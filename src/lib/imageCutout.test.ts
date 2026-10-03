import { describe, it, expect } from 'vitest';
import { hasTransparency, whiteToTransparent } from './imageCutout';

const px = (...rows: number[][]) => new Uint8ClampedArray(rows.flat());

describe('tách nền trắng cho chữ ký / con dấu', () => {
  it('nền trắng → trong suốt hẳn', () => expect(whiteToTransparent(px([255, 255, 255, 255]))[3]).toBe(0));
  it('gần trắng (giấy hơi xám/ngả vàng) → vẫn trong suốt', () => {
    expect(whiteToTransparent(px([248, 246, 240, 255]))[3]).toBe(0);
    expect(whiteToTransparent(px([243, 243, 243, 255]))[3]).toBe(0);
  });
  it('mực đen / xanh đậm → giữ nguyên, không đổi màu', () => {
    expect(Array.from(whiteToTransparent(px([10, 10, 10, 255])))).toEqual([10, 10, 10, 255]);
    expect(Array.from(whiteToTransparent(px([20, 40, 160, 255])))).toEqual([20, 40, 160, 255]);
  });
  it('dấu đỏ → giữ nguyên (kênh xanh lá/lam thấp)', () => expect(Array.from(whiteToTransparent(px([200, 30, 30, 255])))).toEqual([200, 30, 30, 255]));
  it('mép mềm: điểm xám trung gian trong suốt một phần, tối hơn điểm sáng hơn', () => {
    const mid = whiteToTransparent(px([215, 215, 215, 255]))[3];
    const lighter = whiteToTransparent(px([232, 232, 232, 255]))[3];
    expect(mid).toBeGreaterThan(0); expect(mid).toBeLessThan(255);
    expect(lighter).toBeLessThan(mid);
  });
  it('mép KHÔNG bị viền trắng: màu điểm trong suốt một phần được bỏ phần trắng pha vào (tối hơn màu gốc)', () => {
    const out = whiteToTransparent(px([215, 215, 215, 255]));
    expect(out[0]).toBeLessThan(215);
  });
  it('không đụng ảnh gốc (trả mảng mới) và giữ nguyên độ dài', () => {
    const src = px([255, 255, 255, 255], [0, 0, 0, 255]);
    const out = whiteToTransparent(src);
    expect(Array.from(src)).toEqual([255, 255, 255, 255, 0, 0, 0, 255]);
    expect(out).toHaveLength(8); expect(out).not.toBe(src);
  });
  it('xử lý nhiều điểm: giữ nét ký, bỏ nền', () => {
    const out = whiteToTransparent(px([255, 255, 255, 255], [15, 15, 90, 255], [255, 255, 255, 255]));
    expect([out[3], out[7], out[11]]).toEqual([0, 255, 0]);
  });
  it('nhận biết ảnh đã có nền trong suốt', () => {
    expect(hasTransparency(px([0, 0, 0, 255], [0, 0, 0, 255]))).toBe(false);
    expect(hasTransparency(px([0, 0, 0, 255], [0, 0, 0, 0]))).toBe(true);
  });
});
