// api/osm-tile.ts: tải ảnh nền OSM chuẩn hộ trình duyệt khi mạng chặn openstreetmap.org. fetch giả.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import tile, { parseTile, sameSiteReferer } from '../../api/osm-tile';

const asked: { url: string; headers: Record<string, string> }[] = [];
let upstream: 'ok' | 'down' | '404' = 'ok';

beforeEach(() => {
  asked.length = 0;
  upstream = 'ok';
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    asked.push({ url, headers: (init.headers ?? {}) as Record<string, string> });
    if (upstream === 'down') throw new TypeError('fetch failed');
    if (upstream === '404') return new Response('nope', { status: 404 });
    return new Response(new Uint8Array([137, 80, 78, 71]), { status: 200, headers: { 'Content-Type': 'image/png' } });
  }));
});
afterEach(() => { vi.unstubAllGlobals(); });

const req = (query: string, referer: string | null = 'https://letsgo.example/crm-leads') =>
  new Request(`https://letsgo.example/api/osm-tile?${query}`, { headers: referer ? { referer } : {} });

describe('ảnh nền OSM qua server LetsGo', () => {
  it('chỉ nhận z/x/y hợp lệ', () => {
    expect(parseTile(new URLSearchParams('z=14&x=13046&y=7698'))).toEqual({ z: 14, x: 13046, y: 7698 });
    expect(parseTile(new URLSearchParams('z=2&x=4&y=0'))).toBeNull(); // x ngoài lưới 2^z
    expect(parseTile(new URLSearchParams('z=20&x=0&y=0'))).toBeNull(); // quá zoom tối đa
    expect(parseTile(new URLSearchParams('z=1&x=-1&y=0'))).toBeNull();
    expect(parseTile(new URLSearchParams('z=1&x=0'))).toBeNull();
    expect(parseTile(new URLSearchParams('z=1&x=0&y=0/../../x'))).toBeNull();
  });

  it('chỉ phục vụ chính app (Referer cùng tên miền, bỏ qua cổng)', () => {
    expect(sameSiteReferer(req('z=1&x=0&y=0'))).toBe(true);
    expect(sameSiteReferer(req('z=1&x=0&y=0', 'https://trang-khac.vn/'))).toBe(false);
    expect(sameSiteReferer(req('z=1&x=0&y=0', null))).toBe(false);
    expect(sameSiteReferer(new Request('http://localhost/api/osm-tile', { headers: { referer: 'http://localhost:5199/' } }))).toBe(true);
  });

  it('tải ảnh từ tile.openstreetmap.org, ghi rõ ứng dụng, cache dài ở CDN', async () => {
    const res = await tile(req('z=14&x=13046&y=7698'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('cache-control')).toMatch(/s-maxage=604800/);
    expect(asked[0].url).toBe('https://tile.openstreetmap.org/14/13046/7698.png');
    expect(asked[0].headers['User-Agent']).toMatch(/LetsGoVN/);
  });

  it('trang khác dùng ké → 403; ô sai → 400; không gọi OSM', async () => {
    expect((await tile(req('z=14&x=1&y=1', 'https://trang-khac.vn/'))).status).toBe(403);
    expect((await tile(req('z=99&x=1&y=1'))).status).toBe(400);
    expect(asked).toHaveLength(0);
  });

  it('OSM lỗi / không vào được → 502 không cache (trình duyệt chuyển nguồn dự phòng)', async () => {
    upstream = '404';
    const a = await tile(req('z=1&x=0&y=0'));
    expect(a.status).toBe(502);
    expect(a.headers.get('cache-control')).toBe('no-store');
    upstream = 'down';
    expect((await tile(req('z=1&x=0&y=0'))).status).toBe(502);
  });
});
