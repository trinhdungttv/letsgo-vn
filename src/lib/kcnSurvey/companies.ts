// Công ty trên đường khảo sát: gộp Khách hàng + CRM Pipeline + Thị trường (Công ty/Dự án) + nhà máy có tên trên
// OpenStreetMap thành 1 danh sách, mỗi công ty 1 mục, rồi tìm công ty đang đi ngang.
//
// Bản ghi LIÊN KẾT nhau là 1 công ty: pipeline.client_id → khách hàng, market_leads.crm_id → pipeline.
// Vị trí của 1 công ty có thể có nhiều điểm: ghim khách hàng, ghim Thị trường, ghim nhà máy theo KCN
// (crm_pipeline.zone_sites, migration 187) và khối nhà xưởng OSM trùng tên.
import type { LatLng } from '../geo';
import { companyKey, compareKeys, type CompanyKey } from '../companyMatch';
import { distM, distToShape } from './track';

/** client = đang hợp tác · pipeline = đang theo đuổi · declined = không hợp tác · stopped = ngưng HĐ
 *  prospect = KH tiềm năng (trang Khách hàng) · lead = mới có ở Thị trường · osm = chỉ có tên trên bản đồ OSM */
export type SurveyStatus = 'client' | 'pipeline' | 'prospect' | 'declined' | 'stopped' | 'lead' | 'osm';

export const STATUS_META: Record<SurveyStatus, { label: string; color: string; /** hiện thẻ tổng quan đầy đủ */ rich: boolean; rank: number }> = {
  client: { label: 'Đang hợp tác', color: '#059669', rich: true, rank: 0 },
  pipeline: { label: 'Trong Pipeline', color: '#7C3AED', rich: true, rank: 1 },
  prospect: { label: 'KH tiềm năng', color: '#2563EB', rich: true, rank: 2 },
  declined: { label: 'Không hợp tác', color: '#DC2626', rich: true, rank: 3 },
  stopped: { label: 'Ngưng HĐ', color: '#6B7280', rich: true, rank: 4 },
  lead: { label: 'Có ở Thị trường', color: '#DB2777', rich: false, rank: 5 },
  osm: { label: 'Trên bản đồ', color: '#475569', rich: false, rank: 6 },
};

export const PIPELINE_STAGE_LABEL: Record<string, string> = {
  'tiem-nang': 'Tiềm năng', 'dang-lh': 'Đang liên hệ', 'quan-tam': 'Quan tâm/Chờ', 'dam-phan': 'Đàm phán HĐ',
  'hop-tac': 'Đang hợp tác', 'khong-nhu-cau': 'Không hợp tác', ngung: 'Ngưng HĐ',
};

export interface SurveyClientIn {
  id: string;
  name: string;
  client_type: 'prospect' | 'active';
  cooperation_status?: 'active' | 'suspended' | null;
  lat: number | null;
  lng: number | null;
}
export interface SurveyPipelineIn {
  id: string;
  company_name: string;
  client_id?: string | null;
  stage: string;
  zone_sites?: Record<string, { lat: number | null; lng: number | null } | null> | null;
}
export interface SurveyLeadIn {
  id: string;
  company_name: string;
  crm_id?: string | null;
  lat?: number | null;
  lng?: number | null;
}
export interface OsmPlace {
  /** 'n123' / 'w456' / 'r789' */
  id: string;
  name: string;
  point: LatLng;
  /** Khối nhà xưởng (đa giác) nếu là way khép kín — [lat, lng] */
  ring?: [number, number][];
}

export interface SurveyCompany {
  /** 'c:<client>' | 'p:<pipeline>' | 'l:<lead>' | 'o:<osm>' */
  key: string;
  name: string;
  status: SurveyStatus;
  clientId: string | null;
  crmId: string | null;
  leadId: string | null;
  points: LatLng[];
  rings: [number, number][][];
  /** Có vị trí chỉ nhờ khớp tên với nhà máy trên OSM (chưa ghim trong hệ thống). */
  osmOnly: boolean;
  osmName?: string;
}

const okPos = (lat: number | null | undefined, lng: number | null | undefined): LatLng | null =>
  lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;

function statusOf(client: SurveyClientIn | undefined, stage: string | null): SurveyStatus {
  if (client?.client_type === 'active') return client.cooperation_status === 'suspended' ? 'stopped' : 'client';
  switch (stage) {
    case 'hop-tac': return 'client';
    case 'khong-nhu-cau': return 'declined';
    case 'ngung': return 'stopped';
    case null: return client ? 'prospect' : 'lead';
    default: return 'pipeline';
  }
}

/** Giai đoạn "đáng tin" hơn khi 1 khách có nhiều thẻ pipeline: đang chạy > đã hợp tác > lưu trữ. */
const STAGE_RANK: Record<string, number> = { 'dam-phan': 0, 'quan-tam': 1, 'dang-lh': 2, 'tiem-nang': 3, 'hop-tac': 4, ngung: 5, 'khong-nhu-cau': 6 };

function pushPoint(list: LatLng[], p: LatLng | null) {
  if (!p) return;
  // Ghim trùng / sát nhau (khách hàng & Thị trường dán cùng 1 link) thì bỏ
  if (!list.some(q => distM(q, p) < 10)) list.push(p);
}

/** Gộp 3 nguồn trong hệ thống thành danh sách công ty (chưa có OSM). Công ty chưa có toạ độ vẫn nằm trong danh sách (points rỗng) để OSM bổ sung. */
export function buildSurveyCompanies(input: { clients: readonly SurveyClientIn[]; pipeline: readonly SurveyPipelineIn[]; leads: readonly SurveyLeadIn[] }): SurveyCompany[] {
  const clientById = new Map(input.clients.map(c => [c.id, c]));
  const pipeById = new Map(input.pipeline.map(p => [p.id, p]));
  const leadsByCrm = new Map<string, SurveyLeadIn[]>();
  for (const l of input.leads) {
    if (!l.crm_id || !pipeById.has(l.crm_id)) continue;
    const list = leadsByCrm.get(l.crm_id);
    if (list) list.push(l); else leadsByCrm.set(l.crm_id, [l]);
  }

  const byKey = new Map<string, SurveyCompany & { stageRank: number; stage: string | null }>();
  const clientsUsed = new Set<string>();

  for (const p of input.pipeline) {
    const client = p.client_id ? clientById.get(p.client_id) : undefined;
    const key = client ? `c:${client.id}` : `p:${p.id}`;
    if (client) clientsUsed.add(client.id);
    const leads = leadsByCrm.get(p.id) ?? [];
    const rank = STAGE_RANK[p.stage] ?? 9;
    let e = byKey.get(key);
    if (!e) {
      e = {
        key, name: (client?.name || p.company_name || '').trim(), status: 'lead', clientId: client?.id ?? null, crmId: p.id,
        leadId: leads[0]?.id ?? null, points: [], rings: [], osmOnly: false, stageRank: rank, stage: p.stage,
      };
      byKey.set(key, e);
    } else if (rank < e.stageRank) {
      e.crmId = p.id; e.stageRank = rank; e.stage = p.stage;
      if (!e.leadId && leads[0]) e.leadId = leads[0].id;
    }
    pushPoint(e.points, client ? okPos(client.lat, client.lng) : null);
    for (const l of leads) pushPoint(e.points, okPos(l.lat, l.lng));
    for (const site of Object.values(p.zone_sites ?? {})) pushPoint(e.points, site ? okPos(site.lat, site.lng) : null);
    e.status = statusOf(client, e.stage);
  }

  for (const c of input.clients) {
    if (clientsUsed.has(c.id)) continue;
    const pts: LatLng[] = [];
    pushPoint(pts, okPos(c.lat, c.lng));
    byKey.set(`c:${c.id}`, {
      key: `c:${c.id}`, name: c.name.trim(), status: statusOf(c, null), clientId: c.id, crmId: null, leadId: null,
      points: pts, rings: [], osmOnly: false, stageRank: 9, stage: null,
    });
  }

  for (const l of input.leads) {
    if (l.crm_id && pipeById.has(l.crm_id)) continue;
    const pts: LatLng[] = [];
    pushPoint(pts, okPos(l.lat, l.lng));
    byKey.set(`l:${l.id}`, {
      key: `l:${l.id}`, name: l.company_name.trim(), status: 'lead', clientId: null, crmId: null, leadId: l.id,
      points: pts, rings: [], osmOnly: false, stageRank: 9, stage: null,
    });
  }

  return [...byKey.values()]
    .filter(e => e.name)
    .map(({ stageRank: _r, stage: _s, ...e }) => { void _r; void _s; return e; });
}

/** Tên khu công nghiệp (cả khu là 1 đa giác landuse=industrial) — không phải 1 công ty. */
const ZONE_NAME_RE = /(khu\s*c[oô]ng\s*nghi[eệ]p|^kcn\b|c[uụ]m\s*c[oô]ng\s*nghi[eệ]p|^ccn\b|industrial\s*(park|zone|estate|area)|khu\s*ch[eế]\s*xu[aấ]t)/i;
export const isZoneLikeName = (name: string) => ZONE_NAME_RE.test(name.trim());

/**
 * Ghép nhà máy có tên trên OSM vào danh sách:
 *  - Trùng tên lõi (bỏ "Công ty TNHH", dấu…) với công ty trong hệ thống → thêm khối nhà xưởng vào công ty đó
 *    (công ty chưa ghim toạ độ thì nhờ đó mới nhận ra được khi đi ngang — đánh dấu osmOnly).
 *  - Gần giống (lệch vài ký tự) chỉ ghép khi ở gần ghim sẵn có (≤ 1,5 km), tránh nhận nhầm công ty khác nơi.
 *  - Không khớp → 1 mục 'osm' chỉ có tên.
 */
export function mergeOsmPlaces(companies: readonly SurveyCompany[], places: readonly OsmPlace[]): SurveyCompany[] {
  const out = companies.map(c => ({ ...c, points: [...c.points], rings: [...c.rings] }));
  const keys = new Map<SurveyCompany, CompanyKey>();
  const byCore = new Map<string, SurveyCompany[]>();
  for (const c of out) {
    const k = companyKey(c.name);
    keys.set(c, k);
    for (const token of new Set([k.core, k.brand])) {
      if (token.length < 3) continue;
      const list = byCore.get(token);
      if (list) list.push(c); else byCore.set(token, [c]);
    }
  }
  const located = out.filter(c => c.points.length);

  for (const place of places) {
    if (!place.name.trim() || isZoneLikeName(place.name)) continue;
    const k = companyKey(place.name);
    let target: SurveyCompany | null = null;
    const exact = [...(byCore.get(k.core) ?? []), ...(k.brand !== k.core ? byCore.get(k.brand) ?? [] : [])];
    if (exact.length) {
      // Nhiều công ty cùng tên lõi: ưu tiên cái có ghim gần nhất, rồi trạng thái quan trọng hơn
      target = [...exact].sort((a, b) => {
        const da = a.points.length ? Math.min(...a.points.map(p => distM(p, place.point))) : 5e4;
        const db = b.points.length ? Math.min(...b.points.map(p => distM(p, place.point))) : 5e4;
        return da - db || STATUS_META[a.status].rank - STATUS_META[b.status].rank;
      })[0];
    } else {
      let bestScore = 0;
      for (const c of located) {
        if (c.points.every(p => distM(p, place.point) > 1500)) continue;
        const m = compareKeys(k, keys.get(c)!);
        if (m && m.level !== 'maybe' && m.score > bestScore) { bestScore = m.score; target = c; }
      }
    }
    if (target) {
      if (!target.points.length) target.osmOnly = true;
      if (place.ring) target.rings.push(place.ring);
      else pushPoint(target.points, place.point);
      // Công ty có ghim thì vẫn giữ tâm khối OSM làm điểm phụ để tính "gần"
      if (place.ring && target.osmOnly) pushPoint(target.points, place.point);
      target.osmName ??= place.name;
      continue;
    }
    out.push({
      key: `o:${place.id}`, name: place.name.trim(), status: 'osm', clientId: null, crmId: null, leadId: null,
      points: [place.point], rings: place.ring ? [place.ring] : [], osmOnly: true,
    });
  }
  return out;
}

export interface NearbyCompany {
  company: SurveyCompany;
  dist: number;
}

/** Công ty trong bán kính quanh vị trí, gần nhất trước (cùng khoảng cách thì khách hàng / pipeline trước). */
export function companiesNear(pos: LatLng, companies: readonly SurveyCompany[], radiusM: number): NearbyCompany[] {
  const out: NearbyCompany[] = [];
  // Lọc thô bằng khung toạ độ trước khi tính khoảng cách chi tiết
  const dLat = (radiusM + 600) / 111_320;
  for (const c of companies) {
    if (!c.points.length && !c.rings.length) continue;
    const roughNear = c.points.some(p => Math.abs(p.lat - pos.lat) < dLat && Math.abs(p.lng - pos.lng) < dLat * 1.1)
      || c.rings.some(r => r.some(([lat, lng]) => Math.abs(lat - pos.lat) < dLat && Math.abs(lng - pos.lng) < dLat * 1.1));
    if (!roughNear) continue;
    const d = distToShape(pos, c.points, c.rings);
    if (d <= radiusM) out.push({ company: c, dist: d });
  }
  return out.sort((a, b) => a.dist - b.dist || STATUS_META[a.company.status].rank - STATUS_META[b.company.status].rank);
}

/**
 * Chọn công ty hiện trên thẻ "Đang đi ngang" — có độ trễ để thẻ không nhảy qua lại khi đi giữa 2 công ty:
 * giữ công ty đang hiện nếu nó vẫn trong bán kính và không xa hơn công ty gần nhất quá `stickM` mét.
 */
export function pickCurrent(nearby: readonly NearbyCompany[], currentKey: string | null, stickM = 15): NearbyCompany | null {
  if (!nearby.length) return null;
  const nearest = nearby[0];
  if (currentKey && currentKey !== nearest.company.key) {
    const cur = nearby.find(n => n.company.key === currentKey);
    if (cur && cur.dist <= nearest.dist + stickM) return cur;
  }
  return nearest;
}

/** Công ty đã đi ngang trong chuyến — lưu vào kcn_survey_trips.passed. */
export interface PassedCompany {
  key: string;
  name: string;
  status: SurveyStatus;
  first_at: string;
  min_dist_m: number;
}

/** Ghi nhận các công ty vừa ở trong bán kính vào danh sách đã đi ngang (giữ lần đầu, cập nhật khoảng cách gần nhất). */
export function notePassed(passed: Map<string, PassedCompany>, nearby: readonly NearbyCompany[], at: string): boolean {
  let changed = false;
  for (const n of nearby) {
    const old = passed.get(n.company.key);
    const dist = Math.round(n.dist);
    if (!old) {
      passed.set(n.company.key, { key: n.company.key, name: n.company.name, status: n.company.status, first_at: at, min_dist_m: dist });
      changed = true;
    } else if (dist < old.min_dist_m) {
      old.min_dist_m = dist;
      changed = true;
    }
  }
  return changed;
}
