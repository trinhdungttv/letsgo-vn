// Pháp lý — tải ảnh (logo pháp nhân, ảnh trong bài học) lên kho: Cloudflare R2 thư mục legal/ trước,
// R2 chưa cài / lỗi → bucket avatars/legal/ của Supabase (giống ảnh mặt bằng khách hàng).
import { supabase } from '../supabase';
import { resizeImage } from '../imageResize';
import { r2PutFiles, r2Status } from '../r2Upload';

const FALLBACK_BUCKET = 'avatars';

export async function uploadLegalImage(file: File, maxPx = 1800): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Chỉ nhận file ảnh');
  const img = await resizeImage(file, { max: maxPx, quality: 0.86 });
  const month = new Date().toISOString().slice(0, 7);
  const key = `legal/${month}/${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}.${img.ext}`;
  if ((await r2Status()).enabled) {
    try {
      const [url] = await r2PutFiles([{ key, blob: img.blob, contentType: img.blob.type || 'image/jpeg' }]);
      return url;
    } catch (e) {
      console.warn('Cloudflare R2 lỗi — lưu Supabase thay:', (e as Error).message);
    }
  }
  const bucket = supabase.storage.from(FALLBACK_BUCKET);
  const { error } = await bucket.upload(key, img.blob, { upsert: false, contentType: img.blob.type, cacheControl: '31536000' });
  if (error) throw new Error('Tải ảnh lên lỗi: ' + error.message);
  return bucket.getPublicUrl(key).data.publicUrl;
}
