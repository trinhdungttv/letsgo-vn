import { describe, it, expect } from 'vitest';
import { computePlan, solveServiceFee, summarizePlan, DEFAULT_SETTINGS, newLine } from './engine';
import { computePriceList, includedNoteAuto, priceListToTsv } from './quoteSheet';
import { defaultDoc, emptyProfile, resolveDoc } from './quoteDoc';
import { buildFillValues } from './excelFill';
import type { CostLine, PlanData } from './types';

// Bảng demo của công ty (xem costPlan.test.ts): giá báo 424.600/công, trong đó BHXH 51.000/công
const lines = (sepBhxh: boolean): CostLine[] => [
  newLine({ name: 'Lương cơ bản', unit: 'day', value: 240000, paidToWorker: true, isBaseWage: true, insurable: true, group: 'worker' }),
  newLine({ name: 'Phụ cấp độc hại', unit: 'day', value: 29000, paidToWorker: true, group: 'worker' }),
  newLine({ name: 'Phụ cấp chuyên cần', unit: 'day', value: 11600, paidToWorker: true, group: 'worker' }),
  newLine({ name: 'BHXH', unit: 'day', value: 51000, group: 'compliance', billSeparately: sepBhxh }),
  newLine({ name: 'Phép năm', unit: 'day', value: 9000, group: 'compliance' }),
  newLine({ name: 'Công đoàn', unit: 'day', value: 5000, group: 'compliance' }),
  newLine({ name: 'Khám SK', unit: 'day', value: 4000, group: 'compliance' }),
  newLine({ name: 'Phí dịch vụ', unit: 'day', value: 60000, isServiceFee: true, group: 'service' }),
];
const plan = (sep: boolean, settings: Partial<PlanData['settings']> = {}): PlanData =>
  ({ settings: { ...DEFAULT_SETTINGS, ...settings }, lines: lines(sep), notes: '' });

describe('Tách bảo hiểm khỏi giá ngày — thu riêng theo tháng', () => {
  const gop = computePlan(plan(false));
  const tach = computePlan(plan(true));

  it('giá ngày giảm đúng bằng phần bảo hiểm; giá vốn không đổi', () => {
    expect(tach.costDaily).toBe(gop.costDaily);
    expect(tach.separatedDaily).toBe(51_000);
    expect(tach.quoteDaily).toBeCloseTo(424_600 - 51_000, 6);
    expect(tach.separatedMonthly).toBe(51_000 * 26);
  });
  it('lợi nhuận không đổi (thu bao nhiêu chi bấy nhiêu), doanh thu tháng vẫn đủ', () => {
    expect(tach.profitMonthly).toBe(gop.profitMonthly);
    expect(tach.separatedBilledMonthly).toBe(51_000 * 26 * 20);
    expect(tach.revenueMonthly).toBeCloseTo(gop.revenueMonthly, 4);
  });
  it('dưới 14 công/tháng: không thu, có nhắc', () => {
    const r = computePlan(plan(true, { simDays: 12 }));
    expect(r.separatedBilledMonthly).toBe(0);
    expect(r.warnings.some(w => w.text.includes('dưới 14 công'))).toBe(true);
    const r2 = computePlan(plan(true, { simDays: 12, insuranceMinDays: 10 }));
    expect(r2.separatedBilledMonthly).toBeGreaterThan(0);
  });
  it('thuế 20% tổng chỉ tính trên phần trong giá ngày', () => {
    const r = computePlan(plan(true, { taxOption: 'total20' }));
    expect(r.taxDaily).toBeCloseTo((409_600 - 51_000) * 0.2, 6);
  });
  it('tính ngược phí DV từ giá ngày khách chốt vẫn đúng khi đã tách', () => {
    const fee = solveServiceFee(plan(true), 400_000)!;
    const r = computePlan({ ...plan(true), lines: plan(true).lines.map(l => (l.isServiceFee ? fee : l)) });
    expect(r.quoteDaily).toBeCloseTo(400_000, 0);
  });
  it('bảng giá: thêm dòng bảo hiểm /người/tháng, "Bao gồm" bỏ BHXH; không tách thì không có dòng này', () => {
    const list = computePriceList(plan(true), tach);
    const ins = list.rows.find(r => r.kind === 'insurance')!;
    expect(ins).toMatchObject({ price: 1_326_000, unit: 'VNĐ/người/tháng', hidden: false });
    expect(list.rows.find(r => r.kind === 'day8')!.price).toBe(373_600);
    expect(includedNoteAuto(plan(true))).not.toContain('BHXH');
    expect(includedNoteAuto(plan(false))).toContain('BHXH');
    expect(computePriceList(plan(false), gop).rows.some(r => r.kind === 'insurance')).toBe(false);
    expect(priceListToTsv(list, '', '')).toContain('Chỉ áp dụng cho NLĐ làm từ 14 công/tháng trở lên');
  });
  it('tài liệu báo giá: dòng bảo hiểm được dịch + ghi chú điều kiện 14 công', () => {
    const v = resolveDoc({ ...defaultDoc(new Date('2026-10-13')), lang: 'zh' }, plan(true), tach, emptyProfile());
    const row = v.rows.find(r => r.unit.a === 'VNĐ/người/tháng')!;
    expect(row.name).toEqual({ a: 'Bảo hiểm xã hội, y tế, thất nghiệp', b: '社会保险、医疗保险、失业保险' });
    expect(v.notes[0].a).toContain('làm từ 14 công/tháng trở lên');
    expect(v.notes[0].b).toContain('14个工日');
    const v2 = resolveDoc(defaultDoc(new Date('2026-10-13')), plan(false), gop, emptyProfile());
    expect(v2.notes.some(n => n.a.includes('14 công'))).toBe(false);
  });
  it('điền file Excel mẫu: ô BHXH = khoản thu riêng, ô giá ngày = giá đã tách', () => {
    const fv = buildFillValues(plan(true), tach, {});
    expect(fv.prices.bhxh).toBe(1_326_000);
    expect(fv.prices.day8).toBe(373_600);
  });
  it('tóm tắt lưu kèm phương án có khoản thu riêng / người / tháng', () => {
    expect(summarizePlan(plan(true), tach).insuranceMonthly).toBe(1_326_000);
    expect('insuranceMonthly' in summarizePlan(plan(false), gop)).toBe(false);
  });
});
