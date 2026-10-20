// Khối "Hôm nay cần liên hệ" (port PRM TodayQueue), kiểu danh sách Apple: mỗi người 1 dòng —
// avatar, tên, lý do (màu + icon theo mức khẩn, luôn kèm chữ), nhóm · công ty; bên phải nút tròn
// Gọi / Zalo / SMS + Xong (việc đã hứa) + Đã liên hệ. Điện thoại thì nút xuống hàng dưới (Xong chỉ
// còn icon, Đã liên hệ dạt phải), vùng chạm ≥ 40px. Chạm vào dòng → tóm tắt nhanh.
import { Check, CheckCheck } from 'lucide-react';
import { contactActionLinks, type ContactActionChannel } from '../../../lib/cskh/contactActions';
import type { TodayQueueItem } from '../../../lib/cskh/todayQueue';
import type { CskhContact, CskhGroup } from '../../../lib/cskh/types';
import { CHANNEL_META, groupDisplayOf, REASON_META } from '../ui';
import { ContactAvatar } from './ContactAvatar';

const roundBtn = 'inline-flex items-center justify-center w-10 h-10 md:w-8 md:h-8 rounded-full bg-[#F2F2F7] text-[#1D4ED8] hover:bg-[#E5E5EA] transition';
const pill = 'inline-flex items-center gap-1 h-10 md:h-8 px-3.5 md:px-3 rounded-full text-[13px] font-semibold transition';

export function TodayQueue({ items, contactById, groupById, loading, onLaunch, onMarkContacted, onDoneFollowUp, onOpenBrief, busyId }: {
  items: readonly TodayQueueItem[];
  contactById: ReadonlyMap<string, CskhContact>;
  groupById: ReadonlyMap<string, CskhGroup>;
  loading: boolean;
  onLaunch: (contact: CskhContact, channel: ContactActionChannel) => void;
  onMarkContacted: (contact: CskhContact) => void;
  onDoneFollowUp: (item: TodayQueueItem) => void;
  onOpenBrief: (contact: CskhContact, item: TodayQueueItem) => void;
  /** Dòng nhật ký đang được đánh dấu xong (khoá nút). */
  busyId?: string | null;
}) {
  if (loading && items.length === 0) {
    return <p className="py-10 text-center text-[13px] text-[#86868B]">Đang tải…</p>;
  }
  if (items.length === 0) {
    return (
      <div className="py-10 flex flex-col items-center gap-2 text-center">
        <span className="w-12 h-12 rounded-full bg-[rgba(52,199,89,0.14)] flex items-center justify-center">
          <Check size={22} strokeWidth={2.6} className="text-[#248A3D]" />
        </span>
        <p className="text-[15px] font-semibold text-[#1D1D1F]">Không ai cần liên hệ hôm nay</p>
        <p className="text-[13px] text-[#86868B]">Mọi mối quan hệ đều đang trong nhịp.</p>
      </div>
    );
  }

  return (
    <div>
      {items.map((item, idx) => {
        const contact = contactById.get(item.contactId);
        if (!contact) return null;
        const links = contactActionLinks(contact);
        const isFollowUp = item.reason === 'followup_overdue' || item.reason === 'followup_today';
        const reason = REASON_META[item.reason];
        const group = groupDisplayOf(contact, groupById);
        return (
          <div key={item.contactId} className="relative py-3">
            {idx > 0 && <span aria-hidden className="absolute top-0 left-[52px] right-0 h-px bg-[#E5E5EA]" />}
            <div className="flex flex-wrap md:flex-nowrap items-center gap-x-3 gap-y-2.5">
              <button type="button" onClick={() => onOpenBrief(contact, item)} aria-label={`Xem tóm tắt ${contact.fullName}`}
                className="flex items-center gap-3 min-w-0 flex-1 basis-full md:basis-auto text-left">
                <ContactAvatar name={contact.fullName} url={contact.avatarUrl} tier={contact.tier} size={40} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-semibold text-[#1D1D1F] truncate">{contact.fullName}</span>
                  <span className="flex items-start gap-1 text-[13px] font-medium leading-snug" style={{ color: reason.color }}>
                    <reason.Icon size={13} strokeWidth={2.3} className="shrink-0 mt-[3px]" />
                    <span className="line-clamp-2">{item.label}</span>
                  </span>
                  <span className="block text-[12px] text-[#86868B] truncate">
                    {group.key !== 'unclassified' && (
                      <><i className="inline-block w-1.5 h-1.5 rounded-full align-middle mr-1 -mt-px" style={{ background: group.color }} />{group.label}</>
                    )}
                    {contact.organization ? `${group.key !== 'unclassified' ? ' · ' : ''}${contact.organization}` : ''}
                    {item.alsoLabels.length > 0 && ` · Còn: ${item.alsoLabels.join(' · ')}`}
                  </span>
                </span>
              </button>

              <div className="flex items-center gap-1.5 w-full md:w-auto shrink-0">
                {links.map(link => {
                  const meta = CHANNEL_META[link.channel];
                  return (
                    <a key={link.channel} href={link.url} className={roundBtn} title={meta.label}
                      aria-label={`${meta.aria} ${contact.fullName}`}
                      // Zalo là link web → tab mới để app LetsGo vẫn ở tab cũ
                      {...(link.channel === 'zalo' ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                      onClick={() => onLaunch(contact, link.channel)}>
                      <meta.Icon size={15} strokeWidth={2.1} />
                    </a>
                  );
                })}
                {isFollowUp && (
                  <button type="button" disabled={busyId === item.interactionId} onClick={() => onDoneFollowUp(item)}
                    aria-label={`Đánh dấu xong việc đã hứa với ${contact.fullName}`}
                    title="Xong việc đã hứa"
                    className="inline-flex items-center justify-center gap-1 w-10 h-10 md:w-auto md:h-8 md:px-3 rounded-full text-[13px] font-semibold bg-[rgba(52,199,89,0.14)] text-[#248A3D] hover:bg-[rgba(52,199,89,0.22)] disabled:opacity-50 transition">
                    <CheckCheck size={15} strokeWidth={2.3} /><span className="hidden md:inline">Xong</span>
                  </button>
                )}
                <button type="button" onClick={() => onMarkContacted(contact)} aria-label={`Ghi nhận đã liên hệ với ${contact.fullName}`}
                  className={`${pill} ml-auto md:ml-0 bg-[rgba(29,78,216,0.09)] text-[#1D4ED8] hover:bg-[rgba(29,78,216,0.15)]`}>
                  <Check size={14} strokeWidth={2.5} /> Đã liên hệ
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
