// Nối dữ liệu công ty cho 2 chức năng mới của Khảo sát KCN:
//   • Nhà trọ: danh sách công ty / KCN có toạ độ để đo đường xe máy / đi bộ (RouteCandidate)
//   • Ảnh 360: danh sách điểm để hiện "công ty, dự án ở gần ảnh" (PanoMapPoint)
// Màn khảo sát GPS dùng công ty đã gộp sẵn (khách, Pipeline, Thị trường, công ty quét được trên bản đồ); tab Khảo sát KCN
// dùng các điểm của Bản đồ (fetchMapContextPoints).
import { STATUS_META, type SurveyCompany, type SurveyStatus } from '../../../lib/kcnSurvey/companies';
import { fetchMapContextPoints, MAP_GROUPS, MAP_GROUP_COLOR, type MapGroup } from '../../../lib/mapGroups';
import { shortId } from '../../../hooks/useHashSubRoute';
import { looksLikeCompany, type RouteCandidate } from '../../../lib/kcnSurvey/lodgingCore';
import type { PanoMapPoint } from '../../../components/pano/PanoModal';
import type { MarketZone } from '../../../lib/types';

const KCN_COLOR = MAP_GROUP_COLOR.kcn;
const STATUS_GROUP: Record<SurveyStatus, MapGroup> = {
  client: 'client', pipeline: 'prospect', prospect: 'prospect', declined: 'lead', stopped: 'lead', lead: 'lead', osm: 'lead',
};

export function surveyCandidates(companies: readonly SurveyCompany[], zones: readonly Pick<MarketZone, 'id' | 'name' | 'lat' | 'lng'>[]): RouteCandidate[] {
  const out: RouteCandidate[] = [];
  for (const c of companies) {
    const p = c.points[0];
    if (!p) continue;
    out.push({
      key: c.key, name: c.name, kind: STATUS_META[c.status].label, color: STATUS_META[c.status].color, lat: p.lat, lng: p.lng,
      // Tên lấy từ bản đồ (OSM / quét) — chỉ tự đo khi trông như công ty, còn lại để người dùng tự chọn
      optional: c.status === 'osm' && !looksLikeCompany(c.name),
    });
  }
  for (const z of zones) {
    if (z.lat == null || z.lng == null) continue;
    out.push({ key: `z:${z.id}`, name: /^kcn\b/i.test(z.name) ? z.name : `KCN ${z.name}`, kind: 'KCN', color: KCN_COLOR, lat: z.lat, lng: z.lng });
  }
  return out;
}

export function surveyPanoPoints(companies: readonly SurveyCompany[], zones: readonly Pick<MarketZone, 'id' | 'name' | 'lat' | 'lng'>[], open: (c: SurveyCompany) => void): PanoMapPoint[] {
  const out: PanoMapPoint[] = [];
  for (const c of companies) {
    // Ngân hàng / quán / cửa hàng lấy từ bản đồ → bỏ, chỉ giữ tên trông như công ty
    if (c.status === 'osm' && !looksLikeCompany(c.name)) continue;
    for (const [i, p] of c.points.slice(0, 3).entries()) {
      out.push({
        id: i ? `${c.key}#${i}` : c.key, group: STATUS_GROUP[c.status], name: c.name, lat: p.lat, lng: p.lng, sub: '',
        color: STATUS_META[c.status].color, groupLabel: STATUS_META[c.status].label,
        onOpen: c.clientId || c.crmId || c.leadId ? () => open(c) : undefined,
      });
    }
  }
  for (const z of zones) {
    if (z.lat == null || z.lng == null) continue;
    out.push({ id: `z:${z.id}`, group: 'kcn', name: z.name, lat: z.lat, lng: z.lng, sub: '' });
  }
  return out;
}

const GROUP_LABEL = Object.fromEntries(MAP_GROUPS.map(g => [g.id, g.label])) as Record<MapGroup, string>;

/** Điểm của Bản đồ (khách, KH tiềm năng, Công ty/Dự án, KCN, chi nhánh) — cho tab Khảo sát KCN (không ở màn GPS). */
export async function loadMapCandidates(): Promise<{ candidates: RouteCandidate[]; panoPoints: PanoMapPoint[] }> {
  const pts = (await fetchMapContextPoints()).filter(p => p.group !== 'source');
  const candidates: RouteCandidate[] = pts.filter(p => p.group !== 'branch').map(p => ({
    key: `${p.group}:${p.id}`, name: p.name, kind: GROUP_LABEL[p.group], color: MAP_GROUP_COLOR[p.group], lat: p.lat, lng: p.lng,
  }));
  const panoPoints: PanoMapPoint[] = pts.map(p => ({
    id: `${p.group}:${p.id}`, group: p.group, name: p.name, lat: p.lat, lng: p.lng, sub: '',
    onOpen: p.group === 'client' || p.group === 'prospect' ? () => { window.location.hash = `#/client-detail/${shortId(p.id)}`; }
      : p.group === 'branch' ? () => { window.location.hash = `#/branches/${shortId(p.id)}`; }
      : undefined,
  }));
  return { candidates, panoPoints };
}
