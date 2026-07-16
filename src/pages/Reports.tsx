import { useEffect, useMemo, useState, useCallback } from 'react';
import { Bar, Line, Doughnut } from 'react-chartjs-2';
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, LineElement,
  PointElement, ArcElement, Tooltip, Filler,
} from 'chart.js';
import { Target, AlertTriangle, FileWarning, Coins, Settings2, TrendingUp, TrendingDown, X as XIcon, Download } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import type { Client, LaborHistoryEntry, ProjectPnl, ProjectPnlCost, Branch, BranchTarget, FinanceRecord, BranchOverhead, WorkTask, WorkTaskComment } from '../lib/types';
import { TASK_STATUS_LABELS, TASK_STATUS_COLORS, DOC_STATUS_STEPS } from '../lib/types';
import { getMonthLast, formatCurrency, monthLabel, shiftMonth, daysUntil, formatDate } from '../lib/format';
import { supabase } from '../lib/supabase';

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, ArcElement, Tooltip, Filler);

interface ReportsProps {
  clients: Client[];
  laborHistory: Record<string, LaborHistoryEntry[]>;
}

type PeriodMode = 'month' | 'quarter' | 'year';

function currentMonthStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Danh sách tháng "YYYY-MM" thuộc kỳ đang chọn.
function periodMonths(mode: PeriodMode, selMonth: string): string[] {
  const [y, m] = selMonth.split('-').map(Number);
  if (mode === 'month') return [selMonth];
  if (mode === 'quarter') {
    const q0 = Math.floor((m - 1) / 3) * 3 + 1;
    return [0, 1, 2].map(i => `${y}-${String(q0 + i).padStart(2, '0')}`);
  }
  return Array.from({ length: 12 }, (_, i) => `${y}-${String(i + 1).padStart(2, '0')}`);
}

function periodLabel(mode: PeriodMode, selMonth: string): string {
  const [y, m] = selMonth.split('-').map(Number);
  if (mode === 'month') return monthLabel(selMonth);
  if (mode === 'quarter') return `Quý ${Math.floor((m - 1) / 3) + 1}/${y}`;
  return `Năm ${y}`;
}

// Tỷ lệ thời gian đã trôi qua của kỳ (0..1) — chuẩn nhịp để so % đạt mục tiêu.
function elapsedFraction(months: string[]): number {
  const now = new Date();
  const cur = currentMonthStr();
  let done = 0;
  for (const mo of months) {
    if (mo < cur) done += 1;
    else if (mo === cur) {
      const [y, m] = mo.split('-').map(Number);
      done += now.getDate() / new Date(y, m, 0).getDate();
    }
  }
  return months.length ? Math.min(1, done / months.length) : 0;
}

const DOC_STATUS_LABEL: Record<string, string> = Object.fromEntries(DOC_STATUS_STEPS.map(s => [s.key, s.label]));

const C = {
  blue: '#1D4ED8', green: '#059669', red: '#DC2626', gray: '#9CA3AF',
  coral: '#D85A30', grid: '#F0EEE9',
};

export default function Reports({ clients, laborHistory }: ReportsProps) {
  const [mode, setMode] = useState<PeriodMode>('month');
  const [selMonth, setSelMonth] = useState<string>(currentMonthStr());
  const [branches, setBranches] = useState<Branch[]>([]);
  const [pnls, setPnls] = useState<ProjectPnl[]>([]);
  const [costsByPnl, setCostsByPnl] = useState<Record<string, number>>({});
  const [overheads, setOverheads] = useState<BranchOverhead[]>([]);
  const [targets, setTargets] = useState<BranchTarget[]>([]);
  const [targetsMissing, setTargetsMissing] = useState(false);
  const [unpaid, setUnpaid] = useState<FinanceRecord[]>([]);
  // Việc "Tái ký HĐ" từ Workspace (work_tasks) — nguồn trạng thái thật của radar hợp đồng.
  const [renewalTasks, setRenewalTasks] = useState<Record<string, WorkTask>>({});
  const [renewalComments, setRenewalComments] = useState<Record<string, WorkTaskComment>>({});
  const [showTargets, setShowTargets] = useState(false);
  const [showAllBranches, setShowAllBranches] = useState(false);
  const [revenueLines, setRevenueLines] = useState<{ amount: number; invoice_date: string }[]>([]);
  const [toast, setToast] = useState('');

  const notify = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3500);
  }, []);

  // Cửa sổ dữ liệu: 12 tháng lùi từ tháng đang chọn (đủ cho mọi chế độ xem).
  const windowMonths = useMemo(() => {
    const arr: string[] = [];
    for (let i = 12; i >= 0; i--) arr.push(shiftMonth(selMonth, -i));
    return arr;
  }, [selMonth]);

  // Map tên đầy đủ mọi KH (kể cả KH không nằm trong prop clients — vd đã lưu trữ).
  const [allNames, setAllNames] = useState<Record<string, string>>({});

  useEffect(() => {
    supabase.from('branches').select('*').order('name').then(({ data }) => setBranches((data ?? []) as Branch[]));
    supabase.from('clients').select('id, name').then(({ data }) => {
      setAllNames(Object.fromEntries(((data ?? []) as { id: string; name: string }[]).map(c => [c.id, c.name])));
    });
    // Mặc định mở kỳ gần nhất có dữ liệu P&L (tránh màn hình trống khi tháng hiện tại chưa nhập).
    supabase.from('projects_pnl').select('month').order('month', { ascending: false }).limit(1).then(({ data }) => {
      const latest = (data as { month: string }[] | null)?.[0]?.month;
      if (latest && latest < currentMonthStr()) setSelMonth(latest);
    });
  }, []);

  useEffect(() => {
    supabase.from('projects_pnl').select('*').in('month', windowMonths).then(({ data }) => {
      setPnls((data ?? []) as ProjectPnl[]);
    });
    supabase.from('branch_overhead').select('*').in('month', windowMonths).then(({ data }) => {
      setOverheads((data ?? []) as BranchOverhead[]);
    });
    supabase.from('branch_targets').select('*').in('month', windowMonths).then(({ data, error }) => {
      if (error) { setTargetsMissing(true); setTargets([]); return; }
      setTargetsMissing(false);
      setTargets((data ?? []) as BranchTarget[]);
    });
    supabase.from('finance_records').select('*').eq('paid_status', false).then(({ data }) => {
      setUnpaid(((data ?? []) as FinanceRecord[]).filter(r => r.month <= currentMonthStr()));
    });
  }, [windowMonths]);

  // Việc tái ký từ Workspace: lấy task mới nhất theo từng KH + bình luận cuối cùng.
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('work_tasks').select('*')
        .eq('task_type', 'Tái ký HĐ').order('created_at', { ascending: false });
      const tasks = (data ?? []) as WorkTask[];
      const byClient: Record<string, WorkTask> = {};
      for (const t of tasks) {
        if (t.client_id && !byClient[t.client_id]) byClient[t.client_id] = t;
      }
      setRenewalTasks(byClient);
      const ids = Object.values(byClient).map(t => t.id);
      if (!ids.length) { setRenewalComments({}); return; }
      const { data: cData } = await supabase.from('work_task_comments').select('*')
        .in('task_id', ids).order('created_at', { ascending: true });
      const lastByTask: Record<string, WorkTaskComment> = {};
      for (const c of (cData ?? []) as WorkTaskComment[]) lastByTask[c.task_id] = c;
      setRenewalComments(lastByTask);
    })();
  }, []);

  // Hoá đơn có ngày (pnl_revenue_lines) của tháng đang chọn + tháng liền trước —
  // nguồn cho biểu đồ doanh thu tích luỹ trong tháng.
  useEffect(() => {
    let cancelled = false;
    const prevMo = shiftMonth(selMonth, -1);
    const [cy, cm] = selMonth.split('-').map(Number);
    const from = `${prevMo}-01`;
    const to = `${selMonth}-${String(new Date(cy, cm, 0).getDate()).padStart(2, '0')}`;
    supabase.from('pnl_revenue_lines').select('amount, invoice_date')
      .gte('invoice_date', from).lte('invoice_date', to)
      .then(({ data }) => {
        if (!cancelled) setRevenueLines((data ?? []) as { amount: number; invoice_date: string }[]);
      });
    return () => { cancelled = true; };
  }, [selMonth]);

  // Tổng chi phí theo pnl_id — tải theo lô để tránh URL quá dài.
  useEffect(() => {
    if (!pnls.length) { setCostsByPnl({}); return; }
    let cancelled = false;
    (async () => {
      const ids = pnls.map(p => p.id);
      const map: Record<string, number> = {};
      for (let i = 0; i < ids.length; i += 150) {
        const { data } = await supabase.from('projects_pnl_costs').select('pnl_id, value').in('pnl_id', ids.slice(i, i + 150));
        for (const c of (data ?? []) as Pick<ProjectPnlCost, 'pnl_id' | 'value'>[]) {
          map[c.pnl_id] = (map[c.pnl_id] || 0) + (Number(c.value) || 0);
        }
      }
      if (!cancelled) setCostsByPnl(map);
    })();
    return () => { cancelled = true; };
  }, [pnls]);

  const activeClients = useMemo(() => clients.filter(c => c.cooperation_status !== 'suspended' && !c.archived_at), [clients]);
  const clientById = useMemo(() => Object.fromEntries(clients.map(c => [c.id, c])), [clients]);

  const curMonths = useMemo(() => periodMonths(mode, selMonth), [mode, selMonth]);
  const prevMonths = useMemo(() => curMonths.map(m => shiftMonth(m, -curMonths.length)), [curMonths]);
  const elapsed = useMemo(() => elapsedFraction(curMonths), [curMonths]);

  const sumRevenue = useCallback((months: string[]) => pnls.filter(p => months.includes(p.month)).reduce((s, p) => s + (p.revenue || 0), 0), [pnls]);
  const sumCosts = useCallback((months: string[]) => {
    const projectCosts = pnls.filter(p => months.includes(p.month)).reduce((s, p) => s + (costsByPnl[p.id] || 0), 0);
    const ohCosts = overheads.filter(o => months.includes(o.month)).reduce((s, o) => s + (o.value || 0), 0);
    return projectCosts + ohCosts;
  }, [pnls, costsByPnl, overheads]);

  const revenue = sumRevenue(curMonths);
  const prevRevenue = sumRevenue(prevMonths);
  const costs = sumCosts(curMonths);
  const prevCosts = sumCosts(prevMonths);
  const profit = revenue - costs;
  const prevProfit = prevRevenue - prevCosts;
  const margin = revenue > 0 ? (profit / revenue) * 100 : 0;
  const prevMargin = prevRevenue > 0 ? (prevProfit / prevRevenue) * 100 : 0;

  const totalTarget = useMemo(() => targets.filter(t => curMonths.includes(t.month)).reduce((s, t) => s + (t.revenue_target || 0), 0), [targets, curMonths]);
  const attainment = totalTarget > 0 ? (revenue / totalTarget) * 100 : null;
  // Nhịp so kỳ trước: quy đổi doanh thu hiện tại về cả kỳ theo thời gian đã trôi.
  const pace = prevRevenue > 0 && elapsed > 0.02 ? ((revenue / elapsed - prevRevenue) / prevRevenue) * 100 : null;

  // ==== Lao động — luôn neo theo hôm nay (dữ liệu vận hành thời gian thực,
  // tách khỏi kỳ kế toán P&L đang chọn) ====
  const nowMonthNum = new Date().getMonth() + 1;
  const prevNowNum = nowMonthNum === 1 ? 12 : nowMonthNum - 1;
  const laborByClient = useMemo(() => {
    const rows: { client: Client; cur: number | null; prev: number | null; delta: number | null }[] = [];
    for (const c of activeClients) {
      const hist = laborHistory[c.id] || [];
      const cur = getMonthLast(hist, nowMonthNum) ?? c.current_workers ?? null;
      const prev = getMonthLast(hist, prevNowNum);
      rows.push({ client: c, cur, prev, delta: cur !== null && prev !== null ? cur - prev : null });
    }
    return rows;
  }, [activeClients, laborHistory, nowMonthNum, prevNowNum]);

  // Số LĐ tại kỳ P&L đang chọn — dùng cho chỉ số doanh thu/LĐ (cùng kỳ với doanh thu).
  const periodMonthNum = Number(curMonths[curMonths.length - 1].split('-')[1]);
  const workersAtPeriod = useMemo(() => {
    let sum = 0;
    for (const c of activeClients) {
      const v = getMonthLast(laborHistory[c.id] || [], periodMonthNum);
      if (v !== null) sum += v;
    }
    return sum;
  }, [activeClients, laborHistory, periodMonthNum]);

  const totalWorkers = laborByClient.reduce((s, r) => s + (r.cur || 0), 0);
  const laborGains = laborByClient.reduce((s, r) => s + (r.delta && r.delta > 0 ? r.delta : 0), 0);
  const laborLosses = laborByClient.reduce((s, r) => s + (r.delta && r.delta < 0 ? -r.delta : 0), 0);
  const laborNet = laborGains - laborLosses;

  // ==== Tỷ lệ đáp ứng cam kết ====
  const commitRows = laborByClient.filter(r => r.client.service_type !== 'recruitment' && (r.client.min_workers || 0) > 0);
  const committed = commitRows.reduce((s, r) => s + r.client.min_workers, 0);
  const actualVsCommit = commitRows.reduce((s, r) => s + (r.cur || 0), 0);
  const fillRate = committed > 0 ? (actualVsCommit / committed) * 100 : null;
  const deficit = commitRows.reduce((s, r) => s + Math.max(0, r.client.min_workers - (r.cur || 0)), 0);
  const underCount = commitRows.filter(r => (r.cur || 0) < r.client.min_workers).length;
  const workersForRate = workersAtPeriod > 0 ? workersAtPeriod : totalWorkers;
  const revPerWorker = workersForRate > 0 ? revenue / curMonths.length / workersForRate : 0;
  const missedRevenue = deficit * revPerWorker;

  // ==== Xu hướng 12 tháng (hoặc theo quý) ====
  const trendData = useMemo(() => {
    if (mode === 'quarter') {
      const qKeys: string[] = [];
      for (let i = 7; i >= 0; i--) {
        const mo = shiftMonth(selMonth, -i * 3);
        const [y, m] = mo.split('-').map(Number);
        const key = `Q${Math.floor((m - 1) / 3) + 1}/${y}`;
        if (!qKeys.includes(key)) qKeys.push(key);
      }
      const rev: Record<string, number> = {}, cost: Record<string, number> = {}, tgt: Record<string, number> = {};
      for (const p of pnls) {
        const [y, m] = p.month.split('-').map(Number);
        const key = `Q${Math.floor((m - 1) / 3) + 1}/${y}`;
        rev[key] = (rev[key] || 0) + (p.revenue || 0);
        cost[key] = (cost[key] || 0) + (costsByPnl[p.id] || 0);
      }
      for (const o of overheads) {
        const [y, m] = o.month.split('-').map(Number);
        const key = `Q${Math.floor((m - 1) / 3) + 1}/${y}`;
        cost[key] = (cost[key] || 0) + (o.value || 0);
      }
      for (const t of targets) {
        const [y, m] = t.month.split('-').map(Number);
        const key = `Q${Math.floor((m - 1) / 3) + 1}/${y}`;
        tgt[key] = (tgt[key] || 0) + (t.revenue_target || 0);
      }
      return {
        labels: qKeys,
        revenue: qKeys.map(k => (rev[k] || 0) / 1e6),
        profit: qKeys.map(k => ((rev[k] || 0) - (cost[k] || 0)) / 1e6),
        target: qKeys.map(k => (tgt[k] || 0) / 1e6),
      };
    }
    const months = windowMonths.slice(1);
    const rev: Record<string, number> = {}, cost: Record<string, number> = {}, tgt: Record<string, number> = {};
    for (const p of pnls) {
      rev[p.month] = (rev[p.month] || 0) + (p.revenue || 0);
      cost[p.month] = (cost[p.month] || 0) + (costsByPnl[p.id] || 0);
    }
    for (const o of overheads) cost[o.month] = (cost[o.month] || 0) + (o.value || 0);
    for (const t of targets) tgt[t.month] = (tgt[t.month] || 0) + (t.revenue_target || 0);
    return {
      labels: months.map(m => `T${Number(m.split('-')[1])}/${m.split('-')[0].slice(2)}`),
      revenue: months.map(m => (rev[m] || 0) / 1e6),
      profit: months.map(m => ((rev[m] || 0) - (cost[m] || 0)) / 1e6),
      target: months.map(m => (tgt[m] || 0) / 1e6),
    };
  }, [mode, selMonth, windowMonths, pnls, costsByPnl, overheads, targets]);

  const hasTargetLine = trendData.target.some(v => v > 0);

  // ==== Doanh thu tích luỹ trong tháng (từ ngày hoá đơn) ====
  // Chỉ vẽ khi hoá đơn có ngày bao phủ đủ doanh thu tháng (≥60%) — tránh biểu đồ sai lệch.
  const cumulative = useMemo(() => {
    const prevMo = shiftMonth(selMonth, -1);
    const [cy, cm] = selMonth.split('-').map(Number);
    const daysInCur = new Date(cy, cm, 0).getDate();
    const [py, pm] = prevMo.split('-').map(Number);
    const daysInPrev = new Date(py, pm, 0).getDate();
    const curDaily = new Array(daysInCur).fill(0);
    const prevDaily = new Array(daysInPrev).fill(0);
    for (const l of revenueLines) {
      const mo = l.invoice_date.slice(0, 7);
      const day = Number(l.invoice_date.slice(8, 10));
      if (mo === selMonth && day >= 1 && day <= daysInCur) curDaily[day - 1] += l.amount || 0;
      else if (mo === prevMo && day >= 1 && day <= daysInPrev) prevDaily[day - 1] += l.amount || 0;
    }
    const accumulate = (arr: number[]) => { let s = 0; return arr.map(v => (s += v)); };
    const curCum = accumulate(curDaily);
    const prevCum = accumulate(prevDaily);
    // Tháng hiện tại: cắt đường tại hôm nay để không vẽ phần tương lai bằng 0.
    const isCurrent = selMonth === currentMonthStr();
    const today = new Date().getDate();
    const curSeries: (number | null)[] = curCum.map((v, i) => (isCurrent && i + 1 > today ? null : v / 1e6));
    const monthRevenue = sumRevenue([selMonth]);
    const linesTotal = curCum[daysInCur - 1] || 0;
    const coverage = monthRevenue > 0 ? linesTotal / monthRevenue : 0;
    return {
      days: Array.from({ length: daysInCur }, (_, i) => i + 1),
      cur: curSeries,
      prev: prevCum.slice(0, daysInCur).map(v => v / 1e6),
      coverage,
      hasData: linesTotal > 0 || prevCum[daysInPrev - 1] > 0,
    };
  }, [selMonth, revenueLines, sumRevenue]);

  const showCumulativeChart = mode === 'month' && cumulative.hasData && cumulative.coverage >= 0.6;

  // ==== Xu hướng lao động 6 tháng gần nhất tính từ hôm nay
  // (week_label không có năm — giữ trong phạm vi 6 tháng để tránh trùng nhãn) ====
  const laborTrend = useMemo(() => {
    const months: { num: number; label: string }[] = [];
    for (let i = 5; i >= 0; i--) {
      const mo = shiftMonth(currentMonthStr(), -i);
      const [y, m] = mo.split('-').map(Number);
      months.push({ num: m, label: `T${m}/${String(y).slice(2)}` });
    }
    const totals = months.map(({ num }) => {
      let sum = 0, found = false;
      for (const c of activeClients) {
        const v = getMonthLast(laborHistory[c.id] || [], num);
        if (v !== null) { sum += v; found = true; }
      }
      return found ? sum : null;
    });
    return { labels: months.map(m => m.label), totals };
  }, [activeClients, laborHistory]);

  // ==== Bảng xếp hạng chi nhánh ====
  const matchBranch = useCallback((key: string): Branch | undefined =>
    branches.find(b => b.name === key || b.short_name === key || b.manager_name === key), [branches]);

  const leaderboard = useMemo(() => {
    const byKey: Record<string, { cur: number; prev: number }> = {};
    for (const p of pnls) {
      const key = p.branch_manager || '—';
      if (!byKey[key]) byKey[key] = { cur: 0, prev: 0 };
      if (curMonths.includes(p.month)) byKey[key].cur += p.revenue || 0;
      if (prevMonths.includes(p.month)) byKey[key].prev += p.revenue || 0;
    }
    const rows = Object.entries(byKey).map(([key, v]) => {
      const br = matchBranch(key);
      const tgt = br ? targets.filter(t => t.branch_id === br.id && curMonths.includes(t.month)).reduce((s, t) => s + (t.revenue_target || 0), 0) : 0;
      return {
        key, branch: br, cur: v.cur, prev: v.prev, target: tgt,
        attainment: tgt > 0 ? (v.cur / tgt) * 100 : null,
        growth: v.prev > 0 ? ((v.cur - v.prev) / v.prev) * 100 : null,
      };
    }).filter(r => r.cur > 0 || r.prev > 0);
    rows.sort((a, b) => (b.attainment ?? -1) - (a.attainment ?? -1) || b.cur - a.cur);
    return rows;
  }, [pnls, curMonths, prevMonths, targets, matchBranch]);

  const onTrackCount = leaderboard.filter(r => r.attainment !== null && r.attainment >= elapsed * 100 - 8).length;

  // Chỉ hiện các đơn vị tiêu biểu (top 5) + đơn vị đội sổ; bấm "Xem đủ" để mở toàn bộ.
  const visibleLeaderboard = useMemo(() => {
    if (showAllBranches || leaderboard.length <= 6) return leaderboard.map((r, i) => ({ ...r, rank: i + 1 }));
    const rows = leaderboard.slice(0, 5).map((r, i) => ({ ...r, rank: i + 1 }));
    rows.push({ ...leaderboard[leaderboard.length - 1], rank: leaderboard.length });
    return rows;
  }, [leaderboard, showAllBranches]);

  // ==== Radar hợp đồng ====
  const latestRevByClient = useMemo(() => {
    const map: Record<string, number> = {};
    for (const mo of [...windowMonths].reverse()) {
      for (const p of pnls.filter(x => x.month === mo)) {
        if (map[p.client_id] === undefined) map[p.client_id] = p.revenue || 0;
      }
    }
    return map;
  }, [pnls, windowMonths]);

  const expiring = useMemo(() => activeClients
    .map(c => ({ client: c, days: daysUntil(c.contract_end) }))
    .filter((r): r is { client: Client; days: number } => r.days !== null && r.days >= 0 && r.days <= 90)
    .sort((a, b) => a.days - b.days), [activeClients]);

  const bucket = (lo: number, hi: number) => {
    const rows = expiring.filter(r => r.days >= lo && r.days <= hi);
    return { count: rows.length, revenue: rows.reduce((s, r) => s + (latestRevByClient[r.client.id] || 0), 0) };
  };
  const b30 = bucket(0, 30), b60 = bucket(31, 60), b90 = bucket(61, 90);
  const protectRevenue = b30.revenue + b60.revenue + b90.revenue;

  // Trạng thái tái ký ánh xạ từ Workspace: ưu tiên tiến độ hồ sơ (doc_status),
  // fallback trạng thái việc; chưa có việc tái ký nào → "Chưa xử lý".
  const renewalInfo = (c: Client): { label: string; cls: string; task: WorkTask | null; comment: WorkTaskComment | null } => {
    const task = renewalTasks[c.id] || null;
    if (!task) return { label: 'Chưa xử lý', cls: 'bg-red-50 text-red-700 border-red-200', task: null, comment: null };
    const label = (task.doc_status && DOC_STATUS_LABEL[task.doc_status]) || TASK_STATUS_LABELS[task.status];
    return { label, cls: TASK_STATUS_COLORS[task.status], task, comment: renewalComments[task.id] || null };
  };

  // ==== Công nợ phải thu ====
  const debt = useMemo(() => {
    const cur = currentMonthStr();
    const curNum = Number(cur.split('-')[0]) * 12 + Number(cur.split('-')[1]);
    const buckets = [0, 0, 0, 0];
    const rows = unpaid.map(r => {
      const late = curNum - (Number(r.month.split('-')[0]) * 12 + Number(r.month.split('-')[1]));
      return { rec: r, late };
    });
    for (const { rec, late } of rows) buckets[Math.min(Math.max(late, 0), 3)] += rec.revenue || 0;
    const total = buckets.reduce((a, b) => a + b, 0);
    const top = rows.filter(r => r.late >= 1).sort((a, b) => b.late - a.late || (b.rec.revenue || 0) - (a.rec.revenue || 0)).slice(0, 3);
    return { buckets, total, top };
  }, [unpaid]);

  // ==== Biến động lao động — top tăng/giảm ====
  const movers = useMemo(() => {
    const withDelta = laborByClient.filter(r => r.delta !== null && r.delta !== 0) as { client: Client; delta: number }[];
    const ups = [...withDelta].sort((a, b) => b.delta - a.delta).slice(0, 5).filter(r => r.delta > 0);
    const downs = [...withDelta].sort((a, b) => a.delta - b.delta).slice(0, 5).filter(r => r.delta < 0);
    return [...ups, ...downs.reverse()];
  }, [laborByClient]);

  // ==== Cơ cấu doanh thu ====
  const concentration = useMemo(() => {
    const byClient: Record<string, number> = {};
    for (const p of pnls.filter(x => curMonths.includes(x.month))) byClient[p.client_id] = (byClient[p.client_id] || 0) + (p.revenue || 0);
    const sorted = Object.entries(byClient).sort((a, b) => b[1] - a[1]);
    const top5 = sorted.slice(0, 5).map(([id, v]) => ({ name: clientById[id]?.name || allNames[id] || 'KH khác', value: v }));
    const rest = sorted.slice(5).reduce((s, [, v]) => s + v, 0);
    const total = top5.reduce((s, r) => s + r.value, 0) + rest;
    return { top5, rest, restCount: Math.max(0, sorted.length - 5), total, top5Share: total > 0 ? (top5.reduce((s, r) => s + r.value, 0) / total) * 100 : 0 };
  }, [pnls, curMonths, clientById, allNames]);

  // ==== Cần hành động — mỗi thẻ kèm hành động thật (điều hướng qua hash) ====
  const actions = useMemo(() => {
    const cards: { tone: 'red' | 'amber' | 'green'; title: string; body: string; actionLabel: string; go: () => void }[] = [];
    const goClient = (id: string) => () => { window.location.hash = `#/client-detail/${id}`; };
    const unpaidClientIds = new Set(unpaid.map(r => r.client_id));
    for (const r of laborByClient) {
      if (r.delta !== null && r.delta <= -20 && unpaidClientIds.has(r.client.id)) {
        cards.push({ tone: 'red', title: `${r.client.name} mất ${-r.delta!} LĐ + còn công nợ`, body: 'Rủi ro kép: giảm lao động mạnh trong khi vẫn còn hoá đơn chưa thanh toán. Liên hệ ngay để giữ khách và thu hồi nợ.', actionLabel: 'Mở hồ sơ khách hàng →', go: goClient(r.client.id) });
        break;
      }
    }
    const urgent = expiring.find(r => {
      const t = renewalTasks[r.client.id];
      return r.days <= 30 && (!t || t.status === 'pending');
    });
    if (urgent) {
      const rev = latestRevByClient[urgent.client.id] || 0;
      cards.push({ tone: 'red', title: `HĐ ${urgent.client.name} còn ${urgent.days} ngày`, body: `${rev > 0 ? formatCurrency(rev) + '/tháng ' : ''}việc tái ký chưa được xử lý trong Workspace. Đặt lịch gặp trong tuần này.`, actionLabel: 'Mở hồ sơ khách hàng →', go: goClient(urgent.client.id) });
    }
    const lagger = leaderboard.find(r => r.attainment !== null && r.attainment < elapsed * 100 - 8);
    if (lagger) {
      cards.push({ tone: 'amber', title: `${lagger.key} chậm mục tiêu ${Math.round(elapsed * 100 - (lagger.attainment || 0))} điểm`, body: `Đạt ${Math.round(lagger.attainment || 0)}% khi kỳ đã qua ${Math.round(elapsed * 100)}%. Rà kế hoạch tuyển và đơn hàng của chi nhánh.`, actionLabel: 'Xem chi nhánh →', go: () => { window.location.hash = '#/branches'; } });
    }
    const gainer = movers.find(r => (r.delta || 0) > 0);
    if (gainer) {
      cards.push({ tone: 'green', title: `${gainer.client.name} tăng ${gainer.delta} LĐ — cơ hội`, body: 'Lao động tăng mạnh. Xem lại ngưỡng khoán và đàm phán mở rộng hợp tác.', actionLabel: 'Mở hồ sơ khách hàng →', go: goClient(gainer.client.id) });
    }
    return cards.slice(0, 4);
  }, [laborByClient, unpaid, expiring, leaderboard, elapsed, movers, latestRevByClient]); // eslint-disable-line react-hooks/exhaustive-deps

  const fmtTr = (v: number) => Math.round(v).toLocaleString('vi-VN');

  // ==== Xuất Excel — 4 sheet: Tổng quan, Chi nhánh, Hợp đồng, Công nợ ====
  const [exporting, setExporting] = useState(false);
  const exportExcel = async () => {
    setExporting(true);
    try {
      const ExcelJS = (await import('exceljs')).default;
      const wb = new ExcelJS.Workbook();
      const toTr = (v: number) => Math.round(v / 1e6);

      const s1 = wb.addWorksheet('Tổng quan');
      s1.columns = [{ width: 34 }, { width: 20 }];
      s1.addRows([
        ['Kỳ báo cáo', periodLabel(mode, selMonth)],
        ['Doanh thu (triệu)', toTr(revenue)],
        ['Mục tiêu (triệu)', totalTarget > 0 ? toTr(totalTarget) : 'Chưa nhập'],
        ['% đạt mục tiêu', attainment !== null ? `${Math.round(attainment)}%` : '—'],
        ['Lợi nhuận gộp (triệu)', toTr(profit)],
        ['Biên lợi nhuận', `${margin.toFixed(1)}%`],
        ['Tổng lao động hiện tại', totalWorkers],
        ['Biến động ròng (so tháng trước)', laborNet],
        ['Vào / Ra (theo KH)', `${laborGains} / ${laborLosses}`],
        ['Đáp ứng cam kết', fillRate !== null ? `${fillRate.toFixed(1)}%` : 'Chưa có KH đặt cam kết'],
        ['Doanh thu / LĐ / tháng (triệu)', toTr(revPerWorker)],
        ['Công nợ chưa thu (triệu)', toTr(debt.total)],
      ]);
      s1.getColumn(1).font = { bold: true };

      const s2 = wb.addWorksheet('Chi nhánh');
      s2.addRow(['#', 'Chi nhánh', 'Doanh thu (triệu)', 'Mục tiêu (triệu)', '% đạt', 'Tăng trưởng so kỳ trước']).font = { bold: true };
      leaderboard.forEach((r, i) => s2.addRow([
        i + 1, r.key, toTr(r.cur), r.target > 0 ? toTr(r.target) : '',
        r.attainment !== null ? `${Math.round(r.attainment)}%` : '',
        r.growth !== null ? `${Math.round(r.growth)}%` : '',
      ]));
      s2.columns = [{ width: 5 }, { width: 28 }, { width: 18 }, { width: 18 }, { width: 10 }, { width: 22 }];

      const s3 = wb.addWorksheet('Hợp đồng 90 ngày');
      s3.addRow(['Khách hàng', 'Ngày hết hạn', 'Còn (ngày)', 'DT tháng gần nhất (triệu)', 'Tiến độ tái ký', 'Ghi chú mới nhất']).font = { bold: true };
      expiring.forEach(({ client: c, days }) => {
        const info = renewalInfo(c);
        s3.addRow([
          c.name, formatDate(c.contract_end), days,
          latestRevByClient[c.id] ? toTr(latestRevByClient[c.id]) : '',
          info.label,
          info.comment ? `${info.comment.user_name}: ${info.comment.content}` : (info.task?.notes || ''),
        ]);
      });
      s3.columns = [{ width: 30 }, { width: 14 }, { width: 12 }, { width: 24 }, { width: 16 }, { width: 50 }];

      const s4 = wb.addWorksheet('Công nợ');
      s4.addRow(['Khách hàng', 'Tháng', 'Số tiền (triệu)', 'Trễ (tháng)']).font = { bold: true };
      const curNum = (() => { const c = currentMonthStr(); return Number(c.split('-')[0]) * 12 + Number(c.split('-')[1]); })();
      unpaid.forEach(r => s4.addRow([
        clientById[r.client_id]?.name || allNames[r.client_id] || r.clients?.name || 'KH',
        monthLabel(r.month), toTr(r.revenue || 0),
        Math.max(0, curNum - (Number(r.month.split('-')[0]) * 12 + Number(r.month.split('-')[1]))),
      ]));
      s4.columns = [{ width: 30 }, { width: 16 }, { width: 16 }, { width: 12 }];

      const buf = await wb.xlsx.writeBuffer();
      const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `bao-cao-dieu-hanh-${selMonth}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      notify('Đã xuất báo cáo Excel.');
    } catch {
      notify('Xuất Excel thất bại — thử lại.');
    }
    setExporting(false);
  };

  return (
    <>
      <PageHeader
        title="Trung tâm điều hành kinh doanh"
        subtitle={
          mode === 'month' && selMonth === currentMonthStr()
            ? `${periodLabel(mode, selMonth)} · ngày ${new Date().getDate()}/${new Date(Number(selMonth.split('-')[0]), Number(selMonth.split('-')[1]), 0).getDate()} · dữ liệu thời gian thực`
            : `${periodLabel(mode, selMonth)} · doanh thu, lợi nhuận, lao động theo chi nhánh`
        }
        actions={
          <div className="flex items-center gap-2">
            <div className="flex bg-[#F9F9F7] border border-[#E8E7E2] rounded-lg overflow-hidden">
              {(['month', 'quarter', 'year'] as PeriodMode[]).map(m => (
                <button key={m} onClick={() => setMode(m)}
                  className={`px-3 py-1.5 text-[12px] ${mode === m ? 'bg-navy text-white font-medium' : 'text-[#555] hover:bg-[#F0EEE9]'}`}>
                  {m === 'month' ? 'Tháng' : m === 'quarter' ? 'Quý' : 'Năm'}
                </button>
              ))}
            </div>
            <input type="month" value={selMonth} onChange={e => e.target.value && setSelMonth(e.target.value)}
              className="h-[30px] px-2 text-[12px] border border-[#E8E7E2] rounded-lg bg-white" />
            <button onClick={() => setShowTargets(true)}
              className="h-[30px] px-2.5 sm:px-3 text-[12px] border border-[#E8E7E2] rounded-lg bg-white hover:bg-[#F9F9F7] flex items-center gap-1.5">
              <Target size={13} /><span className="hidden sm:inline">Mục tiêu</span>
            </button>
            <button onClick={exportExcel} disabled={exporting}
              className="h-[30px] px-2.5 sm:px-3 text-[12px] border border-[#E8E7E2] rounded-lg bg-white hover:bg-[#F9F9F7] flex items-center gap-1.5 disabled:opacity-50">
              <Download size={13} /><span className="hidden sm:inline">{exporting ? 'Đang xuất…' : 'Xuất'}</span>
            </button>
          </div>
        }
      />
      <div className="flex-1 overflow-y-auto p-3 md:p-5 space-y-3 md:space-y-4">

        {targetsMissing && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5 text-[12px] text-amber-800">
            Chưa có bảng mục tiêu trong database — chạy migration <span className="font-mono">082_branch_targets_renewal.sql</span> (Supabase SQL Editor) để bật thanh tiến độ % mục tiêu và nhập mục tiêu chi nhánh.
          </div>
        )}

        {/* ==== KPI strip ==== */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-2.5">
          <div className="bg-white border border-[#E8E7E2] rounded-[10px] p-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-[#888]">Doanh thu</span>
              {attainment !== null && <span className="text-[10px] font-medium text-[#1D4ED8] bg-blue-50 px-1.5 py-px rounded-full">{Math.round(attainment)}% mục tiêu</span>}
            </div>
            <div className="text-[20px] font-bold text-[#111] mt-1">{formatCurrency(revenue)}</div>
            {attainment !== null ? (
              <>
                <div className="h-1 bg-[#E8E7E2] rounded-full mt-2 overflow-hidden">
                  <div className="h-full bg-[#1D4ED8] rounded-full" style={{ width: `${Math.min(100, attainment)}%` }} />
                </div>
                <div className="text-[10px] text-[#888] mt-1">Mục tiêu {formatCurrency(totalTarget)} · nhịp chuẩn {Math.round(elapsed * 100)}%</div>
              </>
            ) : (
              <div className="text-[10px] text-[#aaa] mt-1.5">Chưa có mục tiêu kỳ này</div>
            )}
            {pace !== null && (
              <div className={`text-[10px] mt-0.5 ${pace >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                Nhịp {pace >= 0 ? 'nhanh hơn' : 'chậm hơn'} kỳ trước {Math.abs(Math.round(pace))}%
              </div>
            )}
          </div>

          <div className="bg-white border border-[#E8E7E2] rounded-[10px] p-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-[#888]">Lợi nhuận gộp</span>
              <span className="text-[10px] font-medium text-emerald-700 bg-emerald-50 px-1.5 py-px rounded-full">biên {margin.toFixed(1)}%</span>
            </div>
            <div className="text-[20px] font-bold text-[#111] mt-1">{formatCurrency(profit)}</div>
            <div className={`text-[10px] mt-1.5 flex items-center gap-1 ${margin >= prevMargin ? 'text-emerald-600' : 'text-red-600'}`}>
              {margin >= prevMargin ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
              {(margin - prevMargin) >= 0 ? '+' : ''}{(margin - prevMargin).toFixed(1)} điểm biên so kỳ trước
            </div>
          </div>

          <div className="bg-white border border-[#E8E7E2] rounded-[10px] p-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-[#888]">Lao động</span>
              <span className={`text-[10px] font-medium px-1.5 py-px rounded-full ${laborNet >= 0 ? 'text-emerald-700 bg-emerald-50' : 'text-red-700 bg-red-50'}`}>ròng {laborNet >= 0 ? '+' : ''}{laborNet}</span>
            </div>
            <div className="text-[20px] font-bold text-[#111] mt-1">{totalWorkers.toLocaleString('vi-VN')}</div>
            <div className="text-[10px] text-[#888] mt-1.5">vào {laborGains} · ra {laborLosses} (theo KH, so tháng trước)</div>
            <div className="text-[10px] text-amber-700 mt-0.5">Chỉ số dẫn dắt doanh thu kỳ sau</div>
          </div>

          <div className={`rounded-[10px] p-3 border ${fillRate !== null && fillRate < 98 ? 'bg-orange-50/50 border-orange-200' : 'bg-white border-[#E8E7E2]'}`}>
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-[#888]">Đáp ứng cam kết</span>
            </div>
            <div className="text-[20px] font-bold text-[#111] mt-1">{fillRate !== null ? `${fillRate.toFixed(1)}%` : '—'}</div>
            {fillRate !== null ? (
              <>
                <div className="h-1 bg-orange-100 rounded-full mt-2 overflow-hidden">
                  <div className={`h-full rounded-full ${fillRate >= 98 ? 'bg-emerald-500' : 'bg-[#D85A30]'}`} style={{ width: `${Math.min(100, fillRate)}%` }} />
                </div>
                <div className="text-[10px] text-[#888] mt-1">hụt {deficit} LĐ · {underCount} KH dưới cam kết</div>
                {missedRevenue > 0 && <div className="text-[10px] font-medium text-red-700 mt-0.5">bỏ lỡ ~{formatCurrency(missedRevenue)}/tháng</div>}
              </>
            ) : (
              <div className="text-[10px] text-[#aaa] mt-1.5">Chưa có KH đặt mức cam kết</div>
            )}
          </div>

          <div className="bg-white border border-[#E8E7E2] rounded-[10px] p-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-[#888]">Doanh thu / LĐ</span>
              <span className="text-[10px] font-medium text-purple-700 bg-purple-50 px-1.5 py-px rounded-full">hiệu suất</span>
            </div>
            <div className="text-[20px] font-bold text-[#111] mt-1">{formatCurrency(revPerWorker)}</div>
            <div className="text-[10px] text-[#888] mt-1.5">bình quân tháng, trên mỗi lao động</div>
          </div>
        </div>

        {/* ==== Doanh thu tích luỹ trong tháng ==== */}
        {mode === 'month' && (
          <div className="bg-white border border-[#E8E7E2] rounded-[10px] p-4">
            <div className="flex items-center justify-between mb-1">
              <div className="text-[12.5px] font-semibold text-[#111]">Doanh thu tích luỹ trong tháng</div>
              {showCumulativeChart && (
                <div className="flex gap-3 text-[10.5px] text-[#666]">
                  <span className="flex items-center gap-1"><span className="w-3.5 h-[2.5px] rounded-sm" style={{ background: C.blue }} />{monthLabel(selMonth)}</span>
                  <span className="flex items-center gap-1"><span className="w-3.5 border-t-2 border-dashed" style={{ borderColor: C.gray }} />{monthLabel(shiftMonth(selMonth, -1))}</span>
                  {totalTarget > 0 && <span className="flex items-center gap-1"><span className="w-3.5 border-t-2 border-dotted" style={{ borderColor: C.coral }} />Mục tiêu {formatCurrency(totalTarget)}</span>}
                </div>
              )}
            </div>
            {showCumulativeChart ? (
              <div style={{ height: 210 }}>
                <Line
                  data={{
                    labels: cumulative.days,
                    datasets: [
                      { label: monthLabel(selMonth), data: cumulative.cur, borderColor: C.blue, backgroundColor: 'rgba(29,78,216,0.07)', fill: true, borderWidth: 2.5, pointRadius: 0, tension: 0.25, spanGaps: false },
                      { label: monthLabel(shiftMonth(selMonth, -1)), data: cumulative.prev, borderColor: C.gray, borderDash: [5, 4], borderWidth: 1.8, pointRadius: 0, tension: 0.25 },
                      ...(totalTarget > 0 ? [{ label: 'Mục tiêu', data: cumulative.days.map(d => (d * totalTarget) / cumulative.days.length / 1e6), borderColor: C.coral, borderDash: [2, 4], borderWidth: 1.5, pointRadius: 0 }] : []),
                    ],
                  }}
                  options={{
                    responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
                    plugins: {
                      legend: { display: false },
                      tooltip: { callbacks: { title: items => `Ngày ${items[0]?.label}`, label: c => `${c.dataset.label}: ${fmtTr(c.parsed.y as number)} tr` } },
                    },
                    scales: {
                      x: { grid: { display: false }, ticks: { font: { size: 10 }, maxTicksLimit: 11 } },
                      y: { ticks: { font: { size: 10 }, callback: v => fmtTr(Number(v)) }, grid: { color: C.grid } },
                    },
                  }}
                />
              </div>
            ) : (
              <div className="text-[12px] text-[#888] bg-[#F9F9F7] rounded-lg px-4 py-3 leading-relaxed">
                Biểu đồ này vẽ từ <span className="font-medium text-[#555]">ngày xuất hoá đơn</span> trong P&L Dự án — hiện hoá đơn có ngày mới bao phủ {Math.round(cumulative.coverage * 100)}% doanh thu {monthLabel(selMonth).toLowerCase()}, chưa đủ để vẽ chính xác.
                Khi đội tài chính nhập hoá đơn kèm ngày (mục Doanh thu trong từng dự án P&L), biểu đồ sẽ tự hiển thị: đường tháng này so với tháng trước theo từng ngày — nhìn là biết đang nhanh hay chậm hơn.
              </div>
            )}
          </div>
        )}

        {/* ==== Xu hướng doanh thu + lao động ==== */}
        <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-2.5">
          <div className="bg-white border border-[#E8E7E2] rounded-[10px] p-4">
            <div className="flex items-center justify-between mb-1">
              <div className="text-[12.5px] font-semibold text-[#111]">Doanh thu · Lợi nhuận {mode === 'quarter' ? 'theo quý' : '12 tháng'}</div>
              <div className="flex gap-3 text-[10.5px] text-[#666]">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm" style={{ background: C.blue }} />Doanh thu</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm" style={{ background: C.green }} />Lợi nhuận</span>
                {hasTargetLine && <span className="flex items-center gap-1"><span className="w-3 border-t-2 border-dashed" style={{ borderColor: C.coral }} />Mục tiêu</span>}
              </div>
            </div>
            <div style={{ height: 230 }}>
              <Bar
                data={{
                  labels: trendData.labels,
                  datasets: [
                    { type: 'bar' as const, label: 'Doanh thu', data: trendData.revenue, backgroundColor: C.blue, borderRadius: 3, barPercentage: 0.55, order: 2 },
                    { type: 'line' as const, label: 'Lợi nhuận', data: trendData.profit, borderColor: C.green, backgroundColor: C.green, borderWidth: 2, pointRadius: 2.5, tension: 0.3, order: 1 },
                    ...(hasTargetLine ? [{ type: 'line' as const, label: 'Mục tiêu', data: trendData.target.map(v => v || null), borderColor: C.coral, borderDash: [4, 4], borderWidth: 1.5, pointRadius: 0, order: 0 }] : []),
                  ] as never,
                }}
                options={{
                  responsive: true, maintainAspectRatio: false,
                  plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${fmtTr(c.parsed.y as number)} tr` } } },
                  scales: {
                    x: { grid: { display: false }, ticks: { font: { size: 10 }, autoSkip: false, maxRotation: 45 } },
                    y: { ticks: { font: { size: 10 }, callback: v => fmtTr(Number(v)) }, grid: { color: C.grid } },
                  },
                }}
              />
            </div>
          </div>
          <div className="bg-white border border-[#E8E7E2] rounded-[10px] p-4">
            <div className="text-[12.5px] font-semibold text-[#111] mb-1">Xu hướng lao động 6 tháng</div>
            <div style={{ height: 230 }}>
              <Line
                data={{
                  labels: laborTrend.labels,
                  datasets: [{ data: laborTrend.totals, borderColor: C.blue, backgroundColor: 'rgba(29,78,216,0.08)', fill: true, tension: 0.3, pointRadius: 3, pointBackgroundColor: C.blue, spanGaps: true }],
                }}
                options={{
                  responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
                  plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `${Number(c.parsed.y).toLocaleString('vi-VN')} người` } } },
                  scales: {
                    x: { grid: { display: false }, ticks: { font: { size: 10 } } },
                    y: { ticks: { font: { size: 10 }, callback: v => Number(v).toLocaleString('vi-VN') }, grid: { color: C.grid } },
                  },
                }}
              />
            </div>
          </div>
        </div>

        {/* ==== Leaderboard chi nhánh ==== */}
        <div className="bg-white border border-[#E8E7E2] rounded-[10px] p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[12.5px] font-semibold text-[#111]">Bảng xếp hạng chi nhánh — {totalTarget > 0 ? '% đạt mục tiêu' : 'doanh thu'} {periodLabel(mode, selMonth).toLowerCase()}</div>
            {totalTarget > 0 && <span className="text-[11px] text-[#888]">{onTrackCount}/{leaderboard.length} đúng tiến độ</span>}
          </div>
          {leaderboard.length === 0 ? (
            <div className="text-[12px] text-[#999] py-4 text-center">Chưa có dữ liệu P&L cho kỳ này</div>
          ) : (
            <div className="space-y-1">
              <div className="hidden sm:grid grid-cols-[24px_1fr_180px_80px_60px] gap-2.5 items-center text-[10.5px] text-[#999] px-1">
                <span>#</span><span>Chi nhánh</span><span>Tiến độ so mục tiêu</span><span className="text-right">Doanh thu</span><span className="text-right">Xu hướng</span>
              </div>
              {visibleLeaderboard.map(r => {
                const lag = r.attainment !== null && r.attainment < elapsed * 100 - 8;
                const isWorstShortcut = !showAllBranches && leaderboard.length > 6 && r.rank === leaderboard.length;
                const warn = lag || isWorstShortcut;
                const rankBadge = (
                  <span className={`w-5 h-5 rounded-full text-[10.5px] font-medium flex items-center justify-center shrink-0 ${r.rank === 1 ? 'bg-amber-100 text-amber-800' : warn ? 'bg-orange-100 text-orange-800' : 'bg-[#F1EFE8] text-[#5F5E5A]'}`}>{r.rank}</span>
                );
                const pctColor = r.attainment === null ? '#bbb' : r.attainment >= elapsed * 100 ? C.green : lag ? '#993C1D' : C.blue;
                const barColor = r.attainment === null ? '#ddd' : r.attainment >= elapsed * 100 ? C.green : lag ? C.coral : C.blue;
                return (
                  <div key={r.key} className={`border-t border-[#F0EEE9] ${warn ? 'bg-orange-50/50 rounded-md' : ''}`}>
                    {/* Mobile: hạng + tên/thanh tiến độ + giá trị */}
                    <div className="flex sm:hidden items-center gap-2.5 px-1 py-2">
                      {rankBadge}
                      <span className="flex-1 min-w-0">
                        <span className="block text-[12px] font-semibold text-[#111] truncate">{r.key}</span>
                        <span className="block h-1 bg-[#F0EEE9] rounded-full overflow-hidden mt-1.5">
                          <span className="block h-full rounded-full" style={{ width: `${r.attainment !== null ? Math.min(100, r.attainment) : 0}%`, background: barColor }} />
                        </span>
                      </span>
                      <span className="text-right shrink-0">
                        <span className="block text-[12px] font-semibold text-[#111]">{formatCurrency(r.cur)}</span>
                        <span className="block text-[10px] font-medium" style={{ color: pctColor }}>
                          {r.attainment !== null ? `${Math.round(r.attainment)}%` : 'chưa có MT'}
                        </span>
                      </span>
                    </div>
                    {/* Desktop: giữ nguyên bảng đầy đủ */}
                    <div className="hidden sm:grid grid-cols-[24px_1fr_180px_80px_60px] gap-2.5 items-center px-1 py-1.5 text-[12px]">
                      {rankBadge}
                      <span className="font-semibold text-[#111] truncate">{r.key}</span>
                      {r.attainment !== null ? (
                        <span className="flex items-center gap-1.5">
                          <span className="flex-1 h-1.5 bg-[#F0EEE9] rounded-full overflow-hidden">
                            <span className="block h-full rounded-full" style={{ width: `${Math.min(100, r.attainment)}%`, background: barColor }} />
                          </span>
                          <span className="text-[11px] font-medium min-w-[32px]" style={{ color: pctColor }}>{Math.round(r.attainment)}%</span>
                        </span>
                      ) : (
                        <span className="text-[11px] text-[#bbb]">— chưa có mục tiêu</span>
                      )}
                      <span className="text-right text-[#111]">{formatCurrency(r.cur)}</span>
                      <span className={`text-right text-[11px] ${r.growth === null ? 'text-[#bbb]' : r.growth > 1 ? 'text-emerald-600' : r.growth < -1 ? 'text-red-600' : 'text-[#888]'}`}>
                        {r.growth === null ? '—' : `${r.growth > 1 ? '▲' : r.growth < -1 ? '▼' : '—'} ${r.growth >= 0 ? '+' : ''}${Math.round(r.growth)}%`}
                      </span>
                    </div>
                  </div>
                );
              })}
              {leaderboard.length > 6 && (
                <button onClick={() => setShowAllBranches(v => !v)}
                  className="text-[11px] text-[#1D4ED8] hover:underline mt-1.5 px-1">
                  {showAllBranches ? 'Thu gọn — chỉ hiện đơn vị tiêu biểu' : `Xem đủ ${leaderboard.length} chi nhánh →`}
                </button>
              )}
            </div>
          )}
        </div>

        {/* ==== Radar hợp đồng + Công nợ ==== */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
          <div className="bg-white border border-[#E8E7E2] rounded-[10px] p-4">
            <div className="text-[12.5px] font-semibold text-[#111] flex items-center gap-1.5"><FileWarning size={14} className="text-amber-600" />Radar hợp đồng hết hạn</div>
            <div className="text-[11px] text-[#888] mt-0.5 mb-2.5">{expiring.length} hợp đồng · {formatCurrency(protectRevenue)}/tháng cần bảo vệ</div>
            <div className="grid grid-cols-3 gap-1.5 mb-2.5">
              {[{ b: b30, label: '≤ 30 ngày', bg: 'bg-red-50', txt: 'text-red-800', sub: 'text-red-600' },
                { b: b60, label: '31–60 ngày', bg: 'bg-amber-50', txt: 'text-amber-800', sub: 'text-amber-600' },
                { b: b90, label: '61–90 ngày', bg: 'bg-[#F1EFE8]', txt: 'text-[#444441]', sub: 'text-[#5F5E5A]' }].map(({ b, label, bg, txt, sub }) => (
                <div key={label} className={`${bg} rounded-lg p-2 text-center`}>
                  <div className={`text-[15px] font-bold ${txt}`}>{b.count}</div>
                  <div className={`text-[10px] ${sub}`}>{label}</div>
                  <div className={`text-[10.5px] font-medium ${txt} mt-0.5`}>{b.revenue > 0 ? formatCurrency(b.revenue) + '/th' : '—'}</div>
                </div>
              ))}
            </div>
            {expiring.length === 0 ? (
              <div className="text-[12px] text-[#999] py-3 text-center">Không có hợp đồng nào hết hạn trong 90 ngày tới</div>
            ) : (
              <div className="space-y-1">
                {expiring.slice(0, 6).map(({ client: c, days }) => {
                  const info = renewalInfo(c);
                  return (
                    <div key={c.id} className="px-2 py-1.5 bg-[#F9F9F7] rounded-md text-[11.5px]">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <span className="font-semibold text-[#111]">{c.name}</span>
                          <span className="text-[#888]"> · {latestRevByClient[c.id] ? formatCurrency(latestRevByClient[c.id]) + '/th' : formatDate(c.contract_end)}</span>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className={`text-[10px] px-1.5 py-px rounded-full ${days <= 30 ? 'bg-red-50 text-red-800' : days <= 60 ? 'bg-amber-50 text-amber-800' : 'bg-[#F1EFE8] text-[#5F5E5A]'}`}>còn {days} ngày</span>
                          <span className={`text-[10px] font-medium px-1.5 py-px rounded-md border ${info.cls}`}>{info.label}</span>
                        </div>
                      </div>
                      {(info.comment || info.task?.notes) && (
                        <div className="text-[10.5px] text-[#777] mt-1 truncate" title={info.comment ? `${info.comment.user_name}: ${info.comment.content}` : info.task?.notes || ''}>
                          <span className="text-[#aaa]">{info.comment ? `${info.comment.user_name} · ${formatDate(info.comment.created_at)}: ` : 'Ghi chú: '}</span>
                          {info.comment ? info.comment.content : info.task?.notes}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="bg-white border border-[#E8E7E2] rounded-[10px] p-4">
            <div className="text-[12.5px] font-semibold text-[#111] flex items-center gap-1.5"><Coins size={14} className="text-blue-700" />Công nợ phải thu</div>
            <div className="text-[11px] text-[#888] mt-0.5 mb-2.5">{unpaid.length} kỳ chưa thanh toán, tính theo tháng ghi nhận</div>
            <div className="text-[20px] font-bold text-[#111] mb-2">{formatCurrency(debt.total)}</div>
            {debt.total > 0 ? (
              <>
                <div className="flex h-3 rounded-full overflow-hidden gap-px mb-1.5">
                  {debt.buckets.map((v, i) => v > 0 && (
                    <div key={i} style={{ width: `${(v / debt.total) * 100}%`, background: ['#93C5FD', '#FCD34D', '#F0997B', '#E24B4A'][i] }} />
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-x-2.5 gap-y-0.5 text-[10.5px] text-[#555] mb-2.5">
                  {['Kỳ hiện tại', 'Trễ 1 tháng', 'Trễ 2 tháng', 'Trễ ≥3 tháng'].map((l, i) => (
                    <span key={l} className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-sm" style={{ background: ['#93C5FD', '#FCD34D', '#F0997B', '#E24B4A'][i] }} />
                      {l} · {formatCurrency(debt.buckets[i])}
                    </span>
                  ))}
                </div>
                <div className="space-y-1">
                  {debt.top.map(({ rec, late }) => (
                    <div key={rec.id} className={`flex items-center justify-between px-2 py-1.5 rounded-md text-[11.5px] ${late >= 2 ? 'bg-red-50' : 'bg-orange-50/60'}`}>
                      <span className={`font-semibold ${late >= 2 ? 'text-red-800' : 'text-orange-900'}`}>
                        {clientById[rec.client_id]?.name || allNames[rec.client_id] || rec.clients?.name || 'KH'} · {formatCurrency(rec.revenue || 0)}
                      </span>
                      <span className={`text-[10px] ${late >= 2 ? 'text-red-700' : 'text-orange-700'}`}>{monthLabel(rec.month)} · trễ {late} tháng</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="text-[12px] text-[#999] py-3 text-center">Không có công nợ chưa thu 🎉</div>
            )}
          </div>
        </div>

        {/* ==== Biến động LĐ + Cơ cấu doanh thu ==== */}
        <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_1fr] gap-2.5">
          <div className="bg-white border border-[#E8E7E2] rounded-[10px] p-4">
            <div className="text-[12.5px] font-semibold text-[#111]">Biến động lao động theo khách hàng</div>
            <div className="text-[11px] text-[#888] mt-0.5 mb-1">Top tăng / giảm so với tháng trước</div>
            {movers.length === 0 ? (
              <div className="text-[12px] text-[#999] py-4 text-center">Chưa có biến động trong kỳ</div>
            ) : (
              <div style={{ height: Math.max(160, movers.length * 32 + 60) }}>
                <Bar
                  data={{
                    labels: movers.map(r => r.client.name.length > 22 ? r.client.name.slice(0, 22) + '…' : r.client.name),
                    datasets: [{ data: movers.map(r => r.delta), backgroundColor: movers.map(r => (r.delta || 0) >= 0 ? C.green : C.red), borderRadius: 3, barPercentage: 0.6 }],
                  }}
                  options={{
                    indexAxis: 'y', responsive: true, maintainAspectRatio: false,
                    plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `${(c.parsed.x as number) > 0 ? '+' : ''}${c.parsed.x} người` } } },
                    scales: {
                      x: { ticks: { font: { size: 10 } }, grid: { color: C.grid } },
                      y: { grid: { display: false }, ticks: { font: { size: 10.5 } } },
                    },
                  }}
                />
              </div>
            )}
          </div>
          <div className="bg-white border border-[#E8E7E2] rounded-[10px] p-4">
            <div className="text-[12.5px] font-semibold text-[#111]">Cơ cấu doanh thu khách hàng</div>
            <div className="text-[11px] text-[#888] mt-0.5 mb-1">
              Top 5 chiếm {Math.round(concentration.top5Share)}% — rủi ro tập trung {concentration.top5Share > 60 ? 'cao' : concentration.top5Share > 40 ? 'trung bình' : 'thấp'}
            </div>
            {concentration.total === 0 ? (
              <div className="text-[12px] text-[#999] py-4 text-center">Chưa có dữ liệu doanh thu kỳ này</div>
            ) : (
              <>
                <div style={{ height: 150 }}>
                  <Doughnut
                    data={{
                      labels: [...concentration.top5.map(r => r.name), `${concentration.restCount} KH khác`],
                      datasets: [{
                        data: [...concentration.top5.map(r => r.value), concentration.rest],
                        backgroundColor: ['#1D4ED8', '#378ADD', '#85B7EB', '#B5D4F4', '#E6F1FB', '#D3D1C7'],
                        borderColor: '#fff', borderWidth: 2,
                      }],
                    }}
                    options={{
                      responsive: true, maintainAspectRatio: false, cutout: '62%',
                      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `${c.label}: ${formatCurrency(Number(c.parsed))}` } } },
                    }}
                  />
                </div>
                <div className="grid grid-cols-2 gap-x-2.5 gap-y-0.5 text-[10.5px] text-[#555] mt-2">
                  {[...concentration.top5.map((r, i) => ({ name: r.name, value: r.value, color: ['#1D4ED8', '#378ADD', '#85B7EB', '#B5D4F4', '#E6F1FB'][i] })),
                    { name: `${concentration.restCount} KH khác`, value: concentration.rest, color: '#D3D1C7' }].map(r => (
                    <span key={r.name} className="flex items-center gap-1 truncate">
                      <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: r.color }} />
                      <span className="truncate">{r.name}</span>
                      <span className="text-[#999] shrink-0">{concentration.total > 0 ? Math.round((r.value / concentration.total) * 100) : 0}%</span>
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* ==== Cần hành động ==== */}
        <div className="bg-white border border-[#E8E7E2] rounded-[10px] p-4">
          <div className="text-[12.5px] font-semibold text-[#111] flex items-center gap-1.5 mb-2.5"><AlertTriangle size={14} className="text-amber-600" />Cần hành động</div>
          {actions.length === 0 ? (
            <div className="text-[12px] text-[#999] py-2">Không có cảnh báo nào — mọi chỉ số trong ngưỡng an toàn.</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2">
              {actions.map((a, i) => {
                const tones = {
                  red: { card: 'bg-red-50 border-red-200', title: 'text-red-800', body: 'text-red-700' },
                  amber: { card: 'bg-amber-50 border-amber-200', title: 'text-amber-800', body: 'text-amber-700' },
                  green: { card: 'bg-emerald-50 border-emerald-200', title: 'text-emerald-800', body: 'text-emerald-700' },
                }[a.tone];
                return (
                  <div key={i} className={`border rounded-[10px] px-3 py-2.5 ${tones.card}`}>
                    <div className={`text-[11.5px] font-semibold ${tones.title}`}>{a.title}</div>
                    <div className={`text-[11px] mt-1 leading-relaxed ${tones.body}`}>{a.body}</div>
                    <button onClick={a.go} className={`text-[11px] font-semibold mt-1.5 hover:underline ${tones.title}`}>{a.actionLabel}</button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ==== Modal nhập mục tiêu ==== */}
      {showTargets && (
        <TargetsModal
          branches={branches}
          month={mode === 'month' ? selMonth : currentMonthStr()}
          targets={targets}
          targetsMissing={targetsMissing}
          onClose={() => setShowTargets(false)}
          onSaved={t => {
            setTargets(prev => {
              const others = prev.filter(x => !(x.branch_id === t.branch_id && x.month === t.month));
              return [...others, t];
            });
          }}
          notify={notify}
        />
      )}

      {toast && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 bg-[#111] text-white text-[12.5px] px-4 py-2.5 rounded-lg shadow-lg z-50">{toast}</div>
      )}
    </>
  );
}

interface TargetsModalProps {
  branches: Branch[];
  month: string;
  targets: BranchTarget[];
  targetsMissing: boolean;
  onClose: () => void;
  onSaved: (t: BranchTarget) => void;
  notify: (msg: string) => void;
}

function TargetsModal({ branches, month, targets, targetsMissing, onClose, onSaved, notify }: TargetsModalProps) {
  const [selMonth, setSelMonth] = useState(month);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const activeBranches = useMemo(() => branches.filter(b => b.status === 'active'), [branches]);

  useEffect(() => {
    const map: Record<string, string> = {};
    for (const b of activeBranches) {
      const t = targets.find(x => x.branch_id === b.id && x.month === selMonth);
      map[b.id] = t && t.revenue_target > 0 ? String(Math.round(t.revenue_target / 1e6)) : '';
    }
    setValues(map);
  }, [selMonth, activeBranches, targets]);

  const save = async () => {
    if (targetsMissing) { notify('Cần chạy migration 082 trước khi lưu mục tiêu.'); return; }
    setSaving(true);
    let ok = 0, fail = 0;
    for (const b of activeBranches) {
      const raw = values[b.id]?.trim();
      if (raw === undefined || raw === '') continue;
      const vnd = (Number(raw.replace(/[,.]/g, '')) || 0) * 1e6;
      const { data, error } = await supabase.from('branch_targets')
        .upsert({ branch_id: b.id, month: selMonth, revenue_target: vnd, updated_at: new Date().toISOString() }, { onConflict: 'branch_id,month' })
        .select().single();
      if (error) fail++;
      else { ok++; onSaved(data as BranchTarget); }
    }
    setSaving(false);
    notify(fail ? `Lưu ${ok} mục tiêu, lỗi ${fail}.` : `Đã lưu mục tiêu ${ok} chi nhánh cho ${monthLabel(selMonth)}.`);
    if (!fail) onClose();
  };

  const total = activeBranches.reduce((s, b) => s + (Number((values[b.id] || '').replace(/[,.]/g, '')) || 0), 0);

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl w-full max-w-[440px] max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#E8E7E2]">
          <div className="text-[13.5px] font-semibold text-[#111] flex items-center gap-1.5"><Settings2 size={15} />Mục tiêu doanh thu chi nhánh</div>
          <button onClick={onClose} className="text-[#888] hover:text-[#111]"><XIcon size={16} /></button>
        </div>
        <div className="px-4 py-3 border-b border-[#E8E7E2] flex items-center gap-2">
          <span className="text-[12px] text-[#555]">Tháng áp dụng</span>
          <input type="month" value={selMonth} onChange={e => e.target.value && setSelMonth(e.target.value)}
            className="h-[30px] px-2 text-[12px] border border-[#E8E7E2] rounded-lg" />
          <span className="ml-auto text-[11px] text-[#888]">Tổng: <span className="font-semibold text-[#111]">{total.toLocaleString('vi-VN')} tr</span></span>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-2">
          {targetsMissing && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-[11px] text-amber-800 my-2">
              Bảng branch_targets chưa tồn tại — chạy migration 082 trong Supabase SQL Editor trước.
            </div>
          )}
          {activeBranches.map(b => (
            <div key={b.id} className="flex items-center justify-between gap-3 py-1.5 border-b border-[#F0EEE9] last:border-0">
              <span className="text-[12px] text-[#111] truncate">{b.name}</span>
              <div className="flex items-center gap-1.5 shrink-0">
                <input
                  type="number" min={0} placeholder="0"
                  value={values[b.id] ?? ''}
                  onChange={e => setValues(v => ({ ...v, [b.id]: e.target.value }))}
                  className="w-[110px] h-[30px] px-2 text-[12px] text-right border border-[#E8E7E2] rounded-lg focus:outline-none focus:border-blue-400"
                />
                <span className="text-[11px] text-[#888]">tr</span>
              </div>
            </div>
          ))}
        </div>
        <div className="px-4 py-3 border-t border-[#E8E7E2] flex justify-end gap-2">
          <button onClick={onClose} className="h-[32px] px-3.5 text-[12px] border border-[#E8E7E2] rounded-lg hover:bg-[#F9F9F7]">Đóng</button>
          <button onClick={save} disabled={saving}
            className="h-[32px] px-3.5 text-[12px] bg-[#1D4ED8] text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
            {saving ? 'Đang lưu…' : 'Lưu mục tiêu'}
          </button>
        </div>
      </div>
    </div>
  );
}
