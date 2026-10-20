import { describe, it, expect } from 'vitest';
import { addDaysIso, convertLunar2Solar, convertSolar2Lunar, diffDays, nextOccurrenceIso } from './lunar';

const iso = (s: { day: number; month: number; year: number } | null) =>
  s ? `${s.year}-${String(s.month).padStart(2, '0')}-${String(s.day).padStart(2, '0')}` : null;

describe('âm lịch — đối chiếu mốc có thật', () => {
  it('Tết Nguyên Đán', () => {
    expect(iso(convertLunar2Solar(1, 1, 2025, false))).toBe('2025-01-29');
    expect(iso(convertLunar2Solar(1, 1, 2026, false))).toBe('2026-02-17');
    expect(iso(convertLunar2Solar(1, 1, 2027, false))).toBe('2027-02-06');
  });

  it('Giỗ Tổ Hùng Vương 10/3 âm và Trung thu 15/8 âm', () => {
    expect(iso(convertLunar2Solar(10, 3, 2025, false))).toBe('2025-04-07');
    expect(iso(convertLunar2Solar(10, 3, 2026, false))).toBe('2026-04-26');
    expect(iso(convertLunar2Solar(15, 8, 2025, false))).toBe('2025-10-06');
  });

  it('tháng nhuận: 2025 nhuận tháng 6, 2023 nhuận tháng 2', () => {
    expect(convertSolar2Lunar(25, 7, 2025)).toEqual({ day: 1, month: 6, year: 2025, isLeapMonth: true });
    expect(convertSolar2Lunar(24, 7, 2025)).toEqual({ day: 30, month: 6, year: 2025, isLeapMonth: false });
    expect(convertSolar2Lunar(22, 3, 2023)).toEqual({ day: 1, month: 2, year: 2023, isLeapMonth: true });
    expect(iso(convertLunar2Solar(1, 6, 2025, true))).toBe('2025-07-25');
    // Năm đó không có tháng 5 nhuận → null
    expect(convertLunar2Solar(1, 5, 2025, true)).toBeNull();
  });

  it('đổi qua lại dương → âm → dương khớp', () => {
    for (const d of ['2026-01-01', '2026-06-15', '2026-10-19', '2027-02-05', '2028-02-29']) {
      const [y, m, dd] = d.split('-').map(Number);
      const l = convertSolar2Lunar(dd, m, y);
      expect(iso(convertLunar2Solar(l.day, l.month, l.year, l.isLeapMonth))).toBe(d);
    }
  });
});

describe('lần xảy ra kế tiếp', () => {
  it('âm lịch: giỗ 10/3 đã qua năm nay → sang năm', () => {
    expect(nextOccurrenceIso(10, 3, true, '2026-04-26')).toBe('2026-04-26'); // đúng ngày vẫn tính
    expect(nextOccurrenceIso(10, 3, true, '2026-04-27')).toBe('2027-04-16');
  });

  it('âm lịch: ngày 30 tháng thiếu → lùi về ngày cuối tháng (giỗ sớm, không dời sang tháng sau)', () => {
    // Tháng Chạp năm Bính Ngọ chỉ có 29 ngày → 30/12 âm rơi vào 29/12 âm = 05/02/2027
    expect(nextOccurrenceIso(30, 12, true, '2026-10-19')).toBe('2027-02-05');
  });

  it('dương lịch: 29/02 năm thường → 28/02, năm nhuận giữ 29/02', () => {
    expect(nextOccurrenceIso(29, 2, false, '2026-10-19')).toBe('2027-02-28');
    expect(nextOccurrenceIso(29, 2, false, '2027-03-01')).toBe('2028-02-29');
  });

  it('dương lịch: hôm nay vẫn là "lần kế tiếp"', () => {
    expect(nextOccurrenceIso(19, 10, false, '2026-10-19')).toBe('2026-10-19');
    expect(nextOccurrenceIso(18, 10, false, '2026-10-19')).toBe('2027-10-18');
  });
});

describe('cộng trừ ngày', () => {
  it('diffDays qua tháng/năm', () => {
    expect(diffDays('2026-12-31', '2027-01-02')).toBe(2);
    expect(diffDays('2026-10-19', '2026-10-12')).toBe(-7);
  });

  it('addDaysIso qua tháng, năm, năm nhuận', () => {
    expect(addDaysIso('2026-10-10', 1)).toBe('2026-10-11');
    expect(addDaysIso('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysIso('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDaysIso('2027-03-01', -1)).toBe('2027-02-28');
  });
});
