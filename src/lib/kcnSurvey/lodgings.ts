// Nhà trọ ghi khi khảo sát KCN — bảng kcn_survey_lodgings (migration 221): đọc / ghi, tải ảnh, đo đường xe máy / đi bộ.
// Phần thuần ở lodgingCore.ts.
import { supabase } from '../supabase';
import { resizeImage } from '../imageResize';
import { r2PutFiles, r2Status, R2_PATH_PREFIX } from '../r2Upload';
import { isMissingTableError } from '../clientMaps/orgChart';
import { PHOTO_BUCKET } from './api';
import { normLodging, pickRouteTargets, type Lodging, type LodgingPhoto, type LodgingPhotoKind, type LodgingRoute, type RouteCandidate } from './lodgingCore';

export const LODGING_MIGRATION_HINT = 'Cần chạy migration 221 (Nhà trọ khi khảo sát KCN) trong Supabase → SQL Editor';
export class LodgingMissingTable extends Error {}

const fail = (e: { code?: string; message?: string }): never => {
  if (isMissingTableError(e)) throw new LodgingMissingTable(LODGING_MIGRATION_HINT);
  throw new Error(e.message ?? String(e));
};

export async function listLodgings(): Promise<Lodging[]> {
  const { data, error } = await supabase.from('kcn_survey_lodgings').select('*').is('deleted_at', null).order('created_at', { ascending: false }).limit(1000);
  if (error) fail(error);
  return ((data ?? []) as Record<string, unknown>[]).map(normLodging);
}

export type LodgingInput = Omit<Lodging, 'created_at' | 'updated_at' | 'created_by' | 'updated_by'>;

/** Lưu (tạo mới hoặc sửa) — id do app sinh nên bấm lưu lại sau khi mất mạng không tạo trùng. */
export async function saveLodging(l: LodgingInput, userName: string, isNew: boolean): Promise<Lodging> {
  const row: Record<string, unknown> = { ...l, updated_by: userName };
  if (isNew) row.created_by = userName;
  const { data, error } = await supabase.from('kcn_survey_lodgings').upsert(row, { onConflict: 'id' }).select('*').single();
  if (error) fail(error);
  return normLodging(data as Record<string, unknown>);
}

export async function softDeleteLodging(id: string, userName: string): Promise<void> {
  const { error } = await supabase.from('kcn_survey_lodgings').update({ deleted_at: new Date().toISOString(), updated_by: userName }).eq('id', id);
  if (error) fail(error);
}

/** Nén + tải 1 ảnh nhà trọ (1400 px + ảnh nhỏ 320 px) lên R2, lỗi thì Supabase — giống ảnh chỉ tiêu. */
export async function uploadLodgingPhoto(lodgingId: string, file: File, kind: LodgingPhotoKind): Promise<LodgingPhoto> {
  const id = crypto.randomUUID();
  const [big, thumb] = await Promise.all([
    resizeImage(file, { max: 1400, quality: 0.74 }),
    resizeImage(file, { max: 320, quality: 0.7 }),
  ]);
  const base = `lodging/${lodgingId}/${id}`;
  const path = `${base}.${big.ext}`, thumbPath = `${base}_thumb.${thumb.ext}`;
  if ((await r2Status()).enabled) {
    try {
      const [url, thumbUrl] = await r2PutFiles([
        { key: `${PHOTO_BUCKET}/${path}`, blob: big.blob, contentType: big.blob.type || 'image/jpeg' },
        { key: `${PHOTO_BUCKET}/${thumbPath}`, blob: thumb.blob, contentType: thumb.blob.type || 'image/jpeg' },
      ]);
      return { id, kind, url, thumb_url: thumbUrl, storage_path: `${R2_PATH_PREFIX}${PHOTO_BUCKET}/${path}`, caption: '', width: big.width, height: big.height };
    } catch (e) {
      console.warn('Cloudflare R2 lỗi — lưu Supabase thay:', (e as Error).message);
    }
  }
  const bucket = supabase.storage.from(PHOTO_BUCKET);
  for (const [p, b] of [[path, big.blob], [thumbPath, thumb.blob]] as const) {
    const { error } = await bucket.upload(p, b, { upsert: false, contentType: b.type, cacheControl: '31536000' });
    if (error && !/exists|duplicate/i.test(error.message)) throw new Error('Tải ảnh lên lỗi: ' + error.message);
  }
  return { id, kind, url: bucket.getPublicUrl(path).data.publicUrl, thumb_url: bucket.getPublicUrl(thumbPath).data.publicUrl, storage_path: path, caption: '', width: big.width, height: big.height };
}

// ── Đo đường xe máy / đi bộ ─────────────────────────────────────────────────
// Valhalla FOSSGIS (CORS mở, gọi được từ mạng VN — đang dùng cho Nguồn LĐ): costing motorcycle / pedestrian, 1 lượt cho cả
// danh sách công ty. Lỗi → OSRM (đường ô tô) rồi ước giờ: xe máy 28 km/h, đi bộ 4,5 km/h.
const VALHALLA_URL = 'https://valhalla1.openstreetmap.de';
const OSRM_URL = 'https://router.project-osrm.org';
const MOTO_KMH = 28;
const WALK_KMH = 4.5;
const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

type Cell = { km: number | null; min: number | null };

async function valhallaRow(src: { lat: number; lng: number }, targets: readonly { lat: number; lng: number }[], costing: 'motorcycle' | 'pedestrian'): Promise<Cell[]> {
  const res = await fetch(`${VALHALLA_URL}/sources_to_targets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sources: [{ lat: src.lat, lon: src.lng }], targets: targets.map(t => ({ lat: t.lat, lon: t.lng })), costing, units: 'kilometers' }),
  });
  if (!res.ok) throw new Error(`Valhalla ${res.status}`);
  const data = await res.json() as { sources_to_targets?: { to_index: number; distance: number | null; time: number | null }[][] };
  const row = data.sources_to_targets?.[0];
  if (!Array.isArray(row)) throw new Error('Valhalla trả dữ liệu lạ');
  const out: Cell[] = targets.map(() => ({ km: null, min: null }));
  for (const c of row) if (c.distance != null && c.time != null) out[c.to_index] = { km: r2(c.distance), min: r1(c.time / 60) };
  return out;
}

async function osrmKm(src: { lat: number; lng: number }, targets: readonly { lat: number; lng: number }[]): Promise<(number | null)[]> {
  const coords = [src, ...targets].map(p => `${p.lng},${p.lat}`).join(';');
  const res = await fetch(`${OSRM_URL}/table/v1/driving/${coords}?sources=0&annotations=distance`);
  if (!res.ok) throw new Error(`OSRM ${res.status}`);
  const data = await res.json() as { code?: string; distances?: (number | null)[][] };
  const row = data.code === 'Ok' ? data.distances?.[0] : undefined;
  if (!row) throw new Error('OSRM trả dữ liệu lạ');
  return targets.map((_, i) => (row[i + 1] == null ? null : r2(row[i + 1]! / 1000)));
}

/** Đo đường từ nhà trọ tới các công ty gần nhất (mặc định 8 công ty trong 5 km + các công ty tự chọn). */
export async function computeLodgingRoutes(from: { lat: number; lng: number }, cands: readonly RouteCandidate[], opts: { max?: number; radiusM?: number; keep?: readonly string[] } = {}): Promise<LodgingRoute[]> {
  const targets = pickRouteTargets(from, cands, opts);
  if (!targets.length) return [];
  const at = new Date().toISOString();
  let moto: Cell[] | null = null, walk: Cell[] | null = null;
  try { moto = await valhallaRow(from, targets, 'motorcycle'); } catch { moto = null; }
  try { walk = await valhallaRow(from, targets, 'pedestrian'); } catch { walk = null; }
  let carKm: (number | null)[] | null = null;
  if (!moto || !walk) { try { carKm = await osrmKm(from, targets); } catch { carKm = null; } }
  return targets.map((t, i) => {
    const est = carKm?.[i] ?? null;
    const m = moto?.[i] ?? (est != null ? { km: est, min: r1((est / MOTO_KMH) * 60) } : { km: null, min: null });
    const w = walk?.[i] ?? (est != null ? { km: est, min: r1((est / WALK_KMH) * 60) } : { km: null, min: null });
    return {
      key: t.key, name: t.name, kind: t.kind, color: t.color, lat: t.lat, lng: t.lng, straight_m: t.straight_m,
      moto_km: m.km, moto_min: m.min, walk_km: w.km, walk_min: w.min,
      engine: moto && walk ? 'valhalla' as const : 'estimate' as const, at,
    };
  });
}
