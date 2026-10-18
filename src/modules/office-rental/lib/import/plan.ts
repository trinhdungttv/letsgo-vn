// Xem trước (dry-run) việc nhập file tracker: đếm số bản ghi sẽ tạo / cập nhật / xoá. Thuần TS.
import type { BdsHeadLease, BdsOpexCategory, BdsSettings, BdsTables, BdsTenant } from '../types';
import { monthToDate } from '../calc/months';
import { normName } from '../calc/csv';
import type { TrackerSnapshot } from './tracker';

export type PlanRows = Pick<{ [K in keyof BdsTables]: BdsTables[K][] },
  'bds_head_leases' | 'bds_head_lease_increases' | 'bds_tenants' | 'bds_tenant_rent' | 'bds_tenant_fees' |
  'bds_opex_categories' | 'bds_opex_monthly' | 'bds_forecast_expenses' | 'bds_breakeven_scenarios' | 'bds_breakeven_rooms' |
  'bds_meter_readings' | 'bds_invoices'>;

export const leaseMatchKey = (landlord: string, name: string) => `${landlord}|${normName(name)}`;
export const forecastMatchKey = (name: string, month: string) => `${normName(name)}|${month.slice(0, 7)}`;

export interface CountPair { create: number; update: number }

export interface ImportPlan {
  headLeases: CountPair;
  increases: number;
  tenants: CountPair;
  opexCategories: CountPair;
  rent: CountPair;
  fees: CountPair;
  opex: CountPair;
  forecasts: CountPair;
  scenarios: CountPair;
  settingsChanges: { label: string; from: string; to: string }[];
  /** Chỉ có khi chọn "thay thế toàn bộ" */
  deletes: { label: string; count: number }[] | null;
}

export interface ImportOptions {
  replaceAll: boolean;
  includeSettings: boolean;
}

export function matchExisting(s: TrackerSnapshot, rows: Pick<PlanRows, 'bds_head_leases' | 'bds_tenants' | 'bds_opex_categories'>) {
  const leaseByKey = new Map(rows.bds_head_leases.map(l => [leaseMatchKey(l.landlord, l.name), l]));
  const tenantByName = new Map(rows.bds_tenants.map(t => [normName(t.name), t]));
  const catByName = new Map(rows.bds_opex_categories.map(c => [normName(c.name), c]));
  const leases = new Map<string, BdsHeadLease | null>();
  for (const h of s.headLeases) leases.set(h.key, leaseByKey.get(leaseMatchKey(h.landlord, h.name)) || null);
  const tenants = new Map<string, BdsTenant | null>();
  for (const t of s.tenants) tenants.set(t.key, tenantByName.get(normName(t.name)) || null);
  const cats = new Map<string, BdsOpexCategory | null>();
  for (const c of s.opexCategories) cats.set(c.key, catByName.get(normName(c.name)) || null);
  return { leases, tenants, cats };
}

const fmt = (v: unknown) => (typeof v === 'number' ? v.toLocaleString('en-US') : typeof v === 'boolean' ? (v ? 'Bật' : 'Tắt') : String(v ?? '—'));

export function settingsPatch(s: TrackerSnapshot): Partial<BdsSettings> {
  const st = s.settings;
  const p: Partial<BdsSettings> = {};
  if (st.exchangeRate && st.exchangeRate > 0) p.exchange_rate = st.exchangeRate;
  if (st.vatRateRent !== undefined && st.vatRateRent >= 0 && st.vatRateRent <= 100) p.vat_rate_rent = st.vatRateRent;
  if (st.vatRateUtil !== undefined && st.vatRateUtil >= 0 && st.vatRateUtil <= 100) p.vat_rate_util = st.vatRateUtil;
  if (st.parkingPriceMoto !== undefined && st.parkingPriceMoto >= 0) p.parking_price_moto = st.parkingPriceMoto;
  if (st.parkingPriceCar !== undefined && st.parkingPriceCar >= 0) p.parking_price_car = st.parkingPriceCar;
  if (st.startMonth) p.start_month = monthToDate(st.startMonth);
  if (st.rangeMonths) p.range_months = st.rangeMonths;
  if (st.includeForecastInCost !== undefined) p.include_forecast_in_cost = st.includeForecastInCost;
  if (st.hideEmptyMonths !== undefined) p.hide_empty_months = st.hideEmptyMonths;
  if (st.showFeePanel !== undefined) p.show_fee_panel = st.showFeePanel;
  return p;
}

const SETTING_LABELS: Partial<Record<keyof BdsSettings, string>> = {
  exchange_rate: 'Tỷ giá USD→VNĐ', vat_rate_rent: 'VAT thuê mặt bằng (%)', vat_rate_util: 'VAT điện & bãi xe (%)',
  parking_price_moto: 'Đơn giá xe máy', parking_price_car: 'Đơn giá ô tô', start_month: 'Tháng bắt đầu',
  range_months: 'Số tháng theo dõi', include_forecast_in_cost: 'Cộng dự kiến vào chi phí',
  hide_empty_months: 'Chỉ hiện tháng có doanh thu', show_fee_panel: 'Mở khối phụ phí',
};

export function planImport(s: TrackerSnapshot, rows: PlanRows, settings: BdsSettings, opts: ImportOptions): ImportPlan {
  const m = matchExisting(s, rows);
  const count = <T>(items: T[], isExisting: (x: T) => boolean): CountPair => {
    let create = 0; let update = 0;
    for (const x of items) { if (isExisting(x)) update++; else create++; }
    return { create, update };
  };

  // Ô tháng: tồn tại khi khách/hạng mục đã khớp và có sẵn dòng (tenant, month). Thay thế toàn bộ → mọi ô đều "tạo".
  const rentKeys = new Set(opts.replaceAll ? [] : rows.bds_tenant_rent.map(r => `${r.tenant_id}|${r.month}`));
  const feeKeys = new Set(opts.replaceAll ? [] : rows.bds_tenant_fees.map(r => `${r.tenant_id}|${r.month}`));
  const opexKeys = new Set(opts.replaceAll ? [] : rows.bds_opex_monthly.map(r => `${r.category_id}|${r.month}`));
  const fcKeys = new Set(opts.replaceAll ? [] : rows.bds_forecast_expenses.map(f => forecastMatchKey(f.name, f.month)));
  const scNames = new Set(rows.bds_breakeven_scenarios.map(x => normName(x.name)));

  const settingsChanges: ImportPlan['settingsChanges'] = [];
  if (opts.includeSettings) {
    const p = settingsPatch(s);
    for (const [k, v] of Object.entries(p) as [keyof BdsSettings, unknown][]) {
      const cur = settings[k];
      const same = typeof v === 'number' ? Number(cur) === v : cur === v;
      if (!same) settingsChanges.push({ label: SETTING_LABELS[k] || k, from: fmt(cur), to: fmt(v) });
    }
  }

  let deletes: ImportPlan['deletes'] = null;
  if (opts.replaceAll) {
    const keepLeases = new Set([...m.leases.values()].filter(Boolean).map(l => l!.id));
    const keepTenants = new Set([...m.tenants.values()].filter(Boolean).map(t => t!.id));
    const keepCats = new Set([...m.cats.values()].filter(Boolean).map(c => c!.id));
    const dropTenants = rows.bds_tenants.filter(t => !keepTenants.has(t.id));
    const dropTenantIds = new Set(dropTenants.map(t => t.id));
    deletes = [
      { label: 'Tiền thuê theo tháng (tất cả)', count: rows.bds_tenant_rent.length },
      { label: 'Phụ phí điện/xe theo tháng (tất cả)', count: rows.bds_tenant_fees.length },
      { label: 'Chi phí vận hành theo tháng (tất cả)', count: rows.bds_opex_monthly.length },
      { label: 'Khoản dự kiến phát sinh (tất cả)', count: rows.bds_forecast_expenses.length },
      { label: 'Mốc tăng giá (tất cả)', count: rows.bds_head_lease_increases.length },
      { label: 'Khoản thuê không có trong file', count: rows.bds_head_leases.filter(l => !keepLeases.has(l.id)).length },
      { label: 'Khách không có trong file', count: dropTenants.length },
      { label: '… kèm hoá đơn của các khách đó', count: rows.bds_invoices.filter(i => dropTenantIds.has(i.tenant_id)).length },
      { label: '… kèm chỉ số điện của các khách đó', count: rows.bds_meter_readings.filter(i => dropTenantIds.has(i.tenant_id)).length },
      { label: 'Hạng mục vận hành không có trong file', count: rows.bds_opex_categories.filter(c => !keepCats.has(c.id)).length },
    ].filter(d => d.count > 0);
  }

  return {
    headLeases: count(s.headLeases, h => !!m.leases.get(h.key)),
    increases: s.headLeases.reduce((a, h) => a + h.increases.length, 0),
    tenants: count(s.tenants, t => !!m.tenants.get(t.key)),
    opexCategories: count(s.opexCategories, c => !!m.cats.get(c.key)),
    rent: count(s.rent, r => { const t = m.tenants.get(r.tenantKey); return !!t && rentKeys.has(`${t.id}|${monthToDate(r.month)}`); }),
    fees: count(s.fees, r => { const t = m.tenants.get(r.tenantKey); return !!t && feeKeys.has(`${t.id}|${monthToDate(r.month)}`); }),
    opex: count(s.opex, r => { const c = m.cats.get(r.categoryKey); return !!c && opexKeys.has(`${c.id}|${monthToDate(r.month)}`); }),
    forecasts: count(s.forecasts, f => fcKeys.has(forecastMatchKey(f.name, f.month))),
    scenarios: count(s.scenarios, x => scNames.has(normName(x.name))),
    settingsChanges,
    deletes,
  };
}
