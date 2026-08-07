import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * Encode UUID to short base62 string (~22 chars) and back.
 */
const B62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

export function shortId(uuid: string): string {
  const hex = uuid.replace(/-/g, '');
  let num = BigInt('0x' + hex);
  if (num === 0n) return '0';
  let s = '';
  while (num > 0n) {
    s = B62[Number(num % 62n)] + s;
    num = num / 62n;
  }
  return s;
}

export function expandId(short: string, items: { id: string }[]): string | null {
  for (const item of items) {
    if (shortId(item.id) === short) return item.id;
  }
  return null;
}

/**
 * Mã siêu ngắn cho URL: lấy vài ký tự ĐẦU của shortId(), độ dài vừa đủ để không
 * trùng với item nào khác trong danh sách hiện tại (thường 3-4 ký tự thay vì 22).
 * Vẫn tương thích ngược với link cũ dùng shortId() đầy đủ — vì chuỗi đầy đủ luôn
 * "bắt đầu bằng chính nó", expandTinyId() bên dưới vẫn giải mã đúng.
 */
export function tinyId(id: string, items: { id: string }[], minLen = 3): string {
  const full = shortId(id);
  for (let len = minLen; len < full.length; len++) {
    const prefix = full.slice(0, len);
    const collides = items.some(it => it.id !== id && shortId(it.id).startsWith(prefix));
    if (!collides) return prefix;
  }
  return full;
}

/** Giải mã tinyId() (hoặc shortId() cũ, đầy đủ) — khớp theo tiền tố duy nhất trong danh sách. */
export function expandTinyId(short: string, items: { id: string }[]): string | null {
  const matches = items.filter(it => shortId(it.id).startsWith(short));
  return matches.length === 1 ? matches[0].id : null;
}

interface UseHashSubRouteOptions<T extends string> {
  page: string;
  validTabs: readonly T[];
  defaultTab: T;
  items?: { id: string }[];
}

export function useHashSubRoute<T extends string>({ page, validTabs, defaultTab, items }: UseHashSubRouteOptions<T>) {
  function parseFromHash(): { itemId: string | null; tab: T } {
    const parts = window.location.hash.replace('#/', '').split('/');
    if (parts[0] !== page) return { itemId: null, tab: defaultTab };
    const shortOrId = parts[1] || null;
    let itemId: string | null = null;
    if (shortOrId && items?.length) {
      itemId = expandId(shortOrId, items) || items.find(i => i.id === shortOrId)?.id || null;
    } else if (shortOrId && !items) {
      itemId = shortOrId;
    }
    const rawTab = parts[2] as T;
    const tab = rawTab && (validTabs as readonly string[]).includes(rawTab) ? rawTab : defaultTab;
    return { itemId, tab };
  }

  const [selectedId, setSelectedIdRaw] = useState<string | null>(() => parseFromHash().itemId);
  const [activeTab, setActiveTabRaw] = useState<T>(() => parseFromHash().tab);
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const syncRef = useRef(true);

  // Re-resolve short ID once items load
  useEffect(() => {
    if (selectedId || !items?.length) return;
    const { itemId, tab } = parseFromHash();
    if (itemId) {
      setSelectedIdRaw(itemId);
      setActiveTabRaw(tab);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  const updateHash = useCallback((id: string | null, tab: T) => {
    const sid = id && items ? shortId(id) : id;
    const hash = sid ? `#/${page}/${sid}/${tab}` : `#/${page}`;
    if (window.location.hash !== hash) {
      syncRef.current = false;
      window.history.pushState(null, '', hash);
    }
  }, [page, items]);

  const setSelectedId = useCallback((id: string | null) => {
    setSelectedIdRaw(id);
    setActiveTabRaw(defaultTab);
    updateHash(id, defaultTab);
  }, [updateHash, defaultTab]);

  const setActiveTab = useCallback((tab: T) => {
    setActiveTabRaw(tab);
    updateHash(selectedIdRef.current, tab);
  }, [updateHash]);

  useEffect(() => {
    const onNav = () => {
      if (!syncRef.current) { syncRef.current = true; return; }
      const { itemId, tab } = parseFromHash();
      setSelectedIdRaw(itemId);
      setActiveTabRaw(tab);
    };
    window.addEventListener('popstate', onNav);
    return () => window.removeEventListener('popstate', onNav);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  return { selectedId, setSelectedId, activeTab, setActiveTab };
}

/**
 * Simpler version for pages that only have tabs (no item selection).
 */
export function useHashTab<T extends string>(page: string, validTabs: readonly T[], defaultTab: T, tabSegment = 1) {
  function parseTab(): T {
    const parts = window.location.hash.replace('#/', '').split('/');
    if (parts[0] !== page) return defaultTab;
    const raw = parts[tabSegment] as T;
    return raw && (validTabs as readonly string[]).includes(raw) ? raw : defaultTab;
  }

  const [tab, setTabRaw] = useState<T>(parseTab);
  const syncRef = useRef(true);

  const setTab = useCallback((t: T) => {
    setTabRaw(t);
    const parts = window.location.hash.replace('#/', '').split('/');
    const newParts = parts.slice(0, tabSegment);
    while (newParts.length < tabSegment) newParts.push('');
    newParts[0] = page;
    newParts[tabSegment] = t;
    const hash = '#/' + newParts.join('/');
    if (window.location.hash !== hash) {
      syncRef.current = false;
      window.history.pushState(null, '', hash);
    }
  }, [page, tabSegment]);

  useEffect(() => {
    const onNav = () => {
      if (!syncRef.current) { syncRef.current = true; return; }
      setTabRaw(parseTab());
    };
    window.addEventListener('popstate', onNav);
    return () => window.removeEventListener('popstate', onNav);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return [tab, setTab] as const;
}
