// Nhiều hợp đồng / 1 công ty (migration 203). clients.contract_start / contract_end = TÓM TẮT của các HĐ
// còn hiệu lực, do summarizeContracts() tính và app ghi lại mỗi khi HĐ thay đổi → các màn cũ vẫn đọc như trước.
import { supabase } from './supabase'

export interface ClientContract {
  id: string
  client_id: string
  name: string
  scope: string
  start_date: string | null
  end_date: string | null
  terminated_at: string | null
  renewed_from: string | null
  notes: string
  deleted_at?: string | null
  created_at?: string
}

export type ContractState = 'active' | 'expiring' | 'expired' | 'terminated'

const DAY = 86400000
const ms = (d: string) => new Date(d + 'T00:00:00').getTime()

/** Trạng thái 1 HĐ tại thời điểm `today` ('YYYY-MM-DD'). Sắp hết hạn = còn ≤ 60 ngày (khớp màu cảnh báo hồ sơ khách). */
export function contractState(c: Pick<ClientContract, 'end_date' | 'terminated_at'>, today: string): ContractState {
  if (c.terminated_at) return 'terminated'
  if (!c.end_date) return 'active'
  const left = Math.ceil((ms(c.end_date) - ms(today)) / DAY)
  return left < 0 ? 'expired' : left <= 60 ? 'expiring' : 'active'
}

/** Tóm tắt ghi vào clients.contract_start / contract_end.
 *  Có HĐ chưa thanh lý: bắt đầu sớm nhất – hết hạn muộn nhất của chúng (HĐ ký lại sau làm hạn kéo dài ra).
 *  Toàn bộ đã thanh lý: lấy mốc cũ nhất – ngày kết thúc muộn nhất (thanh lý hoặc hết hạn) để hồ sơ không trống. */
export function summarizeContracts(list: ClientContract[]): { contract_start: string | null; contract_end: string | null } {
  const live = list.filter(c => !c.deleted_at)
  if (!live.length) return { contract_start: null, contract_end: null }
  const open = live.filter(c => !c.terminated_at)
  const pool = open.length ? open : live
  const starts = pool.map(c => c.start_date).filter(Boolean) as string[]
  const ends = pool.map(c => (open.length ? c.end_date : (c.terminated_at || c.end_date))).filter(Boolean) as string[]
  return {
    contract_start: starts.length ? starts.reduce((a, b) => (a < b ? a : b)) : null,
    contract_end: ends.length ? ends.reduce((a, b) => (a > b ? a : b)) : null,
  }
}

/** Đồng bộ tóm tắt sang bảng clients. Trả về giá trị đã ghi. */
export async function syncClientContractSummary(clientId: string, list: ClientContract[]) {
  const s = summarizeContracts(list)
  const { error } = await supabase.from('clients').update({ ...s, updated_at: new Date().toISOString() }).eq('id', clientId)
  if (error) throw error
  return s
}

export async function fetchClientContracts(clientId: string): Promise<ClientContract[]> {
  const { data, error } = await supabase.from('client_contracts').select('*')
    .eq('client_id', clientId).is('deleted_at', null).order('start_date', { ascending: false, nullsFirst: false })
  if (error) throw error
  return (data ?? []) as ClientContract[]
}
