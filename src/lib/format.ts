import type { ProjectPnlType, CostPayer, ClientManagerHistory, ClientBranchHistory, BranchTypeHistory, BranchType } from './types';

export function formatCurrency(value: number): string {
  if (value >= 1_000_000_000) return (value / 1_000_000_000).toFixed(1) + ' tỷ';
  if (value >= 1_000_000) return (value / 1_000_000).toFixed(0) + ' tr';
  return value.toLocaleString('vi-VN') + ' ₫';
}

export function formatCurrencyFull(value: number): string {
  return value.toLocaleString('vi-VN') + ' ₫';
}

export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  const [y, m, d] = dateStr.split('T')[0].split('-');
  return `${d}/${m}/${y}`;
}

export function daysUntil(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const diff = new Date(dateStr).getTime() - new Date().setHours(0, 0, 0, 0);
  return Math.ceil(diff / 86400000);
}

// Lấy số LĐ của tuần cuối cùng (lớn nhất) thuộc tháng `month` (1-12).
// Dùng regex khớp chính xác "TmWw" để tránh nhầm vd "T1" khớp luôn cả "T10/T11/T12".
export function getMonthLast(
  hist: { week_label: string; count: number }[],
  month: number
): number | null {
  const re = new RegExp(`^T${month}W(\\d+)$`);
  const entries = hist
    .map(h => ({ h, m: h.week_label.match(re) }))
    .filter((x): x is { h: typeof hist[number]; m: RegExpMatchArray } => !!x.m)
    .sort((a, b) => Number(a.m[1]) - Number(b.m[1]));
  return entries.length ? entries[entries.length - 1].h.count : null;
}

// Trả về `n` tháng gần nhất tính theo ngày hôm nay (cũ -> mới, tháng hiện tại ở cuối).
// Dùng để tự động hiển thị "Theo tháng" / "Báo cáo tăng giảm theo tháng" theo thời gian thực,
// không hardcode tên tháng.
export function recentMonths(n = 3): { month: number; year: number; label: string }[] {
  const now = new Date();
  const result: { month: number; year: number; label: string }[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const month = d.getMonth() + 1;
    const year = d.getFullYear();
    result.push({ month, year, label: `T${month}/${year}` });
  }
  return result;
}

// Sắp xếp lịch sử lao động theo đúng trình tự thời gian thực tế (cũ -> mới),
// dựa trên kỳ (tháng/tuần) ghi trong week_label (dạng "TmWw") — KHÔNG theo
// thứ tự nhập (created_at), vì người dùng có thể nhập các tháng không theo
// thứ tự (vd: nhập T5 trước rồi mới nhập T1-T4).
export function sortLaborHistory<T extends { week_label: string; created_at: string }>(entries: T[]): T[] {
  const sortKey = (label: string): number => {
    const wIdx = label.indexOf('W');
    const month = parseInt(label.slice(1, wIdx), 10);
    const week = parseInt(label.slice(wIdx + 1), 10);
    return month * 10 + week;
  };
  return [...entries].sort((a, b) => sortKey(a.week_label) - sortKey(b.week_label) || a.created_at.localeCompare(b.created_at));
}

// ---------------------------------------------------------------------------
// TUẦN LỊCH THẬT (chuẩn hoá 16/07/2026):
//   - Tuần chạy Thứ 2 → CN; hiển thị Thứ 2 → Thứ 7 (CN nghỉ, không tính công).
//   - Tuần được phép vắt qua 2 tháng (ví dụ 29/6–4/7).
//   - Tuần thuộc THÁNG CHỨA NGÀY THỨ 5 của tuần đó (chuẩn ISO) — tức tháng
//     chiếm đa số ngày làm việc. Ví dụ 29/6–4/7 → T7W1.
//   - Nhãn giữ nguyên format TmWn để tương thích dữ liệu client_labor_history.
// ---------------------------------------------------------------------------

// Thứ 2 của tuần chứa ngày d (00:00 local).
function mondayOf(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); // getDay: CN=0 → Mon=0..Sun=6
  return x;
}

// Ngày Thứ 5 đầu tiên của tháng — mốc xác định tuần W1.
function firstThursday(year: number, month: number): Date {
  const d = new Date(year, month - 1, 1);
  d.setDate(1 + ((4 - d.getDay() + 7) % 7));
  return d;
}

// Thông tin tuần lịch thật chứa ngày `d`.
export function weekInfoOf(d: Date): { year: number; month: number; week: number; label: string } {
  const thu = mondayOf(d);
  thu.setDate(thu.getDate() + 3);
  const year = thu.getFullYear();
  const month = thu.getMonth() + 1;
  const week = Math.floor((thu.getDate() - firstThursday(year, month).getDate()) / 7) + 1;
  return { year, month, week, label: `T${month}W${week}` };
}

export function getCurrentWeekLabel(): string {
  return weekInfoOf(new Date()).label;
}

// Returns the week labels (TmWn) that actually exist in a given month, ascending (W1 first).
// Tháng có đúng 4 hoặc 5 tuần thật (đếm theo số ngày Thứ 5 trong tháng).
export function weekLabelsForMonth(year: number, month: number): string[] {
  const first = firstThursday(year, month);
  const labels: string[] = [];
  const d = new Date(first);
  while (d.getMonth() === first.getMonth()) {
    labels.push(`T${month}W${labels.length + 1}`);
    d.setDate(d.getDate() + 7);
  }
  return labels;
}

// Số tuần tính từ đầu năm (chuẩn ISO — đánh số theo ngày Thứ 5, khớp với quy tắc
// gán tháng ở trên). Ví dụ T7W3/2026 → 29.
export function weekOfYear(label: string, year?: number): number {
  const y = year ?? new Date().getFullYear();
  const wIdx = label.indexOf('W');
  if (wIdx < 0) return 0;
  const m = parseInt(label.slice(1, wIdx), 10);
  const w = parseInt(label.slice(wIdx + 1), 10);
  const thu = firstThursday(y, m);
  thu.setDate(thu.getDate() + (w - 1) * 7);
  const doy = Math.round((thu.getTime() - new Date(thu.getFullYear(), 0, 1).getTime()) / 86400000) + 1;
  return Math.ceil(doy / 7);
}

// Nhãn tuần đầy đủ cho dropdown: "T7W3 - W29 (13/7-18/7)".
export function weekLabelFull(label: string, year?: number): string {
  return `${label} - W${weekOfYear(label, year)} (${weekDateRange(label, year)})`;
}

// Nhãn tuần liền trước (theo tuần lịch thật — lùi Thứ 2 đi 7 ngày).
export function prevWeekLabel(label: string, year?: number): string | null {
  const y = year ?? new Date().getFullYear();
  const wIdx = label.indexOf('W');
  if (wIdx < 0) return null;
  const m = parseInt(label.slice(1, wIdx), 10);
  const w = parseInt(label.slice(wIdx + 1), 10);
  const mon = firstThursday(y, m);
  mon.setDate(mon.getDate() + (w - 1) * 7 - 3 - 7);
  return weekInfoOf(mon).label;
}

// Khoảng ngày làm việc Thứ 2 → Thứ 7 của tuần; ghi kèm tháng ở cả 2 đầu vì tuần
// có thể vắt qua 2 tháng (ví dụ "29/6-4/7").
export function weekDateRange(label: string, year?: number): string {
  const y = year ?? new Date().getFullYear();
  const wIdx = label.indexOf('W');
  if (wIdx < 0) return '';
  const m = parseInt(label.slice(1, wIdx), 10);
  const w = parseInt(label.slice(wIdx + 1), 10);
  const mon = firstThursday(y, m);
  mon.setDate(mon.getDate() + (w - 1) * 7 - 3);
  const sat = new Date(mon);
  sat.setDate(sat.getDate() + 5);
  return `${mon.getDate()}/${mon.getMonth() + 1}-${sat.getDate()}/${sat.getMonth() + 1}`;
}

// Returns week labels (TmWn) grouped by month for the past `monthsBack` months (incl. current),
// newest first. Current month only includes weeks up to the current week (no future weeks).
export function recentWeekLabels(monthsBack = 6): { month: string; labels: string[] }[] {
  const nowInfo = weekInfoOf(new Date());
  const curMonday = mondayOf(new Date()).getTime();
  const groups: { month: string; labels: string[] }[] = [];
  for (let i = 0; i < monthsBack; i++) {
    const d = new Date(nowInfo.year, nowInfo.month - 1 - i, 1);
    const m = d.getMonth() + 1;
    const y = d.getFullYear();
    // Chỉ giữ các tuần đã bắt đầu (Thứ 2 của tuần ≤ Thứ 2 tuần hiện tại).
    const labels = weekLabelsForMonth(y, m)
      .filter((_, idx) => {
        const mon = firstThursday(y, m);
        mon.setDate(mon.getDate() + idx * 7 - 3);
        return mon.getTime() <= curMonday;
      })
      .reverse();
    groups.push({ month: `Tháng ${m}/${y}`, labels });
  }
  return groups;
}

// Trả về `n` tuần kế tiếp ngay sau tuần hiện tại (chưa nằm trong recentWeekLabels),
// nhóm theo tháng, mới nhất (xa nhất trong tương lai) ở đầu — cùng thứ tự với
// recentWeekLabels. Dùng cho nút "+ Tuần tiếp theo" trong "Nhập nhanh số lao động":
// thêm từng tuần một (kể cả khi cần sang tháng mới), thay vì tạo nguyên 1 tháng.
export function nextWeekLabels(n: number): { month: string; labels: string[] }[] {
  if (n <= 0) return [];
  const mon = mondayOf(new Date());
  const flat: { groupKey: string; label: string }[] = [];
  for (let i = 1; i <= n; i++) {
    const d = new Date(mon);
    d.setDate(d.getDate() + i * 7);
    const info = weekInfoOf(d);
    flat.push({ groupKey: `Tháng ${info.month}/${info.year}`, label: info.label });
  }
  const groups: { month: string; labels: string[] }[] = [];
  for (const { groupKey, label } of flat) {
    const last = groups[groups.length - 1];
    if (last && last.month === groupKey) last.labels.push(label);
    else groups.push({ month: groupKey, labels: [label] });
  }
  groups.reverse();
  for (const g of groups) g.labels.reverse();
  return groups;
}

// "2026-06" -> "Tháng 6/2026"
export function monthLabel(month: string): string {
  const [y, m] = month.split('-');
  return `Tháng ${Number(m)}/${y}`;
}

// Shifts a "YYYY-MM" month string by `delta` months (negative = past).
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Trả về người quản lý đang phụ trách tại tháng `month` ("YYYY-MM"), dựa trên lịch sử bàn giao.
export function getManagerForMonth(history: ClientManagerHistory[], month: string): string | null {
  const applicable = history.filter(h => h.effective_from <= month);
  if (!applicable.length) return null;
  return applicable.reduce((a, b) => (a.effective_from > b.effective_from ? a : b)).manager_name;
}

export function getBranchForMonth(history: ClientBranchHistory[], month: string): string | null {
  const applicable = history.filter(h => h.effective_from <= month);
  if (!applicable.length) return null;
  return applicable.reduce((a, b) => (a.effective_from > b.effective_from ? a : b)).branch_name;
}

export function fmtTrieu(value: number): string {
  return Math.round(value).toLocaleString('vi-VN');
}

export function getBranchTypeForMonth(history: BranchTypeHistory[], month: string): { type: BranchType; manager: string | null; lgPct: number; cnPct: number; khoanMode: 'common' | 'per_project' } | null {
  const applicable = history.filter(h => h.effective_from <= month);
  if (!applicable.length) return null;
  const latest = applicable.reduce((a, b) => (a.effective_from > b.effective_from ? a : b));
  const khoanMode = latest.notes?.includes('[per_project]') ? 'per_project' as const : 'common' as const;
  return { type: latest.branch_type as BranchType, manager: latest.manager_name, lgPct: latest.lg_pct, cnPct: latest.cn_pct, khoanMode };
}

// P&L calculation shared by the Finance Workspace project tabs.
// hohOpts: phần doanh thu "HOH" (xuất hộ khách hàng, lấy phí) trong dự án — tách riêng khỏi
// khoán/lương thông thường, mặc định 100% về Let's Go VN, có thể tuỳ chỉnh tỷ lệ theo dự án.
export function calcPnl(
  p: { project_type: ProjectPnlType; lg_pct: number; cn_pct: number; revenue: number; manday_rate?: number; total_man_days?: number },
  costs: { value: number; payer: CostPayer; label?: string; service_type?: string }[],
  taxOpts?: { categories?: { label: string; group_type?: string }[]; taxPct?: number; taxExempt?: boolean },
  hohOpts?: { revenue: number; lgPct: number; cnPct: number }
): { tc: number; profit: number; lgC: number; cnC: number; shC: number; lgP: number; cnP: number; salaryCost: number; generalCost: number; tax: number; taxPct: number; taxExempt: boolean; profitAfterTax: number; hohProfit: number; hohLgP: number; hohCnP: number } {
  const tc = costs.reduce((s, c) => s + (Number(c.value) || 0), 0);
  const profit = p.revenue - tc;
  let lgC = 0, cnC = 0, shC = 0;
  for (const c of costs) {
    const v = Number(c.value) || 0;
    if (c.payer === 'lg') lgC += v;
    else if (c.payer === 'cn') cnC += v;
    else shC += v;
  }
  let salaryCost = 0;
  if (taxOpts?.categories) {
    const salaryLabels = new Set(taxOpts.categories.filter(c => c.group_type === 'salary').map(c => c.label));
    for (const c of costs) if (c.label && salaryLabels.has(c.label)) salaryCost += Number(c.value) || 0;
  }
  const generalCost = tc - salaryCost;
  const taxPct = taxOpts?.taxExempt ? 0 : (taxOpts?.taxPct ?? 0);
  const tax = profit > 0 ? profit * taxPct / 100 : 0;
  const profitAfterTax = profit - tax;

  // Tách phần lợi nhuận sau thuế thuộc về HOH (theo tỷ lệ giữa LN trước thuế của HOH và tổng LN
  // trước thuế — cùng chịu thuế TNDN như phần còn lại), phần còn lại tính theo cách chia thông
  // thường của dự án (managed/per_manday/shared). Không có dòng HOH nào → kết quả giống hệt trước đây.
  const hohCost = costs.filter(c => c.service_type === 'hoh').reduce((s, c) => s + (Number(c.value) || 0), 0);
  const hohRevenue = hohOpts?.revenue ?? 0;
  const hohProfit = hohRevenue - hohCost;
  const restProfitPreTax = profit - hohProfit;
  const scale = profit !== 0 ? profitAfterTax / profit : 1;
  const hohPostTax = hohProfit * scale;
  const restPostTax = restProfitPreTax * scale;

  // per_manday: CN nhận đơn giá × công (đảm bảo đủ kể cả khi lỗ), LGV nhận phần còn lại (có thể âm).
  let restLgP: number, restCnP: number;
  if (p.project_type === 'managed') {
    restLgP = restPostTax; restCnP = 0;
  } else if (p.project_type === 'per_manday') {
    restCnP = (Number(p.manday_rate) || 0) * (Number(p.total_man_days) || 0);
    restLgP = restPostTax - restCnP;
  } else {
    restLgP = restPostTax * p.lg_pct / 100;
    restCnP = restPostTax * p.cn_pct / 100;
  }
  const hohLgPct = hohOpts?.lgPct ?? 100;
  const hohCnPct = hohOpts?.cnPct ?? 0;
  const hohLgP = hohPostTax * hohLgPct / 100;
  const hohCnP = hohPostTax * hohCnPct / 100;
  const lgP = restLgP + hohLgP;
  const cnP = restCnP + hohCnP;

  return { tc, profit, lgC, cnC, shC, lgP, cnP, salaryCost, generalCost, tax, taxPct, taxExempt: !!taxOpts?.taxExempt, profitAfterTax, hohProfit, hohLgP, hohCnP };
}

export function statusPill(status: string): { label: string; cls: string } {
  switch (status) {
    case 'ok': return { label: 'Bình thường', cls: 'bg-emerald-50 text-emerald-700 border border-emerald-200' };
    case 'warn': return { label: 'Sắp hết HĐ', cls: 'bg-amber-50 text-amber-700 border border-amber-200' };
    case 'danger': return { label: 'Khẩn cấp', cls: 'bg-red-50 text-red-700 border border-red-200' };
    default: return { label: status, cls: 'bg-gray-100 text-gray-600 border border-gray-200' };
  }
}
