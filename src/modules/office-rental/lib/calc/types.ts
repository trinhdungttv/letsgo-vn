// Kiểu dữ liệu của calc engine — thuần TS, không phụ thuộc React/Supabase.
// Tháng luôn là khoá 'YYYY-MM'. Tiền là số thực, chỉ làm tròn ở lớp hiển thị.

export type Currency = 'VND' | 'USD';
export type VatMode = 'none' | 'incl' | 'excl';
export type VatCategory = 'rent' | 'util';
export type Landlord = 'mbt' | 'ts4';
export type MonthKey = string;

export interface CalcSettings {
  exchangeRate: number;
  /** % — VAT tiền thuê mặt bằng */
  vatRateRent: number;
  /** % — VAT điện & bãi xe */
  vatRateUtil: number;
  parkingPriceMoto: number;
  parkingPriceCar: number;
  includeForecastInCost: boolean;
}

export interface CalcIncrease {
  month: MonthKey;
  percent: number;
}

export interface CalcHeadLease {
  id: string;
  landlord: Landlord;
  name: string;
  currency: Currency;
  basePrice: number;
  baseMonth: MonthKey;
  /** Trả mặt bằng từ tháng này (giá = 0 từ tháng này trở đi). */
  endMonth?: MonthKey | null;
  vatMode: VatMode;
  vatCategory: VatCategory;
  isParking: boolean;
  increases: CalcIncrease[];
}

export interface CalcTenant {
  id: string;
  name: string;
  currency: Currency;
  vatMode: VatMode;
  headLeaseId: string | null;
}

export interface CalcFee {
  electricity: number;
  moto: number;
  car: number;
}

export interface CalcOpexCategory {
  id: string;
  name: string;
  vatMode: VatMode;
  vatCategory: VatCategory;
}

export interface CalcForecast {
  month: MonthKey;
  amount: number;
}

export interface CalcData {
  settings: CalcSettings;
  headLeases: CalcHeadLease[];
  tenants: CalcTenant[];
  opexCategories: CalcOpexCategory[];
  forecasts: CalcForecast[];
  /** rent[month][tenantId] = số nhập (theo tiền tệ của khách) */
  rent: Record<MonthKey, Record<string, number>>;
  /** fees[month][tenantId] — điện (VNĐ) + số lượng xe */
  fees: Record<MonthKey, Record<string, CalcFee>>;
  /** opex[month][categoryId] = VNĐ */
  opex: Record<MonthKey, Record<string, number>>;
}

export interface MonthResult {
  month: MonthKey;
  mbt: number;
  ts4: number;
  opex: number;
  /** Tiền thuê (gross, VNĐ) */
  rentRevenue: number;
  /** Điện + xe (gross, VNĐ) */
  feeRevenue: number;
  revenue: number;
  forecast: number;
  cost: number;
  profit: number;
  /** tỉ lệ 0..1 */
  margin: number;
}

export type MonthStatus = 'actual' | 'future' | 'missing';
