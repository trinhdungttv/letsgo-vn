import { useCallback, useEffect, useState } from 'react';
import { listEntities } from '../../../lib/costPlan/api';
import type { QuoteEntity } from '../../../lib/costPlan/entity';

const LAST_KEY = 'lgvn_doc_entity';
export const lastEntityId = (): string | null => { try { return localStorage.getItem(LAST_KEY); } catch { return null; } };
export const rememberEntity = (id: string) => { try { localStorage.setItem(LAST_KEY, id); } catch { /* chế độ riêng tư */ } };

/** Danh sách pháp nhân gửi báo giá. Chưa đăng nhập hoặc chưa chạy migration 161 → danh sách rỗng (kèm thông báo lỗi nếu có). */
export function useEntities(token: string | null) {
  const [entities, setEntities] = useState<QuoteEntity[]>([]);
  const [canSign, setCanSign] = useState(false);
  const [loading, setLoading] = useState(!!token);
  const [err, setErr] = useState<string | null>(null);
  const reload = useCallback(async () => {
    if (!token) { setLoading(false); return; }
    try { const r = await listEntities(token); setEntities(r.entities); setCanSign(r.canSign); setErr(null); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setLoading(false);
  }, [token]);
  useEffect(() => { reload(); }, [reload]);
  return { entities, canSign, loading, err, reload };
}
