// Lộ trình "đi 1 lượt hết đường" khi khảo sát KCN — bài toán người đưa thư (Rural Postman) giải gần đúng. Hàm thuần.
//
// Cần đi qua MỌI khúc đường chưa đi trong KCN mà đi lặp càng ít càng tốt (KCN bàn cờ: đi hết dãy này sang dãy kia,
// không quay lại đường vừa đi). Cách làm (Frederickson):
//   1. Khúc chưa đi tạo thành nhiều cụm rời → nối các cụm bằng cây khung ngắn nhất (đường nối = đoạn phải đi lại).
//   2. Nút có số ngả lẻ (ngã ba, ngõ cụt) → ghép cặp gần nhau rồi thêm đường nối giữa cặp, để đi được 1 nét liền
//      (chu trình Euler). Chừa chỗ xuất phát + 1 nút làm điểm kết thúc — không cần quay về chỗ cũ.
//   3. Đi theo chu trình Euler (Hierholzer), ở mỗi ngã ưu tiên đi thẳng, rồi rẽ phải, hạn chế quay đầu.
//   4. Thay đoạn nối bằng đường ngắn nhất THẬT (tôn trọng đường 1 chiều); khúc 1 chiều thì đi đúng chiều; khúc đã đi
//      qua lúc nối rồi thì không quay lại.
import type { LatLng } from '../geo';
import { angleDiff, bearing } from './heading';
import { assemble, canGo, MinHeap, nodesTo, shortestFrom, snapToGraph, UTURN_PENALTY_M, type NavRoute, type RoadGraph } from './navigate';

export interface TourOpts {
  /** hướng đang chạy (độ) — null khi đứng yên */
  heading: number | null;
  /** chỉ số khúc chưa đi trong KCN */
  targets: readonly number[];
  /** khúc đã dẫn qua trong lần dẫn đường này (GPS lệch chưa tô kịp) → không tính */
  skip?: ReadonlySet<number>;
  maxSnapM?: number;
  /** Cụm khúc chưa đi nằm riêng lẻ ngắn hơn bấy nhiêu mét thì bỏ (sót do GPS lệch) */
  minClusterM?: number;
}

/** Quá nhiều khúc thì thôi (máy yếu tính lâu) — dùng kiểu dẫn từng đoạn. */
export const TOUR_MAX_PIECES = 5000;

const ll = (p: readonly [number, number]): LatLng => ({ lat: p[0], lng: p[1] });

class UnionFind {
  private p: Int32Array;
  constructor(n: number) { this.p = new Int32Array(n).map((_, i) => i); }
  find(x: number): number {
    while (this.p[x] !== x) { this.p[x] = this.p[this.p[x]]; x = this.p[x]; }
    return x;
  }
  union(a: number, b: number) { const ra = this.find(a), rb = this.find(b); if (ra !== rb) this.p[ra] = rb; }
}

/** Dijkstra dùng lại bộ nhớ (đánh dấu lượt thay cho xoá mảng) — chạy hàng trăm lần cho 1 lộ trình. */
class Searcher {
  private dist: Float64Array;
  private prevEdge: Int32Array;
  private prevNode: Int32Array;
  private stamp: Int32Array;
  private cur = 0;
  constructor(n: number) {
    this.dist = new Float64Array(n);
    this.prevEdge = new Int32Array(n);
    this.prevNode = new Int32Array(n);
    this.stamp = new Int32Array(n);
  }
  d(n: number) { return this.stamp[n] === this.cur ? this.dist[n] : Infinity; }
  private set(n: number, d: number, e: number, from: number) {
    this.stamp[n] = this.cur; this.dist[n] = d; this.prevEdge[n] = e; this.prevNode[n] = from;
  }
  /**
   * Chạy từ các nút nguồn; `stop(nút, quãng)` đúng thì dừng và trả nút đó. directed = tôn trọng đường 1 chiều.
   * `uturn` = cạnh vừa đi tới nút xuất phát: đi ngược lại ngay trên cạnh đó bị cộng phạt quay đầu.
   */
  run(g: RoadGraph, sources: Iterable<number>, o: { stop?: (n: number, d: number) => boolean; maxDist?: number; directed?: boolean; uturn?: { node: number; edge: number } } = {}): number {
    this.cur += 1;
    const heap = new MinHeap();
    for (const s of sources) { this.set(s, 0, -1, -1); heap.push(0, s); }
    while (heap.size) {
      const [d, u] = heap.pop();
      if (d > this.d(u)) continue;
      if (o.stop?.(u, d)) return u;
      if (o.maxDist != null && d > o.maxDist) return -1;
      for (const ei of g.adj[u]) {
        const e = g.edges[ei];
        if (o.directed && !canGo(e, u)) continue;
        const v = e.a === u ? e.b : e.a;
        let nd = d + e.len;
        if (o.uturn && d === 0 && u === o.uturn.node && ei === o.uturn.edge && g.adj[u].length > 1) nd += UTURN_PENALTY_M;
        if (nd < this.d(v)) { this.set(v, nd, ei, u); heap.push(nd, v); }
      }
    }
    return -1;
  }
  /** Đường từ nguồn tới `n` (lượt chạy gần nhất): các nút (nguồn trước) + các cạnh. */
  path(n: number): { nodes: number[]; edges: number[] } {
    const nodes: number[] = [], edges: number[] = [];
    let cur = n;
    for (let guard = 0; cur >= 0 && guard < 1e6; guard++) {
      nodes.push(cur);
      const e = this.prevEdge[cur];
      if (e < 0) break;
      edges.push(e);
      cur = this.prevNode[cur];
    }
    return { nodes: nodes.reverse(), edges: edges.reverse() };
  }
}

/** Ghép đầy đủ (bảng khoảng cách + cải thiện 2-opt) khi số nút lẻ không quá bấy nhiêu; nhiều hơn thì ghép tham lam. */
const FULL_MATCH_MAX = 48;

/**
 * Ghép cặp các nút (số lẻ nút) theo đường ngắn nhất, chừa lại đúng 1 nút (= nơi kết thúc lộ trình) — tổng quãng nối
 * nhỏ nhất có thể. Ít nút: thêm 1 nút ảo cách mọi nút 0 m (ghép với nút ảo = được chừa), ghép tham lam rồi đổi cặp
 * 2-opt tới khi hết cải thiện. Nhiều nút: mỗi nút chỉ xét vài nút gần nhất.
 */
function matchOdd(g: RoadGraph, search: Searcher, nodes: readonly number[]): [number, number][] {
  if (nodes.length < 2) return [];
  if (nodes.length > FULL_MATCH_MAX) return greedyMatch(g, search, nodes).pairs.map(([a, b]) => [a, b]);
  const k = nodes.length, K = k + 1; // chỉ số k = nút ảo
  const D = new Float64Array(K * K);
  nodes.forEach((u, i) => {
    search.run(g, [u]);
    nodes.forEach((v, j) => { D[i * K + j] = search.d(v); });
  });
  const cost = (i: number, j: number) => (i === k || j === k ? 0 : D[i * K + j]);
  // Tham lam: cặp gần nhất ghép trước (nút ảo đứng cuối danh sách cạnh 0 m → được dùng sau cùng)
  const cand: [number, number, number][] = [];
  for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) cand.push([cost(i, j), i, j]);
  cand.sort((a, b) => a[0] - b[0]);
  const mate = new Int32Array(K).fill(-1);
  for (const [, i, j] of cand) if (mate[i] < 0 && mate[j] < 0) { mate[i] = j; mate[j] = i; }
  const free = [...Array(K).keys()].filter(i => mate[i] < 0);
  for (let t = 0; t + 1 < free.length; t += 2) { mate[free[t]] = free[t + 1]; mate[free[t + 1]] = free[t]; }
  // 2-opt: 2 cặp (a,b) (c,d) → (a,c)(b,d) hoặc (a,d)(b,c) nếu ngắn hơn
  for (let iter = 0, improved = true; improved && iter < 50; iter++) {
    improved = false;
    for (let a = 0; a < K; a++) {
      for (let c = a + 1; c < K; c++) {
        const b = mate[a], d = mate[c];
        if (b === c || b < a || d < c) continue; // mỗi cặp xét 1 lần, theo nút nhỏ hơn
        const now = cost(a, b) + cost(c, d);
        const x1 = cost(a, c) + cost(b, d), x2 = cost(a, d) + cost(b, c);
        if (x1 < now - 0.5 && x1 <= x2) { mate[a] = c; mate[c] = a; mate[b] = d; mate[d] = b; improved = true; }
        else if (x2 < now - 0.5) { mate[a] = d; mate[d] = a; mate[b] = c; mate[c] = b; improved = true; }
      }
    }
  }
  const out: [number, number][] = [];
  for (let i = 0; i < k; i++) if (mate[i] > i && mate[i] < k) out.push([nodes[i], nodes[mate[i]]]);
  return out;
}

/**
 * Ghép cặp tham lam các nút bậc lẻ theo đường ngắn nhất: mỗi nút tìm vài nút gần nhất, cặp gần nhất ghép trước.
 * Số lẻ nút thì chừa lại đúng 1 nút (= nơi kết thúc lộ trình).
 */
function greedyMatch(g: RoadGraph, search: Searcher, nodes: readonly number[]): { pairs: [number, number, number][]; left: number[] } {
  const pairs: [number, number, number][] = [];
  let pool = [...nodes];
  for (let round = 0; pool.length >= 2 && round < 6; round++) {
    const set = new Set(pool);
    const k = round === 0 ? 8 : pool.length;
    const cands: [number, number, number][] = [];
    for (const u of pool) {
      let found = 0;
      search.run(g, [u], {
        maxDist: round === 0 ? 4000 : undefined,
        stop: (v, d) => {
          if (v !== u && set.has(v)) { cands.push([d, u, v]); found += 1; }
          return found >= k;
        },
      });
    }
    cands.sort((a, b) => a[0] - b[0]);
    const matched = new Set<number>();
    for (const [d, u, v] of cands) {
      if (matched.has(u) || matched.has(v)) continue;
      if (pool.length - matched.size <= 1) break;
      matched.add(u); matched.add(v);
      pairs.push([u, v, d]);
    }
    pool = pool.filter(v => !matched.has(v));
    if (!cands.length) break;
  }
  return { pairs, left: pool };
}

/**
 * Lộ trình đi 1 lượt qua mọi khúc chưa đi (`targets`), xuất phát từ chỗ đang đứng. null = không còn khúc nào /
 * đứng quá xa đường / quá nhiều khúc (khi đó dùng planNextRun).
 */
export function planCoverTour(g: RoadGraph, p: LatLng, o: TourOpts): NavRoute | null {
  const snap = snapToGraph(g, p, o.maxSnapM ?? 80, o.heading);
  if (!snap) return null;
  const n = g.pts.length;

  // 1. Khúc cần đi: bỏ khúc đang đứng (đang đi trên nó), khúc vòng về chính nút, cụm lẻ quá ngắn
  let req = o.targets.filter(i => i !== snap.edge && !o.skip?.has(i) && g.edges[i] && g.edges[i].a !== g.edges[i].b);
  if (!req.length || req.length > TOUR_MAX_PIECES) return null;
  const uf = new UnionFind(n);
  for (const i of req) uf.union(g.edges[i].a, g.edges[i].b);
  const clusterLen = new Map<number, number>();
  for (const i of req) { const r = uf.find(g.edges[i].a); clusterLen.set(r, (clusterLen.get(r) ?? 0) + g.edges[i].len); }
  const minC = o.minClusterM ?? 40;
  req = req.filter(i => (clusterLen.get(uf.find(g.edges[i].a)) ?? 0) >= minC);
  if (!req.length) return null;

  // 2. Xuất phát ở đầu khúc đang đứng tới được trước (đã tính phạt quay đầu khi đang chạy)
  const S = shortestFrom(g, snap, o.heading);
  const e0 = g.edges[snap.edge];
  const s = S.dist[e0.a] <= S.dist[e0.b] ? e0.a : e0.b;
  if (!Number.isFinite(S.dist[s])) return null;

  // 3. Nối các cụm bằng cây khung ngắn nhất (kiểu Prim, bắt đầu từ cụm chứa chỗ xuất phát)
  const compOf = new Map<number, number>();
  for (const i of req) { const e = g.edges[i]; compOf.set(e.a, uf.find(e.a)); compOf.set(e.b, uf.find(e.b)); }
  const members = new Map<number, number[]>();
  for (const [node, r] of compOf) { const l = members.get(r); if (l) l.push(node); else members.set(r, [node]); }
  const tree = new Set<number>([s]);
  const joined = new Set<number>();
  const sComp = compOf.get(s);
  if (sComp != null) { joined.add(sComp); for (const m of members.get(sComp)!) tree.add(m); }
  const search = new Searcher(n);
  const deadhead: number[] = [];
  while (joined.size < members.size) {
    const hit = search.run(g, tree, { stop: u => { const c = compOf.get(u); return c != null && !joined.has(c); } });
    if (hit < 0) break; // cụm còn lại không tới được trên mạng đường đã tải → bỏ
    const path = search.path(hit);
    deadhead.push(...path.edges);
    for (const v of path.nodes) tree.add(v);
    const c = compOf.get(hit)!;
    joined.add(c);
    for (const m of members.get(c)!) tree.add(m);
  }
  req = req.filter(i => joined.has(compOf.get(g.edges[i].a)!));
  if (!req.length) return null;

  // Đa đồ thị: khúc cần đi + đoạn nối (mỗi phần tử = 1 lần đi qua 1 cạnh)
  const mE: number[] = [];
  const mReq: boolean[] = [];
  const inc = new Map<number, number[]>();
  const deg = new Map<number, number>();
  const addM = (ei: number, isReq: boolean) => {
    const id = mE.length;
    mE.push(ei); mReq.push(isReq);
    const e = g.edges[ei];
    for (const v of [e.a, e.b]) {
      const l = inc.get(v); if (l) l.push(id); else inc.set(v, [id]);
      deg.set(v, (deg.get(v) ?? 0) + 1);
    }
  };
  for (const i of req) addM(i, true);
  for (const i of deadhead) addM(i, false);

  // 4. Nút bậc lẻ → ghép cặp, thêm đường nối giữa cặp. Đi 1 nét từ s cần đúng 2 nút lẻ: s và nơi kết thúc.
  const odd = [...deg].filter(([, d]) => d % 2 === 1).map(([v]) => v);
  const sOdd = odd.includes(s);
  // s lẻ: ghép các nút lẻ còn lại, chừa 1 nút làm nơi kết thúc. s chẵn: thêm s vào để ghép (đoạn nối s → u làm s lẻ),
  // nút được "chừa" mà là s thì lộ trình vòng về chỗ xuất phát
  const pairs = matchOdd(g, search, sOdd ? odd.filter(v => v !== s) : [...odd, s]);
  for (const [a, b] of pairs) {
    if (search.run(g, [a], { stop: u => u === b }) < 0) continue;
    for (const ei of search.path(b).edges) addM(ei, false);
  }

  // 5. Đi 1 nét (Hierholzer): ở mỗi nút chọn cạnh rẽ ít nhất — thẳng > phải > trái > quay đầu
  const used = new Uint8Array(mE.length);
  const other = (id: number, v: number) => { const e = g.edges[mE[id]]; return e.a === v ? e.b : e.a; };
  const brg = (u: number, v: number) => bearing(ll(g.pts[u]), ll(g.pts[v]));
  const stackN = [s], stackE = [-1];
  const stackH: (number | null)[] = [o.heading];
  const outN: number[] = [], outE: number[] = [];
  while (stackN.length) {
    const v = stackN[stackN.length - 1];
    const hin = stackH[stackH.length - 1];
    let pick = -1, best = Infinity;
    for (const id of inc.get(v) ?? []) {
      if (used[id]) continue;
      let score = mReq[id] ? 0 : 5;
      if (hin != null) {
        const a = angleDiff(hin, brg(v, other(id, v)));
        score += Math.abs(a) + (a < -20 ? 15 : 0) + (Math.abs(a) > 150 ? 400 : 0);
      }
      if (score < best) { best = score; pick = id; }
    }
    if (pick < 0) {
      outN.push(stackN.pop()!); outE.push(stackE.pop()!); stackH.pop();
      continue;
    }
    used[pick] = 1;
    const w = other(pick, v);
    stackN.push(w); stackE.push(pick); stackH.push(brg(v, w));
  }
  outN.reverse(); outE.reverse(); // outE[j] = cạnh đi từ outN[j-1] tới outN[j]

  // 6. Dãy nút đi thật: khúc cần đi theo thứ tự Euler, đoạn nối = đường ngắn nhất có xét đường 1 chiều
  const seq: number[] = [s];
  const passed = new Set<number>();
  let cur = s, lastEdge = -1;
  for (let j = 1; j < outN.length; j++) {
    const id = outE[j];
    if (id < 0 || !mReq[id]) continue;
    const ei = mE[id];
    if (passed.has(ei)) continue; // đã đi qua lúc nối đường → không quay lại
    const e = g.edges[ei];
    let from = outN[j - 1], to = outN[j];
    if (!canGo(e, from)) [from, to] = [to, from];
    if (from !== cur) {
      const hit = search.run(g, [cur], { directed: true, stop: u => u === from, uturn: lastEdge >= 0 ? { node: cur, edge: lastEdge } : undefined });
      if (hit < 0) continue; // không tới được đúng chiều → bỏ khúc này
      const path = search.path(from);
      path.nodes.slice(1).forEach(v => seq.push(v));
      path.edges.forEach(x => passed.add(x));
      if (path.edges.length) lastEdge = path.edges[path.edges.length - 1];
      cur = from;
      if (passed.has(ei)) continue; // đoạn nối vừa đi qua chính khúc này
    }
    seq.push(to);
    passed.add(ei);
    cur = to;
    lastEdge = ei;
  }
  if (seq.length < 2) return null;

  // 7. Lộ trình: từ chỗ đứng tới s rồi theo dãy nút; tô tím khúc cần đi ở lần qua đầu tiên
  const all = [...nodesTo(S, s), ...seq.slice(1)];
  const route = assemble(g, snap.pt, all, null, o.heading);
  const reqSet = new Set(req);
  const seen = new Set<number>();
  const coverAt = route.edgeAt.map(ei => {
    if (ei < 0 || !reqSet.has(ei) || seen.has(ei)) return false;
    seen.add(ei);
    return true;
  });
  const startIdx = route.nodeAt.indexOf(s);
  const maneuvers = route.maneuvers.filter(m => m.s < route.total - 5);
  maneuvers.push({ s: route.total, kind: 'arrive', text: 'Hết lộ trình — đã qua hết đường chưa đi' });
  return {
    coords: route.coords, cum: route.cum, total: route.total,
    approach: startIdx >= 0 ? route.cum[startIdx] : 0,
    maneuvers, edgeAt: route.edgeAt, coverAt,
    target: { kind: 'tour', len: req.reduce((m, i) => m + g.edges[i].len, 0), pieces: req },
  };
}

/** Quãng đi lặp / đi nối của lộ trình 1 lượt (m) = tổng quãng − quãng qua đường chưa đi lần đầu. */
export function tourOverhead(r: NavRoute): number {
  if (!r.coverAt) return 0;
  let cover = 0;
  for (let i = 1; i < r.coords.length; i++) if (r.coverAt[i]) cover += r.cum[i] - r.cum[i - 1];
  return Math.max(0, r.total - cover);
}
