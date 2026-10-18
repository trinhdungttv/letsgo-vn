// Đọc file JSON của tracker cũ (orient_pl_*.json, version 3 hoặc 4) thành dạng chuẩn hoá theo TÊN.
// Thuần TS — không đụng DB. Việc ghi vào bds_* nằm ở data/importTracker.ts.

import type { CalcData, CalcSettings, Currency, Landlord, MonthKey, VatCategory, VatMode } from '../calc/types';
import { isMonthKey } from '../calc/months';

export interface SnapshotSettings {
  exchangeRate?: number;
  vatRateRent?: number;
  vatRateUtil?: number;
  parkingPriceMoto?: number;
  parkingPriceCar?: number;
  startMonth?: MonthKey;
  rangeMonths?: number;
  includeForecastInCost?: boolean;
  hideEmptyMonths?: boolean;
  showFeePanel?: boolean;
}

export interface SnapshotHeadLease {
  key: string;
  landlord: Landlord;
  name: string;
  currency: Currency;
  basePrice: number;
  baseMonth: MonthKey;
  endMonth: MonthKey | null;
  vatMode: VatMode;
  vatCategory: VatCategory;
  isParking: boolean;
  note: string | null;
  increases: { month: MonthKey; percent: number }[];
}

export interface SnapshotTenant {
  key: string;
  name: string;
  currency: Currency;
  vatMode: VatMode;
  headLeaseKey: string | null;
  areaM2: number | null;
  active: boolean;
  note: string | null;
}

export interface SnapshotOpexCategory {
  key: string;
  name: string;
  vatMode: VatMode;
  vatCategory: VatCategory;
}

export interface SnapshotScenario {
  name: string;
  headLeaseKey: string | null;
  referenceMonth: MonthKey | null;
  targetCost: number;
  extraCost: number;
  parentAreaM2: number | null;
  note: string | null;
  rooms: { name: string; areaM2: number; currency: Currency; price: number; vatMode: VatMode }[];
}

export interface TrackerSnapshot {
  version: number;
  settings: SnapshotSettings;
  headLeases: SnapshotHeadLease[];
  tenants: SnapshotTenant[];
  opexCategories: SnapshotOpexCategory[];
  rent: { tenantKey: string; month: MonthKey; amount: number }[];
  fees: { tenantKey: string; month: MonthKey; electricity: number; moto: number; car: number }[];
  opex: { categoryKey: string; month: MonthKey; amount: number }[];
  forecasts: { name: string; month: MonthKey; amount: number; note: string | null }[];
  scenarios: SnapshotScenario[];
  warnings: string[];
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(/,/g, '')) : NaN;
  return Number.isFinite(n) ? n : 0;
};
const nonNeg = (v: unknown): number => Math.max(0, num(v));
const optNum = (v: unknown): number | undefined => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
};
const cur = (v: unknown): Currency => (v === 'USD' ? 'USD' : 'VND');
const vat = (v: unknown): VatMode => (v === 'incl' || v === 'excl' ? v : 'none');
const vatCat = (v: unknown, fallback: VatCategory): VatCategory => (v === 'util' || v === 'rent' ? v : fallback);
const bool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined);
const month = (v: unknown): MonthKey | null => {
  const s = str(v).slice(0, 7);
  return isMonthKey(s) ? s : null;
};

/** Bãi xe: tên có chữ "xe" (Bãi giữ xe, Hầm xe…) hoặc id u_xe của tracker. */
export function looksLikeParking(id: string, name: string): boolean {
  return id === 'u_xe' || /(^|\s)xe(\s|$)/i.test(name.normalize('NFC'));
}

export function parseTrackerJson(raw: unknown): { snapshot?: TrackerSnapshot; error?: string } {
  if (!isObj(raw)) return { error: 'File không phải JSON object.' };
  const version = num(raw.version);
  if (version !== 3 && version !== 4) {
    return { error: `Chỉ hỗ trợ file tracker version 3 hoặc 4 (file này: ${raw.version ?? 'không có version'}).` };
  }
  const warnings: string[] = [];

  // Cài đặt — v3 chỉ có 1 thuế suất `vatRate` → áp cho cả thuê lẫn điện/xe để giữ đúng cách tính cũ.
  const settings: SnapshotSettings = {
    exchangeRate: optNum(raw.exchangeRate),
    vatRateRent: optNum(raw.vatRateRent) ?? optNum(raw.vatRate),
    vatRateUtil: optNum(raw.vatRateUtil) ?? optNum(raw.vatRate),
    parkingPriceMoto: optNum(raw.parkingPriceMoto),
    parkingPriceCar: optNum(raw.parkingPriceCar),
    startMonth: month(raw.startMonth) ?? undefined,
    rangeMonths: [12, 18, 24, 36].includes(num(raw.range)) ? num(raw.range) : undefined,
    includeForecastInCost: bool(raw.includeForecastInCost),
    hideEmptyMonths: bool(raw.hideEmpty),
    showFeePanel: bool(raw.showCustFees),
  };

  const headLeases: SnapshotHeadLease[] = [];
  const payables = isObj(raw.payables) ? raw.payables : {};
  for (const landlord of ['mbt', 'ts4'] as const) {
    const grp = payables[landlord];
    const units = isObj(grp) && Array.isArray(grp.units) ? grp.units : [];
    for (const u of units) {
      if (!isObj(u)) continue;
      const key = str(u.id) || `${landlord}_${headLeases.length}`;
      const name = str(u.name);
      if (!name) { warnings.push(`Bỏ qua 1 khoản thuê ${landlord.toUpperCase()} không có tên.`); continue; }
      const baseMonth = month(u.baseMonth);
      if (!baseMonth) warnings.push(`"${name}": tháng áp dụng không hợp lệ → dùng 2026-01.`);
      const parking = typeof u.isParking === 'boolean' ? u.isParking : looksLikeParking(key, name);
      const increases = (Array.isArray(u.increases) ? u.increases : [])
        .filter(isObj)
        .map(i => ({ month: month(i.month), percent: num(i.percent) }))
        .filter((i): i is { month: MonthKey; percent: number } => !!i.month && i.percent > -100);
      headLeases.push({
        key, landlord, name,
        currency: cur(u.currency),
        basePrice: nonNeg(u.basePrice),
        baseMonth: baseMonth ?? '2026-01',
        endMonth: month(u.endMonth),
        vatMode: vat(u.vatMode),
        vatCategory: vatCat(u.vatCategory, parking ? 'util' : 'rent'),
        isParking: parking,
        note: str(u.note) || null,
        increases,
      });
    }
  }

  const tenants: SnapshotTenant[] = [];
  const seenTenant = new Set<string>();
  for (const c of Array.isArray(raw.customers) ? raw.customers : []) {
    if (!isObj(c)) continue;
    const name = str(c.name);
    if (!name) continue;
    const lower = name.toLocaleLowerCase('vi');
    if (seenTenant.has(lower)) { warnings.push(`Khách "${name}" bị trùng tên trong file — gộp làm một.`); continue; }
    seenTenant.add(lower);
    const leaseKey = str(c.unitId) || str(c.headLeaseId) || null;
    tenants.push({
      key: str(c.id) || name,
      name,
      currency: cur(c.currency),
      vatMode: vat(c.vatMode),
      headLeaseKey: leaseKey && headLeases.some(h => h.key === leaseKey) ? leaseKey : null,
      areaM2: optNum(c.areaM2) ?? null,
      active: bool(c.active) ?? true,
      note: str(c.note) || null,
    });
  }
  const tenantKeys = new Set(tenants.map(t => t.key));

  const opexCategories: SnapshotOpexCategory[] = [];
  for (const o of Array.isArray(raw.opexCats) ? raw.opexCats : []) {
    if (!isObj(o)) continue;
    const name = str(o.name);
    if (!name) continue;
    if (opexCategories.some(x => x.name.toLowerCase() === name.toLowerCase())) continue;
    opexCategories.push({ key: str(o.id) || name, name, vatMode: vat(o.vatMode), vatCategory: vatCat(o.vatCategory, 'rent') });
  }
  const opexKeys = new Set(opexCategories.map(o => o.key));

  const rent: TrackerSnapshot['rent'] = [];
  if (isObj(raw.revenue)) {
    for (const [mk, row] of Object.entries(raw.revenue)) {
      const m = month(mk);
      if (!m || !isObj(row)) continue;
      for (const [tk, v] of Object.entries(row)) {
        const amount = nonNeg(v);
        if (amount > 0 && tenantKeys.has(tk)) rent.push({ tenantKey: tk, month: m, amount });
      }
    }
  }

  const fees: TrackerSnapshot['fees'] = [];
  if (isObj(raw.custFees)) {
    for (const [mk, row] of Object.entries(raw.custFees)) {
      const m = month(mk);
      if (!m || !isObj(row)) continue;
      for (const [tk, v] of Object.entries(row)) {
        if (!isObj(v) || !tenantKeys.has(tk)) continue;
        const f = { electricity: nonNeg(v.dien), moto: Math.round(nonNeg(v.moto)), car: Math.round(nonNeg(v.car)) };
        if (f.electricity || f.moto || f.car) fees.push({ tenantKey: tk, month: m, ...f });
      }
    }
  }

  const opex: TrackerSnapshot['opex'] = [];
  if (isObj(raw.opex)) {
    for (const [mk, row] of Object.entries(raw.opex)) {
      const m = month(mk);
      if (!m || !isObj(row)) continue;
      for (const [ck, v] of Object.entries(row)) {
        const amount = nonNeg(v);
        if (amount > 0 && opexKeys.has(ck)) opex.push({ categoryKey: ck, month: m, amount });
      }
    }
  }

  const forecasts: TrackerSnapshot['forecasts'] = [];
  for (const f of Array.isArray(raw.forecastExpenses) ? raw.forecastExpenses : []) {
    if (!isObj(f)) continue;
    const name = str(f.name);
    const m = month(f.month);
    if (!name || !m) continue;
    forecasts.push({ name, month: m, amount: nonNeg(f.amount), note: str(f.note) || null });
  }

  const scenarios: SnapshotScenario[] = [];
  for (const s of Array.isArray(raw.breakevenScenarios) ? raw.breakevenScenarios : []) {
    if (!isObj(s) || !str(s.name)) continue;
    const leaseKey = str(s.headLeaseKey) || str(s.unitId) || null;
    scenarios.push({
      name: str(s.name),
      headLeaseKey: leaseKey && headLeases.some(h => h.key === leaseKey) ? leaseKey : null,
      referenceMonth: month(s.referenceMonth),
      targetCost: nonNeg(s.targetCost),
      extraCost: nonNeg(s.extraCost),
      parentAreaM2: optNum(s.parentAreaM2) ?? null,
      note: str(s.note) || null,
      rooms: (Array.isArray(s.rooms) ? s.rooms : []).filter(isObj).map(r => ({
        name: str(r.name), areaM2: nonNeg(r.areaM2), currency: cur(r.currency), price: nonNeg(r.price), vatMode: vat(r.vatMode),
      })),
    });
  }

  return {
    snapshot: { version, settings, headLeases, tenants, opexCategories, rent, fees, opex, forecasts, scenarios, warnings },
  };
}

export const DEFAULT_CALC_SETTINGS: CalcSettings = {
  exchangeRate: 26000,
  vatRateRent: 10,
  vatRateUtil: 8,
  parkingPriceMoto: 150000,
  parkingPriceCar: 1500000,
  includeForecastInCost: false,
};

/** Dựng CalcData từ snapshot (dùng cho xem trước + test). Khoá = key trong file. */
export function snapshotToCalcData(s: TrackerSnapshot, settings: CalcSettings): CalcData {
  const data: CalcData = {
    settings,
    headLeases: s.headLeases.map(h => ({
      id: h.key, landlord: h.landlord, name: h.name, currency: h.currency, basePrice: h.basePrice,
      baseMonth: h.baseMonth, endMonth: h.endMonth, vatMode: h.vatMode, vatCategory: h.vatCategory,
      isParking: h.isParking, increases: h.increases,
    })),
    tenants: s.tenants.map(t => ({ id: t.key, name: t.name, currency: t.currency, vatMode: t.vatMode, headLeaseId: t.headLeaseKey })),
    opexCategories: s.opexCategories.map(o => ({ id: o.key, name: o.name, vatMode: o.vatMode, vatCategory: o.vatCategory })),
    forecasts: s.forecasts.map(f => ({ month: f.month, amount: f.amount })),
    rent: {},
    fees: {},
    opex: {},
  };
  for (const r of s.rent) (data.rent[r.month] ||= {})[r.tenantKey] = r.amount;
  for (const f of s.fees) (data.fees[f.month] ||= {})[f.tenantKey] = { electricity: f.electricity, moto: f.moto, car: f.car };
  for (const o of s.opex) (data.opex[o.month] ||= {})[o.categoryKey] = o.amount;
  return data;
}
