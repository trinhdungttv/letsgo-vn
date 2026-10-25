import { describe, expect, it } from 'vitest';
import { rememberTileProvider, shouldFallback, startTileProvider, TILE_MEMORY_MS } from './mapTileChoice';

const NOW = Date.UTC(2026, 9, 25, 1, 0, 0);

describe('chọn nguồn ảnh nền bản đồ', () => {
  it('chưa nhớ gì / dữ liệu hỏng → bắt đầu bằng OpenStreetMap', () => {
    expect(startTileProvider(null, NOW)).toBe(0);
    expect(startTileProvider('{oops', NOW)).toBe(0);
    expect(startTileProvider(JSON.stringify({ key: 'google', at: NOW }), NOW)).toBe(0);
  });

  it('nhớ nguồn dự phòng chạy được trong 24 giờ, hết hạn thì thử lại OSM', () => {
    expect(startTileProvider(rememberTileProvider(1, NOW), NOW + 60_000)).toBe(1);
    expect(startTileProvider(rememberTileProvider(3, NOW), NOW + TILE_MEMORY_MS - 1)).toBe(3);
    expect(startTileProvider(rememberTileProvider(1, NOW), NOW + TILE_MEMORY_MS + 1)).toBe(0);
    expect(startTileProvider(rememberTileProvider(1, NOW + 60_000), NOW)).toBe(0); // giờ máy lùi → không tin
  });

  it('chuyển nguồn khi hỏng liên tiếp mà chưa tải được ảnh nào; nguồn cuối thì thôi', () => {
    expect(shouldFallback(0, 1, 0)).toBe(false);
    expect(shouldFallback(0, 2, 0)).toBe(true);
    expect(shouldFallback(3, 5, 0)).toBe(false); // đã tải được ảnh — chỉ là vài ảnh lỗi lẻ
    expect(shouldFallback(0, 9, 2)).toBe(true);
    expect(shouldFallback(0, 9, 3)).toBe(false); // hết nguồn dự phòng
  });
});
