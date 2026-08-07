// Mốc ngày trong timeline (chốt công / tính lương / phát lương / kỳ TT).
// Quy ước lưu trong DB:
//   null = chưa đặt
//   1..31 = ngày cố định trong tháng
//   EOM (-1) = "cuối tháng" — luôn nhảy theo số ngày thực tế của tháng đang xem (28/29/30/31)

export const EOM = -1;

/** Số ngày thực tế của tháng (year, month 1-12). */
export function daysOfMonth(year: number, month1to12: number): number {
  return new Date(year, month1to12, 0).getDate();
}

/**
 * Đổi giá trị lưu trong DB thành ngày thật của tháng đang xem.
 * EOM luôn ra đúng ngày cuối tháng — không lùi 1 ngày, kể cả khi là ngày bắt đầu.
 */
export function resolveDay(v: number | null | undefined, daysInMonth: number): number | null {
  if (v == null) return null;
  if (v === EOM) return daysInMonth;
  return Math.min(Math.max(v, 1), daysInMonth);
}

/** Thứ tự so sánh: EOM luôn đứng sau mọi ngày cố định. */
export function dayOrder(v: number | null | undefined): number {
  if (v == null) return -Infinity;
  return v === EOM ? 32 : v;
}

/** Nhãn hiển thị cho 1 mốc: "cuối tháng", "5", "5–cuối tháng"… */
export function formatDayRange(start: number | null | undefined, end: number | null | undefined): string {
  const one = (v: number) => (v === EOM ? 'cuối tháng' : String(v));
  const { start: s, end: e } = normalizeDayRange(start, end);
  if (s == null) return '—';
  return e == null ? one(s) : `${one(s)}–${one(e)}`;
}

/**
 * Chuẩn hoá 1 cặp (bắt đầu, kết thúc) trước khi lưu:
 *  - chỉ nhập ngày kết thúc  → coi như mốc 1 ngày (dồn về ngày bắt đầu)
 *  - kết thúc <= bắt đầu     → mốc 1 ngày (bỏ ngày kết thúc)
 *  - cả hai đều trống        → giữ null
 * Nhờ vậy chọn CT ở bất kỳ ô nào cũng ra đúng "1 ngày cuối tháng".
 */
export function normalizeDayRange(
  start: number | null | undefined,
  end: number | null | undefined,
): { start: number | null; end: number | null } {
  const s = start ?? null;
  const e = end ?? null;
  if (s == null && e == null) return { start: null, end: null };
  if (s == null) return { start: e, end: null };
  if (e == null) return { start: s, end: null };
  if (dayOrder(e) <= dayOrder(s)) return { start: s, end: null };
  return { start: s, end: e };
}
