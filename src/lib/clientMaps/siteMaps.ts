// Mặt bằng nhà xưởng của khách hàng (tab "Mặt bằng" trong hồ sơ khách) — bảng client_site_maps.
// Có 2 loại (cột kind, migration 202):
//   'image' (migration 199): ảnh tải lên. File ảnh: Cloudflare R2 (thư mục client-site/, storage_path "r2:…"); R2 chưa cài / lỗi →
//           bucket avatars/client-site/ của Supabase. Khu vực vẽ lên ảnh lưu ở cột zones (siteZones.ts), ảnh gốc không bị sửa.
//   'map'   (migration 202): bản đồ vệ tinh — khối nhà theo toạ độ thật ở cột geo (siteGeo.ts), không có file ảnh.
// Chưa chạy 202 → đọc bằng bộ cột cũ (mọi dòng là 'image'), nút Bản đồ vệ tinh báo cần chạy 202.
import { supabase } from '../supabase';
import { resizeImage } from '../imageResize';
import { r2PutFiles, r2Status, R2_PATH_PREFIX } from '../r2Upload';
import { sanitizeZones, type SiteZone } from './siteZones';
import { sanitizeGeo, type SiteGeo } from './siteGeo';

export type SiteMapKind = 'image' | 'map';

export interface ClientSiteMap {
  id: string;
  client_id: string;
  kind: SiteMapKind;
  title: string;
  image_url: string;
  storage_path: string;
  width: number | null;
  height: number | null;
  zones: SiteZone[];
  /** Chỉ có khi kind = 'map'. */
  geo: SiteGeo | null;
  sort_order: number;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
}

export const SITE_GEO_MIGRATION_HINT = 'Cần chạy migration 202 (Bản đồ vệ tinh cho Mặt bằng) trong Supabase → SQL Editor';

const BASE_COLS = 'id, client_id, title, image_url, storage_path, width, height, zones, sort_order, created_by, updated_by, created_at, updated_at';
const GEO_COLS = `${BASE_COLS}, kind, geo`;
const FALLBACK_BUCKET = 'avatars';
/** Mặt bằng cần đọc rõ chữ nhỏ trên ảnh → giữ to hơn ảnh thường (cạnh dài 2400px). */
const SITE_MAX_PX = 2400;

/** Lần đọc gần nhất thấy DB đã có cột kind / geo chưa (quyết định bộ cột khi ghi). */
let geoColumns = true;

const cols = () => (geoColumns ? GEO_COLS : BASE_COLS);
const isMissingColumn = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === '42703' || e.code === 'PGRST204' || /\b(kind|geo)\b.*(does not exist|schema cache)|could not find the '(kind|geo)' column/i.test(e.message ?? ''));

const norm = (r: Record<string, unknown>): ClientSiteMap => {
  const kind: SiteMapKind = r.kind === 'map' ? 'map' : 'image';
  return { ...(r as unknown as ClientSiteMap), kind, zones: sanitizeZones(r.zones), geo: kind === 'map' ? sanitizeGeo(r.geo) : null };
};

export async function listSiteMaps(clientId: string): Promise<{ maps: ClientSiteMap[]; geoReady: boolean }> {
  const run = (c: string) => supabase.from('client_site_maps').select(c)
    .eq('client_id', clientId).is('deleted_at', null)
    .order('sort_order', { ascending: true }).order('created_at', { ascending: true });
  let res = await run(GEO_COLS);
  geoColumns = true;
  if (res.error && isMissingColumn(res.error)) {
    geoColumns = false;
    res = await run(BASE_COLS);
  }
  if (res.error) throw res.error;
  return { maps: ((res.data ?? []) as unknown as Record<string, unknown>[]).map(norm), geoReady: geoColumns };
}

export interface StoredImage { url: string; storagePath: string; width: number; height: number }

/** Nén + tải 1 ảnh mặt bằng lên kho (R2 trước, lỗi thì Supabase). */
export async function uploadSiteImage(clientId: string, file: File): Promise<StoredImage> {
  const img = await resizeImage(file, { max: SITE_MAX_PX, quality: 0.86 });
  const name = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}.${img.ext}`;
  const key = `client-site/${clientId}/${name}`;
  if ((await r2Status()).enabled) {
    try {
      const [url] = await r2PutFiles([{ key, blob: img.blob, contentType: img.blob.type || 'image/jpeg' }]);
      return { url, storagePath: `${R2_PATH_PREFIX}${key}`, width: img.width, height: img.height };
    } catch (e) {
      console.warn('Cloudflare R2 lỗi — lưu Supabase thay:', (e as Error).message);
    }
  }
  const bucket = supabase.storage.from(FALLBACK_BUCKET);
  const { error } = await bucket.upload(key, img.blob, { upsert: false, contentType: img.blob.type, cacheControl: '31536000' });
  if (error) throw new Error('Tải ảnh lên lỗi: ' + error.message);
  return { url: bucket.getPublicUrl(key).data.publicUrl, storagePath: key, width: img.width, height: img.height };
}

export async function createSiteMap(input: { clientId: string; title: string; image: StoredImage; sortOrder: number; userName: string }): Promise<ClientSiteMap> {
  const { data, error } = await supabase.from('client_site_maps').insert({
    client_id: input.clientId,
    title: input.title,
    image_url: input.image.url,
    storage_path: input.image.storagePath,
    width: input.image.width,
    height: input.image.height,
    zones: [],
    sort_order: input.sortOrder,
    created_by: input.userName,
    updated_by: input.userName,
  }).select(cols()).single();
  if (error) throw error;
  return norm(data as unknown as Record<string, unknown>);
}

/** Tạo bản đồ vệ tinh (kind = 'map'). Chưa chạy migration 202 → ném lỗi có gợi ý chạy 202. */
export async function createGeoMap(input: { clientId: string; title: string; geo: SiteGeo; sortOrder: number; userName: string }): Promise<ClientSiteMap> {
  const { data, error } = await supabase.from('client_site_maps').insert({
    client_id: input.clientId,
    kind: 'map',
    title: input.title,
    image_url: '',
    storage_path: '',
    zones: [],
    geo: input.geo,
    sort_order: input.sortOrder,
    created_by: input.userName,
    updated_by: input.userName,
  }).select(GEO_COLS).single();
  if (error) {
    if (isMissingColumn(error)) throw new Error(SITE_GEO_MIGRATION_HINT);
    throw error;
  }
  geoColumns = true;
  return norm(data as unknown as Record<string, unknown>);
}

export type SiteMapPatch = Partial<Pick<ClientSiteMap, 'title' | 'zones' | 'geo' | 'image_url' | 'storage_path' | 'width' | 'height' | 'sort_order'>>;

export async function updateSiteMap(id: string, patch: SiteMapPatch, userName: string): Promise<ClientSiteMap> {
  const { data, error } = await supabase.from('client_site_maps')
    .update({ ...patch, updated_by: userName }).eq('id', id).select(cols()).single();
  if (error) throw error;
  return norm(data as unknown as Record<string, unknown>);
}

/** Xoá MỀM — dòng và file ảnh vẫn còn (khôi phục được bằng cỗ máy thời gian / đặt deleted_at = null). */
export async function archiveSiteMap(id: string, userName: string): Promise<void> {
  const { error } = await supabase.from('client_site_maps')
    .update({ deleted_at: new Date().toISOString(), updated_by: userName }).eq('id', id);
  if (error) throw error;
}
