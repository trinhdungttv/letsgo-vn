import { describe, expect, it } from 'vitest';
import { cleanPin, isPin, lockFailText, waitText } from './lock';

describe('mã khoá 4 số', () => {
  it('chỉ giữ chữ số, tối đa 4', () => {
    expect(cleanPin('12 34')).toBe('1234');
    expect(cleanPin('a1b2c3d4e5')).toBe('1234');
    expect(cleanPin('')).toBe('');
  });

  it('isPin chỉ nhận đúng 4 chữ số', () => {
    expect(isPin('0000')).toBe(true);
    expect(isPin('123')).toBe(false);
    expect(isPin('12345')).toBe(false);
    expect(isPin('12a4')).toBe(false);
  });
});

describe('câu báo khi bị từ chối', () => {
  it('thời gian chờ dễ đọc', () => {
    expect(waitText(45)).toBe('45 giây');
    expect(waitText(900)).toBe('15 phút');
    expect(waitText(61)).toBe('2 phút');
    expect(waitText(3600)).toBe('1 giờ');
    expect(waitText(5400)).toBe('1 giờ 30 phút');
  });

  it('sai mã / mật khẩu kèm số lần thử còn lại', () => {
    expect(lockFailText({ reason: 'wrong_pin', remaining: 3 })).toBe('Sai mã — còn 3 lần thử');
    expect(lockFailText({ reason: 'wrong_password', remaining: 1 })).toBe('Sai mật khẩu đăng nhập — còn 1 lần thử');
    expect(lockFailText({ reason: 'locked', seconds: 1800 })).toBe('Nhập sai quá 5 lần — thử lại sau 30 phút');
    expect(lockFailText({ reason: 'note_locked' })).toContain('đang khoá chống xoá');
  });
});
