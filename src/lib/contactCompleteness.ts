// Người liên hệ tạo nhanh (thường chỉ có họ tên) → nhắc bổ sung các thông tin tối thiểu để liên lạc & chăm sóc.
// Dùng ở ô "Người liên hệ (CSKH)" của form Thêm công ty và hồ sơ công ty (CRM Pipeline).
import type { Contact } from './types';
import { isBirthdayDraft } from './birthday';

export const CONTACT_ESSENTIALS = [
  { key: 'role', label: 'chức vụ' },
  { key: 'phone', label: 'số điện thoại' },
  { key: 'email', label: 'email' },
  { key: 'birthday', label: 'ngày sinh' },
] as const;

/** Tên các thông tin còn trống (theo thứ tự CONTACT_ESSENTIALS) — rỗng = đã đủ. */
export function contactMissingInfo(c: Partial<Pick<Contact, 'role' | 'phone' | 'email' | 'birthday'>>): string[] {
  // Ngày sinh đang nhập dở (bản nháp '~…', xem lib/birthday) chưa tính là có
  return CONTACT_ESSENTIALS.filter(f => {
    const v = String(c[f.key] ?? '').trim();
    return !v || (f.key === 'birthday' && isBirthdayDraft(v));
  }).map(f => f.label);
}
