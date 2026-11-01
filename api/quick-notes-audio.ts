// Vercel Serverless Function (Edge) — cap link CO HAN de tai len / nghe lai file ghi am cua "Ghi chu nhanh".
//
// Bucket Storage 'quick-notes' la RIENG TU va khong co policy cho anon (migration 188), nen trinh duyet khong tu
// doc / ghi duoc. Function nay kiem phien dang nhap qua RPC quick_notes_rpc('whoami') (header token cua app),
// roi dung khoa service_role ky link cho DUNG thu muc <user_id>/ cua nguoi do — nguoi khac khong mo duoc file.
//
// Cau hinh bat buoc (lam 1 lan):
//   Vercel > Project > Settings > Environment Variables > them SUPABASE_SERVICE_ROLE_KEY
//   (Supabase > Project Settings > API > service_role — KHONG co tien to VITE_, khong bao gio dua vao client).
//   Chay dev tren may: them cung dong do vao file .env (vite.config.ts doc va phuc vu route nay).
//
// POST { action: 'upload', ext }   -> { path, token }   (client goi storage.uploadToSignedUrl(path, token, blob))
// POST { action: 'play', path }    -> { url }           (link nghe lai, het han sau 1 gio)
import { createClient } from '@supabase/supabase-js';
import { sessionUserId, TOKEN_HEADER } from './_letsgoSession';

export const config = { runtime: 'edge' };

const BUCKET = 'quick-notes';
const EXTS = ['webm', 'mp4', 'm4a', 'ogg', 'mp3', 'wav', 'aac'];
const PLAY_TTL_SEC = 3600;

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const base = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
  const anon = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!base || !anon) return json({ error: 'Server chưa cấu hình Supabase' }, 500);
  if (!service) {
    return json({ error: 'Server chưa cấu hình SUPABASE_SERVICE_ROLE_KEY nên chưa lưu được file ghi âm' }, 503);
  }

  const userId = await sessionUserId(req.headers.get(TOKEN_HEADER) ?? '');
  if (!userId) return json({ error: 'Phiên đăng nhập hết hạn — đăng nhập lại rồi thử.' }, 401);

  let body: { action?: unknown; ext?: unknown; path?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Body khong hop le' }, 400);
  }

  const admin = createClient(base, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const storage = admin.storage.from(BUCKET);

  if (body.action === 'upload') {
    const ext = typeof body.ext === 'string' && EXTS.includes(body.ext) ? body.ext : 'webm';
    const month = new Date().toISOString().slice(0, 7);
    const path = `${userId}/${month}/${crypto.randomUUID()}.${ext}`;
    const { data, error } = await storage.createSignedUploadUrl(path);
    if (error || !data) return json({ error: storageError(error?.message) }, 502);
    return json({ path: data.path || path, token: data.token });
  }

  if (body.action === 'play') {
    const path = typeof body.path === 'string' ? body.path : '';
    // Chi file trong thu muc cua chinh nguoi dang nhap, khong cho "../"
    if (!path.startsWith(`${userId}/`) || path.includes('..')) return json({ error: 'Không có quyền mở file này' }, 403);
    const { data, error } = await storage.createSignedUrl(path, PLAY_TTL_SEC);
    if (error || !data) return json({ error: storageError(error?.message) }, 502);
    return json({ url: data.signedUrl, expiresIn: PLAY_TTL_SEC });
  }

  return json({ error: 'Thao tác không hợp lệ' }, 400);
}

function storageError(msg: string | undefined): string {
  if (msg && /bucket not found/i.test(msg)) return 'Chưa có bucket quick-notes (chưa chạy migration 188).';
  return `Lỗi Storage: ${msg ?? 'không rõ'}`;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
