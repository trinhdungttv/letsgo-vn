import { describe, expect, it } from 'vitest';
import { dropIndex, fmtDuration, fmtKm, moveItem, stopColor, stopLetter } from './measureRoute';

describe('moveItem', () => {
  it('dời xuống / lên / giữ nguyên', () => {
    expect(moveItem(['A', 'B', 'C', 'D'], 0, 2)).toEqual(['B', 'C', 'A', 'D']);
    expect(moveItem(['A', 'B', 'C', 'D'], 3, 0)).toEqual(['D', 'A', 'B', 'C']);
    expect(moveItem(['A', 'B', 'C'], 1, 1)).toEqual(['A', 'B', 'C']);
  });
  it('chỉ số ngoài khoảng → không hỏng mảng', () => {
    expect(moveItem(['A', 'B'], 5, 0)).toEqual(['A', 'B']);
    expect(moveItem(['A', 'B', 'C'], 0, 99)).toEqual(['B', 'C', 'A']);
  });
  it('không sửa mảng gốc', () => {
    const a = ['A', 'B', 'C'];
    moveItem(a, 0, 2);
    expect(a).toEqual(['A', 'B', 'C']);
  });
});

describe('dropIndex', () => {
  // 3 dòng còn lại cao 40px, giữa ở y = 20, 60, 100
  const mids = [20, 60, 100];
  it('ngón tay trên cùng → đầu danh sách', () => expect(dropIndex(mids, 5)).toBe(0));
  it('giữa 2 dòng', () => expect(dropIndex(mids, 70)).toBe(2));
  it('dưới cùng → cuối danh sách', () => expect(dropIndex(mids, 500)).toBe(3));
});

describe('định dạng', () => {
  it('thời gian', () => {
    expect(fmtDuration(20)).toBe('1 phút');
    expect(fmtDuration(25 * 60)).toBe('25 phút');
    expect(fmtDuration(65 * 60)).toBe('1 giờ 5 phút');
    expect(fmtDuration(120 * 60)).toBe('2 giờ');
  });
  it('km', () => {
    expect(fmtKm(3.456)).toBe('3.5');
    expect(fmtKm(42.4)).toBe('42');
  });
  it('chữ cái + màu', () => {
    expect([0, 1, 2].map(stopLetter)).toEqual(['A', 'B', 'C']);
    expect(stopColor(0, 3)).toBe('#16A34A');
    expect(stopColor(1, 3)).toBe('#2563EB');
    expect(stopColor(2, 3)).toBe('#DC2626');
  });
});
