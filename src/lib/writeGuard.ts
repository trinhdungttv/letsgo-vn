// Lớp bảo vệ ghi dữ liệu dùng chung cho client Supabase chính (lib/supabase.ts) — migration 218.
//
// 1) Gắn token phiên đăng nhập (header x-letsgo-token) vào MỌI request /rest/v1 → trigger lịch sử (dh_track) biết
//    AI thêm / sửa / xoá từng dòng (Lịch sử → "Nhật ký nhân viên", cảnh báo bất thường, khôi phục theo đợt).
// 2) Vai trò CHỈ XEM (Ban Điều Hành) → chặn ngay ở trình duyệt mọi lệnh ghi bảng / tải tệp, trả lỗi tiếng Việt như
//    lỗi Supabase thường (code cũ hiện thông báo lỗi như mọi khi) + bắn sự kiện để App hiện 1 thông báo chung.
//    Database chặn thêm 1 lớp nữa (dh_log_change, migration 218) phòng khi có đường ghi khác lọt qua.
//    RPC (/rest/v1/rpc/…) không chặn ở đây vì phần lớn là đọc — RPC có ghi bảng thì database tự chặn.
import { getStoredSessionToken } from './sessionToken';

/** Vai trò chỉ được xem, không thêm / sửa / xoá — khớp lgvn_readonly_role() trong migration 218. */
export const READONLY_ROLES: readonly string[] = ['bdh'];

export function isReadOnlyRole(role: string | null | undefined): boolean {
  return !!role && READONLY_ROLES.includes(role);
}

export const READONLY_MESSAGE = 'Tài khoản Ban Điều Hành chỉ được xem — không thêm / sửa / xoá được dữ liệu.';
/** window event — App nghe để hiện thông báo (đã giãn cách, không spam). */
export const READONLY_EVENT = 'lgvn:readonly-blocked';
export const TOKEN_HEADER = 'x-letsgo-token';

let currentRole: string | null = null;

/** AuthProvider gọi mỗi khi đăng nhập / đăng xuất / đổi người. */
export function setWriteGuardRole(role: string | null | undefined): void {
  currentRole = role ?? null;
}

const WRITE_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

function pathOf(url: string): string {
  try { return new URL(url).pathname; } catch { return url.split('?')[0]; }
}

/** Lệnh ghi thẳng vào bảng (không phải RPC) hoặc tải / xoá tệp trong Storage. */
export function isBlockedWrite(url: string, method: string): boolean {
  if (!WRITE_METHODS.has(method.toUpperCase())) return false;
  const path = pathOf(url);
  if (/\/rest\/v1\/rpc\//.test(path)) return false;
  return /\/rest\/v1\/[^/]+/.test(path) || /\/storage\/v1\/object\//.test(path);
}

/** Request tới REST của Supabase (bảng + RPC) — chỉ những request này mang token (Storage không nhận header lạ). */
export function isRestRequest(url: string): boolean {
  return /\/rest\/v1\//.test(pathOf(url));
}

let lastNotice = 0;
function notifyBlocked(): void {
  const now = Date.now();
  if (now - lastNotice < 3000) return;
  lastNotice = now;
  try { window.dispatchEvent(new CustomEvent(READONLY_EVENT)); } catch { /* môi trường không có window (test) */ }
}

export function readOnlyResponse(): Response {
  return new Response(
    JSON.stringify({ code: 'LGVN_READONLY', message: READONLY_MESSAGE, details: null, hint: null }),
    { status: 403, headers: { 'Content-Type': 'application/json' } },
  );
}

/** Bọc hàm fetch của client Supabase: chặn ghi với vai trò chỉ xem + gắn token người dùng. */
export function withWriteGuard(base: typeof fetch, getToken: () => string | null = getStoredSessionToken): typeof fetch {
  return (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? (typeof input !== 'string' && !(input instanceof URL) ? input.method : 'GET');
    if (isReadOnlyRole(currentRole) && isBlockedWrite(url, method)) {
      notifyBlocked();
      return Promise.resolve(readOnlyResponse());
    }
    const token = isRestRequest(url) ? getToken() : null;
    if (!token) return base(input, init);
    const headers = new Headers(init?.headers ?? (typeof input !== 'string' && !(input instanceof URL) ? input.headers : undefined));
    if (!headers.has(TOKEN_HEADER)) headers.set(TOKEN_HEADER, token);
    return base(input, { ...init, headers });
  };
}
