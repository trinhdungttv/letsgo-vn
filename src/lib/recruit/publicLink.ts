// Link ứng tuyển công khai: #/apply/<mã dự án>[/<id CTV>] — mở được không cần đăng nhập (giống link Phương án giá).
// Người ngoài chỉ gọi được 2 hàm recruit_public_get / recruit_public_apply (migration 181).
import qrcode from 'qrcode-generator';
import { supabase } from '../supabase';

export function parseApplyHash(hash: string): { code: string; ref: string | null } | null {
  const m = /^#\/apply\/([A-Za-z0-9]{6})(?:\/([0-9a-fA-F-]{36}))?\/?$/.exec(hash);
  return m ? { code: m[1].toUpperCase(), ref: m[2] ?? null } : null;
}

export function applyUrl(code: string, ref?: string | null, origin = window.location.origin): string {
  return `${origin}/#/apply/${code}${ref ? `/${ref}` : ''}`;
}

/** Mã QR dạng SVG (chuỗi) — in lên tờ rơi / băng rôn / gửi Zalo. */
export function qrSvg(text: string, cell = 6, margin = 4): string {
  const qr = qrcode(0, 'M');
  qr.addData(text, 'Byte');
  qr.make();
  return qr.createSvgTag({ cellSize: cell, margin, scalable: true });
}

export interface PublicPosition {
  id: string; title: string; group_code: string; site_ids: string[]; salary_min: number | null; salary_max: number | null;
  salary_note: string; hours_per_week: number | null; shift_note: string; description: string; requirements: string; benefits: string;
  education_min: string; age_min: number | null; age_max: number | null; gender_pref: 'any' | 'male' | 'female'; cleanroom: boolean;
}
export interface PublicProject {
  project: { name: string; no_worker_fee: boolean };
  sites: { id: string; name: string; zone_name: string; address: string }[];
  positions: PublicPosition[];
}

export async function fetchPublicProject(code: string): Promise<PublicProject | null> {
  const { data, error } = await supabase.rpc('recruit_public_get', { p_code: code });
  if (error) throw new Error(error.message);
  return (data as PublicProject | null) ?? null;
}

export type ApplyReason = 'closed' | 'name' | 'phone' | 'consent' | 'busy';
export const APPLY_REASON_TEXT: Readonly<Record<ApplyReason, string>> = {
  closed: 'Đợt tuyển này đã đóng.',
  name: 'Vui lòng nhập họ tên.',
  phone: 'Số điện thoại phải có 10 số, bắt đầu bằng 0.',
  consent: 'Vui lòng đồng ý để chúng tôi liên hệ giới thiệu việc làm.',
  busy: 'Hệ thống đang nhận quá nhiều hồ sơ, vui lòng thử lại sau ít phút.',
};

export async function submitPublicApplication(code: string, data: Record<string, unknown>): Promise<{ ok: boolean; reason?: ApplyReason }> {
  const { data: res, error } = await supabase.rpc('recruit_public_apply', { p_code: code, p_data: data });
  if (error) throw new Error(error.message);
  return res as { ok: boolean; reason?: ApplyReason };
}
