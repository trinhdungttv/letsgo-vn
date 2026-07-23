// Danh sách "trường lương chi tiết" dùng CHUNG toàn hệ thống (Lương cơ bản, Phụ cấp…).
// Thêm/xoá 1 trường ở đây thì mọi bảng chi tiết lương (Let's Go VN lẫn từng NCC, ở mọi
// công ty/dự án) đều đổi theo — migration 101.
import { supabase } from '../../lib/supabase';

export async function fetchWageFields(): Promise<string[]> {
  const { data, error } = await supabase.from('wage_detail_fields').select('name').order('sort_order').order('created_at');
  if (error || !data) return [];
  return data.map(d => d.name as string);
}

export async function addWageField(name: string): Promise<string | null> {
  const { error } = await supabase.from('wage_detail_fields').insert({ name });
  if (error && !/duplicate|unique/i.test(error.message)) return error.message;
  return null;
}

export async function deleteWageField(name: string): Promise<string | null> {
  const { error } = await supabase.from('wage_detail_fields').delete().eq('name', name);
  return error ? error.message : null;
}

/** Đổi qua lại giữa giá trị lưu DB (VNĐ) và giá trị hiển thị/nhập trên form (triệu). */
export const wageDetailToStrings = (d: Record<string, number> | null | undefined): Record<string, string> =>
  Object.fromEntries(Object.entries(d ?? {}).map(([k, v]) => [k, String(v / 1_000_000)]));
export const wageDetailToNumbers = (d: Record<string, string>): Record<string, number> =>
  Object.fromEntries(Object.entries(d).filter(([, v]) => v.trim()).map(([k, v]) => [k, parseFloat(v) * 1_000_000]));
