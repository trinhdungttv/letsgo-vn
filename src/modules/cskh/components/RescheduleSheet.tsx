// Hẹn lại việc đã hứa: tới ngày mà khách / mình đổi lịch hoặc huỷ thì chọn ngày mới, hoặc "Để dịp khác"
// (bỏ hạn — hết nhắc hằng ngày, việc vẫn nằm ở "Việc đang mở" để hẹn lại khi có dịp). Dùng chung cho
// Hôm nay cần liên hệ, thẻ tóm tắt, danh sách Việc đã hứa và Nhật ký.
import { useState } from 'react';
import { CalendarClock, CalendarX2 } from 'lucide-react';
import { useAuth } from '../../../lib/auth';
import { formatDateVN, todayVN } from '../../../lib/cskh/dates';
import { emitCskhDataChanged } from '../../../lib/cskh/events';
import { addDaysIso, diffDays } from '../../../lib/cskh/lunar';
import type { CskhInteraction } from '../../../lib/cskh/types';
import { rescheduleFollowUp } from '../data/api';
import { useCskh } from '../context';
import { inputCls } from '../ui';
import { Sheet } from './Sheet';

const QUICK_PICKS: readonly { label: string; days: number }[] = [
  { label: 'Ngày mai', days: 1 },
  { label: '3 ngày nữa', days: 3 },
  { label: 'Tuần sau', days: 7 },
  { label: '2 tuần nữa', days: 14 },
  { label: 'Tháng sau', days: 30 },
];

export function RescheduleSheet({ item, onClose }: { item: CskhInteraction; onClose: () => void }) {
  const { user } = useAuth();
  const { toast } = useCskh();
  const today = todayVN();
  const [date, setDate] = useState('');
  const [busy, setBusy] = useState(false);

  // Việc thêm (id có "#") chỉ có ở Workspace → không có chỗ lưu "chưa có hạn"
  const canPark = !item.id.includes('#') && item.followUpDue !== null;
  const late = item.followUpDue ? diffDays(item.followUpDue, today) : null;
  const who = item.contactPerson || 'người liên hệ';

  const run = async (due: string | null) => {
    setBusy(true);
    try {
      await rescheduleFollowUp(item, due, user);
      emitCskhDataChanged();
      toast(due
        ? `Đã hẹn lại ${formatDateVN(due)} — ${who}`
        : `Đã để dịp khác — việc vẫn còn ở "Việc đang mở", hẹn lại khi có lịch${item.followUpTaskId ? ' (Workspace đã gỡ khỏi lịch)' : ''}`);
      onClose();
    } catch (e) {
      toast('Lỗi: ' + (e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Sheet label="Hẹn lại việc đã hứa" onClose={onClose}>
      <h2 className="text-[20px] font-bold tracking-[-0.02em] text-[#1D1D1F] pr-8">Hẹn lại</h2>
      <p className="mt-1 text-[13.5px] leading-snug text-[#1D1D1F]">
        <span className="font-medium">{item.followUpAction}</span>
        <span className="text-[#86868B]"> — {who}</span>
      </p>
      <p className="mt-1 text-[12px] text-[#86868B]">
        {item.followUpDue === null ? 'Hiện chưa có ngày (để dịp khác)'
          : <>Hạn cũ: {formatDateVN(item.followUpDue)}{late !== null && late > 0 ? ` · đã trễ ${late} ngày` : late === 0 ? ' · hôm nay' : ''}</>}
      </p>

      <p className="mt-4 mb-1.5 text-[12px] font-semibold uppercase tracking-[0.04em] text-[#86868B]">Hẹn lại vào</p>
      <div className="grid grid-cols-3 gap-2">
        {QUICK_PICKS.map(p => {
          const d = addDaysIso(today, p.days);
          const on = date === d;
          return (
            <button key={p.days} type="button" onClick={() => setDate(d)} aria-pressed={on}
              className={`h-[52px] rounded-[12px] text-[12.5px] font-medium flex flex-col items-center justify-center leading-tight transition active:scale-[0.97] ${on
                ? 'bg-[#0071E3] text-white' : 'bg-white md:bg-[#F5F5F7] text-[#1D1D1F] hover:bg-[#0071E3]/10'}`}>
              {p.label}
              <span className={`text-[11px] tabular-nums ${on ? 'text-white/80' : 'text-[#86868B]'}`}>{formatDateVN(d).slice(0, 5)}</span>
            </button>
          );
        })}
        <input type="date" value={date} min={today} onChange={e => setDate(e.target.value)} aria-label="Chọn ngày khác"
          className={`${inputCls} !h-[52px] !text-[12.5px]`} />
      </div>

      <button type="button" disabled={busy || !date || date < today} onClick={() => void run(date)}
        className="mt-3 w-full h-11 md:h-9 rounded-full bg-[#0071E3] text-white text-[13px] font-semibold hover:bg-[#0077ED] active:scale-[0.98] transition disabled:opacity-40 inline-flex items-center justify-center gap-1.5">
        <CalendarClock size={15} strokeWidth={2.3} />
        {date ? `Hẹn lại ngày ${formatDateVN(date)}` : 'Chọn ngày hẹn lại'}
      </button>

      {canPark ? (
        <div className="mt-4 pt-3 border-t border-black/[0.08]">
          <button type="button" disabled={busy} onClick={() => void run(null)}
            className="w-full h-11 md:h-9 rounded-full bg-[rgba(118,118,128,0.12)] text-[#1D1D1F] text-[13px] font-medium hover:bg-[rgba(118,118,128,0.2)] active:scale-[0.98] transition disabled:opacity-40 inline-flex items-center justify-center gap-1.5">
            <CalendarX2 size={15} strokeWidth={2.2} /> Để dịp khác
          </button>
          <p className="mt-1.5 text-[11.5px] leading-snug text-[#86868B]">
            Chưa có ngày: hết nhắc mỗi ngày và không báo trễ, nhưng việc vẫn còn ở "Việc đang mở" để hẹn lại khi có dịp.
            {item.followUpTaskId && ' Việc trong Workspace được gỡ khỏi lịch, hẹn lại sẽ khôi phục.'}
          </p>
        </div>
      ) : item.id.includes('#') && (
        <p className="mt-3 text-[11.5px] leading-snug text-[#86868B]">Đây là việc thêm (nằm ở Workspace) nên chỉ hẹn lại ngày mới được. Muốn bỏ hẳn thì sửa dòng nhật ký.</p>
      )}

      <button type="button" onClick={onClose} disabled={busy}
        className="mt-3 w-full h-11 md:h-9 rounded-full text-[13px] font-medium text-[#0071E3] hover:bg-[#0071E3]/[0.06] transition disabled:opacity-40">Đóng</button>
    </Sheet>
  );
}
