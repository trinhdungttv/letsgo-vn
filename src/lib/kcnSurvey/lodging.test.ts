import { describe, expect, it } from 'vitest';
import { directionsLink, fmtKm, fmtMin, fmtRent, lodgingTitle, looksLikeCompany, normLodging, parseRent, phoneDigits, pickRouteTargets, sanitizePhotos } from './lodgingCore';

const at = (dLat: number, dLng: number) => ({ lat: 10.98 + dLat, lng: 106.67 + dLng });

describe('nhà trọ', () => {
  it('giá phòng gõ kiểu Việt', () => {
    expect(parseRent('2.5tr')).toBe(2_500_000);
    expect(parseRent('2tr5')).toBe(2_500_000);
    expect(parseRent('2,5')).toBe(2_500_000);
    expect(parseRent('1500k')).toBe(1_500_000);
    expect(parseRent('2.500.000')).toBe(2_500_000);
    expect(parseRent('2500000đ')).toBe(2_500_000);
    expect(parseRent('')).toBeNull();
    expect(parseRent('abc')).toBeNull();
    expect(fmtRent(2_500_000, 3_000_000)).toBe('2,5–3 triệu');
    expect(fmtRent(1_800_000, null)).toBe('1,8 triệu');
    expect(fmtRent(null, null)).toBe('');
  });

  it('số điện thoại, tên tự đặt, định dạng', () => {
    expect(phoneDigits('+84 909 123 456')).toBe('0909123456');
    expect(phoneDigits('0909.123.456')).toBe('0909123456');
    expect(lodgingTitle({ name: '', landlord_name: 'cô Lan', landlord_phone: '' })).toBe('Nhà trọ cô Lan');
    expect(lodgingTitle({ name: '', landlord_name: '', landlord_phone: '' })).toBe('Nhà trọ');
    expect(fmtMin(7.4)).toBe('7 phút');
    expect(fmtMin(95)).toBe('1 giờ 35 phút');
    expect(fmtKm(0.43)).toBe('430 m');
    expect(fmtKm(2.36)).toBe('2,4 km');
    expect(directionsLink(at(0, 0), at(0.01, 0), 'moto')).toContain('travelmode=two-wheeler');
  });

  it('chọn công ty gần để đo đường: theo khoảng cách, bỏ trùng tên, giữ công ty tự thêm', () => {
    const from = at(0, 0);
    const c = (key: string, name: string, dLat: number) => ({ key, name, kind: 'KH', color: '#059669', ...at(dLat, 0) });
    const list = [c('a', 'Cty A', 0.005), c('b', 'Cty B', 0.01), c('b2', 'cty b', 0.002), c('far', 'Xa', 0.2), c('d', 'Cty D', 0.02)];
    const r = pickRouteTargets(from, list, { max: 2, radiusM: 5000 });
    expect(r.map(x => x.key)).toEqual(['b2', 'a']);
    const k = pickRouteTargets(from, list, { max: 2, radiusM: 5000, keep: ['far'] });
    expect(k.map(x => x.key)).toEqual(['b2', 'far']);
    expect(k[1].straight_m).toBeGreaterThan(20_000);
  });

  it('tên trên bản đồ: chỉ tự đo khi trông như công ty', () => {
    expect(looksLikeCompany('Công ty TNHH May Việt')).toBe(true);
    expect(looksLikeCompany('Nhà máy in Bình Dương')).toBe(true);
    expect(looksLikeCompany('Pouchen Vietnam Co., Ltd')).toBe(true);
    expect(looksLikeCompany('Ocean Bank - Chi nhánh Bình Dương')).toBe(false);
    expect(looksLikeCompany('Như Ý')).toBe(false);
    const from = at(0, 0);
    const r = pickRouteTargets(from, [{ key: 'bank', name: 'BIDV', kind: '', color: '#000000', ...at(0.001, 0), optional: true }, { key: 'c', name: 'Cty C', kind: '', color: '#000000', ...at(0.01, 0) }]);
    expect(r.map(x => x.key)).toEqual(['c']);
    expect(pickRouteTargets(from, [{ key: 'bank', name: 'BIDV', kind: '', color: '#000000', ...at(0.001, 0), optional: true }], { keep: ['bank'] })).toHaveLength(1);
  });

  it('đọc dòng DB lỗi / thiếu cột không vỡ', () => {
    const l = normLodging({ id: 'x', total_rooms: 12.4, vacant_rooms: -2, facilities: ['Wifi', 3], photos: [{ url: 'https://a/b.jpg', kind: 'facility' }, { url: 'javascript:1' }], routes: [{ lat: 1, lng: 2, name: 'A' }, { name: 'thiếu toạ độ' }] });
    expect(l.total_rooms).toBe(12);
    expect(l.vacant_rooms).toBe(0);
    expect(l.facilities).toEqual(['Wifi']);
    expect(l.photos).toHaveLength(1);
    expect(l.photos[0].kind).toBe('facility');
    expect(l.routes).toHaveLength(1);
    expect(l.position_source).toBe('gps');
    expect(sanitizePhotos('x')).toEqual([]);
  });
});
