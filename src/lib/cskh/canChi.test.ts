// Port từ PRM Tony Study (src/lib/prm/canChi.test.mjs).
import { describe, expect, it } from 'vitest';
import { compatibility, elementRelations, lunarYearOf, yearSign } from './canChi';

describe('tuổi âm lịch', () => {
  it('can chi + mệnh nạp âm', () => {
    const s = yearSign(1993);
    expect({ name: s.name, napAm: s.napAm, element: s.element }).toEqual({ name: 'Quý Dậu', napAm: 'Kiếm Phong Kim', element: 'Kim' });
    expect(yearSign(2000).name).toBe('Canh Thìn');
    expect(yearSign(2000).napAm).toBe('Bạch Lạp Kim');
    expect(yearSign(1984).name).toBe('Giáp Tý');
    expect(yearSign(1984).napAm).toBe('Hải Trung Kim');
    expect(yearSign(1990).name).toBe('Canh Ngọ');
    expect(yearSign(1990).napAm).toBe('Lộ Bàng Thổ');
    expect(yearSign(2026).name).toBe('Bính Ngọ');
    expect(yearSign(2026).napAm).toBe('Thiên Hà Thủy');
    expect(yearSign(1983).napAm).toBe('Đại Hải Thủy');
  });

  it('sinh trước Tết thuộc năm âm trước; ngày âm lịch giữ nguyên năm', () => {
    expect(lunarYearOf(20, 1, 1993, false)).toBe(1992); // Tết Quý Dậu là 23/1/1993
    expect(lunarYearOf(1, 3, 1993, false)).toBe(1993);
    expect(lunarYearOf(20, 12, 1992, true)).toBe(1992);
  });

  it('ngũ hành: tương sinh là hợp, tương khắc là kỵ', () => {
    expect(elementRelations('Kim')).toEqual({ good: ['Thổ', 'Thủy'], bad: ['Hỏa', 'Mộc'] });
    expect(elementRelations('Thủy')).toEqual({ good: ['Kim', 'Mộc'], bad: ['Thổ', 'Hỏa'] });
  });

  it('hợp/kỵ tuổi Quý Dậu: tam hợp Tỵ Sửu, lục hợp Thìn; xung Mão, hại Tuất, tứ hành xung Tý Ngọ', () => {
    const c = compatibility(yearSign(1993));
    expect(c.goodChi).toEqual(['Tỵ', 'Sửu', 'Thìn']);
    expect(c.badChi).toEqual(['Mão', 'Tuất', 'Tý', 'Ngọ']);
    expect(c.goodElements).toEqual(['Thổ', 'Thủy']);
    expect(c.goodYears.length).toBeGreaterThan(0);
    for (const y of c.goodYears) {
      expect(['Tỵ', 'Sửu', 'Thìn']).toContain(y.chi);
      expect(['Kim', 'Thổ', 'Thủy']).toContain(y.element);
      expect(Math.abs(y.lunarYear - 1993)).toBeLessThanOrEqual(8);
    }
    const years = c.goodYears.map(y => y.lunarYear);
    expect(years).toEqual([...years].sort((a, b) => a - b));
  });
});
