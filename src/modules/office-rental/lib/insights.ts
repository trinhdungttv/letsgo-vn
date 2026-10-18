// Nhận định tự động bằng tiếng Việt từ số liệu — thuần TS.
import type { CalcData, MonthKey } from './calc/types';
import { addMonths, monthLabel } from './calc/months';
import { fmtTr, fmtVND } from './calc/money';
import { computeMonth, hasRevenue, leaseCostVND, tenantMonth, unitPL } from './calc/pl';
import type { Projection } from './forecast';
import { firstProjectedLoss } from './forecast';

export type InsightTone = 'good' | 'bad' | 'warn' | 'info';

export interface Insight {
  key: string;
  tone: InsightTone;
  text: string;
  href?: string;
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

export function buildInsights(input: {
  data: CalcData;
  months: MonthKey[];
  currentMonth: MonthKey;
  projection: Projection;
  unpaid: { total: number; overdue: number };
  occupancy: { total: number; occupied: number; rate: number | null };
}): Insight[] {
  const { data, currentMonth, projection } = input;
  const out: Insight[] = [];
  const actual = input.months.filter(m => m <= currentMonth && hasRevenue(data, m));
  const A = actual[actual.length - 1];
  const B = actual[actual.length - 2];

  if (!A) {
    out.push({ key: 'no-data', tone: 'warn', text: 'Chưa có tháng nào nhập doanh thu — nhập tiền thuê để hệ thống tính lời/lỗ và dự báo.', href: '#/office-pl/doanh-thu' });
  } else {
    const a = computeMonth(data, A);
    out.push({
      key: 'last', tone: a.profit >= 0 ? 'good' : 'bad',
      text: `${monthLabel(A)} ${a.profit >= 0 ? 'lời' : 'lỗ'} ${fmtTr(Math.abs(a.profit))} tr — doanh thu ${fmtTr(a.revenue)} tr, chi phí ${fmtTr(a.cost)} tr, biên ${pct(a.margin)}.`,
    });
    if (B) {
      const b = computeMonth(data, B);
      if (b.revenue > 0) {
        const d = (a.revenue - b.revenue) / b.revenue;
        if (Math.abs(d) >= 0.005) {
          out.push({
            key: 'mom', tone: d >= 0 ? 'good' : 'warn',
            text: `Doanh thu ${monthLabel(A)} ${d >= 0 ? 'tăng' : 'giảm'} ${pct(Math.abs(d))} so với ${monthLabel(B)} (${d >= 0 ? '+' : '−'}${fmtTr(Math.abs(a.revenue - b.revenue))} tr).`,
          });
        }
      }
    }
    // Lũy kế năm
    const year = A.slice(0, 4);
    const ytd = actual.filter(m => m.startsWith(year)).map(m => computeMonth(data, m));
    if (ytd.length > 1) {
      const sum = ytd.reduce((s, x) => s + x.profit, 0);
      out.push({ key: 'ytd', tone: sum >= 0 ? 'good' : 'bad', text: `Lũy kế ${ytd.length} tháng năm ${year}: ${sum >= 0 ? 'lời' : 'lỗ'} ${fmtTr(Math.abs(sum))} tr.` });
    }

    // Rủi ro tập trung khách
    const rents = data.tenants.map(t => ({ t, v: tenantMonth(data, A, t).rent })).filter(x => x.v > 0).sort((x, y) => y.v - x.v);
    const totalRent = rents.reduce((s, x) => s + x.v, 0);
    if (rents.length && totalRent > 0 && rents[0].v / totalRent >= 0.5) {
      out.push({
        key: 'concentration', tone: 'warn',
        text: `${rents[0].t.name} chiếm ${pct(rents[0].v / totalRent)} tiền thuê — phụ thuộc lớn vào 1 khách, nên theo dõi sát hợp đồng.`,
        href: '#/office-rooms/hop-dong',
      });
    }

    // Mặt bằng / bãi xe đang lỗ
    const u = unitPL(data, A);
    for (const b of u.buckets) {
      if (b.kind === 'lease' && b.revenue === 0 && b.cost > 0) {
        const assigned = data.tenants.filter(t => t.headLeaseId === b.key).map(t => t.name);
        out.push({
          key: `empty-${b.key}`, tone: 'warn',
          text: assigned.length
            ? `${b.name} không có doanh thu ${monthLabel(A)} (${assigned.join(', ')} chưa nhập tiền thuê?) — chi phí thuê ${fmtTr(b.cost)} tr/tháng.`
            : `${b.name} chưa có khách gán vào — đang gánh ${fmtTr(b.cost)} tr/tháng chi phí thuê.`,
          href: assigned.length ? '#/office-pl/doanh-thu' : '#/office-pl/mat-bang',
        });
      } else if (b.kind === 'parking' && b.profit < 0 && data.settings.parkingPriceMoto > 0) {
        out.push({
          key: 'parking', tone: 'warn',
          text: `Bãi xe lỗ ${fmtTr(-b.profit)} tr/tháng — cần thêm ~${Math.ceil(-b.profit / data.settings.parkingPriceMoto)} xe máy (hoặc tăng giá gửi xe) để hòa vốn.`,
          href: '#/office-parking',
        });
      }
    }

    // Hòa vốn
    const cur = computeMonth(data, A);
    if (cur.cost > 0) {
      out.push({
        key: 'breakeven', tone: cur.revenue >= cur.cost ? 'info' : 'warn',
        text: `Cần doanh thu tối thiểu ${fmtTr(cur.cost)} tr/tháng để hòa vốn — ${monthLabel(A)} đạt ${pct(cur.revenue / cur.cost)}.`,
      });
    }
  }

  // Mốc tăng giá 12 tháng tới
  const end = addMonths(currentMonth, 12);
  const incs = data.headLeases.flatMap(l => l.increases
    .filter(i => i.month > currentMonth && i.month <= end)
    .map(i => ({ l, i, delta: leaseCostVND(l, i.month, data.settings) - leaseCostVND(l, addMonths(i.month, -1), data.settings) })));
  if (incs.length) {
    const sum = incs.reduce((s, x) => s + x.delta, 0);
    out.push({
      key: 'increases', tone: 'warn',
      text: `12 tháng tới chi phí thuê tăng thêm ${fmtVND(sum)}/tháng: ${incs.sort((x, y) => x.i.month.localeCompare(y.i.month)).map(x => `${x.l.name} +${x.i.percent}% từ ${monthLabel(x.i.month)}`).join('; ')}.`,
      href: '#/office-pl/chi-phi-thue',
    });
  }

  // Dự báo chuyển sang lỗ
  const loss = firstProjectedLoss(projection);
  if (loss) {
    out.push({
      key: 'proj-loss', tone: 'bad',
      text: `Dự báo bắt đầu lỗ từ ${monthLabel(loss.month)} (${fmtTr(loss.profit)} tr)${loss.notes.length ? ` — do ${loss.notes.join(', ')}` : ''}.`,
      href: '#/office-reports/du-bao',
    });
  }

  // Thiếu số liệu
  const missing = input.months.filter(m => m < currentMonth && !hasRevenue(data, m) && (!actual[0] || m > actual[0]));
  if (missing.length) {
    out.push({ key: 'gaps', tone: 'warn', text: `${missing.length} tháng chưa nhập doanh thu: ${missing.map(monthLabel).join(', ')}.`, href: '#/office-pl/doanh-thu' });
  }

  if (input.unpaid.total > 0) {
    out.push({
      key: 'unpaid', tone: input.unpaid.overdue > 0 ? 'bad' : 'info',
      text: `Còn phải thu ${fmtVND(input.unpaid.total)}${input.unpaid.overdue > 0 ? `, trong đó quá hạn ${fmtVND(input.unpaid.overdue)}` : ''}.`,
      href: '#/office-reports/cong-no',
    });
  }

  if (input.occupancy.rate !== null && input.occupancy.rate < 1) {
    out.push({
      key: 'occupancy', tone: input.occupancy.rate < 0.8 ? 'warn' : 'info',
      text: `Lấp đầy ${pct(input.occupancy.rate)} (${(input.occupancy.total - input.occupancy.occupied).toLocaleString('en-US')} m² còn trống).`,
      href: '#/office-rooms/phong',
    });
  }

  const rank: Record<InsightTone, number> = { bad: 0, warn: 1, good: 2, info: 3 };
  return out.sort((x, y) => rank[x.tone] - rank[y.tone]);
}
