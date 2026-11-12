// Kế hoạch ghé công ty (migration 223) — phần gọi mạng: bảng kcn_survey_plan_stops, máy định tuyến Valhalla (xe máy),
// tìm công ty theo tên ở 4 nguồn: trong hệ thống → bản đồ quanh KCN (Overture, đã/đang quét) → OpenStreetMap (Photon) → Google (khi có khoá).
// Phần thuần ở planStops.ts.
import { supabase } from '../supabase';
import { isMissingTableError } from '../clientMaps/orgChart';
import { isValidVnLatLng, type LatLng } from '../geo';
import { extractLatLng, isShortMapLink } from '../cskh/nearby';
import { distM } from './track';
import { ESTIMATE_KMH, estimateM, nameMatchScore, normStop, type PlanStop, type StopSource } from './planStops';
import type { SurveyCompany } from './companies';
import type { ScanPlace } from './marketScan';

export const PLAN_MIGRATION_HINT = 'Cần chạy migration 223 (Kế hoạch ghé công ty) trong Supabase → SQL Editor';
export class PlanMissingTable extends Error {}

/** fetch có hạn chờ — máy chủ bản đồ công cộng có lúc treo hẳn (Photon từng không trả lời > 10 s ở mạng VN) */
async function fetchT(url: string, init: RequestInit & { signal?: AbortSignal } = {}, ms = 8000): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new DOMException('Hết thời gian chờ', 'TimeoutError')), ms);
  const outer = init.signal;
  const onAbort = () => ctrl.abort(outer?.reason);
  if (outer) { if (outer.aborted) ctrl.abort(outer.reason); else outer.addEventListener('abort', onAbort, { once: true }); }
  try { return await fetch(url, { ...init, signal: ctrl.signal }); }
  finally { clearTimeout(timer); outer?.removeEventListener('abort', onAbort); }
}

const fail = (e: { code?: string; message?: string }): never => {
  if (isMissingTableError(e)) throw new PlanMissingTable(PLAN_MIGRATION_HINT);
  throw new Error(e.message ?? String(e));
};

// ── Bảng ─────────────────────────────────────────────────────────────────────
export async function listPlanStops(): Promise<PlanStop[]> {
  const { data, error } = await supabase.from('kcn_survey_plan_stops').select('*').is('deleted_at', null).order('created_at', { ascending: true }).limit(2000);
  if (error) fail(error);
  return ((data ?? []) as Record<string, unknown>[]).map(normStop).filter((x): x is PlanStop => !!x);
}

export type NewStop = Pick<PlanStop, 'zone_id' | 'zone_name' | 'name' | 'address' | 'lat' | 'lng' | 'source' | 'ref_key' | 'map_link' | 'note'>;

export async function addPlanStops(rows: readonly NewStop[], userName: string): Promise<PlanStop[]> {
  if (!rows.length) return [];
  const { data, error } = await supabase.from('kcn_survey_plan_stops')
    .insert(rows.map(r => ({ ...r, id: crypto.randomUUID(), created_by: userName, updated_by: userName }))).select('*');
  if (error) fail(error);
  return ((data ?? []) as Record<string, unknown>[]).map(normStop).filter((x): x is PlanStop => !!x);
}

export async function updatePlanStop(id: string, patch: Partial<Pick<PlanStop, 'name' | 'address' | 'note' | 'lat' | 'lng' | 'map_link'>>, userName: string): Promise<PlanStop | null> {
  const { data, error } = await supabase.from('kcn_survey_plan_stops').update({ ...patch, updated_by: userName }).eq('id', id).select('*').single();
  if (error) fail(error);
  return normStop(data as Record<string, unknown>);
}

/** Xoá MỀM (deleted_at) — dòng vẫn còn trong DB */
export async function deletePlanStop(id: string, userName: string): Promise<void> {
  const { error } = await supabase.from('kcn_survey_plan_stops').update({ deleted_at: new Date().toISOString(), updated_by: userName }).eq('id', id);
  if (error) fail(error);
}

/** Tới nơi (GPS ≤ 50 m) trong 1 chuyến — "đã ghé" tính theo từng chuyến */
export async function markStopVisited(id: string, tripId: string | null): Promise<void> {
  const { error } = await supabase.from('kcn_survey_plan_stops').update({ visited_at: new Date().toISOString(), visited_trip_id: tripId }).eq('id', id);
  if (error) fail(error);
}

// ── Link Google Maps rút gọn → toạ độ (qua api/resolve-map, cần phiên đăng nhập) ──
export interface ResolvedLink { url: string; coords: LatLng | null }
export async function resolveMapLink(url: string, token: string | null): Promise<ResolvedLink | null> {
  const direct = extractLatLng(url);
  if (direct) return { url, coords: direct };
  if (!isShortMapLink(url)) return { url, coords: null };
  try {
    const res = await fetchT('/api/resolve-map', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { 'x-letsgo-token': token } : {}) },
      body: JSON.stringify({ url }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { url?: string };
    if (typeof data.url !== 'string') return null;
    const coords = extractLatLng(data.url);
    return { url: data.url, coords: coords && isValidVnLatLng(coords) ? coords : null };
  } catch { return null; }
}

// ── Định tuyến xe máy (Valhalla FOSSGIS, CORS mở, chạy được ở mạng VN) ───────
const VALHALLA_URL = 'https://valhalla1.openstreetmap.de';

export interface RouteMatrix {
  /** giây đi xe máy i → j (đường 1 chiều nên có thể lệch chiều) */
  sec: number[][];
  /** km i → j */
  km: number[][];
  engine: 'valhalla' | 'estimate';
}

function estimateMatrix(pts: readonly LatLng[]): RouteMatrix {
  const km = pts.map(a => pts.map(b => estimateM(a, b) / 1000));
  return { km, sec: km.map(r => r.map(k => (k / ESTIMATE_KMH) * 3600)), engine: 'estimate' };
}

/** Ma trận thời gian / quãng đường xe máy giữa mọi cặp điểm (≤ 50 điểm). Lỗi mạng → ước tính theo chim bay. */
export async function routeMatrix(pts: readonly LatLng[], signal?: AbortSignal): Promise<RouteMatrix> {
  if (pts.length < 2 || pts.length > 50) return estimateMatrix(pts);
  try {
    const locs = pts.map(p => ({ lat: p.lat, lon: p.lng }));
    const res = await fetchT(`${VALHALLA_URL}/sources_to_targets`, {
      method: 'POST', signal, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sources: locs, targets: locs, costing: 'motorcycle', units: 'kilometers' }),
    }, 12_000);
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json() as { sources_to_targets?: { from_index: number; to_index: number; distance: number | null; time: number | null }[][] };
    const rows = data.sources_to_targets;
    if (!Array.isArray(rows) || rows.length !== pts.length) throw new Error('lạ');
    const est = estimateMatrix(pts);
    const sec = est.sec.map(r => r.slice()), km = est.km.map(r => r.slice());
    for (const row of rows) for (const c of row) {
      // Ô không tới được (điểm nằm giữa ruộng / ngoài mạng đường) → giữ ước tính ×1,5 để vẫn xếp được
      if (c.time != null && c.distance != null) { sec[c.from_index][c.to_index] = c.time; km[c.from_index][c.to_index] = c.distance; }
      else { sec[c.from_index][c.to_index] *= 1.5; km[c.from_index][c.to_index] *= 1.5; }
    }
    return { sec, km, engine: 'valhalla' };
  } catch (e) {
    if ((e as Error).name === 'AbortError' && signal?.aborted) throw e;
    return estimateMatrix(pts);
  }
}

/** Giải mã polyline độ chính xác 6 chữ số (Valhalla) → [lat, lng][] */
export function decodePolyline6(str: string): [number, number][] {
  const out: [number, number][] = [];
  let i = 0, lat = 0, lng = 0;
  while (i < str.length) {
    for (const which of [0, 1]) {
      let shift = 0, result = 0, b: number;
      do { b = str.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20 && i < str.length);
      const d = result & 1 ? ~(result >> 1) : result >> 1;
      if (which === 0) lat += d; else lng += d;
    }
    out.push([lat / 1e6, lng / 1e6]);
  }
  return out;
}

/** Đường xe máy thật đi qua các điểm theo thứ tự (vẽ lên bản đồ) — chia 20 điểm / lượt gọi. null = không gọi được. */
export async function routeShape(pts: readonly LatLng[], signal?: AbortSignal): Promise<{ lines: [number, number][][]; km: number; sec: number } | null> {
  if (pts.length < 2) return null;
  const lines: [number, number][][] = [];
  let km = 0, sec = 0;
  try {
    for (let i = 0; i < pts.length - 1; i += 19) {
      const chunk = pts.slice(i, i + 20);
      const res = await fetchT(`${VALHALLA_URL}/route`, {
        method: 'POST', signal, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locations: chunk.map(p => ({ lat: p.lat, lon: p.lng })), costing: 'motorcycle', units: 'kilometers' }),
      }, 12_000);
      if (!res.ok) return null;
      const data = await res.json() as { trip?: { summary?: { length: number; time: number }; legs?: { shape: string }[] } };
      if (!data.trip?.legs) return null;
      for (const leg of data.trip.legs) lines.push(decodePolyline6(leg.shape));
      km += data.trip.summary?.length ?? 0;
      sec += data.trip.summary?.time ?? 0;
    }
    return { lines, km, sec };
  } catch { return null; }
}

// ── Tìm công ty theo tên ────────────────────────────────────────────────────
export interface StopCandidate {
  key: string;
  name: string;
  lat: number;
  lng: number;
  address: string;
  source: StopSource;
  refKey: string;
  mapLink: string;
  /** cách tâm KCN (m) */
  distM: number | null;
  score: number;
  /** nhãn phụ: "Khách hàng", "Nhà máy", số điện thoại… */
  hint: string;
}

const STATUS_HINT: Record<string, string> = { client: 'Khách hàng', pipeline: 'Pipeline', prospect: 'KH tiềm năng', declined: 'Không hợp tác', stopped: 'Ngừng hợp tác', lead: 'Thị trường', osm: 'Bản đồ' };
const dist = (center: LatLng | null, p: LatLng) => (center ? Math.round(distM(center, p)) : null);
/** Gần KCN được cộng điểm nhẹ để công ty cùng tên ở tỉnh khác xuống dưới */
const rank = (score: number, d: number | null) => score - (d == null ? 0 : Math.min(0.25, d / 200_000));

export function searchSystem(q: string, companies: readonly SurveyCompany[], center: LatLng | null): StopCandidate[] {
  const out: StopCandidate[] = [];
  for (const c of companies) {
    const p = c.points[0] ?? (c.rings[0]?.[0] ? { lat: c.rings[0][0][0], lng: c.rings[0][0][1] } : null);
    if (!p || c.status === 'osm') continue;
    const score = nameMatchScore(q, c.name);
    if (score <= 0) continue;
    const d = dist(center, p);
    out.push({ key: c.key, name: c.name, lat: p.lat, lng: p.lng, address: '', source: 'system', refKey: c.key, mapLink: '', distM: d, score: rank(score + 0.05, d), hint: STATUS_HINT[c.status] ?? '' });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 8);
}

export function searchScanPlaces(q: string, places: readonly ScanPlace[], center: LatLng | null): StopCandidate[] {
  const out: StopCandidate[] = [];
  for (const p of places) {
    if (p.kind !== 'company') continue;
    const score = nameMatchScore(q, p.name);
    if (score <= 0) continue;
    const d = dist(center, p);
    const src: StopSource = p.sources.includes('google') ? 'google' : p.sources.includes('overture') ? 'overture' : 'osm';
    out.push({ key: `s:${p.key}`, name: p.name, lat: p.lat, lng: p.lng, address: p.address, source: src, refKey: '', mapLink: p.mapsUrl, distM: d, score: rank(score, d), hint: [p.category, p.phone].filter(Boolean).join(' · ') });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 8);
}

const PHOTON_API = 'https://photon.komoot.io/api/';
const VN_BBOX = '102.1,8.2,109.6,23.4';

export async function searchPhoton(q: string, center: LatLng | null, signal?: AbortSignal): Promise<StopCandidate[]> {
  const params = new URLSearchParams({ q, limit: '10', bbox: VN_BBOX });
  if (center) { params.set('lat', String(center.lat)); params.set('lon', String(center.lng)); }
  const res = await fetchT(`${PHOTON_API}?${params.toString()}`, { signal }, 7000);
  if (!res.ok) throw new Error(`Bản đồ OSM lỗi ${res.status}`);
  const data = await res.json() as { features?: { geometry?: { coordinates?: [number, number] }; properties?: Record<string, string | undefined> }[] };
  const out: StopCandidate[] = [];
  for (const f of data.features ?? []) {
    const c = f.geometry?.coordinates;
    const pr = f.properties ?? {};
    if (!c || !pr.name || (pr.countrycode && pr.countrycode !== 'VN')) continue;
    const p = { lat: c[1], lng: c[0] };
    if (!isValidVnLatLng(p)) continue;
    const score = nameMatchScore(q, pr.name);
    if (score <= 0) continue;
    const d = dist(center, p);
    out.push({
      key: `o:${pr.osm_type ?? ''}${pr.osm_id ?? `${p.lat},${p.lng}`}`, name: pr.name, lat: p.lat, lng: p.lng,
      address: [pr.street, pr.district, pr.city, pr.state].filter(Boolean).join(', '), source: 'osm', refKey: '', mapLink: '', distM: d, score: rank(score, d), hint: '',
    });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 6);
}

let googleOn: Promise<boolean> | null = null;
/** Đã cài GOOGLE_MAPS_API_KEY trên Vercel chưa (hỏi 1 lần mỗi phiên) */
export function googlePlacesEnabled(): Promise<boolean> {
  googleOn ??= fetchT('/api/places-search', {}, 6000).then(r => (r.ok ? r.json() : { enabled: false })).then((d: { enabled?: boolean }) => !!d.enabled).catch(() => false);
  return googleOn;
}

export async function searchGoogle(q: string, center: LatLng | null, token: string | null, signal?: AbortSignal): Promise<StopCandidate[]> {
  const body: Record<string, unknown> = { query: q };
  if (center) body.circle = { lat: center.lat, lng: center.lng, radius: 20_000 };
  const res = await fetchT('/api/places-search', {
    method: 'POST', signal, headers: { 'Content-Type': 'application/json', ...(token ? { 'x-letsgo-token': token } : {}) }, body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { places?: { id: string; name: string; address: string; lat: number; lng: number; type: string; mapsUrl: string; status: string }[]; error?: string };
  if (!res.ok) throw new Error(data.error ?? `Google Maps lỗi ${res.status}`);
  return (data.places ?? []).filter(p => p.status !== 'CLOSED_PERMANENTLY').slice(0, 8).map((p, i) => {
    const d = dist(center, p);
    // Google đã xếp theo độ liên quan — giữ thứ tự đó, chỉ cộng nhẹ khi tên khớp
    return { key: `g:${p.id}`, name: p.name, lat: p.lat, lng: p.lng, address: p.address, source: 'google' as const, refKey: '', mapLink: p.mapsUrl, distM: d, score: rank(0.6 - i * 0.02 + nameMatchScore(q, p.name) * 0.3, d), hint: p.type };
  });
}

/** Link mở Google Maps tìm sẵn tên công ty quanh KCN — để tự tìm rồi bấm Chia sẻ → dán link về */
export const googleSearchUrl = (q: string, center: LatLng | null) =>
  `https://www.google.com/maps/search/${encodeURIComponent(q)}${center ? `/@${center.lat.toFixed(5)},${center.lng.toFixed(5)},14z` : ''}`;
