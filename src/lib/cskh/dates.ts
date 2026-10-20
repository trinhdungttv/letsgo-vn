// ============================================================================
// CSKH — ngày giờ. Mọi logic tính ngày dùng GIỜ VIỆT NAM, dạng "YYYY-MM-DD",
// không dùng giờ máy (máy người dùng / server Vercel có thể ở múi giờ khác).
// ============================================================================
import { diffDays } from './lunar';

/** Hôm nay "YYYY-MM-DD" theo giờ Việt Nam. `now` để test truyền thời điểm cố định. */
export function todayVN(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** "YYYY-MM-DD" → "dd/mm/yyyy". */
export function formatDateVN(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

/** "YYYY-MM-DD" → "dd/mm". */
export function formatDayMonth(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

/** "Hôm nay" / "Hôm qua" / "5 ngày trước" / "3 tuần trước" / "2 tháng trước" / dd/mm/yyyy. */
export function relativeDayLabel(iso: string, today: string): string {
  const d = diffDays(iso, today);
  if (d <= 0) return d === 0 ? 'Hôm nay' : formatDateVN(iso);
  if (d === 1) return 'Hôm qua';
  if (d < 14) return `${d} ngày trước`;
  if (d < 60) return `${Math.floor(d / 7)} tuần trước`;
  if (d < 365) return `${Math.floor(d / 30)} tháng trước`;
  return formatDateVN(iso);
}

const WEEKDAYS = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];

/** "Chủ Nhật, 18 tháng 10" — dòng ngày ở đầu Dashboard CSKH. */
export function longDateVN(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${weekday}, ${d} tháng ${m}`;
}

/** Ngày/tháng (dương lịch) có thật không — năm trống thì kiểm theo năm nhuận 2000 để 29/02 hợp lệ. */
export function isValidDayMonth(day: number, month: number, year: number | null): boolean {
  if (!Number.isInteger(day) || !Number.isInteger(month) || month < 1 || month > 12 || day < 1) return false;
  return day <= new Date(Date.UTC(year ?? 2000, month, 0)).getUTCDate();
}
