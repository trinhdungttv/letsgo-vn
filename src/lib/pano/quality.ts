// Độ nét của trình xem ảnh 360°: nạp ảnh vào bộ vẽ ở cỡ nào (giữ ảnh gốc, có trần bộ nhớ) và vẽ khung hình ở độ phân giải
// nào (đúng mật độ điểm ảnh của màn hình, có trần). Thuần hàm — test ở quality.test.ts.
//
// Vì sao từng mờ trên iPhone (13/11/2026):
//   • ảnh lưu 6144 px nhưng điện thoại bị ép thu về 4096 px, mà Safari iPhone khi vẽ thu nhỏ ảnh to lại GIẢI MÃ ở 1/2
//     (image subsampling của WebKit) → thực chất chỉ còn 3072 px rồi bị phóng lại 4096 → mất ~½ chi tiết;
//   • khung vẽ chặn ở 2× trong khi màn iPhone là 3× → cả khung bị phóng 1,5 lần lúc hiển thị.

/** Trần điểm ảnh texture trên điện thoại = đúng cỡ ảnh lưu tối đa (6144 × 3072 ≈ 19 MP ≈ 100 MB bộ nhớ đồ hoạ kể cả mipmap). */
export const TEX_BUDGET_PHONE = 6144 * 3072;
/** Máy tính / iPad. */
export const TEX_BUDGET_DESKTOP = 8192 * 4096;
/** Vừa mất WebGL vì hết bộ nhớ đồ hoạ → thử lại 1 lần với ảnh nhỏ hơn trước khi chuyển sang vẽ bằng CPU. */
export const TEX_BUDGET_LOW = 4096 * 2048;
/** Safari iPhone giới hạn khung vẽ 2D ~16,7 triệu điểm ảnh — áp khi phải vẽ ảnh qua canvas để thu nhỏ. */
export const CANVAS_MAX_PX = 16_000_000;

/** Số điểm ảnh tối đa mỗi khung hình WebGL: điện thoại 430 × 932 × 3² ≈ 3,6 MP vẫn vẽ đủ 3×. */
export const RENDER_BUDGET_PHONE = 4_500_000;
/** Máy tính: màn 5K (2560 × 1440 × 2²) vẫn vẽ đủ 2×. */
export const RENDER_BUDGET_DESKTOP = 16_600_000;

/** Vẽ bằng CPU (máy không có WebGL): ảnh nguồn tối đa — mảng 4 byte / điểm, 6144 × 3072 ≈ 75 MB. */
export const SOFT_SRC_BUDGET = 6144 * 3072;
/** Vẽ bằng CPU: lượt vẽ nét khi dừng tay tối đa ~6 MP (chia nhiều lượt nhỏ nên không khựng). */
export const SOFT_SHARP_PX = 6_000_000;

/**
 * Hệ số thu nhỏ ảnh trước khi nạp vào bộ vẽ (1 = giữ nguyên ảnh gốc).
 * `halvesOnly` (Safari iPhone / iPad): chỉ thu theo nấc ½, ¼… — đúng nấc WebKit tự giải mã, nên không bị giải mã nhỏ
 * rồi phóng lại (VD 6144 → 3072 nét hơn hẳn 6144 → "4096" thực chất là 3072 phóng to).
 */
export function textureScale(w: number, h: number, opts: { maxTex: number; budgetPx: number; halvesOnly?: boolean }): number {
  if (!(w > 0 && h > 0)) return 1;
  let k = Math.min(1, opts.maxTex / w, opts.maxTex / h, Math.sqrt(opts.budgetPx / (w * h)));
  if (k >= 1) return 1;
  // Phải thu nhỏ = phải vẽ qua canvas 2D → không vượt giới hạn khung vẽ của iPhone
  k = Math.min(k, Math.sqrt(CANVAS_MAX_PX / (w * h)));
  if (opts.halvesOnly) k = 2 ** -Math.ceil(Math.log2(1 / k) - 1e-9);
  return k;
}

/**
 * Mật độ vẽ khung hình (điểm ảnh thật / 1 px CSS): theo devicePixelRatio của máy (iPhone = 3, tối đa 3) để ảnh không bị
 * phóng mờ lúc hiển thị; khung quá to thì hạ bớt cho vừa `budgetPx` (không thấp hơn 1).
 */
export function renderDpr(w: number, h: number, deviceDpr: number, budgetPx: number): number {
  const d = Math.min(3, Math.max(1, Number.isFinite(deviceDpr) ? deviceDpr : 1));
  return Math.max(1, Math.min(d, Math.sqrt(budgetPx / Math.max(1, w * h))));
}

/** Safari / mọi trình duyệt trên iPhone, iPad (iPadOS báo là "Macintosh" nhưng có cảm ứng). */
export function isIOSWebKit(nav: { userAgent: string; maxTouchPoints?: number } | undefined = typeof navigator === 'undefined' ? undefined : navigator): boolean {
  if (!nav) return false;
  return /iP(hone|ad|od)/.test(nav.userAgent) || (/Macintosh/.test(nav.userAgent) && (nav.maxTouchPoints ?? 0) > 1);
}
