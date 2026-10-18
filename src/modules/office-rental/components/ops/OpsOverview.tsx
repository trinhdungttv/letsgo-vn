import { useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, Info } from 'lucide-react';
import { useOffice } from '../../data/OfficeDataProvider';
import { sortTenants } from '../../data/selectors';
import { computeMonth } from '../../lib/calc/pl';
import { monthLabel, monthToDate } from '../../lib/calc/months';
import { fmtTr, fmtUSD, fmtVND } from '../../lib/calc/money';
import type { MonthKey } from '../../lib/calc/types';
import { buildAlerts, invoiceBreakdown, invoiceState, occupancy, todayStr, type OpsAlert } from '../../lib/ops';
import { Banner, Card, Kpi, MonthSelect, cls, pnlTone, signed } from '../ui';
import { InvoiceStateBadge } from './shared';

const TARGET_HASH: Record<OpsAlert['target'], string> = {
  contracts: '#/office-rooms/hop-dong',
  invoices: '#/office-billing/hoa-don',
  rooms: '#/office-rooms/phong',
  revenue: '#/office-pl/doanh-thu',
  tickets: '#/office-tickets',
};

export default function OpsOverview() {
  const { rows, calc, months, currentMonth, settings, opsReady } = useOffice();
  const [sel, setSel] = useState<MonthKey>(() => (months.includes(currentMonth) ? currentMonth : months[0]));
  const month = months.includes(sel) ? sel : months[0];
  const today = todayStr();
  const k = computeMonth(calc, month);
  const prev = months.indexOf(month) > 0 ? computeMonth(calc, months[months.indexOf(month) - 1]) : null;
  const rate = calc.settings.exchangeRate || 1;
  const occ = occupancy(rows.bds_rooms, rows.bds_tenants);

  const alerts = useMemo(() => buildAlerts({
    tenants: rows.bds_tenants, rooms: rows.bds_rooms, invoices: rows.bds_invoices,
    openTickets: rows.bds_tickets.filter(t => t.status === 'open' || t.status === 'in_progress').length,
    today, alertDays: settings.alert_days ?? 60, exchangeRate: rate, opsReady,
  }), [rows, today, settings.alert_days, rate, opsReady]);

  const roomOf = new Map(rows.bds_rooms.map(r => [r.id, r]));
  const invOf = new Map(rows.bds_invoices.filter(i => i.month === monthToDate(month)).map(i => [i.tenant_id, i]));
  const calcTenant = new Map(calc.tenants.map(t => [t.id, t]));
  const billing = sortTenants(rows.bds_tenants)
    .map(t => ({ t, b: invoiceBreakdown(calc, month, calcTenant.get(t.id)!) }))
    .filter(x => x.t.active || !x.b.isEmpty);
  const collected = billing.reduce((a, x) => {
    const inv = invOf.get(x.t.id);
    return a + (inv?.status === 'paid' ? (inv.paid_amount ?? x.b.total) : 0);
  }, 0);

  const delta = (cur: number, p: number | undefined) => {
    if (p === undefined || !p) return null;
    const d = (cur - p) / Math.abs(p) * 100;
    return `${d >= 0 ? '↑' : '↓'} ${Math.abs(d).toFixed(1)}% so với ${monthLabel(months[months.indexOf(month) - 1])}`;
  };

  return (
    <div className="space-y-3 md:space-y-4">
      {!opsReady && (
        <Banner tone="amber">Cảnh báo hợp đồng, hoá đơn, phòng trống cần chạy migration <code>165_bds_office_rental_ops.sql</code>. Phần lời/lỗ bên dưới vẫn dùng được.</Banner>
      )}

      {alerts.length > 0 ? (
        <div className={`rounded-xl border p-3 ${alerts[0].tone === 'red' ? 'border-red-200 bg-gradient-to-r from-red-50 to-amber-50' : alerts[0].tone === 'amber' ? 'border-amber-200 bg-amber-50' : 'border-blue-200 bg-blue-50'}`}>
          <div className={`flex items-center gap-2 text-[13px] font-semibold mb-2 ${alerts[0].tone === 'red' ? 'text-red-800' : alerts[0].tone === 'amber' ? 'text-amber-900' : 'text-blue-900'}`}>
            <AlertTriangle size={15} /> {alerts.length} việc cần xử lý
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
            {alerts.map(a => (
              <a key={a.key} href={TARGET_HASH[a.target]} className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12px] bg-white/70 hover:bg-white border ${a.tone === 'red' ? 'border-red-200 text-red-800' : a.tone === 'amber' ? 'border-amber-200 text-amber-900' : 'border-blue-200 text-blue-800'}`}>
                {a.tone === 'blue' ? <Info size={13} className="shrink-0" /> : <AlertTriangle size={13} className="shrink-0" />}
                <span className="flex-1">{a.text}</span>
                <ArrowRight size={12} className="shrink-0 opacity-50" />
              </a>
            ))}
          </div>
        </div>
      ) : (
        <Banner tone="green">✓ Không có việc gì cần xử lý gấp.</Banner>
      )}

      <div className="flex items-center gap-2 text-[12px] text-gray-500">Dữ liệu tháng <MonthSelect months={months} value={month} onChange={setSel} /></div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 md:gap-3">
        <Kpi label={`Doanh thu ${monthLabel(month)}`} value={`${fmtTr(k.revenue)} tr`} sub={<>≈ {fmtUSD(Math.round(k.revenue / rate))}{opsReady && <> · Đã thu {fmtTr(collected)} tr</>}<br />{delta(k.revenue, prev?.revenue)}</>} accent="#1baf7a" />
        <Kpi label="Tổng chi phí" value={`${fmtTr(k.cost)} tr`} sub={<>Thuê {fmtTr(k.mbt + k.ts4)} tr · Vận hành {fmtTr(k.opex)} tr<br />{delta(k.cost, prev?.cost)}</>} accent="#eb6834" />
        <Kpi label={k.profit >= 0 ? 'Lợi nhuận (lời)' : 'Lợi nhuận (lỗ)'} tone={pnlTone(k.profit)} value={`${signed(fmtTr(k.profit), k.profit)} tr`} sub={k.revenue > 0 ? `Biên ${(k.margin * 100).toFixed(1)}%` : 'Chưa có doanh thu'} accent={k.profit >= 0 ? '#2a78d6' : '#e34948'} />
        <Kpi
          label="Tỷ lệ lấp đầy"
          value={occ.rate === null ? '—' : `${Math.round(occ.rate * 100)}%`}
          sub={occ.rate === null ? 'Khai báo phòng ở "Phòng & Hợp đồng"' : `${occ.occupied.toLocaleString('en-US')}/${occ.total.toLocaleString('en-US')} m² có khách`}
          accent="#6250d6"
        />
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
