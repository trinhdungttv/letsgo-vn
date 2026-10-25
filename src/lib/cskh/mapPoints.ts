// ============================================================================
// CSKH — Điểm trên Bản đồ Khách hàng: 3 lớp, độ chính xác, khoảng cách, ai ở gần
// (port PRM mapPoints.ts, chỉnh cho LetsGo)
// ----------------------------------------------------------------------------
//   company  vị trí công ty khách hàng (clients.lat/lng) — mặc định (chốt 19/10/2026)
//   current  nhà hiện tại (contacts.lat/lng — từ link Maps, chấm tay hoặc tra chữ)
//   origin   quê quán theo TỈNH (origin_province) → vẽ ở tâm tỉnh, luôn "tương đối"
// Chính xác / Tương đối (chốt 24/10/2026, không cần công tắc): có link Google Maps hoặc đã
// chấm tay = Chính xác; chỉ có chữ địa chỉ = Tương đối; quê quán luôn tương đối.
// ============================================================================
import { extractLatLng, type LatLng } from './nearby';
import type { CskhContact, GeoSource } from './types';

export type MapLayer = 'company' | 'current' | 'origin';

export const MAP_LAYER_LABEL: Readonly<Record<MapLayer, string>> = {
  company: 'Vị trí công ty',
  current: 'Nơi ở hiện tại',
  origin: 'Quê quán (theo tỉnh)',
};

export type AddressPrecision = 'precise' | 'approx' | 'none';

/** Độ chính xác của địa chỉ nhà hiện tại — tự suy từ link Maps / chấm tay. */
export function addressPrecision(c: { address: string; mapUrl: string; geoSource: GeoSource }): AddressPrecision {
  if (c.mapUrl.trim() !== '' || c.geoSource === 'manual') return 'precise';
  return c.address.trim() !== '' ? 'approx' : 'none';
}

/** Toạ độ nhà hiện tại đã lưu; chưa có thì trích thẳng từ link Maps đầy đủ. */
export function currentPoint(c: Pick<CskhContact, 'lat' | 'lng' | 'mapUrl'>): LatLng | null {
  if (c.lat !== null && c.lng !== null) return { lat: c.lat, lng: c.lng };
  return extractLatLng(c.mapUrl);
}

/** Câu tra Nominatim cho tâm tỉnh quê: bỏ hậu tố "(cũ)". */
export function provinceGeoQuery(province: string): string {
  const name = province.trim().replace(/\s*\((cũ|cu)\)\s*$/i, '').trim();
  return name ? `${name}, Việt Nam` : '';
}

export interface MapPoint extends LatLng {
  contact: CskhContact;
  /** Vị trí tương đối (tâm tỉnh quê, địa chỉ tra chữ…) — ghim có "~". */
  approx: boolean;
  /** Dòng phụ trong popup (công ty / địa chỉ / tỉnh). */
  sub: string;
}

/**
 * Điểm theo lớp. `companyGeo`: id công ty → toạ độ + tên; `provinceGeo`: tên tỉnh → tâm tỉnh
 * (tra 1 lần rồi nhớ trong máy). Người không có vị trí ở lớp đó thì bỏ qua.
 */
export function layerPoints(
  contacts: readonly CskhContact[],
  layer: MapLayer,
  companyGeo: ReadonlyMap<string, LatLng & { name: string }>,
  provinceGeo: ReadonlyMap<string, LatLng>,
): MapPoint[] {
  const out: MapPoint[] = [];
  for (const c of contacts) {
    if (layer === 'company') {
      const id = [...c.primaryClientIds, ...c.clientIds].find(x => companyGeo.has(x));
      const g = id ? companyGeo.get(id) : undefined;
      if (g) out.push({ lat: g.lat, lng: g.lng, contact: c, approx: false, sub: g.name });
    } else if (layer === 'current') {
      const p = currentPoint(c);
      if (p) out.push({ ...p, contact: c, approx: addressPrecision(c) !== 'precise', sub: c.address || c.province });
    } else {
      const p = c.originProvince ? provinceGeo.get(c.originProvince) : undefined;
      if (p) out.push({ lat: p.lat, lng: p.lng, contact: c, approx: true, sub: `Quê ${c.originProvince}` });
    }
  }
  return out;
}

/** Khoảng cách đường chim bay (km), công thức haversine. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** "850 m" / "3,4 km" / "125 km". */
export function fmtDistance(km: number): string {
  if (km < 1) return `${Math.max(10, Math.round((km * 1000) / 10) * 10)} m`;
  if (km < 100) return `${km.toFixed(1).replace('.', ',')} km`;
  return `${Math.round(km)} km`;
}

/** "12 phút" / "1 giờ 05 phút". */
export function fmtDuration(seconds: number): string {
  const m = Math.max(1, Math.round(seconds / 60));
  if (m < 60) return `${m} phút`;
  return `${Math.floor(m / 60)} giờ ${String(m % 60).padStart(2, '0')} phút`;
}

/** n điểm gần `from` nhất (chim bay), kèm khoảng cách. */
export function nearestPoints<T extends LatLng>(points: readonly T[], from: LatLng, n = 8): (T & { km: number })[] {
  return points
    .map(p => ({ ...p, km: haversineKm(from, p) }))
    .sort((a, b) => a.km - b.km)
    .slice(0, n);
}

export interface GeoState {
  address: string;
  mapUrl: string;
  lat: number | null;
  lng: number | null;
  geoSource: GeoSource;
}

export type GeoPlan =
  | { kind: 'keep' }
  | { kind: 'clear' }
  | { kind: 'set'; lat: number; lng: number; source: GeoSource }
  | { kind: 'geocode'; address: string };

/**
 * Toạ độ nhà hiện tại khi lưu hồ sơ — ưu tiên: chấm tay > link Maps > tra chữ.
 *   • `manualPin`: vừa chấm / kéo ghim trong lần sửa này.
 *   • `linkCoords`: toạ độ đọc được từ link (link rút gọn đã mở qua server).
 * Chấm tay cũ được giữ khi địa chỉ + link không đổi; đổi địa chỉ / link thì tính lại.
 */
export function planGeo(current: GeoState, next: { address: string; mapUrl: string }, manualPin: LatLng | null, linkCoords: LatLng | null): GeoPlan {
  const address = next.address.trim();
  const link = next.mapUrl.trim();
  if (manualPin) return { kind: 'set', lat: manualPin.lat, lng: manualPin.lng, source: 'manual' };
  // Không đổi địa chỉ lẫn link mà đã có toạ độ → giữ (kể cả khi lần này không mở được link rút gọn)
  const unchanged = address === current.address.trim() && link === current.mapUrl.trim();
  if (unchanged && current.lat !== null && current.geoSource !== '') return { kind: 'keep' };
  if (linkCoords) {
    const same = current.lat === linkCoords.lat && current.lng === linkCoords.lng && current.geoSource === 'map_url';
    return same ? { kind: 'keep' } : { kind: 'set', lat: linkCoords.lat, lng: linkCoords.lng, source: 'map_url' };
  }
  if (address) {
    // Đã tra chữ đúng địa chỉ này rồi thì thôi (Nominatim là dịch vụ miễn phí, gọi ít thôi)
    if (address === current.address.trim() && current.lat !== null && current.geoSource === 'address') return { kind: 'keep' };
    return { kind: 'geocode', address };
  }
  return current.lat === null && current.geoSource === '' ? { kind: 'keep' } : { kind: 'clear' };
}
