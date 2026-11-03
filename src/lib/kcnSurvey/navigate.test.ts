import { describe, expect, it } from 'vitest';
import { splitRoads, type RoadWay } from './track';
import {
  buildRoadGraph, nodeDegree, snapToGraph, shortestFrom, unvisitedRuns, planNextRun, planToPoint, routeProgress, nextManeuvers,
  spokenInstruction, turnKind, runScore,
} from './navigate';
import { angleDiff, bearing, compassFromEvent, displayHeading, normDeg, smoothAngle } from './heading';
import { sanitizeMarks, simplifyPath, arrowHead } from './markup';
import { onewayOf } from './overpass';

// Quanh KCN Nhơn Trạch: 1 m bắc ≈ 1/111320 độ
const LAT = 10.72, LNG = 106.94;
const P = (x: number, y: number): [number, number] => [LAT + y / 111_320, LNG + x / (111_320 * Math.cos((LAT * Math.PI) / 180))];
const at = (x: number, y: number) => { const [lat, lng] = P(x, y); return { lat, lng }; };

// Đường số 1 chạy Tây → Đông (0..400 m), Đường số 2 rẽ lên phía Bắc tại x=200 (0..300 m), Đường số 3 chạy sang Đông ở y=300
const WAYS: RoadWay[] = [
  { id: 1, name: 'Đường số 1', kind: 'main', coords: [P(0, 0), P(200, 0), P(400, 0)] },
  { id: 2, name: 'Đường số 2', kind: 'minor', coords: [P(200, 0), P(200, 300)] },
  { id: 3, name: 'Đường số 3', kind: 'minor', coords: [P(200, 300), P(500, 300)] },
];

const setup = (ways = WAYS) => {
  const pieces = splitRoads(ways);
  const g = buildRoadGraph(pieces, ways);
  const idsOf = (wayId: number) => pieces.map((p, i) => (p.wayId === wayId ? i : -1)).filter(i => i >= 0);
  return { pieces, g, idsOf };
};

describe('đồ thị đường', () => {
  it('nối các khúc tại ngã ba (cùng toạ độ) — nút ngã ba có 3 ngả', () => {
    const { g } = setup();
    const j = g.pts.findIndex(p => Math.abs(p[0] - P(200, 0)[0]) < 1e-7 && Math.abs(p[1] - P(200, 0)[1]) < 1e-7);
    expect(j).toBeGreaterThanOrEqual(0);
    expect(nodeDegree(g, j)).toBe(3);
  });
  it('bám vị trí vào đường gần nhất', () => {
    const { g, pieces } = setup();
    const s = snapToGraph(g, at(50, 10))!;
    expect(s).not.toBeNull();
    expect(pieces[s.edge].wayId).toBe(1);
    expect(s.off).toBeGreaterThan(9);
    expect(s.off).toBeLessThan(11);
    expect(snapToGraph(g, at(50, 200), 60)).toBeNull();
  });
  it('đường 1 chiều: không đi ngược chiều', () => {
    const ways: RoadWay[] = [WAYS[0], { ...WAYS[1], oneway: -1 }];
    const { g } = setup(ways);
    const s = shortestFrom(g, snapToGraph(g, at(20, 0))!);
    const top = g.pts.findIndex(p => Math.abs(p[0] - P(200, 300)[0]) < 1e-7);
    expect(s.dist[top]).toBe(Infinity);
    const fwd = shortestFrom(g, snapToGraph(g, at(20, 0))!);
    const east = g.pts.findIndex(p => Math.abs(p[1] - P(400, 0)[1]) < 1e-7 && Math.abs(p[0] - P(400, 0)[0]) < 1e-7);
    expect(fwd.dist[east]).toBeGreaterThan(370);
    expect(fwd.dist[east]).toBeLessThan(390);
  });
});

describe('đoạn chưa đi', () => {
  it('gom khúc liền nhau trên cùng đường, bỏ đoạn quá ngắn, đánh dấu có nhà máy', () => {
    const { g, idsOf } = setup();
    const targets = [...idsOf(2), ...idsOf(3)];
    const scores = new Float32Array(g.edges.length);
    idsOf(3).forEach(i => { scores[i] = 3; });
    const runs = unvisitedRuns(g, targets, scores);
    expect(runs).toHaveLength(2);
    const r3 = runs.find(r => r.way === 3)!;
    expect(r3.factory).toBe(true);
    expect(r3.len).toBeGreaterThan(295);
    const r2 = runs.find(r => r.way === 2)!;
    expect(r2.factory).toBe(false);
    // đường trống chỉ được 1/4 điểm khi ưu tiên nhà máy
    expect(r2.value).toBeCloseTo(r2.len * 0.25, 0);
    expect(unvisitedRuns(g, idsOf(2).slice(0, 1), scores)).toHaveLength(0);
  });
  it('điểm chọn ưu tiên đoạn gần (mũ 1,5)', () => {
    expect(runScore(125, 0)).toBeGreaterThan(runScore(1000, 500));
    expect(runScore(1000, 200)).toBeGreaterThan(runScore(125, 0));
  });
});

describe('lập lộ trình', () => {
  it('dẫn tới đoạn chưa đi: chạy về Đông rồi RẼ TRÁI vào Đường số 2 tại ngã ba', () => {
    const { g, idsOf } = setup();
    const r = planNextRun(g, at(20, 0), { heading: 90, targets: idsOf(2), scores: new Float32Array(g.edges.length) })!;
    expect(r).not.toBeNull();
    expect(r.target.kind).toBe('run');
    expect(r.approach).toBeGreaterThan(170);
    expect(r.approach).toBeLessThan(190);
    expect(r.total).toBeGreaterThan(470);
    const turn = r.maneuvers.find(m => m.kind === 'left')!;
    expect(turn.text).toBe('Rẽ trái vào Đường số 2');
    expect(turn.s).toBeCloseTo(r.approach, 0);
    expect(r.maneuvers.map(m => m.kind)).toEqual(['left', 'run-start', 'arrive']);
  });
  it('đang chạy ngược hướng → báo quay đầu trước', () => {
    const { g, idsOf } = setup();
    const r = planNextRun(g, at(150, 0), { heading: 270, targets: idsOf(2), scores: new Float32Array(g.edges.length) })!;
    expect(r.maneuvers[0].kind).toBe('uturn');
  });
  it('đứng ngay ngã ba đang chạy về Đông → rẽ trái tại chỗ (không bám nhầm sang đường cắt ngang)', () => {
    const { g, idsOf } = setup();
    const r = planNextRun(g, at(200, 0), { heading: 88, targets: idsOf(2), scores: [] })!;
    expect(r.maneuvers[0]).toMatchObject({ s: 0, kind: 'left', text: 'Rẽ trái vào Đường số 2' });
    expect(r.maneuvers.some(m => m.kind === 'uturn')).toBe(false);
    expect(nextManeuvers(r, 0).next?.kind).toBe('left');
    expect(nextManeuvers(r, 20).next?.kind).toBe('arrive');
  });
  it('đứng giữa đoạn chưa đi → đi tiếp phía trước, không quay về đầu đoạn', () => {
    const { g, idsOf } = setup();
    const r = planNextRun(g, at(200, 150), { heading: 0, targets: idsOf(2), scores: new Float32Array(g.edges.length) })!;
    expect(r.approach).toBeLessThan(30);
    expect(r.maneuvers.some(m => m.kind === 'uturn')).toBe(false);
  });
  it('khúc đã dẫn qua (skip) không dẫn lại; hết đoạn → null', () => {
    const { g, idsOf } = setup();
    expect(planNextRun(g, at(20, 0), { heading: null, targets: idsOf(2), scores: [], skip: new Set(idsOf(2)) })).toBeNull();
    expect(planNextRun(g, at(20, 0), { heading: null, targets: [], scores: [] })).toBeNull();
  });
  it('dẫn tới công ty: tới chỗ trên đường gần công ty, kết thúc bằng "Đến …"', () => {
    const { g } = setup();
    const r = planToPoint(g, at(20, 0), at(260, 330), 'Công ty A', null)!;
    expect(r).not.toBeNull();
    expect(r.maneuvers[r.maneuvers.length - 1]).toMatchObject({ kind: 'arrive', text: 'Đến Công ty A' });
    expect(r.maneuvers.some(m => m.text === 'Rẽ trái vào Đường số 2')).toBe(true);
    expect(r.maneuvers.some(m => m.text === 'Rẽ phải vào Đường số 3')).toBe(true);
  });
});

describe('theo dõi trên lộ trình', () => {
  it('vị trí trên lộ trình + chỗ rẽ kế tiếp', () => {
    const { g, idsOf } = setup();
    const r = planNextRun(g, at(20, 0), { heading: 90, targets: idsOf(2), scores: [] })!;
    const pr = routeProgress(r, at(120, 4), 0);
    expect(pr.s).toBeGreaterThan(95);
    expect(pr.s).toBeLessThan(105);
    expect(pr.off).toBeLessThan(5);
    const { next, after } = nextManeuvers(r, pr.s);
    expect(next?.kind).toBe('left');
    expect(after?.kind).toBe('run-start');
    expect(routeProgress(r, at(120, 80), pr.s).off).toBeGreaterThan(70);
  });
  it('câu đọc to làm tròn 50 m', () => {
    const m = { s: 0, kind: 'left' as const, text: 'Rẽ trái vào Đường số 2' };
    expect(spokenInstruction(m, 163)).toBe('Sau 150 mét, rẽ trái vào Đường số 2');
    expect(spokenInstruction(m, 30)).toBe('Rẽ trái vào Đường số 2');
    expect(spokenInstruction(m, 1240)).toBe('Sau 1,2 ki lô mét, rẽ trái vào Đường số 2');
  });
  it('loại rẽ theo góc', () => {
    expect(turnKind(10)).toBeNull();
    expect(turnKind(-45)).toBe('slight-left');
    expect(turnKind(90)).toBe('right');
    expect(turnKind(-100)).toBe('left');
    expect(turnKind(170)).toBe('uturn');
  });
});

describe('hướng / la bàn', () => {
  it('góc & hướng', () => {
    expect(normDeg(-10)).toBe(350);
    expect(angleDiff(350, 10)).toBe(20);
    expect(angleDiff(10, 350)).toBe(-20);
    expect(bearing(at(0, 0), at(0, 100))).toBeCloseTo(0, 0);
    expect(bearing(at(0, 0), at(100, 0))).toBeCloseTo(90, 0);
  });
  it('la bàn iPhone / Android, bỏ sự kiện không tuyệt đối', () => {
    expect(compassFromEvent({ alpha: 10, webkitCompassHeading: 45 })).toBe(45);
    expect(compassFromEvent({ alpha: 90, absolute: true })).toBe(270);
    expect(compassFromEvent({ alpha: 90, absolute: true }, 90)).toBe(0);
    expect(compassFromEvent({ alpha: 90, absolute: false })).toBeNull();
  });
  it('làm mượt đi đường ngắn qua 0°', () => {
    const v = smoothAngle(350, 10, 0.5);
    expect(v).toBeCloseTo(0, 5);
  });
  it('đang chạy → theo GPS; đứng yên → theo la bàn', () => {
    expect(displayHeading({ course: 90, speed: 8, compass: 200 })).toEqual({ deg: 90, source: 'course' });
    expect(displayHeading({ course: 90, speed: 0.3, compass: 200 })).toEqual({ deg: 200, source: 'compass' });
    expect(displayHeading({ course: null, speed: null, compass: null })).toBeNull();
  });
});

describe('ghi chú vẽ trên ảnh', () => {
  it('lọc nét hỏng, kẹp toạ độ 0..1, bỏ màu lạ', () => {
    const marks = sanitizeMarks([
      { t: 'pen', c: '#FF3B30', w: 0.01, p: [[0.1, 0.1], [1.5, 0.2]] },
      { t: 'ellipse', c: 'red', w: 0.01, a: [0.2, 0.2], b: [0.4, 0.5] },
      { t: 'text', c: '#FFFFFF', s: 0.05, x: 0.5, y: 0.5, text: '  Tuyển 50 CN ' },
      { t: 'text', c: '#FFFFFF', s: 0.05, x: 0.5, y: 0.5, text: '   ' },
      { t: 'arrow', c: '#0A84FF', w: 0.01, a: [0.1], b: [0.2, 0.2] },
      'rác', null,
    ]);
    expect(marks).toHaveLength(3);
    expect(marks[0]).toMatchObject({ t: 'pen', p: [[0.1, 0.1], [1, 0.2]] });
    expect(marks[1]).toMatchObject({ t: 'ellipse', c: '#FF3B30' });
    expect(marks[2]).toMatchObject({ t: 'text', text: 'Tuyển 50 CN' });
    expect(sanitizeMarks('x')).toEqual([]);
  });
  it('rút gọn nét bút thẳng còn 2 điểm', () => {
    const line = Array.from({ length: 50 }, (_, i) => [i / 49, 0.5] as [number, number]);
    expect(simplifyPath(line)).toHaveLength(2);
  });
  it('đầu mũi tên đối xứng', () => {
    const [w1, w2] = arrowHead([0.1, 0.5], [0.5, 0.5], 0.01, 1);
    expect(w1[0]).toBeCloseTo(w2[0], 6);
    expect(w1[1] + w2[1]).toBeCloseTo(1, 6);
    expect(w1[0]).toBeLessThan(0.5);
  });
});

describe('chiều đi OSM', () => {
  it('oneway / vòng xuyến', () => {
    expect(onewayOf({ oneway: 'yes' })).toBe(1);
    expect(onewayOf({ oneway: '-1' })).toBe(-1);
    expect(onewayOf({ junction: 'roundabout' })).toBe(1);
    expect(onewayOf({ junction: 'roundabout', oneway: 'no' })).toBeUndefined();
    expect(onewayOf({ highway: 'residential' })).toBeUndefined();
  });
});
