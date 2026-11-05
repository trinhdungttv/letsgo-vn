// Kho tạm trên máy (IndexedDB) cho ghi âm CRM chưa lên Storage: (1) NHÁP lưu mỗi ~10 giây khi đang ghi — tắt trang / sập tab
// đột ngột vẫn còn phần đã ghi; (2) bản đã dừng nhưng tải lên lỗi (mất mạng…). Lần mở app sau tự tải lên nốt rồi mới xoá.
// Máy chặn IndexedDB (chế độ riêng tư) → các hàm trả rỗng / false, không báo lỗi.
import type { VoiceSubject } from './api';

const DB_NAME = 'letsgo-crm-voice';
const STORE = 'pending';

export interface PendingVoice {
  /** mã cố định của 1 lần ghi — nháp sau ghi đè nháp trước, lên Storage xong thì xoá */
  id: string;
  userId: string;
  userName: string;
  type: VoiceSubject;
  subjectId: string;
  relatedDate: string | null;
  title: string;
  blob: Blob;
  mime: string;
  ext: string;
  durationSec: number;
  recordedAt: string;
  /** true = nháp của lần ghi đang chạy (chưa bấm Dừng) */
  draft: boolean;
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise(resolve => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' }); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest, fallback: T): Promise<T> {
  const db = await openDb();
  if (!db) return fallback;
  return new Promise(resolve => {
    try {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => { db.close(); resolve((req.result as T) ?? fallback); };
      tx.onerror = () => { db.close(); resolve(fallback); };
      tx.onabort = () => { db.close(); resolve(fallback); };
    } catch { db.close(); resolve(fallback); }
  });
}

export const stashVoice = async (item: PendingVoice): Promise<boolean> => (await run<IDBValidKey | null>('readwrite', s => s.put(item), null)) !== null;
export const dropVoice = async (id: string): Promise<void> => { await run<undefined>('readwrite', s => s.delete(id), undefined); };
export async function listStashedVoice(userId: string): Promise<PendingVoice[]> {
  const all = await run<PendingVoice[]>('readonly', s => s.getAll(), []);
  return all.filter(a => a.userId === userId && a.blob instanceof Blob);
}
