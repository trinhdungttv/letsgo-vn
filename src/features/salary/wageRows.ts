// 14 dòng đơn giá theo luật (SPEC §1.1) — định nghĩa tĩnh, không phụ thuộc SHR.
//
// Hệ số pháp lý KHÔNG khai báo lại ở đây: import từ lib/payroll/coefficients.ts, nơi engine suy
// ngược cũ đã được verify đúng và có test. SPEC §0.1 "KHÔNG viết lại từ đầu".
//
// ⚠ KHÁC BIỆT ĐƠN VỊ VỚI ENGINE CŨ — ĐỌC TRƯỚC KHI SỬA:
// Engine cũ (basisHoursOf) coi số tiền của ca 12h là ĐƠN GIÁ BÌNH QUÂN/GIỜ ⇒ basisHours = 1,
// nhãn 'đ/giờ (b/q ca 12h)'. SPEC mới quy ước ngược lại: AT-1 chốt fullPrice(shift12_day) =
// 581.000đ và fullPrice(shift12_night) = 763.600đ, tức số tiền là CẢ CA 12 TIẾNG ⇒ hoursPerUnit
// = 12. Nhờ vậy "đơn vị nhập" và "đơn vị sản lượng" trùng nhau ở cả 14 dòng, không còn 2 khái
// niệm số giờ song song.
// Hệ quả: khi đọc/ghi bảng lương NCC bên Thị trường (vốn theo quy ước CŨ) phải quy đổi ở đúng
// ranh giới đó — dùng toLegacyEntryAmount()/fromLegacyEntryAmount() bên dưới, đừng truyền số thô.
import {
  coefficientOf, PAYROLL_INPUT_LABELS, basisHoursOf, type PayrollInputType,
} from '../../lib/payroll/coefficients';
import type { WageCode, WageRowDef, WageGroup, WageUnit } from './types';

const GROUP_OF: Record<WageCode, WageGroup> = {
  base_salary: 'BASE',
  day_wage_8h: 'FULL_SHIFT', night_wage_8h: 'FULL_SHIFT',
  sunday_day_wage_8h: 'FULL_SHIFT', sunday_night_wage_8h: 'FULL_SHIFT', holiday_wage_8h: 'FULL_SHIFT',
  ot_day_weekday: 'OVERTIME', ot_night_weekday: 'OVERTIME',
  ot_day_sunday: 'OVERTIME', ot_night_sunday: 'OVERTIME',
  ot_day_holiday: 'OVERTIME', ot_night_holiday: 'OVERTIME',
  shift12_day: 'SHIFT_12H', shift12_night: 'SHIFT_12H',
};

export const unitOf = (code: WageCode): WageUnit =>
  code === 'base_salary' ? 'month'
    : GROUP_OF[code] === 'SHIFT_12H' ? 'shift12h'
      : GROUP_OF[code] === 'FULL_SHIFT' ? 'shift8h'
        : 'hour';

/** month → 0: nơi dùng PHẢI thay bằng workdaysPerMonth × 8 (xem hoursPerUnit()). */
const NOMINAL_HOURS: Record<WageUnit, number> = { month: 0, shift8h: 8, shift12h: 12, hour: 1 };

export const WAGE_ROWS: WageRowDef[] = (Object.keys(PAYROLL_INPUT_LABELS) as PayrollInputType[]).map(code => ({
  code,
  label: PAYROLL_INPUT_LABELS[code],
  coefficient: coefficientOf(code, false),
  unit: unitOf(code),
  hoursPerUnit: NOMINAL_HOURS[unitOf(code)],
  group: GROUP_OF[code],
  countsInVolume: code !== 'base_salary',   // lương tháng không phải 1 loại giờ
}));

export const BILLABLE_ROWS = WAGE_ROWS.filter(r => r.countsInVolume);

export const wageRowOf = (code: WageCode): WageRowDef =>
  WAGE_ROWS.find(r => r.code === code)!;

/** Số giờ mà 1 đơn vị của dòng này đại diện — dùng CHUNG cho cả đơn giá nhập vào và sản lượng. */
export const hoursPerUnit = (code: WageCode, workdaysPerMonth: number): number => {
  const u = unitOf(code);
  return u === 'month' ? workdaysPerMonth * 8 : NOMINAL_HOURS[u];
};

export const unitLabelOf = (code: WageCode): string => {
  const u = unitOf(code);
  return u === 'month' ? 'đ/tháng' : u === 'shift8h' ? 'đ/ca 8h'
    : u === 'shift12h' ? 'đ/ca 12h' : 'đ/giờ';
};

/** Nhãn đơn vị SẢN LƯỢNG (ô nhập số lượng ở khối L2). */
export const volumeUnitLabelOf = (code: WageCode): string => {
  const u = unitOf(code);
  return u === 'hour' ? 'giờ' : u === 'month' ? 'tháng' : 'ca';
};

export const coefficientFor = (code: WageCode, priorDayOt = false): number =>
  coefficientOf(code, code === 'ot_night_weekday' ? priorDayOt : false);

// ── Ranh giới với quy ước CŨ (bảng lương NCC bên Thị trường) ───────────────────────────────
// Chỉ ca 12h lệch: cũ = đ/giờ bình quân, mới = đ/cả ca 12h. Các dòng khác trùng nhau nên 2 hàm
// này là no-op với chúng. Đi qua đây thay vì nhân/chia 12 rải rác khắp nơi.

const legacyRatio = (code: WageCode, workdaysPerMonth: number): number => {
  const legacy = basisHoursOf(code, workdaysPerMonth);
  const current = hoursPerUnit(code, workdaysPerMonth);
  return legacy > 0 && current > 0 ? legacy / current : 1;
};

/** Số tiền theo đơn vị MỚI → đơn vị CŨ (để ghi sang Thị trường). */
export const toLegacyEntryAmount = (amount: number, code: WageCode, workdaysPerMonth: number): number =>
  amount * legacyRatio(code, workdaysPerMonth);

/** Số tiền theo đơn vị CŨ (đọc từ Thị trường) → đơn vị MỚI. */
export const fromLegacyEntryAmount = (amount: number, code: WageCode, workdaysPerMonth: number): number => {
  const r = legacyRatio(code, workdaysPerMonth);
  return r !== 0 ? amount / r : amount;
};
