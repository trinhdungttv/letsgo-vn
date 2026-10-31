// ============================================================================
// UpcomingDatesReminder — nhắc sinh nhật & ngày quan trọng khi mở app (mọi trang).
// ----------------------------------------------------------------------------
// Từ CSKH nâng cấp 24/10/2026 (port PRM OccasionAlertHost): mỗi sự kiện nhắc 2 lần —
// lần mở app ĐẦU TIÊN trong 2 ngày trước (Tony chốt 31/10; sự kiện đặt "chỉ đúng ngày" thì bỏ
// mốc này) và ĐÚNG NGÀY; mỗi mốc chỉ hiện 1 lần trên mỗi trình duyệt (khoá `id:ngàyLầnTới:mốc`,
// lưu localStorage theo người dùng, tự dọn mốc đã qua). App để mở qua đêm (iPad/PWA) thì
// kiểm lại khi quay lại màn hình sang ngày mới. Nhắc MỌI người liên hệ của khách đang phụ trách,
// kể cả người chưa xếp hạng chăm sóc (Tony chốt 31/10/2026); bỏ người đã nghỉ.
// Kèm ngày của CÔNG TY đang hợp tác (migration 185): thành lập, kỷ niệm, ngày lễ công ty và
// ngày lễ quốc gia người đứng đầu (1 dòng gom các công ty cùng nước) — cùng luật 2 mốc.
// DB chưa chạy migration CSKH → giữ cách cũ (mọi ngày trong 7 ngày tới, mỗi ngày 1 lần).
// ============================================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import { Building2, CalendarHeart, Gift, Globe2, X } from 'lucide-react';
import { fetchOccasionAlerts, fetchUpcomingContactEvents, type UpcomingEvent } from '../../lib/contactSpecialDates';
import { todayVN } from '../../lib/cskh/dates';
import { alertWhen, pruneSeenKeys, type OccasionAlert } from '../../lib/cskh/occasions';
import { agendaCompanies, agendaTitle, COMPANY_OCCASION_LABEL, type CompanyAlert } from '../../lib/cskh/companyDates';
import { fetchCompanyAlerts } from '../../lib/companyDatesApi';
import { AvatarCircle } from './AvatarUpload';

const WINDOW_DAYS = 7;
const seenKey = (userId: string) => `lgvn_occ_alert_seen_${userId}`;

function readSeen(userId: string): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(seenKey(userId)) ?? '[]');
    return new Set(Array.isArray(raw) ? raw.filter((k): k is string => typeof k === 'string') : []);
  } catch {
    return new Set();
  }
}

function writeSeen(userId: string, keys: string[]) {
  try {
    localStorage.setItem(seenKey(userId), JSON.stringify(keys));
  } catch {
    // chế độ riêng tư / bị chặn lưu trữ — lần sau mở app nhắc lại, chấp nhận được
  }
}

/** Một dòng hiển thị chung cho cả cách mới (mốc) lẫn cách cũ. */
interface Item {
  key: string;
  name: string;
  avatarUrl: string | null;
  label: string;
  sub: string;
  daysUntil: number;
  notBirthday: boolean;
  /** Dòng ngày công ty / ngày lễ quốc gia — hiện ô biểu tượng thay ảnh đại diện. */
  icon?: 'company' | 'national';
  /** Gợi ý chăm sóc của ngày lễ quốc gia. */
  tip?: string;
}

const fromAlert = (a: OccasionAlert): Item => ({
  key: a.key,
  name: a.contactName,
  avatarUrl: a.avatarUrl || null,
  label: `${a.label}${a.age !== null ? ` · tròn ${a.age} tuổi` : ''} · ${a.nextIso.slice(8, 10)}/${a.nextIso.slice(5, 7)}${a.isLunar ? ` (âm ${a.lunarDayMonth})` : ''}`,
  sub: a.sub,
  daysUntil: a.daysUntil,
  notBirthday: !a.label.startsWith('Sinh nhật'),
});

const fromCompany = ({ key, item }: CompanyAlert): Item => {
  const national = item.type === 'national';
  const lunar = national ? item.holiday.isLunar : item.occasion.isLunar;
  const lunarDm = national ? `${item.holiday.day}/${item.holiday.month}` : `${item.occasion.day}/${item.occasion.month}`;
  return {
    key,
    name: national ? `${item.holiday.title}${item.holiday.localName ? ` · ${item.holiday.localName}` : ''}` : item.client.name,
    avatarUrl: null,
    label: `${national ? `Lễ ${item.holiday.country}` : agendaTitle(item)} · ${item.nextIso.slice(8, 10)}/${item.nextIso.slice(5, 7)}${lunar ? ` (âm ${lunarDm})` : ''}`,
    sub: national ? agendaCompanies(item, 4) : COMPANY_OCCASION_LABEL[item.occasion.kind],
    daysUntil: item.daysUntil,
    notBirthday: true,
    icon: national ? 'national' : 'company',
    tip: national ? item.holiday.tip : item.occasion.note,
  };
};

const fromLegacy = (e: UpcomingEvent, i: number): Item => ({
  key: `legacy:${i}`,
  name: e.contactName,
  avatarUrl: e.avatarUrl,
  label: e.label,
  sub: [e.role, e.clientName].filter(Boolean).join(' · '),
  daysUntil: e.daysUntil,
  notBirthday: e.label !== 'Sinh nhật',
});

interface Props {
  userId: string;
  /** Cho phép trang khác (VD nút chuông) mở lại modal ngoài giờ tự động. */
  forceOpenToken?: number;
}

export default function UpcomingDatesReminder({ userId, forceOpenToken }: Props) {
  const [items, setItems] = useState<Item[]>([]);
  const [open, setOpen] = useState(false);
  /** 'legacy' = DB chưa chạy migration CSKH → nhắc kiểu cũ (mỗi ngày 1 lần). */
  const modeRef = useRef<'alerts' | 'legacy'>('alerts');
  const checkedDay = useRef('');
  const allRef = useRef<Item[]>([]);

  const check = useCallback(async () => {
    const today = todayVN();
    checkedDay.current = today;
    try {
      const [alerts, companyAlerts] = await Promise.all([
        fetchOccasionAlerts(today),
        // Ngày công ty lỗi / chưa chạy migration 185 → vẫn nhắc người liên hệ như cũ
        fetchCompanyAlerts(today).catch(() => null),
      ]);
      const companyItems = (companyAlerts ?? []).map(fromCompany);
      if (alerts) {
        modeRef.current = 'alerts';
        const all = [...alerts.map(fromAlert), ...companyItems].sort((a, b) => a.daysUntil - b.daysUntil);
        allRef.current = all;
        const seen = readSeen(userId);
        const fresh = all.filter(a => !seen.has(a.key));
        setItems(fresh);
        setOpen(fresh.length > 0);
        return;
      }
      modeRef.current = 'legacy';
      const list = [...(await fetchUpcomingContactEvents(WINDOW_DAYS)).map(fromLegacy), ...companyItems].sort((a, b) => a.daysUntil - b.daysUntil);
      allRef.current = list;
      setItems(list);
      setOpen(list.length > 0 && !localStorage.getItem(`lgvn_bday_seen_${userId}_${today}`));
    } catch {
      // lỗi mạng — lần mở app sau sẽ kiểm lại
    }
  }, [userId]);

  useEffect(() => { void check(); }, [check]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && todayVN() !== checkedDay.current) void check();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [check]);

  useEffect(() => {
    if (!forceOpenToken) return;
    setItems(allRef.current);
    setOpen(true);
  }, [forceOpenToken]);

  const close = () => {
    const today = todayVN();
    if (modeRef.current === 'alerts') writeSeen(userId, pruneSeenKeys([...readSeen(userId), ...items.map(i => i.key)], today));
    else {
      try { localStorage.setItem(`lgvn_bday_seen_${userId}_${today}`, '1'); } catch { /* bỏ qua */ }
    }
    setOpen(false);
  };

  if (!open || items.length === 0) return null;
  const todayCount = items.filter(i => i.daysUntil === 0).length;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end md:items-center justify-center z-[70] md:p-4" role="dialog" aria-modal="true" aria-labelledby="occ-alert-title">
      <div className="bg-white rounded-t-[22px] md:rounded-[22px] shadow-xl w-full md:max-w-md max-h-[85vh] overflow-y-auto pb-[env(safe-area-inset-bottom)]">
        <div className="flex items-center gap-3 px-5 pt-5 pb-2 sticky top-0 bg-white">
          <span className="w-9 h-9 shrink-0 rounded-full bg-[#FF3B30]/[0.12] text-[#D70015] flex items-center justify-center"><Gift size={17} /></span>
          <h2 id="occ-alert-title" className="flex-1 min-w-0 text-[17px] font-bold tracking-[-0.02em] text-[#1D1D1F]">
            {todayCount > 0 ? 'Hôm nay có ngày quan trọng' : 'Sắp tới ngày quan trọng'}
          </h2>
          <button onClick={close} aria-label="Đóng" className="w-8 h-8 rounded-full bg-black/[0.05] text-[#86868B] flex items-center justify-center hover:bg-black/[0.09]"><X size={15} /></button>
        </div>
        <p className="px-5 text-[12.5px] text-[#86868B]">Đừng quên chúc mừng hoặc chuẩn bị quà.</p>

        <ul className="px-5 py-2">
          {items.map(e => (
            <li key={e.key} className="flex items-center gap-3 py-2.5 border-b border-[#F0F0F2] last:border-0">
              {e.icon ? (
                <span className={`w-[38px] h-[38px] shrink-0 rounded-full flex items-center justify-center ${e.icon === 'national' ? 'bg-[#0071E3]/[0.12] text-[#0058B0]' : 'bg-[#8944AB]/[0.12] text-[#8944AB]'}`}>
                  {e.icon === 'national' ? <Globe2 size={18} /> : <Building2 size={18} />}
                </span>
              ) : <AvatarCircle url={e.avatarUrl} name={e.name} size={38} />}
              <div className="flex-1 min-w-0">
                <div className="text-[14px] font-semibold text-[#1D1D1F] truncate">{e.name}</div>
                <div className="text-[12px] text-[#6E6E73] truncate">
                  {e.notBirthday && !e.icon && <CalendarHeart className="inline w-3 h-3 text-[#D70015] -mt-0.5 mr-0.5" />}
                  {e.label}
                </div>
                {e.sub && <div className="text-[11.5px] text-[#86868B] truncate">{e.sub}</div>}
                {e.tip && <div className="text-[11.5px] text-[#6E6E73] line-clamp-2">{e.tip}</div>}
              </div>
              <span className={`shrink-0 text-[11.5px] font-semibold px-2.5 py-1 rounded-full ${
                e.daysUntil === 0 ? 'bg-[#FF3B30]/[0.12] text-[#D70015]' : e.daysUntil === 1 ? 'bg-[#FF9500]/[0.14] text-[#B25000]' : 'bg-black/[0.05] text-[#6E6E73]'
              }`}>
                {alertWhen(e.daysUntil)}
              </span>
            </li>
          ))}
        </ul>

        <div className="px-5 pb-5 pt-1 flex flex-wrap justify-end gap-2">
          <button
            onClick={() => { close(); window.location.hash = '#/crm-leads/events'; }}
            className="h-10 md:h-9 px-4 rounded-full bg-[rgba(118,118,128,0.12)] text-[13px] font-medium text-[#1D1D1F] hover:bg-[rgba(118,118,128,0.2)]"
          >
            Mở Sự kiện &amp; Quà tặng
          </button>
          <button onClick={close} className="h-10 md:h-9 px-5 rounded-full bg-[#0071E3] text-white text-[13px] font-semibold hover:bg-[#0077ED]">
            Đã xem
          </button>
        </div>
      </div>
    </div>
  );
}
