// Sản phẩm CRM quyết định hình thức dịch vụ của công ty ở CRM Pipeline: chọn "Giới thiệu lao động" thì
// "Hình thức cần" là chính thức (giới thiệu), chọn "Cho thuê lao động" thì là thời vụ (cho thuê) — không để
// 2 ô nói 2 điều khác nhau. Khách cần cả hai thì vẫn chọn được "Cả thời vụ & chính thức".
// Nhóm sản phẩm khác (VD "HOH - Gia công") hoặc chưa chọn sản phẩm → không ràng buộc.
import type { NeedType } from './serviceMode';

const fold = (s?: string | null) => (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').toLowerCase();

/** Nhóm sản phẩm (crm_products.category) → hình thức dịch vụ; null = không phải sản phẩm lao động. */
export function serviceOfProduct(category?: string | null): 'leasing' | 'recruitment' | null {
  const k = fold(category);
  if (k.includes('gioi thieu')) return 'recruitment';
  if (k.includes('cho thue')) return 'leasing';
  return null;
}

/** Hình thức khách cần theo sản phẩm: giới thiệu → chính thức ('direct'), cho thuê → thời vụ ('leasing'). */
export function needOfProduct(category?: string | null): NeedType | null {
  const s = serviceOfProduct(category);
  return s === 'recruitment' ? 'direct' : s === 'leasing' ? 'leasing' : null;
}

/** Các lựa chọn "Hình thức cần" hợp với sản phẩm (cả hai luôn hợp). */
export function needOptionsFor(implied: NeedType | null): NeedType[] {
  return implied && implied !== 'both' ? [implied, 'both'] : ['leasing', 'direct', 'both'];
}

/** Hình thức đang lưu → hình thức đúng theo sản phẩm (giữ nguyên nếu đã hợp). */
export function fitNeedToProduct(current: NeedType | null | undefined, implied: NeedType | null): NeedType | null {
  if (!implied) return current ?? null;
  return current === implied || current === 'both' ? current : implied;
}
