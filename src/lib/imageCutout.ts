// Ảnh CHỮ KÝ / CON DẤU: thường là ảnh chụp/scan trên giấy trắng. Đặt thẳng lên báo giá sẽ có "ô vuông trắng" che chữ bên dưới,
// nên cần tách nền trắng thành trong suốt. Phần tính toán là hàm THUẦN trên mảng RGBA (test được); phần canvas bọc bên ngoài.

/** Có điểm ảnh nào đã trong suốt chưa (ảnh PNG đã tách nền sẵn thì không xử lý lại). */
export function hasTransparency(rgba: Uint8ClampedArray): boolean {
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] < 250) return true;
  return false;
}

/**
 * Nền trắng → trong suốt, mép mềm. Điểm càng trắng (kênh sáng nhất thấp nhất = min(r,g,b)) càng trong suốt:
 *   min ≥ high → trong suốt hẳn · min ≤ low → giữ nguyên · ở giữa → trong suốt một phần.
 * Màu ở mép được "bỏ phần trắng pha vào" để mép mực/dấu đỏ không bị viền trắng.
 * Mực xanh/đen và dấu đỏ có ít nhất một kênh thấp → luôn được giữ.
 */
export function whiteToTransparent(rgba: Uint8ClampedArray, low = 170, high = 235): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rgba);
  for (let i = 0; i < out.length; i += 4) {
    const w = Math.min(out[i], out[i + 1], out[i + 2]);
    if (w >= high) { out[i + 3] = 0; continue; }
    if (w <= low) continue;
    const a = (high - w) / (high - low);              // 0..1
    out[i + 3] = Math.round(out[i + 3] * a);
    for (let k = 0; k < 3; k++) out[i + k] = Math.max(0, Math.min(255, Math.round((out[i + k] - 255 * (1 - a)) / a)));
  }
  return out;
}

export interface StampImage {
  /** Ảnh đã (hoặc chưa) tách nền — PNG data URL */
  dataUrl: string;
  /** Ảnh gốc đã thu nhỏ, chưa tách nền — để người dùng bật/tắt "Xoá nền trắng" */
  original: string;
  /** Ảnh đã có sẵn nền trong suốt (không cần tách) */
  hadAlpha: boolean;
}

/** Đọc vài byte đầu để biết ảnh thật sự là gì (đuôi file / file.type có thể sai hoặc để trống, nhất là HEIC từ iPhone). */
async function sniffKind(file: Blob): Promise<'png' | 'jpeg' | 'webp' | 'heic' | 'gif' | 'unknown'> {
  const b = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const asc = (from: number, to: number) => String.fromCharCode(...b.slice(from, to));
  if (b[0] === 0x89 && asc(1, 4) === 'PNG') return 'png';
  if (b[0] === 0xff && b[1] === 0xd8) return 'jpeg';
  if (asc(0, 4) === 'RIFF' && asc(8, 12) === 'WEBP') return 'webp';
  if (asc(0, 3) === 'GIF') return 'gif';
  if (asc(4, 8) === 'ftyp' && /^(heic|heix|hevc|hevx|heim|heis|mif1|msf1|heif)/.test(asc(8, 12))) return 'heic';
  return 'unknown';
}

export const HEIC_HINT = 'Không đổi được ảnh HEIC này — thử mở bằng Safari, hoặc xuất sang JPG/PNG rồi tải lại.';

const loadViaImage = (file: Blob): Promise<HTMLImageElement> => new Promise((res, rej) => {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => { URL.revokeObjectURL(url); res(img); };
  img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('decode')); };
  img.src = url;
});

/** Mọi thứ vẽ lên canvas được: <img> hoặc ImageBitmap (đã xoay đúng EXIF). */
type Drawable = { src: CanvasImageSource; w: number; h: number };

async function loadImg(file: Blob): Promise<Drawable> {
  const kind = await sniffKind(file);
  try {
    const img = await loadViaImage(file);
    return { src: img, w: img.naturalWidth, h: img.naturalHeight };
  } catch { /* thử đường khác */ }
  try {
    // createImageBitmap giải mã được một số file mà <img> từ chối (JPEG lạ, blob không có type…)
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    return { src: bmp, w: bmp.width, h: bmp.height };
  } catch { /* hết đường */ }
  if (kind === 'heic') {
    // Chrome/Firefox không đọc HEIC: đổi sang JPEG bằng heic2any (nạp khi cần, ~1 MB)
    try {
      const { default: heic2any } = await import('heic2any');
      const out = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.92 });
      const jpg = Array.isArray(out) ? out[0] : out;
      const img = await loadViaImage(jpg);
      return { src: img, w: img.naturalWidth, h: img.naturalHeight };
    } catch { throw new Error(HEIC_HINT); }
  }
  throw new Error('Không đọc được file ảnh — file có thể bị hỏng hoặc không phải PNG/JPG/WebP.');
}

/** Dung lượng gần đúng của data URL (byte). */
export const dataUrlBytes = (u: string) => Math.round((u.length - u.indexOf(',') - 1) * 0.75);

/**
 * Thu nhỏ (cạnh dài tối đa `maxSide`) và tuỳ chọn tách nền trắng. Tự hạ kích thước nếu PNG vẫn quá lớn (> `maxBytes`).
 */
export async function prepareStampImage(file: File, opts: { maxSide?: number; cutout?: boolean; maxBytes?: number } = {}): Promise<StampImage> {
  const kind = await sniffKind(file);
  if (kind === 'unknown' && !/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('Chỉ nhận ảnh PNG, JPEG hoặc WebP (hoặc HEIC nếu trình duyệt hỗ trợ)');
  const img = await loadImg(file);
  let side = opts.maxSide ?? 720;
  const maxBytes = opts.maxBytes ?? 600_000;
  for (let attempt = 0; attempt < 4; attempt++) {
    const k = Math.min(1, side / Math.max(img.w, img.h));
    const w = Math.max(1, Math.round(img.w * k)), h = Math.max(1, Math.round(img.h * k));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(img.src, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h);
    const hadAlpha = hasTransparency(data.data);
    const original = c.toDataURL('image/png');
    let dataUrl = original;
    if ((opts.cutout ?? true) && !hadAlpha) {
      ctx.putImageData(new ImageData(whiteToTransparent(data.data), w, h), 0, 0);
      dataUrl = c.toDataURL('image/png');
    }
    if (dataUrlBytes(dataUrl) <= maxBytes && dataUrlBytes(original) <= maxBytes) return { dataUrl, original, hadAlpha };
    side = Math.round(side * 0.7);
  }
  throw new Error('Ảnh quá phức tạp để lưu (nén vẫn lớn hơn 600 KB) — dùng ảnh đơn giản hơn.');
}

/** Tách nền trắng cho 1 ảnh đã có (data URL) — dùng khi người dùng bật lại "Xoá nền trắng". */
export async function cutoutDataUrl(dataUrl: string): Promise<string> {
  const blob = await (await fetch(dataUrl)).blob();
  const img = await loadImg(blob);
  const c = document.createElement('canvas'); c.width = img.w; c.height = img.h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img.src, 0, 0);
  const d = ctx.getImageData(0, 0, c.width, c.height);
  if (hasTransparency(d.data)) return dataUrl;
  ctx.putImageData(new ImageData(whiteToTransparent(d.data), c.width, c.height), 0, 0);
  return c.toDataURL('image/png');
}
