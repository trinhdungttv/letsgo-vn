// Kế hoạch ghé công ty khi khảo sát KCN (migration 223) — phần THUẦN, có test (planStops.test.ts):
//   • đọc ô nhập: mỗi dòng 1 công ty — tên, link Google Maps (dài / rút gọn), hoặc "vĩ độ, kinh độ";
//     văn bản "Chia sẻ" của app Google Maps (tên + địa chỉ + link) tự gộp thành 1 công ty
//   • sắp thứ tự ghé ngắn nhất (bài toán người giao hàng, đường mở): chính xác khi ít điểm, nhiều điểm thì
//     láng giềng gần nhất + 2-opt + dời điểm (or-opt) — chạy với ma trận thời gian xe máy thật (Valhalla) hoặc ước tính
//   • link Google Maps chỉ đường qua nhiều điểm (chia chặng khi quá số điểm dừng cho phép)
//   • ảnh bổ sung sau chuyến: vị trí theo giờ chụp trên vết GPS của chuyến
import { isValidVnLatLng, type LatLng } from '../geo';
import { extractLatLng, isShortMapLink, placeNameFromLink } from '../cskh/nearby';
import { distM, type TrackSegment } from './track';
import { compareKeys, companyKey } from '../companyMatch';

// ── Dữ liệu ──────────────────────────────────────────────────────────────────
export type StopSource = 'maps_link' | 'coords' | 'system' | 'overture' | 'google' | 'osm' | 'manual';
export const STOP_SOURCE_LABEL: Record<StopSource, string> = {
  maps_link: 'Link Google Maps', coords: 'Toạ độ', system: 'Có trong hệ thống', overture: 'Bản đồ quanh KCN', google: 'Google Maps', osm: 'OpenStreetMap', manual: 'Tự ghim',
};

export interface PlanStop {
  id: string;
  zone_id: string | null;
  zone_name: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  source: StopSource;
  /** c:<client> / p:<pipeline> / l:<lead> nếu là công ty trong hệ thống; '' = công ty ngoài */
  ref_key: string;
  map_link: string;
  note: string;
  visited_at: string | null;
  visited_trip_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

const SOURCES: StopSource[] = ['maps_link', 'coords', 'system', 'overture', 'google', 'osm', 'manual'];
const s = (v: unknown, max = 500) => (typeof v === 'string' ? v.slice(0, max) : '');
const n = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function normStop(r: Record<string, unknown>): PlanStop | null {
  const lat = n(r.lat), lng = n(r.lng);
  if (lat == null || lng == null) return null;
  return {
    id: s(r.id, 60), zone_id: typeof r.zone_id === 'string' ? r.zone_id : null, zone_name: s(r.zone_name, 200),
    name: s(r.name, 200), address: s(r.address, 300), lat, lng,
    source: SOURCES.includes(r.source as StopSource) ? (r.source as StopSource) : 'manual',
    ref_key: s(r.ref_key, 120), map_link: s(r.map_link, 1000), note: s(r.note, 1000),
    visited_at: typeof r.visited_at === 'string' ? r.visited_at : null,
    visited_trip_id: typeof r.visited_trip_id === 'string' ? r.visited_trip_id : null,
    created_by: s(r.created_by, 120), created_at: s(r.created_at, 40), updated_at: s(r.updated_at, 40),
  };
}

/** Tên hiển thị: tên đã đặt, không có thì "Điểm 10.95, 106.71" */
export const stopTitle = (st: Pick<PlanStop, 'name' | 'lat' | 'lng'>) => st.name.trim() || `Điểm ${st.lat.toFixed(4)}, ${st.lng.toFixed(4)}`;

// ── Đọc ô nhập ───────────────────────────────────────────────────────────────
export type StopLine =
  | { kind: 'link'; url: string; short: boolean; coords: LatLng | null; name: string; address: string }
  | { kind: 'coords'; coords: LatLng; name: string }
  | { kind: 'name'; name: string };

const URL_RE = /https?:\/\/[^\s<>"']+/i;
const COORD_RE = /(-?\d{1,2}\.\d{3,})\s*[,;]\s*(-?\d{2,3}\.\d{3,})/;
// Bỏ gạch đầu dòng / số thứ tự ("1. ", "2) ", "- ", "• ") nhưng giữ tên bắt đầu bằng số ("3M Việt Nam")
const cleanName = (t: string) => t.replace(/^\s*(?:[-–•*·]+|\d{1,2}[.)])\s+/, '').replace(/[\s|,;:–-]+$/, '').replace(/^[\s|,;:–-]+/, '').trim();

/**
 * Mỗi dòng 1 công ty. Dòng chữ đứng NGAY TRƯỚC 1 link (chưa thuộc link nào) = tên (dòng đầu) + địa chỉ (các dòng sau) của link đó
 * — đúng khuôn văn bản "Chia sẻ" của app Google Maps. Dòng chữ không đi kèm link = tên để app tự tìm.
 */
export function parseStopLines(text: string): StopLine[] {
  const out: StopLine[] = [];
  let pending: string[] = [];
  const flushNames = () => { for (const t of pending) { const name = cleanName(t); if (name.length >= 2) out.push({ kind: 'name', name }); } pending = []; };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) { flushNames(); continue; }
    const url = URL_RE.exec(line)?.[0];
    if (url) {
      const inline = cleanName(line.replace(url, ' '));
      const coords = extractLatLng(url);
      const fromUrl = placeNameFromLink(url);
      const name = inline || cleanName(pending[0] ?? '') || fromUrl;
      const address = inline ? '' : pending.slice(1).map(cleanName).filter(Boolean).join(', ');
      pending = [];
      out.push({ kind: 'link', url, short: isShortMapLink(url), coords: coords && isValidVnLatLng(coords) ? coords : null, name, address });
      continue;
    }
    const m = COORD_RE.exec(line);
    if (m) {
      const coords = { lat: +m[1], lng: +m[2] };
      if (isValidVnLatLng(coords)) {
        const name = cleanName(line.replace(m[0], ' ')) || cleanName(pending[0] ?? '');
        pending = [];
        out.push({ kind: 'coords', coords, name });
        continue;
      }
    }
    pending.push(line);
  }
  flushNames();
  return out;
}

// ── Thứ tự ghé ngắn nhất ────────────────────────────────────────────────────
export type CostFn = (i: number, j: number) => number;

export function pathCost(order: readonly number[], cost: CostFn): number {
  let c = 0;
  for (let k = 1; k < order.length; k++) c += cost(order[k - 1], order[k]);
  return c;
}

function permute(arr: number[], k: number, visit: (a: number[]) => void) {
  if (k === arr.length) { visit(arr); return; }
  for (let i = k; i < arr.length; i++) {
    [arr[k], arr[i]] = [arr[i], arr[k]];
    permute(arr, k + 1, visit);
    [arr[k], arr[i]] = [arr[i], arr[k]];
  }
}

/** Cải thiện tại chỗ bằng 2-opt (đảo 1 khúc) + or-opt (dời 1–3 điểm liền nhau). Giữ nguyên `lockFirst` điểm đầu. Chi phí tính lại cả đường → đúng cả khi ma trận lệch chiều (đường 1 chiều). */
function improve(order: number[], cost: CostFn, lockFirst: number): number[] {
  let best = order.slice();
  let bestC = pathCost(best, cost);
  for (let round = 0; round < 50; round++) {
    let better = false;
    const len = best.length;
    for (let i = lockFirst; i < len - 1 && !better; i++) {
      for (let j = i + 1; j < len; j++) {
        const cand = [...best.slice(0, i), ...best.slice(i, j + 1).reverse(), ...best.slice(j + 1)];
        const c = pathCost(cand, cost);
        if (c < bestC - 1e-9) { best = cand; bestC = c; better = true; break; }
      }
    }
    for (let segLen = 1; segLen <= 3 && !better; segLen++) {
      for (let i = lockFirst; i + segLen <= len && !better; i++) {
        const seg = best.slice(i, i + segLen);
        const rest = [...best.slice(0, i), ...best.slice(i + segLen)];
        for (let k = lockFirst; k <= rest.length; k++) {
          if (k === i) continue;
          const cand = [...rest.slice(0, k), ...seg, ...rest.slice(k)];
          const c = pathCost(cand, cost);
          if (c < bestC - 1e-9) { best = cand; bestC = c; better = true; break; }
        }
      }
    }
    if (!better) break;
  }
  return best;
}

/**
 * Thứ tự đi qua `count` điểm (chỉ số 0..count-1) với tổng chi phí nhỏ nhất, KHÔNG quay về.
 * `first` = điểm bắt buộc đi đầu (VD vị trí đang đứng) — null thì tự chọn điểm đầu tốt nhất.
 * ≤ 8 điểm tự do: thử hết (chính xác). Nhiều hơn: láng giềng gần nhất từ nhiều điểm đầu + 2-opt + or-opt.
 */
export function orderOpenPath(count: number, cost: CostFn, first: number | null = null): number[] {
  if (count <= 0) return [];
  const all = Array.from({ length: count }, (_, i) => i);
  if (count === 1) return all;
  const free = first == null ? all : all.filter(i => i !== first);
  const head = first == null ? [] : [first];
  if (free.length <= 8) {
    let best: number[] = [...head, ...free], bestC = Infinity;
    permute(free.slice(), 0, p => {
      const cand = [...head, ...p];
      const c = pathCost(cand, cost);
      if (c < bestC) { bestC = c; best = cand.slice(); }
    });
    return best;
  }
  const starts = first == null ? all : [first];
  let best: number[] = [], bestC = Infinity;
  for (const st of starts) {
    const path = [st];
    const left = new Set(all.filter(i => i !== st));
    while (left.size) {
      const last = path[path.length - 1];
      let pick = -1, pc = Infinity;
      for (const j of left) { const c = cost(last, j); if (c < pc) { pc = c; pick = j; } }
      path.push(pick);
      left.delete(pick);
    }
    const imp = improve(path, cost, first == null ? 0 : 1);
    const c = pathCost(imp, cost);
    if (c < bestC) { bestC = c; best = imp; }
  }
  return best;
}

/** Chi phí ước tính khi không gọi được máy định tuyến: đường chim bay × 1,35 (đường KCN vòng vèo), đơn vị mét. */
export const estimateM = (a: LatLng, b: LatLng) => distM(a, b) * 1.35;

/** Xe máy trong KCN ~ 25 km/h khi ước tính */
export const ESTIMATE_KMH = 25;

// ── Link Google Maps chỉ đường ──────────────────────────────────────────────
const ll = (p: LatLng) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;

/**
 * Link chỉ đường Google Maps đi qua `pts` theo đúng thứ tự. `origin` null = Google lấy vị trí hiện tại của điện thoại.
 * Mỗi link tối đa `maxWaypoints` điểm dừng giữa (Google cho 9) → dài hơn thì chia chặng, chặng sau bắt đầu ở điểm cuối chặng trước.
 * 1 điểm đến → xe máy; nhiều điểm → ô tô (chế độ xe máy của Google không cho thêm điểm dừng).
 */
export function googleDirectionsLinks(origin: LatLng | null, pts: readonly LatLng[], maxWaypoints = 9): string[] {
  if (!pts.length) return [];
  const out: string[] = [];
  let from: LatLng | null = origin;
  let i = 0;
  while (i < pts.length) {
    const chunk = pts.slice(i, i + maxWaypoints + 1);
    const dest = chunk[chunk.length - 1];
    const ways = chunk.slice(0, -1);
    const q = new URLSearchParams({ api: '1' });
    if (from) q.set('origin', ll(from));
    q.set('destination', ll(dest));
    if (ways.length) q.set('waypoints', ways.map(ll).join('|'));
    q.set('travelmode', ways.length ? 'driving' : 'two-wheeler');
    out.push(`https://www.google.com/maps/dir/?${q.toString().replace(/%2C/g, ',').replace(/%7C/g, '|')}`);
    from = dest;
    i += chunk.length;
  }
  return out;
}

// ── Ảnh bổ sung: vị trí theo giờ chụp ───────────────────────────────────────
export interface TrackHit { lat: number; lng: number; /** lệch giờ (giây) so với điểm vết gần nhất — 0 khi nội suy giữa 2 điểm liền nhau */ gapS: number }

/**
 * Vị trí trên vết GPS lúc `atMs`. TrackPoint[2] = giây kể từ `tripStartMs`.
 * Giữa 2 điểm liền nhau (cách ≤ 3 phút) → nội suy; quanh chỗ tạm dừng / đầu / cuối chuyến → điểm vết gần nhất nếu lệch ≤ `tolMs`.
 */
export function positionAtTime(segments: readonly TrackSegment[], tripStartMs: number, atMs: number, tolMs = 15 * 60_000): TrackHit | null {
  const t = (atMs - tripStartMs) / 1000;
  let best: TrackHit | null = null;
  for (const seg of segments) {
    for (let i = 0; i < seg.length; i++) {
      const p = seg[i];
      if (i > 0) {
        const a = seg[i - 1];
        if (a[2] <= t && t <= p[2] && p[2] - a[2] <= 180) {
          const f = p[2] === a[2] ? 0 : (t - a[2]) / (p[2] - a[2]);
          return { lat: a[0] + (p[0] - a[0]) * f, lng: a[1] + (p[1] - a[1]) * f, gapS: 0 };
        }
      }
      const gap = Math.abs(p[2] - t);
      if (gap * 1000 <= tolMs && (!best || gap < best.gapS)) best = { lat: p[0], lng: p[1], gapS: Math.round(gap) };
    }
  }
  return best;
}

/** Khoảng cách (m) từ 1 điểm tới vết gần nhất — để báo ảnh chụp ở xa chuyến này. */
export function distToTrack(p: LatLng, segments: readonly TrackSegment[]): number {
  let best = Infinity;
  for (const seg of segments) for (let i = 0; i < seg.length; i += 3) best = Math.min(best, distM(p, { lat: seg[i][0], lng: seg[i][1] }));
  return best;
}

/** Giờ chụp EXIF ('YYYY-MM-DDTHH:mm:ss', giờ máy ảnh = giờ địa phương) → ms; lỗi → null */
export function exifTimeMs(takenAt: string | null | undefined): number | null {
  if (!takenAt) return null;
  const ms = new Date(takenAt).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/** Điểm kế hoạch gần vị trí nhất trong bán kính (m) */
export function nearestStop<T extends { lat: number; lng: number }>(p: LatLng, stops: readonly T[], radiusM: number): T | null {
  let best: T | null = null, bd = radiusM;
  for (const st of stops) { const d = distM(p, st); if (d <= bd) { bd = d; best = st; } }
  return best;
}

// ── Tìm theo tên ─────────────────────────────────────────────────────────────
/**
 * Độ khớp 0..1 giữa tên gõ và tên công ty: bỏ dấu, bỏ "Công ty TNHH / Việt Nam…" (lib companyMatch), cho gõ 1 phần tên
 * ("pouchen" ↔ "Công ty TNHH Pouchen Việt Nam"), gõ thiếu đuôi từ ("kumho ti" ↔ "Kumho Tire"). 0 = không khớp.
 */
export function nameMatchScore(query: string, name: string): number {
  const a = companyKey(query), b = companyKey(name);
  if (!a.core || !b.core) return 0;
  const m = compareKeys(a, b);
  if (m) return m.score;
  if (a.tokens.length && a.tokens.every(t => b.tokens.some(x => x.startsWith(t)))) return 0.5;
  if (a.core.length >= 3 && b.core.includes(a.core)) return 0.4;
  return 0;
}
