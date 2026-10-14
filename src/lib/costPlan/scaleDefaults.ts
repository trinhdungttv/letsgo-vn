// Quy mô chuẩn (số người × số công / tháng) để ước tính lợi nhuận — DÙNG CHUNG cho mọi phương án, riêng cho
// Cung ứng và Giới thiệu lao động. Người dùng nhập số ở phương án nào thì số đó thành quy mô chuẩn cho các phương án
// sau, để các phương án so được với nhau (trước đây mỗi phương án lấy số LĐ dự kiến của từng khách nên mỗi nơi một số).
// Lưu ở bảng app_settings (key/value, đã có sẵn) → cả công ty dùng chung, không cần migration.
import { supabase } from '../supabase';
import type { ServiceKind } from './referral';

export interface Scale { workers: number; simDays: number }
export type ScaleDefaults = Record<ServiceKind, Scale>;

export const SCALE_KEY = 'cost_plan_scale_defaults';
// Mặc định: Cung ứng = 1 người × 20 công (để xem lợi nhuận / công là chính; số người thật đổi ở từng phương án khi cần).
export const FALLBACK_SCALE: ScaleDefaults = { supply: { workers: 1, simDays: 20 }, referral: { workers: 20, simDays: 26 } };
/** Đời dữ liệu: v2 = chuẩn chỉ đổi khi người dùng bấm "Đặt làm chuẩn". Giá trị đời 1 (tự đổi theo số vừa gõ) bị bỏ, về mặc định. */
const STORE_V = 2;

const clampScale = (raw: unknown, d: Scale): Scale => {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Scale>;
  const w = Math.round(Number(r.workers)), s = Math.round(Number(r.simDays));
  return {
    workers: Number.isFinite(w) && w >= 1 ? Math.min(5000, w) : d.workers,
    simDays: Number.isFinite(s) && s >= 1 ? Math.min(31, s) : d.simDays,
  };
};

/** Đọc giá trị lưu trong app_settings (chuỗi JSON, có thể hỏng/thiếu) — không bao giờ ném lỗi. */
export function parseScaleDefaults(raw: string | null | undefined): ScaleDefaults {
  let obj: Record<string, unknown> = {};
  try { obj = raw ? JSON.parse(raw) : {}; } catch { obj = {}; }
  if (obj.v !== STORE_V) obj = {};
  return { supply: clampScale(obj.supply, FALLBACK_SCALE.supply), referral: clampScale(obj.referral, FALLBACK_SCALE.referral) };
}

export async function loadScaleDefaults(): Promise<ScaleDefaults> {
  const { data } = await supabase.from('app_settings').select('value').eq('key', SCALE_KEY).maybeSingle();
  return parseScaleDefaults((data as { value: string | null } | null)?.value);
}

export async function saveScaleDefaults(d: ScaleDefaults): Promise<void> {
  const { error } = await supabase.from('app_settings')
    .upsert({ key: SCALE_KEY, value: JSON.stringify({ ...d, v: STORE_V }), updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) throw error;
}
