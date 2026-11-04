import { describe, expect, it } from 'vitest';
import {
  birthdayAge, birthdayDraftError, birthdayForSave, birthdayOfDraft, birthdayValue, draftOfBirthday,
  formatBirthday, hasBirthYear, NO_YEAR, parseBirthday,
} from './birthday';

describe('ngày sinh không có năm', () => {
  it('đọc DB: có năm / năm giữ chỗ 1604 / năm lạ / rỗng', () => {
    expect(parseBirthday('1985-03-15')).toEqual({ day: 15, month: 3, year: 1985 });
    expect(parseBirthday('1604-03-15')).toEqual({ day: 15, month: 3, year: null });
    expect(parseBirthday('1604-02-29')).toEqual({ day: 29, month: 2, year: null }); // 1604 nhuận
    expect(parseBirthday('0198-07-01')).toEqual({ day: 1, month: 7, year: null });
    expect(parseBirthday('')).toBeNull();
    expect(parseBirthday(null)).toBeNull();
    expect(parseBirthday('~5//')).toBeNull();
    expect(hasBirthYear('1985-03-15')).toBe(true);
    expect(hasBirthYear('1604-03-15')).toBe(false);
  });

  it('ghi DB: không rõ năm → 1604', () => {
    expect(NO_YEAR).toBe(1604);
    expect(birthdayValue({ day: 5, month: 9, year: null })).toBe('1604-09-05');
    expect(birthdayValue({ day: 5, month: 9, year: 1990 })).toBe('1990-09-05');
  });

  it('hiển thị + tuổi: không năm thì không tuổi', () => {
    expect(formatBirthday('1985-03-15')).toBe('15/03/1985');
    expect(formatBirthday('1604-03-15')).toBe('15/03');
    expect(formatBirthday(null)).toBe('');
    expect(birthdayAge('1985-03-15', '2026-03-14')).toBe(40);
    expect(birthdayAge('1985-03-15', '2026-03-15')).toBe(41);
    expect(birthdayAge('1604-03-15', '2026-03-15')).toBeNull();
  });
});

describe('ô nhập Ngày / Tháng / Năm', () => {
  it('đủ ngày + tháng là lưu được, năm để trống', () => {
    expect(birthdayOfDraft({ day: 15, month: 3, yearText: '' }, 2026)).toBe('1604-03-15');
    expect(birthdayOfDraft({ day: 15, month: 3, yearText: '1985' }, 2026)).toBe('1985-03-15');
    expect(birthdayOfDraft({ day: null, month: null, yearText: '' }, 2026)).toBe('');
  });

  it('gõ dở → bản nháp, lưu thì báo lỗi (không xoá nhầm ngày sinh)', () => {
    const half = birthdayOfDraft({ day: 15, month: null, yearText: '' }, 2026);
    expect(half).toBe('~15//');
    expect(draftOfBirthday(half)).toEqual({ day: 15, month: null, yearText: '' });
    expect(() => birthdayForSave(half, 2026)).toThrow(/đủ ngày và tháng/);
    const year2 = birthdayOfDraft({ day: 1, month: 2, yearText: '19' }, 2026);
    expect(draftOfBirthday(year2)).toEqual({ day: 1, month: 2, yearText: '19' });
    expect(() => birthdayForSave(year2, 2026)).toThrow(/4 số/);
  });

  it('kiểm ngày có thật, năm hợp lệ', () => {
    expect(birthdayDraftError({ day: 31, month: 4, yearText: '' }, 2026)).toMatch(/31\/4/);
    expect(birthdayDraftError({ day: 29, month: 2, yearText: '' }, 2026)).toBeNull();
    expect(birthdayDraftError({ day: 29, month: 2, yearText: '1990' }, 2026)).toMatch(/1990 không có ngày 29\/2/);
    expect(birthdayDraftError({ day: 1, month: 1, yearText: '2030' }, 2026)).toMatch(/không hợp lệ/);
    expect(birthdayDraftError({ day: 1, month: 1, yearText: '1850' }, 2026)).toMatch(/không hợp lệ/);
  });

  it('đọc lại giá trị DB vào ô nhập: năm giữ chỗ thành ô năm trống', () => {
    expect(draftOfBirthday('1604-03-15')).toEqual({ day: 15, month: 3, yearText: '' });
    expect(draftOfBirthday('1985-03-15')).toEqual({ day: 15, month: 3, yearText: '1985' });
    expect(draftOfBirthday('')).toEqual({ day: null, month: null, yearText: '' });
  });

  it('giá trị đang có trong DB lưu lại y nguyên', () => {
    expect(birthdayForSave('1985-03-15', 2026)).toBe('1985-03-15');
    expect(birthdayForSave('1604-03-15', 2026)).toBe('1604-03-15');
    expect(birthdayForSave('', 2026)).toBeNull();
    expect(() => birthdayForSave('abc', 2026)).toThrow(/không hợp lệ/);
  });
});
