// ============================================================================
// DailyAttentionAlert — lần mở app ĐẦU TIÊN mỗi ngày: nhắc việc quá hạn / đến hạn hôm nay,
// đặc biệt hợp đồng cần báo khách. Mỗi ngày 1 lần trên mỗi trình duyệt (khoá theo người + ngày,
// lưu localStorage). Chỉ đọc work_tasks của chính người đăng nhập (cùng điều kiện Workspace).
// Không có việc nào cần chú ý → không hiện, cũng không ghi nhận "đã xem".
// ============================================================================
import { useEffect, useState } from 'react';
import { AlertTriangle, FileText, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { todayVN } from '../lib/cskh/dates';
import { taskGroupOf, taskTypeLabel } from '../lib/workTaskTypes';
import type { WorkTask } from '../lib/types';

const seenKey = (userId: string, day: string) => `lgvn_daily_attention_${userId}_${day}`;
const MAX_ROWS = 8;

type Row = Pick<WorkTask, 'id' | 'title' | 'task_type' | 'due_date' | 'client_id'>;

function daysLate(due: string, today: string): number {
  return Math.round((Date.parse(today) - Date.parse(due)) / 86400000);
}

export default function DailyAttentionAlert({ userId, onOpenWorkspace }: { userId: string; onOpenWorkspace: () => void }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [today, setToday] = useState('');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const day = todayVN();
    try { if (localStorage.getItem(seenKey(userId, day))) return; } catch { /* bỏ qua */ }
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from('work_tasks')
        .select('id, title, task_type, due_date, client_id, doc_status')
        .eq('user_id', userId).is('deleted_at', null).is('voided_at', null).neq('status', 'done')
        .lte('due_date', day).order('due_date', { ascending: true });
      if (cancelled || error || !data) return;
      const list = (data as (Row & { doc_status?: string | null })[])
        .filter(t => t.doc_status !== 'hoan_tat' && t.doc_status !== 'ngung_hd');
      if (!list.length) return;
      setRows(list); setToday(day); setOpen(true);
    })();
    return () => { cancelled = true; };
  }, [userId]);

  if (!open) return null;

  const close = () => {
    try { localStorage.setItem(seenKey(userId, today), '1'); } catch { /* bỏ qua */ }
    setOpen(false);
  };
  const overdue = rows.filter(r => r.due_date < today);
  const dueToday = rows.filter(r => r.due_date === today);
  const contracts = rows.filter(r => taskGroupOf(r.task_type) === 'Hợp đồng');
  // Hợp đồng lên đầu, rồi đến việc trễ nhất
  const shown = [...rows].sort((a, b) =>
    Number(taskGroupOf(b.task_type) === 'Hợp đồng') - Number(taskGroupOf(a.task_type) === 'Hợp đồng') || a.due_date.localeCompare(b.due_date),
  ).slice(0, MAX_ROWS);

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end md:items-center justify-center z-[70] md:p-4" role="dialog" aria-modal="true" aria-labelledby="daily-att-title">
      <div className="bg-white rounded-t-[22px] md:rounded-[22px] shadow-xl w-full md:max-w-md max-h-[85vh] overflow-y-auto pb-[env(safe-area-inset-bottom)]">
        <div className="flex items-center gap-3 px-5 pt-5 pb-2 sticky top-0 bg-white">
          <span className="w-9 h-9 shrink-0 rounded-full bg-[#FF3B30]/[0.12] text-[#D70015] flex items-center justify-center"><AlertTriangle size={17} /></span>
          <h2 id="daily-att-title" className="flex-1 min-w-0 text-[17px] font-bold tracking-[-0.02em] text-[#1D1D1F]">Việc cần chú ý hôm nay</h2>
          <button onClick={close} aria-label="Đóng" className="w-8 h-8 rounded-full bg-black/[0.05] text-[#86868B] flex items-center justify-center hover:bg-black/[0.09]"><X size={15} /></button>
        </div>
        <p className="px-5 text-[12.5px] text-[#86868B]">
          {overdue.length > 0 && <b className="text-[#D70015]">{overdue.length} quá hạn</b>}
          {overdue.length > 0 && dueToday.length > 0 && ' · '}
          {dueToday.length > 0 && <b className="text-[#B25000]">{dueToday.length} đến hạn hôm nay</b>}
          {contracts.length > 0 && <> · {contracts.length} liên quan hợp đồng — nhớ báo khách</>}
        </p>
        <ul className="px-5 py-2">
          {shown.map(r => {
            const late = daysLate(r.due_date, today);
            return (
              <li key={r.id} className="flex items-center gap-3 py-2.5 border-b border-[#F0F0F2] last:border-0">
                <span className={`w-[34px] h-[34px] shrink-0 rounded-full flex items-center justify-center ${taskGroupOf(r.task_type) === 'Hợp đồng' ? 'bg-[#0071E3]/[0.12] text-[#0058B0]' : 'bg-black/[0.05] text-[#6E6E73]'}`}>
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
        {rows.length > MAX_ROWS && <p className="px-5 pb-1 text-[12px] text-[#86868B]">và {rows.length - MAX_ROWS} việc khác…</p>}
        <div className="px-5 pb-5 pt-1 flex flex-wrap justify-end gap-2">
          <button onClick={() => { close(); onOpenWorkspace(); }} className="h-10 md:h-9 px-4 rounded-full bg-[rgba(118,118,128,0.12)] text-[13px] font-medium text-[#1D1D1F] hover:bg-[rgba(118,118,128,0.2)]">
            Mở Workspace
          </button>
          <button onClick={close} className="h-10 md:h-9 px-5 rounded-full bg-[#0071E3] text-white text-[13px] font-semibold hover:bg-[#0077ED]">Đã xem</button>
        </div>
      </div>
    </div>
  );
}
