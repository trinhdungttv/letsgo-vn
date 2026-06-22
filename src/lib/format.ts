import type { ProjectPnlType, CostPayer, ClientManagerHistory, ClientBranchHistory } from './types';

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

export function getCurrentWeekLabel(): string {
  const now = new Date();
  const weekNum = Math.ceil(now.getDate() / 7);
  return `T${now.getMonth() + 1}W${weekNum}`;
}

// Returns the week labels (TmWn) that actually exist in a given month, ascending (W1 first).
export function weekLabelsForMonth(year: number, month: number): string[] {
  const daysInMonth = new Date(year, month, 0).getDate();
  const maxWeek = Math.ceil(daysInMonth / 7);
  const labels: string[] = [];
  for (let w = 1; w <= maxWeek; w++) labels.push(`T${month}W${w}`);
  return labels;
}

export function weekDateRange(label: string, year?: number): string {
  const y = year ?? new Date().getFullYear();
  const wIdx = label.indexOf('W');
  if (wIdx < 0) return '';
  const m = parseInt(label.slice(1, wIdx), 10);
  const w = parseInt(label.slice(wIdx + 1), 10);
  const daysInMonth = new Date(y, m, 0).getDate();
  const from = (w - 1) * 7 + 1;
  const to = Math.min(w * 7, daysInMonth);
  return `${from}-${to}/${m}`;
}

// Returns week labels (TmWn) grouped by month for the past `monthsBack` months (incl. current),
// newest first. Current month only includes weeks up to the current week (no future weeks).
export function recentWeekLabels(monthsBack = 6): { month: string; labels: string[] }[] {
  const now = new Date();
  const groups: { month: string; labels: string[] }[] = [];
  for (let i = 0; i < monthsBack; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const m = d.getMonth() + 1;
    const y = d.getFullYear();
    const isCurrent = i === 0;
    const all = weekLabelsForMonth(y, m);
    const labels = (isCurrent ? all.slice(0, Math.ceil(now.getDate() / 7)) : all).slice().reverse();
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
  const now = new Date();
  let month = now.getMonth() + 1;
  let year = now.getFullYear();
  let week = Math.ceil(now.getDate() / 7);
  const flat: { groupKey: string; label: string }[] = [];
  for (let i = 0; i < n; i++) {
    const maxWeek = weekLabelsForMonth(year, month).length;
    week++;
    if (week > maxWeek) {
      week = 1;
      month++;
      if (month > 12) { month = 1; year++; }
    }
    flat.push({ groupKey: `Tháng ${month}/${year}`, label: `T${month}W${week}` });
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

// P&L calculation shared by the Finance Workspace project tabs.
export function calcPnl(
  p: { project_type: ProjectPnlType; lg_pct: number; cn_pct: number; revenue: number },
  costs: { value: number; payer: CostPayer }[]
): { tc: number; profit: number; lgC: number; cnC: number; shC: number; lgP: number; cnP: number } {
  const tc = costs.reduce((s, c) => s + (Number(c.value) || 0), 0);
  const profit = p.revenue - tc;
  let lgC = 0, cnC = 0, shC = 0;
  for (const c of costs) {
    const v = Number(c.value) || 0;
    if (c.payer === 'lg') lgC += v;
    else if (c.payer === 'cn') cnC += v;
    else shC += v;
  }
  const lgP = p.project_type === 'managed' ? profit : profit * p.lg_pct / 100;
  const cnP = p.project_type === 'managed' ? 0 : profit * p.cn_pct / 100;
  return { tc, profit, lgC, cnC, shC, lgP, cnP };
}

export function statusPill(status: string): { label: string; cls: string } {
  switch (status) {
    case 'ok': return { label: 'Bình thường', cls: 'bg-emerald-50 text-emerald-700 border border-emerald-200' };
    case 'warn': return { label: 'Sắp hết HĐ', cls: 'bg-amber-50 text-amber-700 border border-amber-200' };
    case 'danger': return { label: 'Khẩn cấp', cls: 'bg-red-50 text-red-700 border border-red-200' };
    default: return { label: status, cls: 'bg-gray-100 text-gray-600 border border-gray-200' };
  }
}
