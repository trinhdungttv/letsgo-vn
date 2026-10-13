import { describe, it, expect } from 'vitest';
import { minWageTimelineNotes, planMinWage, withCurrentRows } from './minWageAt';
import type { MinWageBatch } from '../minWage';

// Số liệu GIẢ ĐỊNH để kiểm tra logic theo thời gian (không phải số nghị định)
const b = (date: string, i: number, decree = `Mốc ${date}`): MinWageBatch => ({
  effectiveFrom: date, decree, wages: { I: { monthly: i, hourly: null }, II: { monthly: i - 500_000, hourly: null }, III: null, IV: null },
});
const DB = [b('2026-01-01', 5_310_000), b('2027-01-01', 5_600_000)];

describe('Lương tối thiểu theo ngày ban hành báo giá', () => {
  it('lấy đúng mốc đang hiệu lực tại ngày ban hành', () => {
    expect(planMinWage('I', '2025-12-20', DB)?.monthly).toBe(4_960_000);        // seed NĐ 74/2024
    expect(planMinWage('I', '2026-10-13', DB)).toMatchObject({ monthly: 5_310_000, label: 'Vùng I', effectiveFrom: '2026-01-01' });
    expect(planMinWage('I', '2027-01-01', DB)?.monthly).toBe(5_600_000);
    expect(planMinWage(null, '2026-10-13', DB)).toBeNull();
  });
  it('báo giá còn hiệu lực qua mốc tăng lương → cảnh báo tính lại', () => {
    const n = minWageTimelineNotes('I', '2026-12-15', '2027-01-15', DB, '2026-12-15');
    expect(n.some(x => x.level === 'warn' && x.text.includes('từ 01/01/2027') && x.text.includes('5.600.000'))).toBe(true);
    expect(minWageTimelineNotes('I', '2026-10-13', '2026-11-13', DB, '2026-10-13')).toEqual([]);
  });
  it('báo giá ban hành trước mốc mới → nhắc đang dùng mức cũ hơn hôm nay', () => {
    const n = minWageTimelineNotes('I', '2025-12-20', '2026-01-10', DB, '2026-10-13');
    expect(n.some(x => x.level === 'info' && x.text.includes('4.960.000') && x.text.includes('5.310.000'))).toBe(true);
    expect(n.some(x => x.level === 'warn' && x.text.includes('từ 01/01/2026'))).toBe(true);
  });
  it('bảng lương vùng lâu chưa cập nhật → nhắc lỗi thời', () => {
    expect(minWageTimelineNotes('I', '2028-06-01', '', DB, '2028-06-01').some(x => x.text.includes('lỗi thời'))).toBe(true);
  });
  it('gộp mức hiện hành của bảng lương vùng khi chưa có mốc tương ứng', () => {
    const rows = { I: { amount: 5_310_000, effectiveDate: '2026-01-01' }, II: { amount: 4_730_000, effectiveDate: '2026-01-01' } };
    const merged = withCurrentRows([], rows);
    expect(planMinWage('I', '2026-10-13', merged)?.monthly).toBe(5_310_000);
    expect(withCurrentRows(DB, rows)).toBe(DB);   // đã có mốc 01/01/2026 → giữ nguyên
  });
});
