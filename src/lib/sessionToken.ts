// Token phiên đăng nhập của app (bảng app_sessions, migration 061) — lưu localStorage.
// Tách khỏi auth.tsx để code ngoài React (VD lib/gemini gửi header x-letsgo-token lên /api) dùng được.

export const SESSION_TOKEN_KEY = 'letsgo_token';

/** Token đang lưu; null = chưa đăng nhập / máy chặn lưu trữ. */
export function getStoredSessionToken(): string | null {
  try {
    return localStorage.getItem(SESSION_TOKEN_KEY);
  } catch {
    return null;
  }
}
