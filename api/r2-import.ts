// Vercel Serverless Function (Edge) — tai anh tu LINK NGOAI (Facebook, website...) ve luu thang vao Cloudflare R2 cua app.
// Dung de link anh khong bi hong khi nguon het han / go anh, va de anh nam trong kho cua Tony.
//
// POST { url }  (header x-letsgo-token) -> { url: <link R2>, bytes, contentType, reused }
//   Loi: { error, code } — code: 'disabled' | 'blocked' | 'fetch' | 'notimage' | 'toobig' | 'r2'
//
// An toan: yeu cau dang nhap; chi https + ten mien (khong IP / mang noi bo), toi da 3 lan chuyen huong (kiem lai moi lan);
// chi nhan jpg / png / webp / gif nhan dang bang byte dau (khong nhan svg); toi da 8 MB; 15 giay.
// File luu theo ma bam noi dung (mirror/YYYY-MM/<hash>.<ext>) -> cung 1 anh nhap nhieu lan chi luu 1 ban.
import { requireSession } from './_letsgoSession';
import { MAX_IMPORT_BYTES, safeImageUrl, sniffImage } from '../src/lib/imageGuard';
import { presignUrl } from '../src/lib/r2Sign';

export const config = { runtime: 'edge' };

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

async function readLimited(res: Response, max: number): Promise<Uint8Array | null> {
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > max) return null;
  if (!res.body) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) { await reader.cancel().catch(() => {}); return null; }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.byteLength; }
  return out;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const denied = await requireSession(req);
  if (denied) return denied;

  const accountId = process.env.R2_ACCOUNT_ID || '', accessKeyId = process.env.R2_ACCESS_KEY_ID || '', secretAccessKey = process.env.R2_SECRET_ACCESS_KEY || '';
  const bucket = process.env.R2_BUCKET || '', publicUrl = (process.env.R2_PUBLIC_URL || '').replace(/\/+$/, '');
  if (!(accountId && accessKeyId && secretAccessKey && bucket && /^https:\/\//.test(publicUrl))) return json({ error: 'Chưa cài Cloudflare R2', code: 'disabled' }, 501);

  let raw = '';
  try { raw = String(((await req.json()) as { url?: unknown }).url ?? ''); } catch { return json({ error: 'Body khong hop le' }, 400); }
  let target = safeImageUrl(raw);
  if (!target) return json({ error: 'Link không hợp lệ (chỉ nhận https, có tên miền)', code: 'blocked' }, 400);
  // Link của chính kho này → không cần tải lại
  if (raw.startsWith(`${publicUrl}/`)) return json({ url: raw, bytes: 0, contentType: '', reused: true }, 200);

  let res: Response | null = null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    for (let hop = 0; hop < 4; hop++) {
      res = await fetch(target.toString(), { redirect: 'manual', signal: ctrl.signal, headers: { 'User-Agent': UA, Accept: 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8' } });
      const loc = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && loc) {
        const next = safeImageUrl(new URL(loc, target).toString());
        if (!next) return json({ error: 'Link chuyển hướng tới nơi không cho phép', code: 'blocked' }, 400);
        target = next;
        continue;
      }
      break;
    }
  } catch {
    clearTimeout(timer);
    return json({ error: 'Không tải được ảnh từ link (quá thời gian hoặc nguồn chặn)', code: 'fetch' }, 502);
  }
  clearTimeout(timer);
  if (!res || !res.ok) return json({ error: `Nguồn ảnh trả lỗi ${res?.status ?? 'không rõ'} (link có thể đã hết hạn hoặc chặn tải)`, code: 'fetch' }, 502);

  const bytes = await readLimited(res, MAX_IMPORT_BYTES).catch(() => null);
  if (!bytes) return json({ error: 'Ảnh lớn hơn 8 MB', code: 'toobig' }, 413);
  const kind = sniffImage(bytes);
  if (!kind) return json({ error: 'Link không phải ảnh (jpg / png / webp / gif)', code: 'notimage' }, 415);

  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].slice(0, 12).map(b => b.toString(16).padStart(2, '0')).join('');
  const key = `mirror/${new Date().toISOString().slice(0, 7)}/${hash}.${kind.ext}`;
  const host = `${accountId}.r2.cloudflarestorage.com`;
  // Ảnh cùng nội dung đã có trong kho (bucket bật khoá không cho ghi đè) → dùng luôn bản đó
  try {
    const head = await fetch(await presignUrl({ method: 'HEAD', host, path: `/${bucket}/${key}`, accessKeyId, secretAccessKey, region: 'auto', expires: 120, now: new Date() }), { method: 'HEAD' });
    if (head.ok) return json({ url: `${publicUrl}/${key}`, bytes: bytes.byteLength, contentType: kind.mime, reused: true }, 200);
  } catch { /* không kiểm tra được → cứ thử ghi */ }
  const uploadUrl = await presignUrl({ method: 'PUT', host, path: `/${bucket}/${key}`, accessKeyId, secretAccessKey, region: 'auto', expires: 300, now: new Date() });
  try {
    const put = await fetch(uploadUrl, { method: 'PUT', body: bytes, headers: { 'Content-Type': kind.mime, 'Cache-Control': 'public, max-age=31536000, immutable' } });
    // 409/412 = file cùng nội dung đã có (khoá bucket không cho ghi đè) → coi như xong
    if (!put.ok && put.status !== 409 && put.status !== 412) return json({ error: `Lưu vào Cloudflare lỗi ${put.status}`, code: 'r2' }, 502);
  } catch {
    return json({ error: 'Không kết nối được Cloudflare R2', code: 'r2' }, 502);
  }
  return json({ url: `${publicUrl}/${key}`, bytes: bytes.byteLength, contentType: kind.mime, reused: false }, 200);
}
