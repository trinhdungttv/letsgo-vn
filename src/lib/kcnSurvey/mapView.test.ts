import { describe, expect, it } from 'vitest';
import { aheadPoint, northOf, rotatedSize, smartZoom, speedZoom, unwrapBearing, visiblePadding } from './mapView';
import { parseSurveyPrefs } from '../../pages/market/survey/surveyData';

describe('khung bản đồ xoay theo hướng đi', () => {
  it('khung vuông = đường chéo màn hình (số chẵn)', () => {
    expect(rotatedSize(390, 844)).toBe(930);
    expect(rotatedSize(300, 400)).toBe(500);
    expect(rotatedSize(3, 4) % 2).toBe(0);
  });
  it('góc xoay đi đường ngắn nhất qua 0°, về Bắc theo đường ngắn nhất', () => {
    expect(unwrapBearing(350, 10)).toBe(370);
    expect(unwrapBearing(370, 350)).toBe(350);
    expect(unwrapBearing(-10, 200)).toBe(-160);
    expect(northOf(370)).toBe(360);
    expect(northOf(200)).toBe(360);
    expect(northOf(170)).toBe(0);
    expect(northOf(-20)).toBe(0);
  });
  it('tâm khung dời ra phía trước hướng đi (mũi tên ở dưới màn hình)', () => {
    const u = { x: 1000, y: 1000 };
    const n = aheadPoint(u, 0, 100);
    expect(n.x).toBeCloseTo(1000); expect(n.y).toBeCloseTo(900); // đi về Bắc → tâm ở phía trên
    const e = aheadPoint(u, 90, 100);
    expect(e.x).toBeCloseTo(1100); expect(e.y).toBeCloseTo(1000);
    const sw = aheadPoint(u, 225, 100);
    expect(sw.x).toBeLessThan(1000); expect(sw.y).toBeGreaterThan(1000);
  });
  it('tự zoom: theo tốc độ; gần chỗ rẽ phóng to, xa thì thu nhỏ', () => {
    expect(speedZoom(15, 17)).toBe(15);
    expect(speedZoom(7, 17)).toBe(16);
    expect(speedZoom(0.5, 17)).toBe(18);
    expect(smartZoom({ speed: 12, navDist: null, lat: 10.8, viewH: 800, base: 17 })).toBe(15);
    const near = smartZoom({ speed: 6, navDist: 60, lat: 10.8, viewH: 800, base: 17 });
    const far = smartZoom({ speed: 6, navDist: 500, lat: 10.8, viewH: 800, base: 17 });
    expect(near).toBeGreaterThan(far);
    expect(near).toBeLessThanOrEqual(18);
    expect(far).toBeGreaterThanOrEqual(14);
  });
  it('canh vùng trong phần màn hình đang thấy', () => {
    expect(visiblePadding({ x: 930, y: 930 }, { w: 390, h: 844 }, { top: 90, bottom: 170, side: 20 })).toEqual({
      paddingTopLeft: [290, 133], paddingBottomRight: [290, 213],
    });
  });
  it('cài đặt cũ "Tự zoom theo tốc độ" (tắt) → tự zoom mới bật, xoay theo hướng đi', () => {
    const p = parseSurveyPrefs({ autoZoom: false });
    expect(p.smartZoom).toBe(true);
    expect(p.mapOrientation).toBe('heading');
    expect('autoZoom' in p).toBe(false);
    expect(parseSurveyPrefs({ mapOrientation: 'north', smartZoom: false })).toMatchObject({ mapOrientation: 'north', smartZoom: false });
    expect(parseSurveyPrefs({ mapOrientation: 'xoay' }).mapOrientation).toBe('heading');
  });
});
