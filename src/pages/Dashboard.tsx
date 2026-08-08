import { useState, useMemo, useEffect, useRef, type ReactNode } from 'react';
import AlertsTasksPanel from '../components/AlertsTasksPanel';
import { Bar, Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, PointElement, LineElement,
  BarElement, Tooltip, Filler, Legend,
} from 'chart.js';
import {
  AlertCircle, TrendingUp, Users, BarChart2, Target,
  ChevronDown, X, Phone, Mail, SlidersHorizontal,
} from 'lucide-react';
import type { Client, ProjectPnl, ProjectPnlCost, PnlSplitSettings, FinanceRecord, Branch, MarketZone, Manager, LaborHistoryEntry } from '../lib/types';
import { statusPill, formatCurrency, formatDate, calcPnl, shiftMonth, monthLabel, getMonthLast, daysUntil } from '../lib/format';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { usePersistedState } from '../hooks/usePersistedState';

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
  laborHistory: Record<string, LaborHistoryEntry[]>;
  onOpenBranch?: (region: string) => void;
  onOpenClient?: (id: string) => void;
  onOpenPipelineEntry?: (crmId: string) => void;
  onOpenWorkspace?: () => void;
  onClientUpdate?: (client: Client) => void;
}

type ScopeMode = 'all' | 'region' | 'branch' | 'manager';
// Grouping always by branch

// Nút bộ lọc của biểu đồ: giấu các điều khiển trong popover, bấm mới hiện.
// Các lựa chọn bên trong được lưu (usePersistedState) làm mặc định hiển thị.
function ChartFilterButton({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        title="Bộ lọc & cài đặt hiển thị"
        className={`p-1.5 rounded-md border transition ${open ? 'border-blue-400 text-blue-600 bg-blue-50' : 'border-gray-200 text-gray-500 hover:border-blue-300 hover:text-blue-500'}`}
      >
        <SlidersHorizontal size={13} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-30 bg-white border border-gray-200 rounded-lg shadow-lg p-3 w-[250px] space-y-2.5">
          {children}
          <div className="text-[10px] text-gray-400 pt-1 border-t border-gray-100">
            Lựa chọn được lưu làm mặc định hiển thị cho các lần sau.
          </div>
        </div>
      )}
    </div>
  );
}

// Hàng label + control trong popover bộ lọc.
function FilterRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[11px] text-gray-500 shrink-0">{label}</span>
      {children}
    </div>
  );
}

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

export default function Dashboard({ clients, laborHistory, onOpenBranch, onOpenClient, onOpenPipelineEntry, onOpenWorkspace, onClientUpdate }: DashboardProps) {
  const { user } = useAuth();
  const isAdmin = (user as any)?.role === 'admin';
  const [scopeMode, setScopeMode] = useState<ScopeMode>('all');
  const [selectedScope, setSelectedScope] = useState<string>('');
  // Build client→branch mapping
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);

  const today = new Date().toLocaleDateString('vi-VN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  // Load branches, market zones, managers for filters
  const [branches, setBranches] = useState<Branch[]>([]);
  const [marketZones, setMarketZones] = useState<MarketZone[]>([]);
  const [allManagers, setAllManagers] = useState<Manager[]>([]);
  useEffect(() => {
    supabase.from('branches').select('*').order('name').then(({ data }) => setBranches((data ?? []) as Branch[]));
    supabase.from('market_zones').select('id, name, location').then(({ data }) => setMarketZones((data ?? []) as MarketZone[]));
    supabase.from('managers').select('*').order('name').then(({ data }) => setAllManagers((data ?? []) as Manager[]));
  }, []);

  // Provinces from market zones (shared data source)
  const provinces = useMemo(() =>
    [...new Set(marketZones.map(z => z.location).filter(Boolean) as string[])].sort(),
    [marketZones]
  );

  // Zone names grouped by province for client matching
  const zonesByProvince = useMemo(() => {
    const map: Record<string, Set<string>> = {};
    for (const z of marketZones) {
      if (!z.location) continue;
      (map[z.location] ??= new Set()).add(z.name);
    }
    return map;
  }, [marketZones]);

  const branchNames = useMemo(() => branches.map(b => ({ label: b.name, region: b.region })), [branches]);
  const managers = useMemo(() => allManagers.map(m => m.name).sort(), [allManagers]);

  // Filtered clients based on global scope (exclude suspended)
  const filteredClients = useMemo(() => {
    const base = clients.filter(c => c.cooperation_status !== 'suspended');
    if (scopeMode === 'all' || !selectedScope) return base;
    if (scopeMode === 'region') {
      const zonesInProvince = zonesByProvince[selectedScope];
      if (!zonesInProvince) return base;
      return base.filter(c => c.industrial_zones?.some(iz => zonesInProvince.has(iz)));
    }
    if (scopeMode === 'branch') {
      const br = branches.find(b => b.name === selectedScope);
      if (!br) return base;
      const matchValues = new Set([br.name, br.region, br.short_name].filter(Boolean));
      return base.filter(c => c.region && matchValues.has(c.region));
    }
    return base.filter(c => c.manager === selectedScope);
  }, [clients, scopeMode, selectedScope, zonesByProvince, branches]);

  const curMonth = currentMonthStr();
  const curMonthNum = parseInt(curMonth.split('-')[1], 10);

  // P&L dự án tháng hiện tại — nguồn số liệu thực cho doanh thu/lợi nhuận trên Dashboard
  const [projectsPnl, setProjectsPnl] = useState<ProjectPnl[]>([]);
  const [financeRecords, setFinanceRecords] = useState<FinanceRecord[]>([]);
  useEffect(() => {
    supabase.from('projects_pnl').select('*').eq('month', curMonth).then(({ data }) => {
      setProjectsPnl((data || []) as ProjectPnl[]);
    });
    supabase.from('finance_records').select('*').eq('month', curMonth).then(({ data }) => {
      setFinanceRecords((data || []) as FinanceRecord[]);
    });
  }, [curMonth]);

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

  const financeByClient = useMemo(() => {
    const map: Record<string, FinanceRecord> = {};
    for (const f of financeRecords) map[f.client_id] = f;
    return map;
  }, [financeRecords]);
  const financeRevenue = useMemo(() => filteredClients.reduce((s, c) => s + (financeByClient[c.id]?.revenue || 0), 0), [filteredClients, financeByClient]);
  const financePaid = useMemo(() => filteredClients.filter(c => financeByClient[c.id]?.paid_status).length, [filteredClients, financeByClient]);
  const displayRevenue = financeRevenue > 0 ? financeRevenue : totalRevenue;
  const paid = financePaid > 0 ? financePaid : filteredClients.filter(c => c.paid_this_month).length;
  // HĐ cần xử lý — đếm theo NGÀY HẾT HẠN THẬT (clients.contract_end), cùng nguồn với
  // bảng "Tái ký hợp đồng" ngay bên cạnh và rail "HĐ cần xử lý" ở Workspace.
  // Trước đây thẻ này đếm clients.status === 'danger'/'warn': trường đó không có chỗ
  // nào ghi giá trị (toàn bộ KH đều là 'ok') nên thẻ luôn hiện 0 dù HĐ đã hết hạn.
  const contractAlerts = useMemo(() => {
    let expired = 0, soon = 0;
    for (const c of filteredClients) {
      const d = daysUntil(c.contract_end);
      if (d === null) continue;          // chưa nhập ngày hết hạn → không kết luận
      if (d <= 0) expired++;
      else if (d <= 30) soon++;
    }
    return { expired, soon, total: expired + soon };
  }, [filteredClients]);

  // Số KH còn hạn hợp đồng (KH chưa nhập ngày hết hạn vẫn tính là đang HĐ).
  const activeContracts = filteredClients.length - contractAlerts.expired;

  // Tăng/giảm lao động so với tháng trước — số thật từ lịch sử lao động,
  // thay cho dòng "+2.8%" vốn được ghi cứng trong mã nguồn.
  const monthWorkers = useMemo(() => {
    const sumOf = (monthNum: number) => {
      if (monthNum < 1) return null;
      let sum = 0, found = false;
      for (const c of filteredClients) {
        const v = getMonthLast(laborHistory[c.id] || [], monthNum);
        if (v !== null) { sum += v; found = true; }
      }
      return found ? sum : null;
    };
    return { cur: sumOf(curMonthNum), prev: sumOf(curMonthNum - 1) };
  }, [filteredClients, laborHistory, curMonthNum]);

  // Chỉ so sánh khi tháng này ĐÃ có người nhập số. Chưa nhập thì `totalWorkers`
  // vẫn đang là số chốt của tháng trước (current_workers = bản ghi mới nhất),
  // đem so sẽ ra "0%" — nghe như lao động đứng yên, trong khi thực tế là chưa có số.
  const workerDeltaPct = monthWorkers.cur !== null && monthWorkers.prev !== null && monthWorkers.prev > 0
    ? ((totalWorkers - monthWorkers.prev) / monthWorkers.prev) * 100
    : null;

  // Map client region → branch name
  const clientToBranch = useMemo(() => {
    const map: Record<string, string> = {};
    for (const c of clients) {
      if (!c.region) continue;
      const br = branches.find(b => [b.name, b.region, b.short_name].filter(Boolean).includes(c.region!));
      if (br) map[c.id] = br.name;
    }
    return map;
  }, [clients, branches]);

  // Groups for bar chart & table — always grouped by branch
  const groups = useMemo((): GroupRow[] => {
    const map: Record<string, GroupRow> = {};
    for (const c of filteredClients) {
      const key = clientToBranch[c.id] || 'Khác';
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
  }, [filteredClients, clientToBranch, pnlByClient]);

  // ---- Xu hướng lao động: luôn chạy tới THÁNG HIỆN TẠI, tự nới ra khi sang tháng mới ----
  // Số LĐ mỗi tháng dùng đúng quy tắc sẵn có của trang (xem workersOf bên dưới):
  //   • tháng hiện tại  → số live (current_workers) ⇒ khớp thẻ "Tổng lao động"
  //   • tháng đã qua    → số của tuần cuối cùng tháng đó trong lịch sử lao động
  // Cửa sổ hiển thị luôn dừng ở T1 của năm nay: week_label ("TmWw") KHÔNG mang năm,
  // lùi qua năm trước sẽ lấy nhầm số của cùng tháng năm nay.
  const [trendRange, setTrendRange] = usePersistedState<'ytd' | '3' | '6' | '12'>('lgvn_dash_trendRange', 'ytd');

  const laborTrend = useMemo(() => {
    const span = trendRange === 'ytd' ? curMonthNum : Math.min(Number(trendRange), curMonthNum);
    const months = Array.from({ length: span }, (_, i) => curMonthNum - span + 1 + i);
    const points = months.map(num => {
      if (num === curMonthNum) return totalWorkers || null;
      let sum = 0, found = false;
      for (const c of filteredClients) {
        const v = getMonthLast(laborHistory[c.id] || [], num);
        if (v !== null) { sum += v; found = true; }
      }
      // Tháng chưa nhập liệu → null (đứt nét) thay vì 0, tránh đường tụt giả tạo.
      return found ? sum : null;
    });
    return { months, labels: months.map(n => `T${n}`), points };
  }, [trendRange, curMonthNum, filteredClients, laborHistory, totalWorkers]);

  const trendRangeLabel = laborTrend.months.length > 1
    ? `T${laborTrend.months[0]}–T${laborTrend.months[laborTrend.months.length - 1]}`
    : `T${curMonthNum}`;

  // ---- Kiểu hiển thị & khung trục đứng của biểu đồ xu hướng (tuỳ chọn, có lưu) ----
  const [trendChart, setTrendChart] = usePersistedState<'line' | 'bar'>('lgvn_dash_trendChart', 'line');
  const [trendAxis, setTrendAxis] = usePersistedState<'auto' | 'data' | 'zero' | 'custom'>('lgvn_dash_trendAxis', 'auto');
  const [trendMin, setTrendMin] = usePersistedState<string>('lgvn_dash_trendMin', '');
  const [trendMax, setTrendMax] = usePersistedState<string>('lgvn_dash_trendMax', '');
  const [trendTicks, setTrendTicks] = usePersistedState<number>('lgvn_dash_trendTicks', 8);

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

  // Khung trục đứng của biểu đồ xu hướng. Bước chia luôn là số tròn và số vạch
  // do người dùng chọn (mặc định 8) — không để Chart.js tự nhảy bước, vì khi dải
  // số rộng nó chọn bước 500 làm biểu đồ trống trơn.
  const trendYScale = useMemo(() => {
    const NICE = [1, 2, 5, 10, 20, 25, 50, 100, 150, 200, 250, 500, 750, 1000, 1500, 2000, 2500, 5000];
    const ticks = Math.max(3, Math.min(12, trendTicks));
    const snap = (lo: number, hi: number, exact = false) => {
      if (exact) {
        // Mức tự nhập giữ nguyên — chọn bước chia CHIA HẾT khoảng đó để vạch cuối
        // rơi đúng vào mức trên, và số vạch gần với lựa chọn nhất.
        const ideal = (hi - lo) / ticks;
        const pool = NICE.filter(s => Number.isInteger((hi - lo) / s));
        const list = pool.length ? pool : NICE;
        const step = list.reduce((best, s) => Math.abs(s - ideal) < Math.abs(best - ideal) ? s : best, list[0]);
        return { min: lo, max: hi, step };
      }
      const step = NICE.find(s => s >= (hi - lo) / ticks) ?? 10000;
      return { min: Math.max(0, Math.floor(lo / step) * step), max: Math.ceil(hi / step) * step, step };
    };

    if (trendAxis === 'custom') {
      const lo = Number(trendMin), hi = Number(trendMax);
      // Nhập đủ & hợp lệ thì dùng đúng con số đã nhập, không bo tròn.
      if (Number.isFinite(lo) && Number.isFinite(hi) && hi > lo && trendMin !== '' && trendMax !== '') {
        return snap(lo, hi, true);
      }
    }

    const vals = laborTrend.points.filter((v): v is number => v != null);
    if (!vals.length) return null;
    const dataLo = Math.min(...vals), dataHi = Math.max(...vals);

    // "Bám dữ liệu": bỏ qua mốc mục tiêu để đường lao động trải kín khung.
    if (trendAxis === 'data') return snap(dataLo * 0.95, dataHi * 1.05);

    const withTarget = targetValue != null ? [...vals, targetValue] : vals;
    const hi = Math.max(...withTarget);
    if (trendAxis === 'zero') return snap(0, hi * 1.05);
    // "Tự động": trần dừng ĐÚNG ở mốc mục tiêu (không đệm thêm 5% phía trên nữa),
    // để mốc mục tiêu nằm trên vạch trên cùng và đường lao động được đẩy lên cao hơn.
    const cap = targetValue != null && targetValue >= dataHi ? targetValue : hi * 1.05;
    return snap(Math.min(...withTarget) * 0.95, cap);
  }, [laborTrend, trendAxis, trendMin, trendMax, trendTicks, targetValue]);

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

  // ---- Tháng dữ liệu cho 2 biểu đồ (Số công & Doanh thu/LN) — chọn được tháng cũ ----
  const [pnlMonth, setPnlMonth] = useState(curMonth);
  const pnlMonthNum = parseInt(pnlMonth.split('-')[1], 10);
  const monthOptions = useMemo(() => Array.from({ length: 12 }, (_, i) => shiftMonth(curMonth, -i)), [curMonth]);

  // P&L + chi phí dự án + cài đặt thuế của tháng đang chọn — để tính LN đúng như trang Tài chính.
  const [monthPnl, setMonthPnl] = useState<ProjectPnl[]>([]);
  const [monthPnlCosts, setMonthPnlCosts] = useState<Record<string, ProjectPnlCost[]>>({});
  const [splitSettingsMap, setSplitSettingsMap] = useState<Record<string, PnlSplitSettings>>({});
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('projects_pnl').select('*').eq('month', pnlMonth);
      const rows = (data || []) as ProjectPnl[];
      setMonthPnl(rows);
      if (rows.length) {
        const { data: cData } = await supabase.from('projects_pnl_costs').select('*').in('pnl_id', rows.map(r => r.id));
        const grouped: Record<string, ProjectPnlCost[]> = {};
        for (const c of (cData || []) as ProjectPnlCost[]) (grouped[c.pnl_id] ??= []).push(c);
        setMonthPnlCosts(grouped);
      } else {
        setMonthPnlCosts({});
      }
    })();
  }, [pnlMonth]);
  useEffect(() => {
    supabase.from('pnl_split_settings').select('*').then(({ data }) => {
      const map: Record<string, PnlSplitSettings> = {};
      for (const s of (data || []) as PnlSplitSettings[]) map[s.client_id] = s;
      setSplitSettingsMap(map);
    });
  }, []);

  const monthPnlByClient = useMemo(() => {
    const map: Record<string, ProjectPnl[]> = {};
    for (const p of monthPnl) (map[p.client_id] ??= []).push(p);
    return map;
  }, [monthPnl]);

  // Gom nhóm chung cho 2 biểu đồ: lọc theo tên → tính giá trị → nhóm chi nhánh/công ty → sắp xếp.
  const buildChartRows = (
    search: string, group: 'branch' | 'company', sort: 'desc' | 'name',
    valueOf: (c: Client) => number, hideZero: boolean,
  ): { key: string; value: number }[] => {
    const source = filteredClients.filter(c => !search || c.name.toLowerCase().includes(search.toLowerCase()));
    let rows: { key: string; value: number }[];
    if (group === 'company') {
      rows = source.map(c => ({ key: c.name, value: valueOf(c) }));
    } else {
      const map: Record<string, number> = {};
      for (const c of source) {
        const key = clientToBranch[c.id] || 'Khác';
        map[key] = (map[key] || 0) + valueOf(c);
      }
      rows = Object.entries(map).map(([key, value]) => ({ key, value }));
    }
    if (hideZero) rows = rows.filter(r => r.value !== 0);
    rows.sort(sort === 'name' ? (a, b) => a.key.localeCompare(b.key, 'vi') : (a, b) => b.value - a.value);
    // Nhóm theo công ty danh sách dài — giới hạn 15 cột cho dễ đọc (dùng ô tìm để xem cụ thể).
    return group === 'company' ? rows.slice(0, 15) : rows;
  };

  // ---- Biểu đồ 1: Lao động / Số công ----
  const [laborMetric, setLaborMetric] = usePersistedState<'workers' | 'mandays'>('lgvn_dash_laborMetric', 'workers');
  const [laborGroup, setLaborGroup] = usePersistedState<'branch' | 'company'>('lgvn_dash_laborGroup', 'branch');
  const [laborSort, setLaborSort] = usePersistedState<'desc' | 'name'>('lgvn_dash_laborSort', 'desc');
  const [laborSearch, setLaborSearch] = useState('');

  // Số công tháng đang chọn của 1 khách hàng — nhập từ P&L Dự án (projects_pnl.total_man_days).
  const manDaysOf = (clientId: string) => (monthPnlByClient[clientId] || []).reduce((s, p) => s + (p.total_man_days || 0), 0);

  // Số lao động theo tháng chọn: tháng hiện tại dùng số live (current_workers);
  // tháng cũ lấy số của tuần cuối tháng đó trong lịch sử lao động.
  const workersOf = (c: Client) =>
    pnlMonth === curMonth
      ? (c.current_workers || 0)
      : (getMonthLast(laborHistory[c.id] || [], pnlMonthNum) ?? 0);

  const laborRows = useMemo(
    () => buildChartRows(
      laborSearch, laborGroup, laborSort,
      c => laborMetric === 'mandays' ? manDaysOf(c.id) : workersOf(c),
      laborMetric === 'mandays' || pnlMonth !== curMonth,
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filteredClients, laborSearch, laborMetric, laborGroup, laborSort, clientToBranch, monthPnlByClient, pnlMonth, laborHistory],
  );

  const laborBarData = {
    labels: laborRows.map(r => r.key.length > 12 ? r.key.slice(0, 12) + '…' : r.key),
    datasets: [{
      label: laborMetric === 'mandays' ? `Số công T${pnlMonthNum}` : pnlMonth === curMonth ? 'Lao động' : `Lao động T${pnlMonthNum}`,
      data: laborRows.map(r => r.value),
      backgroundColor: laborMetric === 'mandays' ? 'rgba(249,115,22,0.75)' : 'rgba(59,130,246,0.75)',
      borderRadius: 4,
    }],
  };

  // ---- Biểu đồ 2: Doanh thu / Lợi nhuận ----
  const [revMetric, setRevMetric] = usePersistedState<'revenue' | 'net' | 'lg' | 'cn'>('lgvn_dash_revMetric', 'revenue');
  const [revGroup, setRevGroup] = usePersistedState<'branch' | 'company'>('lgvn_dash_revGroup', 'branch');
  const [revSort, setRevSort] = usePersistedState<'desc' | 'name'>('lgvn_dash_revSort', 'desc');
  const [revSearch, setRevSearch] = useState('');

  const REV_METRICS: Record<'revenue' | 'net' | 'lg' | 'cn', { label: string; short: string; color: string }> = {
    revenue: { label: 'Doanh thu', short: 'Doanh thu', color: 'rgba(16,185,129,0.75)' },
    net: { label: 'LN ròng (sau chi phí & thuế)', short: 'LN ròng', color: 'rgba(139,92,246,0.75)' },
    lg: { label: "LN Let's Go VN (sau chia)", short: 'LN LGV', color: 'rgba(59,130,246,0.75)' },
    cn: { label: 'LN Chi nhánh (sau chia)', short: 'LN Chi nhánh', color: 'rgba(5,150,105,0.75)' },
  };

  // Tính đủ chuỗi P&L cho 1 khách hàng trong tháng chọn — dùng đúng calcPnl như trang Tài chính.
  const revValueOf = (c: Client): number => {
    const pnls = monthPnlByClient[c.id] || [];
    let sum = 0;
    for (const p of pnls) {
      if (revMetric === 'revenue') { sum += p.revenue || 0; continue; }
      const s = splitSettingsMap[c.id];
      const r = calcPnl(p, monthPnlCosts[p.id] || [], { taxPct: s?.tax_pct ?? 20, taxExempt: s?.tax_exempt ?? false });
      sum += revMetric === 'net' ? r.profitAfterTax : revMetric === 'lg' ? r.lgP : r.cnP;
    }
    return Math.round(sum);
  };

  const revRows = useMemo(
    () => buildChartRows(revSearch, revGroup, revSort, revValueOf, true),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filteredClients, revSearch, revMetric, revGroup, revSort, clientToBranch, monthPnlByClient, monthPnlCosts, splitSettingsMap],
  );

  const revenueBarData = {
    labels: revRows.map(r => r.key.length > 12 ? r.key.slice(0, 12) + '…' : r.key),
    datasets: [{
      label: `${REV_METRICS[revMetric].short} T${pnlMonthNum}`,
      data: revRows.map(r => r.value),
      backgroundColor: REV_METRICS[revMetric].color,
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

  const scopeOptions = scopeMode === 'region' ? provinces
    : scopeMode === 'branch' ? branchNames.map(b => b.label)
    : scopeMode === 'manager' ? managers : [];

  return (
    <>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 md:px-6 py-3 bg-white border-b border-[#E8E7E2] shrink-0">
        <div>
          <div className="text-[14px] font-semibold text-[#111]">Dashboard</div>
          <div className="text-[11.5px] text-[#888] mt-0.5">{today}</div>
        </div>

        {/* Global Filter */}
        <div className="flex flex-wrap items-center gap-2 max-w-full">
          <span className="hidden sm:inline text-[11.5px] text-[#888] font-medium">Bộ lọc:</span>
          {(['all', 'region', 'branch', 'manager'] as ScopeMode[]).map(m => (
            <button
              key={m}
              onClick={() => { setScopeMode(m); setSelectedScope(''); }}
              className={`px-3 py-1.5 rounded-lg text-[11.5px] font-medium border transition ${
                scopeMode === m
                  ? 'bg-blue-600 border-blue-600 text-white'
                  : 'bg-white border-gray-300 text-gray-600 hover:border-blue-400'
              }`}
            >
              {m === 'all' ? 'Toàn bộ' : m === 'region' ? 'Khu vực' : m === 'branch' ? 'Chi nhánh' : 'Quản lý'}
            </button>
          ))}
          {scopeMode !== 'all' && (
            <div className="relative">
              <select
                value={selectedScope}
                onChange={e => setSelectedScope(e.target.value)}
                className="appearance-none pl-3 pr-8 py-1.5 rounded-lg border border-gray-300 text-[11.5px] text-gray-700 bg-white focus:outline-none focus:border-blue-500 cursor-pointer"
              >
                <option value="">-- Chọn {scopeMode === 'region' ? 'khu vực' : scopeMode === 'branch' ? 'chi nhánh' : 'quản lý'} --</option>
                {scopeOptions.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
              <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 md:p-5 space-y-3 md:space-y-4">
        {/* KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
          <div className="bg-white border border-[#E8E7E2] rounded-lg p-3.5">
            <div className="flex items-center justify-between mb-1">
              <div className="text-[11.5px] text-[#888]">Tổng khách hàng</div>
              <Users size={14} className="text-[#ccc]" />
            </div>
            <div className="text-[22px] font-bold text-[#111]">{filteredClients.length}</div>
            <div className="text-[11px] text-[#aaa] mt-0.5">
              Đang HĐ: {activeContracts}
              {contractAlerts.expired > 0 && <span className="text-red-500"> · {contractAlerts.expired} hết hạn</span>}
            </div>
          </div>
          <div className="bg-white border border-[#E8E7E2] rounded-lg p-3.5">
            <div className="flex items-center justify-between mb-1">
              <div className="text-[11.5px] text-[#888]">Tổng lao động</div>
              <TrendingUp size={14} className="text-blue-400" />
            </div>
            <div className="text-[22px] font-bold text-[#1D4ED8]">{totalWorkers.toLocaleString()}</div>
            {workerDeltaPct === null ? (
              <div className="text-[11px] text-[#aaa] mt-0.5">
                {curMonthNum <= 1
                  ? 'Chưa có mốc so sánh (đầu năm)'
                  : monthWorkers.cur === null && monthWorkers.prev !== null
                    ? `Chưa nhập số T${curMonthNum} — đang lấy số chốt T${curMonthNum - 1}`
                    : `Chưa có số liệu T${curMonthNum - 1} để so sánh`}
              </div>
            ) : (
              <div className={`text-[11px] mt-0.5 ${workerDeltaPct > 0 ? 'text-emerald-600' : workerDeltaPct < 0 ? 'text-red-500' : 'text-[#aaa]'}`}>
                {workerDeltaPct > 0 ? '+' : ''}{workerDeltaPct.toFixed(1)}% so tháng trước
                <span className="text-[#aaa]"> ({monthWorkers.prev!.toLocaleString()})</span>
              </div>
            )}
          </div>
          <div className="bg-white border border-[#E8E7E2] rounded-lg p-3.5">
            <div className="flex items-center justify-between mb-1">
              <div className="text-[11.5px] text-[#888]">Doanh thu ước T{curMonthNum}</div>
              <BarChart2 size={14} className="text-[#ccc]" />
            </div>
            <div className="text-[22px] font-bold text-[#111]">{formatCurrency(displayRevenue)}</div>
            <div className="text-[11px] mt-0.5">
              {displayRevenue > 0 ? (
                <span className={paid > 0 ? 'text-emerald-600' : 'text-[#aaa]'}>Đã TT: {paid}/{filteredClients.length} KH</span>
              ) : (
                // Phân biệt "chưa nhập số" với "đã nhập nhưng bằng 0" — tránh hiểu nhầm là không ai thanh toán.
                <span className="text-[#aaa]">Chưa nhập P&L tháng {curMonthNum}</span>
              )}
            </div>
          </div>
          <div className="bg-white border border-[#E8E7E2] rounded-lg p-3.5">
            <div className="flex items-center justify-between mb-1">
              <div className="text-[11.5px] text-[#888]">HĐ cần xử lý</div>
              <AlertCircle size={14} className={contractAlerts.total > 0 ? 'text-red-400' : 'text-[#ccc]'} />
            </div>
            <div className="text-[22px] font-bold" style={{ color: contractAlerts.expired > 0 ? '#DC2626' : contractAlerts.total > 0 ? '#D97706' : '#059669' }}>{contractAlerts.total}</div>
            <div className="text-[11px] text-[#aaa] mt-0.5">{contractAlerts.expired} đã hết hạn · {contractAlerts.soon} sắp hết (≤30 ngày)</div>
          </div>
        </div>

        {/* Trend + Alerts */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-2.5">
          <div className="lg:col-span-2 bg-white border border-[#E8E7E2] rounded-lg overflow-visible">
            <div className="px-4 py-2.5 border-b border-[#E8E7E2] flex items-center gap-1.5 flex-wrap">
              <TrendingUp size={13} className="text-blue-500" />
              <span className="text-[12.5px] font-semibold text-[#111]">Xu hướng lao động {trendRangeLabel}</span>
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
                <ChartFilterButton>
                  <FilterRow label="Khoảng tháng">
                    <select value={trendRange} onChange={e => setTrendRange(e.target.value as 'ytd' | '3' | '6' | '12')}
                      className="text-[11px] px-1.5 py-1 border border-gray-200 rounded-md outline-none bg-white text-[#555] focus:border-blue-400 w-[130px]">
                      <option value="ytd">Từ đầu năm</option>
                      <option value="12">12 tháng gần nhất</option>
                      <option value="6">6 tháng gần nhất</option>
                      <option value="3">3 tháng gần nhất</option>
                    </select>
                  </FilterRow>
                  <div className="text-[10px] text-gray-400 leading-snug">
                    Luôn kết thúc ở tháng hiện tại (T{curMonthNum}) và không lùi quá T1 năm nay.
                  </div>
                  <FilterRow label="Kiểu biểu đồ">
                    <select value={trendChart} onChange={e => setTrendChart(e.target.value as 'line' | 'bar')}
                      className="text-[11px] px-1.5 py-1 border border-gray-200 rounded-md outline-none bg-white text-[#555] focus:border-blue-400 w-[130px]">
                      <option value="line">Đường</option>
                      <option value="bar">Cột</option>
                    </select>
                  </FilterRow>
                  <FilterRow label="Trục đứng">
                    <select value={trendAxis} onChange={e => setTrendAxis(e.target.value as 'auto' | 'data' | 'zero' | 'custom')}
                      className="text-[11px] px-1.5 py-1 border border-gray-200 rounded-md outline-none bg-white text-[#555] focus:border-blue-400 w-[130px]">
                      <option value="auto">Tự động (kèm mục tiêu)</option>
                      <option value="data">Bám sát dữ liệu</option>
                      <option value="zero">Bắt đầu từ 0</option>
                      <option value="custom">Tự nhập mức</option>
                    </select>
                  </FilterRow>
                  {trendAxis === 'custom' && (
                    <FilterRow label="Từ → đến">
                      <div className="flex items-center gap-1 w-[130px]">
                        <input type="number" value={trendMin} onChange={e => setTrendMin(e.target.value)} placeholder="2000"
                          className="text-[11px] px-1.5 py-1 border border-gray-200 rounded-md outline-none w-full focus:border-blue-400" />
                        <span className="text-[11px] text-gray-400">→</span>
                        <input type="number" value={trendMax} onChange={e => setTrendMax(e.target.value)} placeholder="3000"
                          className="text-[11px] px-1.5 py-1 border border-gray-200 rounded-md outline-none w-full focus:border-blue-400" />
                      </div>
                    </FilterRow>
                  )}
                  <FilterRow label="Số vạch chia">
                    <select value={trendTicks} onChange={e => setTrendTicks(Number(e.target.value))}
                      className="text-[11px] px-1.5 py-1 border border-gray-200 rounded-md outline-none bg-white text-[#555] focus:border-blue-400 w-[130px]">
                      {[4, 6, 8, 10, 12].map(n => <option key={n} value={n}>{n} vạch</option>)}
                    </select>
                  </FilterRow>
                  {trendAxis === 'data' && targetValue != null && (
                    <div className="text-[10px] text-amber-600 leading-snug">
                      Chế độ này bỏ mốc mục tiêu {targetValue.toLocaleString('vi-VN')} ra khỏi khung nên
                      đường kẻ mục tiêu có thể không hiện.
                    </div>
                  )}
                </ChartFilterButton>
              </div>
            </div>
            <div className="p-3" style={{ height: 168 }}>
              {(() => {
                const trendOpts = {
                  responsive: true, maintainAspectRatio: false,
                  // Chừa chỗ cho nhãn mục tiêu khi mốc mục tiêu nằm đúng vạch trên cùng.
                  layout: { padding: { top: 10 } },
                  plugins: {
                    legend: { display: false },
                    tooltip: { callbacks: { label: (c: any) => `${Number(c.parsed.y).toLocaleString('vi-VN')} người` } },
                    ...({ targetLine: { value: targetValue } } as any),
                  },
                  scales: {
                    x: { grid: { display: false } },
                    y: {
                      ...(trendYScale ? { min: trendYScale.min, max: trendYScale.max } : {}),
                      ticks: { stepSize: trendYScale?.step, callback: (v: any) => Number(v).toLocaleString() },
                    },
                  },
                } as any;
                return trendChart === 'bar' ? (
                  <Bar
                    data={{ labels: laborTrend.labels, datasets: [{ data: laborTrend.points, backgroundColor: 'rgba(59,130,246,0.75)', borderRadius: 4, maxBarThickness: 34 }] }}
                    options={trendOpts}
                  />
                ) : (
                  <Line
                    data={{ labels: laborTrend.labels, datasets: [{ data: laborTrend.points, borderColor: '#3B82F6', backgroundColor: 'rgba(59,130,246,.08)', fill: true, tension: 0.45, cubicInterpolationMode: 'monotone', borderWidth: 2, pointRadius: 3, spanGaps: true }] }}
                    options={trendOpts}
                  />
                );
              })()}
            </div>
          </div>

          {/* Alerts + Tasks */}
          <div className="lg:col-span-3">
            <AlertsTasksPanel
              clients={clients}
              regionFilter={scopeMode === 'region' ? selectedScope : null}
              onSelectClient={setSelectedClient}
              onOpenClient={onOpenClient}
              onOpenPipelineEntry={onOpenPipelineEntry}
              onOpenWorkspace={onOpenWorkspace}
              isAdmin={isAdmin}
              onClientUpdate={onClientUpdate}
              clientToBranch={clientToBranch}
            />
          </div>
        </div>

        {/* Labor & Revenue Bar Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
          <div className="bg-white border border-[#E8E7E2] rounded-lg overflow-visible">
            <div className="px-4 py-2.5 border-b border-[#E8E7E2] flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                <Users size={13} className={`shrink-0 ${laborMetric === 'mandays' ? 'text-orange-500' : 'text-blue-500'}`} />
                <span className="text-[12.5px] font-semibold text-[#111] truncate">
                  {laborMetric === 'mandays' ? 'Số công' : 'Lao động'} theo {laborGroup === 'company' ? 'công ty' : 'chi nhánh'}
                </span>
                {(laborMetric === 'mandays' || pnlMonth !== curMonth) && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#F5F4EF] text-[#888] shrink-0">T{pnlMonthNum}</span>
                )}
                {laborSearch && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 truncate">“{laborSearch}”</span>}
              </div>
              <ChartFilterButton>
                <FilterRow label="Tháng">
                  <select value={pnlMonth} onChange={e => setPnlMonth(e.target.value)}
                    className="text-[11px] px-1.5 py-1 border border-gray-200 rounded-md outline-none bg-white text-[#555] focus:border-blue-400 w-[130px]">
                    {monthOptions.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
                  </select>
                </FilterRow>
                <FilterRow label="Chỉ số">
                  <select value={laborMetric} onChange={e => setLaborMetric(e.target.value as 'workers' | 'mandays')}
                    className="text-[11px] px-1.5 py-1 border border-gray-200 rounded-md outline-none bg-white text-[#555] focus:border-blue-400 w-[130px]">
                    <option value="workers">Lao động</option>
                    <option value="mandays">Số công (P&L)</option>
                  </select>
                </FilterRow>
                <FilterRow label="Nhóm theo">
                  <select value={laborGroup} onChange={e => setLaborGroup(e.target.value as 'branch' | 'company')}
                    className="text-[11px] px-1.5 py-1 border border-gray-200 rounded-md outline-none bg-white text-[#555] focus:border-blue-400 w-[130px]">
                    <option value="branch">Chi nhánh</option>
                    <option value="company">Công ty</option>
                  </select>
                </FilterRow>
                <FilterRow label="Sắp xếp">
                  <select value={laborSort} onChange={e => setLaborSort(e.target.value as 'desc' | 'name')}
                    className="text-[11px] px-1.5 py-1 border border-gray-200 rounded-md outline-none bg-white text-[#555] focus:border-blue-400 w-[130px]">
                    <option value="desc">Cao → thấp</option>
                    <option value="name">Theo tên</option>
                  </select>
                </FilterRow>
                <FilterRow label="Tìm công ty">
                  <input
                    type="text" value={laborSearch} onChange={e => setLaborSearch(e.target.value)}
                    placeholder="Tên công ty..."
                    className="text-[11px] px-2 py-1 border border-gray-200 rounded-md outline-none w-[130px] focus:border-blue-400"
                  />
                </FilterRow>
              </ChartFilterButton>
            </div>
            <div className="p-3" style={{ height: 180 }}>
              {laborRows.length ? (
                <Bar data={laborBarData} options={barOpts(false) as any} />
              ) : (
                <div className="flex items-center justify-center h-full text-[12px] text-gray-400">
                  {laborMetric === 'mandays'
                    ? `Chưa có số công tháng ${pnlMonthNum} — nhập ở Tài chính → P&L Dự án`
                    : pnlMonth !== curMonth
                      ? `Chưa có dữ liệu LĐ tháng ${pnlMonthNum} — nhập ở "Nhập nhanh số lao động"`
                      : 'Không có dữ liệu'}
                </div>
              )}
            </div>
          </div>

          <div className="bg-white border border-[#E8E7E2] rounded-lg overflow-visible">
            <div className="px-4 py-2.5 border-b border-[#E8E7E2] flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                <BarChart2 size={13} className="text-emerald-500 shrink-0" />
                <span className="text-[12.5px] font-semibold text-[#111] truncate">
                  {REV_METRICS[revMetric].short} theo {revGroup === 'company' ? 'công ty' : 'chi nhánh'}
                </span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#F5F4EF] text-[#888] shrink-0">T{pnlMonthNum}</span>
                {revSearch && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 truncate">“{revSearch}”</span>}
              </div>
              <ChartFilterButton>
                <FilterRow label="Tháng">
                  <select value={pnlMonth} onChange={e => setPnlMonth(e.target.value)}
                    className="text-[11px] px-1.5 py-1 border border-gray-200 rounded-md outline-none bg-white text-[#555] focus:border-blue-400 w-[150px]">
                    {monthOptions.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
                  </select>
                </FilterRow>
                <FilterRow label="Chỉ số">
                  <select value={revMetric} onChange={e => setRevMetric(e.target.value as 'revenue' | 'net' | 'lg' | 'cn')}
                    className="text-[11px] px-1.5 py-1 border border-gray-200 rounded-md outline-none bg-white text-[#555] focus:border-blue-400 w-[150px]">
                    {(Object.keys(REV_METRICS) as ('revenue' | 'net' | 'lg' | 'cn')[]).map(k => (
                      <option key={k} value={k}>{REV_METRICS[k].label}</option>
                    ))}
                  </select>
                </FilterRow>
                <FilterRow label="Nhóm theo">
                  <select value={revGroup} onChange={e => setRevGroup(e.target.value as 'branch' | 'company')}
                    className="text-[11px] px-1.5 py-1 border border-gray-200 rounded-md outline-none bg-white text-[#555] focus:border-blue-400 w-[150px]">
                    <option value="branch">Chi nhánh</option>
                    <option value="company">Công ty</option>
                  </select>
                </FilterRow>
                <FilterRow label="Sắp xếp">
                  <select value={revSort} onChange={e => setRevSort(e.target.value as 'desc' | 'name')}
                    className="text-[11px] px-1.5 py-1 border border-gray-200 rounded-md outline-none bg-white text-[#555] focus:border-blue-400 w-[150px]">
                    <option value="desc">Cao → thấp</option>
                    <option value="name">Theo tên</option>
                  </select>
                </FilterRow>
                <FilterRow label="Tìm công ty">
                  <input
                    type="text" value={revSearch} onChange={e => setRevSearch(e.target.value)}
                    placeholder="Tên công ty..."
                    className="text-[11px] px-2 py-1 border border-gray-200 rounded-md outline-none w-[150px] focus:border-blue-400"
                  />
                </FilterRow>
              </ChartFilterButton>
            </div>
            <div className="p-3" style={{ height: 180 }}>
              {revRows.length ? (
                <Bar data={revenueBarData} options={barOpts(true) as any} />
              ) : (
                <div className="flex items-center justify-center h-full text-[12px] text-gray-400">
                  Chưa có dữ liệu P&L tháng {pnlMonthNum} — nhập ở Tài chính → P&L Dự án
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Summary Table */}
        <div className="bg-white border border-[#E8E7E2] rounded-[10px] overflow-hidden">
          <div className="px-4 py-2.5 border-b border-[#E8E7E2] flex items-center justify-between">
            <span className="text-[12.5px] font-semibold text-[#111]">Báo cáo tổng hợp theo chi nhánh</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-[#E8E7E2]">
                  {['Chi nhánh','Số KH','Tổng LĐ','Doanh thu','Chi phí','Lợi nhuận','Margin'].map(h => (
                    <th key={h} className="text-left px-3 py-2 text-[11.5px] text-[#888] font-medium bg-[#F9F9F7] whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {groups.map(g => (
                  <tr
                    key={g.key}
                    onClick={onOpenBranch ? () => onOpenBranch(g.key) : undefined}
                    className={`border-b border-[#F0EEE9] last:border-0 hover:bg-gray-50 transition-colors ${onOpenBranch ? 'cursor-pointer' : ''}`}
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
