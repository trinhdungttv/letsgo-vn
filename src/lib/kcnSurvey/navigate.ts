// Dẫn đường khi khảo sát KCN — tự tính trên mạng đường OSM đã tải (không cần dịch vụ chỉ đường bên ngoài, mất sóng
// vẫn chạy). Hàm thuần, test được.
//
//  - "Đoạn chưa đi tiếp theo": gom các khúc đường chưa đi trong KCN thành từng đoạn liền, chấm điểm (dài × có nhà máy
//    hai bên), chia cho quãng đường phải đi tới → chọn đoạn đáng đi nhất, chỉ đường tới đầu đoạn rồi đi hết đoạn.
//    Đi xong / lạc đường thì tự tính lại.
//  - "Tới công ty": đường ngắn nhất tới điểm trên đường gần công ty nhất.
// Đường 1 chiều (oneway) được tôn trọng; đang chạy mà phải quay đầu thì cộng thêm quãng "phạt" để ưu tiên đi tiếp phía trước.
import type { LatLng } from '../geo';
import { pointSegDist, projector, type RoadPiece, type RoadWay } from './track';
import { angleDiff, bearing } from './heading';

export interface GraphEdge {
  a: number;
  b: number;
  len: number;
  way: number;
  /** 1 = chỉ đi a→b · -1 = chỉ đi b→a · 0 = hai chiều */
  dir: 0 | 1 | -1;
}

/** Đồ thị đường: mỗi khúc đường (RoadPiece, ≤ 25 m) là 1 cạnh, cạnh thứ i ứng với pieces[i]. */
export interface RoadGraph {
  pts: [number, number][];
  edges: GraphEdge[];
  /** nút → các cạnh chạm nút */
  adj: number[][];
  wayName: Map<number, string>;
}

const nodeKey = (p: readonly [number, number]) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`;

export function buildRoadGraph(pieces: readonly RoadPiece[], ways: readonly RoadWay[]): RoadGraph {
  const wayInfo = new Map(ways.map(w => [w.id, w]));
  const index = new Map<string, number>();
  const pts: [number, number][] = [];
  const adj: number[][] = [];
  const node = (p: [number, number]) => {
    const k = nodeKey(p);
    let i = index.get(k);
    if (i === undefined) { i = pts.length; index.set(k, i); pts.push(p); adj.push([]); }
    return i;
  };
  const edges = pieces.map((p, i): GraphEdge => {
    const a = node(p.a), b = node(p.b);
    adj[a].push(i);
    if (b !== a) adj[b].push(i);
    return { a, b, len: p.len, way: p.wayId, dir: wayInfo.get(p.wayId)?.oneway ?? 0 };
  });
  const wayName = new Map<number, string>();
  for (const w of ways) if (w.name) wayName.set(w.id, w.name);
  return { pts, edges, adj, wayName };
}

/** Số ngả đường tại 1 nút (đếm nút kề khác nhau). ≥ 3 = ngã ba / ngã tư. */
export function nodeDegree(g: RoadGraph, n: number): number {
  const seen = new Set<number>();
  for (const e of g.adj[n]) {
    const o = g.edges[e].a === n ? g.edges[e].b : g.edges[e].a;
    if (o !== n) seen.add(o);
  }
  return seen.size;
}

const canGo = (e: GraphEdge, from: number) => e.dir === 0 || (e.dir === 1 ? e.a === from : e.b === from);

// ── Bám vị trí vào đường ────────────────────────────────────────────────────
export interface Snap {
  edge: number;
  /** vị trí trên cạnh: 0 = ở nút a, 1 = ở nút b */
  t: number;
  /** cách đường (m) */
  off: number;
  pt: [number, number];
}

/** Độ lệch giữa hướng chạy và trục 1 khúc đường (0 = dọc theo khúc, 90 = cắt ngang), không kể chiều. */
const axisMismatch = (heading: number, edgeBearing: number) => {
  const d = Math.abs(angleDiff(heading, edgeBearing));
  return Math.min(d, 180 - d);
};

/**
 * Khúc đường gần vị trí nhất (≤ maxM mét). Đứng ngay ngã ba / ngã tư thì nhiều khúc cách gần bằng nhau → có `heading`
 * (đang chạy) thì ưu tiên khúc cùng hướng chạy (lệch 90° tính như xa thêm ~13 m).
 */
export function snapToGraph(g: RoadGraph, p: LatLng, maxM = 60, heading: number | null = null): Snap | null {
  const pr = projector(p.lat, p.lng);
  let best: Snap | null = null;
  let bestScore = Infinity;
  const lim = maxM * 1.5;
  for (let i = 0; i < g.edges.length; i++) {
    const e = g.edges[i];
    const A = g.pts[e.a], B = g.pts[e.b];
    const ax = pr.x(A[1]), ay = pr.y(A[0]), bx = pr.x(B[1]), by = pr.y(B[0]);
    // loại nhanh khúc ở xa
    if (Math.min(Math.abs(ax), Math.abs(bx)) > lim + e.len && Math.min(Math.abs(ay), Math.abs(by)) > lim + e.len) continue;
    const d = pointSegDist(0, 0, ax, ay, bx, by);
    if (d > maxM) continue;
    const score = heading != null && e.len > 0.5 ? d + axisMismatch(heading, normBearing(ax, ay, bx, by)) * 0.15 : d;
    if (score >= bestScore) continue;
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.max(0, Math.min(1, (-ax * dx - ay * dy) / l2)) : 0;
    bestScore = score;
    best = { edge: i, t, off: d, pt: [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t] };
  }
  return best;
}

/** Hướng (độ từ Bắc) của đoạn a→b trong toạ độ phẳng mét (x đông, y bắc). */
const normBearing = (ax: number, ay: number, bx: number, by: number) => ((Math.atan2(bx - ax, by - ay) * 180) / Math.PI + 360) % 360;

// ── Đường ngắn nhất (Dijkstra) ──────────────────────────────────────────────
export interface Search {
  dist: Float64Array;
  /** cạnh đi tới nút; -2 = nút xuất phát (2 đầu khúc đang đứng) */
  prevEdge: Int32Array;
  prevNode: Int32Array;
  start: Snap;
}

/** Quãng "phạt" khi phải quay đầu ngay lúc đang chạy (m) — đường phía trước dài hơn chút vẫn được ưu tiên. */
export const UTURN_PENALTY_M = 120;

class MinHeap {
  private k: number[] = [];
  private v: number[] = [];
  get size() { return this.k.length; }
  push(key: number, val: number) {
    const k = this.k, v = this.v;
    let i = k.length;
    k.push(key); v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p]; v[i] = v[p]; i = p;
    }
    k[i] = key; v[i] = val;
  }
  pop(): [number, number] {
    const k = this.k, v = this.v;
    const topK = k[0], topV = v[0];
    const lk = k.pop()!, lv = v.pop()!;
    if (k.length) {
      let i = 0;
      const n = k.length;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        let mk = lk;
        if (l < n && k[l] < mk) { m = l; mk = k[l]; }
        if (r < n && k[r] < mk) { m = r; mk = k[r]; }
        if (m === i) break;
        k[i] = k[m]; v[i] = v[m]; i = m;
      }
      k[i] = lk; v[i] = lv;
    }
    return [topK, topV];
  }
}

/**
 * Quãng đường ngắn nhất từ chỗ đang đứng tới mọi nút. `heading` (độ, hướng đang chạy) có thì đi ngược lại hướng đó
 * bị cộng UTURN_PENALTY_M.
 */
export function shortestFrom(g: RoadGraph, start: Snap, heading: number | null = null): Search {
  const n = g.pts.length;
  const dist = new Float64Array(n).fill(Infinity);
  const prevEdge = new Int32Array(n).fill(-1);
  const prevNode = new Int32Array(n).fill(-1);
  // Cạnh vừa đi tới nút — không cho quay ngược ngay trên chính cạnh đó (= quay đầu giữa đường, né phạt quay đầu),
  // trừ khi là ngõ cụt chỉ có 1 cạnh
  const arrive = new Int32Array(n).fill(-1);
  const heap = new MinHeap();
  const e0 = g.edges[start.edge];
  let penA = 0, penB = 0;
  if (heading != null) {
    // Chỉ phạt khi đang chạy dọc theo khúc này; cắt ngang (đứng ở ngã tư, rẽ sang) thì đi bên nào cũng như nhau
    const ab = bearing({ lat: g.pts[e0.a][0], lng: g.pts[e0.a][1] }, { lat: g.pts[e0.b][0], lng: g.pts[e0.b][1] });
    const d = Math.abs(angleDiff(heading, ab));
    if (d < 60) penA = UTURN_PENALTY_M; else if (d > 120) penB = UTURN_PENALTY_M;
  }
  const seed = (node: number, d: number) => {
    if (d < dist[node]) { dist[node] = d; prevEdge[node] = -2; prevNode[node] = -1; arrive[node] = start.edge; heap.push(d, node); }
  };
  if (e0.dir !== 1) seed(e0.a, start.t * e0.len + penA);
  if (e0.dir !== -1) seed(e0.b, (1 - start.t) * e0.len + penB);
  while (heap.size) {
    const [d, u] = heap.pop();
    if (d > dist[u]) continue;
    for (const ei of g.adj[u]) {
      const e = g.edges[ei];
      if (!canGo(e, u) || (ei === arrive[u] && g.adj[u].length > 1)) continue;
      const v = e.a === u ? e.b : e.a;
      const nd = d + e.len;
      if (nd < dist[v]) { dist[v] = nd; prevEdge[v] = ei; prevNode[v] = u; arrive[v] = ei; heap.push(nd, v); }
    }
  }
  return { dist, prevEdge, prevNode, start };
}

/** Các nút từ chỗ xuất phát tới `node` (nút đầu là 1 trong 2 đầu khúc đang đứng). */
function nodesTo(s: Search, node: number): number[] {
  const out: number[] = [];
  let cur = node;
  for (let guard = 0; cur >= 0 && guard < 1e6; guard++) {
    out.push(cur);
    if (s.prevEdge[cur] === -2) break;
    cur = s.prevNode[cur];
  }
  return out.reverse();
}

// ── Đoạn chưa đi ────────────────────────────────────────────────────────────
export interface Run {
  /** chỉ số khúc (= cạnh) theo thứ tự trên đường */
  pieces: number[];
  /** nút theo thứ tự: nodes[0] = đầu đoạn, nodes[last] = cuối đoạn */
  nodes: number[];
  len: number;
  /** có nhà máy / công ty hai bên */
  factory: boolean;
  value: number;
  way: number;
  dir: 0 | 1 | -1;
}

/**
 * Gom các khúc chưa đi liền nhau trên cùng 1 con đường thành đoạn. `targets` = chỉ số khúc chưa đi trong KCN,
 * `scores[i]` = điểm nhà máy hai bên của khúc i (0 = đường trống). Đoạn ngắn hơn minLen (sót do GPS lệch) bỏ qua.
 * preferFactories: đường trống chỉ được 1/4 điểm — vẫn dẫn tới khi đã đi hết đường có nhà máy.
 */
export function unvisitedRuns(g: RoadGraph, targets: readonly number[], scores: ArrayLike<number>, opts: { minLen?: number; preferFactories?: boolean } = {}): Run[] {
  const minLen = opts.minLen ?? 30;
  const sorted = [...targets].sort((a, b) => a - b);
  const runs: Run[] = [];
  let cur: Run | null = null;
  const close = () => {
    if (cur && cur.len >= minLen) {
      if (!cur.factory && opts.preferFactories !== false) cur.value *= 0.25;
      runs.push(cur);
    }
    cur = null;
  };
  for (const i of sorted) {
    const e = g.edges[i];
    const sc = Math.min(6, scores[i] ?? 0);
    const joins = cur && cur.way === e.way && cur.nodes[cur.nodes.length - 1] === e.a;
    if (!joins) {
      close();
      cur = { pieces: [], nodes: [e.a], len: 0, factory: false, value: 0, way: e.way, dir: e.dir };
    }
    const r = cur!;
    r.pieces.push(i);
    r.nodes.push(e.b);
    r.len += e.len;
    r.value += e.len * (1 + sc / 2);
    if (sc > 0) r.factory = true;
  }
  close();
  return runs;
}

/** Cắt đoạn đang đứng giữa thành 2 nửa (trước / sau chỗ đứng) để không bị dẫn quay về đầu đoạn. */
function splitAtEdge(g: RoadGraph, run: Run, edge: number, scores: ArrayLike<number>, preferFactories: boolean): Run[] {
  const k = run.pieces.indexOf(edge);
  if (k < 0) return [run];
  const part = (from: number, to: number): Run | null => {
    if (to < from) return null;
    const pieces = run.pieces.slice(from, to + 1);
    let len = 0, value = 0, factory = false;
    for (const i of pieces) {
      const sc = Math.min(6, scores[i] ?? 0);
      len += g.edges[i].len;
      value += g.edges[i].len * (1 + sc / 2);
      if (sc > 0) factory = true;
    }
    if (!factory && preferFactories) value *= 0.25;
    return { ...run, pieces, nodes: run.nodes.slice(from, to + 2), len, value, factory };
  };
  return [part(0, k - 1), part(k + 1, run.pieces.length - 1)].filter((r): r is Run => !!r && r.len >= 15);
}

/** Điểm chọn đoạn: đáng đi (dài, có nhà máy) chia cho quãng phải đi tới — mũ 1,5 để ưu tiên đoạn gần, đỡ chạy vòng. */
export const runScore = (value: number, cost: number) => value / Math.pow(cost + 100, 1.5);

// ── Lộ trình + hướng dẫn rẽ ─────────────────────────────────────────────────
export type ManeuverKind = 'left' | 'right' | 'slight-left' | 'slight-right' | 'uturn' | 'run-start' | 'arrive';

export interface Maneuver {
  /** vị trí trên lộ trình (m tính từ chỗ bắt đầu) */
  s: number;
  kind: ManeuverKind;
  /** "Rẽ trái vào Đường số 5" */
  text: string;
}

export type NavTarget =
  | { kind: 'run'; len: number; factory: boolean; pieces: number[]; name: string | null }
  | { kind: 'point'; name: string; point: LatLng };

export interface NavRoute {
  coords: [number, number][];
  /** quãng tích luỹ tới từng điểm của coords */
  cum: number[];
  total: number;
  /** quãng đi tới đầu đoạn chưa đi (= total khi dẫn tới công ty) */
  approach: number;
  maneuvers: Maneuver[];
  target: NavTarget;
}

const TURN_TEXT: Record<'left' | 'right' | 'slight-left' | 'slight-right' | 'uturn', string> = {
  left: 'Rẽ trái', right: 'Rẽ phải', 'slight-left': 'Chếch trái', 'slight-right': 'Chếch phải', uturn: 'Quay đầu',
};

/** Loại rẽ theo góc (độ, dương = sang phải); dưới 35° coi là đi thẳng → null. */
export function turnKind(angle: number): 'left' | 'right' | 'slight-left' | 'slight-right' | 'uturn' | null {
  const a = Math.abs(angle);
  if (a < 35) return null;
  if (a >= 155) return 'uturn';
  if (a < 60) return angle > 0 ? 'slight-right' : 'slight-left';
  return angle > 0 ? 'right' : 'left';
}

const ll = (p: readonly [number, number]): LatLng => ({ lat: p[0], lng: p[1] });

/** Hướng của lộ trình quanh điểm i: lùi / tiến khoảng `span` mét để không bị khúc ngắn làm lệch. */
function dirAround(coords: readonly [number, number][], cum: readonly number[], i: number, forward: boolean, span = 18): number | null {
  if (forward) {
    let j = i + 1;
    while (j < coords.length - 1 && cum[j] - cum[i] < span) j++;
    return j < coords.length && cum[j] - cum[i] > 0.5 ? bearing(ll(coords[i]), ll(coords[j])) : null;
  }
  let j = i - 1;
  while (j > 0 && cum[i] - cum[j] < span) j--;
  return j >= 0 && cum[i] - cum[j] > 0.5 ? bearing(ll(coords[j]), ll(coords[i])) : null;
}

/**
 * Ghép lộ trình từ dãy nút (+ điểm đầu = chỗ đứng, điểm cuối tuỳ chọn) và tính các chỗ rẽ: báo ở ngã ba / ngã tư
 * (nút ≥ 3 ngả) khi góc rẽ ≥ 35°, và ở góc cua sang đường khác (≥ 60°); khúc cong trên cùng 1 đường thì không báo.
 */
function assemble(g: RoadGraph, startPt: [number, number], nodes: readonly number[], endPt: [number, number] | null, heading: number | null) {
  const coords: [number, number][] = [startPt];
  const nodeAt: number[] = [-1];
  const wayAt: (number | null)[] = [null]; // đường của đoạn đi TỚI điểm i
  const edgeBetween = (u: number, v: number) => g.adj[u].find(e => (g.edges[e].a === u && g.edges[e].b === v) || (g.edges[e].b === u && g.edges[e].a === v));
  nodes.forEach((n, k) => {
    const p = g.pts[n];
    const last = coords[coords.length - 1];
    if (Math.abs(last[0] - p[0]) < 1e-9 && Math.abs(last[1] - p[1]) < 1e-9) { nodeAt[coords.length - 1] = n; return; }
    coords.push(p);
    nodeAt.push(n);
    const e = k > 0 ? edgeBetween(nodes[k - 1], n) : undefined;
    wayAt.push(e != null ? g.edges[e].way : null);
  });
  if (endPt) { coords.push(endPt); nodeAt.push(-1); wayAt.push(wayAt[wayAt.length - 1] ?? null); }
  const cum = [0];
  const pr = projector(startPt[0], startPt[1]);
  for (let i = 1; i < coords.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pr.x(coords[i][1]) - pr.x(coords[i - 1][1]), pr.y(coords[i][0]) - pr.y(coords[i - 1][0])));
  }
  // Đoạn đầu từ chỗ đứng tới nút đầu chưa có đường → lấy theo đoạn kế tiếp
  if (wayAt.length > 1 && wayAt[1] == null) wayAt[1] = wayAt[2] ?? null;

  const maneuvers: Maneuver[] = [];
  // Ngay chỗ đứng: đang chạy mà lộ trình đi hướng khác (đứng ở ngã tư phải rẽ / phải quay đầu) → báo luôn
  if (heading != null && coords.length >= 2) {
    const first = dirAround(coords, cum, 0, true);
    const kind = first != null ? turnKind(angleDiff(heading, first)) : null;
    if (kind) {
      const road = wayAt[1] != null ? g.wayName.get(wayAt[1]!) : undefined;
      maneuvers.push({ s: 0, kind, text: kind === 'uturn' ? 'Quay đầu' : `${TURN_TEXT[kind]}${road ? ` vào ${road}` : ''}` });
    }
  }
  for (let i = 1; i < coords.length - 1; i++) {
    const n = nodeAt[i];
    if (n < 0) continue;
    const deg = nodeDegree(g, n);
    const way = wayAt[i + 1];
    const corner = deg === 2 && way != null && wayAt[i] != null && way !== wayAt[i];
    if (deg < 3 && !corner) continue;
    const din = dirAround(coords, cum, i, false), dout = dirAround(coords, cum, i, true);
    if (din == null || dout == null) continue;
    const angle = angleDiff(din, dout);
    if (corner && Math.abs(angle) < 60) continue;
    const kind = turnKind(angle);
    if (!kind) continue;
    const road = way != null ? g.wayName.get(way) : undefined;
    maneuvers.push({ s: cum[i], kind, text: `${TURN_TEXT[kind]}${road ? ` vào ${road}` : ''}` });
  }
  return { coords, cum, nodeAt, total: cum[cum.length - 1] ?? 0, maneuvers };
}

export interface PlanOpts {
  /** hướng đang chạy (độ) — null khi đứng yên */
  heading: number | null;
  /** chỉ số khúc chưa đi trong KCN */
  targets: readonly number[];
  /** điểm nhà máy hai bên theo chỉ số khúc */
  scores: ArrayLike<number>;
  preferFactories?: boolean;
  /** khúc đã dẫn qua trong lần dẫn đường này (đi rồi mà GPS lệch chưa tô kịp) → không dẫn lại */
  skip?: ReadonlySet<number>;
  /** cách đường xa hơn bấy nhiêu thì không dẫn (m) */
  maxSnapM?: number;
}

const fmtLen = (m: number) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} km`);

/** Chọn đoạn chưa đi đáng đi nhất và lập lộ trình: tới đầu đoạn rồi đi hết đoạn. null = không còn đoạn nào / ở quá xa đường. */
export function planNextRun(g: RoadGraph, p: LatLng, o: PlanOpts): NavRoute | null {
  const snap = snapToGraph(g, p, o.maxSnapM ?? 80, o.heading);
  if (!snap) return null;
  const prefer = o.preferFactories !== false;
  const targets = o.skip?.size ? o.targets.filter(i => !o.skip!.has(i)) : o.targets;
  let runs = unvisitedRuns(g, targets, o.scores, { preferFactories: prefer });
  runs = runs.flatMap(r => (r.pieces.includes(snap.edge) ? splitAtEdge(g, r, snap.edge, o.scores, prefer) : [r]));
  if (!runs.length) return null;
  const s = shortestFrom(g, snap, o.heading);
  let best: { run: Run; forward: boolean; cost: number; score: number } | null = null;
  for (const run of runs) {
    const first = run.nodes[0], last = run.nodes[run.nodes.length - 1];
    const options: { forward: boolean; cost: number }[] = [];
    if (run.dir !== -1) options.push({ forward: true, cost: s.dist[first] });
    if (run.dir !== 1) options.push({ forward: false, cost: s.dist[last] });
    for (const opt of options) {
      if (!Number.isFinite(opt.cost)) continue;
      const score = runScore(run.value, opt.cost);
      if (!best || score > best.score) best = { run, forward: opt.forward, cost: opt.cost, score };
    }
  }
  if (!best) return null;
  const runNodes = best.forward ? best.run.nodes : [...best.run.nodes].reverse();
  const approachNodes = nodesTo(s, runNodes[0]);
  const all = [...approachNodes, ...runNodes.slice(1)];
  const route = assemble(g, snap.pt, all, null, o.heading);
  // Quãng tới đầu đoạn = vị trí nút đầu đoạn trên lộ trình (đường ngắn nhất không đi qua 1 nút 2 lần → lần gặp đầu tiên)
  const startIdx = route.nodeAt.indexOf(runNodes[0]);
  const approach = startIdx >= 0 ? route.cum[startIdx] : 0;
  const name = g.wayName.get(best.run.way) ?? null;
  const maneuvers = route.maneuvers.filter(m => m.s < route.total - 5);
  maneuvers.push({
    s: approach + 0.5, kind: 'run-start',
    text: `Vào đoạn chưa đi${name ? ` trên ${name}` : ''} · ${fmtLen(best.run.len)}${best.run.factory ? ' · có nhà máy hai bên' : ''}`,
  });
  maneuvers.push({ s: route.total, kind: 'arrive', text: 'Hết đoạn chưa đi — tìm đoạn tiếp theo' });
  maneuvers.sort((a, b) => a.s - b.s);
  return {
    ...route, approach, maneuvers,
    target: { kind: 'run', len: best.run.len, factory: best.run.factory, pieces: best.run.pieces, name },
  };
}

/** Lộ trình tới 1 điểm (công ty): tới chỗ trên đường gần điểm nhất. null = không có đường gần điểm / không tới được. */
export function planToPoint(g: RoadGraph, p: LatLng, target: LatLng, name: string, heading: number | null, maxSnapM = 80): NavRoute | null {
  const from = snapToGraph(g, p, maxSnapM, heading);
  const to = snapToGraph(g, target, 250);
  if (!from || !to) return null;
  const s = shortestFrom(g, from, heading);
  const e = g.edges[to.edge];
  // Cùng khúc → đi thẳng tới điểm
  const opts: { node: number; cost: number }[] = [];
  if (canGo(e, e.a)) opts.push({ node: e.a, cost: s.dist[e.a] + to.t * e.len });
  if (canGo(e, e.b)) opts.push({ node: e.b, cost: s.dist[e.b] + (1 - to.t) * e.len });
  const pick = opts.filter(x => Number.isFinite(x.cost)).sort((a, b) => a.cost - b.cost)[0];
  if (!pick && from.edge !== to.edge) return null;
  const nodes = from.edge === to.edge ? [] : nodesTo(s, pick!.node);
  const route = assemble(g, from.pt, nodes, to.pt, heading);
  const maneuvers = route.maneuvers.filter(m => m.s < route.total - 5);
  maneuvers.push({ s: route.total, kind: 'arrive', text: `Đến ${name}` });
  return { ...route, approach: route.total, maneuvers, target: { kind: 'point', name, point: target } };
}

// ── Theo dõi trên lộ trình ──────────────────────────────────────────────────
export interface RouteProgress {
  /** đã đi được bao nhiêu mét trên lộ trình */
  s: number;
  /** cách lộ trình (m) */
  off: number;
}

/**
 * Chỗ đang đứng tương ứng với vị trí nào trên lộ trình. Ưu tiên tìm quanh vị trí lần trước (`hintS`) — lộ trình có thể
 * đi qua 1 con đường 2 lần (vào ngõ cụt rồi quay ra).
 */
export function routeProgress(route: NavRoute, p: LatLng, hintS = 0): RouteProgress {
  const pr = projector(p.lat, p.lng);
  const { coords, cum } = route;
  const scan = (lo: number, hi: number) => {
    let best: RouteProgress = { s: hintS, off: Infinity };
    for (let i = 1; i < coords.length; i++) {
      if (cum[i] < lo || cum[i - 1] > hi) continue;
      const ax = pr.x(coords[i - 1][1]), ay = pr.y(coords[i - 1][0]), bx = pr.x(coords[i][1]), by = pr.y(coords[i][0]);
      const d = pointSegDist(0, 0, ax, ay, bx, by);
      if (d < best.off) {
        const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
        const t = l2 > 0 ? Math.max(0, Math.min(1, (-ax * dx - ay * dy) / l2)) : 0;
        best = { s: cum[i - 1] + (cum[i] - cum[i - 1]) * t, off: d };
      }
    }
    return best;
  };
  const near = scan(hintS - 40, hintS + 400);
  if (near.off <= 30) return near;
  const all = scan(-Infinity, Infinity);
  return all.off < near.off ? all : near;
}

/** Chỗ rẽ kế tiếp (và chỗ sau đó) tính từ vị trí s. */
export function nextManeuvers(route: NavRoute, s: number): { next: Maneuver | null; after: Maneuver | null } {
  // Chỗ rẽ ngay tại điểm xuất phát (s = 0) vẫn hiện cho tới khi đã đi được ~15 m
  const ahead = route.maneuvers.filter(m => m.s > s + 3 || (m.kind === 'arrive' && m.s >= s) || (m.s === 0 && s < 15));
  return { next: ahead[0] ?? null, after: ahead[1] ?? null };
}

/** Câu đọc to: "Sau 150 mét, rẽ trái vào Đường số 5" (làm tròn 50 m; gần thì đọc ngay chỗ rẽ). */
export function spokenInstruction(m: Maneuver, distM: number): string {
  const lower = m.text.charAt(0).toLowerCase() + m.text.slice(1);
  if (distM <= 40) return m.text;
  const r = distM >= 1000 ? `${(Math.round(distM / 100) / 10).toLocaleString('vi-VN')} ki lô mét` : `${Math.max(50, Math.round(distM / 50) * 50)} mét`;
  return `Sau ${r}, ${lower}`;
}
