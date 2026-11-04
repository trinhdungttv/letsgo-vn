// Bản đồ vệ tinh vẽ mặt bằng: toán toạ độ + xoay + đọc dữ liệu.
import { describe, expect, it } from 'vitest';
import {
  bearingAround, bearingToLevel, centroid, fitPoints, fromScreen, labelPx, longestEdge, newSiteGeo, normBearing, panBy,
  project, rectToGeo, sanitizeGeo, scaleBar, tileZoomFor, toScreen, unproject, visibleTiles, zoomAround, type GeoPt, type View,
} from './siteGeo';

const BAU_BANG: GeoPt = { lat: 11.2967, lng: 106.6285 };
const view = (extra: Partial<View> = {}): View => ({ center: BAU_BANG, zoom: 18, bearing: 0, w: 1000, h: 700, ...extra });
const near = (a: GeoPt, b: GeoPt, tol = 1e-6) => { expect(Math.abs(a.lat - b.lat)).toBeLessThan(tol); expect(Math.abs(a.lng - b.lng)).toBeLessThan(tol); };

describe('project / unproject', () => {
  it('đi rồi về ra đúng điểm cũ', () => {
    near(unproject(project(BAU_BANG, 18), 18), BAU_BANG, 1e-9);
    near(unproject(project({ lat: 21.03, lng: 105.85 }, 12), 12), { lat: 21.03, lng: 105.85 }, 1e-9);
  });
});

describe('toScreen / fromScreen', () => {
  it('tâm khung nhìn nằm giữa màn hình', () => {
    const p = toScreen(view({ bearing: 37 }), BAU_BANG);
    expect(p.x).toBeCloseTo(500, 6);
    expect(p.y).toBeCloseTo(350, 6);
  });
  it('đi rồi về đúng điểm cũ ở mọi góc xoay', () => {
    for (const bearing of [0, 12.5, -45, 90, 179, -170]) {
      const v = view({ bearing });
      const g = { lat: BAU_BANG.lat + 0.0013, lng: BAU_BANG.lng - 0.0021 };
      near(fromScreen(v, toScreen(v, g)), g, 1e-8);
    }
  });
  it('bản đồ xoay 90° theo chiều kim đồng hồ: hướng Đông (bên phải) quay xuống dưới', () => {
    const east = { lat: BAU_BANG.lat, lng: BAU_BANG.lng + 0.001 };
    const a = toScreen(view({ bearing: 0 }), east);
    const b = toScreen(view({ bearing: 90 }), east);
    expect(a.x).toBeGreaterThan(500);
    expect(b.y).toBeGreaterThan(350);
    expect(Math.abs(b.x - 500)).toBeLessThan(1e-6);
  });
});

describe('panBy / zoomAround / bearingAround', () => {
  it('kéo nội dung sang phải 100px → điểm từng ở giữa nay lệch phải 100px', () => {
    for (const bearing of [0, 30, -75]) {
      const v = view({ bearing });
      const moved = { ...v, center: panBy(v, 100, 40) };
      const p = toScreen(moved, v.center);
      expect(p.x).toBeCloseTo(600, 4);
      expect(p.y).toBeCloseTo(390, 4);
    }
  });
  it('phóng theo con trỏ: điểm dưới con trỏ đứng yên', () => {
    const v = view({ bearing: 23 });
    const at = { x: 710, y: 180 };
    const g = fromScreen(v, at);
    const z = zoomAround(v, at, 19.3);
    const p = toScreen({ ...v, ...z }, g);
    expect(p.x).toBeCloseTo(at.x, 4);
    expect(p.y).toBeCloseTo(at.y, 4);
    expect(z.zoom).toBeCloseTo(19.3);
  });
  it('mức phóng bị kẹp trong khoảng cho phép', () => {
    expect(zoomAround(view(), { x: 500, y: 350 }, 30).zoom).toBe(21);
    expect(zoomAround(view(), { x: 500, y: 350 }, 2).zoom).toBe(14);
  });
  it('xoay quanh điểm: điểm đó đứng yên', () => {
    const v = view({ bearing: 10 });
    const at = { x: 300, y: 500 };
    const g = fromScreen(v, at);
    const r = bearingAround(v, at, 48);
    const p = toScreen({ ...v, ...r }, g);
    expect(p.x).toBeCloseTo(at.x, 4);
    expect(p.y).toBeCloseTo(at.y, 4);
  });
});

describe('normBearing', () => {
  it('đưa về (-180, 180]', () => {
    expect(normBearing(190)).toBe(-170);
    expect(normBearing(-190)).toBe(170);
    expect(normBearing(360)).toBe(0);
    expect(normBearing(180)).toBe(180);
    expect(normBearing(-180)).toBe(180);
    expect(normBearing(NaN)).toBe(0);
  });
});

describe('bearingToLevel — căn thẳng theo cạnh', () => {
  it('cạnh nghiêng 12° → xoay để nằm ngang, kể cả khi đang xoay sẵn', () => {
    const a = BAU_BANG;
    // cạnh chếch lên trên-phải khoảng 12° so với hướng Đông
    const pa = project(a, 20);
    const d = 400;
    const b = unproject({ x: pa.x + d * Math.cos((-12 * Math.PI) / 180), y: pa.y + d * Math.sin((-12 * Math.PI) / 180) }, 20);
    for (const start of [0, 25, -60]) {
      const nb = bearingToLevel(a, b, start);
      const screenA = toScreen(view({ bearing: nb }), a), screenB = toScreen(view({ bearing: nb }), b);
      const ang = Math.atan2(screenB.y - screenA.y, screenB.x - screenA.x) * 180 / Math.PI;
      const off = Math.abs(ang - 90 * Math.round(ang / 90));
      expect(off).toBeLessThan(0.1);
    }
  });
  it('đã thẳng thì giữ nguyên', () => {
    const b = { lat: BAU_BANG.lat, lng: BAU_BANG.lng + 0.001 };
    expect(bearingToLevel(BAU_BANG, b, 0)).toBe(0);
  });
});

describe('centroid / longestEdge', () => {
  const rect: GeoPt[] = [
    { lat: 11.0, lng: 106.0 }, { lat: 11.0, lng: 106.002 }, { lat: 11.001, lng: 106.002 }, { lat: 11.001, lng: 106.0 },
  ];
  it('tâm hình chữ nhật ở giữa', () => {
    near(centroid(rect), { lat: 11.0005, lng: 106.001 }, 2e-6);
  });
  it('1 điểm = chính nó, 2 điểm = trung điểm', () => {
    near(centroid([rect[0]]), rect[0], 1e-9);
    near(centroid([rect[0], rect[1]]), { lat: 11.0, lng: 106.001 }, 1e-6);
  });
  it('cạnh dài nhất là cạnh theo hướng Đông–Tây', () => {
    const e = longestEdge(rect)!;
    expect(Math.abs(e[0].lng - e[1].lng)).toBeCloseTo(0.002, 6);
    expect(longestEdge([rect[0]])).toBeNull();
  });
});

describe('rectToGeo', () => {
  it('khung kéo trên màn hình đã xoay → 4 góc vẫn là hình chữ nhật trên màn hình', () => {
    const v = view({ bearing: 33 });
    const a = { x: 300, y: 200 }, b = { x: 520, y: 330 };
    const pts = rectToGeo(v, a, b);
    expect(pts).toHaveLength(4);
    const s = pts.map(p => toScreen(v, p));
    // toạ độ làm tròn 6 chữ số (~0,1 m) nên lệch dưới nửa điểm ảnh
    expect(Math.abs(s[0].x - 300)).toBeLessThan(0.5); expect(Math.abs(s[0].y - 200)).toBeLessThan(0.5);
    expect(Math.abs(s[2].x - 520)).toBeLessThan(0.5); expect(Math.abs(s[2].y - 330)).toBeLessThan(0.5);
  });
});

describe('visibleTiles', () => {
  it('phủ kín màn hình, kể cả khi xoay', () => {
    for (const bearing of [0, 45, 90]) {
      const v = view({ bearing });
      const tz = tileZoomFor(v.zoom);
      const tiles = visibleTiles(v, tz);
      expect(tiles.length).toBeGreaterThan(8);
      // tâm khung nằm trong 1 ô
      expect(tiles.some(t => t.left <= 0 && t.top <= 0 && t.left + t.size >= 0 && t.top + t.size >= 0)).toBe(true);
    }
  });
  it('mức ảnh không vượt mức Esri có', () => {
    expect(tileZoomFor(20.6)).toBe(19);
    expect(tileZoomFor(17.4)).toBe(17);
  });
});

describe('fitPoints', () => {
  it('khung vừa các điểm nằm trọn trong màn hình', () => {
    const pts: GeoPt[] = [{ lat: 11.296, lng: 106.627 }, { lat: 11.298, lng: 106.630 }, { lat: 11.2975, lng: 106.6275 }];
    for (const bearing of [0, 30]) {
      const f = fitPoints(pts, bearing, 1000, 700)!;
      const v = view({ ...f, bearing });
      for (const p of pts) {
        const s = toScreen(v, p);
        expect(s.x).toBeGreaterThan(0); expect(s.x).toBeLessThan(1000);
        expect(s.y).toBeGreaterThan(0); expect(s.y).toBeLessThan(700);
      }
    }
    expect(fitPoints([], 0, 1000, 700)).toBeNull();
  });
});

describe('sanitizeGeo', () => {
  it('đọc dữ liệu tốt, bỏ khối hỏng, kẹp mức phóng / góc', () => {
    const g = sanitizeGeo({
      v: 1, center: { lat: 11.2967, lng: 106.6285 }, zoom: 40, bearing: 190, origin: { lat: 11.3, lng: 106.6 },
      zones: [
        { id: 'a', label: 'B5', note: 'Gia vị', color: '#8B5CF6', pts: [{ lat: 11, lng: 106 }, { lat: 11, lng: 106.1 }, { lat: 11.1, lng: 106.1 }] },
        { id: 'b', label: 'Cổng', color: 'red', pts: [{ lat: 11.2, lng: 106.2 }] },
        { id: 'c', label: '2 điểm', pts: [{ lat: 11, lng: 106 }, { lat: 11, lng: 106.1 }] },
        { id: 'd', label: 'hỏng', pts: [{ lat: 'x', lng: 1 }, { lat: 1, lng: 1 }, { lat: 2, lng: 2 }] },
        null,
      ],
    })!;
    expect(g.zoom).toBe(21);
    expect(g.bearing).toBe(-170);
    expect(g.origin).toEqual({ lat: 11.3, lng: 106.6 });
    expect(g.zones.map(z => z.id)).toEqual(['a', 'b']);
    expect(g.zones[1].color).toBe('#1D7BF2');
    expect(g.zones[0]).toMatchObject({ label: 'B5', note: 'Gia vị', color: '#8B5CF6' });
  });
  it('giữ cờ khoá hướng; thiếu hoặc sai kiểu thì coi như chưa khoá', () => {
    const base = { center: { lat: 11.2, lng: 106.6 }, zones: [] };
    expect(sanitizeGeo({ ...base, locked: true })!.locked).toBe(true);
    expect(sanitizeGeo({ ...base, locked: false })!.locked).toBeUndefined();
    expect(sanitizeGeo({ ...base, locked: 'yes' })!.locked).toBeUndefined();
    expect(sanitizeGeo(base)!.locked).toBeUndefined();
  });
  it('thiếu tâm bản đồ → null', () => {
    expect(sanitizeGeo(null)).toBeNull();
    expect(sanitizeGeo({ zones: [] })).toBeNull();
    expect(sanitizeGeo({ center: { lat: 'a', lng: 1 } })).toBeNull();
  });
  it('bản mới tạo có ghim gốc + mức phóng mặc định', () => {
    const g = newSiteGeo({ lat: 11.2967123456, lng: 106.6285 });
    expect(g).toMatchObject({ v: 1, zoom: 18, bearing: 0, zones: [] });
    expect(g.origin).toEqual(g.center);
    expect(g.center.lat).toBe(11.296712);
  });
});

describe('labelPx / scaleBar', () => {
  it('chữ to dần khi phóng, không nhỏ hơn 9px hay to hơn 44px', () => {
    expect(labelPx(18)).toBeCloseTo(15);
    expect(labelPx(19)).toBeGreaterThan(labelPx(18));
    expect(labelPx(14)).toBe(9);
    expect(labelPx(21, 2)).toBe(44);
  });
  it('thước tỉ lệ nằm trong 70–140px', () => {
    for (const z of [15, 16, 17, 18, 19, 20]) {
      const s = scaleBar(11.3, z);
      expect(s.px).toBeGreaterThanOrEqual(70);
      expect(s.px).toBeLessThan(260);
    }
  });
});
