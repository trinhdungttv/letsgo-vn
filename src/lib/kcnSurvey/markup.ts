// Ghi chú vẽ lên ảnh chỉ tiêu (khoanh số lượng, mũi tên chỉ cổng, ghi chữ…) — lưu dạng nét vẽ, KHÔNG sửa file ảnh gốc
// (cột kcn_survey_photos.annotations, migration 193) → sửa / xoá nét được về sau, ảnh gốc vẫn nguyên.
//
// Toạ độ chuẩn hoá theo khung ảnh: x = 0..1 theo chiều ngang, y = 0..1 theo chiều dọc. Bề dày nét / cỡ chữ tính theo
// chiều ngang ảnh (0.01 = 1% bề ngang) → ảnh nhỏ hay to đều vẽ đúng tỉ lệ.

export type Pt = [number, number];

export type PhotoMark =
  | { t: 'pen'; c: string; w: number; p: Pt[] }
  | { t: 'arrow'; c: string; w: number; a: Pt; b: Pt }
  | { t: 'ellipse'; c: string; w: number; a: Pt; b: Pt }
  | { t: 'text'; c: string; s: number; x: number; y: number; text: string };

export const MARK_COLORS = ['#FF3B30', '#FFD60A', '#34C759', '#0A84FF', '#FFFFFF'] as const;
export const DEFAULT_STROKE = 0.008;
export const DEFAULT_TEXT = 0.05;
/** Bề ngang khung vẽ SVG (đơn vị ảo); chiều cao = MARK_W × cao / ngang của ảnh */
export const MARK_W = 1000;

const MAX_MARKS = 200;
const MAX_PTS = 600;
const isColor = (c: unknown): c is string => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);
const clamp01 = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : null);
const r4 = (n: number) => Math.round(n * 10_000) / 10_000;
const pt = (v: unknown): Pt | null => {
  if (!Array.isArray(v) || v.length < 2) return null;
  const x = clamp01(v[0]), y = clamp01(v[1]);
  return x == null || y == null ? null : [r4(x), r4(y)];
};
const width = (w: unknown, def: number, max: number) => (typeof w === 'number' && Number.isFinite(w) && w > 0 ? Math.min(max, w) : def);

/** Đọc nét vẽ từ DB (bỏ nét hỏng / lạ, giới hạn số lượng) — dữ liệu do người dùng sửa được nên luôn lọc lại. */
export function sanitizeMarks(raw: unknown): PhotoMark[] {
  if (!Array.isArray(raw)) return [];
  const out: PhotoMark[] = [];
  for (const m of raw.slice(0, MAX_MARKS)) {
    if (!m || typeof m !== 'object') continue;
    const o = m as Record<string, unknown>;
    const c = isColor(o.c) ? o.c : MARK_COLORS[0];
    if (o.t === 'pen' && Array.isArray(o.p)) {
      const p = o.p.slice(0, MAX_PTS).map(pt).filter((q): q is Pt => !!q);
      if (p.length >= 2) out.push({ t: 'pen', c, w: width(o.w, DEFAULT_STROKE, 0.05), p });
    } else if ((o.t === 'arrow' || o.t === 'ellipse')) {
      const a = pt(o.a), b = pt(o.b);
      if (a && b) out.push({ t: o.t, c, w: width(o.w, DEFAULT_STROKE, 0.05), a, b });
    } else if (o.t === 'text' && typeof o.text === 'string' && o.text.trim()) {
      const x = clamp01(o.x), y = clamp01(o.y);
      if (x != null && y != null) out.push({ t: 'text', c, s: width(o.s, DEFAULT_TEXT, 0.2), x: r4(x), y: r4(y), text: o.text.trim().slice(0, 200) });
    }
  }
  return out;
}

/** Rút gọn nét bút (Ramer–Douglas–Peucker) — tay vẽ ra hàng trăm điểm, giữ hình dạng với vài chục điểm. */
export function simplifyPath(p: readonly Pt[], tol = 0.002): Pt[] {
  if (p.length <= 2) return p.map(q => [r4(q[0]), r4(q[1])]);
  const keep = new Uint8Array(p.length);
  keep[0] = keep[p.length - 1] = 1;
  const stack: [number, number][] = [[0, p.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop()!;
    const [ax, ay] = p[i], [bx, by] = p[j];
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    let best = -1, bd = tol;
    for (let k = i + 1; k < j; k++) {
      const [px, py] = p[k];
      let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(ax + t * dx - px, ay + t * dy - py);
      if (d > bd) { bd = d; best = k; }
    }
    if (best > 0) { keep[best] = 1; stack.push([i, best], [best, j]); }
  }
  return p.filter((_, i) => keep[i]).map(q => [r4(q[0]), r4(q[1])]);
}

/** Đầu mũi tên: 2 cánh tại b, dài theo bề dày nét. Trả toạ độ chuẩn hoá (đã nhân tỉ lệ cao/ngang). */
export function arrowHead(a: Pt, b: Pt, w: number, aspect: number): [Pt, Pt] {
  // làm việc trong khung có cùng đơn vị 2 trục (y nhân với cao/ngang)
  const ax = a[0], ay = a[1] * aspect, bx = b[0], by = b[1] * aspect;
  const ang = Math.atan2(by - ay, bx - ax);
  const len = Math.max(0.03, w * 5);
  const wing = (d: number): Pt => [bx - len * Math.cos(ang + d), (by - len * Math.sin(ang + d)) / aspect];
  return [wing(Math.PI / 7), wing(-Math.PI / 7)];
}

/** Có nét nào không (để hiện huy hiệu "có ghi chú trên ảnh"). */
export const hasMarks = (raw: unknown) => sanitizeMarks(raw).length > 0;
