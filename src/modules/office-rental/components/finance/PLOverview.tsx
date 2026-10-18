import { useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import {
  BarController, BarElement, CategoryScale, Chart as ChartJS, Legend, LinearScale, LineController, LineElement,
  PointElement, Tooltip, type ChartData, type ChartOptions,
} from 'chart.js';
import { Chart } from 'react-chartjs-2';
import { useOffice } from '../../data/OfficeDataProvider';
import { computeMonth, hasRevenue, monthStatus, sumResults } from '../../lib/calc/pl';
import { monthLabel } from '../../lib/calc/months';
import { fmtTr, fmtUSD, fmtVND } from '../../lib/calc/money';
import type { MonthKey, MonthStatus } from '../../lib/calc/types';
import { buildPLCsv, downloadText, stamp } from '../../lib/download';
import { Badge, Card, Kpi, MonthSelect, Toggle, cls, pnlTone, signed } from '../ui';

ChartJS.register(CategoryScale, LinearScale, BarElement, BarController, LineElement, LineController, PointElement, Tooltip, Legend);

// Bảng màu đã kiểm (dataviz validator): lời/lỗ = cặp phân kỳ xanh dương ↔ đỏ; 2 đường = aqua & cam (nét đứt)
const C_PROFIT = '#2a78d6';
const C_LOSS = '#e34948';
const C_REV = '#1baf7a';
const C_COST = '#eb6834';

const STATUS: Record<MonthStatus, { label: string; tone: 'green' | 'blue' | 'amber' }> = {
  actual: { label: 'Thực tế', tone: 'green' },
  future: { label: 'Dự kiến', tone: 'blue' },
  missing: { label: 'Thiếu DT', tone: 'amber' },
};

export default function PLOverview() {
  const { calc, months, currentMonth, settings, patch } = useOffice();
  const [kpiMonth, setKpiMonth] = useState<MonthKey>(() => (months.includes(currentMonth) ? currentMonth : months[0]));
  const month = months.includes(kpiMonth) ? kpiMonth : months[0];
  const rate = calc.settings.exchangeRate || 1;
  const hide = settings.hide_empty_months;

  const all = useMemo(() => months.map(m => computeMonth(calc, m)), [calc, months]);
  const visible = useMemo(() => all.filter(r => !hide || hasRevenue(calc, r.month)), [all, hide, calc]);
  const tot = sumResults(visible);
  const k = computeMonth(calc, month);

  const increases = useMemo(() => {
    const out: string[] = [];
    for (const l of calc.headLeases) for (const i of l.increases) out.push(`${monthLabel(i.month)}: ${l.name} +${i.percent}%`);
    return out;
  }, [calc.headLeases]);

  const chartData: ChartData<'bar' | 'line', number[], string> = {
    labels: visible.map(r => monthLabel(r.month)),
    datasets: [
      {
        type: 'bar', label: 'Lợi nhuận', order: 3,
        data: visible.map(r => r.profit / 1e6),
        backgroundColor: visible.map(r => (r.profit >= 0 ? C_PROFIT : C_LOSS)),
        borderRadius: 4, maxBarThickness: 28,
      },
      {
        type: 'line', label: 'Doanh thu', order: 1, data: visible.map(r => r.revenue / 1e6),
        borderColor: C_REV, backgroundColor: C_REV, borderWidth: 2, pointRadius: 3, pointHoverRadius: 5, tension: 0.3,
      },
      {
        type: 'line', label: 'Tổng chi phí', order: 2, data: visible.map(r => r.cost / 1e6),
        borderColor: C_COST, backgroundColor: C_COST, borderWidth: 2, pointRadius: 3, pointHoverRadius: 5, tension: 0.3, borderDash: [5, 4],
      },
    ],
  };
  const chartOptions: ChartOptions<'bar' | 'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 }, color: '#52514e' } },
      tooltip: {
        callbacks: {
          label: c => {
            const v = Number(c.parsed.y) || 0;
            const tag = c.dataset.label === 'Lợi nhuận' ? (v >= 0 ? ' (lời)' : ' (lỗ)') : '';
            return `${c.dataset.label}${tag}: ${v.toLocaleString('en-US', { maximumFractionDigits: 1 })} tr`;
          },
        },
      },
    },
    scales: {
      x: { grid: { display: false }, ticks: { font: { size: 11 }, color: '#888' } },
      y: { grid: { color: '#F1F0EA' }, ticks: { font: { size: 11 }, color: '#888', callback: v => `${v} tr` } },
    },
  };

  let cum = 0;
  return (
    <div className="space-y-3 md:space-y-4">
      <div className="flex flex-wrap items-end gap-3 justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-[12px] text-gray-500 flex items-center gap-2">
            Xem KPI tháng <MonthSelect months={months} value={month} onChange={setKpiMonth} />
          </label>
          <Toggle
            checked={hide}
            onChange={v => patch('bds_settings', '1', { hide_empty_months: v }, true)}
            label="Chỉ hiện tháng đã nhập doanh thu"
          />
        </div>
        <button className={`${cls.btn} ${cls.secondary}`} onClick={() => downloadText(`orient_pl_bao_cao_${stamp()}.csv`, buildPLCsv(calc, months), 'text/csv;charset=utf-8')}>
          <Download size={13} /> Xuất CSV báo cáo
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-2 md:gap-3">
        <Kpi label="Doanh thu (thuê + phụ phí)" value={fmtVND(k.revenue)} sub={`≈ ${fmtUSD(Math.round(k.revenue / rate))}`} accent="#1baf7a" />
        <Kpi label="Thuê MBT + TS4" value={fmtVND(k.mbt + k.ts4)} sub={`MBT ${fmtTr(k.mbt)} tr · TS4 ${fmtTr(k.ts4)} tr`} accent="#6250d6" />
        <Kpi label="Chi phí vận hành" value={fmtVND(k.opex)} sub={`≈ ${fmtUSD(Math.round(k.opex / rate))}`} accent="#eda100" />
        <Kpi
          label={`Lợi nhuận ${k.profit >= 0 ? '(lời)' : '(lỗ)'}`} tone={pnlTone(k.profit)}
          value={signed(fmtVND(k.profit), k.profit)}
          sub={k.revenue > 0 ? `Biên ${(k.margin * 100).toFixed(1)}%` : 'Chưa có doanh thu'}
          accent={k.profit >= 0 ? C_PROFIT : C_LOSS}
        />
        <Kpi
          label="Dự kiến phát sinh" tone="purple" value={fmtVND(k.forecast)}
          sub={settings.include_forecast_in_cost ? 'đã cộng vào chi phí' : 'chỉ tham khảo, chưa cộng'}
          accent="#8b5cf6"
        />
      </div>

      <Card
        title="Biểu đồ Lời/Lỗ theo tháng"
        desc={<>Cột = lợi nhuận (xanh = lời, đỏ = lỗ) · Đường = doanh thu &amp; tổng chi phí (triệu VNĐ){increases.length > 0 && <> · <b>Mốc tăng giá:</b> {increases.join(' · ')}</>}</>}
      >
        {visible.length ? (
          <div className="h-[260px] md:h-[300px]"><Chart type="bar" data={chartData} options={chartOptions} /></div>
        ) : (
          <div className="text-center py-10 text-[12.5px] text-gray-400">Chưa có tháng nào có doanh thu. Tắt công tắc lọc hoặc nhập doanh thu ở tab "Doanh thu khách hàng".</div>
        )}
      </Card>

      <Card
        pad={false}
        title="Bảng chi tiết Lời/Lỗ"
        desc={<>Đơn vị: triệu VNĐ, đã gồm VAT + phụ phí · Cột "Dự kiến PS" {settings.include_forecast_in_cost ? <b className="text-violet-600">đã được cộng</b> : <b>chưa</b>} vào Tổng CP</>}
        actions={<div className="text-[12px] text-gray-500">Lũy kế lợi nhuận: <b className={tot.profit >= 0 ? 'text-emerald-600' : 'text-red-600'}>{signed(fmtVND(tot.profit), tot.profit)}</b> <span className="text-gray-400">≈ {fmtUSD(Math.round(tot.profit / rate))}</span></div>}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead className="bg-gray-50/70">
              <tr>
                <th className={`${cls.th} text-left sticky left-0 bg-gray-50`}>Tháng</th>
                <th className={`${cls.th} text-left`}>Trạng thái</th>
                <th className={`${cls.th} text-right`}>Doanh thu</th>
                <th className={`${cls.th} text-right`}>Thuê MBT</th>
                <th className={`${cls.th} text-right`}>Thuê TS4</th>
                <th className={`${cls.th} text-right`}>Vận hành</th>
                <th className={`${cls.th} text-right`}>Dự kiến PS</th>
                <th className={`${cls.th} text-right`}>Tổng CP</th>
                <th className={`${cls.th} text-right`}>Lợi nhuận</th>
                <th className={`${cls.th} text-right`}>Biên</th>
                <th className={`${cls.th} text-right`}>Lũy kế</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(r => {
                const st = STATUS[monthStatus(calc, r.month, currentMonth)];
                cum += r.profit;
                const now = r.month === currentMonth;
                return (
                  <tr key={r.month} className={`border-t border-gray-100 ${now ? 'bg-amber-50/60' : ''}`}>
                    <td className={`${cls.td} font-semibold sticky left-0 ${now ? 'bg-amber-50' : 'bg-white'}`}>{monthLabel(r.month)}</td>
                    <td className={cls.td}><Badge tone={st.tone}>{st.label}</Badge></td>
                    <td className={`${cls.td} ${cls.num}`}>{fmtTr(r.revenue)}</td>
                    <td className={`${cls.td} ${cls.num} text-violet-700`}>{fmtTr(r.mbt)}</td>
                    <td className={`${cls.td} ${cls.num} text-teal-700`}>{fmtTr(r.ts4)}</td>
                    <td className={`${cls.td} ${cls.num} text-amber-700`}>{fmtTr(r.opex)}</td>
                    <td className={`${cls.td} ${cls.num} text-violet-500`}>{r.forecast > 0 ? fmtTr(r.forecast) : '—'}</td>
                    <td className={`${cls.td} ${cls.num}`}>{fmtTr(r.cost)}</td>
                    <td className={`${cls.td} ${cls.num} font-semibold ${r.profit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{signed(fmtTr(r.profit), r.profit)}</td>
                    <td className={`${cls.td} ${cls.num} text-gray-500`}>{r.revenue > 0 ? `${(r.margin * 100).toFixed(1)}%` : '—'}</td>
                    <td className={`${cls.td} ${cls.num} ${cum >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{signed(fmtTr(cum), cum)}</td>
                  </tr>
                );
              })}
              {!visible.length && (
                <tr><td colSpan={11} className="text-center text-gray-400 py-6">Chưa có tháng nào có doanh thu. Tắt công tắc lọc hoặc nhập doanh thu.</td></tr>
              )}
            </tbody>
            {visible.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-gray-200 bg-gray-50 font-semibold">
                  <td className={`${cls.td} sticky left-0 bg-gray-50`} colSpan={2}>TỔNG ({visible.length} tháng)</td>
                  <td className={`${cls.td} ${cls.num}`}>{fmtTr(tot.revenue)}</td>
                  <td className={`${cls.td} ${cls.num}`}>{fmtTr(tot.mbt)}</td>
                  <td className={`${cls.td} ${cls.num}`}>{fmtTr(tot.ts4)}</td>
                  <td className={`${cls.td} ${cls.num}`}>{fmtTr(tot.opex)}</td>
                  <td className={`${cls.td} ${cls.num} text-violet-500`}>{fmtTr(tot.forecast)}</td>
                  <td className={`${cls.td} ${cls.num}`}>{fmtTr(tot.cost)}</td>
                  <td className={`${cls.td} ${cls.num} ${tot.profit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{signed(fmtTr(tot.profit), tot.profit)}</td>
                  <td className={`${cls.td} ${cls.num} text-gray-500`}>{tot.revenue > 0 ? `${(tot.margin * 100).toFixed(1)}%` : '—'}</td>
                  <td className={cls.td} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </Card>
    </div>
  );
}
