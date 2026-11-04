// Ảnh mặt bằng nhà xưởng của khách hàng (tab "Mặt bằng" trong hồ sơ khách) — bảng client_site_maps, migration 199.
// File ảnh: Cloudflare R2 (thư mục client-site/, storage_path "r2:…"); R2 chưa cài / lỗi → bucket avatars/client-site/ của
// Supabase như các ảnh khác. Khu vực vẽ lên ảnh lưu ở cột zones (xem siteZones.ts), ảnh gốc không bị sửa.
import { supabase } from '../supabase';
import { resizeImage } from '../imageResize';
import { r2PutFiles, r2Status, R2_PATH_PREFIX } from '../r2Upload';
import { sanitizeZones, type SiteZone } from './siteZones';

export interface ClientSiteMap {
  id: string;
  client_id: string;
  title: string;
  image_url: string;
  storage_path: string;
  width: number | null;
  height: number | null;
  zones: SiteZone[];
  sort_order: number;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
}

const COLS = 'id, client_id, title, image_url, storage_path, width, height, zones, sort_order, created_by, updated_by, created_at, updated_at';
const FALLBACK_BUCKET = 'avatars';
/** Mặt bằng cần đọc rõ chữ nhỏ trên ảnh → giữ to hơn ảnh thường (cạnh dài 2400px). */
const SITE_MAX_PX = 2400;

const norm = (r: Record<string, unknown>): ClientSiteMap => ({ ...(r as unknown as ClientSiteMap), zones: sanitizeZones(r.zones) });

export async function listSiteMaps(clientId: string): Promise<ClientSiteMap[]> {
  const { data, error } = await supabase.from('client_site_maps').select(COLS)
    .eq('client_id', clientId).is('deleted_at', null)
    .order('sort_order', { ascending: true }).order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(r => norm(r as Record<string, unknown>));
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
  }).select(COLS).single();
  if (error) throw error;
  return norm(data as Record<string, unknown>);
}

export type SiteMapPatch = Partial<Pick<ClientSiteMap, 'title' | 'zones' | 'image_url' | 'storage_path' | 'width' | 'height' | 'sort_order'>>;

export async function updateSiteMap(id: string, patch: SiteMapPatch, userName: string): Promise<ClientSiteMap> {
  const { data, error } = await supabase.from('client_site_maps')
    .update({ ...patch, updated_by: userName }).eq('id', id).select(COLS).single();
  if (error) throw error;
  return norm(data as Record<string, unknown>);
}

/** Xoá MỀM — dòng và file ảnh vẫn còn (khôi phục được bằng cỗ máy thời gian / đặt deleted_at = null). */
export async function archiveSiteMap(id: string, userName: string): Promise<void> {
  const { error } = await supabase.from('client_site_maps')
    .update({ deleted_at: new Date().toISOString(), updated_by: userName }).eq('id', id);
  if (error) throw error;
}
