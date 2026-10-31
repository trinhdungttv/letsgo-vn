// Lao động thời vụ theo từng người (GĐ4): số tháng đã làm, mốc cảnh báo 12 tháng, đối chiếu số tuần. File thuần.
//
// BLLĐ 2019 Điều 53: thời hạn cho thuê lại lao động tối đa 12 tháng → nhắc từ tháng thứ 10 để kịp chuyển chính
// thức cho khách / điều chuyển / kết thúc đúng hạn.

export const LEASE_WARN_MONTHS = 10;
export const LEASE_MAX_MONTHS = 12;

/** Số tháng tròn đã làm tính tới `today` (ngày trong tháng chưa tới thì chưa đủ tháng). */
export function monthsWorked(start: string | null | undefined, today: string): number {
  if (!start) return 0;
  const [y1, m1, d1] = start.slice(0, 10).split('-').map(Number);
  const [y2, m2, d2] = today.slice(0, 10).split('-').map(Number);
  let m = (y2 - y1) * 12 + (m2 - m1);
  if (d2 < d1) m -= 1;
  return Math.max(0, m);
}

export type LeaseLevel = 'ok' | 'warn' | 'over';
export function leaseLevel(months: number): LeaseLevel {
  if (months >= LEASE_MAX_MONTHS) return 'over';
  if (months >= LEASE_WARN_MONTHS) return 'warn';
  return 'ok';
}

/** Ngày chạm mốc 12 tháng. */
export function leaseLimitDate(start: string): string {
  const [y, m, d] = start.slice(0, 10).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + LEASE_MAX_MONTHS, d));
  return dt.toISOString().slice(0, 10);
}

/**
 * So số người đang làm (theo danh sách từng người) với số lao động tuần gần nhất đang nhập tay ở Khách hàng.
 * null = chưa nhập số tuần. Lệch dương = danh sách từng người nhiều hơn số tuần.
 */
export function headcountGap(active: number, weekly: number | null | undefined): number | null {
  return weekly == null ? null : active - weekly;
}
