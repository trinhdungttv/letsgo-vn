// Kiểm tra link ảnh trước khi máy chủ tải về (chống bị lợi dụng để dò mạng nội bộ) + nhận dạng định dạng ảnh qua
// "chữ ký đầu file". Thuần hàm — dùng ở api/r2-import.ts và test.

/** Chỉ https; chặn địa chỉ IP thô (nhất là mạng nội bộ), localhost, tên miền nội bộ, cổng lạ. */
export function safeImageUrl(raw: string): URL | null {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  if (u.username || u.password) return null;
  if (u.port && u.port !== '443') return null;
  const h = u.hostname.toLowerCase();
  if (!h.includes('.') || h === 'localhost' || /\.(local|internal|localdomain|lan|home|corp|intranet)$/.test(h)) return null;
  // IPv4 / IPv6 thô → không nhận (ảnh thật luôn có tên miền)
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(':') || h.startsWith('[')) return null;
  return u;
}

export type ImageKind = { ext: 'jpg' | 'png' | 'webp' | 'gif'; mime: string };

/** Định dạng ảnh theo vài byte đầu (không tin Content-Type của máy chủ lạ). SVG không nhận (có thể chứa mã). */
export function sniffImage(b: Uint8Array): ImageKind | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' };
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { ext: 'png', mime: 'image/png' };
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return { ext: 'webp', mime: 'image/webp' };
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return { ext: 'gif', mime: 'image/gif' };
  return null;
}

export const MAX_IMPORT_BYTES = 8 * 1024 * 1024;
