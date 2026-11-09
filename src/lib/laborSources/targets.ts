// ============================================================================
// Đích tính đường + danh sách công ty để ghép — dựng từ dữ liệu sẵn có của app:
//   KCN (market_zones) · Khách hàng đang hợp tác / tiềm năng (clients) · Công ty / Dự án (market_leads) · Chi nhánh.
// Chỉ điểm có toạ độ mới tính được đường xe.
// ============================================================================
import { foldVn } from '../companyMatch';
import { sameZone } from '../zoneMatch';
import type { Branch, Client, Industry, MarketLead, MarketZone } from '../types';
import { industryIdByName, type MatchCompany } from './match';
import { computeRoutes, computeRoutesToOne, isFresh, routeKey, type RouteTarget } from './routing';
import { upsertRoutes } from './api';
import type { LaborSource, RouteRow, RouteTargetType } from './types';

export interface NamedTarget extends RouteTarget { name: string; sub: string }

const hasLL = (o: { lat?: number | null; lng?: number | null }): o is { lat: number; lng: number } =>
  typeof o.lat === 'number' && typeof o.lng === 'number' && Number.isFinite(o.lat) && Number.isFinite(o.lng);

/** Khách còn dùng để ghép: đang hợp tác hoặc tiềm năng, chưa lưu trữ. */
export const liveClients = (clients: readonly Client[]) => clients.filter(c => !c.archived_at);

/** Công ty / Dự án trùng tên với 1 khách hàng thì bỏ (đã có ở Khách hàng). */
export function liveLeads(leads: readonly MarketLead[], clients: readonly Client[]): MarketLead[] {
  const names = new Set(clients.map(c => foldVn(c.name).trim()));
  return leads.filter(l => !names.has(foldVn(l.company_name).trim()));
}

export function zoneIdOfName(name: string | null | undefined, zones: readonly MarketZone[]): string | null {
  if (!name) return null;
  return zones.find(z => sameZone(z.name, name))?.id ?? null;
}

export function buildTargets(o: { zones: readonly MarketZone[]; clients: readonly Client[]; leads: readonly MarketLead[]; branches: readonly Branch[] }): NamedTarget[] {
  const out: NamedTarget[] = [];
  for (const z of o.zones) if (hasLL(z)) out.push({ type: 'zone', id: z.id, lat: z.lat, lng: z.lng, name: z.name, sub: z.location ?? '' });
  for (const b of o.branches) if (hasLL(b)) out.push({ type: 'branch', id: b.id, lat: b.lat, lng: b.lng, name: b.name, sub: 'Chi nhánh' });
  const clients = liveClients(o.clients);
  for (const c of clients) if (hasLL(c)) out.push({ type: 'client', id: c.id, lat: c.lat, lng: c.lng, name: c.name, sub: c.client_type === 'active' ? 'Khách hàng' : 'KH tiềm năng' });
  for (const l of liveLeads(o.leads, clients)) if (hasLL(l)) out.push({ type: 'lead', id: l.id, lat: l.lat, lng: l.lng, name: l.company_name, sub: 'Công ty / Dự án' });
  return out;
}

/** Công ty để ghép (có hoặc chưa có toạ độ). */
export function buildCompanies(o: { zones: readonly MarketZone[]; clients: readonly Client[]; leads: readonly MarketLead[]; industries: readonly Pick<Industry, 'id' | 'name'>[] }): MatchCompany[] {
  const clients = liveClients(o.clients);
  const out: MatchCompany[] = clients.map(c => ({
    type: 'client', id: c.id, name: c.name,
    industryId: industryIdByName(c.industry, o.industries), industryName: (c.industry ?? '').trim(),
    zoneId: zoneIdOfName(c.industrial_zones?.[0], o.zones),
    lat: hasLL(c) ? c.lat : null, lng: hasLL(c) ? c.lng : null,
  }));
  for (const l of liveLeads(o.leads, clients)) {
    out.push({
      type: 'lead', id: l.id, name: l.company_name,
      industryId: industryIdByName(l.industry, o.industries), industryName: (l.industry ?? '').trim(),
      zoneId: zoneIdOfName(l.region, o.zones),
      lat: hasLL(l) ? l.lat : null, lng: hasLL(l) ? l.lng : null,
    });
  }
  return out;
}

/** Bảng tra đường đã lưu: "<source>|<type>:<id>" → dòng. */
export function routeIndex(rows: readonly RouteRow[]): Map<string, RouteRow> {
  return new Map(rows.map(r => [`${r.source_id}|${routeKey(r.target_type, r.target_id)}`, r]));
}
export const routeLookupKey = (sourceId: string, type: RouteTargetType, id: string) => `${sourceId}|${routeKey(type, id)}`;

// Mỗi cặp chỉ tính 1 lượt cùng lúc (nhiều khối giao diện cùng xin 1 lúc)
const inflight = new Map<string, Promise<RouteRow[]>>();

/** Đường từ 1 đơn vị → các đích còn thiếu / đã dời chỗ. Lưu DB, trả các dòng mới. */
export function ensureFromSource(source: LaborSource, targets: readonly RouteTarget[], index: ReadonlyMap<string, RouteRow>,
  onProgress?: (done: number, total: number) => void): Promise<RouteRow[]> {
  if (!hasLL(source)) return Promise.resolve([]);
  const src = { lat: source.lat, lng: source.lng };
  const need = targets.filter(t => !isFresh(index.get(routeLookupKey(source.id, t.type, t.id)), src, t));
  if (!need.length) return Promise.resolve([]);
  const key = `from:${source.id}:${need.length}`;
  const running = inflight.get(key);
  if (running) return running;
  const job = (async () => {
    const res = await computeRoutes(src, need, { onProgress });
    const now = new Date().toISOString();
    const rows: RouteRow[] = [];
    for (const t of need) {
      const r = res.get(routeKey(t.type, t.id));
      if (!r) continue;
      rows.push({ source_id: source.id, target_type: t.type, target_id: t.id, from_lat: src.lat, from_lng: src.lng, to_lat: t.lat, to_lng: t.lng, distance_km: r.distanceKm, duration_min: r.durationMin, engine: r.engine, computed_at: now });
    }
    if (rows.length) await upsertRoutes(rows).catch(() => undefined); // lưu lỗi (chưa chạy 213) vẫn hiện được trong phiên
    return rows;
  })().finally(() => inflight.delete(key));
  inflight.set(key, job);
  return job;
}

/** Đường từ mọi đơn vị (có toạ độ) → 1 đích. Lưu DB, trả các dòng mới. */
export function ensureToTarget(target: RouteTarget, sources: readonly LaborSource[], index: ReadonlyMap<string, RouteRow>): Promise<RouteRow[]> {
  const need = sources.filter(hasLL).filter(s => !isFresh(index.get(routeLookupKey(s.id, target.type, target.id)), s as { lat: number; lng: number }, target));
  if (!need.length) return Promise.resolve([]);
  const key = `to:${routeKey(target.type, target.id)}:${need.length}`;
  const running = inflight.get(key);
  if (running) return running;
  const job = (async () => {
    const res = await computeRoutesToOne(need.map(s => ({ id: s.id, lat: s.lat as number, lng: s.lng as number })), target);
    const now = new Date().toISOString();
    const rows: RouteRow[] = [];
    for (const s of need) {
      const r = res.get(s.id);
      if (!r) continue;
      rows.push({ source_id: s.id, target_type: target.type, target_id: target.id, from_lat: s.lat as number, from_lng: s.lng as number, to_lat: target.lat, to_lng: target.lng, distance_km: r.distanceKm, duration_min: r.durationMin, engine: r.engine, computed_at: now });
    }
    if (rows.length) await upsertRoutes(rows).catch(() => undefined);
    return rows;
  })().finally(() => inflight.delete(key));
  inflight.set(key, job);
  return job;
}

/** Gộp dòng mới vào danh sách cũ (cùng khoá thì thay). */
export function mergeRoutes(prev: readonly RouteRow[], next: readonly RouteRow[]): RouteRow[] {
  if (!next.length) return prev as RouteRow[];
  const m = routeIndex(prev);
  for (const r of next) m.set(routeLookupKey(r.source_id, r.target_type, r.target_id), r);
  return [...m.values()];
}

export { hasLL };
