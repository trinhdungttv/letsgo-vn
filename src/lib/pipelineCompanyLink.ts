// ============================================================================
// Gắn người liên hệ vào công ty ĐANG Ở BD PIPELINE (chưa hợp tác) — 04/11/2026.
// ----------------------------------------------------------------------------
// Người liên hệ chỉ gắn được vào hồ sơ `clients` (bảng nối contact_clients). Công ty ở BD Pipeline
// chưa hợp tác thì CHƯA có hồ sơ clients (crm_pipeline.client_id trống) → trước đây ô "Sang công ty"
// không thấy các công ty này.
//
// Cách gắn: dùng hồ sơ clients TRÙNG TÊN nếu đã có, chưa có thì tạo hồ sơ dạng KH tiềm năng.
// KHÔNG ghi client_id vào thẻ Pipeline: thẻ có client_id = đã hợp tác (ẩn nút "Bắt đầu hợp tác", chi
// nhánh lấy từ Khách hàng…). Khi bấm "Bắt đầu hợp tác", CompanyProfileModal.handleActivate tìm hồ sơ
// trùng tên (findClientsByName) → nâng chính hồ sơ này lên đang hợp tác → người liên hệ giữ nguyên.
// ============================================================================
import { supabase } from './supabase';
import { logActivity } from './audit';
import { foldVN } from './contactCareer';
import { CRM_STAGES } from './constants';
import { findClientsByName } from './pipelineHelpers';
import type { AppUser } from './types';

export interface PipelineCompanyLite {
  id: string;
  company_name: string;
  stage: string;
  client_id: string | null;
  contact_id: string | null;
  branch_id: string | null;
}

export const PIPELINE_COMPANY_SELECT = 'id, company_name, stage, client_id, contact_id, branch_id';

/** Giai đoạn lưu trữ (không phải cột kanban) — cùng nhãn với ARCHIVED_STAGES ở CompanyProfileModal. */
const ARCHIVED_STAGE_LABEL: Readonly<Record<string, string>> = { 'khong-nhu-cau': 'Không hợp tác', ngung: 'Ngưng HĐ' };

/** Tên giai đoạn Pipeline để hiện cạnh tên công ty ("Đàm phán HĐ"…). */
export function pipelineStageLabel(stage: string): string {
  return CRM_STAGES.find(s => s.id === stage)?.label ?? ARCHIVED_STAGE_LABEL[stage] ?? stage;
}

/**
 * Công ty chỉ có ở BD Pipeline (chưa có hồ sơ Khách hàng) để chọn khi gắn người liên hệ:
 * bỏ thẻ đã gắn hồ sơ (client_id), thẻ "Ngưng HĐ" (đã gộp / dừng), thẻ trùng tên với hồ sơ clients
 * đã có trong danh sách (hồ sơ đó đã hiện rồi) và thẻ trùng tên nhau (giữ thẻ tạo trước).
 */
export function pipelineOnlyCompanies(
  entries: readonly PipelineCompanyLite[],
  clientNames: Iterable<string>,
): PipelineCompanyLite[] {
  const seen = new Set<string>();
  for (const n of clientNames) seen.add(foldVN(n));
  const out: PipelineCompanyLite[] = [];
  for (const e of entries) {
    if (e.client_id || e.stage === 'ngung') continue;
    const key = foldVN(e.company_name || '');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

/**
 * Hồ sơ clients để gắn người liên hệ vào công ty đang ở Pipeline: hồ sơ trùng tên (chưa lưu trữ) nếu có,
 * không thì tạo KH tiềm năng (mang theo chi nhánh của thẻ). Không đụng thẻ Pipeline.
 */
export async function ensureClientForPipelineCompany(
  entry: PipelineCompanyLite,
  user: AppUser | null,
): Promise<{ id: string; name: string; created: boolean }> {
  const name = entry.company_name.replace(/\s+/g, ' ').trim();
  if (!name) throw new Error('Thẻ Pipeline chưa có tên công ty');
  const existing = (await findClientsByName(name)).find(c => !c.archived_at);
  if (existing) return { id: existing.id, name: existing.name, created: false };

  const { data, error } = await supabase.from('clients')
    .insert({ name, client_type: 'prospect', status: 'ok', branch_id: entry.branch_id ?? null })
    .select('id, name').single();
  if (error) throw new Error('Chưa tạo được hồ sơ công ty: ' + error.message);
  const created = data as { id: string; name: string };
  await logActivity({
    user, action: 'insert', table: 'clients', recordId: created.id,
    description: `Thêm hồ sơ "${name}" (KH tiềm năng — đang ở BD Pipeline: ${pipelineStageLabel(entry.stage)}) để gắn người liên hệ`,
    newData: created,
  });
  return { ...created, created: true };
}

/**
 * Thẻ Pipeline chưa chọn người liên hệ → đặt người vừa gắn (chỉ khi còn trống, không ghi đè).
 * Trả về true nếu đã đặt.
 */
export async function fillPipelineContactIfEmpty(
  entry: PipelineCompanyLite,
  contact: { id: string; name: string },
  user: AppUser | null,
): Promise<boolean> {
  if (entry.contact_id) return false;
  const { data, error } = await supabase.from('crm_pipeline')
    .update({ contact_id: contact.id })
    .eq('id', entry.id).is('contact_id', null)
    .select('id');
  if (error || !data?.length) return false;
  await logActivity({
    user, action: 'update', table: 'crm_pipeline', recordId: entry.id,
    description: `Đặt người liên hệ "${contact.name}" cho thẻ Pipeline "${entry.company_name}"`,
    oldData: { contact_id: null }, newData: { contact_id: contact.id },
  });
  return true;
}
