// Trang đang mở là BẢN CŨ sau khi app vừa được cập nhật (deploy mới lên Vercel).
//
// Các phần nặng (mẫu báo giá Let's Go, Excel, PDF…) chỉ tải khi cần, từ file có mã trong tên (vd letsgoTemplate-5A2TCY6E.js).
// Deploy bản mới thì file của bản cũ bị thay → trang mở từ trước đi tìm file cũ và báo "Failed to fetch dynamically imported
// module". Không phải lỗi dữ liệu: tải lại trang là hết. Ở đây: nhận ra lỗi đó, nói bằng lời dễ hiểu và hiện nút tải lại.

const STALE_RE = /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS|ChunkLoadError|Loading (CSS )?chunk [\w-]+ failed/i;

export function isStaleBuildError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : typeof e === 'string' ? e : String((e as { message?: unknown })?.message ?? '');
  return STALE_RE.test(msg);
}

export const STALE_BUILD_MSG = 'Ứng dụng vừa được cập nhật bản mới nên trang đang mở đã cũ. Bấm “Tải lại trang” để dùng tiếp (đang sửa phương án thì Lưu trước).';

/** Câu báo lỗi cho người dùng: lỗi "trang cũ" → câu dễ hiểu; lỗi khác giữ nguyên (kèm tiền tố nếu có). */
export function errorText(e: unknown, prefix = ''): string {
  if (isStaleBuildError(e)) return STALE_BUILD_MSG;
  return `${prefix}${e instanceof Error ? e.message : String(e)}`;
}

/** Tải lại trang. Đang có thay đổi chưa lưu thì trình duyệt tự hỏi trước (cảnh báo rời trang của màn soạn phương án). */
export function reloadApp() { window.location.reload(); }

const BANNER_ID = 'lgvn-update-banner';

function showUpdateBanner() {
  if (document.getElementById(BANNER_ID)) return;
  const bar = document.createElement('div');
  bar.id = BANNER_ID;
  bar.setAttribute('role', 'status');
  bar.style.cssText = 'position:fixed;left:0;right:0;bottom:20px;margin:0 auto;width:fit-content;z-index:2147483000;display:flex;align-items:center;gap:12px;max-width:calc(100vw - 32px);padding:10px 12px 10px 16px;border-radius:14px;background:#1d1d1f;color:#fff;font:500 13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.3)';
  const text = document.createElement('span');
  text.textContent = 'Có bản cập nhật mới của ứng dụng. Lưu việc đang làm rồi tải lại trang.';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = 'Tải lại trang';
  btn.style.cssText = 'flex:none;border:0;border-radius:999px;padding:6px 14px;background:#0a84ff;color:#fff;font:600 13px/1 inherit;cursor:pointer';
  btn.onclick = reloadApp;
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = '×';
  close.setAttribute('aria-label', 'Đóng');
  close.style.cssText = 'flex:none;border:0;background:transparent;color:#aaa;font:400 20px/1 inherit;cursor:pointer;padding:0 4px';
  close.onclick = () => bar.remove();
  bar.append(text, btn, close);
  document.body.appendChild(bar);
}

/** Gắn 1 lần lúc khởi động: gặp lỗi "trang cũ" ở bất kỳ đâu → hiện thanh báo kèm nút tải lại (không tự tải lại để khỏi mất việc đang làm). */
export function installStaleBuildNotice() {
  window.addEventListener('vite:preloadError', () => showUpdateBanner());
  window.addEventListener('unhandledrejection', e => { if (isStaleBuildError(e.reason)) showUpdateBanner(); });
  window.addEventListener('error', e => { if (isStaleBuildError(e.error ?? e.message)) showUpdateBanner(); });
}

/** Cho các hộp thoại: báo đúng lỗi "trang cũ" thì cũng hiện thanh báo. */
export function noteIfStale(e: unknown) { if (isStaleBuildError(e)) showUpdateBanner(); }
