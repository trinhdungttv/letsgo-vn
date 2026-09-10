import { useEffect, useState } from 'react'
import { ClipboardList, Trash2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import type { WorkTask } from '../../lib/types'
import { TASK_STATUS_LABELS, TASK_STATUS_COLORS, TASK_PRIORITY_LABELS, TASK_PRIORITY_COLORS } from '../../lib/types'
import { formatDate } from '../../lib/format'

type Row = WorkTask & {
  clients?: { name: string } | null
}

interface Props {
  /** Hồ sơ Khách hàng: lấy việc gắn với khách này. */
  clientId?: string
  /** Hồ sơ Chi nhánh: lấy việc gắn với chi nhánh này, hiện kèm tên khách của từng việc. */
  branchId?: string
  refreshKey?: number
}

const PAGE_SIZE = 8

/**
 * Việc trong "Việc của tôi" (work_tasks) đã mang sẵn client_id + branch_id, nên hai hồ sơ
 * này đọc THẲNG bảng đó thay vì giữ một bản sao riêng — sửa/hoàn thành/xoá ở Workspace là
 * hồ sơ Khách hàng và Chi nhánh thấy ngay, không cần đồng bộ.
 */
export function LinkedWorkTasks({ clientId, branchId, refreshKey }: Props) {
  const [rows, setRows] = useState<Row[]>([])
  // Tên người phụ trách tra riêng thay vì join: bảng app_users nhỏ, và nếu tra tên có
  // trục trặc thì cùng lắm mất tên — danh sách việc vẫn hiện đủ.
  const [userNames, setUserNames] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [showAll, setShowAll] = useState(false)

  useEffect(() => {
    if (!clientId && !branchId) { setRows([]); setLoading(false); return }
    let cancelled = false
    setLoading(true)
    ;(async () => {
      // Lấy cả việc đã xoá mềm: đây là lịch sử — đã từng làm gì với khách thì vẫn phải tra lại được.
      const base = supabase.from('work_tasks').select('*, clients(name)')
      const { data } = await (clientId ? base.eq('client_id', clientId) : base.eq('branch_id', branchId!))
        .order('due_date', { ascending: false })
      if (cancelled) return
      setRows((data || []) as Row[])
      setLoading(false)

      const ids = [...new Set(((data || []) as Row[]).map(t => t.user_id).filter(Boolean))]
      if (!ids.length) return
      const { data: us } = await supabase.from('app_users').select('id, full_name').in('id', ids)
      if (cancelled || !us) return
      setUserNames(Object.fromEntries((us as { id: string; full_name: string }[]).map(u => [u.id, u.full_name])))
    })()
    return () => { cancelled = true }
  }, [clientId, branchId, refreshKey])

  const open = rows.filter(r => !r.deleted_at && r.status !== 'done').length
  const visible = showAll ? rows : rows.slice(0, PAGE_SIZE)

  return (
    <div className="border border-[#E8E7E2] rounded-lg bg-white overflow-hidden">
      <div className="flex items-center gap-1.5 px-2.5 py-2 bg-[#FAFAF8] border-b border-[#E8E7E2]">
        <ClipboardList size={12} className="text-[#1D4ED8]" />
        <span className="text-[10px] font-semibold text-[#555] uppercase tracking-wide">Công việc & trao đổi</span>
        <span className="text-[9px] text-[#bbb] ml-auto">
          {rows.length ? `${rows.length} việc · ${open} đang mở` : ''}
        </span>
      </div>

      {loading ? (
        <div className="text-[11px] text-[#bbb] py-4 text-center">Đang tải…</div>
      ) : rows.length === 0 ? (
        <div className="text-[11px] text-[#bbb] py-5 text-center">
          Chưa có việc nào — tạo ở Workspace &gt; Việc của tôi, chọn {clientId ? 'khách hàng này' : 'chi nhánh này'} là việc sẽ hiện ở đây.
        </div>
      ) : (
        <div className="flex flex-col divide-y divide-[#F0EFEB]">
          {visible.map(t => {
            const removed = !!t.deleted_at
            return (
              <div key={t.id} className={`px-2.5 py-2 ${removed ? 'bg-[#FAFAF8]' : ''}`}>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className={`text-[11.5px] font-semibold flex-1 min-w-[120px] ${removed ? 'text-[#aaa] line-through' : 'text-[#111]'}`}>
                    {t.title}
                  </span>
                  {removed ? (
                    <span className="inline-flex items-center gap-0.5 text-[9.5px] px-1.5 py-px rounded-full border bg-gray-100 text-gray-500 border-gray-300">
                      <Trash2 size={9} /> Đã xoá
                    </span>
                  ) : (
                    <span className={`text-[9.5px] px-1.5 py-px rounded-full border ${TASK_STATUS_COLORS[t.status]}`}>
                      {TASK_STATUS_LABELS[t.status]}
                    </span>
                  )}
                  {!removed && (
                    <span className={`text-[9.5px] px-1.5 py-px rounded-full border ${TASK_PRIORITY_COLORS[t.priority]}`}>
                      {TASK_PRIORITY_LABELS[t.priority]}
                    </span>
                  )}
                  {t.task_type && (
                    <span className="text-[9.5px] px-1.5 py-px rounded-full border bg-blue-50 text-blue-700 border-blue-200">{t.task_type}</span>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-wrap text-[10px] text-[#999] mt-0.5">
                  <span>Hạn: {formatDate(t.due_date)}</span>
                  {t.completed_at && <span className="text-emerald-600">Xong: {formatDate(t.completed_at.slice(0, 10))}</span>}
                  <span>Phụ trách: {userNames[t.user_id] || '—'}</span>
                  {branchId && t.clients?.name && <span className="text-[#666]">KH: {t.clients.name}</span>}
                </div>
                {t.notes && <div className="text-[11px] text-[#666] mt-1 whitespace-pre-wrap break-words">{t.notes}</div>}
              </div>
            )
          })}
          {rows.length > visible.length && (
            <button onClick={() => setShowAll(true)} className="text-[11px] text-blue-600 hover:underline py-1.5">
              Xem thêm {rows.length - visible.length} việc cũ hơn
            </button>
          )}
        </div>
      )}
    </div>
  )
}
