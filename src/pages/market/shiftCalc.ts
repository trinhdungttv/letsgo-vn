// "Lương cơ bản" chỉ là 1 THÔNG SỐ (đ/tháng) để suy ra các mức lương theo ca — KHÔNG được cộng
// chung với "Ca ngày 12h", "Ca đêm 12h", "OT"… vì đó đều là biểu diễn khác của CÙNG một lương cơ
// bản dưới các cách đi làm khác nhau, không phải khoản tiền cộng dồn. Cộng chung là tính sai
// (double-count) — đây là nơi tính ĐÚNG: chọn 1 kiểu ca, suy ra mức tương ứng theo công chuẩn
// 26 ngày công, dùng lại đúng hệ số pháp lý ở coefficients.ts (không phát minh quy ước mới, để
// khớp với "Tính bảng lương" — marketBridge.ts đọc/ghi cùng các trường này).
import { coefficientOf, basisHoursOf, type PayrollInputType } from '../../lib/payroll/coefficients';
import { pickPayrollInputFromWageDetail, allowancesFromWageDetail, type WageFieldMapping } from '../../lib/payroll/rateCard';

export const STANDARD_WORKING_DAYS = 26;

/** Tổng lương THÁNG-tương-đương của 1 phía (giá khách trả hoặc giá trả người lao động).
 *
 * KHÔNG được cộng dồn Object.values() thẳng — "Lương cơ bản", "Ca ngày 12h", "Ca đêm 12h",
 * "OT"… là các cách BIỂU DIỄN KHÁC NHAU của CÙNG một lương cơ bản dưới các kiểu ca khác nhau,
 * không phải khoản tiền cộng thêm. Cộng chung ra số ảo, to hơn thực tế nhiều lần — đúng lỗi
 * "Tổng giá vốn" bị báo sai. Đúng phải là: CHỌN 1 mốc lương chính đã nhập (ưu tiên base_salary
 * → day_wage_8h → ca 12h ngày → ca 8h đêm → ca 12h đêm — thứ tự pickPayrollInputFromWageDetail),
 * quy về đ/THÁNG theo công chuẩn 26 ngày công, rồi mới cộng phụ cấp (khoản không gắn loại đơn
 * giá giờ nào — ăn ca, xăng xe…) vì phụ cấp mới thực sự cộng dồn được với lương chính. */
export function wageMonthlyTotal(d: Record<string, number> | null | undefined, fields: WageFieldMapping[]): number {
  const allowances = Object.values(allowancesFromWageDetail(d, fields)).reduce((a, b) => a + b, 0);
  const picked = pickPayrollInputFromWageDetail(d, fields);
  if (!picked) return allowances;
  const basis = basisHoursOf(picked.type, STANDARD_WORKING_DAYS);
  const shr = picked.value / (coefficientOf(picked.type, false) * basis);
  return Math.round(shr * 8 * STANDARD_WORKING_DAYS) + allowances;
}

export type ShiftPattern = 'day8' | 'night8' | 'day12' | 'night12';

export const SHIFT_PATTERN_LABELS: Record<ShiftPattern, string> = {
  day8: 'Ca ngày 8h', night8: 'Ca đêm 8h', day12: 'Ca ngày 12h', night12: 'Ca đêm 12h',
};

const BASE_TYPE_OF: Record<ShiftPattern, PayrollInputType> = {
  day8: 'day_wage_8h', night8: 'night_wage_8h', day12: 'shift12_day', night12: 'shift12_night',
};
export const baseTypeOfPattern = (p: ShiftPattern) => BASE_TYPE_OF[p];

/** Ca 12h đã gồm sẵn 4h OT trong hệ số (xem coefficients.ts) — không cho cộng OT rời vào ca
 *  này, kẻo tính OT 2 lần. */
export const allowsExtraOt = (p: ShiftPattern) => p === 'day8' || p === 'night8';

const naturalRate = (type: PayrollInputType, baseSalary: number, workingDays: number) => {
  const shr = baseSalary / (workingDays * 8);
  return Math.round(shr * coefficientOf(type, false) * basisHoursOf(type, workingDays));
};

export interface ShiftCalcResult {
  /** Giá trị "tự nhiên" cần ghi vào wage_detail cho từng loại đơn giá — đúng đơn vị mà cả hệ
   *  thống đang dùng cho khoản đó (đ/ca 8h, đ/giờ b/q ca 12h, đ/giờ OT). */
  patch: Partial<Record<PayrollInputType, number>>;
  /** Tổng dự kiến cho ĐÚNG 1 ca cụ thể (gồm OT rời nếu có) — chỉ để người dùng đối chiếu, không lưu. */
  previewTotal: number;
  previewHours: number;
}

export function computeShift(
  baseSalary: number, pattern: ShiftPattern, otHours: number, workingDays = STANDARD_WORKING_DAYS,
): ShiftCalcResult {
  const baseType = BASE_TYPE_OF[pattern];
  const baseRate = naturalRate(baseType, baseSalary, workingDays);
  const is12h = pattern === 'day12' || pattern === 'night12';
  const baseTotalForShift = is12h ? baseRate * 12 : baseRate; // ca 12h lưu theo đ/giờ b/q, còn ca 8h lưu thẳng đ/ca
  const patch: Partial<Record<PayrollInputType, number>> = { [baseType]: baseRate };

  let otTotal = 0;
  const hasOt = allowsExtraOt(pattern) && otHours > 0;
  if (hasOt) {
    const otType: PayrollInputType = pattern === 'night8' ? 'ot_night_weekday' : 'ot_day_weekday';
    const otRate = naturalRate(otType, baseSalary, workingDays);
    patch[otType] = otRate;
    otTotal = otRate * otHours;
  }

  return {
    patch,
    previewTotal: baseTotalForShift + otTotal,
    previewHours: (is12h ? 12 : 8) + (hasOt ? otHours : 0),
  };
}
