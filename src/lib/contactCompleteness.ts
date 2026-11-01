// Người liên hệ tạo nhanh (thường chỉ có họ tên) → nhắc bổ sung các thông tin tối thiểu để liên lạc & chăm sóc.
// Dùng ở ô "Người liên hệ (CSKH)" của form Thêm công ty và hồ sơ công ty (CRM Pipeline).
import type { Contact } from './types';

export const CONTACT_ESSENTIALS = [
  { key: 'role', label: 'chức vụ' },
  { key: 'phone', label: 'số điện thoại' },
  { key: 'email', label: 'email' },
  { key: 'birthday', label: 'ngày sinh' },
] as const;

/** Tên các thông tin còn trống (theo thứ tự CONTACT_ESSENTIALS) — rỗng = đã đủ. */
export function contactMissingInfo(c: Partial<Pick<Contact, 'role' | 'phone' | 'email' | 'birthday'>>): string[] {
  return CONTACT_ESSENTIALS.filter(f => !String(c[f.key] ?? '').trim()).map(f => f.label);
}
