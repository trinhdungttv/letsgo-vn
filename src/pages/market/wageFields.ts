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

/** Sắp xếp lại thứ tự hiển thị các trường lương (áp dụng mọi nơi dùng bảng chi tiết lương). */
export async function reorderWageFields(names: string[]): Promise<string | null> {
  for (let i = 0; i < names.length; i++) {
    const { error } = await supabase.from('wage_detail_fields').update({ sort_order: i + 1 }).eq('name', names[i]);
    if (error) return error.message;
  }
  return null;
}

/** Đổi khoá trong 1 object chi tiết lương, giữ nguyên thứ tự các khoá khác. */
function renameKey(d: Record<string, number> | null | undefined, from: string, to: string) {
  if (!d || !(from in d)) return null;
  return Object.fromEntries(Object.entries(d).map(([k, v]) => [k === from ? to : k, v]));
}

/**
 * Đổi TÊN 1 trường lương.
 *
 * Tên trường CHÍNH LÀ KHOÁ trong mọi bản ghi chi tiết lương đã nhập — clients / market_leads /
 * quote_requests (2 phía wage_detail + wage_detail_client) và từng NCC nằm bên trong
 * market_suppliers / suppliers. Đổi tên mà không viết lại các bản ghi đó thì số liệu đã nhập
 * sẽ "rơi" khỏi giao diện dù vẫn nằm nguyên trong database (đúng lỗi từng gặp khi đổi tên KCN).
 *
 * Thứ tự: viết lại DỮ LIỆU trước, đổi ĐỊNH NGHĨA sau. Nhờ vậy nếu đứt giữa chừng thì tên cũ
 * vẫn còn, bấm đổi lại lần nữa là chạy tiếp đúng các bản ghi chưa kịp đổi (idempotent).
 */
export async function renameWageField(oldName: string, newName: string): Promise<string | null> {
  const to = newName.trim();
  if (!to || to === oldName) return null;

  const existing = await fetchWageFields();
  if (existing.some(f => f === to)) return `Đã có trường tên "${to}" — đặt tên khác để không gộp nhầm số liệu`;

  // clients: 2 phía ở cấp công ty + 2 phía của từng NCC trong market_suppliers
  const { data: clients, error: ce } = await supabase.from('clients').select('id, wage_detail, wage_detail_client, market_suppliers');
  if (ce) return ce.message;
  for (const c of clients ?? []) {
    const patch: Record<string, unknown> = {};
    const wd = renameKey(c.wage_detail, oldName, to);
    const wdc = renameKey(c.wage_detail_client, oldName, to);
    if (wd) patch.wage_detail = wd;
    if (wdc) patch.wage_detail_client = wdc;
    const sups = c.market_suppliers as { wage_detail?: Record<string, number> | null; wage_detail_client?: Record<string, number> | null }[] | null;
    if (sups?.some(s => renameKey(s.wage_detail, oldName, to) || renameKey(s.wage_detail_client, oldName, to))) {
      patch.market_suppliers = sups.map(s => ({
        ...s,
        ...(renameKey(s.wage_detail, oldName, to) ? { wage_detail: renameKey(s.wage_detail, oldName, to) } : {}),
        ...(renameKey(s.wage_detail_client, oldName, to) ? { wage_detail_client: renameKey(s.wage_detail_client, oldName, to) } : {}),
      }));
    }
    if (!Object.keys(patch).length) continue;
    const { error } = await supabase.from('clients').update(patch).eq('id', c.id);
    if (error) return `Lỗi cập nhật khách hàng: ${error.message}`;
  }

  // market_leads: cùng cấu trúc, mảng NCC tên là `suppliers`
  const { data: leads, error: le } = await supabase.from('market_leads').select('id, wage_detail, wage_detail_client, suppliers');
  if (le) return le.message;
  for (const l of leads ?? []) {
    const patch: Record<string, unknown> = {};
    const wd = renameKey(l.wage_detail, oldName, to);
    const wdc = renameKey(l.wage_detail_client, oldName, to);
    if (wd) patch.wage_detail = wd;
    if (wdc) patch.wage_detail_client = wdc;
    const sups = l.suppliers as { wage_detail?: Record<string, number> | null; wage_detail_client?: Record<string, number> | null }[] | null;
    if (sups?.some(s => renameKey(s.wage_detail, oldName, to) || renameKey(s.wage_detail_client, oldName, to))) {
      patch.suppliers = sups.map(s => ({
        ...s,
        ...(renameKey(s.wage_detail, oldName, to) ? { wage_detail: renameKey(s.wage_detail, oldName, to) } : {}),
        ...(renameKey(s.wage_detail_client, oldName, to) ? { wage_detail_client: renameKey(s.wage_detail_client, oldName, to) } : {}),
      }));
    }
    if (!Object.keys(patch).length) continue;
    const { error } = await supabase.from('market_leads').update(patch).eq('id', l.id);
    if (error) return `Lỗi cập nhật công ty/dự án: ${error.message}`;
  }

  // quote_requests: bảng lương đã chốt của từng lần báo giá
  const { data: quotes, error: qe } = await supabase.from('quote_requests').select('id, wage_detail, wage_detail_client');
  if (qe) return qe.message;
  for (const q of quotes ?? []) {
    const patch: Record<string, unknown> = {};
    const wd = renameKey(q.wage_detail, oldName, to);
    const wdc = renameKey(q.wage_detail_client, oldName, to);
    if (wd) patch.wage_detail = wd;
    if (wdc) patch.wage_detail_client = wdc;
    if (!Object.keys(patch).length) continue;
    const { error } = await supabase.from('quote_requests').update(patch).eq('id', q.id);
    if (error) return `Lỗi cập nhật báo giá: ${error.message}`;
  }

  // Dữ liệu đã đổi hết → giờ mới đổi định nghĩa. payroll_input_type nằm cùng dòng nên giữ nguyên.
  const { error } = await supabase.from('wage_detail_fields').update({ name: to }).eq('name', oldName);
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
