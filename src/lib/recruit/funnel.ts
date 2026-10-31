// Phễu tuyển dụng & dự báo kịp chỉ tiêu (GĐ3). File thuần — test ở funnel.test.ts.
//
// Dự báo đơn giản, đọc được: tháng M còn thiếu G người → cần G ÷ (tỷ lệ hồ sơ → đi làm) hồ sơ, và phải gom xong
// trước "hạn gom" = cuối tháng M − số ngày trung vị từ lúc nộp tới lúc đi làm. Chia cho số tuần còn lại tới hạn gom
// → số hồ sơ / tuần cần có; so với số hồ sơ / tuần đang nhận (4 tuần gần nhất).
import type { PlanMatrix } from './plan';

export interface FunnelRow {
  site_id: string | null;
  group_code: string;
  source_channel: string;
  total: number;
  contacted: number;
  interview: number;
  passed: number;
  started: number;
  fee_ok: number;
  lost: number;
  left_count: number;
  early_left: number;
  /** hồ sơ đã nộp ≥ 14 ngày / trong đó đã đi làm (migration 182) */
  mature: number;
  mature_started: number;
}

export interface FunnelReport {
  rows: FunnelRow[];
  median_days_to_start: number | null;
  weeks: { week: string; created: number; started: number }[];
}

export interface FunnelSummary {
  total: number;
  contacted: number;
  interview: number;
  passed: number;
  started: number;
  fee_ok: number;
  lost: number;
  left_count: number;
  early_left: number;
  mature: number;
  mature_started: number;
}

const KEYS: (keyof FunnelSummary)[] = ['total', 'contacted', 'interview', 'passed', 'started', 'fee_ok', 'lost', 'left_count', 'early_left', 'mature', 'mature_started'];

export function sumFunnel(rows: FunnelRow[], filter: (r: FunnelRow) => boolean = () => true): FunnelSummary {
  const out = Object.fromEntries(KEYS.map(k => [k, 0])) as unknown as FunnelSummary;
  for (const r of rows) if (filter(r)) for (const k of KEYS) out[k] += Number(r[k]) || 0;
  return out;
}

/** Giả định khi chưa đủ dữ liệu thật: KTV 6 hồ sơ ra 1 người, LĐPT 3 hồ sơ ra 1 người. */
export const DEFAULT_YIELD: Readonly<Record<string, number>> = { A: 1 / 6, B: 1 / 3, C: 1 / 4, other: 1 / 3, '': 1 / 3 };
export const MIN_MATURE = 30;

/**
 * Tỷ lệ hồ sơ → đi làm, đo trên hồ sơ đã nộp ≥ 14 ngày (đủ thời gian ra kết quả). Đo trên toàn bộ hồ sơ sẽ thấp giả
 * (hồ sơ mới chưa kịp đi làm); đo trên "đã có kết quả" lại lạc quan giả lúc đầu (người đi làm có kết quả trước người
 * bị loại). Chưa đủ 30 hồ sơ như vậy thì dùng giả định theo nhóm.
 */
export function yieldRate(s: FunnelSummary, group = 'B'): { rate: number; measured: boolean; decided: number } {
  if (s.mature >= MIN_MATURE) return { rate: Math.max(0.02, s.mature_started / s.mature), measured: true, decided: s.mature };
  return { rate: DEFAULT_YIELD[group] ?? DEFAULT_YIELD.B, measured: false, decided: s.mature };
}

/** Số hồ sơ / tuần đang nhận: trung bình 4 tuần ĐÃ XONG gần nhất (bỏ tuần đang chạy). */
export function weeklyIntake(weeks: FunnelReport['weeks']): number {
  const done = weeks.slice(0, -1).slice(-4);
  if (!done.length) return 0;
  return done.reduce((s, w) => s + w.created, 0) / done.length;
}

const lastDay = (month: string): Date => {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0));
};
const parseDay = (iso: string): Date => new Date(`${iso}T00:00:00Z`);
const isoDay = (d: Date): string => d.toISOString().slice(0, 10);

export type ForecastStatus = 'done' | 'ok' | 'tight' | 'behind' | 'late' | 'past';
export interface ForecastRow {
  month: string;
  target: number;
  started: number;
  scheduled: number;
  gap: number;
  leadsNeeded: number;
  /** hạn gom hồ sơ (YYYY-MM-DD) để kịp đi làm trong tháng */
  deadline: string;
  weeksLeft: number;
  perWeek: number;
  status: ForecastStatus;
}

export function forecast(input: {
  matrix: PlanMatrix;
  rate: number;
  intakePerWeek: number;
  medianDays: number | null;
  today: string;
}): ForecastRow[] {
  const { matrix, rate, intakePerWeek, today } = input;
  const lead = Math.max(0, Math.round(input.medianDays ?? 7));
  const t = parseDay(today);
  const currentMonth = today.slice(0, 7);
  return matrix.months.map(month => {
    const c = matrix.totals[month];
    const gap = Math.max(0, c.target - c.started - c.scheduled);
    const leadsNeeded = rate > 0 ? Math.ceil(gap / rate) : 0;
    const deadline = new Date(lastDay(month).getTime() - lead * 86400000);
    const days = Math.round((deadline.getTime() - t.getTime()) / 86400000);
    const weeksLeft = Math.max(0, days / 7);
    const perWeek = gap === 0 ? 0 : Math.ceil(leadsNeeded / Math.max(1, weeksLeft));
    let status: ForecastStatus;
    if (month < currentMonth) status = gap > 0 ? 'past' : 'done';
    else if (gap === 0) status = c.target > 0 ? 'done' : 'ok';
    else if (days < 0) status = 'late';
    else if (perWeek <= intakePerWeek) status = 'ok';
    else if (perWeek <= intakePerWeek * 1.5) status = 'tight';
    else status = 'behind';
    return { month, target: c.target, started: c.started, scheduled: c.scheduled, gap, leadsNeeded, deadline: isoDay(deadline), weeksLeft, perWeek, status };
  });
}

/**
 * Tổng số hồ sơ / tuần cần từ nay tới tháng cuối, tính DỒN: các tháng gần phải gom trước nên cộng dồn số hồ sơ cần
 * tới mỗi hạn gom rồi lấy mức cao nhất (tháng nào "chật" nhất quyết định nhịp tuyển).
 */
export function requiredWeeklyPace(rows: ForecastRow[]): number {
  let cum = 0;
  let worst = 0;
  for (const r of rows.filter(x => x.status !== 'past' && x.status !== 'done')) {
    cum += r.leadsNeeded;
    worst = Math.max(worst, Math.ceil(cum / Math.max(1, r.weeksLeft)));
  }
  return worst;
}

/** Chi phí / 1 người đi làm theo kênh (0 người → null). */
export function costPerHire(cost: number, started: number): number | null {
  return started > 0 ? Math.round(cost / started) : null;
}
