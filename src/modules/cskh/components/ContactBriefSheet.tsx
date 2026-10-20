// Tóm tắt trước khi liên hệ (port PRM ContactBriefSheet): Điều cần nhớ, việc đang mở
// (Xong ngay tại chỗ), 2 lần trao đổi gần nhất, nút Gọi / Zalo / SMS + Đã liên hệ.
import { Check, CheckCheck, Contact2 } from 'lucide-react';
import { contactActionLinks, type ContactActionChannel } from '../../../lib/cskh/contactActions';
import { formatDateVN } from '../../../lib/cskh/dates';
import { hasRememberNotes } from '../../../lib/cskh/remember';
import type { TodayQueueItem } from '../../../lib/cskh/todayQueue';
import type { CskhContact, CskhInteraction } from '../../../lib/cskh/types';
import { INTERACTION_LABEL } from '../../../lib/cskh/types';
import { CHANNEL_META } from '../ui';
import { ContactAvatar } from './ContactAvatar';
import { RememberList } from './QuickLogSheet';
import { Sheet } from './Sheet';

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
  const openFollowUps = recent.filter(i => i.followUpAction.trim() !== '' && !i.followUpDone);

  return (
    <Sheet label={`Tóm tắt ${contact.fullName}`} onClose={onClose}>
      <div className="flex items-center gap-3 pr-6">
        <ContactAvatar name={contact.fullName} url={contact.avatarUrl} tier={contact.tier} size={44} />
        <div className="min-w-0">
          <p className="text-[16px] md:text-[15px] font-semibold text-[#111] truncate">{contact.fullName}</p>
          <p className="text-[12px] text-[#888] truncate">
            {[contact.jobTitle, contact.organization].filter(Boolean).join(' · ')}
          </p>
          <p className="text-[11.5px] text-[#999]">
            {groupLabel}{ownerName ? ` · Phụ trách: ${ownerName}` : ''}
            {' · '}
            <button type="button" onClick={() => onOpenProfile(contact)} className="inline-flex items-center gap-0.5 text-[#1D4ED8] hover:underline">
              <Contact2 size={12} /> Mở hồ sơ
            </button>
          </p>
        </div>
      </div>
      {item && <p className="text-[13px] font-semibold mt-3 text-[#1D4ED8]">{item.label}</p>}

      {hasRememberNotes(contact.rememberNotes) ? (
        <RememberList contact={contact} />
      ) : (
        <p className="text-[11.5px] text-[#aaa] mt-3">
          Chưa có "Điều cần nhớ" —{' '}
          <button type="button" onClick={() => onOpenProfile(contact)} className="text-[#1D4ED8] hover:underline">thêm trong hồ sơ</button>
          {' '}để lần sau được nhắc ở đây.
        </p>
      )}

      {openFollowUps.length > 0 && (
        <div className="mt-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[#D97706] mb-1">Việc đang mở ({openFollowUps.length})</p>
          <div className="space-y-1">
            {openFollowUps.map(i => (
              <div key={i.id} className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
                <span className="flex-1 min-w-0 text-[12.5px] text-[#333] leading-snug">
                  {i.followUpAction}
                  {i.followUpDue && <span className="text-[#888]"> — hạn {formatDateVN(i.followUpDue)}</span>}
                </span>
                <button type="button" disabled={busyId === i.id} onClick={() => onDoneFollowUp(i)}
                  className="shrink-0 inline-flex items-center gap-1 h-9 md:h-7 px-2.5 rounded-lg border border-emerald-200 bg-white text-emerald-700 text-[12px] font-medium hover:bg-emerald-50 disabled:opacity-50">
                  <CheckCheck size={13} /> Xong
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {lastTwo.length > 0 && (
        <div className="mt-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[#999] mb-1">Gần đây</p>
          {lastTwo.map(i => (
            <p key={i.id} className="text-[12.5px] leading-snug mb-1 text-[#333]">
              <span className="text-[#888]">
                {formatDateVN(i.occurredAt)} · {INTERACTION_LABEL[i.type]}
                {i.initiatedBy === 'them' ? ' (họ chủ động)' : ''}
                {i.content ? ' — ' : ''}
              </span>
              {i.content.length > 160 ? `${i.content.slice(0, 159)}…` : i.content}
            </p>
          ))}
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
                className="h-11 md:h-9 rounded-[10px] border border-[#E8E7E2] bg-white text-[13px] font-medium text-[#333] inline-flex items-center justify-center gap-1.5 hover:border-blue-200 hover:text-[#1D4ED8]">
                <meta.Icon size={15} /> {meta.label}
              </a>
            );
          })}
        </div>
      )}
      <div className="flex gap-2 mt-2">
        <button type="button" onClick={onClose}
          className="flex-1 h-11 md:h-9 rounded-[10px] border border-gray-300 bg-white text-[13px] font-medium text-gray-600 hover:bg-gray-50">Đóng</button>
        <button type="button" onClick={() => { onClose(); onMarkContacted(contact); }}
          className="flex-[2] h-11 md:h-9 rounded-[10px] bg-[#1D4ED8] text-white text-[13px] font-semibold hover:bg-[#1E40AF] inline-flex items-center justify-center gap-1.5">
          <Check size={15} strokeWidth={2.4} /> Đã liên hệ
        </button>
      </div>
    </Sheet>
  );
}
