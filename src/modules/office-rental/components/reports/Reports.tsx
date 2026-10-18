import { useMemo, useState, type ReactNode } from 'react';
import { Download, Printer } from 'lucide-react';
import { useOffice } from '../../data/OfficeDataProvider';
import { sortTenants } from '../../data/selectors';
import { useReferenceMonth } from '../../data/useSmart';
import { addMonths, monthLabel, monthRange, monthToDate, toMonthKey } from '../../lib/calc/months';
import { fmtMoney, fmtTr, fmtUSD, fmtVND } from '../../lib/calc/money';
import { computeMonth, hasRevenue, leaseCostVND, priceAt, sumResults, tenantMonth, unitPL } from '../../lib/calc/pl';
import { gross, vatRateFor } from '../../lib/calc/vat';
import type { MonthKey } from '../../lib/calc/types';
import { toCsv } from '../../lib/calc/csv';
import { downloadText, stamp } from '../../lib/download';
import { buildProjection } from '../../lib/forecast';
import { contractState, daysBetween, fmtDate, invoiceBreakdown, invoiceState, todayStr } from '../../lib/ops';
import { ReportHeader, usePrint } from '../print';
import { Badge, Card, MonthSelect, cls, signed } from '../ui';
import { ContractBadge } from '../ops/shared';

export type ReportTab = 'thang' | 'nam' | 'cong-no' | 'hop-dong' | 'du-bao';

type Row = (string | number)[];

function monthsDiff(a: MonthKey, b: MonthKey): number {
  const [y1, m1] = a.split('-').map(Number);
  const [y2, m2] = b.split('-').map(Number);
  return (y2 - y1) * 12 + (m2 - m1);
}

function Toolbar({ children, onCsv, onPrint }: { children?: ReactNode; onCsv: () => void; onPrint: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {children}
      <div className="ml-auto flex gap-2">
        <button className={`${cls.btn} ${cls.secondary}`} onClick={onCsv}><Download size={13} /> Xuất CSV</button>
        <button className={`${cls.btn} ${cls.primary}`} onClick={onPrint}><Printer size={13} /> In / PDF</button>
      </div>
    </div>
  );
}

function T({ head, rows, foot, align }: { head: string[]; rows: ReactNode[][]; foot?: ReactNode[]; align?: ('l' | 'r')[] }) {
  const a = (i: number) => (align?.[i] ?? (i === 0 ? 'l' : 'r')) === 'l' ? 'text-left' : 'text-right tabular-nums';
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12px]">
        <thead className="bg-gray-50/70"><tr>{head.map((h, i) => <th key={i} className={`${cls.th} ${a(i)}`}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, ri) => <tr key={ri} className="border-t border-gray-100">{r.map((c, i) => <td key={i} className={`${cls.td} ${a(i)}`}>{c}</td>)}</tr>)}</tbody>
        {foot && <tfoot><tr className="border-t-2 border-gray-200 bg-gray-50 font-semibold">{foot.map((c, i) => <td key={i} className={`${cls.td} ${a(i)}`}>{c}</td>)}</tr></tfoot>}
      </table>
    </div>
  );
}

const pnl = (v: number, unit: 'vnd' | 'tr' = 'vnd') => (
  <span className={v >= 0 ? 'text-emerald-700' : 'text-red-600'}>{signed(unit === 'tr' ? fmtTr(v) : fmtVND(v), v)}</span>
);
const pctChange = (cur: number, prev: number) => (prev ? `${cur >= prev ? '+' : ''}${(((cur - prev) / Math.abs(prev)) * 100).toFixed(1)}%` : '—');

// ═══ 1. Báo cáo tháng ═════════════════════════════════════════════════════
function MonthReport() {
  const { calc, months, rows, opsReady } = useOffice();
  const ref = useReferenceMonth();
  const [sel, setSel] = useState<MonthKey | null>(null);
  const m = sel && months.includes(sel) ? sel : ref;
  const { print, portal } = usePrint();
  const k = computeMonth(calc, m);
  const prev = computeMonth(calc, addMonths(m, -1));
  const yoyMonth = addMonths(m, -12);
  const yoy = hasRevenue(calc, yoyMonth) ? computeMonth(calc, yoyMonth) : null;
  const tenants = sortTenants(rows.bds_tenants).map(t => ({ t, x: tenantMonth(calc, m, calc.tenants.find(c => c.id === t.id)!) })).filter(r => r.x.total > 0);
  const leases = calc.headLeases.map(l => ({ l, v: leaseCostVND(l, m, calc.settings) })).filter(r => r.v > 0);
  const cats = calc.opexCategories.map(c => ({ c, v: gross(calc.opex[m]?.[c.id] || 0, c.vatMode, vatRateFor(calc.settings, c.vatCategory)) })).filter(r => r.v > 0);
  const units = unitPL(calc, m);
  const inv = rows.bds_invoices.filter(i => i.month === monthToDate(m));
  const paid = inv.filter(i => i.status === 'paid').reduce((s, i) => {
    const t = calc.tenants.find(c => c.id === i.tenant_id);
    return s + (i.paid_amount ?? (t ? tenantMonth(calc, m, t).total : 0));
  }, 0);

  const body = (
    <div className="space-y-4">
      <ReportHeader title="Báo cáo kết quả kinh doanh" period={`Tháng ${Number(m.slice(5))}/${m.slice(0, 4)}`} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[12px]">
        {[
          ['Doanh thu', fmtVND(k.revenue)], ['Tổng chi phí', fmtVND(k.cost)],
          ['Lợi nhuận', signed(fmtVND(k.profit), k.profit)], ['Biên lợi nhuận', k.revenue > 0 ? `${(k.margin * 100).toFixed(1)}%` : '—'],
        ].map(([l, v]) => <div key={l} className="border border-gray-200 rounded-lg p-2"><div className="text-[10.5px] text-gray-400 uppercase font-semibold">{l}</div><div className="text-[15px] font-semibold tabular-nums">{v}</div></div>)}
      </div>
      <div>
        <div className="text-[12.5px] font-semibold mb-1">1. Doanh thu theo khách (đã gồm VAT)</div>
        <T
          head={['Khách thuê', 'Tiền thuê', 'Điện', 'Gửi xe', 'Tổng']}
          rows={tenants.map(({ t, x }) => [t.name + (t.currency === 'USD' ? ` (${fmtUSD(x.rentInput)})` : ''), fmtVND(x.rent), fmtVND(x.electricity), fmtVND(x.parking), fmtVND(x.total)])}
          foot={['Tổng doanh thu', fmtVND(k.rentRevenue), '', '', fmtVND(k.revenue)]}
        />
      </div>
      <div>
        <div className="text-[12.5px] font-semibold mb-1">2. Chi phí</div>
        <T
          head={['Khoản chi', 'Nhóm', 'Số tiền']}
          align={['l', 'l', 'r']}
          rows={[
            ...leases.map(({ l, v }) => [l.name, l.landlord === 'mbt' ? 'Thuê MBT' : 'Thuê TS4', fmtVND(v)]),
            ...cats.map(({ c, v }) => [c.name, 'Vận hành', fmtVND(v)]),
            ...(calc.settings.includeForecastInCost && k.forecast ? [['Khoản dự kiến phát sinh', 'Dự kiến', fmtVND(k.forecast)]] : []),
          ]}
          foot={['Tổng chi phí', '', fmtVND(k.cost)]}
        />
      </div>
      <div>
        <div className="text-[12.5px] font-semibold mb-1">3. So sánh</div>
        <T
          head={['Chỉ tiêu', monthLabel(m), monthLabel(addMonths(m, -1)), 'Thay đổi', yoy ? monthLabel(yoyMonth) : 'Cùng kỳ', 'So cùng kỳ']}
          rows={([['Doanh thu', 'revenue'], ['Tổng chi phí', 'cost'], ['Lợi nhuận', 'profit']] as const).map(([l, f]) => [
            l, fmtVND(k[f]), fmtVND(prev[f]), pctChange(k[f], prev[f]), yoy ? fmtVND(yoy[f]) : '—', yoy ? pctChange(k[f], yoy[f]) : '—',
          ])}
        />
      </div>
      <div>
        <div className="text-[12.5px] font-semibold mb-1">4. Lời / lỗ theo mặt bằng</div>
        <T
          head={['Mặt bằng', 'Doanh thu', 'Chi phí thuê', 'Lời / lỗ']}
          rows={units.buckets.map(b => [b.name, fmtVND(b.revenue), fmtVND(b.cost), pnl(b.profit)])}
          foot={[`Σ − vận hành${units.forecastInCost ? ' − dự kiến' : ''} = lợi nhuận`, '', '', <>{pnl(units.reconciledProfit)} {units.ok ? '✓' : '⚠'}</>]}
        />
      </div>
      {opsReady && inv.length > 0 && (
        <div className="text-[12px]">
          <b>5. Thu tiền:</b> phải thu {fmtVND(k.revenue)} · đã thu {fmtVND(paid)} · còn lại <b>{fmtVND(Math.max(0, k.revenue - paid))}</b>
        </div>
      )}
    </div>
  );

  const csv = () => {
    const r: Row[] = [['Mục', 'Chi tiết', 'Số tiền (VNĐ)']];
    tenants.forEach(({ t, x }) => r.push(['Doanh thu', t.name, Math.round(x.total)]));
    r.push(['Doanh thu', 'TỔNG', Math.round(k.revenue)]);
    leases.forEach(({ l, v }) => r.push(['Chi phí thuê', l.name, Math.round(v)]));
    cats.forEach(({ c, v }) => r.push(['Chi phí vận hành', c.name, Math.round(v)]));
    if (calc.settings.includeForecastInCost && k.forecast) r.push(['Dự kiến', 'Khoản dự kiến', Math.round(k.forecast)]);
    r.push(['Chi phí', 'TỔNG', Math.round(k.cost)], ['Lợi nhuận', '', Math.round(k.profit)]);
    units.buckets.forEach(b => r.push(['Theo mặt bằng', b.name, Math.round(b.profit)]));
    downloadText(`orient_bao_cao_${m}.csv`, toCsv(r), 'text/csv;charset=utf-8');
  };

  return (
    <div className="space-y-3">
      <Toolbar onCsv={csv} onPrint={() => print(body)}>
        <span className="text-[12px] text-gray-500">Tháng</span><MonthSelect months={months} value={m} onChange={setSel} />
      </Toolbar>
      <Card>{body}</Card>
      {portal}
    </div>
  );
}

// ═══ 2. Năm / quý ═════════════════════════════════════════════════════════
function YearReport() {
  const { calc, months, rows, currentMonth } = useOffice();
  const ref = useReferenceMonth();
  const years = [...new Set(months.map(m => m.slice(0, 4)))];
  const [year, setYear] = useState(ref.slice(0, 4));
  const { print, portal } = usePrint();
  const proj = useMemo(() => buildProjection({
    data: calc, currentMonth, from: `${year}-01`, count: 12,
    tenants: rows.bds_tenants.map(t => ({ id: t.id, name: t.name, active: t.active, contract_start: t.contract_start, contract_end: t.contract_end })),
  }), [calc, currentMonth, year, rows.bds_tenants]);
  const quarters = [0, 1, 2, 3].map(q => proj.months.slice(q * 3, q * 3 + 3));
  const actual = proj.months.filter(x => !x.projected);
  const totA = sumResults(actual);
  const totAll = sumResults(proj.months);
  const line = (label: ReactNode, x: { revenue: number; mbt: number; ts4: number; opex: number; cost: number; profit: number; margin: number }, note?: ReactNode) =>
    [label, fmtTr(x.revenue), fmtTr(x.mbt), fmtTr(x.ts4), fmtTr(x.opex), fmtTr(x.cost), pnl(x.profit, 'tr'), x.revenue > 0 ? `${(x.margin * 100).toFixed(1)}%` : '—', note ?? ''];
  const tableRows: ReactNode[][] = [];
  quarters.forEach((q, qi) => {
    q.forEach(x => tableRows.push(line(monthLabel(x.month), x, x.projected ? <Badge tone="blue">Dự báo</Badge> : <Badge tone="green">Thực tế</Badge>)));
    tableRows.push(line(<b>Quý {qi + 1}</b>, sumResults(q), q.some(x => x.projected) ? <span className="text-[10.5px] text-gray-400">gồm dự báo</span> : ''));
  });
  const body = (
    <div className="space-y-3">
      <ReportHeader title={`Báo cáo năm ${year}`} period="Theo tháng và quý · đơn vị triệu VNĐ" />
      <T head={['Kỳ', 'Doanh thu', 'Thuê MBT', 'Thuê TS4', 'Vận hành', 'Tổng CP', 'Lợi nhuận', 'Biên', '']} rows={tableRows}
        align={['l', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'l']}
        foot={line(`Lũy kế thực tế (${actual.length} th)`, totA)} />
      <div className="text-[12px] text-gray-600">Cả năm (thực tế + dự báo): doanh thu <b>{fmtTr(totAll.revenue)} tr</b>, chi phí <b>{fmtTr(totAll.cost)} tr</b>, lợi nhuận <b>{pnl(totAll.profit, 'tr')} tr</b>.</div>
    </div>
  );
  const csv = () => {
    const r: Row[] = [['Kỳ', 'Doanh thu', 'Thuê MBT', 'Thuê TS4', 'Vận hành', 'Tổng CP', 'Lợi nhuận', 'Biên %', 'Loại']];
    proj.months.forEach(x => r.push([monthLabel(x.month), Math.round(x.revenue), Math.round(x.mbt), Math.round(x.ts4), Math.round(x.opex), Math.round(x.cost), Math.round(x.profit), x.revenue > 0 ? (x.margin * 100).toFixed(1) : '0', x.projected ? 'Dự báo' : 'Thực tế']));
    downloadText(`orient_bao_cao_nam_${year}.csv`, toCsv(r), 'text/csv;charset=utf-8');
  };
  return (
    <div className="space-y-3">
      <Toolbar onCsv={csv} onPrint={() => print(body)}>
        <span className="text-[12px] text-gray-500">Năm</span>
        <select className={cls.inputSm} value={year} onChange={e => setYear(e.target.value)}>{years.map(y => <option key={y} value={y}>{y}</option>)}</select>
      </Toolbar>
      <Card pad={false}><div className="p-3 md:p-4">{body}</div></Card>
      {portal}
    </div>
  );
}

// ═══ 3. Công nợ ═══════════════════════════════════════════════════════════
function ReceivablesReport() {
  const { calc, rows, opsReady, currentMonth } = useOffice();
  const today = todayStr();
  const { print, portal } = usePrint();
  if (!opsReady) return <Card><div className="text-[12.5px] text-gray-500">Cần chạy migration 165 để theo dõi công nợ.</div></Card>;
  const ct = new Map(calc.tenants.map(t => [t.id, t]));
  const bucketOf = (days: number) => (days <= 0 ? 'Chưa đến hạn' : days <= 30 ? '1–30 ngày' : days <= 60 ? '31–60 ngày' : 'Trên 60 ngày');
  const open = rows.bds_invoices.filter(i => i.status !== 'paid' && ct.has(i.tenant_id)).map(i => {
    const st = invoiceState(i, today);
    const amount = invoiceBreakdown(calc, toMonthKey(i.month), ct.get(i.tenant_id)!).total;
    const over = i.due_date ? daysBetween(i.due_date, today) : 0;
    return { i, name: ct.get(i.tenant_id)!.name, amount, over, bucket: bucketOf(over), st };
  }).sort((a, b) => b.over - a.over);
  const buckets = ['Chưa đến hạn', '1–30 ngày', '31–60 ngày', 'Trên 60 ngày'].map(b => ({ b, v: open.filter(x => x.bucket === b).reduce((s, x) => s + x.amount, 0) }));
  const total = open.reduce((s, x) => s + x.amount, 0);
  // Tháng đã có doanh thu nhưng chưa lập thông báo: chỉ tính từ tháng đầu tiên anh bắt đầu lập thông báo
  // tới tháng trước (tháng hiện tại chưa tới kỳ), tối đa 6 tháng.
  const invoiced = new Set(rows.bds_invoices.map(i => `${i.tenant_id}|${toMonthKey(i.month)}`));
  const firstInvoiced = rows.bds_invoices.map(i => toMonthKey(i.month)).sort()[0];
  const prevMonth = addMonths(currentMonth, -1);
  const fromMonth = firstInvoiced && firstInvoiced > addMonths(currentMonth, -6) ? firstInvoiced : addMonths(currentMonth, -6);
  const checkMonths = firstInvoiced && fromMonth <= prevMonth ? monthRange(fromMonth, monthsDiff(fromMonth, prevMonth) + 1) : [];
  const notIssued = checkMonths.flatMap(m => calc.tenants
    .map(t => ({ m, t, v: tenantMonth(calc, m, t).total }))
    .filter(x => x.v > 0 && !invoiced.has(`${x.t.id}|${x.m}`)));
  const body = (
    <div className="space-y-3">
      <ReportHeader title="Báo cáo công nợ phải thu" period={`Tính đến ${fmtDate(today)}`} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {buckets.map(x => <div key={x.b} className={`border rounded-lg p-2 ${x.b === 'Trên 60 ngày' && x.v ? 'border-red-300 bg-red-50' : 'border-gray-200'}`}><div className="text-[10.5px] text-gray-400 uppercase font-semibold">{x.b}</div><div className="text-[14px] font-semibold tabular-nums">{fmtVND(x.v)}</div></div>)}
      </div>
      <T
        head={['Khách', 'Kỳ', 'Số TB', 'Hạn TT', 'Số tiền', 'Tuổi nợ']}
        align={['l', 'l', 'l', 'l', 'r', 'l']}
        rows={open.map(x => [x.name, monthLabel(toMonthKey(x.i.month)), x.i.invoice_no || '—', fmtDate(x.i.due_date), fmtVND(x.amount), x.over > 0 ? <Badge tone={x.over > 60 ? 'red' : 'amber'}>Quá {x.over} ngày</Badge> : <Badge>Chưa đến hạn</Badge>])}
        foot={['Tổng còn phải thu', '', '', '', fmtVND(total), '']}
      />
      {notIssued.length > 0 && (
        <div>
          <div className="text-[12.5px] font-semibold mb-1">Đã có doanh thu nhưng chưa lập thông báo thanh toán</div>
          <T head={['Khách', 'Kỳ', 'Số tiền']} align={['l', 'l', 'r']} rows={notIssued.map(x => [x.t.name, monthLabel(x.m), fmtVND(x.v)])} />
        </div>
      )}
      {!open.length && !notIssued.length && <div className="text-[12.5px] text-emerald-700">✓ Không có công nợ.</div>}
    </div>
  );
  const csv = () => {
    const r: Row[] = [['Khách', 'Kỳ', 'Số TB', 'Hạn TT', 'Số tiền', 'Quá hạn (ngày)', 'Nhóm']];
    open.forEach(x => r.push([x.name, monthLabel(toMonthKey(x.i.month)), x.i.invoice_no || '', fmtDate(x.i.due_date), Math.round(x.amount), Math.max(0, x.over), x.bucket]));
    notIssued.forEach(x => r.push([x.t.name, monthLabel(x.m), '', '', Math.round(x.v), '', 'Chưa lập thông báo']));
    downloadText(`orient_cong_no_${stamp()}.csv`, toCsv(r), 'text/csv;charset=utf-8');
  };
  return (
    <div className="space-y-3">
      <Toolbar onCsv={csv} onPrint={() => print(body)} />
      <Card>{body}</Card>
      {portal}
    </div>
  );
}

// ═══ 4. Hợp đồng ══════════════════════════════════════════════════════════
function ContractsReport() {
  const { calc, rows, settings, opsReady, currentMonth } = useOffice();
  const today = todayStr();
  const { print, portal } = usePrint();
  const roomOf = new Map(rows.bds_rooms.map(r => [r.id, r]));
  const quarterOf = (d: string | null | undefined) => (d ? `Q${Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1}/${d.slice(0, 4)}` : 'Chưa nhập ngày hết hạn');
  const list = sortTenants(rows.bds_tenants).filter(t => t.active).map(t => {
    const ct = calc.tenants.find(c => c.id === t.id)!;
    const ms = Object.keys(calc.rent).filter(m => m <= currentMonth && (calc.rent[m]?.[t.id] || 0) > 0).sort();
    const last = ms[ms.length - 1];
    const monthly = last ? tenantMonth(calc, last, ct).total : 0;
    return { t, monthly, q: quarterOf(t.contract_end), c: contractState(t, today, settings.alert_days ?? 90) };
  }).sort((a, b) => (a.t.contract_end || '9999').localeCompare(b.t.contract_end || '9999'));
  const byQ = [...new Set(list.map(x => x.q))].map(q => ({ q, n: list.filter(x => x.q === q).length, v: list.filter(x => x.q === q).reduce((s, x) => s + x.monthly, 0) }));
  const depVND = rows.bds_tenants.filter(t => t.active && t.deposit_currency !== 'USD').reduce((s, t) => s + (Number(t.deposit_amount) || 0), 0);
  const depUSD = rows.bds_tenants.filter(t => t.active && t.deposit_currency === 'USD').reduce((s, t) => s + (Number(t.deposit_amount) || 0), 0);
  const end24 = addMonths(currentMonth, 24);
  const inbound = calc.headLeases.flatMap(l => [
    ...l.increases.filter(i => i.month >= currentMonth && i.month <= end24).map(i => ({ m: i.month, text: `${l.name}: tăng ${i.percent}% → ${fmtMoney(priceAt(l, i.month), l.currency)}/tháng (+${fmtVND(leaseCostVND(l, i.month, calc.settings) - leaseCostVND(l, addMonths(i.month, -1), calc.settings))})` })),
    ...(l.endMonth && l.endMonth >= currentMonth && l.endMonth <= end24 ? [{ m: l.endMonth, text: `${l.name}: trả mặt bằng` }] : []),
  ]).sort((a, b) => a.m.localeCompare(b.m));
  const body = (
    <div className="space-y-3">
      <ReportHeader title="Báo cáo hợp đồng" period={`Tính đến ${fmtDate(today)}`} />
      {!opsReady && <div className="text-[12px] text-amber-700">Cần migration 165 để có ngày hợp đồng.</div>}
      <div className="text-[12.5px] font-semibold">1. Lịch hết hạn hợp đồng khách thuê (doanh thu/tháng có nguy cơ mất)</div>
      <T head={['Quý hết hạn', 'Số HĐ', 'Doanh thu/tháng']} align={['l', 'r', 'r']} rows={byQ.map(x => [x.q, x.n, fmtVND(x.v)])} />
      <T
        head={['Mã HĐ', 'Khách', 'Phòng', 'Bắt đầu', 'Kết thúc', 'Doanh thu/tháng', 'Cọc', 'Trạng thái']}
        align={['l', 'l', 'l', 'l', 'l', 'r', 'r', 'l']}
        rows={list.map(x => [x.t.contract_code || '—', x.t.name, x.t.room_id ? roomOf.get(x.t.room_id)?.code || '—' : '—', fmtDate(x.t.contract_start), fmtDate(x.t.contract_end), fmtVND(x.monthly), x.t.deposit_amount ? fmtMoney(x.t.deposit_amount, x.t.deposit_currency || 'VND') : '—', <ContractBadge c={x.c} />])}
      />
      <div className="text-[12px]">Tổng tiền cọc đang giữ: <b>{fmtVND(depVND)}</b>{depUSD > 0 && <> + <b>{fmtUSD(depUSD)}</b></>}</div>
      <div className="text-[12.5px] font-semibold">2. Hợp đồng đầu vào — mốc thay đổi giá 24 tháng tới</div>
      <T head={['Tháng', 'Nội dung']} align={['l', 'l']} rows={inbound.map(x => [monthLabel(x.m), x.text])} />
      {!inbound.length && <div className="text-[12px] text-gray-400">Không có mốc tăng giá trong 24 tháng tới.</div>}
    </div>
  );
  const csv = () => {
    const r: Row[] = [['Mã HĐ', 'Khách', 'Phòng', 'Bắt đầu', 'Kết thúc', 'Quý hết hạn', 'Doanh thu/tháng', 'Cọc', 'Tiền tệ cọc']];
    list.forEach(x => r.push([x.t.contract_code || '', x.t.name, x.t.room_id ? roomOf.get(x.t.room_id)?.code || '' : '', fmtDate(x.t.contract_start), fmtDate(x.t.contract_end), x.q, Math.round(x.monthly), Number(x.t.deposit_amount) || 0, x.t.deposit_currency || 'VND']));
    downloadText(`orient_hop_dong_${stamp()}.csv`, toCsv(r), 'text/csv;charset=utf-8');
  };
  return (
    <div className="space-y-3">
      <Toolbar onCsv={csv} onPrint={() => print(body)} />
      <Card>{body}</Card>
      {portal}
    </div>
  );
}

// ═══ 5. Dòng tiền dự báo ══════════════════════════════════════════════════
function ForecastReport() {
  const { calc, rows, currentMonth } = useOffice();
  const { print, portal } = usePrint();
  const proj = useMemo(() => buildProjection({
    data: calc, currentMonth, from: currentMonth, count: 12,
    tenants: rows.bds_tenants.map(t => ({ id: t.id, name: t.name, active: t.active, contract_start: t.contract_start, contract_end: t.contract_end })),
  }), [calc, currentMonth, rows.bds_tenants]);
  let cum = 0;
  const tableRows = proj.months.map(x => {
    cum += x.profit;
    return [monthLabel(x.month), fmtTr(x.revenue), fmtTr(x.mbt + x.ts4), fmtTr(x.opex), fmtTr(x.forecast), fmtTr(x.cost), pnl(x.profit, 'tr'), pnl(cum, 'tr'), x.notes.join(' · ') || ''];
  });
  const tot = sumResults(proj.months);
  const body = (
    <div className="space-y-3">
      <ReportHeader title="Dòng tiền dự báo 12 tháng" period={`${monthLabel(proj.months[0].month)} – ${monthLabel(proj.months[11].month)} · triệu VNĐ`} />
      <T head={['Tháng', 'Doanh thu', 'Chi phí thuê', 'Vận hành', 'Dự kiến PS', 'Tổng CP', 'Lời / lỗ', 'Lũy kế', 'Ghi chú']} rows={tableRows}
        align={['l', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'l']}
        foot={['Cộng 12 tháng', fmtTr(tot.revenue), fmtTr(tot.mbt + tot.ts4), fmtTr(tot.opex), fmtTr(tot.forecast), fmtTr(tot.cost), pnl(tot.profit, 'tr'), '', '']} />
      <div className="text-[11.5px] text-gray-500 leading-relaxed">
        <b>Giả định:</b> tháng đã nhập doanh thu dùng số thực tế{proj.lastActual ? ` (đến ${monthLabel(proj.lastActual)})` : ''}; các tháng sau giữ tiền thuê gần nhất của từng khách đang thuê và dừng sau tháng hết hợp đồng;
        phụ phí điện/xe & chi phí vận hành lấy trung bình 3 tháng gần nhất; chi phí thuê đầu vào tính đúng theo mốc tăng giá;
        khoản dự kiến phát sinh {calc.settings.includeForecastInCost ? 'đã cộng' : 'chưa cộng'} vào tổng chi phí (đổi ở Cài đặt).
      </div>
    </div>
  );
  const csv = () => {
    const r: Row[] = [['Tháng', 'Doanh thu', 'Chi phí thuê', 'Vận hành', 'Dự kiến PS', 'Tổng CP', 'Lời/lỗ', 'Loại', 'Ghi chú']];
    proj.months.forEach(x => r.push([monthLabel(x.month), Math.round(x.revenue), Math.round(x.mbt + x.ts4), Math.round(x.opex), Math.round(x.forecast), Math.round(x.cost), Math.round(x.profit), x.projected ? 'Dự báo' : 'Thực tế', x.notes.join('; ')]));
    downloadText(`orient_du_bao_${stamp()}.csv`, toCsv(r), 'text/csv;charset=utf-8');
  };
  return (
    <div className="space-y-3">
      <Toolbar onCsv={csv} onPrint={() => print(body)} />
      <Card pad={false}><div className="p-3 md:p-4">{body}</div></Card>
      {portal}
    </div>
  );
}

export default function Reports({ tab }: { tab: ReportTab }) {
  if (tab === 'nam') return <YearReport />;
  if (tab === 'cong-no') return <ReceivablesReport />;
  if (tab === 'hop-dong') return <ContractsReport />;
  if (tab === 'du-bao') return <ForecastReport />;
  return <MonthReport />;
}
