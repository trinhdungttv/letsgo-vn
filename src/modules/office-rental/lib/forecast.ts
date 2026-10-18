// Dự báo lời/lỗ các tháng tới — thuần TS, tái dùng calc engine.
// Tháng đã có doanh thu → số thực tế. Tháng sau đó → dự báo:
//   - Tiền thuê: giữ mức gần nhất của từng khách, dừng sau tháng hết hợp đồng (nếu có ngày kết thúc).
//   - Phụ phí điện/xe: trung bình các tháng gần nhất có số.
//   - Chi phí vận hành: số đã nhập (nếu có) hoặc trung bình các tháng gần nhất.
//   - Chi phí thuê đầu vào: tính chính xác theo mốc tăng giá / ngày trả mặt bằng.
import type { CalcData, CalcFee, MonthKey, MonthResult } from './calc/types';
import { addMonths, monthLabel, monthRange, toMonthKey } from './calc/months';
import { computeMonth, hasRevenue } from './calc/pl';

export interface ProjectionTenant {
  id: string;
  name: string;
  active: boolean;
  contract_start?: string | null;
  contract_end?: string | null;
}

export interface ProjectedMonth extends MonthResult {
  projected: boolean;
  notes: string[];
}

export interface Projection {
  months: ProjectedMonth[];
  /** Tháng thực tế cuối cùng làm gốc dự báo */
  lastActual: MonthKey | null;
  /** CalcData đã điền số dự báo (dùng cho biểu đồ theo mặt bằng) */
  data: CalcData;
}

function avg(values: number[]): number {
  return values.length ? values.reduce((a, v) => a + v, 0) / values.length : 0;
}

export function lastActualMonth(data: CalcData, upTo: MonthKey): MonthKey | null {
  const ms = Object.keys(data.rent).filter(m => m <= upTo && hasRevenue(data, m)).sort();
  return ms[ms.length - 1] || null;
}

export function buildProjection(input: {
  data: CalcData;
  tenants: ProjectionTenant[];
  from: MonthKey;
  count: number;
  currentMonth: MonthKey;
  lookback?: number;
}): Projection {
  const { data, tenants, currentMonth } = input;
  const lookback = input.lookback ?? 3;
  const lastActual = lastActualMonth(data, currentMonth);
  const months = monthRange(input.from, input.count);

  const projected: CalcData = {
    ...data,
    rent: { ...data.rent },
    fees: { ...data.fees },
    opex: { ...data.opex },
  };

  // Mức tiền thuê gốc của từng khách = tháng gần nhất có tiền thuê (≤ tháng thực tế cuối)
  const baseRent = new Map<string, number>();
  const feeAvg = new Map<string, CalcFee>();
  if (lastActual) {
    const pastMonths = Object.keys(data.rent).filter(m => m <= lastActual).sort();
    for (const t of tenants) {
      const withRent = pastMonths.filter(m => (data.rent[m]?.[t.id] || 0) > 0);
      const last = withRent[withRent.length - 1];
      if (last) baseRent.set(t.id, data.rent[last][t.id]);
      const feeMonths = Object.keys(data.fees).filter(m => m <= lastActual && data.fees[m]?.[t.id]).sort().slice(-lookback);
      if (feeMonths.length) {
        feeAvg.set(t.id, {
          electricity: avg(feeMonths.map(m => data.fees[m][t.id].electricity || 0)),
          moto: Math.round(avg(feeMonths.map(m => data.fees[m][t.id].moto || 0))),
          car: Math.round(avg(feeMonths.map(m => data.fees[m][t.id].car || 0))),
        });
      }
    }
  }
  const opexMonths = Object.keys(data.opex)
    .filter(m => m <= currentMonth && Object.values(data.opex[m] || {}).some(v => v > 0))
    .sort().slice(-lookback);
  const opexAvg: Record<string, number> = {};
  for (const c of data.opexCategories) opexAvg[c.id] = avg(opexMonths.map(m => data.opex[m]?.[c.id] || 0));

  const covers = (t: ProjectionTenant, m: MonthKey) =>
    (!t.contract_start || toMonthKey(t.contract_start) <= m) && (!t.contract_end || toMonthKey(t.contract_end) >= m);

  const out: ProjectedMonth[] = months.map(m => {
    const isProjected = !lastActual || m > lastActual;
    const notes: string[] = [];
    if (isProjected) {
      const rent: Record<string, number> = {};
      const fees: Record<string, CalcFee> = {};
      for (const t of tenants) {
        if (!t.active || !covers(t, m)) continue;
        const r = baseRent.get(t.id);
        if (r) rent[t.id] = r;
        const f = feeAvg.get(t.id);
        if (f) fees[t.id] = f;
      }
      projected.rent[m] = rent;
      projected.fees[m] = fees;
      if (!Object.values(data.opex[m] || {}).some(v => v > 0) && opexMonths.length) projected.opex[m] = { ...opexAvg };
    }
    for (const l of data.headLeases) {
      for (const inc of l.increases) if (inc.month === m) notes.push(`${l.name} +${inc.percent}%`);
      if (l.endMonth === m) notes.push(`Trả ${l.name}`);
    }
    for (const t of tenants) {
      if (t.active && t.contract_end && toMonthKey(t.contract_end) === m) notes.push(`HĐ ${t.name} hết hạn`);
      if (t.contract_start && toMonthKey(t.contract_start) === m) notes.push(`${t.name} bắt đầu thuê`);
    }
    return { ...computeMonth(projected, m), projected: isProjected, notes };
  });

  return { months: out, lastActual, data: projected };
}

/** Tháng dự báo đầu tiên bị lỗ (khi tháng thực tế cuối đang lời). */
export function firstProjectedLoss(p: Projection): ProjectedMonth | null {
  const last = p.months.filter(m => !m.projected).pop();
  if (last && last.profit < 0) return null;
  return p.months.find(m => m.projected && m.profit < 0) || null;
}

export function describeMonth(m: ProjectedMonth): string {
  return `${monthLabel(m.month)}${m.notes.length ? ` (${m.notes.join(', ')})` : ''}`;
}

export function projectionWindow(currentMonth: MonthKey, back: number, ahead: number): { from: MonthKey; count: number } {
  return { from: addMonths(currentMonth, -back), count: back + ahead + 1 };
}
