import { describe, expect, it } from 'vitest';
import { aheadPoint, centerForOffset, fitRotated, glideMs, metersPerPixel, northOf, rotatedSize, screenToMap, smartZoom, speedZoom, unwrapBearing, visiblePadding } from './mapView';
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
  it('cài đặt giao diện gọn / kiểu dẫn đường: mặc định + bỏ giá trị lạ', () => {
    const d = parseSurveyPrefs({});
    expect(d).toMatchObject({ navStrategy: 'tour', compactMode: 'auto', pinned: ['photo', 'voice'], legendCollapsed: false });
    expect(d.assistive.side).toBe('right');
    const p = parseSurveyPrefs({ navStrategy: 'xyz', compactMode: 'always', pinned: ['voice', 'lạ', 'photo', 3], assistive: { side: 'left', y: 7 } });
    expect(p.navStrategy).toBe('tour');
    expect(p.compactMode).toBe('always');
    expect(p.pinned).toEqual(['photo', 'voice']);
    expect(p.assistive).toEqual({ side: 'left', y: 1 });
    expect(parseSurveyPrefs({ assistive: { side: 'giữa', y: 0.5 }, pinned: 'photo' })).toMatchObject({ assistive: { side: 'right' }, pinned: ['photo', 'voice'] });
    // Không dùng chung mảng mặc định (sửa cài đặt máy này không làm đổi mặc định)
    expect(parseSurveyPrefs({}).pinned).not.toBe(parseSurveyPrefs({}).pinned);
  });
});

describe('camera bám vị trí trên bản đồ xoay', () => {
  const close = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    expect(a.x).toBeCloseTo(b.x, 6);
    expect(a.y).toBeCloseTo(b.y, 6);
  };
  it('vector màn hình ↔ bản đồ: xoay rồi xoay ngược về như cũ', () => {
    // Bản đồ xoay 90° (đang đi hướng Đông): kéo ngón tay lên trên màn hình = kéo về phía Đông trên bản đồ
    close(screenToMap({ x: 0, y: -10 }, 90), { x: 10, y: 0 });
    close(screenToMap(screenToMap({ x: 3, y: 7 }, 37), -37), { x: 3, y: 7 });
  });
  it('tâm bản đồ để mũi tên lệch đúng chỗ trên màn hình', () => {
    // Không xoay: mũi tên lệch phải 100 px → tâm nằm bên trái mũi tên 100 px
    close(centerForOffset({ x: 500, y: 500 }, 0, { x: 100, y: 0 }), { x: 400, y: 500 });
    // aheadPoint là trường hợp riêng (lệch xuống dưới k px)
    close(aheadPoint({ x: 0, y: 0 }, 30, 50), centerForOffset({ x: 0, y: 0 }, 30, { x: 0, y: 50 }));
    // Kiểm ngược: điểm user hiện trên màn hình ở tâm + offset
    const c = centerForOffset({ x: 1000, y: 2000 }, 123, { x: 80, y: 60 });
    close(screenToMap({ x: 1000 - c.x, y: 2000 - c.y }, -123), { x: 80, y: 60 });
  });
  it('trượt mũi tên theo nhịp GPS, nhảy xa / mất sóng thì đặt ngay', () => {
    expect(glideMs(1000, 10)).toBe(1050);
    expect(glideMs(100, 1)).toBe(250);
    expect(glideMs(1000, 500)).toBe(0);
    expect(glideMs(8000, 10)).toBe(0);
    expect(glideMs(null, 5)).toBe(900);
  });
  it('mét / điểm ảnh', () => {
    expect(metersPerPixel(0, 0)).toBeCloseTo(156_543.03, 1);
    expect(metersPerPixel(10.72, 17)).toBeCloseTo(1.17, 2);
  });
  it('canh vùng vừa màn hình khi bản đồ xoay: hình chữ nhật dài xoay 90° vẫn lọt', () => {
    // Vùng 1000 × 100 px (ngang) ở zoom 15; màn hình dọc 400 × 1200
    const pts = [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 100 }, { x: 0, y: 100 }];
    const pad = { top: 0, bottom: 0, left: 0, right: 0 };
    const north = fitRotated(pts, 0, 15, { w: 400, h: 1200 }, pad)!;
    const turned = fitRotated(pts, 90, 15, { w: 400, h: 1200 }, pad)!;
    expect(north.zoom).toBe(13); // 1000 px phải thu ~2,5 lần mới lọt 400 px → lùi 2 mức
    expect(turned.zoom).toBe(15); // xoay 90°: cạnh dài nằm dọc màn hình 1200 px → giữ nguyên
    close(north.center, { x: 125, y: 12.5 }); // tâm vùng ở zoom 13 (1/4)
    close(turned.center, { x: 500, y: 50 });
    // Vùng trống lệch (thanh bên trái 200 px) → tâm bản đồ dời để vùng nằm giữa phần còn trống
    const side = fitRotated(pts, 0, 15, { w: 1200, h: 800 }, { ...pad, left: 200 })!;
    expect(side.zoom).toBe(15);
    close(side.center, { x: 400, y: 50 });
  });
});
