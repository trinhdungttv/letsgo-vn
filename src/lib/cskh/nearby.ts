// ============================================================================
// CSKH — Định vị địa chỉ người liên hệ (port PRM nearby.ts)
// ----------------------------------------------------------------------------
// Dịch vụ cộng đồng OpenStreetMap (miễn phí, không cần API key): Nominatim đổi địa chỉ chữ
// sang toạ độ; toạ độ trong link Google Maps đầy đủ thì trích thẳng; link rút gọn
// (maps.app.goo.gl) phải mở ở server (api/resolve-map.ts) vì trình duyệt bị CORS.
// File này KHÔNG import gì ngoài lib/geo (thuần fetch) để api/resolve-map dùng chung được.
// ============================================================================
import { nominatimGeocode } from '../geo';

export interface LatLng {
  lat: number;
  lng: number;
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * Toạ độ trong link Google Maps ĐẦY ĐỦ (link rút gọn không có). Ưu tiên ghim địa điểm
 * "!3dLAT!4dLNG", rồi tâm khung nhìn "@lat,lng", rồi "?q=lat,lng" / "query=" / "ll=".
 */
export function extractLatLng(mapUrl: string): LatLng | null {
  const url = safeDecode(mapUrl);
  const m = url.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/)
    ?? url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/)
    ?? url.match(/[?&](?:q|query|ll|center|destination)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}

/** Link rút gọn của Google Maps (chia sẻ từ điện thoại) — phải mở qua server mới biết toạ độ. */
export function isShortMapLink(url: string): boolean {
  try {
    const u = new URL(url.trim());
    return u.protocol === 'https:' && (u.hostname === 'maps.app.goo.gl'
      || (u.hostname === 'goo.gl' && u.pathname.startsWith('/maps')) || u.hostname === 'g.co');
  } catch {
    return false;
  }
}

/** Tên miền Google được phép đi theo khi mở link rút gọn (chống dùng API để gọi trang khác). */
export function isGoogleMapsHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === 'maps.app.goo.gl' || h === 'goo.gl' || h === 'g.co'
    || /^(www\.|maps\.)?google\.(com|co\.[a-z]{2}|com\.[a-z]{2}|[a-z]{2})$/.test(h);
}

/** Tên nơi trong link "/maps/place/<tên>/…" (VD "Cầu Ngang, Trà Vinh"); '' nếu không có. */
export function placeNameFromLink(url: string): string {
  const m = url.match(/\/maps\/place\/([^/@?]+)/);
  return m ? safeDecode(m[1].replace(/\+/g, ' ')).trim() : '';
}

/** Phường / xã / thị trấn — tên cũ nhiều nơi đã đổi sau sáp nhập 2025, dễ khớp nhầm nơi khác. */
const WARD_RE = /^(phường|phuong|p\.|xã|xa|thị trấn|thi tran|tt\.)\s*/i;
/** Số nhà / hẻm / ngõ ở đầu đoạn đầu: "220/51/2C", "Số 12", "Hẻm 45", "Ngõ 3", "Kiệt 7". */
const HOUSE_RE = /^\s*((số|so|hẻm|hem|ngõ|ngo|ngách|ngach|kiệt|kiet)\s+)?\d[\w/.-]*\s+/i;

/**
 * Các cách hỏi Nominatim, từ chính xác tới gần đúng: cả địa chỉ → bỏ số nhà/hẻm → bỏ thêm
 * phường → chỉ còn quận/huyện trở đi. KHÔNG bỏ nguyên đoạn đầu (tên đường): "Phường 5,
 * Bình Thạnh" bị khớp nhầm "Phường 5" ở quận khác.
 */
export function addressQueries(address: string): string[] {
  const parts = address.split(/,|\n/).map(x => x.trim()).filter(Boolean);
  if (parts.length === 0) return [];
  const out = [parts.join(', ')];
  const street = parts[0].replace(HOUSE_RE, '').trim();
  const rest = parts.slice(1);
  const restNoWard = rest.filter(x => !WARD_RE.test(x));
  if (street && street !== parts[0]) out.push([street, ...rest].join(', '));
  if (street && restNoWard.length < rest.length) out.push([street, ...restNoWard].join(', '));
  for (let i = 0; i < restNoWard.length - 1; i += 1) out.push(restNoWard.slice(i).join(', '));
  return [...new Set(out)];
}

/** Nominatim cho tối đa 1 yêu cầu/giây. */
export const NOMINATIM_DELAY_MS = 1100;

/**
 * Định vị địa chỉ theo addressQueries; chỉ cách đầu (cả địa chỉ) mới là `precise` — còn lại
 * giao diện nhắc chấm lại cho đúng nhà. Giữa các lần thử nghỉ ~1,1 giây.
 */
export async function geocodeAddressDetailed(
  address: string,
  geocode: (q: string) => Promise<LatLng | null> = nominatimGeocode,
  wait: (ms: number) => Promise<unknown> = ms => new Promise(r => setTimeout(r, ms)),
): Promise<(LatLng & { precise: boolean }) | null> {
  const queries = addressQueries(address);
  for (let i = 0; i < queries.length; i += 1) {
    if (i > 0) await wait(NOMINATIM_DELAY_MS);
    const found = await geocode(queries[i]);
    if (found) return { ...found, precise: i === 0 };
  }
  return null;
}
