// Mô hình dữ liệu cho "Tính bảng lương" — 5 tầng L1→L5 (SPEC §2/§3).
//
// NGUYÊN TẮC BẤT BIẾN: SHR là nguồn sự thật duy nhất. Mọi con số khác là hàm của
// (SHR × hệ số × sản lượng). Dòng dữ liệu MỘT CHIỀU, không vòng:
//   L1 WAGE ENGINE  → SHR ⇄ 14 dòng đơn giá
//   L2 VOLUME       → số ca/giờ từng loại giờ
//   L3 PRICE BOOK   → cột "Khách trả ta" — DUY NHẤT 1 nguồn doanh thu
//   L4 P&L          → DT / CP trực / CP gián / LN / Giá sàn
//   L5 COMPETITIVE  → n×NCC → SHR_max, SHR_đề xuất, biên ngầm đối thủ
//
// WageCode dùng LẠI PayrollInputType của engine cũ (src/lib/payroll/coefficients.ts) thay vì
// khai báo lại 14 mã y hệt: 2 danh sách song song chắc chắn sẽ lệch nhau khi luật đổi, và đó
// đúng là loại lỗi "nhiều nguồn sự thật" mà bản rebuild này sinh ra để dẹp (BUG-1).
import type { PayrollInputType } from '../../lib/payroll/coefficients';

export type WageCode = PayrollInputType;

export type WageUnit = 'month' | 'shift8h' | 'shift12h' | 'hour';

/** Nhóm hiển thị — cũng là nhóm nhập sản lượng ở khối L2. */
export type WageGroup = 'BASE' | 'FULL_SHIFT' | 'OVERTIME' | 'SHIFT_12H';

export interface WageRowDef {
  code: WageCode;
  label: string;
  coefficient: number;   // 1.0, 1.3, 3.9 … — hệ số danh nghĩa theo luật
  unit: WageUnit;
  /** month → 0 (phải dùng workdaysPerMonth × 8), shift8h → 8, shift12h → 12, hour → 1. */
  hoursPerUnit: number;
  group: WageGroup;
  /** base_salary = false — lương tháng KHÔNG phải 1 loại giờ, cộng vào sản lượng là tính 2 lần. */
  countsInVolume: boolean;
}

// Vùng lương + bảng mức tối thiểu dùng CHUNG toàn app (src/lib/minWage.ts), không khai lại ở đây.
export type { RegionZone, MinWageRule, MinWageBatch } from '../../lib/minWage';
import type { RegionZone } from '../../lib/minWage';

// ── L1 ────────────────────────────────────────────────────────────────────────────────────
export interface WageBasis {
  /** Đơn giá giờ chuẩn TRẢ THỰC. */
  shrPay: number;
  /** BUG-5: nền BHXH thường THẤP HƠN đơn giá trả thực (NCC đóng trên mức tối thiểu vùng, không
   *  đóng trên lương thực trả). Gộp 2 đại lượng này làm 1 khiến chi phí BHXH bị tính vống →
   *  tưởng lỗ trong khi đối thủ vẫn lời. 'linked' giữ hành vi cũ, 'custom' mới là thực tế. */
  shrBhxhMode: 'linked' | 'custom';
  shrBhxhCustom?: number;
  workdaysPerMonth: number;
  region: RegionZone;
  /** BUG-8: luật quy định 300% ngày lễ CHƯA KỂ tiền lương ngày lễ hưởng nguyên lương (Điều 112
   *  BLLĐ 2019) ⇒ tổng thực chi thường là 400%. Mặc định BẬT. */
  includeHolidayBasePay: boolean;
  /** Khoá tay từng dòng — gõ theo ĐƠN VỊ TỰ NHIÊN của dòng đó (đ/tháng, đ/ca, đ/giờ). */
  overrides: Partial<Record<WageCode, number>>;
  /** Chỉ ảnh hưởng 'ot_night_weekday' — xem computeNightOTCoefficient(). */
  priorDayOt: boolean;
}

// ── L2 ────────────────────────────────────────────────────────────────────────────────────
export interface VolumeProfile {
  id: string;
  name: string;
  /** shift8h/shift12h → số CA; hour → số GIỜ. Đơn vị bám theo WageRowDef.unit. */
  quantities: Partial<Record<WageCode, number>>;
}

// ── L3 ────────────────────────────────────────────────────────────────────────────────────
export type PriceBookMode = 'manual' | 'markupPercent' | 'markupPerHour' | 'singleDayRate';

export interface PriceBook {
  mode: PriceBookMode;
  markupPercent?: number;
  markupPerHour?: number;
  /** Ghi vào day_wage_8h rồi nhân hệ số ra các dòng còn lại. */
  singleDayRate?: number;
  manual: Partial<Record<WageCode, number>>;
  vatPercent: number;
}

/** 1 khoản phụ cấp LUÔN có 2 MẶT — cùng quy ước với AllowanceItem bên lib/payroll/rateCard.ts. */
export interface AllowanceLine {
  id: string;
  name: string;
  customerPays: number;   // doanh thu
  weOweWorker: number;    // chi phí
  taxable: boolean;       // có tính vào nền BHXH không
}

// ── L4 ────────────────────────────────────────────────────────────────────────────────────
export interface OverheadConfig {
  unionFeePercent: number;
  employerInsurancePercent: number;
  workerInsurancePercent: number;
  recruitCostPerHire: number;
  monthlyTurnoverPercent: number;
  opsCostPerHeadMonth: number;
  otherCostPerHeadMonth: number;
  headcount: number;
  horizonMonths: number;
  targetNetMarginPercent: number;
}

/** Config phí dịch vụ cũ — GIỮ LẠI nhưng đã MẤT vai trò nguồn doanh thu (BUG-1). Giờ nó chỉ
 *  còn 2 việc: (a) sinh ra PriceBook.manual qua priceBookFromServiceFee(), (b) cho biết doanh
 *  thu tắt ở tháng thứ mấy (BUG-4 — phí giới thiệu có thời hạn). */
export type ServiceFeeType = 'per_day_worked' | 'referral_hourly' | 'referral_daily_limited';
export type ReferralDurationMode = 'one_time' | 'recurring_months';

export interface ServiceFeeConfig {
  type: ServiceFeeType;
  value: number;
  durationMode: ReferralDurationMode;
  months: number;
  feeHoursPerDay: number;
}

// ── L5 ────────────────────────────────────────────────────────────────────────────────────
export interface SupplierQuote {
  id: string;
  supplierName: string;
  isUs: boolean;
  contactNote?: string;
  /** Mỗi NCC = 1 WageEngine đầy đủ, không phải 1 con số — có vậy mới giữ được bảng 14 dòng
   *  của họ để so từng loại giờ (BUG-10). */
  basis: WageBasis;
  allowances: AllowanceLine[];
}

export interface Scenario {
  version: 2;
  customerName: string;
  industrialZone: string;
  us: SupplierQuote;
  competitors: SupplierQuote[];
  /** DÙNG CHUNG cho mọi NCC — mỗi NCC một profile riêng thì so sánh vô nghĩa. */
  volume: VolumeProfile;
  priceBook: PriceBook;
  overhead: OverheadConfig;
  serviceFee: ServiceFeeConfig;
}

// ── Mặc định ──────────────────────────────────────────────────────────────────────────────
export const DEFAULT_OVERHEAD: OverheadConfig = {
  unionFeePercent: 2,
  employerInsurancePercent: 21.5,
  workerInsurancePercent: 10.5,
  recruitCostPerHire: 0,
  monthlyTurnoverPercent: 0,
  opsCostPerHeadMonth: 0,
  otherCostPerHeadMonth: 0,
  headcount: 1,
  horizonMonths: 12,
  targetNetMarginPercent: 8,
};

export const DEFAULT_PRICE_BOOK: PriceBook = { mode: 'manual', manual: {}, vatPercent: 8 };
