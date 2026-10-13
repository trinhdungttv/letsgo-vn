import { describe, it, expect } from 'vitest';
import { computePlan, DEFAULT_SETTINGS, INSURANCE_CAP_MONTHLY, newLine } from './engine';
import type { PlanData } from './types';

// Lương trả NLĐ 6.760.000/tháng (cao hơn tối thiểu vùng); KCN Vùng I tối thiểu 5.310.000
const plan = (s: Partial<PlanData['settings']> = {}, withMin = true): PlanData => ({
  settings: { ...DEFAULT_SETTINGS, ...s }, notes: '',
  minWage: withMin ? { monthly: 5_310_000, label: 'Vùng I' } : null,
  lines: [
    newLine({ name: 'Lương cơ bản', unit: 'month', value: 6_760_000, paidToWorker: true, isBaseWage: true, insurable: true, group: 'worker' }),
    newLine({ id: 'bh', name: 'BHXH, BHYT, BHTN (DN đóng 21,5%)', group: 'compliance', mode: 'percent', base: 'insurable', value: 21.5 }),
    newLine({ id: 'cd', name: 'Kinh phí Công đoàn (DN nộp 2%)', group: 'compliance', mode: 'percent', base: 'insurable', value: 2 }),
    newLine({ name: 'Phí dịch vụ', unit: 'day', value: 46_090, isServiceFee: true, group: 'service' }),
  ],
});
const bh = (d: PlanData, opts = {}) => computePlan(d, opts).lines.bh.monthly;

describe('Mức lương đóng BHXH', () => {
  it('phương án cũ (chưa chọn) giữ cách tính theo lương trả NLĐ — số đã báo không đổi', () => {
    expect(bh(plan())).toBeCloseTo(6_760_000 * 0.215, 4);
    expect(computePlan(plan()).insuranceBaseUsed).toBe('wage');
  });
  it('tối thiểu vùng: BHXH 21,5% và công đoàn 2% tính trên 5.310.000', () => {
    const r = computePlan(plan({ insuranceBase: 'region' }));
    expect(r.lines.bh.monthly).toBeCloseTo(5_310_000 * 0.215, 4);
    expect(r.lines.cd.monthly).toBeCloseTo(5_310_000 * 0.02, 4);
    expect(r.insuranceSalaryMonthly).toBeCloseTo(5_310_000, 4);
    expect(r.insuranceBaseUsed).toBe('region');
  });
  it('lấy tối thiểu vùng truyền vào (KCN đang chọn) trước ảnh chụp đã lưu', () => {
    expect(bh(plan({ insuranceBase: 'region' }), { minWageMonthly: 4_730_000, minWageLabel: 'Vùng II' })).toBeCloseTo(4_730_000 * 0.215, 4);
  });
  it('dự án cho đóng cao hơn: theo mức tự nhập; thấp hơn tối thiểu vùng thì báo lỗi', () => {
    expect(bh(plan({ insuranceBase: 'custom', insuranceSalary: 6_000_000 }))).toBeCloseTo(6_000_000 * 0.215, 4);
    const low = computePlan(plan({ insuranceBase: 'custom', insuranceSalary: 5_000_000 }));
    expect(low.warnings.some(w => w.level === 'error' && w.text.includes('thấp hơn lương tối thiểu Vùng I'))).toBe(true);
    expect(computePlan(plan({ insuranceBase: 'custom' })).insuranceBaseUsed).toBe('region');
  });
  it('chưa chọn KCN: tạm tính theo lương trả NLĐ, có nhắc', () => {
    const r = computePlan(plan({ insuranceBase: 'region' }, false));
    expect(r.insuranceBaseUsed).toBe('wage');
    expect(r.lines.bh.monthly).toBeCloseTo(6_760_000 * 0.215, 4);
    expect(r.warnings.some(w => w.text.includes('Chưa chọn KCN'))).toBe(true);
  });
  it('trần đóng BHXH (20 × lương cơ sở) vẫn áp dụng với mức tự nhập', () => {
    const d = plan({ insuranceBase: 'custom', insuranceSalary: 60_000_000 });
    d.lines = d.lines.map(l => (l.id === 'bh' ? { ...l, cap: INSURANCE_CAP_MONTHLY } : l));
    expect(computePlan(d).lines.bh.monthly).toBeCloseTo(INSURANCE_CAP_MONTHLY * 0.215, 4);
  });
});
