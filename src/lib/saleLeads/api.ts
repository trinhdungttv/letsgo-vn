// ============================================================================
// Bảng nháp đầu mối Sale / CTV — đọc / ghi Supabase (bảng `sale_leads`, migration 226).
// Xoá = xoá MỀM (deleted_at). DB chặn trùng SĐT giữa các dòng còn sống (trigger), app kiểm trước.
// ============================================================================
import { supabase } from '../supabase';
import type { AppUser } from '../types';
import { phoneKeysOf } from './parse';
import { mapSaleLeadRow, type LeadContactLog, type SaleLead, type SaleLeadRow, type SaleLeadStatus } from './types';

export const SALE_LEADS_MIGRATION_HINT =
  'Bảng nháp đầu mối cần migration 226 (sale_leads). Mở Supabase → SQL Editor, chạy file 20261113120000_226_sale_leads.sql rồi tải lại trang.';

const who = (user: AppUser | null) => user?.full_name || user?.username || '';

/** Lỗi "chưa có bảng" (chưa chạy migration 226). */
export function isMissingTable(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  return err.code === '42P01' || err.code === 'PGRST205'
    || (/sale_leads/.test(err.message ?? '') && /(does not exist|schema cache|could not find)/i.test(err.message ?? ''));
}

/** Lỗi ghi → câu dễ hiểu (chưa có bảng → hướng dẫn chạy migration; trùng SĐT → câu của trigger DB). */
const friendly = (e: { code?: string; message?: string }) =>
  new Error(isMissingTable(e) ? SALE_LEADS_MIGRATION_HINT : e.message || 'Lỗi lưu đầu mối');

/** Mọi đầu mối còn sống, mới nhất trước. `null` = chưa chạy migration. */
export async function loadSaleLeads(): Promise<SaleLead[] | null> {
  const out: SaleLeadRow[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from('sale_leads').select('*').is('deleted_at', null)
      .order('created_at', { ascending: false }).order('id').range(from, from + PAGE - 1);
    if (error) {
      if (isMissingTable(error)) return null;
      throw error;
    }
    const rows = (data ?? []) as SaleLeadRow[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out.map(mapSaleLeadRow);
}

/** Dữ liệu 1 đầu mối khi thêm / sửa (form hoặc nhập bảng). */
export interface SaleLeadInput {
  fullName: string;
  phone: string;
  company: string;
  zoneIds: string[];
  areaText: string;
  channelUrl: string;
  postUrl: string;
  note: string;
  status?: SaleLeadStatus;
}

function rowOf(i: SaleLeadInput): Record<string, unknown> {
  return {
    full_name: i.fullName.trim(),
    phone: i.phone.trim(),
    phone_keys: phoneKeysOf(i.phone),
    company: i.company.trim(),
    zone_ids: i.zoneIds,
    area_text: i.areaText.trim(),
    channel_url: i.channelUrl.trim(),
    post_url: i.postUrl.trim(),
    note: i.note.trim(),
  };
}

export async function insertSaleLead(input: SaleLeadInput, user: AppUser | null, source = ''): Promise<SaleLead> {
  const { data, error } = await supabase.from('sale_leads')
    .insert({ ...rowOf(input), status: input.status ?? 'new', source, created_by: who(user), updated_by: who(user) })
    .select().single();
  if (error) throw friendly(error);
  return mapSaleLeadRow(data as SaleLeadRow);
}

/** Thêm nhiều dòng (nhập từ bảng) — chia lô 200 dòng. */
export async function insertSaleLeads(inputs: readonly SaleLeadInput[], user: AppUser | null, source: string): Promise<number> {
  let n = 0;
  for (let i = 0; i < inputs.length; i += 200) {
    const chunk = inputs.slice(i, i + 200).map(x => ({ ...rowOf(x), status: x.status ?? 'new', source, created_by: who(user), updated_by: who(user) }));
    const { error } = await supabase.from('sale_leads').insert(chunk);
    if (error) throw new Error(`${friendly(error).message}${n ? ` — đã lưu ${n} dòng trước đó` : ''}`);
    n += chunk.length;
  }
  return n;
}

export async function updateSaleLead(id: string, input: SaleLeadInput, user: AppUser | null): Promise<void> {
  const { error } = await supabase.from('sale_leads').update({ ...rowOf(input), ...(input.status ? { status: input.status } : {}), updated_by: who(user) }).eq('id', id);
  if (error) throw friendly(error);
}

/** Ghi đè vài cột (bổ sung thông tin khi nhập lại, đổi trạng thái nhanh…). */
export async function patchSaleLead(id: string, patch: Record<string, unknown>, user: AppUser | null): Promise<void> {
  const { error } = await supabase.from('sale_leads').update({ ...patch, updated_by: who(user) }).eq('id', id);
  if (error) throw friendly(error);
}

/** Ghi 1 lần gọi / nhắn: nối vào nhật ký + đổi trạng thái theo kết quả. */
export async function logLeadContact(lead: SaleLead, entry: Omit<LeadContactLog, 'by'>, user: AppUser | null): Promise<void> {
  const log = [...lead.contactLog, { ...entry, note: entry.note.trim(), by: who(user) }];
  await patchSaleLead(lead.id, {
    contact_log: log,
    // Đã chuyển sang Sale / CTV thì giữ trạng thái đó, chỉ thêm dòng nhật ký
    ...(lead.status === 'promoted' ? {} : { status: entry.result }),
    last_contact_at: entry.at,
  }, user);
}

/** Đánh dấu đã chuyển sang Sale / CTV (người trong contacts). */
export async function markLeadPromoted(id: string, contactId: string, user: AppUser | null): Promise<void> {
  await patchSaleLead(id, { status: 'promoted', promoted_contact_id: contactId, promoted_at: new Date().toISOString() }, user);
}

/** Đổi tình trạng nhiều dòng 1 lượt (không dùng cho "Đã chuyển" — việc đó đi qua nút Chuyển). */
export async function bulkSetLeadStatus(ids: readonly string[], status: Exclude<SaleLeadStatus, 'promoted'>, user: AppUser | null): Promise<void> {
  if (!ids.length) return;
  const { error } = await supabase.from('sale_leads').update({ status, updated_by: who(user) }).in('id', ids);
  if (error) throw friendly(error);
}

/** Xoá mềm (khôi phục được ở trang Lịch sử). */
export async function deleteSaleLeads(ids: readonly string[], user: AppUser | null): Promise<void> {
  if (!ids.length) return;
  const { error } = await supabase.from('sale_leads').update({ deleted_at: new Date().toISOString(), updated_by: who(user) }).in('id', ids);
  if (error) throw friendly(error);
}
