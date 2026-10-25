// ============================================================================
// Chọn nguồn ảnh nền bản đồ đường phố (hàm thuần, có test — phần gắn Leaflet ở mapTiles.ts).
// ----------------------------------------------------------------------------
// OpenStreetMap là nguồn chính, nhưng một số mạng ở VN chặn hẳn tile.openstreetmap.org (kết nối
// hỏng ngay) → bản đồ xám trơn. Khi ảnh nền của nguồn đang dùng hỏng liên tiếp mà chưa tải được
// ảnh nào thì chuyển nguồn kế tiếp; nguồn tải được thì nhớ 24 giờ để lần mở sau dùng luôn
// (khỏi chớp xám), hết hạn thì thử lại OSM.
// ============================================================================

export const TILE_PROVIDER_KEYS = ['osm', 'osmfr', 'esri'] as const;
export type TileProviderKey = (typeof TILE_PROVIDER_KEYS)[number];

/** Nhớ nguồn chạy được bấy lâu. */
export const TILE_MEMORY_MS = 24 * 60 * 60 * 1000;
/** Hỏng liên tiếp bấy nhiêu ảnh (chưa ảnh nào tải được) thì chuyển nguồn. */
export const TILE_FAIL_LIMIT = 2;

/** Nguồn bắt đầu: nguồn đã nhớ (còn hạn) hoặc OSM. `stored` = chuỗi JSON đọc từ localStorage. */
export function startTileProvider(stored: string | null, now: number): number {
  if (!stored) return 0;
  try {
    const v = JSON.parse(stored) as { key?: unknown; at?: unknown };
    const i = TILE_PROVIDER_KEYS.indexOf(v.key as TileProviderKey);
    if (i < 0 || typeof v.at !== 'number' || now - v.at > TILE_MEMORY_MS || v.at > now) return 0;
    return i;
  } catch {
    return 0;
  }
}

export const rememberTileProvider = (index: number, now: number): string =>
  JSON.stringify({ key: TILE_PROVIDER_KEYS[index], at: now });

/** Chuyển sang nguồn kế tiếp? Chỉ khi chưa tải được ảnh nào và còn nguồn dự phòng. */
export function shouldFallback(loaded: number, failed: number, index: number): boolean {
  return loaded === 0 && failed >= TILE_FAIL_LIMIT && index < TILE_PROVIDER_KEYS.length - 1;
}
