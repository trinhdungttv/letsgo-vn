import { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import { History, ChevronDown, ChevronUp, Activity, AlertTriangle, TrendingUp, Pencil, Trash2, Check, X, Plus, Send, Link2, Unlink, Search, CalendarDays } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import type { Branch, MorningPriority, WorkspaceTaskComment, WsTaskStatus } from '../../lib/types'
import { GOAL_TYPE_LABELS, WS_TASK_STATUS_LABELS, WS_TASK_STATUS_COLORS } from '../../lib/types'
import { formatDate } from '../../lib/format'
import { useAuth } from '../../lib/auth'
import type { WorkspaceTask } from './MyWorkFeed'
import { fetchWorkspaceTaskComments, addWorkspaceTaskComment, updateWorkspaceTaskComment, deleteWorkspaceTaskComment } from '../../lib/workspaceTaskComments'

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

const inputCls = "w-full text-[11.5px] border border-[#E5E3DD] rounded-md px-2.5 py-2 bg-[#FAFAF8] text-[#333] placeholder:text-[#bbb] focus:outline-none focus:border-blue-400 focus:bg-white transition-colors resize-y min-h-[56px]"
const editInputCls = "w-full text-[11px] border border-[#E5E3DD] rounded-md px-2 py-1.5 bg-white text-[#333] focus:outline-none focus:border-blue-400 transition-colors resize-y min-h-[40px]"

const FIELD_META: Record<string, { icon: typeof Activity; color: string }> = {
  'Tình trạng': { icon: Activity, color: 'text-blue-500' },
  'Khó khăn': { icon: AlertTriangle, color: 'text-amber-500' },
  'Cơ hội': { icon: TrendingUp, color: 'text-emerald-500' },
}

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

/** Số ngày đã trôi qua kể từ một ngày (yyyy-mm-dd). */
function daysSince(dateStr: string): number {
  const from = new Date(`${dateStr}T00:00:00`).getTime()
  const now = new Date(`${todayStr()}T00:00:00`).getTime()
  return Math.round((now - from) / 86400000)
}

/** "hôm nay" / "3 ngày trước" — đọc nhanh hơn ngày tuyệt đối. */
function agoLabel(dateStr: string): string {
  const d = daysSince(dateStr)
  if (d <= 0) return 'hôm nay'
  if (d === 1) return 'hôm qua'
  if (d < 30) return `${d} ngày trước`
  const m = Math.floor(d / 30)
  return `${m} tháng trước`
}

// Class viết đủ chữ (không ghép chuỗi động) để Tailwind sinh đúng CSS.
const KIND_META = {
  'Tình trạng': {
    icon: Activity,
    chip: 'bg-blue-50 text-blue-700 border-blue-200',
    chipActive: 'bg-blue-100 text-blue-800 border-blue-400',
  },
  'Khó khăn': {
    icon: AlertTriangle,
    chip: 'bg-amber-50 text-amber-700 border-amber-200',
    chipActive: 'bg-amber-100 text-amber-800 border-amber-400',
  },
  'Cơ hội': {
    icon: TrendingUp,
    chip: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    chipActive: 'bg-emerald-100 text-emerald-800 border-emerald-400',
  },
} as const

type Kind = keyof typeof KIND_META

export function BranchHistoryFields({ branch, onChange, refreshKey, recordDate, onRecordDateChange }: Props) {
  const [history, setHistory] = useState<MorningPriority[]>([])
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<{ status_note: string; difficulties: string; opportunities: string }>({ status_note: '', difficulties: '', opportunities: '' })
  const [editSaving, setEditSaving] = useState(false)
  // Form ghi nhận mặc định đóng — mở bằng nút "Ghi nhận mới" ở đầu khối.
  const [showInputForm, setShowInputForm] = useState(false)
  const [filterKind, setFilterKind] = useState<Kind | 'all'>('all')
  const [search, setSearch] = useState('')
  const [showAllEntries, setShowAllEntries] = useState(false)
  const [saving, setSaving] = useState(false)
  const { user } = useAuth()

  // ---- Việc nội bộ liên kết — Task nội bộ (chung) gắn với chi nhánh này (workspace_tasks.branch_id).
  // Cùng đọc/ghi thẳng workspace_tasks + workspace_task_comments với Workspace > MyWorkFeed —
  // không nhân bản dữ liệu, sửa ở đây hay ở Workspace đều là cùng 1 bảng.
  const [linkedTasks, setLinkedTasks] = useState<WorkspaceTask[]>([])
  const [linkedComments, setLinkedComments] = useState<Record<string, WorkspaceTaskComment[]>>({})
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null)
  const [linkedCommentInput, setLinkedCommentInput] = useState<Record<string, string>>({})
  const [sendingLinkedComment, setSendingLinkedComment] = useState<string | null>(null)
  const [editingLinkedCommentId, setEditingLinkedCommentId] = useState<string | null>(null)
  const [editingLinkedCommentText, setEditingLinkedCommentText] = useState('')

  useEffect(() => {
    if (!branch.id) { setLinkedTasks([]); return }
    let cancelled = false
    ;(async () => {
      const { data } = await supabase
        .from('workspace_tasks')
        .select('*')
        .eq('branch_id', branch.id)
        .eq('type', 'task')
        .order('deadline', { ascending: true })
      if (cancelled) return
      const tasks = (data || []) as WorkspaceTask[]
      setLinkedTasks(tasks)
      const ids = tasks.map(t => t.id)
      if (ids.length) {
        const cData = await fetchWorkspaceTaskComments(ids)
        if (cancelled) return
        const map: Record<string, WorkspaceTaskComment[]> = {}
        for (const c of cData) (map[c.task_id] ||= []).push(c)
        setLinkedComments(map)
      } else {
        setLinkedComments({})
      }
    })()
    return () => { cancelled = true }
  }, [branch.id, refreshKey])

  async function changeLinkedTaskStatus(t: WorkspaceTask, status: WsTaskStatus) {
    setLinkedTasks(prev => prev.map(x => x.id === t.id ? { ...x, status } : x))
    await supabase.from('workspace_tasks').update({ status }).eq('id', t.id)
  }

  async function unlinkTask(t: WorkspaceTask) {
    if (!confirm(`Bỏ liên kết "${t.title}" khỏi chi nhánh này?`)) return
    setLinkedTasks(prev => prev.filter(x => x.id !== t.id))
    await supabase.from('workspace_tasks').update({ branch_id: null }).eq('id', t.id)
  }

  async function sendLinkedComment(taskId: string) {
    const content = (linkedCommentInput[taskId] ?? '').trim()
    if (!content || !user) return
    setSendingLinkedComment(taskId)
    const data = await addWorkspaceTaskComment(taskId, user.id, user.full_name || user.username || 'Người dùng', content)
    if (data) {
      setLinkedComments(prev => ({ ...prev, [taskId]: [...(prev[taskId] ?? []), data] }))
      setLinkedCommentInput(prev => ({ ...prev, [taskId]: '' }))
    }
    setSendingLinkedComment(null)
  }

  async function saveLinkedCommentEdit(commentId: string, taskId: string) {
    const content = editingLinkedCommentText.trim()
    if (!content) return
    setLinkedComments(prev => ({ ...prev, [taskId]: (prev[taskId] ?? []).map(c => c.id === commentId ? { ...c, content } : c) }))
    setEditingLinkedCommentId(null)
    await updateWorkspaceTaskComment(commentId, content)
  }

  async function deleteLinkedComment(commentId: string, taskId: string) {
    setLinkedComments(prev => ({ ...prev, [taskId]: (prev[taskId] ?? []).filter(c => c.id !== commentId) }))
    await deleteWorkspaceTaskComment(commentId)
  }

  // Phiên cập nhật khoá theo TÊN CHUẨN của chi nhánh. Các phiên ghi trước đây dùng
  // tên cũ (branch.region) nên vẫn đọc kèm khoá đó, chỉ ghi mới bằng tên chuẩn.
  const regionKey = branch.name
  const legacyKeys = [branch.name, branch.region].filter(Boolean) as string[]

  // Auto-save draft to localStorage
  const draftKey = regionKey ? `lgvn_branch_draft_${regionKey}` : null
  const draftLoaded = useRef(false)

  useEffect(() => {
    if (!draftKey || draftLoaded.current) return
    try {
      const saved = localStorage.getItem(draftKey)
      if (saved) {
        const draft = JSON.parse(saved)
        if (draft.status_note || draft.difficulties || draft.opportunities) {
          onChange({ status_note: draft.status_note || '', difficulties: draft.difficulties || '', opportunities: draft.opportunities || '' })
          setShowInputForm(true)
        }
      }
    } catch {}
    draftLoaded.current = true
  }, [draftKey])

  const saveDraft = useCallback(() => {
    if (!draftKey) return
    const draft = { status_note: branch.status_note || '', difficulties: branch.difficulties || '', opportunities: branch.opportunities || '' }
    if (draft.status_note || draft.difficulties || draft.opportunities) {
      localStorage.setItem(draftKey, JSON.stringify(draft))
    } else {
      localStorage.removeItem(draftKey)
    }
  }, [draftKey, branch.status_note, branch.difficulties, branch.opportunities])

  useEffect(() => {
    if (!draftLoaded.current) return
    saveDraft()
  }, [saveDraft])

  const hasContent = !!(branch.status_note?.trim() || branch.difficulties?.trim() || branch.opportunities?.trim())

  async function handleSaveSession() {
    if (!user || !regionKey || !hasContent) return
    setSaving(true)
    try {
      await recordBranchUpdateSession(user.id, regionKey, {
        status_note: branch.status_note ?? null,
        difficulties: branch.difficulties ?? null,
        opportunities: branch.opportunities ?? null,
      }, recordDate)
      // Reload history
      const { data } = await supabase
        .from('morning_priorities')
        .select('*')
        .in('target_name', legacyKeys.map(k => `Chi nhánh ${k}`))
        .order('priority_date', { ascending: false })
        .limit(30)
      if (data) setHistory(data as MorningPriority[])
      // Clear fields & draft
      onChange({ status_note: '', difficulties: '', opportunities: '' })
      if (draftKey) localStorage.removeItem(draftKey)
    } catch (e) {
      alert('Lỗi khi lưu: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    if (!regionKey) { setHistory([]); return }
    supabase
      .from('morning_priorities')
      .select('*')
      .in('target_name', legacyKeys.map(k => `Chi nhánh ${k}`))
      .order('priority_date', { ascending: false })
      .limit(30)
      .then(({ data }) => setHistory((data || []) as MorningPriority[]))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regionKey, branch.region, refreshKey])

  // Tách sẵn từng phiên thành 3 trường để lọc/tìm/xem trước mà không phải mở ra.
  const parsedHistory = useMemo(() => history.map(h => {
    const fields = (h.goal_note ? parseGoalNote(h.goal_note) : null)?.filter(f => f.text) ?? []
    const byKind = {} as Record<Kind, string>
    for (const f of fields) if (f.label in KIND_META) byKind[f.label as Kind] = f.text
    return {
      h,
      byKind,
      kinds: fields.map(f => f.label).filter((l): l is Kind => l in KIND_META),
      haystack: `${h.goal_note ?? ''} ${h.outcome_note ?? ''}`.toLowerCase(),
    }
  }), [history])

  const filteredHistory = useMemo(() => {
    const q = search.trim().toLowerCase()
    return parsedHistory.filter(e => {
      if (filterKind !== 'all' && !e.kinds.includes(filterKind)) return false
      if (q && !e.haystack.includes(q)) return false
      return true
    })
  }, [parsedHistory, filterKind, search])

  const visibleHistory = showAllEntries ? filteredHistory : filteredHistory.slice(0, 10)

  /** Gom theo tháng để dòng thời gian có mốc, thay cho lưới lịch cũ. */
  const groupedHistory = useMemo(() => {
    const groups: { month: string; items: typeof visibleHistory }[] = []
    for (const e of visibleHistory) {
      const month = e.h.priority_date.slice(0, 7)
      const last = groups[groups.length - 1]
      if (last && last.month === month) last.items.push(e)
      else groups.push({ month, items: [e] })
    }
    return groups
  }, [visibleHistory])

  // Số liệu cho dải tóm tắt — trả lời ngay "lâu chưa ghi nhận?" và "đang vướng gì?"
  const stats = useMemo(() => {
    const last = parsedHistory[0]?.h.priority_date ?? null
    const since = last ? daysSince(last) : null
    const in30 = parsedHistory.filter(e => daysSince(e.h.priority_date) <= 30).length
    const latestIssue = parsedHistory.find(e => e.byKind['Khó khăn'])
    return {
      last,
      since,
      in30,
      issues: parsedHistory.filter(e => e.byKind['Khó khăn']).length,
      chances: parsedHistory.filter(e => e.byKind['Cơ hội']).length,
      latestIssue,
    }
  }, [parsedHistory])

  const pastSuggestions = useMemo(() => {
    const status: string[] = []
    const difficulties: string[] = []
    const opportunities: string[] = []
    const seen = { s: new Set<string>(), d: new Set<string>(), o: new Set<string>() }
    for (const h of history) {
      if (!h.goal_note) continue
      const parsed = parseGoalNote(h.goal_note)
      if (!parsed) continue
      for (const f of parsed) {
        const t = f.text.trim()
        if (!t) continue
        if (f.label === 'Tình trạng' && !seen.s.has(t)) { seen.s.add(t); status.push(t) }
        if (f.label === 'Khó khăn' && !seen.d.has(t)) { seen.d.add(t); difficulties.push(t) }
        if (f.label === 'Cơ hội' && !seen.o.has(t)) { seen.o.add(t); opportunities.push(t) }
      }
    }
    return { status: status.slice(0, 5), difficulties: difficulties.slice(0, 5), opportunities: opportunities.slice(0, 5) }
  }, [history])

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
    const preview = parsedHistory.find(e => e.h.id === h.id) ?? { byKind: {} as Record<Kind, string> }
    const outcome = h.outcome_status ? OUTCOME_LABELS[h.outcome_status] : null
    const isExpanded = forceOpen || expandedId === h.id
    const isEditing = editingId === h.id
    return (
      <div key={h.id} className="border border-[#E8E7E2] bg-white rounded-lg overflow-hidden group/entry">
        <div
          onClick={() => !forceOpen && !isEditing && setExpandedId(prev => prev === h.id ? null : h.id)}
          className={`flex items-center justify-between gap-2 px-3 py-2 ${forceOpen || isEditing ? 'bg-[#fafafa]' : 'cursor-pointer hover:bg-[#fafafa] transition-colors'}`}
        >
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span className="text-[11.5px] font-semibold text-[#111] shrink-0 w-[78px]">{formatDate(h.priority_date)}</span>
            <span className="text-[10px] text-[#bbb] shrink-0 w-[74px]">{agoLabel(h.priority_date)}</span>
            {/* Chip loại + trích nội dung — xem lướt được mà không cần mở phiên */}
            <div className="flex items-center gap-1 shrink-0">
              {(Object.keys(KIND_META) as Kind[]).filter(k => !!preview.byKind[k]).map(k => {
                const Icon = KIND_META[k].icon
                return (
                  <span key={k} title={k} className={`inline-flex items-center gap-0.5 text-[9.5px] px-1.5 py-0.5 rounded-full border ${KIND_META[k].chip}`}>
                    <Icon size={9} /> {k}
                  </span>
                )
              })}
            </div>
            {!isExpanded && !isEditing && (
              <span className="text-[11px] text-[#999] truncate min-w-0">
                {preview.byKind['Khó khăn'] || preview.byKind['Tình trạng'] || preview.byKind['Cơ hội'] || h.goal_note || ''}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
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
            {!forceOpen && !isEditing && (isExpanded ? <ChevronUp size={12} className="text-[#bbb]" /> : <ChevronDown size={12} className="text-[#bbb]" />)}
          </div>
        </div>
        {isEditing ? (
          <div className="px-3 pb-2.5 flex flex-col gap-1.5">
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
          <div className="px-3 pb-2.5 flex flex-col gap-1.5">
            {(() => {
              const fields = h.goal_note ? parseGoalNote(h.goal_note) : null
              if (fields) {
                return fields.filter(f => f.text).map(f => {
                  const meta = FIELD_META[f.label]
                  const Icon = meta?.icon
                  return (
                    <div key={f.label} className="flex items-start gap-1.5 bg-[#fafafa] border border-[#F0EFEB] rounded-md px-2.5 py-1.5">
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
              <div className="text-[11px] text-[#888] bg-[#fafafa] border border-[#F0EFEB] rounded-md px-2 py-1">
                {h.outcome_note}
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">

      {/* ── 1. Dải tóm tắt — trả lời ngay "lâu chưa ghi nhận?" và "đang vướng gì?" ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        <div className="border border-[#E8E7E2] rounded-lg bg-white px-3 py-2">
          <div className="text-[9.5px] uppercase tracking-wide text-[#aaa] font-semibold">Ghi nhận gần nhất</div>
          <div className="text-[14px] font-bold text-[#111] mt-0.5">
            {stats.last ? formatDate(stats.last) : '—'}
          </div>
          <div className={`text-[10px] mt-0.5 ${stats.since === null ? 'text-[#bbb]' : stats.since > 14 ? 'text-red-600 font-medium' : 'text-[#999]'}`}>
            {stats.since === null
              ? 'Chưa có phiên nào'
              : stats.since > 14 ? `⚠ ${agoLabel(stats.last!)} — nên cập nhật` : agoLabel(stats.last!)}
          </div>
        </div>
        <div className="border border-[#E8E7E2] rounded-lg bg-white px-3 py-2">
          <div className="text-[9.5px] uppercase tracking-wide text-[#aaa] font-semibold">Phiên 30 ngày qua</div>
          <div className="text-[14px] font-bold text-[#111] mt-0.5">{stats.in30}</div>
          <div className="text-[10px] text-[#999] mt-0.5">tổng cộng {history.length} phiên</div>
        </div>
        <button
          type="button"
          onClick={() => setFilterKind(k => k === 'Khó khăn' ? 'all' : 'Khó khăn')}
          className={`text-left border rounded-lg px-3 py-2 transition ${filterKind === 'Khó khăn' ? 'border-amber-400 bg-amber-50' : 'border-[#E8E7E2] bg-white hover:border-amber-300'}`}
        >
          <div className="text-[9.5px] uppercase tracking-wide text-[#aaa] font-semibold">Phiên có khó khăn</div>
          <div className="text-[14px] font-bold text-amber-600 mt-0.5">{stats.issues}</div>
          <div className="text-[10px] text-[#999] mt-0.5">bấm để lọc riêng</div>
        </button>
        <button
          type="button"
          onClick={() => setFilterKind(k => k === 'Cơ hội' ? 'all' : 'Cơ hội')}
          className={`text-left border rounded-lg px-3 py-2 transition ${filterKind === 'Cơ hội' ? 'border-emerald-400 bg-emerald-50' : 'border-[#E8E7E2] bg-white hover:border-emerald-300'}`}
        >
          <div className="text-[9.5px] uppercase tracking-wide text-[#aaa] font-semibold">Phiên có cơ hội</div>
          <div className="text-[14px] font-bold text-emerald-600 mt-0.5">{stats.chances}</div>
          <div className="text-[10px] text-[#999] mt-0.5">bấm để lọc riêng</div>
        </button>
      </div>

      {/* ── 2. Khó khăn mới nhất — đưa lên đầu để xử lý cho kịp ── */}
      {stats.latestIssue && (
        <div className="border border-amber-200 bg-amber-50/60 rounded-lg px-3 py-2.5 flex items-start gap-2">
          <AlertTriangle size={14} className="text-amber-500 shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <div className="text-[9.5px] uppercase tracking-wide text-amber-700 font-semibold">
              Khó khăn mới nhất · {formatDate(stats.latestIssue.h.priority_date)} ({agoLabel(stats.latestIssue.h.priority_date)})
            </div>
            <div className="text-[12px] text-[#4A3208] mt-1 whitespace-pre-line break-words">
              {stats.latestIssue.byKind['Khó khăn']}
            </div>
          </div>
          <button
            type="button"
            onClick={() => { setFilterKind('all'); setSearch(''); setExpandedId(stats.latestIssue!.h.id) }}
            className="text-[10.5px] text-amber-700 hover:underline shrink-0 whitespace-nowrap"
          >Xem phiên</button>
        </div>
      )}

      {/* ── 3. Ghi nhận phiên mới — đưa lên trên, mặc định đóng ── */}
      <div className="border border-[#E8E7E2] rounded-lg bg-white overflow-hidden">
        <div className="flex items-center justify-between gap-2 px-3 py-2 bg-[#FAFAF8] border-b border-[#E8E7E2]">
          <button
            type="button"
            onClick={() => setShowInputForm(v => !v)}
            className="flex items-center gap-2 min-w-0 text-left"
          >
            <Plus size={12} className="text-[#7C3AED] shrink-0" />
            <span className="text-[10.5px] font-semibold text-[#555] uppercase tracking-wide">Ghi nhận phiên mới</span>
            {showInputForm ? <ChevronUp size={12} className="text-[#bbb]" /> : <ChevronDown size={12} className="text-[#bbb]" />}
          </button>
          {/* Ngày ghi nhận — trước đây cố định là hôm nay, không sửa được */}
          <label className="flex items-center gap-1.5 shrink-0">
            <CalendarDays size={11} className="text-[#aaa]" />
            <span className="text-[10px] text-[#999]">Ngày ghi nhận</span>
            <input
              type="date"
              value={recordDate}
              onChange={e => onRecordDateChange(e.target.value)}
              className="text-[11px] px-1.5 py-0.5 border border-[#E5E3DD] rounded bg-white text-[#333] focus:outline-none focus:border-blue-400"
            />
          </label>
        </div>
        {showInputForm && (
          <div className="p-3 flex flex-col gap-3">
            <div>
              <label className="flex items-center gap-1 text-[9.5px] font-semibold text-[#888] uppercase tracking-wide mb-1">
                <Activity size={11} className="text-blue-500" />
                Tình trạng hiện tại
              </label>
              <textarea
                value={branch.status_note || ''}
                onChange={e => onChange({ status_note: e.target.value })}
                placeholder="Nhập tình trạng hoạt động..."
                rows={3}
                className={inputCls}
              />
              {pastSuggestions.status.length > 0 && !branch.status_note && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {pastSuggestions.status.map((s, i) => (
                    <button key={i} type="button" onClick={() => onChange({ status_note: s })}
                      className="text-[9px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 hover:bg-blue-100 transition truncate max-w-[140px] border border-blue-100">
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div>
              <label className="flex items-center gap-1 text-[9.5px] font-semibold text-[#888] uppercase tracking-wide mb-1">
                <AlertTriangle size={11} className="text-amber-500" />
                Khó khăn
              </label>
              <textarea
                value={branch.difficulties || ''}
                onChange={e => onChange({ difficulties: e.target.value })}
                placeholder="Nhập khó khăn đang gặp..."
                rows={3}
                className={inputCls}
              />
              {pastSuggestions.difficulties.length > 0 && !branch.difficulties && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {pastSuggestions.difficulties.map((s, i) => (
                    <button key={i} type="button" onClick={() => onChange({ difficulties: s })}
                      className="text-[9px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-600 hover:bg-amber-100 transition truncate max-w-[140px] border border-amber-100">
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div>
              <label className="flex items-center gap-1 text-[9.5px] font-semibold text-[#888] uppercase tracking-wide mb-1">
                <TrendingUp size={11} className="text-emerald-500" />
                Cơ hội
              </label>
              <textarea
                value={branch.opportunities || ''}
                onChange={e => onChange({ opportunities: e.target.value })}
                placeholder="Nhập cơ hội phát triển..."
                rows={3}
                className={inputCls}
              />
              {pastSuggestions.opportunities.length > 0 && !branch.opportunities && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {pastSuggestions.opportunities.map((s, i) => (
                    <button key={i} type="button" onClick={() => onChange({ opportunities: s })}
                      className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-600 hover:bg-emerald-100 transition truncate max-w-[140px] border border-emerald-100">
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {/* Save button */}
            <div className="flex flex-col gap-1.5 pt-0.5">
              <button
                onClick={handleSaveSession}
                disabled={saving || !hasContent}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-[12.5px] font-semibold bg-[#7C3AED] text-white hover:bg-[#6D28D9] disabled:opacity-40 transition shadow-sm"
              >
                <Send size={13} />
                {saving ? 'Đang lưu...' : 'Lưu phiên ghi nhận'}
              </button>
              {draftKey && hasContent && (
                <span className="text-[9px] text-[#bbb] flex items-center justify-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
                  Bản nháp đã lưu tự động
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── 4. Việc nội bộ liên kết (giữ nguyên) ── */}
      {linkedTasks.length > 0 && (
        <div className="border border-[#E8E7E2] rounded-lg bg-white overflow-hidden">
          <div className="flex items-center gap-1.5 px-2.5 py-2 bg-[#fafafa] border-b border-[#E8E7E2]">
            <Link2 size={12} className="text-[#7C3AED]" />
            <span className="text-[10px] font-semibold text-[#555] uppercase tracking-wide">Việc nội bộ liên kết</span>
            <span className="text-[9px] text-[#bbb] ml-auto">{linkedTasks.length} việc</span>
          </div>
          <div className="flex flex-col divide-y divide-[#F0EFEB]">
            {linkedTasks.map(t => {
              const isExpanded = expandedTaskId === t.id
              const cmts = linkedComments[t.id] ?? []
              return (
                <div key={t.id} className="px-2.5 py-2">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <button
                      onClick={() => setExpandedTaskId(isExpanded ? null : t.id)}
                      className="text-[11.5px] font-semibold text-[#111] text-left hover:underline flex-1 min-w-[120px]"
                    >
                      {t.title}
                    </button>
                    <select
                      value={t.status in WS_TASK_STATUS_LABELS ? t.status : 'todo'}
                      onChange={e => changeLinkedTaskStatus(t, e.target.value as WsTaskStatus)}
                      className={`text-[10px] border rounded-md px-1.5 py-0.5 focus:outline-none font-medium ${WS_TASK_STATUS_COLORS[(t.status as WsTaskStatus)] ?? WS_TASK_STATUS_COLORS.todo}`}
                    >
                      {(['todo', 'in_progress', 'done'] as WsTaskStatus[]).map(s => (
                        <option key={s} value={s}>{WS_TASK_STATUS_LABELS[s]}</option>
                      ))}
                    </select>
                    {t.deadline && <span className="text-[10px] text-[#999] whitespace-nowrap">Hạn: {formatDate(t.deadline)}</span>}
                    {cmts.length > 0 && <span className="text-[10px] text-[#999]">{cmts.length} bình luận</span>}
                    <button onClick={() => unlinkTask(t)} title="Bỏ liên kết khỏi chi nhánh" className="p-1 rounded hover:bg-red-50 text-[#ccc] hover:text-red-500 transition">
                      <Unlink size={11} />
                    </button>
                  </div>
                  {isExpanded && (
                    <div className="mt-2 border border-[#E8E7E2] rounded-lg bg-[#fafafa] overflow-hidden">
                      {cmts.length > 0 && (
                        <div className="flex flex-col divide-y divide-[#F0EEE9] max-h-36 overflow-y-auto">
                          {cmts.map(cm => (
                            <div key={cm.id} className="px-2.5 py-1.5 group bg-white">
                              <div className="flex items-center gap-1.5 mb-0.5">
                                <span className="text-[10.5px] font-semibold text-[#1D4ED8]">{cm.user_name}</span>
                                <span className="text-[10px] text-[#bbb]">{new Date(cm.created_at).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                                <div className="ml-auto flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <button onClick={() => { setEditingLinkedCommentId(cm.id); setEditingLinkedCommentText(cm.content) }} className="p-0.5 rounded hover:bg-blue-50 text-[#ccc] hover:text-blue-500"><Pencil size={10} /></button>
                                  <button onClick={() => { if (confirm('Xoá bình luận này?')) deleteLinkedComment(cm.id, t.id) }} className="p-0.5 rounded hover:bg-red-50 text-[#ccc] hover:text-red-500"><Trash2 size={10} /></button>
                                </div>
                              </div>
                              {editingLinkedCommentId === cm.id ? (
                                <div className="flex gap-1 mt-1">
                                  <input autoFocus value={editingLinkedCommentText} onChange={e => setEditingLinkedCommentText(e.target.value)}
                                    onKeyDown={e => { if (e.key === 'Enter') saveLinkedCommentEdit(cm.id, t.id); if (e.key === 'Escape') setEditingLinkedCommentId(null) }}
                                    className="flex-1 text-[11px] px-2 py-0.5 border border-blue-300 rounded focus:outline-none" />
                                  <button onClick={() => saveLinkedCommentEdit(cm.id, t.id)} className="text-[10px] px-1.5 py-0.5 bg-blue-600 text-white rounded"><Check size={10} /></button>
                                  <button onClick={() => setEditingLinkedCommentId(null)} className="text-[10px] px-1.5 py-0.5 border border-[#E8E7E2] rounded text-[#666]"><X size={10} /></button>
                                </div>
                              ) : (
                                <div className="text-[11.5px] text-[#333] whitespace-pre-wrap">{cm.content}</div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="flex gap-1.5 p-1.5 border-t border-[#F0EEE9] first:border-t-0">
                        <input
                          type="text" value={linkedCommentInput[t.id] ?? ''}
                          onChange={e => setLinkedCommentInput(prev => ({ ...prev, [t.id]: e.target.value }))}
                          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendLinkedComment(t.id) } }}
                          placeholder="Bình luận tiến độ..."
                          className="flex-1 text-[11px] px-2 py-1 rounded-md border border-[#E8E7E2] focus:outline-none focus:border-blue-400 bg-white placeholder:text-[#ccc]"
                        />
                        <button
                          onClick={() => sendLinkedComment(t.id)}
                          disabled={sendingLinkedComment === t.id || !(linkedCommentInput[t.id] ?? '').trim()}
                          className="text-[11px] px-2.5 py-1 rounded-md bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-40 shrink-0"
                        >Gửi</button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── 5. Dòng thời gian các phiên — thay cho lưới lịch cũ ── */}
      <div>
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <History size={12} className="text-[#888]" />
          <span className="text-[10px] font-semibold text-[#555] uppercase tracking-wide">Dòng thời gian</span>
          <div className="flex items-center gap-1">
            {(['all', 'Tình trạng', 'Khó khăn', 'Cơ hội'] as const).map(k => (
              <button
                key={k}
                type="button"
                onClick={() => setFilterKind(k)}
                className={`text-[10px] px-2 py-0.5 rounded-full border transition ${
                  filterKind === k
                    ? k === 'all' ? 'bg-[#333] text-white border-[#333]' : KIND_META[k].chipActive
                    : 'bg-white text-[#888] border-[#E8E7E2] hover:border-[#bbb]'
                }`}
              >
                {k === 'all' ? 'Tất cả' : k}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1 ml-auto">
            <Search size={11} className="text-[#bbb]" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Tìm trong nội dung..."
              className="text-[11px] px-2 py-1 border border-[#E5E3DD] rounded-md bg-white w-[170px] focus:outline-none focus:border-blue-400 placeholder:text-[#ccc]"
            />
            <span className="text-[9.5px] text-[#bbb] whitespace-nowrap">{filteredHistory.length}/{history.length} phiên</span>
          </div>
        </div>

        {filteredHistory.length === 0 ? (
          <div className="text-[11px] text-[#bbb] py-5 text-center border border-dashed border-[#E8E7E2] rounded-lg bg-white">
            {history.length === 0
              ? 'Chưa có lịch sử trao đổi — bấm "Ghi nhận phiên mới" ở trên để bắt đầu'
              : 'Không có phiên nào khớp bộ lọc'}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {groupedHistory.map(g => (
              <div key={g.month} className="flex flex-col gap-1.5">
                <div className="text-[9.5px] font-semibold text-[#aaa] uppercase tracking-wide px-0.5">
                  Tháng {Number(g.month.slice(5))}/{g.month.slice(0, 4)} · {g.items.length} phiên
                </div>
                {g.items.map(e => renderEntry(e.h))}
              </div>
            ))}
            {filteredHistory.length > visibleHistory.length && (
              <button
                type="button"
                onClick={() => setShowAllEntries(true)}
                className="text-[11px] text-blue-600 hover:underline py-1.5"
              >
                Xem thêm {filteredHistory.length - visibleHistory.length} phiên cũ hơn
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
