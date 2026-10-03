// Làm RÕ / NÉT / ĐẬM màu cho ảnh chữ ký (mực xanh) và con dấu (mực đỏ) — ảnh scan thường nhạt, mờ, ngả xám nên khi đặt lên báo giá
// không giống bản ký/đóng dấu thật. Phần tính toán là hàm THUẦN trên mảng RGBA (test được); phần canvas bọc bên ngoài.
//
// Với mức L (0..1; 0 = giữ nguyên ảnh):
//   1) lượng mực s của từng điểm: ảnh đã tách nền → độ đục; ảnh còn nền giấy → độ tối (đã bỏ phần "sương" giấy)
//   2) kéo nét: nâng phần mực nhạt (gamma) rồi đẩy tương phản (mực vừa → đặc hẳn, nền → trong suốt hẳn)
//   3) làm đậm: nét được loe nhẹ sang điểm bên cạnh (nét mảnh của chữ ký dày lên)
//   4) đổi màu mực về xanh đậm (chữ ký) / đỏ đậm (con dấu) theo mức, để scan nhạt hay ngả màu vẫn ra màu thật
export type InkKind = 'sig' | 'seal';
const INK: Record<InkKind, [number, number, number]> = { sig: [12, 38, 150], seal: [205, 20, 28] };
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function enhanceInkPixels(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number, kind: InkKind, level: number): Uint8ClampedArray {
  const L = clamp01(level);
  const out = new Uint8ClampedArray(rgba);
  if (L <= 0) return out;
  const n = w * h;
  const s = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2], a = rgba[i * 4 + 3] / 255;
    if (a < 0.98) s[i] = a;                                                        // ảnh đã tách nền: độ đục = lượng mực
    else s[i] = clamp01(((1 - (0.299 * r + 0.587 * g + 0.114 * b) / 255) - 0.10) / 0.55);   // còn nền giấy: tối = có mực
  }
  const gamma = 1 / (1 + 2.2 * L), lo = 0.12 * L, hi = 1 - 0.25 * L;
  const t = new Float32Array(n);
  for (let i = 0; i < n; i++) t[i] = clamp01((Math.pow(s[i], gamma) - lo) / (hi - lo));
  const bold = 0.55 * L;
  const fin = new Float32Array(n);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    let m = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      const v = t[yy * w + xx]; if (v > m) m = v;
    }
    fin[i] = Math.max(t[i], m * bold);
  }
  const k = Math.min(1, 0.35 + 0.8 * L);                                           // mức "nhuộm" về màu mực chuẩn
  const T = INK[kind];
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) out[i * 4 + c] = Math.round(rgba[i * 4 + c] * (1 - k) + T[c] * k);
    out[i * 4 + 3] = Math.round(fin[i] * 255);
  }
  return out;
}

// ── Canvas ──
const cache = new Map<string, string>();
const MAX_SIDE = 1100;

/** PNG data URL đã làm rõ. Mức 0 hoặc môi trường không có canvas → trả nguyên ảnh. Có nhớ kết quả (kéo thanh trượt không tính lại cái đã có). */
export async function enhanceInk(src: string | null | undefined, kind: InkKind, level: number): Promise<string | null> {
  if (!src) return null;
  const L = Math.round(clamp01(level) * 100) / 100;
  if (L <= 0 || typeof document === 'undefined') return src;
  const key = `${kind}|${L}|${src.length}|${src.slice(-48)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('img')); im.src = src; });
    const k = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d'); if (!ctx) return src;
    ctx.drawImage(img, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h);
    d.data.set(enhanceInkPixels(d.data, w, h, kind, L));
    ctx.putImageData(d, 0, 0);
    const url = c.toDataURL('image/png');
    if (cache.size > 24) cache.delete(cache.keys().next().value as string);
    cache.set(key, url);
    return url;
  } catch { return src; }
}
