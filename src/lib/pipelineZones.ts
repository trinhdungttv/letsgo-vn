// KCN của 1 công ty ở CRM Pipeline — CHỌN NHIỀU từ danh mục Thị trường → Khu vực (market_zones), lưu MÃ
// (crm_pipeline.zone_ids, migration 186). Công ty lớn có nhiều nhà máy ở nhiều KCN, tuyển ở từng nơi.
//
// Đọc theo thứ tự:
//   1. Đã là Khách hàng (client_id) → clients.industrial_zones (tên) — trang Khách hàng là chủ dữ liệu.
//   2. crm_pipeline.zone_ids.
//   3. Dữ liệu cũ: market_leads.region (1 KCN dạng chữ) — khi chưa chạy 186 hoặc thẻ chưa chọn lại.
// Khi lưu, KCN đầu tiên vẫn được ghi vào market_leads.region để các màn Thị trường cũ (đọc 1 KCN) chạy nguyên.
// Tên cũ không có trong danh mục → trả về ở `legacy` để hồ sơ báo người dùng chọn lại, không âm thầm bỏ.
import { sameZone } from './zoneMatch';
import type { CRMPipelineEntry } from './types';

export interface ZoneRef { id: string; name: string }

export const PIPELINE_ZONES_MIGRATION_HINT = 'Chưa chạy migration 186 nên mới lưu được KCN đầu tiên — chạy 186 để lưu nhiều KCN';

/** Tên KCN (chữ) → mã trong danh mục; tên không khớp gom vào `unmatched`. Bỏ trùng, giữ thứ tự. */
export function zoneIdsFromNames(names: readonly (string | null | undefined)[], zones: readonly ZoneRef[]): { ids: string[]; unmatched: string[] } {
  const ids: string[] = [];
  const unmatched: string[] = [];
  for (const raw of names) {
    const name = (raw ?? '').trim();
    if (!name) continue;
    const hit = zones.find(z => z.name === name) ?? zones.find(z => sameZone(z.name, name));
    if (hit) { if (!ids.includes(hit.id)) ids.push(hit.id); }
    else if (!unmatched.some(u => u === name || sameZone(u, name))) unmatched.push(name);
  }
  return { ids, unmatched };
}

export interface ZoneSources {
  /** clients.industrial_zones của khách đã gắn — undefined/null = chưa là khách hoặc chưa nạp được khách. */
  clientZones?: readonly string[] | null;
  /** market_leads.region của dòng Thị trường gắn crm_id (dữ liệu cũ, 1 KCN dạng chữ). */
  leadRegion?: string | null;
  /** Tên không phải KCN (tên chi nhánh từng được ghi tạm vào region) — không báo là "KCN cũ". */
  ignoreNames?: readonly string[];
}

export interface EntryZones {
  /** Mã KCN theo thứ tự chọn — KCN đầu tiên là KCN chính. */
  ids: string[];
  /** Tên KCN cũ dạng chữ không có trong danh mục. */
  legacy: string[];
}

export function pipelineZones(
  entry: Pick<CRMPipelineEntry, 'client_id' | 'zone_ids'>,
  src: ZoneSources,
  zones: readonly ZoneRef[],
): EntryZones {
  const notZone = (n: string) => (src.ignoreNames ?? []).some(x => x.trim() === n);
  if (entry.client_id && src.clientZones) {
    const { ids, unmatched } = zoneIdsFromNames(src.clientZones, zones);
    return { ids, legacy: unmatched.filter(n => !notZone(n)) };
  }
  // KCN đã bị xoá khỏi danh mục → mã cũ tự bị bỏ qua (giống CatalogPick)
  const known = new Set(zones.map(z => z.id));
  const own = (entry.zone_ids ?? []).filter((id, i, a) => known.has(id) && a.indexOf(id) === i);
  if (own.length) return { ids: own, legacy: [] };
  const { ids, unmatched } = zoneIdsFromNames([src.leadRegion], zones);
  return { ids, legacy: unmatched.filter(n => !notZone(n)) };
}

/** Tên KCN theo mã (bỏ mã không còn trong danh mục). */
export function zoneNames(ids: readonly string[], zones: readonly ZoneRef[]): string[] {
  const byId = new Map(zones.map(z => [z.id, z.name]));
  return ids.map(id => byId.get(id)).filter((n): n is string => !!n);
}

/** Bộ lọc KCN của Pipeline: 'all' | 'none' (chưa gán KCN) | mã KCN — khớp khi công ty có KCN đó trong danh sách. */
export function matchesZoneFilter(ids: readonly string[], filter: string): boolean {
  if (filter === 'all') return true;
  if (filter === 'none') return ids.length === 0;
  return ids.includes(filter);
}

/** Các KCN đang có công ty, kèm số công ty (1 công ty nhiều KCN thì đếm ở mỗi KCN), xếp theo tên. */
export function zoneFilterOptions(lists: readonly (readonly string[])[], zones: readonly ZoneRef[]): (ZoneRef & { count: number })[] {
  const counts = new Map<string, number>();
  for (const ids of lists) for (const id of new Set(ids)) counts.set(id, (counts.get(id) ?? 0) + 1);
  return zones.filter(z => counts.has(z.id))
    .map(z => ({ ...z, count: counts.get(z.id)! }))
    .sort((a, b) => a.name.localeCompare(b.name, 'vi'));
}

// ── Vị trí nhà máy theo từng KCN (crm_pipeline.zone_sites, migration 187) ──────────────────────────
export interface ZoneSite { map_link: string | null; lat: number | null; lng: number | null }
export type ZoneSites = Record<string, ZoneSite>;

export const ZONE_SITES_MIGRATION_HINT = 'Chưa lưu được vị trí nhà máy — cần chạy migration 187 trên Supabase';

const coord = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Đọc zone_sites (jsonb) an toàn: bỏ mục hỏng, toạ độ không phải số → null. */
export function readZoneSites(raw: unknown): ZoneSites {
  const out: ZoneSites = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== 'object') continue;
    const r = v as Record<string, unknown>;
    const site = { map_link: typeof r.map_link === 'string' && r.map_link.trim() ? r.map_link.trim() : null, lat: coord(r.lat), lng: coord(r.lng) };
    if (site.map_link || (site.lat != null && site.lng != null)) out[id] = site;
  }
  return out;
}

/** Đặt / xoá (site = null) vị trí nhà máy của 1 KCN — trả về object mới, không đụng các KCN khác. */
export function withZoneSite(raw: unknown, zoneId: string, site: ZoneSite | null): ZoneSites {
  const next = { ...readZoneSites(raw) };
  if (site && (site.map_link || (site.lat != null && site.lng != null))) next[zoneId] = site;
  else delete next[zoneId];
  return next;
}
