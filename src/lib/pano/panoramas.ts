// Ảnh 360° của Khảo sát KCN (Thị trường → Khảo sát KCN + màn khảo sát GPS) — bảng map_panoramas (migration 220).
//   • Lấy ảnh từ link Google Photos / Google Drive / link ảnh: máy chủ /api/pano-import tự tìm ảnh gốc, đọc GPS + hướng,
//     lấy bản ≤ 6144 px rồi chép về Cloudflare R2 (pano/…).
//   • Tải từ máy: đọc GPS + hướng ngay trên máy, ảnh quá to thì thu về 5760 px, rồi tải lên R2 (lỗi → Supabase).
// Nét vẽ (annotations.ts) lưu theo hướng trong ảnh nên căn lại hướng Bắc không làm lệch.
import { supabase } from '../supabase';
import { getStoredSessionToken } from '../sessionToken';
import { resizeImage } from '../imageResize';
import { r2PutFiles, r2Status, R2_PATH_PREFIX } from '../r2Upload';
import { isMissingTableError } from '../clientMaps/orgChart';
import { sanitizeShapes, type PanoShape } from './annotations';
import { coverageFromSize, HFOV_DEFAULT, clamp, wrap360, wrapYaw } from './sphere';
import { readPanoMeta, type PanoMeta } from './imageMeta';
import { PANO_MAX_W, type PanoLinkKind } from './links';

export type PanoSourceKind = PanoLinkKind | 'upload';

export interface PanoStartView { yaw: number; pitch: number; hfov: number }

export interface MapPanorama {
  id: string;
  title: string;
  note: string;
  source_kind: PanoSourceKind;
  source_url: string;
  pano_url: string;
  google_url: string | null;
  storage_path: string;
  width: number | null;
  height: number | null;
  haov: number;
  vaov: number;
  voffset: number;
  lat: number | null;
  lng: number | null;
  /** Hướng la bàn của giữa ảnh; null = chưa căn hướng. */
  heading: number | null;
  camera_height: number;
  view: PanoStartView | null;
  annotations: PanoShape[];
  taken_at: string | null;
  trip_id: string | null;
  zone_id: string | null;
  zone_name: string;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
}

export const PANO_MIGRATION_HINT = 'Cần chạy migration 220 (Ảnh 360 của Khảo sát KCN) trong Supabase → SQL Editor';
export class PanoMissingTable extends Error {}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function readView(raw: unknown): PanoStartView | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const yaw = num(o.yaw), pitch = num(o.pitch), hfov = num(o.hfov);
  if (yaw == null || pitch == null) return null;
  return { yaw: wrapYaw(yaw), pitch: clamp(pitch, -90, 90), hfov: clamp(hfov ?? HFOV_DEFAULT, 10, 130) };
}

function norm(r: Record<string, unknown>): MapPanorama {
  const width = num(r.width), height = num(r.height);
  const cov = coverageFromSize(width ?? 0, height ?? 0);
  return {
    ...(r as unknown as MapPanorama),
    title: typeof r.title === 'string' ? r.title : '',
    zone_name: typeof r.zone_name === 'string' ? r.zone_name : '',
    trip_id: typeof r.trip_id === 'string' ? r.trip_id : null,
    zone_id: typeof r.zone_id === 'string' ? r.zone_id : null,
    note: typeof r.note === 'string' ? r.note : '',
    width, height,
    haov: clamp(num(r.haov) ?? cov.haov, 10, 360),
    vaov: clamp(num(r.vaov) ?? cov.vaov, 10, 180),
    voffset: clamp(num(r.voffset) ?? cov.voffset, -90, 90),
    lat: num(r.lat), lng: num(r.lng),
    heading: num(r.heading) == null ? null : wrap360(num(r.heading)!),
    camera_height: clamp(num(r.camera_height) ?? 2, 0, 2000),
    view: readView(r.view),
    annotations: sanitizeShapes(r.annotations),
  };
}

export async function listPanoramas(): Promise<MapPanorama[]> {
  const { data, error } = await supabase.from('map_panoramas').select('*').is('deleted_at', null).order('created_at', { ascending: false });
  if (error) {
    if (isMissingTableError(error)) throw new PanoMissingTable(PANO_MIGRATION_HINT);
    throw error;
  }
  return ((data ?? []) as Record<string, unknown>[]).map(norm);
}

export interface PanoImageInfo {
  panoUrl: string;
  googleUrl: string | null;
  storagePath: string;
  width: number | null;
  height: number | null;
  sourceKind: PanoSourceKind;
  sourceUrl: string;
  meta: PanoMeta;
  /** 'failed' = máy chủ chưa đọc kịp file gốc (Google trả chậm) → GPS / hướng có thể còn thiếu, form tự đọc lại. */
  metaRead?: 'ok' | 'failed';
  /** Ảnh đã chọn trong album Google Photos — gửi lại khi đọc lại GPS. */
  pick?: string;
}

export interface PanoCandidate { url: string; width: number; height: number; thumb: string }

export type ImportResult =
  | { status: 'ok'; info: PanoImageInfo }
  | { status: 'pick'; candidates: PanoCandidate[] }
  | { status: 'error'; code: string; message: string };

/** Gửi link cho máy chủ lấy ảnh (xem api/pano-import.ts). pick = link ảnh đã chọn trong album. */
export async function importPanoLink(url: string, pick?: string): Promise<ImportResult> {
  const token = getStoredSessionToken();
  let res: Response;
  try {
    res = await fetch('/api/pano-import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { 'x-letsgo-token': token } : {}) },
      body: JSON.stringify({ url, pick }),
    });
  } catch {
    return { status: 'error', code: 'network', message: 'Không kết nối được máy chủ — kiểm tra mạng rồi thử lại.' };
  }
  const isJson = (res.headers.get('content-type') ?? '').includes('json');
  const data = (isJson ? await res.json().catch(() => ({})) : {}) as Record<string, unknown>;
  if (!isJson) return { status: 'error', code: 'noapi', message: 'Máy chủ chưa có chức năng lấy ảnh 360 (bản chạy thử trên máy không có /api) — dùng "Tải từ máy".' };
  if (data.status === 'pick' && Array.isArray(data.candidates)) return { status: 'pick', candidates: data.candidates as PanoCandidate[] };
  if (res.ok && data.status === 'ok' && typeof data.panoUrl === 'string') {
    const meta = (data.meta ?? {}) as PanoMeta & { origWidth?: number; origHeight?: number };
    return {
      status: 'ok',
      info: {
        panoUrl: data.panoUrl,
        googleUrl: typeof data.googleUrl === 'string' ? data.googleUrl : null,
        storagePath: typeof data.storagePath === 'string' ? data.storagePath : '',
        width: num(data.width), height: num(data.height),
        sourceKind: (data.sourceKind as PanoSourceKind) ?? 'url',
        sourceUrl: typeof data.sourceUrl === 'string' ? data.sourceUrl : url,
        meta,
        metaRead: data.metaRead === 'failed' ? 'failed' : 'ok',
        pick: typeof data.pick === 'string' ? data.pick : undefined,
      },
    };
  }
  return { status: 'error', code: String(data.code ?? res.status), message: String(data.error ?? `Máy chủ báo lỗi ${res.status}`) };
}

/**
 * Đọc lại GPS / hướng từ file gốc trên Google (lần lấy ảnh đầu Google trả file gốc chậm quá).
 * null = vẫn chưa đọc được (chậm / lỗi mạng); meta rỗng lat/lng = file gốc thật sự không có GPS.
 */
export async function readPanoLinkMeta(url: string, pick?: string): Promise<PanoMeta | null> {
  const token = getStoredSessionToken();
  try {
    const res = await fetch('/api/pano-import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { 'x-letsgo-token': token } : {}) },
      body: JSON.stringify({ url, pick, metaOnly: true }),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || data.status !== 'meta' || data.metaRead !== 'ok') return null;
    return (data.meta ?? {}) as PanoMeta;
  } catch {
    return null;
  }
}

/** Cạnh ngang tối đa khi phải thu nhỏ trên máy (iPhone giới hạn khung vẽ ~16,7 triệu điểm ảnh → 5760 × 2880). */
const UPLOAD_RESIZE_W = 5760;

/** Ảnh 360 từ máy: đọc GPS / hướng, ảnh to thì thu nhỏ, rồi tải lên kho. */
export async function uploadPanoFile(file: File): Promise<PanoImageInfo> {
  if (!file.type.startsWith('image/')) throw new Error('Chỉ nhận file ảnh (JPG, PNG, WebP).');
  const head = new Uint8Array(await file.slice(0, 512 * 1024).arrayBuffer());
  const meta = readPanoMeta(head);
  let blob: Blob = file;
  let ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
  let width = meta.width ?? null, height = meta.height ?? null;
  if (!width || width > PANO_MAX_W || file.size > 20 * 1024 * 1024) {
    const img = await resizeImage(file, { max: UPLOAD_RESIZE_W, quality: 0.86 });
    blob = img.blob; ext = img.ext; width = img.width; height = img.height;
  }
  const type = blob.type || (ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg');
  const key = `pano/${new Date().toISOString().slice(0, 7)}/${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const base = { googleUrl: null, width, height, sourceKind: 'upload' as const, sourceUrl: file.name, meta };
  if ((await r2Status()).enabled) {
    try {
      const [url] = await r2PutFiles([{ key, blob, contentType: type }]);
      return { ...base, panoUrl: url, storagePath: `${R2_PATH_PREFIX}${key}` };
    } catch (e) {
      console.warn('Cloudflare R2 lỗi — lưu Supabase thay:', (e as Error).message);
    }
  }
  const bucket = supabase.storage.from('avatars');
  const { error } = await bucket.upload(key, blob, { upsert: false, contentType: type, cacheControl: '31536000' });
  if (error) throw new Error('Tải ảnh lên lỗi: ' + error.message);
  return { ...base, panoUrl: bucket.getPublicUrl(key).data.publicUrl, storagePath: key };
}

export interface NewPano {
  title: string;
  info: PanoImageInfo;
  lat: number;
  lng: number;
  heading: number | null;
  cameraHeight: number;
  userName: string;
  tripId?: string | null;
  zoneId?: string | null;
  zoneName?: string;
}

export async function createPanorama(p: NewPano): Promise<MapPanorama> {
  const m = p.info.meta;
  const cov = m.haov && m.vaov ? { haov: m.haov, vaov: m.vaov, voffset: m.voffset ?? 0 } : coverageFromSize(p.info.width ?? 0, p.info.height ?? 0);
  const taken = m.takenAt && !Number.isNaN(Date.parse(m.takenAt)) ? new Date(m.takenAt).toISOString() : null;
  const { data, error } = await supabase.from('map_panoramas').insert({
    title: p.title.trim(),
    source_kind: p.info.sourceKind,
    source_url: p.info.sourceUrl,
    pano_url: p.info.panoUrl,
    google_url: p.info.googleUrl,
    storage_path: p.info.storagePath,
    width: p.info.width,
    height: p.info.height,
    haov: cov.haov, vaov: cov.vaov, voffset: cov.voffset,
    lat: p.lat, lng: p.lng,
    heading: p.heading,
    camera_height: p.cameraHeight,
    annotations: [],
    taken_at: taken,
    trip_id: p.tripId ?? null,
    zone_id: p.zoneId ?? null,
    zone_name: p.zoneName ?? '',
    created_by: p.userName,
    updated_by: p.userName,
  }).select('*').single();
  if (error) {
    if (isMissingTableError(error)) throw new PanoMissingTable(PANO_MIGRATION_HINT);
    throw error;
  }
  return norm(data as Record<string, unknown>);
}

export type PanoPatch = Partial<Pick<MapPanorama, 'title' | 'note' | 'lat' | 'lng' | 'heading' | 'camera_height' | 'view' | 'annotations' | 'zone_id' | 'zone_name'>>;

export async function updatePanorama(id: string, patch: PanoPatch, userName: string): Promise<MapPanorama> {
  const { data, error } = await supabase.from('map_panoramas').update({ ...patch, updated_by: userName }).eq('id', id).select('*').single();
  if (error) throw error;
  return norm(data as Record<string, unknown>);
}

/** Xoá MỀM — dòng và file ảnh vẫn còn (khôi phục được ở Lịch sử dữ liệu). */
export async function archivePanorama(id: string, userName: string): Promise<void> {
  const { error } = await supabase.from('map_panoramas').update({ deleted_at: new Date().toISOString(), updated_by: userName }).eq('id', id);
  if (error) throw error;
}

/** Nguồn ảnh để trình xem thử lần lượt (R2 trước, link Google dự phòng). */
export function panoSources(p: Pick<MapPanorama, 'pano_url' | 'google_url'>): string[] {
  return [...new Set([p.pano_url, p.google_url].filter((u): u is string => !!u))];
}

/** Ảnh nhỏ cho danh sách / popup: chỉ link Google mới tự thu nhỏ được (ảnh R2 là bản to ~4 MB). */
export function panoThumb(p: Pick<MapPanorama, 'google_url'>, w = 480, h = 240): string | null {
  if (!p.google_url || !/googleusercontent\.com\//.test(p.google_url)) return null;
  return `${p.google_url.replace(/=[a-z][a-z0-9-]*$/i, '')}=w${w}-h${h}-c`;
}
