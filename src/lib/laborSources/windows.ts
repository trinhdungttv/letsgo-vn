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
