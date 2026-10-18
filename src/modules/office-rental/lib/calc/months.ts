import type { MonthKey } from './types';

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function isMonthKey(s: unknown): s is MonthKey {
  return typeof s === 'string' && MONTH_RE.test(s);
}

/** '2026-01-01' | '2026-01' → '2026-01' */
export function toMonthKey(s: string): MonthKey {
  return s.slice(0, 7);
}

/** '2026-01' → '2026-01-01' (cột date trong DB) */
export function monthToDate(m: MonthKey): string {
  return `${m}-01`;
}

export function addMonths(m: MonthKey, n: number): MonthKey {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function monthRange(start: MonthKey, count: number): MonthKey[] {
  const out: MonthKey[] = [];
  for (let i = 0; i < count; i++) out.push(addMonths(start, i));
  return out;
}

/** '2026-01' → 'T1/2026' */
export function monthLabel(m: MonthKey): string {
  const [y, mo] = m.split('-');
  return `T${Number(mo)}/${y}`;
}

export function currentMonthKey(now: Date = new Date()): MonthKey {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}
