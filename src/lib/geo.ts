// Tiện ích toạ độ bản đồ: parse link Google Maps + geocode Nominatim (OSM).

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

/** Geocode một địa chỉ/tên qua Nominatim. Người gọi tự chịu trách nhiệm rate-limit 1 req/s. */
export async function nominatimGeocode(query: string): Promise<LatLng | null> {
  const url =
    'https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=vn&q=' +
    encodeURIComponent(query);
  try {
    const res = await fetch(url, { headers: { 'Accept-Language': 'vi' } });
    if (!res.ok) return null;
    const data: { lat: string; lon: string }[] = await res.json();
    if (!data?.length) return null;
    return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
  } catch {
    return null;
  }
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
 * Người gọi tự chịu trách nhiệm rate-limit 1 req/s.
 */
export async function nominatimGeocodeBoundary(query: string): Promise<GeoBoundary | null> {
  const url =
    'https://nominatim.openstreetmap.org/search?format=json&limit=5&countrycodes=vn' +
    '&polygon_geojson=1&polygon_threshold=0.0001&q=' + encodeURIComponent(query);
  try {
    const res = await fetch(url, { headers: { 'Accept-Language': 'vi' } });
    if (!res.ok) return null;
    interface Item {
      lat: string; lon: string;
      class?: string; type?: string; osm_type?: string;
      geojson?: { type: string; coordinates: unknown };
    }
    const data: Item[] = await res.json();
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
  } catch {
    return null;
  }
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
 */
export async function nominatimBoundaryNear(query: string, near: LatLng): Promise<GeoBoundary | null> {
  const url =
    'https://nominatim.openstreetmap.org/search?format=json&limit=10&countrycodes=vn' +
    '&polygon_geojson=1&polygon_threshold=0.0001&q=' + encodeURIComponent(query);
  try {
    const res = await fetch(url, { headers: { 'Accept-Language': 'vi' } });
    if (!res.ok) return null;
    interface Item {
      lat: string; lon: string;
      class?: string;
      geojson?: { type: string; coordinates: unknown };
    }
    const data: Item[] = await res.json();
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
  } catch {
    return null;
  }
}

/** Kiểm tra toạ độ hợp lệ nằm trong khung Việt Nam (loại trừ 0,0 hoặc parse lỗi). */
export function isValidVnLatLng(p: LatLng | null): p is LatLng {
  return !!p && p.lat >= 7 && p.lat <= 24.5 && p.lng >= 101 && p.lng <= 111;
}
