import { describe, it, expect } from 'vitest';
import { addIssue, changedSinceIssue, cleanIssues, latestIssue, planStage, quoteFingerprint, removeLastIssue } from './issue';
import { DEFAULT_SETTINGS, newLine, normalizePlanData } from './engine';
import { defaultQuoteSheet } from './quoteSheet';
import { defaultDoc } from './quoteDoc';
import { EMPTY_PLAN_FILTER, filterPlans } from './listFilter';
import type { CostPlanRow, PlanData } from './types';

const plan = (): PlanData => ({
  settings: { ...DEFAULT_SETTINGS, taxOption: 'none' }, notes: 'ghi chú nội bộ',
  lines: [
    newLine({ name: 'Lương cơ bản', unit: 'day', value: 250_000, paidToWorker: true, isBaseWage: true, group: 'worker' }),
    newLine({ name: 'Phí dịch vụ', unit: 'day', value: 50_000, isServiceFee: true, group: 'service' }),
  ],
  quote: defaultQuoteSheet(),
  doc: defaultDoc(new Date('2026-10-14')),
});
const sent = (d: PlanData) => addIssue(d, { date: '2026-10-14', to: 'Chị Lan', channel: 'zalo', by: 'Dũng' });

describe('Đã ban hành (đã gửi khách)', () => {
  it('ghi nhận lần gửi; trạng thái hiển thị: Lưu trữ > Đã ban hành > Đã chốt > Nháp', () => {
    const d = sent(plan());
    expect(latestIssue(d)).toMatchObject({ date: '2026-10-14', to: 'Chị Lan', channel: 'zalo', by: 'Dũng' });
    expect(latestIssue(d)!.fingerprint).toBeTruthy();
    expect(planStage({ status: 'draft', data: plan() })).toBe('draft');
    expect(planStage({ status: 'final', data: plan() })).toBe('final');
    expect(planStage({ status: 'final', data: d })).toBe('issued');
    expect(planStage({ status: 'draft', data: d })).toBe('issued');
    expect(planStage({ status: 'archived', data: d })).toBe('archived');
  });
  it('sửa nội dung khách nhận (giá, dòng, số / hiệu lực báo giá) → "đã sửa sau khi gửi"; sửa ghi chú nội bộ / quy mô thì không', () => {
    const d = sent(plan());
    expect(changedSinceIssue(d)).toBe(false);
    expect(changedSinceIssue({ ...d, notes: 'đổi ghi chú', settings: { ...d.settings, workers: 50, companyPct: 50 } })).toBe(false);
    expect(changedSinceIssue({ ...d, lines: d.lines.map(l => (l.isServiceFee ? { ...l, value: 60_000 } : l)) })).toBe(true);
    expect(changedSinceIssue({ ...d, doc: { ...d.doc!, validUntil: '2027-01-31' } })).toBe(true);
    const q = d.quote!;
    expect(changedSinceIssue({ ...d, quote: { ...q, rows: q.rows.map(r => (r.kind === 'ot_hol' ? { ...r, hidden: false } : r)) } })).toBe(true);
    expect(changedSinceIssue(plan())).toBeNull();
  });
  it('ban hành lại: thêm lần gửi mới, dấu vân tay theo bản mới; bỏ đánh dấu lần gần nhất', () => {
    const d1 = sent(plan());
    const edited = { ...d1, lines: d1.lines.map(l => (l.isServiceFee ? { ...l, value: 60_000 } : l)) };
    const d2 = addIssue(edited, { date: '2026-10-20', channel: 'email' });
    expect(cleanIssues(d2.issues)).toHaveLength(2);
    expect(changedSinceIssue(d2)).toBe(false);
    expect(latestIssue(removeLastIssue(d2))!.date).toBe('2026-10-14');
    expect(removeLastIssue(d1).issues).toBeUndefined();
  });
  it('lưu / đọc lại giữ các lần gửi; dữ liệu hỏng bị bỏ qua', () => {
    const d = sent(plan());
    expect(latestIssue(normalizePlanData(JSON.parse(JSON.stringify(d))))).toEqual(latestIssue(d));
    expect(quoteFingerprint(normalizePlanData(JSON.parse(JSON.stringify(d))))).toBe(latestIssue(d)!.fingerprint);
    expect(cleanIssues([{ date: 'hôm qua' }, null, { date: '2026-10-01', channel: 'fax' }])).toEqual([{ date: '2026-10-01', at: '2026-10-01T00:00:00.000Z', fingerprint: '' }]);
    expect(normalizePlanData({ ...plan(), issues: [] }).issues).toBeUndefined();
  });
  it('lọc danh sách: tab "Đã ban hành" tách khỏi Nháp / Đã chốt', () => {
    const row = (id: string, status: CostPlanRow['status'], data: PlanData) => ({ id, status, data, title: id, pipeline_id: null, client_id: null, company_name: null }) as unknown as CostPlanRow;
    const plans = [row('nhap', 'draft', plan()), row('chot', 'final', plan()), row('gui', 'final', sent(plan())), row('cu', 'archived', sent(plan()))];
    const ids = (status: typeof EMPTY_PLAN_FILTER.status) => filterPlans(plans, { ...EMPTY_PLAN_FILTER, status }, [], []).map(p => p.id);
    expect(ids('')).toEqual(['nhap', 'chot', 'gui']);
    expect(ids('draft')).toEqual(['nhap']);
    expect(ids('final')).toEqual(['chot']);
    expect(ids('issued')).toEqual(['gui']);
    expect(ids('archived')).toEqual(['cu']);
  });
});
