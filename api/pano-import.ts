// Vercel Serverless Function (Edge) — lay ANH 360° tu link Google Photos / Google Drive / link anh truc tiep,
// doc thong tin trong anh (GPS, huong la ban GPano, goc phu), lay ban co toi da 6144 px roi chep ve Cloudflare R2.
// Trinh duyet khong tu lam duoc vi trang chia se Google Photos / Drive chan CORS.
//
// POST { url, pick? }  (header x-letsgo-token)
//   -> { status: 'ok', panoUrl, googleUrl, storagePath, width, height, bytes, sourceKind, meta }
//   -> { status: 'pick', candidates: [{ url, width, height, thumb }] }   (album nhieu anh — goi lai voi pick = url da chon)
//   Loi: { error, code } — code: 'badlink' | 'shortlink' | 'private' | 'notimage' | 'toobig' | 'fetch' | 'timeout'
//   ('shortlink' = link photos.app.goo.gl: tu 2025 Google mo bang JavaScript → nguoi dung mo trong trinh duyet, dan link dai)
//
// An toan: yeu cau dang nhap; link Google chi di theo chuyen huong trong ten mien Google; link ngoai kiem nhu
// api/r2-import.ts (https + ten mien, khong IP); chi nhan jpg / png / webp nhan dang bang byte dau; toi da 30 MB.
import { requireSession } from './_letsgoSession';
import { safeImageUrl, sniffImage } from '../src/lib/imageGuard';
import { presignUrl } from '../src/lib/r2Sign';
import { autoPick, classifyPanoLink, extractPhotoCandidates, googleImageBase, targetSize, PANO_MAX_W } from '../src/lib/pano/links';
import { imageSize, readPanoMeta, type PanoMeta } from '../src/lib/pano/imageMeta';

export const config = { runtime: 'edge' };

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const MAX_BYTES = 30 * 1024 * 1024;
const META_BYTES = 512 * 1024;
const PAGE_BYTES = 6 * 1024 * 1024;
/** Vercel Edge phai tra loi trong 25 giay. */
const DEADLINE_MS = 23_000;
const GOOGLE_HOST = /(^|\.)(google\.com|goo\.gl|googleusercontent\.com|ggpht\.com)$/i;
const IMG_ACCEPT = 'image/jpeg,image/png;q=0.9';

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

class Fail extends Error {
  constructor(public code: string, msg: string, public status = 400) { super(msg); }
}

const PRIVATE_PHOTOS = 'Không mở được ảnh từ link Google Photos (ảnh chưa chia sẻ công khai). Trong Google Photos bấm Chia sẻ → Tạo đường liên kết; '
  + 'hoặc tải ảnh lên Google Drive, đặt quyền "Bất kỳ ai có đường liên kết" rồi dán link Drive.';
const SHORT_PHOTOS = 'Link rút gọn photos.app.goo.gl phải mở trên trình duyệt trước: bấm "Mở link", đợi Google Photos hiện ảnh, '
  + 'copy địa chỉ trên thanh trình duyệt (dạng photos.google.com/share/…) rồi dán lại vào đây.';
const PRIVATE_DRIVE = 'Không mở được file Google Drive. Bấm chuột phải file → Chia sẻ → Quyền truy cập chung: "Bất kỳ ai có đường liên kết" → Sao chép đường liên kết rồi dán lại.';

async function readLimited(res: Response, max: number, cut = false): Promise<Uint8Array | null> {
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (!cut && declared > max) return null;
  if (!res.body) { const b = new Uint8Array(await res.arrayBuffer()); return b.byteLength > max ? (cut ? b.subarray(0, max) : null) : b; }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
    if (total >= max) {
      await reader.cancel().catch(() => {});
      if (!cut && total > max) return null;
      break;
    }
  }
  const out = new Uint8Array(Math.min(total, max));
  let off = 0;
  for (const c of chunks) {
    if (off >= out.length) break;
    const part = c.subarray(0, out.length - off);
    out.set(part, off);
    off += part.byteLength;
  }
  return out;
}

/** fetch theo chuyen huong bang tay: link Google chi duoc di tiep trong ten mien Google; link ngoai kiem safeImageUrl moi lan. */
async function fetchFollow(url: string, init: RequestInit, ms: number, googleOnly: boolean): Promise<{ res: Response; finalUrl: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Math.max(1000, ms));
  let current = url;
  try {
    for (let hop = 0; hop < 7; hop++) {
      const res = await fetch(current, { ...init, redirect: 'manual', signal: ctrl.signal });
      const loc = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && loc) {
        const next = new URL(loc, current);
        const ok = googleOnly ? next.protocol === 'https:' && GOOGLE_HOST.test(next.hostname) : !!safeImageUrl(next.toString());
        if (!ok) throw new Fail('fetch', 'Link chuyển hướng tới nơi không cho phép');
        current = next.toString();
        continue;
      }
      // Giu timer den khi doc xong body: tra ve kem ham huy
      return { res, finalUrl: current };
    }
    throw new Fail('fetch', 'Link chuyển hướng quá nhiều lần');
  } catch (e) {
    clearTimeout(timer);
    if (e instanceof Fail) throw e;
    throw new Fail(ctrl.signal.aborted ? 'timeout' : 'fetch', ctrl.signal.aborted ? 'Google phản hồi quá chậm — thử lại sau ít phút' : 'Không kết nối được tới nguồn ảnh', 502);
  }
}

/** Doc ~512 KB dau file goc de lay GPS / huong / co anh (khong tai ca file). Loi thi tra rong. */
async function readHeadMeta(url: string, ms: number): Promise<{ meta: PanoMeta; isImage: boolean }> {
  try {
    const { res } = await fetchFollow(url, { headers: { 'User-Agent': UA, Range: `bytes=0-${META_BYTES - 1}` } }, ms, true);
    if (!res.ok && res.status !== 206) return { meta: {}, isImage: false };
    const head = await readLimited(res, META_BYTES, true);
    if (!head || !sniffImage(head)) return { meta: {}, isImage: false };
    return { meta: readPanoMeta(head), isImage: true };
  } catch {
    return { meta: {}, isImage: false };
  }
}

async function downloadImage(urls: string[], ms: number, googleOnly: boolean): Promise<{ bytes: Uint8Array; finalUrl: string; tried: number[] }> {
  const tried: number[] = [];
  const started = Date.now();
  for (const u of urls) {
    const left = ms - (Date.now() - started);
    if (left < 1500) break;
    let got: { res: Response; finalUrl: string };
    try {
      got = await fetchFollow(u, { headers: { 'User-Agent': UA, Accept: IMG_ACCEPT } }, left, googleOnly);
    } catch (e) {
      if (e instanceof Fail && e.code === 'timeout') throw e;
      tried.push(0);
      continue;
    }
    tried.push(got.res.status);
    if (!got.res.ok) { await got.res.body?.cancel().catch(() => {}); continue; }
    let bytes: Uint8Array | null;
    try { bytes = await readLimited(got.res, MAX_BYTES); } catch { throw new Fail('timeout', 'Tải ảnh quá lâu — thử lại, hoặc dùng ảnh nhỏ hơn', 504); }
    if (!bytes) throw new Fail('toobig', 'Ảnh lớn hơn 30 MB — hãy xuất ảnh nhỏ hơn (cạnh dài ≤ 8000 px) rồi thử lại', 413);
    if (!sniffImage(bytes)) continue;
    return { bytes, finalUrl: got.finalUrl, tried };
  }
  return { bytes: new Uint8Array(), finalUrl: '', tried };
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const denied = await requireSession(req);
  if (denied) return denied;

  let body: { url?: unknown; pick?: unknown } = {};
  try { body = (await req.json()) as typeof body; } catch { return json({ error: 'Body khong hop le' }, 400); }
  const link = classifyPanoLink(String(body.url ?? ''));
  if (!link) return json({ error: 'Chưa nhận ra link — dán link chia sẻ Google Photos, Google Drive hoặc link ảnh (https://…)', code: 'badlink' }, 400);
  const pick = typeof body.pick === 'string' ? body.pick : '';
  const started = Date.now();
  const left = () => DEADLINE_MS - (Date.now() - started);

  try {
    let imageUrls: string[] = [];
    let googleOnly = true;
    let meta: PanoMeta = {};
    let orig: { w: number; h: number } | null = null;
    let privateHint = PRIVATE_PHOTOS;

    if (link.kind === 'gphotos') {
      const { res, finalUrl } = await fetchFollow(link.url, { headers: { 'User-Agent': UA, 'Accept-Language': 'vi,en;q=0.8' } }, Math.min(9000, left()), true);
      if (/accounts\.google\.com/.test(new URL(finalUrl).hostname) || !res.ok) throw new Fail('private', PRIVATE_PHOTOS, 403);
      const page = await readLimited(res, PAGE_BYTES, true).catch(() => null);
      if (!page) throw new Fail('timeout', 'Trang Google Photos tải quá lâu — thử lại sau ít phút', 504);
      const html = new TextDecoder().decode(page);
      const cands = extractPhotoCandidates(html);
      // Link rút gọn photos.app.goo.gl (từ 2025) mở bằng JavaScript trong trình duyệt, máy chủ không tự theo được
      if (!cands.length && /(^|\.)goo\.gl$/i.test(new URL(finalUrl).hostname)) throw new Fail('shortlink', SHORT_PHOTOS, 422);
      if (!cands.length) throw new Fail('private', PRIVATE_PHOTOS, 404);
      const chosen = pick ? cands.find(c => c.url === pick) ?? null : autoPick(cands);
      if (!chosen) {
        return json({
          status: 'pick',
          candidates: cands.slice(0, 60).map(c => ({ url: c.url, width: c.width, height: c.height, thumb: `${c.url}=w480-h240-c` })),
        });
      }
      orig = { w: chosen.width, h: chosen.height };
      ({ meta } = await readHeadMeta(`${chosen.url}=d`, Math.min(6000, left() - 9000)));
      const t = targetSize(orig.w, orig.h);
      imageUrls = [`${chosen.url}=w${t.w}-h${t.h}`];
    } else if (link.kind === 'gimage') {
      const base = googleImageBase(link.url);
      ({ meta } = await readHeadMeta(`${base}=d`, Math.min(6000, left() - 9000)));
      if (meta.width && meta.height) orig = { w: meta.width, h: meta.height };
      const t = targetSize(orig?.w ?? 0, orig?.h ?? 0);
      imageUrls = [`${base}=w${t.w}-h${t.h}`, link.url];
    } else if (link.kind === 'gdrive') {
      privateHint = PRIVATE_DRIVE;
      const id = link.driveId!;
      ({ meta } = await readHeadMeta(`https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`, Math.min(6000, left() - 9000)));
      if (meta.width && meta.height) orig = { w: meta.width, h: meta.height };
      const w = orig ? targetSize(orig.w, orig.h).w : PANO_MAX_W;
      imageUrls = [
        `https://lh3.googleusercontent.com/d/${id}=w${w}`,
        `https://drive.google.com/thumbnail?id=${id}&sz=w${w}`,
      ];
      // Anh nho san (≤ 6144 px) → lay ca ban goc neu 2 cach tren khong duoc
      if (orig && orig.w <= PANO_MAX_W) imageUrls.push(`https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`);
    } else {
      const safe = safeImageUrl(link.url);
      if (!safe) throw new Fail('badlink', 'Link không hợp lệ (chỉ nhận https, có tên miền)');
      imageUrls = [safe.toString()];
      googleOnly = false;
      privateHint = 'Link không trả về ảnh (jpg / png / webp) — kiểm tra lại link hoặc tải ảnh từ máy lên.';
    }

    const dl = await downloadImage(imageUrls, left() - 4000, googleOnly);
    if (!dl.bytes.length) {
      const denied = dl.tried.some(s => s === 401 || s === 403 || s === 404);
      throw new Fail(denied || link.kind !== 'url' ? 'private' : 'notimage', privateHint, 403);
    }
    const kind = sniffImage(dl.bytes)!;
    if (link.kind === 'url') meta = readPanoMeta(dl.bytes.subarray(0, META_BYTES));
    const size = imageSize(dl.bytes) ?? { width: meta.width ?? 0, height: meta.height ?? 0 };
    const finalHost = (() => { try { return new URL(dl.finalUrl).hostname; } catch { return ''; } })();
    // Link Google dung truc tiep duoc trong trinh xem (lh3 cho phep CORS) → giu lam du phong
    const googleUrl = /googleusercontent\.com$/i.test(finalHost) ? dl.finalUrl : null;

    // ── Chep ve Cloudflare R2 ──
    const accountId = process.env.R2_ACCOUNT_ID || '', accessKeyId = process.env.R2_ACCESS_KEY_ID || '', secretAccessKey = process.env.R2_SECRET_ACCESS_KEY || '';
    const bucket = process.env.R2_BUCKET || '', publicUrl = (process.env.R2_PUBLIC_URL || '').replace(/\/+$/, '');
    let panoUrl = googleUrl ?? dl.finalUrl;
    let storagePath = '';
    if (accountId && accessKeyId && secretAccessKey && bucket && /^https:\/\//.test(publicUrl)) {
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', dl.bytes))].slice(0, 12).map(b => b.toString(16).padStart(2, '0')).join('');
      const key = `pano/${new Date().toISOString().slice(0, 7)}/${hash}.${kind.ext}`;
      const host = `${accountId}.r2.cloudflarestorage.com`;
      let stored = false;
      try {
        const head = await fetch(await presignUrl({ method: 'HEAD', host, path: `/${bucket}/${key}`, accessKeyId, secretAccessKey, region: 'auto', expires: 120, now: new Date() }), { method: 'HEAD' });
        stored = head.ok;
      } catch { /* khong kiem duoc → cu ghi */ }
      if (!stored) {
        try {
          const uploadUrl = await presignUrl({ method: 'PUT', host, path: `/${bucket}/${key}`, accessKeyId, secretAccessKey, region: 'auto', expires: 300, now: new Date() });
          const put = await fetch(uploadUrl, { method: 'PUT', body: dl.bytes, headers: { 'Content-Type': kind.mime, 'Cache-Control': 'public, max-age=31536000, immutable' } });
          stored = put.ok || put.status === 409 || put.status === 412;
        } catch { stored = false; }
      }
      if (stored) { panoUrl = `${publicUrl}/${key}`; storagePath = `r2:${key}`; }
    }

    return json({
      status: 'ok',
      panoUrl,
      googleUrl,
      storagePath,
      width: size.width || null,
      height: size.height || null,
      bytes: dl.bytes.byteLength,
      sourceKind: link.kind,
      sourceUrl: link.url,
      meta: {
        lat: meta.lat, lng: meta.lng, heading: meta.heading, haov: meta.haov, vaov: meta.vaov, voffset: meta.voffset,
        takenAt: meta.takenAt, isPano: meta.isPano,
        origWidth: orig?.w ?? meta.width, origHeight: orig?.h ?? meta.height,
      },
    });
  } catch (e) {
    if (e instanceof Fail) return json({ error: e.message, code: e.code }, e.status);
    return json({ error: 'Lỗi không xác định khi lấy ảnh: ' + String((e as Error)?.message ?? e), code: 'fetch' }, 500);
  }
}
