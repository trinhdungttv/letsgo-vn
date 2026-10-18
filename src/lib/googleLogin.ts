// Đăng nhập bằng Google: dùng Supabase Auth (Google OAuth, luồng PKCE) CHỈ để Google xác minh email,
// rồi đổi ngay sang session token của app qua RPC verify_google_login (migration 167) — RPC tự đọc email
// từ phía máy chủ, không tin email do trình duyệt gửi. Xong là đăng xuất phiên Supabase Auth.
// Dùng client Supabase riêng (storageKey riêng, chỉ tạo khi cần) → client chính `supabase` vẫn luôn chạy anon.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { supabaseUrl, supabaseAnonKey } from './supabase';
import type { AppUser } from './types';

const OAUTH_STORAGE_KEY = 'letsgo_google_oauth';
// Đánh dấu "đang chờ Google trả về" → chỉ xử lý ?code= do chính nút Google của app khởi tạo.
const PENDING_KEY = 'letsgo_google_pending';

export const GOOGLE_NOT_ALLOWED = 'Tài khoản Google này chưa được cấp quyền';

export type GoogleLoginResult = { user: AppUser; token: string } | { error: string };

type Redirect = { code: string } | { error: string; description: string };
let redirect: Redirect | null = null;
let result: Promise<GoogleLoginResult> | null = null;

let client: SupabaseClient | null = null;
function oauthClient(): SupabaseClient {
  if (!client) {
    client = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { storageKey: OAUTH_STORAGE_KEY, flowType: 'pkce', detectSessionInUrl: false, autoRefreshToken: false, persistSession: true },
    });
  }
  return client;
}

function clearOAuthStorage() {
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i);
    if (k && k.startsWith(OAUTH_STORAGE_KEY)) localStorage.removeItem(k);
  }
}

/** Bấm nút Google: chuyển trình duyệt sang trang chọn tài khoản Google. Trả về câu lỗi nếu không đi được. */
export async function startGoogleLogin(): Promise<string | null> {
  // Quản trị viên chưa bật Google trong Supabase → báo rõ, thay vì để Supabase hiện trang lỗi JSON.
  try {
    const res = await fetch(`${supabaseUrl}/auth/v1/settings`, { headers: { apikey: supabaseAnonKey } });
    if (res.ok) {
      const s = (await res.json()) as { external?: Record<string, boolean> };
      if (s.external && !s.external.google) {
        return 'Đăng nhập Google chưa được bật trên hệ thống (quản trị viên cần bật Google trong Supabase).';
      }
    }
  } catch { /* mạng chập chờn → cứ thử chuyển sang Google */ }

  clearOAuthStorage();
  localStorage.setItem(PENDING_KEY, String(Date.now()));
  const { error } = await oauthClient().auth.signInWithOAuth({
    provider: 'google',
    options: {
      // Quay về trang gốc, không kèm hash: App tự mở lại đúng trang đang xem (lgvn_page).
      redirectTo: window.location.origin + window.location.pathname,
      queryParams: { prompt: 'select_account' },
    },
  });
  if (error) {
    localStorage.removeItem(PENDING_KEY);
    return 'Không mở được đăng nhập Google: ' + error.message;
  }
  return null;
}

/**
 * Gọi 1 lần lúc khởi động (main.tsx), TRƯỚC khi App đọc hash: nhận ?code= (hoặc lỗi) Google trả về
 * rồi xoá khỏi địa chỉ, để hash routing (#/...) và link chia sẻ #/p/<mã> không bị ảnh hưởng.
 */
export function captureGoogleRedirect() {
  if (!localStorage.getItem(PENDING_KEY)) return;
  const url = new URL(window.location.href);
  const hash = new URLSearchParams(url.hash.slice(1)); // Supabase gửi lỗi cả ở ?error=... lẫn #error=...
  const pick = (k: string) => url.searchParams.get(k) || hash.get(k);
  const code = url.searchParams.get('code');
  const error = pick('error') || pick('error_code');
  const description = pick('error_description') || '';
  if (!code && !error && !description) return; // vd bấm Back từ trang Google → không có gì để xử lý

  localStorage.removeItem(PENDING_KEY);
  redirect = error || description ? { error: error || '', description } : { code: code! };
  for (const k of ['code', 'error', 'error_code', 'error_description']) url.searchParams.delete(k);
  if (hash.has('error') || hash.has('error_description')) url.hash = '';
  window.history.replaceState(window.history.state, '', url.toString());
}

export function hasGoogleRedirect(): boolean {
  return redirect !== null;
}

/** Vừa quay về từ Google → đổi sang token của app. Gọi nhiều lần (StrictMode) vẫn chỉ đổi 1 lần. */
export function completeGoogleLogin(): Promise<GoogleLoginResult> | null {
  if (!redirect) return null;
  if (!result) result = exchange(redirect);
  return result;
}

async function exchange(r: Redirect): Promise<GoogleLoginResult> {
  if ('error' in r) return { error: describeRedirectError(r.error, r.description) };
  const c = oauthClient();
  try {
    const { data: ex, error: exErr } = await c.auth.exchangeCodeForSession(r.code);
    if (exErr) return { error: `Không hoàn tất được đăng nhập Google (${exErr.message}). Vui lòng bấm lại nút Google.` };
    const { data, error } = await c.rpc('verify_google_login');
    if (error) return { error: describeRpcError(error, ex.session?.user?.email) };
    const row = (Array.isArray(data) ? data[0] : data) as (AppUser & { token?: string }) | undefined;
    if (!row || !row.token) return { error: GOOGLE_NOT_ALLOWED };
    const { token, ...user } = row;
    return { user, token };
  } catch (e) {
    return { error: 'Lỗi đăng nhập Google: ' + (e instanceof Error ? e.message : String(e)) };
  } finally {
    // App không giữ phiên Supabase Auth: thu hồi phiên (refresh token) + xoá sạch phần lưu trong trình duyệt.
    await c.auth.signOut().catch(() => {});
    clearOAuthStorage();
  }
}

function describeRedirectError(error: string, description: string): string {
  const text = `${error} ${description}`.toLowerCase();
  if (text.includes('access_denied') || text.includes('cancel')) return 'Bạn đã huỷ đăng nhập Google.';
  if (text.includes('signup') || text.includes('sign up')) {
    return 'Supabase đang chặn tạo người dùng mới — quản trị viên cần bật "Allow new users to sign up" trong Supabase.';
  }
  return 'Đăng nhập Google không thành công: ' + (description || error);
}

function describeRpcError(err: { code?: string; message?: string }, email?: string | null): string {
  const who = email ? ` (${email})` : '';
  const m = err.message || '';
  if (err.code === 'PGRST202' || err.code === '42883') {
    return 'Máy chủ chưa cài đăng nhập Google (quản trị viên cần chạy migration 167 trong Supabase).';
  }
  if (m.includes('GOOGLE_NOT_ALLOWED')) return `${GOOGLE_NOT_ALLOWED}${who}. Nhờ quản trị viên gán email này vào tài khoản của bạn.`;
  if (m.includes('GOOGLE_ACCOUNT_LOCKED')) return `Tài khoản gắn với email Google${who} đang bị khoá. Liên hệ quản trị viên.`;
  if (m.includes('GOOGLE_EMAIL_DUPLICATE')) return `Email Google${who} đang gắn với nhiều tài khoản. Nhờ quản trị viên chỉ để lại 1 tài khoản dùng email này.`;
  if (m.includes('GOOGLE_IDENTITY_INVALID')) {
    return `Không xác minh được email Google${who}. Quản trị viên kiểm tra mục Authentication → Users trong Supabase (người dùng này chỉ được đăng nhập bằng Google).`;
  }
  if (m.includes('GOOGLE_NO_SESSION')) return 'Phiên Google không hợp lệ. Vui lòng bấm lại nút Google.';
  return 'Lỗi đăng nhập Google: ' + m;
}
