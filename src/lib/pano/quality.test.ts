import { describe, expect, it } from 'vitest';
import {
  CANVAS_MAX_PX, RENDER_BUDGET_DESKTOP, RENDER_BUDGET_PHONE, TEX_BUDGET_DESKTOP, TEX_BUDGET_LOW, TEX_BUDGET_PHONE,
  isIOSWebKit, renderDpr, textureScale,
} from './quality';

describe('textureScale — giữ ảnh gốc, chỉ thu khi vượt trần', () => {
  it('ảnh lưu tối đa 6144 × 3072 vào NGUYÊN VẸN trên điện thoại (trước đây bị ép 4096)', () => {
    expect(textureScale(6144, 3072, { maxTex: 16384, budgetPx: TEX_BUDGET_PHONE, halvesOnly: true })).toBe(1);
    expect(textureScale(6144, 3072, { maxTex: 16384, budgetPx: TEX_BUDGET_PHONE })).toBe(1);
    expect(textureScale(5760, 2880, { maxTex: 8192, budgetPx: TEX_BUDGET_PHONE })).toBe(1);
  });

  it('ảnh nhỏ không bao giờ bị phóng to', () => {
    expect(textureScale(2048, 1024, { maxTex: 4096, budgetPx: TEX_BUDGET_LOW })).toBe(1);
  });

  it('GPU giới hạn 4096 → thu đúng vừa 4096 (Android / máy cũ)', () => {
    const k = textureScale(6144, 3072, { maxTex: 4096, budgetPx: TEX_BUDGET_PHONE });
    expect(Math.round(6144 * k)).toBe(4096);
  });

  it('iPhone / iPad: chỉ thu theo nấc ½ — tránh WebKit giải mã ½ rồi phóng lại', () => {
    // hết bộ nhớ → trần thấp 4096 × 2048: 6144 → 3072 (đúng nấc ½), KHÔNG phải 4096 "giả"
    expect(textureScale(6144, 3072, { maxTex: 16384, budgetPx: TEX_BUDGET_LOW, halvesOnly: true })).toBe(0.5);
    // ảnh 8192 trên điện thoại: vượt trần 19 MP → ½ = 4096
    expect(textureScale(8192, 4096, { maxTex: 16384, budgetPx: TEX_BUDGET_PHONE, halvesOnly: true })).toBe(0.5);
    // ảnh rất to: ¼
    expect(textureScale(16384, 8192, { maxTex: 8192, budgetPx: TEX_BUDGET_PHONE, halvesOnly: true })).toBe(0.25);
  });

  it('phải thu qua canvas thì không vượt giới hạn khung vẽ iPhone (~16,7 MP)', () => {
    const k = textureScale(8192, 4096, { maxTex: 16384, budgetPx: TEX_BUDGET_DESKTOP + 1 });
    expect(k).toBe(1);
    const k2 = textureScale(10000, 5000, { maxTex: 16384, budgetPx: TEX_BUDGET_DESKTOP });
    expect(10000 * k2 * 5000 * k2).toBeLessThanOrEqual(CANVAS_MAX_PX + 1);
  });

  it('kích thước lạ (0) → giữ nguyên', () => {
    expect(textureScale(0, 0, { maxTex: 4096, budgetPx: TEX_BUDGET_PHONE })).toBe(1);
  });
});

describe('renderDpr — vẽ đúng mật độ màn hình', () => {
  it('iPhone 3×: khung toàn màn vẽ đủ 3× (trước đây chặn 2× → bị phóng 1,5 lần, mờ)', () => {
    expect(renderDpr(393, 700, 3, RENDER_BUDGET_PHONE)).toBe(3);
    expect(renderDpr(430, 932, 3, RENDER_BUDGET_PHONE)).toBe(3);
  });

  it('không vượt 3× và không dưới 1×', () => {
    expect(renderDpr(400, 800, 4, RENDER_BUDGET_PHONE)).toBe(3);
    expect(renderDpr(400, 800, 0.5, RENDER_BUDGET_PHONE)).toBe(1);
    expect(renderDpr(400, 800, Number.NaN, RENDER_BUDGET_PHONE)).toBe(1);
    expect(renderDpr(10000, 10000, 2, RENDER_BUDGET_DESKTOP)).toBe(1);
  });

  it('khung quá to → hạ cho vừa trần điểm ảnh', () => {
    const d = renderDpr(1920, 1080, 3, RENDER_BUDGET_DESKTOP);
    expect(d).toBeLessThan(3);
    expect(1920 * 1080 * d * d).toBeLessThanOrEqual(RENDER_BUDGET_DESKTOP + 1);
    // màn 5K vẫn đủ 2×
    expect(renderDpr(2560, 1440, 2, RENDER_BUDGET_DESKTOP)).toBe(2);
  });
});

describe('isIOSWebKit', () => {
  it('nhận iPhone, iPad (cả iPadOS báo "Macintosh" có cảm ứng)', () => {
    expect(isIOSWebKit({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15', maxTouchPoints: 5 })).toBe(true);
    expect(isIOSWebKit({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15', maxTouchPoints: 5 })).toBe(true);
  });
  it('máy Mac / Android / không có navigator → false', () => {
    expect(isIOSWebKit({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15', maxTouchPoints: 0 })).toBe(false);
    expect(isIOSWebKit({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/131 Mobile' })).toBe(false);
    expect(isIOSWebKit(undefined)).toBe(false);
  });
});
