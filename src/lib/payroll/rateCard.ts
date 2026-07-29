// Cầu nối giữa "Tính bảng lương" (đơn giá suy ra theo luật) và "bảng lương chi tiết của NCC"
// bên Thị trường (clients.market_suppliers[].wage_detail) — migration 126.
//
// VÌ SAO CẦN CHỈNH TAY ĐÈ LÊN KẾT QUẢ TÍNH: hệ số pháp lý cho ra số lẻ (vd 28.846đ/giờ), còn
// thực tế công ty niêm yết số tròn (30.000đ/giờ) hoặc cộng thêm khoản ngoài luật. Nên bảng đơn
// giá phải sửa tay được, và số đã sửa mới là số đem đi so sánh/đồng bộ — chứ không phải số lý thuyết.
import { basisHoursOf, coefficientOf, type PayrollInputType } from './coefficients';
import type { RateCardRow } from './reverseCalcEngine';

/** Đơn giá từng loại giờ do người dùng gõ đè lên kết quả tính theo luật. */
export type RateOverrides = Partial<Record<PayrollInputType, number>>;

/** 1 khoản phụ cấp/phụ phí kèm theo lương. `passThrough` = khoản này về tay NLĐ (chi phí thật),
 *  ngược lại là phần công ty giữ lại (doanh thu) — cùng quy ước với bảng So sánh giá dịch vụ. */
export interface AllowanceItem { id: string; label: string; amount: string; passThrough: boolean }

export const sumAllowances = (items: AllowanceItem[], onlyPassThrough?: boolean): number =>
  items
    .filter(it => onlyPassThrough === undefined || it.passThrough === onlyPassThrough)
    .reduce((s, it) => s + (parseFloat(it.amount) || 0), 0);

export const allowanceRecord = (items: AllowanceItem[]): Record<string, number> =>
  Object.fromEntries(items.filter(it => it.label.trim() && (parseFloat(it.amount) || 0) > 0).map(it => [it.label.trim(), parseFloat(it.amount)]));

// CẢNH BÁO ĐƠN VỊ (đây là chỗ đã từng sai): computePayrollMatrix trả rateCard[].rate luôn là
// ĐỒNG/GIỜ, trong khi bảng lương bên Thị trường ghi theo ĐƠN VỊ TỰ NHIÊN của từng khoản —
// "Lương cơ bản" là đồng/THÁNG, "Ca ngày 8h" là đồng/CA 8 TIẾNG, OT mới là đồng/giờ. Quy đổi
// giữa 2 đơn vị chính là basisHoursOf() — cũng đúng bằng đơn vị mà computePayrollMatrix nhận
// làm inputValue cho loại đó, nên đi vòng tròn (đọc từ Thị trường → tính → ghi lại) không lệch.
export interface EffectiveRateRow extends RateCardRow {
  basisHours: number;      // số giờ mà "đơn vị tự nhiên" của khoản này đại diện
  unitLabel: string;       // nhãn đơn vị để hiện cho người dùng khỏi nhập nhầm
  naturalRate: number;     // theo luật, quy về đơn vị tự nhiên (đ/tháng, đ/ca, đ/giờ)
  effectiveNatural: number; // số đang dùng thật, đơn vị tự nhiên — số này mới đem đi đồng bộ
  effectiveHourly: number;  // số đang dùng thật, quy về đ/giờ để đối chiếu ngang các loại giờ
  overridden: boolean;
}

export function unitLabelOf(type: PayrollInputType): string {
  if (type === 'base_salary') return 'đ/tháng';
  if (type === 'day_wage_8h' || type === 'night_wage_8h' || type === 'holiday_wage_8h') return 'đ/ca 8h';
  if (type === 'shift12_day' || type === 'shift12_night') return 'đ/giờ (b/q ca 12h)';
  return 'đ/giờ';
}

/** 1 trường lương chi tiết bên Thị trường + loại đơn giá theo luật nó tương ứng.
 *  Khai báo ở đây (thay vì import từ pages/) để tầng lib không phụ thuộc ngược lên tầng UI. */
export interface WageFieldMapping { name: string; payrollInputType: PayrollInputType | null }

/** `overrides` được gõ theo ĐƠN VỊ TỰ NHIÊN của từng khoản (giống hệt cách nhập bên Thị trường),
 *  không phải đồng/giờ — xem cảnh báo đơn vị ở EffectiveRateRow. */
export function applyRateOverrides(
  rateCard: RateCardRow[], overrides: RateOverrides, workingDaysPerMonth: number,
): EffectiveRateRow[] {
  return rateCard.map(row => {
    const basisHours = basisHoursOf(row.type, workingDaysPerMonth);
    const naturalRate = row.rate * basisHours;
    const ov = overrides[row.type];
    const overridden = ov != null && Number.isFinite(ov);
    const effectiveNatural = overridden ? ov : naturalRate;
    return {
      ...row, basisHours, unitLabel: unitLabelOf(row.type), naturalRate,
      effectiveNatural, effectiveHourly: basisHours > 0 ? effectiveNatural / basisHours : 0,
      overridden,
    };
  });
}

// Đơn giá giờ THƯỜNG ban ngày quyết định "lương tháng chuẩn" (nền tính BHXH + đối chiếu lương
// tối thiểu vùng), nên sửa 2 dòng này thì phải tính lại TOÀN BỘ ma trận; sửa các dòng OT/đêm thì
// không, vì lương tháng chuẩn vốn không bao gồm giờ OT (xem computePayrollMatrix).
// Giá trị truyền vào là ĐƠN VỊ TỰ NHIÊN: base_salary đã là đ/tháng, day_wage_8h là đ/ca nên
// phải × số ngày công mới ra tháng.
// Trả về lương tháng tương ứng để gọi lại computePayrollMatrix với inputType='base_salary' —
// cách này dùng lại nguyên engine, không viết lại công thức BHXH/chi phí ở đây.
export function monthlyGrossFromOverrides(overrides: RateOverrides, workingDaysPerMonth: number): number | null {
  if (overrides.base_salary != null && Number.isFinite(overrides.base_salary)) return overrides.base_salary;
  if (overrides.day_wage_8h != null && Number.isFinite(overrides.day_wage_8h)) return overrides.day_wage_8h * workingDaysPerMonth;
  return null;
}

// Số tiền cần đưa vào computePayrollMatrix (vẫn giữ nguyên inputType/priorDayOt người dùng đã
// chọn) để lương tháng chuẩn ra đúng bằng `target`. Dùng khi người dùng sửa tay đơn giá giờ
// thường: thay vì viết lại công thức BHXH/chi phí ở tầng UI, ta quy ngược về số tiền đầu vào
// rồi chạy lại nguyên engine — chỉ có 1 nơi giữ công thức pháp lý.
export function inputValueForMonthlyGross(
  target: number, inputType: PayrollInputType, priorDayOt: boolean, workingDaysPerMonth: number,
): number {
  const shrTarget = target / (8 * workingDaysPerMonth);
  return shrTarget * coefficientOf(inputType, priorDayOt) * basisHoursOf(inputType, workingDaysPerMonth);
}

/** Bảng đơn giá + các khoản phụ cấp → wage_detail để ghi sang Thị trường.
 *  Chỉ ghi vào những trường có gán payroll_input_type (đơn giá giờ) hoặc có trong `allowances`
 *  (phụ cấp) — trường nào không thuộc 2 nhóm đó thì giữ nguyên giá trị cũ, không xoá. */
export function toWageDetail(
  rows: EffectiveRateRow[],
  fields: WageFieldMapping[],
  allowances: Record<string, number>,
  previous: Record<string, number> = {},
): Record<string, number> {
  // Ghi theo ĐƠN VỊ TỰ NHIÊN (đ/tháng cho lương cơ bản, đ/ca cho ca 8h…) — đúng đơn vị mà ô
  // nhập bên Thị trường đang dùng, cũng đúng đơn vị đọc ngược lại làm inputValue.
  const byType = new Map(rows.map(r => [r.type, r.effectiveNatural]));
  const out: Record<string, number> = { ...previous };
  for (const f of fields) {
    if (f.payrollInputType && byType.has(f.payrollInputType)) {
      out[f.name] = Math.round(byType.get(f.payrollInputType)!);
    }
  }
  for (const [name, amount] of Object.entries(allowances)) {
    if (amount > 0) out[name] = Math.round(amount);
  }
  return out;
}

/** Chiều ngược lại: từ bảng lương đã lưu của 1 NCC, chọn ra 1 mức để suy ngược ra SHR.
 *  Ưu tiên lương cơ bản → lương ngày → mức đầu tiên có giá trị, vì đó là các mốc chắc chắn
 *  nhất; OT/ca đêm cũng suy ra được nhưng sai số cao hơn nếu công ty làm tròn mạnh. */
const PICK_PRIORITY: PayrollInputType[] = ['base_salary', 'day_wage_8h', 'shift12_day', 'night_wage_8h', 'shift12_night'];

export function pickPayrollInputFromWageDetail(
  wageDetail: Record<string, number> | null | undefined,
  fields: WageFieldMapping[],
): { type: PayrollInputType; value: number; fieldName: string } | null {
  if (!wageDetail) return null;
  const candidates = fields
    .filter(f => f.payrollInputType && (wageDetail[f.name] ?? 0) > 0)
    .map(f => ({ type: f.payrollInputType!, value: wageDetail[f.name], fieldName: f.name }));
  if (candidates.length === 0) return null;
  for (const wanted of PICK_PRIORITY) {
    const hit = candidates.find(c => c.type === wanted);
    if (hit) return hit;
  }
  return candidates[0];
}

/** Các khoản trong wage_detail KHÔNG phải đơn giá giờ (ăn ca, xăng xe, nhà trọ…) — đây là phụ
 *  cấp cộng thêm vào thu nhập NLĐ, tách riêng để không bị cộng nhầm vào đơn giá giờ. */
export function allowancesFromWageDetail(
  wageDetail: Record<string, number> | null | undefined,
  fields: WageFieldMapping[],
): Record<string, number> {
  if (!wageDetail) return {};
  const rateFieldNames = new Set(fields.filter(f => f.payrollInputType).map(f => f.name));
  return Object.fromEntries(Object.entries(wageDetail).filter(([name, v]) => !rateFieldNames.has(name) && v > 0));
}
