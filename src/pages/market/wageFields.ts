// Danh sách "trường lương chi tiết" dùng CHUNG toàn hệ thống (Lương cơ bản, Phụ cấp…).
// Thêm/xoá 1 trường ở đây thì mọi bảng chi tiết lương (Let's Go VN lẫn từng NCC, ở mọi
// công ty/dự án) đều đổi theo — migration 101.
//
// ĐƠN VỊ: giá trị luôn lưu DB bằng ĐỒNG, và từ migration 126 thì ô nhập trên form cũng bằng
// ĐỒNG (trước đây nhập bằng triệu rồi ×1.000.000 khi lưu). Đổi để khớp với "Tính bảng lương" —
// 2 nơi cùng nói về 1 con số mà khác đơn vị thì rất dễ nhập nhầm gấp/chia 1 triệu lần.
// Dữ liệu CŨ không cần chuyển đổi: DB vốn đã lưu bằng đồng, chỉ tầng hiển thị đổi.
import { supabase } from '../../lib/supabase';
import type { PayrollInputType } from '../../lib/payroll/coefficients';

/** 1 trường lương chi tiết + loại đơn giá theo luật mà nó tương ứng (migration 126).
 *  payrollInputType = null → khoản phụ cấp thuần (ăn ca, xăng xe…), không quy ra đơn giá giờ được. */
export interface WageField { name: string; payrollInputType: PayrollInputType | null }

export async function fetchWageFieldRows(): Promise<WageField[]> {
  const { data, error } = await supabase.from('wage_detail_fields').select('name, payroll_input_type').order('sort_order').order('created_at');
  if (error || !data) return [];
  return data.map(d => ({ name: d.name as string, payrollInputType: (d.payroll_input_type ?? null) as PayrollInputType | null }));
}

export async function fetchWageFields(): Promise<string[]> {
  return (await fetchWageFieldRows()).map(f => f.name);
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

/** Gán/bỏ loại đơn giá theo luật cho 1 trường lương — quyết định trường đó có suy ngược ra
 *  đơn giá giờ (SHR) được hay không khi dùng ở "Tính bảng lương". */
export async function setWageFieldPayrollType(name: string, payrollInputType: PayrollInputType | null): Promise<string | null> {
  const { error } = await supabase.from('wage_detail_fields').update({ payroll_input_type: payrollInputType }).eq('name', name);
  return error ? error.message : null;
}

/** Đổi qua lại giữa giá trị lưu DB và giá trị trên form — cả hai đều là ĐỒNG nên chỉ đổi kiểu
 *  dữ liệu, không nhân chia. Giữ lại 2 hàm này (thay vì bỏ hẳn) để mọi nơi nhập lương vẫn đi
 *  qua 1 chỗ duy nhất, sau này muốn đổi cách hiển thị chỉ sửa ở đây. */
export const wageDetailToStrings = (d: Record<string, number> | null | undefined): Record<string, string> =>
  Object.fromEntries(Object.entries(d ?? {}).map(([k, v]) => [k, String(v)]));
export const wageDetailToNumbers = (d: Record<string, string>): Record<string, number> =>
  Object.fromEntries(Object.entries(d).filter(([, v]) => v.trim()).map(([k, v]) => [k, parseFloat(v) || 0]));
