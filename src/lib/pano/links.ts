// Nhận dạng link ảnh 360° người dùng dán (Google Photos / Google Drive / link ảnh trực tiếp) + bóc link ảnh gốc từ trang
// chia sẻ Google Photos. Thuần hàm — dùng ở api/pano-import.ts, form thêm ảnh và test (pano.test.ts).

export type PanoLinkKind = 'gphotos' | 'gdrive' | 'gimage' | 'url';

export interface PanoLink { kind: PanoLinkKind; url: string; driveId?: string }

const GOOGLE_PHOTOS_HOSTS = /^(photos\.app\.goo\.gl|photos\.google\.com|goo\.gl)$/i;
const DRIVE_HOSTS = /^(drive\.google\.com|docs\.google\.com|drive\.usercontent\.google\.com)$/i;

/** Mã file Google Drive trong link (…/file/d/<mã>/view, …?id=<mã>, …/uc?id=<mã>). */
export function driveFileId(raw: string): string | null {
  const m = raw.match(/\/d\/([A-Za-z0-9_-]{20,})/) ?? raw.match(/[?&]id=([A-Za-z0-9_-]{20,})/);
  return m ? m[1] : null;
}

/** Phân loại link. null = không phải link https dùng được. */
export function classifyPanoLink(raw: string): PanoLink | null {
  const text = raw.trim();
  // Dán cả đoạn tin nhắn có link → lấy link đầu tiên
  const found = text.match(/https:\/\/[^\s<>"']+/);
  if (!found) return null;
  let u: URL;
  try { u = new URL(found[0]); } catch { return null; }
  const host = u.hostname.toLowerCase();
  if (GOOGLE_PHOTOS_HOSTS.test(host)) {
    if (host === 'goo.gl' && !u.pathname.startsWith('/photos')) return null;
    return { kind: 'gphotos', url: u.toString() };
  }
  if (DRIVE_HOSTS.test(host)) {
    const id = driveFileId(u.toString());
    return id ? { kind: 'gdrive', url: u.toString(), driveId: id } : null;
  }
  if (/^lh\d\.googleusercontent\.com$/.test(host)) return { kind: 'gimage', url: u.toString() };
  return { kind: 'url', url: u.toString() };
}

/** Link lh3 của Google: bỏ phần tham số cỡ ảnh ở đuôi (=w1920-h1080-no…) để tự gắn lại cỡ cần lấy. */
export function googleImageBase(url: string): string {
  return url.replace(/=[a-z][a-z0-9-]*$/i, '').replace(/=$/, '');
}

export interface PhotoCandidate { url: string; width: number; height: number }

/**
 * Trang chia sẻ Google Photos (photos.google.com/share/…) chứa dữ liệu dạng ["https://lh3.googleusercontent.com/pw/…",rộng,cao,…]
 * cho từng ảnh trong album → lấy danh sách ảnh (bỏ trùng, giữ thứ tự xuất hiện).
 */
export function extractPhotoCandidates(html: string): PhotoCandidate[] {
  const out: PhotoCandidate[] = [];
  const seen = new Set<string>();
  const re = /\["(https:\/\/lh\d\.googleusercontent\.com\/pw\/[A-Za-z0-9_-]+)",(\d+),(\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < 200) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    out.push({ url: m[1], width: Number(m[2]), height: Number(m[3]) });
  }
  return out;
}

/** Ảnh trông giống ảnh 360° trọn (tỉ lệ ~2:1). */
export const looksSpherical = (w: number, h: number) => h > 0 && Math.abs(w / h - 2) < 0.08;

/** Chọn sẵn ảnh trong album: 1 ảnh → lấy luôn; nhiều ảnh mà chỉ 1 ảnh 2:1 → lấy ảnh đó; còn lại để người dùng chọn. */
export function autoPick(cands: readonly PhotoCandidate[]): PhotoCandidate | null {
  if (cands.length === 1) return cands[0];
  const sph = cands.filter(c => looksSpherical(c.width, c.height));
  return sph.length === 1 ? sph[0] : null;
}

/** Cỡ tối đa lưu cho ảnh 360 (đủ nét để đọc biển hiệu, vẫn mở mượt trên điện thoại). */
export const PANO_MAX_W = 6144;

/** Cỡ cần xin Google cắt sẵn: không phóng to ảnh nhỏ. */
export function targetSize(w: number, h: number, max = PANO_MAX_W): { w: number; h: number } {
  if (!(w > 0 && h > 0)) return { w: max, h: Math.round(max / 2) };
  if (w <= max) return { w, h };
  return { w: max, h: Math.round((h * max) / w) };
}
