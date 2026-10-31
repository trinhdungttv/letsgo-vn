// ============================================================================
// Ngày lễ & kỷ niệm của CÔNG TY khách hàng (migration 185) — hàm thuần, có test.
// ----------------------------------------------------------------------------
// Hai nguồn:
//   • client_occasions   ngày riêng của từng công ty (thành lập, kỷ niệm, ngày lễ công ty…)
//   • national_holidays  ngày lễ theo quốc gia, áp cho mọi công ty có người đứng đầu nước đó
//                        (clients.leader_country) — 1 ngày lễ gom nhiều công ty thành 1 dòng.
// Nhập ở module Khách hàng (nút "Ngày lễ KH"); hiện ở CSKH (Sự kiện, Dashboard) và popup
// khi mở app: trước GREETING_POPUP_DAYS ngày + đúng ngày, mỗi mốc 1 lần.
// Chỉ công ty ĐANG HỢP TÁC (isCooperatingClient ở seedTiers) mới được nhắc — nơi gọi tự lọc.
// ============================================================================
import { isValidDayMonth } from './dates';
import { diffDays, nextOccurrenceIso } from './lunar';

export type CompanyOccasionKind = 'founding' | 'anniversary' | 'holiday' | 'other';

export const COMPANY_OCCASION_KINDS: readonly CompanyOccasionKind[] = ['founding', 'anniversary', 'holiday', 'other'];

export const COMPANY_OCCASION_LABEL: Record<CompanyOccasionKind, string> = {
  founding: 'Thành lập',
  anniversary: 'Kỷ niệm',
  holiday: 'Ngày lễ công ty',
  other: 'Khác',
};

export interface CompanyOccasion {
  id: string;
  clientId: string;
  kind: CompanyOccasionKind;
  title: string;
  day: number;
  month: number;
  year: number | null;
  isLunar: boolean;
  note: string;
  isArchived: boolean;
}

export interface NationalHoliday {
  id: string;
  country: string;
  title: string;
  localName: string;
  day: number;
  month: number;
  isLunar: boolean;
  tip: string;
  isArchived: boolean;
}

/** Công ty tối thiểu để tính lịch: tên + quốc gia người đứng đầu. */
export interface CompanyLite {
  id: string;
  name: string;
  leaderCountry: string | null;
}

/** Popup chúc mừng khi mở app: trước 2 ngày + đúng ngày (Tony chốt 31/10/2026). */
export const GREETING_POPUP_DAYS = 2;

// ── Dòng DB → kiểu dùng trong app ───────────────────────────────────────────
export interface CompanyOccasionRow {
  id: string;
  client_id: string;
  kind: string;
  title: string;
  day: number;
  month: number;
  year: number | null;
  is_lunar: boolean;
  note: string | null;
  is_archived: boolean;
}

export interface NationalHolidayRow {
  id: string;
  country: string;
  title: string;
  local_name: string | null;
  day: number;
  month: number;
  is_lunar: boolean;
  tip: string | null;
  is_archived: boolean;
}

const asKind = (k: string): CompanyOccasionKind =>
  (COMPANY_OCCASION_KINDS as readonly string[]).includes(k) ? k as CompanyOccasionKind : 'other';

export function mapCompanyOccasionRow(r: CompanyOccasionRow): CompanyOccasion {
  return {
    id: r.id,
    clientId: r.client_id,
    kind: asKind(r.kind),
    title: r.title,
    day: r.day,
    month: r.month,
    year: r.year ?? null,
    isLunar: !!r.is_lunar,
    note: r.note ?? '',
    isArchived: !!r.is_archived,
  };
}

export function mapNationalHolidayRow(r: NationalHolidayRow): NationalHoliday {
  return {
    id: r.id,
    country: r.country,
    title: r.title,
    localName: r.local_name ?? '',
    day: r.day,
    month: r.month,
    isLunar: !!r.is_lunar,
    tip: r.tip ?? '',
    isArchived: !!r.is_archived,
  };
}

// ── Quốc gia ────────────────────────────────────────────────────────────────
/** Khoá so khớp tên quốc gia: bỏ khác biệt dựng chữ Unicode, hoa/thường, khoảng trắng thừa. */
export function countryKey(name: string | null | undefined): string {
  return (name ?? '').normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Danh sách quốc gia để chọn: gộp nhiều nguồn, bỏ trùng theo countryKey, xếp theo tiếng Việt. */
export function mergeCountryNames(...lists: readonly (readonly (string | null | undefined)[])[]): string[] {
  const byKey = new Map<string, string>();
  for (const list of lists) {
    for (const n of list) {
      const key = countryKey(n);
      if (key && !byKey.has(key)) byKey.set(key, (n as string).normalize('NFC').replace(/\s+/g, ' ').trim());
    }
  }
  return [...byKey.values()].sort((a, b) => a.localeCompare(b, 'vi'));
}

// ── Nhập ngày nhanh ─────────────────────────────────────────────────────────
export interface DayMonthYear {
  day: number;
  month: number;
  year: number | null;
}

/**
 * Ô ngày gõ tay: "15/8", "15/08/2010", "15-8-2010", "15.8", "2010-08-15".
 * '' → null (bỏ trống); sai → 'invalid'. Âm lịch: ngày tối đa 30, không kiểm theo năm.
 */
export function parseDateInput(text: string, isLunar = false): DayMonthYear | null | 'invalid' {
  const s = text.trim();
  if (s === '') return null;
  let day: number;
  let month: number;
  let year: number | null = null;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  const dmy = /^(\d{1,2})\s*[/.\-\s]\s*(\d{1,2})(?:\s*[/.\-\s]\s*(\d{4}))?$/.exec(s);
  if (iso) {
    year = Number(iso[1]);
    month = Number(iso[2]);
    day = Number(iso[3]);
  } else if (dmy) {
    day = Number(dmy[1]);
    month = Number(dmy[2]);
    year = dmy[3] ? Number(dmy[3]) : null;
  } else {
    return 'invalid';
  }
  if (year !== null && (year < 1800 || year > 2200)) return 'invalid';
  if (month < 1 || month > 12 || day < 1) return 'invalid';
  if (isLunar ? day > 30 : !isValidDayMonth(day, month, year)) return 'invalid';
  return { day, month, year };
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** "15/08/2010" hoặc "15/08" khi chưa rõ năm. */
export function formatDayMonthYear(d: DayMonthYear): string {
  return `${pad2(d.day)}/${pad2(d.month)}${d.year !== null ? `/${d.year}` : ''}`;
}

// ── Lịch sắp tới ────────────────────────────────────────────────────────────
interface AgendaBase {
  /** Khoá ổn định: `co:<id>` (ngày công ty) / `nh:<id>` (ngày lễ quốc gia). */
  key: string;
  nextIso: string;
  daysUntil: number;
}

export interface CompanyOccasionItem extends AgendaBase {
  type: 'company';
  occasion: CompanyOccasion;
  client: CompanyLite;
  /** Tròn N năm (thành lập / kỷ niệm dương lịch có năm), null nếu không tính được. */
  years: number | null;
}

export interface NationalHolidayItem extends AgendaBase {
  type: 'national';
  holiday: NationalHoliday;
  /** Các công ty có người đứng đầu nước này (đã xếp theo tên). */
  clients: CompanyLite[];
}

export type CompanyAgendaItem = CompanyOccasionItem | NationalHolidayItem;

/** Tròn N năm vào lần tới — chỉ dương lịch có năm (âm lịch lệch năm dương). */
export function yearsAt(o: Pick<CompanyOccasion, 'kind' | 'year' | 'isLunar'>, nextIso: string): number | null {
  if (o.year === null || o.isLunar || (o.kind !== 'founding' && o.kind !== 'anniversary')) return null;
  const n = Number(nextIso.slice(0, 4)) - o.year;
  return n > 0 ? n : null;
}

/**
 * Ngày công ty + ngày lễ quốc gia trong `withinDays` ngày tới (kể cả hôm nay), gần nhất trước.
 * `clients` = các công ty muốn xét (đã lọc đang hợp tác / phạm vi ở nơi gọi).
 */
export function buildCompanyAgenda(input: {
  clients: readonly CompanyLite[];
  occasions: readonly CompanyOccasion[];
  holidays: readonly NationalHoliday[];
  today: string;
  withinDays?: number;
}): CompanyAgendaItem[] {
  const { today } = input;
  const within = input.withinDays ?? 30;
  const byId = new Map(input.clients.map(c => [c.id, c]));
  const out: CompanyAgendaItem[] = [];

  for (const o of input.occasions) {
    const client = byId.get(o.clientId);
    if (o.isArchived || !client) continue;
    const nextIso = nextOccurrenceIso(o.day, o.month, o.isLunar, today);
    const daysUntil = diffDays(today, nextIso);
    if (daysUntil > within) continue;
    out.push({ type: 'company', key: `co:${o.id}`, occasion: o, client, nextIso, daysUntil, years: yearsAt(o, nextIso) });
  }

  const byCountry = new Map<string, CompanyLite[]>();
  for (const c of input.clients) {
    const k = countryKey(c.leaderCountry);
    if (!k) continue;
    byCountry.set(k, [...(byCountry.get(k) ?? []), c]);
  }
  for (const h of input.holidays) {
    const clients = byCountry.get(countryKey(h.country));
    if (h.isArchived || !clients?.length) continue;
    const nextIso = nextOccurrenceIso(h.day, h.month, h.isLunar, today);
    const daysUntil = diffDays(today, nextIso);
    if (daysUntil > within) continue;
    out.push({
      type: 'national', key: `nh:${h.id}`, holiday: h, nextIso, daysUntil,
      clients: [...clients].sort((a, b) => a.name.localeCompare(b.name, 'vi')),
    });
  }

  return out.sort((a, b) => a.daysUntil - b.daysUntil || agendaTitle(a).localeCompare(agendaTitle(b), 'vi'));
}

/** Tên dòng: "Kỷ niệm 10 năm thành lập" / "Tết Chuseok (Trung thu)". */
export function agendaTitle(item: CompanyAgendaItem): string {
  if (item.type === 'national') return item.holiday.title;
  const o = item.occasion;
  if (o.kind === 'founding') return item.years ? `Kỷ niệm ${item.years} năm thành lập` : 'Ngày thành lập';
  return item.years ? `${o.title} · tròn ${item.years} năm` : o.title;
}

/** "AQUA, CHERVON, HEMPEL +2" — tên công ty của 1 dòng. */
export function agendaCompanies(item: CompanyAgendaItem, max = 3): string {
  const names = item.type === 'company' ? [item.client.name] : item.clients.map(c => c.name);
  return names.length > max ? `${names.slice(0, max).join(', ')} +${names.length - max}` : names.join(', ');
}

// ── Popup khi mở app ────────────────────────────────────────────────────────
export interface CompanyAlert {
  /** `${item.key}:${nextIso}:${stage}` — cùng dạng khoá với popup người liên hệ (pruneSeenKeys). */
  key: string;
  stage: 'before' | 'day';
  item: CompanyAgendaItem;
}

/** Mốc cần báo hôm nay: còn 1..GREETING_POPUP_DAYS ngày → "trước", đúng ngày → "đúng ngày". */
export function buildCompanyAlerts(input: {
  clients: readonly CompanyLite[];
  occasions: readonly CompanyOccasion[];
  holidays: readonly NationalHoliday[];
  today: string;
}): CompanyAlert[] {
  return buildCompanyAgenda({ ...input, withinDays: GREETING_POPUP_DAYS }).map(item => {
    const stage = item.daysUntil === 0 ? 'day' as const : 'before' as const;
    return { key: `${item.key}:${item.nextIso}:${stage}`, stage, item };
  });
}

// ── Lưu form nhập nhanh ─────────────────────────────────────────────────────
/** 1 ngày khác (ngoài ngày thành lập) trên form. id undefined = dòng mới. */
export interface ExtraDraft {
  id?: string;
  kind: CompanyOccasionKind;
  title: string;
  day: number;
  month: number;
  year: number | null;
  isLunar: boolean;
  note: string;
}

export interface CompanyDraft {
  clientId: string;
  /** '' = chưa rõ. */
  country: string;
  /** Ô ngày thành lập gõ tay ("15/08/2010"). */
  founding: string;
  extras: ExtraDraft[];
}

export type OccasionFieldsWrite = Pick<CompanyOccasion, 'kind' | 'title' | 'day' | 'month' | 'year' | 'isLunar' | 'note'>;

export interface CompanyWritePlan {
  /** clients.leader_country mới; undefined = không đổi. */
  country?: string | null;
  inserts: OccasionFieldsWrite[];
  updates: { id: string; fields: OccasionFieldsWrite }[];
  /** Xoá mềm (is_archived) — khôi phục được ở Lịch sử. */
  archives: string[];
}

export function draftFromCompany(clientId: string, country: string | null, occasions: readonly CompanyOccasion[]): CompanyDraft {
  const mine = occasions.filter(o => o.clientId === clientId && !o.isArchived);
  const founding = mine.find(o => o.kind === 'founding');
  return {
    clientId,
    country: country ?? '',
    founding: founding ? formatDayMonthYear(founding) : '',
    extras: mine.filter(o => o !== founding).map(o => ({
      id: o.id, kind: o.kind, title: o.title, day: o.day, month: o.month, year: o.year, isLunar: o.isLunar, note: o.note,
    })),
  };
}

const cleanTitle = (t: string, kind: CompanyOccasionKind) => t.replace(/\s+/g, ' ').trim().slice(0, 120) || COMPANY_OCCASION_LABEL[kind];

function sameFields(a: OccasionFieldsWrite, b: OccasionFieldsWrite): boolean {
  return a.kind === b.kind && a.title === b.title && a.day === b.day && a.month === b.month
    && a.year === b.year && a.isLunar === b.isLunar && a.note === b.note;
}

/**
 * So form của 1 công ty với dữ liệu đang có → việc cần ghi. Ô ngày thành lập sai định dạng
 * → trả lỗi (không ghi gì của công ty đó). Dòng bị bỏ khỏi form → xoá mềm.
 */
export function planCompanySave(
  draft: CompanyDraft,
  currentCountry: string | null,
  occasions: readonly CompanyOccasion[],
): CompanyWritePlan | { error: string } {
  const mine = occasions.filter(o => o.clientId === draft.clientId && !o.isArchived);
  const plan: CompanyWritePlan = { inserts: [], updates: [], archives: [] };

  const country = draft.country.replace(/\s+/g, ' ').trim();
  if (countryKey(country) !== countryKey(currentCountry)) plan.country = country === '' ? null : country;

  const parsed = parseDateInput(draft.founding);
  if (parsed === 'invalid') return { error: `Ngày thành lập "${draft.founding.trim()}" không hợp lệ — gõ dạng 15/08/2010 hoặc 15/08` };
  const founding = mine.find(o => o.kind === 'founding');
  if (parsed) {
    const fields: OccasionFieldsWrite = {
      kind: 'founding', title: COMPANY_OCCASION_LABEL.founding, day: parsed.day, month: parsed.month,
      year: parsed.year, isLunar: false, note: founding?.note ?? '',
    };
    if (!founding) plan.inserts.push(fields);
    else if (!sameFields(fields, { ...founding, title: COMPANY_OCCASION_LABEL.founding })) plan.updates.push({ id: founding.id, fields });
  } else if (founding) {
    plan.archives.push(founding.id);
  }

  const byId = new Map(mine.filter(o => o !== founding).map(o => [o.id, o]));
  const kept = new Set<string>();
  for (const e of draft.extras) {
    // Ngày thành lập chỉ nhập ở ô riêng — dòng khác chọn loại "Thành lập" coi như Kỷ niệm
    const kind: CompanyOccasionKind = e.kind === 'founding' ? 'anniversary' : e.kind;
    const fields: OccasionFieldsWrite = {
      kind, title: cleanTitle(e.title, kind), day: e.day, month: e.month,
      year: e.year, isLunar: e.isLunar, note: e.note.trim(),
    };
    const old = e.id ? byId.get(e.id) : undefined;
    if (!old) {
      plan.inserts.push(fields);
      continue;
    }
    kept.add(old.id);
    if (!sameFields(fields, old)) plan.updates.push({ id: old.id, fields });
  }
  for (const id of byId.keys()) if (!kept.has(id)) plan.archives.push(id);
  return plan;
}

export function isEmptyCompanyPlan(p: CompanyWritePlan): boolean {
  return p.country === undefined && p.inserts.length === 0 && p.updates.length === 0 && p.archives.length === 0;
}
