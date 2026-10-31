import { describe, it, expect } from 'vitest';
import { headcountGap, leaseLevel, leaseLimitDate, monthsWorked } from './workforce';

describe('Thời vụ — mốc 12 tháng', () => {
  it('số tháng tròn đã làm', () => {
    expect(monthsWorked('2025-10-31', '2026-10-31')).toBe(12);
    expect(monthsWorked('2025-11-01', '2026-10-31')).toBe(11);
    expect(monthsWorked('2026-10-15', '2026-10-31')).toBe(0);
    expect(monthsWorked(null, '2026-10-31')).toBe(0);
    expect(monthsWorked('2027-01-01', '2026-10-31')).toBe(0);
  });
  it('mức cảnh báo: từ tháng 10, quá hạn từ tháng 12', () => {
    expect(leaseLevel(9)).toBe('ok');
    expect(leaseLevel(10)).toBe('warn');
    expect(leaseLevel(12)).toBe('over');
  });
  it('ngày chạm mốc 12 tháng', () => {
    expect(leaseLimitDate('2026-01-15')).toBe('2027-01-15');
  });
  it('đối chiếu số tuần', () => {
    expect(headcountGap(48, 50)).toBe(-2);
    expect(headcountGap(48, null)).toBeNull();
  });
});
