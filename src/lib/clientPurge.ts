import { supabase } from './supabase';

/**
 * XOÁ VĨNH VIỄN công ty khỏi Lưu trữ.
 *
 * "Xoá" ở màn Khách hàng chỉ là lưu trữ mềm (clients.archived_at). Module này là
 * bước cuối cùng: xoá hẳn dòng trong bảng clients.
 *
 * Không phó mặc cho ON DELETE của database (mỗi bảng khai báo một kiểu, có bảng
 * còn để NO ACTION nên sẽ chặn lệnh xoá). Ở đây dọn tường minh theo 2 nhóm:
 *   - OWNED  : dữ liệu thuộc về công ty → xoá theo.
 *   - DETACH : bản ghi của bộ phận khác chỉ trỏ tới công ty → giữ lại, gỡ liên kết.
 *
 * Mọi thao tác vẫn được trigger dh_track ghi vào data_history, nên còn khôi phục
 * được ở "Lịch sử & An toàn dữ liệu → Nhật ký Database / Cỗ máy thời gian".
 */

export interface RelationTable {
  table: string;
  label: string;
}

export const OWNED_TABLES: RelationTable[] = [
  { table: 'projects_pnl', label: 'Dự án P&L (kèm chi phí & dòng doanh thu)' },
  { table: 'client_labor_history', label: 'Lịch sử lao động' },
  { table: 'finance_records', label: 'Bản ghi tài chính (bảng cũ)' },
  { table: 'contacts', label: 'Người liên hệ' },
  { table: 'contact_clients', label: 'Liên kết liên hệ ↔ công ty' },
  { table: 'client_gifts', label: 'Quà tặng' },
  { table: 'client_documents', label: 'Tài liệu' },
  { table: 'client_manager_history', label: 'Lịch sử người quản lý' },
  { table: 'client_branch_history', label: 'Lịch sử chi nhánh' },
  { table: 'pnl_split_settings', label: 'Cài đặt chia lợi nhuận' },
  { table: 'pnl_invoice_settings', label: 'Cài đặt hoá đơn nhiều kỳ' },
  { table: 'cooperation_suspension_requests', label: 'Yêu cầu tạm ngưng hợp tác' },
];

export const DETACH_TABLES: RelationTable[] = [
  { table: 'cskh_logs', label: 'Nhật ký CSKH' },
  { table: 'crm_deals', label: 'Cơ hội CRM' },
  { table: 'crm_pipeline', label: 'Pipeline CRM' },
  { table: 'work_tasks', label: 'Công việc' },
  { table: 'quote_requests', label: 'Yêu cầu báo giá' },
  { table: 'win_loss_records', label: 'Ghi nhận thắng/thua' },
];

export interface RelationCount extends RelationTable {
  count: number;
}

export interface ClientImpact {
  owned: RelationCount[];
  detach: RelationCount[];
  ownedTotal: number;
  detachTotal: number;
}

/** Bảng/cột không tồn tại (migration chưa chạy) — bỏ qua, không coi là lỗi. */
const isMissingSchema = (code?: string) => code === '42P01' || code === '42703' || code === 'PGRST205';

async function countIn(table: string, clientId: string): Promise<number> {
  const { count, error } = await supabase
    .from(table)
    .select('client_id', { count: 'exact', head: true })
    .eq('client_id', clientId);
  if (error) {
    if (isMissingSchema(error.code)) return 0;
    throw error;
  }
  return count ?? 0;
}

/** Đếm dữ liệu liên quan để hiện bảng "sẽ mất những gì" trước khi xoá. */
export async function countClientImpact(clientId: string): Promise<ClientImpact> {
  const [owned, detach] = await Promise.all([
    Promise.all(OWNED_TABLES.map(async t => ({ ...t, count: await countIn(t.table, clientId) }))),
    Promise.all(DETACH_TABLES.map(async t => ({ ...t, count: await countIn(t.table, clientId) }))),
  ]);
  return {
    owned: owned.filter(t => t.count > 0),
    detach: detach.filter(t => t.count > 0),
    ownedTotal: owned.reduce((s, t) => s + t.count, 0),
    detachTotal: detach.reduce((s, t) => s + t.count, 0),
  };
}

async function delWhereClient(table: string, clientId: string) {
  const { error } = await supabase.from(table).delete().eq('client_id', clientId);
  if (error && !isMissingSchema(error.code)) throw new Error(`Xoá ${table}: ${error.message}`);
}

async function detachClient(table: string, clientId: string) {
  const { error } = await supabase.from(table).update({ client_id: null }).eq('client_id', clientId);
  if (error && !isMissingSchema(error.code)) throw new Error(`Gỡ liên kết ${table}: ${error.message}`);
}

/**
 * Xoá vĩnh viễn 1 công ty đã lưu trữ. Chỉ chạy khi người dùng đã xác nhận —
 * hàm này không tự hỏi lại.
 */
export async function purgeClient(clientId: string): Promise<void> {
  // 1. P&L: xoá con trước (chi phí, dòng doanh thu) rồi mới tới dòng dự án.
  const { data: pnlRows, error: pnlErr } = await supabase
    .from('projects_pnl').select('id').eq('client_id', clientId);
  if (pnlErr && !isMissingSchema(pnlErr.code)) throw pnlErr;
  const pnlIds = (pnlRows ?? []).map(r => r.id as string);
  if (pnlIds.length > 0) {
    for (const child of ['projects_pnl_costs', 'pnl_revenue_lines']) {
      const { error } = await supabase.from(child).delete().in('pnl_id', pnlIds);
      if (error && !isMissingSchema(error.code)) throw new Error(`Xoá ${child}: ${error.message}`);
    }
  }

  // 2. Dữ liệu thuộc về công ty.
  for (const t of OWNED_TABLES) await delWhereClient(t.table, clientId);

  // 3. Bản ghi của bộ phận khác — giữ lại, chỉ gỡ liên kết.
  for (const t of DETACH_TABLES) await detachClient(t.table, clientId);

  // 4. Chính công ty.
  const { error } = await supabase.from('clients').delete().eq('id', clientId);
  if (error) throw error;
}
