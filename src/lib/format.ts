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

export function getMonthLast(
  hist: { week_label: string; count: number }[],
  prefix: string
): number | null {
  const entries = hist.filter(h => h.week_label.startsWith(prefix));
  return entries.length ? entries[entries.length - 1].count : null;
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

export function statusPill(status: string): { label: string; cls: string } {
  switch (status) {
    case 'ok': return { label: 'Bình thường', cls: 'bg-emerald-50 text-emerald-700 border border-emerald-200' };
    case 'warn': return { label: 'Sắp hết HĐ', cls: 'bg-amber-50 text-amber-700 border border-amber-200' };
    case 'danger': return { label: 'Khẩn cấp', cls: 'bg-red-50 text-red-700 border border-red-200' };
    default: return { label: status, cls: 'bg-gray-100 text-gray-600 border border-gray-200' };
  }
}
