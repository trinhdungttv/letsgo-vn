import { describe, expect, it } from 'vitest';
import {
  normalizeAreaQuery, parsePhoton, parseIndustrialAround, ringsAreaM2, ringsCenter, boundsRing, closeRing, fmtArea, shortZoneName, provinceOf,
  type Ring,
} from './areaSearch';
import { detectZone } from './zones';
import { parseSurveyPrefs, nextNavSound, DEFAULT_SURVEY_PREFS } from '../../pages/market/survey/surveyData';

const LAT = 10.85, LNG = 106.96;
const P = (x: number, y: number): [number, number] => [LAT + y / 111_320, LNG + x / (111_320 * Math.cos((LAT * Math.PI) / 180))];
const square = (x0: number, y0: number, s: number): Ring => [P(x0, y0), P(x0 + s, y0), P(x0 + s, y0 + s), P(x0, y0 + s), P(x0, y0)];
const geom = (r: Ring) => r.map(([lat, lon]) => ({ lat, lon }));

describe('tra cứu vùng khảo sát', () => {
  it('viết tắt KCN / CCN → tên đầy đủ (thử trước), giữ câu gốc', () => {
    expect(normalizeAreaQuery('kcn long duc')).toEqual(['Khu công nghiệp long duc', 'kcn long duc']);
    expect(normalizeAreaQuery('CCN Phú Thạnh')).toEqual(['Cụm công nghiệp Phú Thạnh', 'CCN Phú Thạnh']);
    expect(normalizeAreaQuery('  Amata  ')).toEqual(['Amata']);
    expect(normalizeAreaQuery('')).toEqual([]);
  });
  it('tên ngắn + tỉnh cho danh sách Khu vực', () => {
    expect(shortZoneName('Khu công nghiệp Long Đức')).toBe('KCN Long Đức');
    expect(shortZoneName('Cụm công nghiệp Phú Thạnh')).toBe('CCN Phú Thạnh');
    expect(provinceOf('Thành phố Đồng Nai')).toBe('Đồng Nai');
    expect(provinceOf('Tỉnh Bình Dương')).toBe('Bình Dương');
  });
  it('Photon: bỏ trạm xe buýt, KCN có ranh giới lên đầu, đọc extent + tỉnh', () => {
    const list = parsePhoton({ features: [
      { properties: { osm_type: 'N', osm_id: 1, osm_key: 'highway', osm_value: 'bus_stop', name: 'Khu công nghiệp Long Đức', state: 'Thành phố Đồng Nai' }, geometry: { coordinates: [106.94, 10.82] } },
      { properties: { osm_type: 'R', osm_id: 7, osm_key: 'boundary', osm_value: 'administrative', name: 'Huyện Long Hồ', state: 'Vĩnh Long' }, geometry: { coordinates: [106.0, 10.0] } },
      { properties: { osm_type: 'W', osm_id: 882356440, osm_key: 'landuse', osm_value: 'industrial', name: 'Khu công nghiệp Long Đức', county: 'Xã An Phước', state: 'Thành phố Đồng Nai', extent: [106.9495, 10.8573, 106.9906, 10.8372] }, geometry: { coordinates: [106.9633, 10.8469] } },
    ] });
    expect(list.map(c => c.key)).toEqual(['w882356440', 'r7']);
    expect(list[0]).toMatchObject({ kind: 'industrial', osm: { type: 'way', id: 882356440 }, place: 'Xã An Phước, Thành phố Đồng Nai', province: 'Thành phố Đồng Nai' });
    expect(list[0].extent).toEqual({ minLng: 106.9495, maxLng: 106.9906, minLat: 10.8372, maxLat: 10.8573 });
    expect(parsePhoton(null)).toEqual([]);
  });
  it('KCN quanh 1 điểm: vùng chứa điểm lên đầu, bỏ khối < 1 ha, ghép relation', () => {
    const big = square(-1000, -1000, 2000); // 400 ha chứa điểm (0,0)
    const near = square(1500, 0, 400); // 16 ha cạnh bên
    const tiny = square(100, 100, 50); // 0,25 ha
    const list = parseIndustrialAround({ elements: [
      { type: 'way', id: 2, tags: { name: 'Công ty Formosa', landuse: 'industrial' }, geometry: geom(near) },
      { type: 'way', id: 3, tags: { landuse: 'industrial' }, geometry: geom(tiny) },
      { type: 'relation', id: 9, tags: { name: 'Khu công nghiệp Long Đức', landuse: 'industrial' }, members: [
        { type: 'way', role: 'outer', geometry: geom(big.slice(0, 3)) },
        { type: 'way', role: 'outer', geometry: geom(big.slice(2)) },
      ] },
    ] }, { lat: LAT, lng: LNG });
    expect(list.map(c => c.key)).toEqual(['r9', 'w2']);
    expect(list[0].rings).toHaveLength(1);
    expect(list[0].areaM2! / 10_000).toBeCloseTo(400, -1);
  });
  it('diện tích, tâm, khung, vòng tự chấm', () => {
    const r = square(0, 0, 1000);
    expect(ringsAreaM2([r])).toBeCloseTo(1_000_000, -3);
    const c = ringsCenter([r.slice(0, 4)]);
    expect(c.lat).toBeCloseTo(P(500, 500)[0], 6);
    expect(boundsRing({ minLat: 1, maxLat: 2, minLng: 3, maxLng: 4 })).toHaveLength(5);
    expect(closeRing([[1, 1], [1, 2]])).toBeNull();
    const closed = closeRing([[1, 1], [1, 2], [2, 2]])!;
    expect(closed[0]).toEqual(closed[closed.length - 1]);
    expect(fmtArea(1_200_000)).toBe('120 ha');
    expect(fmtArea(35_000_000)).toBe('35 km²');
  });
});

describe('vùng đã khoanh khi nhận KCN', () => {
  it('đứng trong vùng đã lưu → chắc chắn đúng KCN đó, dù tâm KCN khác gần hơn', () => {
    const zones = [
      { id: 'a', name: 'KCN A', lat: P(0, 0)[0], lng: P(0, 0)[1] },
      { id: 'b', name: 'KCN B', lat: P(900, 0)[0], lng: P(900, 0)[1] },
    ];
    const p = { lat: P(300, 0)[0], lng: P(300, 0)[1] };
    expect(detectZone(p, [], zones).best?.zone.id).toBe('a');
    const d = detectZone(p, [], zones, 3000, [{ zoneId: 'b', rings: [square(200, -200, 1000)] }]);
    expect(d.best?.zone.id).toBe('b');
    expect(d.sure).toBe(true);
  });
});

describe('cài đặt khảo sát', () => {
  it('bản cũ navVoice bật/tắt → navSound; giá trị lạ về mặc định', () => {
    expect(parseSurveyPrefs({ navVoice: false }).navSound).toBe('off');
    expect(parseSurveyPrefs({ navVoice: true }).navSound).toBe('voice');
    expect(parseSurveyPrefs({ navVoice: true, navSound: 'beep' }).navSound).toBe('beep');
    expect(parseSurveyPrefs({ navSound: 'loud', roadTodo: 'xanh', roadDone: 'tim' })).toMatchObject({ navSound: DEFAULT_SURVEY_PREFS.navSound, roadTodo: 'orange', roadDone: 'green' });
    expect('navVoice' in parseSurveyPrefs({ navVoice: true })).toBe(false);
    expect(parseSurveyPrefs('rác')).toEqual(DEFAULT_SURVEY_PREFS);
  });
  it('nút loa: Tắt → Bíp → Giọng đọc → Tắt', () => {
    expect(nextNavSound('off')).toBe('beep');
    expect(nextNavSound('beep')).toBe('voice');
    expect(nextNavSound('voice')).toBe('off');
  });
});
