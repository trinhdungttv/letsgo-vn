// Tra cứu vùng khảo sát (KCN / cụm công nghiệp chưa có trên hệ thống hoặc chưa có ranh giới).
//
// Google Maps không cho tải ranh giới / mạng đường về (không có API miễn phí, điều khoản cấm lấy dữ liệu) → dùng
// OpenStreetMap: tìm theo TÊN qua Photon (máy tìm kiếm trên dữ liệu OSM, gõ không dấu vẫn ra), theo TOẠ ĐỘ (lấy từ
// link Google Maps hoặc chỗ đang đứng) qua Overpass "khu công nghiệp quanh điểm này", rồi tải hình khoanh vùng.
// Không có ranh giới nào → tự chấm vùng trên bản đồ. Phần đọc / tính là hàm thuần (test được).
import type { LatLng } from '../geo';
import type { Bounds } from './track';
import { distM, pointInRing, projector } from './track';
import { OVERPASS_ENDPOINTS, stitchRings } from './overpass';
import { isZoneLikeName } from './companies';

export type Ring = [number, number][];

export interface AreaCandidate {
  /** 'w123' / 'r456' (có ranh giới trên OSM) · 'p:lat,lng' (chỉ là 1 điểm) */
  key: string;
  name: string;
  /** "Xã An Phước, Thành phố Đồng Nai" */
  place: string;
  /** khu công nghiệp (landuse=industrial / tên dạng KCN) · địa điểm khác · chỉ có điểm */
  kind: 'industrial' | 'other' | 'point';
  osm: { type: 'way' | 'relation'; id: number } | null;
  center: LatLng;
  /** null = chưa tải hình (kết quả tìm theo tên) */
  rings: Ring[] | null;
  extent: Bounds | null;
  areaM2: number | null;
  /** tỉnh / thành (điền sẵn cho KCN mới) */
  province: string;
}

const VN_BBOX = '102.1,8.2,109.6,23.4';
const PHOTON_API = 'https://photon.komoot.io/api/';

/** "KCN Long Đức" → thử thêm "Khu công nghiệp Long Đức" (máy tìm kiếm không hiểu chữ viết tắt). */
export function normalizeAreaQuery(q: string): string[] {
  const t = q.trim().replace(/\s+/g, ' ');
  if (!t) return [];
  const out = [t];
  const expanded = t
    .replace(/^(kcn|k\.c\.n\.?)\s+/i, 'Khu công nghiệp ')
    .replace(/^(ccn)\s+/i, 'Cụm công nghiệp ')
    .replace(/^(kcx)\s+/i, 'Khu chế xuất ');
  if (expanded !== t) out.unshift(expanded);
  return out;
}

/** "Khu công nghiệp Long Đức" → "KCN Long Đức" (cách đặt tên trong danh sách Khu vực). */
export const shortZoneName = (n: string) => n.trim()
  .replace(/^khu công nghiệp\s+/i, 'KCN ').replace(/^cụm công nghiệp\s+/i, 'CCN ').replace(/^khu chế xuất\s+/i, 'KCX ');
/** "Thành phố Đồng Nai" → "Đồng Nai" */
export const provinceOf = (s: string) => s.replace(/^(tỉnh|thành phố|tp\.?)\s+/i, '').trim();

// ── Diện tích / tâm ──────────────────────────────────────────────────────────
/** Diện tích (m²) của các vòng (phép chiếu phẳng quanh vòng đầu — đủ chính xác cho vài km). */
export function ringsAreaM2(rings: readonly Ring[]): number {
  if (!rings.length || !rings[0].length) return 0;
  const pr = projector(rings[0][0][0], rings[0][0][1]);
  let total = 0;
  for (const r of rings) {
    let a = 0;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += pr.x(r[j][1]) * pr.y(r[i][0]) - pr.x(r[i][1]) * pr.y(r[j][0]);
    total += Math.abs(a / 2);
  }
  return total;
}

export function ringsCenter(rings: readonly Ring[]): LatLng {
  const pts = rings.flat();
  return { lat: pts.reduce((s, p) => s + p[0], 0) / Math.max(1, pts.length), lng: pts.reduce((s, p) => s + p[1], 0) / Math.max(1, pts.length) };
}

export function ringsBounds(rings: readonly Ring[]): Bounds | null {
  let b: Bounds | null = null;
  for (const r of rings) for (const [lat, lng] of r) {
    if (!b) b = { minLat: lat, maxLat: lat, minLng: lng, maxLng: lng };
    else { b.minLat = Math.min(b.minLat, lat); b.maxLat = Math.max(b.maxLat, lat); b.minLng = Math.min(b.minLng, lng); b.maxLng = Math.max(b.maxLng, lng); }
  }
  return b;
}

/** Khung chữ nhật → 1 vòng khép kín. */
export const boundsRing = (b: Bounds): Ring => [[b.minLat, b.minLng], [b.minLat, b.maxLng], [b.maxLat, b.maxLng], [b.maxLat, b.minLng], [b.minLat, b.minLng]];

/** Đóng vòng tự chấm (điểm cuối = điểm đầu). Dưới 3 điểm → null. */
export function closeRing(pts: readonly [number, number][]): Ring | null {
  if (pts.length < 3) return null;
  const r: Ring = pts.map(p => [p[0], p[1]]);
  const a = r[0], b = r[r.length - 1];
  if (a[0] !== b[0] || a[1] !== b[1]) r.push([a[0], a[1]]);
  return r;
}

/** "120 ha" / "3,5 km²" */
export function fmtArea(m2: number): string {
  if (m2 >= 5_000_000) return `${(m2 / 1_000_000).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} km²`;
  return `${Math.max(1, Math.round(m2 / 10_000)).toLocaleString('vi-VN')} ha`;
}

// ── Photon (tìm theo tên) ────────────────────────────────────────────────────
interface PhotonFeature {
  properties?: {
    osm_type?: string; osm_id?: number; osm_key?: string; osm_value?: string; name?: string;
    city?: string; county?: string; district?: string; state?: string; extent?: [number, number, number, number];
  };
  geometry?: { type?: string; coordinates?: [number, number] };
}

/** Kết quả Photon → ứng viên. Bỏ trạm xe buýt / nhà có trùng tên; KCN lên đầu. */
export function parsePhoton(data: unknown): AreaCandidate[] {
  const feats = (data as { features?: PhotonFeature[] })?.features;
  if (!Array.isArray(feats)) return [];
  const out: AreaCandidate[] = [];
  const seen = new Set<string>();
  for (const f of feats) {
    const p = f.properties ?? {};
    const c = f.geometry?.coordinates;
    const name = (p.name ?? '').trim();
    if (!name || !c || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) continue;
    // Trạm xe buýt / đường / đường sắt / cửa hàng trùng tên KCN → bỏ
    if (['highway', 'railway', 'public_transport', 'amenity', 'shop', 'tourism'].includes(p.osm_key ?? '') || p.osm_value === 'bus_stop') continue;
    const t = (p.osm_type ?? '').toUpperCase();
    const osm = t === 'W' && p.osm_id ? { type: 'way' as const, id: p.osm_id } : t === 'R' && p.osm_id ? { type: 'relation' as const, id: p.osm_id } : null;
    const key = osm ? `${osm.type[0]}${osm.id}` : `p:${c[1].toFixed(5)},${c[0].toFixed(5)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const industrial = p.osm_value === 'industrial' || isZoneLikeName(name);
    const e = p.extent;
    out.push({
      key, name,
      place: [p.county ?? p.district ?? p.city, p.state].filter(Boolean).join(', '),
      kind: industrial ? 'industrial' : osm ? 'other' : 'point',
      osm, center: { lat: c[1], lng: c[0] }, rings: null,
      // extent của Photon: [minLng, maxLat, maxLng, minLat]
      extent: e && e.length === 4 ? { minLng: Math.min(e[0], e[2]), maxLng: Math.max(e[0], e[2]), minLat: Math.min(e[1], e[3]), maxLat: Math.max(e[1], e[3]) } : null,
      areaM2: null,
      province: p.state ?? '',
    });
  }
  const rank = (a: AreaCandidate) => (a.kind === 'industrial' ? 0 : a.kind === 'other' ? 1 : 2);
  return out.map((a, i) => ({ a, i })).sort((x, y) => rank(x.a) - rank(y.a) || x.i - y.i).map(x => x.a);
}

export async function photonSearch(q: string, bias: LatLng | null, signal?: AbortSignal): Promise<AreaCandidate[]> {
  const merged: AreaCandidate[] = [];
  for (const query of normalizeAreaQuery(q)) {
    const params = new URLSearchParams({ q: query, limit: '12', bbox: VN_BBOX });
    if (bias) { params.set('lat', String(bias.lat)); params.set('lon', String(bias.lng)); }
    const res = await fetch(`${PHOTON_API}?${params.toString()}`, { signal });
    if (!res.ok) throw new Error(`Máy tìm kiếm bản đồ trả lỗi ${res.status}`);
    for (const c of parsePhoton(await res.json())) if (!merged.some(m => m.key === c.key)) merged.push(c);
    if (merged.some(m => m.kind === 'industrial')) break;
  }
  return merged.slice(0, 12);
}

// ── Overpass (hình khoanh vùng, KCN quanh 1 điểm) ───────────────────────────
/**
 * Gửi 1 truy vấn nhỏ lên Overpass: 2 máy chủ cùng lúc, cứ 5 giây chưa xong thì thêm 1 máy nữa, lấy kết quả về trước
 * (máy chủ công cộng hay xếp hàng hàng chục giây theo đợt). Hết máy chủ mà vẫn lỗi → báo lỗi tiếng Việt.
 */
function overpassPost(query: string, signal?: AbortSignal): Promise<unknown> {
  const body = new URLSearchParams({ data: query }).toString();
  return new Promise((resolve, reject) => {
    const ctrls: AbortController[] = [];
    let next = 0, failed = 0, done = false, lastErr = '';
    let hedge: ReturnType<typeof setInterval> | null = null;
    const stop = () => { done = true; if (hedge) clearInterval(hedge); ctrls.forEach(c => c.abort()); signal?.removeEventListener('abort', onAbort); };
    const onAbort = () => { if (done) return; stop(); reject(new DOMException('aborted', 'AbortError')); };
    if (signal?.aborted) { reject(new DOMException('aborted', 'AbortError')); return; }
    signal?.addEventListener('abort', onAbort, { once: true });
    const launch = () => {
      if (done || next >= OVERPASS_ENDPOINTS.length) return;
      const url = OVERPASS_ENDPOINTS[next++];
      const ctrl = new AbortController();
      ctrls.push(ctrl);
      const timer = setTimeout(() => ctrl.abort(), 60_000);
      fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, signal: ctrl.signal })
        .then(async res => {
          if (!res.ok) throw new Error([429, 502, 503, 504].includes(res.status) ? 'máy chủ OSM đang quá tải' : `máy chủ trả lỗi ${res.status}`);
          const data = await res.json();
          if (done) return;
          stop();
          resolve(data);
        })
        .catch(e => {
          if (done) return;
          lastErr = (e as Error)?.name === 'AbortError' ? 'quá thời gian chờ' : (e as Error)?.message?.startsWith('máy chủ') ? (e as Error).message : 'không kết nối được';
          failed += 1;
          if (next < OVERPASS_ENDPOINTS.length) launch();
          else if (failed >= next) { stop(); reject(new Error(`Không tải được dữ liệu OSM (${lastErr}) — máy chủ bản đồ công cộng đang bận, thử lại sau ít phút`)); }
        })
        .finally(() => clearTimeout(timer));
    };
    launch();
    launch();
    hedge = setInterval(launch, 5000);
  });
}

type OsmGeom = ({ lat: number; lon: number } | null)[];
interface OsmEl {
  type: string; id: number; tags?: Record<string, string>;
  geometry?: OsmGeom; members?: { type: string; role?: string; geometry?: OsmGeom }[];
}
const cleanGeom = (g?: OsmGeom): Ring => (g ?? []).filter((p): p is { lat: number; lon: number } => !!p && Number.isFinite(p.lat) && Number.isFinite(p.lon)).map(p => [p.lat, p.lon]);

/** Phần tử OSM (way khép kín / relation) → các vòng ngoài. */
export function elementRings(el: OsmEl): Ring[] {
  if (el.type === 'way') {
    const r = cleanGeom(el.geometry);
    if (r.length < 4) return [];
    const a = r[0], b = r[r.length - 1];
    return Math.abs(a[0] - b[0]) < 1e-7 && Math.abs(a[1] - b[1]) < 1e-7 ? [r] : [];
  }
  if (el.type === 'relation') {
    return stitchRings((el.members ?? []).filter(m => m.type === 'way' && (m.role ?? 'outer') !== 'inner').map(m => cleanGeom(m.geometry)));
  }
  return [];
}

/**
 * Kết quả "khu công nghiệp quanh điểm" → ứng viên: vùng CHỨA điểm lên đầu, rồi tên dạng KCN, rồi vùng lớn.
 * Vùng quá nhỏ (< 1 ha — thường là 1 nhà xưởng lẻ) bỏ.
 */
export function parseIndustrialAround(data: unknown, p: LatLng): AreaCandidate[] {
  const els = (data as { elements?: OsmEl[] })?.elements;
  if (!Array.isArray(els)) return [];
  const out: { a: AreaCandidate; inside: boolean }[] = [];
  for (const el of els) {
    const name = (el.tags?.name ?? el.tags?.['name:vi'] ?? '').trim();
    const rings = elementRings(el);
    if (!rings.length) continue;
    const areaM2 = ringsAreaM2(rings);
    if (areaM2 < 10_000) continue;
    const center = ringsCenter(rings);
    const inside = rings.some(r => pointInRing(p.lat, p.lng, r));
    if (out.some(o => o.a.key === `${el.type[0]}${el.id}`)) continue;
    out.push({
      a: {
        key: `${el.type[0]}${el.id}`, name: name || 'Khu công nghiệp chưa có tên', place: '',
        kind: 'industrial', osm: { type: el.type === 'way' ? 'way' : 'relation', id: el.id },
        center, rings, extent: ringsBounds(rings), areaM2, province: el.tags?.['addr:province'] ?? '',
      },
      inside,
    });
  }
  const score = (o: { a: AreaCandidate; inside: boolean }) => (o.inside ? 0 : 10) + (isZoneLikeName(o.a.name) ? 0 : 5);
  return out
    .sort((x, y) => score(x) - score(y) || (y.a.areaM2 ?? 0) - (x.a.areaM2 ?? 0) || distM(p, x.a.center) - distM(p, y.a.center))
    .map(o => o.a)
    .slice(0, 15);
}

/** Khu công nghiệp có tên trong bán kính quanh 1 điểm (toạ độ từ link Google Maps / chỗ đang đứng). */
export async function industrialAround(p: LatLng, radiusM = 2500, signal?: AbortSignal): Promise<AreaCandidate[]> {
  const at = `${Math.round(radiusM)},${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;
  // is_in: vùng lớn CHỨA điểm (cụm KCN vài km — viền ở xa nên around không bắt được); around: vùng xung quanh
  const q = `[out:json][timeout:25];
is_in(${p.lat.toFixed(6)},${p.lng.toFixed(6)})->.a;
(
  way(pivot.a)["landuse"="industrial"];
  relation(pivot.a)["landuse"="industrial"];
  way["landuse"="industrial"](around:${at});
  relation["landuse"="industrial"](around:${at});
);
out tags geom;`;
  return parseIndustrialAround(await overpassPost(q, signal), p);
}

/** Tải hình khoanh vùng của 1 kết quả tìm theo tên (way / relation trên OSM). */
export async function fetchCandidateRings(c: AreaCandidate, signal?: AbortSignal): Promise<Ring[]> {
  if (!c.osm) return [];
  const q = `[out:json][timeout:25];
${c.osm.type}(${c.osm.id});
out geom;`;
  const data = await overpassPost(q, signal) as { elements?: OsmEl[] };
  const el = data.elements?.find(e => e.type === c.osm!.type && e.id === c.osm!.id);
  return el ? elementRings(el) : [];
}
