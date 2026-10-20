// Port từ PRM Tony Study (src/lib/prm/search.test.mjs + remember.test.mjs).
import { describe, it, expect } from 'vitest';
import { normalizeSearch, contactSearchHaystack, matchesQuery } from './search';
import { cleanRememberNotes, hasRememberNotes, REMEMBER_MAX_CHARS } from './remember';
import type { RememberNotes } from './types';

const c = {
  fullName: 'Nguyễn Đức Hiếu', nickname: 'Anh Hiếu', organization: 'Công ty Điện Máy Midea', jobTitle: 'Giám đốc nhân sự',
  phones: ['+84 90 123 4567', '(028) 3822.1234'], emails: ['hieu.nguyen@Midea.com'],
};

describe('tìm không dấu', () => {
  it('bỏ dấu tiếng Việt, đ → d, chữ thường', () => {
    expect(normalizeSearch('  Nguyễn  ĐỨC Hiếu ')).toBe('nguyen duc hieu');
    expect(normalizeSearch('Đặng Thị Hồng')).toBe('dang thi hong');
  });

  it('gõ không dấu vẫn ra tên có dấu, mọi từ phải có mặt, thứ tự không quan trọng', () => {
    const h = contactSearchHaystack(c);
    expect(matchesQuery(h, 'nguyen')).toBe(true);
    expect(matchesQuery(h, 'duc hieu')).toBe(true);
    expect(matchesQuery(h, 'hieu duc')).toBe(true);
    expect(matchesQuery(h, 'hieu tuan')).toBe(false);
    expect(matchesQuery(h, 'MIDEA')).toBe(true);
    expect(matchesQuery(h, 'giam doc')).toBe(true);
    expect(matchesQuery(h, 'hieu.nguyen@midea')).toBe(true);
  });

  it('tìm theo số điện thoại bất kể cách gõ', () => {
    const h = contactSearchHaystack(c);
    expect(matchesQuery(h, '0901234567')).toBe(true); // lưu +84… vẫn ra khi gõ 0…
    expect(matchesQuery(h, '84901234567')).toBe(true);
    expect(matchesQuery(h, '901 234')).toBe(true);
    expect(matchesQuery(h, '028 3822')).toBe(true);
  });

  it('LetsGo: tìm thêm theo chi nhánh / người phụ trách truyền vào', () => {
    const h = contactSearchHaystack(c, ['Chi nhánh Bình Dương']);
    expect(matchesQuery(h, 'binh duong')).toBe(true);
  });

  it('truy vấn rỗng khớp tất cả', () => {
    expect(matchesQuery(contactSearchHaystack(c), '   ')).toBe(true);
  });
});

describe('Điều cần nhớ', () => {
  it('làm sạch: cắt khoảng trắng, bỏ mục rỗng, bỏ khoá lạ', () => {
    const raw = { family: '  Vợ tên Hoa  ', likes: '', avoid: '   ', work: 'Dự án nhà xưởng', hack: 'x' } as RememberNotes;
    expect(cleanRememberNotes(raw)).toEqual({ family: 'Vợ tên Hoa', work: 'Dự án nhà xưởng' });
  });

  it('cắt độ dài mỗi mục', () => {
    expect(cleanRememberNotes({ other: 'a'.repeat(REMEMBER_MAX_CHARS + 50) }).other).toHaveLength(REMEMBER_MAX_CHARS);
  });

  it('null / undefined / giá trị không phải chuỗi → object rỗng', () => {
    expect(cleanRememberNotes(null)).toEqual({});
    expect(cleanRememberNotes(undefined)).toEqual({});
    expect(cleanRememberNotes({ family: 123 } as unknown as RememberNotes)).toEqual({});
  });

  it('hasRememberNotes', () => {
    expect(hasRememberNotes({})).toBe(false);
    expect(hasRememberNotes({ likes: '  ' })).toBe(false);
    expect(hasRememberNotes({ likes: 'cà phê' })).toBe(true);
  });
});
