// ============================================================================
// CSKH — hằng số hiển thị dùng chung cho các tab (màu, chip, icon).
// Phong cách Apple như Workspace (src/components/workspace/wsTheme.ts): nền #F5F5F7, thẻ
// trắng bo 18px, nhấn #0071E3; màu trạng thái = bản "đậm" của màu hệ thống Apple để chữ
// trên capsule (nền cùng màu pha ~12%) đủ tương phản. Màu trạng thái luôn đi kèm chữ.
// ============================================================================
import type { CSSProperties } from 'react';
import { Cake, Clock, Coffee, Gift, Handshake, Mail, MessageCircle, MessageSquare, MoreHorizontal, Phone, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { CareStatus } from '../../lib/cskh/cadence';
import type { ContactActionChannel } from '../../lib/cskh/contactActions';
import type { TodayReason } from '../../lib/cskh/todayQueue';
import type { CskhContact, CskhGroup, CskhTier, GroupColor, InteractionType, SaleStage } from '../../lib/cskh/types';
import { TIER_LABEL } from '../../lib/cskh/types';
import { BTN_ICON, BTN_PRIMARY, BTN_TINTED, CARD } from '../../components/workspace/wsTheme';

// ── Lớp giao diện kiểu Apple (thẻ, nút viên, nút tròn) — khối giao diện ở components/apple.tsx ──
/** Thẻ chuẩn (trắng, bo 18px, bóng mảnh). */
export const PANEL = CARD;
/** Chữ phụ xám hệ thống. */
export const CAPTION = 'text-[12px] text-[#86868B] leading-snug';
/** Liên kết chữ xanh (kiểu "Xem tất cả ›"). */
export const LINK = 'inline-flex items-center gap-0.5 text-[13px] font-medium text-[#0066CC] hover:opacity-70 transition min-h-[36px] md:min-h-0 shrink-0';
/** Nút viên: chính / phụ tô nhạt — kích thước chuẩn của đầu trang CSKH. */
export const PILL_PRIMARY = `${BTN_PRIMARY} h-10 md:h-9 px-4 text-[13px] font-semibold whitespace-nowrap`;
export const PILL_TINTED = `${BTN_TINTED} h-10 md:h-9 px-4 text-[13px] font-semibold whitespace-nowrap`;
export const PILL_GRAY = 'inline-flex items-center justify-center gap-1.5 rounded-full bg-black/[0.05] text-[#1D1D1F] hover:bg-black/[0.08] active:scale-[0.97] transition disabled:opacity-40 h-10 md:h-9 px-4 text-[13px] font-medium whitespace-nowrap';
/** Nút tròn chỉ có icon (sửa, xoá, lịch…) — vùng chạm 36px trên điện thoại. */
export const ROUND_ICON = `${BTN_ICON} !w-9 !h-9 md:!w-8 md:!h-8 shrink-0 disabled:opacity-40`;
/** Nút tròn "+" ghi tương tác ở cuối dòng. */
export const ROUND_ADD = 'shrink-0 w-9 h-9 md:w-8 md:h-8 rounded-full bg-[#0071E3]/10 text-[#0066CC] hover:bg-[#0071E3]/[0.16] active:scale-95 flex items-center justify-center transition';

export const BLUE = '#0071E3';
export const GREEN = '#248A3D';
export const ORANGE = '#B25000';
export const RED = '#D70015';
export const PURPLE = '#8944AB';
export const GRAY = '#6E6E73';

export const TIER_COLOR: Readonly<Record<CskhTier, string>> = {
  vvip: RED,
  vip: ORANGE,
  partner: '#0066CC',
  friend: GREEN,
  family: '#C4103E',
  other: GRAY,
  unclassified: '#AEAEB2',
};

export const GROUP_COLOR: Readonly<Record<GroupColor, string>> = {
  blue: '#0066CC',
  green: GREEN,
  orange: '#B25000',
  red: RED,
  purple: PURPLE,
  gray: GRAY,
};

/** Tên các mục danh mục (KCN / ngành) đã chọn, theo thứ tự danh mục — để hiện trong bảng / tìm kiếm. */
export function catalogNames(items: readonly { id: string; name: string }[], ids: readonly string[]): string[] {
  const set = new Set(ids);
  return items.filter(i => set.has(i.id)).map(i => i.name);
}

/** Màu tiến độ chiêu mộ Sale (Mạng lưới Sale). */
export const SALE_STAGE_COLOR: Readonly<Record<SaleStage, string>> = {
  none: GRAY,
  exploring: '#0066CC',
  invited: PURPLE,
  negotiating: ORANGE,
  joined: GREEN,
  declined: '#8E8E93',
};

export const CARE_STATUS_COLOR: Readonly<Record<CareStatus, string>> = {
  overdue: RED,
  due_soon: ORANGE,
  ok: GREEN,
  unclassified: '#AEAEB2',
};

/** Màu điểm sức khỏe: ≥ 70 xanh lá · ≥ 40 cam · còn lại đỏ. */
export function scoreColor(total: number): string {
  if (total >= 70) return GREEN;
  if (total >= 40) return ORANGE;
  return RED;
}

/** Capsule: chữ màu đậm trên nền cùng màu pha ~12% (hex + alpha 1F). */
export function chipStyle(color: string): CSSProperties {
  return { background: `${color}1F`, color };
}

/** Lý do trong hàng đợi: màu + icon theo mức khẩn (luôn kèm chữ). */
export const REASON_META: Readonly<Record<TodayReason, { color: string; Icon: LucideIcon }>> = {
  followup_overdue: { color: RED, Icon: Handshake },
  followup_today: { color: ORANGE, Icon: Handshake },
  occasion_soon: { color: PURPLE, Icon: Cake },
  cadence_overdue: { color: '#0066CC', Icon: Clock },
};

/** Nút liên hệ 1 chạm. */
export const CHANNEL_META: Readonly<Record<ContactActionChannel, { Icon: LucideIcon; label: string; aria: string }>> = {
  call: { Icon: Phone, label: 'Gọi', aria: 'Gọi điện cho' },
  zalo: { Icon: MessageCircle, label: 'Zalo', aria: 'Nhắn Zalo cho' },
  sms: { Icon: MessageSquare, label: 'SMS', aria: 'Nhắn SMS cho' },
};

export const INTERACTION_ICON: Readonly<Record<InteractionType, LucideIcon>> = {
  call: Phone,
  message: MessageSquare,
  email: Mail,
  meet: Users,
  coffee: Coffee,
  gift: Gift,
  other: MoreHorizontal,
};

// ── "Nhóm" hợp nhất: hạng có sẵn + nhóm tự tạo là MỘT danh sách ─────────────
export interface GroupDisplay {
  /** Hạng ('vvip'…'unclassified') hoặc 'g:<id nhóm tự tạo>'. */
  key: string;
  label: string;
  color: string;
}

export function groupDisplayOf(
  contact: Pick<CskhContact, 'tier' | 'groupId'>,
  groupById: ReadonlyMap<string, CskhGroup>,
  /** Nhãn hạng của khu vực (Sale có nhãn riêng — useSpace().tierLabel); mặc định nhãn khách. */
  tierLabel: Readonly<Record<CskhTier, string>> = TIER_LABEL,
): GroupDisplay {
  const g = contact.groupId ? groupById.get(contact.groupId) : undefined;
  if (g) return { key: `g:${g.id}`, label: g.name, color: GROUP_COLOR[g.color] };
  return { key: contact.tier, label: tierLabel[contact.tier], color: TIER_COLOR[contact.tier] };
}

/** Khoá "Nhóm" hợp nhất → giá trị ghi DB: tier + group_id (null = nhóm mặc định). */
export function resolveGroupKey(
  key: string,
  groupById: ReadonlyMap<string, CskhGroup>,
  tierLabel: Readonly<Record<CskhTier, string>> = TIER_LABEL,
): { tier: CskhTier; groupId: string | null; label: string } | null {
  if (key.startsWith('g:')) {
    const g = groupById.get(key.slice(2));
    return g ? { tier: g.baseTier ?? 'other', groupId: g.id, label: g.name } : null;
  }
  if (!(key in TIER_LABEL)) return null;
  const tier = key as CskhTier;
  return { tier, groupId: null, label: tierLabel[tier] };
}

/** Ô nhập chuẩn trong các form CSKH (16px trên điện thoại do CSS chung lo). */
export const inputCls = 'w-full text-[13px] text-[#1D1D1F] placeholder:text-[#AEAEB2] px-3 py-2 md:py-[7px] rounded-[10px] border border-black/[0.12] bg-white outline-none focus:border-[#0071E3] focus:ring-4 focus:ring-[#0071E3]/15 transition';

/** "Việc tiếp theo" + hạn ("YYYY-MM-DD"; rỗng = chưa chọn). */
export interface FollowUpValue {
  action: string;
  due: string;
}

export const EMPTY_FOLLOW_UP: FollowUpValue = { action: '', due: '' };

/** "Hôm nay" / "Ngày mai" / "5 ngày" — đếm ngược sự kiện. */
export function daysUntilLabel(n: number): string {
  if (n === 0) return 'Hôm nay';
  if (n === 1) return 'Ngày mai';
  return `${n} ngày`;
}

/** Giá trị đặc biệt trong ô chọn nhóm: mở màn tạo nhóm mới. */
export const NEW_GROUP_VALUE = '__new_group';

// ── Thấu hiểu con người: chip gợi ý bấm để thêm/bỏ vào ô chữ tự do (phẩy ngăn cách) ──
export const INTEREST_PRESETS: readonly string[] = [
  'Golf', 'Du lịch', 'Ẩm thực', 'Rượu vang', 'Cà phê', 'Đọc sách', 'Bóng đá', 'Gym / thể hình',
  'Nhiếp ảnh', 'Âm nhạc', 'Xe hơi', 'Đầu tư - chứng khoán', 'Câu cá', 'Cờ tướng', 'Yoga - thiền', 'Cây cảnh',
];
export const HABIT_PRESETS: readonly string[] = [
  'Dậy sớm', 'Chạy bộ buổi sáng', 'Không uống rượu bia', 'Ăn chay định kỳ', 'Hay đi công tác',
  'Ngủ trưa', 'Thích uống trà', 'Hay làm việc khuya', 'Tập gym đều đặn', 'Hút thuốc lá',
];
export const PERSONALITY_PRESETS: readonly string[] = [
  'Quyết đoán', 'Cẩn thận', 'Hài hước', 'Ít nói', 'Nhiệt tình', 'Thẳng thắn', 'Kín đáo', 'Chu đáo',
  'Nóng tính', 'Điềm đạm', 'Cầu toàn', 'Phóng khoáng', 'Trọng chữ tín', 'Hoài nghi',
];

/** "a, b, c" → ['a','b','c'] (đã cắt khoảng trắng, bỏ rỗng). */
export function splitList(value: string): string[] {
  return value.split(',').map(s => s.trim()).filter(Boolean);
}

/** Bấm chip gợi ý: có rồi thì bỏ, chưa có thì thêm cuối (không phân biệt hoa/thường). */
export function toggleToken(current: string, token: string): string {
  const items = splitList(current);
  const idx = items.findIndex(s => s.toLowerCase() === token.toLowerCase());
  if (idx >= 0) items.splice(idx, 1);
  else items.push(token);
  return items.join(', ');
}

export const hasToken = (current: string, token: string): boolean =>
  splitList(current).some(s => s.toLowerCase() === token.toLowerCase());

/** Truy vấn cho bản đồ nhúng (không cần API key): toạ độ trong link Maps, không thì địa chỉ. */
export function mapEmbedQuery(mapUrl: string, address: string): string | null {
  const url = mapUrl.trim();
  if (url) {
    const at = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) ?? url.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
    if (at) return `${at[1]},${at[2]}`;
    try {
      const q = new URL(url).searchParams.get('q');
      if (q) return q;
    } catch {
      // link không hợp lệ — thử địa chỉ
    }
    const place = url.match(/\/maps\/place\/([^/@?]+)/);
    if (place) return decodeURIComponent(place[1]).replace(/\+/g, ' ');
  }
  return address.trim() || null;
}

export const mapEmbedSrc = (query: string): string =>
  `https://maps.google.com/maps?q=${encodeURIComponent(query)}&z=16&hl=vi&output=embed`;

/**
 * Link mẫu Google Calendar điền sẵn (không cần OAuth) — sự kiện cả ngày: ngày kết thúc
 * là ngày kế tiếp theo quy ước của Google Calendar.
 */
export function gcalTemplateUrl(o: { title: string; dateIso: string; location: string; details: string }): string {
  const start = o.dateIso.replace(/-/g, '');
  const end = new Date(new Date(`${o.dateIso}T00:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10).replace(/-/g, '');
  const params = new URLSearchParams({ action: 'TEMPLATE', text: o.title, dates: `${start}/${end}`, location: o.location, details: o.details });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
