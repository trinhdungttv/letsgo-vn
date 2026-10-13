import { describe, it, expect } from 'vitest';
import { computePlan, DEFAULT_SETTINGS, newLine } from './engine';
import { computePriceList, defaultQuoteSheet, effectiveResult } from './quoteSheet';
import { buildFillValues } from './excelFill';
import type { PlanData, QuoteRowKind } from './types';

// Đúng tình huống CÔNG TY TNHH BAO BÌ TRƯỜNG VIỆT: lương 260.000/công, BHXH 21,5% trên tối thiểu Vùng I 5.310.000
// thu riêng theo tháng, phí dịch vụ 46.090/công, không tính thuế dự phòng.
const plan = (itemized: boolean, ov: Partial<Record<QuoteRowKind, number>> = {}): PlanData => {
  const q = defaultQuoteSheet();
  return {
    settings: { ...DEFAULT_SETTINGS, taxOption: 'none', insuranceBase: 'region', workers: 1, simDays: 20 },
    minWage: { monthly: 5_310_000, label: 'Vùng I' }, notes: '',
    lines: [
      newLine({ name: 'Lương cơ bản', unit: 'day', value: 260_000, paidToWorker: true, isBaseWage: true, insurable: true, group: 'worker' }),
      newLine({ name: 'BHXH, BHYT, BHTN (DN đóng 21,5%)', group: 'compliance', mode: 'percent', base: 'insurable', value: 21.5, billSeparately: true }),
      newLine({ name: 'Phí dịch vụ nhà thầu cung ứng', unit: 'day', value: 46_090, isServiceFee: true, group: 'service' }),
    ],
    quote: { ...q, itemized, rows: q.rows.map(r => ({ ...r, override: ov[r.kind] ?? null })) },
  };
};
const run = (d: PlanData) => { const r = computePlan(d); return { r, e: effectiveResult(d, r), list: computePriceList(d, r) }; };
const price = (d: PlanData, k: QuoteRowKind) => run(d).list.rows.find(x => x.kind === k)?.price;

describe('Báo giá tách khoản: lương = trả NLĐ, phí dịch vụ là dòng riêng', () => {
  it('dòng lương = 260.000, dòng phí dịch vụ = 46.090, bảo hiểm 1.141.650/tháng thu riêng', () => {
    const d = plan(true);
    expect(price(d, 'day8')).toBe(260_000);
    expect(price(d, 'service_fee')).toBe(46_090);
    expect(price(d, 'insurance')).toBe(1_141_650);
    expect(price(d, 'night8')).toBe(260_000 + 78_000);    // lương ca đêm = lương + 30%
  });
  it('lãi = phí dịch vụ 46.090/công (KHÔNG phải 0), kể cả khi ghi tay dòng lương 260.000', () => {
    expect(run(plan(true)).e.profitDaily).toBeCloseTo(46_090, 6);
    const { e } = run(plan(true, { day8: 260_000 }));
    expect(e.profitDaily).toBeCloseTo(46_090, 6);
    expect(e.profitMonthly).toBeCloseTo(46_090 * 20, 4);
    expect(e.warnings.some(w => w.text.includes('biên lợi nhuận dưới 5%'))).toBe(false);
  });
  it('ghi tay phí dịch vụ 50.000 → lãi 50.000/công', () => {
    expect(run(plan(true, { service_fee: 50_000 })).e.profitDaily).toBeCloseTo(50_000, 6);
  });
  it('kiểu gộp: dòng giá ngày là toàn bộ tiền khách trả — ghi 260.000 thì đúng là không còn lãi', () => {
    expect(price(plan(false), 'service_fee')).toBeUndefined();
    expect(price(plan(false), 'day8')).toBe(306_090);
    expect(run(plan(false, { day8: 260_000 })).e.profitDaily).toBeCloseTo(0, 6);
  });
  it('điền file Excel mẫu tách khoản: Phí dịch vụ lấy đúng dòng phí (kể cả ghi tay)', () => {
    const d = plan(true, { service_fee: 50_000 });
    expect(buildFillValues(d, computePlan(d), {}).prices.service_fee).toBe(50_000);
  });
});
