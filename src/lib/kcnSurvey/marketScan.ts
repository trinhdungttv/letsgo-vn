// "Tải thông tin KCN" trước khi khảo sát: quét công ty trong KCN + nhà cung ứng lao động quanh KCN để định hình thị
// trường. Nguồn:
//   - Overture Maps (miễn phí, không cần khoá — nguồn chính): bộ địa điểm mở của Meta / Microsoft / Amazon…, nhiều
//     doanh nghiệp Việt Nam (lấy từ trang Facebook / Bing) kèm SĐT, Facebook, website — xem overtureScan.ts.
//   - OpenStreetMap (miễn phí): nhà máy / văn phòng có tên trong vùng KCN, văn phòng việc làm và các tên có chữ
//     "cung ứng / nhân lực / việc làm / tuyển dụng…" quanh KCN (Overpass) + tìm theo từ khoá (Photon). Thưa ở VN.
//   - Google Maps (cần khoá Google Places API cài trên máy chủ — chưa cài): tìm theo bộ từ khoá tự lên.
// Kết quả gộp trùng, đối chiếu với khách hàng / Pipeline / Thị trường / Đối thủ đã có. Phần đọc / gộp là hàm thuần.
import type { LatLng } from '../geo';
import type { Bounds } from './track';
import { boundsAround, distM, distToShape } from './track';
import { companyKey, compareKeys, foldVn } from '../companyMatch';
import { isZoneLikeName, type SurveyCompany } from './companies';
import { overpassPost } from './areaSearch';

export type ScanKind = 'company' | 'supplier';
export type ScanSource = 'google' | 'osm' | 'overture';

export interface ScanPlace {
  key: string;
  sources: ScanSource[];
  kind: ScanKind;
  name: string;
  lat: number;
  lng: number;
  address: string;
  /** "Nhà máy", "Văn phòng việc làm", loại địa điểm trên Google… */
  category: string;
  mapsUrl: string;
  phone: string;
  website: string;
  /** Trang Facebook (Overture lấy từ Meta) */
  facebook?: string;
  /** Trang "… Tuyển dụng" của chính nhà máy → nhà máy đang tuyển người */
  hiring?: boolean;
  /** Độ tin cậy 0..1 của Overture (thấp = có thể đã đóng / sai chỗ) */
  confidence?: number;
  /** Từ khoá đã tìm ra mục này */
  keywords: string[];
}

// ── Từ khoá tự lên ───────────────────────────────────────────────────────────
/** Ngành hay có trong KCN phía Nam — mỗi ngành 1 từ khoá để Google trả thêm công ty khác ngoài 60 kết quả / từ khoá. */
const INDUSTRY_WORDS = ['may mặc', 'điện tử', 'giày da', 'cơ khí', 'nhựa', 'thực phẩm', 'gỗ nội thất', 'bao bì', 'hoá chất', 'thép', 'dệt', 'linh kiện ô tô'];
const SUPPLIER_WORDS = [
  'công ty cung ứng lao động', 'cung ứng nhân lực', 'cho thuê lại lao động', 'dịch vụ việc làm', 'trung tâm giới thiệu việc làm',
  'tuyển dụng công nhân', 'văn phòng tuyển dụng', 'công ty nhân sự', 'cung ứng lao động thời vụ', 'manpower', 'outsourcing nhân sự',
];

/** Bộ từ khoá quét cho 1 KCN: công ty trong KCN (chung + theo ngành) và nhà cung ứng lao động quanh KCN. */
export function scanKeywords(zoneName: string): { company: string[]; supplier: string[] } {
  const short = zoneName.trim().replace(/^(khu công nghiệp|kcn)\s+/i, '');
  const company = [
    'công ty', 'nhà máy', 'công ty TNHH', 'Co., Ltd', 'factory',
    ...(short ? [`công ty KCN ${short}`, `nhà máy KCN ${short}`] : []),
    ...INDUSTRY_WORDS.map(w => `công ty ${w}`),
  ];
  return { company, supplier: [...SUPPLIER_WORDS, ...(short ? [`cung ứng lao động ${short}`, `tuyển dụng KCN ${short}`] : [])] };
}

/** Tên có dáng nhà cung ứng lao động / dịch vụ việc làm (bỏ dấu). */
const SUPPLIER_RE = /cung ung|nhan luc|viec lam|tuyen dung|lao dong|nhan su|manpower|outsourc|human resource|recruit|staffing|cho thue lai|headhunt/;
export const looksLikeSupplier = (name: string) => SUPPLIER_RE.test(foldVn(name));
/** Chỉ có chữ "tuyển dụng" kèm tên công ty ("Hyosung Tuyển Dụng") = trang tuyển người của nhà máy, không phải nhà cung ứng. */
const SUPPLIER_STRONG_RE = /cung ung|nhan luc|viec lam|lao dong|nhan su|manpower|outsourc|human resource|staffing|cho thue lai|headhunt|giai phap nhan/;
export const looksLikeHiringPage = (name: string) => /tuyen dung|tuyen cong nhan|tuyen lao dong/.test(foldVn(name)) && !SUPPLIER_STRONG_RE.test(foldVn(name).replace(/tuyen lao dong/g, ''));

// ── Vùng quét ────────────────────────────────────────────────────────────────
export interface ScanArea {
  /** Khung công ty: ranh giới KCN (hoặc quanh tâm) + 300 m */
  company: Bounds;
  /** Khung nhà cung ứng: quanh tâm KCN bán kính `supplierRadiusM` */
  supplier: Bounds;
  center: LatLng;
  rings: readonly (readonly [number, number][])[] | null;
  supplierRadiusM: number;
}

export function scanArea(center: LatLng, rings: readonly (readonly [number, number][])[] | null, companyRadiusM = 1500, supplierRadiusM = 6000): ScanArea {
  let company: Bounds | null = null;
  for (const r of rings ?? []) for (const [lat, lng] of r) {
    if (!company) company = { minLat: lat, maxLat: lat, minLng: lng, maxLng: lng };
    else { company.minLat = Math.min(company.minLat, lat); company.maxLat = Math.max(company.maxLat, lat); company.minLng = Math.min(company.minLng, lng); company.maxLng = Math.max(company.maxLng, lng); }
  }
  if (company) {
    const pad = boundsAround(center, 300);
    const dLat = (pad.maxLat - pad.minLat) / 2, dLng = (pad.maxLng - pad.minLng) / 2;
    company = { minLat: company.minLat - dLat, maxLat: company.maxLat + dLat, minLng: company.minLng - dLng, maxLng: company.maxLng + dLng };
  }
  return { company: company ?? boundsAround(center, companyRadiusM), supplier: boundsAround(center, supplierRadiusM), center, rings: rings?.length ? rings : null, supplierRadiusM };
}

/** Công ty có nằm trong KCN không (trong ranh giới; không có ranh giới thì trong khung). */
export function inCompanyArea(a: ScanArea, p: LatLng): boolean {
  // Trong ranh giới, hoặc sát viền ≤ 250 m (cổng / nhà máy ở mép KCN)
  if (a.rings) return distToShape(p, [], a.rings as [number, number][][]) <= 250;
  const b = a.company;
  return p.lat >= b.minLat && p.lat <= b.maxLat && p.lng >= b.minLng && p.lng <= b.maxLng;
}

// ── OpenStreetMap ────────────────────────────────────────────────────────────
const bb = (b: Bounds) => `${b.minLat.toFixed(5)},${b.minLng.toFixed(5)},${b.maxLat.toFixed(5)},${b.maxLng.toFixed(5)}`;
const SPLIT = 'lgvn_split';

/** 1 truy vấn Overpass: nơi có tên trong vùng KCN (nhà máy, văn phòng…) + nhà cung ứng lao động quanh KCN. */
export function buildScanQuery(a: ScanArea): string {
  const c = bb(a.company), s = bb(a.supplier);
  const words = 'cung ứng|Cung ứng|CUNG ỨNG|Cung Ứng|nhân lực|Nhân lực|NHÂN LỰC|Nhân Lực|việc làm|Việc làm|VIỆC LÀM|Việc Làm|tuyển dụng|Tuyển dụng|TUYỂN DỤNG|Tuyển Dụng|lao động|Lao động|LAO ĐỘNG|Lao Động|nhân sự|Nhân sự|NHÂN SỰ|Nhân Sự|[Mm]anpower|MANPOWER|[Oo]utsourc|OUTSOURC|[Rr]ecruit|RECRUIT|[Ss]taffing';
  return `[out:json][timeout:40];
(
  nwr["name"]["office"](${c});
  nwr["name"]["man_made"="works"](${c});
  nwr["name"]["industrial"](${c});
  nwr["name"]["craft"](${c});
  way["name"]["building"~"^(industrial|factory|warehouse|manufacture|office|commercial)$"](${c});
  way["name"]["landuse"="industrial"](${c});
);
out center tags;
make ${SPLIT} kind="supplier";
out;
(
  nwr["office"="employment_agency"](${s});
  nwr["name"~"${words}"](${s});
);
out center tags;`;
}

interface OsmEl { type: string; id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> }

const osmCategory = (t: Record<string, string>): string => {
  if (t.office === 'employment_agency') return 'Văn phòng việc làm';
  if (t.man_made === 'works' || t.industrial || /industrial|factory|manufacture/.test(t.building ?? '')) return 'Nhà máy';
  if (t.building === 'warehouse' || t.industrial === 'warehouse') return 'Kho';
  if (t.office) return 'Văn phòng';
  if (t.craft) return 'Xưởng';
  if (t.landuse === 'industrial') return 'Khu nhà xưởng';
  return 'Địa điểm';
};
const osmAddress = (t: Record<string, string>) => [
  [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' '), t['addr:subdistrict'] ?? t['addr:ward'], t['addr:district'], t['addr:city'] ?? t['addr:province'],
].filter(Boolean).join(', ') || t['addr:full'] || '';

/** Kết quả Overpass → nơi có tên (bỏ ranh giới KCN, bỏ đường / trạm xe buýt trùng chữ). */
export function parseScanOsm(data: unknown, a: ScanArea): ScanPlace[] {
  const els = (data as { elements?: (OsmEl | { type: string; tags?: Record<string, string> })[] })?.elements;
  if (!Array.isArray(els)) return [];
  const out: ScanPlace[] = [];
  let section: 'company' | 'supplier' = 'company';
  for (const raw of els) {
    if (raw.type === SPLIT) { section = 'supplier'; continue; }
    const el = raw as OsmEl;
    const t = el.tags ?? {};
    const name = (t.name ?? t['name:vi'] ?? '').trim();
    const lat = el.lat ?? el.center?.lat, lng = el.lon ?? el.center?.lon;
    if (!name || lat == null || lng == null) continue;
    if (t.highway || t.public_transport || t.railway || isZoneLikeName(name)) continue;
    const supplier = section === 'supplier' || t.office === 'employment_agency' || looksLikeSupplier(name);
    // Nhà cung ứng quét theo tên ("lao động", "việc làm") dễ dính trường học / bệnh viện / công viên → bỏ
    if (section === 'supplier' && t.office !== 'employment_agency' && ((t.amenity && t.amenity !== 'office') || t.leisure || t.tourism || t.landuse || t.boundary)) continue;
    if (!supplier && !inCompanyArea(a, { lat, lng })) continue;
    out.push({
      key: `o:${el.type[0]}${el.id}`, sources: ['osm'], kind: supplier ? 'supplier' : 'company', name, lat, lng,
      address: osmAddress(t), category: osmCategory(t),
      mapsUrl: `https://www.google.com/maps/search/?api=1&query=${lat.toFixed(6)},${lng.toFixed(6)}`,
      phone: t.phone ?? t['contact:phone'] ?? '', website: t.website ?? t['contact:website'] ?? '', keywords: ['OpenStreetMap'],
    });
  }
  return out;
}

export async function scanOsm(a: ScanArea, signal?: AbortSignal): Promise<ScanPlace[]> {
  try {
    return parseScanOsm(await overpassPost(buildScanQuery(a), signal), a);
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new Error(`OpenStreetMap: ${(e as Error).message}`);
  }
}

// ── Photon (tìm theo từ khoá trên dữ liệu OSM) ───────────────────────────────
interface PhotonF { properties?: { osm_type?: string; osm_id?: number; osm_key?: string; osm_value?: string; name?: string; street?: string; housenumber?: string; district?: string; county?: string; city?: string; state?: string }; geometry?: { coordinates?: [number, number] } }

/** Kết quả Photon cho 1 từ khoá nhà cung ứng: chỉ giữ tên có dáng cung ứng / việc làm, trong khung quanh KCN. */
export function parsePhotonSuppliers(data: unknown, a: ScanArea, keyword: string): ScanPlace[] {
  const feats = (data as { features?: PhotonF[] })?.features;
  if (!Array.isArray(feats)) return [];
  const b = a.supplier;
  const out: ScanPlace[] = [];
  for (const f of feats) {
    const pr = f.properties ?? {};
    const c = f.geometry?.coordinates;
    const name = (pr.name ?? '').trim();
    if (!name || !c || ['highway', 'railway', 'public_transport', 'boundary', 'place'].includes(pr.osm_key ?? '')) continue;
    const lat = c[1], lng = c[0];
    if (lat < b.minLat || lat > b.maxLat || lng < b.minLng || lng > b.maxLng || !looksLikeSupplier(name)) continue;
    out.push({
      key: `o:${(pr.osm_type ?? 'n').toLowerCase()}${pr.osm_id ?? `${lat},${lng}`}`, sources: ['osm'], kind: 'supplier', name, lat, lng,
      address: [[pr.housenumber, pr.street].filter(Boolean).join(' '), pr.district ?? pr.county, pr.city ?? pr.state].filter(Boolean).join(', '),
      category: pr.osm_value === 'employment_agency' ? 'Văn phòng việc làm' : 'Địa điểm',
      mapsUrl: `https://www.google.com/maps/search/?api=1&query=${lat.toFixed(6)},${lng.toFixed(6)}`, phone: '', website: '', keywords: [keyword],
    });
  }
  return out;
}

export async function photonSuppliers(keyword: string, a: ScanArea, signal?: AbortSignal): Promise<ScanPlace[]> {
  const b = a.supplier;
  const params = new URLSearchParams({ q: keyword, limit: '15', lat: String(a.center.lat), lon: String(a.center.lng), bbox: `${b.minLng},${b.minLat},${b.maxLng},${b.maxLat}` });
  const res = await fetch(`https://photon.komoot.io/api/?${params.toString()}`, { signal });
  if (!res.ok) throw new Error(`Photon lỗi ${res.status}`);
  return parsePhotonSuppliers(await res.json(), a, keyword);
}

// ── Google Maps (qua máy chủ của app) ─────────────────────────────────────────
interface GPlace { id: string; name: string; address: string; lat: number; lng: number; type: string; types: string[]; mapsUrl: string; status: string }

export async function googleEnabled(): Promise<boolean> {
  try {
    const res = await fetch('/api/places-search');
    if (!res.ok) return false;
    return !!((await res.json()) as { enabled?: boolean }).enabled;
  } catch { return false; }
}

/** 1 từ khoá, tối đa `pages` trang × 20 kết quả. */
export async function googleSearch(query: string, where: { rect?: Bounds; circle?: { center: LatLng; radius: number } }, token: string | null, pages = 3, signal?: AbortSignal): Promise<GPlace[]> {
  const out: GPlace[] = [];
  let pageToken: string | null = null;
  for (let i = 0; i < pages; i++) {
    const body: Record<string, unknown> = { query };
    if (where.rect) body.rect = { low: { lat: where.rect.minLat, lng: where.rect.minLng }, high: { lat: where.rect.maxLat, lng: where.rect.maxLng } };
    else if (where.circle) body.circle = { lat: where.circle.center.lat, lng: where.circle.center.lng, radius: where.circle.radius };
    if (pageToken) body.pageToken = pageToken;
    const res = await fetch('/api/places-search', {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json', ...(token ? { 'x-letsgo-token': token } : {}) },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as { places?: GPlace[]; nextPageToken?: string | null; error?: string };
    if (!res.ok) throw new Error(data.error ?? `Google Maps lỗi ${res.status}`);
    out.push(...(data.places ?? []));
    pageToken = data.nextPageToken ?? null;
    if (!pageToken) break;
    // Google cần vài giây mới dùng được trang kế
    await new Promise(r => setTimeout(r, 1500));
  }
  return out;
}

/** Kết quả Google → ScanPlace (bỏ nơi đã đóng cửa hẳn, bỏ chính KCN). */
export function fromGoogle(list: readonly GPlace[], kind: ScanKind, keyword: string, a: ScanArea): ScanPlace[] {
  return list
    .filter(p => p.status !== 'CLOSED_PERMANENTLY' && !isZoneLikeName(p.name))
    .filter(p => kind === 'supplier' || inCompanyArea(a, p))
    .map(p => ({
      key: `g:${p.id}`, sources: ['google' as const], kind: kind === 'company' && looksLikeSupplier(p.name) ? 'supplier' as const : kind,
      name: p.name, lat: p.lat, lng: p.lng, address: p.address, category: p.type || 'Địa điểm', mapsUrl: p.mapsUrl, phone: '', website: '',
      keywords: [keyword],
    }));
}

// ── Gộp trùng + đối chiếu ────────────────────────────────────────────────────
/** Bỏ chữ "tuyển dụng" khỏi tên trang tuyển người của nhà máy ("Hyosung Tuyển Dụng" → "Hyosung") để gộp với nhà máy. */
export const stripHiring = (name: string) => name.replace(/[-–|·:]*\s*(tuyển dụng|tuyen dung|tuyển công nhân|tuyển lao động)\s*[-–|·:]*/gi, ' ').replace(/\s+/g, ' ').trim() || name;

/** Gộp nơi trùng (cùng mã, hoặc tên lõi giống hệt / rất giống trong vòng 400 m). Giữ thông tin đầy đủ nhất. */
export function mergeScan(lists: readonly (readonly ScanPlace[])[]): ScanPlace[] {
  const out: ScanPlace[] = [];
  const keyOf = new Map<ScanPlace, ReturnType<typeof companyKey>>();
  for (const list of lists) {
    for (const p of list) {
      const k = companyKey(stripHiring(p.name));
      const hit = out.find(o => o.key === p.key || ((() => { const m = compareKeys(k, keyOf.get(o)!); return !!m && m.level !== 'maybe'; })() && distM(o, p) < 400));
      if (!hit) { const copy = { ...p, sources: [...p.sources], keywords: [...p.keywords] }; out.push(copy); keyOf.set(copy, k); continue; }
      for (const s of p.sources) if (!hit.sources.includes(s)) hit.sources.push(s);
      for (const w of p.keywords) if (!hit.keywords.includes(w)) hit.keywords.push(w);
      if (p.sources.includes('google') && !hit.mapsUrl.includes('cid=') && p.mapsUrl) hit.mapsUrl = p.mapsUrl;
      if (!hit.address && p.address) hit.address = p.address;
      if (!hit.phone && p.phone) hit.phone = p.phone;
      if (!hit.website && p.website) hit.website = p.website;
      if (!hit.facebook && p.facebook) hit.facebook = p.facebook;
      if (p.hiring) hit.hiring = true;
      if (p.confidence != null) hit.confidence = Math.max(hit.confidence ?? 0, p.confidence);
      if (p.kind === 'supplier') hit.kind = 'supplier';
      // Gộp trang "… Tuyển dụng" vào nhà máy: giữ tên nhà máy
      if (hit.hiring && looksLikeHiringPage(hit.name) && !looksLikeHiringPage(p.name)) hit.name = p.name;
    }
  }
  return out;
}

export interface CompetitorLite { id: string; company_name: string; active_zones: string[] | null; zone_name: string | null }

export type ScanMatch =
  | { type: 'new' }
  | { type: 'company'; company: SurveyCompany }
  | { type: 'competitor'; competitor: CompetitorLite; activeHere: boolean };

/** Đã có trong hệ thống chưa: công ty → khách hàng / Pipeline / Thị trường; nhà cung ứng → Đối thủ (có ghi nhận ở KCN này chưa). */
export function matchScan(p: ScanPlace, companies: readonly SurveyCompany[], competitors: readonly CompetitorLite[], zoneName: string): ScanMatch {
  const k = companyKey(p.name);
  if (p.kind === 'supplier') {
    let best: { c: CompetitorLite; score: number } | null = null;
    for (const c of competitors) {
      const m = compareKeys(k, companyKey(c.company_name));
      if (m && m.level !== 'maybe' && (!best || m.score > best.score)) best = { c, score: m.score };
    }
    if (best) {
      const z = foldVn(zoneName).replace(/^(kcn|khu cong nghiep)\s+/, '');
      const activeHere = (best.c.active_zones ?? []).some(a => foldVn(a).replace(/^(kcn|khu cong nghiep)\s+/, '') === z);
      return { type: 'competitor', competitor: best.c, activeHere };
    }
    return { type: 'new' };
  }
  let best: { c: SurveyCompany; score: number } | null = null;
  for (const c of companies) {
    if (c.status === 'osm') continue;
    const m = compareKeys(k, companyKey(c.name));
    if (!m || m.level === 'maybe') continue;
    // Tên rất giống mà ghim ở xa (> 3 km) thì có thể là công ty khác cùng tên
    if (m.level === 'likely' && c.points.length && c.points.every(q => distM(q, p) > 3000)) continue;
    if (!best || m.score > best.score) best = { c, score: m.score };
  }
  return best ? { type: 'company', company: best.c } : { type: 'new' };
}

// ── Nhớ kết quả trong máy (30 ngày) ──────────────────────────────────────────
const CACHE_PREFIX = 'lgvn_kcn_scan_v1:';
export const SCAN_TTL_MS = 30 * 86_400_000;

export interface ScanCache { at: number; places: ScanPlace[]; sources: ScanSource[] }

export function readScanCache(zoneId: string, now = Date.now()): ScanCache | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + zoneId);
    if (!raw) return null;
    const c = JSON.parse(raw) as ScanCache;
    if (!c?.at || !Array.isArray(c.places) || now - c.at > SCAN_TTL_MS) return null;
    return c;
  } catch { return null; }
}
export function writeScanCache(zoneId: string, c: ScanCache) {
  try { localStorage.setItem(CACHE_PREFIX + zoneId, JSON.stringify(c)); } catch { /* đầy bộ nhớ — lần sau quét lại */ }
}
