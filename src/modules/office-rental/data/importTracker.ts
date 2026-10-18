// Ghi file tracker (đã đọc + xem trước) vào các bảng bds_*. Khớp theo TÊN → chạy lại không nhân đôi.
// Mặc định KHÔNG xoá gì; "thay thế toàn bộ" chỉ chạy khi người dùng đã xác nhận 2 bước ở giao diện.
import type { BdsSettings, BdsTenantFee, BdsTenantRent, BdsOpexMonthly } from '../lib/types';
import { monthToDate } from '../lib/calc/months';
import { normName } from '../lib/calc/csv';
import type { TrackerSnapshot } from '../lib/import/tracker';
import { forecastMatchKey, matchExisting, settingsPatch, type ImportOptions, type PlanRows } from '../lib/import/plan';
import { deleteAll, deleteRow, deleteWhere, insertRow, insertRows, updateRow, upsertCells } from './api';

export async function runTrackerImport(
  s: TrackerSnapshot,
  rows: PlanRows,
  opts: ImportOptions,
  onStep: (msg: string) => void,
): Promise<void> {
  const m = matchExisting(s, rows);

  if (opts.replaceAll) {
    onStep('Đang xoá dữ liệu tài chính cũ…');
    await deleteAll('bds_tenant_rent');
    await deleteAll('bds_tenant_fees');
    await deleteAll('bds_opex_monthly');
    await deleteAll('bds_forecast_expenses');
    await deleteAll('bds_head_lease_increases');
    const keepLeases = new Set([...m.leases.values()].filter(Boolean).map(l => l!.id));
    const keepTenants = new Set([...m.tenants.values()].filter(Boolean).map(t => t!.id));
    const keepCats = new Set([...m.cats.values()].filter(Boolean).map(c => c!.id));
    for (const t of rows.bds_tenants) if (!keepTenants.has(t.id)) await deleteRow('bds_tenants', t.id);
    for (const l of rows.bds_head_leases) if (!keepLeases.has(l.id)) await deleteRow('bds_head_leases', l.id);
    for (const c of rows.bds_opex_categories) if (!keepCats.has(c.id)) await deleteRow('bds_opex_categories', c.id);
  }

  // 1) Khoản thuê đầu vào + mốc tăng giá (mốc của khoản đã có được thay bằng bản trong file)
  onStep('Đang nhập chi phí thuê đầu vào…');
  const leaseId = new Map<string, string>();
  let order = rows.bds_head_leases.reduce((a, l) => Math.max(a, l.sort_order || 0), 0);
  for (const h of s.headLeases) {
    const fields = {
      landlord: h.landlord, name: h.name, currency: h.currency, base_price: h.basePrice, base_month: monthToDate(h.baseMonth),
      end_month: h.endMonth ? monthToDate(h.endMonth) : null, vat_mode: h.vatMode, vat_category: h.vatCategory,
      is_parking: h.isParking, ...(h.note ? { note: h.note } : {}),
    };
    const existing = m.leases.get(h.key);
    let id: string;
    if (existing) {
      await updateRow('bds_head_leases', existing.id, fields);
      id = existing.id;
      if (!opts.replaceAll) await deleteWhere('bds_head_lease_increases', 'head_lease_id', id);
    } else {
      id = (await insertRow('bds_head_leases', { ...fields, sort_order: ++order })).id;
    }
    leaseId.set(h.key, id);
    await insertRows('bds_head_lease_increases', h.increases.map(i => ({ head_lease_id: id, effective_month: monthToDate(i.month), percent: i.percent })));
  }

  // 2) Khách
  onStep('Đang nhập khách hàng…');
  const tenantId = new Map<string, string>();
  order = rows.bds_tenants.reduce((a, t) => Math.max(a, t.sort_order || 0), 0);
  for (const t of s.tenants) {
    const lease = t.headLeaseKey ? leaseId.get(t.headLeaseKey) : undefined;
    const fields = {
      name: t.name, currency: t.currency, vat_mode: t.vatMode,
      ...(lease ? { head_lease_id: lease } : {}),
      ...(t.areaM2 !== null ? { area_m2: t.areaM2 } : {}),
      ...(t.note ? { note: t.note } : {}),
      ...(s.version >= 4 ? { active: t.active } : {}),
    };
    const existing = m.tenants.get(t.key);
    if (existing) {
      await updateRow('bds_tenants', existing.id, fields);
      tenantId.set(t.key, existing.id);
    } else {
      tenantId.set(t.key, (await insertRow('bds_tenants', { ...fields, sort_order: ++order })).id);
    }
  }

  // 3) Hạng mục vận hành
  onStep('Đang nhập chi phí vận hành…');
  const catId = new Map<string, string>();
  order = rows.bds_opex_categories.reduce((a, c) => Math.max(a, c.sort_order || 0), 0);
  for (const c of s.opexCategories) {
    const fields = { name: c.name, vat_mode: c.vatMode, vat_category: c.vatCategory };
    const existing = m.cats.get(c.key);
    if (existing) {
      await updateRow('bds_opex_categories', existing.id, fields);
      catId.set(c.key, existing.id);
    } else {
      catId.set(c.key, (await insertRow('bds_opex_categories', { ...fields, sort_order: ++order })).id);
    }
  }

  // 4) Ô tháng — upsert theo (khách|hạng mục, tháng)
  onStep('Đang nhập số liệu theo tháng…');
  const rent: BdsTenantRent[] = s.rent
    .filter(r => tenantId.has(r.tenantKey))
    .map(r => ({ tenant_id: tenantId.get(r.tenantKey)!, month: monthToDate(r.month), amount: r.amount }));
  const fees: BdsTenantFee[] = s.fees
    .filter(f => tenantId.has(f.tenantKey))
    .map(f => ({ tenant_id: tenantId.get(f.tenantKey)!, month: monthToDate(f.month), electricity_amount: f.electricity, motorbike_count: f.moto, car_count: f.car }));
  const opex: BdsOpexMonthly[] = s.opex
    .filter(o => catId.has(o.categoryKey))
    .map(o => ({ category_id: catId.get(o.categoryKey)!, month: monthToDate(o.month), amount: o.amount }));
  await upsertCells('bds_tenant_rent', rent);
  await upsertCells('bds_tenant_fees', fees);
  await upsertCells('bds_opex_monthly', opex);

  // 5) Dự kiến phát sinh — khớp (tên, tháng)
  onStep('Đang nhập khoản dự kiến…');
  const fcByKey = new Map(opts.replaceAll ? [] : rows.bds_forecast_expenses.map(f => [forecastMatchKey(f.name, f.month), f]));
  for (const f of s.forecasts) {
    const existing = fcByKey.get(forecastMatchKey(f.name, f.month));
    if (existing) await updateRow('bds_forecast_expenses', existing.id, { amount: f.amount, note: f.note });
    else await insertRow('bds_forecast_expenses', { name: f.name, month: monthToDate(f.month), amount: f.amount, note: f.note });
  }

  // 6) Kịch bản hòa vốn (file v4) — khớp theo tên, phòng được thay bằng bản trong file
  if (s.scenarios.length) {
    onStep('Đang nhập kịch bản hòa vốn…');
    const scByName = new Map(rows.bds_breakeven_scenarios.map(x => [normName(x.name), x]));
    for (const sc of s.scenarios) {
      const fields = {
        name: sc.name, head_lease_id: sc.headLeaseKey ? leaseId.get(sc.headLeaseKey) || null : null,
        reference_month: sc.referenceMonth ? monthToDate(sc.referenceMonth) : null, target_cost: sc.targetCost,
        extra_cost: sc.extraCost, parent_area_m2: sc.parentAreaM2, note: sc.note,
      };
      const existing = scByName.get(normName(sc.name));
      let id: string;
      if (existing) {
        await updateRow('bds_breakeven_scenarios', existing.id, fields);
        await deleteWhere('bds_breakeven_rooms', 'scenario_id', existing.id);
        id = existing.id;
      } else {
        id = (await insertRow('bds_breakeven_scenarios', fields)).id;
      }
      await insertRows('bds_breakeven_rooms', sc.rooms.map((r, i) => ({
        scenario_id: id, name: r.name, area_m2: r.areaM2, currency: r.currency, price: r.price, vat_mode: r.vatMode, sort_order: i + 1,
      })));
    }
  }

  // 7) Cài đặt (chỉ khi người dùng tick)
  if (opts.includeSettings) {
    const p: Partial<BdsSettings> = settingsPatch(s);
    if (Object.keys(p).length) {
      onStep('Đang cập nhật cài đặt…');
      await updateRow('bds_settings', 1, p);
    }
  }
  onStep('Xong');
}
