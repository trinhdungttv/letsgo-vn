// Vercel Serverless Function (Edge) — mo link RUT GON Google Maps (maps.app.goo.gl… — chia se tu
// dien thoai) o server de lay link day du co toa do: trinh duyet khong tu theo duoc vi CORS.
// Port tu Tony Study (src/app/api/prm/resolve-map/route.ts).
//
// POST { url }  (header x-letsgo-token: token phien dang nhap cua app)  ->  { url, coords: {lat,lng} | null }
//
// An toan:
//  - Yeu cau dang nhap: header x-letsgo-token, kiem qua api/_letsgoSession.ts (RPC bds_access_check).
//  - Chi nhan link rut gon cua Google, chi di theo chuyen huong trong ten mien Google (toi da 5 buoc)
//    -> khong dung duoc API nay de goi trang bat ky.
//
// 12/11: KHONG gia lam trinh duyet (truoc day gui User-Agent Safari) — gia Safari thi Google tra trang JS
// (DurableDeepLinkUi, HTTP 200, khong co gi doc duoc); goi thang (khong UA trinh duyet) thi Google tra 302 ve:
//   - link chia se tu MAY TINH: google.com/maps/place/<ten>/@lat,lng…!3d!4d → co toa do
//   - link chia se tu APP DIEN THOAI (…?g_st=ic): maps.google.com/?q=<ten>, <dia chi>&ftid=0x…:0x… → co ten + dia chi,
//     KHONG co toa do → dung lai o day (di tiep chi ra trang HTML co tam khung nhin theo IP may chu = SAI cho).
//     Phia app doc ten trong q roi tu tim cong ty theo ten.
import { extractLatLng, isGoogleMapsHost, isShortMapLink, placeQueryFromLink } from '../src/lib/cskh/nearby';
import { requireSession } from './_letsgoSession';

export const config = { runtime: 'edge' };

const MAX_HOPS = 5;
const TIMEOUT_MS = 8000;
const SHORT_HOSTS = new Set(['maps.app.goo.gl', 'goo.gl', 'g.co']);

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const denied = await requireSession(req);
  if (denied) return denied;

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
        res = await fetch(current, { redirect: 'manual', signal: ctrl.signal });
      } finally {
        clearTimeout(timer);
      }
      const location = res.headers.get('location');
      if (location) {
        const next = new URL(location, current);
        if (next.protocol !== 'https:' || !isGoogleMapsHost(next.hostname)) break;
        current = next.toString();
        // Du thong tin: co toa do, hoac trang 1 dia diem (ten trong q / duong dan /maps/place/)
        if (extractLatLng(current) || placeQueryFromLink(current) || next.pathname.startsWith('/maps/place/')) break;
        continue;
      }
      // Link rut gon tra trang HTML (khong chuyen huong) — tim link maps day du trong noi dung.
      // Chi lam o ten mien rut gon; bo link /maps/api/ (anh staticmap = tam khung nhin theo IP, khong phai dia diem)
      if (res.ok && SHORT_HOSTS.has(new URL(current).hostname)) {
        const html = (await res.text()).slice(0, 300_000).replace(/\\u003d/g, '=').replace(/\\u0026/g, '&').replace(/&amp;/g, '&');
        const found = [...html.matchAll(/https:\/\/(?:www\.|maps\.)?google\.[a-z.]+\/maps[^"'\s<>\\]*/g)].map(m => m[0]).find(u => !u.includes('/maps/api/'));
        if (found) current = found;
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
