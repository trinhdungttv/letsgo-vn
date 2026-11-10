import { useCallback, useEffect, useRef, useState } from 'react';
import { listEntities } from '../../../lib/costPlan/api';
import type { QuoteEntity } from '../../../lib/costPlan/entity';

const LAST_KEY = 'lgvn_doc_entity';
export const lastEntityId = (): string | null => { try { return localStorage.getItem(LAST_KEY); } catch { return null; } };
export const rememberEntity = (id: string) => { try { localStorage.setItem(LAST_KEY, id); } catch { /* chế độ riêng tư */ } };

/**
 * Danh sách pháp nhân cho giấy tờ (thông tin từ Pháp lý + bộ chữ ký / con dấu). Chưa đăng nhập hoặc chưa chạy
 * migration 161 → danh sách rỗng (kèm thông báo lỗi nếu có). Quay lại tab này (vd vừa sửa ở Pháp lý) → tự tải lại.
 */
export function useEntities(token: string | null) {
  const [entities, setEntities] = useState<QuoteEntity[]>([]);
  const [canSign, setCanSign] = useState(false);
  const [canStamp, setCanStamp] = useState(false);
  const [loading, setLoading] = useState(!!token);
  const [err, setErr] = useState<string | null>(null);
  const reload = useCallback(async () => {
    if (!token) { setLoading(false); return; }
    try { const r = await listEntities(token); setEntities(r.entities); setCanSign(r.canSign); setCanStamp(r.canStamp); setErr(null); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setLoading(false);
  }, [token]);
  useEffect(() => { reload(); }, [reload]);

  const last = useRef(0);
  useEffect(() => {
    const onBack = () => {
      if (document.visibilityState !== 'visible' || Date.now() - last.current < 15_000) return;
      last.current = Date.now();
      void reload();
    };
    window.addEventListener('focus', onBack);
    document.addEventListener('visibilitychange', onBack);
    return () => { window.removeEventListener('focus', onBack); document.removeEventListener('visibilitychange', onBack); };
  }, [reload]);
  return { entities, canSign, canStamp, loading, err, reload };
}

/** Mở trang Pháp lý ở TAB MỚI, đúng pháp nhân (không rời giấy tờ đang làm dở ở tab này). */
export function openLegalEntity(legalId: string | null) {
  try {
    const raw = JSON.parse(localStorage.getItem('legal-place') || '{}') as Record<string, unknown>;
    localStorage.setItem('legal-place', JSON.stringify({ ...raw, tab: 'entities', entityId: legalId ?? raw.entityId ?? null, entityTab: 'overview' }));
  } catch { /* bỏ qua */ }
  window.open(`${window.location.origin}${window.location.pathname}#/legal`, '_blank', 'noopener');
}
