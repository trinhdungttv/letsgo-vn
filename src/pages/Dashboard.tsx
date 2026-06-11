import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { Bar, Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, PointElement, LineElement,
  BarElement, Tooltip, Filler, Legend,
} from 'chart.js';
import {
  AlertCircle, TrendingUp, Users, BarChart2,
  ChevronDown, CheckCircle2, Clock, Circle, RefreshCw, ClipboardList, X, Phone, Mail,
} from 'lucide-react';
import type { Client } from '../lib/types';
import { statusPill, formatCurrency, formatDate, daysUntil } from '../lib/format';
import { supabase } from '../lib/supabase';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Tooltip, Filler, Legend);

interface DashboardProps { clients: Client[]; }

type ScopeMode = 'all' | 'region' | 'manager';
type GroupMode = 'region' | 'manager';
type TaskStatus = 'pending' | 'in_progress' | 'done';

interface DashboardTask {
  id: string;
  client_id: string | null;
  client_name: string;
  client_region: string | null;
  description: string;
  status: TaskStatus;
  source_status: string | null;
  created_at: string;
  source_type?: 'contract' | 'pipeline';
  due_date?: string | null;
}

interface GroupRow {
  key: string;
  count: number;
  workers: number;
  revenue: number;
  costs: number;
  profit: number;
}

const TASK_STATUS_CONFIG: Record<TaskStatus, { label: string; icon: React.ReactNode; cls: string; bg: string }> = {
  pending:     { label: 'Cần làm',    icon: <Circle size={13} />,       cls: 'text-slate-600',   bg: 'bg-slate-100'   },
  in_progress: { label: 'Đang làm',   icon: <Clock size={13} />,        cls: 'text-blue-600',    bg: 'bg-blue-100'    },
  done:        { label: 'Hoàn thành', icon: <CheckCircle2 size={13} />, cls: 'text-emerald-600', bg: 'bg-emerald-100' },
};

export default function Dashboard({ clients }: DashboardProps) {
  const [scopeMode, setScopeMode] = useState<ScopeMode>('all');
  const [selectedScope, setSelectedScope] = useState<string>('');
  const [groupMode, setGroupMode] = useState<GroupMode>('region');
  const [tasks, setTasks] = useState<DashboardTask[]>([]);
  const [tasksLoading, setTasksLoading] = useState(false);
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

  const totalWorkers = filteredClients.reduce((s, c) => s + (c.current_workers || 0), 0);
  const totalRevenue = totalWorkers * 850000 * 30;
  const paid = filteredClients.filter(c => c.paid_this_month).length;
  const danger = filteredClients.filter(c => c.status === 'danger').length;
  const warn = filteredClients.filter(c => c.status === 'warn').length;

  // Groups for bar chart & table
  const groups = useMemo((): GroupRow[] => {
    const map: Record<string, GroupRow> = {};
    for (const c of filteredClients) {
      const key = (groupMode === 'region' ? c.region : c.manager) || 'Khác';
      if (!map[key]) map[key] = { key, count: 0, workers: 0, revenue: 0, costs: 0, profit: 0 };
      const w = c.current_workers || 0;
      const rev = w * 850000 * 30;
      const cost = w * 720000 * 30;
      map[key].count++;
      map[key].workers += w;
      map[key].revenue += rev;
      map[key].costs += cost;
      map[key].profit += rev - cost;
    }
    return Object.values(map).sort((a, b) => b.workers - a.workers);
  }, [filteredClients, groupMode]);

  const trendData = [2420, 2510, 2590, 2670, 2790, totalWorkers || 2847];
  const expiringClients = filteredClients.filter(c => { const d = daysUntil(c.contract_end); return d !== null && d <= 30; });

  // Load tasks from Supabase (contract alerts + pipeline tasks)
  const loadTasks = useCallback(async () => {
    setTasksLoading(true);
    try {
      const [{ data: contractTasks }, { data: pipelineTasks }] = await Promise.all([
        supabase.from('dashboard_tasks').select('*').order('created_at', { ascending: false }),
        supabase.from('crm_pipeline_tasks').select('*').neq('status', 'done').order('created_at', { ascending: false }),
      ]);

      // De-dupe contract tasks by client_id (keep most recent, list is ordered by created_at desc)
      const seenClientIds = new Set<string>();
      const ct: DashboardTask[] = [];
      for (const t of (contractTasks || []) as any[]) {
        const key = t.client_id || t.id;
        if (seenClientIds.has(key)) continue;
        seenClientIds.add(key);
        ct.push({ ...t, source_type: 'contract' as const });
      }
      const pt: DashboardTask[] = (pipelineTasks || []).map((t: any) => ({
        id: `pt_${t.id}`,
        client_id: null,
        client_name: t.company_name,
        client_region: null,
        description: t.title + (t.description ? ` — ${t.description}` : ''),
        status: t.status as TaskStatus,
        source_status: null,
        created_at: t.created_at,
        source_type: 'pipeline' as const,
        due_date: t.due_date,
        _real_id: t.id,
      } as any));

      setTasks([...ct, ...pt]);
    } finally {
      setTasksLoading(false);
    }
  }, []);

  // Sync alerts → tasks (insert missing ones; guarded against concurrent runs to avoid duplicates)
  const syncInFlight = useRef(false);
  const syncAlertTasks = useCallback(async (alertClients: Client[]) => {
    if (!alertClients.length || syncInFlight.current) return;
    syncInFlight.current = true;
    try {
      const ids = alertClients.map(c => c.id);
      const { data: existing } = await supabase.from('dashboard_tasks').select('client_id').in('client_id', ids);
      const existingIds = new Set((existing || []).map((r: any) => r.client_id));
      const missing = alertClients.filter(c => !existingIds.has(c.id));
      if (!missing.length) return;
      const upserts = missing.map(c => {
        const d = daysUntil(c.contract_end);
        let description = 'Hợp đồng sắp hết hạn';
        if (c.status === 'danger') description = 'Hợp đồng khẩn cấp cần xử lý';
        else if (d !== null && d <= 0) description = 'Hợp đồng đã hết hạn';
        else if (d !== null) description = `Hợp đồng sắp hết hạn (còn ${d} ngày)`;
        return {
          client_id: c.id,
          client_name: c.name,
          client_region: c.region,
          description,
          source_status: c.status,
        };
      });
      await supabase.from('dashboard_tasks').insert(upserts);
      await loadTasks();
    } finally {
      syncInFlight.current = false;
    }
  }, [loadTasks]);

  useEffect(() => { loadTasks(); }, [loadTasks]);

  // Clients needing attention: hard alerts (danger/warn) + contracts expiring within 30 days
  const alertAndExpiringClients = useMemo(() => {
    const map = new Map<string, Client>();
    for (const c of filteredClients) {
      if (c.status === 'danger' || c.status === 'warn') map.set(c.id, c);
    }
    for (const c of expiringClients) map.set(c.id, c);
    return [...map.values()];
  }, [filteredClients, expiringClients]);

  useEffect(() => {
    if (alertAndExpiringClients.length && tasks.length >= 0) syncAlertTasks(alertAndExpiringClients);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alertAndExpiringClients.length]);

  const updateTaskStatus = async (id: string, status: TaskStatus) => {
    if (id.startsWith('pt_')) {
      const realId = id.replace('pt_', '');
      await supabase.from('crm_pipeline_tasks').update({ status, updated_at: new Date().toISOString() }).eq('id', realId);
      if (status === 'done') {
        setTasks(prev => prev.filter(t => t.id !== id));
        return;
      }
    } else {
      await supabase.from('dashboard_tasks').update({ status, updated_at: new Date().toISOString() }).eq('id', id);
    }
    setTasks(prev => prev.map(t => t.id === id ? { ...t, status } : t));
  };

  const findClientForTask = useCallback((task: DashboardTask): Client | null => {
    if (task.client_id) return clients.find(c => c.id === task.client_id) || null;
    return clients.find(c => c.name === task.client_name) || null;
  }, [clients]);

  // Filter tasks by current scope
  const visibleTasks = useMemo(() => {
    if (scopeMode === 'all' || !selectedScope) return tasks;
    if (scopeMode === 'region') return tasks.filter(t => t.client_region === selectedScope);
    return tasks;
  }, [tasks, scopeMode, selectedScope]);

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

  // Group payment calendar by region
  const paymentByRegion = useMemo(() => {
    const regionKeys = [...new Set(filteredClients.map(c => c.region || 'Khác'))];
    return regionKeys.map(region => {
      const regionClients = filteredClients.filter(c => (c.region || 'Khác') === region);
      const counts = new Array(31).fill(0);
      for (const c of regionClients) {
        const start = c.payment_start ?? 1;
        const end = c.payment_end ?? 5;
        for (let d = start; d <= Math.min(end, 31); d++) counts[d - 1]++;
      }
      return { region, counts };
    });
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
            <div className="px-4 py-2.5 border-b border-[#E8E7E2] flex items-center gap-1.5">
              <TrendingUp size={13} className="text-blue-500" />
              <span className="text-[12.5px] font-semibold text-[#111]">Xu hướng lao động T1–T6</span>
            </div>
            <div className="p-3" style={{ height: 168 }}>
              <Line
                data={{ labels: ['T1','T2','T3','T4','T5','T6'], datasets: [{ data: trendData, borderColor: '#3B82F6', backgroundColor: 'rgba(59,130,246,.08)', fill: true, tension: 0.4, borderWidth: 2, pointRadius: 3 }] }}
                options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false } }, y: { min: 2200, ticks: { callback: (v) => Number(v).toLocaleString() } } } }}
              />
            </div>
          </div>

          {/* Alerts + Tasks */}
          <div className="col-span-3 bg-white border border-[#E8E7E2] rounded-lg overflow-hidden">
            <div className="px-4 py-2.5 border-b border-[#E8E7E2] flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <AlertCircle size={13} className="text-amber-500" />
                <span className="text-[12.5px] font-semibold text-[#111]">Cảnh báo & Việc cần làm</span>
              </div>
              <button onClick={loadTasks} className="text-gray-400 hover:text-gray-600 transition">
                <RefreshCw size={13} className={tasksLoading ? 'animate-spin' : ''} />
              </button>
            </div>
            <div className="overflow-y-auto" style={{ maxHeight: 220 }}>
              {visibleTasks.length === 0 ? (
                <div className="text-center text-[#aaa] text-[13px] py-4">Không có việc cần làm</div>
              ) : (
                <div className="grid grid-cols-2">
                  {visibleTasks.map(task => {
                    const cfg = TASK_STATUS_CONFIG[task.status] || TASK_STATUS_CONFIG.pending;
                    const relatedClient = findClientForTask(task);
                    const daysLeft = task.source_type !== 'pipeline' && relatedClient ? daysUntil(relatedClient.contract_end) : null;
                    return (
                      <div key={task.id} className="flex items-center gap-2 px-3 py-2 border-b border-r border-[#F0EEE9] [&:nth-child(2n)]:border-r-0">
                        {task.source_type === 'pipeline' ? (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10.5px] font-medium shrink-0 bg-orange-100 text-orange-700">
                            <ClipboardList size={10} /> BD
                          </span>
                        ) : daysLeft !== null ? (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10.5px] font-medium shrink-0 bg-red-100 text-red-700">
                            {daysLeft <= 0 ? 'Hết hạn' : `${daysLeft} ngày`}
                          </span>
                        ) : null}
                        <div className="flex-1 min-w-0">
                          {relatedClient ? (
                            <button onClick={() => setSelectedClient(relatedClient)} className="font-medium text-[12px] truncate text-blue-700 hover:underline text-left block w-full">{task.client_name}</button>
                          ) : (
                            <div className="font-medium text-[12px] truncate">{task.client_name}</div>
                          )}
                          <div className="text-[11px] text-gray-500 truncate">{task.description}</div>
                          {(task as any).due_date && (
                            <div className={`text-[10.5px] mt-0.5 ${new Date((task as any).due_date) < new Date() ? 'text-red-500 font-medium' : 'text-gray-400'}`}>
                              Hạn: {(task as any).due_date}
                            </div>
                          )}
                        </div>
                        {task.client_region && (
                          <span className="text-[10.5px] text-gray-400 shrink-0">{task.client_region}</span>
                        )}
                        {/* Status selector */}
                        <div className="relative shrink-0">
                          <select
                            value={task.status}
                            onChange={e => updateTaskStatus(task.id, e.target.value as TaskStatus)}
                            className={`appearance-none text-[10.5px] font-medium pl-5 pr-4 py-0.5 rounded-full border-0 cursor-pointer focus:outline-none focus:ring-1 focus:ring-blue-400 ${cfg.bg} ${cfg.cls}`}
                          >
                            {(Object.entries(TASK_STATUS_CONFIG) as [TaskStatus, typeof TASK_STATUS_CONFIG[TaskStatus]][]).map(([val, c]) => (
                              <option key={val} value={val}>{c.label}</option>
                            ))}
                          </select>
                          <span className={`absolute left-1.5 top-1/2 -translate-y-1/2 pointer-events-none ${cfg.cls}`}>
                            {cfg.icon}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
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
                  <tr key={g.key} className="border-b border-[#F0EEE9] last:border-0 hover:bg-gray-50 transition-colors">
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
            <span className="text-[11px] text-gray-400 ml-1">— số KH thanh toán theo ngày trong tháng</span>
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

            {/* Per-region payment calendar */}
            {paymentByRegion.length > 0 && (
              <div className="mt-4 border-t border-[#F0EEE9] pt-4">
                <div className="text-[11.5px] font-medium text-gray-600 mb-3">Theo khu vực</div>
                <div className="space-y-2.5">
                  {paymentByRegion.map(({ region, counts }) => {
                    const maxCount = Math.max(...counts, 1);
                    return (
                      <div key={region}>
                        <div className="text-[11px] font-semibold text-gray-700 mb-1">{region}</div>
                        <div className="flex gap-px">
                          {counts.map((count, idx) => (
                            <div
                              key={idx}
                              title={`Ngày ${idx + 1}: ${count} KH`}
                              className="flex-1 rounded-sm transition-all"
                              style={{
                                height: 20,
                                backgroundColor: count === 0
                                  ? '#F3F4F6'
                                  : `rgba(139,92,246,${0.2 + (count / maxCount) * 0.8})`,
                              }}
                            />
                          ))}
                        </div>
                        <div className="flex justify-between text-[9px] text-gray-400 mt-0.5">
                          <span>1</span><span>10</span><span>20</span><span>31</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
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
