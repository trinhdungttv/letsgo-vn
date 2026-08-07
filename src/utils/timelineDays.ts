// Mốc ngày trong timeline (chốt công / tính lương / phát lương / kỳ TT).
// Quy ước lưu trong DB:
//   null = chưa đặt
//   1..31 = ngày cố định trong tháng
//   EOM (-1) = "cuối tháng" — luôn nhảy theo số ngày thực tế của tháng đang xem (28/29/30/31)
//   EOM_1 (-2) = "cuối tháng -1" — ngày kề trước ngày cuối tháng (27/28/29/30)

export const EOM = -1;
export const EOM_1 = -2;

/** Nhãn ngắn cho 2 mốc động, dùng chung cho nút bấm và chỗ hiển thị. */
export const EOM_LABEL = 'Cuối tháng';
export const EOM_1_LABEL = 'Cuối tháng -1';

/** Giá trị động (cuối tháng / cuối tháng -1) hay ngày cố định 1–31? */
export function isDynamicDay(v: number | null | undefined): boolean {
  return v === EOM || v === EOM_1;
}

/** Nhãn hiển thị cho 1 giá trị ngày đã lưu. */
export function dayLabel(v: number | null | undefined): string {
  if (v == null) return '—';
  if (v === EOM) return EOM_LABEL;
  if (v === EOM_1) return EOM_1_LABEL;
  return String(v);
}

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
  if (v === EOM_1) return Math.max(daysInMonth - 1, 1);
  return Math.min(Math.max(v, 1), daysInMonth);
}

/** Thứ tự so sánh: EOM luôn đứng sau mọi ngày cố định. */
export function dayOrder(v: number | null | undefined): number {
  if (v == null) return -Infinity;
  if (v === EOM) return 32;
  if (v === EOM_1) return 31.5;
  return v;
}

/** Nhãn hiển thị cho 1 mốc: "cuối tháng", "5", "5–cuối tháng"… */
export function formatDayRange(start: number | null | undefined, end: number | null | undefined): string {
  const one = (v: number) => (v === EOM ? 'cuối tháng' : v === EOM_1 ? 'cuối tháng -1' : String(v));
  const { start: s, end: e } = normalizeDayRange(start, end);
  if (s == null) return '—';
  return e == null ? one(s) : `${one(s)}–${one(e)}`;
}

/**
 * Mốc 1 ngày có thể được nhập ở ô "bắt đầu" HOẶC ô "kết thúc" — người dùng chọn ô
 * nào thì lưu đúng ô đó (xem handleSaveEdit trong Finance). Hàm này lấy ra ngày
 * thật sự của mốc cho những chỗ chỉ hiển thị 1 con số.
 */
export function anchorDay(
  start: number | null | undefined,
  end: number | null | undefined,
): number | null {
  return start ?? end ?? null;
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
