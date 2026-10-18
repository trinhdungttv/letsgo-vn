// Xuất toàn bộ dữ liệu bds_* ra JSON theo định dạng tracker v4 → chính màn Import nạp lại được phần Tài chính.
// Khối `ops` (phòng, hoá đơn, ticket…) chỉ để lưu trữ.
import type { BdsTables } from './types';
import { toMonthKey } from './calc/months';

type AllRows = { [K in keyof BdsTables]: BdsTables[K][] };

export function buildExportJson(rows: AllRows, exportedAt = new Date()): Record<string, unknown> {
  const s = rows.bds_settings[0];
  const unitsOf = (landlord: 'mbt' | 'ts4') => rows.bds_head_leases
    .filter(l => l.landlord === landlord)
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'vi'))
    .map(l => ({
      id: l.id, name: l.name, currency: l.currency, basePrice: Number(l.base_price), baseMonth: toMonthKey(l.base_month),
      endMonth: l.end_month ? toMonthKey(l.end_month) : null, vatMode: l.vat_mode, vatCategory: l.vat_category,
      isParking: l.is_parking, note: l.note,
      increases: rows.bds_head_lease_increases
        .filter(i => i.head_lease_id === l.id)
        .sort((a, b) => a.effective_month.localeCompare(b.effective_month))
        .map(i => ({ month: toMonthKey(i.effective_month), percent: Number(i.percent) })),
    }));

  const revenue: Record<string, Record<string, number>> = {};
  for (const r of rows.bds_tenant_rent) (revenue[toMonthKey(r.month)] ||= {})[r.tenant_id] = Number(r.amount);
  const custFees: Record<string, Record<string, { dien: number; moto: number; car: number }>> = {};
  for (const f of rows.bds_tenant_fees) {
    (custFees[toMonthKey(f.month)] ||= {})[f.tenant_id] = {
      dien: Number(f.electricity_amount), moto: Number(f.motorbike_count), car: Number(f.car_count),
    };
  }
  const opex: Record<string, Record<string, number>> = {};
  for (const o of rows.bds_opex_monthly) (opex[toMonthKey(o.month)] ||= {})[o.category_id] = Number(o.amount);

  return {
    version: 4,
    source: 'letsgo-vn / Văn phòng Orient',
    exportedAt: exportedAt.toISOString(),
    exchangeRate: s ? Number(s.exchange_rate) : undefined,
    vatRateRent: s ? Number(s.vat_rate_rent) : undefined,
    vatRateUtil: s ? Number(s.vat_rate_util) : undefined,
    startMonth: s ? toMonthKey(s.start_month) : undefined,
    range: s?.range_months,
    hideEmpty: s?.hide_empty_months,
    parkingPriceMoto: s ? Number(s.parking_price_moto) : undefined,
    parkingPriceCar: s ? Number(s.parking_price_car) : undefined,
    showCustFees: s?.show_fee_panel,
    includeForecastInCost: s?.include_forecast_in_cost,
    payables: {
      mbt: { name: 'Minh Bảo Tín', units: unitsOf('mbt') },
      ts4: { name: 'Thủy Sản 4', units: unitsOf('ts4') },
    },
    customers: [...rows.bds_tenants]
      .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'vi'))
      .map(t => ({
        id: t.id, name: t.name, currency: t.currency, vatMode: t.vat_mode, unitId: t.head_lease_id,
        areaM2: t.area_m2, active: t.active, note: t.note,
      })),
    opexCats: [...rows.bds_opex_categories]
      .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'vi'))
      .map(c => ({ id: c.id, name: c.name, vatMode: c.vat_mode, vatCategory: c.vat_category })),
    revenue,
    opex,
    custFees,
    forecastExpenses: rows.bds_forecast_expenses.map(f => ({
      id: f.id, name: f.name, month: toMonthKey(f.month), amount: Number(f.amount), note: f.note || '',
    })),
    breakevenScenarios: rows.bds_breakeven_scenarios.map(sc => ({
      name: sc.name, headLeaseKey: sc.head_lease_id, referenceMonth: sc.reference_month ? toMonthKey(sc.reference_month) : null,
      targetCost: Number(sc.target_cost), extraCost: Number(sc.extra_cost), parentAreaM2: sc.parent_area_m2, note: sc.note,
      rooms: rows.bds_breakeven_rooms
        .filter(r => r.scenario_id === sc.id)
        .sort((a, b) => a.sort_order - b.sort_order)
        .map(r => ({ name: r.name, areaM2: Number(r.area_m2), currency: r.currency, price: Number(r.price), vatMode: r.vat_mode })),
    })),
    ops: {
      note: 'Dữ liệu vận hành — chỉ để lưu trữ, màn Import chưa khôi phục phần này.',
      settings: s,
      tenantContracts: rows.bds_tenants.map(t => ({
        tenantId: t.id, name: t.name, room_id: t.room_id ?? null, contract_code: t.contract_code ?? null,
        contract_start: t.contract_start ?? null, contract_end: t.contract_end ?? null,
        deposit_amount: t.deposit_amount ?? null, deposit_currency: t.deposit_currency ?? null,
        contact_name: t.contact_name ?? null, contact_phone: t.contact_phone ?? null,
      })),
      rooms: rows.bds_rooms,
      meterReadings: rows.bds_meter_readings,
      invoices: rows.bds_invoices,
      assets: rows.bds_assets,
      tickets: rows.bds_tickets,
      maintenanceLogs: rows.bds_maintenance_logs,
    },
  };
}
