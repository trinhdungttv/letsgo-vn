import { describe, it, expect } from 'vitest';
import { costPerHire, forecast, requiredWeeklyPace, sumFunnel, weeklyIntake, yieldRate } from './funnel';
import type { FunnelRow } from './funnel';
import type { PlanMatrix } from './plan';

const row = (o: Partial<FunnelRow>): FunnelRow => ({
  site_id: 's', group_code: 'B', source_channel: 'Facebook', total: 0, contacted: 0, interview: 0, passed: 0, started: 0,
  fee_ok: 0, lost: 0, left_count: 0, early_left: 0, mature: 0, mature_started: 0, ...o,
});

const matrix = (cells: Record<string, [number, number, number]>): PlanMatrix => {
  const months = Object.keys(cells);
  const totals = Object.fromEntries(months.map(m => [m, { target: cells[m][0], started: cells[m][1], scheduled: cells[m][2], confirmed: false }]));
  return { months, rows: [], totals, grand: { target: 0, started: 0, scheduled: 0, confirmed: false }, surveyQty: 0 };
};

describe('Phễu tuyển dụng', () => {
  it('cộng dồn theo bộ lọc', () => {
    const s = sumFunnel([row({ total: 10, started: 3 }), row({ group_code: 'A', total: 4, started: 1 })], r => r.group_code === 'B');
    expect(s).toMatchObject({ total: 10, started: 3 });
  });
  it('tỷ lệ đo trên hồ sơ đã nộp ≥ 14 ngày; lúc đầu chỉ có người đi làm thì KHÔNG ra 100%', () => {
    expect(yieldRate(sumFunnel([row({ total: 100, started: 22, mature: 60, mature_started: 15 })]))).toEqual({ rate: 0.25, measured: true, decided: 60 });
    expect(yieldRate(sumFunnel([row({ total: 22, started: 22, mature: 0, mature_started: 0 })]))).toEqual({ rate: 1 / 3, measured: false, decided: 0 });
    expect(yieldRate(sumFunnel([row({ mature: 10, mature_started: 2 })]), 'A').rate).toBeCloseTo(1 / 6);
    expect(yieldRate(sumFunnel([row({ mature: 40, mature_started: 0 })])).rate).toBe(0.02);
  });
  it('hồ sơ / tuần: 4 tuần đã xong gần nhất', () => {
    const weeks = [10, 20, 30, 40, 50, 999].map((created, i) => ({ week: `w${i}`, created, started: 0 }));
    expect(weeklyIntake(weeks)).toBe(35);
    expect(weeklyIntake([])).toBe(0);
  });
  it('chi phí / người', () => {
    expect(costPerHire(7_000_000, 14)).toBe(500_000);
    expect(costPerHire(1, 0)).toBeNull();
  });
});

describe('Dự báo kịp chỉ tiêu (tình huống Co-Herent T4/27)', () => {
  const m = matrix({ '2026-10': [10, 4, 0], '2026-11': [499, 0, 99], '2027-04': [2224, 0, 0] });
  const rows = forecast({ matrix: m, rate: 1 / 3, intakePerWeek: 150, medianDays: 10, today: '2026-11-01' });
  it('tháng đã qua còn thiếu → past', () => {
    expect(rows[0].status).toBe('past');
  });
  it('T11: thiếu 400 (đã trừ 99 hẹn) → 1.200 hồ sơ trước 20/11 → ~429/tuần > 150×1,5 → behind', () => {
    expect(rows[1]).toMatchObject({ gap: 400, leadsNeeded: 1200, deadline: '2026-11-20', status: 'behind' });
    expect(rows[1].perWeek).toBe(Math.ceil(1200 / (19 / 7)));
  });
  it('T4/27: 6.672 hồ sơ trước 20/04 (24 tuần) → 278/tuần', () => {
    expect(rows[2]).toMatchObject({ gap: 2224, leadsNeeded: 6672, deadline: '2027-04-20' });
    expect(rows[2].perWeek).toBe(Math.ceil(6672 / (170 / 7)));
  });
  it('nhịp tuyển chung lấy tháng "chật" nhất (cộng dồn)', () => {
    expect(requiredWeeklyPace(rows)).toBe(Math.max(rows[1].perWeek, Math.ceil((1200 + 6672) / (170 / 7))));
  });
  it('đủ người → done; quá hạn gom → late', () => {
    const r = forecast({ matrix: matrix({ '2026-11': [5, 5, 0], '2026-12': [10, 0, 0] }), rate: 0.5, intakePerWeek: 100, medianDays: 40, today: '2026-11-25' });
    expect(r[0].status).toBe('done');
    expect(r[1].status).toBe('late');
  });
});
