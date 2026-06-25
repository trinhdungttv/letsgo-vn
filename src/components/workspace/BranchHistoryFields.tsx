import { useEffect, useMemo, useState } from 'react'
import { History, ChevronDown, ChevronUp, Activity, AlertTriangle, TrendingUp, CalendarDays, Pencil, Trash2, Check, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import type { Branch, MorningPriority } from '../../lib/types'
import { GOAL_TYPE_LABELS } from '../../lib/types'
import { formatDate } from '../../lib/format'

interface Props {
  branch: Branch
  onChange: (fields: Partial<Branch>) => void
  refreshKey?: number
  recordDate: string
  onRecordDateChange: (date: string) => void
}

const OUTCOME_LABELS: Record<string, { label: string; cls: string }> = {
  done: { label: 'Hoàn thành', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  partial: { label: 'Một phần', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  missed: { label: 'Chưa đạt', cls: 'bg-red-50 text-red-700 border-red-200' },
}

const WEEKDAY_LABELS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']

const inputCls = "w-full text-[12px] border border-[#E5E3DD] rounded-md px-2.5 py-2 bg-[#FAFAF8] text-[#333] placeholder:text-[#bbb] focus:outline-none focus:border-blue-400 focus:bg-white transition-colors resize-y min-h-[64px]"
const editInputCls = "w-full text-[11px] border border-[#E5E3DD] rounded-md px-2 py-1.5 bg-white text-[#333] focus:outline-none focus:border-blue-400 transition-colors resize-y min-h-[40px]"

const FIELD_META: Record<string, { icon: typeof Activity; color: string }> = {
  'Tình trạng': { icon: Activity, color: 'text-blue-500' },
  'Khó khăn': { icon: AlertTriangle, color: 'text-amber-500' },
  'Cơ hội': { icon: TrendingUp, color: 'text-emerald-500' },
}

// Tách goal_note dạng "Tình trạng: ... Khó khăn: ... Cơ hội: ..." (nối bằng \n)
// thành từng mục riêng để hiển thị mỗi mục 1 dòng.
function parseGoalNote(note: string): { label: string; text: string }[] | null {
  const re = /(Tình trạng|Khó khăn|Cơ hội): /g
  const matches = [...note.matchAll(re)]
  if (!matches.length) return null
  return matches.map((m, i) => {
    const start = m.index! + m[0].length
    const end = i + 1 < matches.length ? matches[i + 1].index! : note.length
    return { label: m[1], text: note.slice(start, end).trim() }
  })
}

export function todayStr(): string {
  return new Date().toISOString().split('T')[0]
}

// Ghi nhận 1 "phiên" trao đổi/cập nhật thông tin chi nhánh vào morning_priorities
// (đè lên phiên trong ngày nếu đã có) — để lịch & lịch sử trao đổi nhận biết
// ngày hôm nay đã có cập nhật.
export async function recordBranchUpdateSession(
  userId: string,
  region: string,
  fields: { status_note: string | null; difficulties: string | null; opportunities: string | null },
  priority_date: string = todayStr()
) {
  if (!region) return
  const target = `Chi nhánh ${region}`
  const parts: string[] = []
  if (fields.status_note?.trim()) parts.push(`Tình trạng: ${fields.status_note.trim()}`)
  if (fields.difficulties?.trim()) parts.push(`Khó khăn: ${fields.difficulties.trim()}`)
  if (fields.opportunities?.trim()) parts.push(`Cơ hội: ${fields.opportunities.trim()}`)
  const goal_note = parts.join('\n') || 'Cập nhật thông tin chi nhánh'

  const { data: existing, error: selectError } = await supabase
    .from('morning_priorities')
    .select('id')
    .eq('target_name', target)
    .eq('priority_date', priority_date)
    .maybeSingle()
  if (selectError) throw selectError

  if (existing) {
    const { error } = await supabase.from('morning_priorities').update({ goal_note, goal_type: 'cap_nhat', updated_at: new Date().toISOString() }).eq('id', existing.id)
    if (error) throw error
  } else {
    const { error } = await supabase.from('morning_priorities').insert({
      user_id: userId,
      priority_date,
      target_name: target,
      target_kcn: null,
      goal_type: 'cap_nhat',
      goal_note,
      outcome_note: null,
      outcome_status: null,
    })
    if (error) throw error
  }
}

// Trả về danh sách "YYYY-MM-DD" (hoặc null cho ô trống đầu lịch) cho tháng hiện tại,
// tuần bắt đầu từ Thứ 2.
function buildMonthGrid(): (string | null)[] {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1
  const daysInMonth = new Date(year, month, 0).getDate()
  const startWeekday = (new Date(year, month - 1, 1).getDay() + 6) % 7
  const cells: (string | null)[] = []
  for (let i = 0; i < startWeekday; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(`${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`)
  }
  return cells
}

// Hiển thị lịch sử trao đổi công việc của chi nhánh (từ morning_priorities,
// target_client = "Chi nhánh {region}") và 3 ô ghi nhanh Tình trạng/Khó khăn/Cơ hội.
// Dùng chung cho tab "Hồ sơ chi nhánh" (Branches.tsx) và panel cập nhật nhanh
// từ Workspace -> Morning Priority -> "Cập nhật thông tin CN".
export function BranchHistoryFields({ branch, onChange, refreshKey, recordDate, onRecordDateChange }: Props) {
  const [history, setHistory] = useState<MorningPriority[]>([])
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<{ status_note: string; difficulties: string; opportunities: string }>({ status_note: '', difficulties: '', opportunities: '' })
  const [editSaving, setEditSaving] = useState(false)

  useEffect(() => {
    if (!branch.region) { setHistory([]); return }
    supabase
      .from('morning_priorities')
      .select('*')
      .eq('target_name', `Chi nhánh ${branch.region}`)
      .order('priority_date', { ascending: false })
      .limit(20)
      .then(({ data }) => setHistory((data || []) as MorningPriority[]))
  }, [branch.region, refreshKey])

  const monthGrid = useMemo(buildMonthGrid, [])
  const sessionDates = useMemo(() => new Set(history.map(h => h.priority_date)), [history])
  const today = todayStr()
  const selectedEntries = selectedDate ? history.filter(h => h.priority_date === selectedDate) : []

  function startEdit(h: MorningPriority) {
    const parsed = h.goal_note ? parseGoalNote(h.goal_note) : null
    setEditForm({
      status_note: parsed?.find(f => f.label === 'Tình trạng')?.text || '',
      difficulties: parsed?.find(f => f.label === 'Khó khăn')?.text || '',
      opportunities: parsed?.find(f => f.label === 'Cơ hội')?.text || '',
    })
    setEditingId(h.id)
  }

  async function saveEdit(id: string) {
    setEditSaving(true)
    const parts: string[] = []
    if (editForm.status_note.trim()) parts.push(`Tình trạng: ${editForm.status_note.trim()}`)
    if (editForm.difficulties.trim()) parts.push(`Khó khăn: ${editForm.difficulties.trim()}`)
    if (editForm.opportunities.trim()) parts.push(`Cơ hội: ${editForm.opportunities.trim()}`)
    const goal_note = parts.join('\n') || 'Cập nhật thông tin chi nhánh'
    const { error } = await supabase.from('morning_priorities').update({ goal_note, updated_at: new Date().toISOString() }).eq('id', id)
    if (!error) {
      setHistory(prev => prev.map(h => h.id === id ? { ...h, goal_note } : h))
    }
    setEditingId(null)
    setEditSaving(false)
  }

  async function deleteEntry(id: string) {
    if (!confirm('Xoá phiên ghi nhận này?')) return
    const { error } = await supabase.from('morning_priorities').delete().eq('id', id)
    if (!error) {
      setHistory(prev => prev.filter(h => h.id !== id))
    }
  }

  function renderEntry(h: MorningPriority, forceOpen = false) {
    const outcome = h.outcome_status ? OUTCOME_LABELS[h.outcome_status] : null
    const isExpanded = forceOpen || expandedId === h.id
    const isEditing = editingId === h.id
    return (
      <div key={h.id} className="border border-[#E8E7E2] bg-[#fafafa] rounded-lg overflow-hidden group/entry">
        <div
          onClick={() => !forceOpen && !isEditing && setExpandedId(prev => prev === h.id ? null : h.id)}
          className={`flex items-center justify-between gap-2 px-2.5 py-1.5 ${forceOpen || isEditing ? '' : 'cursor-pointer hover:bg-[#f0f0ed] transition-colors'}`}
        >
          <span className="text-[11px] font-medium text-[#111]">Phiên {formatDate(h.priority_date)}</span>
          <div className="flex items-center gap-1 shrink-0">
            {!isEditing && (
              <div className="flex items-center gap-0.5 opacity-0 group-hover/entry:opacity-100 transition-opacity">
                <button
                  onClick={e => { e.stopPropagation(); startEdit(h) }}
                  title="Sửa"
                  className="p-1 rounded hover:bg-blue-50 text-[#ccc] hover:text-blue-500 transition"
                ><Pencil size={11} /></button>
                <button
                  onClick={e => { e.stopPropagation(); deleteEntry(h.id) }}
                  title="Xoá"
                  className="p-1 rounded hover:bg-red-50 text-[#ccc] hover:text-red-500 transition"
                ><Trash2 size={11} /></button>
              </div>
            )}
            {outcome && (
              <span className={`text-[10px] px-2 py-0.5 rounded-full border whitespace-nowrap ${outcome.cls}`}>
                {outcome.label}
              </span>
            )}
            {!forceOpen && !isEditing && (isExpanded ? <ChevronUp size={13} className="text-[#bbb]" /> : <ChevronDown size={13} className="text-[#bbb]" />)}
          </div>
        </div>
        {isEditing ? (
          <div className="px-2.5 pb-2 flex flex-col gap-1.5">
            <div>
              <label className="flex items-center gap-1 text-[9px] font-semibold text-[#999] uppercase tracking-wide mb-0.5">
                <Activity size={10} className="text-blue-500" /> Tình trạng
              </label>
              <textarea value={editForm.status_note} onChange={e => setEditForm(f => ({ ...f, status_note: e.target.value }))} className={editInputCls} rows={2} />
            </div>
            <div>
              <label className="flex items-center gap-1 text-[9px] font-semibold text-[#999] uppercase tracking-wide mb-0.5">
                <AlertTriangle size={10} className="text-amber-500" /> Khó khăn
              </label>
              <textarea value={editForm.difficulties} onChange={e => setEditForm(f => ({ ...f, difficulties: e.target.value }))} className={editInputCls} rows={2} />
            </div>
            <div>
              <label className="flex items-center gap-1 text-[9px] font-semibold text-[#999] uppercase tracking-wide mb-0.5">
                <TrendingUp size={10} className="text-emerald-500" /> Cơ hội
              </label>
              <textarea value={editForm.opportunities} onChange={e => setEditForm(f => ({ ...f, opportunities: e.target.value }))} className={editInputCls} rows={2} />
            </div>
            <div className="flex justify-end gap-1.5 mt-0.5">
              <button onClick={() => setEditingId(null)} className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-md border border-[#E8E7E2] text-[#666] hover:bg-[#f4f4f1] transition">
                <X size={10} /> Huỷ
              </button>
              <button onClick={() => saveEdit(h.id)} disabled={editSaving} className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-md bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-40 transition">
                <Check size={10} /> {editSaving ? '...' : 'Lưu'}
              </button>
            </div>
          </div>
        ) : isExpanded && (
          <div className="px-2.5 pb-2 flex flex-col gap-1.5">
            {(() => {
              const fields = h.goal_note ? parseGoalNote(h.goal_note) : null
              if (fields) {
                return fields.filter(f => f.text).map(f => {
                  const meta = FIELD_META[f.label]
                  const Icon = meta?.icon
                  return (
                    <div key={f.label} className="flex items-start gap-1.5 bg-white border border-[#F0EFEB] rounded-md px-2 py-1.5">
                      {Icon && <Icon size={12} className={`${meta.color} mt-[1px] shrink-0`} />}
                      <div className="min-w-0">
                        <div className="text-[9px] font-semibold text-[#999] uppercase tracking-wide">{f.label}</div>
                        <div className="text-[11px] text-[#444] mt-0.5 whitespace-pre-line break-words">{f.text}</div>
                      </div>
                    </div>
                  )
                })
              }
              return (
                <div className="text-[11px] text-[#666]">
                  {h.goal_note || (h.goal_type ? GOAL_TYPE_LABELS[h.goal_type] : '—')}
                </div>
              )
            })()}
            {h.outcome_note && (
              <div className="text-[11px] text-[#888] bg-white border border-[#F0EFEB] rounded-md px-2 py-1">
                {h.outcome_note}
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      {/* Cột trái: Lịch sử trao đổi */}
      <div className="border border-[#E8E7E2] rounded-lg p-2.5 bg-[#fafafa] flex flex-col">
        <div className="flex items-center gap-1 text-[10px] font-semibold text-[#555] uppercase tracking-wide mb-1.5">
          <History size={12} className="text-[#888]" />
          Lịch sử trao đổi công việc
        </div>

        {history.length === 0 ? (
          <div className="text-[11px] text-[#bbb] py-3 text-center border border-dashed border-[#E8E7E2] rounded-lg bg-white">
            Chưa có lịch sử trao đổi
          </div>
        ) : (
          <>
            {/* Lịch tháng hiện tại — ngày có phiên trao đổi tô xanh, hôm nay viền đỏ */}
            <div className="border border-[#E8E7E2] rounded-lg p-2 mb-2 bg-white">
              <div className="grid grid-cols-7 gap-1 mb-1">
                {WEEKDAY_LABELS.map(d => (
                  <div key={d} className="text-[9px] text-center text-[#bbb] font-medium">{d}</div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {monthGrid.map((dateStr, i) => {
                  if (!dateStr) return <div key={`empty-${i}`} />
                  const hasSession = sessionDates.has(dateStr)
                  const isToday = dateStr === today
                  const isSelected = selectedDate === dateStr
                  const day = Number(dateStr.split('-')[2])
                  return (
                    <button
                      key={dateStr}
                      type="button"
                      onClick={() => hasSession && setSelectedDate(prev => prev === dateStr ? null : dateStr)}
                      className={[
                        'aspect-square flex items-center justify-center rounded-md text-[11px] transition-colors',
                        isSelected ? 'bg-blue-600 text-white font-semibold' : hasSession ? 'bg-blue-50 text-blue-700 font-medium hover:bg-blue-100 cursor-pointer' : 'text-[#ccc] cursor-default',
                        isToday && !isSelected ? 'ring-2 ring-red-400' : '',
                      ].join(' ')}
                    >
                      {day}
                    </button>
                  )
                })}
              </div>
            </div>

            {selectedDate && (
              <div className="flex flex-col gap-1.5 mb-2">
                {selectedEntries.map(h => renderEntry(h, true))}
              </div>
            )}

            <div className="flex flex-col gap-1.5 max-h-56 overflow-y-auto pr-0.5">
              {history.map(h => renderEntry(h))}
            </div>
          </>
        )}
      </div>

      {/* Cột phải: Ghi nhận phiên hôm nay */}
      <div className="border border-[#E8E7E2] rounded-lg bg-white flex flex-col divide-y divide-[#F0EFEB]">
        <div className="p-2.5">
          <label className="flex items-center gap-1 text-[10px] font-semibold text-[#555] uppercase tracking-wide mb-1.5">
            <CalendarDays size={12} className="text-[#888]" />
            Ngày ghi nhận phiên này
          </label>
          <input
            type="date"
            value={recordDate}
            onChange={e => onRecordDateChange(e.target.value)}
            className="text-[12px] border border-[#E5E3DD] rounded-md px-2.5 py-1.5 bg-[#FAFAF8] text-[#333] focus:outline-none focus:border-blue-400 focus:bg-white"
          />
          <div className="text-[10px] text-[#aaa] mt-1">
            Nội dung 3 ô dưới sẽ thành 1 dòng lịch sử cho ngày này khi bấm Lưu.
          </div>
        </div>

        <div className="p-2.5">
          <label className="flex items-center gap-1 text-[10px] font-semibold text-[#555] uppercase tracking-wide mb-1.5">
            <Activity size={12} className="text-blue-500" />
            Tình trạng hiện tại
          </label>
          <textarea
            value={branch.status_note || ''}
            onChange={e => onChange({ status_note: e.target.value })}
            placeholder="Tình trạng hoạt động hiện tại của chi nhánh..."
            className={inputCls}
          />
        </div>

        <div className="p-2.5">
          <label className="flex items-center gap-1 text-[10px] font-semibold text-[#555] uppercase tracking-wide mb-1.5">
            <AlertTriangle size={12} className="text-amber-500" />
            Khó khăn
          </label>
          <textarea
            value={branch.difficulties || ''}
            onChange={e => onChange({ difficulties: e.target.value })}
            placeholder="Những khó khăn chi nhánh đang gặp phải..."
            className={inputCls}
          />
        </div>

        <div className="p-2.5">
          <label className="flex items-center gap-1 text-[10px] font-semibold text-[#555] uppercase tracking-wide mb-1.5">
            <TrendingUp size={12} className="text-emerald-500" />
            Cơ hội
          </label>
          <textarea
            value={branch.opportunities || ''}
            onChange={e => onChange({ opportunities: e.target.value })}
            placeholder="Cơ hội phát triển / mở rộng tại chi nhánh..."
            className={inputCls}
          />
        </div>
      </div>
    </div>
  )
}
