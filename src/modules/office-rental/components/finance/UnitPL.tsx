import { useMemo, useState } from 'react';
import { AlertTriangle, Car, CheckCircle2 } from 'lucide-react';
import { useOffice } from '../../data/OfficeDataProvider';
import { LANDLORD_SHORT, sortLeases } from '../../data/selectors';
import { hasRevenue, unitPL, type UnitBucket } from '../../lib/calc/pl';
import { monthLabel } from '../../lib/calc/months';
import { fmtTr, fmtVND } from '../../lib/calc/money';
import type { MonthKey } from '../../lib/calc/types';
import { Badge, Banner, Card, MonthSelect, cls, signed } from '../ui';

function BucketCard({ b }: { b: UnitBucket }) {
  const pos = b.profit >= 0;
  return (
    <div className={`bg-white rounded-xl border p-3 md:p-4 ${b.kind === 'unassigned' ? 'border-amber-300' : 'border-[#E8E7E2]'}`}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="text-[13px] font-semibold text-[#111] flex items-center gap-1.5 min-w-0">
          {b.kind === 'parking' && <Car size={14} className="text-gray-400 shrink-0" />}
          {b.kind === 'unassigned' && <AlertTriangle size={14} className="text-amber-500 shrink-0" />}
          <span className="truncate">{b.name}</span>
        </div>
        {b.landlord && <Badge tone={b.landlord === 'mbt' ? 'purple' : 'teal'}>{LANDLORD_SHORT[b.landlord]}</Badge>}
      </div>
      <div className="space-y-1 text-[12px]">
        <div className="flex justify-between"><span className="text-gray-500">Doanh thu {b.kind === 'parking' ? '(phí xe mọi khách)' : '(thuê + điện)'}</span><span className="tabular-nums">{fmtVND(b.revenue)}</span></div>
        <div className="flex justify-between"><span className="text-gray-500">Chi phí thuê</span><span className="tabular-nums">{fmtVND(b.cost)}</span></div>
        <div className="flex justify-between border-t border-gray-100 pt-1 font-semibold">
          <span>{pos ? 'Lời' : 'Lỗ'}</span>
          <span className={`tabular-nums ${pos ? 'text-emerald-600' : 'text-red-600'}`}>{signed(fmtVND(b.profit), b.profit)}</span>
        </div>
      </div>
      {b.tenants.length > 0 && (
        <div className="mt-2 pt-2 border-t border-dashed border-gray-200 space-y-0.5">
          {b.tenants.map(t => (
            <div key={t.tenantId} className="flex justify-between text-[11px] text-gray-500 gap-2">
              <span className="truncate">{t.name}</span><span className="tabular-nums shrink-0">{fmtVND(t.revenue)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function UnitPL() {
  const { calc, months, currentMonth, rows, settings, patch } = useOffice();
  const [sel, setSel] = useState<MonthKey>(() => (months.includes(currentMonth) ? currentMonth : months[0]));
  const month = months.includes(sel) ? sel : months[0];
  const r = useMemo(() => unitPL(calc, month), [calc, month]);
  const leases = sortLeases(rows.bds_head_leases);

  const tableMonths = useMemo(
    () => months.filter(m => !settings.hide_empty_months || hasRevenue(calc, m)),
    [months, settings.hide_empty_months, calc],
  );
  const table = useMemo(() => tableMonths.map(m => unitPL(calc, m)), [calc, tableMonths]);
  const columns = useMemo(() => {
    const keys = new Map<string, string>();
    for (const t of table) for (const b of t.buckets) if (!keys.has(b.key)) keys.set(b.key, b.name);
    return [...keys.entries()];
  }, [table]);
  const anyForecastCol = settings.include_forecast_in_cost;

  return (
    <div className="space-y-3 md:space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-[12px] text-gray-500 flex items-center gap-2">
          Tháng <MonthSelect months={months} value={month} onChange={setSel} />
        </label>
        <span className="text-[11.5px] text-gray-400">Chi phí vận hành là chi phí chung — không phân bổ cho mặt bằng nào.</span>
      </div>

      {r.unassignedTenants.length > 0 && (
        <Banner tone="amber">
          <div className="font-semibold mb-1">⚠ {r.unassignedTenants.length} khách chưa gán mặt bằng — doanh thu của họ đang nằm ở thẻ "Chưa gán mặt bằng".</div>
          <div className="flex flex-col gap-1.5">
            {r.unassignedTenants.map(t => (
              <div key={t.id} className="flex flex-wrap items-center gap-2">
                <span className="min-w-[120px] font-medium">{t.name}</span>
                <select
                  className={cls.inputSm} value=""
                  onChange={e => { if (e.target.value) patch('bds_tenants', t.id, { head_lease_id: e.target.value }, true); }}
                >
                  <option value="">— Gán vào mặt bằng —</option>
                  {leases.map(l => <option key={l.id} value={l.id}>{LANDLORD_SHORT[l.landlord]} · {l.name}</option>)}
                </select>
              </div>
            ))}
          </div>
        </Banner>
      )}

      {r.buckets.length ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2 md:gap-3">
          {r.buckets.map(b => <BucketCard key={b.key} b={b} />)}
        </div>
      ) : (
        <Card><div className="text-center text-[12.5px] text-gray-400 py-4">Chưa có khoản thuê đầu vào nào. Thêm ở tab "Chi phí thuê".</div></Card>
      )}

      <div className={`rounded-xl border px-3 py-2.5 text-[12px] flex flex-wrap items-center gap-x-2 gap-y-1 ${r.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : 'bg-red-50 border-red-200 text-red-900'}`}>
        {r.ok ? <CheckCircle2 size={15} className="text-emerald-600" /> : <AlertTriangle size={15} className="text-red-600" />}
        <span className="font-semibold">Đối chiếu {monthLabel(month)}:</span>
        <span className="tabular-nums">Σ lời/lỗ các mặt bằng {fmtVND(r.bucketProfit)}</span>
        <span className="tabular-nums">− vận hành {fmtVND(r.opex)}</span>
        {r.forecastInCost && <span className="tabular-nums">− dự kiến {fmtVND(r.forecast)}</span>}
        <span className="tabular-nums">= <b>{fmtVND(r.reconciledProfit)}</b></span>
        <span className="tabular-nums">· Lợi nhuận Tổng quan <b>{fmtVND(r.dashboardProfit)}</b></span>
        <span className="font-semibold">{r.ok ? '✓ Khớp' : `⚠ Lệch ${fmtVND(r.diff)}`}</span>
      </div>

      <Card pad={false} title="Lời/lỗ theo mặt bằng qua các tháng" desc="Đơn vị: triệu VNĐ. Cột cuối = lợi nhuận toàn hệ thống (khớp tab Tổng quan).">
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead className="bg-gray-50/70">
              <tr>
                <th className={`${cls.th} text-left sticky left-0 bg-gray-50`}>Tháng</th>
                {columns.map(([k, name]) => <th key={k} className={`${cls.th} text-right`}>{name}</th>)}
                <th className={`${cls.th} text-right`}>Vận hành</th>
                {anyForecastCol && <th className={`${cls.th} text-right`}>Dự kiến</th>}
                <th className={`${cls.th} text-right`}>Lợi nhuận</th>
                <th className={`${cls.th} text-center`}>Đối chiếu</th>
              </tr>
            </thead>
            <tbody>
              {table.map(t => (
                <tr key={t.month} className={`border-t border-gray-100 ${t.month === currentMonth ? 'bg-amber-50/60' : ''}`}>
                  <td className={`${cls.td} font-semibold sticky left-0 bg-white`}>{monthLabel(t.month)}</td>
                  {columns.map(([k]) => {
                    const b = t.buckets.find(x => x.key === k);
                    const v = b?.profit ?? 0;
                    return <td key={k} className={`${cls.td} ${cls.num} ${v >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>{b ? signed(fmtTr(v), v) : '—'}</td>;
                  })}
                  <td className={`${cls.td} ${cls.num} text-amber-700`}>−{fmtTr(t.opex)}</td>
                  {anyForecastCol && <td className={`${cls.td} ${cls.num} text-violet-600`}>{t.forecast ? `−${fmtTr(t.forecast)}` : '—'}</td>}
                  <td className={`${cls.td} ${cls.num} font-semibold ${t.dashboardProfit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{signed(fmtTr(t.dashboardProfit), t.dashboardProfit)}</td>
                  <td className={`${cls.td} text-center`}>{t.ok ? '✓' : '⚠️'}</td>
                </tr>
              ))}
              {!table.length && <tr><td colSpan={columns.length + 4} className="text-center text-gray-400 py-6">Chưa có tháng nào có doanh thu.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
