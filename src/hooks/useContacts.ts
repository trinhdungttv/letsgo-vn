import { useState, useEffect, useCallback } from 'react';
import { fetchContactsOfClient } from '../lib/contactOps';
import type { Contact } from '../lib/types';

/**
 * Đọc danh sách người liên hệ của MỘT công ty.
 * Hook này chỉ đọc — mọi thao tác thêm/sửa/gắn công ty/ngưng/xoá đều nằm ở
 * `lib/contactOps.ts` để trang Khách hàng và trang CSKH chạy chung một logic.
 *
 * Từ migration 145 quan hệ nằm ở bảng nối `contact_clients` và một người phụ
 * trách được nhiều công ty; `fetchContactsOfClient` lo phần đó, kể cả khi DB
 * chưa kịp chạy migration.
 */
export function useContacts(clientId: string) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!clientId) { setContacts([]); return; }
    setLoading(true);
    setError(null);
    try {
      setContacts(await fetchContactsOfClient(clientId));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => { load(); }, [load]);

  return { contacts, loading, error, reload: load };
}
