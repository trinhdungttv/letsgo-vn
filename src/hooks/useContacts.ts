import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { Contact } from '../lib/types';

/**
 * Đọc danh sách người liên hệ của MỘT công ty.
 * Hook này chỉ đọc — mọi thao tác thêm/sửa/gắn công ty/ngưng/xoá đều nằm ở
 * `lib/contactOps.ts` để trang Khách hàng và trang CSKH chạy chung một logic.
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
      const { data, error: err } = await supabase
        .from('contacts')
        .select('*, clients(name)')
        .eq('client_id', clientId)
        .order('is_primary', { ascending: false })
        .order('is_active', { ascending: false })
        .order('created_at', { ascending: false });
      if (err) throw err;
      setContacts((data || []) as Contact[]);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => { load(); }, [load]);

  return { contacts, loading, error, reload: load };
}
