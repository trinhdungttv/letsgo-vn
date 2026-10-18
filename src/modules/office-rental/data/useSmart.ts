// Các phép tính "thông minh" dùng chung: sự kiện/thông báo, dự báo, nhận định, công nợ.
import { useMemo } from 'react';
import { useOffice } from './OfficeDataProvider';
import { buildEvents, visibleEvents, type OfficeEvent } from '../lib/events';
import { buildProjection, type Projection } from '../lib/forecast';
import { buildInsights } from '../lib/insights';
import { invoiceBreakdown, invoiceState, occupancy, todayStr } from '../lib/ops';
import { addMonths } from '../lib/calc/months';
import { hasRevenue } from '../lib/calc/pl';
import type { MonthKey } from '../lib/calc/types';

export function useOfficeEvents(): { all: OfficeEvent[]; visible: OfficeEvent[]; hidden: OfficeEvent[]; today: string } {
  const { rows, calc, settings, opsReady } = useOffice();
  const today = todayStr();
  const all = useMemo(() => buildEvents({
    data: calc, leases: rows.bds_head_leases, tenants: rows.bds_tenants, rooms: rows.bds_rooms,
    invoices: rows.bds_invoices, readings: rows.bds_meter_readings, opexRows: rows.bds_opex_monthly,
    tickets: rows.bds_tickets, assets: rows.bds_assets, forecasts: rows.bds_forecast_expenses,
    today, horizonDays: settings.alert_days ?? 90, opsReady,
  }), [calc, rows, settings.alert_days, opsReady, today]);
  const visible = useMemo(() => visibleEvents(all, rows.bds_notification_states, today), [all, rows.bds_notification_states, today]);
  const hidden = useMemo(() => all.filter(e => !visible.includes(e)), [all, visible]);
  return { all, visible, hidden, today };
}

/** Tháng tham chiếu = tháng gần nhất (≤ hiện tại) đã có doanh thu; chưa có thì lấy tháng hiện tại. */
export function useReferenceMonth(): MonthKey {
  const { calc, months, currentMonth } = useOffice();
  return useMemo(() => {
    const ms = months.filter(m => m <= currentMonth && hasRevenue(calc, m));
    return ms[ms.length - 1] || (months.includes(currentMonth) ? currentMonth : months[0]);
  }, [calc, months, currentMonth]);
}

/** Dự báo: `back` tháng trước + tháng hiện tại + `ahead` tháng tới. */
export function useProjection(back = 11, ahead = 12): Projection {
  const { calc, rows, currentMonth } = useOffice();
  return useMemo(() => buildProjection({
    data: calc, currentMonth, from: addMonths(currentMonth, -back), count: back + ahead + 1,
    tenants: rows.bds_tenants.map(t => ({ id: t.id, name: t.name, active: t.active, contract_start: t.contract_start, contract_end: t.contract_end })),
  }), [calc, rows.bds_tenants, currentMonth, back, ahead]);
}

export function useReceivables(): { total: number; overdue: number; count: number } {
  const { rows, calc } = useOffice();
  const today = todayStr();
  return useMemo(() => {
    const ct = new Map(calc.tenants.map(t => [t.id, t]));
    let total = 0; let overdue = 0; let count = 0;
    for (const inv of rows.bds_invoices) {
      const t = ct.get(inv.tenant_id);
      if (!t || inv.status === 'paid') continue;
      const amount = invoiceBreakdown(calc, inv.month.slice(0, 7), t).total;
      total += amount; count++;
      if (invoiceState(inv, today).state === 'overdue') overdue += amount;
    }
    return { total, overdue, count };
  }, [rows.bds_invoices, calc, today]);
}

export function useInsights() {
  const { calc, months, currentMonth, rows } = useOffice();
  const projection = useProjection();
  const unpaid = useReceivables();
  return useMemo(() => buildInsights({
    data: calc, months, currentMonth, projection, unpaid,
    occupancy: occupancy(rows.bds_rooms, rows.bds_tenants),
  }), [calc, months, currentMonth, projection, unpaid, rows.bds_rooms, rows.bds_tenants]);
}
