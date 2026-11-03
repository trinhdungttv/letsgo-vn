// Tải file lên Cloudflare R2 (khi đã cài trên máy chủ — xem docs/HUONG_DAN_CLOUDFLARE_R2.md): xin link đã ký từ
// /api/r2-upload rồi PUT thẳng file từ điện thoại lên R2 (không đi qua máy chủ của app). Chưa cài / lỗi → người gọi
// tự lưu Supabase như cũ, nên không bao giờ mất ảnh vì R2.
import { getStoredSessionToken } from './sessionToken';

export interface R2Status { enabled: boolean; publicUrl: string | null }

let status: Promise<R2Status> | null = null;

/** Máy chủ đã cài R2 chưa (hỏi 1 lần mỗi lần mở app; chạy thử trên máy — không có /api — thì coi như chưa cài). */
export function r2Status(): Promise<R2Status> {
  if (!status) {
    status = fetch('/api/r2-upload')
      .then(async r => (r.ok && (r.headers.get('content-type') ?? '').includes('json') ? ((await r.json()) as R2Status) : { enabled: false, publicUrl: null }))
      .catch(() => ({ enabled: false, publicUrl: null }));
  }
  return status;
}

export interface R2File { key: string; blob: Blob; contentType: string }

/** Tải các file lên R2, trả link công khai theo đúng thứ tự. Lỗi bất kỳ → ném lỗi (người gọi lưu Supabase thay). */
export async function r2PutFiles(files: readonly R2File[]): Promise<string[]> {
  const token = getStoredSessionToken();
  const res = await fetch('/api/r2-upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { 'x-letsgo-token': token } : {}) },
    body: JSON.stringify({ files: files.map(f => ({ key: f.key, contentType: f.contentType })) }),
  });
  const data = (await res.json().catch(() => ({}))) as { uploads?: { key: string; uploadUrl: string; publicUrl: string }[]; error?: string };
  if (!res.ok || !data.uploads?.length) throw new Error(data.error ?? `Cloudflare R2 lỗi ${res.status}`);
  await Promise.all(data.uploads.map(async (u, i) => {
    const put = await fetch(u.uploadUrl, {
      method: 'PUT', body: files[i].blob,
      // Ảnh không bao giờ sửa (tên file theo mã riêng) → cho trình duyệt / CDN giữ lâu
      headers: { 'Content-Type': files[i].contentType, 'Cache-Control': 'public, max-age=31536000, immutable' },
    });
    if (!put.ok) throw new Error(`Tải lên Cloudflare R2 lỗi ${put.status}`);
  }));
  return data.uploads.map(u => u.publicUrl);
}

/** storage_path của file nằm trên R2 có tiền tố này (file cũ trên Supabase thì không) — để sau này biết file ở đâu. */
export const R2_PATH_PREFIX = 'r2:';
