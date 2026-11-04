// Pháp lý — tự lưu có độ trễ (sơ đồ, bài học, thẻ ghi nhớ, ghi chú khi đọc). Rời trang / đóng tài liệu / ẩn tab
// thì gửi nốt phần đang chờ. Lỗi → giữ lại để thử lại lần sửa sau hoặc khi bấm "Chưa lưu — thử lại".
import { useCallback, useEffect, useRef, useState } from 'react';

export type SaveState = { s: 'idle' } | { s: 'saving' } | { s: 'saved'; at: string } | { s: 'error'; msg: string };

export function useAutosave<T>(save: (value: T) => Promise<string>, delay = 1200) {
  const [state, setState] = useState<SaveState>({ s: 'idle' });
  const pending = useRef<{ v: T } | null>(null);
  const busy = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveRef = useRef(save);
  saveRef.current = save;

  const flush = useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (busy.current || !pending.current) return;
    const { v } = pending.current;
    pending.current = null;
    busy.current = true;
    setState({ s: 'saving' });
    try {
      const at = await saveRef.current(v);
      setState({ s: 'saved', at });
    } catch (e) {
      if (!pending.current) pending.current = { v };
      setState({ s: 'error', msg: (e as Error).message ?? 'lỗi không rõ' });
    } finally {
      busy.current = false;
    }
    if (pending.current && !timer.current) timer.current = setTimeout(() => { void flush(); }, delay);
  }, [delay]);

  const queue = useCallback((v: T) => {
    pending.current = { v };
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void flush(); }, delay);
  }, [flush, delay]);

  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => {
    const onHide = () => { void flushRef.current(); };
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onHide);
      void flushRef.current();
    };
  }, []);

  return { state, queue, flush, setState };
}
