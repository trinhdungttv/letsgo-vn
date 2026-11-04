// Khu vực trên ảnh mặt bằng nhà xưởng.
import { describe, expect, it } from 'vitest';
import { moveZone, nextZoneLabel, rectFrom, resizeZone, sanitizeZones, sortZones, zoneCenter, type SiteZone } from './siteZones';

const z = (label: string, extra: Partial<SiteZone> = {}): SiteZone => ({ id: label || 'x', label, note: '', color: '#1D7BF2', x: 0.5, y: 0.5, ...extra });

describe('sortZones', () => {
  it('so số theo giá trị: B3 < B4 < B10 < B14, A trước B', () => {
    const order = sortZones([z('B14'), z('B3'), z('A4'), z('B10'), z('A3'), z('B4')]).map(x => x.label);
    expect(order).toEqual(['A3', 'A4', 'B3', 'B4', 'B10', 'B14']);
  });
  it('nhãn trống xuống cuối', () => {
    expect(sortZones([z(''), z('Kho TN'), z('A6')]).map(x => x.label)).toEqual(['A6', 'Kho TN', '']);
  });
});

describe('sanitizeZones', () => {
  it('bỏ dòng hỏng, kẹp toạ độ, màu lạ về màu mặc định', () => {
    const out = sanitizeZones([
      { id: 'a', label: 'B5', note: 'Gia vị', color: '#8B5CF6', x: 0.3, y: 0.4 },
      { id: 'b', label: 'X', x: 'abc', y: 0.1 },
      null,
      { id: 'c', label: 'Kho', color: 'red', x: 1.4, y: -1 },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ id: 'a', label: 'B5', note: 'Gia vị', color: '#8B5CF6', x: 0.3, y: 0.4 });
    expect(out[1]).toMatchObject({ id: 'c', color: '#1D7BF2', x: 1, y: 0 });
  });
  it('vùng không tràn khỏi ảnh; khung quá nhỏ thành nhãn rời', () => {
    const [rect, tiny] = sanitizeZones([
      { id: 'r', label: 'B10', x: 0.8, y: 0.7, w: 0.5, h: 0.6 },
      { id: 't', label: 'B7', x: 0.2, y: 0.2, w: 0.001, h: 0.3 },
    ]);
    expect(rect.w).toBeCloseTo(0.2);
    expect(rect.h).toBeCloseTo(0.3);
    expect(tiny.w).toBeUndefined();
  });
  it('trùng id thì cấp id mới; không phải mảng → rỗng', () => {
    const out = sanitizeZones([{ id: 'a', x: 0.1, y: 0.1 }, { id: 'a', x: 0.2, y: 0.2 }]);
    expect(out[0].id).toBe('a');
    expect(out[1].id).not.toBe('a');
    expect(sanitizeZones({})).toEqual([]);
  });
});

describe('nextZoneLabel', () => {
  it('tiếp số của tên cuối', () => {
    expect(nextZoneLabel([z('B3'), z('B4')])).toBe('B5');
    expect(nextZoneLabel([z('B5'), z('B6'), z('Kho')])).toBe('B7');
  });
  it('bỏ qua tên đã có, chưa có số thì Khu 1', () => {
    expect(nextZoneLabel([z('B5'), z('B6'), z('B4')])).toBe('B7');
    expect(nextZoneLabel([])).toBe('Khu 1');
    expect(nextZoneLabel([z('Kho TN')])).toBe('Khu 1');
  });
});

describe('hình học', () => {
  it('kéo theo hướng nào cũng ra khung đúng', () => {
    expect(rectFrom({ x: 0.6, y: 0.5 }, { x: 0.2, y: 0.1 })).toEqual({ x: 0.2, y: 0.1, w: 0.4, h: 0.4 });
  });
  it('dời vùng không ra khỏi ảnh', () => {
    const moved = moveZone(z('B10', { x: 0.7, y: 0.7, w: 0.2, h: 0.2 }), 0.5, -0.9);
    expect(moved.x).toBeCloseTo(0.8);
    expect(moved.y).toBe(0);
  });
  it('tâm nhãn + đổi cỡ', () => {
    const r = z('B6', { x: 0.2, y: 0.2, w: 0.4, h: 0.2 });
    expect(zoneCenter(r)).toEqual({ x: 0.4, y: 0.30000000000000004 });
    expect(zoneCenter(z('B3', { x: 0.1, y: 0.9 }))).toEqual({ x: 0.1, y: 0.9 });
    expect(resizeZone(r, { x: 0.9, y: 0.5 })).toMatchObject({ w: 0.7, h: 0.3 });
    expect(resizeZone(r, { x: 0.1, y: 0.1 })).toMatchObject({ w: 0.015, h: 0.015 });
  });
});
