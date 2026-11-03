// Hướng đi / hướng điện thoại khi khảo sát KCN — hàm thuần, test được.
//
// Mũi tên vị trí kiểu Google Maps: đang chạy xe → theo hướng di chuyển của GPS (la bàn trong xe hay bị kim loại làm lệch);
// đứng yên / đi chậm → theo la bàn điện thoại (xoay máy hướng nào, mũi tên chỉ hướng đó).
import type { LatLng } from '../geo';

const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

/** Góc về [0, 360). */
export const normDeg = (d: number) => ((d % 360) + 360) % 360;

/** Hiệu 2 góc có dấu, trong (-180, 180]: dương = b nằm bên phải a (theo chiều kim đồng hồ). */
export function angleDiff(a: number, b: number): number {
  const d = normDeg(b - a);
  return d > 180 ? d - 360 : d;
}

/** Hướng từ a tới b, độ tính từ hướng Bắc theo chiều kim đồng hồ. */
export function bearing(a: LatLng, b: LatLng): number {
  const φ1 = toRad(a.lat), φ2 = toRad(b.lat), Δλ = toRad(b.lng - a.lng);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return normDeg(toDeg(Math.atan2(y, x)));
}

/** Làm mượt góc (đi đường ngắn nhất qua 0°/360°): k = 0..1, càng lớn càng bám nhanh. */
export function smoothAngle(prev: number | null, next: number, k = 0.25): number {
  if (prev == null || !Number.isFinite(prev)) return normDeg(next);
  return normDeg(prev + angleDiff(prev, next) * k);
}

export interface OrientationLike {
  alpha: number | null;
  absolute?: boolean;
  /** iPhone / iPad: độ từ hướng Bắc (đã là la bàn), có sẵn trong sự kiện deviceorientation */
  webkitCompassHeading?: number;
}

/**
 * Hướng đỉnh điện thoại so với hướng Bắc từ sự kiện xoay máy. iPhone có webkitCompassHeading; Android dùng alpha của
 * sự kiện "absolute" (alpha tăng ngược chiều kim đồng hồ nên hướng = 360 − alpha). Sự kiện không tuyệt đối (alpha tính
 * từ lúc mở trang, không phải hướng Bắc) → null. `screenAngle` = màn hình đang xoay ngang bao nhiêu độ.
 */
export function compassFromEvent(e: OrientationLike, screenAngle = 0): number | null {
  if (typeof e.webkitCompassHeading === 'number' && Number.isFinite(e.webkitCompassHeading)) {
    return normDeg(e.webkitCompassHeading + screenAngle);
  }
  if (e.absolute && e.alpha != null && Number.isFinite(e.alpha)) return normDeg(360 - e.alpha + screenAngle);
  return null;
}

/** Tốc độ (m/s) từ đó coi là đang di chuyển → mũi tên theo hướng GPS thay cho la bàn. ~7 km/h. */
export const MOVING_SPEED = 2;

/**
 * Hướng hiển thị cho mũi tên vị trí. `course` = hướng đi do GPS báo (hoặc tính từ 2 điểm vết gần nhất).
 * Trả về nguồn để vẽ đúng kiểu: 'course' = mũi tên đầy (đang chạy), 'compass' = quạt sáng (đang cầm máy xoay).
 */
export function displayHeading(opts: { course: number | null; speed: number | null; compass: number | null }): { deg: number; source: 'course' | 'compass' } | null {
  const moving = (opts.speed ?? 0) >= MOVING_SPEED;
  if (moving && opts.course != null && Number.isFinite(opts.course)) return { deg: normDeg(opts.course), source: 'course' };
  if (opts.compass != null && Number.isFinite(opts.compass)) return { deg: normDeg(opts.compass), source: 'compass' };
  if (opts.course != null && Number.isFinite(opts.course) && (opts.speed ?? 0) > 0.8) return { deg: normDeg(opts.course), source: 'course' };
  return null;
}
