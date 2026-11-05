// Liên kết Quy trình công việc ⇄ Mặt bằng: mỗi xưởng (workshop) gắn 0..n khu vực đã vẽ ở tab Mặt bằng (ảnh hoặc bản đồ vệ tinh).
// Lưu trong JSON của xưởng (client_workflows.workshops[].zones) — không cần migration. Hàm thuần, có test.
import type { ClientSiteMap } from '../clientMaps/siteMaps';
import { mediaCount, type WfWorkshop, type WfZoneRef } from './workflow';

/** Cùng khoá với ClientSiteMaps: mở tab Mặt bằng đúng bản vẽ đang chọn. */
export const SITE_ACTIVE_KEY = (clientId: string) => `lgvn_site_map_active:${clientId}`;
/** Mở tab Quy trình đúng xưởng đang chọn. */
export const WF_ACTIVE_KEY = (clientId: string) => `lgvn_workflow_active:${clientId}`;

export interface ZoneOption { mapId: string; mapTitle: string; zoneId: string; label: string; note: string; color: string }

/** Mọi khu vực của mọi bản vẽ mặt bằng (ảnh + vệ tinh), theo thứ tự bản vẽ. */
export function zoneOptions(maps: readonly ClientSiteMap[]): ZoneOption[] {
  const out: ZoneOption[] = [];
  maps.forEach((m, i) => {
    const title = m.title?.trim() || (m.kind === 'map' ? 'Bản đồ vệ tinh' : `Mặt bằng ${i + 1}`);
    const zones = m.kind === 'map' ? m.geo?.zones ?? [] : m.zones;
    for (const z of zones) out.push({ mapId: m.id, mapTitle: title, zoneId: z.id, label: z.label || '(chưa đặt tên)', note: z.note || '', color: z.color });
  });
  return out;
}

export const sameZone = (a: Pick<WfZoneRef, 'mapId' | 'zoneId'>, b: Pick<WfZoneRef, 'mapId' | 'zoneId'>) => a.mapId === b.mapId && a.zoneId === b.zoneId;

export interface ZoneWorkshopInfo { id: string; name: string; steps: number; media: number }

/** zoneId → các xưởng gắn khu vực đó (để hiện ở bảng chú thích của Mặt bằng). */
export function workshopsByZone(workshops: readonly WfWorkshop[]): Map<string, ZoneWorkshopInfo[]> {
  const m = new Map<string, ZoneWorkshopInfo[]>();
  for (const w of workshops) {
    for (const z of w.zones) {
      const list = m.get(z.zoneId) ?? [];
      if (!list.some(x => x.id === w.id)) list.push({ id: w.id, name: w.name || 'Chưa đặt tên', steps: w.steps.length, media: mediaCount(w) });
      m.set(z.zoneId, list);
    }
  }
  return m;
}
