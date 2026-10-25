// Vercel Serverless Function (Edge) — tai anh nen ban do OpenStreetMap CHUAN (giong Tony Study) ho
// trinh duyet. Mot so mang o VN chan *.openstreetmap.org nen trinh duyet khong tu tai duoc; server
// Vercel van vao duoc -> nen ban do giu dung kieu OSM. src/lib/mapTiles.ts chi dung route nay khi
// tai thang tile.openstreetmap.org hong.
//
// GET /api/osm-tile?z=..&x=..&y=..  ->  image/png
//
// Theo chinh sach su dung tile OSM: User-Agent ghi ro ung dung, giu chu thich "© OpenStreetMap" tren ban
// do, cache dai o CDN Vercel (s-maxage 7 ngay) de moi o anh chi xin OSM 1 lan.
// Chong dung route lam proxy cho trang khac: chi nhan request co Referer cung ten mien voi app.

export const config = { runtime: 'edge' };

const UPSTREAM = 'https://tile.openstreetmap.org';
const UA = 'LetsGoVN-CRM/1.0 (internal company map; contact via app admin)';
const MAX_ZOOM = 19;
const TIMEOUT_MS = 8000;

/** z/x/y hop le (so nguyen, x,y trong luoi 2^z). null = khong hop le. */
export function parseTile(params: URLSearchParams): { z: number; x: number; y: number } | null {
  const [z, x, y] = ['z', 'x', 'y'].map(k => params.get(k) ?? '');
  if (![z, x, y].every(v => /^\d{1,7}$/.test(v))) return null;
  const t = { z: Number(z), x: Number(x), y: Number(y) };
  const n = 2 ** t.z;
  return t.z <= MAX_ZOOM && t.x < n && t.y < n ? t : null;
}

/** Referer cung ten mien voi app (bo qua cong — dev chay localhost:port). */
export function sameSiteReferer(req: Request): boolean {
  const ref = req.headers.get('referer');
  if (!ref) return false;
  try {
    return new URL(ref).hostname === new URL(req.url).hostname;
  } catch {
    return false;
  }
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 });
  if (!sameSiteReferer(req)) return new Response('Forbidden', { status: 403 });
  const t = parseTile(new URL(req.url).searchParams);
  if (!t) return new Response('Bad tile', { status: 400 });

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const up = await fetch(`${UPSTREAM}/${t.z}/${t.x}/${t.y}.png`, {
      headers: { 'User-Agent': UA, Referer: new URL(req.url).origin + '/' },
      signal: ctrl.signal,
    });
    if (!up.ok) return new Response('Upstream error', { status: 502, headers: { 'Cache-Control': 'no-store' } });
    return new Response(up.body, {
      status: 200,
      headers: {
        'Content-Type': up.headers.get('content-type') ?? 'image/png',
        // Trinh duyet giu 1 ngay, CDN Vercel giu 7 ngay
        'Cache-Control': 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400',
      },
    });
  } catch {
    return new Response('Upstream unreachable', { status: 502, headers: { 'Cache-Control': 'no-store' } });
  } finally {
    clearTimeout(timer);
  }
}
