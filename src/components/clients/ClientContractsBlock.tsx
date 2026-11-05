import { useEffect, useState } from 'react'
import { Plus, Pencil, RotateCw, Ban, Trash2, Check } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { formatDate } from '../../lib/format'
import { useAuth } from '../../lib/auth'
import {
  fetchClientContracts, syncClientContractSummary, contractState,
  type ClientContract, type ContractState,
} from '../../lib/clientContracts'

const STATE_UI: Record<ContractState, { label: string; cls: string }> = {
  active: { label: 'Đang hiệu lực', cls: 'bg-emerald-50 text-emerald-700' },
  expiring: { label: 'Sắp hết hạn', cls: 'bg-amber-50 text-amber-700' },
  expired: { label: 'Hết hạn', cls: 'bg-red-50 text-red-600' },
  terminated: { label: 'Đã thanh lý', cls: 'bg-gray-100 text-gray-500' },
}
const inp = 'text-[12.5px] px-2 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500 bg-white w-full'

interface Draft { id?: string; name: string; scope: string; start_date: string; end_date: string; terminated_at: string; renewed_from: string | null; notes: string }
const EMPTY: Draft = { name: '', scope: '', start_date: '', end_date: '', terminated_at: '', renewed_from: null, notes: '' }

/** Danh sách hợp đồng của 1 công ty (1 công ty có thể ký nhiều HĐ, thanh lý / ký lại từng cái riêng). */
export default function ClientContractsBlock({ clientId, toast, onSummary, onCount }: {
  clientId: string
  toast: (m: string) => void
  /** Tóm tắt mới (đã ghi vào clients) để hồ sơ cập nhật ngay "Bắt đầu / Hết hạn HĐ". */
  onSummary: (s: { contract_start: string | null; contract_end: string | null }) => void
  onCount?: (n: number) => void
}) {
  const { user } = useAuth()
  const [list, setList] = useState<ClientContract[]>([])
  const [missing, setMissing] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const today = new Date().toISOString().slice(0, 10)

  const load = async () => {
    try {
      const l = await fetchClientContracts(clientId)
      setList(l); setMissing(false); onCount?.(l.length)
    } catch { setMissing(true); onCount?.(0) }
  }
  useEffect(() => { load() }, [clientId]) // eslint-disable-line react-hooks/exhaustive-deps

  const afterChange = async () => {
    const l = await fetchClientContracts(clientId)
    setList(l); onCount?.(l.length)
    onSummary(await syncClientContractSummary(clientId, l))
  }

  const save = async () => {
    if (!draft) return
    if (!draft.start_date && !draft.end_date) { toast('Nhập ít nhất ngày bắt đầu hoặc ngày hết hạn'); return }
    if (draft.start_date && draft.end_date && draft.end_date < draft.start_date) { toast('Ngày hết hạn phải sau ngày bắt đầu'); return }
    const row = {
      name: draft.name.trim(), scope: draft.scope.trim(), notes: draft.notes.trim(),
      start_date: draft.start_date || null, end_date: draft.end_date || null,
      terminated_at: draft.terminated_at || null, renewed_from: draft.renewed_from,
      updated_by: user?.full_name || '',
    }
    try {
      const { error } = draft.id
        ? await supabase.from('client_contracts').update(row).eq('id', draft.id)
        : await supabase.from('client_contracts').insert({ ...row, client_id: clientId, created_by: user?.full_name || '' })
      if (error) throw error
      await afterChange(); setDraft(null); toast('Đã lưu hợp đồng')
    } catch (e: any) { toast('Lỗi: ' + e.message) }
  }

  const terminate = async (c: ClientContract) => {
    const d = window.prompt(`Ngày thanh lý hợp đồng "${c.name || c.scope || 'này'}" (YYYY-MM-DD):`, today)
    if (!d) return
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) { toast('Ngày không đúng dạng YYYY-MM-DD'); return }
    try {
      const { error } = await supabase.from('client_contracts').update({ terminated_at: d, updated_by: user?.full_name || '' }).eq('id', c.id)
      if (error) throw error
      await afterChange(); toast('Đã thanh lý hợp đồng')
    } catch (e: any) { toast('Lỗi: ' + e.message) }
  }

  const remove = async (c: ClientContract) => {
    if (!window.confirm(`Xoá hợp đồng "${c.name || c.scope || 'này'}"?\nHợp đồng bị ẩn khỏi danh sách và ngày HĐ của công ty được tính lại (dữ liệu vẫn lưu trong lịch sử).`)) return
    try {
      const { error } = await supabase.from('client_contracts').update({ deleted_at: new Date().toISOString() }).eq('id', c.id)
      if (error) throw error
      await afterChange(); toast('Đã xoá hợp đồng')
    } catch (e: any) { toast('Lỗi: ' + e.message) }
  }

  if (missing) {
    return <div className="text-[12px] text-amber-700 bg-amber-50 rounded-lg px-3 py-2">Cần chạy migration 203 để quản lý nhiều hợp đồng. Hiện chỉ dùng ngày HĐ ở dưới.</div>
  }

  const field = (label: string, el: React.ReactNode) => (
    <div className="flex flex-col gap-1"><label className="text-[11px] text-[#666] font-medium">{label}</label>{el}</div>
  )

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-semibold text-[#444]">Hợp đồng ({list.length})</span>
        <button onClick={() => setDraft(EMPTY)} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11.5px] font-medium border border-gray-300 text-[#444] hover:bg-[#FAFAF8]">
          <Plus size={12} /> Thêm hợp đồng
        </button>
      </div>

      {!list.length && !draft && <div className="text-[12px] text-[#999]">Chưa có hợp đồng nào.</div>}

      {list.map(c => {
        const st = STATE_UI[contractState(c, today)]
        const done = !!c.terminated_at || (!!c.end_date && c.end_date < today)
        return (
          <div key={c.id} className="rounded-lg border border-[#E8E7E2] px-3 py-2 flex flex-col gap-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[13px] font-medium text-[#222]">{c.name || 'Hợp đồng'}</span>
              {c.scope && <span className="text-[11px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700">{c.scope}</span>}
              <span className={`text-[10.5px] px-1.5 py-0.5 rounded ${st.cls}`}>{st.label}</span>
            </div>
            <div className="text-[12px] text-[#666]">
              {formatDate(c.start_date) || '—'} → {formatDate(c.end_date) || '—'}
              {c.terminated_at && <span className="ml-2">· thanh lý {formatDate(c.terminated_at)}</span>}
              {c.renewed_from && <span className="ml-2 text-blue-600">· ký lại</span>}
            </div>
            {c.notes && <div className="text-[11.5px] text-[#888]">{c.notes}</div>}
            <div className="flex gap-1.5 flex-wrap pt-0.5">
              <button onClick={() => setDraft({ id: c.id, name: c.name, scope: c.scope, start_date: c.start_date || '', end_date: c.end_date || '', terminated_at: c.terminated_at || '', renewed_from: c.renewed_from, notes: c.notes })} className="inline-flex items-center gap-1 text-[11px] text-[#555] hover:text-blue-600"><Pencil size={11} /> Sửa</button>
              {!c.terminated_at && <button onClick={() => terminate(c)} className="inline-flex items-center gap-1 text-[11px] text-[#555] hover:text-amber-600"><Ban size={11} /> Thanh lý</button>}
              {done && <button onClick={() => setDraft({ ...EMPTY, name: c.name, scope: c.scope, renewed_from: c.id })} className="inline-flex items-center gap-1 text-[11px] text-[#555] hover:text-emerald-600"><RotateCw size={11} /> Ký lại</button>}
              <button onClick={() => remove(c)} className="inline-flex items-center gap-1 text-[11px] text-[#555] hover:text-red-600"><Trash2 size={11} /> Xoá</button>
            </div>
          </div>
        )
      })}

      {draft && (
        <div className="p-3 rounded-lg border border-blue-200 bg-blue-50/50 flex flex-col gap-2">
          <div className="text-[12px] font-semibold text-[#333]">{draft.id ? 'Sửa hợp đồng' : draft.renewed_from ? 'Ký lại hợp đồng' : 'Thêm hợp đồng'}</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {field('Tên / số hợp đồng', <input className={inp} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} placeholder="VD: HĐ số 12/2026" />)}
            {field('Công đoạn / phạm vi', <input className={inp} value={draft.scope} onChange={e => setDraft({ ...draft, scope: e.target.value })} placeholder="VD: Công đoạn A" />)}
            {field('Ngày bắt đầu', <input type="date" className={inp} value={draft.start_date} onChange={e => setDraft({ ...draft, start_date: e.target.value })} />)}
            {field('Ngày hết hạn', <input type="date" className={inp} value={draft.end_date} onChange={e => setDraft({ ...draft, end_date: e.target.value })} />)}
            {draft.id && field('Ngày thanh lý (để trống = còn hiệu lực)', <input type="date" className={inp} value={draft.terminated_at} onChange={e => setDraft({ ...draft, terminated_at: e.target.value })} />)}
          </div>
          {field('Ghi chú', <input className={inp} value={draft.notes} onChange={e => setDraft({ ...draft, notes: e.target.value })} />)}
          <div className="flex gap-2">
            <button onClick={save} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-[#1D4ED8] text-white hover:bg-[#1E40AF]"><Check size={13} /> Lưu</button>
            <button onClick={() => setDraft(null)} className="px-3 py-1.5 rounded-lg text-[12px] border border-gray-300 text-gray-600 hover:bg-gray-50">Huỷ</button>
          </div>
        </div>
      )}
    </div>
  )
}
