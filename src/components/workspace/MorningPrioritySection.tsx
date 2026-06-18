// src/components/workspace/MorningPrioritySection.tsx
import { useState, useEffect, useMemo } from 'react'
import { Sun, FileWarning, Phone, MapPin, ArrowRight, Check, ListTodo, ChevronDown, ChevronUp, ChevronRight, Undo2, Settings, X, Trash2, Pencil } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { useRegions } from '../../hooks/useRegions'
import { useBranchData } from '../../hooks/useBranchData'
import { usePersistedState } from '../../hooks/usePersistedState'
import type { Client, WorkTask, TaskStatus, Branch, WorkTaskComment } from '../../lib/types'
import { TASK_PRIORITY_LABELS, TASK_PRIORITY_COLORS, TASK_STATUS_LABELS, TASK_STATUS_COLORS, DOC_STATUS_STEPS, type DocStatus } from '../../lib/types'
import { formatDate, daysUntil } from '../../lib/format'
import { WorkTasksCard } from './WorkTasksCard'
import { BranchHistoryFields, recordBranchUpdateSession } from './BranchHistoryFields'

// Colors per doc status step
const DOC_STATUS_BTN: Record<string, string> = {
  chua_soan: 'bg-gray-100 text-gray-600 border-gray-300',
  dang_soan: 'bg-blue-100 text-blue-700 border-blue-300',
  cho_duyet: 'bg-amber-100 text-amber-700 border-amber-300',
  cho_kh_ky: 'bg-violet-100 text-violet-700 border-violet-300',
  hoan_tat:  'bg-green-100 text-green-700 border-green-300',
  ngung_hd:  'bg-red-100 text-red-700 border-red-300',
}
const DOC_STATUS_STEP_DOT: Record<string, string> = {
  chua_soan: 'bg-gray-400 border-gray-400 text-white',
  dang_soan: 'bg-blue-500 border-blue-500 text-white',
  cho_duyet: 'bg-amber-500 border-amber-500 text-white',
  cho_kh_ky: 'bg-violet-500 border-violet-500 text-white',
  hoan_tat:  'bg-green-500 border-green-500 text-white',
  ngung_hd:  'bg-red-500 border-red-500 text-white',
}

// --- DocStatusDropdown: 1 nút, click sổ danh sách chọn trạng thái ---
function DocStatusDropdown({
  taskId,
  docStatus,
  onSelect,
}: {
  taskId: string
  docStatus: DocStatus | null
  onSelect: (taskId: string, step: typeof DOC_STATUS_STEPS[number]) => void
}) {
  const [open, setOpen] = useState(false)
  const current = DOC_STATUS_STEPS.find(s => s.key === docStatus)
  const label = current?.label ?? 'Chọn trạng thái'
  const btnColor = docStatus ? (DOC_STATUS_BTN[docStatus] ?? 'bg-gray-100 text-gray-600 border-gray-300') : 'bg-white text-[#666] border-[#E8E7E2]'

  return (
    <div className="relative shrink-0">
      <button
        onClick={() => setOpen(v => !v)}
        className={`flex items-center gap-1 text-[10.5px] px-2.5 py-1 rounded-md border font-medium transition-colors hover:opacity-80 ${btnColor}`}
      >
        {label}
        <ChevronDown size={11} className={open ? 'rotate-180 transition-transform' : 'transition-transform'} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-50 bg-white border border-[#E8E7E2] rounded-lg shadow-lg overflow-hidden flex flex-row">
            {DOC_STATUS_STEPS.map((step, i) => {
              const isActive = docStatus === step.key
              const dotCls = isActive ? (DOC_STATUS_STEP_DOT[step.key] ?? 'bg-gray-400 border-gray-400 text-white') : 'border-[#ccc] text-[#999]'
              return (
                <button
                  key={step.key}
                  onClick={() => { onSelect(taskId, step); setOpen(false) }}
                  className={[
                    'px-3 py-2 text-[11px] flex flex-col items-center gap-1 transition-colors whitespace-nowrap border-r last:border-r-0 border-[#F0EFEB]',
                    isActive ? 'bg-gray-50 font-semibold' : 'hover:bg-[#F5F4F0]',
                  ].join(' ')}
                >
                  {!step.danger ? (
                    <span className={`w-5 h-5 rounded-full border flex items-center justify-center text-[9px] font-bold ${dotCls}`}>
                      {i + 1}
                    </span>
                  ) : (
                    <span className="text-[13px]">🚫</span>
                  )}
                  <span className={step.danger ? 'text-red-600' : isActive ? (DOC_STATUS_BTN[step.key]?.split(' ')[1] ?? 'text-gray-700') : 'text-[#333]'}>
                    {step.label}
                  </span>
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

interface Props {
  clients: Client[]
  onClientUpdate: (client: Client) => void
  onTaskDone?: (taskId: string) => void
}

function todayStr() {
  return new Date().toISOString().split('T')[0]
}

interface ContractSuggest { client: Client; daysLeft: number; kcn: string }
interface VisitSuggest { branchName: string; daysSince: number | null }

export function MorningPrioritySection({ clients, onClientUpdate, onTaskDone }: Props) {
  const { user } = useAuth()
  const { regions } = useRegions()
  const { branches, updateBranch } = useBranchData()
  const [saving, setSaving] = useState(false)
  const [branchActivity, setBranchActivity] = useState<Record<string, string>>({})

  const [selectedContractIds, setSelectedContractIds] = useState<Set<string>>(new Set())
  const [showManualAdd, setShowManualAdd] = useState(false)
  const [manualSearch, setManualSearch] = useState('')
  const [addingManual, setAddingManual] = useState(false)
  const [visitThreshold, setVisitThreshold] = usePersistedState('lgvn_visit_threshold_days', 7)
  const [showThresholdSettings, setShowThresholdSettings] = useState(false)
  const [openBranchPanel, setOpenBranchPanel] = useState<Branch | null>(null)
  const [panelForm, setPanelForm] = useState<Partial<Branch>>({})
  const [panelRecordDate, setPanelRecordDate] = useState(todayStr())
  const [panelSaving, setPanelSaving] = useState(false)
  const [pendingTasks, setPendingTasks] = useState<WorkTask[]>([])
  const [doneTasks, setDoneTasks] = useState<WorkTask[]>([])
  const [showDoneHistory, setShowDoneHistory] = useState(false)
  const [reportTaskId, setReportTaskId] = useState<string | null>(null)
  const [reportText, setReportText] = useState('')
  const [newContractEnd, setNewContractEnd] = useState('')
  const [taskComments, setTaskComments] = useState<Record<string, WorkTaskComment[]>>({})
  const [commentInput, setCommentInput] = useState<Record<string, string>>({})
  const [submittingComment, setSubmittingComment] = useState<string | null>(null)
  const [suspendRequestTask, setSuspendRequestTask] = useState<WorkTask | null>(null)
  const [suspendRequestReason, setSuspendRequestReason] = useState('')
  const [submittingSuspend, setSubmittingSuspend] = useState(false)
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null)
  const [editingCommentContent, setEditingCommentContent] = useState('')

  useEffect(() => { loadPendingTasks(); loadDoneTasks() }, [user])

  async function loadPendingTasks() {
    if (!user) return
    const { data } = await supabase
      .from('work_tasks')
      .select('*')
      .eq('user_id', user.id)
      .neq('status', 'done')
      .order('due_date', { ascending: true })
    if (data) {
      setPendingTasks(data as WorkTask[])
      // load comments for all pending tasks
      const ids = (data as WorkTask[]).map(t => t.id)
      if (ids.length) {
        supabase.from('work_task_comments').select('*').in('task_id', ids).order('created_at', { ascending: true }).then(({ data: cData }) => {
          if (!cData) return
          const map: Record<string, WorkTaskComment[]> = {}
          for (const c of cData as WorkTaskComment[]) {
            if (!map[c.task_id]) map[c.task_id] = []
            map[c.task_id].push(c)
          }
          setTaskComments(map)
        })
      }
    }
  }

  async function loadDoneTasks() {
    if (!user) return
    const since = new Date(Date.now() - 30 * 86400000).toISOString()
    const { data } = await supabase
      .from('work_tasks')
      .select('*')
      .eq('user_id', user.id)
      .eq('status', 'done')
      .gte('completed_at', since)
      .order('completed_at', { ascending: false })
    if (data) setDoneTasks(data as WorkTask[])
  }

  function handleTaskCreated(task: WorkTask) {
    setPendingTasks(prev => [task, ...prev])
    setTaskComments(prev => ({ ...prev, [task.id]: [] }))
  }

  async function handleDocStatusChange(id: string, docStatus: DocStatus) {
    if (docStatus === 'hoan_tat') {
      setReportTaskId(id)
      setReportText('')
      const task = pendingTasks.find(t => t.id === id)
      if (task?.task_type === 'Tái ký HĐ') {
        const client = task.client_id ? clients.find(c => c.id === task.client_id) : null
        setNewContractEnd(client?.contract_end || '')
      }
      const { error } = await supabase.from('work_tasks').update({ doc_status: docStatus }).eq('id', id)
      if (error) { console.error('doc_status update error:', error); return }
      setPendingTasks(prev => prev.map(t => t.id === id ? { ...t, doc_status: docStatus } : t))
      return
    }
    if (docStatus === 'ngung_hd') {
      const { error } = await supabase.from('work_tasks').update({ doc_status: docStatus, status: 'ngung_hd' as TaskStatus }).eq('id', id)
      if (error) { console.error('doc_status update error:', error); return }
      setPendingTasks(prev => prev.filter(t => t.id !== id))
      return
    }
    const { error } = await supabase.from('work_tasks').update({ doc_status: docStatus, status: 'in_progress' }).eq('id', id)
    if (error) { console.error('doc_status update error:', error); return }
    setPendingTasks(prev => prev.map(t => t.id === id ? { ...t, doc_status: docStatus, status: 'in_progress' } : t))
  }

  function handleStatusChange(id: string, status: TaskStatus) {
    if (status === 'done') {
      const task = pendingTasks.find(t => t.id === id)
      setReportTaskId(id)
      setReportText('')
      if (task?.task_type === 'Tái ký HĐ') {
        const client = task.client_id ? clients.find(c => c.id === task.client_id) : null
        setNewContractEnd(client?.contract_end || '')
      } else {
        setNewContractEnd('')
      }
      return
    }
    updateTaskStatus(id, status)
  }

  function submitReport() {
    if (!reportTaskId) return
    const task = pendingTasks.find(t => t.id === reportTaskId)
    if (task?.task_type === 'Tái ký HĐ' && !newContractEnd) {
      alert('Vui lòng nhập hạn hợp đồng mới')
      return
    }
    updateTaskStatus(reportTaskId, 'done', reportText, task?.task_type === 'Tái ký HĐ' ? newContractEnd : undefined)
    setReportTaskId(null)
    setReportText('')
    setNewContractEnd('')
  }

  async function updateTaskStatus(id: string, status: WorkTask['status'], note?: string, newContractEndDate?: string) {
    const patch: Partial<WorkTask> = { status, updated_at: new Date().toISOString() }
    if (status === 'done') {
      patch.completed_at = new Date().toISOString()
      if (note?.trim()) patch.notes = note.trim()
    }
    const task = pendingTasks.find(t => t.id === id)
    if (status === 'done') {
      setPendingTasks(prev => {
        const t = prev.find(x => x.id === id)
        if (t) setDoneTasks(d => [{ ...t, ...patch } as WorkTask, ...d])
        return prev.filter(x => x.id !== id)
      })
      onTaskDone?.(id)
    } else {
      setPendingTasks(prev => prev.map(t => t.id === id ? { ...t, ...patch } as WorkTask : t))
    }
    await supabase.from('work_tasks').update(patch).eq('id', id)

    if (status === 'done' && newContractEndDate && task?.client_id) {
      await supabase.from('clients').update({ contract_end: newContractEndDate }).eq('id', task.client_id)
      const client = clients.find(c => c.id === task.client_id)
      if (client) onClientUpdate({ ...client, contract_end: newContractEndDate })
    }
  }

  async function undoTask(id: string) {
    const patch: Partial<WorkTask> = { status: 'pending', completed_at: null, updated_at: new Date().toISOString() }
    setDoneTasks(prev => {
      const task = prev.find(t => t.id === id)
      if (task) setPendingTasks(p => [{ ...task, ...patch } as WorkTask, ...p])
      return prev.filter(t => t.id !== id)
    })
    await supabase.from('work_tasks').update(patch).eq('id', id)
  }

  async function deleteTask(id: string) {
    setPendingTasks(prev => prev.filter(t => t.id !== id))
    await supabase.from('work_tasks').delete().eq('id', id)
  }

  async function submitComment(taskId: string) {
    const content = (commentInput[taskId] ?? '').trim()
    if (!content || !user) return
    setSubmittingComment(taskId)
    const userName = (user as any).name || (user as any).email || 'Người dùng'
    const { data, error } = await supabase.from('work_task_comments').insert({ task_id: taskId, user_id: user.id, user_name: userName, content }).select().single()
    if (!error && data) {
      setTaskComments(prev => ({ ...prev, [taskId]: [...(prev[taskId] ?? []), data as WorkTaskComment] }))
      setCommentInput(prev => ({ ...prev, [taskId]: '' }))
    }
    setSubmittingComment(null)
  }

  async function deleteComment(commentId: string, taskId: string) {
    setTaskComments(prev => ({ ...prev, [taskId]: (prev[taskId] ?? []).filter(c => c.id !== commentId) }))
    await supabase.from('work_task_comments').delete().eq('id', commentId)
  }

  async function saveCommentEdit(commentId: string, taskId: string) {
    const newContent = editingCommentContent.trim()
    if (!newContent) return
    setTaskComments(prev => ({
      ...prev,
      [taskId]: (prev[taskId] ?? []).map(c => c.id === commentId ? { ...c, content: newContent } : c),
    }))
    setEditingCommentId(null)
    await supabase.from('work_task_comments').update({ content: newContent }).eq('id', commentId)
  }

  const isAdmin = (user as any)?.role === 'admin'

  async function handleSuspendRequest() {
    if (!suspendRequestTask || !suspendRequestReason.trim() || !user) return
    setSubmittingSuspend(true)
    const userName = (user as any).full_name || (user as any).name || (user as any).username || 'Người dùng'
    const client = clients.find(c => c.id === suspendRequestTask.client_id)
    if (!client) { setSubmittingSuspend(false); return }

    if (isAdmin) {
      // Admin: ngưng thẳng
      const now = new Date().toISOString()
      await supabase.from('clients').update({ cooperation_status: 'suspended', suspension_reason: suspendRequestReason.trim(), suspended_at: now, updated_at: now }).eq('id', client.id)
      onClientUpdate({ ...client, cooperation_status: 'suspended', suspension_reason: suspendRequestReason.trim(), suspended_at: now })
    } else {
      // User thường: tạo yêu cầu chờ duyệt
      await supabase.from('cooperation_suspension_requests').insert({
        client_id: client.id,
        task_id: suspendRequestTask.id,
        requester_id: user.id,
        requester_name: userName,
        reason: suspendRequestReason.trim(),
        status: 'pending',
      })
    }
    setSuspendRequestTask(null)
    setSuspendRequestReason('')
    setSubmittingSuspend(false)
    alert(isAdmin ? `Đã ngưng hợp tác với "${client.name}"` : `Đã gửi yêu cầu ngưng HĐ với "${client.name}" — chờ Quản trị viên duyệt`)
  }

  // Lấy lần hỏi thăm gần nhất của từng chi nhánh (toàn công ty, không chỉ user hiện tại)
  useEffect(() => {
    if (!regions.length) return
    supabase
      .from('morning_priorities')
      .select('target_name, priority_date')
      .in('target_name', regions.map(r => `Chi nhánh ${r.name}`))
      .order('priority_date', { ascending: false })
      .then(({ data }) => {
        if (!data) return
        const today = todayStr()
        const map: Record<string, string> = {}
        for (const row of data) {
          if (!row.target_name || row.priority_date > today) continue
          if (!map[row.target_name] || row.priority_date > map[row.target_name]) map[row.target_name] = row.priority_date
        }
        setBranchActivity(map)
      })
  }, [regions])

  // Tasks for suspended clients hidden from "Công việc chưa hoàn thành"
  const suspendedClientIds = useMemo(
    () => new Set(clients.filter(c => c.cooperation_status === 'suspended').map(c => c.id)),
    [clients]
  )
  const visiblePendingTasks = useMemo(
    () => pendingTasks.filter(t => !t.client_id || !suspendedClientIds.has(t.client_id)),
    [pendingTasks, suspendedClientIds]
  )

  // --- Auto-suggest: HĐ cần xử lý (cột trái) ---
  const contractSuggests: ContractSuggest[] = clients
    .filter(c => c.client_type === 'active' && c.cooperation_status !== 'suspended')
    .filter(c => !pendingTasks.some(t => t.client_id === c.id && t.task_type === 'Tái ký HĐ'))
    .map(c => ({ client: c, daysLeft: daysUntil(c.contract_end) }))
    .filter((x): x is { client: Client; daysLeft: number } => x.daysLeft !== null && x.daysLeft <= 17)
    .sort((a, b) => a.daysLeft - b.daysLeft)
    .map(x => ({ ...x, kcn: x.client.industrial_zones?.[0] || '' }))

  // --- Auto-suggest: Chi nhánh cần hỏi thăm (cột phải) ---
  const visitSuggests: VisitSuggest[] = regions
    .map(r => {
      const last = branchActivity[`Chi nhánh ${r.name}`]
      const daysSince = last ? Math.floor((Date.now() - new Date(last).getTime()) / 86400000) : null
      return { branchName: r.name, daysSince }
    })
    .sort((a, b) => (b.daysSince ?? 9999) - (a.daysSince ?? 9999))

  function urgColor(daysLeft: number) {
    if (daysLeft <= 7) return 'bg-red-50 text-red-700 border-red-200'
    return 'bg-amber-50 text-amber-700 border-amber-200'
  }

  function visitColor(daysSince: number | null) {
    if (daysSince === null || daysSince > 2 * visitThreshold) return 'bg-red-50 text-red-700 border-red-200'
    if (daysSince > visitThreshold) return 'bg-amber-50 text-amber-700 border-amber-200'
    return 'bg-green-50 text-green-700 border-green-200'
  }

  function visitDotColor(daysSince: number | null) {
    if (daysSince === null || daysSince > 2 * visitThreshold) return 'bg-red-500'
    if (daysSince > visitThreshold) return 'bg-amber-400'
    return 'bg-green-500'
  }

  function toggleContractSelect(clientId: string) {
    setSelectedContractIds(prev => {
      const next = new Set(prev)
      if (next.has(clientId)) next.delete(clientId)
      else next.add(clientId)
      return next
    })
  }

  function openBranchProfile(branchName: string) {
    const branch = branches.find(b => b.region === branchName)
    if (!branch) {
      alert(`Chi nhánh "${branchName}" chưa có hồ sơ — vào trang Chi nhánh để tạo`)
      return
    }
    setOpenBranchPanel(branch)
    setPanelForm(branch)
    setPanelRecordDate(todayStr())
  }

  async function savePanelBranch() {
    if (!openBranchPanel || !user) return
    setPanelSaving(true)
    const fields = {
      status_note: panelForm.status_note ?? null,
      difficulties: panelForm.difficulties ?? null,
      opportunities: panelForm.opportunities ?? null,
    }
    try {
      await updateBranch(openBranchPanel.id, fields)
      if (openBranchPanel.region) {
        await recordBranchUpdateSession(user.id, openBranchPanel.region, fields, panelRecordDate)
        setBranchActivity(prev => ({ ...prev, [`Chi nhánh ${openBranchPanel.region}`]: panelRecordDate }))
      }
      setOpenBranchPanel(null)
      setPanelRecordDate(todayStr())
    } catch (e) {
      alert('Lỗi khi lưu: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setPanelSaving(false)
    }
  }

  async function saveSelectedTasks() {
    if (!user) return
    setSaving(true)
    const today_ = todayStr()
    const toInsert: Array<Record<string, unknown>> = []

    for (const s of contractSuggests) {
      if (!selectedContractIds.has(s.client.id)) continue
      if (pendingTasks.some(t => t.client_id === s.client.id && t.due_date === today_ && t.task_type === 'Tái ký HĐ')) continue
      toInsert.push({
        user_id: user.id,
        client_id: s.client.id,
        title: `Tái ký HĐ — ${s.client.name}`,
        task_type: 'Tái ký HĐ',
        due_date: today_,
        priority: s.daysLeft <= 0 ? 'high' : 'medium',
        kcn: s.kcn || null,
        status: 'in_progress',
        doc_status: 'dang_soan',
      })
    }

    if (toInsert.length > 0) {
      const { data: inserted } = await supabase.from('work_tasks').insert(toInsert).select()
      if (inserted) setPendingTasks(prev => [...(inserted as WorkTask[]), ...prev])
    }

    setSelectedContractIds(new Set())
    setSaving(false)
  }

  const selectedCount = selectedContractIds.size

  // Danh sách KH chưa có trong contractSuggests và chưa có task tái ký đang pending
  const manualCandidates = clients.filter(c =>
    c.client_type === 'active' &&
    c.cooperation_status !== 'suspended' &&
    !contractSuggests.some(s => s.client.id === c.id) &&
    !pendingTasks.some(t => t.client_id === c.id && t.task_type === 'Tái ký HĐ')
  )

  const filteredManualCandidates = manualSearch.trim()
    ? manualCandidates.filter(c => c.name.toLowerCase().includes(manualSearch.toLowerCase()))
    : manualCandidates

  async function addManualRenewalTask(client: Client) {
    if (!user || addingManual) return
    setAddingManual(true)
    const today_ = todayStr()
    const { data, error } = await supabase.from('work_tasks').insert({
      user_id: user.id,
      client_id: client.id,
      title: `Tái ký HĐ — ${client.name}`,
      task_type: 'Tái ký HĐ',
      due_date: today_,
      priority: 'medium',
      kcn: client.industrial_zones?.[0] || null,
      status: 'in_progress',
      doc_status: 'dang_soan',
    }).select().single()
    setAddingManual(false)
    if (!error && data) {
      setPendingTasks(prev => [data as WorkTask, ...prev])
      setShowManualAdd(false)
      setManualSearch('')
    }
  }

  return (
    <>
    <div className="flex flex-col gap-0">

      {/* Sáng – gợi ý */}
      <div className="p-3 border-b border-[#E8E7E2]">
        <div className="flex items-center gap-1.5 mb-2.5">
          <Sun size={13} className="text-yellow-500" />
          <span className="text-[11px] font-medium text-[#333]">
            Ưu tiên hôm nay — {new Date().toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit' })}
          </span>
        </div>

        {/* Auto-suggest 3 cột */}
        {(contractSuggests.length > 0 || visitSuggests.length > 0 || pendingTasks.length > 0) && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-1">
            {/* Cột trái: HĐ cần xử lý */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-1 text-[10px] font-medium text-[#888] uppercase tracking-wide">
                  <FileWarning size={12} />
                  HĐ cần xử lý
                </div>
                <button
                  onClick={() => { setShowManualAdd(v => !v); setManualSearch('') }}
                  className="text-[10px] px-2 py-0.5 rounded-md border border-blue-300 text-blue-600 bg-blue-50 hover:bg-blue-100 transition"
                >
                  + Thêm thủ công
                </button>
              </div>

              {/* Inline search để thêm thủ công */}
              {showManualAdd && (
                <div className="mb-2 border border-blue-200 rounded-lg bg-blue-50 p-2">
                  <input
                    autoFocus
                    placeholder="Tìm công ty..."
                    value={manualSearch}
                    onChange={e => setManualSearch(e.target.value)}
                    className="w-full text-[11.5px] px-2.5 py-1.5 rounded-md border border-[#E8E7E2] bg-white focus:outline-none focus:border-blue-400 mb-1.5"
                  />
                  <div className="flex flex-col gap-0.5 max-h-40 overflow-y-auto">
                    {filteredManualCandidates.length === 0 ? (
                      <div className="text-[11px] text-[#bbb] text-center py-2">Không tìm thấy</div>
                    ) : filteredManualCandidates.map(c => (
                      <button
                        key={c.id}
                        onClick={() => addManualRenewalTask(c)}
                        disabled={addingManual}
                        className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-white border border-[#E8E7E2] hover:border-blue-300 hover:bg-blue-50 transition text-left"
                      >
                        <span className="w-2 h-2 rounded-full bg-blue-400 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <div className="text-[11.5px] font-medium text-[#111] truncate">{c.name}</div>
                          {c.region && <div className="text-[10px] text-[#888]">CN {c.region}</div>}
                        </div>
                        {c.contract_end && (
                          <span className="text-[10px] text-[#aaa] shrink-0">
                            {Math.ceil((new Date(c.contract_end).getTime() - Date.now()) / 86400000)} ngày
                          </span>
                        )}
                        <ArrowRight size={12} className="text-[#bbb] shrink-0" />
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex flex-col gap-1 max-h-64 overflow-y-auto pr-0.5">
                {contractSuggests.length === 0 && !showManualAdd && (
                  <div className="text-[11px] text-[#bbb] py-3 text-center border border-dashed border-[#E8E7E2] rounded-lg">Không có HĐ gần hết hạn</div>
                )}
                {contractSuggests.map(s => {
                  const isSel = selectedContractIds.has(s.client.id)
                  return (
                    <div
                      key={s.client.id}
                      onClick={() => toggleContractSelect(s.client.id)}
                      className={`flex items-center gap-2 px-2.5 py-1.5 border rounded-lg cursor-pointer transition-colors ${isSel ? 'border-blue-300 bg-blue-50' : 'border-[#E8E7E2] bg-[#fafafa] hover:border-blue-200 hover:bg-blue-50'}`}
                    >
                      <input
                        type="checkbox"
                        checked={isSel}
                        onClick={e => e.stopPropagation()}
                        onChange={() => toggleContractSelect(s.client.id)}
                        className="shrink-0 accent-blue-600"
                      />
                      <span className={`w-2 h-2 rounded-full shrink-0 ${s.daysLeft <= 0 ? 'bg-red-500' : s.daysLeft <= 7 ? 'bg-red-400' : 'bg-amber-400'}`} />
                      <div className="min-w-0 flex-1">
                        <div className="text-[11.5px] font-medium text-[#111] truncate">{s.client.name}</div>
                        {(s.client.region || s.kcn) && (
                          <div className="text-[10px] text-[#888] mt-0.5 flex items-center gap-1">
                            <MapPin size={10} />
                            {s.client.region ? `CN ${s.client.region}` : s.kcn}
                          </div>
                        )}
                      </div>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full border whitespace-nowrap ${urgColor(s.daysLeft)}`}>
                        {s.daysLeft <= 0 ? 'HĐ đã hết hạn' : `Còn ${s.daysLeft} ngày`}
                      </span>
                      {isSel ? <Check size={13} className="text-blue-500 shrink-0" /> : <ArrowRight size={13} className="text-[#bbb] shrink-0" />}
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Cột giữa: Công việc chưa hoàn thành */}
            <div>
              <div className="flex items-center gap-1 text-[10px] font-medium text-[#888] uppercase tracking-wide mb-1.5">
                <ListTodo size={12} />
                Công việc chưa hoàn thành
              </div>
              {visiblePendingTasks.length === 0 ? (
                <div className="text-[11px] text-[#bbb] py-3 text-center border border-dashed border-[#E8E7E2] rounded-lg">Không có việc nào</div>
              ) : (
                <div className="flex flex-col gap-1 max-h-64 overflow-y-auto pr-0.5">
                  {visiblePendingTasks.map(t => {
                    const overdue = daysUntil(t.due_date) !== null && (daysUntil(t.due_date) as number) < 0
                    return (
                      <div key={t.id} className="flex flex-col gap-1.5 px-2.5 py-1.5 border border-[#E8E7E2] bg-[#fafafa] rounded-lg">
                        <div className="flex items-center gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="text-[11.5px] font-medium text-[#111] truncate">{t.title}</div>
                            <div className={`text-[10px] mt-0.5 ${overdue ? 'text-red-500' : 'text-[#888]'}`}>{formatDate(t.due_date)}{t.kcn ? ` · ${t.kcn}` : ''}</div>
                          </div>
                          <span className={`text-[10px] px-2 py-0.5 rounded-full border whitespace-nowrap ${TASK_PRIORITY_COLORS[t.priority]}`}>
                            {TASK_PRIORITY_LABELS[t.priority]}
                          </span>
                          {t.task_type !== 'Tái ký HĐ' && (
                            <select
                              value={t.status}
                              onChange={e => handleStatusChange(t.id, e.target.value as TaskStatus)}
                              className={`text-[10px] border rounded-md px-1.5 py-1 focus:outline-none shrink-0 font-medium ${TASK_STATUS_COLORS[t.status] ?? 'bg-slate-100 text-slate-600 border-slate-300'}`}
                            >
                              {(['pending', 'in_progress', 'done', 'ngung_hd'] as TaskStatus[]).map(s => (
                                <option key={s} value={s}>{TASK_STATUS_LABELS[s]}</option>
                              ))}
                            </select>
                          )}
                          <button
                            onClick={() => { if (confirm('Xoá công việc này? Client sẽ hiện lại ở "HĐ cần xử lý".')) deleteTask(t.id) }}
                            title="Xoá việc"
                            className="p-1 rounded hover:bg-red-50 text-[#ccc] hover:text-red-500 transition shrink-0"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                        {/* Doc status dropdown for Tái ký HĐ */}
                        {t.task_type === 'Tái ký HĐ' && (
                          <DocStatusDropdown
                            taskId={t.id}
                            docStatus={(t.doc_status as DocStatus | null) ?? null}
                            onSelect={(taskId, step) => {
                              if (step.key === 'ngung_hd') {
                                setSuspendRequestTask(t)
                                setSuspendRequestReason('')
                              } else {
                                handleDocStatusChange(taskId, step.key)
                              }
                            }}
                          />
                        )}
                        {/* Comment thread */}
                        <div className="border border-[#E8E7E2] rounded-lg bg-white overflow-hidden">
                          {(taskComments[t.id] ?? []).length > 0 && (
                            <div className="flex flex-col divide-y divide-[#F0EEE9] max-h-36 overflow-y-auto">
                              {(taskComments[t.id] ?? []).map(cm => (
                                <div key={cm.id} className="px-2.5 py-1.5 group">
                                  <div className="flex items-center gap-1.5 mb-0.5">
                                    <span className="text-[10.5px] font-semibold text-[#1D4ED8]">{cm.user_name}</span>
                                    <span className="text-[10px] text-[#bbb]">{new Date(cm.created_at).toLocaleString('vi-VN', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })}</span>
                                    <div className="ml-auto flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                      <button
                                        onClick={() => { setEditingCommentId(cm.id); setEditingCommentContent(cm.content) }}
                                        className="p-0.5 rounded hover:bg-blue-50 text-[#ccc] hover:text-blue-500 transition"
                                      ><Pencil size={10} /></button>
                                      <button
                                        onClick={() => { if (confirm('Xoá bình luận này?')) deleteComment(cm.id, t.id); }}
                                        className="p-0.5 rounded hover:bg-red-50 text-[#ccc] hover:text-red-500 transition"
                                      ><Trash2 size={10} /></button>
                                    </div>
                                  </div>
                                  {editingCommentId === cm.id ? (
                                    <div className="flex gap-1 mt-1">
                                      <input
                                        autoFocus
                                        value={editingCommentContent}
                                        onChange={e => setEditingCommentContent(e.target.value)}
                                        onKeyDown={e => { if (e.key === 'Enter') saveCommentEdit(cm.id, t.id); if (e.key === 'Escape') setEditingCommentId(null) }}
                                        className="flex-1 text-[11px] px-2 py-0.5 border border-blue-300 rounded focus:outline-none"
                                      />
                                      <button onClick={() => saveCommentEdit(cm.id, t.id)} className="text-[10px] px-1.5 py-0.5 bg-blue-600 text-white rounded hover:bg-blue-700"><Check size={10} /></button>
                                      <button onClick={() => setEditingCommentId(null)} className="text-[10px] px-1.5 py-0.5 border border-[#E8E7E2] rounded text-[#666] hover:bg-gray-50"><X size={10} /></button>
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
                              type="text"
                              value={commentInput[t.id] ?? ''}
                              onChange={e => setCommentInput(prev => ({ ...prev, [t.id]: e.target.value }))}
                              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitComment(t.id) } }}
                              placeholder="Bình luận tình trạng HĐ..."
                              className="flex-1 text-[11px] px-2 py-1 rounded-md border border-[#E8E7E2] focus:outline-none focus:border-blue-400 bg-[#fafafa] placeholder:text-[#ccc]"
                            />
                            <button
                              onClick={() => submitComment(t.id)}
                              disabled={submittingComment === t.id || !(commentInput[t.id] ?? '').trim()}
                              className="text-[11px] px-2.5 py-1 rounded-md bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-40 shrink-0"
                            >Gửi</button>
                          </div>
                        </div>
                        {reportTaskId === t.id && (
                          <div className="flex flex-col gap-1.5 pl-1">
                            {t.task_type === 'Tái ký HĐ' && (
                              <div>
                                <label className="text-[10px] font-medium text-[#888] uppercase tracking-wide mb-1 block">Hạn hợp đồng mới</label>
                                <input
                                  type="date"
                                  value={newContractEnd}
                                  onChange={e => setNewContractEnd(e.target.value)}
                                  className="text-[11.5px] border border-[#E8E7E2] rounded-md px-2 py-1.5 bg-white text-[#333] focus:outline-none focus:border-blue-400 w-full"
                                />
                              </div>
                            )}
                            <textarea
                              rows={2}
                              autoFocus
                              className="text-[11.5px] border border-[#E8E7E2] rounded-md px-2 py-1.5 bg-white text-[#333] placeholder:text-[#bbb] focus:outline-none focus:border-blue-400 resize-none"
                              placeholder="Báo cáo nội dung đã hoàn thành..."
                              value={reportText}
                              onChange={e => setReportText(e.target.value)}
                            />
                            <div className="flex justify-end gap-1.5">
                              <button onClick={() => { setReportTaskId(null); setNewContractEnd('') }} className="text-[11px] px-2.5 py-1 rounded-md border border-[#E8E7E2] text-[#666] hover:bg-[#f4f4f1]">Huỷ</button>
                              <button onClick={submitReport} className="text-[11px] px-2.5 py-1 rounded-md bg-blue-600 text-white font-medium hover:bg-blue-700">Lưu</button>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Cột phải: Chi nhánh cần hỏi thăm */}
            {visitSuggests.length > 0 && (
              <div>
                <div className="flex items-center gap-1 text-[10px] font-medium text-[#888] uppercase tracking-wide mb-1.5">
                  <Phone size={12} />
                  Cập nhật thông tin CN
                  <span className="text-[9px] text-[#bbb] font-normal normal-case ml-0.5">— gọi điện / cập nhật tình hình</span>
                  <div className="relative ml-auto">
                    <button
                      onClick={() => setShowThresholdSettings(v => !v)}
                      title="Cài đặt ngưỡng cảnh báo"
                      className="text-[#bbb] hover:text-blue-600 transition-colors"
                    >
                      <Settings size={12} />
                    </button>
                    {showThresholdSettings && (
                      <div className="absolute right-0 top-full mt-1 z-10 bg-white border border-[#E8E7E2] rounded-lg shadow-lg p-2.5 w-52 normal-case">
                        <label className="text-[10px] font-medium text-[#888] uppercase tracking-wide mb-1 block">Ngưỡng (số ngày)</label>
                        <input
                          type="number"
                          min={1}
                          value={visitThreshold}
                          onChange={e => setVisitThreshold(Math.max(1, Number(e.target.value) || 1))}
                          className="text-[11.5px] border border-[#E8E7E2] rounded-md px-2 py-1 bg-white text-[#333] focus:outline-none focus:border-blue-400 w-full"
                        />
                        <div className="text-[10px] text-[#aaa] mt-1.5 leading-relaxed">
                          ≤ {visitThreshold} ngày: xanh · {visitThreshold}-{2 * visitThreshold} ngày: cam · &gt;{2 * visitThreshold} ngày: đỏ
                        </div>
                        <button onClick={() => setShowThresholdSettings(false)} className="mt-1.5 text-[11px] px-2.5 py-1 rounded-md bg-blue-600 text-white font-medium hover:bg-blue-700 w-full">Đóng</button>
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex flex-col gap-1 max-h-64 overflow-y-auto pr-0.5">
                  {visitSuggests.map(s => (
                    <div
                      key={s.branchName}
                      onClick={() => openBranchProfile(s.branchName)}
                      className="flex items-center gap-2 px-2.5 py-1.5 border border-[#E8E7E2] bg-[#fafafa] rounded-lg cursor-pointer transition-colors hover:border-blue-200 hover:bg-blue-50"
                    >
                      <span className={`w-2 h-2 rounded-full shrink-0 ${visitDotColor(s.daysSince)}`} />
                      <div className="min-w-0 flex-1">
                        <div className="text-[11.5px] font-medium text-[#111] truncate">Chi nhánh {s.branchName}</div>
                        <div className="text-[10px] text-[#888] mt-0.5 flex items-center gap-1">
                          <Phone size={10} />
                          Gọi điện / nhắn tin hỏi thăm
                        </div>
                      </div>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full border whitespace-nowrap ${visitColor(s.daysSince)}`}>
                        {s.daysSince === null ? 'Chưa liên hệ' : `${s.daysSince} ngày chưa LH`}
                      </span>
                      <ChevronRight size={13} className="text-[#bbb] shrink-0" />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Lưu lựa chọn vào Công việc sắp tới */}
        {selectedCount > 0 && (
          <div className="flex items-center justify-between mt-2 px-2.5 py-2 bg-blue-50 border border-blue-200 rounded-lg">
            <span className="text-[11.5px] text-blue-700">Đã chọn {selectedCount} việc</span>
            <button
              onClick={saveSelectedTasks}
              disabled={saving}
              className="text-[12px] px-3 py-1.5 rounded-md bg-blue-600 text-white font-medium disabled:opacity-40 hover:bg-blue-700 transition-colors"
            >
              {saving ? '...' : 'Lưu vào Công việc sắp tới'}
            </button>
          </div>
        )}
      </div>

      {/* Panel cập nhật hồ sơ chi nhánh */}
      {openBranchPanel && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-end z-50" onClick={() => setOpenBranchPanel(null)}>
          <div className="bg-white h-full w-full max-w-md shadow-2xl overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="sticky top-0 bg-white border-b border-[#E8E7E2] px-4 py-3 flex items-center gap-2 z-10">
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-semibold text-[#111] truncate">Chi nhánh {openBranchPanel.region || openBranchPanel.name}</div>
                <div className="text-[11px] text-[#888] mt-0.5">
                  {openBranchPanel.manager_name && `Quản lý: ${openBranchPanel.manager_name}`}
                  {openBranchPanel.phone && ` · ${openBranchPanel.phone}`}
                </div>
              </div>
              <button onClick={() => setOpenBranchPanel(null)} className="text-[#999] hover:text-[#333] transition-colors shrink-0">
                <X size={18} />
              </button>
            </div>
            <div className="p-4">
              <BranchHistoryFields branch={panelForm as Branch} onChange={fields => setPanelForm(prev => ({ ...prev, ...fields }))} recordDate={panelRecordDate} onRecordDateChange={setPanelRecordDate} />
              <button
                onClick={savePanelBranch}
                disabled={panelSaving}
                className="mt-3 w-full text-[12px] px-3 py-2 rounded-md bg-blue-600 text-white font-medium disabled:opacity-40 hover:bg-blue-700 transition-colors"
              >
                {panelSaving ? 'Đang lưu...' : 'Lưu'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    {/* Modal yêu cầu ngưng HĐ */}

    {suspendRequestTask && (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setSuspendRequestTask(null)}>
        <div className="bg-white rounded-xl shadow-xl max-w-sm w-full" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
            <div>
              <h2 className="text-base font-semibold text-gray-900">
                {isAdmin ? 'Ngưng hợp tác' : 'Yêu cầu ngưng hợp tác'}
              </h2>
              <p className="text-xs text-gray-500 mt-0.5">
                {clients.find(c => c.id === suspendRequestTask.client_id)?.name ?? suspendRequestTask.title}
              </p>
            </div>
            <button onClick={() => setSuspendRequestTask(null)} className="p-1 hover:bg-gray-100 rounded-md text-gray-500 text-lg leading-none">×</button>
          </div>
          <div className="p-5 space-y-3">
            {!isAdmin && (
              <p className="text-[12.5px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                Yêu cầu sẽ được gửi đến <strong>Quản trị viên</strong> để xét duyệt trước khi có hiệu lực.
              </p>
            )}
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Lý do ngưng <span className="text-red-500">*</span></label>
              <textarea
                rows={3}
                value={suspendRequestReason}
                onChange={e => setSuspendRequestReason(e.target.value)}
                autoFocus
                placeholder="Nhập lý do ngưng hợp tác..."
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-400 resize-none"
              />
            </div>
          </div>
          <div className="px-5 pb-5 flex gap-2">
            <button onClick={() => setSuspendRequestTask(null)} className="flex-1 px-3 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition">Hủy</button>
            <button
              onClick={handleSuspendRequest}
              disabled={submittingSuspend || !suspendRequestReason.trim()}
              className="flex-1 px-3 py-2 text-sm font-medium text-white bg-orange-500 hover:bg-orange-600 disabled:opacity-50 rounded-lg transition"
            >
              {submittingSuspend ? 'Đang gửi...' : isAdmin ? 'Xác nhận ngưng' : 'Gửi yêu cầu'}
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  )
}
