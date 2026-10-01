import { useEffect, useState } from 'react'
import { ClipboardList, Trash2, ChevronDown, ChevronRight } from 'lucide-react'
import { ContractCompareTables } from '../ContractCompareTables'
import { supabase } from '../../lib/supabase'
import type { WorkTask } from '../../lib/types'
import { TASK_STATUS_LABELS, TASK_STATUS_COLORS, TASK_PRIORITY_LABELS, TASK_PRIORITY_COLORS } from '../../lib/types'
import { formatDate } from '../../lib/format'
import { useAuth } from '../../lib/auth'
import { contractTitle } from '../../lib/contractTitle'

type Row = WorkTask & {
  clients?: { name: string } | null
}

interface Props {
  /** Hồ sơ Khách hàng: lấy việc gắn với khách này. */
  clientId?: string
  /** Hồ sơ Chi nhánh: lấy việc gắn với chi nhánh này, hiện kèm tên khách của từng việc. */
  branchId?: string
  refreshKey?: number
  /** Chỉ lấy các loại việc này (vd. Hợp đồng / Phụ lục). Bỏ trống = lấy tất cả. */
  taskTypes?: string[]
  title?: string
  emptyHint?: string
}

const PAGE_SIZE = 8

/**
 * Việc trong "Việc của tôi" (work_tasks) đã mang sẵn client_id + branch_id, nên hai hồ sơ
 * này đọc THẲNG bảng đó thay vì giữ một bản sao riêng — sửa/hoàn thành/xoá ở Workspace là
 * hồ sơ Khách hàng và Chi nhánh thấy ngay, không cần đồng bộ.
 */
export function LinkedWorkTasks({ clientId, branchId, refreshKey, taskTypes, title = 'Công việc & trao đổi', emptyHint }: Props) {
  const [rows, setRows] = useState<Row[]>([])
  // Tên người phụ trách tra riêng thay vì join: bảng app_users nhỏ, và nếu tra tên có
  // trục trặc thì cùng lắm mất tên — danh sách việc vẫn hiện đủ.
  const [userNames, setUserNames] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [showAll, setShowAll] = useState(false)
  // Mặc định đóng; mở dòng nào mới hiện đủ ghi chú và (với Hợp đồng/Phụ lục) bảng + nội dung của khách.
  const { user } = useAuth()
  const [newApp, setNewApp] = useState<{ parentId: string; desc: string; due: string } | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [msg, setMsg] = useState('')
  const notify = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 3500) }

  useEffect(() => {
    if (!clientId && !branchId) { setRows([]); setLoading(false); return }
    let cancelled = false
    setLoading(true)
    ;(async () => {
      // Lấy cả việc đã xoá mềm: đây là lịch sử — đã từng làm gì với khách thì vẫn phải tra lại được.
      const base = supabase.from('work_tasks').select('*, clients(name)')
      const scoped = clientId ? base.eq('client_id', clientId) : base.eq('branch_id', branchId!)
      const { data } = await (taskTypes?.length ? scoped.in('task_type', taskTypes) : scoped)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, branchId, refreshKey, taskTypes?.join('|')])

  const open = rows.filter(r => !r.deleted_at && !r.voided_at && r.status !== 'done').length
  // Phụ lục trực thuộc Hợp đồng: xếp ngay dưới Hợp đồng cha, thụt vào.
  const ordered = (() => {
    const ids = new Set(rows.map(r => r.id))
    const kids = (id: string) => rows.filter(r => r.parent_task_id === id)
    const roots = rows.filter(r => !r.parent_task_id || !ids.has(r.parent_task_id))
    return roots.flatMap(r => [r, ...kids(r.id)])
  })()
  const visible = showAll ? ordered : ordered.slice(0, PAGE_SIZE)

  async function patch(t: Row, fields: Partial<WorkTask>) {
    const { error } = await supabase.from('work_tasks').update(fields).eq('id', t.id)
    if (error) { notify('Lỗi: ' + error.message); return }
    setRows(prev => prev.map(x => x.id === t.id ? { ...x, ...fields } : x))
  }

  // Vô hiệu hoá / khôi phục hiệu lực — chỉ đánh dấu, không xoá gì. Vô hiệu HĐ thì hỏi có vô hiệu luôn các Phụ lục thuộc nó.
  async function toggleVoid(t: Row) {
    if (t.voided_at) {
      if (!confirm(`Khôi phục hiệu lực cho "${t.title}"?`)) return
      await patch(t, { voided_at: null, void_reason: null }); notify('Đã khôi phục hiệu lực'); return
    }
    const reason = prompt(`Vô hiệu hoá "${t.title}"?\nLý do (VD: đã thanh lý, hết hiệu lực) — có thể để trống:`)
    if (reason === null) return
    const now = new Date().toISOString()
    await patch(t, { voided_at: now, void_reason: reason.trim() || null })
    const kids = t.task_type === 'Hợp đồng' ? rows.filter(r => r.parent_task_id === t.id && !r.voided_at && !r.deleted_at) : []
    if (kids.length && confirm(`Hợp đồng này có ${kids.length} Phụ lục. Vô hiệu luôn các Phụ lục đó?`)) {
      for (const k of kids) await patch(k, { voided_at: now, void_reason: reason.trim() || 'HĐ gốc vô hiệu' })
    }
    notify('Đã vô hiệu hoá — bấm "Khôi phục hiệu lực" nếu cần dùng lại')
  }

  async function addAppendix(parent: Row) {
    if (!newApp || !newApp.desc.trim() || !user || !parent.client_id) return
    const { data, error } = await supabase.from('work_tasks').insert({
      user_id: user.id, client_id: parent.client_id, branch_id: parent.branch_id,
      title: contractTitle(parent.clients?.name, 'Phụ lục', newApp.desc), task_type: 'Phụ lục',
      due_date: newApp.due, priority: 'medium', status: 'pending', parent_task_id: parent.id,
    }).select('*, clients(name)').single()
    if (error || !data) { notify('Lỗi thêm Phụ lục: ' + (error?.message || '')); return }
    setRows(prev => [...prev, data as Row]); setNewApp(null); setOpenId((data as Row).id); notify('Đã thêm Phụ lục vào Hợp đồng')
  }

  return (
    <div className="border border-[#E8E7E2] rounded-lg bg-white overflow-hidden">
      <div className="flex items-center gap-1.5 px-2.5 py-2 bg-[#FAFAF8] border-b border-[#E8E7E2]">
        <ClipboardList size={12} className="text-[#1D4ED8]" />
        <span className="text-[10px] font-semibold text-[#555] uppercase tracking-wide">{title}</span>
        <span className="text-[9px] text-[#bbb] ml-auto">
          {rows.length ? `${rows.length} việc · ${open} đang mở` : ''}
        </span>
      </div>

      {msg && <div className="text-[11px] px-2.5 py-1 bg-emerald-50 text-emerald-700 border-b border-emerald-200">{msg}</div>}
      {loading ? (
        <div className="text-[11px] text-[#bbb] py-4 text-center">Đang tải…</div>
      ) : rows.length === 0 ? (
        <div className="text-[11px] text-[#bbb] py-5 text-center">
          {emptyHint ?? <>Chưa có việc nào — tạo ở Workspace &gt; Việc của tôi, chọn {clientId ? 'khách hàng này' : 'chi nhánh này'} là việc sẽ hiện ở đây.</>}
        </div>
      ) : (
        <div className="flex flex-col divide-y divide-[#F0EFEB]">
          {visible.map(t => {
            const removed = !!t.deleted_at
            return (
              <div key={t.id} className={`px-2.5 py-2 ${removed ? 'bg-[#FAFAF8]' : ''} ${t.parent_task_id && rows.some(r => r.id === t.parent_task_id) ? 'ml-5 border-l-2 border-blue-200' : ''}`}>
                <div className="flex items-center gap-1.5 flex-wrap cursor-pointer" onClick={() => setOpenId(openId === t.id ? null : t.id)}>
                  {openId === t.id ? <ChevronDown size={12} className="text-[#999] shrink-0" /> : <ChevronRight size={12} className="text-[#999] shrink-0" />}
                  <span className={`text-[11.5px] font-semibold flex-1 min-w-[120px] ${removed ? 'text-[#aaa] line-through' : t.voided_at ? 'text-[#999] line-through' : 'text-[#111]'}`}>
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
                  {t.voided_at && !removed && (
                    <span className="text-[9.5px] px-1.5 py-px rounded-full border bg-red-50 text-red-600 border-red-200" title={t.void_reason || ''}>Vô hiệu</span>
                  )}
                  {t.task_type && (
                    <span className="text-[9.5px] px-1.5 py-px rounded-full border bg-blue-50 text-blue-700 border-blue-200">{t.task_type}</span>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-wrap text-[10px] text-[#999] mt-0.5">
                  <span>Hạn: {formatDate(t.due_date)}</span>
                  {t.completed_at && <span className="text-emerald-600">Xong: {formatDate(t.completed_at.slice(0, 10))}</span>}
                  <span>Phụ trách: {userNames[t.user_id] || '—'}</span>
                  {t.voided_at && <span className="text-red-500">Vô hiệu từ {formatDate(t.voided_at.slice(0, 10))}{t.void_reason ? ` — ${t.void_reason}` : ''}</span>}
                  {branchId && t.clients?.name && <span className="text-[#666]">KH: {t.clients.name}</span>}
                </div>
                {openId !== t.id && t.notes && <div className="text-[11px] text-[#666] mt-1 line-clamp-1 break-words cursor-pointer" onClick={() => setOpenId(t.id)}>{t.notes}</div>}
                {openId === t.id && (
                  <div className="mt-1.5 flex flex-col gap-2">
                    {t.notes && <div className="text-[11.5px] text-[#444] whitespace-pre-wrap break-words">{t.notes}</div>}
                    {(t.task_type === 'Hợp đồng' || t.task_type === 'Phụ lục') && !removed && (
                      <div className="flex items-center gap-2 flex-wrap text-[11px] bg-[#F9F9F7] border border-[#E8E7E2] rounded-md px-2 py-1.5">
                        <span className="text-[#888]">Loại:</span>
                        <select value={t.task_type} onChange={e => patch(t, { task_type: e.target.value, ...(e.target.value === 'Hợp đồng' ? { parent_task_id: null } : {}) })} className="border border-[#E8E7E2] rounded px-1.5 py-0.5 bg-white">
                          <option value="Hợp đồng">Hợp đồng</option><option value="Phụ lục">Phụ lục</option>
                        </select>
                        {t.task_type === 'Phụ lục' && (
                          <>
                            <span className="text-[#888]">Thuộc HĐ:</span>
                            <select value={t.parent_task_id ?? ''} onChange={e => patch(t, { parent_task_id: e.target.value || null })} className="border border-[#E8E7E2] rounded px-1.5 py-0.5 bg-white max-w-[260px]">
                              <option value="">— Chưa chọn —</option>
                              {rows.filter(r => r.task_type === 'Hợp đồng' && !r.deleted_at && r.id !== t.id).map(r => <option key={r.id} value={r.id}>{r.title}</option>)}
                            </select>
                          </>
                        )}
                        <button onClick={() => toggleVoid(t)} className={`ml-auto ${t.voided_at ? 'text-emerald-600' : 'text-red-500'} hover:underline`}>{t.voided_at ? 'Khôi phục hiệu lực' : 'Vô hiệu hoá'}</button>
                        <button onClick={() => { const v = prompt('Sửa tiêu đề', t.title); if (v && v.trim()) patch(t, { title: v.trim() }) }} className="text-blue-600 hover:underline">Sửa tiêu đề</button>
                      </div>
                    )}
                    {t.task_type === 'Hợp đồng' && !removed && t.client_id && (
                      newApp?.parentId === t.id ? (
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <input autoFocus value={newApp.desc} onChange={e => setNewApp({ ...newApp, desc: e.target.value })} onKeyDown={e => { if (e.key === 'Enter') addAppendix(t) }}
                            placeholder='Tên Phụ lục, VD: 01/PLHDDV-AMPACS-LGVN' className="flex-1 min-w-[180px] text-[11.5px] px-2 py-1 rounded-md border border-[#E8E7E2] bg-white focus:outline-none focus:border-blue-400" />
                          <input type="date" value={newApp.due} onChange={e => setNewApp({ ...newApp, due: e.target.value })} className="text-[11.5px] px-2 py-1 rounded-md border border-[#E8E7E2] bg-white" />
                          <button onClick={() => addAppendix(t)} disabled={!newApp.desc.trim()} className="text-[11.5px] px-3 py-1 rounded-md bg-blue-600 text-white disabled:opacity-40">Thêm</button>
                          <button onClick={() => setNewApp(null)} className="text-[11.5px] px-2 py-1 rounded-md border border-[#E8E7E2] text-[#666]">✕</button>
                        </div>
                      ) : (
                        <button onClick={() => setNewApp({ parentId: t.id, desc: '', due: new Date().toISOString().slice(0, 10) })} className="self-start text-[11.5px] text-blue-600 hover:underline">+ Thêm Phụ lục thuộc Hợp đồng này</button>
                      )
                    )}
                    {(t.task_type === 'Hợp đồng' || t.task_type === 'Phụ lục') && t.client_id && (
                      <ContractCompareTables clientId={t.client_id} taskId={t.id} toast={notify} />
                    )}
                  </div>
                )}
              </div>
            )
          })}
          {ordered.length > visible.length && (
            <button onClick={() => setShowAll(true)} className="text-[11px] text-blue-600 hover:underline py-1.5">
              Xem thêm {ordered.length - visible.length} việc cũ hơn
            </button>
          )}
        </div>
      )}
    </div>
  )
}
