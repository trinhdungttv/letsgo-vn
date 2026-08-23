// ============================================================================
// Thu nhỏ ảnh ngay trên trình duyệt TRƯỚC khi tải lên storage.
// Ảnh chụp từ điện thoại thường 3–8 MB; avatar chỉ hiển thị ở kích thước
// 28–96 px nên tải nguyên ảnh gốc lên là lãng phí băng thông và làm chậm mọi
// bảng có hiển thị avatar. Hàm này cắt vuông giữa ảnh, hạ về tối đa 256 px và
// nén WebP — kết quả thường 10–25 KB.
// ============================================================================

export interface ResizeOptions {
  /** Cạnh dài tối đa của ảnh kết quả (px). */
  max?: number;
  /** Chất lượng nén 0–1. */
  quality?: number;
  /** true = cắt vuông lấy phần giữa (dùng cho avatar). */
  square?: boolean;
}

const loadImage = (file: File): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Không đọc được file ảnh')); };
    img.src = url;
  });

/** Trình duyệt cũ không mã hoá được WebP — canvas sẽ tự trả về PNG, khi đó dùng JPEG. */
function pickMimeType(): 'image/webp' | 'image/jpeg' {
  const c = document.createElement('canvas');
  c.width = c.height = 1;
  return c.toDataURL('image/webp').startsWith('data:image/webp') ? 'image/webp' : 'image/jpeg';
}

export interface ResizedImage {
  blob: Blob;
  ext: 'webp' | 'jpg';
  width: number;
  height: number;
  /** Dung lượng sau khi nén (byte). */
  size: number;
}

export async function resizeImage(file: File, opts: ResizeOptions = {}): Promise<ResizedImage> {
  const { max = 256, quality = 0.85, square = false } = opts;
  if (!file.type.startsWith('image/')) throw new Error('File không phải ảnh');

  const img = await loadImage(file);
  let sx = 0, sy = 0, sw = img.naturalWidth, sh = img.naturalHeight;
  if (square) {
    const side = Math.min(sw, sh);
    sx = (sw - side) / 2;
    sy = (sh - side) / 2;
    sw = sh = side;
  }

  // Không phóng to ảnh nhỏ hơn giới hạn — phóng to chỉ làm mờ và nặng thêm.
  const scale = Math.min(1, max / Math.max(sw, sh));
  const dw = Math.max(1, Math.round(sw * scale));
  const dh = Math.max(1, Math.round(sh * scale));

  const canvas = document.createElement('canvas');
  canvas.width = dw;
  canvas.height = dh;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Trình duyệt không hỗ trợ xử lý ảnh');
  ctx.imageSmoothingQuality = 'high';
  // Ảnh PNG/WebP trong suốt khi nén JPEG sẽ ra nền đen — lót nền trắng trước.
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, dw, dh);
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, dw, dh);

  const mime = pickMimeType();
  const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, mime, quality));
  if (!blob) throw new Error('Không nén được ảnh');

  return {
    blob,
    ext: mime === 'image/webp' ? 'webp' : 'jpg',
    width: dw,
    height: dh,
    size: blob.size,
  };
}

export const formatBytes = (n: number) =>
  n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
