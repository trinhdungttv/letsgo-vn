import { describe, expect, it } from 'vitest';
import { hasPosition, joinPositions, planPositionChange, positionUsage, replacePosition, togglePosition, type UsagePhoto } from './positions';
import { matchesNeeds, needsText, sanitizeNeeds, toggleNeed } from './needs';

const ph = (id: string, company_name: string, positions: string, zone_name = 'KCN A'): UsagePhoto => ({ id, company_name, positions, zone_name, thumb_url: null, url: '' });

describe('chuỗi ngành nghề', () => {
  it('bỏ trùng không phân biệt dấu / hoa thường, giữ cách viết đầu', () => {
    expect(joinPositions(['Thợ hàn', 'tho han', ' Bảo vệ ', '', 'THỢ HÀN'])).toBe('Thợ hàn, Bảo vệ');
  });
  it('bật / tắt 1 ngành', () => {
    expect(togglePosition('Thợ hàn, Bảo vệ', 'bao ve')).toBe('Thợ hàn');
    expect(togglePosition('Thợ hàn', 'Bảo vệ')).toBe('Thợ hàn, Bảo vệ');
    expect(hasPosition('Thợ hàn; Bảo vệ', 'BẢO VỆ')).toBe(true);
  });
  it('đổi tên giữ thứ tự, gộp khi trùng, bỏ khi null', () => {
    expect(replacePosition('Bảo vệ, Nhựa / bao bì, Thợ hàn', 'nhựa / bao bì', 'Bao bì carton')).toBe('Bảo vệ, Bao bì carton, Thợ hàn');
    expect(replacePosition('Thợ may, Công nhân may', 'Thợ may', 'Công nhân may')).toBe('Công nhân may');
    expect(replacePosition('Thợ may, Bảo vệ', 'Thợ may', null)).toBe('Bảo vệ');
    expect(replacePosition('Bảo vệ', 'Thợ may', 'X')).toBe('Bảo vệ');
  });
});

describe('ngành theo công ty', () => {
  const photos = [
    ph('1', 'Việt Hưng', 'Nhựa / bao bì, Công nhân sản xuất'),
    ph('2', 'việt hưng', 'nhựa / bao bì'),
    ph('3', 'Changshin', 'Giày da, Nhựa / bao bì', 'KCN B'),
    ph('4', '', 'Nhựa / bao bì'),
  ];
  const usage = positionUsage(photos);
  it('gom ảnh theo công ty (tên bỏ dấu), ảnh chưa rõ công ty gom chung', () => {
    const u = usage.get('nhua / bao bi')!;
    expect(u.name).toBe('Nhựa / bao bì');
    expect(u.photoCount).toBe(4);
    expect(u.companies.map(c => [c.name || '?', c.photos.length])).toEqual([['Việt Hưng', 2], ['?', 1], ['Changshin', 1]]);
  });
  it('mỗi công ty chọn lại ngành riêng, còn lại theo mặc định', () => {
    const u = usage.get('nhua / bao bi')!;
    const plan = planPositionChange(u, new Map([['changshin', 'Giày da']]), 'Bao bì');
    expect(plan).toEqual([
      { id: '1', positions: 'Bao bì, Công nhân sản xuất' },
      { id: '2', positions: 'Bao bì' },
      { id: '4', positions: 'Bao bì' },
      { id: '3', positions: 'Giày da' },
    ]);
  });
});

describe('nhu cầu cung ứng / giới thiệu', () => {
  it('lọc giá trị lạ, đúng thứ tự', () => {
    expect(sanitizeNeeds(['thoi_vu', 'x', 'cung_ung', 'thoi_vu'])).toEqual(['cung_ung', 'thoi_vu']);
    expect(sanitizeNeeds(null)).toEqual([]);
    expect(toggleNeed(['cung_ung'], 'cung_ung')).toEqual([]);
  });
  it('chữ hiển thị + lọc đủ điều kiện', () => {
    expect(needsText(['gioi_thieu', 'thoi_vu', 'chinh_thuc'])).toBe('Giới thiệu · Thời vụ + Chính thức');
    expect(needsText([])).toBe('');
    expect(matchesNeeds(['gioi_thieu', 'thoi_vu'], ['gioi_thieu'])).toBe(true);
    expect(matchesNeeds(['gioi_thieu'], ['gioi_thieu', 'chinh_thuc'])).toBe(false);
    expect(matchesNeeds([], [])).toBe(true);
  });
});
