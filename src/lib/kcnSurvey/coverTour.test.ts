import { describe, expect, it } from 'vitest';
import { splitRoads, type RoadWay } from './track';
import { buildRoadGraph, planNextRun, pointAlong, snapToGraph } from './navigate';
import { planCoverTour, tourOverhead } from './coverTour';

const LAT = 10.72, LNG = 106.94;
const P = (x: number, y: number): [number, number] => [LAT + y / 111_320, LNG + x / (111_320 * Math.cos((LAT * Math.PI) / 180))];
const at = (x: number, y: number) => { const [lat, lng] = P(x, y); return { lat, lng }; };

/** KCN bàn cờ n × n đường (cách nhau `step` m): đường ngang id 1.., đường dọc id 100.. */
const grid = (n: number, step: number): RoadWay[] => {
  const xs = [...Array(n).keys()].map(i => i * step);
  return [
    ...xs.map((y, k) => ({ id: 1 + k, name: `Đường ngang ${k + 1}`, kind: 'minor' as const, coords: xs.map(x => P(x, y)) })),
    ...xs.map((x, k) => ({ id: 100 + k, name: `Đường dọc ${k + 1}`, kind: 'minor' as const, coords: xs.map(y => P(x, y)) })),
  ];
};
/** 2×2 ô: 3 đường ngang (y = 0, 200, 400) × 3 đường dọc (x = 0, 200, 400), mỗi đường dài 400 m. */
const GRID = grid(3, 200);

const setup = (ways: RoadWay[]) => {
  const pieces = splitRoads(ways);
  const g = buildRoadGraph(pieces, ways);
  return { pieces, g, all: pieces.map((_, i) => i) };
};

/** Số lần đi qua từng khúc trên lộ trình. */
const passes = (edgeAt: number[]) => {
  const m = new Map<number, number>();
  for (const e of edgeAt) if (e >= 0) m.set(e, (m.get(e) ?? 0) + 1);
  return m;
};

describe('lộ trình đi 1 lượt hết đường', () => {
  it('KCN bàn cờ: qua hết mọi khúc, đi lặp ít', () => {
    const { g, all } = setup(GRID);
    const r = planCoverTour(g, at(10, 0), { heading: 90, targets: all })!;
    expect(r).not.toBeNull();
    expect(r.target.kind).toBe('tour');
    const snapEdge = snapToGraph(g, at(10, 0), 80, 90)!.edge;
    const seen = passes(r.edgeAt!);
    for (const i of all) if (i !== snapEdge) expect(seen.get(i) ?? 0).toBeGreaterThan(0);
    // Xuất phát gần góc (khúc sau lưng chưa đi) → tối ưu phải đi lặp 2 đoạn: 200 m + 400 m giữa các ngã ba
    expect(r.total).toBeLessThan(3000);
    expect(tourOverhead(r)).toBeLessThan(650);
    // Không khúc nào đi quá 2 lần
    expect(Math.max(...seen.values())).toBeLessThanOrEqual(2);
  });

  it('KCN bàn cờ lớn: ngắn hơn kiểu "đoạn gần nhất" nối tiếp nhau', () => {
    const { g, all } = setup(grid(6, 150));
    const start = at(375, 225);
    const tour = planCoverTour(g, start, { heading: 0, targets: all })!;
    expect(tourOverhead(tour) / 9000).toBeLessThan(0.15); // 9 km đường, đi lặp < 15%
    // Mô phỏng kiểu cũ: đi hết đoạn này rồi tìm đoạn gần nhất tiếp theo
    let pos = start, heading: number | null = 0, total = 0;
    const skip = new Set<number>();
    for (let k = 0; k < 200; k++) {
      const r = planNextRun(g, pos, { heading, targets: all, scores: new Float32Array(all.length), preferFactories: false, skip });
      if (!r || r.target.kind !== 'run') break;
      total += r.total;
      r.target.pieces.forEach(i => skip.add(i));
      r.edgeAt?.forEach(i => { if (i >= 0) skip.add(i); });
      const end = pointAlong(r, r.total);
      pos = { lat: end.lat, lng: end.lng };
      heading = end.bearing;
    }
    expect(tour.total).toBeLessThan(total * 0.95);
  });

  it('ngõ cụt: vào hết rồi báo quay đầu, kết thúc ở đầu kia (không vòng về chỗ cũ)', () => {
    const ways: RoadWay[] = [
      { id: 1, name: 'Đường số 1', kind: 'main', coords: [P(0, 0), P(200, 0), P(400, 0)] },
      { id: 2, name: 'Đường số 2', kind: 'minor', coords: [P(200, 0), P(200, 300)] },
    ];
    const { g, all } = setup(ways);
    const r = planCoverTour(g, at(10, 0), { heading: 90, targets: all })!;
    expect(r).not.toBeNull();
    // Tối ưu: đông tới 400 → quay đầu về ngã ba → lên hết Đường số 2 (875 m); kiểu kia 975 m
    expect(r.total).toBeLessThan(900);
    expect(r.maneuvers.some(m => m.kind === 'uturn')).toBe(true);
    const end = pointAlong(r, r.total);
    expect(Math.abs(end.lat - at(200, 300).lat) * 111_320).toBeLessThan(5);
  });

  it('đường 1 chiều: khúc 1 chiều chỉ đi đúng chiều', () => {
    const ways = GRID.map(w => (w.id === 3 ? { ...w, oneway: 1 as const } : w)); // đường ngang trên cùng: chỉ Tây → Đông
    const { g, all, pieces } = setup(ways);
    const r = planCoverTour(g, at(10, 0), { heading: 90, targets: all })!;
    expect(r).not.toBeNull();
    for (let i = 1; i < r.coords.length; i++) {
      const e = r.edgeAt![i];
      if (e < 0 || pieces[e].wayId !== 3) continue;
      expect(r.coords[i][1]).toBeGreaterThan(r.coords[i - 1][1]); // kinh độ tăng = đi về phía Đông
    }
  });

  it('không còn khúc chưa đi / đứng xa đường → null', () => {
    const { g, all } = setup(GRID);
    expect(planCoverTour(g, at(10, 0), { heading: null, targets: [] })).toBeNull();
    expect(planCoverTour(g, at(10, 0), { heading: null, targets: all, skip: new Set(all) })).toBeNull();
    expect(planCoverTour(g, at(100, 100), { heading: null, targets: all, maxSnapM: 50 })).toBeNull();
  });

  it('bỏ cụm khúc lẻ quá ngắn (sót do GPS lệch)', () => {
    const { g, pieces } = setup(GRID);
    const one = pieces.findIndex(p => p.wayId === 12); // 1 khúc ≤ 25 m trên đường dọc 3
    expect(planCoverTour(g, at(10, 0), { heading: 90, targets: [one] })).toBeNull();
  });
});

describe('điểm trên lộ trình', () => {
  it('nội suy theo quãng s, có hướng đi', () => {
    const { g, all } = setup(GRID);
    const r = planCoverTour(g, at(10, 0), { heading: 90, targets: all })!;
    const a = pointAlong(r, 0);
    expect(Math.abs(a.lat - r.coords[0][0])).toBeLessThan(1e-9);
    const mid = pointAlong(r, 50);
    expect(mid.bearing).not.toBeNull();
    const far = pointAlong(r, r.total + 100);
    expect(far.lat).toBeCloseTo(r.coords[r.coords.length - 1][0], 9);
  });
});
