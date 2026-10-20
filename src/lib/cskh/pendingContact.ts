// ============================================================================
// CSKH — "Liên hệ đang chờ xác nhận" (port PRM pendingContact.ts)
// ----------------------------------------------------------------------------
// Bấm Gọi/Zalo/SMS → lưu {contactId, kênh, thời điểm}. Khi app hiện lại
// (visibilitychange / pageshow / focus) mà còn bản ghi này → hỏi
// "Đã liên hệ với X qua Zalo?". Quay lại sớm hơn 3 giây = chưa kịp liên hệ;
// quá 12 giờ thì tự huỷ. Storage được truyền vào (localStorage thật ở trình
// duyệt, Map giả ở test) — có bộ nhớ dự phòng khi localStorage bị chặn.
// ============================================================================
import type { ContactActionChannel } from './contactActions';

export interface PendingContact {
  contactId: string;
  channel: ContactActionChannel;
  /** epoch ms lúc bấm nút. */
  startedAt: number;
}

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const PENDING_KEY = 'lgvn_cskh_pending_contact';
/** Quá 12 giờ thì tự huỷ, không hỏi nữa. */
export const PENDING_MAX_AGE_MS = 12 * 60 * 60 * 1000;
/** Quay lại app sớm hơn 3 giây = chưa kịp liên hệ (VD mở Zalo thất bại) → chưa hỏi. */
export const PENDING_MIN_AGE_MS = 3000;

const CHANNELS: readonly string[] = ['call', 'zalo', 'sms'];

export function savePending(storage: KeyValueStorage, pending: PendingContact): void {
  try {
    storage.setItem(PENDING_KEY, JSON.stringify(pending));
  } catch {
    // storage đầy / bị chặn (chế độ riêng tư) — bỏ qua, tính năng chỉ là tiện ích
  }
}

export function clearPending(storage: KeyValueStorage): void {
  try {
    storage.removeItem(PENDING_KEY);
  } catch {
    // bỏ qua
  }
}

/** Đọc bản ghi chờ xác nhận. Hỏng / sai định dạng / hết hạn / ở tương lai xa → xoá và trả null. */
export function loadPending(storage: KeyValueStorage, now: number): PendingContact | null {
  let raw: string | null = null;
  try {
    raw = storage.getItem(PENDING_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  try {
    const p = JSON.parse(raw) as Partial<PendingContact> | null;
    const valid =
      p !== null &&
      typeof p === 'object' &&
      typeof p.contactId === 'string' &&
      p.contactId !== '' &&
      typeof p.channel === 'string' &&
      CHANNELS.includes(p.channel) &&
      typeof p.startedAt === 'number' &&
      Number.isFinite(p.startedAt);
    if (!valid) {
      clearPending(storage);
      return null;
    }
    const pending = p as PendingContact;
    const age = now - pending.startedAt;
    if (age > PENDING_MAX_AGE_MS || age < -60_000) {
      clearPending(storage);
      return null;
    }
    return pending;
  } catch {
    clearPending(storage);
    return null;
  }
}

/** Đã đủ lâu để hỏi xác nhận chưa (tránh hỏi ngay khi vừa bấm nút). */
export function isPendingReady(pending: PendingContact, now: number): boolean {
  return now - pending.startedAt >= PENDING_MIN_AGE_MS;
}

/** localStorage nếu dùng được, không thì Map trong bộ nhớ (mất khi tải lại trang nhưng vẫn chạy trong phiên). */
export function createSafeStorage(): KeyValueStorage {
  const memory = new Map<string, string>();
  const local = (): Storage | null => {
    try {
      return typeof window !== 'undefined' ? window.localStorage : null;
    } catch {
      return null;
    }
  };
  return {
    getItem(key) {
      try {
        const v = local()?.getItem(key);
        if (v !== undefined && v !== null) return v;
      } catch {
        // rơi xuống bộ nhớ
      }
      return memory.get(key) ?? null;
    },
    setItem(key, value) {
      memory.set(key, value);
      try {
        local()?.setItem(key, value);
      } catch {
        // chỉ còn bản trong bộ nhớ
      }
    },
    removeItem(key) {
      memory.delete(key);
      try {
        local()?.removeItem(key);
      } catch {
        // bỏ qua
      }
    },
  };
}

let sharedStorage: KeyValueStorage | null = null;

/** Một storage dùng chung cho nút bấm (ghi) và bottom sheet (đọc) — chung cả bộ nhớ dự phòng. */
export function getPendingStorage(): KeyValueStorage {
  if (!sharedStorage) sharedStorage = createSafeStorage();
  return sharedStorage;
}
