// Vết GPS khi khảo sát KCN: lọc điểm GPS, đo quãng đường, khung toạ độ, và đo "đường nào đã đi qua".
// Toàn hàm thuần (không đụng DOM / Supabase) để test được.
//
// Toạ độ trong 1 KCN chỉ vài km → dùng phép chiếu phẳng quanh 1 vĩ độ gốc (sai số không đáng kể)
// thay cho haversine ở các vòng lặp nóng (đo phủ đường hàng nghìn đoạn).
import type { LatLng } from '../geo';

/** 1 điểm vết: [lat, lng, giây kể từ lúc bắt đầu chuyến, sai số GPS (m)]. */
export type TrackPoint = [number, number, number, number];
/** 1 đoạn đi liền (tạm dừng rồi đi tiếp = đoạn mới, không nối 2 đầu). */
export type TrackSegment = TrackPoint[];

const M_PER_DEG_LAT = 111_320;
const toRad = (d: number) => (d * Math.PI) / 180;

/** Phép chiếu phẳng quanh vĩ độ gốc: lat/lng → mét (x đông, y bắc). */
export interface Projector {
  x: (lng: number) => number;
  y: (lat: number) => number;
}
export function projector(lat0: number, lng0: number): Projector {
  const mLng = M_PER_DEG_LAT * Math.cos(toRad(lat0));
  return { x: lng => (lng - lng0) * mLng, y: lat => (lat - lat0) * M_PER_DEG_LAT };
}

/** Khoảng cách 2 điểm (m) — phép chiếu phẳng, đủ chính xác trong vài chục km. */
export function distM(a: LatLng, b: LatLng): number {
  const mLng = M_PER_DEG_LAT * Math.cos(toRad((a.lat + b.lat) / 2));
  const dx = (b.lng - a.lng) * mLng;
  const dy = (b.lat - a.lat) * M_PER_DEG_LAT;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Khoảng cách từ điểm (px,py) tới đoạn thẳng (ax,ay)–(bx,by), cùng đơn vị mét. */
export function pointSegDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const qx = ax + t * dx - px, qy = ay + t * dy - py;
  return Math.sqrt(qx * qx + qy * qy);
}

// ── Lọc điểm GPS ─────────────────────────────────────────────────────────────
export interface FixFilter {
  /** Bỏ điểm có sai số lớn hơn (m) — trong nhà xưởng / dưới mái che GPS hay nhảy. */
  maxAccuracy: number;
  /** Chỉ ghi khi đã đi thêm ít nhất bấy nhiêu mét (đứng yên không ghi chồng điểm). */
  minStep: number;
  /** Tốc độ vô lý (m/s) giữa 2 điểm = GPS nhảy → bỏ. 45 m/s ≈ 160 km/h. */
  maxSpeed: number;
}
export const DEFAULT_FIX_FILTER: FixFilter = { maxAccuracy: 35, minStep: 6, maxSpeed: 45 };

export type FixVerdict = 'accept' | 'inaccurate' | 'too-close' | 'jump';

/** Có ghi điểm GPS mới vào vết không. `last` = điểm đã ghi gần nhất của đoạn đang đi (null = điểm đầu). */
export function judgeFix(last: TrackPoint | null, fix: { lat: number; lng: number; t: number; acc: number }, f: FixFilter = DEFAULT_FIX_FILTER): FixVerdict {
  if (!Number.isFinite(fix.lat) || !Number.isFinite(fix.lng)) return 'inaccurate';
  if (fix.acc > f.maxAccuracy) return 'inaccurate';
  if (!last) return 'accept';
  const d = distM({ lat: last[0], lng: last[1] }, fix);
  // Bước tối thiểu nới theo sai số: điểm sai số 20m mà chỉ lệch 8m thì coi như đứng yên
  if (d < Math.max(f.minStep, Math.min(fix.acc, last[3]) * 0.5)) return 'too-close';
  // Điểm tính theo giây nguyên → 2 điểm cùng giây coi như cách 1 giây (không để cú nhảy lọt qua vì chia cho 0)
  const dt = Math.max(1, fix.t - last[2]);
  if (d / dt > f.maxSpeed) return 'jump';
  return 'accept';
}

/** Tổng quãng đường (m) của các đoạn. */
export function trackLength(segments: readonly TrackSegment[]): number {
  let total = 0;
  for (const seg of segments) {
    for (let i = 1; i < seg.length; i++) total += distM({ lat: seg[i - 1][0], lng: seg[i - 1][1] }, { lat: seg[i][0], lng: seg[i][1] });
  }
  return total;
}

export interface Bounds { minLat: number; minLng: number; maxLat: number; maxLng: number }

/** Khung toạ độ bao các đoạn; null nếu chưa có điểm nào. */
export function trackBounds(segments: readonly TrackSegment[]): Bounds | null {
  let b: Bounds | null = null;
  for (const seg of segments) {
    for (const [lat, lng] of seg) {
      if (!b) b = { minLat: lat, minLng: lng, maxLat: lat, maxLng: lng };
      else {
        if (lat < b.minLat) b.minLat = lat;
        if (lat > b.maxLat) b.maxLat = lat;
        if (lng < b.minLng) b.minLng = lng;
        if (lng > b.maxLng) b.maxLng = lng;
      }
    }
  }
  return b;
}

/** Khung vuông quanh 1 điểm, bán kính (m). */
export function boundsAround(p: LatLng, radiusM: number): Bounds {
  const dLat = radiusM / M_PER_DEG_LAT;
  const dLng = radiusM / (M_PER_DEG_LAT * Math.cos(toRad(p.lat)));
  return { minLat: p.lat - dLat, maxLat: p.lat + dLat, minLng: p.lng - dLng, maxLng: p.lng + dLng };
}

export function boundsIntersect(a: Bounds, b: Bounds): boolean {
  return a.minLat <= b.maxLat && a.maxLat >= b.minLat && a.minLng <= b.maxLng && a.maxLng >= b.minLng;
}

// ── Chỉ mục vết để tra "điểm này có gần đường đã đi không" ─────────────────
/**
 * Lưới ô vuông `cell` mét; mỗi đoạn vết (2 điểm liền nhau) được ghi vào mọi ô mà khung bao của nó chạm.
 * Tra 1 điểm: chỉ xét các đoạn trong ô của nó và 8 ô quanh → đúng khi ngưỡng ≤ cell.
 * Hai điểm cách nhau quá `maxGap` mét (mất sóng lâu) thì KHÔNG nối — tránh tô "đã đi" cả con đường bị cắt ngang.
 */
export class TrackIndex {
  private cells = new Map<string, number[]>();
  private segs: number[] = []; // ax, ay, bx, by liên tiếp
  readonly proj: Projector;

  constructor(lat0: number, lng0: number, readonly cell = 40, readonly maxGap = 120) {
    this.proj = projector(lat0, lng0);
  }

  get size() { return this.segs.length / 4; }

  addSegment(a: LatLng, b: LatLng) {
    const ax = this.proj.x(a.lng), ay = this.proj.y(a.lat), bx = this.proj.x(b.lng), by = this.proj.y(b.lat);
    if (Math.hypot(bx - ax, by - ay) > this.maxGap) return;
    const id = this.segs.length / 4;
    this.segs.push(ax, ay, bx, by);
    const c = this.cell;
    const x0 = Math.floor(Math.min(ax, bx) / c), x1 = Math.floor(Math.max(ax, bx) / c);
    const y0 = Math.floor(Math.min(ay, by) / c), y1 = Math.floor(Math.max(ay, by) / c);
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const k = `${x},${y}`;
        const list = this.cells.get(k);
        if (list) list.push(id); else this.cells.set(k, [id]);
      }
    }
  }

  /** Nạp nguyên các đoạn vết (mỗi cặp điểm liền nhau trong 1 đoạn). Điểm lẻ (đoạn 1 điểm) nối với chính nó. */
  addSegments(segments: readonly TrackSegment[]) {
    for (const seg of segments) {
      if (seg.length === 1) this.addSegment({ lat: seg[0][0], lng: seg[0][1] }, { lat: seg[0][0], lng: seg[0][1] });
      for (let i = 1; i < seg.length; i++) this.addSegment({ lat: seg[i - 1][0], lng: seg[i - 1][1] }, { lat: seg[i][0], lng: seg[i][1] });
    }
  }

  /** Khoảng cách (m) từ điểm tới vết gần nhất, chỉ tìm trong bán kính ~cell; ngoài tầm trả Infinity. */
  nearest(lat: number, lng: number): number {
    const px = this.proj.x(lng), py = this.proj.y(lat);
    const cx = Math.floor(px / this.cell), cy = Math.floor(py / this.cell);
    let best = Infinity;
    const seen = new Set<number>();
    for (let x = cx - 1; x <= cx + 1; x++) {
      for (let y = cy - 1; y <= cy + 1; y++) {
        const list = this.cells.get(`${x},${y}`);
        if (!list) continue;
        for (const id of list) {
          if (seen.has(id)) continue;
          seen.add(id);
          const o = id * 4;
          const d = pointSegDist(px, py, this.segs[o], this.segs[o + 1], this.segs[o + 2], this.segs[o + 3]);
          if (d < best) best = d;
        }
      }
    }
    return best;
  }
}

// ── Mạng đường & độ phủ ──────────────────────────────────────────────────────
export interface RoadWay {
  id: number;
  name?: string;
  /** 'main' = đường trục (primary / secondary / tertiary…), 'minor' = đường nhánh / nội bộ */
  kind: string;
  coords: [number, number][];
}

/** 1 khúc đường ngắn (≤ maxPiece mét) — đơn vị để tô "đã đi / chưa đi". */
export interface RoadPiece {
  wayId: number;
  /** Đường trục (primary / secondary / tertiary…) — vẽ đậm hơn đường nhánh */
  main: boolean;
  a: [number, number];
  b: [number, number];
  /** Trung điểm — điểm đem đi tra với vết. */
  mid: [number, number];
  len: number;
}

/** Cắt các con đường thành khúc ngắn đều nhau để tô từng phần (đi nửa đường thì tô nửa). */
export function splitRoads(ways: readonly RoadWay[], maxPiece = 25): RoadPiece[] {
  const out: RoadPiece[] = [];
  for (const w of ways) {
    for (let i = 1; i < w.coords.length; i++) {
      const [lat1, lng1] = w.coords[i - 1];
      const [lat2, lng2] = w.coords[i];
      const len = distM({ lat: lat1, lng: lng1 }, { lat: lat2, lng: lng2 });
      if (len < 0.5) continue;
      const n = Math.max(1, Math.ceil(len / maxPiece));
      for (let k = 0; k < n; k++) {
        const t0 = k / n, t1 = (k + 1) / n;
        const a: [number, number] = [lat1 + (lat2 - lat1) * t0, lng1 + (lng2 - lng1) * t0];
        const b: [number, number] = [lat1 + (lat2 - lat1) * t1, lng1 + (lng2 - lng1) * t1];
        out.push({ wayId: w.id, main: w.kind === 'main', a, b, mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], len: len / n });
      }
    }
  }
  return out;
}

export interface CoverageResult {
  /** covered[i] ứng với pieces[i]. */
  covered: boolean[];
  coveredM: number;
  totalM: number;
  /** 0–100, null khi chưa có đường nào. */
  pct: number | null;
}

/**
 * Khúc đường nào đã đi qua: trung điểm khúc nằm trong `threshold` mét quanh vết (sai số GPS + bề rộng đường).
 * Đường đôi 2 chiều sát nhau đi 1 bên thì cả 2 bên cùng tính là đã đi — chấp nhận được khi khảo sát.
 */
export function roadCoverage(pieces: readonly RoadPiece[], index: TrackIndex, threshold = 22): CoverageResult {
  const covered = new Array<boolean>(pieces.length);
  let coveredM = 0, totalM = 0;
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i];
    const hit = index.size > 0 && index.nearest(p.mid[0], p.mid[1]) <= threshold;
    covered[i] = hit;
    totalM += p.len;
    if (hit) coveredM += p.len;
  }
  return { covered, coveredM, totalM, pct: totalM > 0 ? Math.round((coveredM / totalM) * 1000) / 10 : null };
}

/**
 * Gộp các khúc liền nhau cùng trạng thái (cùng con đường, khúc sau bắt đầu đúng chỗ khúc trước kết thúc)
 * thành 1 đường vẽ — bản đồ vẽ vài trăm đường thay vì vài nghìn khúc.
 */
export function mergePieces(pieces: readonly RoadPiece[], pick: (i: number) => boolean): [number, number][][] {
  const lines: [number, number][][] = [];
  let cur: [number, number][] | null = null;
  let prev: RoadPiece | null = null;
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i];
    if (!pick(i)) { cur = null; prev = null; continue; }
    const joins = cur && prev && prev.wayId === p.wayId && prev.b[0] === p.a[0] && prev.b[1] === p.a[1];
    if (joins) cur!.push(p.b);
    else { cur = [p.a, p.b]; lines.push(cur); }
    prev = p;
  }
  return lines;
}

// ── Khoảng cách tới 1 công ty (điểm ghim hoặc khối nhà xưởng) ───────────────
/** Điểm nằm trong đa giác (ray casting) — toạ độ [lat, lng]. */
export function pointInRing(lat: number, lng: number, ring: readonly [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i], [yj, xj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Khoảng cách (m) từ vị trí tới công ty: 0 nếu đang ở trong khối nhà xưởng, không thì tới ghim / cạnh khối gần nhất. */
export function distToShape(p: LatLng, points: readonly LatLng[], rings: readonly (readonly [number, number][])[] = []): number {
  let best = Infinity;
  for (const q of points) {
    const d = distM(p, q);
    if (d < best) best = d;
  }
  if (rings.length) {
    const pr = projector(p.lat, p.lng);
    for (const ring of rings) {
      if (ring.length >= 3 && pointInRing(p.lat, p.lng, ring)) return 0;
      for (let i = 1; i < ring.length; i++) {
        const d = pointSegDist(0, 0, pr.x(ring[i - 1][1]), pr.y(ring[i - 1][0]), pr.x(ring[i][1]), pr.y(ring[i][0]));
        if (d < best) best = d;
      }
    }
  }
  return best;
}

/** Định dạng quãng đường ngắn gọn: 850 m · 3,2 km. */
export function fmtDistance(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toLocaleString('vi-VN', { maximumFractionDigits: m < 10_000 ? 1 : 0 })} km`;
}

/** Định dạng thời lượng: 45 phút · 1 giờ 05 phút. */
export function fmtDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  if (h === 0) return m === 0 ? `${s} giây` : `${m} phút`;
  return `${h} giờ ${String(m).padStart(2, '0')} phút`;
}
