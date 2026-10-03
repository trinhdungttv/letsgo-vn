import { useEffect, useState } from 'react';
import { enhanceInk, type InkKind } from '../../../lib/imageInk';

/** Ảnh chữ ký / con dấu đã làm rõ theo mức (0 = nguyên bản). Trong lúc tính vẫn hiện ảnh gốc, không nhấp nháy trống. */
export function useInk(src: string | null | undefined, kind: InkKind, level: number): string | null {
  const [url, setUrl] = useState<string | null>(src ?? null);
  useEffect(() => {
    let on = true;
    if (!src) { setUrl(null); return; }
    enhanceInk(src, kind, level).then(r => { if (on) setUrl(r); });
    return () => { on = false; };
  }, [src, kind, level]);
  return src ? url ?? src : null;
}
