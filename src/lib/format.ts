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

export function statusPill(status: string): { label: string; cls: string } {
  switch (status) {
    case 'ok': return { label: 'Bình thường', cls: 'bg-emerald-50 text-emerald-700 border border-emerald-200' };
    case 'warn': return { label: 'Sắp hết HĐ', cls: 'bg-amber-50 text-amber-700 border border-amber-200' };
    case 'danger': return { label: 'Khẩn cấp', cls: 'bg-red-50 text-red-700 border border-red-200' };
    default: return { label: status, cls: 'bg-gray-100 text-gray-600 border border-gray-200' };
  }
}
