// ============================================================================
// CSKH — chuyển dòng DB (snake_case) ↔ đối tượng miền kiểu PRM (camelCase)
// ----------------------------------------------------------------------------
// Mọi cột CSKH đều TUỲ CHỌN ở kiểu dòng: DB chưa chạy migration 168–173 thì
// cột không có, mapper tự lấy giá trị mặc định → app không vỡ.
// Dòng cũ cũng đọc được:
//   • cskh_logs.contact_type cũ 'meeting' → 'meet'; 'zalo' → 'message' + kênh Zalo
//   • contact_special_dates chưa có day/month → lấy từ cột `date`
//   • contacts.birthday → một sự kiện "Sinh nhật" ảo (sửa ở form người liên hệ)
// ============================================================================
import type { ClientGift, Contact, CSKHLog } from '../types';
import { splitPhones } from './contactActions';
import { cleanEducation } from './education';
import { DEFAULT_REMIND_DAYS } from './occasions';
import { cleanRememberNotes } from './remember';
import { contactKindOf, DEFAULT_SALE_CADENCE, parseSaleCadence } from './space';
import type {
  CadenceConfig, CskhClassifiedTier, CskhContact, CskhContext, CskhGift, CskhGroup,
  CskhInteraction, CskhOccasion, CskhSettings, CskhTier, GeoSource, GiftDirection,
  Gender, GroupColor, InitiatedBy, InteractionChannel, InteractionType, OccasionType, RememberNotes, SaleStage,
} from './types';
import { ALL_TIERS, CLASSIFIED_TIERS, DEFAULT_CADENCE, GEO_SOURCES, GROUP_COLORS, INTERACTION_TYPES, SALE_STAGES } from './types';

// ── Kiểu dòng DB ────────────────────────────────────────────────────────────
/** Cột CSKH thêm vào contacts (migration 169). */
export interface ContactCskhColumns {
  tier: string;
  group_id: string | null;
  cadence_days: number | null;
  last_interaction_at: string | null;
  last_cold_alert_at: string | null;
  owner_id: string | null;
  nickname: string;
  zalo_phone: string;
  habits: string;
  personality: string;
  mbti: string;
  remember_notes: RememberNotes | null;
  introduced_by: string | null;
  context: string;
  province: string;
  lat: number | null;
  lng: number | null;
  geo_source: string;
  external_ref: string | null;
}
/** Cột hồ sơ nâng cấp 24/10 (migration 174) — chưa chạy migration thì không có. */
export interface ContactProfileColumns {
  gender: string;
  education: unknown;
  origin_province: string;
  birthday_remind_days: number | null;
}
/** Cột Mạng lưới Sale (migration 178) — chưa chạy thì không có (mọi người = khách). */
export interface ContactSaleColumns {
  sale_company: string;
  competitor_id: string | null;
  sale_stage: string;
  sale_area: string;
  sale_industries: string;
}
export type ContactRow = Contact & Partial<ContactCskhColumns> & Partial<ContactProfileColumns> & Partial<ContactSaleColumns>;

/** Cột thêm vào cskh_logs (migration 170). */
export interface CskhLogColumns {
  contact_id: string | null;
  channel: string;
  initiated_by: string | null;
  followup_due: string | null;
  followup_task_id: string | null;
  extra_task_ids: string[];
  created_by: string | null;
  created_by_name: string | null;
  is_archived: boolean;
  updated_at: string;
}
export type CskhLogRow = CSKHLog & Partial<CskhLogColumns>;

/** contact_special_dates (migration 144 + 171). */
export interface SpecialDateRow {
  id: string;
  contact_id: string;
  label: string;
  date: string | null;
  occasion_type?: string;
  day?: number | null;
  month?: number | null;
  year?: number | null;
  is_lunar?: boolean;
  related_person?: string;
  remind_days_before?: number;
  last_reminded_year?: number | null;
  note?: string;
  is_archived?: boolean;
}

/** Cột thêm vào client_gifts (migration 172). */
export type ClientGiftRow = ClientGift & Partial<{
  direction: string;
  occasion_id: string | null;
  is_archived: boolean;
  updated_at: string;
}>;

export interface CskhGroupRow {
  id: string;
  name: string;
  color: string;
  base_tier: string | null;
  /** Migration 178 — chưa chạy = nhóm của khách. */
  kind?: string | null;
  is_archived?: boolean;
}

export interface CskhSettingsRow {
  cadence_vvip: number;
  cadence_vip: number;
  cadence_partner: number;
  cadence_friend: number;
  cadence_family: number;
  cadence_other: number;
  digest_enabled: boolean;
  digest_time: string;
  digest_max_items: number;
  digest_last_sent_on: string | null;
  /** Nhịp theo hạng của Mạng lưới Sale (migration 178, jsonb). */
  sale_cadence?: unknown;
  updated_at: string;
}

// ── Tiện ích nhỏ ────────────────────────────────────────────────────────────
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;

const text = (v: string | null | undefined): string => v ?? '';

/**
 * Sở thích: cột `hobbies` là TEXT chứa JSON array; dữ liệu cũ có thể là chuỗi
 * ngăn phẩy. Cùng quy tắc với parseHobbies() trong lib/contactOps (file đó gọi
 * Supabase nên không import vào lớp hàm thuần này).
 */
export function parseInterests(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map(String).filter(s => s.trim() !== '') : [];
  } catch {
    return raw.split(',').map(s => s.trim()).filter(Boolean);
  }
}

// ── Người liên hệ ───────────────────────────────────────────────────────────
export function mapContactRow(row: ContactRow): CskhContact {
  const links = row.contact_clients
    ?? (row.client_id ? [{ client_id: row.client_id, is_primary: !!row.is_primary, clients: row.clients ?? null }] : []);
  const sorted = [...links].sort((a, b) => (a.clients?.name || '').localeCompare(b.clients?.name || '', 'vi'));
  const kind = contactKindOf(row);
  const saleCompany = text(row.sale_company).trim();
  return {
    id: row.id,
    kind,
    saleCompany,
    competitorId: row.competitor_id ?? null,
    saleStage: oneOf<SaleStage>(row.sale_stage, SALE_STAGES, 'none'),
    saleArea: text(row.sale_area),
    saleIndustries: text(row.sale_industries),
    fullName: row.name,
    nickname: text(row.nickname),
    avatarUrl: text(row.avatar_url),
    phones: splitPhones(row.phone),
    zaloPhone: text(row.zalo_phone),
    emails: row.email?.trim() ? [row.email.trim()] : [],
    clientIds: sorted.map(l => l.client_id),
    primaryClientIds: sorted.filter(l => l.is_primary).map(l => l.client_id),
    // Sale không gắn công ty khách — "công ty" hiển thị là nơi Sale đang làm
    organization: kind === 'sale' ? saleCompany : sorted.map(l => l.clients?.name).filter(Boolean).join(', '),
    jobTitle: text(row.role),
    tier: oneOf<CskhTier>(row.tier, ALL_TIERS, 'unclassified'),
    groupId: row.group_id ?? null,
    cadenceDays: row.cadence_days ?? null,
    lastInteractionAt: row.last_interaction_at ?? null,
    lastColdAlertAt: row.last_cold_alert_at ?? null,
    ownerId: row.owner_id ?? null,
    interests: parseInterests(row.hobbies),
    habits: text(row.habits),
    personality: text(row.personality),
    mbti: text(row.mbti),
    notes: text(row.notes),
    rememberNotes: cleanRememberNotes(row.remember_notes),
    introducedBy: row.introduced_by ?? null,
    context: oneOf<CskhContext>(row.context, ['personal', 'work', 'both'], 'work'),
    address: text(row.address),
    mapUrl: text(row.map_link),
    province: text(row.province),
    originProvince: text(row.origin_province),
    lat: row.lat ?? null,
    lng: row.lng ?? null,
    geoSource: oneOf<GeoSource>(row.geo_source, GEO_SOURCES, ''),
    birthday: row.birthday || null,
    birthdayRemindDays: row.birthday_remind_days ?? null,
    gender: oneOf<Gender>(row.gender, ['', 'male', 'female'], ''),
    education: cleanEducation(row.education),
    isActive: row.is_active,
    isArchived: !row.is_active,
    externalRef: row.external_ref ?? null,
    updatedAt: row.updated_at,
  };
}

// ── Nhật ký ─────────────────────────────────────────────────────────────────
/** Loại tương tác của dòng cũ (Relationship Radar / CSKH.tsx ghi call|meeting|zalo|email). */
export function interactionTypeOf(contactType: string | null | undefined): InteractionType {
  if (contactType === 'meeting') return 'meet';
  if (contactType === 'zalo') return 'message';
  return oneOf<InteractionType>(contactType, INTERACTION_TYPES, 'other');
}

function legacyChannel(contactType: string | null | undefined): InteractionChannel {
  if (contactType === 'zalo') return 'zalo';
  if (contactType === 'call') return 'call';
  return '';
}

export function mapLogRow(row: CskhLogRow): CskhInteraction {
  const channel = oneOf<InteractionChannel>(row.channel, ['', 'call', 'zalo', 'sms', 'other'], '');
  return {
    id: row.id,
    contactId: row.contact_id ?? null,
    clientId: row.client_id ?? null,
    clientName: text(row.client_name),
    contactPerson: text(row.contact_person),
    type: interactionTypeOf(row.contact_type),
    channel: channel || legacyChannel(row.contact_type),
    initiatedBy: row.initiated_by === 'me' || row.initiated_by === 'them' ? (row.initiated_by as InitiatedBy) : null,
    occurredAt: row.log_date,
    content: text(row.content),
    followUpAction: text(row.followup),
    followUpDue: row.followup_due ?? null,
    followUpDone: !!row.followup_done,
    followUpTaskId: row.followup_task_id ?? null,
    extraTaskIds: Array.isArray(row.extra_task_ids) ? row.extra_task_ids : [],
    extraTasks: [],
    createdBy: row.created_by ?? null,
    createdByName: text(row.created_by_name),
    isArchived: !!row.is_archived,
    createdAt: row.created_at,
  };
}

// ── Sự kiện ─────────────────────────────────────────────────────────────────
/** Dòng không xác định được ngày/tháng (dữ liệu hỏng) → null, bỏ qua. */
export function mapSpecialDateRow(row: SpecialDateRow): CskhOccasion | null {
  const fromDate = row.date ? { day: Number(row.date.slice(8, 10)), month: Number(row.date.slice(5, 7)) } : null;
  const isLunar = !!row.is_lunar;
  // Dương lịch: `date` là chuẩn (trigger DB cũng giữ day/month khớp `date`)
  const day = isLunar ? row.day ?? null : fromDate?.day ?? row.day ?? null;
  const month = isLunar ? row.month ?? null : fromDate?.month ?? row.month ?? null;
  if (!day || !month) return null;
  return {
    id: row.id,
    contactId: row.contact_id,
    title: row.label,
    occasionType: oneOf<OccasionType>(row.occasion_type, ['birthday', 'anniversary', 'memorial', 'other'], 'other'),
    day,
    month,
    year: row.year ?? null,
    isLunar,
    relatedPerson: text(row.related_person),
    remindDaysBefore: row.remind_days_before ?? 7,
    lastRemindedYear: row.last_reminded_year ?? null,
    note: text(row.note),
    isArchived: !!row.is_archived,
    source: 'special_date',
  };
}

/** Id của sự kiện "Sinh nhật" ảo dựng từ contacts.birthday. */
export const birthdayOccasionId = (contactId: string) => `birthday:${contactId}`;

/** contacts.birthday → sự kiện "Sinh nhật" (dương lịch). Không có ngày sinh → null. */
export function birthdayOccasion(contact: Pick<CskhContact, 'id' | 'birthday' | 'birthdayRemindDays'>): CskhOccasion | null {
  const b = contact.birthday;
  if (!b || !/^\d{4}-\d{2}-\d{2}/.test(b)) return null;
  const year = Number(b.slice(0, 4));
  return {
    id: birthdayOccasionId(contact.id),
    contactId: contact.id,
    title: 'Sinh nhật',
    occasionType: 'birthday',
    day: Number(b.slice(8, 10)),
    month: Number(b.slice(5, 7)),
    year: year >= 1900 && year <= 2100 ? year : null,
    isLunar: false,
    relatedPerson: '',
    remindDaysBefore: contact.birthdayRemindDays ?? DEFAULT_REMIND_DAYS,
    lastRemindedYear: null,
    note: '',
    isArchived: false,
    source: 'birthday',
  };
}

// ── Quà ─────────────────────────────────────────────────────────────────────
export function mapGiftRow(row: ClientGiftRow): CskhGift {
  return {
    id: row.id,
    clientId: row.client_id,
    contactId: row.recipient_contact_id ?? null,
    recipientName: text(row.recipient_name),
    occasionId: row.occasion_id ?? null,
    direction: oneOf<GiftDirection>(row.direction, ['given', 'received'], 'given'),
    item: row.item_name,
    estimatedValue: row.value === null || row.value === undefined ? null : Number(row.value),
    givenAt: row.gift_date,
    note: text(row.notes),
    createdBy: text(row.created_by),
    isArchived: !!row.is_archived,
    createdAt: row.created_at,
  };
}

// ── Nhóm + cài đặt ──────────────────────────────────────────────────────────
export function mapGroupRow(row: CskhGroupRow): CskhGroup {
  return {
    id: row.id,
    name: row.name,
    color: oneOf<GroupColor>(row.color, GROUP_COLORS, 'blue'),
    baseTier: row.base_tier && (CLASSIFIED_TIERS as readonly string[]).includes(row.base_tier)
      ? (row.base_tier as CskhClassifiedTier)
      : null,
    kind: contactKindOf(row),
    isArchived: !!row.is_archived,
  };
}

/** Hạng hiệu lực của nhóm tự tạo (chưa chọn → 'other', giống PRM). */
export const groupBaseTier = (g: Pick<CskhGroup, 'baseTier'>): CskhClassifiedTier => g.baseTier ?? 'other';

/** Chưa có dòng cài đặt (chưa chạy migration 173) → mặc định. */
export function mapSettingsRow(row: CskhSettingsRow | null | undefined): CskhSettings {
  if (!row) {
    return {
      cadence: { ...DEFAULT_CADENCE },
      saleCadence: { ...DEFAULT_SALE_CADENCE },
      digestEnabled: false,
      digestTime: '07:30',
      digestMaxItems: 7,
      digestLastSentOn: null,
      updatedAt: null,
    };
  }
  const cadence: CadenceConfig = {
    vvip: row.cadence_vvip ?? DEFAULT_CADENCE.vvip,
    vip: row.cadence_vip ?? DEFAULT_CADENCE.vip,
    partner: row.cadence_partner ?? DEFAULT_CADENCE.partner,
    friend: row.cadence_friend ?? DEFAULT_CADENCE.friend,
    family: row.cadence_family ?? DEFAULT_CADENCE.family,
    other: row.cadence_other ?? DEFAULT_CADENCE.other,
  };
  return {
    cadence,
    saleCadence: parseSaleCadence(row.sale_cadence),
    digestEnabled: !!row.digest_enabled,
    // Postgres trả "07:30:00" → giữ "HH:MM"
    digestTime: (row.digest_time ?? '07:30').slice(0, 5),
    digestMaxItems: row.digest_max_items ?? 7,
    digestLastSentOn: row.digest_last_sent_on ?? null,
    updatedAt: row.updated_at ?? null,
  };
}
