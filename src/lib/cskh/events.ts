// ============================================================================
// CSKH — sự kiện nhẹ giữa các thành phần (port PRM prmEvents.ts)
// ----------------------------------------------------------------------------
// Mỗi tab CSKH tự tải dữ liệu nên không biết khi tab khác vừa ghi. Hai sự kiện window:
//   cskh:data-changed — vừa ghi nhật ký / người liên hệ ở nơi khác → tải lại
//   cskh:quick-log    — yêu cầu mở bottom sheet "Đã liên hệ" cho 1 người
// ============================================================================
import type { ContactActionChannel } from './contactActions';

const DATA_CHANGED = 'cskh:data-changed';
const QUICK_LOG = 'cskh:quick-log';

export interface QuickLogRequest {
  contactId: string;
  /** Kênh đã dùng; null = ghi nhận thủ công (gặp trực tiếp). */
  channel: ContactActionChannel | null;
}

export function emitCskhDataChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(DATA_CHANGED));
}

/** Đăng ký nghe; trả về hàm huỷ (dùng thẳng trong useEffect). */
export function onCskhDataChanged(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(DATA_CHANGED, cb);
  return () => window.removeEventListener(DATA_CHANGED, cb);
}

export function requestQuickLog(req: QuickLogRequest): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<QuickLogRequest>(QUICK_LOG, { detail: req }));
}

export function onQuickLogRequest(cb: (req: QuickLogRequest) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = (e: Event) => cb((e as CustomEvent<QuickLogRequest>).detail);
  window.addEventListener(QUICK_LOG, handler);
  return () => window.removeEventListener(QUICK_LOG, handler);
}
