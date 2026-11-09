// ============================================================================
// Đường xe từ đơn vị nguồn → KCN / công ty / chi nhánh — tính cho XE KHÁCH 16–45 chỗ (Tony chốt 09/11:
// luôn hiện đường ô tô đi, vì đưa rước SV bằng xe 16/45 chỗ, không dùng đường chim bay).
//
//   1. Valhalla (máy chủ công cộng FOSSGIS, chế độ "bus"): đúng loại xe nhất. Giới hạn: tối đa 100 điểm / lượt
//      và quãng ≤ 150 km → chỉ dùng cho đích trong ~140 km đường thẳng, mỗi lượt ≤ 80 đích.
//   2. OSRM (router.project-osrm.org, ô tô con): dự phòng khi Valhalla lỗi + đích xa (trường ở tỉnh khác).
//      Thời gian ô tô × BUS_FACTOR để ra giờ xe khách (đo thật 09/11: cùng tuyến 39,9 phút ô tô ↔ 56,8 phút bus).
//
// Cả 2 máy chủ mở CORS, gọi thẳng từ trình duyệt được (đã thử từ mạng VN 09/11). Kết quả lưu bảng
// labor_source_routes để mọi máy dùng chung, không gọi lại.
// ============================================================================
import { haversineKm } from '../geo';
import type { RouteEngine, RouteRow, RouteTargetType } from './types';

export interface GeoPoint { lat: number; lng: number }
export interface RouteTarget extends GeoPoint { type: RouteTargetType; id: string }
export interface RouteResult { distanceKm: number | null; durationMin: number | null; engine: RouteEngine }

export const BUS_FACTOR = 1.35;
export const VALHALLA_MAX_KM = 140;
const VALHALLA_CHUNK = 80;
const OSRM_CHUNK = 90;
const VALHALLA_URL = 'https://valhalla1.openstreetmap.de';
const OSRM_URL = 'https://router.project-osrm.org';
/** Giãn cách giữa 2 lượt gọi cùng máy chủ công cộng (quy định dùng chung). */
const GAP_MS = 1100;

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export const routeKey = (type: RouteTargetType, id: string) => `${type}:${id}`;

/** Toạ độ lệch quá ~50 m → coi như đã dời chỗ, phải tính lại đường. */
export function coordsMoved(a: GeoPoint, b: GeoPoint, tol = 0.0005): boolean {
  return Math.abs(a.lat - b.lat) > tol || Math.abs(a.lng - b.lng) > tol;
}

/** Dòng đã lưu còn dùng được cho cặp điểm này không. */
export function isFresh(row: RouteRow | undefined, src: GeoPoint, tgt: GeoPoint): boolean {
  if (!row) return false;
  return !coordsMoved({ lat: row.from_lat, lng: row.from_lng }, src) && !coordsMoved({ lat: row.to_lat, lng: row.to_lng }, tgt);
}

export function chunk<T>(arr: readonly T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

/** Giải chuỗi polyline (Valhalla: độ chính xác 6 chữ số) → [lat, lng][]. */
export function decodePolyline(str: string, precision = 6): [number, number][] {
  const factor = 10 ** precision;
  const out: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < str.length) {
    for (const which of [0, 1] as const) {
      let result = 0;
      let shift = 0;
      let byte: number;
      do {
        byte = str.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20); // hết chuỗi → charCodeAt = NaN → dừng
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (which === 0) lat += delta; else lng += delta;
    }
    out.push([lat / factor, lng / factor]);
  }
  return out;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

async function valhallaMatrix(src: GeoPoint, targets: readonly RouteTarget[], fetchFn: FetchFn): Promise<RouteResult[]> {
  const res = await fetchFn(`${VALHALLA_URL}/sources_to_targets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sources: [{ lat: src.lat, lon: src.lng }],
      targets: targets.map(t => ({ lat: t.lat, lon: t.lng })),
      costing: 'bus',
      units: 'kilometers',
    }),
  });
  if (!res.ok) throw new Error(`Valhalla ${res.status}`);
  const data = await res.json() as { sources_to_targets?: { to_index: number; distance: number | null; time: number | null }[][] };
  const row = data.sources_to_targets?.[0];
  if (!Array.isArray(row)) throw new Error('Valhalla trả dữ liệu lạ');
  const out: RouteResult[] = targets.map(() => ({ distanceKm: null, durationMin: null, engine: 'valhalla-bus' }));
  for (const cell of row) {
    if (cell.distance == null || cell.time == null) continue;
    out[cell.to_index] = { distanceKm: round2(cell.distance), durationMin: round1(cell.time / 60), engine: 'valhalla-bus' };
  }
  return out;
}

async function osrmTable(src: GeoPoint, targets: readonly RouteTarget[], fetchFn: FetchFn): Promise<RouteResult[]> {
  const coords = [src, ...targets].map(p => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
  const res = await fetchFn(`${OSRM_URL}/table/v1/driving/${coords}?sources=0&annotations=duration,distance`);
  if (!res.ok) throw new Error(`OSRM ${res.status}`);
  const data = await res.json() as { code?: string; durations?: (number | null)[][]; distances?: (number | null)[][] };
  if (data.code !== 'Ok' || !data.durations?.[0]) throw new Error('OSRM không tính được đường');
  return targets.map((_, i) => {
    const d = data.distances?.[0]?.[i + 1];
    const t = data.durations?.[0]?.[i + 1];
    if (d == null || t == null) return { distanceKm: null, durationMin: null, engine: 'osrm-car' as const };
    return { distanceKm: round2(d / 1000), durationMin: round1((t / 60) * BUS_FACTOR), engine: 'osrm-car' as const };
  });
}

/**
 * Tính đường xe từ 1 điểm tới nhiều đích. Đích gần → Valhalla bus; đích xa hoặc Valhalla lỗi → OSRM.
 * Đích nào cả 2 máy chủ đều lỗi thì KHÔNG có trong kết quả (lần sau tính lại); không tìm được đường
 * (máy chủ trả rỗng) thì có kết quả với distanceKm = null.
 */
export async function computeRoutes(src: GeoPoint, targets: readonly RouteTarget[], opts: {
  fetchFn?: FetchFn;
  onProgress?: (done: number, total: number) => void;
  gapMs?: number;
} = {}): Promise<Map<string, RouteResult>> {
  const fetchFn = opts.fetchFn ?? ((u, i) => fetch(u, i));
  const gap = opts.gapMs ?? GAP_MS;
  const out = new Map<string, RouteResult>();
  const near: RouteTarget[] = [];
  const fallback: RouteTarget[] = [];
  for (const t of targets) (haversineKm(src, t) <= VALHALLA_MAX_KM ? near : fallback).push(t);
  const total = targets.length;
  let calls = 0;
  const wait = async () => { if (calls++ > 0 && gap > 0) await sleep(gap); };

  for (const part of chunk(near, VALHALLA_CHUNK)) {
    await wait();
    try {
      const r = await valhallaMatrix(src, part, fetchFn);
      part.forEach((t, i) => out.set(routeKey(t.type, t.id), r[i]));
    } catch {
      fallback.push(...part);
    }
    opts.onProgress?.(out.size, total);
  }
  for (const part of chunk(fallback, OSRM_CHUNK)) {
    await wait();
    try {
      const r = await osrmTable(src, part, fetchFn);
      part.forEach((t, i) => out.set(routeKey(t.type, t.id), r[i]));
    } catch { /* cả 2 máy chủ lỗi — để lần sau */ }
    opts.onProgress?.(out.size, total);
  }
  return out;
}

export interface RouteOrigin extends GeoPoint { id: string }

async function valhallaToOne(origins: readonly RouteOrigin[], dst: GeoPoint, fetchFn: FetchFn): Promise<RouteResult[]> {
  const res = await fetchFn(`${VALHALLA_URL}/sources_to_targets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sources: origins.map(o => ({ lat: o.lat, lon: o.lng })),
      targets: [{ lat: dst.lat, lon: dst.lng }],
      costing: 'bus',
      units: 'kilometers',
    }),
  });
  if (!res.ok) throw new Error(`Valhalla ${res.status}`);
  const data = await res.json() as { sources_to_targets?: { from_index: number; distance: number | null; time: number | null }[][] };
  if (!Array.isArray(data.sources_to_targets)) throw new Error('Valhalla trả dữ liệu lạ');
  const out: RouteResult[] = origins.map(() => ({ distanceKm: null, durationMin: null, engine: 'valhalla-bus' }));
  for (const row of data.sources_to_targets) {
    const cell = row?.[0];
    if (!cell || cell.distance == null || cell.time == null) continue;
    out[cell.from_index] = { distanceKm: round2(cell.distance), durationMin: round1(cell.time / 60), engine: 'valhalla-bus' };
  }
  return out;
}

async function osrmToOne(origins: readonly RouteOrigin[], dst: GeoPoint, fetchFn: FetchFn): Promise<RouteResult[]> {
  const coords = [...origins, dst].map(p => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
  const srcIdx = origins.map((_, i) => i).join(';');
  const res = await fetchFn(`${OSRM_URL}/table/v1/driving/${coords}?sources=${srcIdx}&destinations=${origins.length}&annotations=duration,distance`);
  if (!res.ok) throw new Error(`OSRM ${res.status}`);
  const data = await res.json() as { code?: string; durations?: (number | null)[][]; distances?: (number | null)[][] };
  if (data.code !== 'Ok' || !data.durations) throw new Error('OSRM không tính được đường');
  return origins.map((_, i) => {
    const d = data.distances?.[i]?.[0];
    const t = data.durations?.[i]?.[0];
    if (d == null || t == null) return { distanceKm: null, durationMin: null, engine: 'osrm-car' as const };
    return { distanceKm: round2(d / 1000), durationMin: round1((t / 60) * BUS_FACTOR), engine: 'osrm-car' as const };
  });
}

/** Ngược chiều computeRoutes: nhiều đơn vị nguồn → 1 đích (KCN / công ty) — kết quả theo id đơn vị. */
export async function computeRoutesToOne(origins: readonly RouteOrigin[], dst: GeoPoint, opts: { fetchFn?: FetchFn; gapMs?: number } = {}): Promise<Map<string, RouteResult>> {
  const fetchFn = opts.fetchFn ?? ((u, i) => fetch(u, i));
  const gap = opts.gapMs ?? GAP_MS;
  const out = new Map<string, RouteResult>();
  const near: RouteOrigin[] = [];
  const fallback: RouteOrigin[] = [];
  for (const o of origins) (haversineKm(o, dst) <= VALHALLA_MAX_KM ? near : fallback).push(o);
  let calls = 0;
  const wait = async () => { if (calls++ > 0 && gap > 0) await sleep(gap); };
  for (const part of chunk(near, VALHALLA_CHUNK)) {
    await wait();
    try {
      const r = await valhallaToOne(part, dst, fetchFn);
      part.forEach((o, i) => out.set(o.id, r[i]));
    } catch { fallback.push(...part); }
  }
  for (const part of chunk(fallback, OSRM_CHUNK)) {
    await wait();
    try {
      const r = await osrmToOne(part, dst, fetchFn);
      part.forEach((o, i) => out.set(o.id, r[i]));
    } catch { /* để lần sau */ }
  }
  return out;
}

export interface RouteShape {
  points: [number, number][];
  distanceKm: number;
  durationMin: number;
  engine: RouteEngine;
}

/** Hình đường đi (để vẽ lên bản đồ) — Valhalla bus, lỗi thì OSRM ô tô. */
export async function fetchRouteShape(src: GeoPoint, dst: GeoPoint, fetchFn: FetchFn = (u, i) => fetch(u, i)): Promise<RouteShape | null> {
  try {
    const res = await fetchFn(`${VALHALLA_URL}/route`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locations: [{ lat: src.lat, lon: src.lng }, { lat: dst.lat, lon: dst.lng }], costing: 'bus', units: 'kilometers' }),
    });
    if (res.ok) {
      const data = await res.json() as { trip?: { summary: { length: number; time: number }; legs: { shape: string }[] } };
      if (data.trip) {
        return {
          points: data.trip.legs.flatMap(l => decodePolyline(l.shape, 6)),
          distanceKm: round2(data.trip.summary.length),
          durationMin: round1(data.trip.summary.time / 60),
          engine: 'valhalla-bus',
        };
      }
    }
  } catch { /* thử OSRM */ }
  try {
    const res = await fetchFn(`${OSRM_URL}/route/v1/driving/${src.lng},${src.lat};${dst.lng},${dst.lat}?overview=full&geometries=polyline6`);
    if (!res.ok) return null;
    const data = await res.json() as { code?: string; routes?: { geometry: string; distance: number; duration: number }[] };
    const r = data.code === 'Ok' ? data.routes?.[0] : undefined;
    if (!r) return null;
    return { points: decodePolyline(r.geometry, 6), distanceKm: round2(r.distance / 1000), durationMin: round1((r.duration / 60) * BUS_FACTOR), engine: 'osrm-car' };
  } catch {
    return null;
  }
}

// ── Hiển thị ────────────────────────────────────────────────────────────────
export function fmtKm(km: number | null | undefined): string {
  if (km == null) return '—';
  return km >= 100 ? `${Math.round(km).toLocaleString('vi-VN')} km` : `${km.toLocaleString('vi-VN', { maximumFractionDigits: 1 })} km`;
}

export function fmtDuration(min: number | null | undefined): string {
  if (min == null) return '—';
  const m = Math.round(min);
  if (m < 60) return `${m} phút`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} giờ ${r} phút` : `${h} giờ`;
}

/** Ghi chú nguồn số liệu (hiện khi rê chuột / dưới bảng). */
export const ENGINE_NOTE: Readonly<Record<RouteEngine, string>> = {
  'valhalla-bus': 'Đường xe khách thực tế',
  'osrm-car': `Đường ô tô thực tế, giờ đi ước cho xe khách (× ${BUS_FACTOR.toLocaleString('vi-VN')})`,
};
