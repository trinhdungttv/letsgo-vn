// Khung nhìn bản đồ khi khảo sát (kiểu Google Maps dẫn đường) — hàm thuần, test được.
//
// Bản đồ "xoay theo hướng đi": Leaflet không tự xoay được → xoay cả khung bản đồ bằng CSS. Khung được làm VUÔNG, cạnh =
// đường chéo màn hình, đặt giữa màn hình → xoay góc nào cũng phủ kín màn hình. Mũi tên vị trí đặt ở phần dưới màn hình
// (tâm khung dời lên phía trước theo hướng đi) để nhìn được xa phía trước.
import { angleDiff } from './heading';

/** Cạnh khung bản đồ vuông phủ kín màn hình w × h khi xoay bất kỳ góc nào (số chẵn để tâm khung trùng tâm màn hình). */
export function rotatedSize(w: number, h: number): number {
  const d = Math.ceil(Math.hypot(w, h));
  return d % 2 ? d + 1 : d;
}

/**
 * Góc xoay liên tục (không nhảy 359° → 0°) để CSS chuyển động đi đường ngắn nhất: 350° rồi tới 10° = 370°.
 * `prev` là góc đang hiển thị (có thể > 360 hoặc âm), `next` là hướng mới 0..360.
 */
export function unwrapBearing(prev: number, next: number): number {
  return prev + angleDiff(prev, next);
}

/** Đưa góc đang hiển thị về hướng Bắc theo đường ngắn nhất (VD 370° → 360°). */
export const northOf = (prev: number) => prev - angleDiff(0, prev);

/**
 * Tâm khung bản đồ (toạ độ điểm ảnh của bản đồ chưa xoay) để vị trí đang đứng hiện ở dưới tâm màn hình `k` px sau khi
 * xoay khung theo hướng đi `bearing` (độ): dời tâm ra phía trước theo hướng đi.
 */
export function aheadPoint(user: { x: number; y: number }, bearing: number, k: number): { x: number; y: number } {
  const r = (bearing * Math.PI) / 180;
  return { x: user.x + Math.sin(r) * k, y: user.y - Math.cos(r) * k };
}

/** Zoom theo tốc độ (m/s): > 11 (≈ 40 km/h) nhìn xa, < 1,5 (đi bộ / dừng xem cổng) nhìn gần. */
export function speedZoom(speed: number | null, base: number): number {
  if (speed == null) return base;
  if (speed > 11) return Math.max(14, base - 2);
  if (speed > 5) return Math.max(15, base - 1);
  if (speed < 1.5) return Math.min(19, base + 1);
  return base;
}

/**
 * Tự zoom kiểu dẫn đường: bình thường theo tốc độ; sắp tới chỗ rẽ (< 600 m) thì chọn mức zoom để chỗ rẽ nằm khoảng 40%
 * chiều cao màn hình phía trên mũi tên (gần rẽ → phóng to, xa → thu nhỏ). Kết quả nguyên, trong 14..18.
 */
export function smartZoom(o: { speed: number | null; navDist: number | null; lat: number; viewH: number; base: number }): number {
  let z = speedZoom(o.speed, o.base);
  if (o.navDist != null && Number.isFinite(o.navDist) && o.navDist < 600 && o.viewH > 0) {
    const mpp = (o.navDist + 40) / (o.viewH * 0.4);
    z = Math.log2((156_543.03392 * Math.cos((o.lat * Math.PI) / 180)) / mpp);
  }
  return Math.max(14, Math.min(18, Math.round(z)));
}

/** Đệm cho fitBounds khi khung bản đồ to hơn màn hình (khung vuông xoay được): chỉ canh trong phần đang thấy. */
export function visiblePadding(map: { x: number; y: number }, view: { w: number; h: number }, pad: { top: number; bottom: number; side: number }) {
  const ox = Math.max(0, (map.x - view.w) / 2), oy = Math.max(0, (map.y - view.h) / 2);
  return {
    paddingTopLeft: [ox + pad.side, oy + pad.top] as [number, number],
    paddingBottomRight: [ox + pad.side, oy + pad.bottom] as [number, number],
  };
}
