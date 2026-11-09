// ============================================================================
// Lịch thực tập — tính lần gần nhất của mùa (lặp hằng năm), tháng rơi vào, và kế hoạch nhắc việc.
// Ngày là chuỗi 'YYYY-MM-DD' (giờ VN), tính bằng UTC để không lệch múi giờ.
// ============================================================================
import type { InternWindow, LaborSource } from './types';

export interface Occurrence {
  start: string;
  end: string;
}

const DAY = 86_400_000;
const toMs = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
const toIso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Cộng năm, 29/02 sang năm không nhuận → 28/02. */
export function addYears(iso: string, years: number): string {
  const y = +iso.slice(0, 4) + years;
  const m = +iso.slice(5, 7);
  let d = +iso.slice(8, 10);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (d > last) d = last;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export const addDays = (iso: string, days: number) => toIso(toMs(iso) + days * DAY);
export const daysBetween = (from: string, to: string) => Math.round((toMs(to) - toMs(from)) / DAY);

/** Ngày kết thúc thực tế (thiếu end_date → coi như 1 ngày). */
const endOf = (w: Pick<InternWindow, 'start_date' | 'end_date'>) =>
  w.end_date && w.end_date >= w.start_date ? w.end_date : w.start_date;

/**
 * Lần đang diễn ra hoặc sắp tới của mùa thực tập.
 * Không lặp → đúng ngày đã nhập (kể cả đã qua). Lặp hằng năm → dời theo năm tới khi chưa kết thúc.
 */
export function nextOccurrence(w: Pick<InternWindow, 'start_date' | 'end_date' | 'repeat_yearly'>, today: string): Occurrence {
  const start = w.start_date;
  const end = endOf(w);
  if (!w.repeat_yearly) return { start, end };
  const span = daysBetween(start, end);
  let k = +today.slice(0, 4) - +start.slice(0, 4) - 1;
  if (k < 0) k = 0;
  for (let i = 0; i < 4; i += 1) {
    const s = addYears(start, k + i);
    const e = addDays(s, span);
    if (e >= today) return { start: s, end: e };
  }
  const s = addYears(start, k + 4);
  return { start: s, end: addDays(s, span) };
}

/** Mọi lần (mùa lặp) chạm vào khoảng [from, to] — dùng cho lịch 12 tháng. */
export function occurrencesBetween(w: Pick<InternWindow, 'start_date' | 'end_date' | 'repeat_yearly'>, from: string, to: string): Occurrence[] {
  const start = w.start_date;
  const end = endOf(w);
  if (!w.repeat_yearly) return end >= from && start <= to ? [{ start, end }] : [];
  const span = daysBetween(start, end);
  const out: Occurrence[] = [];
  const y0 = +from.slice(0, 4) - +start.slice(0, 4) - 1;
  const y1 = +to.slice(0, 4) - +start.slice(0, 4) + 1;
  for (let k = Math.max(0, y0); k <= y1; k += 1) {
    const s = addYears(start, k);
    const e = addDays(s, span);
    if (e >= from && s <= to) out.push({ start: s, end: e });
  }
  return out;
}

/** Các tháng (1–12) mà lần tới của mùa thực tập rơi vào. */
export function occurrenceMonths(o: Occurrence): number[] {
  const out = new Set<number>();
  let y = +o.start.slice(0, 4);
  let m = +o.start.slice(5, 7);
  const ey = +o.end.slice(0, 4);
  const em = +o.end.slice(5, 7);
  for (let guard = 0; guard < 24 && (y < ey || (y === ey && m <= em)); guard += 1) {
    out.add(m);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return [...out].sort((a, b) => a - b);
}

/** Tháng có SV đi thực tập trong 12 tháng tới (gộp mọi mùa của 1 đơn vị). */
export function upcomingMonths(windows: readonly InternWindow[], today: string): number[] {
  const to = addDays(today, 365);
  const set = new Set<number>();
  for (const w of windows) {
    if (w.deleted_at) continue;
    for (const o of occurrencesBetween(w, today, to)) occurrenceMonths(o).forEach(m => set.add(m));
  }
  return [...set].sort((a, b) => a - b);
}

export interface ReminderPlan {
  window: InternWindow;
  source: LaborSource;
  occurrence: Occurrence;
  /** Hạn việc trong Workspace. */
  due: string;
  title: string;
}

export const fmtDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** Tên việc nhắc trong Workspace — bắt đầu bằng "Nguồn LĐ:" để nhận ra ở mọi danh sách. */
export function reminderTitle(source: Pick<LaborSource, 'name' | 'short_name'>, w: Pick<InternWindow, 'cohort'>, o: Occurrence): string {
  const who = source.short_name.trim() || source.name.trim();
  const cohort = w.cohort.trim() ? ` ${w.cohort.trim()}` : '';
  return `Nguồn LĐ: Liên hệ ${who} — mùa thực tập${cohort} từ ${fmtDate(o.start)}`;
}

/**
 * Mùa thực tập nào cần tạo việc nhắc HÔM NAY: đã vào khoảng "trước N ngày" mà chưa bắt đầu, và lần này
 * chưa nhắc (reminder_for khác ngày bắt đầu của lần này). Đơn vị đã xoá / tạm dừng thì bỏ qua.
 */
export function planReminders(windows: readonly InternWindow[], sources: readonly LaborSource[], today: string): ReminderPlan[] {
  const byId = new Map(sources.map(s => [s.id, s]));
  const out: ReminderPlan[] = [];
  for (const w of windows) {
    if (w.deleted_at || w.remind_days <= 0) continue;
    const source = byId.get(w.source_id);
    if (!source || source.deleted_at || source.status === 'paused') continue;
    const o = nextOccurrence(w, today);
    if (o.start < today) continue; // đã bắt đầu → không nhắc nữa
    const from = addDays(o.start, -w.remind_days);
    if (today < from) continue;
    if (w.reminder_for === o.start) continue;
    out.push({ window: w, source, occurrence: o, due: today, title: reminderTitle(source, w, o) });
  }
  return out;
}

// ── Hẹn liên hệ lại (nhãn "Để liên hệ sau", migration 214) ──────────────────
export interface RecontactPlan { source: LaborSource; title: string }

/** Đơn vị "Để liên hệ sau" đã tới ngày hẹn mà chưa tạo việc cho ngày hẹn đó. */
export function planRecontacts(sources: readonly LaborSource[], today: string): RecontactPlan[] {
  return sources
    .filter(s => !s.deleted_at && s.pursuit === 'lien_he_sau' && !!s.recontact_at && s.recontact_at <= today && s.recontact_task_for !== s.recontact_at)
    .map(s => ({ source: s, title: `Nguồn LĐ: Liên hệ lại ${s.short_name.trim() || s.name.trim()} (hẹn ${fmtDate(s.recontact_at!)})` }));
}

// ── Lịch lặp hằng năm nhập KHÔNG CẦN NĂM (Tony 09/11) ────────────────────────
// Lưu vào cột date với NĂM MỐC 2000 (năm nhuận → 29/02 vẫn lưu được). nextOccurrence tự dời sang năm hiện tại.
// "Chỉ tháng" = ngày đầu tháng bắt đầu → ngày cuối tháng kết thúc. Mùa vắt qua năm (T12 → T2) thì kết thúc ở năm mốc + 1.
export const YEARLY_BASE = 2000;
const pad2 = (n: number) => String(n).padStart(2, '0');
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Ngày lưu DB cho mùa lặp hằng năm. day = null → cả tháng (đầu tháng / cuối tháng). */
export function yearlyDates(startMonth: number, startDay: number | null, endMonth: number, endDay: number | null): { start: string; end: string } {
  const sd = Math.min(startDay ?? 1, lastDay(YEARLY_BASE, startMonth));
  const crosses = endMonth < startMonth || (endMonth === startMonth && endDay != null && startDay != null && endDay < startDay);
  const ey = YEARLY_BASE + (crosses ? 1 : 0);
  const ed = Math.min(endDay ?? lastDay(ey, endMonth), lastDay(ey, endMonth));
  return { start: `${YEARLY_BASE}-${pad2(startMonth)}-${pad2(sd)}`, end: `${ey}-${pad2(endMonth)}-${pad2(ed)}` };
}

/** Mùa nhập "chỉ tháng": bắt đầu ngày 1, kết thúc ngày cuối tháng. */
export function isMonthOnly(w: Pick<InternWindow, 'start_date' | 'end_date'>): boolean {
  const e = w.end_date ?? w.start_date;
  return w.start_date.slice(8, 10) === '01' && +e.slice(8, 10) === lastDay(+e.slice(0, 4), +e.slice(5, 7));
}

/** Nhãn mùa: hằng năm → "T3 – T5" / "15/03 – 30/05"; 1 lần → ngày đầy đủ. */
export function windowLabel(w: Pick<InternWindow, 'start_date' | 'end_date' | 'repeat_yearly'>): string {
  const e = w.end_date ?? w.start_date;
  if (!w.repeat_yearly) return w.end_date ? `${fmtDate(w.start_date)} – ${fmtDate(e)}` : fmtDate(w.start_date);
  if (isMonthOnly(w)) {
    const sm = +w.start_date.slice(5, 7);
    const em = +e.slice(5, 7);
    return sm === em && e.slice(0, 4) === w.start_date.slice(0, 4) ? `T${sm} hằng năm` : `T${sm} – T${em} hằng năm`;
  }
  return `${w.start_date.slice(8, 10)}/${w.start_date.slice(5, 7)} – ${e.slice(8, 10)}/${e.slice(5, 7)} hằng năm`;
}
