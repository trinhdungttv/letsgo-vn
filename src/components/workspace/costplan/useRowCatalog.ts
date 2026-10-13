import { useCallback, useEffect, useState } from 'react';
import { loadCatalog, removeFromCatalog, saveCatalog, upsertCatalog, type CatalogItem } from '../../../lib/costPlan/rowCatalog';

// Kho đầu mục của công ty — đọc 1 lần (cache module), thêm/xoá xong báo các nơi khác nạp lại.
let cache: CatalogItem[] | undefined;
let pending: Promise<CatalogItem[]> | null = null;
const EVT = 'lgvn:row-catalog-changed';

function fetchOnce(): Promise<CatalogItem[]> {
  if (cache !== undefined) return Promise.resolve(cache);
  pending ??= loadCatalog().then(l => { cache = l; return l; }).catch(() => { cache = []; return []; }).finally(() => { pending = null; });
  return pending;
}

export function useRowCatalog() {
  const [mine, setMine] = useState<CatalogItem[]>(cache ?? []);
  useEffect(() => {
    let alive = true;
    fetchOnce().then(l => { if (alive) setMine(l); });
    const h = () => { if (alive) setMine(cache ?? []); };
    window.addEventListener(EVT, h);
    return () => { alive = false; window.removeEventListener(EVT, h); };
  }, []);
  const commit = useCallback(async (next: CatalogItem[]) => {
    await saveCatalog(next);
    cache = next;
    window.dispatchEvent(new Event(EVT));
  }, []);
  const add = useCallback((it: CatalogItem) => commit(upsertCatalog(cache ?? [], it)), [commit]);
  const remove = useCallback((id: string) => commit(removeFromCatalog(cache ?? [], id)), [commit]);
  return { mine, add, remove };
}
