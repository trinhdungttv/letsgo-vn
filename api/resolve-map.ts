// Vercel Serverless Function (Edge) — mo link RUT GON Google Maps (maps.app.goo.gl… — chia se tu
// dien thoai) o server de lay link day du co toa do: trinh duyet khong tu theo duoc vi CORS.
// Port tu Tony Study (src/app/api/prm/resolve-map/route.ts).
//
// POST { url }  (header x-letsgo-token: token phien dang nhap cua app)  ->  { url, coords: {lat,lng} | null }
//
// An toan:
//  - Yeu cau dang nhap: kiem token qua RPC bds_access_check (doc header x-letsgo-token, dung chung
//    session_role cua migration 061/164) — 'ok' hoac 'not_admin' = phien hop le.
//  - Chi nhan link rut gon cua Google, chi di theo chuyen huong trong ten mien Google (toi da 5 buoc)
//    -> khong dung duoc API nay de goi trang bat ky.
//
// Cau hinh: dung lai bien moi truong Supabase cua app (SUPABASE_URL / SUPABASE_ANON_KEY, hoac
// VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY da khai bao tren Vercel cho ban build).
import { extractLatLng, isGoogleMapsHost, isShortMapLink } from '../src/lib/cskh/nearby';

export const config = { runtime: 'edge' };

const MAX_HOPS = 5;
const TIMEOUT_MS = 8000;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

/** Phien dang nhap LetsGo con han (bat ky vai tro nao). */
async function sessionOk(token: string): Promise<boolean> {
  const base = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!base || !key || !token) return false;
  try {
    const res = await fetch(`${base.replace(/\/$/, '')}/rest/v1/rpc/bds_access_check`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'x-letsgo-token': token },
      body: '{}',
    });
    if (!res.ok) return false;
    const state = await res.json();
    return state === 'ok' || state === 'not_admin';
  } catch {
    return false;
  }
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!(await sessionOk(req.headers.get('x-letsgo-token') ?? ''))) {
    return json({ error: 'Phiên đăng nhập hết hạn — đăng nhập lại rồi thử.' }, 401);
  }

  let url = '';
  try {
    const body = (await req.json()) as { url?: unknown };
    url = typeof body?.url === 'string' ? body.url.trim() : '';
  } catch {
    return json({ error: 'Body khong hop le' }, 400);
  }
  if (!isShortMapLink(url)) return json({ error: 'Chỉ nhận link rút gọn của Google Maps' }, 400);

  let current = url;
  try {
    for (let hop = 0; hop < MAX_HOPS; hop += 1) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      let res: Response;
      try {
        res = await fetch(current, { redirect: 'manual', headers: { 'User-Agent': UA }, signal: ctrl.signal });
      } finally {
        clearTimeout(timer);
      }
      const location = res.headers.get('location');
      if (location) {
        const next = new URL(location, current);
        if (next.protocol !== 'https:' || !isGoogleMapsHost(next.hostname)) break;
        current = next.toString();
        if (extractLatLng(current)) break;
        continue;
      }
      // Mot so link tra trang HTML (khong chuyen huong) — tim link maps day du trong noi dung
      if (res.ok) {
        const html = (await res.text()).slice(0, 300_000).replace(/\\u003d/g, '=').replace(/\\u0026/g, '&').replace(/&amp;/g, '&');
        const found = html.match(/https:\/\/(?:www\.|maps\.)?google\.[a-z.]+\/maps[^"'\s<>\\]*/);
        if (found) current = found[0];
      }
      break;
    }
  } catch {
    return json({ error: 'Không mở được link' }, 502);
  }
  return json({ url: current, coords: extractLatLng(current) }, 200);
}

function json(obj: unknown, status: number): Response {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}
