import { useEffect, useState } from 'react';
import { Bell, BellOff, X } from 'lucide-react';
import { useOffice } from '../data/OfficeDataProvider';
import { useOfficeEvents } from '../data/useSmart';
import EventItem from './EventItem';
import { SubTabs } from './ui';

type Tab = 'urgent' | 'upcoming' | 'hidden';

export default function NotificationBell() {
  const { notifyReady } = useOffice();
  const { visible, hidden } = useOfficeEvents();
  const [open, setOpen] = useState(false);
  const urgent = visible.filter(e => e.severity !== 'info');
  const upcoming = visible.filter(e => e.severity === 'info');
  const [tab, setTab] = useState<Tab>('urgent');
  const critical = urgent.filter(e => e.severity === 'critical').length;

  useEffect(() => {
    if (!open) return;
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const list = tab === 'urgent' ? urgent : tab === 'upcoming' ? upcoming : hidden;

  return (
    <>
      <button
        onClick={() => { setOpen(true); setTab(urgent.length ? 'urgent' : 'upcoming'); }}
        className="relative p-1.5 rounded-lg text-gray-500 hover:text-gray-800 hover:bg-gray-100"
        title="Thông báo Văn phòng Orient" aria-label="Thông báo"
      >
        <Bell size={17} />
        {urgent.length > 0 && (
          <span className={`absolute -top-0.5 -right-0.5 min-w-[17px] h-[17px] px-1 rounded-full text-[10px] font-bold text-white flex items-center justify-center ${critical ? 'bg-red-600' : 'bg-amber-500'}`}>
            {urgent.length > 99 ? '99+' : urgent.length}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed inset-0 z-[75] bg-black/30" onMouseDown={e => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div className="absolute inset-x-0 bottom-0 md:inset-x-auto md:bottom-auto md:right-4 md:top-14 md:w-[440px] max-h-[85dvh] md:max-h-[80vh] bg-[#F7F6F2] md:bg-white rounded-t-2xl md:rounded-xl shadow-2xl flex flex-col">
            <div className="flex items-center justify-between px-4 pt-3 pb-1">
              <div className="text-[14px] font-semibold text-[#111] flex items-center gap-1.5"><Bell size={15} /> Thông báo</div>
              <button onClick={() => setOpen(false)} className="p-1 rounded hover:bg-gray-100 text-gray-400" aria-label="Đóng"><X size={16} /></button>
            </div>
            <div className="px-3">
              <SubTabs
                tabs={[
                  { key: 'urgent', label: `Cần xử lý (${urgent.length})` },
                  { key: 'upcoming', label: `Sắp tới (${upcoming.length})` },
                  { key: 'hidden', label: `Đã ẩn (${hidden.length})` },
                ]}
                value={tab} onChange={setTab}
              />
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2 pb-[max(12px,env(safe-area-inset-bottom))]">
              {list.map(e => <EventItem key={e.key} e={e} hidden={tab === 'hidden'} onOpen={() => setOpen(false)} />)}
              {!list.length && (
                <div className="text-center text-[12.5px] text-gray-400 py-10 flex flex-col items-center gap-2">
                  <BellOff size={22} />
                  {tab === 'urgent' ? 'Không có việc gấp. Mọi thứ đang ổn ✓' : tab === 'upcoming' ? 'Không có sự kiện nào trong thời gian nhắc trước.' : 'Chưa ẩn thông báo nào.'}
                </div>
              )}
              {!notifyReady && (
                <div className="text-[10.5px] text-gray-400 text-center pt-1">Trạng thái "đã xử lý" đang lưu trên máy này — chạy migration 166 để đồng bộ giữa điện thoại và máy tính.</div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
