// Mặt bằng nhà xưởng vẽ TRỰC TIẾP trên bản đồ vệ tinh (tab "Mặt bằng" → "Bản đồ vệ tinh") — phần thuần, có test.
// Khối nhà / nhãn lưu theo toạ độ thật (lat, lng) → đúng vị trí dù xoay hay phóng to; hướng xoay (bearing) và
// khung nhìn lưu kèm để lần sau mở ra đúng hình đã cân chỉnh.
//
// Bản đồ tự dựng (không dùng Leaflet) vì Leaflet không xoay được: ảnh vệ tinh (ô vuông 256px, Web Mercator) xếp trong
// một khung xoay bằng CSS, còn khối nhà / chữ được tính toạ độ màn hình ở đây (đã tính cả góc xoay) nên bấm / kéo luôn đúng chỗ.
import { ZONE_COLORS, isZoneColor } from './siteZones';

export interface GeoPt { lat: number; lng: number }
export interface Pt { x: number; y: number }

/** Khối nhà (≥ 3 điểm) hoặc nhãn rời (1 điểm). */
export interface GeoZone {
  id: string;
  /** tên ngắn hiện trên bản đồ: "B5", "Kho TN" */
  label: string;
  /** xưởng làm gì: "Gia vị", "H. Nhân", "Kho" */
  note: string;
  color: string;
  pts: GeoPt[];
  /** cỡ chữ: 0.75 nhỏ · 1 vừa · 1.4 lớn */
  size?: number;
}

export interface SiteGeo {
  v: 1;
  /** tâm khung nhìn */
  center: GeoPt;
  zoom: number;
  /** góc xoay bản đồ theo chiều kim đồng hồ (độ), 0 = Bắc ở trên */
  bearing: number;
  /** vị trí nhà máy đã ghim lúc tạo (ghim đỏ) */
  origin?: GeoPt;
  zones: GeoZone[];
}

export const TILE = 256;
export const MIN_ZOOM = 14;
export const MAX_ZOOM = 21;
/** Esri không có ảnh sâu hơn mức này ở Việt Nam → phóng thêm bằng cách giãn ảnh. */
export const MAX_NATIVE_ZOOM = 19;
export const DEFAULT_ZOOM = 18;
const MAX_ZONES = 300;
const MAX_PTS = 200;
export const TILE_URL = (z: number, x: number, y: number) =>
  `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const r6 = (n: number) => Math.round(n * 1e6) / 1e6;

export const clampZoom = (z: number) => clamp(z, MIN_ZOOM, MAX_ZOOM);

/** Góc về khoảng (-180, 180]. */
export function normBearing(b: number): number {
  if (!Number.isFinite(b)) return 0;
  const x = Math.round(((((b + 180) % 360) + 360) % 360 - 180) * 1000) / 1000;
  return x === -180 ? 180 : x;
}

// ── Web Mercator ───────────────────────────────────────────────────────────
export function project(p: GeoPt, z: number): Pt {
  const s = TILE * 2 ** z;
  const sin = Math.sin(rad(clamp(p.lat, -85.0511, 85.0511)));
  return { x: ((p.lng + 180) / 360) * s, y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * s };
}

export function unproject(pt: Pt, z: number): GeoPt {
  const s = TILE * 2 ** z;
  const n = Math.PI - (2 * Math.PI * pt.y) / s;
  return { lat: deg(Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)))), lng: (pt.x / s) * 360 - 180 };
}

/** Xoay vector theo chiều kim đồng hồ `d` độ (trục y hướng xuống — giống CSS rotate). */
export function rot(v: Pt, d: number): Pt {
  const c = Math.cos(rad(d)), s = Math.sin(rad(d));
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

// ── Khung nhìn ─────────────────────────────────────────────────────────────
export interface View { center: GeoPt; zoom: number; bearing: number; w: number; h: number }

export function toScreen(v: View, p: GeoPt): Pt {
  const c = project(v.center, v.zoom), q = project(p, v.zoom);
  const d = rot({ x: q.x - c.x, y: q.y - c.y }, v.bearing);
  return { x: v.w / 2 + d.x, y: v.h / 2 + d.y };
}

export function fromScreen(v: View, s: Pt): GeoPt {
  const c = project(v.center, v.zoom);
  const d = rot({ x: s.x - v.w / 2, y: s.y - v.h / 2 }, -v.bearing);
  return unproject({ x: c.x + d.x, y: c.y + d.y }, v.zoom);
}

/** Dời khung nhìn khi kéo nội dung (dx, dy) điểm ảnh trên màn hình. */
export function panBy(v: View, dx: number, dy: number): GeoPt {
  const c = project(v.center, v.zoom);
  const d = rot({ x: dx, y: dy }, -v.bearing);
  return unproject({ x: c.x - d.x, y: c.y - d.y }, v.zoom);
}

/** Đổi mức phóng mà điểm `at` trên màn hình vẫn đứng yên (phóng theo con trỏ). */
export function zoomAround(v: View, at: Pt, zoom: number): { center: GeoPt; zoom: number } {
  const z = clampZoom(zoom);
  const g = fromScreen(v, at);
  const d = rot({ x: at.x - v.w / 2, y: at.y - v.h / 2 }, -v.bearing);
  const gp = project(g, z);
  return { center: unproject({ x: gp.x - d.x, y: gp.y - d.y }, z), zoom: z };
}

/** Xoay quanh điểm `at` trên màn hình (điểm đó đứng yên). */
export function bearingAround(v: View, at: Pt, bearing: number): { center: GeoPt; bearing: number } {
  const b = normBearing(bearing);
  const g = fromScreen(v, at);
  const d = rot({ x: at.x - v.w / 2, y: at.y - v.h / 2 }, -b);
  const gp = project(g, v.zoom);
  return { center: unproject({ x: gp.x - d.x, y: gp.y - d.y }, v.zoom), bearing: b };
}

// ── Ô ảnh vệ tinh ──────────────────────────────────────────────────────────
export interface TileRef { key: string; z: number; x: number; y: number; left: number; top: number; size: number }

/** Mức ảnh dùng cho mức phóng hiện tại (làm tròn, không vượt mức Esri có). */
export const tileZoomFor = (zoom: number) => clamp(Math.round(zoom), 3, MAX_NATIVE_ZOOM);

/** Các ô cần vẽ ở mức `tz`. left/top tính từ TÂM khung (trước khi xoay); size = cạnh ô trên màn hình. */
export function visibleTiles(v: View, tz: number): TileRef[] {
  const scale = 2 ** (v.zoom - tz);
  const c = project(v.center, tz);
  const a = Math.abs(Math.cos(rad(v.bearing))), b = Math.abs(Math.sin(rad(v.bearing)));
  const hw = ((a * v.w + b * v.h) / 2) / scale, hh = ((b * v.w + a * v.h) / 2) / scale;
  const n = 2 ** tz;
  const out: TileRef[] = [];
  const x0 = Math.floor((c.x - hw) / TILE), x1 = Math.floor((c.x + hw) / TILE);
  const y0 = Math.max(0, Math.floor((c.y - hh) / TILE)), y1 = Math.min(n - 1, Math.floor((c.y + hh) / TILE));
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      const wx = ((tx % n) + n) % n;
      out.push({ key: `${tz}/${wx}/${ty}@${tx}`, z: tz, x: wx, y: ty, left: (tx * TILE - c.x) * scale, top: (ty * TILE - c.y) * scale, size: TILE * scale });
    }
  }
  return out;
}

// ── Hình học khối nhà ──────────────────────────────────────────────────────
const REF_Z = 20;

/** Điểm giữa khối (trọng tâm theo diện tích; 1–2 điểm = trung bình). */
export function centroid(pts: readonly GeoPt[]): GeoPt {
  if (!pts.length) return { lat: 0, lng: 0 };
  const o = project(pts[0], REF_Z);
  const q = pts.map(p => { const a = project(p, REF_Z); return { x: a.x - o.x, y: a.y - o.y }; });
  const mean = { x: q.reduce((s, p) => s + p.x, 0) / q.length, y: q.reduce((s, p) => s + p.y, 0) / q.length };
  let area = 0, cx = 0, cy = 0;
  if (q.length >= 3) {
    for (let i = 0; i < q.length; i++) {
      const p = q[i], n = q[(i + 1) % q.length];
      const cr = p.x * n.y - n.x * p.y;
      area += cr; cx += (p.x + n.x) * cr; cy += (p.y + n.y) * cr;
    }
  }
  const m = Math.abs(area) > 1e-6 ? { x: cx / (3 * area), y: cy / (3 * area) } : mean;
  return unproject({ x: o.x + m.x, y: o.y + m.y }, REF_Z);
}

/** Cạnh dài nhất của khối (để căn thẳng theo khối). null nếu không phải khối. */
export function longestEdge(pts: readonly GeoPt[]): [GeoPt, GeoPt] | null {
  if (pts.length < 3) return null;
  let best: [GeoPt, GeoPt] | null = null, len = -1;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const pa = project(a, REF_Z), pb = project(b, REF_Z);
    const l = Math.hypot(pb.x - pa.x, pb.y - pa.y);
    if (l > len) { len = l; best = [a, b]; }
  }
  return best;
}

/**
 * Góc xoay mới để cạnh a–b nằm NGANG (hoặc đứng — lấy hướng gần góc hiện tại nhất, xoay ít nhất).
 * Làm tròn 0,1°.
 */
export function bearingToLevel(a: GeoPt, b: GeoPt, bearing: number): number {
  const pa = project(a, REF_Z), pb = project(b, REF_Z);
  const screenAngle = deg(Math.atan2(pb.y - pa.y, pb.x - pa.x)) + bearing;
  const delta = screenAngle - 90 * Math.round(screenAngle / 90);
  return normBearing(Math.round((bearing - delta) * 10) / 10);
}

/** Khung nhìn vừa khít các điểm (có chừa lề `pad` điểm ảnh), giữ nguyên góc xoay. */
export function fitPoints(pts: readonly GeoPt[], bearing: number, w: number, h: number, pad = 80): { center: GeoPt; zoom: number } | null {
  if (!pts.length || w <= 0 || h <= 0) return null;
  const r = pts.map(p => rot(project(p, REF_Z), bearing));
  const minX = Math.min(...r.map(p => p.x)), maxX = Math.max(...r.map(p => p.x));
  const minY = Math.min(...r.map(p => p.y)), maxY = Math.max(...r.map(p => p.y));
  const bw = Math.max(1, maxX - minX), bh = Math.max(1, maxY - minY);
  const k = Math.min(Math.max(40, w - pad * 2) / bw, Math.max(40, h - pad * 2) / bh);
  const zoom = clampZoom(REF_Z + Math.log2(k));
  const mid = rot({ x: (minX + maxX) / 2, y: (minY + maxY) / 2 }, -bearing);
  return { center: unproject(mid, REF_Z), zoom: Math.round(zoom * 100) / 100 };
}

/** Khung chữ nhật kéo trên MÀN HÌNH (song song với khung nhìn đã xoay) → 4 góc toạ độ thật. */
export function rectToGeo(v: View, a: Pt, b: Pt): GeoPt[] {
  return [{ x: a.x, y: a.y }, { x: b.x, y: a.y }, { x: b.x, y: b.y }, { x: a.x, y: b.y }].map(p => roundPt(fromScreen(v, p)));
}

export const roundPt = (p: GeoPt): GeoPt => ({ lat: r6(p.lat), lng: r6(p.lng) });

/** Dời cả khối theo độ lệch toạ độ thật. */
export function shiftPts(pts: readonly GeoPt[], dLat: number, dLng: number): GeoPt[] {
  return pts.map(p => roundPt({ lat: p.lat + dLat, lng: p.lng + dLng }));
}

/** Cỡ chữ nhãn (px) theo mức phóng: phóng to → chữ to theo, thu nhỏ → giữ tối thiểu 9px. */
export function labelPx(zoom: number, size = 1): number {
  return clamp(15 * size * 2 ** ((zoom - DEFAULT_ZOOM) * 0.75), 9, 44);
}

/** Thước tỉ lệ: độ dài "đẹp" (m) và độ rộng tương ứng trên màn hình (px), khoảng 70–140px. */
export function scaleBar(lat: number, zoom: number): { meters: number; px: number } {
  const mpp = (156543.03392 * Math.cos(rad(lat))) / 2 ** zoom;
  const steps = [5, 10, 20, 50, 100, 200, 500, 1000, 2000];
  const meters = steps.find(m => m / mpp >= 70) ?? steps[steps.length - 1];
  return { meters, px: meters / mpp };
}

export function geoZoneId(): string {
  const a = new Uint8Array(6);
  crypto.getRandomValues(a);
  return Array.from(a, b => b.toString(36).padStart(2, '0')).join('').slice(0, 10);
}

// ── Đọc / kiểm dữ liệu từ DB ───────────────────────────────────────────────
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');

function readPt(v: unknown): GeoPt | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const lat = num(o.lat), lng = num(o.lng);
  if (lat == null || lng == null || Math.abs(lat) > 85 || Math.abs(lng) > 180) return null;
  return { lat: r6(lat), lng: r6(lng) };
}

/** Đọc cột geo (jsonb): bỏ khối hỏng, kẹp góc / mức phóng. null = chưa có tâm bản đồ hợp lệ. */
export function sanitizeGeo(raw: unknown): SiteGeo | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const center = readPt(o.center);
  if (!center) return null;
  const zones: GeoZone[] = [];
  const seen = new Set<string>();
  for (const z of (Array.isArray(o.zones) ? o.zones : []).slice(0, MAX_ZONES)) {
    if (!z || typeof z !== 'object') continue;
    const zo = z as Record<string, unknown>;
    const pts = (Array.isArray(zo.pts) ? zo.pts : []).slice(0, MAX_PTS).map(readPt).filter((p): p is GeoPt => !!p);
    if (pts.length !== 1 && pts.length < 3) continue;
    let id = str(zo.id, 40);
    if (!id || seen.has(id)) id = geoZoneId();
    seen.add(id);
    const zone: GeoZone = { id, label: str(zo.label, 40), note: str(zo.note, 300), color: isZoneColor(zo.color) ? zo.color : ZONE_COLORS[0], pts };
    if (typeof zo.size === 'number' && Number.isFinite(zo.size) && zo.size !== 1) zone.size = clamp(zo.size, 0.5, 2);
    zones.push(zone);
  }
  const geo: SiteGeo = { v: 1, center, zoom: clampZoom(num(o.zoom) ?? DEFAULT_ZOOM), bearing: normBearing(num(o.bearing) ?? 0), zones };
  const origin = readPt(o.origin);
  if (origin) geo.origin = origin;
  return geo;
}

export function newSiteGeo(at: GeoPt): SiteGeo {
  const p = roundPt(at);
  return { v: 1, center: p, zoom: DEFAULT_ZOOM, bearing: 0, origin: p, zones: [] };
}
