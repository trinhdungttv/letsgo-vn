import { describe, expect, it, vi } from 'vitest';

vi.mock('./supabase', () => ({ supabase: {} }));
vi.mock('./audit', () => ({ logActivity: vi.fn() }));

import { clientStarOf, contactStarOf, isStarFilter, matchesStarFilter, starFilterLabel } from './clientStars';

describe('clientStarOf', () => {
  it('đọc 1–3, còn lại coi là chưa xếp sao', () => {
    expect(clientStarOf({ star_rating: 3 })).toBe(3);
    expect(clientStarOf({ star_rating: 1 })).toBe(1);
    expect(clientStarOf({ star_rating: null })).toBeNull();
    expect(clientStarOf({})).toBeNull(); // chưa chạy migration 198
    expect(clientStarOf({ star_rating: 0 })).toBeNull();
    expect(clientStarOf({ star_rating: 5 })).toBeNull();
    expect(clientStarOf(null)).toBeNull();
  });
});

describe('contactStarOf — sao người liên hệ = sao cao nhất trong các công ty họ gắn', () => {
  const byId = new Map([
    ['a', { star_rating: 1 }],
    ['b', { star_rating: 3 }],
    ['c', { star_rating: null }],
  ]);
  it('lấy mức cao nhất', () => {
    expect(contactStarOf(['a', 'b'], byId)).toBe(3);
    expect(contactStarOf(['a', 'c'], byId)).toBe(1);
  });
  it('không gắn công ty / công ty chưa xếp / công ty không có trong danh sách → null', () => {
    expect(contactStarOf([], byId)).toBeNull();
    expect(contactStarOf(['c'], byId)).toBeNull();
    expect(contactStarOf(['zzz'], byId)).toBeNull();
  });
});

describe('bộ lọc sao', () => {
  it('khớp đúng mức', () => {
    expect(matchesStarFilter(3, 'all')).toBe(true);
    expect(matchesStarFilter(null, 'all')).toBe(true);
    expect(matchesStarFilter(3, '3')).toBe(true);
    expect(matchesStarFilter(2, '3')).toBe(false);
    expect(matchesStarFilter(null, '1')).toBe(false);
    expect(matchesStarFilter(null, 'none')).toBe(true);
    expect(matchesStarFilter(1, 'none')).toBe(false);
  });
  it('giá trị lưu từ bản cũ / lạ không hợp lệ', () => {
    expect(isStarFilter('2')).toBe(true);
    expect(isStarFilter('none')).toBe(true);
    expect(isStarFilter(undefined)).toBe(false);
    expect(isStarFilter('4')).toBe(false);
    expect(isStarFilter(3)).toBe(false);
  });
  it('nhãn tiếng Việt', () => {
    expect(starFilterLabel('3')).toBe('★★★ Quan trọng');
    expect(starFilterLabel('2')).toBe('★★ Bình thường');
    expect(starFilterLabel('1')).toBe('★ Dự án nhỏ');
    expect(starFilterLabel('none')).toBe('Chưa xếp sao');
  });
});
