// Engine "Tính bảng lương" L1–L4 (SPEC §4.1–§4.5) — hàm THUẦN: không import React, không gọi
// Supabase. Mọi công thức tài chính của màn hình này nằm ở đây và chỉ ở đây (§11).
//
// Quy ước tiền tệ (§7): mọi số là `number` đơn vị ĐỒNG, giữ số thực xuyên suốt, KHÔNG làm tròn
// giữa chuỗi tính toán — chỉ tầng hiển thị mới Math.round.
//
// Nguyên tắc bất biến: SHR là nguồn sự thật duy nhất. Mọi con số khác là hàm của
// (SHR × hệ số × sản lượng). Dòng dữ liệu một chiều L1 → L2 → L3 → L4.
import { INSURANCE_CAP_MULTIPLE, BASE_SALARY_FOR_CAP } from '../../lib/payroll/coefficients';
import {
  WAGE_ROWS, hoursPerUnit, unitLabelOf, coefficientFor,
} from './wageRows';
import { resolveMinWage, minWageStaleNotice } from './minWage';
import type {
  WageCode, WageRowDef, WageBasis, VolumeProfile, PriceBook, AllowanceLine,
  OverheadConfig, ServiceFeeConfig, MinWageBatch,
} from './types';

/** Trần đóng BHXH = 20 × lương cơ sở. GIỮ từ engine cũ — SPEC không nhắc, nhưng bỏ đi là làm
 *  mất một ràng buộc pháp lý đang đúng. */
const INSURANCE_CAP = INSURANCE_CAP_MULTIPLE * BASE_SALARY_FOR_CAP;

// ── L1: suy ngược & suy xuôi ──────────────────────────────────────────────────────────────

/** Phần phụ trội "ngày lễ hưởng nguyên lương" cộng vào dòng lễ (BUG-8): 100% × 8h.
 *  Chỉ áp cho NGUYÊN CA lễ, không áp cho giờ OT lễ (mặc định theo SPEC §4.1). */
const holidayBonusHours = (code: WageCode, includeHolidayBasePay: boolean): number =>
  includeHolidayBasePay && code === 'holiday_wage_8h' ? 8 : 0;

/** §4.1 suy ngược: shrPay = amount / (coefficient × hoursPerUnit).
 *  AT-9: khi toggle lương ngày lễ đang BẬT, engine phải TRỪ phần base ra trước khi chia hệ số,
 *  nếu không toggle ON/OFF sẽ làm shrPay trôi. */
export function deriveShr(
  code: WageCode, amount: number, workdaysPerMonth: number,
  opts: { priorDayOt?: boolean; includeHolidayBasePay?: boolean } = {},
): number {
  const { priorDayOt = false, includeHolidayBasePay = false } = opts;
  const denom = coefficientFor(code, priorDayOt) * hoursPerUnit(code, workdaysPerMonth)
    + holidayBonusHours(code, includeHolidayBasePay);
  return denom > 0 ? amount / denom : 0;
}

/** Số tiền tương ứng của `code` khi SHR đã biết — nghịch đảo của deriveShr(). */
export function amountForShr(
  code: WageCode, shrPay: number, workdaysPerMonth: number,
  opts: { priorDayOt?: boolean; includeHolidayBasePay?: boolean } = {},
): number {
  const { priorDayOt = false, includeHolidayBasePay = false } = opts;
  return shrPay * (coefficientFor(code, priorDayOt) * hoursPerUnit(code, workdaysPerMonth)
    + holidayBonusHours(code, includeHolidayBasePay));
}

/** BUG-7 / AT-13: đổi loại đơn giá phải GIỮ giá trị và quy đổi sang đơn vị mới theo SHR hiện
 *  hành — không reset về 0, và cũng không để nguyên con số (để nguyên = âm thầm diễn giải lại ý
 *  nghĩa của nó dưới hệ số khác, sai còn khó phát hiện hơn reset). */
export function convertAmountBetweenCodes(
  amount: number, from: WageCode, to: WageCode, workdaysPerMonth: number,
  opts: { priorDayOt?: boolean; includeHolidayBasePay?: boolean } = {},
): number {
  return amountForShr(to, deriveShr(from, amount, workdaysPerMonth, opts), workdaysPerMonth, opts);
}

export interface WageTableRow extends WageRowDef {
  /** Số giờ thực của 1 đơn vị (base_salary đã thay bằng workdaysPerMonth × 8). */
  resolvedHours: number;
  unitLabel: string;
  /** đ/giờ theo luật, chưa override, chưa gồm phụ trội lễ. */
  nominalHourly: number;
  /** đ/đơn vị theo luật (AT-1 cột fullPrice), đã gồm phụ trội lễ, CHƯA override. */
  legalPrice: number;
  /** đ/đơn vị ĐANG DÙNG THẬT — đã gồm override. Số này khớp ô người dùng nhìn thấy. */
  fullPrice: number;
  /** fullPrice quy về đ/giờ — để so ngang các loại giờ. */
  effectiveHourly: number;
  /** effectiveHourly / shrPay — hệ số THỰC TẾ sau override/phụ trội lễ. */
  effectiveCoefficient: number;
  overridden: boolean;
  holidayBasePayApplied: boolean;
}

export function buildWageTable(basis: WageBasis): WageTableRow[] {
  const { shrPay, workdaysPerMonth, overrides, includeHolidayBasePay, priorDayOt } = basis;
  return WAGE_ROWS.map(def => {
    const resolvedHours = hoursPerUnit(def.code, workdaysPerMonth);
    const coefficient = coefficientFor(def.code, priorDayOt);
    const nominalHourly = shrPay * coefficient;
    const holidayBasePayApplied = holidayBonusHours(def.code, includeHolidayBasePay) > 0;
    const legalPrice = amountForShr(def.code, shrPay, workdaysPerMonth, { priorDayOt, includeHolidayBasePay });

    // §4.1: override thì DÙNG THẲNG, KHÔNG suy lại shrPay.
    const ov = overrides[def.code];
    const overridden = ov != null && Number.isFinite(ov) && ov > 0;
    const fullPrice = overridden ? ov : legalPrice;
    const effectiveHourly = resolvedHours > 0 ? fullPrice / resolvedHours : 0;

    return {
      ...def,
      coefficient,
      resolvedHours,
      unitLabel: unitLabelOf(def.code),
      nominalHourly,
      legalPrice,
      fullPrice,
      effectiveHourly,
      effectiveCoefficient: shrPay > 0 ? effectiveHourly / shrPay : coefficient,
      overridden,
      holidayBasePayApplied,
    };
  });
}

export const rowOf = (table: WageTableRow[], code: WageCode): WageTableRow =>
  table.find(r => r.code === code)!;

// ── L2: giờ quy đổi ───────────────────────────────────────────────────────────────────────

export const qtyOf = (volume: VolumeProfile, code: WageCode): number => volume.quantities[code] ?? 0;

/** §4.2 EH = Σ qty × hoursPerUnit × coefficient.
 *  Dùng effectiveCoefficient (đã gồm override + phụ trội lễ) chứ không phải hệ số danh nghĩa —
 *  nhờ vậy đẳng thức DirectWage = shrPay × EH luôn đúng kể cả khi có override, và phép nhân ngược
 *  ở §4.6 mới ra đúng mức lương tối đa. Không override ⇒ trùng khít công thức SPEC. */
export function equivalentHours(table: WageTableRow[], volume: VolumeProfile): number {
  return table.reduce((s, r) =>
    r.countsInVolume ? s + qtyOf(volume, r.code) * r.resolvedHours * r.effectiveCoefficient : s, 0);
}

/** Tổng giờ THỰC có mặt tại nhà máy (không nhân hệ số) — để đối chiếu trần giờ làm thêm. */
export function actualHours(table: WageTableRow[], volume: VolumeProfile): number {
  return table.reduce((s, r) =>
    r.countsInVolume ? s + qtyOf(volume, r.code) * r.resolvedHours : s, 0);
}

/** Lương trực tiếp phải trả NLĐ trong tháng theo đúng sản lượng đã nhập. */
export function directWage(table: WageTableRow[], volume: VolumeProfile): number {
  return table.reduce((s, r) =>
    r.countsInVolume ? s + qtyOf(volume, r.code) * r.fullPrice : s, 0);
}

// ── L3: phụ cấp & nền BHXH ────────────────────────────────────────────────────────────────

export const sumAllowanceCustomer = (a: AllowanceLine[]): number => a.reduce((s, x) => s + (x.customerPays || 0), 0);
export const sumAllowanceWorker = (a: AllowanceLine[]): number => a.reduce((s, x) => s + (x.weOweWorker || 0), 0);
const sumAllowanceTaxable = (a: AllowanceLine[]): number =>
  a.reduce((s, x) => s + (x.taxable ? (x.weOweWorker || 0) : 0), 0);

export interface InsuranceResult {
  shrBhxh: number;
  bhxhBase: number;
  bhxhBaseCapped: boolean;
  workerInsurance: number;
  employerInsurance: number;
  unionFee: number;
}

/** §4.3. BUG-5: nền BHXH tách khỏi đơn giá trả thực — NCC thường đóng trên mức thấp hơn nhiều,
 *  gộp 2 đại lượng làm 1 khiến chi phí BHXH bị tính vống ⇒ tưởng lỗ trong khi đối thủ vẫn lời. */
export function computeInsurance(
  basis: WageBasis, allowances: AllowanceLine[], overhead: OverheadConfig,
): InsuranceResult {
  const shrBhxh = basis.shrBhxhMode === 'custom' ? (basis.shrBhxhCustom ?? 0) : basis.shrPay;
  const raw = shrBhxh * 8 * basis.workdaysPerMonth + sumAllowanceTaxable(allowances);
  const bhxhBase = Math.min(raw, INSURANCE_CAP);
  return {
    shrBhxh,
    bhxhBase,
    bhxhBaseCapped: raw > INSURANCE_CAP,
    workerInsurance: bhxhBase * overhead.workerInsurancePercent / 100,
    employerInsurance: bhxhBase * overhead.employerInsurancePercent / 100,
    unionFee: bhxhBase * overhead.unionFeePercent / 100,
  };
}

// ── L3: Price Book — NGUỒN DOANH THU DUY NHẤT (BUG-1) ─────────────────────────────────────

/** §4.4 giá khách trả cho 1 đơn vị của dòng này. undefined = CHƯA KHAI giá — khác hẳn 0đ; nơi
 *  gọi phải phân biệt để không sinh ra doanh thu ảo. */
export function customerPrice(
  code: WageCode, table: WageTableRow[], priceBook: PriceBook,
): number | undefined {
  const row = table.find(r => r.code === code);
  if (!row) return undefined;
  switch (priceBook.mode) {
    case 'manual': {
      const v = priceBook.manual[code];
      return v != null && Number.isFinite(v) ? v : undefined;
    }
    case 'markupPercent':
      return row.fullPrice * (1 + (priceBook.markupPercent ?? 0) / 100);
    case 'markupPerHour':
      return row.fullPrice + (priceBook.markupPerHour ?? 0) * row.resolvedHours;
    case 'singleDayRate': {
      // 1 ngày công = 1 ca 8h ⇒ quy giá khách về SHR phía khách rồi nhân hệ số từng dòng.
      const shrCustomer = (priceBook.singleDayRate ?? 0) / 8;
      return shrCustomer * row.effectiveCoefficient * row.resolvedHours;
    }
  }
}

export interface RevenueBreakdownRow {
  code: WageCode;
  label: string;
  qty: number;
  unitLabel: string;
  customerUnitPrice: number | undefined;
  ourUnitCost: number;
  lineRevenue: number;
  lineDirectCost: number;
  /** Khách trả THẤP HƠN chi phí trực tiếp dòng này → badge đỏ (§5.2). */
  underwater: boolean;
}

export interface RevenueResult {
  rows: RevenueBreakdownRow[];
  revenueLabor: number;
  revenueAllowance: number;
  revenueMonth: number;
  /** Dòng có sản lượng > 0 nhưng CHƯA khai giá khách — doanh thu đang thiếu, phải cảnh báo. */
  unpricedCodes: WageCode[];
}

export function computeRevenue(
  table: WageTableRow[], volume: VolumeProfile, priceBook: PriceBook, allowances: AllowanceLine[],
): RevenueResult {
  const rows: RevenueBreakdownRow[] = [];
  const unpricedCodes: WageCode[] = [];
  let revenueLabor = 0;

  for (const r of table) {
    if (!r.countsInVolume) continue;
    const qty = qtyOf(volume, r.code);
    const price = customerPrice(r.code, table, priceBook);
    const lineRevenue = price != null ? qty * price : 0;
    revenueLabor += lineRevenue;
    if (qty > 0 && price == null) unpricedCodes.push(r.code);
    rows.push({
      code: r.code, label: r.label, qty, unitLabel: r.unitLabel,
      customerUnitPrice: price, ourUnitCost: r.fullPrice,
      lineRevenue, lineDirectCost: qty * r.fullPrice,
      underwater: price != null && price < r.fullPrice,
    });
  }

  const revenueAllowance = sumAllowanceCustomer(allowances);
  return { rows, revenueLabor, revenueAllowance, revenueMonth: revenueLabor + revenueAllowance, unpricedCodes };
}

/** §4.4: serviceFee KHÔNG còn là nguồn doanh thu — chỉ là GENERATOR sinh ra price book.
 *  Nút "Sinh Price Book từ phí dịch vụ" gọi hàm này rồi ghi kết quả vào priceBook.manual.
 *
 *  Công thức COST-PLUS, đúng cách bản cũ lập invoice (AT-14): khách trả = chi phí lao động đầy đủ
 *  (lương + BHXH NSDLĐ + KPCĐ) + phí dịch vụ. Phần bảo hiểm được phân bổ theo TỶ TRỌNG EH của từng
 *  loại giờ — phân bổ phẳng theo số ca sẽ khiến giờ OT hệ số cao gánh quá ít, đúng cái làm cho
 *  "phí phẳng 10.000đ/giờ trên giờ OT đêm lễ 390%" hoá ra lỗ (BUG-2). */
export function priceBookFromServiceFee(
  basis: WageBasis, volume: VolumeProfile, allowances: AllowanceLine[],
  overhead: OverheadConfig, fee: ServiceFeeConfig,
): Partial<Record<WageCode, number>> {
  const table = buildWageTable(basis);
  const eh = equivalentHours(table, volume);
  const ins = computeInsurance(basis, allowances, overhead);
  const loadPerEh = eh > 0 ? (ins.employerInsurance + ins.unionFee) / eh : 0;
  // Phí theo GIỜ cộng thẳng mỗi giờ; phí theo NGÀY quy về mỗi giờ trước khi nhân số giờ của dòng.
  const feePerHour = fee.type === 'referral_hourly' ? fee.value : fee.value / (fee.feeHoursPerDay || 8);

  const out: Partial<Record<WageCode, number>> = {};
  for (const r of table) {
    if (!r.countsInVolume) continue;
    out[r.code] = r.fullPrice
      + loadPerEh * r.resolvedHours * r.effectiveCoefficient
      + feePerHour * r.resolvedHours;
  }
  return out;
}

/** §4.5 / BUG-4: doanh thu tắt ở tháng thứ mấy. per_day_worked là phí lâu dài → không có mốc tắt. */
export function feeDurationMonths(fee: ServiceFeeConfig): number {
  if (fee.type === 'per_day_worked') return Infinity;
  if (fee.type === 'referral_hourly') return fee.durationMode === 'one_time' ? 1 : Math.max(1, fee.months);
  return Math.max(1, fee.months);
}

// ── L4: P&L ───────────────────────────────────────────────────────────────────────────────

export interface MonthLine { month: number; revenue: number; cost: number; profit: number }

export interface PnLResult {
  equivalentHours: number;
  actualHours: number;
  directWage: number;
  insurance: InsuranceResult;
  allowanceCostWorker: number;
  allowanceRevenue: number;
  revenue: RevenueResult;
  directCostMonth: number;
  indirectCostMonth: number;
  /** Chi phí 1 ĐẦU NGƯỜI/tháng — cơ sở tính giá sàn. */
  costPerHeadMonth: number;
  totalCostMonth: number;      // đã × headcount
  revenueMonth: number;        // 1 đầu người
  /** Lời/lỗ của MỘT tháng đang thu phí (AT-5/AT-6 dùng số này). */
  netProfitMonth: number;
  netMarginMonthPercent: number;
  timeline: MonthLine[];
  revenueTotal: number;
  totalCostTotal: number;
  grossProfit: number;
  netProfit: number;
  netMarginPercent: number;
  breakEvenPerWorkday: number;
  breakEvenPerHour: number;
  netToWorker: number;
}

export function computePnL(
  basis: WageBasis, volume: VolumeProfile, priceBook: PriceBook, allowances: AllowanceLine[],
  overhead: OverheadConfig, fee: ServiceFeeConfig,
): PnLResult {
  const table = buildWageTable(basis);
  const eh = equivalentHours(table, volume);
  const ah = actualHours(table, volume);
  const wage = directWage(table, volume);
  const insurance = computeInsurance(basis, allowances, overhead);
  const allowanceCostWorker = sumAllowanceWorker(allowances);
  const revenue = computeRevenue(table, volume, priceBook, allowances);

  // BUG-3: chi phí thật gồm cả KPCĐ 2%, phụ cấp thực chi, tuyển dụng phân bổ theo turnover và
  // chi phí vận hành — bản cũ chỉ trừ lương gross + BHXH nên "lời" bị thổi phồng.
  const directCostMonth = wage + allowanceCostWorker + insurance.employerInsurance + insurance.unionFee;
  const indirectCostMonth = overhead.opsCostPerHeadMonth + overhead.otherCostPerHeadMonth
    + overhead.recruitCostPerHire * (overhead.monthlyTurnoverPercent / 100);

  const headcount = Math.max(1, overhead.headcount);
  const horizon = Math.max(1, overhead.horizonMonths);
  const costPerHeadMonth = directCostMonth + indirectCostMonth;
  const totalCostMonth = costPerHeadMonth * headcount;

  // BUG-4: doanh thu có mốc hết hạn, chi phí thì KHÔNG — đây chính là vách lỗ mà UI cũ giấu mất
  // (vẫn hiện biên 16,6% ở tháng 7+ trong khi doanh thu đã bằng 0).
  const cliff = feeDurationMonths(fee);
  const timeline: MonthLine[] = Array.from({ length: horizon }, (_, i) => {
    const month = i + 1;
    const rev = (month <= cliff ? revenue.revenueMonth : 0) * headcount;
    return { month, revenue: rev, cost: totalCostMonth, profit: rev - totalCostMonth };
  });

  const revenueTotal = timeline.reduce((s, m) => s + m.revenue, 0);
  const totalCostTotal = totalCostMonth * horizon;
  const netProfitMonth = revenue.revenueMonth - costPerHeadMonth;

  return {
    equivalentHours: eh,
    actualHours: ah,
    directWage: wage,
    insurance,
    allowanceCostWorker,
    allowanceRevenue: revenue.revenueAllowance,
    revenue,
    directCostMonth,
    indirectCostMonth,
    costPerHeadMonth,
    totalCostMonth,
    revenueMonth: revenue.revenueMonth,
    netProfitMonth,
    netMarginMonthPercent: revenue.revenueMonth !== 0 ? netProfitMonth / revenue.revenueMonth * 100 : 0,
    timeline,
    revenueTotal,
    totalCostTotal,
    grossProfit: revenueTotal - directCostMonth * headcount * horizon,
    netProfit: revenueTotal - totalCostTotal,
    netMarginPercent: revenueTotal !== 0 ? (revenueTotal - totalCostTotal) / revenueTotal * 100 : 0,
    // Giá sàn tính TRÊN 1 ĐẦU NGƯỜI — nhân headcount vào giá sàn/ngày công là sai đơn vị.
    breakEvenPerWorkday: basis.workdaysPerMonth > 0 ? costPerHeadMonth / basis.workdaysPerMonth : 0,
    breakEvenPerHour: eh > 0 ? costPerHeadMonth / eh : 0,
    // CHƯA trừ thuế TNCN luỹ tiến (§10 non-goal) — chỉ ghi chú, không tự tính.
    netToWorker: wage + allowanceCostWorker - insurance.workerInsurance,
  };
}

// ── Compliance (BUG-9) ────────────────────────────────────────────────────────────────────

export interface SalaryBanner { level: 'red' | 'amber' | 'black'; message: string; blocksSave: boolean }

/** `dbBatches` = các lần nhập lương vùng đọc từ region_wage_batches (DB thắng hardcode). */
export function checkSalaryCompliance(
  basis: WageBasis, pnl: PnLResult, atDate: string | Date = new Date(), dbBatches: MinWageBatch[] = [],
): SalaryBanner[] {
  const banners: SalaryBanner[] = [];
  const rule = resolveMinWage(basis.region, atDate, dbBatches);
  const monthlyNormal = basis.shrPay * 8 * basis.workdaysPerMonth;
  const fmt = (n: number) => Math.round(n).toLocaleString('vi-VN');

  if (!rule) {
    // Thiếu ngưỡng pháp lý là rủi ro — nói ra, không im lặng cho qua.
    banners.push({
      level: 'amber', blocksSave: false,
      message: `Chưa tra được lương tối thiểu Vùng ${basis.region} tại thời điểm này — không kiểm tra được ngưỡng pháp lý.`,
    });
  } else {
    if (rule.hourly != null && basis.shrPay < rule.hourly) {
      banners.push({
        level: 'red', blocksSave: true,
        message: `Đơn giá giờ ${fmt(basis.shrPay)}đ/giờ thấp hơn lương tối thiểu giờ Vùng ${basis.region} (${fmt(rule.hourly)}đ/giờ theo ${rule.decree}).`,
      });
    }
    if (monthlyNormal < rule.monthly) {
      banners.push({
        level: 'red', blocksSave: true,
        message: `Lương tháng suy ra ${fmt(monthlyNormal)}đ thấp hơn lương tối thiểu Vùng ${basis.region} (${fmt(rule.monthly)}đ theo ${rule.decree}).`,
      });
    }
    const stale = minWageStaleNotice(atDate, dbBatches);
    if (stale) banners.push({ level: 'amber', blocksSave: false, message: stale });
  }

  if (pnl.netProfit < 0) {
    banners.push({
      level: 'amber', blocksSave: false,
      message: `Đang LỖ ${fmt(Math.abs(pnl.netProfit))}đ trên ${pnl.timeline.length} tháng — giá sàn cần ${fmt(pnl.breakEvenPerWorkday)}đ/ngày công.`,
    });
  }
  if (pnl.revenue.unpricedCodes.length > 0) {
    banners.push({
      level: 'amber', blocksSave: false,
      message: `${pnl.revenue.unpricedCodes.length} loại giờ có sản lượng nhưng chưa khai giá khách — doanh thu đang bị tính thiếu.`,
    });
  }
  return banners;
}
