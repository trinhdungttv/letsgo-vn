import { describe, it, expect } from 'vitest';
import { DEFAULT_LAYOUT, containIn, normalizeLayout, pickEntity, pngSize, stampBoxes, type QuoteEntity } from './entity';
import { emptyProfile } from './quoteDoc';

// PNG 1x1 hợp lệ và PNG 400x240 (chỉ cần phần đầu có IHDR đúng)
const png = (w: number, h: number) => {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, w); new DataView(b.buffer).setUint32(20, h);
  return `data:image/png;base64,${btoa(String.fromCharCode(...b))}`;
};

describe('đặt chữ ký + con dấu', () => {
  const box = { w: 280, h: 92 };
  const { sig, seal } = stampBoxes(DEFAULT_LAYOUT, box);
  it('chữ ký và con dấu đều nằm trong khung', () => {
    for (const r of [sig, seal]) { expect(r.x).toBeGreaterThanOrEqual(-1); expect(r.y).toBeGreaterThanOrEqual(-6); expect(r.x + r.w).toBeLessThanOrEqual(box.w + 1); expect(r.y + r.h).toBeLessThanOrEqual(box.h + 6); }
  });
  it('kiểu chuẩn: con dấu lệch trái chữ ký và ĐÈ một phần lên chữ ký', () => {
    expect(seal.x + seal.w / 2).toBeLessThan(sig.x + sig.w / 2);                       // tâm dấu bên trái tâm chữ ký
    const overlap = Math.min(seal.x + seal.w, sig.x + sig.w) - Math.max(seal.x, sig.x);
    expect(overlap).toBeGreaterThan(20);                                                // có đè
    expect(overlap).toBeLessThan(Math.min(seal.w, sig.w) * 0.8);                        // nhưng không che hết
  });
  it('con dấu là hình vuông', () => expect(seal.w).toBeCloseTo(seal.h, 6));
  it('phóng to / dịch chuyển đúng theo cấu hình', () => {
    const big = stampBoxes({ ...DEFAULT_LAYOUT, sealScale: 1.5, sealDx: 20, sealDy: -10 }, box).seal;
    expect(big.w).toBeCloseTo(seal.w * 1.5, 6);
    expect(big.x + big.w / 2).toBeCloseTo(seal.x + seal.w / 2 + 20, 6);
    expect(big.y + big.h / 2).toBeCloseTo(seal.y + seal.h / 2 - 10, 6);
  });
  it('cấu hình rác / vượt ngưỡng bị kéo về giới hạn, không NaN', () => {
    const l = normalizeLayout({ sigScale: 99, sigDx: 'x', sealScale: -3, sealDy: 9999 });
    expect(l.sigScale).toBe(2); expect(l.sigDx).toBe(0); expect(l.sealScale).toBe(0.4); expect(l.sealDy).toBe(150);
    expect(normalizeLayout(null)).toEqual(DEFAULT_LAYOUT);
  });
  it('khung nhỏ (ô Excel) vẫn cho kích thước dương', () => {
    const s = stampBoxes(DEFAULT_LAYOUT, { w: 90, h: 24 });
    expect(s.sig.w).toBeGreaterThan(0); expect(s.seal.h).toBeGreaterThan(0);
  });
});

describe('kích thước ảnh', () => {
  it('đọc rộng × cao từ PNG', () => expect(pngSize(png(400, 240))).toEqual({ w: 400, h: 240 }));
  it('không phải PNG → null', () => { expect(pngSize('data:image/jpeg;base64,AAAA')).toBeNull(); expect(pngSize('xx')).toBeNull(); expect(pngSize('data:image/png;base64,AAAA')).toBeNull(); });
  it('vừa khung giữ tỉ lệ và căn giữa', () => {
    const r = containIn({ x: 10, y: 20, w: 200, h: 100 }, { w: 400, h: 240 });
    expect(r.h).toBeCloseTo(100, 6); expect(r.w).toBeCloseTo(166.667, 2);
    expect(r.x).toBeCloseTo(10 + (200 - 166.667) / 2, 2); expect(r.y).toBeCloseTo(20, 6);
    expect(containIn({ x: 0, y: 0, w: 5, h: 5 }, null)).toEqual({ x: 0, y: 0, w: 5, h: 5 });
  });
});

describe('chọn pháp nhân', () => {
  const mk = (id: string): QuoteEntity => ({ id, label: id, data: emptyProfile(), layout: DEFAULT_LAYOUT, logo: null, signature: null, seal: null, has_signature: false, has_seal: false, sort_order: 0, updated_by_name: null, updated_at: null });
  const list = [mk('a'), mk('b'), mk('c')];
  it('ưu tiên cái đã chọn cho báo giá, rồi cái dùng lần trước, rồi cái đầu', () => {
    expect(pickEntity(list, 'b', 'c')!.id).toBe('b');
    expect(pickEntity(list, null, 'c')!.id).toBe('c');
    expect(pickEntity(list, 'zzz', 'yyy')!.id).toBe('a');
    expect(pickEntity([], 'a', 'a')).toBeNull();
  });
});
