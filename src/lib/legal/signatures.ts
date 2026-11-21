// KHO CHỮ KÝ (Pháp lý → tab "Chữ ký", migration 230). Ảnh GỐC tải lên 1 lần; chọn chữ ký đi với pháp nhân nào.
// Khi lưu, app tách nền + (khi dùng) làm đậm / lên màu mực rồi ĐẨY bản đã xử lý sang bộ ký/dấu của pháp nhân (quote_entities) —
// giấy tờ (báo giá, danh sách vào cổng) vẫn đọc ở đó nên không phải đổi gì.
import { supabase } from '../supabase';
import { cutoutDataUrl } from '../imageCutout';
import { saveEntity } from '../costPlan/api';
import type { QuoteEntity } from '../costPlan/entity';

export const SIG_HINT = 'Chưa chạy migration 230 (kho chữ ký) trên Supabase — chạy file supabase/migrations/20261116110000_230_legal_signatures.sql rồi tải lại trang.';

export interface SigSettings { cutout: boolean; ink: number }
export interface LegalSignature {
  id: string; owner_name: string; original: string; settings: SigSettings; entity_ids: string[];
  updated_by: string | null; updated_at: string;
}

const fail = (e: { message?: string; code?: string }): never => {
  if (e.code === 'PGRST202' || e.code === '42883' || /could not find the function|schema cache/i.test(e.message ?? '')) throw new Error(SIG_HINT);
  throw new Error(e.message ?? 'Lỗi không xác định');
};

export function normalizeSettings(raw: unknown): SigSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const ink = Number(r.ink);
  return { cutout: r.cutout !== false, ink: Number.isFinite(ink) ? Math.min(1, Math.max(0, ink)) : 0.5 };
}

export async function listSignatures(token: string): Promise<LegalSignature[]> {
  const { data, error } = await supabase.rpc('legal_signature_list', { p_token: token });
  if (error) fail(error);
  return ((data ?? []) as Record<string, unknown>[]).map(r => ({
    id: String(r.id), owner_name: String(r.owner_name ?? ''), original: String(r.original ?? ''), settings: normalizeSettings(r.settings),
    entity_ids: Array.isArray(r.entity_ids) ? r.entity_ids.map(String) : [], updated_by: (r.updated_by as string) ?? null, updated_at: String(r.updated_at ?? ''),
  }));
}

export async function saveSignature(token: string, a: { id?: string | null; owner: string; original?: string; settings: SigSettings; entityIds: string[] }): Promise<string> {
  const { data, error } = await supabase.rpc('legal_signature_save', {
    p_token: token, p_id: a.id ?? null, p_owner: a.owner, p_original: a.original ?? null, p_settings: a.settings, p_entity_ids: a.entityIds,
  });
  if (error) fail(error);
  return (data as { id: string }).id;
}

export async function deleteSignature(token: string, id: string): Promise<void> {
  const { error } = await supabase.rpc('legal_signature_delete', { p_token: token, p_id: id });
  if (error) fail(error);
}

/** Ảnh dùng cho giấy tờ: đã tách nền (nếu bật). Độ đậm / màu mực áp lúc dựng giấy tờ qua layout.sigInk. */
export const processSignature = (s: Pick<LegalSignature, 'original' | 'settings'>) => (s.settings.cutout ? cutoutDataUrl(s.original) : Promise.resolve(s.original));

/**
 * Đẩy chữ ký sang bộ ký/dấu của pháp nhân (sig = null → gỡ chữ ký khỏi pháp nhân).
 * Ghi tên chủ chữ ký = người đại diện hiện tại ở Pháp lý (gán rõ ràng = chữ ký này đi với pháp nhân này); đổi người đại diện sau này
 * thì giấy tờ báo chữ ký cũ không còn khớp.
 */
export async function pushSignature(token: string, e: QuoteEntity, sig: LegalSignature | null): Promise<void> {
  const rep = e.legal?.legal_rep.trim() || sig?.owner_name.trim() || '';
  await saveEntity(token, {
    id: e.stamp_id, label: e.own.label || e.label, legalEntityId: e.legal_id,
    data: sig && rep ? { ...e.own.data, signerName: rep } : e.own.data,
    layout: sig ? { ...e.layout, sigInk: sig.settings.ink } : e.layout,
    signature: sig ? await processSignature(sig) : null,
  });
}
