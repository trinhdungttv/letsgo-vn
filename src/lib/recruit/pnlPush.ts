// Ghi bảng đối soát phí giới thiệu thành 1 dòng doanh thu "Giới thiệu lao động" (service_type 'recruitment')
// trong P&L Dự án của đúng thẻ khách hàng + tháng — cùng quy tắc với nút "+ GTLD" ở Tài chính → P&L Dự án:
//   • P&L tháng đó phải có sẵn (tạo ở Tài chính — nơi tính khoán / chia lợi nhuận / chi nhánh theo lịch sử).
//     Không tự tạo P&L ở đây để khỏi lệch các quy tắc đó.
//   • Dự án chưa tách dòng hoá đơn mà đã nhập doanh thu tay → giữ phần đó thành dòng "Cho thuê lao động" trước,
//     để dòng GTLD CỘNG DỒN chứ không đè mất doanh thu cũ.
//   • projects_pnl.revenue = tổng các dòng.
import { supabase } from '../supabase';
import { updateSettlement } from './api';
import type { RecruitSettlement } from './types';

export interface PnlRow { id: string; client_id: string; month: string; revenue: number | null; total_man_days: number | null; invoice_mode?: string | null }
export interface PnlLineRow { id: string; amount: number | null; man_days: number | null; sort_order: number | null }

export interface PnlPushPlan {
  /** dòng "Cho thuê lao động" giữ lại doanh thu đã nhập tay (null = không cần) */
  preserve: { label: string; amount: number; man_days: number; sort_order: number; service_type: 'leasing' } | null;
  line: { label: string; amount: number; man_days: number; sort_order: number; service_type: 'recruitment' };
  newRevenue: number;
}

export function settlementLabel(projectName: string, period: string, people: number): string {
  const [y, m] = period.split('-');
  return `Giới thiệu lao động — ${projectName} T${Number(m)}/${y.slice(2)} (${people} người)`;
}

export function planPnlPush(pnl: PnlRow, lines: PnlLineRow[], amount: number, label: string): PnlPushPlan {
  const preserve = lines.length === 0 && ((pnl.revenue ?? 0) > 0 || (pnl.total_man_days ?? 0) > 0)
    ? { label: 'Cho thuê lao động', amount: pnl.revenue ?? 0, man_days: pnl.total_man_days ?? 0, sort_order: 0, service_type: 'leasing' as const }
    : null;
  const existing = preserve ? preserve.amount : lines.reduce((s, l) => s + (l.amount ?? 0), 0);
  const count = lines.length + (preserve ? 1 : 0);
  return {
    preserve,
    line: { label, amount, man_days: 0, sort_order: count, service_type: 'recruitment' },
    newRevenue: existing + amount,
  };
}

export type PushResult = { ok: true; pnlId: string; lineId: string } | { ok: false; message: string };

export async function pushSettlementToPnl(s: RecruitSettlement, projectName: string): Promise<PushResult> {
  if (!s.client_id) return { ok: false, message: 'Bảng đối soát chưa gắn thẻ khách hàng — gắn thẻ khách cho nhà máy / dự án rồi tạo lại' };
  if (s.pnl_line_id) return { ok: false, message: 'Bảng này đã ghi vào P&L rồi' };
  const { data: pnls, error: e1 } = await supabase.from('projects_pnl').select('id, client_id, month, revenue, total_man_days, invoice_mode')
    .eq('client_id', s.client_id).eq('month', s.period);
  if (e1) return { ok: false, message: e1.message };
  const pnl = (pnls ?? [])[0] as PnlRow | undefined;
  if (!pnl) return { ok: false, message: `Chưa có P&L tháng ${s.period} của khách này — mở Tài chính → P&L Dự án, thêm dự án tháng đó rồi bấm lại` };
  const { data: lines, error: e2 } = await supabase.from('pnl_revenue_lines').select('id, amount, man_days, sort_order').eq('pnl_id', pnl.id);
  if (e2) return { ok: false, message: e2.message };
  const plan = planPnlPush(pnl, (lines ?? []) as PnlLineRow[], s.total_amount, settlementLabel(projectName, s.period, s.line_count));
  // Đánh dấu bảng đối soát TRƯỚC (id dòng tạo sẵn) rồi mới ghi dòng: lỗi giữa chừng không bao giờ dẫn tới bấm lại
  // ghi trùng doanh thu — dòng chưa ghi được thì bảng hiện "dòng đã mất → bỏ đánh dấu để ghi lại".
  const lineId = crypto.randomUUID();
  await updateSettlement(s.id, { pnl_id: pnl.id, pnl_line_id: lineId });
  const fail = async (message: string): Promise<PushResult> => {
    await supabase.from('pnl_revenue_lines').delete().eq('id', lineId); // chỉ xoá đúng dòng vừa tạo (nếu đã kịp tạo)
    await updateSettlement(s.id, { pnl_id: null, pnl_line_id: null }).catch(() => {});
    return { ok: false, message };
  };
  if (plan.preserve) {
    // dòng giữ doanh thu cũ = đúng doanh thu đang có → để lại cũng không lệch số nếu bước sau lỗi
    const { error } = await supabase.from('pnl_revenue_lines').insert({ pnl_id: pnl.id, ...plan.preserve, period_label: null, invoice_date: null });
    if (error) return fail(error.message);
  }
  const { error: e3 } = await supabase.from('pnl_revenue_lines')
    .insert({ id: lineId, pnl_id: pnl.id, ...plan.line, period_label: null, invoice_date: null });
  if (e3) return fail(e3.message);
  const { error: e4 } = await supabase.from('projects_pnl').update({ revenue: plan.newRevenue, updated_at: new Date().toISOString() }).eq('id', pnl.id);
  if (e4) return fail(e4.message);
  return { ok: true, pnlId: pnl.id, lineId };
}

/** Dòng doanh thu đã ghi còn không (người dùng có thể đã xoá ở Tài chính). */
export async function pnlLineExists(lineId: string): Promise<boolean> {
  const { data } = await supabase.from('pnl_revenue_lines').select('id').eq('id', lineId);
  return (data ?? []).length > 0;
}
