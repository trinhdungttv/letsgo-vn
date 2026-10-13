import { describe, it, expect } from 'vitest';
import { computePlan, DEFAULT_SETTINGS, newLine } from './engine';
import { computePriceList, defaultQuoteSheet, effectiveResult, setPerHour } from './quoteSheet';
import { defaultDoc, emptyProfile, resolveDoc } from './quoteDoc';
import type { PlanData, QuoteRowKind } from './types';

// TRI-WALL CARTON: lương 250.000/công, phí dịch vụ 50.000/công, không tính thuế → giá 1 công 300.000
const plan = (o: { perHour?: boolean; itemized?: boolean; ov?: Partial<Record<QuoteRowKind, number>> } = {}): PlanData => {
  const q = defaultQuoteSheet();
  return {
    settings: { ...DEFAULT_SETTINGS, taxOption: 'none', workers: 10, simDays: 26 }, notes: '',
    lines: [
      newLine({ name: 'Lương cơ bản', unit: 'day', value: 250_000, paidToWorker: true, isBaseWage: true, insurable: true, group: 'worker' }),
      newLine({ name: 'Phí dịch vụ', unit: 'day', value: 50_000, isServiceFee: true, group: 'service' }),
    ],
    quote: { ...q, perHour: o.perHour, itemized: o.itemized, rows: q.rows.map(r => ({ ...r, override: o.ov?.[r.kind] ?? null })) },
  };
};
const run = (d: PlanData) => { const r = computePlan(d); return { e: effectiveResult(d, r), rows: computePriceList(d, r).rows }; };
const row = (d: PlanData, k: QuoteRowKind) => run(d).rows.find(x => x.kind === k)!;

describe('Báo giá theo giờ', () => {
  it('dòng ca ngày / ca đêm thành giá 1 giờ, đổi tên & đơn vị; tăng ca giữ nguyên', () => {
    const d = plan({ perHour: true });
    expect(row(d, 'day8')).toMatchObject({ price: 37_500, name: 'Lương 1 giờ làm việc ca ngày', unit: 'VNĐ/giờ' });
    expect(row(d, 'night8')).toMatchObject({ price: Math.round((300_000 + 75_000) / 8), unit: 'VNĐ/giờ (ca đêm)' });
    expect(row(d, 'ot_day').price).toBe(row(plan(), 'ot_day').price);   // 31.250 × 150% = 46.875 cả 2 kiểu
  });
  it('ghi tay 40.000/giờ → giá công 320.000, lợi nhuận tăng đúng 20.000/công', () => {
    const { e } = run(plan({ perHour: true, ov: { day8: 40_000 } }));
    expect(e.quoteDaily).toBe(320_000);
    expect(e.profitDaily).toBeCloseTo(70_000, 6);
  });
  it('tách khoản + theo giờ: lương 31.250/giờ + phí dịch vụ 6.250/giờ', () => {
    const d = plan({ perHour: true, itemized: true });
    expect(row(d, 'day8').price).toBe(31_250);
    expect(row(d, 'service_fee')).toMatchObject({ price: 6_250, unit: 'VNĐ/giờ' });
    expect(run(plan({ perHour: true, itemized: true, ov: { service_fee: 7_000 } })).e.profitDaily).toBeCloseTo(56_000, 6);
  });
  it('đổi ngày ⇄ giờ: giá ghi tay ở dòng chính quy đổi theo, dòng khác giữ nguyên', () => {
    const q = plan({ ov: { day8: 320_000, ot_day: 38_000 } }).quote!;
    const h = setPerHour(q, true);
    expect(h.rows.find(r => r.kind === 'day8')!.override).toBe(40_000);
    expect(h.rows.find(r => r.kind === 'ot_day')!.override).toBe(38_000);
    expect(setPerHour(h, false).rows.find(r => r.kind === 'day8')!.override).toBe(320_000);
  });
  it('tên tự đặt giữ nguyên; tài liệu báo giá dịch tên/đơn vị theo giờ', () => {
    const d = plan({ perHour: true });
    d.quote!.rows = d.quote!.rows.map(r => (r.kind === 'night8' ? { ...r, name: 'Lương ca đêm 8h' } : r));
    expect(row(d, 'night8').name).toBe('Lương ca đêm 8h');
    const v = resolveDoc({ ...defaultDoc(new Date('2026-10-13')), lang: 'zh' }, d, computePlan(d), emptyProfile());
    expect(v.rows[0]).toMatchObject({ name: { a: 'Lương 1 giờ làm việc ca ngày', b: '白班每小时工资' }, unit: { a: 'VNĐ/giờ', b: '越南盾/小时' }, price: 37_500 });
  });
});
