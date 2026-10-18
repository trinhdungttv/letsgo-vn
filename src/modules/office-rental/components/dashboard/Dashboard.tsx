import { useMemo, useState } from 'react';
import { ArrowRight, Lightbulb } from 'lucide-react';
import { Bar, Chart, Doughnut } from 'react-chartjs-2';
import type { ChartData, ScriptableLineSegmentContext } from 'chart.js';
import { useOffice } from '../../data/OfficeDataProvider';
import { useInsights, useOfficeEvents, useReceivables, useReferenceMonth } from '../../data/useSmart';
import { addMonths, monthLabel, monthRange } from '../../lib/calc/months';
import { fmtTr, fmtVND } from '../../lib/calc/money';
import { computeMonth, leaseCostVND, opexAt, forecastAt, tenantMonth, unitPL } from '../../lib/calc/pl';
import type { MonthKey } from '../../lib/calc/types';
import { buildProjection } from '../../lib/forecast';
import { effectiveRoomStatus, fmtDate, occupancy } from '../../lib/ops';
import { C, ChartEmpty, SERIES, Sparkline, alpha, baseOptions, trTick, trVal } from '../charts';
import { SEV_STYLE, whenLabel } from '../EventItem';
import { Card, SubTabs, Toggle, signed } from '../ui';

type Period = 'p6' | 'p12' | 'ytd' | 'all';

const TONE_DOT = { bad: 'bg-red-500', warn: 'bg-amber-400', good: 'bg-emerald-500', info: 'bg-blue-400' } as const;

function monthsBetween(a: MonthKey, b: MonthKey): number {
  const [y1, m1] = a.split('-').map(Number);
  const [y2, m2] = b.split('-').map(Number);
  return (y2 - y1) * 12 + (m2 - m1);
}

function Tile({ label, value, sub, spark, color, tone }: {
  label: string; value: string; sub?: React.ReactNode; spark?: number[]; color?: string; tone?: 'pos' | 'neg';
}) {
  return (
    <div className="bg-white rounded-xl border border-[#E8E7E2] p-3 min-w-0 flex flex-col">
      <div className="text-[10.5px] font-semibold text-gray-400 uppercase tracking-wide truncate">{label}</div>
      <div className={`text-[17px] md:text-[19px] font-semibold tabular-nums whitespace-nowrap mt-0.5 ${tone === 'pos' ? 'text-emerald-600' : tone === 'neg' ? 'text-red-600' : 'text-[#111]'}`}>{value}</div>
      {sub && <div className="text-[11px] text-gray-400 mt-0.5">{sub}</div>}
      {spark && <div className="mt-auto pt-1.5"><Sparkline values={spark} color={color} zeroLine /></div>}
    </div>
  );
}

export default function Dashboard() {
  const { calc, months, currentMonth, rows, opsReady, settings } = useOffice();
  const ref = useReferenceMonth();
  const [period, setPeriod] = useState<Period>('p12');
  const [showForecast, setShowForecast] = useState(true);
  const insights = useInsights();
  const receivable = useReceivables();
  const { visible } = useOfficeEvents();

  // Không lùi trước tháng bắt đầu theo dõi (Cài đặt) — trước đó chưa có số liệu doanh thu
  const rawStart = period === 'p6' ? addMonths(ref, -5) : period === 'p12' ? addMonths(ref, -11) : period === 'ytd' ? `${ref.slice(0, 4)}-01` : months[0];
  const start = rawStart < months[0] ? months[0] : rawStart;
  const end = showForecast ? addMonths(currentMonth > ref ? currentMonth : ref, 6) : ref;
  const projection = useMemo(() => buildProjection({
    data: calc, currentMonth, from: start, count: monthsBetween(start, end) + 1,
    tenants: rows.bds_tenants.map(t => ({ id: t.id, name: t.name, active: t.active, contract_start: t.contract_start, contract_end: t.contract_end })),
  }), [calc, currentMonth, start, end, rows.bds_tenants]);
  const hist = useMemo(() => monthRange(start, monthsBetween(start, ref) + 1), [start, ref]);
  const actual = projection.months.filter(m => !m.projected);
  const firstProj = projection.months.findIndex(m => m.projected);

  const k = computeMonth(calc, ref);
  const prev = computeMonth(calc, addMonths(ref, -1));
  const cum = actual.reduce((s, m) => s + m.profit, 0);
  const occ = occupancy(rows.bds_rooms, rows.bds_tenants);
  const deltaTxt = (cur: number, p: number) => (p ? `${cur >= p ? '↑' : '↓'} ${Math.abs((cur - p) / Math.abs(p) * 100).toFixed(1)}% so với tháng trước` : 'chưa có tháng trước');

  // ── A. Lời/lỗ + dự báo ──
  const isProj = (i: number) => firstProj >= 0 && i >= firstProj;
  const dashAfter = (ctx: ScriptableLineSegmentContext) => (isProj(ctx.p1DataIndex) ? [6, 4] : undefined);
  const comboData: ChartData<'bar' | 'line', number[], string> = {
    labels: projection.months.map(m => monthLabel(m.month)),
    datasets: [
      {
        type: 'bar', label: 'Lợi nhuận', order: 3, data: projection.months.map(m => m.profit / 1e6),
        backgroundColor: projection.months.map((m, i) => alpha(m.profit >= 0 ? C.profit : C.loss, isProj(i) ? 0.35 : 0.9)),
        borderRadius: 4, maxBarThickness: 26,
      },
      {
        type: 'line', label: 'Doanh thu', order: 1, data: projection.months.map(m => m.revenue / 1e6),
        borderColor: C.revenue, backgroundColor: C.revenue, borderWidth: 2, pointRadius: 2.5, tension: 0.3, segment: { borderDash: dashAfter },
      },
      {
        type: 'line', label: 'Tổng chi phí', order: 2, data: projection.months.map(m => m.cost / 1e6),
        borderColor: C.cost, backgroundColor: C.cost, borderWidth: 2, pointRadius: 2.5, tension: 0.3, segment: { borderDash: dashAfter },
      },
    ],
  };
  const comboOptions = baseOptions<'bar' | 'line'>({
    interaction: { mode: 'index', intersect: false },
    plugins: {
      tooltip: {
        callbacks: {
          title: items => `${items[0].label}${isProj(items[0].dataIndex) ? ' · dự báo' : ''}`,
          label: c => `${c.dataset.label}: ${trVal(Number(c.parsed.y) || 0)}`,
          footer: items => projection.months[items[0].dataIndex]?.notes.join(' · ') || '',
        },
      },
    },
    scales: {
      x: { grid: { display: false }, ticks: { font: { size: 10.5 }, color: C.muted } },
      y: { grid: { color: C.grid }, ticks: { font: { size: 10.5 }, color: C.muted, callback: v => trTick(v) } },
    },
  });

  // ── B. Cơ cấu chi phí ──
  const costParts = useMemo(() => {
    const parts = calc.headLeases.map(l => ({ label: l.name, value: hist.reduce((s, m) => s + leaseCostVND(l, m, calc.settings), 0) }));
    parts.push({ label: 'Vận hành', value: hist.reduce((s, m) => s + opexAt(calc, m), 0) });
    if (settings.include_forecast_in_cost) parts.push({ label: 'Dự kiến PS', value: hist.reduce((s, m) => s + forecastAt(calc, m), 0) });
    return parts.filter(p => p.value > 0);
  }, [calc, hist, settings.include_forecast_in_cost]);
  const costTotal = costParts.reduce((s, p) => s + p.value, 0);

  // ── C. Lời/lỗ theo mặt bằng ──
  const units = useMemo(() => {
    const map = new Map<string, { name: string; profit: number }>();
    for (const m of hist) for (const b of unitPL(calc, m).buckets) {
      const cur = map.get(b.key) || { name: b.name, profit: 0 };
      cur.profit += b.profit;
      map.set(b.key, cur);
    }
    return [...map.values()];
  }, [calc, hist]);

  // ── D. Doanh thu theo khách ──
  const byTenant = useMemo(() => {
    const list = calc.tenants.map(t => ({ name: t.name, value: hist.reduce((s, m) => s + tenantMonth(calc, m, t).total, 0) }))
      .filter(x => x.value > 0).sort((a, b) => b.value - a.value);
    if (list.length <= 7) return list;
    return [...list.slice(0, 6), { name: 'Khác', value: list.slice(6).reduce((s, x) => s + x.value, 0) }];
  }, [calc, hist]);
  const revTotal = byTenant.reduce((s, x) => s + x.value, 0);

  // ── E. Lấp đầy theo mặt bằng ──
  const occByLease = useMemo(() => {
    const groups = new Map<string, { name: string; occ: number; vac: number }>();
    for (const r of rows.bds_rooms) {
      const lease = rows.bds_head_leases.find(l => l.id === r.head_lease_id);
      const key = lease?.id || 'none';
      const g = groups.get(key) || { name: lease?.name || 'Chưa gán', occ: 0, vac: 0 };
      const a = Number(r.area_m2) || 0;
      if (effectiveRoomStatus(r, rows.bds_tenants) === 'occupied') g.occ += a; else g.vac += a;
      groups.set(key, g);
    }
    return [...groups.values()];
  }, [rows.bds_rooms, rows.bds_head_leases, rows.bds_tenants]);

  // ── F. Thu tiền ──
  const collection = useMemo(() => hist.map(m => {
    const due = computeMonth(calc, m).revenue;
    const paid = rows.bds_invoices.filter(i => i.month.slice(0, 7) === m && i.status === 'paid')
      .reduce((s, i) => {
        const t = calc.tenants.find(x => x.id === i.tenant_id);
        return s + (i.paid_amount ?? (t ? tenantMonth(calc, m, t).total : 0));
      }, 0);
    return { m, due, paid };
  }), [hist, calc, rows.bds_invoices]);
  const hasInvoices = rows.bds_invoices.length > 0;

  const upcoming = visible.filter(e => e.date && e.kind !== 'ticket' && (e.daysLeft ?? -1) >= 0).sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0)).slice(0, 6);

  const hbarOptions = (unit: 'tr' | 'm²') => baseOptions<'bar'>({
    indexAxis: 'y',
    plugins: {
      legend: { display: unit === 'm²', position: 'bottom', labels: { boxWidth: 10, font: { size: 11 }, color: C.ink } },
      tooltip: { callbacks: { label: c => `${c.dataset.label ? c.dataset.label + ': ' : ''}${unit === 'tr' ? trVal(Number(c.parsed.x) || 0) : `${(Number(c.parsed.x) || 0).toLocaleString('en-US')} m²`}` } },
    },
    scales: {
      x: { stacked: unit === 'm²', grid: { color: C.grid }, ticks: { font: { size: 10.5 }, color: C.muted, callback: v => (unit === 'tr' ? trTick(v) : `${v}`) } },
      y: { stacked: unit === 'm²', grid: { display: false }, ticks: { font: { size: 11 }, color: C.ink } },
    },
  });

  return (
    <div className="space-y-3 md:space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <SubTabs
          tabs={[{ key: 'p6', label: '6 tháng' }, { key: 'p12', label: '12 tháng' }, { key: 'ytd', label: `Năm ${ref.slice(0, 4)}` }, { key: 'all', label: 'Toàn bộ' }]}
          value={period} onChange={setPeriod}
        />
        <Toggle checked={showForecast} onChange={setShowForecast} label="Hiện dự báo 6 tháng tới (nét đứt)" />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2 md:gap-3">
        <Tile label={`Doanh thu ${monthLabel(ref)}`} value={`${fmtTr(k.revenue)} tr`} sub={deltaTxt(k.revenue, prev.revenue)} spark={actual.map(m => m.revenue)} color={C.revenue} />
        <Tile label={`Lợi nhuận ${monthLabel(ref)}`} value={`${signed(fmtTr(k.profit), k.profit)} tr`} tone={k.profit >= 0 ? 'pos' : 'neg'} sub={deltaTxt(k.profit, prev.profit)} spark={actual.map(m => m.profit)} color={k.profit >= 0 ? C.profit : C.loss} />
        <Tile label="Biên lợi nhuận" value={k.revenue > 0 ? `${(k.margin * 100).toFixed(1)}%` : '—'} sub={`Chi phí ${fmtTr(k.cost)} tr/tháng`} spark={actual.map(m => m.margin * 100)} color={C.profit} />
        <Tile label="Lũy kế lợi nhuận (kỳ)" value={`${signed(fmtTr(cum), cum)} tr`} tone={cum >= 0 ? 'pos' : 'neg'} sub={`${actual.length} tháng thực tế`} spark={actual.reduce<number[]>((a, m) => [...a, (a[a.length - 1] || 0) + m.profit], [])} color={cum >= 0 ? C.profit : C.loss} />
        <Tile label="Tỷ lệ lấp đầy" value={occ.rate === null ? '—' : `${Math.round(occ.rate * 100)}%`} sub={occ.rate === null ? 'Chưa khai báo phòng' : `${occ.occupied.toLocaleString('en-US')}/${occ.total.toLocaleString('en-US')} m²`} />
        <Tile label="Còn phải thu" value={`${fmtTr(receivable.total)} tr`} tone={receivable.overdue > 0 ? 'neg' : undefined} sub={receivable.overdue > 0 ? `Quá hạn ${fmtVND(receivable.overdue)}` : `${receivable.count} thông báo chưa thu`} />
      </div>

      <Card title={<><Lightbulb size={14} /> Nhận định tự động</>} desc="Hệ thống tự đọc số liệu và nêu điểm cần chú ý">
        <ul className="grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-1.5">
          {insights.map(i => (
            <li key={i.key} className="flex gap-2 text-[12.5px] text-gray-700 leading-snug">
              <span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${TONE_DOT[i.tone]}`} />
              {i.href ? <a href={i.href} className="hover:text-blue-700">{i.text}</a> : <span>{i.text}</span>}
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Doanh thu – Chi phí – Lợi nhuận" desc={<>Triệu VNĐ · cột xanh = lời, đỏ = lỗ · phần nhạt / nét đứt là <b>dự báo</b> (giữ tiền thuê hiện tại tới hết hợp đồng, chi phí có mốc tăng giá)</>}>
        <div className="h-[280px] md:h-[320px]"><Chart type="bar" data={comboData} options={comboOptions} /></div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 md:gap-4">
        <Card title="Cơ cấu chi phí" desc={`${monthLabel(hist[0])} – ${monthLabel(ref)} · tổng ${fmtTr(costTotal)} tr`}>
          <div className="h-[240px]">
            {costParts.length ? (
              <Doughnut
                data={{ labels: costParts.map(p => p.label), datasets: [{ data: costParts.map(p => p.value / 1e6), backgroundColor: costParts.map((_, i) => SERIES[i % SERIES.length]), borderColor: '#fff', borderWidth: 2 }] }}
                options={baseOptions<'doughnut'>({
                  cutout: '62%',
                  plugins: {
                    legend: { position: 'right', labels: { boxWidth: 10, font: { size: 11 }, color: C.ink } },
                    tooltip: { callbacks: { label: c => `${c.label}: ${trVal(Number(c.parsed) || 0)} (${((Number(c.parsed) * 1e6 / costTotal) * 100).toFixed(1)}%)` } },
                  },
                })}
              />
            ) : <ChartEmpty>Chưa có chi phí trong kỳ.</ChartEmpty>}
          </div>
        </Card>

        <Card title="Lời / lỗ theo mặt bằng" desc={`Cộng dồn ${monthLabel(hist[0])} – ${monthLabel(ref)} · chi phí vận hành không phân bổ`}>
          <div className="h-[240px]">
            {units.length ? (
              <Bar
                data={{ labels: units.map(u => u.name), datasets: [{ data: units.map(u => u.profit / 1e6), backgroundColor: units.map(u => (u.profit >= 0 ? C.profit : C.loss)), borderRadius: 4, maxBarThickness: 22 }] }}
                options={{ ...hbarOptions('tr'), plugins: { ...hbarOptions('tr').plugins, legend: { display: false } } }}
              />
            ) : <ChartEmpty>Chưa có khoản thuê đầu vào.</ChartEmpty>}
          </div>
        </Card>

        <Card title="Doanh thu theo khách" desc={revTotal ? `Tổng ${fmtTr(revTotal)} tr · khách lớn nhất chiếm ${((byTenant[0]?.value || 0) / revTotal * 100).toFixed(0)}%` : 'Chưa có doanh thu trong kỳ'}>
          <div className="h-[240px]">
            {byTenant.length ? (
              <Bar
                data={{ labels: byTenant.map(x => `${x.name} · ${(x.value / revTotal * 100).toFixed(0)}%`), datasets: [{ data: byTenant.map(x => x.value / 1e6), backgroundColor: byTenant.map((x, i) => (x.name === 'Khác' ? C.neutral : SERIES[i % SERIES.length])), borderRadius: 4, maxBarThickness: 22 }] }}
                options={{ ...hbarOptions('tr'), plugins: { ...hbarOptions('tr').plugins, legend: { display: false } } }}
              />
            ) : <ChartEmpty>Nhập tiền thuê ở <a className="text-blue-600 mx-1" href="#/office-pl/doanh-thu">Doanh thu khách hàng</a> để xem.</ChartEmpty>}
          </div>
        </Card>

        <Card title="Lấp đầy theo mặt bằng" desc={occ.rate === null ? 'Chưa khai báo phòng' : `${Math.round((occ.rate || 0) * 100)}% diện tích đang có khách`}>
          <div className="h-[240px]">
            {occByLease.length ? (
              <Bar
                data={{
                  labels: occByLease.map(g => g.name),
                  datasets: [
                    { label: 'Đang thuê', data: occByLease.map(g => g.occ), backgroundColor: C.profit, borderRadius: 4, maxBarThickness: 22 },
                    { label: 'Trống', data: occByLease.map(g => g.vac), backgroundColor: C.neutral, borderRadius: 4, maxBarThickness: 22 },
                  ],
                }}
                options={hbarOptions('m²')}
              />
            ) : <ChartEmpty>{opsReady ? <>Khai báo phòng ở <a className="text-blue-600 mx-1" href="#/office-rooms/phong">Phòng & Hợp đồng</a> để xem.</> : 'Cần chạy migration 165.'}</ChartEmpty>}
          </div>
        </Card>

        <Card title="Thu tiền theo tháng" desc="Phải thu (tính từ doanh thu) và đã thu (theo thông báo thanh toán)">
          <div className="h-[240px]">
            {hasInvoices ? (
              <Bar
                data={{
                  labels: collection.map(c => monthLabel(c.m)),
                  datasets: [
                    { label: 'Phải thu', data: collection.map(c => c.due / 1e6), backgroundColor: alpha(C.revenue, 0.35), borderRadius: 4, maxBarThickness: 18 },
                    { label: 'Đã thu', data: collection.map(c => c.paid / 1e6), backgroundColor: C.revenue, borderRadius: 4, maxBarThickness: 18 },
                  ],
                }}
                options={baseOptions<'bar'>({
                  interaction: { mode: 'index', intersect: false },
                  plugins: { tooltip: { callbacks: { label: c => `${c.dataset.label}: ${trVal(Number(c.parsed.y) || 0)}` } } },
                  scales: {
                    x: { grid: { display: false }, ticks: { font: { size: 10.5 }, color: C.muted } },
                    y: { grid: { color: C.grid }, ticks: { font: { size: 10.5 }, color: C.muted, callback: v => trTick(v) } },
                  },
                })}
              />
            ) : <ChartEmpty>Lập thông báo thanh toán ở <a className="text-blue-600 mx-1" href="#/office-billing/hoa-don">Hoá đơn</a> để theo dõi thu tiền.</ChartEmpty>}
          </div>
        </Card>

        <Card title="Sắp tới" actions={<a href="#/office" className="text-[11.5px] text-blue-600 hover:underline inline-flex items-center gap-0.5">Tổng quan <ArrowRight size={12} /></a>}>
          <div className="space-y-1.5">
            {upcoming.map(e => (
              <a key={e.key} href={e.href} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-gray-50 border border-gray-100">
                <span className={`w-1.5 self-stretch rounded-full ${SEV_STYLE[e.severity].bar}`} />
                <span className="text-[11px] text-gray-400 w-[70px] shrink-0 tabular-nums">{fmtDate(e.date)}</span>
                <span className="text-[12px] text-[#111] flex-1 min-w-0 truncate">{e.title}</span>
                <span className={`text-[10.5px] font-semibold px-1.5 rounded shrink-0 ${SEV_STYLE[e.severity].chip}`}>{whenLabel(e)}</span>
              </a>
            ))}
            {!upcoming.length && <ChartEmpty>Không có mốc nào trong {settings.alert_days ?? 90} ngày tới.</ChartEmpty>}
          </div>
        </Card>
      </div>
    </div>
  );
}
