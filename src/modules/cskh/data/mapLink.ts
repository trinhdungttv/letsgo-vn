// Toạ độ từ link Google Maps (port PRM hooks/useMapLink.ts): link đầy đủ đọc thẳng;
// link rút gọn (maps.app.goo.gl) mở qua api/resolve-map (server, cần phiên đăng nhập).
import { useEffect, useMemo, useState } from 'react';
import { extractLatLng, isShortMapLink, placeNameFromLink, type LatLng } from '../../../lib/cskh/nearby';

export interface MapLinkInfo {
  /** empty = chưa dán; resolving = đang mở link rút gọn; ok = có toạ độ; nocoords = link không có toạ độ; fail = không mở được. */
  status: 'empty' | 'resolving' | 'ok' | 'nocoords' | 'fail';
  coords: LatLng | null;
  /** Tên nơi trong link (nếu có) — dùng cho "Tìm hiểu vùng miền". */
  place: string;
}

interface Resolved {
  url: string;
  coords: LatLng | null;
}

// Mỗi link rút gọn chỉ mở 1 lần mỗi phiên (mở lại hồ sơ không gọi lại server)
const cache = new Map<string, Promise<Resolved | null>>();

function resolveShort(url: string, token: string | null): Promise<Resolved | null> {
  const hit = cache.get(url);
  if (hit) return hit;
  const p = (async () => {
    try {
      const res = await fetch('/api/resolve-map', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { 'x-letsgo-token': token } : {}) },
        body: JSON.stringify({ url }),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { url?: string };
      if (typeof data.url !== 'string') return null;
      return { url: data.url, coords: extractLatLng(data.url) };
    } catch {
      return null;
    }
  })();
  cache.set(url, p);
  // Lỗi mạng thì cho thử lại lần sau
  void p.then(r => { if (!r) cache.delete(url); });
  return p;
}

/** Toạ độ của 1 link Google Maps bất kỳ (dùng khi lưu / định vị hàng loạt). */
export async function mapLinkCoords(raw: string, token: string | null): Promise<LatLng | null> {
  const url = raw.trim();
  if (!url) return null;
  const direct = extractLatLng(url);
  if (direct) return direct;
  if (!isShortMapLink(url)) return null;
  return (await resolveShort(url, token))?.coords ?? null;
}

/** Thông tin vị trí của 1 link (truyền giá trị đã trễ để không gọi theo từng phím gõ). */
export function useMapLink(raw: string, token: string | null): MapLinkInfo {
  const url = raw.trim();
  const direct = useMemo((): MapLinkInfo | null => {
    if (!url) return { status: 'empty', coords: null, place: '' };
    const coords = extractLatLng(url);
    if (coords) return { status: 'ok', coords, place: placeNameFromLink(url) };
    if (!isShortMapLink(url)) return { status: 'nocoords', coords: null, place: placeNameFromLink(url) };
    return null; // link rút gọn → phải mở qua server
  }, [url]);

  const [resolved, setResolved] = useState<{ url: string; info: MapLinkInfo } | null>(null);
  useEffect(() => {
    if (direct || !url) return;
    let cancelled = false;
    void resolveShort(url, token).then(r => {
      if (cancelled) return;
      setResolved({
        url,
        info: r
          ? { status: r.coords ? 'ok' : 'nocoords', coords: r.coords, place: placeNameFromLink(r.url) }
          : { status: 'fail', coords: null, place: '' },
      });
    });
    return () => { cancelled = true; };
  }, [url, direct, token]);

  if (direct) return direct;
  return resolved?.url === url ? resolved.info : { status: 'resolving', coords: null, place: '' };
}
