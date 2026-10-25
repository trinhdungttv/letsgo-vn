// Port từ PRM Tony Study (src/lib/prm/remember.test.mjs) — phần gia đình có cấu trúc.
import { describe, expect, it } from 'vitest';
import {
  cleanFamily, cleanRememberNotes, familySummary, familyYearError, hasRememberNotes, rememberDisplayRows,
} from './remember';
import type { FamilyMember, RememberNotes } from './types';

describe('Điều cần nhớ — gia đình', () => {
  it('vợ/chồng + con có năm sinh, bỏ dòng trống, năm sai → không lưu năm, bỏ vai lạ', () => {
    const members = cleanFamily([
      { role: 'spouse', name: '  Trần   Thị Lan ', year: 1990 },
      { role: 'child', name: 'Gạo', year: 2019 },
      { role: 'child', name: '', year: null },
      { role: 'child', name: 'Bin', year: 3000 },
      { role: 'boss', name: 'x', year: 1980 },
    ], 2026);
    expect(members).toEqual([
      { role: 'spouse', name: 'Trần Thị Lan', year: 1990 },
      { role: 'child', name: 'Gạo', year: 2019 },
      { role: 'child', name: 'Bin', year: null },
    ]);
    // cleanRememberNotes phải GIỮ khoá members (trước đây hàm làm sạch bỏ khoá lạ)
    expect(cleanRememberNotes({ family: 'Có 2 bé gái', members }, 2026).members).toEqual(members);
    expect(hasRememberNotes({ members: [{ role: 'child', name: 'Gạo', year: null }] })).toBe(true);
  });

  it('dữ liệu hỏng → bỏ qua', () => {
    expect(cleanFamily('abc', 2026)).toEqual([]);
    expect(cleanFamily([null, 1, { role: 'child', name: 5, year: '2019' }], 2026)).toEqual([]);
    expect(cleanRememberNotes({ members: 'x' } as unknown as RememberNotes, 2026)).toEqual({});
  });

  it('năm sinh gõ tay', () => {
    expect(familyYearError('', 2026)).toBeNull();
    expect(familyYearError('2019', 2026)).toBeNull();
    expect(familyYearError('19', 2026)).toMatch(/4 chữ số/);
    expect(familyYearError('2030', 2026)).toMatch(/không hợp lệ/);
  });

  it('tóm tắt gia đình hiện trước khi liên hệ', () => {
    const members: FamilyMember[] = [
      { role: 'spouse', name: 'Lan', year: 1990 },
      { role: 'child', name: 'Na', year: 2026 },
      { role: 'child', name: 'Gạo', year: 2019 },
    ];
    expect(familySummary(members, 2026)).toBe('Vợ/chồng: Lan (1990, 36 tuổi) · Con: Na (2026, mới sinh), Gạo (2019, 7 tuổi)');
    expect(rememberDisplayRows({ family: 'Bé út tên Gạo', members, likes: 'Cà phê' }, 2026)).toEqual([
      { key: 'family', value: 'Vợ/chồng: Lan (1990, 36 tuổi) · Con: Na (2026, mới sinh), Gạo (2019, 7 tuổi) · Bé út tên Gạo' },
      { key: 'likes', value: 'Cà phê' },
    ]);
  });
});
