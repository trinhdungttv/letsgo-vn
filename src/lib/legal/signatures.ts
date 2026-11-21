// KHO CHỮ KÝ CHUNG (Pháp lý → tab "Chữ ký", migration 230). Ảnh GỐC tải lên 1 lần. Chữ ký KHÔNG gắn cố định với pháp nhân
// (người ký luân chuyển): khi làm giấy tờ, người làm chọn chữ ký của ai ký lần đó. Tách nền / làm đậm / màu mực làm lúc dùng.
import { supabase } from '../supabase';
import { cutoutDataUrl } from '../imageCutout';

export const SIG_HINT = 'Chưa chạy migration 230 (kho chữ ký) trên Supabase — chạy file supabase/migrations/20261116110000_230_legal_signatures.sql rồi tải lại trang.';

export interface SigSettings { cutout: boolean; ink: number; /** chức danh in dưới tên khi người này ký */ title: string }
export interface LegalSignature { id: string; owner_name: string; original: string; settings: SigSettings; updated_by: string | null; updated_at: string }
export interface SignerOption { id: string; owner_name: string; title: string }

const fail = (e: { message?: string; code?: string }): never => {
  if (e.code === 'PGRST202' || e.code === '42883' || /could not find the function|schema cache/i.test(e.message ?? '')) throw new Error(SIG_HINT);
  throw new Error(e.message ?? 'Lỗi không xác định');
};

export function normalizeSettings(raw: unknown): SigSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const ink = Number(r.ink);
  return { cutout: r.cutout !== false, ink: Number.isFinite(ink) ? Math.min(1, Math.max(0, ink)) : 0.5, title: typeof r.title === 'string' ? r.title : '' };
}

/** Admin: toàn bộ kho kèm ảnh gốc. */
export async function listSignatures(token: string): Promise<LegalSignature[]> {
  const { data, error } = await supabase.rpc('legal_signature_list', { p_token: token });
  if (error) fail(error);
  return ((data ?? []) as Record<string, unknown>[]).map(r => ({
    id: String(r.id), owner_name: String(r.owner_name ?? ''), original: String(r.original ?? ''), settings: normalizeSettings(r.settings),
    updated_by: (r.updated_by as string) ?? null, updated_at: String(r.updated_at ?? ''),
  }));
}

/** Mọi tài khoản: danh sách để CHỌN người ký (không có ảnh). Chưa chạy migration → rỗng. */
export async function listSigners(token: string): Promise<SignerOption[]> {
  const { data, error } = await supabase.rpc('legal_signature_pick_list', { p_token: token });
  if (error) return [];
  return ((data ?? []) as Record<string, unknown>[]).map(r => ({ id: String(r.id), owner_name: String(r.owner_name ?? ''), title: String(r.title ?? '') }));
}

export async function saveSignature(token: string, a: { id?: string | null; owner: string; original?: string; settings: SigSettings }): Promise<string> {
  const { data, error } = await supabase.rpc('legal_signature_save', { p_token: token, p_id: a.id ?? null, p_owner: a.owner, p_original: a.original ?? null, p_settings: a.settings });
  if (error) fail(error);
  return (data as { id: string }).id;
}

export async function deleteSignature(token: string, id: string): Promise<void> {
  const { error } = await supabase.rpc('legal_signature_delete', { p_token: token, p_id: id });
  if (error) fail(error);
}

/** Ảnh dùng cho giấy tờ: đã tách nền (nếu bật). Độ đậm / màu mực áp lúc dựng giấy tờ. */
export const processSignature = (s: Pick<LegalSignature, 'original' | 'settings'>) => (s.settings.cutout ? cutoutDataUrl(s.original) : Promise.resolve(s.original));

/** Lấy ảnh 1 chữ ký để làm giấy tờ — server ghi nhật ký, admin được báo (migration 230). */
export async function fetchSignerStamp(token: string, id: string, purpose: string, context: string): Promise<{ alertId: number; image: string; ink: number }> {
  const { data, error } = await supabase.rpc('legal_signature_stamp', { p_token: token, p_id: id, p_purpose: purpose, p_context: context });
  if (error) fail(error);
  const r = data as { alert_id: number; original: string; settings: unknown };
  const settings = normalizeSettings(r.settings);
  return { alertId: r.alert_id, image: await processSignature({ original: r.original, settings }), ink: settings.ink };
}
