import { describe, it, expect } from 'vitest';
import { latestLaborEntry, laborEntryWeekKey, sortLaborHistory, recentLaborCounts } from './format';

const e = (week_label: string, count: number, created_at: string) => ({ week_label, count, created_at });
const NOW = new Date(2026, 10, 2, 9); // Thứ 2, 02/11/2026 → tuần T11W1

describe('số lao động hiện tại = tuần muộn nhất đã nhập', () => {
  it('nhập bù tuần cũ SAU KHI đã có tuần mới hơn → vẫn lấy tuần mới hơn', () => {
    // Ca thật WEIDA: T9W3 = 65 nhập 16/9, sau đó 21/9 mới nhập bù T8W2 = 67.
    const hist = [e('T9W3', 65, '2026-09-16T03:00:00Z'), e('T8W2', 67, '2026-09-21T03:00:00Z')];
    expect(latestLaborEntry(hist, NOW)?.count).toBe(65);
  });
  it('cùng tuần nhập 2 lần → lấy bản nhập sau', () => {
    const hist = [e('T10W5', 100, '2026-10-27T03:00:00Z'), e('T10W5', 120, '2026-10-28T03:00:00Z')];
    expect(latestLaborEntry(hist, NOW)?.count).toBe(120);
  });
  it('qua năm mới: T1 năm sau mới hơn T12 năm trước', () => {
    const hist = [e('T1W1', 40, '2027-01-06T03:00:00Z'), e('T12W4', 50, '2027-01-07T03:00:00Z')];
    expect(latestLaborEntry(hist, new Date(2027, 0, 10))?.count).toBe(40);
  });
  it('số nhập trước cho tuần tương lai không thay số tuần này; chỉ có tương lai thì lấy tuần gần nhất', () => {
    expect(latestLaborEntry([e('T11W1', 30, '2026-11-01T03:00:00Z'), e('T11W3', 35, '2026-11-01T04:00:00Z')], NOW)?.count).toBe(30);
    expect(latestLaborEntry([e('T11W3', 35, '2026-11-01T04:00:00Z'), e('T11W2', 33, '2026-11-01T05:00:00Z')], NOW)?.count).toBe(33);
  });
  it('không có bản ghi → null; nhãn lạ → giữ cách cũ (bản nhập sau cùng)', () => {
    expect(latestLaborEntry([], NOW)).toBeNull();
    expect(latestLaborEntry([e('cũ', 5, '2026-01-01T00:00:00Z'), e('lạ', 7, '2026-02-01T00:00:00Z')], NOW)?.count).toBe(7);
    expect(laborEntryWeekKey({ week_label: 'T13W1', created_at: '2026-01-01T00:00:00Z' })).toBeNull();
  });
});

describe('thứ tự tuần thật (không so chữ nhãn)', () => {
  const hist = [
    e('T10W1', 90, '2026-10-01T03:00:00Z'),
    e('T9W4', 100, '2026-09-25T03:00:00Z'),
    e('T7W1', 120, '2026-07-01T03:00:00Z'),
    e('T10W3', 80, '2026-10-15T03:00:00Z'),
    e('T8W2', 110, '2026-08-10T03:00:00Z'),
    e('T9W1', 105, '2026-09-02T03:00:00Z'),
    e('T10W3', 85, '2026-10-16T03:00:00Z'),
    e('T11W3', 70, '2026-11-01T03:00:00Z'), // nhập trước cho tuần tương lai
  ];
  it('sortLaborHistory: T9 trước T10, sang năm mới vẫn đúng', () => {
    expect(sortLaborHistory(hist).map(h => h.week_label)).toEqual(['T7W1', 'T8W2', 'T9W1', 'T9W4', 'T10W1', 'T10W3', 'T10W3', 'T11W3']);
    const ny = [e('T1W1', 1, '2027-01-05T00:00:00Z'), e('T12W4', 2, '2026-12-24T00:00:00Z')];
    expect(sortLaborHistory(ny).map(h => h.week_label)).toEqual(['T12W4', 'T1W1']);
  });
  it('recentLaborCounts: 6 tuần gần nhất, mỗi tuần 1 số, bỏ tuần tương lai', () => {
    expect(recentLaborCounts(hist, 6, NOW)).toEqual([120, 110, 105, 100, 90, 85]);
    expect(recentLaborCounts(hist, 3, NOW)).toEqual([100, 90, 85]);
    expect(recentLaborCounts([], 6, NOW)).toEqual([]);
  });
});
