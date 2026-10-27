import { describe, expect, it } from 'vitest';
import { joinSocialLinks, parseSocialLinks, socialKind, socialLinkList } from './socialLinks';

describe('socialLinks', () => {
  it('phân loại theo tên miền', () => {
    expect(socialKind('https://www.facebook.com/abc')).toBe('facebook');
    expect(socialKind('fb.com/abc')).toBe('facebook');
    expect(socialKind('https://vn.linkedin.com/in/abc')).toBe('linkedin');
    expect(socialKind('https://example.com/facebook.com')).toBe('other');
    expect(socialKind('abc')).toBe('other');
  });

  it('đọc dữ liệu cũ 1 link và dữ liệu mới 2 link', () => {
    expect(parseSocialLinks('https://facebook.com/a')).toEqual({ facebook: 'https://facebook.com/a', linkedin: '', other: [] });
    expect(parseSocialLinks('https://linkedin.com/in/b https://facebook.com/a'))
      .toEqual({ facebook: 'https://facebook.com/a', linkedin: 'https://linkedin.com/in/b', other: [] });
    expect(parseSocialLinks(null)).toEqual({ facebook: '', linkedin: '', other: [] });
  });

  it('giữ link khác khi ghép lại', () => {
    const l = parseSocialLinks('https://zalo.me/x https://facebook.com/a');
    expect(joinSocialLinks({ ...l, linkedin: 'https://linkedin.com/in/b' })).toBe('https://facebook.com/a https://linkedin.com/in/b https://zalo.me/x');
    expect(joinSocialLinks({ facebook: '', linkedin: '', other: [] })).toBe('');
  });

  it('danh sách nút mở có https://', () => {
    expect(socialLinkList('facebook.com/a')).toEqual([{ kind: 'facebook', url: 'https://facebook.com/a' }]);
  });
});
