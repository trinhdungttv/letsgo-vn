// ============================================================================
// CSKH — Ngày quan trọng nhập ngay trong hồ sơ + nhắc khi mở app (port PRM occasions.ts)
// ----------------------------------------------------------------------------
// Mỗi người: nhiều dòng (loại · tên · ngày/tháng/năm? · âm lịch · nhắc trước N ngày).
// Nguồn lưu của LetsGo:
//   • Sinh nhật của CHÍNH người liên hệ, dương lịch (có hoặc không rõ năm — 04/11/2026) →
//     contacts.birthday (dùng chung với form đầy đủ / hồ sơ Khách hàng) + contacts.birthday_remind_days
//     (migration 174). Không rõ năm lưu năm giữ chỗ 1604 (lib/birthday).
//   • Mọi dòng khác (âm lịch, của người thân, kỷ niệm, giỗ…) → contact_special_dates.
// Dòng loại "Sinh nhật" có lựa chọn rõ: "Của chính người này" / "Người thân" (forSelf).
// Nhắc khi mở app (popup chúc mừng): lần mở app ĐẦU TIÊN trong 2 ngày trước rồi nhắc LẠI
// ĐÚNG NGÀY — mỗi mốc chỉ hiện 1 lần (khoá `id:ngàyLầnTới:stage`). "Nhắc trước N ngày" của
// từng sự kiện vẫn quyết định việc "Chuẩn bị quà" ở Workspace; popup lấy min(N, 2) — N = 0
// thì chỉ báo đúng ngày. Hàm thuần, có test.
// ============================================================================
import { birthdayValue } from '../birthday';
import { isValidDayMonth } from './dates';
import { GREETING_POPUP_DAYS } from './companyDates';
import { diffDays, nextOccurrenceIso } from './lunar';
import type { CskhContact, CskhOccasion, OccasionType } from './types';
import { OCCASION_LABEL } from './types';

/** Lựa chọn "nhắc trước" trên form (0 = chỉ nhắc đúng ngày). */
export const REMIND_OPTIONS: readonly number[] = [1, 3, 7, 0];
/** Mặc định cho ngày mới thêm (Tony chốt: nhắc trước 3 ngày rồi đúng ngày). */
export const DEFAULT_REMIND_DAYS = 3;

export function remindLabel(days: number): string {
  return days === 0 ? 'Chỉ đúng ngày' : `Nhắc trước ${days} ngày`;
}

/** 1 dòng ngày quan trọng trên form hồ sơ. day/month null = chưa chọn. */
export interface OccasionDraft {
  /** id contact_special_dates, `birthday:<contactId>` (sinh nhật trong hồ sơ), hoặc undefined = dòng mới. */
  id?: string;
  occasionType: OccasionType;
  title: string;
  day: number | null;
  month: number | null;
  year: number | null;
  isLunar: boolean;
  remindDaysBefore: number;
  /**
   * Chỉ với loại "Sinh nhật": true = sinh nhật của CHÍNH người liên hệ, false = của người thân.
   * undefined = đoán theo tên (looksLikeSelfBirthday).
   */
  forSelf?: boolean;
  /** Dòng sự kiện riêng (cũ) người dùng bấm "Dùng làm ngày sinh trong hồ sơ" → chuyển vào contacts.birthday. */
  toProfile?: boolean;
  /** "của con gái"… (cột related_person — chỉ đọc ở form hồ sơ, sửa ở tab Sự kiện & Quà tặng). */
  relatedPerson?: string;
}

/** Tên coi là sinh nhật của chính người này (không ghi của ai). */
const SELF_BIRTHDAY_TITLES = new Set(['', 'sinh nhật', 'sinh nhat', 'sn', 'ngày sinh', 'ngay sinh']);

/** Sự kiện "Sinh nhật" không ghi người thân và tên chỉ là "Sinh nhật" → của chính người liên hệ. */
export function looksLikeSelfBirthday(o: { occasionType: OccasionType; title: string; relatedPerson?: string }): boolean {
  return o.occasionType === 'birthday' && !(o.relatedPerson ?? '').trim()
    && SELF_BIRTHDAY_TITLES.has(o.title.replace(/\s+/g, ' ').trim().toLowerCase());
}

/** Dòng này là sinh nhật của CHÍNH người liên hệ (theo lựa chọn, chưa chọn thì đoán theo tên). */
export function isSelfBirthday(d: Pick<OccasionDraft, 'occasionType' | 'title' | 'forSelf' | 'relatedPerson'>): boolean {
  return d.occasionType === 'birthday' && (d.forSelf ?? looksLikeSelfBirthday(d));
}

export function draftFromOccasion(o: CskhOccasion): OccasionDraft {
  return {
    id: o.id,
    occasionType: o.occasionType,
    title: o.title,
    day: o.day,
    month: o.month,
    year: o.year,
    isLunar: o.isLunar,
    remindDaysBefore: o.remindDaysBefore,
    ...(o.occasionType === 'birthday' ? { forSelf: o.source === 'birthday' || looksLikeSelfBirthday(o) } : {}),
    relatedPerson: o.relatedPerson,
  };
}

export function blankDraft(occasionType: OccasionType = 'birthday'): OccasionDraft {
  return { occasionType, title: '', day: null, month: null, year: null, isLunar: false, remindDaysBefore: DEFAULT_REMIND_DAYS };
}

/** Dòng chưa chọn ngày lẫn tháng — bỏ qua khi lưu. */
export function isBlankDraft(d: Pick<OccasionDraft, 'day' | 'month'>): boolean {
  return d.day === null && d.month === null;
}

/** Tên lưu vào DB: bỏ trống thì lấy tên loại ("Sinh nhật", "Kỷ niệm"…); sinh nhật chính người này luôn "Sinh nhật". */
export function draftTitle(d: Pick<OccasionDraft, 'title' | 'occasionType'> & Partial<Pick<OccasionDraft, 'forSelf' | 'relatedPerson'>>): string {
  if (d.occasionType === 'birthday' && d.forSelf === true) return OCCASION_LABEL.birthday;
  return d.title.replace(/\s+/g, ' ').trim().slice(0, 120) || OCCASION_LABEL[d.occasionType];
}

const SOLAR_MAX_DAY = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** Ngày lớn nhất của tháng: dương lịch cho 29/2 (không biết năm); âm lịch tối đa 30. */
export function maxDay(month: number | null, isLunar: boolean): number {
  if (isLunar) return 30;
  return month ? SOLAR_MAX_DAY[month - 1] ?? 31 : 31;
}

/** Lỗi của 1 dòng (null = hợp lệ hoặc dòng trống). */
export function draftError(d: OccasionDraft, currentYear: number): string | null {
  if (isBlankDraft(d)) return null;
  const name = draftTitle(d);
  if (d.day === null || d.month === null) return `${name}: chọn đủ ngày và tháng`;
  if (d.day < 1 || d.day > maxDay(d.month, d.isLunar)) {
    return `${name}: không có ngày ${d.day}/${d.month}${d.isLunar ? ' âm lịch' : ''}`;
  }
  if (d.year !== null && (!Number.isInteger(d.year) || d.year < 1900 || d.year > currentYear + 50)) {
    return `${name}: năm không hợp lệ`;
  }
  const self = isSelfBirthday(d);
  if (self && d.year !== null && d.year > currentYear) return `${name}: năm sinh ${d.year} chưa tới`;
  // Sinh nhật người thân phải ghi rõ của ai — không thì lưu xong trông y như sinh nhật chính người này
  if (d.occasionType === 'birthday' && !self && !(d.relatedPerson ?? '').trim() && looksLikeSelfBirthday({ ...d, relatedPerson: '' })) {
    return 'Sinh nhật người thân: ghi rõ của ai (VD: Sinh nhật con gái)';
  }
  // 29/2 chỉ có ở năm nhuận khi đã biết năm
  if (!d.isLunar && d.year !== null && !isValidDayMonth(d.day, d.month, d.year)) {
    return `${name}: năm ${d.year} không có ngày ${d.day}/${d.month}`;
  }
  return null;
}

/** Id của sinh nhật trong hồ sơ (contacts.birthday) — trùng birthdayOccasionId ở mappers. */
export const profileBirthdayId = (contactId: string) => `birthday:${contactId}`;
export const isProfileBirthdayId = (id: string | undefined): boolean => !!id && id.startsWith('birthday:');

/**
 * Dòng này lưu được vào contacts.birthday không: sinh nhật của CHÍNH người liên hệ, dương lịch,
 * đủ ngày/tháng — năm không bắt buộc (không rõ năm lưu năm giữ chỗ, xem lib/birthday).
 */
export function fitsProfileBirthday(d: OccasionDraft): boolean {
  return isSelfBirthday(d) && !d.isLunar && d.day !== null && d.month !== null;
}

/**
 * Dòng nào sẽ là ngày sinh trong hồ sơ (contacts.birthday): dòng đang là ngày sinh hồ sơ nếu
 * vẫn hợp lệ; nếu không, dòng MỚI đầu tiên hợp lệ, hoặc dòng cũ người dùng bấm "Dùng làm ngày
 * sinh trong hồ sơ" (toProfile). Sự kiện riêng cũ KHÔNG tự chuyển khi người dùng không bấm.
 */
export function pickProfileBirthday<T extends OccasionDraft>(drafts: readonly T[]): T | null {
  const filled = drafts.filter(d => !isBlankDraft(d));
  return filled.find(d => isProfileBirthdayId(d.id) && fitsProfileBirthday(d))
    ?? filled.find(d => fitsProfileBirthday(d) && (!d.id || (d.toProfile === true && !isProfileBirthdayId(d.id))))
    ?? null;
}

/**
 * Lỗi của cả danh sách: lỗi từng dòng + dòng MỚI "Sinh nhật của chính người này" (dương lịch)
 * trùng với ngày sinh hồ sơ đã có ở dòng khác. Dòng cũ không bao giờ bị chặn ở đây.
 */
export function occasionRowsError(drafts: readonly OccasionDraft[], currentYear: number): string | null {
  const own = drafts.map(d => draftError(d, currentYear)).find(Boolean);
  if (own) return own;
  const profile = pickProfileBirthday(drafts);
  const dup = profile && drafts.find(d => d !== profile && !d.id && !isBlankDraft(d) && fitsProfileBirthday(d));
  return dup ? 'Đã có sinh nhật của chính người này ở dòng khác — dòng mới chọn "Người thân" hoặc bỏ đi' : null;
}


export type OccasionFields = Pick<CskhOccasion, 'occasionType' | 'title' | 'day' | 'month' | 'year' | 'isLunar' | 'remindDaysBefore'>
  /** Chỉ gửi khi cần đổi: dòng chuyển thành "của chính người này" → '' (bỏ người thân cũ). */
  & { relatedPerson?: string };

export interface OccasionWritePlan {
  inserts: OccasionFields[];
  /** resetReminded: đổi ngày/lịch → xoá last_reminded_year để nhắc lại đúng ngày mới. */
  updates: { id: string; fields: OccasionFields; resetReminded: boolean }[];
  /** Dòng contact_special_dates bị bỏ khỏi form → xoá mềm (is_archived). */
  deletes: string[];
  /** contacts.birthday mới ('YYYY-MM-DD' | null = xoá); undefined = không đổi. */
  birthday?: string | null;
  /** contacts.birthday_remind_days mới; undefined = không đổi. */
  birthdayRemindDays?: number;
}

function fieldsOf(d: OccasionDraft, old?: Pick<CskhOccasion, 'relatedPerson'>): OccasionFields {
  return {
    occasionType: d.occasionType,
    title: draftTitle(d),
    day: d.day ?? 1,
    month: d.month ?? 1,
    year: d.year,
    isLunar: d.isLunar,
    remindDaysBefore: d.remindDaysBefore,
    // Đổi sang "của chính người này" → xoá tên người thân cũ (không thì lần sau vẫn đọc ra là người thân)
    ...(d.forSelf === true && old && old.relatedPerson.trim() !== '' ? { relatedPerson: '' } : {}),
  };
}

function sameFields(a: OccasionFields, b: OccasionFields & Pick<CskhOccasion, 'relatedPerson'>): boolean {
  return a.occasionType === b.occasionType && a.title === b.title && a.day === b.day && a.month === b.month
    && a.year === b.year && a.isLunar === b.isLunar && a.remindDaysBefore === b.remindDaysBefore
    && (a.relatedPerson === undefined || a.relatedPerson === b.relatedPerson);
}

/**
 * Đối chiếu ngày đang có với form. `existing` = sự kiện CÒN DÙNG của người này (kể cả
 * sinh nhật ảo dựng từ contacts.birthday). Chỉ đụng các cột form quản lý (giữ nguyên người
 * thân, ghi chú, last_reminded_year nếu ngày không đổi).
 *   • Sinh nhật trong hồ sơ (pickProfileBirthday): dòng giữ id `birthday:` mà vẫn là sinh nhật
 *     chính người này, dương lịch → contacts.birthday (có hoặc không rõ năm); nếu chưa có thì
 *     dòng MỚI đầu tiên hợp lệ lấp vào, hoặc dòng cũ người dùng bấm "Dùng làm ngày sinh trong
 *     hồ sơ" (dòng đó xoá mềm khỏi contact_special_dates — khôi phục được).
 *     Dòng sinh nhật hồ sơ đổi sang âm lịch / người thân → thành sự kiện riêng.
 *   • Còn lại: dòng bị bỏ → xoá mềm, dòng đổi → sửa, dòng mới → thêm.
 */
export function planOccasionSave(
  existing: readonly CskhOccasion[],
  drafts: readonly OccasionDraft[],
): OccasionWritePlan {
  const filled = drafts.filter(d => !isBlankDraft(d));
  const profile = existing.find(o => o.source === 'birthday') ?? null;
  const specials = existing.filter(o => o.source === 'special_date');
  const byId = new Map(specials.map(o => [o.id, o]));

  const profileDraft = pickProfileBirthday(filled);
  const rest = filled.filter(d => d !== profileDraft);
  const kept = new Set(rest.filter(d => d.id && byId.has(d.id)).map(d => d.id as string));

  const plan: OccasionWritePlan = {
    inserts: [],
    updates: [],
    deletes: specials.filter(o => !kept.has(o.id)).map(o => o.id),
  };

  const iso = profileDraft
    ? birthdayValue({ day: profileDraft.day as number, month: profileDraft.month as number, year: profileDraft.year })
    : null;
  const currentIso = profile ? birthdayValue(profile) : null;
  if (iso !== currentIso) plan.birthday = iso;
  if (profileDraft && profileDraft.remindDaysBefore !== (profile?.remindDaysBefore ?? DEFAULT_REMIND_DAYS)) {
    plan.birthdayRemindDays = profileDraft.remindDaysBefore;
  }

  for (const d of rest) {
    const old = d.id ? byId.get(d.id) : undefined;
    const fields = fieldsOf(d, old);
    if (!old) {
      plan.inserts.push(fields);
      continue;
    }
    if (sameFields(fields, old)) continue;
    plan.updates.push({
      id: old.id,
      fields,
      resetReminded: old.day !== fields.day || old.month !== fields.month || old.isLunar !== fields.isLunar,
    });
  }
  return plan;
}

export function isEmptyPlan(p: OccasionWritePlan): boolean {
  return p.inserts.length === 0 && p.updates.length === 0 && p.deletes.length === 0
    && p.birthday === undefined && p.birthdayRemindDays === undefined;
}

/** Tuổi tròn vào lần sinh nhật tới — chỉ sinh nhật dương lịch có năm (âm lịch lệch năm dương). */
function ageAt(d: Pick<OccasionDraft, 'occasionType' | 'year' | 'isLunar'>, nextIso: string): number | null {
  if (d.occasionType !== 'birthday' || d.isLunar || d.year === null) return null;
  const age = Number(nextIso.slice(0, 4)) - d.year;
  return age > 0 && age < 130 ? age : null;
}

/** "Lần tới: 05/11/2026 · còn 12 ngày · tròn 35 tuổi" cho 1 dòng đã đủ ngày/tháng. */
export function nextOccurrenceInfo(
  d: Pick<OccasionDraft, 'occasionType' | 'day' | 'month' | 'year' | 'isLunar'>,
  today: string,
): { nextIso: string; daysUntil: number; age: number | null } | null {
  if (d.day === null || d.month === null || d.day > maxDay(d.month, d.isLunar)) return null;
  const nextIso = nextOccurrenceIso(d.day, d.month, d.isLunar, today);
  return { nextIso, daysUntil: diffDays(today, nextIso), age: ageAt(d, nextIso) };
}

// ── Cảnh báo khi mở app ─────────────────────────────────────────────────────
export type OccasionAlertStage = 'before' | 'day';

export interface OccasionAlert {
  /** `${occasionId}:${nextIso}:${stage}` — đã xem thì không hiện lại mốc này. */
  key: string;
  occasionId: string;
  contactId: string;
  contactName: string;
  avatarUrl: string;
  /** "Chức vụ · Công ty" để biết là ai. */
  sub: string;
  /** "Sinh nhật", "Sinh nhật của con gái"… */
  label: string;
  nextIso: string;
  daysUntil: number;
  stage: OccasionAlertStage;
  isLunar: boolean;
  /** Ngày âm lịch gốc (d/m) khi isLunar. */
  lunarDayMonth: string;
  age: number | null;
}

export function occasionLabel(o: Pick<CskhOccasion, 'title' | 'relatedPerson'>): string {
  const who = o.relatedPerson.trim();
  return who !== '' && !o.title.toLowerCase().includes(who.toLowerCase()) ? `${o.title} của ${who}` : o.title;
}

/**
 * Các mốc cần báo hôm nay: còn 1..min(remindDaysBefore, 2) ngày → mốc "trước" (lỡ mất ngày đầu
 * vẫn báo ở lần mở app kế tiếp trong khoảng đó), đúng ngày → mốc "đúng ngày". Nhắc MỌI người
 * liên hệ, kể cả người chưa xếp hạng chăm sóc (Tony chốt 31/10/2026 — thay chốt C9 ngày 19/10);
 * chỉ bỏ người đã nghỉ và sự kiện đã xoá.
 */
export function buildOccasionAlerts(
  contacts: readonly Pick<CskhContact, 'id' | 'fullName' | 'avatarUrl' | 'isArchived' | 'jobTitle' | 'organization'>[],
  occasions: readonly Pick<CskhOccasion, 'id' | 'contactId' | 'title' | 'occasionType' | 'day' | 'month' | 'year' | 'isLunar' | 'relatedPerson' | 'remindDaysBefore' | 'isArchived'>[],
  today: string,
): OccasionAlert[] {
  const byId = new Map(contacts.map(c => [c.id, c]));
  const out: OccasionAlert[] = [];
  for (const o of occasions) {
    const c = byId.get(o.contactId);
    if (o.isArchived || !c || c.isArchived) continue;
    const nextIso = nextOccurrenceIso(o.day, o.month, o.isLunar, today);
    const daysUntil = diffDays(today, nextIso);
    const stage: OccasionAlertStage | null =
      daysUntil === 0 ? 'day' : daysUntil > 0 && daysUntil <= Math.min(o.remindDaysBefore, GREETING_POPUP_DAYS) ? 'before' : null;
    if (!stage) continue;
    out.push({
      key: `${o.id}:${nextIso}:${stage}`,
      occasionId: o.id,
      contactId: c.id,
      contactName: c.fullName,
      avatarUrl: c.avatarUrl,
      sub: [c.jobTitle, c.organization].filter(Boolean).join(' · '),
      label: occasionLabel(o),
      nextIso,
      daysUntil,
      stage,
      isLunar: o.isLunar,
      lunarDayMonth: o.isLunar ? `${o.day}/${o.month}` : '',
      age: ageAt(o, nextIso),
    });
  }
  return out.sort((a, b) => a.daysUntil - b.daysUntil || a.contactName.localeCompare(b.contactName, 'vi'));
}

/** Bỏ các mốc đã qua (ngày sự kiện < hôm nay) để danh sách "đã xem" không phình mãi. */
export function pruneSeenKeys(keys: Iterable<string>, today: string): string[] {
  // Khoá `id:YYYY-MM-DD:stage` — id sinh nhật hồ sơ có dạng "birthday:<uuid>" nên lấy ngày ở áp chót
  return [...keys].filter(k => {
    const parts = k.split(':');
    const date = parts.length >= 3 ? parts[parts.length - 2] : '';
    return /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= today;
  });
}

export function alertWhen(daysUntil: number): string {
  return daysUntil === 0 ? 'Hôm nay' : daysUntil === 1 ? 'Ngày mai' : `Còn ${daysUntil} ngày`;
}
