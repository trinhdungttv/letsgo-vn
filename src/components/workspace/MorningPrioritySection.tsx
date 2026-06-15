// src/components/workspace/MorningPrioritySection.tsx
import { useState, useEffect } from 'react'
import { Sun, FileWarning, Phone, MapPin, ArrowRight, Check, ListTodo, ChevronDown, ChevronUp, ChevronRight, Undo2, Settings, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { useRegions } from '../../hooks/useRegions'
import { useBranchData } from '../../hooks/useBranchData'
import { usePersistedState } from '../../hooks/usePersistedState'
import type { Client, WorkTask, TaskStatus, Branch } from '../../lib/types'
import { TASK_PRIORITY_LABELS, TASK_PRIORITY_COLORS, TASK_STATUS_LABELS } from '../../lib/types'
import { formatDate, daysUntil } from '../../lib/format'
import { WorkTasksCard } from './WorkTasksCard'
import { BranchHistoryFields, recordBranchUpdateSession } from './BranchHistoryFields'

interface Props {
  clients: Client[]
  onClientUpdate: (client: Client) => void
}

function todayStr() {
  return new Date().toISOString().split('T')[0]
}

interface ContractSuggest { client: Client; daysLeft: number; kcn: string }
interface VisitSuggest { branchName: string; daysSince: number | null }

export function MorningPrioritySection({ clients, onClientUpdate }: Props) {
  const { user } = useAuth()
  const { regions } = useRegions()
  const { branches, updateBranch } = useBranchData()
  const [saving, setSaving] = useState(false)
  const [branchActivity, setBranchActivity] = useState<Record<string, string>>({})

  const [selectedContractIds, setSelectedContractIds] = useState<Set<string>>(new Set())
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

  useEffect(() => { loadPendingTasks(); loadDoneTasks() }, [user])

  async function loadPendingTasks() {
    if (!user) return
    const { data } = await supabase
      .from('work_tasks')
      .select('*')
      .eq('user_id', user.id)
      .neq('status', 'done')
      .order('due_date', { ascending: true })
    if (data) setPendingTasks(data as WorkTask[])
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

  // --- Auto-suggest: HĐ cần xử lý (cột trái) ---
  const contractSuggests: ContractSuggest[] = clients
    .filter(c => c.client_type === 'active')
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
        status: 'pending',
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

  return (
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
            {contractSuggests.length > 0 && (
              <div>
                <div className="flex items-center gap-1 text-[10px] font-medium text-[#888] uppercase tracking-wide mb-1.5">
                  <FileWarning size={12} />
                  HĐ cần xử lý
                </div>
                <div className="flex flex-col gap-1 max-h-64 overflow-y-auto pr-0.5">
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
            )}

            {/* Cột giữa: Công việc chưa hoàn thành */}
            <div>
              <div className="flex items-center gap-1 text-[10px] font-medium text-[#888] uppercase tracking-wide mb-1.5">
                <ListTodo size={12} />
                Công việc chưa hoàn thành
              </div>
              {pendingTasks.length === 0 ? (
                <div className="text-[11px] text-[#bbb] py-3 text-center border border-dashed border-[#E8E7E2] rounded-lg">Không có việc nào</div>
              ) : (
                <div className="flex flex-col gap-1 max-h-64 overflow-y-auto pr-0.5">
                  {pendingTasks.map(t => {
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
                          <select
                            value={t.status}
                            onChange={e => handleStatusChange(t.id, e.target.value as TaskStatus)}
                            className="text-[10px] border border-[#E8E7E2] rounded-md px-1.5 py-1 bg-white text-[#555] focus:outline-none focus:border-blue-400 shrink-0"
                          >
                            {(['pending', 'in_progress', 'done'] as TaskStatus[]).map(s => (
                              <option key={s} value={s}>{TASK_STATUS_LABELS[s]}</option>
                            ))}
                          </select>
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

      {/* Công việc sắp tới */}
      <div className="p-3 border-b border-[#E8E7E2]">
        <WorkTasksCard clients={clients} tasks={pendingTasks} onTaskCreated={handleTaskCreated} onStatusChange={handleStatusChange} onDelete={deleteTask} />
      </div>

      {/* Lịch sử công việc đã hoàn thành (1 tháng gần đây) */}
      <div className="p-3">
        <button
          onClick={() => setShowDoneHistory(v => !v)}
          className="w-full flex items-center justify-between text-[11.5px] font-medium text-[#333] hover:text-blue-600 transition-colors"
        >
          <span className="flex items-center gap-1.5">
            <ListTodo size={13} className="text-[#888]" />
            Lịch sử công việc hoàn thành (1 tháng gần đây)
            {doneTasks.length > 0 && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                {doneTasks.length}
              </span>
            )}
          </span>
          {showDoneHistory ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>

        {showDoneHistory && (
          <div className="mt-2 flex flex-col gap-1.5">
            {doneTasks.length === 0 ? (
              <div className="text-[11px] text-[#bbb] py-3 text-center border border-dashed border-[#E8E7E2] rounded-lg">Chưa có công việc nào hoàn thành</div>
            ) : (
              doneTasks.map(t => (
                <div key={t.id} className="flex items-start gap-2 px-2.5 py-2 border border-[#E8E7E2] bg-[#fafafa] rounded-lg">
                  <div className="min-w-0 flex-1">
                    <div className="text-[11.5px] font-medium text-[#111] truncate">{t.title}</div>
                    <div className="text-[10px] text-[#888] mt-0.5">
                      Hoàn thành {t.completed_at ? formatDate(t.completed_at.split('T')[0]) : ''}
                      {t.kcn ? ` · ${t.kcn}` : ''}
                    </div>
                    {t.notes && (
                      <div className="text-[11px] text-[#666] mt-1 bg-white border border-[#F0EFEB] rounded-md px-2 py-1">
                        {t.notes}
                      </div>
                    )}
                  </div>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full border whitespace-nowrap shrink-0 ${TASK_PRIORITY_COLORS[t.priority]}`}>
                    {TASK_PRIORITY_LABELS[t.priority]}
                  </span>
                  <button
                    onClick={() => undoTask(t.id)}
                    title="Hoàn tác"
                    className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-md border border-[#E8E7E2] text-[#666] hover:bg-white hover:text-blue-600 hover:border-blue-300 transition-colors shrink-0"
                  >
                    <Undo2 size={11} /> Hoàn tác
                  </button>
                </div>
              ))
            )}
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
  )
}
