import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const m = vi.hoisted(() => ({
  auth: { exchangeCodeForSession: vi.fn(), signOut: vi.fn(), signInWithOAuth: vi.fn() },
  rpc: vi.fn(),
  createClient: vi.fn(),
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: m.createClient }));
vi.mock('./supabase', () => ({ supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'anon-key' }));

const PENDING = 'letsgo_google_pending';

function browser(href: string, initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  const loc = { href, origin: new URL(href).origin, pathname: new URL(href).pathname };
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size; },
  });
  vi.stubGlobal('window', {
    location: loc,
    history: { state: null, replaceState: (_s: unknown, _t: string, url: string) => { loc.href = new URL(url, loc.href).toString(); } },
  });
  return { store, loc };
}

async function load() {
  vi.resetModules();
  return import('./googleLogin');
}

beforeEach(() => {
  m.createClient.mockReset().mockReturnValue({ auth: m.auth, rpc: m.rpc });
  m.auth.exchangeCodeForSession.mockReset().mockResolvedValue({ data: { session: { user: { email: 'tony@gmail.com' } } }, error: null });
  m.auth.signOut.mockReset().mockResolvedValue({ error: null });
  m.auth.signInWithOAuth.mockReset().mockResolvedValue({ data: {}, error: null });
  m.rpc.mockReset();
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('captureGoogleRedirect', () => {
  it('không bấm nút Google → không đụng địa chỉ (kể cả có ?code= lạ, link chia sẻ #/p/)', async () => {
    const { loc } = browser('https://app.test/?code=zzz#/p/ABC123');
    const g = await load();
    g.captureGoogleRedirect();
    expect(loc.href).toBe('https://app.test/?code=zzz#/p/ABC123');
    expect(g.hasGoogleRedirect()).toBe(false);
    expect(g.completeGoogleLogin()).toBeNull();
  });

  it('đang chờ nhưng quay lại không có mã (bấm Back) → bỏ qua', async () => {
    const { loc, store } = browser('https://app.test/#/clients', { [PENDING]: '1' });
    const g = await load();
    g.captureGoogleRedirect();
    expect(loc.href).toBe('https://app.test/#/clients');
    expect(g.hasGoogleRedirect()).toBe(false);
    expect(store.has(PENDING)).toBe(true);
  });

  it('nhận ?code= rồi xoá khỏi địa chỉ, giữ hash route', async () => {
    const { loc, store } = browser('https://app.test/?code=abc#/clients', { [PENDING]: '1' });
    const g = await load();
    g.captureGoogleRedirect();
    expect(loc.href).toBe('https://app.test/#/clients');
    expect(g.hasGoogleRedirect()).toBe(true);
    expect(store.has(PENDING)).toBe(false);
  });

  it('lỗi nằm cả ở query lẫn hash → dọn cả hai', async () => {
    const { loc } = browser(
      'https://app.test/?error=access_denied&error_description=User+cancelled#error=access_denied&error_description=User+cancelled',
      { [PENDING]: '1' },
    );
    const g = await load();
    g.captureGoogleRedirect();
    expect(loc.href).toBe('https://app.test/');
    await expect(g.completeGoogleLogin()).resolves.toEqual({ error: 'Bạn đã huỷ đăng nhập Google.' });
    expect(m.auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });
});

describe('completeGoogleLogin', () => {
  it('đổi mã → gọi RPC KHÔNG gửi email → trả user + token, đăng xuất phiên Supabase Auth, xoá bộ nhớ OAuth', async () => {
    const { store } = browser('https://app.test/?code=abc', {
      [PENDING]: '1',
      'letsgo_google_oauth': '{"access_token":"jwt"}',
      'letsgo_google_oauth-code-verifier': 'v',
      letsgo_page: 'clients',
    });
    m.rpc.mockResolvedValue({
      data: [{ id: 'u1', username: 'tony', full_name: 'Tony', role: 'admin', email: 'tony@gmail.com', token: 'tok' }],
      error: null,
    });
    const g = await load();
    g.captureGoogleRedirect();
    const res = await g.completeGoogleLogin();

    expect(res).toEqual({ user: { id: 'u1', username: 'tony', full_name: 'Tony', role: 'admin', email: 'tony@gmail.com' }, token: 'tok' });
    expect(m.auth.exchangeCodeForSession).toHaveBeenCalledWith('abc');
    expect(m.rpc).toHaveBeenCalledWith('verify_google_login');
    expect(m.rpc.mock.calls[0]).toHaveLength(1);
    expect(m.auth.signOut).toHaveBeenCalled();
    expect([...store.keys()]).toEqual(['letsgo_page']);
    expect(m.createClient.mock.calls[0][2].auth).toMatchObject({ storageKey: 'letsgo_google_oauth', flowType: 'pkce', detectSessionInUrl: false });
  });

  it('gọi 2 lần (StrictMode) vẫn chỉ đổi mã 1 lần', async () => {
    browser('https://app.test/?code=abc', { [PENDING]: '1' });
    m.rpc.mockResolvedValue({ data: [{ id: 'u1', username: 'a', full_name: 'A', role: 'bdh', email: 'a@x.vn', token: 't' }], error: null });
    const g = await load();
    g.captureGoogleRedirect();
    const [a, b] = await Promise.all([g.completeGoogleLogin(), g.completeGoogleLogin()]);
    expect(a).toBe(b);
    expect(m.auth.exchangeCodeForSession).toHaveBeenCalledTimes(1);
  });

  it('email chưa có trong app_users → "chưa được cấp quyền", vẫn đăng xuất phiên Google', async () => {
    browser('https://app.test/?code=abc', { [PENDING]: '1' });
    m.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'GOOGLE_NOT_ALLOWED' } });
    const g = await load();
    g.captureGoogleRedirect();
    const res = await g.completeGoogleLogin();
    expect(res && 'error' in res && res.error).toContain('Tài khoản Google này chưa được cấp quyền (tony@gmail.com)');
    expect(m.auth.signOut).toHaveBeenCalled();
  });

  it('các mã lỗi khác của RPC → câu tiếng Việt tương ứng', async () => {
    const cases: [{ code: string; message: string }, string][] = [
      [{ code: 'PGRST202', message: 'Could not find the function' }, 'migration 167'],
      [{ code: 'P0001', message: 'GOOGLE_ACCOUNT_LOCKED' }, 'đang bị khoá'],
      [{ code: 'P0001', message: 'GOOGLE_EMAIL_DUPLICATE' }, 'nhiều tài khoản'],
      [{ code: 'P0001', message: 'GOOGLE_IDENTITY_INVALID' }, 'Không xác minh được email Google'],
    ];
    for (const [err, expected] of cases) {
      browser('https://app.test/?code=abc', { [PENDING]: '1' });
      m.rpc.mockResolvedValue({ data: null, error: err });
      const g = await load();
      g.captureGoogleRedirect();
      const res = await g.completeGoogleLogin();
      expect(res && 'error' in res && res.error).toContain(expected);
    }
  });

  it('đổi mã thất bại (mất code verifier) → báo bấm lại, không gọi RPC', async () => {
    browser('https://app.test/?code=abc', { [PENDING]: '1' });
    m.auth.exchangeCodeForSession.mockResolvedValue({ data: { session: null }, error: { message: 'invalid flow state' } });
    const g = await load();
    g.captureGoogleRedirect();
    const res = await g.completeGoogleLogin();
    expect(res && 'error' in res && res.error).toContain('bấm lại nút Google');
    expect(m.rpc).not.toHaveBeenCalled();
  });
});

describe('startGoogleLogin', () => {
  it('Google chưa bật trong Supabase → báo rõ, không chuyển trang', async () => {
    const { store } = browser('https://app.test/#/dashboard');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ external: { google: false } }) }));
    const g = await load();
    expect(await g.startGoogleLogin()).toContain('chưa được bật');
    expect(m.auth.signInWithOAuth).not.toHaveBeenCalled();
    expect(store.has(PENDING)).toBe(false);
  });

  it('đã bật → chuyển sang Google, quay về trang gốc không kèm hash', async () => {
    const { store } = browser('https://app.test/#/clients');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ external: { google: true } }) }));
    const g = await load();
    expect(await g.startGoogleLogin()).toBeNull();
    expect(m.auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: { redirectTo: 'https://app.test/', queryParams: { prompt: 'select_account' } },
    });
    expect(store.has(PENDING)).toBe(true);
  });
});
