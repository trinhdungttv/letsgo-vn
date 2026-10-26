// Phần chạm trình duyệt của popup "Có phiên bản mới": tải /version.json, nhớ mốc đã xem / "Để sau", cập nhật.
// Mọi thao tác đều im lặng khi lỗi (mạng, localStorage bị chặn…) — popup chỉ là phần thêm, không được làm hỏng app.
import { parseVersionInfo, parseDismissed, serializeDismissed, DEV_BUILD_ID, type Dismissed, type VersionInfo } from './releaseUpdate';
import { reloadApp } from './appVersion';

/** Mã build của bundle ĐANG CHẠY (plugin release-version nhúng lúc build; dev = 'dev'). */
export const RUNNING_BUILD_ID: string = typeof __APP_BUILD_ID__ === 'string' ? __APP_BUILD_ID__ : DEV_BUILD_ID;
/** Id release note mới nhất lúc bundle này được build. */
export const RUNNING_RELEASE_ID: string = typeof __APP_RELEASE_ID__ === 'string' ? __APP_RELEASE_ID__ : '';

const LAST_SEEN_KEY = 'lgvn_release_seen';
const DISMISSED_KEY = 'lgvn_release_dismissed';

function read(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function write(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* chế độ riêng tư / bị chặn lưu trữ — bỏ qua */ }
}

export const readLastSeenRelease = (): string | null => read(LAST_SEEN_KEY) || null;
export const writeLastSeenRelease = (id: string) => write(LAST_SEEN_KEY, id);
export const readDismissed = (): Dismissed | null => parseDismissed(read(DISMISSED_KEY));
export const writeDismissed = (d: Dismissed) => write(DISMISSED_KEY, serializeDismissed(d));

/** Tải version.json mới nhất của server (bỏ qua cache). Mọi lỗi / dữ liệu lạ → null. */
export async function fetchVersionInfo(timeoutMs = 8000): Promise<VersionInfo | null> {
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store', signal: ctrl?.signal });
    if (!res.ok) return null;
    return parseVersionInfo(JSON.parse(await res.text()));
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Dọn cache trình duyệt của app (nếu có) rồi tải lại trang để nhận bản mới. */
export async function applyUpdate() {
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    }
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
  } catch { /* không dọn được thì vẫn tải lại */ }
  reloadApp();
}
