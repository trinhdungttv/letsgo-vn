import { describe, expect, it } from 'vitest';
import {
  scanKeywords, looksLikeSupplier, scanArea, inCompanyArea, buildScanQuery, parseScanOsm, parsePhotonSuppliers, fromGoogle, mergeScan, matchScan,
  type ScanPlace,
} from './marketScan';
import type { SurveyCompany } from './companies';

const LAT = 10.9, LNG = 106.75;
const P = (x: number, y: number) => ({ lat: LAT + y / 111_320, lng: LNG + x / (111_320 * Math.cos((LAT * Math.PI) / 180)) });
const ring = (s: number): [number, number][] => [[P(-s, -s).lat, P(-s, -s).lng], [P(s, -s).lat, P(s, -s).lng], [P(s, s).lat, P(s, s).lng], [P(-s, s).lat, P(-s, s).lng], [P(-s, -s).lat, P(-s, -s).lng]];
const area = scanArea(P(0, 0), [ring(1000)]);
const place = (o: Partial<ScanPlace>): ScanPlace => ({
  key: 'x', sources: ['osm'], kind: 'company', name: 'A', ...P(0, 0), address: '', category: '', mapsUrl: '', phone: '', website: '', keywords: [], ...o,
});

describe('quét thông tin KCN', () => {
  it('từ khoá tự lên theo tên KCN', () => {
    const k = scanKeywords('KCN Sóng Thần 1');
    expect(k.company).toContain('công ty KCN Sóng Thần 1');
    expect(k.company).toContain('công ty may mặc');
    expect(k.supplier).toContain('công ty cung ứng lao động');
    expect(k.supplier).toContain('cung ứng lao động Sóng Thần 1');
  });
  it('nhận dạng tên nhà cung ứng lao động', () => {
    expect(looksLikeSupplier('Công ty TNHH Cung Ứng Nhân Lực Thành Đạt')).toBe(true);
    expect(looksLikeSupplier('Trung tâm Dịch vụ Việc làm Bình Dương')).toBe(true);
    expect(looksLikeSupplier('Manpower Vietnam')).toBe(true);
    expect(looksLikeSupplier('Công ty TNHH Changshin Việt Nam')).toBe(false);
  });
  it('vùng quét: công ty trong ranh giới (sát viền vẫn tính), nhà cung ứng bán kính 6 km', () => {
    expect(inCompanyArea(area, P(500, 500))).toBe(true);
    expect(inCompanyArea(area, P(1150, 0))).toBe(true);
    expect(inCompanyArea(area, P(2500, 0))).toBe(false);
    expect(area.supplier.maxLat - area.supplier.minLat).toBeCloseTo((12_000) / 111_320, 3);
    const q = buildScanQuery(area);
    expect(q).toContain('employment_agency');
    expect(q).toContain('make lgvn_split kind="supplier"');
  });
  it('đọc kết quả OSM: bỏ chính KCN, đường, trường học; công ty ngoài KCN bỏ; nhà cung ứng giữ', () => {
    const c = P(200, 200), out = P(3000, 0), sup = P(3000, 500);
    const list = parseScanOsm({ elements: [
      { type: 'way', id: 1, center: { lat: c.lat, lon: c.lng }, tags: { name: 'Công ty TNHH ABC', man_made: 'works' } },
      { type: 'way', id: 2, center: { lat: c.lat, lon: c.lng }, tags: { name: 'Khu công nghiệp Sóng Thần 1', landuse: 'industrial' } },
      { type: 'node', id: 3, lat: out.lat, lon: out.lng, tags: { name: 'Nhà máy XYZ', office: 'company' } },
      { type: 'node', id: 4, lat: c.lat, lon: c.lng, tags: { name: 'Công ty Nhân Lực Việt', office: 'company' } },
      { type: 'lgvn_split', tags: { kind: 'supplier' } },
      { type: 'node', id: 5, lat: sup.lat, lon: sup.lng, tags: { name: 'Văn phòng việc làm Dĩ An', office: 'employment_agency', 'addr:street': 'Đường số 1' } },
      { type: 'node', id: 6, lat: sup.lat, lon: sup.lng, tags: { name: 'Trường Lao động Xã hội', amenity: 'school' } },
      { type: 'way', id: 7, center: { lat: sup.lat, lon: sup.lng }, tags: { name: 'Đường Tuyển Dụng', highway: 'residential' } },
    ] }, area);
    expect(list.map(p => [p.key, p.kind])).toEqual([['o:w1', 'company'], ['o:n4', 'supplier'], ['o:n5', 'supplier']]);
    expect(list[2]).toMatchObject({ category: 'Văn phòng việc làm', address: 'Đường số 1' });
  });
  it('Photon: chỉ giữ tên dáng cung ứng trong khung quanh KCN', () => {
    const a = P(1000, 1000), far = P(20_000, 0);
    const list = parsePhotonSuppliers({ features: [
      { properties: { osm_type: 'N', osm_id: 9, osm_key: 'office', name: 'Cung ứng lao động Hoàng Long' }, geometry: { coordinates: [a.lng, a.lat] } },
      { properties: { osm_type: 'N', osm_id: 10, osm_key: 'shop', name: 'Tạp hoá Hoàng Long' }, geometry: { coordinates: [a.lng, a.lat] } },
      { properties: { osm_type: 'N', osm_id: 11, osm_key: 'office', name: 'Nhân lực Xa' }, geometry: { coordinates: [far.lng, far.lat] } },
    ] }, area, 'cung ứng lao động');
    expect(list.map(p => p.name)).toEqual(['Cung ứng lao động Hoàng Long']);
  });
  it('Google: bỏ nơi đóng cửa hẳn / chính KCN, công ty ngoài KCN; tên cung ứng chuyển sang nhà cung ứng', () => {
    const g = (id: string, name: string, p = P(100, 100), status = 'OPERATIONAL') => ({ id, name, address: '', ...p, type: '', types: [], mapsUrl: `https://maps.google.com/?cid=${id}`, status });
    const list = fromGoogle([
      g('1', 'Công ty TNHH Giày Da A'), g('2', 'Công ty đã đóng', P(0, 0), 'CLOSED_PERMANENTLY'), g('3', 'Khu công nghiệp Sóng Thần 1'),
      g('4', 'Nhà máy ngoài', P(5000, 0)), g('5', 'Công ty Cung Ứng Nhân Lực B'),
    ], 'company', 'công ty', area);
    expect(list.map(p => [p.key, p.kind])).toEqual([['g:1', 'company'], ['g:5', 'supplier']]);
  });
  it('gộp trùng Google + OSM (cùng tên lõi, gần nhau), giữ link Google', () => {
    const a = place({ key: 'o:n1', name: 'Công ty TNHH Changshin Việt Nam', address: 'Đường 2' });
    const b = place({ key: 'g:x', sources: ['google'], name: 'CHANGSHIN VIETNAM CO., LTD', ...P(80, 0), mapsUrl: 'https://maps.google.com/?cid=1', keywords: ['nhà máy'] });
    const c = place({ key: 'g:y', sources: ['google'], name: 'Changshin', ...P(5000, 0) });
    const m = mergeScan([[a], [b, c]]);
    expect(m).toHaveLength(2);
    expect(m[0]).toMatchObject({ sources: ['osm', 'google'], mapsUrl: 'https://maps.google.com/?cid=1', address: 'Đường 2' });
  });
  it('đối chiếu: công ty đã là khách hàng; đối thủ đã theo dõi / chưa ghi nhận ở KCN này', () => {
    const companies: SurveyCompany[] = [{ key: 'c:1', name: 'Công ty TNHH Changshin Việt Nam', status: 'client', clientId: '1', crmId: null, leadId: null, points: [P(0, 0)], rings: [], osmOnly: false }];
    expect(matchScan(place({ name: 'Changshin Vietnam Co., Ltd' }), companies, [], 'KCN Sóng Thần 1')).toMatchObject({ type: 'company' });
    expect(matchScan(place({ name: 'Công ty ABC mới' }), companies, [], 'KCN Sóng Thần 1').type).toBe('new');
    const comps = [{ id: 'k', company_name: 'Công ty Cung Ứng Nhân Lực Thành Đạt', active_zones: ['Sóng Thần 1'], zone_name: null }];
    expect(matchScan(place({ kind: 'supplier', name: 'Cung ứng nhân lực Thành Đạt' }), [], comps, 'KCN Sóng Thần 1')).toMatchObject({ type: 'competitor', activeHere: true });
    expect(matchScan(place({ kind: 'supplier', name: 'Cung ứng nhân lực Thành Đạt' }), [], comps, 'KCN Đồng An')).toMatchObject({ type: 'competitor', activeHere: false });
  });
});
