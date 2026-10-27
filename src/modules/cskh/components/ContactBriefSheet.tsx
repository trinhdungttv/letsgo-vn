// Tóm tắt trước khi liên hệ (port PRM ContactBriefSheet): Điều cần nhớ, việc đang mở
// (ô tròn tích xong ngay tại chỗ), 2 lần trao đổi gần nhất (bấm "Xem thêm" để đọc đủ), nút Gọi / Zalo / SMS + Đã liên hệ.
import { useState } from 'react';
import { Check, Contact2 } from 'lucide-react';
import { contactActionLinks, type ContactActionChannel } from '../../../lib/cskh/contactActions';
import { formatDateVN } from '../../../lib/cskh/dates';
import { hasRememberNotes } from '../../../lib/cskh/remember';
import type { TodayQueueItem } from '../../../lib/cskh/todayQueue';
import type { CskhContact, CskhInteraction } from '../../../lib/cskh/types';
import { INTERACTION_LABEL } from '../../../lib/cskh/types';
import { CHANNEL_META } from '../ui';
import { ContactAvatar } from './ContactAvatar';
import { CompanyTag, TaskCheck } from './apple';
import { expandOpenExtras } from '../data/api';
import { RememberList } from './QuickLogSheet';
import { Sheet } from './Sheet';

/** Quá số ký tự này thì gập lại, có nút "Xem thêm" để đọc đủ nội dung cuộc trao đổi. */
const RECENT_PREVIEW_CHARS = 160;

/** 1 lần trao đổi gần đây: nội dung dài gập lại, bấm "Xem thêm" mở đủ (giữ nguyên xuống dòng). */
function RecentEntry({ i }: { i: CskhInteraction }) {
  const [open, setOpen] = useState(false);
  const long = i.content.length > RECENT_PREVIEW_CHARS;
  return (
    <p className={`text-[12.5px] leading-snug mb-1.5 text-[#1D1D1F] ${open ? 'whitespace-pre-wrap break-words' : ''}`}>
      <span className="text-[#86868B]">
        {formatDateVN(i.occurredAt)} · {INTERACTION_LABEL[i.type]}
        {i.initiatedBy === 'them' ? ' (họ chủ động)' : ''}
        {i.content ? ' — ' : ''}
      </span>
      {long && !open ? `${i.content.slice(0, RECENT_PREVIEW_CHARS - 1)}…` : i.content}
      {long && (
        <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
          className="ml-1 px-1 py-1.5 -my-1.5 text-[12.5px] font-medium text-[#0071E3] hover:underline">
          {open ? 'Thu gọn' : 'Xem thêm'}
        </button>
      )}
    </p>
  );
}

export function ContactBriefSheet({ contact, item, recent, groupLabel, ownerName, onLaunch, onMarkContacted, onDoneFollowUp, onOpenProfile, busyId, onClose }: {
  contact: CskhContact;
  /** Lý do đang nằm trong hàng đợi; null khi mở từ khối khác. */
  item: TodayQueueItem | null;
  /** Nhật ký của riêng người này (chưa lưu trữ), mới nhất trước. */
  recent: readonly CskhInteraction[];
  groupLabel: string;
  ownerName: string | null;
  onLaunch: (contact: CskhContact, channel: ContactActionChannel) => void;
  onMarkContacted: (contact: CskhContact) => void;
  onDoneFollowUp: (it: CskhInteraction) => void;
  /** Mở hồ sơ đầy đủ để bổ sung Điều cần nhớ, thấu hiểu… */
  onOpenProfile: (contact: CskhContact) => void;
  busyId: string | null;
  onClose: () => void;
}) {
  const links = contactActionLinks(contact);
  const lastTwo = recent.slice(0, 2);
  const allFollowUps = [...recent, ...expandOpenExtras(recent, true)].filter(i => i.followUpAction.trim() !== '');
  const openFollowUps = allFollowUps.filter(i => !i.followUpDone);
  // Việc đã xong: hiện để biết cái nào đã hoàn thành (mới nhất trước, tối đa 6)
  const doneFollowUps = allFollowUps.filter(i => i.followUpDone)
    .sort((a, b) => (b.followUpDue ?? '').localeCompare(a.followUpDue ?? '')).slice(0, 6);

  return (
    <Sheet label={`Tóm tắt ${contact.fullName}`} onClose={onClose}>
      <div className="flex items-center gap-3 pr-6">
        <ContactAvatar name={contact.fullName} url={contact.avatarUrl} tier={contact.tier} size={44} />
        <div className="min-w-0">
          <p className="text-[20px] font-bold tracking-[-0.02em] text-[#1D1D1F] truncate">{contact.fullName}</p>
          <div className="mt-0.5 flex items-center gap-1.5 min-w-0">
            <CompanyTag name={contact.organization} />
            {contact.jobTitle && <span className="text-[12px] text-[#86868B] truncate">{contact.jobTitle}</span>}
          </div>
          <p className="text-[11.5px] text-[#86868B]">
            {groupLabel}{ownerName ? ` · Phụ trách: ${ownerName}` : ''}
            {' · '}
            <button type="button" onClick={() => onOpenProfile(contact)} className="inline-flex items-center gap-0.5 text-[#0071E3] hover:underline">
              <Contact2 size={12} /> Mở hồ sơ
            </button>
          </p>
        </div>
      </div>
      {item && <p className="text-[13px] font-semibold mt-3 text-[#0071E3]">{item.label}</p>}

      {hasRememberNotes(contact.rememberNotes) ? (
        <RememberList contact={contact} />
      ) : (
        <p className="text-[11.5px] text-[#AEAEB2] mt-3">
          Chưa có "Điều cần nhớ" —{' '}
          <button type="button" onClick={() => onOpenProfile(contact)} className="text-[#0071E3] hover:underline">thêm trong hồ sơ</button>
          {' '}để lần sau được nhắc ở đây.
        </p>
      )}

      {openFollowUps.length > 0 && (
        <div className="mt-3">
          <p className="text-[12px] font-semibold uppercase tracking-[0.04em] text-[#C93400] mb-1.5">Việc đang mở ({openFollowUps.length})</p>
          <div className="space-y-1">
            {openFollowUps.map(i => (
              <div key={i.id} className="flex items-center gap-1 bg-[#FF9500]/[0.1] rounded-[12px] pl-1.5 pr-3 py-1">
                <TaskCheck busy={busyId === i.id} onDone={() => onDoneFollowUp(i)} label={`Đánh dấu xong: ${i.followUpAction}`} />
                <span className="flex-1 min-w-0 text-[12.5px] text-[#1D1D1F] leading-snug py-1">
                  {i.followUpAction}
                  {i.followUpDue && <span className="text-[#86868B]"> — hạn {formatDateVN(i.followUpDue)}</span>}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {doneFollowUps.length > 0 && (
        <div className="mt-3">
          <p className="text-[12px] font-semibold uppercase tracking-[0.04em] text-[#248A3D] mb-1.5">Đã hoàn thành ({doneFollowUps.length})</p>
          <div className="space-y-1">
            {doneFollowUps.map(i => (
              <div key={i.id} className="flex items-center gap-1 bg-[#F5F5F7] rounded-[12px] pl-1.5 pr-3 py-1">
                <TaskCheck done label={`Đã xong: ${i.followUpAction}`} />
                <span className="flex-1 min-w-0 text-[12.5px] leading-snug text-[#86868B] py-1">
                  <span className="line-through">{i.followUpAction}</span>
                  {i.followUpDue && <span> — hạn {formatDateVN(i.followUpDue)}</span>}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {lastTwo.length > 0 && (
        <div className="mt-3">
          <p className="text-[12px] font-semibold uppercase tracking-[0.04em] text-[#86868B] mb-1.5">Gần đây</p>
          {lastTwo.map(i => <RecentEntry key={i.id} i={i} />)}
        </div>
      )}

      {links.length > 0 && (
        <div className="grid grid-cols-3 gap-2 mt-4">
          {links.map(link => {
            const meta = CHANNEL_META[link.channel];
            return (
              <a key={link.channel} href={link.url} aria-label={`${meta.aria} ${contact.fullName}`}
                {...(link.channel === 'zalo' ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                onClick={() => onLaunch(contact, link.channel)}
                className="h-[58px] rounded-[12px] bg-white md:bg-[#F5F5F7] text-[12px] font-medium text-[#0071E3] flex flex-col items-center justify-center gap-1 hover:bg-[#0071E3]/10 active:scale-[0.97] transition">
                <meta.Icon size={19} strokeWidth={2.1} /> {meta.label}
              </a>
            );
          })}
        </div>
      )}
      <div className="flex gap-2 mt-2">
        <button type="button" onClick={onClose}
          className="flex-1 h-11 md:h-9 rounded-full bg-[rgba(118,118,128,0.12)] text-[13px] font-medium text-[#1D1D1F] hover:bg-[rgba(118,118,128,0.2)] active:scale-[0.98] transition">Đóng</button>
        <button type="button" onClick={() => { onClose(); onMarkContacted(contact); }}
          className="flex-[2] h-11 md:h-9 rounded-full bg-[#0071E3] text-white active:scale-[0.98] transition text-[13px] font-semibold hover:bg-[#0077ED] inline-flex items-center justify-center gap-1.5">
          <Check size={15} strokeWidth={2.4} /> Đã liên hệ
        </button>
      </div>
    </Sheet>
  );
}
