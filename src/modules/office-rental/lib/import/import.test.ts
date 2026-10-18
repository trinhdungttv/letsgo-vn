import { describe, expect, it } from 'vitest';
import trackerRaw from '../__fixtures__/orient_pl_2026-08.json?raw';
import { parseTrackerJson } from './tracker';
import { planImport, type PlanRows } from './plan';
import { buildExportJson } from '../export';
import type { BdsSettings, BdsTables } from '../types';

const SETTINGS: BdsSettings = {
  id: 1, exchange_rate: 26000, vat_rate_rent: 10, vat_rate_util: 8, parking_price_moto: 150000, parking_price_car: 1500000,
  start_month: '2026-01-01', range_months: 24, include_forecast_in_cost: false, hide_empty_months: true, show_fee_panel: false,
};

type AllRows = { [K in keyof BdsTables]: BdsTables[K][] };
const empty = (): AllRows => ({
  bds_settings: [SETTINGS], bds_head_leases: [], bds_head_lease_increases: [], bds_tenants: [], bds_tenant_rent: [],
  bds_tenant_fees: [], bds_opex_categories: [], bds_opex_monthly: [], bds_forecast_expenses: [], bds_breakeven_scenarios: [],
  bds_breakeven_rooms: [], bds_rooms: [], bds_meter_readings: [], bds_invoices: [], bds_assets: [], bds_tickets: [],
  bds_maintenance_logs: [], bds_notification_states: [],
});

const snap = () => {
  const r = parseTrackerJson(JSON.parse(trackerRaw));
  if (!r.snapshot) throw new Error(r.error);
  return r.snapshot;
};

describe('parseTrackerJson', () => {
  it('đọc đúng file thật v3', () => {
    const s = snap();
    expect(s.version).toBe(3);
    expect(s.headLeases).toHaveLength(4);
    expect(s.tenants).toEqual([expect.objectContaining({ name: 'XHOME', currency: 'USD', vatMode: 'none', headLeaseKey: null })]);
    expect(s.opexCategories.map(c => c.name)).toEqual(['Phí quản lý', 'Bảo trì', 'Sửa chữa', 'Lương NV (bảo vệ/vệ sinh)', 'Đối ngoại']);
    // số 0 bị bỏ qua: 7 tháng × 4 hạng mục khác 0 + 2 tháng có sửa chữa
    expect(s.opex).toHaveLength(7 * 4 + 2);
    expect(s.rent).toHaveLength(0);
    expect(s.forecasts).toHaveLength(2);
    // v3 chỉ có 1 thuế suất → áp cho cả 2
    expect(s.settings.vatRateRent).toBe(8);
    expect(s.settings.vatRateUtil).toBe(8);
    expect(s.settings.exchangeRate).toBe(25870);
  });
  it('từ chối version lạ / file hỏng', () => {
    expect(parseTrackerJson({ version: 1 }).error).toMatch(/version 3 hoặc 4/);
    expect(parseTrackerJson('abc').error).toBeTruthy();
  });
});

describe('planImport — xem trước', () => {
  it('DB trống → toàn bộ là tạo mới, mặc định không đổi cài đặt', () => {
    const p = planImport(snap(), empty() as PlanRows, SETTINGS, { replaceAll: false, includeSettings: false });
    expect(p.headLeases).toEqual({ create: 4, update: 0 });
    expect(p.increases).toBe(2);
    expect(p.tenants).toEqual({ create: 1, update: 0 });
    expect(p.opexCategories).toEqual({ create: 5, update: 0 });
    expect(p.opex).toEqual({ create: 30, update: 0 });
    expect(p.forecasts).toEqual({ create: 2, update: 0 });
    expect(p.settingsChanges).toEqual([]);
    expect(p.deletes).toBeNull();
  });
  it('chạy lại lần 2 → khớp theo tên, chỉ cập nhật (không nhân đôi)', () => {
    const rows = empty();
    rows.bds_head_leases = [
      { id: 'a', landlord: 'mbt', name: 'mặt bằng 1.05 ', currency: 'VND', base_price: 1, base_month: '2025-03-01', end_month: null, vat_mode: 'incl', vat_category: 'rent', is_parking: false, sort_order: 1, note: null },
    ];
    rows.bds_tenants = [{ id: 'x', name: 'Xhome', currency: 'USD', vat_mode: 'none', head_lease_id: null, area_m2: null, active: true, sort_order: 1, note: null }];
    rows.bds_opex_categories = [{ id: 'c1', name: 'Phí quản lý', vat_mode: 'none', vat_category: 'rent', sort_order: 1, active: true }];
    rows.bds_opex_monthly = [{ category_id: 'c1', month: '2026-01-01', amount: 5_000_000 }];
    rows.bds_forecast_expenses = [{ id: 'f', name: 'Sơn lại mặt tiền', month: '2026-09-01', amount: 1, note: null }];
    const p = planImport(snap(), rows as PlanRows, SETTINGS, { replaceAll: false, includeSettings: true });
    expect(p.headLeases).toEqual({ create: 3, update: 1 });
    expect(p.tenants).toEqual({ create: 0, update: 1 });
    expect(p.opexCategories).toEqual({ create: 4, update: 1 });
    expect(p.opex).toEqual({ create: 29, update: 1 });
    expect(p.forecasts).toEqual({ create: 1, update: 1 });
    expect(p.settingsChanges.map(c => c.label)).toEqual(expect.arrayContaining(['Tỷ giá USD→VNĐ', 'VAT thuê mặt bằng (%)', 'Đơn giá ô tô']));
  });
  it('thay thế toàn bộ → liệt kê thứ sẽ bị xoá', () => {
    const rows = empty();
    rows.bds_tenants = [{ id: 'old', name: 'Khách cũ', currency: 'VND', vat_mode: 'none', head_lease_id: null, area_m2: null, active: true, sort_order: 1, note: null }];
    rows.bds_tenant_rent = [{ tenant_id: 'old', month: '2026-01-01', amount: 1 }];
    rows.bds_invoices = [{ id: 'i', tenant_id: 'old', month: '2026-01-01', invoice_no: null, status: 'paid', due_date: null, paid_at: null, paid_amount: null, note: null }];
    const p = planImport(snap(), rows as PlanRows, SETTINGS, { replaceAll: true, includeSettings: false });
    expect(p.deletes).toEqual(expect.arrayContaining([
      { label: 'Khách không có trong file', count: 1 },
      { label: '… kèm hoá đơn của các khách đó', count: 1 },
      { label: 'Tiền thuê theo tháng (tất cả)', count: 1 },
    ]));
  });
});

describe('Xuất JSON v4 → nạp lại', () => {
  it('khứ hồi giữ đủ dữ liệu tài chính', () => {
    const rows = empty();
    rows.bds_head_leases = [
      { id: 'L1', landlord: 'mbt', name: 'Mặt bằng 2.01', currency: 'VND', base_price: 305_556_000, base_month: '2025-03-01', end_month: null, vat_mode: 'incl', vat_category: 'rent', is_parking: false, sort_order: 1, note: null },
      { id: 'L2', landlord: 'ts4', name: 'Hầm giữ ô tô', currency: 'VND', base_price: 27_000_000, base_month: '2026-01-01', end_month: null, vat_mode: 'incl', vat_category: 'util', is_parking: true, sort_order: 1, note: null },
    ];
    rows.bds_head_lease_increases = [{ id: 'i1', head_lease_id: 'L1', effective_month: '2027-01-01', percent: 5 }];
    rows.bds_tenants = [{ id: 'T1', name: 'XHOME', currency: 'USD', vat_mode: 'excl', head_lease_id: 'L1', area_m2: 715, active: true, sort_order: 1, note: 'ghi chú' }];
    rows.bds_tenant_rent = [{ tenant_id: 'T1', month: '2026-08-01', amount: 14_000.5 }];
    rows.bds_tenant_fees = [{ tenant_id: 'T1', month: '2026-08-01', electricity_amount: 2_000_000, motorbike_count: 5, car_count: 1 }];
    rows.bds_opex_categories = [{ id: 'C1', name: 'Bảo vệ', vat_mode: 'excl', vat_category: 'util', sort_order: 1, active: true }];
    rows.bds_opex_monthly = [{ category_id: 'C1', month: '2026-08-01', amount: 9_000_000 }];
    rows.bds_breakeven_scenarios = [{ id: 'S1', name: 'XHOME 778m²', head_lease_id: 'L1', reference_month: '2026-01-01', target_cost: 305_556_000, extra_cost: 0, parent_area_m2: 778, note: null }];
    rows.bds_breakeven_rooms = [{ id: 'R1', scenario_id: 'S1', name: 'Phòng 1', area_m2: 200, currency: 'VND', price: 50_000_000, vat_mode: 'none', sort_order: 1 }];

    const json = JSON.parse(JSON.stringify(buildExportJson(rows)));
    const r = parseTrackerJson(json);
    expect(r.error).toBeUndefined();
    const s = r.snapshot!;
    expect(s.version).toBe(4);
    expect(s.headLeases.find(h => h.key === 'L2')).toMatchObject({ isParking: true, vatCategory: 'util', landlord: 'ts4' });
    expect(s.headLeases.find(h => h.key === 'L1')!.increases).toEqual([{ month: '2027-01', percent: 5 }]);
    expect(s.tenants[0]).toMatchObject({ name: 'XHOME', headLeaseKey: 'L1', areaM2: 715, vatMode: 'excl', note: 'ghi chú' });
    expect(s.rent).toEqual([{ tenantKey: 'T1', month: '2026-08', amount: 14_000.5 }]);
    expect(s.fees).toEqual([{ tenantKey: 'T1', month: '2026-08', electricity: 2_000_000, moto: 5, car: 1 }]);
    expect(s.opexCategories[0]).toMatchObject({ vatMode: 'excl', vatCategory: 'util' });
    expect(s.scenarios[0]).toMatchObject({ name: 'XHOME 778m²', headLeaseKey: 'L1', parentAreaM2: 778, rooms: [expect.objectContaining({ areaM2: 200, price: 50_000_000 })] });
    expect(s.settings).toMatchObject({ exchangeRate: 26000, vatRateRent: 10, vatRateUtil: 8, parkingPriceCar: 1_500_000 });
    // nạp lại vào chính DB đó → không tạo trùng
    const p = planImport(s, rows as PlanRows, SETTINGS, { replaceAll: false, includeSettings: true });
    expect(p.headLeases).toEqual({ create: 0, update: 2 });
    expect(p.tenants).toEqual({ create: 0, update: 1 });
    expect(p.rent).toEqual({ create: 0, update: 1 });
    expect(p.fees).toEqual({ create: 0, update: 1 });
    expect(p.scenarios).toEqual({ create: 0, update: 1 });
    expect(p.settingsChanges).toEqual([]);
  });
});
