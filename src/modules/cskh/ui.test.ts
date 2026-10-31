import { describe, it, expect } from 'vitest';
import type { CskhGroup } from '../../lib/cskh/types';
import { catalogNames, groupDisplayOf, hasToken, mapEmbedQuery, mapEmbedSrc, resolveGroupKey, splitList, toggleToken, TIER_COLOR, GROUP_COLOR } from './ui';

const groups: CskhGroup[] = [
  { id: 'g1', name: 'Khách Samsung', color: 'purple', baseTier: 'vip', kind: 'client', isArchived: false },
  { id: 'g2', name: 'Chưa chọn hạng', color: 'gray', baseTier: null, kind: 'client', isArchived: false },
];
const byId = new Map(groups.map(g => [g.id, g]));

describe('nhóm hợp nhất', () => {
  it('khoá hạng → tier, không có group_id', () => {
    expect(resolveGroupKey('vvip', byId)).toEqual({ tier: 'vvip', groupId: null, label: 'Người quyết định' });
    expect(resolveGroupKey('unclassified', byId)).toEqual({ tier: 'unclassified', groupId: null, label: 'Chưa chăm sóc' });
  });

  it('nhóm tự tạo → group_id + hạng gốc (chưa chọn = Khác)', () => {
    expect(resolveGroupKey('g:g1', byId)).toEqual({ tier: 'vip', groupId: 'g1', label: 'Khách Samsung' });
    expect(resolveGroupKey('g:g2', byId)?.tier).toBe('other');
  });

  it('khoá lạ / nhóm đã xoá → null', () => {
    expect(resolveGroupKey('boss', byId)).toBeNull();
    expect(resolveGroupKey('g:mat', byId)).toBeNull();
  });

  it('hiển thị: nhóm tự tạo còn dùng thì theo nhóm, không thì theo hạng', () => {
    expect(groupDisplayOf({ tier: 'vip', groupId: 'g1' }, byId)).toEqual({ key: 'g:g1', label: 'Khách Samsung', color: GROUP_COLOR.purple });
    expect(groupDisplayOf({ tier: 'vip', groupId: 'da-xoa' }, byId)).toEqual({ key: 'vip', label: 'Người ảnh hưởng', color: TIER_COLOR.vip });
  });
});

describe('chip gợi ý (ô chữ phẩy ngăn cách)', () => {
  it('bấm để thêm / bỏ, không phân biệt hoa thường', () => {
    expect(toggleToken('', 'Golf')).toBe('Golf');
    expect(toggleToken('Golf, Cà phê', 'golf')).toBe('Cà phê');
    expect(toggleToken('Golf,  Cà phê ', 'Du lịch')).toBe('Golf, Cà phê, Du lịch');
    expect(hasToken('Golf, Cà phê', 'cà PHÊ')).toBe(true);
    expect(splitList(' a, ,b ,')).toEqual(['a', 'b']);
  });
});

describe('bản đồ nhúng không cần API key', () => {
  it('ưu tiên toạ độ trong link, rồi q=, rồi tên địa điểm, cuối cùng địa chỉ', () => {
    expect(mapEmbedQuery('https://www.google.com/maps/place/X/@10.9804,106.6519,17z', 'abc')).toBe('10.9804,106.6519');
    expect(mapEmbedQuery('https://maps.google.com/?q=VSIP+1', '')).toBe('VSIP 1');
    expect(mapEmbedQuery('https://www.google.com/maps/place/Midea+VSIP/data=x', '')).toBe('Midea VSIP');
    expect(mapEmbedQuery('', ' 12 Đại lộ Bình Dương ')).toBe('12 Đại lộ Bình Dương');
    expect(mapEmbedQuery('', '  ')).toBeNull();
    expect(mapEmbedSrc('10.9,106.6')).toBe('https://maps.google.com/maps?q=10.9%2C106.6&z=16&hl=vi&output=embed');
  });
});

describe('danh mục KCN / ngành của Sale', () => {
  it('hiện tên theo thứ tự danh mục, bỏ mã đã bị xoá khỏi danh mục', () => {
    const zones = [{ id: 'z1', name: 'KCN Long Bình' }, { id: 'z2', name: 'KCN Nhơn Trạch' }, { id: 'z3', name: 'VSIP 1' }];
    expect(catalogNames(zones, ['z3', 'gone', 'z1'])).toEqual(['KCN Long Bình', 'VSIP 1']);
    expect(catalogNames(zones, [])).toEqual([]);
  });
});
