import { useState, useMemo, useEffect } from 'react'
import { X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import FilterDropdown, { ALL_OPTION } from '../FilterDropdown'
import { getCurrentWeekLabel, recentWeekLabels, nextWeekLabels } from '../../lib/format'
import type { Client } from '../../lib/types'

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
  const [bulkSearch, setBulkSearch] = useState('')
  const [bulkRegions, setBulkRegions] = useState<string[]>([ALL_OPTION])
  const [bulkSaving, setBulkSaving] = useState(false)
  const [, setWeekDataLoaded] = useState(false)

  const activeClients = useMemo(
    () => clients.filter(c => c.client_type === 'active' && c.cooperation_status !== 'suspended'),
    [clients]
  )

  const regionNames = useMemo(() => {
    const names = [...new Set(activeClients.map(c => c.region).filter(Boolean) as string[])]
    return [ALL_OPTION, ...names.sort()]
  }, [activeClients])

  const bulkWeekGroups = useMemo(() => {
    return [...nextWeekLabels(bulkExtraWeeks), ...recentWeekLabels(6)]
  }, [bulkExtraWeeks])

  const filteredClients = useMemo(() =>
    activeClients
      .filter(c => bulkRegions.includes(ALL_OPTION) || bulkRegions.includes(c.region || ''))
      .filter(c => !bulkSearch || c.name.toLowerCase().includes(bulkSearch.toLowerCase())),
    [activeClients, bulkRegions, bulkSearch]
  )

  async function loadWeekData(week: string) {
    setWeekDataLoaded(false)
    const { data } = await supabase.from('client_labor_history')
      .select('client_id, count')
      .eq('week_label', week)
    const prefilled: Record<string, string> = {}
    if (data) {
      for (const row of data as { client_id: string; count: number }[]) {
        prefilled[row.client_id] = String(row.count)
      }
    }
    setBulkValues(prefilled)
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
    if (!entries.length) { toast('Chua nhap so lieu nao'); return }
    setBulkSaving(true)
    let success = 0
    try {
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
      onClose()
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
                  {g.labels.map(l => <option key={l} value={l}>{l}</option>)}
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

        <div className="flex-1 overflow-y-auto px-5 py-2 divide-y divide-gray-100">
          {filteredClients.map(c => (
            <div key={c.id} className="flex items-center justify-between py-1.5 gap-3">
              <span className="text-[12.5px] text-gray-800 truncate">{c.name}</span>
              <input
                type="number" min={0}
                placeholder={String(c.current_workers ?? 0)}
                value={bulkValues[c.id] ?? ''}
                onChange={e => setBulkValues(prev => ({ ...prev, [c.id]: e.target.value }))}
                className="w-20 text-[12px] px-2 py-1 border border-gray-300 rounded-lg outline-none focus:border-blue-500 text-right"
              />
            </div>
          ))}
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
