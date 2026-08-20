// ============================================================================
// Danh mục chức vụ người liên hệ (bảng contact_roles, migration 143).
// Người dùng tự thêm / sửa / xoá ngay trong app — cùng mô hình với bảng
// industries. `contacts.role` vẫn là TEXT (không phải khoá ngoại), nên xoá một
// chức vụ khỏi danh mục KHÔNG làm mất chức vụ đã ghi trên hồ sơ từng người.
// ============================================================================
import { supabase } from './supabase';

export interface ContactRole {
  id: string;
  name: string;
  sort_order: number;
}

/** Danh sách mặc định, dùng khi DB chưa chạy migration 143. */
export const FALLBACK_ROLES = ['Giám đốc', 'HR Manager', 'Kế toán', 'Trưởng phòng', 'Nhân viên', 'Khác'];

export async function fetchContactRoles(): Promise<ContactRole[]> {
  const { data, error } = await supabase
    .from('contact_roles')
    .select('id, name, sort_order')
    .order('sort_order')
    .order('name');
  if (error || !data) {
    return FALLBACK_ROLES.map((name, i) => ({ id: `fallback-${i}`, name, sort_order: (i + 1) * 10 }));
  }
  return data as ContactRole[];
}

export async function addContactRole(name: string): Promise<string | null> {
  const clean = name.trim();
  if (!clean) return 'Tên chức vụ trống';
  const { error } = await supabase.from('contact_roles').insert({ name: clean });
  if (error) return /duplicate|unique/i.test(error.message) ? 'Chức vụ này đã có' : error.message;
  return null;
}

/**
 * Đổi tên một chức vụ. Cập nhật luôn `contacts.role` của những người đang giữ
 * tên cũ, nếu không họ sẽ trỏ về một chức vụ không còn tồn tại trong danh mục.
 */
export async function renameContactRole(id: string, oldName: string, newName: string): Promise<string | null> {
  const clean = newName.trim();
  if (!clean) return 'Tên chức vụ trống';
  if (clean === oldName) return null;
  const { error } = await supabase.from('contact_roles').update({ name: clean }).eq('id', id);
  if (error) return /duplicate|unique/i.test(error.message) ? 'Đã có chức vụ trùng tên' : error.message;
  const { error: upErr } = await supabase
    .from('contacts')
    .update({ role: clean, updated_at: new Date().toISOString() })
    .eq('role', oldName);
  if (upErr) return `Đã đổi tên nhưng chưa cập nhật được hồ sơ đang dùng: ${upErr.message}`;
  return null;
}

/** Đếm số người liên hệ đang mang chức vụ này — để cảnh báo trước khi xoá. */
export async function countContactsWithRole(name: string): Promise<number> {
  const { count } = await supabase
    .from('contacts')
    .select('id', { count: 'exact', head: true })
    .eq('role', name);
  return count || 0;
}

/** Xoá khỏi danh mục. Hồ sơ đang dùng vẫn giữ nguyên chữ chức vụ đã ghi. */
export async function deleteContactRole(id: string): Promise<string | null> {
  const { error } = await supabase.from('contact_roles').delete().eq('id', id);
  return error ? error.message : null;
}
