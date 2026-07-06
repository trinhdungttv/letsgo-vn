// src/components/workspace/MyWorkFeed.tsx
// Feed việc hợp nhất — gộp work_tasks (việc cá nhân) + workspace_tasks (việc chung)
// thành MỘT danh sách nhóm theo thời gian: Quá hạn → Hôm nay → Tuần này → Sau đó.
// Data vẫn nằm ở 2 bảng riêng; chỉ gộp giao diện. Giữ đủ tính năng cũ:
// comment + doc status (Tái ký HĐ), báo cáo khi hoàn thành, sửa/xoá, yêu cầu ngưng HĐ.
import { useState, useEffect, useMemo, useRef } from 'react'
import {
  ChevronDown, Check, X, Trash2, Pencil,
  MessageSquare, History, Search, Plus,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import type { Client, WorkTask, TaskStatus, WorkTaskComment } from '../../lib/types'
import { TASK_STATUS_LABELS, TASK_STATUS_COLORS, TASK_PRIORITY_LABELS, TASK_PRIORITY_COLORS, DOC_STATUS_STEPS, TASK_TYPE_OPTIONS, type DocStatus, type TaskPriority } from '../../lib/types'
import { formatDate } from '../../lib/format'

// ---- Việc chung (bảng workspace_tasks) ----
export interface WorkspaceTask {
  id: string
  title: string
  type: 'doc' | 'task' | string
  status: string
  assignee: string | null
  deadline: string | null
  created_at: string
}

const WS_STATUS: Record<string, { label: string; cls: string }> = {
  drafting:         { label: 'Đang soạn',    cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  pending_approval: { label: 'Chờ duyệt',    cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  pending_sign:     { label: 'Chờ ký',       cls: 'bg-purple-50 text-purple-700 border-purple-200' },
  done:             { label: 'Hoàn thành',   cls: 'bg-green-50 text-green-700 border-green-200' },
  not_started:      { label: 'Chưa bắt đầu', cls: 'bg-slate-100 text-slate-600 border-slate-300' },
  overdue:          { label: 'Quá hạn',      cls: 'bg-red-50 text-red-700 border-red-200' },
}

const DOC_STATUS_BTN: Record<string, string> = {
  chua_soan: 'bg-gray-100 text-gray-600 border-gray-300',
  dang_soan: 'bg-blue-100 text-blue-700 border-blue-300',
  cho_duyet: 'bg-amber-100 text-amber-700 border-amber-300',
  cho_kh_ky: 'bg-violet-100 text-violet-700 border-violet-300',
  hoan_tat:  'bg-green-100 text-green-700 border-green-300',
  ngung_hd:  'bg-red-100 text-red-700 border-red-300',
}

// ---- Phân loại hiển thị (chip lọc) ----
type Category = 'Hợp đồng' | 'Báo giá' | 'Thăm quan / KH' | 'Hồ sơ' | 'Nội bộ' | 'Khác'
const CATEGORY_CHIPS: ('Tất cả' | Category)[] = ['Tất cả', 'Hợp đồng', 'Báo giá', 'Thăm quan / KH', 'Hồ sơ', 'Nội bộ', 'Khác']
const CATEGORY_TAG: Record<Category, string> = {
  'Hợp đồng': 'bg-blue-50 text-blue-700 border-blue-200',
  'Báo giá':  'bg-amber-50 text-amber-700 border-amber-200',
  'Thăm quan / KH': 'bg-teal-50 text-teal-700 border-teal-200',
  'Hồ sơ':    'bg-violet-50 text-violet-700 border-violet-200',
  'Nội bộ':   'bg-slate-100 text-slate-600 border-slate-200',
  'Khác':     'bg-gray-100 text-gray-600 border-gray-200',
}

// Quy tắc bản cũ (Workspace.tsx gốc getWorkTaskCategory): Thăm quan/Hỏi thăm CN → nhóm riêng, không rơi vào Khác
function workCategory(taskType: string | null): Category {
  if (taskType === 'Tái ký HĐ') return 'Hợp đồng'
  if (taskType === 'Báo giá') return 'Báo giá'
  if (taskType === 'Thăm quan' || taskType === 'Hỏi thăm CN') return 'Thăm quan / KH'
  if (taskType === 'Văn phòng') return 'Nội bộ'
  return 'Khác'
}

interface FeedItem {
  key: string
  source: 'work' | 'ws'
  id: string
  title: string
  due: string | null
  category: Category
  work?: WorkTask
  ws?: WorkspaceTask
}

type GroupKey = 'overdue' | 'today' | 'week' | 'later'
const GROUP_META: Record<GroupKey, { label: string; head: string; badge: string }> = {
  overdue: { label: 'Quá hạn',   head: 'text-red-600',   badge: 'bg-red-50 text-red-600' },
  today:   { label: 'Hôm nay',   head: 'text-[#0c2340]', badge: 'bg-blue-50 text-blue-700' },
  week:    { label: 'Tuần này',  head: 'text-[#8a887f]', badge: 'bg-[#EFEDE6] text-[#8a887f]' },
  later:   { label: 'Sau đó',    head: 'text-[#8a887f]', badge: 'bg-[#EFEDE6] text-[#8a887f]' },
}

function todayStr() { return new Date().toISOString().split('T')[0] }

function endOfWeekStr() {
  const d = new Date()
  const monOffset = (d.getDay() + 6) % 7 // 0 = thứ 2
  d.setDate(d.getDate() + (6 - monOffset))
  return d.toISOString().split('T')[0]
}

function dueLabel(due: string | null, group: GroupKey): string {
  if (!due) return 'Không hạn'
  if (group === 'overdue') {
    const days = Math.floor((Date.now() - new Date(due).getTime()) / 86400000)
    return `Trễ ${days} ngày`
  }
  if (group === 'today') return 'Hôm nay'
  const d = new Date(due)
  const wd = d.toLocaleDateString('vi-VN', { weekday: 'long' })
  return `${wd.charAt(0).toUpperCase()}${wd.slice(1)} · ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
}

// ---- Stats báo lên hero của Workspace ----
export interface FeedStats {
  overdue: number
  today: number
  doneThisWeek: number
  renewalClientIds: string[]
}

interface Props {
  clients: Client[]
  onClientUpdate: (client: Client) => void
  toast: (msg: string) => void
  onStatsChange?: (stats: FeedStats) => void
  /** tăng số này từ bên ngoài (GiaoViecModal, rail tạo việc tái ký) để feed tải lại */
  refreshToken?: number
  /** tăng số này để mở + focus ô thêm việc nhanh */
  quickAddSignal?: number
  /** ẩn khối lịch sử (điều khiển từ cài đặt Workspace) */
  hideHistory?: boolean
}

export function MyWorkFeed({ clients, onClientUpdate, toast, onStatsChange, refreshToken = 0, quickAddSignal = 0, hideHistory }: Props) {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  // ---- Data ----
  const [myTasks, setMyTasks] = useState<WorkTask[]>([])
  const [wsTasks, setWsTasks] = useState<WorkspaceTask[]>([])
  const [doneWork, setDoneWork] = useState<WorkTask[]>([])
  const [doneWs, setDoneWs] = useState<WorkspaceTask[]>([])
  const [comments, setComments] = useState<Record<string, WorkTaskComment[]>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) return
    let cancelled = false
    const since = new Date(Date.now() - 30 * 86400000).toISOString()
    ;(async () => {
      setLoading(true)
      const [my, ws, dw, dws] = await Promise.all([
        supabase.from('work_tasks').select('*').eq('user_id', user.id).neq('status', 'done').order('due_date', { ascending: true }),
        supabase.from('workspace_tasks').select('*').neq('status', 'done').order('deadline', { ascending: true }),
        supabase.from('work_tasks').select('*').eq('user_id', user.id).eq('status', 'done').gte('completed_at', since).order('completed_at', { ascending: false }),
        supabase.from('workspace_tasks').select('*').eq('status', 'done').gte('created_at', since).order('created_at', { ascending: false }),
      ])
      if (cancelled) return
      if (my.data) setMyTasks(my.data as WorkTask[])
      if (ws.data) setWsTasks(ws.data as WorkspaceTask[])
      if (dw.data) setDoneWork(dw.data as WorkTask[])
      if (dws.data) setDoneWs(dws.data as WorkspaceTask[])
      setLoading(false)
      const ids = ((my.data as WorkTask[]) || []).map(t => t.id)
      if (ids.length) {
        const { data: cData } = await supabase.from('work_task_comments').select('*').in('task_id', ids).order('created_at', { ascending: true })
        if (cancelled || !cData) return
        const map: Record<string, WorkTaskComment[]> = {}
        for (const c of cData as WorkTaskComment[]) (map[c.task_id] ||= []).push(c)
        setComments(map)
      }
    })()
    return () => { cancelled = true }
  }, [user, refreshToken])

  // ---- Ẩn việc gắn KH đã ngưng hợp tác ----
  const suspendedClientIds = useMemo(
    () => new Set(clients.filter(c => c.cooperation_status === 'suspended').map(c => c.id)),
    [clients]
  )
  const visibleWork = useMemo(
    () => myTasks.filter(t => !t.client_id || !suspendedClientIds.has(t.client_id)),
    [myTasks, suspendedClientIds]
  )

  // ---- Gộp + nhóm theo thời gian ----
  const [filter, setFilter] = useState<'Tất cả' | Category>('Tất cả')

  const groups = useMemo(() => {
    const items: FeedItem[] = [
      ...visibleWork.map((t): FeedItem => ({
        key: `work_${t.id}`, source: 'work', id: t.id, title: t.title,
        due: t.due_date || null, category: workCategory(t.task_type), work: t,
      })),
      ...wsTasks.map((t): FeedItem => ({
        key: `ws_${t.id}`, source: 'ws', id: t.id, title: t.title,
        due: t.deadline, category: t.type === 'doc' ? 'Hồ sơ' : 'Nội bộ', ws: t,
      })),
    ].filter(it => filter === 'Tất cả' || it.category === filter)

    const today = todayStr()
    const eow = endOfWeekStr()
    const g: Record<GroupKey, FeedItem[]> = { overdue: [], today: [], week: [], later: [] }
    for (const it of items) {
      if (!it.due) g.later.push(it)
      else if (it.due < today) g.overdue.push(it)
      else if (it.due === today) g.today.push(it)
      else if (it.due <= eow) g.week.push(it)
      else g.later.push(it)
    }
    const byDue = (a: FeedItem, b: FeedItem) => (a.due ?? '9999').localeCompare(b.due ?? '9999')
    for (const k of Object.keys(g) as GroupKey[]) g[k].sort(byDue)
    return g
  }, [visibleWork, wsTasks, filter])

  const totalVisible = groups.overdue.length + groups.today.length + groups.week.length + groups.later.length

  // ---- Stats lên hero ----
  useEffect(() => {
    if (!onStatsChange) return
    const today = todayStr()
    const monday = new Date()
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
    monday.setHours(0, 0, 0, 0)
    const overdue =
      visibleWork.filter(t => t.due_date && t.due_date < today).length +
      wsTasks.filter(t => t.deadline && t.deadline < today).length
    const todayCount =
      visibleWork.filter(t => t.due_date === today).length +
      wsTasks.filter(t => t.deadline === today).length
    const doneThisWeek =
      doneWork.filter(t => t.completed_at && new Date(t.completed_at) >= monday).length +
      doneWs.filter(t => new Date(t.created_at) >= monday).length
    const renewalClientIds = visibleWork.filter(t => t.task_type === 'Tái ký HĐ' && t.client_id).map(t => t.client_id as string)
    onStatsChange({ overdue, today: todayCount, doneThisWeek, renewalClientIds })
  }, [visibleWork, wsTasks, doneWork, doneWs, onStatsChange])

  // ---- Thêm việc nhanh ----
  const [quickOpen, setQuickOpen] = useState(false)
  const [qTitle, setQTitle] = useState('')
  const [qDue, setQDue] = useState(todayStr())
  const [qKind, setQKind] = useState<'work' | 'ws_task' | 'ws_doc'>('work')
  const [qAssignee, setQAssignee] = useState('')
  const [qSaving, setQSaving] = useState(false)
  const quickInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (quickAddSignal > 0) {
      setQuickOpen(true)
      setTimeout(() => quickInputRef.current?.focus(), 60)
    }
  }, [quickAddSignal])

  async function saveQuickTask() {
    if (!qTitle.trim() || !user || qSaving) return
    setQSaving(true)
    if (qKind === 'work') {
      const { data, error } = await supabase.from('work_tasks').insert({
        user_id: user.id, client_id: null, title: qTitle.trim(), task_type: 'Văn phòng',
        due_date: qDue || todayStr(), priority: 'medium', kcn: null, notes: null, status: 'pending',
      }).select().single()
      if (!error && data) setMyTasks(prev => [data as WorkTask, ...prev])
    } else {
      const { data, error } = await supabase.from('workspace_tasks').insert({
        title: qTitle.trim(), type: qKind === 'ws_doc' ? 'doc' : 'task',
        status: 'not_started', assignee: qAssignee.trim() || null, deadline: qDue || null,
      }).select().single()
      if (!error && data) setWsTasks(prev => [data as WorkspaceTask, ...prev])
    }
    setQSaving(false)
    setQTitle('')
    toast('Đã thêm việc')
  }

  // ---- Form đầy đủ (quy tắc bản cũ — WorkTasksCard): khách hàng / loại việc / ưu tiên / KCN / ghi chú ----
  const [fullForm, setFullForm] = useState(false)
  const [fClientId, setFClientId] = useState('')
  const [fDesc, setFDesc] = useState('')
  const [fType, setFType] = useState(TASK_TYPE_OPTIONS[0])
  const [fDue, setFDue] = useState(todayStr())
  const [fPriority, setFPriority] = useState<TaskPriority>('medium')
  const [fKcn, setFKcn] = useState('')
  const [fNotes, setFNotes] = useState('')
  const [fSaving, setFSaving] = useState(false)

  const activeClients = useMemo(() => clients.filter(c => c.client_type === 'active' && c.cooperation_status !== 'suspended'), [clients])

  function selectFormClient(id: string) {
    setFClientId(id)
    const c = clients.find(cl => cl.id === id)
    if (c?.industrial_zones?.[0]) setFKcn(c.industrial_zones[0])
  }

  function resetFullForm() {
    setFClientId(''); setFDesc(''); setFType(TASK_TYPE_OPTIONS[0])
    setFDue(todayStr()); setFPriority('medium'); setFKcn(''); setFNotes('')
  }

  async function saveFullTask() {
    if (!user || !fDesc.trim() || fSaving) return
    setFSaving(true)
    const selectedClient = clients.find(c => c.id === fClientId) || null
    // Quy tắc bản cũ: tiêu đề = "Tên KH — mô tả" nếu có gắn khách hàng
    const title = selectedClient ? `${selectedClient.name} — ${fDesc.trim()}` : fDesc.trim()
    const { data, error } = await supabase.from('work_tasks').insert({
      user_id: user.id,
      client_id: selectedClient?.id || null,
      title,
      task_type: fType,
      due_date: fDue,
      priority: fPriority,
      kcn: fKcn || null,
      notes: fNotes.trim() || null,
      status: 'pending',
    }).select().single()
    setFSaving(false)
    if (!error && data) {
      setMyTasks(prev => [data as WorkTask, ...prev])
      resetFullForm()
      setFullForm(false)
      toast('Đã lưu công việc')
    }
  }

  // ---- Hoàn thành: ws → xong ngay; work → modal báo cáo ----
  const [reportItem, setReportItem] = useState<WorkTask | null>(null)
  const [reportText, setReportText] = useState('')
  const [newContractEnd, setNewContractEnd] = useState('')

  async function markWsDone(t: WorkspaceTask) {
    setWsTasks(prev => prev.filter(x => x.id !== t.id))
    setDoneWs(prev => [{ ...t, status: 'done' }, ...prev])
    await supabase.from('workspace_tasks').update({ status: 'done' }).eq('id', t.id)
  }

  function startWorkDone(t: WorkTask) {
    setReportItem(t)
    setReportText('')
    if (t.task_type === 'Tái ký HĐ') {
      const client = t.client_id ? clients.find(c => c.id === t.client_id) : null
      setNewContractEnd(client?.contract_end || '')
    } else setNewContractEnd('')
  }

  async function submitReport() {
    const t = reportItem
    if (!t) return
    if (t.task_type === 'Tái ký HĐ' && !newContractEnd) { alert('Vui lòng nhập hạn hợp đồng mới'); return }
    const patch: Partial<WorkTask> = {
      status: 'done', completed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      ...(reportText.trim() ? { notes: reportText.trim() } : {}),
    }
    setMyTasks(prev => prev.filter(x => x.id !== t.id))
    setDoneWork(prev => [{ ...t, ...patch } as WorkTask, ...prev])
    setReportItem(null)
    await supabase.from('work_tasks').update(patch).eq('id', t.id)
    if (t.task_type === 'Tái ký HĐ' && newContractEnd && t.client_id) {
      await supabase.from('clients').update({ contract_end: newContractEnd }).eq('id', t.client_id)
      const client = clients.find(c => c.id === t.client_id)
      if (client) onClientUpdate({ ...client, contract_end: newContractEnd })
    }
  }

  // ---- Trạng thái / doc status / ngưng HĐ (port từ Morning Priority) ----
  const [suspendTask, setSuspendTask] = useState<WorkTask | null>(null)
  const [suspendReason, setSuspendReason] = useState('')
  const [suspendSaving, setSuspendSaving] = useState(false)

  async function changeWorkStatus(t: WorkTask, status: TaskStatus) {
    if (status === 'done') { startWorkDone(t); return }
    setMyTasks(prev => prev.map(x => x.id === t.id ? { ...x, status } : x))
    await supabase.from('work_tasks').update({ status, updated_at: new Date().toISOString() }).eq('id', t.id)
  }

  async function changeDocStatus(t: WorkTask, step: typeof DOC_STATUS_STEPS[number]) {
    if (step.key === 'ngung_hd') { setSuspendTask(t); setSuspendReason(''); return }
    if (step.key === 'hoan_tat') {
      await supabase.from('work_tasks').update({ doc_status: step.key }).eq('id', t.id)
      setMyTasks(prev => prev.map(x => x.id === t.id ? { ...x, doc_status: step.key } : x))
      startWorkDone(t)
      return
    }
    setMyTasks(prev => prev.map(x => x.id === t.id ? { ...x, doc_status: step.key, status: 'in_progress' } : x))
    await supabase.from('work_tasks').update({ doc_status: step.key, status: 'in_progress' }).eq('id', t.id)
  }

  async function submitSuspend() {
    if (!suspendTask || !suspendReason.trim() || !user) return
    setSuspendSaving(true)
    const client = clients.find(c => c.id === suspendTask.client_id)
    if (!client) { setSuspendSaving(false); return }
    if (isAdmin) {
      const now = new Date().toISOString()
      await supabase.from('clients').update({ cooperation_status: 'suspended', suspension_reason: suspendReason.trim(), suspended_at: now, updated_at: now }).eq('id', client.id)
      onClientUpdate({ ...client, cooperation_status: 'suspended', suspension_reason: suspendReason.trim(), suspended_at: now })
    } else {
      await supabase.from('cooperation_suspension_requests').insert({
        client_id: client.id, task_id: suspendTask.id, requester_id: user.id,
        requester_name: user.full_name || user.username || 'Người dùng',
        reason: suspendReason.trim(), status: 'pending',
      })
    }
    setSuspendTask(null)
    setSuspendSaving(false)
    toast(isAdmin ? `Đã ngưng hợp tác với "${client.name}"` : 'Đã gửi yêu cầu ngưng HĐ — chờ Quản trị viên duyệt')
  }

  async function deleteWork(id: string) {
    setMyTasks(prev => prev.filter(t => t.id !== id))
    await supabase.from('work_tasks').delete().eq('id', id)
  }

  // ---- Sửa / xoá việc chung ----
  const [editWsId, setEditWsId] = useState<string | null>(null)
  const [editWs, setEditWs] = useState<{ title: string; status: string; deadline: string; assignee: string }>({ title: '', status: '', deadline: '', assignee: '' })

  async function saveWsEdit(id: string) {
    if (!editWs.title.trim()) return
    const patch = { title: editWs.title.trim(), status: editWs.status, deadline: editWs.deadline || null, assignee: editWs.assignee.trim() || null }
    setWsTasks(prev => prev.map(t => t.id === id ? { ...t, ...patch } : t))
    setEditWsId(null)
    await supabase.from('workspace_tasks').update(patch).eq('id', id)
  }

  async function deleteWs(id: string) {
    setWsTasks(prev => prev.filter(t => t.id !== id))
    await supabase.from('workspace_tasks').delete().eq('id', id)
  }

  // ---- Bình luận (chỉ work tasks) ----
  const [commentInput, setCommentInput] = useState<Record<string, string>>({})
  const [sendingComment, setSendingComment] = useState<string | null>(null)
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null)
  const [editingCommentText, setEditingCommentText] = useState('')

  async function sendComment(taskId: string) {
    const content = (commentInput[taskId] ?? '').trim()
    if (!content || !user) return
    setSendingComment(taskId)
    const { data, error } = await supabase.from('work_task_comments').insert({
      task_id: taskId, user_id: user.id, user_name: user.full_name || user.username || 'Người dùng', content,
    }).select().single()
    if (!error && data) {
      setComments(prev => ({ ...prev, [taskId]: [...(prev[taskId] ?? []), data as WorkTaskComment] }))
      setCommentInput(prev => ({ ...prev, [taskId]: '' }))
    }
    setSendingComment(null)
  }

  async function saveCommentEdit(commentId: string, taskId: string) {
    const content = editingCommentText.trim()
    if (!content) return
    setComments(prev => ({ ...prev, [taskId]: (prev[taskId] ?? []).map(c => c.id === commentId ? { ...c, content } : c) }))
    setEditingCommentId(null)
    await supabase.from('work_task_comments').update({ content }).eq('id', commentId)
  }

  async function deleteComment(commentId: string, taskId: string) {
    setComments(prev => ({ ...prev, [taskId]: (prev[taskId] ?? []).filter(c => c.id !== commentId) }))
    await supabase.from('work_task_comments').delete().eq('id', commentId)
  }

  // ---- Mở rộng dòng ----
  const [expandedKey, setExpandedKey] = useState<string | null>(null)

  // ---- Lịch sử hoàn thành (accordion) ----
  const [historyOpen, setHistoryOpen] = useState(false)
  const [histSearch, setHistSearch] = useState('')
  const [histCat, setHistCat] = useState('all')

  interface DoneItem { id: string; key: string; title: string; category: string; doneAt: string | null; notes: string | null; assignee: string | null; kcn: string | null }
  const doneHistory = useMemo((): DoneItem[] => [
    ...doneWork.map(t => ({
      id: t.id, key: `w_${t.id}`, title: t.title,
      category: workCategory(t.task_type),
      doneAt: t.completed_at ?? null, notes: t.notes ?? null, assignee: null, kcn: t.kcn ?? null,
    })),
    ...doneWs.map(t => ({
      id: t.id, key: `s_${t.id}`, title: t.title,
      category: t.type === 'doc' ? 'Hồ sơ' : 'Nội bộ',
      doneAt: t.created_at ?? null, notes: null, assignee: t.assignee ?? null, kcn: null,
    })),
  ].sort((a, b) => (b.doneAt ?? '').localeCompare(a.doneAt ?? '')), [doneWork, doneWs])

  const HIST_CATS = ['Tất cả', 'Hợp đồng', 'Báo giá', 'Thăm quan / KH', 'Hồ sơ', 'Nội bộ', 'Khác']
  const filteredHistory = doneHistory.filter(t =>
    (histCat === 'all' || t.category === histCat) &&
    (!histSearch.trim() || t.title.toLowerCase().includes(histSearch.toLowerCase()))
  )

  // ---- Render 1 dòng việc ----
  function renderRow(it: FeedItem, group: GroupKey) {
    const expanded = expandedKey === it.key
    const isOverdue = group === 'overdue'
    const cmts = it.source === 'work' ? (comments[it.id] ?? []) : []
    const wsSt = it.ws ? (WS_STATUS[it.ws.status] || WS_STATUS.not_started) : null
    const isEditingWs = it.source === 'ws' && editWsId === it.id

    return (
      <div key={it.key} className="border-t border-[#F0EFEB]">
        <div className="flex items-center gap-2.5 px-4 py-2 hover:bg-[#FBFAF7] cursor-pointer" onClick={() => setExpandedKey(expanded ? null : it.key)}>
          <button
            onClick={e => { e.stopPropagation(); it.source === 'ws' ? markWsDone(it.ws!) : startWorkDone(it.work!) }}
            title="Đánh dấu hoàn thành"
            className={`w-[19px] h-[19px] rounded-full border-[1.8px] shrink-0 flex items-center justify-center transition-colors hover:border-green-500 hover:bg-green-50 ${isOverdue ? 'border-red-300' : 'border-[#cfccc2]'}`}
          >
            <Check size={11} className="opacity-0 hover:opacity-100 text-green-600" />
          </button>
          <div className="min-w-0 flex-1">
            <div className="text-[12.5px] font-semibold text-[#111] truncate">{it.title}</div>
            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
              <span className={`text-[9.5px] font-semibold px-1.5 py-px rounded-md border ${CATEGORY_TAG[it.category]}`}>{it.category}</span>
              {it.work?.kcn && <span className="text-[10.5px] text-[#999]">{it.work.kcn}</span>}
              {wsSt && <span className={`text-[9.5px] px-1.5 py-px rounded-full border ${wsSt.cls}`}>{wsSt.label}</span>}
              {it.ws?.assignee && <span className="text-[10.5px] text-[#888]">{it.ws.assignee}</span>}
              {it.work && <span className={`text-[9.5px] px-1.5 py-px rounded-full border ${TASK_PRIORITY_COLORS[it.work.priority]}`}>{TASK_PRIORITY_LABELS[it.work.priority]}</span>}
              {cmts.length > 0 && <span className="text-[10.5px] text-[#999] flex items-center gap-0.5"><MessageSquare size={10} />{cmts.length}</span>}
            </div>
          </div>
          <span className={`text-[11px] whitespace-nowrap shrink-0 ${isOverdue ? 'text-red-600 font-bold' : 'text-[#999]'}`}>{dueLabel(it.due, group)}</span>
          <ChevronDown size={13} className={`text-[#bbb] shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </div>

        {expanded && (
          <div className="px-4 pb-3 pl-[46px] flex flex-col gap-2">
            {/* --- Việc cá nhân: doc status / trạng thái / xoá --- */}
            {it.work && (
              <div className="flex items-center gap-2 flex-wrap">
                {it.work.task_type === 'Tái ký HĐ' ? (
                  <div className="flex items-center gap-1 flex-wrap">
                    {DOC_STATUS_STEPS.map(step => {
                      const active = it.work!.doc_status === step.key
                      return (
                        <button
                          key={step.key}
                          onClick={() => changeDocStatus(it.work!, step)}
                          className={`text-[10px] px-2 py-1 rounded-md border font-medium transition ${active ? (DOC_STATUS_BTN[step.key] ?? '') : 'bg-white text-[#888] border-[#E8E7E2] hover:border-blue-300'} ${step.danger && !active ? 'text-red-500' : ''}`}
                        >
                          {step.label}
                        </button>
                      )
                    })}
                  </div>
                ) : (
                  <select
                    value={it.work.status}
                    onChange={e => changeWorkStatus(it.work!, e.target.value as TaskStatus)}
                    className={`text-[10.5px] border rounded-md px-2 py-1 focus:outline-none font-medium ${TASK_STATUS_COLORS[it.work.status] ?? 'bg-slate-100 text-slate-600 border-slate-300'}`}
                  >
                    {(['pending', 'in_progress', 'done', 'ngung_hd'] as TaskStatus[]).map(s => (
                      <option key={s} value={s}>{TASK_STATUS_LABELS[s]}</option>
                    ))}
                  </select>
                )}
                <span className="text-[10.5px] text-[#999]">Hạn: {formatDate(it.work.due_date)}</span>
                <button
                  onClick={() => {
                    const msg = it.work!.task_type === 'Tái ký HĐ'
                      ? 'Xoá công việc này? Client sẽ hiện lại ở "HĐ cần xử lý".'
                      : 'Xoá công việc này?'
                    if (confirm(msg)) deleteWork(it.id)
                  }}
                  className="ml-auto p-1 rounded hover:bg-red-50 text-[#ccc] hover:text-red-500 transition"
                  title="Xoá"
                ><Trash2 size={13} /></button>
              </div>
            )}

            {/* --- Việc chung: sửa inline / xoá --- */}
            {it.ws && !isEditingWs && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10.5px] text-[#999]">{it.ws.type === 'doc' ? 'Hồ sơ · HĐ' : 'Task nội bộ'}{it.ws.deadline ? ` · hạn ${formatDate(it.ws.deadline)}` : ''}</span>
                <div className="ml-auto flex items-center gap-1">
                  <button
                    onClick={() => { setEditWsId(it.id); setEditWs({ title: it.ws!.title, status: it.ws!.status, deadline: it.ws!.deadline ?? '', assignee: it.ws!.assignee ?? '' }) }}
                    className="p-1 rounded hover:bg-blue-50 text-[#ccc] hover:text-blue-500 transition" title="Sửa"
                  ><Pencil size={13} /></button>
                  <button
                    onClick={() => { if (confirm('Xoá công việc này?')) deleteWs(it.id) }}
                    className="p-1 rounded hover:bg-red-50 text-[#ccc] hover:text-red-500 transition" title="Xoá"
                  ><Trash2 size={13} /></button>
                </div>
              </div>
            )}
            {it.ws && isEditingWs && (
              <div className="flex flex-col gap-2">
                <input
                  autoFocus value={editWs.title}
                  onChange={e => setEditWs(p => ({ ...p, title: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter') saveWsEdit(it.id); if (e.key === 'Escape') setEditWsId(null) }}
                  className="text-[12px] px-2 py-1 border border-blue-300 rounded-md focus:outline-none w-full"
                />
                <div className="flex gap-2 flex-wrap">
                  <select value={editWs.status} onChange={e => setEditWs(p => ({ ...p, status: e.target.value }))} className="text-[11px] px-2 py-1 border border-[#E8E7E2] rounded-md focus:outline-none">
                    {Object.entries(WS_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select>
                  <input type="date" value={editWs.deadline} onChange={e => setEditWs(p => ({ ...p, deadline: e.target.value }))} className="text-[11px] px-2 py-1 border border-[#E8E7E2] rounded-md focus:outline-none" />
                  <input placeholder="Người phụ trách" value={editWs.assignee} onChange={e => setEditWs(p => ({ ...p, assignee: e.target.value }))} className="text-[11px] px-2 py-1 border border-[#E8E7E2] rounded-md focus:outline-none flex-1 min-w-[90px]" />
                  <button onClick={() => setEditWsId(null)} className="text-[11px] px-2.5 py-1 border border-[#E8E7E2] rounded-md text-[#666]">Huỷ</button>
                  <button onClick={() => saveWsEdit(it.id)} className="text-[11px] px-2.5 py-1 bg-blue-600 text-white rounded-md">Lưu</button>
                </div>
              </div>
            )}

            {/* --- Bình luận (work) --- */}
            {it.work && (
              <div className="border border-[#E8E7E2] rounded-lg bg-white overflow-hidden">
                {cmts.length > 0 && (
                  <div className="flex flex-col divide-y divide-[#F0EEE9] max-h-36 overflow-y-auto">
                    {cmts.map(cm => (
                      <div key={cm.id} className="px-2.5 py-1.5 group">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <span className="text-[10.5px] font-semibold text-[#1D4ED8]">{cm.user_name}</span>
                          <span className="text-[10px] text-[#bbb]">{new Date(cm.created_at).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                          <div className="ml-auto flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => { setEditingCommentId(cm.id); setEditingCommentText(cm.content) }} className="p-0.5 rounded hover:bg-blue-50 text-[#ccc] hover:text-blue-500"><Pencil size={10} /></button>
                            <button onClick={() => { if (confirm('Xoá bình luận này?')) deleteComment(cm.id, it.id) }} className="p-0.5 rounded hover:bg-red-50 text-[#ccc] hover:text-red-500"><Trash2 size={10} /></button>
                          </div>
                        </div>
                        {editingCommentId === cm.id ? (
                          <div className="flex gap-1 mt-1">
                            <input autoFocus value={editingCommentText} onChange={e => setEditingCommentText(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') saveCommentEdit(cm.id, it.id); if (e.key === 'Escape') setEditingCommentId(null) }}
                              className="flex-1 text-[11px] px-2 py-0.5 border border-blue-300 rounded focus:outline-none" />
                            <button onClick={() => saveCommentEdit(cm.id, it.id)} className="text-[10px] px-1.5 py-0.5 bg-blue-600 text-white rounded"><Check size={10} /></button>
                            <button onClick={() => setEditingCommentId(null)} className="text-[10px] px-1.5 py-0.5 border border-[#E8E7E2] rounded text-[#666]"><X size={10} /></button>
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
                    type="text" value={commentInput[it.id] ?? ''}
                    onChange={e => setCommentInput(prev => ({ ...prev, [it.id]: e.target.value }))}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendComment(it.id) } }}
                    placeholder="Bình luận tình trạng..."
                    className="flex-1 text-[11px] px-2 py-1 rounded-md border border-[#E8E7E2] focus:outline-none focus:border-blue-400 bg-[#fafafa] placeholder:text-[#ccc]"
                  />
                  <button
                    onClick={() => sendComment(it.id)}
                    disabled={sendingComment === it.id || !(commentInput[it.id] ?? '').trim()}
                    className="text-[11px] px-2.5 py-1 rounded-md bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-40 shrink-0"
                  >Gửi</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <>
      <div className="bg-white border border-[#E8E7E2] rounded-[12px] overflow-hidden">
        {/* Head: tiêu đề + chip lọc */}
        <div className="flex items-center justify-between gap-2 px-4 py-2.5 flex-wrap">
          <h2 className="text-[13.5px] font-extrabold text-[#0c2340]">Việc của tôi</h2>
          <div className="flex gap-1 flex-wrap">
            {CATEGORY_CHIPS.map(c => (
              <button
                key={c}
                onClick={() => setFilter(c)}
                className={`text-[10.5px] px-2.5 py-0.5 rounded-full border transition ${filter === c ? 'bg-[#0c2340] text-white border-[#0c2340]' : 'bg-white text-[#666] border-[#E8E7E2] hover:border-blue-300'}`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        {/* Thêm việc nhanh + form đầy đủ */}
        <div className="px-4 py-2 border-t border-[#F0EFEB] bg-[#FBFAF7]">
          {!quickOpen && !fullForm ? (
            <button onClick={() => { setQuickOpen(true); setTimeout(() => quickInputRef.current?.focus(), 60) }}
              className="w-full text-left text-[12px] text-[#999] px-3 py-1.5 rounded-[9px] border border-dashed border-[#d6d3c8] bg-white hover:border-blue-300 transition flex items-center gap-1.5">
              <Plus size={13} /> Thêm việc mới — Enter để lưu
            </button>
          ) : quickOpen && !fullForm ? (
            <div className="flex flex-col gap-1.5">
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  ref={quickInputRef} autoFocus placeholder="Tên công việc..."
                  value={qTitle} onChange={e => setQTitle(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') saveQuickTask(); if (e.key === 'Escape') setQuickOpen(false) }}
                  className="flex-1 text-[12.5px] px-3 py-1.5 rounded-[9px] border border-[#E8E7E2] bg-white focus:outline-none focus:border-blue-400"
                />
                <div className="flex gap-2 flex-wrap">
                  <select value={qKind} onChange={e => setQKind(e.target.value as typeof qKind)} className="text-[11.5px] px-2 py-1 rounded-md border border-[#E8E7E2] bg-white focus:outline-none">
                    <option value="work">Việc của tôi</option>
                    <option value="ws_task">Task nội bộ (chung)</option>
                    <option value="ws_doc">Hồ sơ · HĐ (chung)</option>
                  </select>
                  <input type="date" value={qDue} onChange={e => setQDue(e.target.value)} className="text-[11.5px] px-2 py-1 rounded-md border border-[#E8E7E2] bg-white focus:outline-none" />
                  {qKind !== 'work' && (
                    <input placeholder="Người phụ trách" value={qAssignee} onChange={e => setQAssignee(e.target.value)} className="text-[11.5px] px-2 py-1 rounded-md border border-[#E8E7E2] bg-white focus:outline-none w-28" />
                  )}
                  <button onClick={saveQuickTask} disabled={!qTitle.trim() || qSaving} className="text-[11.5px] px-3 py-1 rounded-md bg-blue-600 text-white font-medium disabled:opacity-40">Lưu</button>
                  <button onClick={() => setQuickOpen(false)} className="text-[11.5px] px-2 py-1 rounded-md border border-[#E8E7E2] text-[#666]">✕</button>
                </div>
              </div>
              <button onClick={() => { setQuickOpen(false); setFullForm(true); setFDesc(qTitle) }} className="self-start text-[11px] text-blue-600 hover:underline">
                Mở form đầy đủ (khách hàng, loại việc, ưu tiên, KCN...) →
              </button>
            </div>
          ) : (
            <div className="border border-[#E8E7E2] rounded-lg p-3 flex flex-col gap-2 bg-white">
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="flex-1">
                  <label className="text-[10px] font-medium text-[#888] uppercase tracking-wide mb-1 block">Tên công việc</label>
                  <input
                    autoFocus
                    className="w-full text-[12px] border border-[#E8E7E2] rounded-md px-2.5 py-1.5 bg-white text-[#333] placeholder:text-[#bbb] focus:outline-none focus:border-blue-400"
                    placeholder="VD: đàm phán giá tái ký, soạn HĐ mới..."
                    value={fDesc} onChange={e => setFDesc(e.target.value)}
                  />
                </div>
                <div className="flex-1">
                  <label className="text-[10px] font-medium text-[#888] uppercase tracking-wide mb-1 block">Khách hàng</label>
                  <select
                    className="w-full text-[12px] border border-[#E8E7E2] rounded-md px-2.5 py-1.5 bg-white text-[#333] focus:outline-none focus:border-blue-400"
                    value={fClientId} onChange={e => selectFormClient(e.target.value)}
                  >
                    <option value="">— Không chọn —</option>
                    {activeClients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div className="sm:w-32">
                  <label className="text-[10px] font-medium text-[#888] uppercase tracking-wide mb-1 block">Loại việc</label>
                  <select
                    className="w-full text-[12px] border border-[#E8E7E2] rounded-md px-2 py-1.5 bg-white text-[#555] focus:outline-none focus:border-blue-400"
                    value={fType} onChange={e => setFType(e.target.value)}
                  >
                    {TASK_TYPE_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="flex-1">
                  <label className="text-[10px] font-medium text-[#888] uppercase tracking-wide mb-1 block">Ngày dự kiến</label>
                  <input type="date" value={fDue} onChange={e => setFDue(e.target.value)}
                    className="w-full text-[12px] border border-[#E8E7E2] rounded-md px-2.5 py-1.5 bg-white text-[#333] focus:outline-none focus:border-blue-400" />
                </div>
                <div className="flex-1">
                  <label className="text-[10px] font-medium text-[#888] uppercase tracking-wide mb-1 block">Mức độ ưu tiên</label>
                  <div className="flex gap-1.5">
                    {(['high', 'medium', 'low'] as TaskPriority[]).map(p => (
                      <button key={p} onClick={() => setFPriority(p)}
                        className={`flex-1 text-[11px] px-2.5 py-1.5 rounded-md border transition-all ${fPriority === p ? TASK_PRIORITY_COLORS[p] + ' font-medium' : 'bg-white text-[#666] border-[#E8E7E2] hover:border-blue-300'}`}>
                        {TASK_PRIORITY_LABELS[p]}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex-1">
                  <label className="text-[10px] font-medium text-[#888] uppercase tracking-wide mb-1 block">KCN / Địa điểm</label>
                  <input placeholder="VSIP I, VP..." value={fKcn} onChange={e => setFKcn(e.target.value)}
                    className="w-full text-[12px] border border-[#E8E7E2] rounded-md px-2.5 py-1.5 bg-white text-[#333] placeholder:text-[#bbb] focus:outline-none focus:border-blue-400" />
                </div>
              </div>
              <div>
                <label className="text-[10px] font-medium text-[#888] uppercase tracking-wide mb-1 block">Ghi chú / Chuẩn bị</label>
                <textarea rows={2} placeholder="Chuẩn bị tài liệu, thông tin cần lưu ý..."
                  value={fNotes} onChange={e => setFNotes(e.target.value)}
                  className="w-full text-[12px] border border-[#E8E7E2] rounded-md px-2.5 py-1.5 bg-white text-[#333] placeholder:text-[#bbb] focus:outline-none focus:border-blue-400 resize-none" />
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => { resetFullForm(); setFullForm(false) }}
                  className="text-[12px] px-3 py-1.5 rounded-md border border-[#E8E7E2] text-[#666] hover:bg-[#f4f4f1] transition-colors">Huỷ</button>
                <button onClick={saveFullTask} disabled={!fDesc.trim() || fSaving}
                  className="text-[12px] px-3 py-1.5 rounded-md bg-blue-600 text-white font-medium disabled:opacity-40 hover:bg-blue-700 transition-colors">
                  {fSaving ? 'Đang lưu...' : 'Lưu công việc'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Feed */}
        {loading ? (
          <div className="text-[12.5px] text-[#999] py-8 text-center border-t border-[#F0EFEB]">Đang tải...</div>
        ) : totalVisible === 0 ? (
          <div className="text-[12.5px] text-[#999] py-8 text-center border-t border-[#F0EFEB]">
            {filter === 'Tất cả' ? '🎉 Không còn việc nào — tuyệt vời!' : 'Không có việc nào trong nhóm này'}
          </div>
        ) : (
          (Object.keys(GROUP_META) as GroupKey[]).map(gk => {
            const items = groups[gk]
            if (!items.length) return null
            const meta = GROUP_META[gk]
            return (
              <div key={gk}>
                <div className={`flex items-center gap-2 px-4 pt-3 pb-1 text-[10.5px] font-extrabold uppercase tracking-wider ${meta.head}`}>
                  {meta.label}
                  <span className={`text-[10px] font-bold px-1.5 py-px rounded-full ${meta.badge}`}>{items.length}</span>
                </div>
                {items.map(it => renderRow(it, gk))}
              </div>
            )
          })
        )}
      </div>

      {/* Lịch sử hoàn thành — accordion */}
      {!hideHistory && (
        <div className="mt-4 bg-white border border-[#E8E7E2] rounded-[12px] overflow-hidden">
          <button onClick={() => setHistoryOpen(v => !v)} className="w-full flex items-center justify-between px-4 py-2.5 bg-[#F9F9F7] text-left">
            <div className="flex items-center gap-2 text-[12.5px] font-semibold text-[#333]">
              <History size={14} className="text-[#888]" />
              Lịch sử hoàn thành — 30 ngày
              {doneHistory.length > 0 && (
                <span className="text-[10.5px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">{doneHistory.length}</span>
              )}
            </div>
            <ChevronDown size={15} className={`text-[#999] transition-transform ${historyOpen ? 'rotate-180' : ''}`} />
          </button>
          {historyOpen && (
            <div className="border-t border-[#E8E7E2]">
              <div className="flex items-center gap-2 px-4 py-2 flex-wrap">
                <div className="relative">
                  <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-[#bbb]" />
                  <input
                    value={histSearch} onChange={e => setHistSearch(e.target.value)} placeholder="Tìm theo tên..."
                    className="text-[11px] pl-6 pr-2 py-1 rounded-md border border-[#E8E7E2] focus:outline-none focus:border-blue-400 bg-white w-40"
                  />
                </div>
                <div className="flex gap-1 flex-wrap">
                  {HIST_CATS.map(c => {
                    const key = c === 'Tất cả' ? 'all' : c
                    const count = c === 'Tất cả' ? doneHistory.length : doneHistory.filter(t => t.category === c).length
                    return (
                      <button key={c} onClick={() => setHistCat(key)}
                        className={`text-[10.5px] px-2 py-0.5 rounded-full border transition ${histCat === key ? 'bg-[#0c2340] text-white border-[#0c2340]' : 'bg-white text-[#666] border-[#E8E7E2]'}`}>
                        {c}{count > 0 ? ` ${count}` : ''}
                      </button>
                    )
                  })}
                </div>
              </div>
              <div className="max-h-80 overflow-y-auto px-4 pb-3 flex flex-col gap-1.5">
                {filteredHistory.length === 0 ? (
                  <div className="text-[12px] text-[#999] py-5 text-center">Không có kết quả</div>
                ) : filteredHistory.map(t => (
                  <div key={t.key} className="px-3 py-2 border border-[#F0EFEB] bg-[#fafafa] rounded-lg">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className={`text-[9.5px] font-semibold px-1.5 py-px rounded-md border ${CATEGORY_TAG[t.category as Category] ?? CATEGORY_TAG['Khác']}`}>{t.category}</span>
                      <span className="text-[12px] font-medium text-[#111] truncate">{t.title}</span>
                    </div>
                    <div className="text-[10.5px] text-[#888] mt-0.5">
                      ✓ {t.doneAt ? formatDate(t.doneAt.split('T')[0]) : ''}
                      {t.kcn ? ` · ${t.kcn}` : ''}{t.assignee ? ` · ${t.assignee}` : ''}
                    </div>
                    {t.notes && (
                      <div className="mt-1 flex items-start gap-1.5 bg-emerald-50 border border-emerald-200 rounded-md px-2 py-1">
                        <span className="text-[10px] text-emerald-600 font-semibold shrink-0 mt-0.5">Kết quả:</span>
                        <span className="text-[11px] text-emerald-800">{t.notes}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Modal báo cáo hoàn thành (work task) */}
      {reportItem && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setReportItem(null)}>
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-gray-200">
              <h2 className="text-[14px] font-semibold text-gray-900">Hoàn thành công việc</h2>
              <p className="text-[11.5px] text-gray-500 mt-0.5 truncate">{reportItem.title}</p>
            </div>
            <div className="p-5 space-y-3">
              {reportItem.task_type === 'Tái ký HĐ' && (
                <div>
                  <label className="text-[11px] font-semibold text-gray-700 mb-1 block">Hạn hợp đồng mới <span className="text-red-500">*</span></label>
                  <input type="date" value={newContractEnd} onChange={e => setNewContractEnd(e.target.value)}
                    className="w-full text-[12.5px] border border-[#E8E7E2] rounded-lg px-3 py-2 focus:outline-none focus:border-blue-400" />
                </div>
              )}
              <div>
                <label className="text-[11px] font-semibold text-gray-700 mb-1 block">Báo cáo kết quả</label>
                <textarea rows={3} autoFocus value={reportText} onChange={e => setReportText(e.target.value)}
                  placeholder="Nội dung đã hoàn thành..."
                  className="w-full text-[12.5px] border border-[#E8E7E2] rounded-lg px-3 py-2 focus:outline-none focus:border-blue-400 resize-none" />
              </div>
            </div>
            <div className="px-5 pb-5 flex gap-2">
              <button onClick={() => setReportItem(null)} className="flex-1 px-3 py-2 text-[12.5px] font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition">Huỷ</button>
              <button onClick={submitReport} className="flex-1 px-3 py-2 text-[12.5px] font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition">Hoàn thành</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal yêu cầu ngưng HĐ */}
      {suspendTask && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setSuspendTask(null)}>
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
              <div>
                <h2 className="text-[14px] font-semibold text-gray-900">{isAdmin ? 'Ngưng hợp tác' : 'Yêu cầu ngưng hợp tác'}</h2>
                <p className="text-[11px] text-gray-500 mt-0.5">{clients.find(c => c.id === suspendTask.client_id)?.name ?? suspendTask.title}</p>
              </div>
              <button onClick={() => setSuspendTask(null)} className="p-1 hover:bg-gray-100 rounded-md text-gray-500"><X size={15} /></button>
            </div>
            <div className="p-5 space-y-3">
              {!isAdmin && (
                <p className="text-[12px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  Yêu cầu sẽ được gửi đến <strong>Quản trị viên</strong> để xét duyệt trước khi có hiệu lực.
                </p>
              )}
              <div>
                <label className="block text-[11px] font-semibold text-gray-700 mb-1">Lý do ngưng <span className="text-red-500">*</span></label>
                <textarea rows={3} value={suspendReason} onChange={e => setSuspendReason(e.target.value)} autoFocus
                  placeholder="Nhập lý do ngưng hợp tác..."
                  className="w-full px-3 py-2 text-[12.5px] border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-400 resize-none" />
              </div>
            </div>
            <div className="px-5 pb-5 flex gap-2">
              <button onClick={() => setSuspendTask(null)} className="flex-1 px-3 py-2 text-[12.5px] font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition">Hủy</button>
              <button onClick={submitSuspend} disabled={suspendSaving || !suspendReason.trim()}
                className="flex-1 px-3 py-2 text-[12.5px] font-medium text-white bg-orange-500 hover:bg-orange-600 disabled:opacity-50 rounded-lg transition">
                {suspendSaving ? 'Đang gửi...' : isAdmin ? 'Xác nhận ngưng' : 'Gửi yêu cầu'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
