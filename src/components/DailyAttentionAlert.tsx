// ============================================================================
// DailyAttentionAlert — lần mở app ĐẦU TIÊN mỗi ngày: popup nhiều tab.
//   • Việc cần chú ý: việc quá hạn / đến hạn hôm nay (work_tasks của chính người đăng nhập), hợp đồng lên đầu
//   • Chốt công / Chốt hóa đơn / Ứng lương / Chi lương: khách hàng có mốc rơi vào hôm nay hoặc sắp tới
//     (đọc từ cutoff_day / invoice_day / extra_salary_days / salary_day của khách — cùng nguồn trang Tài chính)
// Người dùng bấm bánh răng để chọn tab nào xếp trước / ẩn tab nào / nhìn trước mấy ngày
// (lưu localStorage theo người trên trình duyệt này). Mỗi ngày 1 lần (khoá theo người + ngày).
// Không có gì cần chú ý ở bất kỳ tab nào → không hiện, cũng không ghi nhận "đã xem".
// ============================================================================
import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowDown, ArrowUp, Bell, FileText, Settings2, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { todayVN } from '../lib/cskh/dates';
import { taskGroupOf, taskTypeLabel } from '../lib/workTaskTypes';
import type { Client, WorkTask } from '../lib/types';
import { daysOfMonth, formatDayRange, normalizeDayRange, resolveDay } from '../utils/timelineDays';

const seenKey = (userId: string, day: string) => `lgvn_daily_attention_${userId}_${day}`;
const prefsKey = (userId: string) => `lgvn_daily_alert_prefs_${userId}`;
const MAX_ROWS = 12;

type TabId = 'tasks' | 'cutoff' | 'invoice' | 'advance' | 'payroll';
const TAB_LABEL: Record<TabId, string> = {
  tasks: 'Việc cần chú ý',
  cutoff: 'Chốt công',
  invoice: 'Chốt hóa đơn',
  advance: 'Ứng lương',
  payroll: 'Chi lương',
};
const DEFAULT_ORDER: TabId[] = ['tasks', 'cutoff', 'invoice', 'advance', 'payroll'];
const LOOKAHEADS = [0, 1, 3, 7];

interface Prefs { order: TabId[]; hidden: TabId[]; look: number }
const DEFAULT_PREFS: Prefs = { order: DEFAULT_ORDER, hidden: [], look: 3 };

function loadPrefs(userId: string): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(prefsKey(userId)) || 'null') as Partial<Prefs> | null;
    if (!raw) return DEFAULT_PREFS;
    const order = (raw.order || []).filter((t): t is TabId => DEFAULT_ORDER.includes(t as TabId));
    for (const t of DEFAULT_ORDER) if (!order.includes(t)) order.push(t);
    const hidden = (raw.hidden || []).filter((t): t is TabId => DEFAULT_ORDER.includes(t as TabId));
    const look = LOOKAHEADS.includes(Number(raw.look)) ? Number(raw.look) : DEFAULT_PREFS.look;
    return { order, hidden, look };
  } catch { return DEFAULT_PREFS; }
}

type TaskRow = Pick<WorkTask, 'id' | 'title' | 'task_type' | 'due_date' | 'client_id'>;

interface FinRow { id: string; name: string; range: string; offset: number }

function daysLate(due: string, today: string): number {
  return Math.round((Date.parse(today) - Date.parse(due)) / 86400000);
}

/** Số ngày từ hôm nay đến lần gần nhất mốc [start,end] rơi vào (0 = hôm nay / đang trong kỳ); null nếu ngoài tầm nhìn. */
function nearestOffset(start: number | null | undefined, end: number | null | undefined, today: string, look: number): number | null {
  const { start: s, end: e } = normalizeDayRange(start, end);
  if (s == null) return null;
  const [y, m, d] = today.split('-').map(Number);
  for (let off = 0; off <= look; off++) {
    const dt = new Date(Date.UTC(y, m - 1, d + off));
    const dim = daysOfMonth(dt.getUTCFullYear(), dt.getUTCMonth() + 1);
    const a = resolveDay(s, dim);
    const b = e == null ? a : resolveDay(e, dim);
    const dn = dt.getUTCDate();
    if (a != null && b != null && dn >= a && dn <= b) return off;
  }
  return null;
}

function buildFinance(clients: Client[], today: string, look: number): Record<'cutoff' | 'invoice' | 'advance' | 'payroll', FinRow[]> {
  const out = { cutoff: [] as FinRow[], invoice: [] as FinRow[], advance: [] as FinRow[], payroll: [] as FinRow[] };
  for (const c of clients) {
    if (c.service_type === 'recruitment') continue;
    if (c.contract_end && c.contract_end < today) continue;
    const push = (key: keyof typeof out, start: number | null | undefined, end: number | null | undefined) => {
      const off = nearestOffset(start, end, today, look);
      if (off != null) out[key].push({ id: `${c.id}-${key}-${start}-${end}`, name: c.name, range: formatDayRange(start, end), offset: off });
    };
    push('cutoff', c.cutoff_day, c.cutoff_day_end);
    push('invoice', c.invoice_day, c.invoice_day_end);
    push('payroll', c.salary_day, c.salary_day_end);
    // Ứng lương = mốc Ứng lương riêng (advance_day + các đợt thêm) và các đợt phát lương thêm cũ; mỗi khách chỉ hiện đợt gần nhất
    let best: { start: number; end: number | null; off: number } | null = null;
    const advCandidates = [
      ...(c.advance_day != null || c.advance_day_end != null ? [{ start: (c.advance_day ?? c.advance_day_end) as number, end: c.advance_day != null ? c.advance_day_end ?? null : null }] : []),
      ...(Array.isArray(c.extra_advance_days) ? c.extra_advance_days : []),
      ...(Array.isArray(c.extra_salary_days) ? c.extra_salary_days : []),
    ];
    for (const ex of advCandidates) {
      const off = nearestOffset(ex.start, ex.end, today, look);
      if (off != null && (!best || off < best.off)) best = { start: ex.start, end: ex.end, off };
    }
    if (best) out.advance.push({ id: `${c.id}-advance`, name: c.name, range: formatDayRange(best.start, best.end), offset: best.off });
  }
  for (const k of Object.keys(out) as (keyof typeof out)[]) out[k].sort((a, b) => a.offset - b.offset || a.name.localeCompare(b.name, 'vi'));
  return out;
}

const offsetLabel = (o: number) => (o === 0 ? 'Hôm nay' : o === 1 ? 'Ngày mai' : `Còn ${o} ngày`);

interface Props {
  userId: string;
  clients: Client[];
  onOpenWorkspace: () => void;
  onOpenFinance?: () => void;
}

export default function DailyAttentionAlert({ userId, clients, onOpenWorkspace, onOpenFinance }: Props) {
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [tasksLoaded, setTasksLoaded] = useState(false);
  const [today] = useState(() => todayVN());
  const [open, setOpen] = useState(false);
  const [prefs, setPrefs] = useState<Prefs>(() => loadPrefs(userId));
  const [active, setActive] = useState<TabId | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const decided = useRef(false);
  const skipToday = useRef(false);

  useEffect(() => {
    try { if (localStorage.getItem(seenKey(userId, today))) skipToday.current = true; } catch { /* bỏ qua */ }
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from('work_tasks')
        .select('id, title, task_type, due_date, client_id, doc_status')
        .eq('user_id', userId).is('deleted_at', null).is('voided_at', null).neq('status', 'done')
        .lte('due_date', today).order('due_date', { ascending: true });
      if (cancelled) return;
      if (!error && data) {
        setTasks((data as (TaskRow & { doc_status?: string | null })[])
          .filter(t => t.doc_status !== 'hoan_tat' && t.doc_status !== 'ngung_hd'));
      }
      setTasksLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [userId, today]);

  const finance = useMemo(() => buildFinance(clients, today, prefs.look), [clients, today, prefs.look]);
  const counts: Record<TabId, number> = {
    tasks: tasks.length,
    cutoff: finance.cutoff.length,
    invoice: finance.invoice.length,
    advance: finance.advance.length,
    payroll: finance.payroll.length,
  };
  const visibleTabs = prefs.order.filter(t => !prefs.hidden.includes(t));
  const firstWithData = visibleTabs.find(t => counts[t] > 0);

  // Quyết định mở popup 1 lần: khi việc đã tải xong và danh sách khách đã có
  useEffect(() => {
    if (decided.current || skipToday.current || !tasksLoaded || clients.length === 0) return;
    decided.current = true;
    if (firstWithData) { setActive(firstWithData); setOpen(true); }
  }, [tasksLoaded, clients.length, firstWithData]);

  const total = visibleTabs.reduce((n, t) => n + counts[t], 0);
  if (!open) {
    if (!tasksLoaded || clients.length === 0) return null;
    // Bong bóng nhỏ: mở lại popup bất cứ lúc nào sau khi đã đóng
    return (
      <button
        onClick={() => { setActive(firstWithData ?? visibleTabs[0] ?? 'tasks'); setShowSettings(false); setOpen(true); }}
        aria-label="Xem lại tổng quan hôm nay" title="Xem lại tổng quan hôm nay"
        className="fixed z-[47] right-3 bottom-[calc(76px+env(safe-area-inset-bottom))] md:right-14 md:bottom-5 w-10 h-10 rounded-full bg-white text-[#1D1D1F] shadow-[0_0_0_0.5px_rgba(0,0,0,0.1),0_6px_18px_-4px_rgba(0,0,0,0.3)] flex items-center justify-center hover:scale-105 active:scale-95 transition"
      >
        <Bell size={17} />
        {total > 0 && <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-[#FF3B30] text-white text-[10.5px] font-bold flex items-center justify-center">{total > 99 ? '99+' : total}</span>}
      </button>
    );
  }

  const savePrefs = (p: Prefs) => {
    setPrefs(p);
    try { localStorage.setItem(prefsKey(userId), JSON.stringify(p)); } catch { /* bỏ qua */ }
  };
  const close = () => {
    try { localStorage.setItem(seenKey(userId, today), '1'); } catch { /* bỏ qua */ }
    setOpen(false);
  };
  const move = (id: TabId, dir: -1 | 1) => {
    const order = [...prefs.order];
    const i = order.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    savePrefs({ ...prefs, order });
  };
  const toggleHidden = (id: TabId) => {
    const hidden = prefs.hidden.includes(id) ? prefs.hidden.filter(t => t !== id) : [...prefs.hidden, id];
    savePrefs({ ...prefs, hidden });
  };

  const current: TabId = active && visibleTabs.includes(active) ? active : (visibleTabs[0] ?? 'tasks');

  const overdue = tasks.filter(r => r.due_date < today);
  const dueToday = tasks.filter(r => r.due_date === today);
  const contracts = tasks.filter(r => taskGroupOf(r.task_type) === 'Hợp đồng');
  const shownTasks = [...tasks].sort((a, b) =>
    Number(taskGroupOf(b.task_type) === 'Hợp đồng') - Number(taskGroupOf(a.task_type) === 'Hợp đồng') || a.due_date.localeCompare(b.due_date),
  ).slice(0, MAX_ROWS);

  const finRows = current === 'tasks' ? [] : finance[current];

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end md:items-center justify-center z-[70] md:p-4" role="dialog" aria-modal="true" aria-labelledby="daily-att-title">
      <div className="bg-white rounded-t-[22px] md:rounded-[22px] shadow-xl w-full md:max-w-lg max-h-[88vh] overflow-y-auto pb-[env(safe-area-inset-bottom)]">
        <div className="sticky top-0 bg-white z-10">
          <div className="flex items-center gap-3 px-5 pt-5 pb-2">
            <span className="w-9 h-9 shrink-0 rounded-full bg-[#FF3B30]/[0.12] text-[#D70015] flex items-center justify-center"><AlertTriangle size={17} /></span>
            <h2 id="daily-att-title" className="flex-1 min-w-0 text-[17px] font-bold tracking-[-0.02em] text-[#1D1D1F]">Cần chú ý hôm nay</h2>
            <button onClick={() => setShowSettings(s => !s)} aria-label="Cài đặt thứ tự tab" title="Cài đặt thứ tự tab"
              className={`w-8 h-8 rounded-full flex items-center justify-center ${showSettings ? 'bg-[#0071E3] text-white' : 'bg-black/[0.05] text-[#86868B] hover:bg-black/[0.09]'}`}><Settings2 size={15} /></button>
            <button onClick={close} aria-label="Đóng" className="w-8 h-8 rounded-full bg-black/[0.05] text-[#86868B] flex items-center justify-center hover:bg-black/[0.09]"><X size={15} /></button>
          </div>
          <div className="flex gap-1.5 px-5 pb-2 overflow-x-auto">
            {visibleTabs.map(t => (
              <button key={t} onClick={() => { setActive(t); setShowSettings(false); }}
                className={`shrink-0 h-8 px-3 rounded-full text-[12.5px] font-semibold flex items-center gap-1.5 ${current === t && !showSettings ? 'bg-[#1D1D1F] text-white' : 'bg-black/[0.05] text-[#3A3A3C] hover:bg-black/[0.09]'}`}>
                {TAB_LABEL[t]}
                <span className={`min-w-[18px] h-[18px] px-1 rounded-full text-[10.5px] flex items-center justify-center ${counts[t] > 0 ? (current === t && !showSettings ? 'bg-white/25 text-white' : 'bg-[#FF3B30] text-white') : 'bg-black/[0.08] text-[#86868B]'}`}>{counts[t]}</span>
              </button>
            ))}
          </div>
        </div>

        {showSettings ? (
          <div className="px-5 py-3">
            <p className="text-[12.5px] text-[#86868B] mb-2">Tab đứng trên cùng sẽ hiện trước khi mở app. Lưu trên trình duyệt này.</p>
            <ul>
              {prefs.order.map((t, i) => (
                <li key={t} className="flex items-center gap-2 py-2 border-b border-[#F0F0F2] last:border-0">
                  <input type="checkbox" checked={!prefs.hidden.includes(t)} onChange={() => toggleHidden(t)} className="w-4 h-4 accent-[#0071E3]" aria-label={`Hiện tab ${TAB_LABEL[t]}`} />
                  <span className={`flex-1 text-[13.5px] ${prefs.hidden.includes(t) ? 'text-[#A1A1A6] line-through' : 'text-[#1D1D1F] font-medium'}`}>{i + 1}. {TAB_LABEL[t]}</span>
                  <button onClick={() => move(t, -1)} disabled={i === 0} aria-label="Lên" className="w-8 h-8 rounded-full bg-black/[0.05] flex items-center justify-center disabled:opacity-30"><ArrowUp size={14} /></button>
                  <button onClick={() => move(t, 1)} disabled={i === prefs.order.length - 1} aria-label="Xuống" className="w-8 h-8 rounded-full bg-black/[0.05] flex items-center justify-center disabled:opacity-30"><ArrowDown size={14} /></button>
                </li>
              ))}
            </ul>
            <div className="mt-3">
              <div className="text-[12.5px] text-[#86868B] mb-1.5">Nhìn trước các mốc Chốt công / Hóa đơn / Lương:</div>
              <div className="flex gap-1.5 flex-wrap">
                {LOOKAHEADS.map(n => (
                  <button key={n} onClick={() => savePrefs({ ...prefs, look: n })}
                    className={`h-8 px-3 rounded-full text-[12.5px] font-semibold ${prefs.look === n ? 'bg-[#0071E3] text-white' : 'bg-black/[0.05] text-[#3A3A3C]'}`}>
                    {n === 0 ? 'Chỉ hôm nay' : `${n} ngày tới`}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : current === 'tasks' ? (
          <>
            {tasks.length === 0 ? (
              <p className="px-5 py-6 text-[13px] text-[#86868B]">Không có việc quá hạn hay đến hạn hôm nay.</p>
            ) : (
              <p className="px-5 text-[12.5px] text-[#86868B]">
                {overdue.length > 0 && <b className="text-[#D70015]">{overdue.length} quá hạn</b>}
                {overdue.length > 0 && dueToday.length > 0 && ' · '}
                {dueToday.length > 0 && <b className="text-[#B25000]">{dueToday.length} đến hạn hôm nay</b>}
                {contracts.length > 0 && <> · {contracts.length} liên quan hợp đồng — nhớ báo khách</>}
              </p>
            )}
            <ul className="px-5 py-2">
              {shownTasks.map(r => {
                const late = daysLate(r.due_date, today);
                const isContract = taskGroupOf(r.task_type) === 'Hợp đồng';
                return (
                  <li key={r.id} className="flex items-center gap-3 py-2.5 border-b border-[#F0F0F2] last:border-0">
                    <span className={`w-[34px] h-[34px] shrink-0 rounded-full flex items-center justify-center ${isContract ? 'bg-[#0071E3]/[0.12] text-[#0058B0]' : 'bg-black/[0.05] text-[#6E6E73]'}`}>
                      <FileText size={16} />
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13.5px] font-semibold text-[#1D1D1F] line-clamp-2">{r.title}</div>
                      <div className="text-[11.5px] text-[#86868B] truncate">{taskTypeLabel(r.task_type)}</div>
                    </div>
                    <span className={`shrink-0 text-[11.5px] font-semibold px-2.5 py-1 rounded-full ${late > 0 ? 'bg-[#FF3B30]/[0.12] text-[#D70015]' : 'bg-[#FF9500]/[0.14] text-[#B25000]'}`}>
                      {late > 0 ? `Trễ ${late} ngày` : 'Hôm nay'}
                    </span>
                  </li>
                );
              })}
            </ul>
            {tasks.length > MAX_ROWS && <p className="px-5 pb-1 text-[12px] text-[#86868B]">và {tasks.length - MAX_ROWS} việc khác…</p>}
          </>
        ) : (
          <>
            <p className="px-5 text-[12.5px] text-[#86868B]">
              {finRows.length === 0
                ? `Không có khách nào có mốc ${TAB_LABEL[current].toLowerCase()} ${prefs.look === 0 ? 'hôm nay' : `trong ${prefs.look} ngày tới`}.`
                : <><b className="text-[#1D1D1F]">{finRows.length} khách</b> có mốc {TAB_LABEL[current].toLowerCase()} {prefs.look === 0 ? 'hôm nay' : `trong ${prefs.look} ngày tới`}</>}
            </p>
            <ul className="px-5 py-2">
              {finRows.slice(0, 40).map(r => (
                <li key={r.id} className="flex items-center gap-3 py-2.5 border-b border-[#F0F0F2] last:border-0">
                  <div className="flex-1 min-w-0">
                    <div className="text-[13.5px] font-semibold text-[#1D1D1F] line-clamp-2">{r.name}</div>
                    <div className="text-[11.5px] text-[#86868B]">Ngày {r.range}</div>
                  </div>
                  <span className={`shrink-0 text-[11.5px] font-semibold px-2.5 py-1 rounded-full ${r.offset === 0 ? 'bg-[#FF9500]/[0.14] text-[#B25000]' : 'bg-black/[0.05] text-[#6E6E73]'}`}>
                    {offsetLabel(r.offset)}
                  </span>
                </li>
              ))}
            </ul>
            {finRows.length > 40 && <p className="px-5 pb-1 text-[12px] text-[#86868B]">và {finRows.length - 40} khách khác…</p>}
          </>
        )}

        <div className="px-5 pb-5 pt-1 flex flex-wrap justify-end gap-2">
          {current === 'tasks' ? (
            <button onClick={() => { close(); onOpenWorkspace(); }} className="h-10 md:h-9 px-4 rounded-full bg-[rgba(118,118,128,0.12)] text-[13px] font-medium text-[#1D1D1F] hover:bg-[rgba(118,118,128,0.2)]">
              Mở Workspace
            </button>
          ) : onOpenFinance && (
            <button onClick={() => { close(); onOpenFinance(); }} className="h-10 md:h-9 px-4 rounded-full bg-[rgba(118,118,128,0.12)] text-[13px] font-medium text-[#1D1D1F] hover:bg-[rgba(118,118,128,0.2)]">
              Mở Tài chính
            </button>
          )}
          <button onClick={close} className="h-10 md:h-9 px-5 rounded-full bg-[#0071E3] text-white text-[13px] font-semibold hover:bg-[#0077ED]">Đã xem</button>
        </div>
      </div>
    </div>
  );
}
