// src/components/workspace/WorkTasksCard.tsx
import { useState } from 'react'
import { CalendarClock, ChevronDown, ChevronUp, Plus, MoreHorizontal, CheckCircle2, Trash2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { useRegions } from '../../hooks/useRegions'
import type { Client, WorkTask, TaskPriority, TaskStatus } from '../../lib/types'
import { TASK_PRIORITY_LABELS, TASK_PRIORITY_COLORS, TASK_TYPE_OPTIONS } from '../../lib/types'

interface Props {
  clients: Client[]
  tasks: WorkTask[]
  onTaskCreated: (task: WorkTask) => void
  onStatusChange: (id: string, status: TaskStatus) => void
  onDelete: (id: string) => void
}

function todayStr() {
  return new Date().toISOString().split('T')[0]
}

function dueLabel(dateStr: string) {
  const d = new Date(dateStr)
  const weekday = d.toLocaleDateString('vi-VN', { weekday: 'long' })
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)} · ${dd}/${mm}`
}

export function WorkTasksCard({ clients, tasks, onTaskCreated, onStatusChange, onDelete }: Props) {
  const { user } = useAuth()
  const { regions } = useRegions()
  const [collapsed, setCollapsed] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)

  // Form state
  const [targetClientId, setTargetClientId] = useState('')
  const [desc, setDesc] = useState('')
  const [taskType, setTaskType] = useState(TASK_TYPE_OPTIONS[0])
  const [dueDate, setDueDate] = useState(todayStr())
  const [priority, setPriority] = useState<TaskPriority>('medium')
  const [kcn, setKcn] = useState('')
  const [notes, setNotes] = useState('')

  function handleClientSelect(id: string) {
    setTargetClientId(id)
    const c = clients.find(cl => cl.id === id)
    if (c?.industrial_zones?.[0]) setKcn(c.industrial_zones[0])
  }

  function resetForm() {
    setTargetClientId('')
    setDesc('')
    setTaskType(TASK_TYPE_OPTIONS[0])
    setDueDate(todayStr())
    setPriority('medium')
    setKcn('')
    setNotes('')
  }

  async function saveTask() {
    if (!user || !desc.trim()) return
    const selectedClient = clients.find(c => c.id === targetClientId) || null
    const title = selectedClient ? `${selectedClient.name} — ${desc.trim()}` : desc.trim()
    const payload = {
      user_id: user.id,
      client_id: selectedClient?.id || null,
      title,
      task_type: taskType,
      due_date: dueDate,
      priority,
      kcn: kcn || null,
      notes: notes.trim() || null,
      status: 'pending' as const,
    }
    const { data } = await supabase.from('work_tasks').insert(payload).select().single()
    if (data) onTaskCreated(data as WorkTask)
    resetForm()
    setShowForm(false)
  }

  function handleComplete(id: string) {
    onStatusChange(id, 'done')
    setOpenMenuId(null)
  }

  function handleDelete(id: string) {
    if (!confirm('Xoá công việc này?')) return
    onDelete(id)
    setOpenMenuId(null)
  }

  const pendingCount = tasks.filter(t => t.status !== 'done' && t.due_date >= todayStr()).length
  const visibleTasks = tasks.filter(t => t.status !== 'done')

  return (
    <div className="bg-white border border-[#E8E7E2] rounded-[10px] overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#E8E7E2] bg-[#F9F9F7]">
        <div className="flex items-center gap-2 text-[12.5px] font-semibold text-[#333]">
          <CalendarClock size={14} className="text-[#888]" />
          Công việc sắp tới
          {pendingCount > 0 && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
              {pendingCount} đã lên kế hoạch
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowForm(v => !v)}
            className="inline-flex items-center gap-1 text-[11.5px] px-2.5 py-1 rounded-md bg-blue-600 text-white font-medium hover:bg-blue-700 transition-colors"
          >
            <Plus size={12} /> Thêm việc
          </button>
          <button onClick={() => setCollapsed(v => !v)} className="text-[#999] hover:text-[#555]">
            {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="p-3 flex flex-col gap-2">
          <div className="text-[11px] text-[#888] bg-[#F9F9F7] border border-[#F0EFEB] rounded-md px-2.5 py-1.5">
            Ghi trước các việc cần làm để hệ thống gợi ý vào đúng ngày
          </div>

          {showForm && (
            <div className="border border-[#E8E7E2] rounded-lg p-3 flex flex-col gap-2 bg-[#fafafa]">
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="text-[10px] font-medium text-[#888] uppercase tracking-wide mb-1 block">Tên công việc</label>
                  <input
                    className="w-full text-[12px] border border-[#E8E7E2] rounded-md px-2.5 py-1.5 bg-white text-[#333] placeholder:text-[#bbb] focus:outline-none focus:border-blue-400"
                    placeholder="VD: đàm phán giá tái ký, soạn HĐ mới..."
                    value={desc}
                    onChange={e => setDesc(e.target.value)}
                  />
                </div>
                <div className="flex-1">
                  <label className="text-[10px] font-medium text-[#888] uppercase tracking-wide mb-1 block">Khách hàng</label>
                  <select
                    className="w-full text-[12px] border border-[#E8E7E2] rounded-md px-2.5 py-1.5 bg-white text-[#333] focus:outline-none focus:border-blue-400"
                    value={targetClientId}
                    onChange={e => handleClientSelect(e.target.value)}
                  >
                    <option value="">— Không chọn —</option>
                    {clients.filter(c => c.client_type === 'active').map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                    {regions.map(r => (
                      <option key={r.id} value="" disabled>Chi nhánh {r.name}</option>
                    ))}
                  </select>
                </div>
                <div className="w-32">
                  <label className="text-[10px] font-medium text-[#888] uppercase tracking-wide mb-1 block">Loại việc</label>
                  <select
                    className="w-full text-[12px] border border-[#E8E7E2] rounded-md px-2 py-1.5 bg-white text-[#555] focus:outline-none focus:border-blue-400"
                    value={taskType}
                    onChange={e => setTaskType(e.target.value)}
                  >
                    {TASK_TYPE_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
              </div>

              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="text-[10px] font-medium text-[#888] uppercase tracking-wide mb-1 block">Ngày dự kiến</label>
                  <input
                    type="date"
                    className="w-full text-[12px] border border-[#E8E7E2] rounded-md px-2.5 py-1.5 bg-white text-[#333] focus:outline-none focus:border-blue-400"
                    value={dueDate}
                    onChange={e => setDueDate(e.target.value)}
                  />
                </div>
                <div className="flex-1">
                  <label className="text-[10px] font-medium text-[#888] uppercase tracking-wide mb-1 block">Mức độ ưu tiên</label>
                  <div className="flex gap-1.5">
                    {(['high', 'medium', 'low'] as TaskPriority[]).map(p => (
                      <button
                        key={p}
                        onClick={() => setPriority(p)}
                        className={`flex-1 text-[11px] px-2.5 py-1.5 rounded-md border transition-all ${
                          priority === p ? TASK_PRIORITY_COLORS[p] + ' font-medium' : 'bg-white text-[#666] border-[#E8E7E2] hover:border-blue-300'
                        }`}
                      >
                        {TASK_PRIORITY_LABELS[p]}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex-1">
                  <label className="text-[10px] font-medium text-[#888] uppercase tracking-wide mb-1 block">KCN / Địa điểm</label>
                  <input
                    className="w-full text-[12px] border border-[#E8E7E2] rounded-md px-2.5 py-1.5 bg-white text-[#333] placeholder:text-[#bbb] focus:outline-none focus:border-blue-400"
                    placeholder="VSIP I, VP..."
                    value={kcn}
                    onChange={e => setKcn(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <label className="text-[10px] font-medium text-[#888] uppercase tracking-wide mb-1 block">Ghi chú / Chuẩn bị</label>
                <textarea
                  rows={2}
                  className="w-full text-[12px] border border-[#E8E7E2] rounded-md px-2.5 py-1.5 bg-white text-[#333] placeholder:text-[#bbb] focus:outline-none focus:border-blue-400 resize-none"
                  placeholder="Chuẩn bị tài liệu, thông tin cần lưu ý..."
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                />
              </div>

              <div className="flex justify-end gap-2">
                <button
                  onClick={() => { resetForm(); setShowForm(false) }}
                  className="text-[12px] px-3 py-1.5 rounded-md border border-[#E8E7E2] text-[#666] hover:bg-[#f4f4f1] transition-colors"
                >
                  Huỷ
                </button>
                <button
                  onClick={saveTask}
                  disabled={!desc.trim()}
                  className="text-[12px] px-3 py-1.5 rounded-md bg-blue-600 text-white font-medium disabled:opacity-40 hover:bg-blue-700 transition-colors"
                >
                  Lưu công việc
                </button>
              </div>
            </div>
          )}

          {visibleTasks.length === 0 ? (
            <div className="text-[11px] text-[#999] py-4 text-center">Chưa có công việc nào</div>
          ) : (
            <div className="flex flex-col divide-y divide-[#F0EFEB]">
              {visibleTasks.map(t => {
                const dotColor = t.priority === 'high' ? 'bg-red-500' : t.priority === 'medium' ? 'bg-amber-400' : 'bg-green-500'
                return (
                  <div key={t.id} className="flex items-center gap-2.5 py-2 relative">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${dotColor}`} />
                    <div className="min-w-0 flex-1">
                      <div className="text-[11.5px] font-medium text-[#111] truncate">{t.title}</div>
                      <div className="text-[10px] text-[#999] mt-0.5 flex items-center gap-1.5 flex-wrap">
                        <span>{dueLabel(t.due_date)}</span>
                        <span className={`px-1.5 py-0.5 rounded-full border ${TASK_PRIORITY_COLORS[t.priority]}`}>{TASK_PRIORITY_LABELS[t.priority]}</span>
                        {t.kcn && <span className="px-1.5 py-0.5 rounded-full border border-[#E8E7E2] bg-[#fafafa] text-[#888]">{t.kcn}</span>}
                        {t.task_type && <span className="px-1.5 py-0.5 rounded-full border border-[#E8E7E2] bg-[#fafafa] text-[#888]">{t.task_type}</span>}
                      </div>
                    </div>
                    <button onClick={() => setOpenMenuId(v => v === t.id ? null : t.id)} className="text-[#999] hover:text-[#555] shrink-0">
                      <MoreHorizontal size={15} />
                    </button>
                    {openMenuId === t.id && (
                      <div className="absolute right-6 top-8 z-10 bg-white border border-[#E8E7E2] rounded-lg shadow-md py-1 min-w-[120px]">
                        <button onClick={() => handleComplete(t.id)} className="w-full flex items-center gap-2 px-3 py-1.5 text-[11.5px] text-[#333] hover:bg-[#f4f4f1] text-left">
                          <CheckCircle2 size={13} className="text-green-600" /> Hoàn thành
                        </button>
                        <button onClick={() => handleDelete(t.id)} className="w-full flex items-center gap-2 px-3 py-1.5 text-[11.5px] text-red-600 hover:bg-[#f4f4f1] text-left">
                          <Trash2 size={13} /> Xoá
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
