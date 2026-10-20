// ============================================================================
// CSKH — "Điều cần nhớ" (contacts.remember_notes, jsonb) — port PRM remember.ts
// Làm sạch trước khi lưu: cắt khoảng trắng, bỏ mục rỗng, cắt ≤ 500 ký tự/mục,
// bỏ khoá lạ. Tổng ≤ 8KB do DB kiểm (migration 169).
// ============================================================================
import type { RememberKey, RememberNotes } from './types';

export const REMEMBER_KEYS: readonly RememberKey[] = ['family', 'likes', 'avoid', 'work', 'other'];
export const REMEMBER_MAX_CHARS = 500;

/** Ví dụ cụ thể cho ô nhập (placeholder). */
export const REMEMBER_PLACEHOLDER: Readonly<Record<RememberKey, string>> = {
  family: 'VD: Vợ là cô giáo, con gái học lớp 5, quê Nam Định',
  likes: 'VD: Thích cà phê đen không đường, mê golf cuối tuần',
  avoid: 'VD: Không uống rượu bia, đừng hỏi chuyện công ty cũ',
  work: 'VD: Đang mở xưởng 2 ở VSIP, cần thêm 50 LĐ quý 1',
  other: 'VD: Hay đi công tác Hàn Quốc đầu tháng',
};

export function cleanRememberNotes(notes: RememberNotes | null | undefined): RememberNotes {
  const out: RememberNotes = {};
  if (!notes || typeof notes !== 'object') return out;
  for (const key of REMEMBER_KEYS) {
    const raw = (notes as Record<string, unknown>)[key];
    const value = typeof raw === 'string' ? raw.trim().slice(0, REMEMBER_MAX_CHARS) : '';
    if (value !== '') out[key] = value;
  }
  return out;
}

export function hasRememberNotes(notes: RememberNotes | null | undefined): boolean {
  return Object.keys(cleanRememberNotes(notes)).length > 0;
}
