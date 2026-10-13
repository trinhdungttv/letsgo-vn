import { describe, it, expect } from 'vitest';
import { computePlan, DEFAULT_SETTINGS, newLine } from './engine';
import { computePriceList, defaultQuoteSheet, effectiveResult } from './quoteSheet';
import type { CostLine, PlanData } from './types';

// Bảng demo của công ty: giá vốn 349.600 · phí DV 60.000 · thuế 15.000 · giá báo 424.600/công
const lines = (): CostLine[] => [
  newLine({ name: 'Lương cơ bản', unit: 'day', value: 240000, paidToWorker: true, isBaseWage: true, insurable: true, group: 'worker' }),
  newLine({ name: 'Phụ cấp độc hại', unit: 'day', value: 29000, paidToWorker: true, group: 'worker' }),
  newLine({ name: 'Phụ cấp chuyên cần', unit: 'day', value: 11600, paidToWorker: true, group: 'worker' }),
  newLine({ name: 'BHXH', unit: 'day', value: 51000, group: 'compliance' }),
  newLine({ name: 'Phép năm', unit: 'day', value: 9000, group: 'compliance' }),
  newLine({ name: 'Công đoàn', unit: 'day', value: 5000, group: 'compliance' }),
  newLine({ name: 'Khám SK', unit: 'day', value: 4000, group: 'compliance' }),
  newLine({ name: 'Phí dịch vụ', unit: 'day', value: 60000, isServiceFee: true, group: 'service' }),
];
const withDayPrice = (price: number | null, settings: Partial<PlanData['settings']> = {}): PlanData => {
  const q = defaultQuoteSheet();
  return { settings: { ...DEFAULT_SETTINGS, ...settings }, lines: lines(), notes: '', quote: { ...q, rows: q.rows.map(r => (r.kind === 'day8' ? { ...r, override: price } : r)) } };
};
const eff = (d: PlanData) => effectiveResult(d, computePlan(d));

describe('Giá ca 8h ghi tay ở Bảng giá là giá thật', () => {
  it('không ghi tay → giữ nguyên số tự tính', () => {
    const d = withDayPrice(null);
    const e = eff(d);
    expect(e.dayOverridden).toBe(false);
    expect(e.profitMonthly).toBe(computePlan(d).profitMonthly);
  });
  it('ghi đúng bằng giá tự tính → y hệt', () => {
    const e = eff(withDayPrice(424_600));
    expect(e.profitDaily).toBeCloseTo(60_000, 6);
    expect(e.taxDaily).toBeCloseTo(15_000, 6);
  });
  it('làm tròn lên 430.000 → phần dôi 5.400 chia 80% lợi nhuận / 20% thuế', () => {
    const e = eff(withDayPrice(430_000));
    expect(e.quoteDaily).toBe(430_000);
    expect(e.autoQuoteDaily).toBeCloseTo(424_600, 6);
    expect(e.profitDaily).toBeCloseTo(64_320, 6);
    expect(e.taxDaily).toBeCloseTo(16_080, 6);
    expect(e.profitMonthly).toBeCloseTo(64_320 * 520, 4);
    expect(e.companyProfit + e.branchProfit).toBe(Math.round(e.profitMonthly));
    expect(e.revenueMonthly).toBe(430_000 * 520);
  });
  it('khách ép xuống 400.000 → lợi nhuận còn 40.320/công', () => {
    expect(eff(withDayPrice(400_000)).profitDaily).toBeCloseTo(40_320, 6);
  });
  it('báo dưới giá vốn → lỗ đúng bằng phần thiếu, không có thuế âm, có cảnh báo', () => {
    const e = eff(withDayPrice(300_000));
    expect(e.profitDaily).toBeCloseTo(300_000 - 349_600, 6);
    expect(e.taxDaily).toBe(0);
    expect(e.warnings[0]).toMatchObject({ level: 'error' });
  });
  it('không tính thuế: toàn bộ phần chênh vào lợi nhuận', () => {
    expect(eff(withDayPrice(420_000, { taxOption: 'none' })).profitDaily).toBeCloseTo(420_000 - 349_600, 6);
  });
  it('ca đêm tự tính theo giá ngày đang báo', () => {
    const d = withDayPrice(430_000);
    const night = computePriceList(d, computePlan(d)).rows.find(r => r.kind === 'night8')!;
    expect(night.price).toBe(430_000 + 72_000);
  });
});
