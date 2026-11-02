// Đọc / ghi chuyến khảo sát KCN, vết GPS và ảnh chỉ tiêu (migration 190).
import { supabase } from '../supabase';
import { resizeImage } from '../imageResize';
import type { Bounds, TrackPoint, TrackSegment } from './track';
import type { PassedCompany } from './companies';

export const SURVEY_MIGRATION_HINT = 'Chưa chạy migration 190 (Khảo sát KCN) trên Supabase — chạy file 20261102100000_190_kcn_survey_trips.sql rồi thử lại';
export const PHOTO_BUCKET = 'kcn-survey';

/** Lỗi do chưa có bảng / bucket của migration 190 → câu nhắc chạy migration; lỗi khác giữ nguyên. */
export function surveyErrorText(e: unknown): string {
  const msg = (e as { message?: string })?.message ?? String(e);
  if (/kcn_survey|kcn-survey|bucket not found|schema cache|does not exist|PGRST20[45]/i.test(msg)) return SURVEY_MIGRATION_HINT;
  return msg;
}

export interface SurveyTrip {
  id: string;
  zone_id: string | null;
  zone_name: string;
  user_id: string | null;
  user_name: string;
  started_at: string;
  ended_at: string | null;
  distance_m: number;
  min_lat: number | null;
  min_lng: number | null;
  max_lat: number | null;
  max_lng: number | null;
  passed: PassedCompany[];
  road_coverage: number | null;
  note: string;
  created_at: string;
}

export interface SurveyPhoto {
  id: string;
  trip_id: string | null;
  zone_id: string | null;
  zone_name: string;
  lat: number;
  lng: number;
  accuracy_m: number | null;
  position_source: 'gps' | 'exif' | 'manual';
  taken_at: string;
  storage_path: string;
  url: string;
  thumb_url: string | null;
  width: number | null;
  height: number | null;
  size_bytes: number | null;
  company_name: string;
  client_id: string | null;
  lead_id: string | null;
  crm_id: string | null;
  positions: string;
  headcount: number | null;
  wage_text: string;
  note: string;
  user_id: string | null;
  user_name: string;
  created_at: string;
}

const TRIP_COLS = 'id, zone_id, zone_name, user_id, user_name, started_at, ended_at, distance_m, min_lat, min_lng, max_lat, max_lng, passed, road_coverage, note, created_at';

const normTrip = (r: SurveyTrip): SurveyTrip => ({
  ...r,
  distance_m: Number(r.distance_m) || 0,
  road_coverage: r.road_coverage == null ? null : Number(r.road_coverage),
  passed: Array.isArray(r.passed) ? r.passed : [],
});

// ── Chuyến ───────────────────────────────────────────────────────────────────
export async function createTrip(t: { zone_id: string | null; zone_name: string; user_id: string | null; user_name: string }): Promise<SurveyTrip> {
  const { data, error } = await supabase.from('kcn_survey_trips').insert(t).select(TRIP_COLS).single();
  if (error) throw new Error(surveyErrorText(error));
  return normTrip(data as SurveyTrip);
}

export async function updateTrip(id: string, patch: Partial<Pick<SurveyTrip, 'zone_id' | 'zone_name' | 'ended_at' | 'distance_m' | 'min_lat' | 'min_lng' | 'max_lat' | 'max_lng' | 'passed' | 'road_coverage' | 'note'>>) {
  const { error } = await supabase.from('kcn_survey_trips').update(patch).eq('id', id);
  if (error) throw new Error(surveyErrorText(error));
}

/** Xoá mềm — chuyến và vết GPS vẫn nằm trong DB (khôi phục được bằng cách đặt deleted_at = NULL). */
export async function softDeleteTrip(id: string) {
  const { error } = await supabase.from('kcn_survey_trips').update({ deleted_at: new Date().toISOString() }).eq('id', id);
  if (error) throw new Error(surveyErrorText(error));
}

export async function getTrip(id: string): Promise<SurveyTrip | null> {
  const { data, error } = await supabase.from('kcn_survey_trips').select(TRIP_COLS).eq('id', id).is('deleted_at', null).maybeSingle();
  if (error) throw new Error(surveyErrorText(error));
  return data ? normTrip(data as SurveyTrip) : null;
}

/**
 * Chuyến cũ: theo KCN (zoneId) và/hoặc chạm khung toạ độ (chuyến chưa kết thúc chưa có khung → lấy theo KCN).
 * Không truyền gì = các chuyến mới nhất.
 */
export async function listTrips(opts: { zoneId?: string | null; bounds?: Bounds | null; limit?: number } = {}): Promise<SurveyTrip[]> {
  let q = supabase.from('kcn_survey_trips').select(TRIP_COLS).is('deleted_at', null).order('started_at', { ascending: false }).limit(opts.limit ?? 60);
  const b = opts.bounds;
  if (opts.zoneId && b) {
    q = q.or(`zone_id.eq.${opts.zoneId},and(min_lat.lte.${b.maxLat},max_lat.gte.${b.minLat},min_lng.lte.${b.maxLng},max_lng.gte.${b.minLng})`);
  } else if (opts.zoneId) {
    q = q.eq('zone_id', opts.zoneId);
  } else if (b) {
    q = q.lte('min_lat', b.maxLat).gte('max_lat', b.minLat).lte('min_lng', b.maxLng).gte('max_lng', b.minLng);
  }
  const { data, error } = await q;
  if (error) throw new Error(surveyErrorText(error));
  return ((data ?? []) as SurveyTrip[]).map(normTrip);
}

// ── Vết GPS ──────────────────────────────────────────────────────────────────
export interface TrackChunk {
  trip_id: string;
  seq: number;
  segment: number;
  points: TrackPoint[];
}

/** Ghi 1 đoạn vết. Gửi lại đoạn đã ghi (cùng trip_id + seq) không tạo bản trùng. */
export async function appendChunk(c: TrackChunk) {
  const { error } = await supabase.from('kcn_survey_track_chunks').upsert(c, { onConflict: 'trip_id,seq', ignoreDuplicates: true });
  if (error) throw new Error(surveyErrorText(error));
}

/** Vết của nhiều chuyến: tripId → các đoạn (theo thứ tự đi). */
export async function loadTracks(tripIds: readonly string[]): Promise<Map<string, TrackSegment[]>> {
  const out = new Map<string, TrackSegment[]>();
  if (!tripIds.length) return out;
  const rows: TrackChunk[] = [];
  const PAGE = 1000;
  for (let from = 0; from < 50_000; from += PAGE) {
    const { data, error } = await supabase.from('kcn_survey_track_chunks')
      .select('trip_id, seq, segment, points')
      .in('trip_id', tripIds as string[])
      .order('trip_id', { ascending: true }).order('seq', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(surveyErrorText(error));
    rows.push(...((data ?? []) as TrackChunk[]));
    if ((data ?? []).length < PAGE) break;
  }
  return groupChunks(rows);
}

/** Ghép các đoạn ~30 giây thành đường đi liền theo segment (thuần — test được). */
export function groupChunks(rows: readonly TrackChunk[]): Map<string, TrackSegment[]> {
  const byTrip = new Map<string, TrackChunk[]>();
  for (const r of rows) {
    const list = byTrip.get(r.trip_id);
    if (list) list.push(r); else byTrip.set(r.trip_id, [r]);
  }
  const out = new Map<string, TrackSegment[]>();
  for (const [tripId, chunks] of byTrip) {
    chunks.sort((a, b) => a.seq - b.seq);
    const segs = new Map<number, TrackSegment>();
    const order: number[] = [];
    for (const c of chunks) {
      const pts = (Array.isArray(c.points) ? c.points : []).filter(p => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]));
      if (!pts.length) continue;
      let seg = segs.get(c.segment);
      if (!seg) { seg = []; segs.set(c.segment, seg); order.push(c.segment); }
      seg.push(...pts.map(p => [p[0], p[1], p[2] ?? 0, p[3] ?? 0] as TrackPoint));
    }
    out.set(tripId, order.map(s => segs.get(s)!));
  }
  return out;
}

// ── Ảnh chỉ tiêu ─────────────────────────────────────────────────────────────
const PHOTO_COLS = 'id, trip_id, zone_id, zone_name, lat, lng, accuracy_m, position_source, taken_at, storage_path, url, thumb_url, width, height, size_bytes, company_name, client_id, lead_id, crm_id, positions, headcount, wage_text, note, user_id, user_name, created_at';

export async function listPhotos(opts: { zoneId?: string | null; tripId?: string | null; bounds?: Bounds | null; limit?: number } = {}): Promise<SurveyPhoto[]> {
  let q = supabase.from('kcn_survey_photos').select(PHOTO_COLS).is('deleted_at', null).order('taken_at', { ascending: false }).limit(opts.limit ?? 300);
  if (opts.tripId) q = q.eq('trip_id', opts.tripId);
  const b = opts.bounds;
  if (opts.zoneId && b) {
    q = q.or(`zone_id.eq.${opts.zoneId},and(lat.gte.${b.minLat},lat.lte.${b.maxLat},lng.gte.${b.minLng},lng.lte.${b.maxLng})`);
  } else if (opts.zoneId) {
    q = q.eq('zone_id', opts.zoneId);
  } else if (b) {
    q = q.gte('lat', b.minLat).lte('lat', b.maxLat).gte('lng', b.minLng).lte('lng', b.maxLng);
  }
  const { data, error } = await q;
  if (error) throw new Error(surveyErrorText(error));
  return (data ?? []) as SurveyPhoto[];
}

export type PhotoMeta = Omit<SurveyPhoto, 'id' | 'storage_path' | 'url' | 'thumb_url' | 'width' | 'height' | 'size_bytes' | 'created_at'>;

/**
 * Nén ảnh ngay trên điện thoại (cạnh dài 1600px — vẫn đọc rõ chữ trên bảng tuyển dụng, ~200–400 KB) + ảnh nhỏ 360px
 * cho lưới xem nhanh, tải cả hai lên bucket rồi ghi 1 dòng. `id` do app sinh → bấm lưu lại sau khi mất mạng không tạo trùng.
 */
export async function uploadPhoto(id: string, file: Blob, meta: PhotoMeta): Promise<SurveyPhoto> {
  const asFile = file instanceof File ? file : new File([file], 'photo.jpg', { type: file.type || 'image/jpeg' });
  const [big, thumb] = await Promise.all([
    resizeImage(asFile, { max: 1600, quality: 0.82 }),
    resizeImage(asFile, { max: 360, quality: 0.75 }),
  ]);
  const day = meta.taken_at.slice(0, 10);
  const base = `${meta.zone_id ?? 'khac'}/${day}/${id}`;
  const path = `${base}.${big.ext}`;
  const thumbPath = `${base}_thumb.${thumb.ext}`;
  const bucket = supabase.storage.from(PHOTO_BUCKET);
  // upsert:false — anon chỉ có quyền tải lên, không có quyền ghi đè. Lần thử lại gặp "đã tồn tại" thì coi như xong.
  const put = async (p: string, blob: Blob) => {
    const { error } = await bucket.upload(p, blob, { upsert: false, contentType: blob.type, cacheControl: '31536000' });
    if (error && !/exists|duplicate/i.test(error.message)) throw new Error(surveyErrorText(error));
  };
  await put(path, big.blob);
  await put(thumbPath, thumb.blob);
  const row = {
    id, ...meta,
    storage_path: path,
    url: bucket.getPublicUrl(path).data.publicUrl,
    thumb_url: bucket.getPublicUrl(thumbPath).data.publicUrl,
    width: big.width, height: big.height, size_bytes: big.size,
  };
  const { data, error } = await supabase.from('kcn_survey_photos').upsert(row, { onConflict: 'id' }).select(PHOTO_COLS).single();
  if (error) throw new Error(surveyErrorText(error));
  return data as SurveyPhoto;
}

export async function updatePhoto(id: string, patch: Partial<Pick<SurveyPhoto, 'company_name' | 'client_id' | 'lead_id' | 'crm_id' | 'positions' | 'headcount' | 'wage_text' | 'note' | 'lat' | 'lng' | 'position_source'>>) {
  const { error } = await supabase.from('kcn_survey_photos').update(patch).eq('id', id);
  if (error) throw new Error(surveyErrorText(error));
}

/** Xoá mềm — file ảnh vẫn trong Storage, dòng vẫn trong DB (deleted_at). */
export async function softDeletePhoto(id: string) {
  const { error } = await supabase.from('kcn_survey_photos').update({ deleted_at: new Date().toISOString() }).eq('id', id);
  if (error) throw new Error(surveyErrorText(error));
}
