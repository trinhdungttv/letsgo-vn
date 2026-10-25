// Port từ PRM Tony Study (nearby.test.mjs, mapPoints.test.mjs) + lớp / quy tắc riêng LetsGo.
import { describe, expect, it } from 'vitest';
import {
  addressQueries, extractLatLng, geocodeAddressDetailed, isGoogleMapsHost, isShortMapLink, placeNameFromLink,
} from './nearby';
import {
  addressPrecision, currentPoint, fmtDistance, fmtDuration, haversineKm, layerPoints, nearestPoints, planGeo,
  provinceGeoQuery, type GeoState,
} from './mapPoints';
import { provinceOptions, VN_PROVINCES } from './provinces';
import { makeContact } from './testFixtures';

describe('định vị địa chỉ', () => {
  it('các cách hỏi: bỏ số nhà, bỏ phường, không bỏ tên đường để lạc quận', () => {
    expect(addressQueries('220/51/2C Hoàng Hoa Thám, Phường 5, Quận Bình Thạnh, Thành phố Hồ Chí Minh')).toEqual([
      '220/51/2C Hoàng Hoa Thám, Phường 5, Quận Bình Thạnh, Thành phố Hồ Chí Minh',
      'Hoàng Hoa Thám, Phường 5, Quận Bình Thạnh, Thành phố Hồ Chí Minh',
      'Hoàng Hoa Thám, Quận Bình Thạnh, Thành phố Hồ Chí Minh',
      'Quận Bình Thạnh, Thành phố Hồ Chí Minh',
    ]);
    expect(addressQueries('Hẻm 45 Lê Lợi, P. Bến Nghé, TP HCM')).toEqual(['Hẻm 45 Lê Lợi, P. Bến Nghé, TP HCM', 'Lê Lợi, P. Bến Nghé, TP HCM', 'Lê Lợi, TP HCM']);
    expect(addressQueries('Cầu Ngang, Trà Vinh')).toEqual(['Cầu Ngang, Trà Vinh']);
    expect(addressQueries('  ')).toEqual([]);
    // Địa chỉ dán nhiều dòng
    expect(addressQueries('12 Lê Lợi\nThủ Dầu Một\nBình Dương')[0]).toBe('12 Lê Lợi, Thủ Dầu Một, Bình Dương');
  });

  it('lùi dần khi không ra; chỉ cách đầu là chính xác', async () => {
    const asked: string[] = [];
    const found = await geocodeAddressDetailed('Số 12 Lê Lợi, Phường 3, Thủ Dầu Một', async q => {
      asked.push(q);
      return q === 'Lê Lợi, Thủ Dầu Một' ? { lat: 11, lng: 106.6 } : null;
    }, async () => undefined);
    expect(asked).toEqual(['Số 12 Lê Lợi, Phường 3, Thủ Dầu Một', 'Lê Lợi, Phường 3, Thủ Dầu Một', 'Lê Lợi, Thủ Dầu Một']);
    expect(found).toEqual({ lat: 11, lng: 106.6, precise: false });
  });

  it('toạ độ từ link đầy đủ: ưu tiên !3d!4d, rồi @, rồi ?q=; link rút gọn không có', () => {
    expect(extractLatLng('https://www.google.com/maps/place/X/@9.8047,106.4497,14z')).toEqual({ lat: 9.8047, lng: 106.4497 });
    expect(extractLatLng('https://maps.app.goo.gl/abc')).toBeNull();
    expect(extractLatLng('https://www.google.com/maps/place/Ch%E1%BB%A3/@10.77,106.69,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x1!8m2!3d10.7725!4d106.6980'))
      .toEqual({ lat: 10.7725, lng: 106.698 });
    expect(extractLatLng('https://maps.google.com/?q=10.80,106.69')).toEqual({ lat: 10.8, lng: 106.69 });
    expect(extractLatLng('https://www.google.com/maps/search/?api=1&query=10.5%2C106.2')).toEqual({ lat: 10.5, lng: 106.2 });
    expect(extractLatLng('https://www.google.com/maps/@200.1,105.2,17z')).toBeNull();
  });

  it('nhận diện link rút gọn, tên miền Google, tên nơi', () => {
    expect(isShortMapLink('https://maps.app.goo.gl/AbC123')).toBe(true);
    expect(isShortMapLink('https://goo.gl/maps/xyz')).toBe(true);
    expect(isShortMapLink('https://goo.gl/other')).toBe(false);
    expect(isShortMapLink('http://maps.app.goo.gl/AbC')).toBe(false);
    expect(isShortMapLink('https://www.google.com/maps/@1.0,2.0')).toBe(false);
    expect(isGoogleMapsHost('www.google.com')).toBe(true);
    expect(isGoogleMapsHost('maps.google.com.vn')).toBe(true);
    expect(isGoogleMapsHost('google.com.evil.com')).toBe(false);
    expect(isGoogleMapsHost('evil.com')).toBe(false);
    expect(isGoogleMapsHost('google.co.evil')).toBe(false);
    expect(isGoogleMapsHost('www.google.co.uk')).toBe(true);
    expect(placeNameFromLink('https://www.google.com/maps/place/C%E1%BA%A7u+Ngang,+Tr%C3%A0+Vinh/@9.8,106.4,14z')).toBe('Cầu Ngang, Trà Vinh');
  });
});

describe('điểm trên bản đồ', () => {
  it('Chính xác khi có link Maps hoặc chấm tay; chỉ chữ = Tương đối', () => {
    expect(addressPrecision({ address: '12 Lê Lợi', mapUrl: 'https://maps.app.goo.gl/x', geoSource: '' })).toBe('precise');
    expect(addressPrecision({ address: '12 Lê Lợi', mapUrl: '', geoSource: 'manual' })).toBe('precise');
    expect(addressPrecision({ address: '12 Lê Lợi', mapUrl: '', geoSource: 'address' })).toBe('approx');
    expect(addressPrecision({ address: ' ', mapUrl: '', geoSource: '' })).toBe('none');
  });

  it('nhà hiện tại: toạ độ đã lưu > trích từ link đầy đủ', () => {
    expect(currentPoint(makeContact({ lat: 10.8, lng: 106.6 }))).toEqual({ lat: 10.8, lng: 106.6 });
    expect(currentPoint(makeContact({ mapUrl: 'https://www.google.com/maps/@10.11,105.29,17z' }))).toEqual({ lat: 10.11, lng: 105.29 });
    expect(currentPoint(makeContact())).toBeNull();
  });

  it('3 lớp: công ty (liên hệ chính trước), nhà hiện tại (~ nếu tra chữ), quê theo tâm tỉnh (luôn ~)', () => {
    const a = makeContact({ id: 'a', clientIds: ['k1', 'k2'], primaryClientIds: ['k2'], lat: 10.8, lng: 106.6, geoSource: 'address', address: '12 Lê Lợi' });
    const b = makeContact({ id: 'b', clientIds: ['k1'], mapUrl: 'https://www.google.com/maps/@10.9,106.7,17z', originProvince: 'Nam Định' });
    const companies = new Map([['k1', { lat: 1, lng: 1, name: 'K1' }], ['k2', { lat: 2, lng: 2, name: 'K2' }]]);
    const provinces = new Map([['Nam Định', { lat: 20.4, lng: 106.2 }]]);
    expect(layerPoints([a, b], 'company', companies, provinces).map(p => [p.contact.id, p.sub])).toEqual([['a', 'K2'], ['b', 'K1']]);
    expect(layerPoints([a, b], 'current', companies, provinces).map(p => [p.contact.id, p.approx])).toEqual([['a', true], ['b', false]]);
    expect(layerPoints([a, b], 'origin', companies, provinces).map(p => [p.contact.id, p.approx, p.lat])).toEqual([['b', true, 20.4]]);
  });

  it('khoảng cách chim bay + định dạng', () => {
    const d = haversineKm({ lat: 10.7769, lng: 106.7009 }, { lat: 21.0285, lng: 105.8542 });
    expect(d).toBeGreaterThan(1130);
    expect(d).toBeLessThan(1150);
    expect(fmtDistance(0.853)).toBe('850 m');
    expect(fmtDistance(3.44)).toBe('3,4 km');
    expect(fmtDistance(1137.6)).toBe('1138 km');
    expect(fmtDuration(720)).toBe('12 phút');
    expect(fmtDuration(3900)).toBe('1 giờ 05 phút');
  });

  it('gần nhất trước', () => {
    const pts = [{ id: 'xa', lat: 11.9, lng: 108.4 }, { id: 'gan', lat: 10.81, lng: 106.66 }, { id: 'vua', lat: 10.9, lng: 106.7 }];
    expect(nearestPoints(pts, { lat: 10.8, lng: 106.65 }, 2).map(p => p.id)).toEqual(['gan', 'vua']);
  });

  it('câu tra tâm tỉnh quê', () => {
    expect(provinceGeoQuery('Lâm Đồng (cũ)')).toBe('Lâm Đồng, Việt Nam');
    expect(provinceGeoQuery(' An Giang ')).toBe('An Giang, Việt Nam');
    expect(provinceGeoQuery('')).toBe('');
  });
});

describe('toạ độ khi lưu hồ sơ: chấm tay > link Maps > tra chữ', () => {
  const cur = (over: Partial<GeoState> = {}): GeoState => ({ address: '', mapUrl: '', lat: null, lng: null, geoSource: '', ...over });
  const pin = { lat: 10.1, lng: 106.1 };
  it('vừa chấm tay → lưu chấm tay', () => {
    expect(planGeo(cur(), { address: '12 Lê Lợi', mapUrl: '' }, pin, null)).toEqual({ kind: 'set', ...pin, source: 'manual' });
  });
  it('chấm tay cũ giữ nguyên khi không đổi địa chỉ / link; đổi địa chỉ thì tính lại', () => {
    const manual = cur({ address: '12 Lê Lợi', lat: 1, lng: 2, geoSource: 'manual' });
    expect(planGeo(manual, { address: '12 Lê Lợi', mapUrl: '' }, null, null)).toEqual({ kind: 'keep' });
    expect(planGeo(manual, { address: '14 Lê Lợi', mapUrl: '' }, null, null)).toEqual({ kind: 'geocode', address: '14 Lê Lợi' });
  });
  it('có link → toạ độ link; không mở được link mà không đổi gì → giữ toạ độ cũ', () => {
    expect(planGeo(cur({ address: 'x' }), { address: 'x', mapUrl: 'https://maps.app.goo.gl/a' }, null, { lat: 3, lng: 4 }))
      .toEqual({ kind: 'set', lat: 3, lng: 4, source: 'map_url' });
    const linked = cur({ mapUrl: 'https://maps.app.goo.gl/a', lat: 3, lng: 4, geoSource: 'map_url' });
    expect(planGeo(linked, { address: '', mapUrl: 'https://maps.app.goo.gl/a' }, null, null)).toEqual({ kind: 'keep' });
  });
  it('chỉ có chữ: tra khi địa chỉ đổi / chưa có toạ độ; xoá hết thì xoá toạ độ', () => {
    expect(planGeo(cur(), { address: '12 Lê Lợi', mapUrl: '' }, null, null)).toEqual({ kind: 'geocode', address: '12 Lê Lợi' });
    expect(planGeo(cur({ address: '12 Lê Lợi', lat: 1, lng: 2, geoSource: 'address' }), { address: '12 Lê Lợi', mapUrl: '' }, null, null)).toEqual({ kind: 'keep' });
    // Bỏ link, giữ địa chỉ → toạ độ cũ là của link → tra lại theo chữ
    expect(planGeo(cur({ address: '12 Lê Lợi', mapUrl: 'https://x', lat: 1, lng: 2, geoSource: 'map_url' }), { address: '12 Lê Lợi', mapUrl: '' }, null, null))
      .toEqual({ kind: 'geocode', address: '12 Lê Lợi' });
    expect(planGeo(cur({ address: 'a', lat: 1, lng: 2, geoSource: 'address' }), { address: '', mapUrl: '' }, null, null)).toEqual({ kind: 'clear' });
    expect(planGeo(cur(), { address: '', mapUrl: '' }, null, null)).toEqual({ kind: 'keep' });
  });
});

describe('danh mục tỉnh cho quê quán', () => {
  it('đủ 63 tỉnh / thành, không trùng', () => {
    expect(VN_PROVINCES).toHaveLength(63);
    expect(new Set(VN_PROVINCES).size).toBe(63);
  });
  it('giữ giá trị lạ đang có, xếp A→Z', () => {
    const opts = provinceOptions(['Huế', ' ']);
    expect(opts).toContain('Huế');
    expect(opts).toHaveLength(64);
    expect(opts[0]).toBe('An Giang');
  });
});
