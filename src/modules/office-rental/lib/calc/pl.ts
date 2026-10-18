import type {
  CalcData, CalcFee, CalcHeadLease, CalcSettings, CalcTenant, Landlord, MonthKey, MonthResult, MonthStatus,
} from './types';
import { gross, toVND, vatRateFor } from './vat';

// ── Giá head lease theo tháng ─────────────────────────────────────────────

/**
 * Giá gốc (chưa áp VAT) của khoản thuê tại tháng `m`, theo tiền tệ của khoản.
 * Trước tháng áp dụng → 0. Các mốc tăng cộng dồn (nhân liên tiếp) theo thứ tự tháng.
 */
export function priceAt(lease: Pick<CalcHeadLease, 'basePrice' | 'baseMonth' | 'endMonth' | 'increases'>, m: MonthKey): number {
  if (m < lease.baseMonth) return 0;
  if (lease.endMonth && m >= lease.endMonth) return 0;
  let p = lease.basePrice || 0;
  const incs = [...(lease.increases || [])].sort((a, b) => a.month.localeCompare(b.month));
  for (const inc of incs) {
    if (inc.month <= m) p = p * (1 + (inc.percent || 0) / 100);
  }
  return p;
}

/** Chi phí thực trả (gross, VNĐ) của khoản thuê tại tháng `m`. */
export function leaseCostVND(lease: CalcHeadLease, m: MonthKey, settings: CalcSettings): number {
  const g = gross(priceAt(lease, m), lease.vatMode, vatRateFor(settings, lease.vatCategory));
  return toVND(g, lease.currency, settings.exchangeRate);
}

// ── Doanh thu khách ───────────────────────────────────────────────────────

const EMPTY_FEE: CalcFee = { electricity: 0, moto: 0, car: 0 };

export function feeOf(data: CalcData, m: MonthKey, tenantId: string): CalcFee {
  return data.fees[m]?.[tenantId] || EMPTY_FEE;
}

/** Phí xe thô (VNĐ, trước VAT) = xe máy × đơn giá + ô tô × đơn giá. */
export function parkingRaw(fee: CalcFee, settings: Pick<CalcSettings, 'parkingPriceMoto' | 'parkingPriceCar'>): number {
  return (fee.moto || 0) * settings.parkingPriceMoto + (fee.car || 0) * settings.parkingPriceCar;
}

/** Phụ phí thô (VNĐ) = điện + phí xe. */
export function feesRaw(fee: CalcFee, settings: Pick<CalcSettings, 'parkingPriceMoto' | 'parkingPriceCar'>): number {
  return (fee.electricity || 0) + parkingRaw(fee, settings);
}

/** Tiền thuê thực thu (gross, VNĐ). */
export function rentGrossVND(tenant: CalcTenant, amount: number, settings: CalcSettings): number {
  return toVND(gross(amount || 0, tenant.vatMode, settings.vatRateRent), tenant.currency, settings.exchangeRate);
}

/** Phụ phí điện/xe thực thu (gross, VNĐ — phụ phí luôn bằng VNĐ). */
export function utilGross(tenant: CalcTenant, rawVND: number, settings: CalcSettings): number {
  return gross(rawVND || 0, tenant.vatMode, settings.vatRateUtil);
}

export interface TenantMonth {
  rentInput: number;
  rent: number;
  electricity: number;
  parking: number;
  fees: number;
  total: number;
}

export function tenantMonth(data: CalcData, m: MonthKey, tenant: CalcTenant): TenantMonth {
  const s = data.settings;
  const rentInput = data.rent[m]?.[tenant.id] || 0;
  const fee = feeOf(data, m, tenant.id);
  const rent = rentGrossVND(tenant, rentInput, s);
  const electricity = utilGross(tenant, fee.electricity || 0, s);
  const parking = utilGross(tenant, parkingRaw(fee, s), s);
  return { rentInput, rent, electricity, parking, fees: electricity + parking, total: rent + electricity + parking };
}

// ── Lời / lỗ theo tháng ───────────────────────────────────────────────────

export function forecastAt(data: CalcData, m: MonthKey): number {
  return data.forecasts.filter(f => f.month === m).reduce((a, f) => a + (f.amount || 0), 0);
}

export function opexAt(data: CalcData, m: MonthKey): number {
  const om = data.opex[m] || {};
  return data.opexCategories.reduce(
    (a, c) => a + gross(om[c.id] || 0, c.vatMode, vatRateFor(data.settings, c.vatCategory)), 0);
}

export function landlordCost(data: CalcData, m: MonthKey, landlord: Landlord): number {
  return data.headLeases
    .filter(l => l.landlord === landlord)
    .reduce((a, l) => a + leaseCostVND(l, m, data.settings), 0);
}

export function computeMonth(data: CalcData, m: MonthKey): MonthResult {
  const mbt = landlordCost(data, m, 'mbt');
  const ts4 = landlordCost(data, m, 'ts4');
  let rentRevenue = 0;
  let feeRevenue = 0;
  for (const t of data.tenants) {
    const x = tenantMonth(data, m, t);
    rentRevenue += x.rent;
    feeRevenue += x.fees;
  }
  const revenue = rentRevenue + feeRevenue;
  const opex = opexAt(data, m);
  const forecast = forecastAt(data, m);
  const cost = mbt + ts4 + opex + (data.settings.includeForecastInCost ? forecast : 0);
  const profit = revenue - cost;
  return { month: m, mbt, ts4, opex, rentRevenue, feeRevenue, revenue, forecast, cost, profit, margin: revenue > 0 ? profit / revenue : 0 };
}

/** Tháng "có doanh thu" = có ít nhất 1 khách tiền thuê > 0. */
export function hasRevenue(data: CalcData, m: MonthKey): boolean {
  const rm = data.rent[m] || {};
  return data.tenants.some(t => (rm[t.id] || 0) > 0);
}

export function monthStatus(data: CalcData, m: MonthKey, current: MonthKey): MonthStatus {
  if (hasRevenue(data, m)) return 'actual';
  return m > current ? 'future' : 'missing';
}

export function sumResults(rows: MonthResult[]): Omit<MonthResult, 'month' | 'margin'> & { margin: number } {
  const t = rows.reduce((a, r) => ({
    mbt: a.mbt + r.mbt, ts4: a.ts4 + r.ts4, opex: a.opex + r.opex,
    rentRevenue: a.rentRevenue + r.rentRevenue, feeRevenue: a.feeRevenue + r.feeRevenue,
    revenue: a.revenue + r.revenue, forecast: a.forecast + r.forecast, cost: a.cost + r.cost, profit: a.profit + r.profit,
  }), { mbt: 0, ts4: 0, opex: 0, rentRevenue: 0, feeRevenue: 0, revenue: 0, forecast: 0, cost: 0, profit: 0 });
  return { ...t, margin: t.revenue > 0 ? t.profit / t.revenue : 0 };
}

// ── Lời / lỗ theo mặt bằng ────────────────────────────────────────────────

export type BucketKind = 'lease' | 'parking' | 'unassigned';

export interface UnitBucketTenant {
  tenantId: string;
  name: string;
  rent: number;
  electricity: number;
  parking: number;
  revenue: number;
}

export interface UnitBucket {
  key: string;
  kind: BucketKind;
  name: string;
  landlord: Landlord | null;
  leaseIds: string[];
  revenue: number;
  cost: number;
  profit: number;
  tenants: UnitBucketTenant[];
}

export interface UnitPLResult {
  month: MonthKey;
  buckets: UnitBucket[];
  /** Khách chưa gán mặt bằng (kể cả chưa có doanh thu tháng này) */
  unassignedTenants: { id: string; name: string }[];
  opex: number;
  forecast: number;
  forecastInCost: boolean;
  bucketProfit: number;
  /** Σ bucket − opex − (cộng dự kiến ? forecast : 0) */
  reconciledProfit: number;
  dashboardProfit: number;
  diff: number;
  ok: boolean;
}

/**
 * Lời/lỗ riêng từng mặt bằng:
 * - Mỗi head lease không phải bãi xe: chi phí = giá thuê; doanh thu = thuê + điện của khách gán vào.
 * - Bãi xe: chi phí = các head lease is_parking; doanh thu = phí xe của TẤT CẢ khách.
 * - Chưa gán: thuê + điện của khách chưa gán, chi phí 0.
 * Chi phí vận hành là chi phí chung, không phân bổ.
 */
export function unitPL(data: CalcData, m: MonthKey): UnitPLResult {
  const s = data.settings;
  const leaseById = new Map(data.headLeases.map(l => [l.id, l]));
  const parkingLeases = data.headLeases.filter(l => l.isParking);
  const parkingKey = 'parking';

  const buckets: UnitBucket[] = [];
  const byKey = new Map<string, UnitBucket>();
  for (const l of data.headLeases) {
    if (l.isParking) continue;
    const b: UnitBucket = {
      key: l.id, kind: 'lease', name: l.name, landlord: l.landlord, leaseIds: [l.id],
      revenue: 0, cost: leaseCostVND(l, m, s), profit: 0, tenants: [],
    };
    buckets.push(b);
    byKey.set(l.id, b);
  }
  const parking: UnitBucket = {
    key: parkingKey, kind: 'parking',
    name: parkingLeases.length === 1 ? parkingLeases[0].name : 'Bãi giữ xe',
    landlord: parkingLeases[0]?.landlord ?? null,
    leaseIds: parkingLeases.map(l => l.id),
    revenue: 0, cost: parkingLeases.reduce((a, l) => a + leaseCostVND(l, m, s), 0), profit: 0, tenants: [],
  };
  const unassigned: UnitBucket = {
    key: 'unassigned', kind: 'unassigned', name: 'Chưa gán mặt bằng', landlord: null, leaseIds: [],
    revenue: 0, cost: 0, profit: 0, tenants: [],
  };

  const unassignedTenants: { id: string; name: string }[] = [];
  for (const t of data.tenants) {
    const x = tenantMonth(data, m, t);
    const lease = t.headLeaseId ? leaseById.get(t.headLeaseId) : undefined;
    if (!lease) unassignedTenants.push({ id: t.id, name: t.name });
    const target = !lease ? unassigned : lease.isParking ? parking : byKey.get(lease.id)!;
    const own = x.rent + x.electricity;
    target.revenue += own;
    parking.revenue += x.parking;
    if (own) target.tenants.push({ tenantId: t.id, name: t.name, rent: x.rent, electricity: x.electricity, parking: 0, revenue: own });
    if (x.parking) parking.tenants.push({ tenantId: t.id, name: t.name, rent: 0, electricity: 0, parking: x.parking, revenue: x.parking });
  }

  if (parkingLeases.length || parking.revenue) buckets.push(parking);
  if (unassigned.revenue || unassignedTenants.length) buckets.push(unassigned);
  for (const b of buckets) b.profit = b.revenue - b.cost;

  const opex = opexAt(data, m);
  const forecast = forecastAt(data, m);
  const forecastInCost = s.includeForecastInCost;
  const bucketProfit = buckets.reduce((a, b) => a + b.profit, 0);
  const reconciledProfit = bucketProfit - opex - (forecastInCost ? forecast : 0);
  const dashboardProfit = computeMonth(data, m).profit;
  const diff = reconciledProfit - dashboardProfit;
  return {
    month: m, buckets, unassignedTenants, opex, forecast, forecastInCost,
    bucketProfit, reconciledProfit, dashboardProfit, diff, ok: Math.abs(diff) < 1,
  };
}
