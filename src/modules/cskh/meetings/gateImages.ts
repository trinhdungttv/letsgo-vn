// Ảnh cho danh sách vào cổng: logo dự phòng Let's Go (pháp nhân chưa tải logo) + đổi ảnh sang PNG cho file Excel
// (ExcelJS chỉ nhận PNG/JPEG; PNG còn đọc được kích thước để giữ đúng tỉ lệ khi chèn).
import type { QuoteEntity } from '../../../lib/costPlan/entity';
import { foldVn } from '../../../lib/companyMatch';

/** Pháp nhân của Let's Go (theo tên công ty / tên gọi) — chưa có logo riêng thì dùng logo Let's Go như file mẫu. */
export function isLetsGoEntity(e: QuoteEntity | null): boolean {
  if (!e) return false;
  return /let'?s ?go/.test(foldVn(`${e.data.name} ${e.label}`).replace(/[’`]/g, "'"));
}

let cached: Promise<string> | null = null;
/** Logo Let's Go (nạp lười — ~80KB). */
export function letsGoLogoUrl(): Promise<string> {
  cached ??= import('../../../lib/costPlan/letsgoLogo').then(m => `data:image/png;base64,${m.LETSGO_LOGO_B64}`);
  return cached;
}

/** data URL bất kỳ (webp, jpeg, png…) → PNG. */
export async function toPngDataUrl(src: string): Promise<string> {
  if (src.startsWith('data:image/png')) return src;
  const img = new Image();
  img.src = src;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  c.getContext('2d')?.drawImage(img, 0, 0);
  return c.toDataURL('image/png');
}
