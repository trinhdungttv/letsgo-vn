import { describe, it, expect } from 'vitest';
import { enhanceInkPixels } from './imageInk';

const px = (r: number, g: number, b: number, a = 255) => [r, g, b, a];
const img = (cells: number[][], w: number, h: number) => ({ data: new Uint8ClampedArray(cells.flat()), w, h });

describe('làm rõ chữ ký / con dấu', () => {
  it('mức 0 giữ nguyên ảnh', () => {
    const { data, w, h } = img([px(120, 140, 200, 90), px(255, 255, 255)], 2, 1);
    expect([...enhanceInkPixels(data, w, h, 'sig', 0)]).toEqual([...data]);
  });
  it('ảnh scan trên giấy trắng: nền thành trong suốt, nét mực nhạt đậm lên', () => {
    const { data, w, h } = img([px(252, 252, 252), px(252, 252, 252), px(252, 252, 252), px(150, 160, 205)], 4, 1);        // giấy … + nét xanh nhạt
    const out = enhanceInkPixels(data, w, h, 'sig', 0.7);
    expect(out[3]).toBe(0);                                                          // giấy (xa nét) → trong suốt
    expect(out[15]).toBeGreaterThan(200);                                            // nét nhạt → gần đặc
  });
  it('ảnh đã tách nền: độ đục của nét mờ được kéo lên, vùng trống vẫn trong suốt', () => {
    const { data, w, h } = img([px(60, 80, 200, 70), px(0, 0, 0, 0), px(0, 0, 0, 0), px(0, 0, 0, 0)], 4, 1);
    const out = enhanceInkPixels(data, w, h, 'sig', 0.8);
    expect(out[3]).toBeGreaterThan(70 * 2); expect(out[11]).toBe(0);
  });
  it('mức càng cao càng đậm (đơn điệu)', () => {
    const { data, w, h } = img([px(60, 80, 200, 90)], 1, 1);
    const a = [0.2, 0.5, 0.9].map(l => enhanceInkPixels(data, w, h, 'sig', l)[3]);
    expect(a[0]).toBeLessThanOrEqual(a[1]); expect(a[1]).toBeLessThanOrEqual(a[2]); expect(a[0]).toBeGreaterThan(90);
  });
  it('màu mực đổi về xanh đậm (chữ ký) / đỏ đậm (con dấu) theo mức', () => {
    const { data, w, h } = img([px(120, 120, 120, 200)], 1, 1);                      // mực xám ngả màu do scan
    const sig = enhanceInkPixels(data, w, h, 'sig', 1), seal = enhanceInkPixels(data, w, h, 'seal', 1);
    expect(sig[2]).toBeGreaterThan(sig[0] + 60);                                     // xanh
    expect(seal[0]).toBeGreaterThan(seal[2] + 100);                                  // đỏ
  });
  it('làm đậm: điểm cạnh nét mảnh cũng có mực (nét dày lên)', () => {
    const cells = [px(0, 0, 0, 0), px(0, 0, 0, 0), px(0, 0, 0, 0), px(0, 0, 0, 0), px(20, 40, 200, 255), px(0, 0, 0, 0), px(0, 0, 0, 0), px(0, 0, 0, 0), px(0, 0, 0, 0)];
    const { data, w, h } = img(cells, 3, 3);
    expect(enhanceInkPixels(data, w, h, 'sig', 0)[3 + 4 * 0]).toBe(0);
    expect(enhanceInkPixels(data, w, h, 'sig', 1)[3 + 4 * 3]).toBeGreaterThan(100);   // điểm bên trái nét
  });
});
