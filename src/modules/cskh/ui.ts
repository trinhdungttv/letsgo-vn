// ============================================================================
// CSKH — hằng số hiển thị dùng chung cho các tab (màu, chip, icon).
// Tông LetsGo (nền giấy, viền mảnh, xanh #1D4ED8) + capsule màu kiểu PRM:
// chữ màu đậm trên nền cùng màu pha ~12%. Màu trạng thái luôn đi kèm chữ.
// ============================================================================
import type { CSSProperties } from 'react';
import { Cake, Clock, Coffee, Gift, Handshake, Mail, MessageCircle, MessageSquare, MoreHorizontal, Phone, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { CareStatus } from '../../lib/cskh/cadence';
import type { ContactActionChannel } from '../../lib/cskh/contactActions';
import type { TodayReason } from '../../lib/cskh/todayQueue';
import type { CskhContact, CskhGroup, CskhTier, GroupColor, InteractionType } from '../../lib/cskh/types';
import { TIER_LABEL } from '../../lib/cskh/types';

export const BLUE = '#1D4ED8';
export const GREEN = '#059669';
export const ORANGE = '#D97706';
export const RED = '#DC2626';
export const PURPLE = '#7C3AED';
export const GRAY = '#6B7280';

export const TIER_COLOR: Readonly<Record<CskhTier, string>> = {
  vvip: RED,
  vip: ORANGE,
  partner: '#2563EB',
  friend: GREEN,
  family: '#DB2777',
  other: GRAY,
  unclassified: '#9CA3AF',
};

export const GROUP_COLOR: Readonly<Record<GroupColor, string>> = {
  blue: '#2563EB',
  green: GREEN,
  orange: '#EA580C',
  red: RED,
  purple: PURPLE,
  gray: GRAY,
};

export const CARE_STATUS_COLOR: Readonly<Record<CareStatus, string>> = {
  overdue: RED,
  due_soon: ORANGE,
  ok: GREEN,
  unclassified: '#9CA3AF',
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
  cadence_overdue: { color: '#2563EB', Icon: Clock },
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
): GroupDisplay {
  const g = contact.groupId ? groupById.get(contact.groupId) : undefined;
  if (g) return { key: `g:${g.id}`, label: g.name, color: GROUP_COLOR[g.color] };
  return { key: contact.tier, label: TIER_LABEL[contact.tier], color: TIER_COLOR[contact.tier] };
}

/** Khoá "Nhóm" hợp nhất → giá trị ghi DB: tier + group_id (null = nhóm mặc định). */
export function resolveGroupKey(
  key: string,
  groupById: ReadonlyMap<string, CskhGroup>,
): { tier: CskhTier; groupId: string | null; label: string } | null {
  if (key.startsWith('g:')) {
    const g = groupById.get(key.slice(2));
    return g ? { tier: g.baseTier ?? 'other', groupId: g.id, label: g.name } : null;
  }
  if (!(key in TIER_LABEL)) return null;
  const tier = key as CskhTier;
  return { tier, groupId: null, label: TIER_LABEL[tier] };
}

/** Ô nhập chuẩn trong các form CSKH (16px trên điện thoại do CSS chung lo). */
export const inputCls = 'w-full text-[13px] px-2.5 py-2 md:py-1.5 rounded-lg border border-gray-300 bg-white outline-none focus:border-blue-500';

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
