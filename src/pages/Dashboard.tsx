import { useState, useMemo, useEffect } from 'react';
import AlertsTasksPanel from '../components/AlertsTasksPanel';
import { Bar, Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, PointElement, LineElement,
  BarElement, Tooltip, Filler, Legend,
} from 'chart.js';
import {
  AlertCircle, TrendingUp, Users, BarChart2, Target,
  ChevronDown, X, Phone, Mail,
} from 'lucide-react';
import type { Client, ProjectPnl } from '../lib/types';
import { statusPill, formatCurrency, formatDate } from '../lib/format';
import { supabase } from '../lib/supabase';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Tooltip, Filler, Legend);

// Draws a dashed horizontal target line + label across the chart area
const targetLinePlugin = {
  id: 'targetLine',
  afterDraw(chart: ChartJS) {
    const target = (chart.options?.plugins as Record<string, { value?: number }> | undefined)?.targetLine?.value;
    if (target == null) return;
    const { ctx, chartArea, scales } = chart;
    const y = scales.y.getPixelForValue(target);
    if (y < chartArea.top || y > chartArea.bottom) return;
    ctx.save();
    ctx.strokeStyle = '#F59E0B';
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(chartArea.left, y);
    ctx.lineTo(chartArea.right, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#D97706';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(Number(target).toLocaleString('vi-VN'), chartArea.right - 4, y - 4);
    ctx.restore();
  },
};
ChartJS.register(targetLinePlugin);

interface DashboardProps {
  clients: Client[];
  onOpenBranch?: (region: string) => void;
  onOpenClient?: (id: string) => void;
  onOpenPipelineEntry?: (crmId: string) => void;
}

type ScopeMode = 'all' | 'region' | 'manager';
type GroupMode = 'region' | 'manager';

interface GroupRow {
  key: string;
  count: number;
  workers: number;
  revenue: number;
  costs: number;
  profit: number;
}

function currentMonthStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function Dashboard({ clients, onOpenBranch, onOpenClient, onOpenPipelineEntry }: DashboardProps) {
  const [scopeMode, setScopeMode] = useState<ScopeMode>('all');
  const [selectedScope, setSelectedScope] = useState<string>('');
  const [groupMode, setGroupMode] = useState<GroupMode>('region');
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);

  const today = new Date().toLocaleDateString('vi-VN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  // Unique regions & managers
  const regions = useMemo(() => [...new Set(clients.map(c => c.region).filter(Boolean) as string[])].sort(), [clients]);
  const managers = useMemo(() => [...new Set(clients.map(c => c.manager).filter(Boolean) as string[])].sort(), [clients]);

  // Filtered clients based on global scope
  const filteredClients = useMemo(() => {
    if (scopeMode === 'all' || !selectedScope) return clients;
    if (scopeMode === 'region') return clients.filter(c => c.region === selectedScope);
    return clients.filter(c => c.manager === selectedScope);
  }, [clients, scopeMode, selectedScope]);

  // P&L dự án tháng hiện tại — nguồn số liệu thực cho doanh thu/lợi nhuận trên Dashboard
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

  const totalWorkers = filteredClients.reduce((s, c) => s + (c.current_workers || 0), 0);
  const totalRevenue = filteredClients.reduce((s, c) => s + (pnlByClient[c.id] || []).reduce((t, p) => t + (p.revenue || 0), 0), 0);
  const paid = filteredClients.filter(c => c.paid_this_month).length;
  const danger = filteredClients.filter(c => c.status === 'danger').length;
  const warn = filteredClients.filter(c => c.status === 'warn').length;

  // Groups for bar chart & table — doanh thu & lợi nhuận lấy từ P&L dự án (projects_pnl)
  const groups = useMemo((): GroupRow[] => {
    const map: Record<string, GroupRow> = {};
    for (const c of filteredClients) {
      const key = (groupMode === 'region' ? c.region : c.manager) || 'Khác';
      if (!map[key]) map[key] = { key, count: 0, workers: 0, revenue: 0, costs: 0, profit: 0 };
      const w = c.current_workers || 0;
      const projects = pnlByClient[c.id] || [];
      const rev = projects.reduce((s, p) => s + (p.revenue || 0), 0);
      const profit = projects.reduce((s, p) => {
        if (p.project_type === 'shared') return s + (p.revenue || 0) * (p.cn_pct || 0) / 100;
        return s;
      }, 0);
      map[key].count++;
      map[key].workers += w;
      map[key].revenue += rev;
      map[key].costs += rev - profit;
      map[key].profit += profit;
    }
    return Object.values(map).sort((a, b) => b.workers - a.workers);
  }, [filteredClients, groupMode, pnlByClient]);

  const trendData = [2420, 2510, 2590, 2670, 2790, totalWorkers || 2847];

  // Labor targets per scope ('total' or a region/branch name)
  const [targets, setTargets] = useState<Record<string, number>>({});
  const [editingTarget, setEditingTarget] = useState(false);
  const [targetInput, setTargetInput] = useState('');

  useEffect(() => {
    supabase.from('dashboard_targets').select('scope, target_value').then(({ data }) => {
      if (!data) return;
      const map: Record<string, number> = {};
      for (const row of data) map[row.scope] = Number(row.target_value);
      setTargets(map);
    });
  }, []);

  const targetScopeKey = scopeMode === 'region' && selectedScope ? selectedScope : 'total';
  const targetScopeLabel = targetScopeKey === 'total' ? 'Tổng' : targetScopeKey;
  const targetValue = targets[targetScopeKey];

  const startEditTarget = () => {
    setTargetInput(targetValue != null ? String(targetValue) : '');
    setEditingTarget(true);
  };

  const saveTarget = async () => {
    const val = parseFloat(targetInput);
    if (!Number.isFinite(val) || val <= 0) {
      // Empty/invalid input clears the target for this scope
      await supabase.from('dashboard_targets').delete().eq('scope', targetScopeKey);
      setTargets(prev => { const next = { ...prev }; delete next[targetScopeKey]; return next; });
      setEditingTarget(false);
      return;
    }
    await supabase.from('dashboard_targets').upsert({ scope: targetScopeKey, target_value: val, updated_at: new Date().toISOString() }, { onConflict: 'scope' });
    setTargets(prev => ({ ...prev, [targetScopeKey]: val }));
    setEditingTarget(false);
  };

  // Bar chart data
  const barLabels = groups.map(g => g.key.length > 12 ? g.key.slice(0, 12) + '…' : g.key);
  const workerBarData = {
    labels: barLabels,
    datasets: [{
      label: 'Lao động',
      data: groups.map(g => g.workers),
      backgroundColor: 'rgba(59,130,246,0.75)',
      borderRadius: 4,
    }],
  };
  const revenueBarData = {
    labels: barLabels,
    datasets: [{
      label: 'Doanh thu',
      data: groups.map(g => g.revenue),
      backgroundColor: 'rgba(16,185,129,0.75)',
      borderRadius: 4,
    }],
  };

  const barOpts = (isCurrency: boolean) => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { grid: { display: false }, ticks: { font: { size: 10 } } },
      y: {
        grid: { color: '#f3f4f6' },
        ticks: {
          font: { size: 10 },
          callback: (v: number | string) => isCurrency ? formatCurrency(Number(v)) : Number(v).toLocaleString(),
        },
      },
    },
  });

  // Payment cycle data — days 1–31, mark each client's payment window
  const paymentDays = Array.from({ length: 31 }, (_, i) => i + 1);
  const paymentByDay = useMemo(() => {
    const counts = new Array(31).fill(0);
    for (const c of filteredClients) {
      const start = c.payment_start ?? 1;
      const end = c.payment_end ?? 5;
      for (let d = start; d <= Math.min(end, 31); d++) counts[d - 1]++;
    }
    return counts;
  }, [filteredClients]);

  const scopeOptions = scopeMode === 'region' ? regions : scopeMode === 'manager' ? managers : [];

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 bg-white border-b border-[#E8E7E2] shrink-0">
        <div>
          <div className="text-[14px] font-semibold text-[#111]">Dashboard</div>
          <div className="text-[11.5px] text-[#888] mt-0.5">{today}</div>
        </div>

        {/* Global Filter */}
        <div className="flex items-center gap-2">
          <span className="text-[11.5px] text-[#888] font-medium">Bộ lọc:</span>
          {(['all', 'region', 'manager'] as ScopeMode[]).map(m => (
            <button
              key={m}
              onClick={() => { setScopeMode(m); setSelectedScope(''); }}
              className={`px-3 py-1.5 rounded-lg text-[11.5px] font-medium border transition ${
                scopeMode === m
                  ? 'bg-blue-600 border-blue-600 text-white'
                  : 'bg-white border-gray-300 text-gray-600 hover:border-blue-400'
              }`}
            >
              {m === 'all' ? 'Toàn bộ' : m === 'region' ? 'Khu vực' : 'Quản lý'}
            </button>
          ))}
          {scopeMode !== 'all' && (
            <div className="relative">
              <select
                value={selectedScope}
                onChange={e => setSelectedScope(e.target.value)}
                className="appearance-none pl-3 pr-8 py-1.5 rounded-lg border border-gray-300 text-[11.5px] text-gray-700 bg-white focus:outline-none focus:border-blue-500 cursor-pointer"
              >
                <option value="">-- Chọn {scopeMode === 'region' ? 'khu vực' : 'quản lý'} --</option>
                {scopeOptions.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
              <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {/* KPI Cards */}
        <div className="grid grid-cols-4 gap-2.5">
          <div className="bg-white border border-[#E8E7E2] rounded-lg p-3.5">
            <div className="flex items-center justify-between mb-1">
              <div className="text-[11.5px] text-[#888]">Tổng khách hàng</div>
              <Users size={14} className="text-[#ccc]" />
            </div>
            <div className="text-[22px] font-bold text-[#111]">{filteredClients.length}</div>
            <div className="text-[11px] text-[#aaa] mt-0.5">Đang HĐ: {filteredClients.filter(c => c.status !== 'danger').length}</div>
          </div>
          <div className="bg-white border border-[#E8E7E2] rounded-lg p-3.5">
            <div className="flex items-center justify-between mb-1">
              <div className="text-[11.5px] text-[#888]">Tổng lao động</div>
              <TrendingUp size={14} className="text-blue-400" />
            </div>
            <div className="text-[22px] font-bold text-[#1D4ED8]">{totalWorkers.toLocaleString()}</div>
            <div className="text-[11px] text-emerald-600 mt-0.5">+2.8% so tháng trước</div>
          </div>
          <div className="bg-white border border-[#E8E7E2] rounded-lg p-3.5">
            <div className="flex items-center justify-between mb-1">
              <div className="text-[11.5px] text-[#888]">Doanh thu ước T6</div>
              <BarChart2 size={14} className="text-[#ccc]" />
            </div>
            <div className="text-[22px] font-bold text-[#111]">{formatCurrency(totalRevenue)}</div>
            <div className="text-[11px] text-[#aaa] mt-0.5">Đã TT: {paid}/{filteredClients.length} KH</div>
          </div>
          <div className="bg-white border border-[#E8E7E2] rounded-lg p-3.5">
            <div className="flex items-center justify-between mb-1">
              <div className="text-[11.5px] text-[#888]">HĐ cần xử lý</div>
              <AlertCircle size={14} className={danger + warn > 0 ? 'text-red-400' : 'text-[#ccc]'} />
            </div>
            <div className="text-[22px] font-bold" style={{ color: danger + warn > 0 ? '#DC2626' : '#059669' }}>{danger + warn}</div>
            <div className="text-[11px] text-[#aaa] mt-0.5">{danger} khẩn cấp · {warn} sắp hết</div>
          </div>
        </div>

        {/* Trend + Alerts */}
        <div className="grid grid-cols-5 gap-2.5">
          <div className="col-span-2 bg-white border border-[#E8E7E2] rounded-lg overflow-hidden">
            <div className="px-4 py-2.5 border-b border-[#E8E7E2] flex items-center gap-1.5 flex-wrap">
              <TrendingUp size={13} className="text-blue-500" />
              <span className="text-[12.5px] font-semibold text-[#111]">Xu hướng lao động T1–T6</span>
              <div className="ml-auto flex items-center gap-1.5">
                {editingTarget ? (
                  <>
                    <span className="text-[11px] text-[#888]">Mục tiêu ({targetScopeLabel}):</span>
                    <input
                      type="number"
                      autoFocus
                      value={targetInput}
                      onChange={e => setTargetInput(e.target.value)}
                      onBlur={saveTarget}
                      onKeyDown={e => { if (e.key === 'Enter') saveTarget(); if (e.key === 'Escape') setEditingTarget(false); }}
                      placeholder="VD: 3000"
                      className="w-20 text-[11px] px-1.5 py-0.5 rounded border border-amber-300 outline-none focus:border-amber-500"
                    />
                  </>
                ) : (
                  <button
                    onClick={startEditTarget}
                    title={targetValue != null ? `Mục tiêu (${targetScopeLabel}): ${targetValue.toLocaleString('vi-VN')}` : `Đặt mục tiêu (${targetScopeLabel})`}
                    className={`p-1 rounded hover:bg-amber-50 transition ${targetValue != null ? 'text-amber-500' : 'text-[#ccc] hover:text-amber-500'}`}
                  >
                    <Target size={14} />
                  </button>
                )}
              </div>
            </div>
            <div className="p-3" style={{ height: 168 }}>
              <Line
                data={{ labels: ['T1','T2','T3','T4','T5','T6'], datasets: [{ data: trendData, borderColor: '#3B82F6', backgroundColor: 'rgba(59,130,246,.08)', fill: true, tension: 0.45, cubicInterpolationMode: 'monotone', borderWidth: 2, pointRadius: 3 }] }}
                options={{
                  responsive: true, maintainAspectRatio: false,
                  plugins: {
                    legend: { display: false },
                    ...({ targetLine: { value: targetValue } } as any),
                  },
                  scales: {
                    x: { grid: { display: false } },
                    y: (() => {
                      const vals = targetValue != null ? [...trendData, targetValue] : trendData;
                      const min = Math.floor(Math.min(...vals) * 0.95 / 10) * 10;
                      const max = Math.ceil(Math.max(...vals) * 1.05 / 10) * 10;
                      return { min, max, ticks: { callback: (v: any) => Number(v).toLocaleString() } };
                    })(),
                  },
                }}
              />
            </div>
          </div>

          {/* Alerts + Tasks */}
          <div className="col-span-3">
            <AlertsTasksPanel
              clients={filteredClients}
              regionFilter={scopeMode === 'region' ? selectedScope : null}
              onSelectClient={setSelectedClient}
              onOpenClient={onOpenClient}
              onOpenPipelineEntry={onOpenPipelineEntry}
            />
          </div>
        </div>

        {/* Labor & Revenue Bar Charts */}
        <div className="grid grid-cols-2 gap-2.5">
          <div className="bg-white border border-[#E8E7E2] rounded-lg overflow-hidden">
            <div className="px-4 py-2.5 border-b border-[#E8E7E2] flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Users size={13} className="text-blue-500" />
                <span className="text-[12.5px] font-semibold text-[#111]">Lao động theo {groupMode === 'region' ? 'khu vực' : 'quản lý'}</span>
              </div>
              <div className="flex gap-1">
                {(['region', 'manager'] as GroupMode[]).map(m => (
                  <button key={m} onClick={() => setGroupMode(m)}
                    className={`px-2 py-0.5 rounded text-[10.5px] font-medium border transition ${groupMode === m ? 'bg-blue-100 border-blue-400 text-blue-700' : 'bg-white border-gray-200 text-gray-500 hover:border-blue-300'}`}>
                    {m === 'region' ? 'KV' : 'QL'}
                  </button>
                ))}
              </div>
            </div>
            <div className="p-3" style={{ height: 180 }}>
              {groups.length ? (
                <Bar data={workerBarData} options={barOpts(false) as any} />
              ) : (
                <div className="flex items-center justify-center h-full text-[12px] text-gray-400">Không có dữ liệu</div>
              )}
            </div>
          </div>

          <div className="bg-white border border-[#E8E7E2] rounded-lg overflow-hidden">
            <div className="px-4 py-2.5 border-b border-[#E8E7E2] flex items-center gap-1.5">
              <BarChart2 size={13} className="text-emerald-500" />
              <span className="text-[12.5px] font-semibold text-[#111]">Doanh thu theo {groupMode === 'region' ? 'khu vực' : 'quản lý'}</span>
            </div>
            <div className="p-3" style={{ height: 180 }}>
              {groups.length ? (
                <Bar data={revenueBarData} options={barOpts(true) as any} />
              ) : (
                <div className="flex items-center justify-center h-full text-[12px] text-gray-400">Không có dữ liệu</div>
              )}
            </div>
          </div>
        </div>

        {/* Summary Table */}
        <div className="bg-white border border-[#E8E7E2] rounded-[10px] overflow-hidden">
          <div className="px-4 py-2.5 border-b border-[#E8E7E2] flex items-center justify-between">
            <span className="text-[12.5px] font-semibold text-[#111]">Báo cáo tổng hợp</span>
            <div className="flex gap-1">
              {(['region', 'manager'] as GroupMode[]).map(m => (
                <button key={m} onClick={() => setGroupMode(m)}
                  className={`px-3 py-1 rounded-lg text-[11.5px] font-medium border transition ${groupMode === m ? 'bg-blue-100 border-blue-500 text-blue-700' : 'bg-white border-gray-300 text-gray-500 hover:border-blue-400'}`}>
                  {m === 'region' ? 'Theo khu vực' : 'Theo quản lý'}
                </button>
              ))}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-[#E8E7E2]">
                  {[groupMode === 'region' ? 'Khu vực' : 'Quản lý','Số KH','Tổng LĐ','Doanh thu','Chi phí','Lợi nhuận','Margin'].map(h => (
                    <th key={h} className="text-left px-3 py-2 text-[11.5px] text-[#888] font-medium bg-[#F9F9F7] whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {groups.map(g => (
                  <tr
                    key={g.key}
                    onClick={groupMode === 'region' && onOpenBranch ? () => onOpenBranch(g.key) : undefined}
                    className={`border-b border-[#F0EEE9] last:border-0 hover:bg-gray-50 transition-colors ${groupMode === 'region' && onOpenBranch ? 'cursor-pointer' : ''}`}
                  >
                    <td className="px-3 py-2 font-semibold">{g.key}</td>
                    <td className="px-3 py-2">{g.count}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{g.workers.toLocaleString()}</span>
                        <div className="flex-1 max-w-[80px] h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full bg-blue-400 rounded-full" style={{ width: `${Math.min(100, (g.workers / Math.max(1, totalWorkers)) * 100)}%` }} />
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-[#1D4ED8]">{formatCurrency(g.revenue)}</td>
                    <td className="px-3 py-2 text-red-600">{formatCurrency(g.costs)}</td>
                    <td className="px-3 py-2 text-emerald-600 font-semibold">{formatCurrency(g.profit)}</td>
                    <td className="px-3 py-2">
                      <span className={`font-semibold ${g.revenue > 0 && g.profit / g.revenue > 0.15 ? 'text-emerald-600' : 'text-amber-600'}`}>
                        {g.revenue > 0 ? ((g.profit / g.revenue) * 100).toFixed(1) : 0}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Payment Cycle Section */}
        <div className="bg-white border border-[#E8E7E2] rounded-[10px] overflow-hidden">
          <div className="px-4 py-2.5 border-b border-[#E8E7E2] flex items-center gap-1.5">
            <BarChart2 size={13} className="text-violet-500" />
            <span className="text-[12.5px] font-semibold text-[#111]">Chu kỳ thanh toán khách hàng</span>
            <span className="text-[11px] text-gray-400 ml-1">— số KH thanh toán theo ngày trong tháng. Dùng "Bộ lọc" phía trên để xem theo khu vực/quản lý.</span>
          </div>

          {/* Overall payment bar chart */}
          <div className="p-4">
            <div className="text-[11.5px] font-medium text-gray-600 mb-2">Tổng hợp ({filteredClients.length} KH)</div>
            <div style={{ height: 120 }}>
              <Bar
                data={{
                  labels: paymentDays.map(d => `${d}`),
                  datasets: [{
                    label: 'Số KH',
                    data: paymentByDay,
                    backgroundColor: paymentByDay.map(v =>
                      v === 0 ? 'rgba(209,213,219,0.3)' :
                      v >= 3 ? 'rgba(139,92,246,0.8)' :
                      'rgba(167,139,250,0.65)'
                    ),
                    borderRadius: 3,
                  }],
                }}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: { legend: { display: false }, tooltip: { callbacks: { title: ([item]) => `Ngày ${item.label}`, label: (item) => `${item.raw} khách hàng` } } },
                  scales: {
                    x: { grid: { display: false }, ticks: { font: { size: 9 }, maxRotation: 0 } },
                    y: { grid: { color: '#f3f4f6' }, ticks: { font: { size: 10 }, stepSize: 1 }, beginAtZero: true },
                  },
                }}
              />
            </div>
          </div>
        </div>

      </div>

      {selectedClient && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setSelectedClient(null)}>
          <div className="bg-white rounded-[12px] w-full max-w-md p-6 shadow-xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[15px] font-semibold text-[#111]">{selectedClient.name}</h2>
              <button onClick={() => setSelectedClient(null)} className="p-1 hover:bg-gray-100 rounded"><X size={15} /></button>
            </div>
            <div className="space-y-3 text-[12.5px]">
              <div className="flex items-center gap-2">
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${statusPill(selectedClient.status).cls}`}>
                  {statusPill(selectedClient.status).label}
                </span>
                {selectedClient.client_type && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-gray-100 text-gray-600">
                    {selectedClient.client_type === 'active' ? 'Khách hàng' : 'Tiềm năng'}
                  </span>
                )}
                {selectedClient.prospect_status && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-blue-50 text-blue-700">
                    {selectedClient.prospect_status}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><div className="text-[11px] text-gray-400">Khu vực</div><div className="font-medium">{selectedClient.region || '—'}</div></div>
                <div><div className="text-[11px] text-gray-400">Quản lý</div><div className="font-medium">{selectedClient.manager || '—'}</div></div>
                <div><div className="text-[11px] text-gray-400">Lao động hiện tại</div><div className="font-medium">{selectedClient.current_workers ?? 0}</div></div>
                <div><div className="text-[11px] text-gray-400">LĐ tối thiểu</div><div className="font-medium">{selectedClient.min_workers}</div></div>
                <div><div className="text-[11px] text-gray-400">Bắt đầu HĐ</div><div className="font-medium">{selectedClient.contract_start ? formatDate(selectedClient.contract_start) : '—'}</div></div>
                <div><div className="text-[11px] text-gray-400">Kết thúc HĐ</div><div className="font-medium">{selectedClient.contract_end ? formatDate(selectedClient.contract_end) : '—'}</div></div>
              </div>
              {(selectedClient.phone || selectedClient.email) && (
                <div className="flex flex-col gap-1.5 pt-2 border-t border-[#F0EEE9]">
                  {selectedClient.phone && (
                    <div className="flex items-center gap-1.5 text-gray-600"><Phone size={12} /> {selectedClient.phone}</div>
                  )}
                  {selectedClient.email && (
                    <div className="flex items-center gap-1.5 text-gray-600"><Mail size={12} /> {selectedClient.email}</div>
                  )}
                </div>
              )}
              {selectedClient.notes && (
                <div className="pt-2 border-t border-[#F0EEE9]">
                  <div className="text-[11px] text-gray-400 mb-1">Ghi chú</div>
                  <div className="text-gray-700 whitespace-pre-wrap">{selectedClient.notes}</div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
