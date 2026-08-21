// ============================================================================
// UpcomingDatesReminder — nhắc sinh nhật & ngày đặc biệt sắp tới, tự mở khi
// vào app. Mỗi ngày chỉ hiện 1 lần (theo user, lưu trong localStorage); nếu
// còn ngày nào trong vòng 7 ngày tới thì hôm sau vẫn tự hiện lại, cho tới khi
// hết hạn 7 ngày đó.
// ============================================================================
import { useState, useEffect } from 'react';
import { CalendarHeart, Gift, X } from 'lucide-react';
import { fetchUpcomingContactEvents, type UpcomingEvent } from '../../lib/contactSpecialDates';
import { AvatarCircle } from './AvatarUpload';

const WINDOW_DAYS = 7;

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

interface Props {
  userId: string;
  /** Cho phép trang khác (VD nút chuông) mở lại modal ngoài giờ tự động. */
  forceOpenToken?: number;
}

export default function UpcomingDatesReminder({ userId, forceOpenToken }: Props) {
  const [events, setEvents] = useState<UpcomingEvent[] | null>(null);
  const [open, setOpen] = useState(false);
  const dismissKey = `lgvn_bday_seen_${userId}_${todayKey()}`;

  useEffect(() => {
    fetchUpcomingContactEvents(WINDOW_DAYS).then(list => {
      setEvents(list);
      if (list.length > 0 && !localStorage.getItem(dismissKey)) setOpen(true);
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  useEffect(() => {
    if (forceOpenToken) setOpen(true);
  }, [forceOpenToken]);

  const close = () => {
    localStorage.setItem(dismissKey, '1');
    setOpen(false);
  };

  if (!open || !events || events.length === 0) return null;

  const dayLabel = (n: number) => (n === 0 ? 'Hôm nay!' : n === 1 ? 'Ngày mai' : `Còn ${n} ngày`);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[70] p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 sticky top-0 bg-white">
          <h2 className="text-[15px] font-semibold text-gray-900 flex items-center gap-1.5">
            <Gift className="w-4 h-4 text-pink-500" /> Ngày sắp tới cần chuẩn bị quà
          </h2>
          <button onClick={close} className="p-1 hover:bg-gray-100 rounded-md"><X className="w-4 h-4 text-gray-500" /></button>
        </div>

        <ul className="divide-y divide-gray-100">
          {events.map((e, i) => (
            <li key={i} className="flex items-center gap-3 px-5 py-3">
              <AvatarCircle url={e.avatarUrl} name={e.contactName} size={36} />
              <div className="flex-1 min-w-0">
                <div className="text-[13.5px] font-semibold text-gray-900 truncate">{e.contactName}</div>
                <div className="text-[11.5px] text-gray-500 truncate">
                  {e.label !== 'Sinh nhật' && <CalendarHeart className="inline w-3 h-3 text-pink-400 -mt-0.5 mr-0.5" />}
                  {e.label}{e.role ? ` · ${e.role}` : ''}{e.clientName ? ` · ${e.clientName}` : ''}
                </div>
              </div>
              <span className={`shrink-0 text-[11px] font-semibold px-2 py-1 rounded-full ${
                e.isToday ? 'bg-pink-100 text-pink-700' : e.daysUntil <= 2 ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'
              }`}>
                {dayLabel(e.daysUntil)}
              </span>
            </li>
          ))}
        </ul>

        <div className="px-5 py-3 border-t border-gray-200 flex justify-end">
          <button onClick={close} className="px-4 py-1.5 bg-blue-600 text-white rounded-lg text-[13px] font-medium hover:bg-blue-700">
            Đã xem
          </button>
        </div>
      </div>
    </div>
  );
}
