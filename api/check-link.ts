// Vercel Serverless Function (Edge) — kiem tra link (Facebook, TikTok, website, Maps…) con "song" hay "chet".
// Trinh duyet khong tu kiem tra duoc vi bi CORS chan, nen phai nho server fetch ho.
//
// POST { urls: string[] }  ->  { results: Record<url, { status: 'live' | 'dead' | 'unknown', reason?: string }> }
//
// Quy tac:
//  - Facebook & TikTok luon tra HTTP 200 ke ca khi trang khong ton tai -> phai doc noi dung de phan biet.
//  - Website khac: 2xx/3xx = song; 404/410/loi DNS/tu choi ket noi = chet.
//  - 401/403/429/5xx/timeout = 'unknown' (trang co the dang chan bot, KHONG ket luan la chet).

export const config = { runtime: 'edge' };

type Status = 'live' | 'dead' | 'unknown';
type Result = { status: Status; reason?: string };

const CHROME_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const FB_UA = 'facebookexternalhit/1.1';
const MAX_URLS = 12;
const TIMEOUT_MS = 8000;

const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|\[?::1\]?$)/i;

export async function checkUrl(raw: string): Promise<Result> {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return { status: 'dead', reason: 'Link không hợp lệ' }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { status: 'dead', reason: 'Link không hợp lệ' };
  if (PRIVATE_HOST.test(u.hostname) || !u.hostname.includes('.')) return { status: 'unknown', reason: 'Địa chỉ nội bộ — không kiểm tra' };

  const host = u.hostname.toLowerCase();
  const isFb = /(^|\.)(facebook\.com|fb\.com|fb\.watch)$/.test(host);
  const isTikTok = /(^|\.)tiktok\.com$/.test(host);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(u.toString(), {
      method: 'GET', redirect: 'follow', signal: ctrl.signal,
      headers: { 'User-Agent': isFb ? FB_UA : CHROME_UA, 'Accept': 'text/html,*/*', 'Accept-Language': 'vi,en;q=0.8' },
    });
    const code = res.status;

    if (isFb || isTikTok) {
      if (code >= 400) return { status: code === 404 || code === 410 ? 'dead' : 'unknown', reason: `HTTP ${code}` };
      const html = (await res.text()).slice(0, 600_000);
      if (isFb) {
        // Trang ton tai co og:title + og:url rieng; trang khong ton tai/bi go thi khong co.
        return /property="og:title"/.test(html) && /property="og:url"/.test(html)
          ? { status: 'live' }
          : { status: 'dead', reason: 'Trang Facebook không tồn tại, đã bị gỡ hoặc không công khai' };
      }
      const m = html.match(/"statusCode":(\d+)/);
      if (m && m[1] !== '0') return { status: 'dead', reason: 'Tài khoản TikTok không tồn tại' };
      return m ? { status: 'live' } : { status: 'unknown', reason: 'TikTok không trả dữ liệu để xác nhận' };
    }

    if (code >= 200 && code < 400) return { status: 'live' };
    if (code === 404 || code === 410) return { status: 'dead', reason: `HTTP ${code}` };
    return { status: 'unknown', reason: `HTTP ${code} — trang có thể đang chặn kiểm tra tự động` };
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') return { status: 'unknown', reason: 'Quá thời gian chờ' };
    // Loi mang (DNS khong phan giai duoc, tu choi ket noi, SSL hong…) = khong vao duoc that su.
    return { status: 'dead', reason: 'Không truy cập được trang' };
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  let urls: unknown;
  try { urls = (await req.json()).urls; } catch { return json({ error: 'Body khong hop le' }, 400); }
  if (!Array.isArray(urls)) return json({ error: 'Thieu urls' }, 400);

  const list = [...new Set(urls.filter((x): x is string => typeof x === 'string' && x.trim() !== ''))].slice(0, MAX_URLS);
  const entries = await Promise.all(list.map(async url => [url, await checkUrl(url)] as const));
  return json({ results: Object.fromEntries(entries) }, 200);
}

function json(obj: unknown, status: number): Response {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}
