import { useState, useMemo, useEffect } from 'react'
import { X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import FilterDropdown, { ALL_OPTION } from '../FilterDropdown'
import { getCurrentWeekLabel, recentWeekLabels, nextWeekLabels, weekLabelFull, weekMondayOf, laborEntryWeekKey } from '../../lib/format'
import { useBranchData } from '../../hooks/useBranchData'
import type { Client } from '../../lib/types'
import { isActiveInMonth, suspensionLabel, formatSuspensionDate } from '../../utils/suspension'
import { branchOf } from '../../lib/branchRef'

interface Props {
  clients: Client[]
  toast: (msg: string) => void
  onClose: () => void
}

export function BulkLaborModal({ clients, toast, onClose }: Props) {
  const { user } = useAuth()
  const [bulkWeek, setBulkWeek] = useState(getCurrentWeekLabel())
  const [bulkExtraWeeks, setBulkExtraWeeks] = useState(0)
  const [bulkValues, setBulkValues] = useState<Record<string, string>>({})
  const [bulkPrevValues, setBulkPrevValues] = useState<Record<string, number>>({})
  const [savedRows, setSavedRows] = useState<Record<string, { id: string; count: number }>>({})
  const [bulkSearch, setBulkSearch] = useState('')
  const [bulkRegions, setBulkRegions] = useState<string[]>([ALL_OPTION])
  const [bulkSaving, setBulkSaving] = useState(false)
  const [, setWeekDataLoaded] = useState(false)

  const { branches } = useBranchData()

  const bulkWeekGroups = useMemo(() => {
    return [...nextWeekLabels(bulkExtraWeeks), ...recentWeekLabels(6)]
  }, [bulkExtraWeeks])

  // Nhãn tuần (TmWw) không mang năm — lấy tháng/năm từ chính nhóm chứa nó.
  const monthOfWeek = useMemo(() => {
    const map: Record<string, string> = {}
    for (const g of bulkWeekGroups) {
      const m = g.month.match(/Tháng\s+(\d+)\/(\d+)/)
      if (!m) continue
      const key = `${m[2]}-${String(Number(m[1])).padStart(2, '0')}`
      for (const l of g.labels) map[l] = key
    }
    return map
  }, [bulkWeekGroups])

  const bulkMonth = monthOfWeek[bulkWeek] ?? null

  // Khách đã ngưng vẫn phải nhập được số LĐ của THÁNG NGƯNG (tháng cuối cùng).
  // Ví dụ ngưng 30/06 → các tuần thuộc tháng 06 vẫn hiện; từ tháng 07 mới ẩn.
  const activeClients = useMemo(
    () => clients.filter(c =>
      c.client_type === 'active' &&
      (c.cooperation_status !== 'suspended' || (bulkMonth != null && isActiveInMonth(c, bulkMonth)))
    ),
    [clients, bulkMonth]
  )

  // Hiển thị tên chi nhánh chuẩn (branches.name); client.region vẫn lưu key cũ
  // (branches.region) nên khi lọc phải chấp nhận cả 2 giá trị.
  const regionNames = useMemo(() => [ALL_OPTION, ...branches.map(b => b.name)], [branches])

  // Lọc theo TÊN CHUẨN của chi nhánh (branches.name).
  const matchesBranchFilter = useMemo(() => {
    const sel = new Set(bulkRegions)
    return (c: Client) => sel.has(ALL_OPTION) || sel.has(branchOf(c, branches)?.name ?? '')
  }, [branches, bulkRegions])

  const filteredClients = useMemo(() =>
    activeClients
      .filter(matchesBranchFilter)
      .filter(c => !bulkSearch || c.name.toLowerCase().includes(bulkSearch.toLowerCase())),
    [activeClients, matchesBranchFilter, bulkSearch]
  )

  // Số "gần nhất trước tuần đang nhập" của từng khách (carry-forward) — đúng cách báo cáo LĐ tính khi tuần không nhập.
  async function fetchCarryForward(week: string): Promise<Record<string, number>> {
    const ym = monthOfWeek[week]
    const year = ym ? Number(ym.slice(0, 4)) : new Date().getFullYear()
    const mon = weekMondayOf(week, year)
    if (!mon) return {}
    const selKey = `${mon.getFullYear()}-${String(mon.getMonth() + 1).padStart(2, '0')}-${String(mon.getDate()).padStart(2, '0')}`
    const rows: { client_id: string; week_label: string; count: number; created_at: string }[] = []
    for (let from = 0; ; from += 1000) {
      const { data } = await supabase.from('client_labor_history')
        .select('client_id, week_label, count, created_at')
        .order('created_at', { ascending: true })
        .range(from, from + 999)
      if (!data || !data.length) break
      rows.push(...(data as typeof rows))
      if (data.length < 1000) break
    }
    const best: Record<string, { k: string; created: string; count: number }> = {}
    for (const r of rows) {
      const k = laborEntryWeekKey(r)
      if (!k || k >= selKey) continue
      const b = best[r.client_id]
      if (!b || k > b.k || (k === b.k && r.created_at > b.created)) best[r.client_id] = { k, created: r.created_at, count: r.count }
    }
    const out: Record<string, number> = {}
    for (const [id, b] of Object.entries(best)) out[id] = b.count
    return out
  }

  async function loadWeekData(week: string) {
    setWeekDataLoaded(false)
    const [{ data }, prev] = await Promise.all([
      supabase.from('client_labor_history').select('id, client_id, count').eq('week_label', week),
      fetchCarryForward(week),
    ])
    const prefilled: Record<string, string> = {}
    const saved: Record<string, { id: string; count: number }> = {}
    if (data) {
      for (const row of data as { id: string; client_id: string; count: number }[]) {
        prefilled[row.client_id] = String(row.count)
        saved[row.client_id] = { id: row.id, count: row.count }
      }
    }
    setBulkValues(prefilled)
    setSavedRows(saved)
    setBulkPrevValues(prev)
    setWeekDataLoaded(true)
  }

  // Load data khi mo modal lan dau
  useEffect(() => { loadWeekData(bulkWeek) }, [])

  function handleWeekChange(week: string) {
    setBulkWeek(week)
    loadWeekData(week)
  }

  async function save() {
    const entries = Object.entries(bulkValues).filter(([, v]) => v.trim() !== '')
    // Ô đã có số lưu cho tuần này mà nay bị xoá trống → xoá số đó (tuần sẽ lấy lại số tuần trước).
    const toDelete = Object.entries(savedRows).filter(([cid]) => (bulkValues[cid] ?? '').trim() === '')
    if (!entries.length && !toDelete.length) { toast('Chua nhap so lieu nao'); return }
    if (toDelete.length) {
      const names = toDelete.map(([cid]) => clients.find(c => c.id === cid)?.name ?? cid)
      const shown = names.slice(0, 5).join(', ') + (names.length > 5 ? ` và ${names.length - 5} công ty khác` : '')
      const ok = window.confirm(
        `Bạn đã xoá trống số lao động tuần ${bulkWeek} của ${toDelete.length} công ty: ${shown}.\n\n` +
        `Lưu sẽ XOÁ HẲN số đã ghi của tuần này (không khôi phục được). Tuần đó sẽ lấy lại số của tuần trước.\n\nTiếp tục?`
      )
      if (!ok) return
    }
    setBulkSaving(true)
    let success = 0
    try {
      for (const [, row] of toDelete) {
        const { error } = await supabase.from('client_labor_history').delete().eq('id', row.id)
        if (error) throw error
        success++
      }
      for (const [clientId, valStr] of entries) {
        const newCount = Math.max(0, parseInt(valStr) || 0)
        // Kiem tra da co du lieu tuan nay chua
        const { data: existing } = await supabase.from('client_labor_history')
          .select('id, count')
          .eq('client_id', clientId)
          .eq('week_label', bulkWeek)
          .maybeSingle()
        if (existing) {
          if (existing.count === newCount) continue
          await supabase.from('client_labor_history')
            .update({ count: newCount, updated_by: (user as any)?.full_name || null })
            .eq('id', existing.id)
        } else {
          await supabase.from('client_labor_history')
            .insert({ client_id: clientId, week_label: bulkWeek, count: newCount, updated_by: (user as any)?.full_name || null })
        }
        success++
      }
      toast(`Da luu LD tuan ${bulkWeek} cho ${success} cong ty`)
      // Giữ cửa sổ mở để nhập tiếp tuần/chi nhánh khác — chỉ tải lại số liệu tuần này.
      await loadWeekData(bulkWeek)
    } catch {
      toast('Co loi khi luu, vui long thu lai')
    } finally {
      setBulkSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <h2 className="text-[14px] font-semibold text-gray-900">Nhập nhanh số lao động</h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-md">
            <X size={16} className="text-gray-500" />
          </button>
        </div>

        <div className="px-5 py-3 border-b border-gray-200 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <label className="text-[11.5px] font-semibold text-gray-700">Tuần:</label>
            <select value={bulkWeek} onChange={e => handleWeekChange(e.target.value)} className="text-[12px] px-2 py-1.5 border border-gray-300 rounded-lg outline-none focus:border-blue-500">
              {bulkWeekGroups.map(g => (
                <optgroup key={g.month} label={g.month}>
                  {g.labels.map(l => <option key={l} value={l}>{weekLabelFull(l)}</option>)}
                </optgroup>
              ))}
            </select>
            <button
              onClick={() => {
                const next = nextWeekLabels(bulkExtraWeeks + 1)[0].labels[0]
                setBulkExtraWeeks(n => n + 1)
                handleWeekChange(next)
              }}
              className="text-[12px] text-blue-600 hover:underline"
            >+ Tuần tiếp theo</button>
          </div>
          <div className="flex items-center gap-2">
            <FilterDropdown label="Chi nhánh" options={regionNames} selected={bulkRegions} onChange={setBulkRegions} />
            <input
              type="text" placeholder="Tìm công ty..."
              value={bulkSearch} onChange={e => setBulkSearch(e.target.value)}
              className="flex-1 text-[12px] px-2.5 py-1.5 border border-gray-300 rounded-lg outline-none focus:border-blue-500"
            />
          </div>
        </div>

        {(() => {
          // Ô trống = lấy số tuần trước (giống báo cáo), nên tổng cũng tính theo số đó.
          const totalCur = filteredClients.reduce((s, c) => {
            const v = (bulkValues[c.id] ?? '').trim()
            return s + (v !== '' ? (parseInt(v) || 0) : (bulkPrevValues[c.id] ?? 0))
          }, 0)
          const totalPrev = filteredClients.reduce((s, c) => s + (bulkPrevValues[c.id] ?? 0), 0)
          const diff = totalCur - totalPrev
          const hasPrev = Object.keys(bulkPrevValues).length > 0
          return (
            <div className="px-5 py-2 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
              <div className="text-[12px] text-gray-600">Tổng: <span className="text-[15px] font-bold text-gray-900">{totalCur.toLocaleString('vi-VN')}</span> lao động</div>
              {hasPrev && <div className={`text-[12px] font-semibold ${diff > 0 ? 'text-emerald-600' : diff < 0 ? 'text-red-600' : 'text-gray-400'}`}>{diff > 0 ? `+${diff.toLocaleString('vi-VN')}` : diff.toLocaleString('vi-VN')} so với tuần trước</div>}
            </div>
          )
        })()}

        <div className="flex-1 overflow-y-auto px-5 py-2 divide-y divide-gray-100">
          {filteredClients.map(c => {
            const hasData = bulkValues[c.id] !== undefined && bulkValues[c.id] !== ''
            const prevVal = bulkPrevValues[c.id]
            const showPrevHint = prevVal !== undefined && !hasData
            return (
              <div key={c.id} className="flex items-center justify-between py-1.5 gap-2">
                <span className="text-[12.5px] text-gray-800 truncate flex-1">
                  {c.name}
                  {c.cooperation_status === 'suspended' && (
                    <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-orange-50 text-orange-700 border border-orange-200 whitespace-nowrap"
                      title={`${suspensionLabel(c)} — đây là tháng cuối cùng còn nhập số lao động`}>
                      Ngưng {formatSuspensionDate(c)} · tháng cuối
                    </span>
                  )}
                </span>
                {showPrevHint && (
                  <button
                    type="button"
                    onClick={() => setBulkValues(prev => ({ ...prev, [c.id]: String(prevVal) }))}
                    title={`Tuần trước: ${prevVal} — bấm để điền nhanh`}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 transition whitespace-nowrap"
                  >{prevVal}</button>
                )}
                <input
                  type="number" min={0}
                  placeholder={String(prevVal ?? 0)}
                  value={bulkValues[c.id] ?? ''}
                  onChange={e => setBulkValues(prev => ({ ...prev, [c.id]: e.target.value }))}
                  className="w-20 text-[12px] px-2 py-1 border border-gray-300 rounded-lg outline-none focus:border-blue-500 text-right"
                />
              </div>
            )
          })}
          {filteredClients.length === 0 && (
            <div className="text-center py-6 text-[12px] text-gray-400">Không tìm thấy công ty</div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-gray-200 flex gap-2">
          <button onClick={onClose} className="flex-1 px-3 py-2 text-[13px] font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition">Hủy</button>
          <button onClick={save} disabled={bulkSaving} className="flex-1 px-3 py-2 text-[13px] font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg transition">
            {bulkSaving ? 'Đang lưu...' : 'Lưu tất cả'}
          </button>
        </div>
      </div>
    </div>
  )
}
