// Đang ở KCN nào, tên chuyến khảo sát, công ty thuộc KCN — hàm thuần, test được.
//
// Nhận KCN: ưu tiên RANH GIỚI KCN trên OpenStreetMap chứa vị trí đang đứng (chắc chắn đúng khu); không có ranh giới
// thì xếp theo khoảng cách tới tâm KCN trong danh mục (market_zones). Cụm KCN sát nhau (Nhơn Trạch 1 / 2 / 3 / 6…)
// mà 2 tâm gần ngang nhau thì báo "chưa chắc" để app hỏi lại trước khi bắt đầu.
import type { LatLng } from '../geo';
import type { OsmZone } from './overpass';
import type { SurveyCompany } from './companies';
import { distM, pointInRing } from './track';

const ROMAN: Record<string, string> = { i: '1', ii: '2', iii: '3', iv: '4', v: '5', vi: '6', vii: '7', viii: '8', ix: '9', x: '10', xi: '11', xii: '12' };

/** Tên KCN bỏ dấu + bỏ chữ "KCN / khu công nghiệp…" + số La Mã thành số (OSM hay ghi "Nhơn Trạch III"):
 *  "KCN Nhơn Trạch 3" / "Khu công nghiệp Nhơn Trạch III" → "nhon trach 3". */
export const foldZoneName = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase()
  .replace(/khu\s*cong\s*nghiep|cum\s*cong\s*nghiep|khu\s*che\s*xuat|industrial\s*(park|zone|estate)|\bkcn\b|\bccn\b|\bkcx\b/g, ' ')
  .replace(/[^a-z0-9]+/g, ' ').trim()
  .split(' ').map(w => ROMAN[w] ?? w).join(' ');

const digitsOf = (s: string) => (s.match(/\d+/g) ?? []).join(',');

/** 2 tên KCN là 1: trùng sau khi bỏ dấu; khác SỐ thì không bao giờ ("Nhơn Trạch" ≠ "Nhơn Trạch 3"); tên này nằm trọn trong tên kia (theo từ). */
export function zoneNameMatch(a: string, b: string): boolean {
  const x = foldZoneName(a), y = foldZoneName(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (digitsOf(x) !== digitsOf(y)) return false;
  const [s, l] = x.length <= y.length ? [x, y] : [y, x];
  return s.length >= 4 && ` ${l} `.includes(` ${s} `);
}

export interface ZoneRefLite {
  id: string;
  name: string;
  lat?: number | null;
  lng?: number | null;
}

/** Diện tích tương đối của vòng (để chọn ranh giới nhỏ nhất chứa điểm). */
function ringArea(ring: readonly [number, number][]): number {
  let a = 0;
  for (let i = 1; i < ring.length; i++) a += ring[i - 1][1] * ring[i][0] - ring[i][1] * ring[i - 1][0];
  return Math.abs(a / 2);
}

/** Ranh giới OSM nhỏ nhất chứa điểm (KCN lồng trong khu lớn hơn thì lấy KCN). */
export function osmZoneAt(p: LatLng, osmZones: readonly OsmZone[]): OsmZone | null {
  const hits = osmZones.filter(z => z.rings.some(r => pointInRing(p.lat, p.lng, r)));
  if (!hits.length) return null;
  return [...hits].sort((a, b) => Math.min(...a.rings.map(ringArea)) - Math.min(...b.rings.map(ringArea)))[0];
}

/**
 * KCN trong danh mục ứng với 1 ranh giới OSM: trùng tên trước; không thì KCN DUY NHẤT có tâm nằm trong ranh giới.
 * Ranh giới CỤM (OSM vẽ 1 khối "Khu công nghiệp Nhơn Trạch" bao cả tâm "Nhơn Trạch 1 / 3 / 6" — tên cụ thể hơn tên khối)
 * thì không chốt được KCN nào → null, để app hỏi lại theo khoảng cách.
 */
export function matchMarketZone(osm: OsmZone, zones: readonly ZoneRefLite[]): ZoneRefLite | null {
  const inside = zones.filter(z => z.lat != null && z.lng != null && osm.rings.some(r => pointInRing(z.lat!, z.lng!, r)));
  const base = foldZoneName(osm.name);
  if (base && inside.some(z => foldZoneName(z.name).startsWith(`${base} `))) return null;
  const named = zones.filter(z => zoneNameMatch(z.name, osm.name));
  if (named.length === 1) return named[0];
  return inside.length === 1 ? inside[0] : null;
}

export interface ZoneCandidate {
  zone: ZoneRefLite;
  /** Khoảng cách tới tâm KCN (m) — 0 nếu KCN không có toạ độ mà vẫn nhận ra nhờ ranh giới */
  dist: number;
  /** Đang đứng trong ranh giới OSM của KCN này */
  inside: boolean;
}

export interface ZoneDetection {
  best: ZoneCandidate | null;
  /** Các KCN quanh đây, gần trước (KCN chứa vị trí đứng đầu) */
  candidates: ZoneCandidate[];
  /** Chắc chắn: đứng trong ranh giới, hoặc KCN gần nhất bỏ xa KCN thứ 2 */
  sure: boolean;
}

/** Cách nhau ít hơn bấy nhiêu mét giữa KCN gần nhất và gần thứ 2 thì coi là "chưa chắc". */
export const ZONE_AMBIGUOUS_M = 800;

export function detectZone(p: LatLng, osmZones: readonly OsmZone[], zones: readonly ZoneRefLite[], maxM = 3000): ZoneDetection {
  const near: ZoneCandidate[] = zones
    .filter(z => z.lat != null && z.lng != null)
    .map(z => ({ zone: z, dist: distM(p, { lat: z.lat!, lng: z.lng! }), inside: false }))
    .filter(c => c.dist <= maxM)
    .sort((a, b) => a.dist - b.dist);
  const osm = osmZoneAt(p, osmZones);
  const hit = osm ? matchMarketZone(osm, zones) : null;
  if (hit) {
    const own = near.find(c => c.zone.id === hit.id) ?? { zone: hit, dist: hit.lat != null && hit.lng != null ? distM(p, { lat: hit.lat, lng: hit.lng }) : 0, inside: true };
    const best = { ...own, inside: true };
    return { best, candidates: [best, ...near.filter(c => c.zone.id !== hit.id)], sure: true };
  }
  const best = near[0] ?? null;
  const second = near[1];
  return { best, candidates: near, sure: !!best && (!second || second.dist - best.dist >= ZONE_AMBIGUOUS_M) };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Tên chuyến: "KCN Nhơn Trạch 3 – Khảo sát 03/11/2026 (lần 2)"; không gắn KCN: "Khảo sát 03/11/2026 08:15". */
export function surveyTitle(zoneName: string | null | undefined, at: Date, nth = 1): string {
  const date = `${pad(at.getDate())}/${pad(at.getMonth() + 1)}/${at.getFullYear()}`;
  const z = (zoneName ?? '').trim();
  if (!z) return `Khảo sát ${date} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
  return `${z} – Khảo sát ${date}${nth > 1 ? ` (lần ${nth})` : ''}`;
}

/** Đầu & cuối ngày (giờ máy) của 1 thời điểm — để đếm "lần thứ mấy trong ngày". */
export function dayRange(at: Date): { from: string; to: string } {
  const a = new Date(at.getFullYear(), at.getMonth(), at.getDate());
  const b = new Date(at.getFullYear(), at.getMonth(), at.getDate() + 1);
  return { from: a.toISOString(), to: b.toISOString() };
}

/**
 * Công ty thuộc KCN đang khảo sát: có ghim / khối nhà xưởng nằm trong ranh giới OSM; KCN chưa có ranh giới trên OSM thì
 * lấy công ty trong bán kính quanh tâm KCN.
 */
export function companiesInArea(companies: readonly SurveyCompany[], boundary: OsmZone | null, center: LatLng | null, radiusM = 1500): SurveyCompany[] {
  const inBoundary = (lat: number, lng: number) => boundary!.rings.some(r => pointInRing(lat, lng, r));
  return companies.filter(c => {
    const pts = [...c.points, ...c.rings.map(r => ({ lat: r[0][0], lng: r[0][1] }))];
    if (!pts.length) return false;
    if (boundary) return pts.some(p => inBoundary(p.lat, p.lng));
    return !!center && pts.some(p => distM(center, p) <= radiusM);
  });
}

/**
 * Ranh giới CỤM (1 khối OSM bao nhiều KCN, VD "Khu công nghiệp Nhơn Trạch" bao Nhơn Trạch 1 / 3 / 6): chia phần cho
 * từng KCN theo tâm gần nhất, để Nhơn Trạch 3 chỉ tính đường + công ty quanh nó. KCN "chung" (tên là phần đầu của KCN
 * khác trong cụm, VD "KCN Nhơn Trạch") không tham gia chia — chọn nó thì lấy cả cụm.
 * Trả hàm "điểm này thuộc phần của KCN đang chọn?"; null = không cần chia (không phải cụm / đang chọn KCN chung).
 */
export function clusterShare(boundary: OsmZone, zoneId: string, zones: readonly ZoneRefLite[]): ((p: LatLng) => boolean) | null {
  const inside = zones.filter(z => z.lat != null && z.lng != null && boundary.rings.some(r => pointInRing(z.lat!, z.lng!, r)));
  const folded = new Map(inside.map(z => [z.id, foldZoneName(z.name)]));
  const isGeneric = (z: ZoneRefLite) => inside.some(o => o.id !== z.id && folded.get(o.id)!.startsWith(`${folded.get(z.id)} `));
  const specific = inside.filter(z => !isGeneric(z));
  if (specific.length < 2 || !specific.some(z => z.id === zoneId)) return null;
  return p => {
    let best: ZoneRefLite | null = null, bd = Infinity;
    for (const z of specific) {
      const d = distM(p, { lat: z.lat!, lng: z.lng! });
      if (d < bd) { bd = d; best = z; }
    }
    return best?.id === zoneId;
  };
}
