// Dung chung cho cac route /api: kiem tra token phien dang nhap cua LetsGo (header x-letsgo-token).
// Ten file bat dau bang "_" -> Vercel KHONG bien no thanh route rieng.
//
// App dang nhap bang session token rieng (bang app_sessions, migration 061), khong dung Supabase Auth.
// Kiem token qua RPC bds_access_check (migration 164): doc header x-letsgo-token, tra 'ok' | 'not_admin'
// khi phien con han + tai khoan dang hoat dong; 'no_token' | 'expired' khi khong hop le.
//
// Cau hinh: dung lai bien moi truong Supabase cua app (SUPABASE_URL / SUPABASE_ANON_KEY, hoac
// VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY da khai bao tren Vercel cho ban build).

export const TOKEN_HEADER = 'x-letsgo-token';

/** Phien dang nhap LetsGo con han (bat ky vai tro nao). Loi mang / thieu cau hinh = khong hop le. */
export async function sessionOk(token: string): Promise<boolean> {
  const base = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!base || !key || !token) return false;
  try {
    const res = await fetch(`${base.replace(/\/$/, '')}/rest/v1/rpc/bds_access_check`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', [TOKEN_HEADER]: token },
      body: '{}',
    });
    if (!res.ok) return false;
    const state = await res.json();
    return state === 'ok' || state === 'not_admin';
  } catch {
    return false;
  }
}

/** Doc token tu request roi kiem; tra Response 401 (cau tieng Viet) khi khong hop le, null khi hop le. */
export async function requireSession(req: Request): Promise<Response | null> {
  if (await sessionOk(req.headers.get(TOKEN_HEADER) ?? '')) return null;
  return new Response(JSON.stringify({ error: 'Phiên đăng nhập hết hạn — đăng nhập lại rồi thử.' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}
