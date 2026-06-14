import { useEffect, useMemo, useState } from 'react';
import { Bar } from 'react-chartjs-2';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip } from 'chart.js';
import PageHeader from '../components/PageHeader';
import type { Client, LaborHistoryEntry, ProjectPnl } from '../lib/types';
import { getMonthLast, recentMonths, formatCurrency } from '../lib/format';
import { supabase } from '../lib/supabase';

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip);

interface ReportsProps {
  clients: Client[];
  laborHistory: Record<string, LaborHistoryEntry[]>;
}

function currentMonthStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function Reports({ clients, laborHistory }: ReportsProps) {
  const totalWorkers = clients.reduce((s, c) => s + (c.current_workers || 0), 0);
  const months = useMemo(() => recentMonths(3), []);

  // P&L dự án tháng hiện tại — nguồn số liệu thực cho doanh thu (giống Dashboard)
  const [projectsPnl, setProjectsPnl] = useState<ProjectPnl[]>([]);
  useEffect(() => {
    supabase.from('projects_pnl').select('*').eq('month', currentMonthStr()).then(({ data }) => {
      setProjectsPnl((data || []) as ProjectPnl[]);
    });
  }, []);

  const pnlByClient = useMemo(() => {
    const map: Record<string, ProjectPnl[]> = {};
    for (const p of projectsPnl) {
      if (!map[p.client_id]) map[p.client_id] = [];
      map[p.client_id].push(p);
    }
    return map;
  }, [projectsPnl]);

  const revenueOf = (clientId: string) => (pnlByClient[clientId] || []).reduce((s, p) => s + (p.revenue || 0), 0);
  const totalRevenue = clients.reduce((s, c) => s + revenueOf(c.id), 0);

  const regionMap: Record<string, { clients: number; workers: number; revenue: number }> = {};
  for (const c of clients) {
    const r = c.region || 'Khác';
    if (!regionMap[r]) regionMap[r] = { clients: 0, workers: 0, revenue: 0 };
    regionMap[r].clients++;
    regionMap[r].workers += c.current_workers || 0;
    regionMap[r].revenue += revenueOf(c.id);
  }
  const regions = Object.entries(regionMap).sort((a, b) => b[1].workers - a[1].workers);

  const sorted = [...clients].sort((a, b) => (b.current_workers || 0) - (a.current_workers || 0));

  return (
    <>
      <PageHeader title="Báo cáo lao động" subtitle="Tổng hợp LĐ theo dự án & khu vực" />
      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {/* Summary KPI */}
        <div className="grid grid-cols-3 gap-2.5">
          <div className="bg-white border border-[#E8E7E2] rounded-lg p-3.5">
            <div className="text-[11.5px] text-[#888] mb-1">Tổng lao động hiện tại</div>
            <div className="text-[24px] font-bold text-[#1D4ED8]">{totalWorkers.toLocaleString()}</div>
            <div className="text-[11px] text-emerald-600 mt-0.5">Cập nhật tuần T6W1</div>
          </div>
          <div className="bg-white border border-[#E8E7E2] rounded-lg p-3.5">
            <div className="text-[11.5px] text-[#888] mb-1">Số khách hàng</div>
            <div className="text-[24px] font-bold text-[#111]">{clients.length}</div>
            <div className="text-[11px] text-[#aaa] mt-0.5">{Object.keys(regionMap).length} khu vực</div>
          </div>
          <div className="bg-white border border-[#E8E7E2] rounded-lg p-3.5">
            <div className="text-[11.5px] text-[#888] mb-1">Doanh thu tháng (P&L Dự án)</div>
            <div className="text-[24px] font-bold text-[#111]">{formatCurrency(totalRevenue)}</div>
            <div className="text-[11px] text-[#aaa] mt-0.5">Tổng doanh thu từ P&L Dự án tháng hiện tại</div>
          </div>
        </div>

        {/* Bar chart: workers by client */}
        <div className="bg-white border border-[#E8E7E2] rounded-[10px] overflow-hidden">
          <div className="px-4 py-2.5 border-b border-[#E8E7E2] text-[12.5px] font-semibold text-[#111]">Lao động theo dự án (tuần hiện tại)</div>
          <div className="p-4" style={{ height: 220 }}>
            <Bar
              data={{
                labels: sorted.map(c => c.name.length > 14 ? c.name.substring(0, 14) + '…' : c.name),
                datasets: [{
                  data: sorted.map(c => c.current_workers || 0),
                  backgroundColor: sorted.map(c => c.status === 'danger' ? '#FCA5A5' : c.status === 'warn' ? '#FCD34D' : '#93C5FD'),
                  borderRadius: 4, barPercentage: 0.7,
                }]
              }}
              options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false } }, y: { beginAtZero: true, ticks: { callback: v => Number(v).toLocaleString() } } } }}
            />
          </div>
        </div>

        {/* By region breakdown */}
        <div className="bg-white border border-[#E8E7E2] rounded-[10px] overflow-hidden">
          <div className="px-4 py-2.5 border-b border-[#E8E7E2] text-[12.5px] font-semibold text-[#111]">Tổng hợp theo khu vực</div>
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead><tr className="border-b border-[#E8E7E2]">
                {['Khu vực', 'Số KH', 'Tổng LĐ', 'TB/KH', 'Tỷ trọng', 'Doanh thu (P&L)'].map(h => (
                  <th key={h} className="text-left px-3 py-2 text-[11.5px] text-[#888] font-medium bg-[#F9F9F7] whitespace-nowrap">{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {regions.map(([region, data]) => (
                  <tr key={region} className="border-b border-[#F0EEE9] last:border-0">
                    <td className="px-3 py-2 font-semibold">{region}</td>
                    <td className="px-3 py-2">{data.clients}</td>
                    <td className="px-3 py-2 font-semibold text-[#1D4ED8]">{data.workers.toLocaleString()}</td>
                    <td className="px-3 py-2">{data.clients > 0 ? Math.round(data.workers / data.clients).toLocaleString() : '—'}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <div className="w-[80px] h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full bg-blue-400 rounded-full" style={{ width: `${totalWorkers > 0 ? (data.workers / totalWorkers) * 100 : 0}%` }} />
                        </div>
                        <span className="text-[11.5px] text-[#888]">{totalWorkers > 0 ? ((data.workers / totalWorkers) * 100).toFixed(1) : 0}%</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-emerald-600">{formatCurrency(data.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Per-client detail table */}
        <div className="bg-white border border-[#E8E7E2] rounded-[10px] overflow-hidden">
          <div className="px-4 py-2.5 border-b border-[#E8E7E2] text-[12.5px] font-semibold text-[#111]">Chi tiết từng dự án — biến động {months[0].label}→{months[1].label}→{months[2].label}</div>
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead><tr className="border-b border-[#E8E7E2]">
                {['Dự án','Khu vực','Quản lý',`${months[0].label} (cuối)`,`${months[1].label} (cuối)`,`${months[2].label} (hiện tại)`,`${months[1].label}→${months[2].label}`].map(h => (
                  <th key={h} className="text-left px-3 py-2 text-[11.5px] text-[#888] font-medium bg-[#F9F9F7] whitespace-nowrap">{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {sorted.map(c => {
                  const hist = laborHistory[c.id] || [];
                  const t4 = getMonthLast(hist, months[0].month);
                  const t5 = getMonthLast(hist, months[1].month);
                  const t6 = getMonthLast(hist, months[2].month);
                  const delta = t5 !== null && t6 !== null ? t6 - t5 : null;
                  return (
                    <tr key={c.id} className="border-b border-[#F0EEE9] last:border-0">
                      <td className="px-3 py-2 font-semibold">{c.name}</td>
                      <td className="px-3 py-2 text-[#555]">{c.region}</td>
                      <td className="px-3 py-2 text-[#555]">{c.manager}</td>
                      <td className="px-3 py-2">{t4 !== null ? t4.toLocaleString() : '—'}</td>
                      <td className="px-3 py-2">{t5 !== null ? t5.toLocaleString() : '—'}</td>
                      <td className="px-3 py-2 font-semibold text-[#1D4ED8]">{t6 !== null ? t6.toLocaleString() : '—'}</td>
                      <td className="px-3 py-2">
                        {delta !== null ? (
                          <span className={`font-medium ${delta > 0 ? 'text-emerald-600' : delta < 0 ? 'text-red-600' : 'text-[#888]'}`}>
                            {delta > 0 ? '+' : ''}{delta}
                          </span>
                        ) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
