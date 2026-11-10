// Nhà trọ ghi khi khảo sát KCN — phần thuần (đọc dữ liệu DB, chọn công ty gần để đo đường, định dạng, link chỉ đường).
// Có test (lodging.test.ts). Phần gọi Supabase / tải ảnh / gọi máy định tuyến ở lodgings.ts.

export type LodgingPhotoKind = 'house' | 'facility';

export interface LodgingPhoto {
  id: string;
  kind: LodgingPhotoKind;
  url: string;
  thumb_url: string;
  storage_path: string;
  caption: string;
  width: number | null;
  height: number | null;
}

/** Khoảng cách thực tế từ nhà trọ tới 1 công ty / KCN (tính lúc lưu). */
export interface LodgingRoute {
  /** khoá công ty (c:<client> / p:<pipeline> / l:<lead> / o:… / z:<KCN>) */
  key: string;
  name: string;
  /** nhãn loại: "Đang hợp tác", "KCN"… */
  kind: string;
  color: string;
  lat: number;
  lng: number;
  straight_m: number;
  moto_km: number | null;
  moto_min: number | null;
  walk_km: number | null;
  walk_min: number | null;
  /** 'valhalla' = đường thật theo xe máy / đi bộ · 'estimate' = ước theo đường ô tô */
  engine: 'valhalla' | 'estimate';
  at: string;
}

export interface Lodging {
  id: string;
  name: string;
  address: string;
  landlord_name: string;
  landlord_phone: string;
  total_rooms: number | null;
  vacant_rooms: number | null;
  rent_min: number | null;
  rent_max: number | null;
  facilities: string[];
  note: string;
  photos: LodgingPhoto[];
  lat: number | null;
  lng: number | null;
  position_source: 'gps' | 'exif' | 'manual';
  zone_id: string | null;
  zone_name: string;
  trip_id: string | null;
  routes: LodgingRoute[];
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
}

export const LODGING_FACILITIES = [
  'Wifi', 'Máy lạnh', 'WC riêng', 'Nóng lạnh', 'Gác lửng', 'Bếp riêng', 'Chỗ để xe', 'Máy giặt chung',
  'Camera an ninh', 'Giờ giấc tự do', 'Chủ ở riêng', 'Gần chợ / tạp hoá', 'Có nội thất',
] as const;

const str = (v: unknown, max = 500) => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const int = (v: unknown): number | null => { const n = num(v); return n == null ? null : Math.max(0, Math.round(n)); };

export function sanitizePhotos(raw: unknown): LodgingPhoto[] {
  if (!Array.isArray(raw)) return [];
  const out: LodgingPhoto[] = [];
  for (const p of raw.slice(0, 60)) {
    if (!p || typeof p !== 'object') continue;
    const o = p as Record<string, unknown>;
    const url = str(o.url, 1000);
    if (!/^(https?:|blob:)/.test(url)) continue;
    out.push({
      id: str(o.id, 60) || url,
      kind: o.kind === 'facility' ? 'facility' : 'house',
      url,
      thumb_url: str(o.thumb_url, 1000) || url,
      storage_path: str(o.storage_path, 400),
      caption: str(o.caption, 200),
      width: int(o.width), height: int(o.height),
    });
  }
  return out;
}

export function sanitizeRoutes(raw: unknown): LodgingRoute[] {
  if (!Array.isArray(raw)) return [];
  const out: LodgingRoute[] = [];
  for (const r of raw.slice(0, 40)) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const lat = num(o.lat), lng = num(o.lng);
    if (lat == null || lng == null) continue;
    out.push({
      key: str(o.key, 120), name: str(o.name, 200), kind: str(o.kind, 60), color: /^#[0-9a-f]{6}$/i.test(str(o.color)) ? str(o.color) : '#64748B',
      lat, lng, straight_m: num(o.straight_m) ?? 0,
      moto_km: num(o.moto_km), moto_min: num(o.moto_min), walk_km: num(o.walk_km), walk_min: num(o.walk_min),
      engine: o.engine === 'estimate' ? 'estimate' : 'valhalla',
      at: str(o.at, 40),
    });
  }
  return out;
}

export function normLodging(r: Record<string, unknown>): Lodging {
  return {
    id: str(r.id, 60),
    name: str(r.name, 200), address: str(r.address, 300),
    landlord_name: str(r.landlord_name, 120), landlord_phone: str(r.landlord_phone, 40),
    total_rooms: int(r.total_rooms), vacant_rooms: int(r.vacant_rooms),
    rent_min: int(r.rent_min), rent_max: int(r.rent_max),
    facilities: Array.isArray(r.facilities) ? r.facilities.filter((x): x is string => typeof x === 'string').slice(0, 40) : [],
    note: str(r.note, 2000),
    photos: sanitizePhotos(r.photos),
    lat: num(r.lat), lng: num(r.lng),
    position_source: r.position_source === 'manual' || r.position_source === 'exif' ? r.position_source : 'gps',
    zone_id: typeof r.zone_id === 'string' ? r.zone_id : null,
    zone_name: str(r.zone_name, 200),
    trip_id: typeof r.trip_id === 'string' ? r.trip_id : null,
    routes: sanitizeRoutes(r.routes),
    created_by: str(r.created_by, 120), updated_by: str(r.updated_by, 120),
    created_at: str(r.created_at, 40), updated_at: str(r.updated_at, 40),
  };
}

export interface RouteCandidate {
  key: string; name: string; kind: string; color: string; lat: number; lng: number;
  /** Chỉ đo khi người dùng tự chọn (VD tên lấy từ bản đồ OSM không rõ có phải công ty). */
  optional?: boolean;
}

/** Tên trên bản đồ trông giống công ty / nhà máy (không phải ngân hàng, quán, cửa hàng…). */
export const looksLikeCompany = (name: string) => /(tnhh|công ty|cong ty|\bcty\b|co\.?,?\s*ltd|\bltd\b|nhà máy|nha may|xí nghiệp|factory|\bcorp|\bvina|\bjsc\b|\binc\b|industr)/i.test(name);

/** Khoảng cách đường chim bay (mét). */
export function straightM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000, rad = Math.PI / 180;
  const dφ = (b.lat - a.lat) * rad, dλ = (b.lng - a.lng) * rad;
  const s = Math.sin(dφ / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dλ / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * Công ty để đo đường: gần nhất theo chim bay trong bán kính, bỏ trùng tên, luôn giữ các công ty người dùng tự thêm (`keep`).
 * Công ty đang hợp tác / Pipeline được ưu tiên giữ khi phải cắt bớt.
 */
export function pickRouteTargets(from: { lat: number; lng: number }, cands: readonly RouteCandidate[], opts: { max?: number; radiusM?: number; keep?: readonly string[] } = {}): (RouteCandidate & { straight_m: number })[] {
  const max = opts.max ?? 8, radius = opts.radiusM ?? 5000, keep = new Set(opts.keep ?? []);
  const seen = new Set<string>();
  const rows = cands
    .map(c => ({ ...c, straight_m: Math.round(straightM(from, c)) }))
    .filter(c => keep.has(c.key) || (!c.optional && c.straight_m <= radius))
    .sort((a, b) => a.straight_m - b.straight_m)
    .filter(c => {
      const k = c.name.trim().toLocaleLowerCase('vi');
      if (seen.has(k) && !keep.has(c.key)) return false;
      seen.add(k);
      return true;
    });
  const kept = rows.filter(r => keep.has(r.key));
  const rest = rows.filter(r => !keep.has(r.key)).slice(0, Math.max(0, max - kept.length));
  return [...kept, ...rest].sort((a, b) => a.straight_m - b.straight_m);
}

/** "2,5–3 triệu" / "từ 2,5 triệu" / "" */
export function fmtRent(min: number | null, max: number | null): string {
  const t = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0).replace('.', ',')} triệu` : `${Math.round(n / 1000)}k`);
  if (min != null && max != null && max !== min) return `${t(min).replace(' triệu', '')}–${t(max)}`;
  if (min != null) return t(min);
  if (max != null) return `đến ${t(max)}`;
  return '';
}

/** Nhập giá kiểu Việt: "2.5tr", "2tr5", "2500000", "2,5" (≤ 100 → hiểu là triệu), "1500k". */
export function parseRent(raw: string): number | null {
  const s = raw.trim().toLowerCase().replace(/\s+/g, '').replace(/đ|vnd|\/tháng|\/th/g, '');
  if (!s) return null;
  let m = s.match(/^(\d+)(?:tr|triệu|trieu|m)(\d{1,3})?$/);
  if (m) return Number(m[1]) * 1_000_000 + (m[2] ? Number(m[2].padEnd(3, '0')) * 1000 : 0);
  m = s.match(/^(\d+(?:[.,]\d+)?)(tr|triệu|trieu|m)$/);
  if (m) return Math.round(Number(m[1].replace(',', '.')) * 1_000_000);
  m = s.match(/^(\d+(?:[.,]\d+)?)k$/);
  if (m) return Math.round(Number(m[1].replace(',', '.')) * 1000);
  if (/^\d{1,3}([.,]\d{3})+$/.test(s)) return Number(s.replace(/[.,]/g, ''));
  const n = Number(s.replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return null;
  return n <= 100 ? Math.round(n * 1_000_000) : Math.round(n);
}

/** Số điện thoại để gọi / Zalo: bỏ ký tự thừa, +84 → 0. */
export function phoneDigits(raw: string): string {
  const d = raw.replace(/[^\d+]/g, '');
  return d.startsWith('+84') ? `0${d.slice(3)}` : d.startsWith('84') && d.length >= 11 ? `0${d.slice(2)}` : d.replace(/\+/g, '');
}

/** Link chỉ đường Google Maps (xe máy / đi bộ) — xem đường đi thật trên điện thoại. */
export function directionsLink(from: { lat: number; lng: number }, to: { lat: number; lng: number }, mode: 'moto' | 'walk'): string {
  return `https://www.google.com/maps/dir/?api=1&origin=${from.lat},${from.lng}&destination=${to.lat},${to.lng}&travelmode=${mode === 'moto' ? 'two-wheeler' : 'walking'}`;
}

export function fmtMin(min: number | null): string {
  if (min == null) return '—';
  if (min < 60) return `${Math.max(1, Math.round(min))} phút`;
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return m ? `${h} giờ ${m} phút` : `${h} giờ`;
}

export function fmtKm(km: number | null): string {
  if (km == null) return '—';
  return km < 1 ? `${Math.round(km * 1000 / 10) * 10} m` : `${km.toFixed(1).replace('.', ',')} km`;
}

/** Tên tự đặt khi chưa gõ: "Nhà trọ cô Lan", "Nhà trọ 0909…" */
export function lodgingTitle(l: Pick<Lodging, 'name' | 'landlord_name' | 'landlord_phone'>): string {
  if (l.name.trim()) return l.name.trim();
  if (l.landlord_name.trim()) return `Nhà trọ ${l.landlord_name.trim()}`;
  if (l.landlord_phone.trim()) return `Nhà trọ ${l.landlord_phone.trim()}`;
  return 'Nhà trọ';
}
