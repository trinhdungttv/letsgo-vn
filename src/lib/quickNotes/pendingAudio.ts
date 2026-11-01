// Kho tạm trên máy (IndexedDB) cho bản ghi âm đã thu xong nhưng chưa lên Storage — mất mạng, server chưa cấu hình,
// lỡ tải lại trang… thì lần mở app sau vẫn còn để tải lên tiếp. Tải lên xong mới xoá khỏi kho.
// Máy chặn IndexedDB (chế độ riêng tư) → các hàm trả về rỗng / false, bản ghi chỉ còn trong bộ nhớ của trang.
import type { PendingAudio } from './types';

const DB_NAME = 'letsgo-quick-notes';
const STORE = 'pending-audio';

function openDb(): Promise<IDBDatabase | null> {
  return new Promise(resolve => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
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
    } catch {
      db.close();
      resolve(fallback);
    }
  });
}

/** true = đã giữ được trên máy. */
export async function stashAudio(item: PendingAudio): Promise<boolean> {
  const ok = await run<IDBValidKey | null>('readwrite', s => s.put(item), null);
  return ok !== null;
}

export async function listStashedAudio(userId: string): Promise<PendingAudio[]> {
  const all = await run<PendingAudio[]>('readonly', s => s.getAll(), []);
  return all.filter(a => a.userId === userId && a.blob instanceof Blob);
}

export async function dropStashedAudio(id: string): Promise<void> {
  await run<undefined>('readwrite', s => s.delete(id), undefined);
}

/** Lưu file về máy (khi không tải lên được). */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
