// Fixture dùng chung cho bộ Acceptance Test (SPEC §9).
// Mặc định của §9: shrPay = 41.500, workdaysPerMonth = 26, region = 'I', allowances = [].
import type {
  WageBasis, VolumeProfile, PriceBook, OverheadConfig, ServiceFeeConfig, SupplierQuote,
} from '../types';
import { DEFAULT_OVERHEAD } from '../types';

export const SHR = 41_500;
export const WD = 26;

/** Ngày cố định cho mọi test có liên quan lương tối thiểu — dùng "hôm nay" thì test sẽ tự vỡ
 *  theo thời gian, và mốc pháp lý là dữ liệu có hiệu lực theo ngày nên phải ghim. */
export const AT_DATE = '2025-06-30';

export const basis = (over: Partial<WageBasis> = {}): WageBasis => ({
  shrPay: SHR,
  shrBhxhMode: 'linked',
  workdaysPerMonth: WD,
  region: 'I',
  includeHolidayBasePay: false,
  overrides: {},
  priorDayOt: false,
  ...over,
});

export const vol = (quantities: VolumeProfile['quantities'], name = 'test'): VolumeProfile =>
  ({ id: 'v', name, quantities });

/** Volume chỉ ca ngày — dùng cho AT-2, AT-5, AT-6, AT-7 (EH = 208). */
export const VOL_DAY_ONLY = vol({ day_wage_8h: WD });

/** Preset "Ca 8h + 2h OT" — AT-3, AT-16 (EH = 302). */
export const VOL_DAY_PLUS_OT = vol({ day_wage_8h: WD, ot_day_weekday: 52, ot_day_sunday: 8 });

/** Preset "Ca 12h luân phiên 4/4" — AT-4 (EH = 421,2). */
export const VOL_SHIFT12 = vol({ shift12_day: 13, shift12_night: 13 });

/** §9 mặc định: KPCĐ tính 2%, không có chi phí gián tiếp, chân trời 12 tháng. */
export const overhead = (over: Partial<OverheadConfig> = {}): OverheadConfig => ({
  ...DEFAULT_OVERHEAD, ...over,
});

/** Phí dịch vụ lâu dài — không tạo vách doanh thu, dùng khi test không quan tâm timeline. */
export const FEE_UNLIMITED: ServiceFeeConfig =
  { type: 'per_day_worked', value: 0, durationMode: 'one_time', months: 6, feeHoursPerDay: 8 };

/** Phí giới thiệu theo giờ, thu hàng tháng trong 6 tháng — AT-10, AT-14, AT-18. */
export const FEE_REFERRAL_6M: ServiceFeeConfig =
  { type: 'referral_hourly', value: 10_000, durationMode: 'recurring_months', months: 6, feeHoursPerDay: 8 };

export const pbSingleDay = (rate: number): PriceBook =>
  ({ mode: 'singleDayRate', singleDayRate: rate, manual: {}, vatPercent: 8 });

export const pbManual = (manual: PriceBook['manual']): PriceBook =>
  ({ mode: 'manual', manual, vatPercent: 8 });

export const pbMarkupPercent = (pct: number): PriceBook =>
  ({ mode: 'markupPercent', markupPercent: pct, manual: {}, vatPercent: 8 });

export const rival = (id: string, shrPay: number, over: Partial<WageBasis> = {}): SupplierQuote => ({
  id, supplierName: `NCC ${id}`, isUs: false, basis: basis({ shrPay, ...over }), allowances: [],
});
