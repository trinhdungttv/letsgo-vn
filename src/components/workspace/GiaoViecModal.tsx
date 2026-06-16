import { useState } from 'react'
import { X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import type { Client, WorkTask, TaskPriority } from '../../lib/types'

interface Props {
  clients: Client[]
  toast: (msg: string) => void
  onClose: () => void
  onCreated?: (task: WorkTask) => void
}

export function GiaoViecModal({ clients, toast, onClose, onCreated }: Props) {
  const { user } = useAuth()
  const [title, setTitle] = useState('')
  const [clientId, setClientId] = useState('')
  const [taskType, setTaskType] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [priority, setPriority] = useState<TaskPriority>('medium')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const activeClients = clients.filter(c => c.client_type === 'active' && c.cooperation_status !== 'suspended')

  async function save() {
    if (!title.trim()) { toast('Vui lòng nhập tên công việc'); return }
    if (!user) return
    setSaving(true)
    const today = new Date().toISOString().split('T')[0]
    const payload = {
      user_id: user.id,
      client_id: clientId || null,
      title: title.trim(),
      task_type: taskType || null,
      due_date: dueDate || today,
      priority,
      notes: notes.trim() || null,
      status: 'pending',
      kcn: clientId ? (activeClients.find(c => c.id === clientId)?.industrial_zones?.[0] || null) : null,
    }
    const { data, error } = await supabase.from('work_tasks').insert(payload).select().single()
    setSaving(false)
    if (error) { toast('Có lỗi khi lưu, thử lại'); return }
    toast('Đã giao việc thành công')
    if (onCreated && data) onCreated(data as WorkTask)
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#E8E7E2]">
          <h2 className="text-[14px] font-semibold text-[#111]">Giao việc</h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-md">
            <X size={16} className="text-gray-500" />
          </button>
        </div>

        <div className="px-5 py-4 flex flex-col gap-3">
          <div>
            <label className="text-[11.5px] font-semibold text-[#666] mb-1 block">Tên công việc *</label>
            <input
              autoFocus
              placeholder="Nhập tên công việc..."
              value={title} onChange={e => setTitle(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && save()}
              className="w-full text-[13px] px-3 py-2 border border-[#E8E7E2] rounded-lg focus:outline-none focus:border-blue-400"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11.5px] font-semibold text-[#666] mb-1 block">Loại công việc</label>
              <select value={taskType} onChange={e => setTaskType(e.target.value)} className="w-full text-[12.5px] px-2.5 py-2 border border-[#E8E7E2] rounded-lg focus:outline-none focus:border-blue-400">
                <option value="">-- Chọn loại --</option>
                {['Tái ký HĐ', 'Báo giá', 'Thăm quan', 'Hỏi thăm CN', 'Văn phòng', 'Khác'].map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[11.5px] font-semibold text-[#666] mb-1 block">Độ ưu tiên</label>
              <select value={priority} onChange={e => setPriority(e.target.value as TaskPriority)} className="w-full text-[12.5px] px-2.5 py-2 border border-[#E8E7E2] rounded-lg focus:outline-none focus:border-blue-400">
                <option value="high">Cao</option>
                <option value="medium">Trung bình</option>
                <option value="low">Thấp</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11.5px] font-semibold text-[#666] mb-1 block">Khách hàng</label>
              <select value={clientId} onChange={e => setClientId(e.target.value)} className="w-full text-[12.5px] px-2.5 py-2 border border-[#E8E7E2] rounded-lg focus:outline-none focus:border-blue-400">
                <option value="">-- Không gắn KH --</option>
                {activeClients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[11.5px] font-semibold text-[#666] mb-1 block">Hạn hoàn thành</label>
              <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="w-full text-[12.5px] px-2.5 py-2 border border-[#E8E7E2] rounded-lg focus:outline-none focus:border-blue-400" />
            </div>
          </div>

          <div>
            <label className="text-[11.5px] font-semibold text-[#666] mb-1 block">Ghi chú</label>
            <textarea
              placeholder="Mô tả thêm..."
              value={notes} onChange={e => setNotes(e.target.value)}
              rows={2}
              className="w-full text-[12.5px] px-3 py-2 border border-[#E8E7E2] rounded-lg focus:outline-none focus:border-blue-400 resize-none"
            />
          </div>
        </div>

        <div className="px-5 py-4 border-t border-[#E8E7E2] flex gap-2">
          <button onClick={onClose} className="flex-1 px-3 py-2 text-[13px] font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition">Hủy</button>
          <button onClick={save} disabled={saving || !title.trim()} className="flex-1 px-3 py-2 text-[13px] font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg transition">
            {saving ? 'Đang lưu...' : 'Giao việc'}
          </button>
        </div>
      </div>
    </div>
  )
}
