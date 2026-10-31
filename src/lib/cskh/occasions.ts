// ============================================================================
// CSKH — Ngày quan trọng nhập ngay trong hồ sơ + nhắc khi mở app (port PRM occasions.ts)
// ----------------------------------------------------------------------------
// Mỗi người: nhiều dòng (loại · tên · ngày/tháng/năm? · âm lịch · nhắc trước N ngày).
// Nguồn lưu của LetsGo:
//   • Sinh nhật của CHÍNH người liên hệ, dương lịch, biết năm → contacts.birthday (dùng chung
//     với hồ sơ Khách hàng) + contacts.birthday_remind_days (migration 174).
//   • Mọi dòng khác (âm lịch, không rõ năm, của người thân, kỷ niệm, giỗ…) → contact_special_dates.
// Nhắc khi mở app (popup chúc mừng): lần mở app ĐẦU TIÊN trong 2 ngày trước rồi nhắc LẠI
// ĐÚNG NGÀY — mỗi mốc chỉ hiện 1 lần (khoá `id:ngàyLầnTới:stage`). "Nhắc trước N ngày" của
// từng sự kiện vẫn quyết định việc "Chuẩn bị quà" ở Workspace; popup lấy min(N, 2) — N = 0
// thì chỉ báo đúng ngày. Hàm thuần, có test.
// ============================================================================
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
  };
}

export function blankDraft(occasionType: OccasionType = 'birthday'): OccasionDraft {
  return { occasionType, title: '', day: null, month: null, year: null, isLunar: false, remindDaysBefore: DEFAULT_REMIND_DAYS };
}

/** Dòng chưa chọn ngày lẫn tháng — bỏ qua khi lưu. */
export function isBlankDraft(d: Pick<OccasionDraft, 'day' | 'month'>): boolean {
  return d.day === null && d.month === null;
}

/** Tên lưu vào DB: bỏ trống thì lấy tên loại ("Sinh nhật", "Kỷ niệm"…). */
export function draftTitle(d: Pick<OccasionDraft, 'title' | 'occasionType'>): string {
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
 * Dòng này lưu được vào contacts.birthday không: sinh nhật của chính người liên hệ (tên mặc
 * định "Sinh nhật"), dương lịch, đủ ngày/tháng/năm.
 */
export function fitsProfileBirthday(d: OccasionDraft): boolean {
  return d.occasionType === 'birthday' && !d.isLunar && d.day !== null && d.month !== null && d.year !== null
    && draftTitle(d) === OCCASION_LABEL.birthday;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

export type OccasionFields = Pick<CskhOccasion, 'occasionType' | 'title' | 'day' | 'month' | 'year' | 'isLunar' | 'remindDaysBefore'>;

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

function fieldsOf(d: OccasionDraft): OccasionFields {
  return {
    occasionType: d.occasionType,
    title: draftTitle(d),
    day: d.day ?? 1,
    month: d.month ?? 1,
    year: d.year,
    isLunar: d.isLunar,
    remindDaysBefore: d.remindDaysBefore,
  };
}

function sameFields(a: OccasionFields, b: OccasionFields): boolean {
  return a.occasionType === b.occasionType && a.title === b.title && a.day === b.day && a.month === b.month
    && a.year === b.year && a.isLunar === b.isLunar && a.remindDaysBefore === b.remindDaysBefore;
}

/**
 * Đối chiếu ngày đang có với form. `existing` = sự kiện CÒN DÙNG của người này (kể cả
 * sinh nhật ảo dựng từ contacts.birthday). Chỉ đụng các cột form quản lý (giữ nguyên người
 * thân, ghi chú, last_reminded_year nếu ngày không đổi).
 *   • Sinh nhật trong hồ sơ: dòng giữ id `birthday:` mà vẫn hợp lệ → contacts.birthday; nếu
 *     chưa có thì dòng MỚI đầu tiên hợp lệ (tên "Sinh nhật", dương lịch, có năm) lấp vào.
 *     Dòng sinh nhật hồ sơ đổi sang âm lịch / bỏ năm / đổi tên → thành sự kiện riêng.
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

  const profileDraft = filled.find(d => isProfileBirthdayId(d.id) && fitsProfileBirthday(d))
    ?? filled.find(d => !d.id && fitsProfileBirthday(d))
    ?? null;
  const rest = filled.filter(d => d !== profileDraft);
  const kept = new Set(rest.filter(d => d.id && byId.has(d.id)).map(d => d.id as string));

  const plan: OccasionWritePlan = {
    inserts: [],
    updates: [],
    deletes: specials.filter(o => !kept.has(o.id)).map(o => o.id),
  };

  const iso = profileDraft ? `${profileDraft.year}-${pad2(profileDraft.month as number)}-${pad2(profileDraft.day as number)}` : null;
  const currentIso = profile ? `${profile.year}-${pad2(profile.month)}-${pad2(profile.day)}` : null;
  if (iso !== currentIso) plan.birthday = iso;
  if (profileDraft && profileDraft.remindDaysBefore !== (profile?.remindDaysBefore ?? DEFAULT_REMIND_DAYS)) {
    plan.birthdayRemindDays = profileDraft.remindDaysBefore;
  }

  for (const d of rest) {
    const old = d.id ? byId.get(d.id) : undefined;
    const fields = fieldsOf(d);
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
