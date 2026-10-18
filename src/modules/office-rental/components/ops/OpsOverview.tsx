import { useMemo, useState } from 'react';
import {
  ArrowRight, BarChart3, CalendarDays, CheckCircle2, FileBarChart, Lightbulb, PenLine, Receipt, Wrench, Zap,
} from 'lucide-react';
import { useOffice } from '../../data/OfficeDataProvider';
import { sortTenants } from '../../data/selectors';
import { useInsights, useOfficeEvents, useReceivables, useReferenceMonth } from '../../data/useSmart';
import { computeMonth } from '../../lib/calc/pl';
import { addMonths, monthLabel, monthToDate } from '../../lib/calc/months';
import { fmtTr, fmtUSD, fmtVND } from '../../lib/calc/money';
import type { MonthKey } from '../../lib/calc/types';
import { groupByMonth } from '../../lib/events';
import { invoiceBreakdown, invoiceState, occupancy } from '../../lib/ops';
import EventItem, { SEV_STYLE, whenLabel } from '../EventItem';
import { Banner, Card, Kpi, MonthSelect, cls, pnlTone, signed } from '../ui';
import { InvoiceStateBadge } from './shared';

const WEEKDAY = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];

const QUICK = [
  { label: 'Nhập doanh thu', href: '#/office-pl/doanh-thu', icon: <PenLine size={13} /> },
  { label: 'Chốt chỉ số điện', href: '#/office-billing/chi-so-dien', icon: <Zap size={13} /> },
  { label: 'Lập thông báo TT', href: '#/office-billing/hoa-don', icon: <Receipt size={13} /> },
  { label: 'Báo sự cố', href: '#/office-tickets', icon: <Wrench size={13} /> },
  { label: 'Dashboard', href: '#/office-dashboard', icon: <BarChart3 size={13} /> },
  { label: 'Báo cáo tháng', href: '#/office-reports/thang', icon: <FileBarChart size={13} /> },
];

const TONE_DOT = { bad: 'bg-red-500', warn: 'bg-amber-400', good: 'bg-emerald-500', info: 'bg-blue-400' } as const;

export default function OpsOverview() {
  const { rows, calc, months, settings, opsReady } = useOffice();
  const ref = useReferenceMonth();
  const [sel, setSel] = useState<MonthKey | null>(null);
  const month = sel && months.includes(sel) ? sel : ref;
  const { visible, today } = useOfficeEvents();
  const insights = useInsights();
  const receivable = useReceivables();
  const k = computeMonth(calc, month);
  const prevK = computeMonth(calc, addMonths(month, -1));
  const rate = calc.settings.exchangeRate || 1;
  const occ = occupancy(rows.bds_rooms, rows.bds_tenants);

  const urgent = visible.filter(e => e.severity !== 'info');
  const timeline = useMemo(() => groupByMonth(visible.filter(e => e.date && e.kind !== 'ticket' && (e.daysLeft ?? 0) >= 0)), [visible]);
  const nCrit = urgent.filter(e => e.severity === 'critical').length;
  const d = new Date();

  const roomOf = new Map(rows.bds_rooms.map(r => [r.id, r]));
  const invOf = new Map(rows.bds_invoices.filter(i => i.month === monthToDate(month)).map(i => [i.tenant_id, i]));
  const ctOf = new Map(calc.tenants.map(t => [t.id, t]));
  const billing = sortTenants(rows.bds_tenants)
    .map(t => ({ t, b: invoiceBreakdown(calc, month, ctOf.get(t.id)!) }))
    .filter(x => x.t.active || !x.b.isEmpty);
  const collected = billing.reduce((a, x) => {
    const inv = invOf.get(x.t.id);
    return a + (inv?.status === 'paid' ? (inv.paid_amount ?? x.b.total) : 0);
  }, 0);
  const delta = (cur: number, p: number) => (p ? `${cur >= p ? '↑' : '↓'} ${Math.abs((cur - p) / Math.abs(p) * 100).toFixed(1)}% so với ${monthLabel(addMonths(month, -1))}` : null);

  return (
    <div className="space-y-3 md:space-y-4">
      {/* Lời chào + tóm tắt */}
      <div className="rounded-xl bg-gradient-to-r from-[#0c2340] to-[#1d4e89] text-white p-4 md:p-5">
        <div className="text-[12px] text-white/60">{WEEKDAY[d.getDay()]}, {today.split('-').reverse().join('/')}</div>
        <div className="text-[17px] md:text-[19px] font-semibold mt-0.5">
          {nCrit ? `${nCrit} việc khẩn cần xử lý hôm nay` : urgent.length ? `${urgent.length} việc cần chú ý` : 'Mọi thứ đang ổn ✓'}
        </div>
        <div className="flex flex-wrap gap-1.5 mt-2.5">
          {(['critical', 'warning', 'info'] as const).map(s => {
            const n = visible.filter(e => e.severity === s).length;
            return <span key={s} className="text-[11px] px-2 py-0.5 rounded-full bg-white/10">{SEV_STYLE[s].label}: <b>{n}</b></span>;
          })}
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-white/10">Nhắc trước {settings.alert_days ?? 90} ngày</span>
        </div>
        <div className="flex gap-1.5 mt-3 overflow-x-auto no-scrollbar">
          {QUICK.map(q => (
            <a key={q.href} href={q.href} className="shrink-0 whitespace-nowrap inline-flex items-center gap-1.5 text-[12px] px-2.5 py-1.5 rounded-lg bg-white text-[#0c2340] font-medium hover:bg-blue-50">
              {q.icon}{q.label}
            </a>
          ))}
        </div>
      </div>

      {!opsReady && <Banner tone="amber">Nhắc hợp đồng, hoá đơn, phòng trống cần chạy migration <code>165</code>. Phần tài chính vẫn dùng được.</Banner>}

      <div className="flex items-center gap-2 text-[12px] text-gray-500">Số liệu tháng <MonthSelect months={months} value={month} onChange={setSel} /></div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 md:gap-3">
        <Kpi label={`Doanh thu ${monthLabel(month)}`} value={`${fmtTr(k.revenue)} tr`} sub={<>≈ {fmtUSD(Math.round(k.revenue / rate))}{delta(k.revenue, prevK.revenue) && <><br />{delta(k.revenue, prevK.revenue)}</>}</>} accent="#1baf7a" />
        <Kpi label={k.profit >= 0 ? 'Lợi nhuận (lời)' : 'Lợi nhuận (lỗ)'} tone={pnlTone(k.profit)} value={`${signed(fmtTr(k.profit), k.profit)} tr`} sub={k.revenue > 0 ? `Biên ${(k.margin * 100).toFixed(1)}% · chi phí ${fmtTr(k.cost)} tr` : `Chi phí ${fmtTr(k.cost)} tr`} accent={k.profit >= 0 ? '#2a78d6' : '#e34948'} />
        <Kpi label="Tỷ lệ lấp đầy" value={occ.rate === null ? '—' : `${Math.round(occ.rate * 100)}%`} sub={occ.rate === null ? 'Khai báo phòng để theo dõi' : `${occ.occupied.toLocaleString('en-US')}/${occ.total.toLocaleString('en-US')} m²`} accent="#6250d6" />
        <Kpi label="Còn phải thu" tone={receivable.overdue > 0 ? 'neg' : 'default'} value={`${fmtTr(receivable.total)} tr`} sub={receivable.overdue > 0 ? `Quá hạn ${fmtVND(receivable.overdue)}` : `${receivable.count} thông báo chưa thu`} accent="#eb6834" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 md:gap-4 items-start">
        <Card className="lg:col-span-2" title={<>Cần xử lý <span className="text-[11px] font-normal text-gray-400">({urgent.length})</span></>} desc="Bấm 'Đã xử lý' khi xong, hoặc 'Nhắc lại sau' để tạm ẩn">
          <div className="space-y-2">
            {urgent.map(e => <EventItem key={e.key} e={e} />)}
            {!urgent.length && <div className="flex items-center gap-2 text-[12.5px] text-emerald-700 py-4 justify-center"><CheckCircle2 size={16} /> Không có việc gấp</div>}
          </div>
        </Card>

        <div className="space-y-3 md:space-y-4">
          <Card title={<><CalendarDays size={14} /> Lịch sắp tới</>} desc={`Các mốc trong ${settings.alert_days ?? 90} ngày tới`}>
            <div className="space-y-3">
              {timeline.map(g => (
                <div key={g.month}>
                  <div className="text-[10.5px] font-semibold uppercase tracking-wide text-gray-400 mb-1">{monthLabel(g.month)}</div>
                  <div className="space-y-1">
                    {g.events.map(e => (
                      <a key={e.key} href={e.href} className="flex items-start gap-2 rounded-lg px-1.5 py-1 hover:bg-gray-50">
                        <span className="w-10 shrink-0 text-center rounded-md border border-gray-200 bg-white leading-tight py-0.5">
                          <span className="block text-[13px] font-semibold text-[#111]">{e.date!.slice(8, 10)}</span>
                          <span className="block text-[9px] text-gray-400">th {Number(e.date!.slice(5, 7))}</span>
                        </span>
                        <span className="min-w-0">
                          <span className="block text-[12px] text-[#111] leading-snug">{e.title}</span>
                          <span className={`inline-block text-[10px] font-semibold px-1.5 rounded mt-0.5 ${SEV_STYLE[e.severity].chip}`}>{whenLabel(e)}</span>
                        </span>
                      </a>
                    ))}
                  </div>
                </div>
              ))}
              {!timeline.length && <div className="text-[12px] text-gray-400 py-3 text-center">Không có mốc nào sắp tới. Nhập ngày hết hạn hợp đồng để được nhắc.</div>}
            </div>
          </Card>

          <Card title={<><Lightbulb size={14} /> Nhận định nhanh</>} actions={<a href="#/office-dashboard" className="text-[11.5px] text-blue-600 hover:underline inline-flex items-center gap-0.5">Dashboard <ArrowRight size={12} /></a>}>
            <ul className="space-y-1.5">
              {insights.slice(0, 5).map(i => (
                <li key={i.key} className="flex gap-2 text-[12px] text-gray-700 leading-snug">
                  <span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${TONE_DOT[i.tone]}`} />
                  {i.href ? <a href={i.href} className="hover:text-blue-700">{i.text}</a> : <span>{i.text}</span>}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>

      <Card pad={false} title={`Tình trạng thu tiền ${monthLabel(month)}`} desc="Số tiền tính trực tiếp từ tiền thuê + điện + xe đã nhập (đã gồm VAT).">
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead className="bg-gray-50/70">
              <tr>
                <th className={`${cls.th} text-left`}>Phòng</th>
                <th className={`${cls.th} text-left`}>Khách thuê</th>
                <th className={`${cls.th} text-right`}>Tiền thuê</th>
                <th className={`${cls.th} text-right`}>Điện</th>
                <th className={`${cls.th} text-right`}>Bãi xe</th>
                <th className={`${cls.th} text-right`}>Tổng phải thu</th>
                {opsReady && <th className={`${cls.th} text-left`}>Trạng thái</th>}
              </tr>
            </thead>
            <tbody>
              {billing.map(({ t, b }) => {
                const room = t.room_id ? roomOf.get(t.room_id) : undefined;
                return (
                  <tr key={t.id} className="border-t border-gray-100">
                    <td className={cls.td}>{room ? <b>{room.code}</b> : <span className="text-gray-300">—</span>}</td>
                    <td className={cls.td}>{t.name}</td>
                    <td className={`${cls.td} ${cls.num}`}>
                      {t.currency === 'USD' && b.rentInput > 0 && <span className="text-gray-400 mr-1">{fmtUSD(b.rentInput)} ·</span>}
                      {fmtVND(b.rent.gross)}
                    </td>
                    <td className={`${cls.td} ${cls.num}`}>{fmtVND(b.electricity.gross)}</td>
                    <td className={`${cls.td} ${cls.num}`}>{b.moto + b.car > 0 && <span className="text-gray-400 mr-1">{b.moto + b.car} xe ·</span>}{fmtVND(b.parking.gross)}</td>
                    <td className={`${cls.td} ${cls.num} font-semibold`}>{fmtVND(b.total)}</td>
                    {opsReady && <td className={cls.td}><InvoiceStateBadge st={invoiceState(invOf.get(t.id), today)} paidAt={invOf.get(t.id)?.paid_at} /></td>}
                  </tr>
                );
              })}
              {!billing.length && <tr><td colSpan={7} className="text-center text-gray-400 py-6">Chưa có khách thuê.</td></tr>}
            </tbody>
            {billing.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-gray-200 bg-gray-50 font-semibold">
                  <td className={cls.td} colSpan={5}>Tổng</td>
                  <td className={`${cls.td} ${cls.num}`}>{fmtVND(k.revenue)}</td>
                  {opsReady && <td className={`${cls.td} text-[11px] text-gray-500`}>Đã thu {fmtVND(collected)}</td>}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </Card>
    </div>
  );
}
