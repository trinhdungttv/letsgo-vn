// Bản nhẹ của dữ liệu Nguồn LĐ cho các trang khác (Khảo sát KCN, Bản đồ, hồ sơ Khách hàng):
// chỉ đơn vị nguồn + đường xe đã lưu + đợt gửi SV. Nạp 1 lần / phiên, tự nạp lại khi Nguồn LĐ đổi.
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { LABOR_CHANGED_EVENT } from '../../../lib/laborSources/api';
import { estimateBusMinutes } from '../../../lib/laborSources/match';
import type { LaborSource, RouteRow, RouteTargetType, SourceBatch } from '../../../lib/laborSources/types';

export type LiteSource = Pick<LaborSource, 'id' | 'name' | 'short_name' | 'kind' | 'status' | 'province' | 'lat' | 'lng' | 'logo_url'>;
export interface LaborLite { ready: boolean; sources: LiteSource[]; routes: RouteRow[]; batches: SourceBatch[] }

const EMPTY: LaborLite = { ready: false, sources: [], routes: [], batches: [] };
let cache: Promise<LaborLite> | null = null;

function load(): Promise<LaborLite> {
  if (!cache) {
    cache = (async () => {
      const [s, r, b] = await Promise.all([
        supabase.from('labor_sources').select('id, name, short_name, kind, status, province, lat, lng, logo_url').is('deleted_at', null).order('name'),
        supabase.from('labor_source_routes').select('*').limit(20000),
        supabase.from('labor_source_batches').select('*').is('deleted_at', null),
      ]);
      if (s.error) return EMPTY; // chưa chạy migration 213
      return {
        ready: true,
        sources: (s.data ?? []) as LiteSource[],
        routes: r.error ? [] : ((r.data ?? []) as RouteRow[]).map(x => ({ ...x, distance_km: x.distance_km == null ? null : Number(x.distance_km), duration_min: x.duration_min == null ? null : Number(x.duration_min) })),
        batches: b.error ? [] : (b.data ?? []) as SourceBatch[],
      };
    })().catch(() => { cache = null; return EMPTY; });
  }
  return cache;
}

if (typeof window !== 'undefined') window.addEventListener(LABOR_CHANGED_EVENT, () => { cache = null; });

export function useLaborLite(enabled = true): LaborLite {
  const [data, setData] = useState<LaborLite>(EMPTY);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const run = () => { void load().then(d => { if (alive) setData(d); }); };
    run();
    const onChanged = () => { cache = null; run(); };
    window.addEventListener(LABOR_CHANGED_EVENT, onChanged);
    return () => { alive = false; window.removeEventListener(LABOR_CHANGED_EVENT, onChanged); };
  }, [enabled]);
  return data;
}

export interface NearSource { source: LiteSource; min: number; km: number | null; estimated: boolean }

/**
 * Đơn vị nguồn gần 1 đích nhất theo giờ xe khách: dùng đường đã tính (bảng đường xe), chưa có thì ước từ đường
 * thẳng (estimated = true — mở Nguồn LĐ để tính thật). Đơn vị tạm dừng / chưa có vị trí bị bỏ.
 */
export function nearestSources(lite: LaborLite, target: { type: RouteTargetType; id: string; lat: number | null | undefined; lng: number | null | undefined }, limit = 3): NearSource[] {
  if (target.lat == null || target.lng == null) return [];
  const t = { lat: target.lat, lng: target.lng };
  const byKey = new Map(lite.routes.filter(r => r.target_type === target.type && r.target_id === target.id).map(r => [r.source_id, r]));
  const out: NearSource[] = [];
  for (const s of lite.sources) {
    if (s.status === 'paused' || s.lat == null || s.lng == null) continue;
    const r = byKey.get(s.id);
    if (r) {
      if (r.duration_min == null) continue;
      out.push({ source: s, min: r.duration_min, km: r.distance_km, estimated: false });
    } else {
      const e = estimateBusMinutes({ lat: s.lat, lng: s.lng }, t);
      out.push({ source: s, min: e.min, km: e.km, estimated: true });
    }
  }
  return out.sort((a, b) => a.min - b.min).slice(0, limit);
}

export const shortName = (s: Pick<LaborSource, 'name' | 'short_name'>) => s.short_name?.trim() || s.name;
