import { useCallback, useEffect, useState } from 'react';
import { loadSheetTemplate, saveSheetTemplate, type SheetTemplate } from '../../../lib/costPlan/sheetTemplate';
import type { QuoteSheet } from '../../../lib/costPlan/types';

// Mẫu bảng giá chung — đọc 1 lần cho cả màn (danh sách phương án + bảng giá), lưu xong báo các nơi khác nạp lại.
let cache: SheetTemplate | null | undefined;
let pending: Promise<SheetTemplate | null> | null = null;
const EVT = 'lgvn:sheet-template-changed';

function fetchOnce(): Promise<SheetTemplate | null> {
  if (cache !== undefined) return Promise.resolve(cache);
  pending ??= loadSheetTemplate().then(t => { cache = t; return t; }).catch(() => { cache = null; return null; }).finally(() => { pending = null; });
  return pending;
}

export function useSheetTemplate() {
  const [tpl, setTpl] = useState<SheetTemplate | null>(cache ?? null);
  useEffect(() => {
    let alive = true;
    fetchOnce().then(t => { if (alive) setTpl(t); });
    const h = () => { if (alive) setTpl(cache ?? null); };
    window.addEventListener(EVT, h);
    return () => { alive = false; window.removeEventListener(EVT, h); };
  }, []);
  const save = useCallback(async (q: QuoteSheet, by: string | null) => {
    const t = await saveSheetTemplate(q, by);
    cache = t;
    window.dispatchEvent(new Event(EVT));
    return t;
  }, []);
  return { tpl, save };
}
