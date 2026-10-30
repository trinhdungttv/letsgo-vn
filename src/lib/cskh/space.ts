// ============================================================================
// CSKH — 2 khu vực chăm sóc dùng chung 1 bộ máy (migration 178):
//   • 'client' = người đại diện công ty khách hàng (CSKH, như trước)
//   • 'sale'   = Mạng lưới Sale — Sale / CTV bên ngoài: trao đổi thông tin, giới thiệu khách,
//                sau này có thể mời về làm. Quan trọng ít hơn khách → nhịp thưa hơn.
// Hai khu vực KHÔNG lẫn nhau: mỗi trang chỉ nạp người cùng loại (contacts.kind) và nhật ký /
// sự kiện / quà / nhóm của chính những người đó.
// File thuần: nhãn, nhịp mặc định, hàm lọc — không gọi Supabase.
// ============================================================================
import type {
  CadenceConfig, ContactKind, CskhContact, CskhGift, CskhGroup, CskhInteraction, CskhOccasion, CskhTier, SaleStage,
} from './types';
import { CONTACT_KINDS, DEFAULT_CADENCE, TIER_HINT, TIER_LABEL } from './types';

export type CskhSpace = ContactKind;

/** Loại của 1 dòng contacts (cột `kind`); chưa chạy migration 178 / giá trị lạ → 'client'. */
export function contactKindOf(row: { kind?: string | null } | null | undefined): ContactKind {
  return row?.kind === 'sale' ? 'sale' : 'client';
}

export const isContactKind = (v: unknown): v is ContactKind => typeof v === 'string' && (CONTACT_KINDS as readonly string[]).includes(v);

/** Hạng của Sale: theo mức ưu tiên giữ quan hệ (khoá enum giữ nguyên như khách). */
export const SALE_TIER_LABEL: Readonly<Record<CskhTier, string>> = {
  vvip: 'Muốn chiêu mộ',
  vip: 'CTV hay giới thiệu',
  partner: 'Trao đổi thông tin',
  friend: 'Quan hệ rộng',
  family: 'Thân thiết',
  other: 'Khác',
  unclassified: 'Chưa chăm sóc',
};

export const SALE_TIER_HINT: Readonly<Record<CskhTier, string>> = {
  vvip: 'Sale giỏi, muốn mời về làm cho Let\'s Go',
  vip: 'Hay giới thiệu khách / làm CTV',
  partner: 'Trao đổi thông tin thị trường, giá, đối thủ',
  friend: 'Quen biết, giữ liên lạc thưa',
  family: 'Quan hệ thân thiết riêng',
  other: 'Khác',
  unclassified: 'Chỉ nằm trong danh bạ Sale, không nhắc, không chấm điểm',
};

/** Nhịp mặc định của Sale — thưa hơn khách (khách: 14 / 30 / 45 / 90 / 30 / 180). */
export const DEFAULT_SALE_CADENCE: Readonly<CadenceConfig> = {
  vvip: 30,
  vip: 45,
  partner: 90,
  friend: 120,
  family: 60,
  other: 180,
};

export const SALE_STAGE_LABEL: Readonly<Record<SaleStage, string>> = {
  none: 'Chưa tính chiêu mộ',
  exploring: 'Đang tìm hiểu',
  invited: 'Đã ngỏ lời mời',
  negotiating: 'Đang thương lượng',
  joined: 'Đã về đội',
  declined: 'Từ chối / không phù hợp',
};

/** Thông tin hiển thị của 1 khu vực — nhãn hạng, tên gọi, chữ trên các màn. */
export interface SpaceInfo {
  space: CskhSpace;
  tierLabel: Readonly<Record<CskhTier, string>>;
  tierHint: Readonly<Record<CskhTier, string>>;
  defaultCadence: Readonly<CadenceConfig>;
  /** "CSKH" / "Mạng lưới Sale" — tên trang. */
  title: string;
  /** "người liên hệ" / "Sale" — danh từ đếm người. */
  noun: string;
  /** Tên tab danh sách: "Ma trận Khách hàng" / "Danh sách Sale". */
  listTitle: string;
  /** Tên ngắn của tab danh sách. */
  listShort: string;
  /** Tiền tố tên việc trong Workspace. */
  taskPrefix: string;
  /** Khoá localStorage riêng từng khu vực (bộ lọc không lẫn). */
  storageKey: (base: string) => string;
}

export const SPACE_INFO: Readonly<Record<CskhSpace, SpaceInfo>> = {
  client: {
    space: 'client',
    tierLabel: TIER_LABEL,
    tierHint: TIER_HINT,
    defaultCadence: DEFAULT_CADENCE,
    title: 'CSKH',
    noun: 'người liên hệ',
    listTitle: 'Ma trận Khách hàng',
    listShort: 'Ma trận',
    taskPrefix: 'CSKH',
    storageKey: base => base,
  },
  sale: {
    space: 'sale',
    tierLabel: SALE_TIER_LABEL,
    tierHint: SALE_TIER_HINT,
    defaultCadence: DEFAULT_SALE_CADENCE,
    title: 'Mạng lưới Sale',
    noun: 'Sale',
    listTitle: 'Danh sách Sale',
    listShort: 'Danh sách',
    taskPrefix: 'Sale',
    storageKey: base => `sale_${base}`,
  },
};

/** Đọc nhịp Sale từ cskh_settings.sale_cadence (jsonb) — thiếu / lạ → mặc định. */
export function parseSaleCadence(raw: unknown): CadenceConfig {
  const out: CadenceConfig = { ...DEFAULT_SALE_CADENCE };
  if (!raw || typeof raw !== 'object') return out;
  for (const k of Object.keys(out) as (keyof CadenceConfig)[]) {
    const v = Number((raw as Record<string, unknown>)[k]);
    if (Number.isInteger(v) && v >= 1 && v <= 3650) out[k] = v;
  }
  return out;
}

/** Dữ liệu CSKH đã nạp — phần cần tách theo khu vực. */
export interface SpaceSlice {
  contacts: CskhContact[];
  interactions: CskhInteraction[];
  occasions: CskhOccasion[];
  gifts: CskhGift[];
  groups: CskhGroup[];
}

/**
 * Tách dữ liệu của 1 khu vực từ dữ liệu nạp chung:
 *   • người liên hệ cùng loại;
 *   • nhật ký / sự kiện / quà của chính những người đó. Riêng khu vực khách giữ thêm dòng cũ
 *     chưa gắn người (nhật ký / quà ghi theo công ty từ trước khi có CSKH theo người) — Sale
 *     không bao giờ có dòng như vậy;
 *   • nhóm tự tạo cùng loại.
 */
export function sliceSpace(all: SpaceSlice, space: CskhSpace): SpaceSlice {
  const contacts = all.contacts.filter(c => c.kind === space);
  const ids = new Set(contacts.map(c => c.id));
  const otherIds = new Set(all.contacts.filter(c => c.kind !== space).map(c => c.id));
  const keep = (contactId: string | null): boolean => {
    if (contactId !== null && ids.has(contactId)) return true;
    if (space === 'sale') return false;
    // Khách: dòng cũ chưa gắn người, hoặc người đã bị xoá hẳn — như trước khi có Sale
    return contactId === null || !otherIds.has(contactId);
  };
  return {
    contacts,
    interactions: all.interactions.filter(i => keep(i.contactId)),
    occasions: all.occasions.filter(o => ids.has(o.contactId)),
    // Quà của khách luôn gắn công ty; quà không công ty là của Sale
    gifts: all.gifts.filter(g => (space === 'sale' ? g.contactId !== null && ids.has(g.contactId) : g.clientId !== null && keep(g.contactId))),
    groups: all.groups.filter(g => g.kind === space),
  };
}
