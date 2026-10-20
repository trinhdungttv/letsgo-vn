import { useEffect, useMemo, useState, useCallback, type KeyboardEvent } from 'react'
import { History, AlertTriangle, TrendingUp, Pencil, Trash2, Check, X, Send, Link2, Unlink, Search, CalendarDays, MapPin, Phone, Flag, FileText, NotebookPen, ClipboardList, RotateCcw, ChevronDown } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import type { Branch, GoalType, MorningPriority, WorkspaceTaskComment, WsTaskStatus } from '../../lib/types'
import { WS_TASK_STATUS_LABELS, WS_TASK_STATUS_COLORS } from '../../lib/types'
import { formatDate } from '../../lib/format'
import { useAuth } from '../../lib/auth'
import type { WorkspaceTask } from './MyWorkFeed'
import { fetchWorkspaceTaskComments, addWorkspaceTaskComment, updateWorkspaceTaskComment, deleteWorkspaceTaskComment } from '../../lib/workspaceTaskComments'
import { LinkedWorkTasks } from './LinkedWorkTasks'

interface Props {
  branch: Branch
  refreshKey?: number
  /** Gọi sau khi lưu xong một lần ghé — trang cha cập nhật mốc "liên hệ gần nhất". */
  onSaved?: (date: string) => void
}

const OUTCOME_LABELS: Record<string, { label: string; cls: string }> = {
  done: { label: 'Hoàn thành', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  partial: { label: 'Một phần', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  missed: { label: 'Chưa đạt', cls: 'bg-red-50 text-red-700 border-red-200' },
}

type NoteFields = { status_note: string; difficulties: string; opportunities: string }
const EMPTY_NOTE: NoteFields = { status_note: '', difficulties: '', opportunities: '' }
/** Câu thay thế khi phiên không có nội dung — nhiều phiên cũ lưu nguyên câu này. */
const EMPTY_NOTE_TEXT = 'Cập nhật thông tin chi nhánh'

// Loại ghi nhận lưu ở morning_priorities.goal_type (cột TEXT, không ràng buộc giá trị).
// Class viết đủ chữ (không ghép chuỗi động) để Tailwind sinh đúng CSS.
interface TypeMeta { value: GoalType; label: string; icon: typeof MapPin; chip: string; pick: string; dot: string; placeholder: string }
const VISIT_TYPES: TypeMeta[] = [
  { value: 'tham_quan', label: 'Ghé thăm', icon: MapPin, chip: 'bg-violet-50 text-violet-700 border-violet-200', pick: 'bg-violet-600 text-white border-violet-600', dot: 'bg-violet-500', placeholder: 'Ghé chi nhánh — gặp ai, trao đổi gì, tình hình nhân sự / khách hàng…' },
  { value: 'hoi_tham', label: 'Gọi / nhắn', icon: Phone, chip: 'bg-sky-50 text-sky-700 border-sky-200', pick: 'bg-sky-600 text-white border-sky-600', dot: 'bg-sky-500', placeholder: 'Gọi điện / nhắn tin với chi nhánh — nội dung trao đổi…' },
  { value: 'su_kien', label: 'Sự kiện', icon: Flag, chip: 'bg-rose-50 text-rose-700 border-rose-200', pick: 'bg-rose-600 text-white border-rose-600', dot: 'bg-rose-500', placeholder: 'Sự kiện liên quan — khai trương, tuyển dụng, khách mới, sự cố…' },
  { value: 'other', label: 'Khác', icon: FileText, chip: 'bg-gray-50 text-gray-600 border-gray-200', pick: 'bg-gray-700 text-white border-gray-700', dot: 'bg-gray-400', placeholder: 'Ghi chú…' },
]
/** Phiên ghi trước đây đều là 'cap_nhat' (Cập nhật thông tin). */
const LEGACY_TYPE: TypeMeta = { value: 'cap_nhat', label: 'Cập nhật', icon: FileText, chip: 'bg-[#F4F4F1] text-[#777] border-[#E5E3DD]', pick: 'bg-[#555] text-white border-[#555]', dot: 'bg-[#C9C7C0]', placeholder: '' }
const typeMeta = (t: GoalType | null) => VISIT_TYPES.find(v => v.value === t) ?? LEGACY_TYPE

// Nội dung 1 phiên vẫn lưu chung cột goal_note theo nhãn "Tình trạng: / Khó khăn: / Cơ hội:" như
// trước để phiên cũ đọc y nguyên. Trên giao diện, "Ghi chú" chính là nhãn "Tình trạng".
const LABEL_RE = /(Tình trạng|Khó khăn|Cơ hội): /g

function noteFields(goal_note: string | null): NoteFields {
  if (!goal_note || goal_note.trim() === EMPTY_NOTE_TEXT) return { ...EMPTY_NOTE }
  const matches = [...goal_note.matchAll(LABEL_RE)]
  if (!matches.length) return { ...EMPTY_NOTE, status_note: goal_note.trim() }
  const out = { ...EMPTY_NOTE }
  const add = (k: keyof NoteFields, t: string) => { if (t) out[k] = out[k] ? `${out[k]}\n${t}` : t }
  // Chữ đứng trước nhãn đầu tiên (nếu có) coi như ghi chú.
  add('status_note', goal_note.slice(0, matches[0].index).trim())
  matches.forEach((m, i) => {
    const end = i + 1 < matches.length ? matches[i + 1].index! : goal_note.length
    const text = goal_note.slice(m.index! + m[0].length, end).trim()
    add(m[1] === 'Khó khăn' ? 'difficulties' : m[1] === 'Cơ hội' ? 'opportunities' : 'status_note', text)
  })
  return out
}

function buildGoalNote(f: NoteFields): string {
  const parts: string[] = []
  if (f.status_note.trim()) parts.push(`Tình trạng: ${f.status_note.trim()}`)
  if (f.difficulties.trim()) parts.push(`Khó khăn: ${f.difficulties.trim()}`)
  if (f.opportunities.trim()) parts.push(`Cơ hội: ${f.opportunities.trim()}`)
  return parts.join('\n') || EMPTY_NOTE_TEXT
}

function mergeText(old: string, add: string): string {
  const o = old.trim(), a = add.trim()
  if (!a || o.includes(a)) return o
  return o ? `${o}\n${a}` : a
}

/** Ngày hôm nay theo giờ máy (không theo UTC — 0h–7h sáng ở VN vẫn là hôm nay). */
function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Ghi 1 lần ghé / sự kiện vào morning_priorities (target_name = 'Chi nhánh {tên chuẩn}').
 * Bảng có UNIQUE(user_id, priority_date, target_name): mỗi người 1 phiên/chi nhánh/ngày. Ghi thêm
 * trong cùng ngày thì GỘP nội dung vào phiên đó — không ghi đè mất nội dung đã lưu như trước.
 */
async function recordBranchVisit(userId: string, branchName: string, fields: NoteFields, priority_date: string, goal_type: GoalType): Promise<'inserted' | 'merged'> {
  const target_name = `Chi nhánh ${branchName}`
  const { data: existing, error: selectError } = await supabase
    .from('morning_priorities')
    .select('id, goal_note, goal_type')
    .eq('user_id', userId)
    .eq('target_name', target_name)
    .eq('priority_date', priority_date)
    .maybeSingle()
  if (selectError) throw selectError

  if (existing) {
    const old = noteFields(existing.goal_note)
    const keepType = existing.goal_type && existing.goal_type !== 'cap_nhat'
    // Gộp khác loại (vd. thêm "Sự kiện" vào phiên "Ghé thăm") thì ghi rõ loại ở đầu dòng thêm vào.
    const tag = keepType && existing.goal_type !== goal_type && fields.status_note.trim() ? `[${typeMeta(goal_type).label}] ` : ''
    const merged: NoteFields = {
      status_note: mergeText(old.status_note, tag + fields.status_note.trim()),
      difficulties: mergeText(old.difficulties, fields.difficulties),
      opportunities: mergeText(old.opportunities, fields.opportunities),
    }
    const { error } = await supabase.from('morning_priorities').update({
      goal_note: buildGoalNote(merged),
      goal_type: keepType ? existing.goal_type : goal_type,
      updated_at: new Date().toISOString(),
    }).eq('id', existing.id)
    if (error) throw error
    return 'merged'
  }

  const { error } = await supabase.from('morning_priorities').insert({
    user_id: userId,
    priority_date,
    target_name,
    target_kcn: null,
    goal_type,
    goal_note: buildGoalNote(fields),
    outcome_note: null,
    outcome_status: null,
  })
  if (error) throw error
  return 'inserted'
}

function daysSince(dateStr: string): number {
  const from = new Date(`${dateStr}T00:00:00`).getTime()
  const now = new Date(`${todayStr()}T00:00:00`).getTime()
  return Math.round((now - from) / 86400000)
}

function agoLabel(dateStr: string): string {
  const d = daysSince(dateStr)
  if (d < 0) return `${-d} ngày tới`
  if (d === 0) return 'hôm nay'
  if (d === 1) return 'hôm qua'
  if (d < 30) return `${d} ngày trước`
  return `${Math.floor(d / 30)} tháng trước`
}

const WEEKDAYS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']
const weekday = (dateStr: string) => WEEKDAYS[new Date(`${dateStr}T00:00:00`).getDay()]
const isLong = (t: string) => t.length > 280 || t.split('\n').length > 4

type DraftData = { fields: NoteFields; type: GoalType }
function readDraft(key: string | null): DraftData {
  const fallback: DraftData = { fields: { ...EMPTY_NOTE }, type: 'tham_quan' }
  if (!key) return fallback
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    const d = JSON.parse(raw)
    return {
      fields: { status_note: d.status_note || '', difficulties: d.difficulties || '', opportunities: d.opportunities || '' },
      type: VISIT_TYPES.some(v => v.value === d.type) ? d.type : 'tham_quan',
    }
  } catch { return fallback }
}

type Filter = 'all' | 'issue' | 'chance' | GoalType

const textareaCls = 'w-full text-[13px] leading-relaxed border border-[#E5E3DD] rounded-lg px-3 py-2 bg-white text-[#222] placeholder:text-[#bbb] focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition resize-y'

/**
 * Hồ sơ chi nhánh — Nhật ký ghé thăm (ô ghi nhận luôn mở ở đầu + dòng thời gian) và Công việc.
 * Dùng chung cho panel ở Workspace và trang Chi nhánh. Ô ghi nhận tự quản nội dung (bản nháp tự lưu
 * vào máy), có nút Lưu riêng — trang cha không phải lưu hộ.
 * Trang cha nên đặt key={branch.id} để đổi chi nhánh là làm mới toàn bộ trạng thái.
 */
export function BranchHistoryFields({ branch, refreshKey, onSaved }: Props) {
  const { user } = useAuth()
  const [tab, setTab] = useState<'log' | 'work'>('log')

  // ---- Lịch sử phiên ----
  const [history, setHistory] = useState<MorningPriority[]>([])
  const [loaded, setLoaded] = useState(false)
  const [names, setNames] = useState<Record<string, string>>({})
  // Phiên ghi trước đây dùng tên cũ (branch.region) nên đọc kèm khoá đó; ghi mới chỉ dùng tên chuẩn.
  const targetsKey = [branch.name, branch.region].filter(Boolean).map(n => `Chi nhánh ${n}`).join('|')

  const loadHistory = useCallback(async () => {
    const targets = targetsKey ? targetsKey.split('|') : []
    if (!targets.length) { setHistory([]); setLoaded(true); return }
    const { data } = await supabase
      .from('morning_priorities')
      .select('*')
      .in('target_name', targets)
      .order('priority_date', { ascending: false })
      .limit(200)
    setHistory((data || []) as MorningPriority[])
    setLoaded(true)
  }, [targetsKey])

  useEffect(() => { loadHistory() }, [loadHistory, refreshKey])

  // Tên người ghi — tra riêng bảng app_users (nhỏ); lỗi thì chỉ mất tên, không mất phiên.
  const userIdsKey = [...new Set(history.map(h => h.user_id))].sort().join(',')
  useEffect(() => {
    const ids = userIdsKey ? userIdsKey.split(',') : []
    if (!ids.length) return
    let cancelled = false
    supabase.from('app_users').select('id, full_name').in('id', ids).then(({ data }) => {
      if (cancelled || !data) return
      setNames(Object.fromEntries((data as { id: string; full_name: string }[]).map(u => [u.id, u.full_name])))
    })
    return () => { cancelled = true }
  }, [userIdsKey])

  const entries = useMemo(() => history.map(h => {
    const f = noteFields(h.goal_note)
    return {
      h,
      f,
      type: typeMeta(h.goal_type),
      empty: !f.status_note && !f.difficulties && !f.opportunities && !h.outcome_note,
      haystack: `${h.goal_note ?? ''} ${h.outcome_note ?? ''}`.toLowerCase(),
    }
  }), [history])
  type Entry = typeof entries[number]

  // ---- Ô ghi nhận lần ghé mới ----
  const draftKey = branch.name ? `lgvn_branch_draft_${branch.name}` : null
  const [initialDraft] = useState(() => readDraft(draftKey))
  const [note, setNote] = useState<NoteFields>(initialDraft.fields)
  const [visitType, setVisitType] = useState<GoalType>(initialDraft.type)
  const [recordDate, setRecordDate] = useState(todayStr())
  const [showIssue, setShowIssue] = useState(!!initialDraft.fields.difficulties)
  const [showChance, setShowChance] = useState(!!initialDraft.fields.opportunities)
  const [saving, setSaving] = useState(false)
  const [flash, setFlash] = useState('')
  const hasContent = !!(note.status_note.trim() || note.difficulties.trim() || note.opportunities.trim())

  useEffect(() => {
    if (!draftKey) return
    try {
      if (hasContent) localStorage.setItem(draftKey, JSON.stringify({ ...note, type: visitType }))
      else localStorage.removeItem(draftKey)
    } catch { /* bộ nhớ trình duyệt bị chặn — bỏ qua bản nháp */ }
  }, [draftKey, note, visitType, hasContent])

  const sameDayEntry = useMemo(
    () => history.find(h => h.user_id === user?.id && h.priority_date === recordDate && h.target_name === `Chi nhánh ${branch.name}`),
    [history, user?.id, recordDate, branch.name],
  )
  const lastIssue = entries.find(e => e.f.difficulties)?.f.difficulties ?? ''
  const lastChance = entries.find(e => e.f.opportunities)?.f.opportunities ?? ''
  const pickedType = typeMeta(visitType)

  async function handleSave() {
    if (!user || !branch.name || !hasContent || saving) return
    setSaving(true)
    try {
      const res = await recordBranchVisit(user.id, branch.name, note, recordDate, visitType)
      await loadHistory()
      setNote({ ...EMPTY_NOTE })
      setShowIssue(false)
      setShowChance(false)
      onSaved?.(recordDate)
      setFlash(res === 'merged' ? `Đã gộp vào ghi nhận ngày ${formatDate(recordDate)}` : `Đã lưu ghi nhận ngày ${formatDate(recordDate)}`)
      setTimeout(() => setFlash(''), 3500)
      setRecordDate(todayStr())
    } catch (e) {
      alert('Lỗi khi lưu: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setSaving(false)
    }
  }

  const onComposerKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); handleSave() }
  }

  // ---- Dòng thời gian: lọc / tìm / mở rộng ----
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [showSearch, setShowSearch] = useState(false)
  const [showAllEntries, setShowAllEntries] = useState(false)
  const [openIds, setOpenIds] = useState<Set<string>>(new Set())
  const toggleOpen = (id: string) => setOpenIds(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return entries.filter(e => {
      if (filter === 'issue' && !e.f.difficulties) return false
      if (filter === 'chance' && !e.f.opportunities) return false
      if (filter !== 'all' && filter !== 'issue' && filter !== 'chance' && e.type.value !== filter) return false
      if (q && !e.haystack.includes(q)) return false
      return true
    })
  }, [entries, filter, search])
  const visible = showAllEntries ? filtered : filtered.slice(0, 12)

  const grouped = useMemo(() => {
    const groups: { month: string; items: Entry[] }[] = []
    for (const e of visible) {
      const month = e.h.priority_date.slice(0, 7)
      const last = groups[groups.length - 1]
      if (last && last.month === month) last.items.push(e)
      else groups.push({ month, items: [e] })
    }
    return groups
  }, [visible])

  const filterOptions = useMemo(() => {
    const opts: { value: Filter; label: string; count: number }[] = [{ value: 'all', label: 'Tất cả', count: entries.length }]
    for (const t of [...VISIT_TYPES, LEGACY_TYPE]) {
      const n = entries.filter(e => e.type.value === t.value).length
      if (n) opts.push({ value: t.value, label: t.label, count: n })
    }
    const issues = entries.filter(e => e.f.difficulties).length
    const chances = entries.filter(e => e.f.opportunities).length
    if (issues) opts.push({ value: 'issue', label: 'Khó khăn', count: issues })
    if (chances) opts.push({ value: 'chance', label: 'Cơ hội', count: chances })
    return opts
  }, [entries])

  // ---- Tóm tắt ----
  const stats = useMemo(() => {
    const past = entries.filter(e => daysSince(e.h.priority_date) >= 0)
    const last = past[0]?.h.priority_date ?? null
    const latestIssue = entries.find(e => e.f.difficulties)
    return {
      last,
      since: last ? daysSince(last) : null,
      in30: past.filter(e => daysSince(e.h.priority_date) <= 30).length,
      issues: entries.filter(e => e.f.difficulties).length,
      latestIssue,
    }
  }, [entries])

  // ---- Sửa / xoá phiên ----
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<NoteFields & { type: GoalType }>({ ...EMPTY_NOTE, type: 'tham_quan' })
  const [editSaving, setEditSaving] = useState(false)

  function startEdit(e: Entry) {
    setEditForm({ ...e.f, type: e.h.goal_type ?? 'cap_nhat' })
    setEditingId(e.h.id)
  }

  async function saveEdit(id: string) {
    setEditSaving(true)
    const goal_note = buildGoalNote(editForm)
    const { error } = await supabase.from('morning_priorities').update({ goal_note, goal_type: editForm.type, updated_at: new Date().toISOString() }).eq('id', id)
    if (error) alert('Lỗi khi lưu: ' + error.message)
    else {
      setHistory(prev => prev.map(h => h.id === id ? { ...h, goal_note, goal_type: editForm.type } : h))
      setEditingId(null)
    }
    setEditSaving(false)
  }

  async function deleteEntry(h: MorningPriority) {
    if (!confirm(`Xoá ghi nhận ngày ${formatDate(h.priority_date)}?`)) return
    const { error } = await supabase.from('morning_priorities').delete().eq('id', h.id)
    if (error) alert('Lỗi khi xoá: ' + error.message)
    else setHistory(prev => prev.filter(x => x.id !== h.id))
  }

  // ---- Công việc: việc của tôi (work_tasks) + việc nội bộ liên kết (workspace_tasks) ----
  const [workCounts, setWorkCounts] = useState({ total: 0, open: 0 })
  // Task nội bộ (chung) gắn với chi nhánh này (workspace_tasks.branch_id). Cùng đọc/ghi thẳng
  // workspace_tasks + workspace_task_comments với Workspace > MyWorkFeed — không nhân bản dữ liệu.
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

  const openLinked = linkedTasks.filter(t => t.status !== 'done').length
  const workTotal = workCounts.total + linkedTasks.length
  const workOpen = workCounts.open + openLinked

  // ---- Render ----
  function typeChips(value: GoalType, onPick: (t: GoalType) => void) {
    return VISIT_TYPES.map(t => {
      const Icon = t.icon
      const active = value === t.value
      return (
        <button
          key={t.value}
          type="button"
          onClick={() => onPick(t.value)}
          className={`inline-flex items-center gap-1.5 text-[12px] px-2.5 py-1 rounded-full border transition ${active ? t.pick : 'bg-white text-[#666] border-[#E5E3DD] hover:border-[#bbb]'}`}
        >
          <Icon size={12} /> {t.label}
        </button>
      )
    })
  }

  function renderEntry(e: Entry) {
    const { h, f, type } = e
    const Icon = type.icon
    const outcome = h.outcome_status ? OUTCOME_LABELS[h.outcome_status] : null
    const isEditing = editingId === h.id
    const open = openIds.has(h.id)
    const long = isLong(f.status_note)
    const author = names[h.user_id]
    return (
      <li key={h.id} className="relative pl-7">
        <span className={`absolute left-[5px] top-[13px] w-[13px] h-[13px] rounded-full border-[3px] border-white shadow-[0_0_0_1px_#E0DED8] ${type.dot}`} />
        <div className={`group/entry rounded-lg border bg-white px-3 ${e.empty && !isEditing ? 'py-2 border-[#EFEEEA]' : 'py-2.5 border-[#E8E7E2]'}`}>
          <div className="flex items-center gap-x-2 gap-y-1 flex-wrap">
            <span className="text-[12.5px] font-semibold text-[#111]">{formatDate(h.priority_date)}</span>
            <span className="text-[11px] text-[#999]">{weekday(h.priority_date)} · {agoLabel(h.priority_date)}</span>
            <span className={`inline-flex items-center gap-1 text-[10.5px] px-1.5 py-px rounded-full border ${type.chip}`}>
              <Icon size={10} /> {type.label}
            </span>
            {outcome && <span className={`text-[10.5px] px-1.5 py-px rounded-full border ${outcome.cls}`}>{outcome.label}</span>}
            {e.empty && !isEditing && <span className="text-[11px] text-[#bbb] italic">không có ghi chú</span>}
            {!isEditing && (
              <div className="ml-auto flex items-center gap-0.5 md:opacity-0 md:group-hover/entry:opacity-100 transition-opacity">
                <button onClick={() => startEdit(e)} title="Sửa" className="p-1 rounded hover:bg-blue-50 text-[#bbb] hover:text-blue-600 transition"><Pencil size={12} /></button>
                <button onClick={() => deleteEntry(h)} title="Xoá" className="p-1 rounded hover:bg-red-50 text-[#bbb] hover:text-red-500 transition"><Trash2 size={12} /></button>
              </div>
            )}
          </div>

          {isEditing ? (
            <div className="mt-2.5 flex flex-col gap-2">
              <div className="flex flex-wrap gap-1.5">{typeChips(editForm.type, t => setEditForm(f2 => ({ ...f2, type: t })))}</div>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold text-[#888]">Ghi chú</span>
                <textarea value={editForm.status_note} onChange={ev => setEditForm(f2 => ({ ...f2, status_note: ev.target.value }))} rows={3} className={textareaCls} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="flex items-center gap-1 text-[11px] font-semibold text-amber-700"><AlertTriangle size={11} /> Khó khăn</span>
                <textarea value={editForm.difficulties} onChange={ev => setEditForm(f2 => ({ ...f2, difficulties: ev.target.value }))} rows={2} placeholder="Để trống nếu không có" className={`${textareaCls} border-amber-200`} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-700"><TrendingUp size={11} /> Cơ hội</span>
                <textarea value={editForm.opportunities} onChange={ev => setEditForm(f2 => ({ ...f2, opportunities: ev.target.value }))} rows={2} placeholder="Để trống nếu không có" className={`${textareaCls} border-emerald-200`} />
              </label>
              <div className="flex justify-end gap-1.5">
                <button onClick={() => setEditingId(null)} className="flex items-center gap-1 text-[12px] px-3 py-1.5 rounded-md border border-[#E8E7E2] text-[#666] hover:bg-[#f4f4f1] transition">
                  <X size={12} /> Huỷ
                </button>
                <button onClick={() => saveEdit(h.id)} disabled={editSaving} className="flex items-center gap-1 text-[12px] px-3 py-1.5 rounded-md bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-40 transition">
                  <Check size={12} /> {editSaving ? 'Đang lưu…' : 'Lưu'}
                </button>
              </div>
            </div>
          ) : !e.empty && (
            <div className="mt-1.5 flex flex-col gap-1.5">
              {f.status_note && (
                <div>
                  <p className={`text-[13px] leading-relaxed text-[#333] whitespace-pre-line break-words ${long && !open ? 'line-clamp-4' : ''}`}>{f.status_note}</p>
                  {long && (
                    <button onClick={() => toggleOpen(h.id)} className="text-[11.5px] text-blue-600 hover:underline mt-0.5">{open ? 'Thu gọn' : 'Xem đầy đủ'}</button>
                  )}
                </div>
              )}
              {f.difficulties && (
                <div className="flex items-start gap-2 rounded-md bg-amber-50/70 border-l-[3px] border-amber-400 px-2.5 py-1.5">
                  <AlertTriangle size={13} className="text-amber-500 shrink-0 mt-[3px]" />
                  <div className="min-w-0">
                    <div className="text-[10.5px] font-semibold text-amber-700 uppercase tracking-wide">Khó khăn</div>
                    <div className="text-[12.5px] leading-relaxed text-[#4A3208] whitespace-pre-line break-words">{f.difficulties}</div>
                  </div>
                </div>
              )}
              {f.opportunities && (
                <div className="flex items-start gap-2 rounded-md bg-emerald-50/70 border-l-[3px] border-emerald-400 px-2.5 py-1.5">
                  <TrendingUp size={13} className="text-emerald-600 shrink-0 mt-[3px]" />
                  <div className="min-w-0">
                    <div className="text-[10.5px] font-semibold text-emerald-700 uppercase tracking-wide">Cơ hội</div>
                    <div className="text-[12.5px] leading-relaxed text-[#14432F] whitespace-pre-line break-words">{f.opportunities}</div>
                  </div>
                </div>
              )}
              {h.outcome_note && (
                <div className="text-[12px] text-[#777] bg-[#FAFAF8] border border-[#F0EFEB] rounded-md px-2.5 py-1.5 whitespace-pre-line">{h.outcome_note}</div>
              )}
              {author && <div className="text-[10.5px] text-[#aaa]">Người ghi: {author}</div>}
            </div>
          )}
        </div>
      </li>
    )
  }

  const sinceTone = stats.since === null ? 'text-[#bbb]' : stats.since > 14 ? 'text-red-600' : stats.since > 7 ? 'text-amber-600' : 'text-emerald-600'

  return (
    <div className="flex flex-col gap-3">
      {/* ── Tóm tắt nhanh ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="rounded-lg border border-[#E8E7E2] bg-white px-3 py-2">
          <div className="text-[10.5px] text-[#999]">Liên hệ gần nhất</div>
          <div className="text-[15px] font-bold text-[#111] leading-tight mt-0.5">{stats.last ? formatDate(stats.last) : '—'}</div>
          <div className={`text-[11px] mt-0.5 ${sinceTone}`}>
            {stats.since === null ? (loaded ? 'Chưa có ghi nhận' : 'Đang tải…') : `${stats.since > 14 ? '⚠ ' : ''}${agoLabel(stats.last!)}`}
          </div>
        </div>
        <div className="rounded-lg border border-[#E8E7E2] bg-white px-3 py-2">
          <div className="text-[10.5px] text-[#999]">30 ngày qua</div>
          <div className="text-[15px] font-bold text-[#111] leading-tight mt-0.5">{stats.in30} lần</div>
          <div className="text-[11px] text-[#999] mt-0.5">tổng {history.length} lần ghi nhận</div>
        </div>
        <button
          type="button"
          onClick={() => { setTab('log'); setFilter(f => f === 'issue' ? 'all' : 'issue') }}
          disabled={!stats.issues}
          className={`text-left rounded-lg border px-3 py-2 transition ${filter === 'issue' ? 'border-amber-400 bg-amber-50' : 'border-[#E8E7E2] bg-white enabled:hover:border-amber-300'}`}
        >
          <div className="text-[10.5px] text-[#999]">Khó khăn</div>
          <div className="text-[15px] font-bold text-amber-600 leading-tight mt-0.5">{stats.issues}</div>
          <div className="text-[11px] text-[#999] mt-0.5 truncate">
            {stats.latestIssue ? `gần nhất ${formatDate(stats.latestIssue.h.priority_date)}` : 'chưa ghi nhận'}
          </div>
        </button>
        <button
          type="button"
          onClick={() => setTab('work')}
          className={`text-left rounded-lg border px-3 py-2 transition ${tab === 'work' ? 'border-blue-400 bg-blue-50' : 'border-[#E8E7E2] bg-white hover:border-blue-300'}`}
        >
          <div className="text-[10.5px] text-[#999]">Việc đang mở</div>
          <div className="text-[15px] font-bold text-blue-700 leading-tight mt-0.5">{workOpen}</div>
          <div className="text-[11px] text-[#999] mt-0.5">trên {workTotal} việc</div>
        </button>
      </div>

      {/* ── Tabs ── */}
      <div className="flex items-center gap-1 border-b border-[#E8E7E2]">
        {([
          { key: 'log', label: 'Nhật ký ghé thăm', icon: History, count: history.length },
          { key: 'work', label: 'Công việc', icon: ClipboardList, count: workTotal },
        ] as const).map(t => {
          const Icon = t.icon
          const active = tab === t.key
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`-mb-px flex items-center gap-1.5 px-3 py-2 text-[13px] border-b-2 transition ${active ? 'border-blue-600 text-[#111] font-semibold' : 'border-transparent text-[#888] hover:text-[#333]'}`}
            >
              <Icon size={14} className={active ? 'text-blue-600' : ''} />
              {t.label}
              <span className={`text-[11px] px-1.5 rounded-full ${active ? 'bg-blue-50 text-blue-700' : 'bg-[#F0EFEB] text-[#888]'}`}>{t.count}</span>
            </button>
          )
        })}
      </div>

      {/* ══════════ Tab: Nhật ký ghé thăm ══════════ */}
      <div className={tab === 'log' ? 'flex flex-col gap-4' : 'hidden'}>
        {/* ── Ô ghi nhận lần ghé mới — luôn mở ── */}
        <div className="rounded-xl border border-[#E0DED8] bg-white shadow-sm">
          <div className="flex items-center gap-2 flex-wrap px-3.5 pt-3">
            <NotebookPen size={15} className="text-blue-600" />
            <span className="text-[13.5px] font-semibold text-[#111]">Ghi nhận lần ghé mới</span>
            <label className="ml-auto flex items-center gap-1.5 text-[12px] text-[#888]">
              <CalendarDays size={13} className="text-[#aaa]" />
              <input
                type="date"
                value={recordDate}
                onChange={e => e.target.value && setRecordDate(e.target.value)}
                className="text-[12px] px-2 py-1 border border-[#E5E3DD] rounded-md bg-white text-[#333] focus:outline-none focus:border-blue-400"
              />
            </label>
          </div>
          <div className="flex flex-wrap gap-1.5 px-3.5 pt-2.5">
            {typeChips(visitType, setVisitType)}
          </div>
          <div className="px-3.5 pt-2.5 flex flex-col gap-2">
            <textarea
              value={note.status_note}
              onChange={e => setNote(n => ({ ...n, status_note: e.target.value }))}
              onKeyDown={onComposerKey}
              placeholder={pickedType.placeholder}
              rows={4}
              className={`${textareaCls} min-h-[96px]`}
            />
            {showIssue && (
              <div>
                <div className="flex items-center gap-1.5 mb-1">
                  <AlertTriangle size={12} className="text-amber-500" />
                  <span className="text-[11.5px] font-semibold text-amber-700">Khó khăn</span>
                  {lastIssue && !note.difficulties && (
                    <button type="button" onClick={() => setNote(n => ({ ...n, difficulties: lastIssue }))} className="ml-1 inline-flex items-center gap-0.5 text-[11px] text-amber-700/80 hover:underline">
                      <RotateCcw size={10} /> Lặp lại lần trước
                    </button>
                  )}
                  <button type="button" onClick={() => { setShowIssue(false); setNote(n => ({ ...n, difficulties: '' })) }} title="Bỏ mục này" className="ml-auto text-[#ccc] hover:text-[#888]"><X size={13} /></button>
                </div>
                <textarea
                  autoFocus={!note.difficulties}
                  value={note.difficulties}
                  onChange={e => setNote(n => ({ ...n, difficulties: e.target.value }))}
                  onKeyDown={onComposerKey}
                  placeholder="Chi nhánh đang vướng gì — thiếu người, khách ép giá, chậm thanh toán…"
                  rows={2}
                  className={`${textareaCls} border-amber-200 bg-amber-50/30`}
                />
              </div>
            )}
            {showChance && (
              <div>
                <div className="flex items-center gap-1.5 mb-1">
                  <TrendingUp size={12} className="text-emerald-600" />
                  <span className="text-[11.5px] font-semibold text-emerald-700">Cơ hội</span>
                  {lastChance && !note.opportunities && (
                    <button type="button" onClick={() => setNote(n => ({ ...n, opportunities: lastChance }))} className="ml-1 inline-flex items-center gap-0.5 text-[11px] text-emerald-700/80 hover:underline">
                      <RotateCcw size={10} /> Lặp lại lần trước
                    </button>
                  )}
                  <button type="button" onClick={() => { setShowChance(false); setNote(n => ({ ...n, opportunities: '' })) }} title="Bỏ mục này" className="ml-auto text-[#ccc] hover:text-[#888]"><X size={13} /></button>
                </div>
                <textarea
                  autoFocus={!note.opportunities}
                  value={note.opportunities}
                  onChange={e => setNote(n => ({ ...n, opportunities: e.target.value }))}
                  onKeyDown={onComposerKey}
                  placeholder="Khách mới, mở rộng đơn hàng, KCN mới…"
                  rows={2}
                  className={`${textareaCls} border-emerald-200 bg-emerald-50/30`}
                />
              </div>
            )}
          </div>
          {sameDayEntry && hasContent && (
            <div className="mx-3.5 mt-2 text-[11.5px] text-blue-800 bg-blue-50 border border-blue-100 rounded-md px-2.5 py-1.5">
              Ngày {formatDate(recordDate)} bạn đã có ghi nhận cho chi nhánh này — nội dung mới sẽ được <b>gộp thêm</b> vào ghi nhận đó.
            </div>
          )}
          <div className="flex items-center gap-2 flex-wrap px-3.5 py-2.5 mt-2.5 border-t border-[#F0EFEB] bg-[#FAFAF8] rounded-b-xl">
            {!showIssue && (
              <button type="button" onClick={() => setShowIssue(true)} className="inline-flex items-center gap-1 text-[12px] px-2.5 py-1 rounded-full border border-amber-200 text-amber-700 bg-white hover:bg-amber-50 transition">
                <AlertTriangle size={11} /> + Khó khăn
              </button>
            )}
            {!showChance && (
              <button type="button" onClick={() => setShowChance(true)} className="inline-flex items-center gap-1 text-[12px] px-2.5 py-1 rounded-full border border-emerald-200 text-emerald-700 bg-white hover:bg-emerald-50 transition">
                <TrendingUp size={11} /> + Cơ hội
              </button>
            )}
            {flash ? (
              <span className="text-[11.5px] text-emerald-700 inline-flex items-center gap-1"><Check size={12} /> {flash}</span>
            ) : hasContent && (
              <span className="text-[11px] text-[#aaa] inline-flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" /> Bản nháp tự lưu
              </span>
            )}
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !hasContent || !user}
              title="Ctrl/⌘ + Enter"
              className="ml-auto inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[12.5px] font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 transition shadow-sm"
            >
              <Send size={13} /> {saving ? 'Đang lưu…' : 'Lưu ghi nhận'}
            </button>
          </div>
        </div>

        {/* ── Dòng thời gian ── */}
        <div>
          <div className="flex items-center gap-1.5 flex-wrap mb-2.5">
            {filterOptions.map(o => (
              <button
                key={o.value}
                type="button"
                onClick={() => setFilter(o.value)}
                className={`text-[11.5px] px-2.5 py-0.5 rounded-full border transition ${filter === o.value ? 'bg-[#222] text-white border-[#222]' : 'bg-white text-[#777] border-[#E5E3DD] hover:border-[#bbb]'}`}
              >
                {o.label} <span className={filter === o.value ? 'text-white/60' : 'text-[#bbb]'}>{o.count}</span>
              </button>
            ))}
            <div className="ml-auto flex items-center gap-1">
              {showSearch && (
                <input
                  autoFocus
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Escape') { setSearch(''); setShowSearch(false) } }}
                  placeholder="Tìm trong ghi chú…"
                  className="text-[12px] px-2 py-1 border border-[#E5E3DD] rounded-md bg-white w-[160px] focus:outline-none focus:border-blue-400 placeholder:text-[#ccc]"
                />
              )}
              <button
                type="button"
                onClick={() => { if (showSearch) setSearch(''); setShowSearch(v => !v) }}
                title={showSearch ? 'Đóng tìm kiếm' : 'Tìm trong ghi chú'}
                className={`p-1.5 rounded-md transition ${showSearch ? 'bg-[#F0EFEB] text-[#333]' : 'text-[#999] hover:bg-[#F4F4F1] hover:text-[#333]'}`}
              >
                {showSearch ? <X size={13} /> : <Search size={13} />}
              </button>
            </div>
          </div>

          {!loaded ? (
            <div className="text-[12px] text-[#bbb] py-6 text-center">Đang tải…</div>
          ) : filtered.length === 0 ? (
            <div className="text-[12px] text-[#aaa] py-6 text-center border border-dashed border-[#E0DED8] rounded-lg bg-white">
              {history.length === 0 ? 'Chưa có lần ghé nào — ghi nhận lần đầu ở ô phía trên.' : 'Không có ghi nhận nào khớp bộ lọc.'}
            </div>
          ) : (
            <ol className="relative flex flex-col gap-2 before:absolute before:left-[11px] before:top-3 before:bottom-3 before:w-px before:bg-[#E0DED8]">
              {grouped.map(g => [
                <li key={`m-${g.month}`} className="relative pl-7 pt-1 first:pt-0">
                  <span className="text-[11px] font-semibold text-[#999] uppercase tracking-wide">
                    Tháng {Number(g.month.slice(5))}/{g.month.slice(0, 4)}
                  </span>
                  <span className="text-[11px] text-[#bbb]"> · {g.items.length} lần</span>
                </li>,
                ...g.items.map(renderEntry),
              ])}
            </ol>
          )}
          {filtered.length > visible.length && (
            <button type="button" onClick={() => setShowAllEntries(true)} className="mt-2 w-full inline-flex items-center justify-center gap-1 text-[12px] text-blue-600 hover:underline py-1.5">
              <ChevronDown size={13} /> Xem thêm {filtered.length - visible.length} ghi nhận cũ hơn
            </button>
          )}
        </div>
      </div>

      {/* ══════════ Tab: Công việc ══════════ */}
      <div className={tab === 'work' ? 'flex flex-col gap-3' : 'hidden'}>
        {/* Việc của tôi gắn với chi nhánh này — cùng bản ghi work_tasks với Workspace */}
        {branch.id && <LinkedWorkTasks branchId={branch.id} refreshKey={refreshKey} onCounts={(total, open) => setWorkCounts({ total, open })} />}

        {/* Việc nội bộ liên kết */}
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
      </div>
    </div>
  )
}
