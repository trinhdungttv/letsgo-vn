// Tải mạng đường + nhà máy có tên quanh KCN từ OpenStreetMap (Overpass API) — miễn phí, không cần khoá API.
// Đường dùng để tô "đường chưa đi"; nhà máy có tên dùng để báo tên công ty khi đi ngang (kể cả công ty chưa có
// trong hệ thống). Overpass có nhiều máy chủ — máy này lỗi / bị chặn thì thử máy khác.
// Kết quả nhớ trong máy (localStorage, 2 vùng gần nhất) để vào lại KCN lúc sóng yếu vẫn có.
import { pointInRing, projector, pointSegDist, type Bounds, type RoadPiece, type RoadWay } from './track';
import { isZoneLikeName, type OsmPlace } from './companies';
import { osmZoneAt, zoneNameMatch } from './zones';
import type { LatLng } from '../geo';

export const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

/** Đường trục (vẽ đậm) và đường nhánh cho xe máy / ô tô đi được. service = đường nội bộ — tuỳ chọn vì trong KCN có
 *  rất nhiều đường nội bộ nhà máy. */
const MAIN_ROADS = 'motorway|trunk|primary|secondary|tertiary|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link';
const MINOR_ROADS = 'unclassified|residential|living_street|road';
/** Mốc chia phần trong kết quả Overpass (lệnh `make`) — đường trục / đường nhánh / nhà máy. */
const SPLIT = 'lgvn_split';

/** Ranh giới 1 khu / cụm công nghiệp trên OSM (landuse=industrial có tên dạng "KCN …"). */
export interface OsmZone {
  id: string;
  name: string;
  rings: [number, number][][];
}

export interface AreaMap {
  key: string;
  bounds: Bounds;
  includeService: boolean;
  roads: RoadWay[];
  places: OsmPlace[];
  zones: OsmZone[];
  fetchedAt: number;
}

export function areaKey(b: Bounds, includeService: boolean): string {
  const r = (n: number) => n.toFixed(3);
  return `${r(b.minLat)},${r(b.minLng)},${r(b.maxLat)},${r(b.maxLng)}${includeService ? ',s' : ''}`;
}

export function buildQuery(b: Bounds, includeService: boolean): string {
  const bbox = `${b.minLat.toFixed(5)},${b.minLng.toFixed(5)},${b.maxLat.toFixed(5)},${b.maxLng.toFixed(5)}`;
  const minor = includeService ? `${MINOR_ROADS}|service` : MINOR_ROADS;
  const filter = '["service"!~"^(parking_aisle|driveway|drive-through)$"]["area"!="yes"]';
  // Đường: bỏ đường nội bộ bãi xe / lối vào nhà (service=parking_aisle|driveway) ngay cả khi lấy service.
  // `out tags geom` = hình dạng + thẻ (tên đường để đọc "rẽ vào Đường số 5", oneway để không dẫn đi ngược chiều),
  // không kèm mã điểm. Đường trục và đường nhánh xuất 2 lượt, giữa có mốc `make lgvn_split`.
  return `[out:json][timeout:35][bbox:${bbox}];
way["highway"~"^(${MAIN_ROADS})$"]${filter};
out tags geom qt;
make ${SPLIT} kind="minor";
out;
way["highway"~"^(${minor})$"]${filter};
out tags geom qt;
make ${SPLIT} kind="places";
out;
(
  node["name"]["man_made"="works"];
  way["name"]["man_made"="works"];
  node["name"]["office"="company"];
  way["name"]["office"="company"];
  way["name"]["building"~"^(industrial|factory|warehouse|manufacture|office|commercial)$"];
  node["name"]["industrial"];
  way["name"]["industrial"];
  way["name"]["landuse"="industrial"];
);
out geom;
rel["name"]["landuse"="industrial"];
out geom;
rel["name"]["building"];
out center;`;
}

type OsmGeom = ({ lat: number; lon: number } | null)[];
interface OsmElement {
  type: 'node' | 'way' | 'relation' | typeof SPLIT;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  geometry?: OsmGeom;
  members?: { type: string; role?: string; geometry?: OsmGeom }[];
  tags?: Record<string, string>;
}

const cleanGeom = (g: OsmGeom | undefined): [number, number][] =>
  (g ?? []).filter((p): p is { lat: number; lon: number } => !!p && Number.isFinite(p.lat) && Number.isFinite(p.lon)).map(p => [p.lat, p.lon]);
const samePt = (a: [number, number], b: [number, number]) => Math.abs(a[0] - b[0]) < 1e-7 && Math.abs(a[1] - b[1]) < 1e-7;

/** Nối các khúc viền ngoài của 1 multipolygon (OSM chia viền thành nhiều way) thành các vòng khép kín. */
export function stitchRings(parts: readonly [number, number][][]): [number, number][][] {
  const pool = parts.filter(p => p.length >= 2).map(p => [...p]);
  const rings: [number, number][][] = [];
  while (pool.length) {
    const ring = pool.shift()!;
    let grown = true;
    while (!samePt(ring[0], ring[ring.length - 1]) && grown) {
      grown = false;
      const end = ring[ring.length - 1];
      const i = pool.findIndex(p => samePt(p[0], end) || samePt(p[p.length - 1], end));
      if (i >= 0) {
        const part = pool.splice(i, 1)[0];
        ring.push(...(samePt(part[0], end) ? part : [...part].reverse()).slice(1));
        grown = true;
      }
    }
    if (ring.length >= 3) {
      if (!samePt(ring[0], ring[ring.length - 1])) ring.push(ring[0]);
      rings.push(ring);
    }
  }
  return rings;
}

const centroid = (ring: readonly [number, number][]): LatLng => ({
  lat: ring.reduce((s, p) => s + p[0], 0) / ring.length,
  lng: ring.reduce((s, p) => s + p[1], 0) / ring.length,
});

/** Chiều đi của đường theo thẻ OSM (oneway=yes / -1, vòng xuyến, đường cao tốc). Đi xe máy vẫn theo chiều này. */
export function onewayOf(tags: Record<string, string>): 1 | -1 | undefined {
  const v = (tags.oneway ?? '').toLowerCase();
  if (v === '-1' || v === 'reverse') return -1;
  if (v === 'yes' || v === '1' || v === 'true') return 1;
  if (v === 'no' || v === 'false' || v === '0') return undefined;
  if (tags.junction === 'roundabout' || tags.junction === 'circular' || tags.highway === 'motorway') return 1;
  return undefined;
}

/** Đọc kết quả Overpass → đường + nhà máy có tên + ranh giới KCN. Bỏ phần tử thiếu toạ độ. */
export function parseOverpass(data: unknown): { roads: RoadWay[]; places: OsmPlace[]; zones: OsmZone[] } {
  const elements = (data as { elements?: OsmElement[] })?.elements;
  const roads: RoadWay[] = [];
  const places: OsmPlace[] = [];
  const zones: OsmZone[] = [];
  const seenPlace = new Set<string>();
  if (!Array.isArray(elements)) return { roads, places, zones };
  let section: 'main' | 'minor' | 'places' = 'main';
  for (const el of elements) {
    if (el.type === SPLIT) {
      const k = el.tags?.kind;
      if (k === 'minor' || k === 'places') section = k;
      continue;
    }
    const tags = el.tags ?? {};
    const geom = (el.geometry ?? []).filter((g): g is { lat: number; lon: number } => !!g && Number.isFinite(g.lat) && Number.isFinite(g.lon));
    // Đường có thẻ highway (bản cũ `out ids` không có thẻ → loại = phần đang đọc); nhà máy luôn có thẻ name
    if (el.type === 'way' && (tags.highway || (!el.tags && section !== 'places'))) {
      const kind = tags.highway ? (new RegExp(`^(${MAIN_ROADS})$`).test(tags.highway) ? 'main' : 'minor') : section === 'main' ? 'main' : 'minor';
      const oneway = onewayOf(tags);
      if (geom.length >= 2) roads.push({ id: el.id, ...(tags.name ? { name: tags.name } : {}), kind, ...(oneway ? { oneway } : {}), coords: geom.map(g => [g.lat, g.lon]) });
      continue;
    }
    const name = (tags.name ?? tags['name:vi'] ?? '').trim();
    if (!name) continue;
    const id = `${el.type[0]}${el.id}`;
    if (seenPlace.has(id)) continue;
    seenPlace.add(id);
    const isZone = tags.landuse === 'industrial' && isZoneLikeName(name);
    if (el.type === 'node' && el.lat != null && el.lon != null) {
      if (!isZone) places.push({ id, name, point: { lat: el.lat, lng: el.lon } });
    } else if (el.type === 'way' && geom.length) {
      const ring: [number, number][] = geom.map(g => [g.lat, g.lon]);
      const closed = ring.length >= 4 && samePt(ring[0], ring[ring.length - 1]);
      if (isZone) { if (closed) zones.push({ id, name, rings: [ring] }); }
      else places.push({ id, name, point: centroid(ring), ...(closed ? { ring } : {}) });
    } else if (el.type === 'relation') {
      const outer = stitchRings((el.members ?? []).filter(m => m.type === 'way' && (m.role ?? 'outer') !== 'inner').map(m => cleanGeom(m.geometry)));
      if (isZone) { if (outer.length) zones.push({ id, name, rings: outer }); continue; }
      const main = [...outer].sort((a, b) => b.length - a.length)[0];
      if (main) places.push({ id, name, point: centroid(main), ring: main });
      else if (el.center) places.push({ id, name, point: { lat: el.center.lat, lng: el.center.lon } });
    }
  }
  return { roads, places, zones };
}

/**
 * Ranh giới của KCN đang khảo sát: khu TRÙNG TÊN với KCN (gần nhất, ≤ 3 km — ghim tâm KCN lệch sang khu bên cạnh vẫn
 * đúng); không có thì vòng nhỏ nhất CHỨA tâm KCN. Không có → null (tính cả vùng xung quanh).
 */
export function pickZoneBoundary(zones: readonly OsmZone[], anchor: LatLng, zoneName: string | null): OsmZone | null {
  if (zoneName) {
    const pr = projector(anchor.lat, anchor.lng);
    const named = zones
      .filter(z => zoneNameMatch(z.name, zoneName))
      .map(z => {
        const c = centroid(z.rings[0]);
        const inside = z.rings.some(r => pointInRing(anchor.lat, anchor.lng, r));
        return { z, d: inside ? 0 : Math.hypot(pr.x(c.lng), pr.y(c.lat)) };
      })
      .filter(x => x.d <= 3000)
      .sort((a, b) => a.d - b.d);
    if (named[0]) return named[0].z;
  }
  return osmZoneAt(anchor, zones);
}

/** Khúc đường nằm trong ranh giới (hoặc chạy sát viền ≤ margin mét — đường bao quanh KCN). */
export function piecesInZone(pieces: readonly RoadPiece[], zone: OsmZone, margin = 40): RoadPiece[] {
  if (!zone.rings.length || !pieces.length) return [...pieces];
  const c = centroid(zone.rings[0]);
  const pr = projector(c.lat, c.lng);
  const edges = zone.rings.map(r => r.map(([lat, lng]) => [pr.x(lng), pr.y(lat)] as [number, number]));
  return pieces.filter(p => {
    const [lat, lng] = p.mid;
    if (zone.rings.some(r => pointInRing(lat, lng, r))) return true;
    const x = pr.x(lng), y = pr.y(lat);
    for (const e of edges) for (let i = 1; i < e.length; i++) if (pointSegDist(x, y, e[i - 1][0], e[i - 1][1], e[i][0], e[i][1]) <= margin) return true;
    return false;
  });
}

const CACHE_KEY = 'lgvn_kcn_survey_area_v4';
const CACHE_MAX = 2;

function readCache(): AreaMap[] {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}
function writeCache(list: AreaMap[]) {
  try {
    // Bản nhớ kiểu cũ (chưa tách đường trục / nhánh, chưa có tên đường / chiều đi) — bỏ cho nhẹ máy
    localStorage.removeItem('lgvn_kcn_survey_area_v1');
    localStorage.removeItem('lgvn_kcn_survey_area_v2');
    localStorage.removeItem('lgvn_kcn_survey_area_v3');
    localStorage.setItem(CACHE_KEY, JSON.stringify(list.slice(0, CACHE_MAX)));
  }
  catch { /* đầy bộ nhớ / chế độ riêng tư — lần sau tải lại */ }
}

/** Vùng đã tải trước đó (trùng khung, trùng tuỳ chọn đường nội bộ). */
export function cachedArea(key: string): AreaMap | null {
  const a = readCache().find(x => x.key === key);
  return a ? { ...a, zones: a.zones ?? [] } : null;
}

/** Chưa có trả lời sau bấy lâu thì gửi thêm sang máy chủ kế tiếp (máy chủ công cộng hay phải xếp hàng 20–30 giây). */
const HEDGE_MS = 12_000;
const REQUEST_TIMEOUT_MS = 60_000;

/**
 * Tải vùng từ Overpass. Gửi máy chủ đầu; quá HEDGE_MS chưa xong (hoặc vừa báo lỗi / quá tải) thì gửi thêm máy kế tiếp,
 * lấy kết quả nào về trước rồi huỷ phần còn lại. Lỗi hết các máy chủ thì ném lỗi tiếng Việt.
 */
export function fetchArea(bounds: Bounds, includeService: boolean, signal?: AbortSignal): Promise<AreaMap> {
  const key = areaKey(bounds, includeService);
  const body = new URLSearchParams({ data: buildQuery(bounds, includeService) }).toString();
  return new Promise<AreaMap>((resolve, reject) => {
    const ctrls: AbortController[] = [];
    let next = 0, failed = 0, done = false, lastErr = '';
    let hedgeTimer: ReturnType<typeof setTimeout> | null = null;
    const stopAll = () => { done = true; if (hedgeTimer) clearTimeout(hedgeTimer); ctrls.forEach(c => c.abort()); };
    const onAbort = () => { stopAll(); reject(new DOMException('aborted', 'AbortError')); };
    if (signal?.aborted) return onAbort();
    signal?.addEventListener('abort', onAbort, { once: true });

    const fail = (msg: string) => {
      lastErr = msg;
      failed += 1;
      if (done) return;
      if (next < OVERPASS_ENDPOINTS.length) launch();
      else if (failed >= OVERPASS_ENDPOINTS.length) { stopAll(); signal?.removeEventListener('abort', onAbort); reject(new Error(`Không tải được bản đồ đường OSM (${lastErr || 'lỗi không rõ'})`)); }
    };
    const launch = () => {
      const url = OVERPASS_ENDPOINTS[next++];
      const ctrl = new AbortController();
      ctrls.push(ctrl);
      const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
      if (hedgeTimer) clearTimeout(hedgeTimer);
      if (next < OVERPASS_ENDPOINTS.length) hedgeTimer = setTimeout(() => { if (!done) launch(); }, HEDGE_MS);
      fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, signal: ctrl.signal })
        .then(async res => {
          if (!res.ok) throw new Error([429, 502, 503, 504].includes(res.status) ? 'máy chủ OSM đang quá tải' : `máy chủ trả lỗi ${res.status}`);
          const { roads, places, zones } = parseOverpass(await res.json());
          if (done) return;
          stopAll();
          signal?.removeEventListener('abort', onAbort);
          const area: AreaMap = { key, bounds, includeService, roads, places, zones, fetchedAt: Date.now() };
          writeCache([area, ...readCache().filter(a => a.key !== key)]);
          resolve(area);
        })
        .catch(e => {
          if (done) return;
          fail((e as Error)?.name === 'AbortError' ? 'quá thời gian chờ' : (e as Error)?.message?.startsWith('máy chủ') ? (e as Error).message : 'không kết nối được');
        })
        .finally(() => clearTimeout(timer));
    };
    launch();
  });
}
