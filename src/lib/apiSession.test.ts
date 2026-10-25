// Route /api cần đăng nhập (api/_letsgoSession.ts): proxy Gemini chỉ chạy cho phiên LetsGo còn hạn.
// fetch giả: Supabase RPC bds_access_check + Google Gemini.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import gemini from '../../api/gemini';
import { sessionOk } from '../../api/_letsgoSession';

const calls: { url: string; headers: Record<string, string> }[] = [];
let sessionState: string = 'ok';

beforeEach(() => {
  calls.length = 0;
  sessionState = 'ok';
  vi.stubEnv('VITE_SUPABASE_URL', 'https://sb.example');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon');
  vi.stubEnv('GEMINI_API_KEY', 'gkey');
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, headers: (init.headers ?? {}) as Record<string, string> });
    if (url.includes('/rpc/bds_access_check')) return new Response(JSON.stringify(sessionState), { status: 200 });
    return new Response('{"candidates":[]}', { status: 200 });
  }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

const req = (token?: string) => new Request('https://app/api/gemini', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(token ? { 'x-letsgo-token': token } : {}) },
  body: JSON.stringify({ model: 'gemini-2.5-flash', body: {} }),
});

describe('proxy Gemini cần phiên đăng nhập', () => {
  it('không có token → 401, không gọi Supabase lẫn Gemini', async () => {
    const res = await gemini(req());
    expect(res.status).toBe(401);
    expect((await res.json()).error).toMatch(/đăng nhập lại/);
    expect(calls).toHaveLength(0);
  });

  it('token hết hạn → 401, không gọi Gemini', async () => {
    sessionState = 'expired';
    const res = await gemini(req('t-cu'));
    expect(res.status).toBe(401);
    expect(calls.map(c => c.url)).toEqual(['https://sb.example/rest/v1/rpc/bds_access_check']);
    expect(calls[0].headers['x-letsgo-token']).toBe('t-cu');
  });

  it('phiên hợp lệ (admin hoặc không) → gọi Gemini bằng key ở server', async () => {
    for (const state of ['ok', 'not_admin']) {
      calls.length = 0;
      sessionState = state;
      const res = await gemini(req('t-moi'));
      expect(res.status).toBe(200);
      expect(calls[1].url).toMatch(/generativelanguage\.googleapis\.com\/.*:generateContent\?key=gkey/);
    }
  });

  it('server thiếu cấu hình Supabase → coi như chưa đăng nhập', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('SUPABASE_URL', '');
    expect(await sessionOk('t')).toBe(false);
  });
});
