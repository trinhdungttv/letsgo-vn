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

/** Kiểm tra toạ độ hợp lệ nằm trong khung Việt Nam (loại trừ 0,0 hoặc parse lỗi). */
export function isValidVnLatLng(p: LatLng | null): p is LatLng {
  return !!p && p.lat >= 7 && p.lat <= 24.5 && p.lng >= 101 && p.lng <= 111;
}
