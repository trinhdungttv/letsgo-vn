// Vị trí nhà máy của khách để mở bản đồ vệ tinh ở tab "Mặt bằng" — LẤY LẠI các vị trí đã ghim sẵn, không bắt nhập lại:
//   1. Nhà máy đã ghim theo từng KCN (crm_pipeline.zone_sites, hồ sơ CRM Pipeline của khách — migration 187).
//   2. Vị trí chính của khách (clients.lat / lng).
//   3. Vị trí công ty ở Thị trường (market_leads gắn crm_id của thẻ Pipeline).
//   4. Chưa ghim gì → tâm KCN của khách (market_zones) để bản đồ mở gần nhà máy, kéo tới đúng chỗ.
// Mỗi nguồn lỗi (chưa chạy migration, thiếu quyền…) chỉ bị bỏ qua, các nguồn còn lại vẫn dùng.
import { supabase } from '../supabase';
import { haversineKm, isValidVnLatLng, parseLatLngFromLink } from '../geo';
import { readZoneSites } from '../pipelineZones';
import { sameZone } from '../zoneMatch';
import type { Client } from '../types';

export type SiteLocationSource = 'factory' | 'client' | 'lead' | 'zone';

export interface SiteLocation {
  key: string;
  /** "Nhà máy — KCN Bàu Bàng" */
  label: string;
  source: SiteLocationSource;
  lat: number;
  lng: number;
}

/** Cùng 1 chỗ (cách nhau dưới 40 m) thì chỉ giữ 1 — vị trí nhà máy đã ghim được ưu tiên. */
const SAME_SPOT_KM = 0.04;

export const SOURCE_HINT: Record<SiteLocationSource, string> = {
  factory: 'Nhà máy đã ghim',
  client: 'Vị trí của khách',
  lead: 'Vị trí ở Thị trường',
  zone: 'Tâm KCN — kéo bản đồ tới nhà máy',
};

const validPt = (lat: unknown, lng: unknown) => (typeof lat === 'number' && typeof lng === 'number' && isValidVnLatLng({ lat, lng }) ? { lat, lng } : null);

/** Gộp các ứng viên theo thứ tự ưu tiên, bỏ điểm trùng chỗ. Hàm thuần (có test). */
export function dedupeLocations(list: readonly SiteLocation[]): SiteLocation[] {
  const out: SiteLocation[] = [];
  for (const l of list) {
    if (out.some(o => haversineKm(o, l) < SAME_SPOT_KM)) continue;
    out.push(l);
  }
  return out;
}

export async function loadSiteLocations(client: Pick<Client, 'id' | 'name' | 'lat' | 'lng' | 'map_link' | 'industrial_zones'>): Promise<SiteLocation[]> {
  const factory: SiteLocation[] = [];
  const own: SiteLocation[] = [];
  const lead: SiteLocation[] = [];
  const zone: SiteLocation[] = [];

  // Tên + tâm các KCN
  let zones: { id: string; name: string; lat: number | null; lng: number | null }[] = [];
  try {
    const { data } = await supabase.from('market_zones').select('id, name, lat, lng');
    zones = (data ?? []) as typeof zones;
  } catch { /* bỏ qua */ }
  const zoneName = (id: string) => zones.find(z => z.id === id)?.name ?? '';

  // Thẻ CRM Pipeline của khách: nhà máy theo KCN
  const pipelineIds: string[] = [];
  let pipeZoneIds: string[] = [];
  try {
    let res = await supabase.from('crm_pipeline').select('id, zone_ids, zone_sites').eq('client_id', client.id);
    if (res.error) res = (await supabase.from('crm_pipeline').select('id').eq('client_id', client.id)) as typeof res;
    for (const row of (res.data ?? []) as { id: string; zone_ids?: string[] | null; zone_sites?: unknown }[]) {
      pipelineIds.push(row.id);
      pipeZoneIds = pipeZoneIds.concat(row.zone_ids ?? []);
      const sites = readZoneSites(row.zone_sites);
      for (const [zid, s] of Object.entries(sites)) {
        const pt = validPt(s.lat, s.lng) ?? (s.map_link ? parseLatLngFromLink(s.map_link) : null);
        if (!pt || !isValidVnLatLng(pt)) continue;
        const zn = zoneName(zid);
        factory.push({ key: `factory:${row.id}:${zid}`, label: zn ? `Nhà máy — ${zn}` : 'Nhà máy đã ghim', source: 'factory', ...pt });
      }
    }
  } catch { /* chưa có bảng / cột → bỏ qua */ }

  const mine = validPt(client.lat, client.lng) ?? parseLatLngFromLink(client.map_link);
  if (mine && isValidVnLatLng(mine)) own.push({ key: 'client', label: `Vị trí của ${client.name}`, source: 'client', ...mine });

  if (pipelineIds.length) {
    try {
      const { data } = await supabase.from('market_leads').select('id, company_name, lat, lng').in('crm_id', pipelineIds);
      for (const r of (data ?? []) as { id: string; company_name: string; lat: number | null; lng: number | null }[]) {
        const pt = validPt(r.lat, r.lng);
        if (pt) lead.push({ key: `lead:${r.id}`, label: 'Vị trí ở Thị trường', source: 'lead', ...pt });
      }
    } catch { /* bỏ qua */ }
  }

  const found = dedupeLocations([...factory, ...own, ...lead]);
  if (found.length) return found;

  // Chưa ghim gì → tâm các KCN của khách
  const names = client.industrial_zones ?? [];
  const wanted = zones.filter(z => pipeZoneIds.includes(z.id) || names.some(n => sameZone(n, z.name)));
  for (const z of wanted) {
    const pt = validPt(z.lat, z.lng);
    if (pt) zone.push({ key: `zone:${z.id}`, label: `Tâm ${z.name}`, source: 'zone', ...pt });
  }
  return dedupeLocations(zone);
}
