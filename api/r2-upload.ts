// Vercel Serverless Function (Edge) — cap link tai file thang len Cloudflare R2 cho anh / ghi am Khao sat KCN.
// Khoa bi mat chi nam o day (bien moi truong Vercel); dien thoai nhan link da ky, han 10 phut, PUT dung 1 file.
//
// GET                                   -> { enabled, publicUrl }   (da cai du 5 bien R2_* chua)
// POST { files: [{ key, contentType }] }  (header x-letsgo-token, toi da 4 file / lan)
//   -> { uploads: [{ key, uploadUrl, publicUrl }] }
//
// Bien moi truong (Vercel -> Settings -> Environment Variables), xem docs/HUONG_DAN_CLOUDFLARE_R2.md:
//   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_URL (VD https://anh.letsgo.vn)
// Chua cai du -> enabled:false, app tu luu Supabase nhu cu.
import { requireSession } from './_letsgoSession';
import { presignUrl, validR2Key } from '../src/lib/r2Sign';

export const config = { runtime: 'edge' };

function env() {
  const accountId = process.env.R2_ACCOUNT_ID || '';
  const accessKeyId = process.env.R2_ACCESS_KEY_ID || '';
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY || '';
  const bucket = process.env.R2_BUCKET || '';
  const publicUrl = (process.env.R2_PUBLIC_URL || '').replace(/\/+$/, '');
  const ok = !!(accountId && accessKeyId && secretAccessKey && bucket && /^https:\/\//.test(publicUrl));
  return { ok, accountId, accessKeyId, secretAccessKey, bucket, publicUrl };
}

export default async function handler(req: Request): Promise<Response> {
  const e = env();
  if (req.method === 'GET') return json({ enabled: e.ok, publicUrl: e.ok ? e.publicUrl : null }, 200);
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const denied = await requireSession(req);
  if (denied) return denied;
  if (!e.ok) return json({ error: 'Chưa cài Cloudflare R2 trên máy chủ' }, 501);

  let files: { key?: unknown; contentType?: unknown }[] = [];
  try { files = ((await req.json()) as { files?: typeof files }).files ?? []; } catch { return json({ error: 'Body khong hop le' }, 400); }
  if (!Array.isArray(files) || !files.length || files.length > 4) return json({ error: 'Gửi 1–4 file mỗi lần' }, 400);

  const host = `${e.accountId}.r2.cloudflarestorage.com`;
  const now = new Date();
  const uploads = [];
  for (const f of files) {
    const key = typeof f.key === 'string' ? f.key : '';
    const type = typeof f.contentType === 'string' ? f.contentType : '';
    if (!validR2Key(key)) return json({ error: `Tên file không hợp lệ: ${key.slice(0, 80)}` }, 400);
    if (!/^(image|audio)\//.test(type)) return json({ error: 'Chỉ nhận ảnh / âm thanh' }, 400);
    const uploadUrl = await presignUrl({
      method: 'PUT', host, path: `/${e.bucket}/${key}`, accessKeyId: e.accessKeyId, secretAccessKey: e.secretAccessKey,
      region: 'auto', expires: 600, now,
    });
    uploads.push({ key, uploadUrl, publicUrl: `${e.publicUrl}/${key}` });
  }
  return json({ uploads }, 200);
}

function json(obj: unknown, status: number): Response {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
