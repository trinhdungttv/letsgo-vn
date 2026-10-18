import { useMemo, useState } from 'react';
import { useOffice } from '../../data/OfficeDataProvider';
import { sortTenants } from '../../data/selectors';
import { hasRevenue, tenantMonth, unitPL } from '../../lib/calc/pl';
import { monthLabel } from '../../lib/calc/months';
import { fmtTr, fmtVND } from '../../lib/calc/money';
import type { MonthKey } from '../../lib/calc/types';
import { Banner, Card, Kpi, MonthSelect, cls, pnlTone, signed } from '../ui';

// Màn tổng hợp bãi xe — dẫn xuất hoàn toàn từ phụ phí xe (bds_tenant_fees) + head lease bãi xe, không có bảng riêng.
export default function Parking() {
  const { rows, calc, months, currentMonth, settings } = useOffice();
  const [sel, setSel] = useState<MonthKey>(() => (months.includes(currentMonth) ? currentMonth : months[0]));
  const month = months.includes(sel) ? sel : months[0];
  const parkingLeases = calc.headLeases.filter(l => l.isParking);
  const bucket = unitPL(calc, month).buckets.find(b => b.kind === 'parking');
  const ctOf = new Map(calc.tenants.map(t => [t.id, t]));
  const perTenant = sortTenants(rows.bds_tenants)
    .map(t => ({ t, f: calc.fees[month]?.[t.id], amount: tenantMonth(calc, month, ctOf.get(t.id)!).parking }))
    .filter(x => x.t.active || (x.f && (x.f.moto || x.f.car)));
  const moto = perTenant.reduce((a, x) => a + (x.f?.moto || 0), 0);
  const car = perTenant.reduce((a, x) => a + (x.f?.car || 0), 0);
  const revenue = bucket?.revenue || 0;
  const cost = bucket?.cost || 0;

  const history = useMemo(() => months
    .filter(m => !settings.hide_empty_months || hasRevenue(calc, m))
    .map(m => {
      const b = unitPL(calc, m).buckets.find(x => x.kind === 'parking');
      let mo = 0; let ca = 0;
      for (const t of calc.tenants) { const f = calc.fees[m]?.[t.id]; mo += f?.moto || 0; ca += f?.car || 0; }
      return { m, moto: mo, car: ca, revenue: b?.revenue || 0, cost: b?.cost || 0, profit: (b?.revenue || 0) - (b?.cost || 0) };
    }), [months, calc, settings.hide_empty_months]);

  return (
    <div className="space-y-3 md:space-y-4">
      {!parkingLeases.length && <Banner tone="amber">Chưa có khoản thuê nào được đánh dấu "bãi giữ xe" — vào Lời/Lỗ → Chi phí thuê, tick "Đây là bãi giữ xe" cho khoản Bãi giữ xe (TS4).</Banner>}
      <div className="flex flex-wrap items-center gap-2 text-[12px] text-gray-500">
        Tháng <MonthSelect months={months} value={month} onChange={setSel} />
        <span className="text-gray-400">Giá thu lại: xe máy {fmtVND(settings.parking_price_moto)} · ô tô {fmtVND(settings.parking_price_car)} /xe/tháng · số xe nhập ở <a className="text-blue-600 hover:underline" href="#/office-pl/doanh-thu">Doanh thu → Phụ phí</a></span>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 md:gap-3">
        <Kpi label="Tổng xe đang gửi" value={`${moto + car} xe`} sub={`Xe máy ${moto} · Ô tô ${car}`} />
        <Kpi label={`Doanh thu bãi xe ${monthLabel(month)}`} value={fmtVND(revenue)} sub={`VAT điện/xe ${calc.settings.vatRateUtil}% theo cấu hình từng khách`} />
        <Kpi label="Chi phí thuê bãi (TS4)" value={fmtVND(cost)} sub={parkingLeases.map(l => l.name).join(', ') || '—'} />
        <Kpi label={revenue - cost >= 0 ? 'Bãi xe lời' : 'Bãi xe lỗ'} tone={pnlTone(revenue - cost)} value={signed(fmtVND(revenue - cost), revenue - cost)} sub={cost > revenue && settings.parking_price_moto > 0 ? `Cần thêm ~${Math.ceil((cost - revenue) / settings.parking_price_moto)} xe máy để hòa vốn` : undefined} />
      </div>

      <Card pad={false} title="Xe theo khách thuê" desc={`Tháng ${monthLabel(month)}`}>
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead className="bg-gray-50/70">
              <tr>
                <th className={`${cls.th} text-left`}>Khách thuê</th>
                <th className={`${cls.th} text-right`}>Xe máy</th>
                <th className={`${cls.th} text-right`}>Ô tô</th>
                <th className={`${cls.th} text-right`}>Tổng thẻ</th>
                <th className={`${cls.th} text-right`}>Phí / tháng (đã gồm VAT)</th>
              </tr>
            </thead>
            <tbody>
              {perTenant.map(x => (
                <tr key={x.t.id} className="border-t border-gray-100">
                  <td className={cls.td}>{x.t.name}</td>
                  <td className={`${cls.td} ${cls.num}`}>{x.f?.moto || 0}</td>
                  <td className={`${cls.td} ${cls.num}`}>{x.f?.car || 0}</td>
                  <td className={`${cls.td} ${cls.num}`}>{(x.f?.moto || 0) + (x.f?.car || 0)}</td>
                  <td className={`${cls.td} ${cls.num}`}>{fmtVND(x.amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-200 bg-gray-50 font-semibold">
                <td className={cls.td}>TỔNG CỘNG</td>
                <td className={`${cls.td} ${cls.num}`}>{moto}</td>
                <td className={`${cls.td} ${cls.num}`}>{car}</td>
                <td className={`${cls.td} ${cls.num}`}>{moto + car}</td>
                <td className={`${cls.td} ${cls.num}`}>{fmtVND(revenue)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      <Card pad={false} title="Lời/lỗ bãi xe qua các tháng" desc="Đơn vị: triệu VNĐ">
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead className="bg-gray-50/70">
              <tr>
                <th className={`${cls.th} text-left`}>Tháng</th>
                <th className={`${cls.th} text-right`}>Xe máy</th>
                <th className={`${cls.th} text-right`}>Ô tô</th>
                <th className={`${cls.th} text-right`}>Doanh thu</th>
                <th className={`${cls.th} text-right`}>Chi phí TS4</th>
                <th className={`${cls.th} text-right`}>Lời / lỗ</th>
              </tr>
            </thead>
            <tbody>
              {history.map(h => (
                <tr key={h.m} className={`border-t border-gray-100 ${h.m === currentMonth ? 'bg-amber-50/60' : ''}`}>
                  <td className={`${cls.td} font-semibold`}>{monthLabel(h.m)}</td>
                  <td className={`${cls.td} ${cls.num}`}>{h.moto}</td>
                  <td className={`${cls.td} ${cls.num}`}>{h.car}</td>
                  <td className={`${cls.td} ${cls.num}`}>{fmtTr(h.revenue)}</td>
                  <td className={`${cls.td} ${cls.num}`}>{fmtTr(h.cost)}</td>
                  <td className={`${cls.td} ${cls.num} font-semibold ${h.profit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{signed(fmtTr(h.profit), h.profit)}</td>
                </tr>
              ))}
              {!history.length && <tr><td colSpan={6} className="text-center text-gray-400 py-6">Chưa có tháng nào có doanh thu.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
