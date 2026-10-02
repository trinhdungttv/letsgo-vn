import { useEffect, useMemo, useState } from 'react';

export type LinkHealth = 'checking' | 'live' | 'dead' | 'unknown';
export type LinkHealthInfo = { status: LinkHealth; reason?: string };

const TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; info: LinkHealthInfo }>();

/** Hỏi server (api/check-link) xem các link còn sống không. Kết quả nhớ 10 phút trong phiên. */
export function useLinkHealth(urls: string[]): Record<string, LinkHealthInfo> {
  const key = useMemo(() => [...new Set(urls.map(u => u.trim()).filter(Boolean))].sort().join('\n'), [urls]);
  const [, bump] = useState(0);

  useEffect(() => {
    const list = key ? key.split('\n') : [];
    const stale = list.filter(u => { const c = cache.get(u); return !c || Date.now() - c.at > TTL_MS; });
    if (!stale.length) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/check-link', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ urls: stale }),
        });
        if (!res.ok) throw new Error(String(res.status));
        const { results } = await res.json() as { results: Record<string, LinkHealthInfo> };
        stale.forEach(u => cache.set(u, { at: Date.now(), info: results[u] ?? { status: 'unknown' } }));
      } catch {
        // Không gọi được server kiểm tra → xám (không rõ), không báo đỏ oan.
        stale.forEach(u => cache.set(u, { at: Date.now() - TTL_MS + 30_000, info: { status: 'unknown', reason: 'Không gọi được máy chủ kiểm tra' } }));
      }
      if (!cancelled) bump(n => n + 1);
    })();
    return () => { cancelled = true; };
  }, [key]);

  const out: Record<string, LinkHealthInfo> = {};
  (key ? key.split('\n') : []).forEach(u => { out[u] = cache.get(u)?.info ?? { status: 'checking' }; });
  return out;
}
