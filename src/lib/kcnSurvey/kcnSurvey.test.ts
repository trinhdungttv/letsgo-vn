import { describe, expect, it } from 'vitest';
import {
  judgeFix, trackLength, trackBounds, TrackIndex, splitRoads, roadCoverage, mergePieces, distToShape, pointInRing,
  boundsAround, boundsIntersect, fmtDistance, fmtDuration, type TrackPoint, type RoadWay,
} from './track';
import { buildSurveyCompanies, mergeOsmPlaces, companiesNear, pickCurrent, notePassed, isZoneLikeName, roadFactoryScores, type PassedCompany, type SurveyCompany } from './companies';
import { foldZoneName, zoneNameMatch, matchMarketZone, detectZone, surveyTitle, dayRange, companiesInArea, osmZoneAt, clusterShare } from './zones';
import { parseOverpass, buildQuery, areaKey, stitchRings, pickZoneBoundary, piecesInZone } from './overpass';
import { readExif } from './exif';
import { groupChunks } from './api';

// Quanh KCN Amata (Biên Hoà): 0,0001° vĩ độ ≈ 11,1 m
const LAT = 10.95, LNG = 106.88;
const north = (m: number) => LAT + m / 111_320;
const east = (m: number) => LNG + m / (111_320 * Math.cos((LAT * Math.PI) / 180));

describe('judgeFix — lọc điểm GPS', () => {
  const last: TrackPoint = [LAT, LNG, 0, 5];
  it('nhận điểm đầu tiên nếu đủ chính xác', () => {
    expect(judgeFix(null, { lat: LAT, lng: LNG, t: 0, acc: 10 })).toBe('accept');
  });
  it('bỏ điểm sai số lớn', () => {
    expect(judgeFix(null, { lat: LAT, lng: LNG, t: 0, acc: 80 })).toBe('inaccurate');
  });
  it('bỏ điểm gần như đứng yên', () => {
    expect(judgeFix(last, { lat: north(3), lng: LNG, t: 5, acc: 5 })).toBe('too-close');
  });
  it('bước tối thiểu nới theo sai số: lệch 8m với sai số 20m vẫn coi là đứng yên', () => {
    expect(judgeFix([LAT, LNG, 0, 20], { lat: north(8), lng: LNG, t: 5, acc: 20 })).toBe('too-close');
  });
  it('nhận điểm đã đi thêm đủ xa', () => {
    expect(judgeFix(last, { lat: north(20), lng: LNG, t: 3, acc: 5 })).toBe('accept');
  });
  it('bỏ cú nhảy GPS vô lý (500m trong 2 giây)', () => {
    expect(judgeFix(last, { lat: north(500), lng: LNG, t: 2, acc: 5 })).toBe('jump');
  });
  it('2 điểm cùng 1 giây mà cách xa vẫn là cú nhảy', () => {
    expect(judgeFix(last, { lat: north(300), lng: LNG, t: 0, acc: 5 })).toBe('jump');
    expect(judgeFix(last, { lat: north(12), lng: LNG, t: 0, acc: 5 })).toBe('accept');
  });
});

describe('quãng đường & khung toạ độ', () => {
  const seg: TrackPoint[] = [[LAT, LNG, 0, 5], [north(100), LNG, 10, 5], [north(100), east(100), 20, 5]];
  it('cộng dồn các đoạn', () => {
    expect(trackLength([seg])).toBeGreaterThan(198);
    expect(trackLength([seg])).toBeLessThan(202);
  });
  it('2 đoạn tách rời không cộng khoảng nối', () => {
    const a: TrackPoint[] = [[LAT, LNG, 0, 5], [north(50), LNG, 5, 5]];
    const b: TrackPoint[] = [[north(1000), LNG, 100, 5], [north(1050), LNG, 105, 5]];
    expect(Math.round(trackLength([a, b]))).toBe(100);
  });
  it('khung bao', () => {
    const b = trackBounds([seg])!;
    expect(b.minLat).toBe(LAT);
    expect(b.maxLng).toBeCloseTo(east(100), 8);
    expect(trackBounds([])).toBeNull();
  });
  it('khung quanh điểm + giao nhau', () => {
    const a = boundsAround({ lat: LAT, lng: LNG }, 500);
    const b = boundsAround({ lat: north(900), lng: LNG }, 500);
    const c = boundsAround({ lat: north(2000), lng: LNG }, 500);
    expect(boundsIntersect(a, b)).toBe(true);
    expect(boundsIntersect(a, c)).toBe(false);
  });
});

describe('TrackIndex + độ phủ đường', () => {
  // Đường A chạy bắc 300m dọc LNG; đường B song song cách 200m về phía đông
  const roads: RoadWay[] = [
    { id: 1, kind: 'tertiary', coords: [[LAT, LNG], [north(300), LNG]] },
    { id: 2, kind: 'tertiary', coords: [[LAT, east(200)], [north(300), east(200)]] },
  ];
  const pieces = splitRoads(roads, 25);

  it('cắt khúc ≤ 25m', () => {
    expect(pieces.length).toBe(24); // mỗi đường 300m → 12 khúc
    expect(Math.max(...pieces.map(p => p.len))).toBeLessThanOrEqual(25.01);
  });

  it('đi hết đường A (lệch 8m) → phủ ~50%, đường B chưa đi', () => {
    const idx = new TrackIndex(LAT, LNG);
    const seg: TrackPoint[] = [];
    for (let m = 0; m <= 300; m += 10) seg.push([north(m), east(8), m, 5]);
    idx.addSegments([seg]);
    const cov = roadCoverage(pieces, idx);
    expect(cov.pct).toBeGreaterThan(48);
    expect(cov.pct).toBeLessThan(52);
    pieces.forEach((p, i) => expect(cov.covered[i]).toBe(p.wayId === 1));
  });

  it('đi nửa đường A → chỉ nửa đó được tô', () => {
    const idx = new TrackIndex(LAT, LNG);
    const seg: TrackPoint[] = [];
    for (let m = 0; m <= 150; m += 10) seg.push([north(m), LNG, m, 5]);
    idx.addSegments([seg]);
    const cov = roadCoverage(pieces, idx);
    const coveredA = pieces.filter((p, i) => p.wayId === 1 && cov.covered[i]).reduce((s, p) => s + p.len, 0);
    expect(coveredA).toBeGreaterThan(140);
    expect(coveredA).toBeLessThan(180);
  });

  it('điểm cách quá xa nhau (mất sóng) không nối thành vết', () => {
    const idx = new TrackIndex(LAT, LNG);
    idx.addSegments([[[LAT, LNG, 0, 5], [north(300), LNG, 60, 5]]]);
    const cov = roadCoverage(pieces, idx);
    // chỉ 2 khúc ở 2 đầu (trong 22m quanh 2 điểm) được tính
    expect(cov.coveredM).toBeLessThan(60);
  });

  it('chưa có vết → 0%', () => {
    expect(roadCoverage(pieces, new TrackIndex(LAT, LNG)).pct).toBe(0);
    expect(roadCoverage([], new TrackIndex(LAT, LNG)).pct).toBeNull();
  });

  it('gộp khúc liền nhau thành 1 đường vẽ', () => {
    const lines = mergePieces(pieces, i => pieces[i].wayId === 2);
    expect(lines.length).toBe(1);
    expect(lines[0].length).toBe(pieces.filter(p => p.wayId === 2).length + 1);
  });
});

describe('khoảng cách tới công ty', () => {
  const ring: [number, number][] = [[LAT, LNG], [north(100), LNG], [north(100), east(100)], [LAT, east(100)], [LAT, LNG]];
  it('trong khối nhà xưởng = 0', () => {
    expect(pointInRing(north(50), east(50), ring)).toBe(true);
    expect(distToShape({ lat: north(50), lng: east(50) }, [], [ring])).toBe(0);
  });
  it('ngoài khối = tới cạnh gần nhất', () => {
    const d = distToShape({ lat: north(50), lng: east(130) }, [], [ring]);
    expect(d).toBeGreaterThan(28);
    expect(d).toBeLessThan(32);
  });
  it('ghim điểm', () => {
    expect(Math.round(distToShape({ lat: LAT, lng: LNG }, [{ lat: north(40), lng: LNG }]))).toBe(40);
  });
});

describe('gộp công ty 3 nguồn', () => {
  const clients = [
    { id: 'c1', name: 'Công ty TNHH Hưng Thịnh', client_type: 'active' as const, lat: north(10), lng: LNG },
    { id: 'c2', name: 'Cty Minh Phát', client_type: 'active' as const, cooperation_status: 'suspended' as const, lat: north(500), lng: LNG },
    { id: 'c3', name: 'Công ty TNHH Tiềm Năng', client_type: 'prospect' as const, lat: null, lng: null },
  ];
  const pipeline = [
    { id: 'p1', company_name: 'Hưng Thịnh', client_id: 'c1', stage: 'tiem-nang' },
    { id: 'p2', company_name: 'Samsung Display', client_id: null, stage: 'dam-phan', zone_sites: { z1: { lat: north(800), lng: LNG } } },
    { id: 'p3', company_name: 'Từ Chối JSC', client_id: null, stage: 'khong-nhu-cau' },
  ];
  const leads = [
    { id: 'l1', company_name: 'Samsung Display VN', crm_id: 'p2', lat: north(805), lng: LNG },
    { id: 'l2', company_name: 'Lẻ Loi Ltd', crm_id: null, lat: north(1200), lng: LNG },
    { id: 'l3', company_name: 'Từ Chối', crm_id: 'p3', lat: north(1500), lng: LNG },
  ];
  const list = buildSurveyCompanies({ clients, pipeline, leads });
  const by = (key: string) => list.find(c => c.key === key)!;

  it('mỗi công ty 1 mục', () => {
    expect(list.map(c => c.key).sort()).toEqual(['c:c1', 'c:c2', 'c:c3', 'l:l2', 'p:p2', 'p:p3']);
  });
  it('khách đang hợp tác thắng giai đoạn pipeline cũ', () => {
    expect(by('c:c1').status).toBe('client');
    expect(by('c:c1').crmId).toBe('p1');
  });
  it('khách ngưng hợp tác', () => expect(by('c:c2').status).toBe('stopped'));
  it('KH tiềm năng', () => expect(by('c:c3').status).toBe('prospect'));
  it('pipeline lấy cả ghim Thị trường lẫn ghim nhà máy, bỏ ghim trùng', () => {
    expect(by('p:p2').status).toBe('pipeline');
    expect(by('p:p2').leadId).toBe('l1');
    expect(by('p:p2').points.length).toBe(1); // 2 ghim cách nhau 5m → cùng 1 chỗ
  });
  it('không hợp tác', () => expect(by('p:p3').status).toBe('declined'));
  it('công ty chỉ có ở Thị trường', () => expect(by('l:l2').status).toBe('lead'));

  it('OSM: trùng tên lõi → gắn vị trí cho công ty chưa có toạ độ', () => {
    const merged = mergeOsmPlaces(list, [
      { id: 'w1', name: 'Tiem Nang Company Limited', point: { lat: north(2000), lng: LNG }, ring: [[north(1990), LNG], [north(2010), LNG], [north(2010), east(20)], [north(1990), LNG]] },
      { id: 'n2', name: 'Nhà máy Lạ Hoắc', point: { lat: north(3000), lng: LNG } },
      { id: 'w3', name: 'Khu công nghiệp Amata', point: { lat: LAT, lng: LNG } },
    ]);
    const c3 = merged.find(c => c.key === 'c:c3')!;
    expect(c3.osmOnly).toBe(true);
    expect(c3.rings.length).toBe(1);
    expect(merged.find(c => c.key === 'o:n2')?.status).toBe('osm');
    expect(merged.some(c => c.name.includes('Amata'))).toBe(false);
  });

  it('tìm công ty trong bán kính, gần trước', () => {
    const near = companiesNear({ lat: north(790), lng: LNG }, list, 150);
    expect(near.map(n => n.company.key)).toEqual(['p:p2']);
    expect(companiesNear({ lat: north(5000), lng: LNG }, list, 150)).toEqual([]);
  });

  it('thẻ "đang đi ngang" không nhảy qua lại khi 2 công ty gần bằng nhau', () => {
    const a = { company: by('c:c1'), dist: 40 };
    const b = { company: by('l:l2'), dist: 32 };
    expect(pickCurrent([b, a], 'c:c1')?.company.key).toBe('c:c1');
    expect(pickCurrent([{ ...b, dist: 10 }, a], 'c:c1')?.company.key).toBe('l:l2');
    expect(pickCurrent([], 'c:c1')).toBeNull();
  });

  it('ghi nhận công ty đã đi ngang', () => {
    const passed = new Map<string, PassedCompany>();
    expect(notePassed(passed, [{ company: by('c:c1'), dist: 80.4 }], '2026-11-02T08:00:00Z')).toBe(true);
    expect(notePassed(passed, [{ company: by('c:c1'), dist: 90 }], '2026-11-02T08:01:00Z')).toBe(false);
    expect(notePassed(passed, [{ company: by('c:c1'), dist: 20 }], '2026-11-02T08:02:00Z')).toBe(true);
    expect(passed.get('c:c1')).toMatchObject({ first_at: '2026-11-02T08:00:00Z', min_dist_m: 20, status: 'client' });
  });

  it('nhận ra tên khu công nghiệp', () => {
    expect(isZoneLikeName('KCN Biên Hoà 2')).toBe(true);
    expect(isZoneLikeName('Amata Industrial Park')).toBe(true);
    expect(isZoneLikeName('Công ty TNHH Changshin')).toBe(false);
  });
});

describe('Overpass', () => {
  it('đọc đường + nhà máy', () => {
    const { roads, places } = parseOverpass({
      elements: [
        { type: 'way', id: 1, tags: { highway: 'tertiary', name: 'Đường 3A' }, geometry: [{ lat: 1, lon: 2 }, { lat: 1.1, lon: 2 }] },
        { type: 'way', id: 2, tags: { highway: 'service' }, geometry: [{ lat: 1, lon: 2 }] },
        { type: 'way', id: 3, tags: { name: 'Pouchen', building: 'industrial' }, geometry: [{ lat: 0, lon: 0 }, { lat: 0, lon: 1 }, { lat: 1, lon: 1 }, { lat: 0, lon: 0 }] },
        { type: 'node', id: 4, lat: 5, lon: 6, tags: { name: 'Xưởng A', man_made: 'works' } },
        { type: 'relation', id: 5, center: { lat: 7, lon: 8 }, tags: { name: 'Nhà máy B', building: 'yes' } },
        { type: 'node', id: 6, lat: 5, lon: 6, tags: { man_made: 'works' } },
        { type: 'way', id: 7, geometry: [{ lat: 3, lon: 4 }, null, { lat: 3.1, lon: 4 }] }, // out skel: không thẻ
      ],
    });
    expect(roads).toEqual([
      { id: 1, name: 'Đường 3A', kind: 'main', coords: [[1, 2], [1.1, 2]] },
      { id: 7, kind: 'main', coords: [[3, 4], [3.1, 4]] },
    ]);
    expect(places.map(p => p.id)).toEqual(['w3', 'n4', 'r5']);
    expect(places[0].ring?.length).toBe(4);
    expect(places[2].point).toEqual({ lat: 7, lng: 8 });
  });
  it('tách đường trục / đường nhánh theo mốc lgvn_split', () => {
    const { roads, places } = parseOverpass({
      elements: [
        { type: 'way', id: 1, geometry: [{ lat: 1, lon: 1 }, { lat: 1, lon: 2 }] },
        { type: 'lgvn_split', id: 1, tags: { kind: 'minor' } },
        { type: 'way', id: 2, geometry: [{ lat: 2, lon: 1 }, { lat: 2, lon: 2 }] },
        { type: 'lgvn_split', id: 2, tags: { kind: 'places' } },
        { type: 'way', id: 3, tags: { name: 'Xưởng X', building: 'factory' }, geometry: [{ lat: 0, lon: 0 }, { lat: 0, lon: 1 }, { lat: 1, lon: 1 }, { lat: 0, lon: 0 }] },
        { type: 'way', id: 4, geometry: [{ lat: 0, lon: 0 }, { lat: 0, lon: 1 }] }, // phần nhà máy mà không thẻ → bỏ
      ],
    });
    expect(roads.map(r => [r.id, r.kind])).toEqual([[1, 'main'], [2, 'minor']]);
    expect(places.map(p => p.id)).toEqual(['w3']);
    expect(splitRoads(roads).map(p => p.main)).toContain(true);
    expect(splitRoads(roads).filter(p => p.wayId === 2).every(p => !p.main)).toBe(true);
  });
  it('câu truy vấn có mốc chia phần', () => {
    const q = buildQuery(boundsAround({ lat: LAT, lng: LNG }, 1000), false);
    expect(q).toContain('make lgvn_split kind="minor"');
    expect(q).toContain('make lgvn_split kind="places"');
    expect(q).toContain('out ids geom qt');
  });
  it('dữ liệu hỏng → rỗng', () => {
    expect(parseOverpass(null)).toEqual({ roads: [], places: [], zones: [] });
  });
  it('ranh giới KCN: way khép kín + relation nhiều khúc viền', () => {
    const { zones, places } = parseOverpass({
      elements: [
        { type: 'way', id: 10, tags: { name: 'Khu công nghiệp Amata', landuse: 'industrial' }, geometry: [{ lat: 0, lon: 0 }, { lat: 0, lon: 1 }, { lat: 1, lon: 1 }, { lat: 0, lon: 0 }] },
        { type: 'relation', id: 11, tags: { name: 'KCN Biên Hòa 2', landuse: 'industrial' }, members: [
          { type: 'way', role: 'outer', geometry: [{ lat: 0, lon: 0 }, { lat: 0, lon: 2 }] },
          { type: 'way', role: 'outer', geometry: [{ lat: 2, lon: 2 }, { lat: 0, lon: 2 }] }, // ngược chiều
          { type: 'way', role: 'outer', geometry: [{ lat: 2, lon: 2 }, { lat: 0, lon: 0 }] },
          { type: 'way', role: 'inner', geometry: [{ lat: 0.5, lon: 0.5 }, { lat: 0.6, lon: 0.6 }] },
        ] },
        { type: 'relation', id: 12, tags: { name: 'Nhà máy C', landuse: 'industrial' }, members: [
          { type: 'way', role: 'outer', geometry: [{ lat: 5, lon: 5 }, { lat: 5, lon: 6 }, { lat: 6, lon: 6 }, { lat: 5, lon: 5 }] },
        ] },
      ],
    });
    expect(zones.map(z => z.id)).toEqual(['w10', 'r11']);
    expect(zones[1].rings).toEqual([[[0, 0], [0, 2], [2, 2], [0, 0]]]);
    expect(places.map(p => p.id)).toEqual(['r12']);
    expect(places[0].ring?.length).toBe(4);
  });
  it('nối khúc viền, khép vòng hở', () => {
    expect(stitchRings([[[0, 0], [0, 1]], [[1, 1], [0, 1]], [[1, 1], [1, 0]]])).toEqual([[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]]);
  });
  it('chọn ranh giới chứa tâm KCN, không thì theo tên', () => {
    const big = { id: 'w1', name: 'KCN Lớn', rings: [[[LAT - 0.01, LNG - 0.01], [LAT - 0.01, LNG + 0.01], [LAT + 0.01, LNG + 0.01], [LAT + 0.01, LNG - 0.01], [LAT - 0.01, LNG - 0.01]] as [number, number][]] };
    const small = { id: 'w2', name: 'KCN Nhỏ', rings: [[[LAT - 0.002, LNG - 0.002], [LAT - 0.002, LNG + 0.002], [LAT + 0.002, LNG + 0.002], [LAT + 0.002, LNG - 0.002], [LAT - 0.002, LNG - 0.002]] as [number, number][]] };
    const far = { id: 'w3', name: 'Khu công nghiệp Amata', rings: [[[north(1500), LNG], [north(1500), east(300)], [north(1800), east(300)], [north(1500), LNG]] as [number, number][]] };
    expect(pickZoneBoundary([big, small], { lat: LAT, lng: LNG }, null)?.id).toBe('w2');
    expect(pickZoneBoundary([far], { lat: LAT, lng: LNG }, 'KCN Amata')?.id).toBe('w3');
    expect(pickZoneBoundary([far], { lat: LAT, lng: LNG }, 'KCN Long Đức')).toBeNull();
  });
  it('chỉ giữ đường trong ranh giới hoặc chạy sát viền', () => {
    const zone = { id: 'w', name: 'KCN', rings: [[[LAT, LNG], [north(200), LNG], [north(200), east(200)], [LAT, east(200)], [LAT, LNG]] as [number, number][]] };
    const pieces = splitRoads([
      { id: 1, kind: 'r', coords: [[north(100), east(20)], [north(100), east(180)]] },   // trong
      { id: 2, kind: 'r', coords: [[north(100), east(-30)], [north(120), east(-30)]] },  // sát viền 30m
      { id: 3, kind: 'r', coords: [[north(100), east(-300)], [north(120), east(-300)]] }, // ngoài xa
    ]);
    const kept = new Set(piecesInZone(pieces, zone).map(p => p.wayId));
    expect([...kept].sort()).toEqual([1, 2]);
  });
  it('câu truy vấn theo tuỳ chọn đường nội bộ', () => {
    const b = boundsAround({ lat: LAT, lng: LNG }, 1000);
    expect(buildQuery(b, false)).not.toContain('|service)');
    expect(buildQuery(b, true)).toContain('|service)');
    expect(areaKey(b, true)).not.toBe(areaKey(b, false));
  });
});

describe('ghép vết từ các đoạn đã lưu', () => {
  it('theo seq, tách segment, bỏ điểm hỏng', () => {
    const map = groupChunks([
      { trip_id: 't', seq: 1, segment: 0, points: [[3, 3, 2, 5]] },
      { trip_id: 't', seq: 0, segment: 0, points: [[1, 1, 0, 5], [2, 2, 1, 5]] },
      { trip_id: 't', seq: 2, segment: 1, points: [[9, 9, 50, 5], [null as unknown as number, 1, 1, 1] as TrackPoint] },
      { trip_id: 'u', seq: 0, segment: 0, points: [] },
    ]);
    expect(map.get('t')).toEqual([[[1, 1, 0, 5], [2, 2, 1, 5], [3, 3, 2, 5]], [[9, 9, 50, 5]]]);
    expect(map.get('u')).toEqual([]);
  });
});

describe('EXIF', () => {
  /** Dựng JPEG tối thiểu có EXIF (TIFF big-endian): IFD0 → GPS IFD + Exif IFD (DateTimeOriginal). */
  function jpegWithGps(lat: [number, number, number], latRef: string, lng: [number, number, number], lngRef: string): ArrayBuffer {
    const tiff: number[] = [];
    const u16 = (n: number) => tiff.push((n >> 8) & 0xff, n & 0xff);
    const u32 = (n: number) => tiff.push((n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff);
    // Bố cục: header(8) | IFD0 @8: 2 mục (2+24+4=30) → @38 | GPS IFD @38: 4 mục (2+48+4=54) → @92
    //         | Exif IFD @92: 1 mục (2+12+4=18) → @110 | lat rationals @110 (24) | lng @134 (24) | date @158 (20)
    u16(0x4d4d); u16(42); u32(8);
    u16(2);
    u16(0x8769); u16(4); u32(1); u32(92);
    u16(0x8825); u16(4); u32(1); u32(38);
    u32(0);
    u16(4);
    u16(1); u16(2); u32(2); tiff.push(latRef.charCodeAt(0), 0, 0, 0);
    u16(2); u16(5); u32(3); u32(110);
    u16(3); u16(2); u32(2); tiff.push(lngRef.charCodeAt(0), 0, 0, 0);
    u16(4); u16(5); u32(3); u32(134);
    u32(0);
    u16(1);
    u16(0x9003); u16(2); u32(20); u32(158);
    u32(0);
    for (const v of lat) { u32(v * 100); u32(100); }
    for (const v of lng) { u32(v * 100); u32(100); }
    for (const ch of '2026:11:02 08:15:30\0') tiff.push(ch.charCodeAt(0));
    const app1Len = 2 + 6 + tiff.length;
    const bytes = [0xff, 0xd8, 0xff, 0xe1, (app1Len >> 8) & 0xff, app1Len & 0xff, 0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff, 0xff, 0xda, 0, 2];
    return new Uint8Array(bytes).buffer;
  }

  it('đọc toạ độ + giờ chụp', () => {
    const info = readExif(jpegWithGps([10, 57, 0], 'N', [106, 52, 48], 'E'))!;
    expect(info.lat).toBeCloseTo(10.95, 6);
    expect(info.lng).toBeCloseTo(106.88, 6);
    expect(info.takenAt).toBe('2026-11-02T08:15:30');
  });
  it('bán cầu Nam / Tây', () => {
    const info = readExif(jpegWithGps([10, 0, 0], 'S', [20, 30, 0], 'W'))!;
    expect(info.lat).toBeCloseTo(-10, 6);
    expect(info.lng).toBeCloseTo(-20.5, 6);
  });
  it('không phải JPEG → null', () => {
    expect(readExif(new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer)).toBeNull();
  });
});

describe('định dạng', () => {
  it('quãng đường', () => {
    expect(fmtDistance(850)).toBe('850 m');
    expect(fmtDistance(3240)).toBe('3,2 km');
  });
  it('thời lượng', () => {
    expect(fmtDuration(45 * 60)).toBe('45 phút');
    expect(fmtDuration(3900)).toBe('1 giờ 05 phút');
    expect(fmtDuration(20)).toBe('20 giây');
  });
});

describe('nhận KCN đang đứng', () => {
  const sq = (lat0: number, lng0: number, m: number): [number, number][] => {
    const dLat = m / 111_320, dLng = m / (111_320 * Math.cos((lat0 * Math.PI) / 180));
    return [[lat0, lng0], [lat0 + dLat, lng0], [lat0 + dLat, lng0 + dLng], [lat0, lng0 + dLng], [lat0, lng0]];
  };
  // NT1 ở gốc (vuông 1 km), NT3 ngay phía đông (vuông 1 km)
  const osm = [
    { id: 'w1', name: 'Khu công nghiệp Nhơn Trạch 1', rings: [sq(LAT, LNG, 1000)] },
    { id: 'w3', name: 'Khu công nghiệp Nhơn Trạch III', rings: [sq(LAT, east(1000), 1000)] },
  ];
  const zones = [
    { id: 'z0', name: 'KCN Nhơn Trạch', lat: north(500), lng: east(900) },
    { id: 'z1', name: 'KCN Nhơn Trạch 1', lat: north(500), lng: east(500) },
    { id: 'z3', name: 'KCN Nhơn Trạch 3', lat: north(500), lng: east(1500) },
  ];

  it('bỏ dấu + bỏ chữ KCN', () => {
    expect(foldZoneName('KCN Nhơn Trạch 3')).toBe('nhon trach 3');
    expect(foldZoneName('Khu công nghiệp Amata')).toBe('amata');
    expect(foldZoneName('Khu công nghiệp Nhơn Trạch III')).toBe('nhon trach 3');
  });
  it('khác số là khác KCN', () => {
    expect(zoneNameMatch('KCN Nhơn Trạch 3', 'Khu công nghiệp Nhơn Trạch 3')).toBe(true);
    expect(zoneNameMatch('KCN Nhơn Trạch', 'Khu công nghiệp Nhơn Trạch 3')).toBe(false);
    expect(zoneNameMatch('KCN Amata', 'Khu công nghiệp Amata Biên Hòa')).toBe(true);
    expect(zoneNameMatch('KCN An', 'KCN An Phước')).toBe(false);
  });
  it('ranh giới tên La Mã vẫn nhận nhờ tâm KCN nằm trong', () => {
    expect(matchMarketZone(osm[1], zones)?.id).toBe('z3');
    expect(matchMarketZone(osm[0], zones)?.id).toBe('z1');
  });
  it('đứng trong ranh giới → chắc chắn, dù tâm KCN khác gần hơn', () => {
    // đứng sát mép đông NT1: tâm "KCN Nhơn Trạch" (z0) gần hơn tâm NT1
    const d = detectZone({ lat: north(500), lng: east(950) }, osm, zones);
    expect(d.sure).toBe(true);
    expect(d.best?.zone.id).toBe('z1');
    expect(d.best?.inside).toBe(true);
    expect(osmZoneAt({ lat: north(500), lng: east(950) }, osm)?.id).toBe('w1');
  });
  it('ranh giới CỤM (1 khối "Nhơn Trạch" bao cả NT1, NT3) không chốt KCN → hỏi lại', () => {
    const cluster = [{ id: 'wc', name: 'Khu công nghiệp Nhơn Trạch', rings: [sq(LAT, LNG, 2000)] }];
    expect(matchMarketZone(cluster[0], zones)).toBeNull();
    const d = detectZone({ lat: north(500), lng: east(750) }, cluster, zones);
    expect(d.sure).toBe(false);
    expect(d.best?.inside).toBe(false);
  });
  it('trong ranh giới cụm: chia phần theo tâm KCN gần nhất, KCN chung không chia', () => {
    const cluster = { id: 'wc', name: 'Khu công nghiệp Nhơn Trạch', rings: [sq(LAT, LNG, 2000)] };
    const share3 = clusterShare(cluster, 'z3', zones)!;
    expect(share3({ lat: north(500), lng: east(1400) })).toBe(true);   // gần tâm NT3
    expect(share3({ lat: north(500), lng: east(300) })).toBe(false);   // gần tâm NT1
    expect(clusterShare(cluster, 'z0', zones)).toBeNull();             // chọn "KCN Nhơn Trạch" chung → cả cụm
    expect(clusterShare(osm[0], 'z1', zones)).toBeNull();              // ranh giới riêng NT1 (chỉ 1 KCN cụ thể) → không chia
  });
  it('không có ranh giới, 2 tâm gần ngang nhau → chưa chắc', () => {
    const d = detectZone({ lat: north(500), lng: east(750) }, [], zones);
    expect(d.sure).toBe(false);
    expect(d.candidates.map(c => c.zone.id).slice(0, 2)).toEqual(['z0', 'z1']);
  });
  it('không có ranh giới, đứng ngay tâm 1 KCN, KCN khác xa → chắc', () => {
    const far = [zones[1], { id: 'z9', name: 'KCN Xa', lat: north(3000), lng: LNG }];
    expect(detectZone({ lat: north(500), lng: east(500) }, [], far).sure).toBe(true);
  });
  it('không có KCN nào trong 3 km', () => {
    expect(detectZone({ lat: north(9000), lng: LNG }, [], zones)).toEqual({ best: null, candidates: [], sure: false });
  });
});

describe('tên chuyến', () => {
  const at = new Date(2026, 10, 3, 8, 5);
  it('có KCN', () => {
    expect(surveyTitle('KCN Nhơn Trạch 3', at)).toBe('KCN Nhơn Trạch 3 – Khảo sát 03/11/2026');
    expect(surveyTitle('KCN Nhơn Trạch 3', at, 2)).toBe('KCN Nhơn Trạch 3 – Khảo sát 03/11/2026 (lần 2)');
  });
  it('không gắn KCN', () => {
    expect(surveyTitle(null, at)).toBe('Khảo sát 03/11/2026 08:05');
  });
  it('khung ngày', () => {
    const r = dayRange(at);
    expect(new Date(r.from).getDate()).toBe(3);
    expect(new Date(r.to).getTime() - new Date(r.from).getTime()).toBe(86_400_000);
  });
});

describe('công ty thuộc KCN + đoạn đường có nhà máy', () => {
  const mk = (key: string, status: SurveyCompany['status'], lat: number, lng: number): SurveyCompany => ({
    key, name: key, status, clientId: null, crmId: null, leadId: null, points: [{ lat, lng }], rings: [], osmOnly: false,
  });
  const boundary = { id: 'w', name: 'KCN', rings: [[[LAT, LNG], [north(500), LNG], [north(500), east(500)], [LAT, east(500)], [LAT, LNG]] as [number, number][]] };
  const cs = [mk('a', 'client', north(100), east(100)), mk('b', 'osm', north(800), east(100))];

  it('lọc theo ranh giới, không có ranh giới thì theo bán kính', () => {
    expect(companiesInArea(cs, boundary, null).map(c => c.key)).toEqual(['a']);
    expect(companiesInArea(cs, null, { lat: LAT, lng: LNG }, 1000).map(c => c.key)).toEqual(['a', 'b']);
    expect(companiesInArea(cs, null, { lat: LAT, lng: LNG }, 300).map(c => c.key)).toEqual(['a']);
  });
  it('khúc đường cạnh khách hàng được điểm cao, đường trống = 0', () => {
    const pieces = splitRoads([
      { id: 1, kind: 'minor', coords: [[north(100), east(50)], [north(100), east(150)]] }, // sát công ty a
      { id: 2, kind: 'minor', coords: [[north(300), east(50)], [north(300), east(150)]] }, // cách 200 m
    ]);
    const sc = roadFactoryScores(pieces, cs);
    pieces.forEach((p, i) => expect(sc[i] > 0).toBe(p.wayId === 1));
    expect(Math.max(...sc)).toBe(3);
  });
  it('công ty có nhà máy ở 2 KCN xa nhau vẫn được tính ở từng nơi', () => {
    const multi = { ...mk('m', 'pipeline', north(100), east(100)), points: [{ lat: north(100), lng: east(100) }, { lat: north(30_000), lng: LNG }] };
    const pieces = splitRoads([{ id: 1, kind: 'main', coords: [[north(100), east(50)], [north(100), east(150)]] }]);
    expect(roadFactoryScores(pieces, [multi]).every(v => v === 3)).toBe(true);
  });
});
