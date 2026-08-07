import React, { useState, useEffect, useMemo } from 'react';
import { Lock, CheckCircle, Circle, Check, X as XIcon, CalendarCheck, Settings } from 'lucide-react';
import { useHashTab } from '../hooks/useHashSubRoute';
import PageHeader from '../components/PageHeader';
import PnLProjectTab from '../components/finance/PnLProjectTab';
// OverheadTab removed — moved to Chi Nhánh > Tài chính
import PerformanceTab from '../components/finance/PerformanceTab';
import PaymentCalendarTab from '../components/finance/PaymentCalendarTab';
import type { FinanceRecord, Client } from '../lib/types';
import { formatCurrency, monthLabel, shiftMonth } from '../lib/format';
import { calcExpectedDue } from '../lib/paymentDate';
import { resolveDay, normalizeDayRange, anchorDay } from '../utils/timelineDays';
import DayCell from '../components/DayCell';
import { isActiveInMonth, suspensionMonth, formatSuspensionDate } from '../utils/suspension';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { logActivity } from '../lib/audit';
import { useRegions } from '../hooks/useRegions';
import { useManagers } from '../hooks/useManagers';
import { useCostCategories } from '../hooks/useCostCategories';
import { useFinanceData } from '../hooks/useFinanceData';
import { useBranchData } from '../hooks/useBranchData';
import { usePersistedState } from '../hooks/usePersistedState';
import FilterDropdown, { ALL_OPTION } from '../components/FilterDropdown';

type WorkspaceTab = 'clients' | 'pnl' | 'overhead' | 'performance' | 'payment';

const todayFull = new Date();
const todayStr = todayFull.toISOString().split('T')[0];
const todayNum = todayFull.getDate();

function fmtDate(d: string) {
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y}`;
}

// ── Các mốc trên timeline: dùng chung cho chú thích, nút lọc và bảng bật/tắt ──
type TimelinePhaseKey = 'cutoff' | 'calc' | 'invoice' | 'paydue' | 'salary';
const TIMELINE_PHASES: { key: TimelinePhaseKey; label: string; dot: React.ReactNode }[] = [
  { key: 'cutoff', label: 'Chốt công', dot: <span className="inline-block w-3 h-3 rounded-full bg-orange-400" /> },
  { key: 'calc', label: 'Tính lương', dot: <span className="inline-block w-3 h-3 bg-blue-400" style={{ clipPath: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)' }} /> },
  { key: 'invoice', label: 'Xuất HĐ', dot: <span className="inline-block w-3 h-3 rounded-sm bg-cyan-500" /> },
  { key: 'paydue', label: 'Kỳ TT', dot: <span className="inline-block w-3 h-3 rounded-sm bg-emerald-500" /> },
  { key: 'salary', label: 'Phát lương', dot: <span className="inline-block w-3 h-3 rounded-full bg-purple-500" /> },
];
/**
 * Giữ invoice_date (ngày cụ thể) khớp với invoice_day (quy tắc lặp hàng tháng).
 * Giữ nguyên THÁNG của invoice_date cũ, chỉ đổi ngày; -1 = ngày cuối tháng đó,
 * ngày 31 ở tháng 30 ngày thì lùi về 30. Chưa từng có invoice_date thì thôi,
 * không tự bịa ra một tháng.
 */
function syncInvoiceDate(current: string | null | undefined, invoiceDay: number | null): string | null {
  if (!current) return current ?? null;
  if (invoiceDay == null) return null;
  const [y, m] = current.slice(0, 10).split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const day = resolveDay(invoiceDay, daysInMonth) ?? daysInMonth;
  return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

const TIMELINE_VISIBLE_KEY = 'lgvn_finance_timeline_visible_phases';
const ALL_PHASES_VISIBLE: Record<TimelinePhaseKey, boolean> = {
  cutoff: true, calc: true, invoice: true, paydue: true, salary: true,
};

function TimelineStep({ label, day, done, isToday }: { label: string; day: number; done: boolean; isToday: boolean }) {
  return (
    <div className="flex flex-col items-center gap-1 min-w-[56px]">
      <div className={`w-7 h-7 rounded-full flex items-center justify-center border-2 transition-all ${
        done
          ? 'bg-emerald-500 border-emerald-500 text-white'
          : isToday
            ? 'bg-amber-100 border-amber-400 text-amber-600'
            : 'bg-white border-gray-200 text-gray-300'
      }`}>
        {done ? <CheckCircle size={13} strokeWidth={2.5} /> : <Circle size={13} strokeWidth={2} />}
      </div>
      <div className="text-[10px] text-center leading-tight">
        <div className="font-medium text-[#444]">{label}</div>
        <div className="text-[#999]">Ngày {day}</div>
      </div>
    </div>
  );
}

interface FinanceProps {
  finance: FinanceRecord[];
  clients: Client[];
  onLoadFinance: (month: string) => Promise<void>;
  onFinanceUpdate: (record: FinanceRecord) => void;
  onClientUpdate: (client: Client) => void;
  toast: (msg: string) => void;
}

export default function Finance({ finance, clients, onLoadFinance, onFinanceUpdate, onClientUpdate, toast }: FinanceProps) {
  const { user } = useAuth();
  // Tháng của Timeline KH — mặc định THÁNG HIỆN TẠI, nhớ lựa chọn qua F5.
  const [month, setMonth] = usePersistedState('lgvn_finance_timelineMonth', todayStr.slice(0, 7));
  const FINANCE_TAB_KEYS = ['clients', 'pnl', 'performance', 'payment'] as const;
  const [activeTab, setActiveTab] = useHashTab<WorkspaceTab>('finance', FINANCE_TAB_KEYS, 'clients');

  useEffect(() => { onLoadFinance(month); }, [month, onLoadFinance]);

  // ── Finance Workspace (P&L / Hiệu suất / Chi phí cố định) ─────────
  const [selectedMonth, setSelectedMonth] = usePersistedState('lgvn_finance_selectedMonth', month);
  const [overheadBranch, setOverheadBranch] = useState('');
  const workspaceMonths = useMemo(() => {
    const base = todayStr.slice(0, 7);
    const arr: string[] = [];
    const startMonth = '2026-01';
    let cursor = startMonth;
    const endMonth = shiftMonth(base, 2);
    while (cursor <= endMonth) { arr.push(cursor); cursor = shiftMonth(cursor, 1); }
    return arr;
  }, []);

  // Danh sách tháng cho Timeline KH: từ 2026-01 đến tháng hiện tại + 3 (mở sẵn
  // tháng tới để lên lịch trước). Luôn kèm tháng đang chọn phòng khi người dùng
  // đã lưu một tháng nằm ngoài dải (vd xem lại tháng rất cũ).
  const timelineMonths = useMemo(() => {
    const arr: string[] = [];
    let cursor = '2026-01';
    const endMonth = shiftMonth(todayStr.slice(0, 7), 3);
    while (cursor <= endMonth) { arr.push(cursor); cursor = shiftMonth(cursor, 1); }
    if (!arr.includes(month)) arr.push(month);
    return arr.sort().reverse();
  }, [month]);
  const finData = useFinanceData();

  // ── Shared filters ────────────────────────────────────────────────
  const [filterRegion, setFilterRegion] = usePersistedState<string[]>('lgvn_finance_filterRegion', [ALL_OPTION]);
  const [filterManager, setFilterManager] = usePersistedState<string[]>('lgvn_finance_filterManager', [ALL_OPTION]);

  type TimelinePhase = TimelinePhaseKey;
  const [timelinePhase, setTimelinePhase] = useState<TimelinePhase | null>(null);
  // Bật/tắt từng loại mốc trên timeline (nút bánh răng) — nhớ qua F5.
  const [visiblePhases, setVisiblePhases] = usePersistedState<Record<TimelinePhaseKey, boolean>>(
    TIMELINE_VISIBLE_KEY, ALL_PHASES_VISIBLE,
  );
  const [showPhaseSettings, setShowPhaseSettings] = useState(false);
  const isPhaseOn = (k: TimelinePhaseKey) => visiblePhases[k] !== false;
  const togglePhase = (k: TimelinePhaseKey) => {
    setVisiblePhases({ ...visiblePhases, [k]: !isPhaseOn(k) });
    // Đang lọc theo mốc vừa tắt thì bỏ luôn bộ lọc, tránh sắp xếp theo thứ không còn hiện.
    if (isPhaseOn(k) && timelinePhase === k) setTimelinePhase(null);
  };

  // ── Timeline edit modal (opened by clicking a company name) ──────
  const [editClient, setEditClient] = useState<Client | null>(null);
  const [editForm, setEditForm] = useState({
    cutoff_day: null as number | null, cutoff_day_end: null as number | null,
    calc_day: null as number | null, calc_day_end: null as number | null,
    invoice_day: null as number | null, invoice_day_end: null as number | null,
    payment_start: null as number | null, payment_end: null as number | null,
    salary_day: null as number | null, salary_day_end: null as number | null,
    extra_salary_days: [] as { start: number; end: number | null }[],
    extra_calc_days: [] as { start: number; end: number | null }[],
    // Điều khoản thanh toán — cùng cột DB với "Điều khoản thanh toán" trong hồ sơ
    // khách hàng, sửa ở đây hay ở đó đều ghi vào một chỗ nên luôn đồng bộ.
    payment_group: 1 as number,
    payment_days: 15 as number,
    payment_fixed_day: 10 as number,
    payment_cutoff: 5 as number,
  });

  // ── Date picker modal state ───────────────────────────────────────
  const [payModal, setPayModal] = useState<{ recId: string; date: string } | null>(null);

  const { regions: regionList } = useRegions();
  const { managers: managerList } = useManagers();
  const { branches: branchList } = useBranchData();
  const { categories: costCategories, add: addCostCat, rename: renameCostCat, remove: removeCostCat, toggleDefault: toggleCostCatDefault, setGroupType: setCostCatGroup, setDefaultPayer: setCostCatPayer } = useCostCategories();

  useEffect(() => {
    if (!overheadBranch && managerList.length) setOverheadBranch(managerList[0].name);
  }, [managerList, overheadBranch]);

  const regions = useMemo(() => [ALL_OPTION, ...regionList.map(r => r.name)], [regionList]);
  const managers = useMemo(() => [ALL_OPTION, ...managerList.map(m => m.name)], [managerList]);

  // Timeline/Trạng thái TT xem theo tháng: khách đã ngưng vẫn hiện ở các tháng
  // tính đến hết tháng ngưng (tháng đó vẫn còn chốt công, xuất HĐ, thu tiền).
  const filteredClients = useMemo(() => clients.filter(c => {
    if (!isActiveInMonth(c, month)) return false;
    const okR = filterRegion.includes(ALL_OPTION) || filterRegion.includes(c.region || '');
    const okM = filterManager.includes(ALL_OPTION) || filterManager.includes(c.manager || '');
    return okR && okM;
  }), [clients, filterRegion, filterManager, month]);

  // ── Calendar dimensions (used by Gantt timeline) ──────────────────
  const [calYear, calMonthNum] = month.split('-').map(Number);
  const daysInMonth = new Date(calYear, calMonthNum, 0).getDate();

  const sortedTimelineClients = useMemo(() => {
    if (!timelinePhase) return filteredClients;
    const today = new Date();
    const todayD = today.getDate();
    const isCurrentMonth = today.getFullYear() === calYear && today.getMonth() + 1 === calMonthNum;
    const ref = isCurrentMonth ? todayD : 1;
    const getRange = (c: Client): [number | null, number | null] => {
      const rd2 = (v: number | null | undefined): number | null => resolveDay(v, daysInMonth);
      const pair = (s: number | null | undefined, e: number | null | undefined): [number | null, number | null] => {
        const n = normalizeDayRange(s, e);
        return [rd2(n.start), rd2(n.end)];
      };
      switch (timelinePhase) {
        case 'cutoff': return pair(c.cutoff_day, c.cutoff_day_end);
        case 'calc': return pair(c.calc_day, c.calc_day_end);
        case 'salary': return pair(c.salary_day, c.salary_day_end);
        case 'invoice': return pair(c.invoice_day, c.invoice_day_end);
        case 'paydue': {
          const autoInv = rd2(anchorDay(c.invoice_day, c.invoice_day_end));
          const invDate = autoInv ? new Date(calYear, calMonthNum - 1, autoInv) : null;
          const due = invDate ? calcExpectedDue(c, invDate) : null;
          const dueDay = due?.date?.getMonth() === calMonthNum - 1 ? due.date.getDate() : null;
          return [dueDay, null];
        }
        default: return [null, null];
      }
    };
    const scored = filteredClients.map(c => {
      const [start, end] = getRange(c);
      if (start == null) return { c, score: 9999 };
      const endD = end ?? start;
      if (ref >= start && ref <= endD) return { c, score: -1 };
      const dist = start >= ref ? start - ref : ref - endD;
      return { c, score: dist };
    });
    scored.sort((a, b) => a.score - b.score);
    return scored.map(s => s.c);
  }, [filteredClients, timelinePhase, calYear, calMonthNum, daysInMonth]);

  const startEdit = (c: Client) => {
    setEditClient(c);
    setEditForm({
      cutoff_day: c.cutoff_day, cutoff_day_end: c.cutoff_day_end,
      calc_day: c.calc_day, calc_day_end: c.calc_day_end,
      invoice_day: c.invoice_day ?? null, invoice_day_end: c.invoice_day_end ?? null,
      payment_start: c.payment_start, payment_end: c.payment_end,
      salary_day: c.salary_day, salary_day_end: c.salary_day_end,
      extra_salary_days: Array.isArray(c.extra_salary_days) ? c.extra_salary_days : [],
      extra_calc_days: Array.isArray((c as any).extra_calc_days) ? (c as any).extra_calc_days : [],
      payment_group: c.payment_group ?? 1,
      payment_days: c.payment_days ?? 15,
      payment_fixed_day: c.payment_fixed_day ?? 10,
      payment_cutoff: c.payment_cutoff ?? 5,
    });
  };

  const handleSaveEdit = async () => {
    if (!editClient) return;
    const c = editClient;
    // Luu DUNG o nguoi dung da nhap: xoa o "bat dau" roi chi dat o "ket thuc" thi
    // gia tri phai nam o "ket thuc" sau khi luu (truoc day bi don ve "bat dau" nen
    // mo lai thay nhu chua luu). Cho hien thi timeline van coi 1 o = moc 1 ngay.
    const keep = (s: number | null, e: number | null) =>
      s == null && e == null ? { start: null, end: null } : { start: s, end: e };
    const cutoff = keep(editForm.cutoff_day, editForm.cutoff_day_end);
    const calc = keep(editForm.calc_day, editForm.calc_day_end);
    const salary = keep(editForm.salary_day, editForm.salary_day_end);
    const normForm = {
      ...editForm,
      cutoff_day: cutoff.start, cutoff_day_end: cutoff.end,
      calc_day: calc.start, calc_day_end: calc.end,
      salary_day: salary.start, salary_day_end: salary.end,
      extra_calc_days: editForm.extra_calc_days.filter(ex => ex.start != null || ex.end != null) as { start: number; end: number | null }[],
      extra_salary_days: editForm.extra_salary_days.filter(ex => ex.start != null || ex.end != null) as { start: number; end: number | null }[],
    };
    // invoice_date là NGÀY CỤ THỂ (Lịch Thu Tiền & Điều khoản thanh toán đang đọc).
    // Đổi "ngày xuất HĐ" ở đây thì kéo invoice_date theo cho khỏi lệch: giữ nguyên
    // tháng cũ, chỉ thay ngày, quy đúng theo số ngày thực tế của tháng đó.
    const invoiceDate = syncInvoiceDate(c.invoice_date, anchorDay(normForm.invoice_day, normForm.invoice_day_end));
    const updates = { ...normForm, invoice_date: invoiceDate, updated_at: new Date().toISOString() };
    const { error } = await supabase.from('clients').update(updates).eq('id', c.id);
    if (error) { toast('Lỗi: ' + error.message); return; }
    onClientUpdate({ ...c, ...normForm, invoice_date: invoiceDate ?? undefined });
    setEditClient(null);
    toast('Đã cập nhật timeline!');
    await logActivity({
      user, action: 'update', table: 'clients', recordId: c.id,
      description: `Cập nhật timeline (chốt công/tính lương/kỳ TT/phát lương) cho "${c.name}"`,
      oldData: c, newData: { ...c, ...updates },
    });
  };

  // ── Finance records ───────────────────────────────────────────────
  // Sort: unpaid first, paid last
  const sortedFinance = useMemo(() => {
    const activeIds = new Set(clients.map(c => c.id));
    return finance.filter(r => activeIds.has(r.client_id)).sort((a, b) => Number(a.paid_status) - Number(b.paid_status));
  }, [finance, clients]);

  const pnlMonth = finData.projectsPnl.filter(p => p.month === selectedMonth);
  const pnlTotalRev = pnlMonth.reduce((s, p) => s + (p.revenue || 0), 0);
  const pnlTotalCost = pnlMonth.reduce((s, p) => {
    const cs = finData.pnlCosts[p.id] || [];
    return s + cs.reduce((ss, c) => ss + (c.value || 0), 0);
  }, 0);
  const finRev = sortedFinance.reduce((s, r) => s + (r.revenue || 0), 0);
  const finCost = sortedFinance.reduce((s, r) => s + (r.cost_labor || 0) + (r.cost_mgmt || 0) + (r.cost_other || 0), 0);
  const totalRev = pnlTotalRev || finRev;
  const totalCost = pnlTotalCost || finCost;
  const totalProfit = totalRev - totalCost;
  const paidCount = sortedFinance.filter(r => r.paid_status).length;
  const monthTitle = month === '2026-06' ? 'Tháng 6/2026' : 'Tháng 5/2026';

  // Mark as paid — open date picker
  const openPayModal = (recId: string) => {
    setPayModal({ recId, date: todayStr });
  };

  const confirmPayment = async () => {
    if (!payModal) return;
    const rec = finance.find(r => r.id === payModal.recId);
    if (!rec) return;
    const { error } = await supabase.from('finance_records').update({
      paid_status: true,
      paid_date: payModal.date,
    }).eq('id', payModal.recId);
    if (error) { toast('Lỗi: ' + error.message); return; }
    onFinanceUpdate({ ...rec, paid_status: true, paid_date: payModal.date });
    setPayModal(null);
    toast(`Đã đánh dấu TT ngày ${fmtDate(payModal.date)}`);
    const cName = clients.find(c => c.id === rec.client_id)?.name || rec.client_id;
    await logActivity({
      user, action: 'update', table: 'finance_records', recordId: rec.id,
      description: `Đánh dấu đã thanh toán cho "${cName}" ngày ${fmtDate(payModal.date)}`,
      oldData: rec, newData: { ...rec, paid_status: true, paid_date: payModal.date },
    });
  };

  const undoPaid = async (rec: FinanceRecord) => {
    const { error } = await supabase.from('finance_records').update({
      paid_status: false,
      paid_date: null,
    }).eq('id', rec.id);
    if (error) { toast('Lỗi: ' + error.message); return; }
    onFinanceUpdate({ ...rec, paid_status: false, paid_date: null });
    toast('Đã hủy trạng thái thanh toán');
    const cName = clients.find(c => c.id === rec.client_id)?.name || rec.client_id;
    await logActivity({
      user, action: 'update', table: 'finance_records', recordId: rec.id,
      description: `Hủy trạng thái thanh toán cho "${cName}"`,
      oldData: rec, newData: { ...rec, paid_status: false, paid_date: null },
    });
  };

  // ── Access guard ──────────────────────────────────────────────────
  if (user?.role === 'kinhdoanh') {
    return (
      <>
        <PageHeader title="Tài chính" subtitle="Timeline · Chi phí · Khoán · Trạng thái TT" />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center py-8">
            <Lock size={36} className="text-gray-300 mx-auto mb-3" />
            <p className="text-[13px] text-[#888]">Chỉ Admin, Kế Toán và BĐH mới xem được Tài chính</p>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Tài chính"
        subtitle="Timeline · Chi phí · Khoán · Trạng thái TT"
        actions={
          <div className="flex items-center gap-2.5">
            {activeTab === 'clients' ? (
              <select
                value={month}
                onChange={e => { setMonth(e.target.value); setEditClient(null); }}
                className="text-[12.5px] px-2.5 py-1.5 border border-gray-300 rounded-lg outline-none"
              >
                {timelineMonths.map(m => (
                  <option key={m} value={m}>
                    {monthLabel(m)}{m === todayStr.slice(0, 7) ? ' (tháng này)' : ''} · {new Date(+m.split('-')[0], +m.split('-')[1], 0).getDate()} ngày
                  </option>
                ))}
              </select>
            ) : (
              <select
                value={selectedMonth}
                onChange={e => setSelectedMonth(e.target.value)}
                className="text-[12.5px] px-2.5 py-1.5 border border-gray-300 rounded-lg outline-none"
              >
                {workspaceMonths.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
              </select>
            )}
            <div className="flex items-center bg-gray-100 rounded-lg p-0.5">
              <button
                onClick={() => setActiveTab('clients')}
                className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-all ${activeTab === 'clients' ? 'bg-white shadow-sm text-[#111]' : 'text-[#999] hover:text-[#555]'}`}
              >
                Timeline KH
              </button>
              <button
                onClick={() => setActiveTab('pnl')}
                className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-all ${activeTab === 'pnl' ? 'bg-white shadow-sm text-[#111]' : 'text-[#999] hover:text-[#555]'}`}
              >
                P&L Dự án
              </button>
              <button
                onClick={() => setActiveTab('performance')}
                className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-all ${activeTab === 'performance' ? 'bg-white shadow-sm text-[#111]' : 'text-[#999] hover:text-[#555]'}`}
              >
                Hiệu suất CN
              </button>
              <button
                onClick={() => setActiveTab('payment')}
                className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-all ${activeTab === 'payment' ? 'bg-white shadow-sm text-[#111]' : 'text-[#999] hover:text-[#555]'}`}
              >
                💰 Lịch Thu Tiền
              </button>
            </div>
          </div>
        }
      />

      <div className="flex-1 overflow-y-auto p-5 space-y-4">

        {/* ── KPI cards — always visible at top ── */}
        <div className="grid grid-cols-4 gap-2.5">
          <div className="bg-white border border-[#E8E7E2] rounded-xl p-3.5">
            <div className="text-[11.5px] text-[#888] mb-1">Doanh thu</div>
            <div className="text-[20px] font-semibold text-[#1D4ED8]">{formatCurrency(totalRev)}</div>
            <div className="text-[11px] text-[#aaa] mt-0.5">+8.3% so T5</div>
          </div>
          <div className="bg-white border border-[#E8E7E2] rounded-xl p-3.5">
            <div className="text-[11.5px] text-[#888] mb-1">Tổng chi phí</div>
            <div className="text-[20px] font-semibold text-red-600">{formatCurrency(totalCost)}</div>
            <div className="text-[11px] text-[#aaa] mt-0.5">&nbsp;</div>
          </div>
          <div className="bg-white border border-[#E8E7E2] rounded-xl p-3.5">
            <div className="text-[11.5px] text-[#888] mb-1">Lợi nhuận gộp</div>
            <div className="text-[20px] font-semibold text-emerald-600">{formatCurrency(totalProfit)}</div>
            <div className="text-[11px] text-[#aaa] mt-0.5">
              Margin {totalRev > 0 ? ((totalProfit / totalRev) * 100).toFixed(1) : 0}%
            </div>
          </div>
          <div className="bg-white border border-[#E8E7E2] rounded-xl p-3.5">
            <div className="text-[11.5px] text-[#888] mb-1">Đã thanh toán</div>
            <div className="text-[20px] font-semibold text-[#111]">
              {paidCount}
              <span className="text-[14px] text-[#aaa] font-normal">/{sortedFinance.length}</span>
            </div>
            <div className="text-[11px] text-[#aaa] mt-0.5">khách hàng</div>
          </div>
        </div>

        {/* ══ MODE 1: Timeline Khách hàng (Gantt) ══ */}
        {activeTab === 'clients' && (
          <>
            {/* Filter: Region + Manager dropdowns */}
            <div className="flex items-center gap-2.5 flex-wrap">
              <FilterDropdown label="Chi nhánh" options={regions} selected={filterRegion} onChange={setFilterRegion} allLabel="Tất cả chi nhánh" />
              <FilterDropdown label="Quản lý" options={managers} selected={filterManager} onChange={setFilterManager} allLabel="Tất cả quản lý" />
              {(!filterRegion.includes(ALL_OPTION) || !filterManager.includes(ALL_OPTION)) && (
                <button
                  onClick={() => { setFilterRegion([ALL_OPTION]); setFilterManager([ALL_OPTION]); }}
                  className="text-[11.5px] text-blue-600 hover:underline"
                >
                  Xóa lọc
                </button>
              )}
              <span className="ml-auto text-[11.5px] text-[#aaa]">{filteredClients.length} khách hàng</span>
            </div>

            {/* Gantt chart */}
            <div className="bg-white border border-[#E8E7E2] rounded-[10px] overflow-hidden">
              <div className="px-4 py-2.5 border-b border-[#E8E7E2] flex items-center justify-between">
                <span className="text-[12.5px] font-semibold text-[#111]">Timeline {monthTitle}</span>
                <div className="flex items-center gap-1 text-[11px]">
                  {TIMELINE_PHASES.filter(p => isPhaseOn(p.key)).map(item => (
                    <button key={item.key} onClick={() => setTimelinePhase(timelinePhase === item.key ? null : item.key)}
                      title={`Bấm để sắp xếp khách hàng theo mốc "${item.label}"`}
                      className={`flex items-center gap-1.5 px-2 py-1 rounded-full transition ${timelinePhase === item.key ? 'bg-gray-200 text-[#111] font-semibold' : 'text-[#888] hover:bg-gray-100'}`}>
                      {item.dot} {item.label}
                    </button>
                  ))}
                  {/* Bánh răng: chọn mốc nào hiện / mốc nào ẩn trên timeline */}
                  <div className="relative">
                    <button
                      onClick={() => setShowPhaseSettings(v => !v)}
                      title="Tuỳ chỉnh mốc hiển thị"
                      className={`p-1.5 rounded-lg border transition ${showPhaseSettings ? 'bg-blue-50 border-blue-200 text-blue-700' : 'border-transparent text-[#999] hover:bg-gray-100 hover:text-[#555]'}`}
                    >
                      <Settings size={13} />
                    </button>
                    {showPhaseSettings && (
                      <>
                        <div className="fixed inset-0 z-10" onClick={() => setShowPhaseSettings(false)} />
                        <div className="absolute right-0 top-full mt-1.5 z-20 w-[210px] bg-white border border-[#E8E7E2] rounded-[12px] shadow-xl p-3 space-y-1.5">
                          <div className="text-[12px] font-semibold text-[#111] mb-1">Mốc hiển thị trên timeline</div>
                          {TIMELINE_PHASES.map(p => (
                            <label key={p.key} className="flex items-center gap-2 px-1 py-1 rounded-lg cursor-pointer hover:bg-[#F9F9F7]">
                              <input
                                type="checkbox"
                                checked={isPhaseOn(p.key)}
                                onChange={() => togglePhase(p.key)}
                                className="w-3.5 h-3.5 accent-blue-600"
                              />
                              {p.dot}
                              <span className="text-[12px] text-[#444]">{p.label}</span>
                            </label>
                          ))}
                          <button
                            onClick={() => { setVisiblePhases(ALL_PHASES_VISIBLE); setShowPhaseSettings(false); }}
                            className="w-full mt-1 py-1 rounded-lg text-[11px] font-medium border border-gray-300 text-[#666] hover:bg-[#F9F9F7] transition"
                          >
                            Hiện lại tất cả
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
              <div className="overflow-x-auto">
                <div className="flex border-b border-[#E8E7E2] bg-[#F9F9F7]" style={{ minWidth: 900 }}>
                  <div className="w-[180px] shrink-0 px-3 py-1.5 text-[11px] text-[#888] font-medium border-r border-[#E8E7E2]">Công ty</div>
                  <div className="flex-1 relative" style={{ height: 28 }}>
                    {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(d => (
                      <div key={d} className="absolute text-[10px] text-[#bbb] text-center"
                        style={{ left: `${((d - 1) / daysInMonth) * 100}%`, width: `${100 / daysInMonth}%`, top: 6 }}>
                        {d % 5 === 0 || d === 1 ? d : ''}
                      </div>
                    ))}
                    <div className="absolute top-0 bottom-0 w-px bg-red-400 z-10"
                      style={{ left: `${((todayNum - 1) / daysInMonth) * 100}%` }} />
                    <div className="absolute text-[9px] font-bold text-red-500 z-20"
                      style={{ left: `${((todayNum - 1) / daysInMonth) * 100}%`, top: -2, transform: 'translateX(-50%)' }}>{todayNum}</div>
                  </div>
                </div>
                <div className="overflow-y-auto" style={{ maxHeight: 640 }}>
                {sortedTimelineClients.length === 0 ? (
                  <div className="text-center py-10 text-[#aaa] text-[13px]" style={{ minWidth: 900 }}>
                    Không có khách hàng
                  </div>
                ) : sortedTimelineClients.map(c => {
                  const isRecruitment = c.service_type === 'recruitment';
                  // -1 (EOM) = cuoi thang: tu nhay theo so ngay thuc te cua thang dang xem
                  const rd = (v: number | null | undefined): number | null => resolveDay(v, daysInMonth);
                  // Chi nhap "ngay ket thuc" => coi nhu moc 1 ngay
                  const nr = (s: number | null | undefined, e: number | null | undefined) => normalizeDayRange(s, e);

                  const cutoffRange = nr(c.cutoff_day, c.cutoff_day_end);
                  const cutoffDay = rd(cutoffRange.start);
                  const cutoffEnd = rd(cutoffRange.end);
                  const cutoffEndOk = cutoffEnd != null && cutoffDay != null && cutoffEnd > cutoffDay ? cutoffEnd : null;
                  const cutoffX = cutoffDay != null ? ((Math.min(cutoffDay - 1, daysInMonth - 1)) / daysInMonth) * 100 : null;
                  const cutoffEndX = cutoffEndOk != null ? (cutoffEndOk / daysInMonth) * 100 : null;

                  const calcRange = nr(c.calc_day, c.calc_day_end);
                  const calcDay = rd(calcRange.start);
                  const calcEnd = rd(calcRange.end);
                  const calcEndOk = calcEnd != null && calcDay != null && calcEnd > calcDay ? calcEnd : null;
                  const calcX = calcDay != null ? ((Math.min(calcDay - 1, daysInMonth - 1)) / daysInMonth) * 100 : null;
                  const calcEndX = calcEndOk != null ? (calcEndOk / daysInMonth) * 100 : null;

                  // Xuat HD: lay tu invoice_day / invoice_day_end (dung chung voi Dieu khoan thanh toan)
                  const invoiceRange = nr(c.invoice_day, c.invoice_day_end);
                  const autoInvoiceDay = rd(invoiceRange.start);
                  const invoiceDay = autoInvoiceDay;
                  const invoiceEnd = rd(invoiceRange.end);
                  const invoiceEndOk = invoiceEnd != null && invoiceDay != null && invoiceEnd > invoiceDay ? invoiceEnd : null;
                  const invoiceX = invoiceDay != null ? ((Math.min(invoiceDay - 1, daysInMonth - 1)) / daysInMonth) * 100 : null;
                  const invoiceEndX = invoiceEndOk != null ? (invoiceEndOk / daysInMonth) * 100 : null;

                  // Ky TT: tu dong tinh tu calcExpectedDue (Dieu khoan thanh toan)
                  const autoInvDate = autoInvoiceDay ? new Date(calYear, calMonthNum - 1, autoInvoiceDay) : null;
                  const dueResult = autoInvDate ? calcExpectedDue(c, autoInvDate) : null;
                  const dueDay = dueResult?.date ? dueResult.date.getDate() : null;
                  const dueDayInMonth = dueDay != null && dueResult?.date?.getMonth() === calMonthNum - 1 ? dueDay : null;
                  const payDueDay = dueDayInMonth;
                  const payDueX = payDueDay != null ? ((payDueDay - 1) / daysInMonth) * 100 : null;

                  const salaryRange = nr(c.salary_day, c.salary_day_end);
                  const salaryDay = rd(salaryRange.start);
                  const salaryEnd = rd(salaryRange.end);
                  const salaryEndOk = salaryEnd != null && salaryDay != null && salaryEnd > salaryDay ? salaryEnd : null;
                  const salaryX = salaryDay != null ? ((Math.min(salaryDay - 1, daysInMonth - 1)) / daysInMonth) * 100 : null;
                  const salaryEndX = salaryEndOk != null ? (salaryEndOk / daysInMonth) * 100 : null;

                  return (
                    <div key={c.id} className="flex border-b border-[#F0EEE9] last:border-0 hover:bg-[#FAFAF8] transition" style={{ minWidth: 900 }}>
                      <div className="w-[180px] shrink-0 px-3 py-2.5 border-r border-[#E8E7E2]">
                        <button onClick={() => startEdit(c)} className="text-[12px] font-semibold text-[#111] truncate hover:text-blue-600 hover:underline text-left">
                          {c.name}{c.status === 'danger' || c.status === 'warn' ? ' 🚩' : ''}
                        </button>
                        {suspensionMonth(c) === month && (
                          <div className="text-[9.5px] text-orange-600 font-medium">Tháng cuối · ngưng {formatSuspensionDate(c)}</div>
                        )}
                        <div className="text-[10.5px] text-[#888]">{(c.current_workers || 0).toLocaleString()} LD</div>
                      </div>
                      <div className="flex-1 relative">
                        <div className="absolute top-0 bottom-0 w-px bg-red-300 opacity-40 z-0"
                          style={{ left: `${((todayNum - 1) / daysInMonth) * 100}%` }} />

                        {(() => {
                          type Mk = { x: number; day: number; label: string; color: string; textCls: string; shape: 'circle' | 'diamond' | 'square'; endX?: number; endDay?: number; dashCls?: string; inlineColor?: string; external?: boolean };
                          const markers: Mk[] = [];
                          if (isPhaseOn('cutoff') && !isRecruitment && cutoffX != null && cutoffDay != null)
                            markers.push({ x: cutoffX, day: cutoffDay, label: 'Chot cong', color: 'bg-orange-400', textCls: 'text-orange-600', shape: 'circle', endX: cutoffEndX ?? undefined, endDay: cutoffEndOk ?? undefined, dashCls: 'border-orange-300' });
                          if (isPhaseOn('calc') && !isRecruitment && calcX != null && calcDay != null)
                            markers.push({ x: calcX, day: calcDay, label: 'Tinh luong', color: 'bg-blue-400', textCls: 'text-blue-600', shape: 'diamond', endX: calcEndX ?? undefined, endDay: calcEndOk ?? undefined, dashCls: 'border-blue-300' });
                          if (isPhaseOn('calc') && !isRecruitment) {
                            const extraCalcs: { start: number; end: number | null }[] = Array.isArray((c as any).extra_calc_days) ? (c as any).extra_calc_days : [];
                            for (const ex of extraCalcs) {
                              const exR = nr(ex.start, ex.end);
                              const exDay = rd(exR.start);
                              const exEnd = rd(exR.end);
                              const exEndOk = exEnd != null && exDay != null && exEnd > exDay ? exEnd : null;
                              const exX = exDay != null ? ((Math.min(exDay - 1, daysInMonth - 1)) / daysInMonth) * 100 : null;
                              const exEndX = exEndOk != null ? (exEndOk / daysInMonth) * 100 : null;
                              if (exX != null && exDay != null)
                                markers.push({ x: exX, day: exDay, label: 'Tinh luong', color: 'bg-blue-300', textCls: 'text-blue-500', shape: 'diamond', endX: exEndX ?? undefined, endDay: exEndOk ?? undefined, dashCls: 'border-blue-200' });
                            }
                          }
                          if (isPhaseOn('invoice') && invoiceX != null && invoiceDay != null)
                            markers.push({ x: invoiceX, day: invoiceDay, label: 'Xuat HD', color: 'bg-cyan-500', textCls: 'text-cyan-600', shape: 'square', endX: invoiceEndX ?? undefined, endDay: invoiceEndOk ?? undefined, dashCls: 'border-cyan-300', external: true });
                          if (isPhaseOn('paydue') && payDueX != null && payDueDay != null)
                            markers.push({ x: payDueX, day: payDueDay, label: c.paid_this_month ? 'Da TT' : 'Ky TT', color: 'bg-emerald-500', textCls: c.paid_this_month ? 'text-emerald-700' : 'text-emerald-600', shape: 'square', external: true });
                          if (isPhaseOn('salary') && !isRecruitment && salaryX != null && salaryDay != null)
                            markers.push({ x: salaryX, day: salaryDay, label: 'Phat luong', color: 'bg-purple-500', textCls: 'text-purple-600', shape: 'circle', endX: salaryEndX ?? undefined, endDay: salaryEndOk ?? undefined, dashCls: 'border-purple-300' });
                          if (isPhaseOn('salary') && !isRecruitment) {
                            const extras: { start: number; end: number | null }[] = Array.isArray(c.extra_salary_days) ? c.extra_salary_days : [];
                            for (const ex of extras) {
                              const exR = nr(ex.start, ex.end);
                              const exDay = rd(exR.start);
                              const exEnd = rd(exR.end);
                              const exEndOk = exEnd != null && exDay != null && exEnd > exDay ? exEnd : null;
                              const exX = exDay != null ? ((Math.min(exDay - 1, daysInMonth - 1)) / daysInMonth) * 100 : null;
                              const exEndX = exEndOk != null ? (exEndOk / daysInMonth) * 100 : null;
                              if (exX != null && exDay != null)
                                markers.push({ x: exX, day: exDay, label: 'Phat luong', color: 'bg-purple-400', textCls: 'text-purple-500', shape: 'circle', endX: exEndX ?? undefined, endDay: exEndOk ?? undefined, dashCls: 'border-purple-200' });
                            }
                          }

                          markers.sort((a, b) => a.x - b.x);

                          const internalDays: number[] = [];
                          for (const m of markers) {
                            if (m.external) continue;
                            internalDays.push(m.day);
                            if (m.endDay != null) internalDays.push(m.endDay);
                          }
                          const isClash = (day: number) => internalDays.some(d => Math.abs(d - day) <= 1);

                          const row1 = { dot: 4, line: 10, label: 19 };
                          const row2 = { dot: 20, line: 26, label: 33 };
                          let anyRow2 = false;

                          const lineColors: Record<string, string> = {
                            'bg-orange-400': '#fb923c', 'bg-blue-400': '#60a5fa', 'bg-cyan-500': '#06b6d4',
                            'bg-emerald-500': '#10b981', 'bg-purple-500': '#a855f7', 'bg-purple-400': '#c084fc',
                          };

                          type Row = typeof row1;
                          const dotItems: { x: number; day: number; color: string; sc: string; cs: React.CSSProperties; title: string; inlineColor?: string; row: Row }[] = [];
                          const labelItems: { x: number; day: number; textCls: string; row: Row }[] = [];
                          const lineItems: { x: number; endX: number; color: string; inlineColor?: string; row: Row }[] = [];

                          for (const m of markers) {
                            const sc = m.shape === 'circle' ? 'rounded-full' : m.shape === 'diamond' ? '' : 'rounded-sm';
                            const cs: React.CSSProperties = m.shape === 'diamond' ? { clipPath: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)' } : {};
                            const r = (m.external && isClash(m.day)) ? row2 : row1;
                            if (r === row2) anyRow2 = true;
                            dotItems.push({ x: m.x, day: m.day, color: m.color, sc, cs, title: `${m.label}: ngay ${m.day}${m.endDay ? `–${m.endDay}` : ''}`, inlineColor: m.inlineColor, row: r });
                            labelItems.push({ x: m.x, day: m.day, textCls: m.textCls, row: r });
                            if (m.endX != null) {
                              lineItems.push({ x: m.x, endX: m.endX, color: m.color, inlineColor: m.inlineColor, row: r });
                              if (m.endDay != null) {
                                dotItems.push({ x: m.endX, day: m.endDay, color: m.color, sc, cs, title: `${m.label}: ngay ${m.day}–${m.endDay}`, inlineColor: m.inlineColor, row: r });
                                labelItems.push({ x: m.endX, day: m.endDay, textCls: m.textCls, row: r });
                              }
                            }
                          }

                          const allSorted = [...labelItems].sort((a, b) => a.row.dot - b.row.dot || a.x - b.x);
                          const r1Labels = allSorted.filter(l => l.row === row1);
                          const r2Labels = allSorted.filter(l => l.row === row2);
                          const nudgeRow = (pts: typeof r1Labels) => {
                            const minGap = 3.5;
                            const out: number[] = [];
                            for (let i = 0; i < pts.length; i++) {
                              let nx = pts[i].x;
                              if (i > 0 && nx - out[i - 1] < minGap) nx = out[i - 1] + minGap;
                              out.push(nx);
                            }
                            return out;
                          };
                          const n1 = nudgeRow(r1Labels);
                          const n2 = nudgeRow(r2Labels);
                          const nudgeMap = new Map<string, number>();
                          r1Labels.forEach((l, i) => nudgeMap.set(`${l.x}-${l.day}-${l.row.dot}`, n1[i]));
                          r2Labels.forEach((l, i) => nudgeMap.set(`${l.x}-${l.day}-${l.row.dot}`, n2[i]));
                          const getLabelX = (x: number, day: number, row: Row) => nudgeMap.get(`${x}-${day}-${row.dot}`) ?? x;

                          return (
                            <div style={{ position: 'relative', height: anyRow2 ? 46 : 34 }}>
                              {lineItems.map((l, i) => {
                                const bc = l.inlineColor ?? lineColors[l.color] ?? '#ccc';
                                return <div key={`l${i}`} className="absolute z-0" style={{ left: `${l.x}%`, width: `${l.endX - l.x}%`, top: l.row.line, borderTop: `2px dashed ${bc}` }} />;
                              })}
                              {dotItems.map((d, i) => (
                                <div key={`d${i}`} className={`absolute w-3 h-3 ${d.color} border-2 border-white shadow-sm z-10 ${d.sc}`}
                                  style={{ left: `calc(${d.x}% - 6px)`, top: d.row.dot, ...d.cs, ...(d.inlineColor ? { backgroundColor: d.inlineColor } : {}) }}
                                  title={d.title} />
                              ))}
                              {labelItems.map((lb, i) => {
                                const lx = getLabelX(lb.x, lb.day, lb.row);
                                return <div key={`t${i}`} className={`absolute text-[8.5px] leading-none ${lb.textCls} font-semibold whitespace-nowrap z-20`}
                                  style={{ left: `${lx}%`, top: lb.row.label, transform: 'translateX(-50%)' }}>{lb.day}</div>;
                              })}
                            </div>
                          );
                        })()}
                        {!payDueDay && !isRecruitment && c.next_month_pay && (
                          <div className="absolute text-[9px] text-emerald-600 font-medium" style={{ right: 4, top: 6 }}>TT thang sau</div>
                        )}
                      </div>
                    </div>
                  );
                })}
                </div>
              </div>
            </div>

            {/* Finance records — sorted, with dynamic steps + date picker */}
            <div className="bg-white border border-[#E8E7E2] rounded-[10px] overflow-hidden">
              <div className="px-4 py-2.5 border-b border-[#E8E7E2] flex items-center justify-between">
                <div className="text-[12.5px] font-semibold text-[#111]">
                  Trạng thái thanh toán {monthTitle}
                </div>
                <div className="text-[11.5px] text-[#aaa]">
                  Chưa TT xếp lên trên · Bấm nút để cập nhật
                </div>
              </div>
              <div className="divide-y divide-[#F0EEE9]">
                {sortedFinance.length === 0 ? (
                  <div className="text-center py-8 text-[#aaa] text-[13px]">Không có dữ liệu tài chính</div>
                ) : sortedFinance.map(r => {
                  const clientData = clients.find(c => c.id === r.client_id);
                  const clientObj = r.clients as { name: string } | null;
                  const cost = (r.cost_labor || 0) + (r.cost_mgmt || 0) + (r.cost_other || 0);
                  const profit = (r.revenue || 0) - cost;

                  const rdStep = (v: number | null | undefined, fallback: number): number =>
                    resolveDay(v, daysInMonth) ?? fallback;
                  const cutoffDay = rdStep(clientData?.cutoff_day, 20);
                  const calcDay = rdStep(clientData?.calc_day, cutoffDay + 2);
                  const payStartDay = rdStep(clientData?.payment_start, 26);
                  const salaryDay = rdStep(clientData?.salary_day, payStartDay);

                  const cutoffDone = todayNum >= cutoffDay;
                  const calcDone = todayNum >= calcDay;
                  const payStartDone = todayNum >= payStartDay;
                  const payDone = r.paid_status;

                  return (
                    <div
                      key={r.id}
                      className={`px-4 py-3 transition ${!r.paid_status ? 'border-l-2 border-l-red-400' : 'border-l-2 border-l-emerald-400 opacity-80'}`}
                    >
                      <div className="flex items-center gap-4 flex-wrap">
                        <div className="flex-1 min-w-0">
                          <div className="text-[13px] font-semibold text-[#111] mb-0.5 truncate">
                            {clientData ? (
                              <button onClick={() => startEdit(clientData)} className="hover:text-blue-600 hover:underline text-left truncate">
                                {clientObj?.name || clientData.name}
                              </button>
                            ) : (clientObj?.name || r.client_id)}
                          </div>
                          <div className="flex gap-3 text-[12px] flex-wrap">
                            <span>DT: <strong className="text-blue-700">{formatCurrency(r.revenue || 0)}</strong></span>
                            <span>CP: <strong className="text-red-600">{formatCurrency(cost)}</strong></span>
                            <span>LN: <strong style={{ color: profit >= 0 ? '#059669' : '#DC2626' }}>{formatCurrency(profit)}</strong></span>
                          </div>
                          {r.paid_status && r.paid_date && (
                            <div className="text-[11px] text-emerald-600 mt-0.5 flex items-center gap-1">
                              <CalendarCheck size={11} /> Thanh toán ngày {fmtDate(r.paid_date)}
                            </div>
                          )}
                        </div>

                        {/* Timeline steps */}
                        <div className="flex items-center gap-1 shrink-0">
                          <TimelineStep label="Chốt công" day={cutoffDay} done={cutoffDone} isToday={todayNum === cutoffDay} />
                          <div className={`w-5 h-0.5 mb-5 ${calcDone ? 'bg-emerald-400' : 'bg-gray-200'}`} />
                          <TimelineStep label="Tính lương" day={calcDay} done={calcDone} isToday={todayNum === calcDay} />
                          <div className={`w-5 h-0.5 mb-5 ${payStartDone ? 'bg-emerald-400' : 'bg-gray-200'}`} />
                          <TimelineStep label="Kỳ TT" day={payStartDay} done={payStartDone} isToday={todayNum === payStartDay} />
                          <div className={`w-5 h-0.5 mb-5 ${payDone ? 'bg-emerald-400' : 'bg-gray-200'}`} />
                          <TimelineStep label="Phát lương" day={salaryDay} done={payDone} isToday={!payDone && todayNum >= salaryDay} />
                        </div>

                        {/* Paid toggle button */}
                        {r.paid_status ? (
                          <button
                            onClick={() => undoPaid(r)}
                            className="shrink-0 px-3 py-1.5 rounded-full text-[12px] font-semibold bg-emerald-100 text-emerald-700 hover:bg-emerald-200 transition"
                          >
                            ✓ Đã TT
                          </button>
                        ) : (
                          <button
                            onClick={() => openPayModal(r.id)}
                            className="shrink-0 px-3 py-1.5 rounded-full text-[12px] font-semibold bg-red-100 text-red-700 hover:bg-red-200 transition"
                          >
                            ✗ Chưa TT
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}

        {/* ══ MODE 3: P&L Dự án ══ */}
        {activeTab === 'pnl' && (
          <PnLProjectTab
            clients={clients}
            month={selectedMonth}
            projectsPnl={finData.projectsPnl}
            pnlCosts={finData.pnlCosts}
            onAddProject={finData.addProjectPnl}
            onUpdateProject={finData.updateProjectPnl}
            onDeleteProject={finData.deleteProjectPnl}
            onLoadCosts={finData.loadPnlCosts}
            onAddCost={finData.addPnlCost}
            onUpdateCost={finData.updatePnlCost}
            onDeleteCost={finData.deletePnlCost}
            splitSettings={finData.splitSettings}
            onSaveSplitSettings={finData.saveSplitSettings}
            invoiceSettings={finData.invoiceSettings}
            onSaveInvoiceSettings={finData.saveInvoiceSettings}
            branches={branchList}
            costCategories={costCategories}
            onAddCategory={addCostCat}
            onRenameCategory={renameCostCat}
            onDeleteCategory={removeCostCat}
            onToggleCategoryDefault={toggleCostCatDefault}
            onSetCategoryGroup={setCostCatGroup}
            onSetCategoryPayer={setCostCatPayer}
            currentUser={user?.full_name}
            toast={toast}
          />
        )}

        {/* Chi phí cố định CN — đã chuyển vào Chi Nhánh > Tài chính */}

        {/* ══ MODE 5: Hiệu suất chi nhánh ══ */}
        {activeTab === 'performance' && (
          <PerformanceTab
            managers={managerList}
            months={workspaceMonths}
            selMonth={selectedMonth}
            onSelMonthChange={setSelectedMonth}
            projectsPnl={finData.projectsPnl}
            pnlCosts={finData.pnlCosts}
            overhead={finData.overhead}
            clients={clients}
            onLoadCosts={finData.loadPnlCosts}
          />
        )}

        {activeTab === 'payment' && (
          <PaymentCalendarTab
            clients={clients}
            onUpdateClient={onClientUpdate}
            toast={toast}
          />
        )}
      </div>

      {/* ── Date picker modal ── */}
      {payModal && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
          onClick={e => { if (e.target === e.currentTarget) setPayModal(null); }}
        >
          <div className="bg-white rounded-xl shadow-2xl p-5 w-[320px]">
            <div className="flex items-center justify-between mb-3">
              <div className="text-[14px] font-semibold text-[#111] flex items-center gap-2">
                <CalendarCheck size={16} className="text-blue-600" />
                Chọn ngày thanh toán
              </div>
              <button onClick={() => setPayModal(null)} className="text-[#aaa] hover:text-[#666]">
                <XIcon size={15} />
              </button>
            </div>

            <input
              type="date"
              value={payModal.date}
              onChange={e => setPayModal({ ...payModal, date: e.target.value })}
              className="w-full text-[13px] px-3 py-2 border border-gray-300 rounded-lg outline-none focus:border-blue-500 mb-3"
            />

            {/* Quick date shortcuts */}
            <div className="flex gap-1.5 mb-4">
              {[
                { label: 'Hôm nay', val: todayStr },
                {
                  label: 'Hôm qua',
                  val: (() => { const d = new Date(todayFull); d.setDate(d.getDate() - 1); return d.toISOString().split('T')[0]; })(),
                },
              ].map(s => (
                <button
                  key={s.label}
                  onClick={() => setPayModal({ ...payModal, date: s.val })}
                  className={`flex-1 py-1 rounded-lg text-[12px] border transition ${payModal.date === s.val ? 'bg-blue-100 border-blue-400 text-blue-700 font-medium' : 'border-gray-300 text-gray-500 hover:bg-gray-50'}`}
                >
                  {s.label}
                </button>
              ))}
            </div>

            <div className="flex gap-2">
              <button
                onClick={confirmPayment}
                className="flex-1 py-2 rounded-lg text-[13px] font-semibold bg-[#1D4ED8] text-white hover:bg-[#1E40AF] transition"
              >
                Xác nhận
              </button>
              <button
                onClick={() => setPayModal(null)}
                className="flex-1 py-2 rounded-lg text-[13px] font-medium border border-gray-300 text-gray-600 hover:bg-gray-50 transition"
              >
                Hủy
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Timeline edit modal (Chốt công / Tính lương / Kỳ TT / Phát lương) ── */}
      {editClient && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
          onClick={e => { if (e.target === e.currentTarget) setEditClient(null); }}
        >
          <div className="bg-white rounded-xl shadow-2xl p-5 w-[420px]">
            <div className="flex items-center justify-between mb-4">
              <div className="text-[14px] font-semibold text-[#111] truncate pr-2">{editClient.name}</div>
              <button onClick={() => setEditClient(null)} className="text-[#aaa] hover:text-[#666] shrink-0">
                <XIcon size={15} />
              </button>
            </div>

            <div className="space-y-3.5">
              {([
                { label: 'Chot cong', start: 'cutoff_day', end: 'cutoff_day_end', dot: 'bg-orange-400' },
                { label: 'Tinh luong', start: 'calc_day', end: 'calc_day_end', dot: 'bg-blue-400' },
                { label: 'Phat luong', start: 'salary_day', end: 'salary_day_end', dot: 'bg-purple-500' },
              ] as { label: string; start: 'cutoff_day' | 'calc_day' | 'salary_day'; end: 'cutoff_day_end' | 'calc_day_end' | 'salary_day_end'; dot: string }[]).map(row => {
                const startVal = editForm[row.start];
                const endVal = editForm[row.end];
                // Chi nhap 1 trong 2 o (bat dau HOAC ket thuc) => moc dien ra trong 1 ngay
                const isOneDay = (startVal == null) !== (endVal == null);
                return (
                  <div key={row.start} className="flex items-center gap-3">
                    <div className="w-[110px] shrink-0 flex items-center gap-1.5 text-[12.5px] font-medium text-[#444]">
                      <span className={`inline-block w-2 h-2 rounded-full ${row.dot}`} />
                      {row.label}
                    </div>
                    <div className="flex-1">
                      <label className="text-[10.5px] text-[#999] block mb-0.5">{isOneDay ? 'Ngay (1 ngay)' : 'Ngay bat dau'}</label>
                      <DayCell quick="eom1" value={startVal} onChange={v => setEditForm({ ...editForm, [row.start]: v })} />
                    </div>
                    <div className="flex-1">
                      <label className="text-[10.5px] text-[#999] block mb-0.5">Ngay ket thuc</label>
                      <DayCell quick="eom" value={endVal} onChange={v => setEditForm({ ...editForm, [row.end]: v })} />
                    </div>
                  </div>
                );
              })}
            </div>
            {editForm.extra_calc_days.map((ex, idx) => (
              <div key={`ec-${idx}`} className="flex items-center gap-3 mt-2">
                <div className="w-[110px] shrink-0 flex items-center gap-1.5 text-[12px] text-[#666]">
                  <span className="inline-block w-2 h-2 rounded-full bg-blue-300" />
                  TL {idx + 2}
                  <button type="button" onClick={() => {
                    const arr = [...editForm.extra_calc_days];
                    arr.splice(idx, 1);
                    setEditForm({ ...editForm, extra_calc_days: arr });
                  }} className="text-[10px] text-gray-400 hover:text-red-500 ml-auto">&times;</button>
                </div>
                <div className="flex-1">
                  <DayCell quick="eom1" value={ex.start} onChange={v => {
                    const arr = [...editForm.extra_calc_days];
                    arr[idx] = { ...arr[idx], start: v ?? 1 };
                    setEditForm({ ...editForm, extra_calc_days: arr });
                  }} />
                </div>
                <div className="flex-1">
                  <DayCell quick="eom" value={ex.end} onChange={v => {
                    const arr = [...editForm.extra_calc_days];
                    arr[idx] = { ...arr[idx], end: v };
                    setEditForm({ ...editForm, extra_calc_days: arr });
                  }} />
                </div>
              </div>
            ))}
            <button type="button" onClick={() => setEditForm({ ...editForm, extra_calc_days: [...editForm.extra_calc_days, { start: 15, end: null }] })}
              className="text-[10.5px] text-blue-500 hover:text-blue-700 mt-1.5 hover:underline">+ Them dot tinh luong</button>
            {editForm.extra_salary_days.map((ex, idx) => (
              <div key={`ex-${idx}`} className="flex items-center gap-3 mt-2">
                <div className="w-[110px] shrink-0 flex items-center gap-1.5 text-[12px] text-[#666]">
                  <span className="inline-block w-2 h-2 rounded-full bg-purple-400" />
                  PL {idx + 2}
                  <button type="button" onClick={() => {
                    const arr = [...editForm.extra_salary_days];
                    arr.splice(idx, 1);
                    setEditForm({ ...editForm, extra_salary_days: arr });
                  }} className="text-[10px] text-gray-400 hover:text-red-500 ml-auto">&times;</button>
                </div>
                <div className="flex-1">
                  <DayCell quick="eom1" value={ex.start} onChange={v => {
                    const arr = [...editForm.extra_salary_days];
                    arr[idx] = { ...arr[idx], start: v ?? 1 };
                    setEditForm({ ...editForm, extra_salary_days: arr });
                  }} />
                </div>
                <div className="flex-1">
                  <DayCell quick="eom" value={ex.end} onChange={v => {
                    const arr = [...editForm.extra_salary_days];
                    arr[idx] = { ...arr[idx], end: v };
                    setEditForm({ ...editForm, extra_salary_days: arr });
                  }} />
                </div>
              </div>
            ))}
            <button type="button" onClick={() => setEditForm({ ...editForm, extra_salary_days: [...editForm.extra_salary_days, { start: 15, end: null }] })}
              className="text-[10.5px] text-purple-500 hover:text-purple-700 mt-1.5 hover:underline">+ Them dot phat luong</button>

            <div className="text-[11px] text-[#aaa] mt-2.5">De trong "Ngay ket thuc" neu moc chi dien ra trong 1 ngay. Nut <strong>CT-1</strong> (o trai) = ngay ke truoc ngay cuoi thang, <strong>CT</strong> (o phai) = ngay cuoi thang — ca hai tu nhay theo so ngay thuc te cua thang (28/29/30/31).</div>

            {/* ── Xuất HĐ + Kỳ TT: cùng cột DB với "Điều khoản thanh toán" trong
                   hồ sơ khách hàng — sửa bên nào cũng vào một chỗ ── */}
            <div className="mt-3 pt-3 border-t border-[#F0EEE9] space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-[110px] shrink-0 text-[12.5px] font-medium text-[#444]">
                  <div className="flex items-center gap-1.5">
                    <span className="inline-block w-2 h-2 rounded-sm bg-cyan-500" />
                    Xuat HD
                  </div>
                  <div className="text-[10px] text-[#aaa] pl-3.5">hang thang</div>
                </div>
                <div className="flex-1">
                  <label className="text-[10.5px] text-[#999] block mb-0.5">
                    {(editForm.invoice_day == null) !== (editForm.invoice_day_end == null) ? 'Ngay (1 ngay)' : 'Ngay bat dau'}
                  </label>
                  <DayCell quick="eom1" value={editForm.invoice_day} onChange={v => setEditForm({ ...editForm, invoice_day: v })} />
                </div>
                <div className="flex-1">
                  <label className="text-[10.5px] text-[#999] block mb-0.5">Ngay ket thuc</label>
                  <DayCell quick="eom" value={editForm.invoice_day_end} onChange={v => setEditForm({ ...editForm, invoice_day_end: v })} />
                </div>
              </div>

              {(() => {
                const g = editForm.payment_group;
                // Xem trước Kỳ TT ngay trong tháng đang mở, dùng đúng hàm tính của
                // Lịch Thu Tiền nên số hiện ở đây khớp với timeline sau khi lưu.
                const invDay = resolveDay(anchorDay(editForm.invoice_day, editForm.invoice_day_end), daysInMonth);
                const preview = invDay != null
                  ? calcExpectedDue(
                      { ...editClient, payment_group: g, payment_days: editForm.payment_days, payment_fixed_day: editForm.payment_fixed_day, payment_cutoff: editForm.payment_cutoff },
                      new Date(calYear, calMonthNum - 1, invDay),
                    )
                  : null;
                return (
                  <div className="flex items-start gap-3">
                    <div className="w-[110px] shrink-0 flex items-center gap-1.5 text-[12.5px] font-medium text-[#444] pt-4">
                      <span className="inline-block w-2 h-2 rounded-sm bg-emerald-500" />
                      Ky TT
                    </div>
                    <div className="flex-1 min-w-0">
                      <label className="text-[10.5px] text-[#999] block mb-0.5">
                        {g === 1 ? 'Sau bao nhieu ngay ke tu xuat HD' : g === 2 && !editClient.payment_weekday ? 'Thu tien ngay co dinh' : 'Dieu khoan'}
                      </label>
                      {g === 1 ? (
                        <div className="flex items-center gap-1.5">
                          <input type="number" min={1} max={90} value={editForm.payment_days}
                            onChange={e => setEditForm({ ...editForm, payment_days: Math.max(1, Math.min(90, +e.target.value)) })}
                            className="w-[70px] text-[13px] px-2.5 py-1.5 border border-gray-300 rounded-lg outline-none focus:border-blue-500" />
                          <span className="text-[11px] text-[#888]">ngay {editClient.payment_wday ? 'lam viec' : 'lich'}</span>
                        </div>
                      ) : g === 2 && !editClient.payment_weekday ? (
                        <div className="flex items-center gap-1.5">
                          <div className="w-[110px]">
                            <DayCell quick="eom" value={editForm.payment_fixed_day} onChange={v => setEditForm({ ...editForm, payment_fixed_day: v ?? 10 })} />
                          </div>
                          <span className="text-[11px] text-[#888] whitespace-nowrap">chot truoc ngay</span>
                          <input type="number" min={1} max={31} value={editForm.payment_cutoff}
                            onChange={e => setEditForm({ ...editForm, payment_cutoff: Math.max(1, Math.min(31, +e.target.value)) })}
                            className="w-[52px] text-[13px] px-2 py-1.5 border border-gray-300 rounded-lg outline-none focus:border-blue-500" />
                        </div>
                      ) : (
                        <div className="text-[11.5px] text-[#666] py-1.5">
                          {g === 2 ? 'Thu theo thu co dinh hang tuan' : 'Chu ky nua thang (nhom 3)'}
                          <span className="text-[10.5px] text-[#aaa]"> — sua trong ho so KH</span>
                        </div>
                      )}
                      {preview && (
                        <div className="text-[10.5px] text-emerald-700 mt-1">
                          Thang nay: <strong>{preview.label}</strong>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}
            </div>

            <div className="text-[11px] text-blue-500 mt-2">Xuat HD va Ky TT dung chung du lieu voi "Dieu khoan thanh toan" trong ho so khach hang — sua o day hay o do deu nhu nhau.</div>

            <div className="flex gap-2 mt-4">
              <button onClick={handleSaveEdit} className="flex-1 inline-flex items-center justify-center gap-1 py-2 rounded-lg text-[13px] font-semibold bg-[#1D4ED8] text-white hover:bg-[#1E40AF] transition">
                <Check size={14} /> Lưu
              </button>
              <button onClick={() => setEditClient(null)} className="flex-1 py-2 rounded-lg text-[13px] font-medium border border-gray-300 text-gray-600 hover:bg-gray-50 transition">
                Hủy
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
