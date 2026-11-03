// Tự đổi link ảnh NGOÀI (Facebook, website…) thành ảnh lưu trong kho Cloudflare R2 của app mỗi khi lưu dữ liệu.
//
// Cách làm: client Supabase dùng `mirroringFetch` làm hàm gửi request. Mọi lệnh ghi (POST / PATCH / PUT) lên /rest/v1/<bảng>
// có chứa các cột ảnh (image_url, cover_image_url, recruit_image_urls, avatar_url, manager_avatar_url) mà giá trị là link
// ngoài → nhờ /api/r2-import tải ảnh về lưu R2 rồi thay bằng link R2 NGAY trước khi gửi. Nhờ vậy mọi màn hình (hiện có và
// sau này) đều được phủ mà không phải sửa từng chỗ.
//
// An toàn: bất kỳ lỗi nào (chưa cài R2, nguồn chặn, link hết hạn, mạng chậm) → GIỮ NGUYÊN link gốc, việc lưu dữ liệu
// vẫn diễn ra bình thường, không bao giờ làm hỏng thao tác của người dùng.
import { getStoredSessionToken } from './sessionToken';
import { r2Status } from './r2Upload';

/** Cột chứa link ảnh (chuỗi) hoặc danh sách link ảnh (mảng chuỗi). */
export const IMAGE_COLUMNS = ['image_url', 'cover_image_url', 'recruit_image_urls', 'avatar_url', 'manager_avatar_url'] as const;

/** Mỗi ảnh chờ tối đa bấy nhiêu giây (máy chủ tự giới hạn 15 giây). */
const PER_IMAGE_MS = 25_000;
const MAX_IMAGES_PER_REQUEST = 12;

const cache = new Map<string, Promise<string>>();
let paused = 0;

/** Chạy `fn` mà KHÔNG tự đổi link ảnh (dùng khi hoàn tác: ghi lại link gốc thì phải giữ nguyên link gốc). */
export async function withoutMirroring<T>(fn: () => Promise<T>): Promise<T> {
  paused += 1;
  try { return await fn(); } finally { paused -= 1; }
}
export const mirrorEvents = new EventTarget();

/** Link thuộc kho của app (Supabase Storage hoặc R2) → không cần tải lại. */
export function isOwnHosted(url: string, r2Public: string | null): boolean {
  if (/\/storage\/v1\/object\/public\//.test(url)) return true;
  return !!r2Public && url.startsWith(`${r2Public}/`);
}

export const isExternalImageUrl = (v: unknown): v is string => typeof v === 'string' && /^https:\/\/[^\s]+$/i.test(v.trim());

/** Tải 1 link ngoài về R2. Trả link R2, hoặc link gốc khi lỗi. Cùng 1 link chỉ tải 1 lần mỗi phiên. */
export function mirrorImageUrl(url: string): Promise<string> {
  const key = url.trim();
  const hit = cache.get(key);
  if (hit) return hit;
  const p = (async () => {
    const st = await r2Status();
    if (!st.enabled || isOwnHosted(key, st.publicUrl)) return url;
    const token = getStoredSessionToken();
    if (!token) return url;
    try {
      // Dùng fetch gốc của trình duyệt (không qua bộ chặn của Supabase)
      const res = await fetch('/api/r2-import', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-letsgo-token': token }, body: JSON.stringify({ url: key }),
        signal: AbortSignal.timeout(PER_IMAGE_MS),
      });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (res.ok && typeof data.url === 'string') {
        mirrorEvents.dispatchEvent(new CustomEvent('done', { detail: { from: key, to: data.url } }));
        return data.url;
      }
      mirrorEvents.dispatchEvent(new CustomEvent('fail', { detail: { from: key, error: data.error ?? `lỗi ${res.status}` } }));
    } catch (e) {
      mirrorEvents.dispatchEvent(new CustomEvent('fail', { detail: { from: key, error: (e as Error).message } }));
    }
    return url;
  })();
  cache.set(key, p);
  // Lỗi thì cho thử lại ở lần lưu sau (mạng yếu, nguồn tạm chặn…)
  void p.then(out => { if (out === url) cache.delete(key); });
  return p;
}

/** Đổi link ngoài trong 1 dòng dữ liệu (object). Trả dòng mới + số ảnh đã đổi. Không sửa dòng gốc. */
export async function mirrorRow<T extends Record<string, unknown>>(row: T, budget = { left: MAX_IMAGES_PER_REQUEST }): Promise<{ row: T; changed: number }> {
  let changed = 0;
  const out: Record<string, unknown> = { ...row };
  for (const col of IMAGE_COLUMNS) {
    const v = out[col];
    if (typeof v === 'string' && isExternalImageUrl(v) && budget.left > 0) {
      budget.left -= 1;
      const to = await mirrorImageUrl(v);
      if (to !== v) { out[col] = to; changed += 1; }
    } else if (Array.isArray(v) && v.some(isExternalImageUrl)) {
      const next: unknown[] = [];
      for (const item of v) {
        if (isExternalImageUrl(item) && budget.left > 0) {
          budget.left -= 1;
          const to = await mirrorImageUrl(item);
          if (to !== item) changed += 1;
          next.push(to);
        } else next.push(item);
      }
      out[col] = next;
    }
  }
  return { row: out as T, changed };
}

const hasImageColumn = (o: unknown): boolean => !!o && typeof o === 'object' && !Array.isArray(o) && IMAGE_COLUMNS.some(c => c in (o as object));

/**
 * Hàm gửi request cho client Supabase: nếu là lệnh ghi có cột ảnh với link ngoài thì đổi link rồi mới gửi.
 * Chỉ động vào body JSON dạng chuỗi của /rest/v1/<bảng> (bỏ qua rpc, storage, auth, đọc dữ liệu).
 */
export async function mirroringFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  try {
    const method = (init?.method ?? (typeof input !== 'string' && !(input instanceof URL) ? input.method : 'GET')).toUpperCase();
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!paused && (method === 'POST' || method === 'PATCH' || method === 'PUT') && /\/rest\/v1\/(?!rpc\/)[a-z0-9_]+/i.test(url) && typeof init?.body === 'string' && init.body.includes('http')) {
      const parsed = JSON.parse(init.body) as unknown;
      const list = Array.isArray(parsed) ? parsed : [parsed];
      if (list.some(hasImageColumn)) {
        const budget = { left: MAX_IMAGES_PER_REQUEST };
        let changed = 0;
        const rows: unknown[] = [];
        for (const r of list) {
          if (hasImageColumn(r)) { const m = await mirrorRow(r as Record<string, unknown>, budget); rows.push(m.row); changed += m.changed; }
          else rows.push(r);
        }
        if (changed > 0) init = { ...init, body: JSON.stringify(Array.isArray(parsed) ? rows : rows[0]) };
      }
    }
  } catch { /* bất kỳ lỗi nào → gửi nguyên bản như cũ */ }
  return fetch(input, init);
}
