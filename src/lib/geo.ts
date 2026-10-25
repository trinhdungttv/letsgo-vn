// Tiện ích toạ độ bản đồ: parse link Google Maps + geocode Nominatim (OSM).
// Một số mạng ở VN chặn hẳn *.openstreetmap.org (cả ảnh nền lẫn Nominatim — kết nối hỏng ngay).
// Khi đó tự chuyển sang Photon (photon.komoot.io — tìm kiếm trên dữ liệu OSM, máy chủ khác) và
// nhớ "Nominatim bị chặn" 24 giờ để khỏi thử lại từng lần. Photon chỉ có toạ độ điểm, KHÔNG có
// ranh giới polygon (xã/phường) — nominatimBoundaryNear khi đó trả null.

export interface LatLng {
  lat: number;
  lng: number;
}

/** Parse toạ độ từ link Google Maps: ưu tiên !3d..!4d.. (vị trí marker), rồi @lat,lng, rồi q=/ll=. */
export function parseLatLngFromLink(link: string | null | undefined): LatLng | null {
  if (!link) return null;
  let m = link.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  if (m) return { lat: +m[1], lng: +m[2] };
  m = link.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (m) return { lat: +m[1], lng: +m[2] };
  m = link.match(/[?&](?:q|ll|query|destination)=(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
  if (m) return { lat: +m[1], lng: +m[2] };
  return null;
}

export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ── Nominatim → Photon khi bị chặn ───────────────────────────────────────────
const NOMINATIM_SEARCH = 'https://nominatim.openstreetmap.org/search';
const PHOTON_API = 'https://photon.komoot.io/api/';
/** Khung Việt Nam cho Photon: minLon,minLat,maxLon,maxLat. */
const VN_BBOX = '102.1,8.2,109.6,23.4';
const BLOCK_KEY = 'lgvn_geocoder_blocked_v1';
/** Nhớ "Nominatim bị chặn" bấy lâu, hết hạn thì thử lại. */
export const GEOCODER_BLOCK_MS = 24 * 60 * 60 * 1000;

/** Còn đang nhớ Nominatim bị chặn? `stored` = chuỗi đọc từ localStorage (thời điểm ms). */
export function geocoderBlocked(stored: string | null, now: number): boolean {
  const at = Number(stored);
  return !!stored && Number.isFinite(at) && at <= now && now - at < GEOCODER_BLOCK_MS;
}

function readBlock(): string | null {
  try { return localStorage.getItem(BLOCK_KEY); } catch { return null; }
}
function writeBlock(now: number) {
  try { localStorage.setItem(BLOCK_KEY, String(now)); } catch { /* chế độ riêng tư — lần sau dò lại */ }
}

/**
 * Điểm đầu tiên trong kết quả Photon (GeoJSON) nằm trong Việt Nam. Photon tìm "gần đúng" nên
 * luôn trả gì đó — chỉ nhận điểm có countrycode VN (hoặc không ghi) và toạ độ trong khung VN.
 */
export function pickPhotonPoint(data: unknown): LatLng | null {
  const features = (data as { features?: unknown })?.features;
  if (!Array.isArray(features)) return null;
  for (const f of features as { geometry?: { type?: string; coordinates?: unknown }; properties?: { countrycode?: string } }[]) {
    const c = f?.geometry?.type === 'Point' ? f.geometry.coordinates : null;
    if (!Array.isArray(c) || c.length < 2) continue;
    const p = { lat: Number(c[1]), lng: Number(c[0]) };
    const cc = f.properties?.countrycode;
    if ((cc === undefined || cc === 'VN') && isValidVnLatLng(p)) return p;
  }
  return null;
}

type NominatimResult<T> = { kind: 'data'; data: T } | { kind: 'error' } | { kind: 'blocked'; fresh: boolean };

/** Gọi Nominatim. Lỗi kết nối / 403 = bị chặn (fresh: vừa phát hiện); lỗi HTTP khác = 'error'. */
async function nominatimSearch<T>(params: Record<string, string>): Promise<NominatimResult<T>> {
  if (geocoderBlocked(readBlock(), Date.now())) return { kind: 'blocked', fresh: false };
  let res: Response;
  try {
    res = await fetch(`${NOMINATIM_SEARCH}?${new URLSearchParams(params).toString()}`, { headers: { 'Accept-Language': 'vi' } });
  } catch {
    return { kind: 'blocked', fresh: true };
  }
  if (res.status === 403) return { kind: 'blocked', fresh: true };
  if (!res.ok) return { kind: 'error' };
  try {
    return { kind: 'data', data: (await res.json()) as T };
  } catch {
    return { kind: 'error' };
  }
}

/**
 * Tra qua Photon. Nominatim vừa hỏng mà Photon vẫn vào được → mạng còn chạy, chính Nominatim bị
 * chặn → nhớ 24 giờ (mất mạng hẳn thì không nhớ nhầm).
 */
async function photonGeocode(query: string, freshBlock: boolean): Promise<LatLng | null> {
  try {
    const res = await fetch(`${PHOTON_API}?${new URLSearchParams({ q: query, limit: '5', bbox: VN_BBOX }).toString()}`);
    if (freshBlock) writeBlock(Date.now());
    if (!res.ok) return null;
    return pickPhotonPoint(await res.json());
  } catch {
    return null;
  }
}

/**
 * Geocode một địa chỉ/tên trong Việt Nam: Nominatim, bị chặn thì Photon. Người gọi tự chịu trách
 * nhiệm giãn cách ~1 yêu cầu/giây (quy định Nominatim, lịch sự với Photon).
 */
export async function nominatimGeocode(query: string): Promise<LatLng | null> {
  const r = await nominatimSearch<{ lat: string; lon: string }[]>({ format: 'json', limit: '1', countrycodes: 'vn', q: query });
  if (r.kind === 'data') return r.data?.length ? { lat: parseFloat(r.data[0].lat), lng: parseFloat(r.data[0].lon) } : null;
  if (r.kind === 'error') return null;
  return photonGeocode(query, r.fresh);
}

/** Khoảng cách đường chim bay giữa hai toạ độ (km) theo công thức haversine. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export interface GeoBoundary {
  lat: number;
  lng: number;
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon | null;
}

/**
 * Geocode kèm ranh giới polygon (OSM boundary) qua Nominatim — dùng cho xã/phường.
 * Ưu tiên kết quả là boundary/administrative có polygon; không có thì trả toạ độ điểm.
 * Nominatim bị chặn → toạ độ điểm từ Photon (không có polygon).
 * Người gọi tự chịu trách nhiệm rate-limit 1 req/s.
 */
export async function nominatimGeocodeBoundary(query: string): Promise<GeoBoundary | null> {
  interface Item {
    lat: string; lon: string;
    class?: string; type?: string; osm_type?: string;
    geojson?: { type: string; coordinates: unknown };
  }
  const r = await nominatimSearch<Item[]>({
    format: 'json', limit: '5', countrycodes: 'vn', polygon_geojson: '1', polygon_threshold: '0.0001', q: query,
  });
  if (r.kind === 'blocked') {
    const p = await photonGeocode(query, r.fresh);
    return p ? { ...p, geometry: null } : null;
  }
  if (r.kind === 'error') return null;
  const data = r.data;
  if (!data?.length) return null;
  const isPoly = (g?: Item['geojson']) => g && (g.type === 'Polygon' || g.type === 'MultiPolygon');
  // Ưu tiên: boundary hành chính có polygon → bất kỳ kết quả nào có polygon → kết quả đầu (điểm).
  const best =
    data.find(d => d.class === 'boundary' && isPoly(d.geojson)) ??
    data.find(d => isPoly(d.geojson)) ??
    data[0];
  return {
    lat: parseFloat(best.lat),
    lng: parseFloat(best.lon),
    geometry: isPoly(best.geojson) ? (best.geojson as unknown as GeoJSON.Polygon | GeoJSON.MultiPolygon) : null,
  };
}

/** Parse link Google Maps dạng /maps/place/<Tên>/@lat,lng — lấy tên địa danh + toạ độ. */
export function parseGmapsPlaceLink(link: string): { name: string; lat: number; lng: number } | null {
  const m = link.match(/\/maps\/place\/([^/@]+)\/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (!m) return null;
  let name = m[1].replace(/\+/g, ' ');
  try { name = decodeURIComponent(name); } catch { /* giữ nguyên nếu decode lỗi */ }
  // Toạ độ marker (!3d!4d) chính xác hơn toạ độ khung nhìn (@lat,lng) nếu có.
  const marker = parseLatLngFromLink(link);
  return { name: name.trim(), lat: marker?.lat ?? +m[2], lng: marker?.lng ?? +m[3] };
}

/**
 * Tìm ranh giới hành chính trên OSM theo tên, ưu tiên boundary có polygon GẦN toạ độ `near`
 * nhất (tránh nhầm phường/xã trùng tên ở tỉnh khác). Quá 50km coi như không khớp.
 * Nominatim bị chặn → null (Photon không có polygon).
 */
export async function nominatimBoundaryNear(query: string, near: LatLng): Promise<GeoBoundary | null> {
  interface Item {
    lat: string; lon: string;
    class?: string;
    geojson?: { type: string; coordinates: unknown };
  }
  const r = await nominatimSearch<Item[]>({
    format: 'json', limit: '10', countrycodes: 'vn', polygon_geojson: '1', polygon_threshold: '0.0001', q: query,
  });
  if (r.kind !== 'data') return null;
  const data = r.data;
  if (!data?.length) return null;
  const isPoly = (g?: Item['geojson']) => g && (g.type === 'Polygon' || g.type === 'MultiPolygon');
  const withPoly = data.filter(d => isPoly(d.geojson));
  const pool = withPoly.filter(d => d.class === 'boundary');
  const candidates = (pool.length ? pool : withPoly)
    .map(d => ({ d, dist: haversineKm(near, { lat: +d.lat, lng: +d.lon }) }))
    .filter(x => x.dist <= 50)
    .sort((a, b) => a.dist - b.dist);
  if (!candidates.length) return null;
  const best = candidates[0].d;
  return {
    lat: parseFloat(best.lat),
    lng: parseFloat(best.lon),
    geometry: best.geojson as unknown as GeoJSON.Polygon | GeoJSON.MultiPolygon,
  };
}

/** Kiểm tra toạ độ hợp lệ nằm trong khung Việt Nam (loại trừ 0,0 hoặc parse lỗi). */
export function isValidVnLatLng(p: LatLng | null): p is LatLng {
  return !!p && p.lat >= 7 && p.lat <= 24.5 && p.lng >= 101 && p.lng <= 111;
}

export type MapLinkStatus = 'ok' | 'short' | 'bad';

/** Đánh giá link Google Maps có "dùng được" cho tab Bản đồ không (đọc được toạ độ trong VN).
 * null = ô trống. 'short' = link rút gọn (maps.app.goo.gl…) — app không đọc được toạ độ từ đó. */
export function mapLinkStatus(link: string | null | undefined): MapLinkStatus | null {
  const l = (link ?? '').trim();
  if (!l) return null;
  if (isValidVnLatLng(parseLatLngFromLink(l))) return 'ok';
  if (/maps\.app\.goo\.gl|goo\.gl\/maps/i.test(l)) return 'short';
  return 'bad';
}

export const MAP_LINK_STATUS_TEXT: Record<MapLinkStatus, { cls: string; text: string }> = {
  ok: { cls: 'text-emerald-600', text: '✓ Đọc được toạ độ' },
  short: { cls: 'text-amber-600', text: '⚠ Link rút gọn — mở link, copy lại link dài trên thanh địa chỉ' },
  bad: { cls: 'text-red-600', text: '✗ Không có toạ độ (cần dạng …/@lat,lng… hoặc …!3d…!4d…)' },
};
