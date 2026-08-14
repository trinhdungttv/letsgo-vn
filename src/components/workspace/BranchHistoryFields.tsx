import { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import { History, ChevronDown, ChevronUp, Activity, AlertTriangle, TrendingUp, Pencil, Trash2, Check, X, Plus, Send, Link2, Unlink } from 'lucide-react'
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

const WEEKDAY_LABELS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']

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

export function BranchHistoryFields({ branch, onChange, refreshKey, recordDate, onRecordDateChange }: Props) {
  const [history, setHistory] = useState<MorningPriority[]>([])
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<{ status_note: string; difficulties: string; opportunities: string }>({ status_note: '', difficulties: '', opportunities: '' })
  const [editSaving, setEditSaving] = useState(false)
  const [showInputForm, setShowInputForm] = useState(true)
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

  const monthGrid = useMemo(buildMonthGrid, [])
  const sessionDates = useMemo(() => new Set(history.map(h => h.priority_date)), [history])
  const today = todayStr()
  const selectedEntries = selectedDate ? history.filter(h => h.priority_date === selectedDate) : []

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
    const outcome = h.outcome_status ? OUTCOME_LABELS[h.outcome_status] : null
    const isExpanded = forceOpen || expandedId === h.id
    const isEditing = editingId === h.id
    return (
      <div key={h.id} className="border border-[#E8E7E2] bg-white rounded-lg overflow-hidden group/entry">
        <div
          onClick={() => !forceOpen && !isEditing && setExpandedId(prev => prev === h.id ? null : h.id)}
          className={`flex items-center justify-between gap-2 px-3 py-2 ${forceOpen || isEditing ? 'bg-[#fafafa]' : 'cursor-pointer hover:bg-[#fafafa] transition-colors'}`}
        >
          <div className="flex items-center gap-2 min-w-0">
            <div className={`w-2 h-2 rounded-full shrink-0 ${sessionDates.has(h.priority_date) ? 'bg-blue-500' : 'bg-gray-300'}`} />
            <span className="text-[11.5px] font-semibold text-[#111]">{formatDate(h.priority_date)}</span>
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
      {/* 0. Việc nội bộ liên kết — Task nội bộ (chung) gắn với chi nhánh này. Khối riêng, tách
          bạch khỏi nhật ký Tình trạng/Khó khăn/Cơ hội tự do bên dưới. Chỉ hiện khi có liên kết. */}
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

      {/* 1. Mini calendar (top) */}
      <div className="border border-[#E8E7E2] rounded-lg p-2.5 bg-[#fafafa]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-semibold text-[#555] uppercase tracking-wide">
              T{new Date().getMonth() + 1}/{new Date().getFullYear()}
            </span>
            <span className="text-[9px] text-[#bbb]">{history.length} phiên</span>
          </div>
          <div className="grid grid-cols-7 gap-0.5 mb-1">
            {WEEKDAY_LABELS.map(d => (
              <div key={d} className="text-[8px] text-center text-[#bbb] font-medium">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-0.5">
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
                    'aspect-square flex items-center justify-center rounded text-[10px] transition-colors',
                    isSelected ? 'bg-blue-600 text-white font-semibold' : hasSession ? 'bg-blue-100 text-blue-700 font-medium hover:bg-blue-200 cursor-pointer' : 'text-[#ccc] cursor-default',
                    isToday && !isSelected ? 'ring-1.5 ring-red-400' : '',
                  ].join(' ')}
                >
                  {day}
                </button>
              )
            })}
          </div>
          {/* Selected date entries */}
          {selectedDate && selectedEntries.length > 0 && (
            <div className="mt-2 pt-2 border-t border-[#E8E7E2] flex flex-col gap-1">
              <div className="text-[9px] font-semibold text-[#888] uppercase">{formatDate(selectedDate)}</div>
              {selectedEntries.map(h => renderEntry(h, true))}
            </div>
          )}
        </div>

      {/* 2. Session history (moved up so operators read past exchanges first) */}
      <div>
        <div className="flex items-center gap-1.5 mb-2">
          <History size={12} className="text-[#888]" />
          <span className="text-[10px] font-semibold text-[#555] uppercase tracking-wide">Các phiên ghi nhận</span>
          <span className="text-[9px] text-[#bbb] ml-auto">{history.length} phiên</span>
        </div>
        {history.length === 0 ? (
          <div className="text-[11px] text-[#bbb] py-4 text-center border border-dashed border-[#E8E7E2] rounded-lg bg-white">
            Chưa có lịch sử trao đổi — ghi nhận phiên đầu tiên ở bên dưới
          </div>
        ) : (
          <div className="flex flex-col gap-1.5 max-h-[320px] overflow-y-auto pr-0.5">
            {history.map(h => renderEntry(h))}
          </div>
        )}
      </div>

      {/* 3. New session form (bottom, vertical layout) */}
      <div className="border border-[#E8E7E2] rounded-lg bg-white overflow-hidden">
        <div
          className="flex items-center justify-between px-3 py-2 bg-[#FAFAF8] border-b border-[#E8E7E2] cursor-pointer"
          onClick={() => setShowInputForm(v => !v)}
        >
          <div className="flex items-center gap-2">
            <Plus size={12} className="text-[#7C3AED]" />
            <span className="text-[10.5px] font-semibold text-[#555] uppercase tracking-wide">Ghi nhận phiên mới</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-[#999]">{new Date().toLocaleDateString('vi-VN', { weekday: 'short', day: '2-digit', month: '2-digit' })}</span>
            {showInputForm ? <ChevronUp size={12} className="text-[#bbb]" /> : <ChevronDown size={12} className="text-[#bbb]" />}
          </div>
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
    </div>
  )
}
