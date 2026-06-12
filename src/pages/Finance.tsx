import { useState, useEffect, useMemo } from 'react';
import { Lock, CheckCircle, Circle, Pencil, Check, X as XIcon, CalendarCheck } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import FinanceTimeline from '../components/FinanceTimeline';
import type { FinanceRecord, Client } from '../lib/types';
import { formatCurrency } from '../lib/format';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { logActivity } from '../lib/audit';
import { useRegions } from '../hooks/useRegions';
import { useManagers } from '../hooks/useManagers';
import FilterDropdown, { ALL_OPTION } from '../components/FilterDropdown';

type TimelineMode = 'clients' | 'payment';
type DayEventType = 'cutoff' | 'calc' | 'payment' | 'salary';
interface DayEvent { client: Client; type: DayEventType }

const EVENT_CFG: Record<DayEventType, { dot: string; pill: string; text: string; label: string }> = {
  cutoff:  { dot: 'bg-orange-400', pill: 'bg-orange-50 border-orange-200',   text: 'text-orange-700',  label: 'Chốt công' },
  calc:    { dot: 'bg-blue-400',   pill: 'bg-blue-50 border-blue-200',       text: 'text-blue-700',    label: 'Tính lương' },
  payment: { dot: 'bg-emerald-500',pill: 'bg-emerald-50 border-emerald-200', text: 'text-emerald-700', label: 'Kỳ thanh toán' },
  salary:  { dot: 'bg-purple-500', pill: 'bg-purple-50 border-purple-200',   text: 'text-purple-700',  label: 'Phát lương' },
};

// inclusive day range, clipped to 1..31; falls back to a single day if no end given
function dayRange(start: number, end: number | null | undefined): number[] {
  const e = end && end >= start ? end : start;
  const days: number[] = [];
  for (let d = start; d <= e; d++) if (d >= 1 && d <= 31) days.push(d);
  return days;
}

const DAY_HEADERS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];

const todayFull = new Date();
const todayStr = todayFull.toISOString().split('T')[0];
const todayNum = todayFull.getDate();

function fmtDate(d: string) {
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y}`;
}

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
  const [month, setMonth] = useState('2026-06');
  const [timelineMode, setTimelineMode] = useState<TimelineMode>('clients');

  useEffect(() => { onLoadFinance(month); }, [month, onLoadFinance]);

  // ── Shared filters ────────────────────────────────────────────────
  const [filterRegion, setFilterRegion] = useState<string[]>([ALL_OPTION]);
  const [filterManager, setFilterManager] = useState<string[]>([ALL_OPTION]);

  // ── Calendar (payment mode) extra state ──────────────────────────
  const [selectedDay, setSelectedDay] = useState<number | null>(null);

  // ── Timeline edit modal (opened by clicking a company name) ──────
  const [editClient, setEditClient] = useState<Client | null>(null);
  const [editForm, setEditForm] = useState({
    cutoff_day: 1, cutoff_day_end: null as number | null,
    calc_day: 3, calc_day_end: null as number | null,
    payment_start: 1, payment_end: 5,
    salary_day: 1, salary_day_end: null as number | null,
  });

  // ── Date picker modal state ───────────────────────────────────────
  const [payModal, setPayModal] = useState<{ recId: string; date: string } | null>(null);

  const { regions: regionList } = useRegions();
  const { managers: managerList } = useManagers();

  const regions = useMemo(() => [ALL_OPTION, ...regionList.map(r => r.name)], [regionList]);
  const managers = useMemo(() => [ALL_OPTION, ...managerList.map(m => m.name)], [managerList]);

  const filteredClients = useMemo(() => clients.filter(c => {
    const okR = filterRegion.includes(ALL_OPTION) || filterRegion.includes(c.region || '');
    const okM = filterManager.includes(ALL_OPTION) || filterManager.includes(c.manager || '');
    return okR && okM;
  }), [clients, filterRegion, filterManager]);

  // ── Calendar (payment mode) ──────────────────────────────────────
  const [calYear, calMonthNum] = month.split('-').map(Number);
  const daysInMonth = new Date(calYear, calMonthNum, 0).getDate();
  const firstDow = new Date(calYear, calMonthNum - 1, 1).getDay();
  const firstColIndex = firstDow === 0 ? 6 : firstDow - 1;

  const calCells: (number | null)[] = [];
  for (let i = 0; i < firstColIndex; i++) calCells.push(null);
  for (let d = 1; d <= daysInMonth; d++) calCells.push(d);
  while (calCells.length % 7 !== 0) calCells.push(null);

  const eventsByDay = useMemo<Record<number, DayEvent[]>>(() => {
    const map: Record<number, DayEvent[]> = {};
    const add = (d: number, c: Client, type: DayEventType) => {
      if (d >= 1 && d <= 31) (map[d] ??= []).push({ client: c, type });
    };
    for (const c of filteredClients) {
      for (const d of dayRange(c.cutoff_day, c.cutoff_day_end)) add(d, c, 'cutoff');
      for (const d of dayRange(c.calc_day, c.calc_day_end)) add(d, c, 'calc');
      for (const d of dayRange(c.payment_start, c.payment_end)) add(d, c, 'payment');
      for (const d of dayRange(c.salary_day, c.salary_day_end)) add(d, c, 'salary');
    }
    return map;
  }, [filteredClients]);

  const selectedEvents = selectedDay ? (eventsByDay[selectedDay] || []) : [];
  const selectedClientIds = [...new Set(selectedEvents.map(e => e.client.id))];

  const startEdit = (c: Client) => {
    setEditClient(c);
    setEditForm({
      cutoff_day: c.cutoff_day, cutoff_day_end: c.cutoff_day_end,
      calc_day: c.calc_day, calc_day_end: c.calc_day_end,
      payment_start: c.payment_start, payment_end: c.payment_end,
      salary_day: c.salary_day, salary_day_end: c.salary_day_end,
    });
  };

  const handleSaveEdit = async () => {
    if (!editClient) return;
    const c = editClient;
    const updates = { ...editForm, updated_at: new Date().toISOString() };
    const { error } = await supabase.from('clients').update(updates).eq('id', c.id);
    if (error) { toast('Lỗi: ' + error.message); return; }
    onClientUpdate({ ...c, ...editForm });
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

  const totalRev = sortedFinance.reduce((s, r) => s + (r.revenue || 0), 0);
  const totalCost = sortedFinance.reduce((s, r) => s + (r.cost_labor || 0) + (r.cost_mgmt || 0) + (r.cost_other || 0), 0);
  const totalProfit = totalRev - totalCost;
  const paidCount = sortedFinance.filter(r => r.paid_status).length;
  const monthLabel = month === '2026-06' ? 'Tháng 6/2026' : 'Tháng 5/2026';

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
            <select
              value={month}
              onChange={e => { setMonth(e.target.value); setSelectedDay(null); setEditClient(null); }}
              className="text-[12.5px] px-2.5 py-1.5 border border-gray-300 rounded-lg outline-none"
            >
              <option value="2026-06">Tháng 6/2026</option>
              <option value="2026-05">Tháng 5/2026</option>
            </select>
            <div className="flex items-center bg-gray-100 rounded-lg p-0.5">
              <button
                onClick={() => setTimelineMode('clients')}
                className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-all ${timelineMode === 'clients' ? 'bg-white shadow-sm text-[#111]' : 'text-[#999] hover:text-[#555]'}`}
              >
                Timeline KH
              </button>
              <button
                onClick={() => setTimelineMode('payment')}
                className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-all ${timelineMode === 'payment' ? 'bg-white shadow-sm text-[#111]' : 'text-[#999] hover:text-[#555]'}`}
              >
                Timeline TT
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
        {timelineMode === 'clients' && (
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
                <span className="text-[12.5px] font-semibold text-[#111]">Timeline {monthLabel}</span>
                <div className="flex items-center gap-4 text-[11px] text-[#888]">
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block w-3 h-3 rounded-full bg-orange-400" /> Chốt công
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block w-3 h-3 bg-blue-400" style={{ clipPath: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)' }} /> Tính lương
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block w-8 h-3 rounded bg-emerald-400 opacity-80" /> Kỳ TT
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block w-3 h-3 rounded-full bg-purple-500" /> Phát lương
                  </span>
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
                  </div>
                </div>
                {filteredClients.length === 0 ? (
                  <div className="text-center py-10 text-[#aaa] text-[13px]" style={{ minWidth: 900 }}>
                    Không có khách hàng
                  </div>
                ) : filteredClients.map(c => {
                  const cutoffEnd = c.cutoff_day_end && c.cutoff_day_end > c.cutoff_day ? c.cutoff_day_end : null;
                  const cutoffX = ((c.cutoff_day - 1) / daysInMonth) * 100;
                  const cutoffEndX = cutoffEnd ? (Math.min(cutoffEnd, daysInMonth) / daysInMonth) * 100 : null;

                  const calcEnd = c.calc_day_end && c.calc_day_end > c.calc_day ? c.calc_day_end : null;
                  const calcX = ((Math.min(c.calc_day - 1, daysInMonth - 1)) / daysInMonth) * 100;
                  const calcEndX = calcEnd ? (Math.min(calcEnd, daysInMonth) / daysInMonth) * 100 : null;

                  const payEnd = Math.min(c.payment_end, daysInMonth);
                  const showBar = !c.next_month_pay && c.payment_start > c.cutoff_day;
                  const payStartX = ((c.payment_start - 1) / daysInMonth) * 100;
                  const payEndX = (payEnd / daysInMonth) * 100;

                  const salaryEnd = c.salary_day_end && c.salary_day_end > c.salary_day ? c.salary_day_end : null;
                  const salaryX = ((Math.min(c.salary_day - 1, daysInMonth - 1)) / daysInMonth) * 100;
                  const salaryEndX = salaryEnd ? (Math.min(salaryEnd, daysInMonth) / daysInMonth) * 100 : null;

                  return (
                    <div key={c.id} className="flex border-b border-[#F0EEE9] last:border-0 hover:bg-[#FAFAF8] transition" style={{ minWidth: 900 }}>
                      <div className="w-[180px] shrink-0 px-3 py-2.5 border-r border-[#E8E7E2]">
                        <button onClick={() => startEdit(c)} className="text-[12px] font-semibold text-[#111] truncate hover:text-blue-600 hover:underline text-left">
                          {c.name}
                        </button>
                        <div className="text-[10.5px] text-[#888]">{(c.current_workers || 0).toLocaleString()} LĐ</div>
                      </div>
                      <div className="flex-1 relative" style={{ height: 64 }}>
                        <div className="absolute top-0 bottom-0 w-px bg-red-300 opacity-40"
                          style={{ left: `${((todayNum - 1) / daysInMonth) * 100}%` }} />

                        {/* Row 1: Chốt công + Tính lương */}
                        {cutoffEndX !== null && (
                          <div className="absolute border-t border-dashed border-orange-300"
                            style={{ left: `${cutoffX}%`, width: `${cutoffEndX - cutoffX}%`, top: 14 }} />
                        )}
                        <div className="absolute w-3 h-3 rounded-full bg-orange-400 border-2 border-white shadow-sm z-10"
                          style={{ left: `calc(${cutoffX}% - 6px)`, top: 8 }}
                          title={`Chốt công: ngày ${c.cutoff_day}${cutoffEnd ? `–${cutoffEnd}` : ''}`} />
                        <div className="absolute text-[9px] leading-none text-orange-600 font-medium"
                          style={{ left: `${cutoffX}%`, top: 21, transform: 'translateX(-50%)' }}>{c.cutoff_day}</div>
                        {cutoffEndX !== null && (
                          <>
                            <div className="absolute w-3 h-3 rounded-full bg-orange-400 border-2 border-white shadow-sm z-10"
                              style={{ left: `calc(${cutoffEndX}% - 6px)`, top: 8 }}
                              title={`Chốt công: ngày ${c.cutoff_day}–${cutoffEnd}`} />
                            <div className="absolute text-[9px] leading-none text-orange-600 font-medium"
                              style={{ left: `${cutoffEndX}%`, top: 21, transform: 'translateX(-50%)' }}>{cutoffEnd}</div>
                          </>
                        )}
                        {calcEndX !== null && (
                          <div className="absolute border-t border-dashed border-blue-300"
                            style={{ left: `${calcX}%`, width: `${calcEndX - calcX}%`, top: 14 }} />
                        )}
                        <div className="absolute w-3 h-3 bg-blue-400 border border-white z-10"
                          style={{ left: `calc(${calcX}% - 6px)`, top: 8, clipPath: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)' }}
                          title={`Tính lương: ngày ${c.calc_day}${calcEnd ? `–${calcEnd}` : ''}`} />
                        <div className="absolute text-[9px] leading-none text-blue-600 font-medium"
                          style={{ left: `${calcX}%`, top: 21, transform: 'translateX(-50%)' }}>{c.calc_day}</div>
                        {calcEndX !== null && (
                          <>
                            <div className="absolute w-3 h-3 bg-blue-400 border border-white z-10"
                              style={{ left: `calc(${calcEndX}% - 6px)`, top: 8, clipPath: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)' }}
                              title={`Tính lương: ngày ${c.calc_day}–${calcEnd}`} />
                            <div className="absolute text-[9px] leading-none text-blue-600 font-medium"
                              style={{ left: `${calcEndX}%`, top: 21, transform: 'translateX(-50%)' }}>{calcEnd}</div>
                          </>
                        )}

                        {/* Row 2: Kỳ TT + Phát lương */}
                        {showBar && (
                          <div
                            className={`absolute rounded-sm flex items-center justify-center text-[9px] font-semibold whitespace-nowrap overflow-hidden ${c.paid_this_month ? 'bg-emerald-400 text-emerald-900' : 'bg-emerald-300 opacity-70 text-emerald-800'}`}
                            style={{ left: `${payStartX}%`, width: `${Math.max(payEndX - payStartX, 0.5)}%`, height: 16, top: 38 }}
                            title={`Kỳ TT: ${c.payment_start}–${c.payment_end}${c.paid_this_month ? ' (Đã TT)' : ' (Chưa TT)'}`}
                          >
                            {c.payment_start}–{c.payment_end}
                          </div>
                        )}
                        {c.next_month_pay && (
                          <div className="absolute text-[9px] text-emerald-600 font-medium" style={{ right: 4, top: 40 }}>TT/T7</div>
                        )}
                        {salaryEndX !== null && (
                          <div className="absolute border-t border-dashed border-purple-300"
                            style={{ left: `${salaryX}%`, width: `${salaryEndX - salaryX}%`, top: 44 }} />
                        )}
                        <div className="absolute w-3 h-3 rounded-full bg-purple-500 border-2 border-white shadow-sm z-10"
                          style={{ left: `calc(${salaryX}% - 6px)`, top: 38 }}
                          title={`Phát lương: ngày ${c.salary_day}${salaryEnd ? `–${salaryEnd}` : ''}`} />
                        <div className="absolute text-[9px] leading-none text-purple-600 font-medium"
                          style={{ left: `${salaryX}%`, top: 51, transform: 'translateX(-50%)' }}>{c.salary_day}</div>
                        {salaryEndX !== null && (
                          <>
                            <div className="absolute w-3 h-3 rounded-full bg-purple-500 border-2 border-white shadow-sm z-10"
                              style={{ left: `calc(${salaryEndX}% - 6px)`, top: 38 }}
                              title={`Phát lương: ngày ${c.salary_day}–${salaryEnd}`} />
                            <div className="absolute text-[9px] leading-none text-purple-600 font-medium"
                              style={{ left: `${salaryEndX}%`, top: 51, transform: 'translateX(-50%)' }}>{salaryEnd}</div>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Finance records — sorted, with dynamic steps + date picker */}
            <div className="bg-white border border-[#E8E7E2] rounded-[10px] overflow-hidden">
              <div className="px-4 py-2.5 border-b border-[#E8E7E2] flex items-center justify-between">
                <div className="text-[12.5px] font-semibold text-[#111]">
                  Trạng thái thanh toán {monthLabel}
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

                  const cutoffDay = clientData?.cutoff_day ?? 20;
                  const calcDay = clientData?.calc_day ?? cutoffDay + 2;
                  const payStartDay = clientData?.payment_start ?? 26;
                  const salaryDay = clientData?.salary_day ?? payStartDay;

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

        {/* ══ MODE 2: Timeline Thanh Toán (Calendar) ══ */}
        {timelineMode === 'payment' && (
          <>
            {/* Filter row */}
            <div className="flex items-center gap-2.5 flex-wrap">
              <FilterDropdown label="Chi nhánh" options={regions} selected={filterRegion} onChange={v => { setFilterRegion(v); setSelectedDay(null); }} allLabel="Tất cả chi nhánh" />
              <FilterDropdown label="Quản lý" options={managers} selected={filterManager} onChange={v => { setFilterManager(v); setSelectedDay(null); }} allLabel="Tất cả quản lý" />
              {(!filterRegion.includes(ALL_OPTION) || !filterManager.includes(ALL_OPTION)) && (
                <button
                  onClick={() => { setFilterRegion([ALL_OPTION]); setFilterManager([ALL_OPTION]); setSelectedDay(null); }}
                  className="text-[11.5px] text-blue-600 hover:underline"
                >
                  Xóa lọc
                </button>
              )}
              <div className="ml-auto flex items-center gap-3">
                {(Object.entries(EVENT_CFG) as [DayEventType, typeof EVENT_CFG[DayEventType]][]).map(([type, cfg]) => (
                  <div key={type} className="flex items-center gap-1">
                    <div className={`w-2 h-2 rounded-full ${cfg.dot}`} />
                    <span className="text-[11px] text-[#666]">{cfg.label}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Calendar grid */}
            <div className="bg-white border border-[#E8E7E2] rounded-[10px] overflow-hidden">
              <div className="grid grid-cols-7 bg-[#F9F9F7] border-b border-[#E8E7E2]">
                {DAY_HEADERS.map(h => (
                  <div key={h} className="text-center text-[11.5px] font-medium text-[#888] py-2">{h}</div>
                ))}
              </div>
              {Array.from({ length: calCells.length / 7 }, (_, week) => (
                <div key={week} className="grid grid-cols-7 border-b border-[#F0EEE9] last:border-0">
                  {calCells.slice(week * 7, week * 7 + 7).map((day, col) => {
                    const events = day ? (eventsByDay[day] || []) : [];
                    const isToday = day === todayNum;
                    const isSelected = day === selectedDay;
                    const hasEvents = events.length > 0;
                    return (
                      <div
                        key={col}
                        onClick={() => day && hasEvents && setSelectedDay(isSelected ? null : day)}
                        className={[
                          'min-h-[72px] p-1.5 border-r border-[#F0EEE9] last:border-0 transition',
                          !day ? 'bg-[#FAFAF8]' : '',
                          hasEvents ? 'cursor-pointer hover:bg-blue-50/60' : '',
                          isSelected ? 'bg-blue-50 ring-1 ring-inset ring-blue-300' : '',
                          isToday && !isSelected ? 'bg-amber-50/40' : '',
                        ].join(' ')}
                      >
                        {day && (
                          <>
                            <div className={`text-[12px] font-semibold mb-1.5 ${isToday ? 'text-amber-600' : 'text-[#555]'}`}>{day}</div>
                            <div className="flex flex-col gap-0.5">
                              {(['cutoff', 'payStart', 'payEnd'] as DayEventType[]).map(type => {
                                const typeEvts = events.filter(e => e.type === type);
                                if (!typeEvts.length) return null;
                                const cfg = EVENT_CFG[type];
                                return (
                                  <div key={type} className="relative group">
                                    <div className={`inline-flex items-center gap-0.5 text-[9.5px] font-medium px-1.5 py-0.5 rounded border max-w-full ${cfg.pill} ${cfg.text}`}>
                                      <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${cfg.dot}`} />
                                      <span className="truncate">
                                        {typeEvts.length === 1
                                          ? typeEvts[0].client.name.split(/\s+/).slice(-1)[0]
                                          : `${typeEvts.length} KH`}
                                      </span>
                                    </div>
                                    <div className="absolute bottom-full left-0 mb-1 hidden group-hover:block z-50 pointer-events-none">
                                      <div className="bg-gray-900 text-white text-[11px] rounded-lg px-2.5 py-1.5 shadow-xl whitespace-nowrap">
                                        <div className="font-semibold mb-0.5 text-gray-300">{cfg.label} — Ngày {day}</div>
                                        {typeEvts.map(e => <div key={e.client.id} className="text-gray-400">{e.client.name}</div>)}
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>

            {/* Selected day edit panel */}
            {selectedDay !== null && selectedEvents.length > 0 && (
              <div className="bg-white border border-[#E8E7E2] rounded-[10px] overflow-hidden">
                <div className="px-4 py-2.5 border-b border-[#E8E7E2] flex items-center justify-between">
                  <div className="text-[12.5px] font-semibold text-[#111]">
                    Ngày {selectedDay} — {selectedClientIds.length} khách hàng
                  </div>
                  <button onClick={() => setSelectedDay(null)} className="text-[#aaa] hover:text-[#666] transition">
                    <XIcon size={14} />
                  </button>
                </div>
                <div className="divide-y divide-[#F0EEE9]">
                  {selectedClientIds.map(clientId => {
                    const evts = selectedEvents.filter(e => e.client.id === clientId);
                    const c = evts[0].client;
                    const seenTypes = [...new Set(evts.map(e => e.type))];
                    return (
                      <div key={clientId} className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="text-[13px] font-semibold text-[#111] truncate">{c.name}</div>
                            <div className="flex gap-1.5 mt-1 flex-wrap">
                              {seenTypes.map(type => {
                                const cfg = EVENT_CFG[type];
                                return (
                                  <span key={type} className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${cfg.pill} ${cfg.text}`}>
                                    {cfg.label}
                                  </span>
                                );
                              })}
                            </div>
                            <div className="text-[11.5px] text-[#aaa] mt-1">
                              Chốt: ngày {c.cutoff_day}{c.cutoff_day_end ? `–${c.cutoff_day_end}` : ''} · Tính lương: {c.calc_day}{c.calc_day_end ? `–${c.calc_day_end}` : ''} · Kỳ TT: {c.payment_start}–{c.payment_end} · Phát lương: {c.salary_day}{c.salary_day_end ? `–${c.salary_day_end}` : ''}
                            </div>
                          </div>
                          <button onClick={() => startEdit(c)} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11.5px] font-medium border border-blue-400 text-blue-700 hover:bg-blue-50 transition shrink-0">
                            <Pencil size={11} /> Chỉnh sửa
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <FinanceTimeline clients={clients} onClientClick={startEdit} />
          </>
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
                { label: 'Chốt công', start: 'cutoff_day', end: 'cutoff_day_end', dot: 'bg-orange-400' },
                { label: 'Tính lương', start: 'calc_day', end: 'calc_day_end', dot: 'bg-blue-400' },
                { label: 'Kỳ thanh toán', start: 'payment_start', end: 'payment_end', dot: 'bg-emerald-500' },
                { label: 'Phát lương', start: 'salary_day', end: 'salary_day_end', dot: 'bg-purple-500' },
              ] as { label: string; start: keyof typeof editForm; end: keyof typeof editForm; dot: string }[]).map(row => (
                <div key={row.start} className="flex items-center gap-3">
                  <div className="w-[110px] shrink-0 flex items-center gap-1.5 text-[12.5px] font-medium text-[#444]">
                    <span className={`inline-block w-2 h-2 rounded-full ${row.dot}`} />
                    {row.label}
                  </div>
                  <div className="flex-1">
                    <label className="text-[10.5px] text-[#999] block mb-0.5">Ngày bắt đầu</label>
                    <input
                      type="number" min={1} max={31}
                      value={editForm[row.start] ?? 1}
                      onChange={e => setEditForm({ ...editForm, [row.start]: Math.max(1, Math.min(31, +e.target.value)) })}
                      className="w-full text-[13px] px-2.5 py-1.5 border border-gray-300 rounded-lg outline-none focus:border-blue-500"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="text-[10.5px] text-[#999] block mb-0.5">Ngày kết thúc</label>
                    <input
                      type="number" min={1} max={31}
                      placeholder="—"
                      value={editForm[row.end] ?? ''}
                      onChange={e => {
                        const v = e.target.value;
                        setEditForm({ ...editForm, [row.end]: v === '' ? null : Math.max(1, Math.min(31, +v)) });
                      }}
                      className="w-full text-[13px] px-2.5 py-1.5 border border-gray-300 rounded-lg outline-none focus:border-blue-500"
                    />
                  </div>
                </div>
              ))}
            </div>
            <div className="text-[11px] text-[#aaa] mt-2.5">Để trống "Ngày kết thúc" nếu mốc chỉ diễn ra trong 1 ngày.</div>

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
