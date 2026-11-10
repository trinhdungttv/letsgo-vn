// Toán cho ảnh 360° (ảnh cầu equirectangular) — phần thuần, có test (pano.test.ts).
//
// Quy ước toạ độ TRONG ẢNH (không phụ thuộc hướng Bắc → nét vẽ luôn dính vào nội dung ảnh):
//   yaw   = kinh độ trong ảnh, độ, (-180, 180]: 0 = giữa ảnh, dương = quay sang PHẢI (cột ảnh tăng)
//   pitch = vĩ độ trong ảnh, độ, [-90, 90]: dương = nhìn LÊN
// Hướng thật: heading = hướng la bàn của giữa ảnh (giống GPano:PoseHeadingDegrees) → điểm có phương vị B (độ, Bắc = 0,
// theo chiều kim đồng hồ) nằm ở yaw = B − heading.
//
// Camera (khung nhìn): yaw / pitch của tâm màn hình + hfov (góc nhìn ngang, độ). Phép chiếu phẳng (rectilinear):
//   tiêu cự f = (w / 2) / tan(hfov / 2); điểm có toạ độ camera (x phải, y lên, z trước) → màn hình (w/2 + f·x/z, h/2 − f·y/z).
// Shader WebGL (PanoViewer.tsx) dùng ĐÚNG công thức này theo chiều ngược lại → nét vẽ luôn khớp ảnh.

export interface SphPt { yaw: number; pitch: number }
export interface PanoView { yaw: number; pitch: number; hfov: number; w: number; h: number }
export type Vec3 = [number, number, number];

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

export const HFOV_MIN = 12;
export const HFOV_MAX = 120;
export const HFOV_DEFAULT = 90;
/** Mặt phẳng cắt gần (z camera) — đỉnh sau lưng người xem bị cắt tại đây trước khi chiếu. */
const Z_NEAR = 0.02;

/** Đưa góc về (-180, 180]. */
export function wrapYaw(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  const r = ((deg % 360) + 360) % 360;
  return r > 180 ? r - 360 : r;
}
/** Đưa góc về [0, 360). */
export function wrap360(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  return ((deg % 360) + 360) % 360;
}
export const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** Hướng (yaw, pitch) → véc-tơ đơn vị trong ảnh (x phải, y lên, z trước = giữa ảnh). */
export function dirOf(p: SphPt): Vec3 {
  const y = p.yaw * RAD, t = p.pitch * RAD;
  const c = Math.cos(t);
  return [c * Math.sin(y), Math.sin(t), c * Math.cos(y)];
}

/** Véc-tơ bất kỳ (khác 0) → (yaw, pitch). */
export function sphOf(v: Vec3): SphPt {
  const n = Math.hypot(v[0], v[1], v[2]) || 1;
  return { yaw: wrapYaw(Math.atan2(v[0], v[2]) * DEG), pitch: Math.asin(clamp(v[1] / n, -1, 1)) * DEG };
}

/** Tiêu cự (px CSS) của khung nhìn. */
export function focal(v: Pick<PanoView, 'hfov' | 'w'>): number {
  return (v.w / 2) / Math.tan((clamp(v.hfov, 1, 179) * RAD) / 2);
}

/** Toạ độ ảnh → toạ độ camera (bỏ yaw rồi bỏ pitch — ngược với shader). */
export function toCam(d: Vec3, v: Pick<PanoView, 'yaw' | 'pitch'>): Vec3 {
  const cy = Math.cos(v.yaw * RAD), sy = Math.sin(v.yaw * RAD);
  const cp = Math.cos(v.pitch * RAD), sp = Math.sin(v.pitch * RAD);
  const x1 = d[0] * cy - d[2] * sy;
  const z1 = d[0] * sy + d[2] * cy;
  return [x1, d[1] * cp - z1 * sp, d[1] * sp + z1 * cp];
}

/** Toạ độ camera → toạ độ ảnh (đúng như shader: xoay pitch rồi yaw). */
export function fromCam(c: Vec3, v: Pick<PanoView, 'yaw' | 'pitch'>): Vec3 {
  const cy = Math.cos(v.yaw * RAD), sy = Math.sin(v.yaw * RAD);
  const cp = Math.cos(v.pitch * RAD), sp = Math.sin(v.pitch * RAD);
  const y1 = c[1] * cp + c[2] * sp;
  const z1 = -c[1] * sp + c[2] * cp;
  return [c[0] * cy + z1 * sy, y1, -c[0] * sy + z1 * cy];
}

function camToScreen(c: Vec3, v: PanoView, f: number): { x: number; y: number } {
  return { x: v.w / 2 + (f * c[0]) / c[2], y: v.h / 2 - (f * c[1]) / c[2] };
}

/** Chiếu 1 điểm lên màn hình. null = điểm nằm sau lưng người xem. (Có thể ra ngoài khung — người gọi tự lọc.) */
export function project(p: SphPt, v: PanoView): { x: number; y: number } | null {
  const c = toCam(dirOf(p), v);
  if (c[2] <= Z_NEAR) return null;
  return camToScreen(c, v, focal(v));
}

/** Điểm màn hình (px CSS trong khung) → hướng trong ảnh. */
export function unproject(sx: number, sy: number, v: PanoView): SphPt {
  const f = focal(v);
  return sphOf(fromCam([sx - v.w / 2, -(sy - v.h / 2), f], v));
}

const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/**
 * Chiếu 1 đường gấp khúc / đa giác: cắt phần sau lưng người xem (Sutherland–Hodgman với mặt phẳng z = Z_NEAR).
 * Cạnh nối 2 đỉnh là cung tròn lớn trên mặt cầu → qua phép chiếu phẳng thành đoạn THẲNG, nên chỉ cần chiếu đỉnh.
 * Trả về các đoạn liền nhau (đa giác: tối đa 1 vòng đã cắt; đường: có thể tách thành nhiều đoạn).
 */
export function projectPath(pts: readonly SphPt[], v: PanoView, closed: boolean): { x: number; y: number }[][] {
  if (!pts.length) return [];
  const f = focal(v);
  const cam = pts.map(p => toCam(dirOf(p), v));
  if (closed) {
    const out: Vec3[] = [];
    for (let i = 0; i < cam.length; i++) {
      const a = cam[i], b = cam[(i + 1) % cam.length];
      const ina = a[2] > Z_NEAR, inb = b[2] > Z_NEAR;
      if (ina) out.push(a);
      if (ina !== inb) out.push(lerp3(a, b, (Z_NEAR - a[2]) / (b[2] - a[2])));
    }
    return out.length >= 2 ? [out.map(c => camToScreen(c, v, f))] : [];
  }
  const runs: Vec3[][] = [];
  let cur: Vec3[] = [];
  for (let i = 0; i < cam.length; i++) {
    const a = cam[i];
    const ina = a[2] > Z_NEAR;
    if (ina) cur.push(a);
    const b = cam[i + 1];
    if (!b) break;
    const inb = b[2] > Z_NEAR;
    if (ina && !inb) { cur.push(lerp3(a, b, (Z_NEAR - a[2]) / (b[2] - a[2]))); runs.push(cur); cur = []; }
    else if (!ina && inb) cur = [lerp3(a, b, (Z_NEAR - a[2]) / (b[2] - a[2]))];
  }
  if (cur.length) runs.push(cur);
  return runs.filter(r => r.length >= 2 || cam.length === 1).map(r => r.map(c => camToScreen(c, v, f)));
}

/** Tâm của 1 nhóm điểm trên mặt cầu (trung bình véc-tơ) — chỗ đặt nhãn của vùng. */
export function centroid(pts: readonly SphPt[]): SphPt {
  if (pts.length === 1) return pts[0];
  const s: Vec3 = [0, 0, 0];
  for (const p of pts) { const d = dirOf(p); s[0] += d[0]; s[1] += d[1]; s[2] += d[2]; }
  if (Math.hypot(s[0], s[1], s[2]) < 1e-9) return pts[0];
  return sphOf(s);
}

/** Điểm giữa của đường gấp khúc (theo độ dài cung) — chỗ đặt nhãn của đường. */
export function pathMidpoint(pts: readonly SphPt[]): SphPt {
  if (pts.length < 2) return pts[0] ?? { yaw: 0, pitch: 0 };
  const segs = pts.slice(1).map((p, i) => angleBetween(pts[i], p));
  const total = segs.reduce((a, b) => a + b, 0);
  let half = total / 2;
  for (let i = 0; i < segs.length; i++) {
    if (half <= segs[i] || i === segs.length - 1) return slerp(pts[i], pts[i + 1], segs[i] ? Math.min(1, half / segs[i]) : 0);
    half -= segs[i];
  }
  return pts[0];
}

/** Góc giữa 2 hướng (độ). */
export function angleBetween(a: SphPt, b: SphPt): number {
  const da = dirOf(a), db = dirOf(b);
  return Math.acos(clamp(da[0] * db[0] + da[1] * db[1] + da[2] * db[2], -1, 1)) * DEG;
}

/** Nội suy theo cung tròn lớn giữa 2 hướng. */
export function slerp(a: SphPt, b: SphPt, t: number): SphPt {
  const da = dirOf(a), db = dirOf(b);
  const om = Math.acos(clamp(da[0] * db[0] + da[1] * db[1] + da[2] * db[2], -1, 1));
  if (om < 1e-9) return a;
  const s = Math.sin(om), ka = Math.sin((1 - t) * om) / s, kb = Math.sin(t * om) / s;
  return sphOf([da[0] * ka + db[0] * kb, da[1] * ka + db[1] * kb, da[2] * ka + db[2] * kb]);
}

/** Dời cả hình theo phép quay đưa hướng `from` tới hướng `to` (kéo cả vùng mà không méo). */
export function rotateShape(pts: readonly SphPt[], from: SphPt, to: SphPt): SphPt[] {
  // Quay theo yaw trước (quanh trục đứng) rồi đẩy pitch — đơn giản, đủ dùng khi kéo đoạn ngắn
  const dYaw = wrapYaw(to.yaw - from.yaw);
  const dPitch = to.pitch - from.pitch;
  return pts.map(p => ({ yaw: wrapYaw(p.yaw + dYaw), pitch: clamp(p.pitch + dPitch, -90, 90) }));
}

// ── Toạ độ thật ──────────────────────────────────────────────────────────────

/** Phương vị (độ, Bắc = 0, theo chiều kim đồng hồ) từ a tới b. */
export function bearingDeg(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const φ1 = a.lat * RAD, φ2 = b.lat * RAD, Δλ = (b.lng - a.lng) * RAD;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return wrap360(Math.atan2(y, x) * DEG);
}

/** Khoảng cách (mét) theo đường chim bay. */
export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const φ1 = a.lat * RAD, φ2 = b.lat * RAD;
  const dφ = (b.lat - a.lat) * RAD, dλ = (b.lng - a.lng) * RAD;
  const s = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Vị trí trong ảnh của 1 địa điểm thật: yaw theo phương vị − hướng giữa ảnh; pitch = góc nhìn xuống chân toà nhà từ độ cao chụp. */
export function placeInPano(bearing: number, distM: number, heading: number, cameraHeightM: number): SphPt {
  const pitch = distM > 0 ? -Math.atan2(Math.max(0, cameraHeightM), distM) * DEG : -90;
  return { yaw: wrapYaw(bearing - heading), pitch };
}

/** Hướng la bàn đang nhìn (độ) khi tâm màn hình ở yaw. */
export function compassAt(yaw: number, heading: number): number {
  return wrap360(heading + yaw);
}

const DIR8 = ['Bắc', 'Đông Bắc', 'Đông', 'Đông Nam', 'Nam', 'Tây Nam', 'Tây', 'Tây Bắc'] as const;
const DIR8_SHORT = ['B', 'ĐB', 'Đ', 'ĐN', 'N', 'TN', 'T', 'TB'] as const;
/** 8 hướng tiếng Việt: 0° → "Bắc", 50° → "Đông Bắc". */
export function dirName(bearing: number, short = false): string {
  const i = Math.round(wrap360(bearing) / 45) % 8;
  return short ? DIR8_SHORT[i] : DIR8[i];
}

export function fmtDistance(m: number): string {
  if (m < 1000) return `${Math.max(1, Math.round(m / 10) * 10)} m`;
  return `${(m / 1000).toFixed(m < 10_000 ? 1 : 0).replace('.', ',')} km`;
}

/**
 * Góc phủ của ảnh: ảnh 360 trọn (2:1) = 360° × 180°. Ảnh khác tỉ lệ (toàn cảnh điện thoại) → coi như mỗi độ bằng nhau
 * theo 2 chiều: rộng hơn 2:1 → ngang 360°, dọc = 360·h/w; hẹp hơn → dọc 180°, ngang = 180·w/h.
 */
export function coverageFromSize(w: number, h: number): { haov: number; vaov: number; voffset: number } {
  if (!(w > 0 && h > 0)) return { haov: 360, vaov: 180, voffset: 0 };
  const r = w / h;
  if (Math.abs(r - 2) < 0.04) return { haov: 360, vaov: 180, voffset: 0 };
  if (r > 2) return { haov: 360, vaov: round2((360 * h) / w), voffset: 0 };
  return { haov: round2(Math.min(360, (180 * w) / h)), vaov: 180, voffset: 0 };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
