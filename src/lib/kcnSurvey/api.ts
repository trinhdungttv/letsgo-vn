// Đọc / ghi chuyến khảo sát KCN, vết GPS và ảnh chỉ tiêu (migration 190).
import { supabase } from '../supabase';
import { resizeImage } from '../imageResize';
import type { Bounds, TrackPoint, TrackSegment } from './track';
import type { PassedCompany } from './companies';
import { sanitizeMarks, type PhotoMark } from './markup';

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
  /** "KCN Nhơn Trạch 3 – Khảo sát 03/11/2026" (migration 192; '' = chưa đặt / chưa có cột) */
  title: string;
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
  /** Nét vẽ / chữ ghi lên ảnh (migration 193; [] = chưa có / chưa có cột) */
  annotations: PhotoMark[];
  user_id: string | null;
  user_name: string;
  created_at: string;
}

const TRIP_COLS_BASE = 'id, zone_id, zone_name, user_id, user_name, started_at, ended_at, distance_m, min_lat, min_lng, max_lat, max_lng, passed, road_coverage, note, created_at';
const TRIP_COLS = `${TRIP_COLS_BASE}, title`;

export const TITLE_MIGRATION_HINT = 'Chưa chạy migration 192 nên chưa lưu được tiêu đề chuyến — chạy 192 rồi sửa lại tên';

// Cột title (migration 192) có thể chưa có trên DB → biết thiếu 1 lần thì đọc / ghi không kèm cột đó, để danh sách
// chuyến không trắng trơn (bài học PGRST201). null = chưa biết.
let titleColumn: boolean | null = null;
const isTitleColError = (e: unknown) => /title/i.test((e as { message?: string })?.message ?? '');
export const titleColumnMissing = () => titleColumn === false;
const tripCols = () => (titleColumn === false ? TRIP_COLS_BASE : TRIP_COLS);

/** Chạy 1 lệnh đọc/ghi chuyến; lỗi do thiếu cột title thì nhớ lại và chạy lần nữa không kèm cột đó. */
async function withTitleFallback<T>(run: (cols: string, withTitle: boolean) => PromiseLike<{ data: T; error: unknown }>): Promise<T> {
  let res = await run(tripCols(), titleColumn !== false);
  if (res.error && titleColumn !== false && isTitleColError(res.error)) {
    titleColumn = false;
    res = await run(TRIP_COLS_BASE, false);
  } else if (!res.error && titleColumn === null) {
    titleColumn = true;
  }
  if (res.error) throw new Error(surveyErrorText(res.error));
  return res.data;
}

const normTrip = (r: SurveyTrip): SurveyTrip => ({
  ...r,
  distance_m: Number(r.distance_m) || 0,
  road_coverage: r.road_coverage == null ? null : Number(r.road_coverage),
  passed: Array.isArray(r.passed) ? r.passed : [],
  title: r.title ?? '',
});

// ── Chuyến ───────────────────────────────────────────────────────────────────
export async function createTrip(t: { zone_id: string | null; zone_name: string; user_id: string | null; user_name: string; title: string }): Promise<SurveyTrip> {
  const { title, ...rest } = t;
  const data = await withTitleFallback((cols, withTitle) =>
    supabase.from('kcn_survey_trips').insert(withTitle ? t : rest).select(cols).single());
  // Chưa có cột title vẫn giữ tên trong máy để hiện trên màn khảo sát
  return normTrip({ ...(data as unknown as SurveyTrip), title: (data as unknown as SurveyTrip).title ?? title });
}

export async function updateTrip(id: string, patch: Partial<Pick<SurveyTrip, 'zone_id' | 'zone_name' | 'ended_at' | 'distance_m' | 'min_lat' | 'min_lng' | 'max_lat' | 'max_lng' | 'passed' | 'road_coverage' | 'note' | 'title'>>) {
  const { title, ...rest } = patch;
  if (title === undefined || titleColumn === false) {
    if (!Object.keys(rest).length) return;
    const { error } = await supabase.from('kcn_survey_trips').update(rest).eq('id', id);
    if (error) throw new Error(surveyErrorText(error));
    return;
  }
  await withTitleFallback((_cols, withTitle) =>
    supabase.from('kcn_survey_trips').update(withTitle ? patch : rest).eq('id', id).select('id'));
}

/** Số chuyến đã có ở 1 KCN trong khoảng thời gian (đặt tên "lần 2, lần 3…" trong ngày). Lỗi → 0. */
export async function countTripsBetween(zoneId: string, from: string, to: string): Promise<number> {
  const { count, error } = await supabase.from('kcn_survey_trips').select('id', { count: 'exact', head: true })
    .eq('zone_id', zoneId).gte('started_at', from).lt('started_at', to).is('deleted_at', null);
  return error ? 0 : count ?? 0;
}

/** Xoá mềm — chuyến và vết GPS vẫn nằm trong DB (khôi phục được bằng cách đặt deleted_at = NULL). */
export async function softDeleteTrip(id: string) {
  const { error } = await supabase.from('kcn_survey_trips').update({ deleted_at: new Date().toISOString() }).eq('id', id);
  if (error) throw new Error(surveyErrorText(error));
}

export async function getTrip(id: string): Promise<SurveyTrip | null> {
  const data = await withTitleFallback(cols => supabase.from('kcn_survey_trips').select(cols).eq('id', id).is('deleted_at', null).maybeSingle());
  return data ? normTrip(data as unknown as SurveyTrip) : null;
}

/**
 * Chuyến cũ: theo KCN (zoneId) và/hoặc chạm khung toạ độ (chuyến chưa kết thúc chưa có khung → lấy theo KCN).
 * Không truyền gì = các chuyến mới nhất.
 */
export async function listTrips(opts: { zoneId?: string | null; bounds?: Bounds | null; limit?: number } = {}): Promise<SurveyTrip[]> {
  const b = opts.bounds;
  const data = await withTitleFallback(cols => {
    let q = supabase.from('kcn_survey_trips').select(cols).is('deleted_at', null).order('started_at', { ascending: false }).limit(opts.limit ?? 60);
    if (opts.zoneId && b) {
      q = q.or(`zone_id.eq.${opts.zoneId},and(min_lat.lte.${b.maxLat},max_lat.gte.${b.minLat},min_lng.lte.${b.maxLng},max_lng.gte.${b.minLng})`);
    } else if (opts.zoneId) {
      q = q.eq('zone_id', opts.zoneId);
    } else if (b) {
      q = q.lte('min_lat', b.maxLat).gte('max_lat', b.minLat).lte('min_lng', b.maxLng).gte('max_lng', b.minLng);
    }
    return q;
  });
  return ((data ?? []) as unknown as SurveyTrip[]).map(normTrip);
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
const PHOTO_COLS_BASE = 'id, trip_id, zone_id, zone_name, lat, lng, accuracy_m, position_source, taken_at, storage_path, url, thumb_url, width, height, size_bytes, company_name, client_id, lead_id, crm_id, positions, headcount, wage_text, note, user_id, user_name, created_at';
const PHOTO_COLS = `${PHOTO_COLS_BASE}, annotations`;

export const MARKUP_MIGRATION_HINT = 'Chưa chạy migration 193 nên chưa lưu được nét vẽ trên ảnh — chạy 193 rồi vẽ lại';

// Cột annotations (migration 193) có thể chưa có → biết thiếu 1 lần thì đọc / ghi không kèm, ảnh vẫn hiện bình thường.
let annotColumn: boolean | null = null;
const isAnnotColError = (e: unknown) => /annotations/i.test((e as { message?: string })?.message ?? '');
export const markupColumnMissing = () => annotColumn === false;

async function withAnnotFallback<T>(run: (cols: string, withAnnot: boolean) => PromiseLike<{ data: T; error: unknown }>): Promise<T> {
  let res = await run(annotColumn === false ? PHOTO_COLS_BASE : PHOTO_COLS, annotColumn !== false);
  if (res.error && annotColumn !== false && isAnnotColError(res.error)) {
    annotColumn = false;
    res = await run(PHOTO_COLS_BASE, false);
  } else if (!res.error && annotColumn === null) {
    annotColumn = true;
  }
  if (res.error) throw new Error(surveyErrorText(res.error));
  return res.data;
}

const normPhoto = (r: SurveyPhoto): SurveyPhoto => ({ ...r, annotations: sanitizeMarks((r as { annotations?: unknown }).annotations) });

export async function listPhotos(opts: { zoneId?: string | null; tripId?: string | null; bounds?: Bounds | null; limit?: number } = {}): Promise<SurveyPhoto[]> {
  const data = await withAnnotFallback(cols => {
    let q = supabase.from('kcn_survey_photos').select(cols).is('deleted_at', null).order('taken_at', { ascending: false }).limit(opts.limit ?? 300);
    if (opts.tripId) q = q.eq('trip_id', opts.tripId);
    const b = opts.bounds;
    if (opts.zoneId && b) {
      q = q.or(`zone_id.eq.${opts.zoneId},and(lat.gte.${b.minLat},lat.lte.${b.maxLat},lng.gte.${b.minLng},lng.lte.${b.maxLng})`);
    } else if (opts.zoneId) {
      q = q.eq('zone_id', opts.zoneId);
    } else if (b) {
      q = q.gte('lat', b.minLat).lte('lat', b.maxLat).gte('lng', b.minLng).lte('lng', b.maxLng);
    }
    return q;
  });
  return ((data ?? []) as unknown as SurveyPhoto[]).map(normPhoto);
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
  const { annotations, ...rowBase } = row;
  const data = await withAnnotFallback((cols, withAnnot) =>
    supabase.from('kcn_survey_photos').upsert(withAnnot ? row : rowBase, { onConflict: 'id' }).select(cols).single());
  // Chưa có cột annotations → nét vẽ vẫn giữ trong máy để hiện ngay (lần mở sau mới mất)
  return normPhoto({ ...(data as unknown as SurveyPhoto), annotations: (data as unknown as SurveyPhoto).annotations ?? annotations });
}

export async function updatePhoto(id: string, patch: Partial<Pick<SurveyPhoto, 'company_name' | 'client_id' | 'lead_id' | 'crm_id' | 'positions' | 'headcount' | 'wage_text' | 'note' | 'lat' | 'lng' | 'position_source' | 'annotations'>>) {
  const { annotations, ...rest } = patch;
  if (annotations !== undefined && annotColumn === false) throw new Error(MARKUP_MIGRATION_HINT);
  const { error } = await supabase.from('kcn_survey_photos').update(patch).eq('id', id);
  if (error && annotations !== undefined && isAnnotColError(error)) {
    annotColumn = false;
    if (Object.keys(rest).length) {
      const r2 = await supabase.from('kcn_survey_photos').update(rest).eq('id', id);
      if (r2.error) throw new Error(surveyErrorText(r2.error));
    }
    throw new Error(MARKUP_MIGRATION_HINT);
  }
  if (error) throw new Error(surveyErrorText(error));
}

/** Xoá mềm — file ảnh vẫn trong Storage, dòng vẫn trong DB (deleted_at). */
export async function softDeletePhoto(id: string) {
  const { error } = await supabase.from('kcn_survey_photos').update({ deleted_at: new Date().toISOString() }).eq('id', id);
  if (error) throw new Error(surveyErrorText(error));
}

// ── Ghi âm khi khảo sát (migration 193) ──────────────────────────────────────
export const VOICE_MIGRATION_HINT = 'Chưa chạy migration 193 (ghi âm khảo sát) — chạy file 20261103090000_193_kcn_survey_markup_voice.sql rồi thử lại';

export interface SurveyVoiceNote {
  id: string;
  trip_id: string | null;
  zone_id: string | null;
  zone_name: string;
  lat: number | null;
  lng: number | null;
  accuracy_m: number | null;
  recorded_at: string;
  duration_s: number;
  storage_path: string;
  url: string;
  mime_type: string;
  size_bytes: number | null;
  company_name: string;
  client_id: string | null;
  lead_id: string | null;
  crm_id: string | null;
  note: string;
  user_id: string | null;
  user_name: string;
  created_at: string;
}

const VOICE_COLS = 'id, trip_id, zone_id, zone_name, lat, lng, accuracy_m, recorded_at, duration_s, storage_path, url, mime_type, size_bytes, company_name, client_id, lead_id, crm_id, note, user_id, user_name, created_at';

function voiceErrorText(e: unknown): string {
  const msg = (e as { message?: string })?.message ?? String(e);
  if (/kcn_survey_voice|schema cache|does not exist|PGRST20[45]/i.test(msg)) return VOICE_MIGRATION_HINT;
  return surveyErrorText(e);
}

const normVoice = (r: SurveyVoiceNote): SurveyVoiceNote => ({ ...r, duration_s: Number(r.duration_s) || 0 });

export async function listVoiceNotes(opts: { zoneId?: string | null; tripId?: string | null; bounds?: Bounds | null; limit?: number } = {}): Promise<SurveyVoiceNote[]> {
  let q = supabase.from('kcn_survey_voice_notes').select(VOICE_COLS).is('deleted_at', null).order('recorded_at', { ascending: false }).limit(opts.limit ?? 300);
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
  if (error) throw new Error(voiceErrorText(error));
  return ((data ?? []) as SurveyVoiceNote[]).map(normVoice);
}

export type VoiceMeta = Omit<SurveyVoiceNote, 'id' | 'storage_path' | 'url' | 'size_bytes' | 'created_at'>;

/** Tải file ghi âm lên bucket (thư mục voice/) rồi ghi 1 dòng. `id` do app sinh → bấm Thử lại không tạo trùng. */
export async function uploadVoiceNote(id: string, blob: Blob, ext: string, meta: VoiceMeta): Promise<SurveyVoiceNote> {
  const day = meta.recorded_at.slice(0, 10);
  const path = `voice/${meta.zone_id ?? 'khac'}/${day}/${id}.${ext}`;
  const bucket = supabase.storage.from(PHOTO_BUCKET);
  const { error: upErr } = await bucket.upload(path, blob, { upsert: false, contentType: meta.mime_type || blob.type || 'audio/webm', cacheControl: '31536000' });
  if (upErr && !/exists|duplicate/i.test(upErr.message)) throw new Error(surveyErrorText(upErr));
  const row = { id, ...meta, storage_path: path, url: bucket.getPublicUrl(path).data.publicUrl, size_bytes: blob.size };
  const { data, error } = await supabase.from('kcn_survey_voice_notes').upsert(row, { onConflict: 'id' }).select(VOICE_COLS).single();
  if (error) throw new Error(voiceErrorText(error));
  return normVoice(data as SurveyVoiceNote);
}

export async function updateVoiceNote(id: string, patch: Partial<Pick<SurveyVoiceNote, 'note' | 'company_name' | 'client_id' | 'lead_id' | 'crm_id'>>) {
  const { error } = await supabase.from('kcn_survey_voice_notes').update(patch).eq('id', id);
  if (error) throw new Error(voiceErrorText(error));
}

/** Xoá mềm — file ghi âm vẫn trong Storage, dòng vẫn trong DB (deleted_at). */
export async function softDeleteVoiceNote(id: string) {
  const { error } = await supabase.from('kcn_survey_voice_notes').update({ deleted_at: new Date().toISOString() }).eq('id', id);
  if (error) throw new Error(voiceErrorText(error));
}

// ── Vùng khảo sát đã khoanh (migration 194) ──────────────────────────────────
export const AREA_MIGRATION_HINT = 'Chưa chạy migration 194 (vùng khảo sát) nên chưa lưu được vùng khoanh — chạy file 20261103120000_194_kcn_survey_areas.sql rồi lưu lại';

export interface SurveyArea {
  id: string;
  zone_id: string | null;
  name: string;
  rings: [number, number][][];
  source: 'osm' | 'drawn' | 'view';
  osm_ref: string | null;
  center_lat: number | null;
  center_lng: number | null;
  area_m2: number | null;
  user_id: string | null;
  user_name: string;
  updated_at: string;
}

const AREA_COLS = 'id, zone_id, name, rings, source, osm_ref, center_lat, center_lng, area_m2, user_id, user_name, updated_at';

function areaErrorText(e: unknown): string {
  const msg = (e as { message?: string })?.message ?? String(e);
  if (/kcn_survey_areas|schema cache|does not exist|PGRST20[45]/i.test(msg)) return AREA_MIGRATION_HINT;
  return msg;
}

/** Vòng hợp lệ: ≥ 4 điểm số thực (đã khép kín). Dữ liệu sửa tay được nên luôn lọc lại. */
const cleanRings = (raw: unknown): [number, number][][] => (Array.isArray(raw) ? raw : [])
  .map(r => (Array.isArray(r) ? r : []).filter((p): p is [number, number] => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])).map(p => [p[0], p[1]] as [number, number]))
  .filter(r => r.length >= 4);

const normArea = (r: SurveyArea): SurveyArea => ({ ...r, rings: cleanRings(r.rings), area_m2: r.area_m2 == null ? null : Number(r.area_m2) });

export async function listSurveyAreas(): Promise<SurveyArea[]> {
  const { data, error } = await supabase.from('kcn_survey_areas').select(AREA_COLS).is('deleted_at', null).limit(500);
  if (error) throw new Error(areaErrorText(error));
  return ((data ?? []) as SurveyArea[]).map(normArea).filter(a => a.rings.length);
}

/** Lưu vùng cho 1 KCN: đã có vùng → sửa dòng đó (lịch sử dữ liệu giữ bản trước); chưa có → thêm mới. */
export async function saveSurveyArea(a: Omit<SurveyArea, 'id' | 'updated_at'>): Promise<SurveyArea> {
  let existingId: string | null = null;
  if (a.zone_id) {
    const { data, error } = await supabase.from('kcn_survey_areas').select('id').eq('zone_id', a.zone_id).is('deleted_at', null).maybeSingle();
    if (error) throw new Error(areaErrorText(error));
    existingId = (data as { id: string } | null)?.id ?? null;
  }
  const q = existingId
    ? supabase.from('kcn_survey_areas').update(a).eq('id', existingId).select(AREA_COLS).single()
    : supabase.from('kcn_survey_areas').insert(a).select(AREA_COLS).single();
  const { data, error } = await q;
  if (error) throw new Error(areaErrorText(error));
  return normArea(data as SurveyArea);
}

/** Thêm nhanh 1 KCN / vùng vào Thị trường → Khu vực (tên, tỉnh, toạ độ tâm, link bản đồ). */
export async function createMarketZoneQuick(z: { name: string; location: string | null; lat: number; lng: number; map_link: string | null }): Promise<{ id: string; name: string; location: string | null; lat: number | null; lng: number | null }> {
  const { data, error } = await supabase.from('market_zones').insert({
    name: z.name, location: z.location, lat: z.lat, lng: z.lng, map_link: z.map_link, geocoded_at: new Date().toISOString(),
    notes: 'Thêm nhanh từ Khảo sát KCN',
  }).select('id, name, location, lat, lng').single();
  if (error) {
    if (/duplicate key|unique/i.test(error.message)) throw new Error(`Đã có khu vực tên "${z.name}" — chọn "Gắn vào KCN có sẵn" hoặc đặt tên khác`);
    throw new Error(error.message);
  }
  return data as { id: string; name: string; location: string | null; lat: number | null; lng: number | null };
}
