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

type XY = { x: number; y: number };

/**
 * Đổi 1 vector trên MÀN HÌNH sang vector trên bản đồ chưa xoay khi khung bản đồ đang xoay `rot` độ (CSS rotate(−rot)).
 * Ngược lại (bản đồ → màn hình) thì gọi với −rot.
 */
export function screenToMap(v: XY, rot: number): XY {
  const r = (rot * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

/**
 * Tâm khung bản đồ (toạ độ điểm ảnh của bản đồ chưa xoay) để vị trí đang đứng `user` hiện lệch khỏi tâm màn hình đúng
 * `offset` px (x sang phải, y xuống dưới) sau khi khung xoay `rot` độ.
 */
export function centerForOffset(user: XY, rot: number, offset: XY): XY {
  const m = screenToMap(offset, rot);
  return { x: user.x - m.x, y: user.y - m.y };
}

/**
 * Tâm khung bản đồ để vị trí đang đứng hiện ở dưới tâm màn hình `k` px sau khi xoay khung theo hướng đi `bearing`
 * (độ): dời tâm ra phía trước theo hướng đi.
 */
export function aheadPoint(user: XY, bearing: number, k: number): XY {
  return centerForOffset(user, bearing, { x: 0, y: k });
}

/** Mét trên 1 điểm ảnh ở vĩ độ / mức zoom (Web Mercator, ô 256 px). */
export const metersPerPixel = (lat: number, zoom: number) => (156_543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;

/**
 * Thời gian trượt mũi tên tới điểm GPS mới (ms) ≈ khoảng cách giữa 2 lần GPS báo (đã làm mượt) → mũi tên chạy đều,
 * không dừng-nhảy. GPS báo thưa / mất sóng lâu, hoặc nhảy quá xa thì không trượt (0 = đặt ngay).
 */
export function glideMs(intervalMs: number | null, jumpM: number): number {
  if (jumpM > 150) return 0;
  if (intervalMs == null || !Number.isFinite(intervalMs)) return 900;
  if (intervalMs > 4000) return 0;
  return Math.max(250, Math.min(1600, intervalMs * 1.05));
}

/**
 * Canh 1 nhóm điểm (toạ độ điểm ảnh ở mức zoom z0) vừa phần màn hình còn trống khi bản đồ đang xoay `rot` độ: chọn
 * mức zoom lớn nhất mà hình bao (đã xoay theo màn hình) lọt vào vùng trống, và tâm bản đồ (điểm ảnh ở mức zoom đó).
 */
export function fitRotated(points: readonly XY[], rot: number, z0: number, view: { w: number; h: number },
  pad: { top: number; bottom: number; left: number; right: number }, maxZoom = 18, minZoom = 3): { zoom: number; center: XY } | null {
  if (!points.length) return null;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of points) {
    const s = screenToMap(p, -rot);
    if (s.x < x0) x0 = s.x; if (s.x > x1) x1 = s.x;
    if (s.y < y0) y0 = s.y; if (s.y > y1) y1 = s.y;
  }
  const availW = Math.max(40, view.w - pad.left - pad.right), availH = Math.max(40, view.h - pad.top - pad.bottom);
  const w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0);
  const zoom = Math.max(minZoom, Math.min(maxZoom, Math.floor(z0 + Math.log2(Math.min(availW / w, availH / h)))));
  const f = 2 ** (zoom - z0);
  // Tâm hình bao (khung màn hình) → về bản đồ; tâm vùng trống lệch khỏi tâm màn hình (pad 2 bên không bằng nhau)
  const mid = screenToMap({ x: ((x0 + x1) / 2) * f, y: ((y0 + y1) / 2) * f }, rot);
  return { zoom, center: centerForOffset(mid, rot, { x: (pad.left - pad.right) / 2, y: (pad.top - pad.bottom) / 2 }) };
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
