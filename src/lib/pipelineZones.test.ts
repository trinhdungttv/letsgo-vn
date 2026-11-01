import { describe, it, expect } from 'vitest';
import { zoneIdsFromNames, pipelineZones, zoneNames, matchesZoneFilter, zoneFilterOptions, readZoneSites, withZoneSite } from './pipelineZones';

const zones = [
  { id: 'z1', name: 'KCN Vsip 1' },
  { id: 'z2', name: 'KCN Biên Hoà 2' },
  { id: 'z3', name: 'KCN Bàu Bàng' },
];

describe('tên KCN cũ → mã danh mục', () => {
  it('khớp bỏ dấu / bỏ "KCN", bỏ trùng, giữ thứ tự, gom tên lạ', () => {
    expect(zoneIdsFromNames(['BIÊN HOÀ 2', 'KCN Vsip 1', 'Khu công nghiệp Biên Hòa 2', 'KCN Lạ', ' ', null], zones))
      .toEqual({ ids: ['z2', 'z1'], unmatched: ['KCN Lạ'] });
  });
});

describe('KCN của 1 thẻ Pipeline', () => {
  it('chưa là khách: ưu tiên zone_ids, bỏ mã đã xoá khỏi danh mục', () => {
    expect(pipelineZones({ client_id: null, zone_ids: ['z3', 'xoa', 'z1', 'z3'] }, { leadRegion: 'KCN Biên Hoà 2' }, zones))
      .toEqual({ ids: ['z3', 'z1'], legacy: [] });
  });
  it('chưa chạy migration (không có zone_ids) → đọc market_leads.region cũ thành danh sách 1 KCN', () => {
    expect(pipelineZones({ client_id: null }, { leadRegion: 'Vsip 1' }, zones)).toEqual({ ids: ['z1'], legacy: [] });
    expect(pipelineZones({ client_id: null, zone_ids: [] }, { leadRegion: 'KCN Lạ' }, zones)).toEqual({ ids: [], legacy: ['KCN Lạ'] });
  });
  it('tên chi nhánh ghi tạm vào region không bị báo là KCN cũ', () => {
    expect(pipelineZones({ client_id: null }, { leadRegion: 'LGV - Bầu Bàng', ignoreNames: ['LGV - Bầu Bàng'] }, zones))
      .toEqual({ ids: [], legacy: [] });
  });
  it('đã là khách: đọc clients.industrial_zones (nhiều KCN), kể cả khi khách bỏ hết KCN', () => {
    expect(pipelineZones({ client_id: 'c1', zone_ids: ['z3'] }, { clientZones: ['KCN Biên Hoà 2', 'VSIP 1', 'Cũ'] }, zones))
      .toEqual({ ids: ['z2', 'z1'], legacy: ['Cũ'] });
    expect(pipelineZones({ client_id: 'c1', zone_ids: ['z3'] }, { clientZones: [] }, zones)).toEqual({ ids: [], legacy: [] });
    // chưa nạp được khách → dùng zone_ids của thẻ
    expect(pipelineZones({ client_id: 'c1', zone_ids: ['z3'] }, {}, zones)).toEqual({ ids: ['z3'], legacy: [] });
  });
  it('tên theo mã', () => {
    expect(zoneNames(['z2', 'xoa', 'z1'], zones)).toEqual(['KCN Biên Hoà 2', 'KCN Vsip 1']);
  });
});

describe('bộ lọc KCN', () => {
  it('khớp khi công ty có BẤT KỲ KCN nào trùng', () => {
    expect(matchesZoneFilter(['z1', 'z2'], 'z2')).toBe(true);
    expect(matchesZoneFilter(['z1'], 'z2')).toBe(false);
    expect(matchesZoneFilter([], 'none')).toBe(true);
    expect(matchesZoneFilter(['z1'], 'none')).toBe(false);
    expect(matchesZoneFilter([], 'all')).toBe(true);
  });
  it('lựa chọn: chỉ KCN có công ty, đếm mỗi KCN của công ty nhiều KCN, xếp theo tên', () => {
    expect(zoneFilterOptions([['z1', 'z2'], ['z2'], [], ['z2', 'z2']], zones).map(o => `${o.name}:${o.count}`))
      .toEqual(['KCN Biên Hoà 2:3', 'KCN Vsip 1:1']);
  });
});

describe('vị trí nhà máy theo KCN', () => {
  it('đọc an toàn, bỏ mục rỗng / hỏng', () => {
    expect(readZoneSites({ z1: { map_link: ' https://maps/x ', lat: 10.9, lng: 106.8 }, z2: { lat: 'x' }, z3: null, z4: {} }))
      .toEqual({ z1: { map_link: 'https://maps/x', lat: 10.9, lng: 106.8 } });
    expect(readZoneSites(null)).toEqual({});
    expect(readZoneSites([1])).toEqual({});
  });
  it('đặt / xoá 1 KCN không đụng KCN khác', () => {
    const cur = { z1: { map_link: null, lat: 10, lng: 106 } };
    expect(withZoneSite(cur, 'z2', { map_link: 'l', lat: 11, lng: 107 })).toEqual({ z1: { map_link: null, lat: 10, lng: 106 }, z2: { map_link: 'l', lat: 11, lng: 107 } });
    expect(withZoneSite(cur, 'z1', null)).toEqual({});
    expect(cur).toEqual({ z1: { map_link: null, lat: 10, lng: 106 } });
  });
});
