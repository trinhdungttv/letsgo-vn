import { describe, expect, it } from 'vitest';
import { composeMilestoneDate, fmtMilestoneDate, milestoneStart, splitMilestoneDate } from './brief';

describe('ngày của mốc', () => {
  it('ghép: chỉ năm / tháng+năm / đủ ngày; giá trị sai bỏ phần sai', () => {
    expect(composeMilestoneDate('', '', '2014')).toBe('2014');
    expect(composeMilestoneDate('', '5', '2014')).toBe('2014-05');
    expect(composeMilestoneDate('9', '5', '2014')).toBe('2014-05-09');
    expect(composeMilestoneDate('31', '2', '2014')).toBe('2014-02'); // 31/2 không có
    expect(composeMilestoneDate('9', '', '2014')).toBe('2014'); // có ngày mà không tháng → bỏ ngày
    expect(composeMilestoneDate('9', '5', '14')).toBe('');
  });
  it('hiển thị đủ ngày tháng năm theo độ chính xác', () => {
    expect(fmtMilestoneDate('2014')).toBe('2014');
    expect(fmtMilestoneDate('2014-05')).toBe('Tháng 5/2014');
    expect(fmtMilestoneDate('2014-05-09')).toBe('09/05/2014');
    expect(fmtMilestoneDate('')).toBe('Chưa rõ ngày');
  });
  it('xếp thứ tự và tách ngược', () => {
    expect(milestoneStart('2014')).toBe('2014-01-01');
    expect(milestoneStart('2014-05')).toBe('2014-05-01');
    expect(splitMilestoneDate('2014-05-09')).toEqual({ day: '9', month: '5', year: '2014' });
    expect(splitMilestoneDate('2014')).toEqual({ day: '', month: '', year: '2014' });
  });
});
