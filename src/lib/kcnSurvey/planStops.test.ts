import { describe, expect, it } from 'vitest';
import {
  distToTrack, googleDirectionsLinks, nameMatchScore, normStop, orderOpenPath, parseStopLines, pathCost, positionAtTime, stopTitle,
} from './planStops';
import type { TrackSegment } from './track';

describe('đọc ô nhập công ty cần ghé', () => {
  it('mỗi dòng tên = 1 công ty cần tìm, bỏ số thứ tự / gạch đầu dòng, giữ tên bắt đầu bằng số', () => {
    const r = parseStopLines('1. Công ty TNHH Pouchen\n- Nitori Việt Nam\n3M Việt Nam\n\n  ');
    expect(r).toEqual([
      { kind: 'name', name: 'Công ty TNHH Pouchen' },
      { kind: 'name', name: 'Nitori Việt Nam' },
      { kind: 'name', name: '3M Việt Nam' },
    ]);
  });

  it('văn bản "Chia sẻ" của Google Maps: tên + địa chỉ + link rút gọn gộp thành 1', () => {
    const r = parseStopLines('Công ty TNHH Kumho Tire Việt Nam\nĐường số 6, KCN Mỹ Phước 2, Bến Cát\nhttps://maps.app.goo.gl/AbCdEf123');
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ kind: 'link', short: true, coords: null, name: 'Công ty TNHH Kumho Tire Việt Nam', address: 'Đường số 6, KCN Mỹ Phước 2, Bến Cát' });
  });

  it('link dài lấy toạ độ ghim + tên trong link; tên gõ cùng dòng được ưu tiên', () => {
    const url = 'https://www.google.com/maps/place/C%C3%B4ng+ty+ABC/@10.95,106.70,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d10.9512!4d106.7034';
    const [a] = parseStopLines(url);
    expect(a).toMatchObject({ kind: 'link', short: false, coords: { lat: 10.9512, lng: 106.7034 }, name: 'Công ty ABC' });
    const [b] = parseStopLines(`Nhà máy số 2 - ${url}`);
    expect(b).toMatchObject({ name: 'Nhà máy số 2' });
  });

  it('toạ độ "vĩ độ, kinh độ" (kèm tên hoặc không), bỏ toạ độ ngoài Việt Nam', () => {
    const r = parseStopLines('Cổng chính 10.9512, 106.7034\n11.0001,106.6002\n48.85, 2.35');
    expect(r[0]).toEqual({ kind: 'coords', coords: { lat: 10.9512, lng: 106.7034 }, name: 'Cổng chính' });
    expect(r[1]).toEqual({ kind: 'coords', coords: { lat: 11.0001, lng: 106.6002 }, name: '' });
    expect(r[2]).toEqual({ kind: 'name', name: '48.85, 2.35' });
  });

  it('link đầy đủ thật (mở link chia sẻ trên trình duyệt): đúng tên Google Maps + ghim', () => {
    const url = 'https://www.google.com/maps/place/C%C3%94NG+TY+TNHH+C%C3%94NG+NGH%E1%BB%86+HKC+(VI%E1%BB%86T+NAM)/@10.7206136,106.9184892,17z/data=!3m1!4b1!4m6!3m5!1s0x317519634e41fedf:0x4f500ac94480a07c!8m2!3d10.7206136!4d106.9184892!16s%2Fg%2F11v6fk9c_3?entry=ttu&g_ep=EgoyMDI2MTEwOS4wIKXMDSoASAFQAw%3D%3D';
    expect(parseStopLines(url)[0]).toMatchObject({ kind: 'link', short: false, name: 'CÔNG TY TNHH CÔNG NGHỆ HKC (VIỆT NAM)', coords: { lat: 10.7206136, lng: 106.9184892 } });
  });

  it('link rút gọn chia sẻ từ iPhone (?g_st=ic) được nhận là link rút gọn', () => {
    expect(parseStopLines('https://maps.app.goo.gl/MENTDu1E5nYoyocM6?g_st=ic')[0]).toMatchObject({ kind: 'link', short: true, coords: null, name: '' });
  });

  it('nhiều link liền nhau, mỗi link nhận đúng dòng tên ngay trên nó', () => {
    const r = parseStopLines('Công ty A\nhttps://maps.app.goo.gl/aaa\nCông ty B\nhttps://maps.app.goo.gl/bbb\nCông ty C');
    expect(r.map(x => [x.kind, 'name' in x ? x.name : ''])).toEqual([['link', 'Công ty A'], ['link', 'Công ty B'], ['name', 'Công ty C']]);
  });
});

describe('thứ tự ghé ngắn nhất', () => {
  // Các điểm trên 1 đường thẳng, xáo trộn: đi đúng phải theo thứ tự toạ độ
  const xs = [5, 1, 9, 3, 7, 2, 8, 4, 6, 10, 0];
  const line: (i: number, j: number) => number = (i, j) => Math.abs(xs[i] - xs[j]);

  it('ít điểm: thử hết, bắt đầu từ chỗ đang đứng', () => {
    const pts = [0, 5, 1, 9, 3]; // điểm 0 = đang đứng ở x=0
    const c = (i: number, j: number) => Math.abs(pts[i] - pts[j]);
    expect(orderOpenPath(pts.length, c, 0).map(i => pts[i])).toEqual([0, 1, 3, 5, 9]);
  });

  it('nhiều điểm (heuristic) vẫn ra đường thẳng không quay lui, tự chọn điểm đầu ở 1 đầu', () => {
    const order = orderOpenPath(xs.length, line);
    expect(pathCost(order, line)).toBe(10);
    const vals = order.map(i => xs[i]);
    expect(vals[0] === 0 || vals[0] === 10).toBe(true);
  });

  it('ma trận lệch chiều (đường 1 chiều): chọn chiều đi rẻ hơn', () => {
    // 0 → 1 → 2 rẻ, đi ngược đắt
    const m = [[0, 1, 5], [9, 0, 1], [9, 9, 0]];
    expect(orderOpenPath(3, (i, j) => m[i][j])).toEqual([0, 1, 2]);
  });

  it('0 / 1 điểm', () => {
    expect(orderOpenPath(0, line)).toEqual([]);
    expect(orderOpenPath(1, line)).toEqual([0]);
  });
});

describe('link Google Maps chỉ đường', () => {
  const pts = Array.from({ length: 12 }, (_, i) => ({ lat: 10.9 + i / 1000, lng: 106.7 }));
  it('1 điểm đến: xe máy, không gửi origin thì Google lấy vị trí điện thoại', () => {
    const [u] = googleDirectionsLinks(null, pts.slice(0, 1));
    expect(u).toContain('destination=10.900000,106.700000');
    expect(u).not.toContain('origin=');
    expect(u).toContain('travelmode=two-wheeler');
  });
  it('quá 9 điểm dừng thì chia chặng, chặng sau nối từ điểm cuối chặng trước', () => {
    const links = googleDirectionsLinks({ lat: 10.8, lng: 106.6 }, pts);
    expect(links).toHaveLength(2);
    expect(links[0]).toContain('origin=10.800000,106.600000');
    expect(links[0].split('waypoints=')[1].split('&')[0].split('|')).toHaveLength(9);
    expect(links[0]).toContain('destination=10.909000');
    expect(links[1]).toContain('origin=10.909000');
    expect(links[1]).toContain('destination=10.911000');
  });
});

describe('ảnh bổ sung: vị trí theo giờ chụp', () => {
  const start = Date.parse('2026-11-12T08:00:00+07:00');
  // đoạn 1: 0–60 s đi từ (10, 106) tới (10.001, 106); tạm dừng; đoạn 2: 600–660 s
  const segs: TrackSegment[] = [
    [[10, 106, 0, 5], [10.0005, 106, 30, 5], [10.001, 106, 60, 5]],
    [[10.002, 106.001, 600, 5], [10.003, 106.001, 660, 5]],
  ];
  it('nội suy giữa 2 điểm liền nhau', () => {
    const p = positionAtTime(segs, start, start + 45_000)!;
    expect(p.gapS).toBe(0);
    expect(p.lat).toBeCloseTo(10.00075, 6);
  });
  it('lúc tạm dừng → điểm vết gần giờ nhất, báo lệch bao nhiêu giây', () => {
    const p = positionAtTime(segs, start, start + 500_000)!;
    expect(p).toMatchObject({ lat: 10.002, lng: 106.001, gapS: 100 });
  });
  it('chụp trước / sau chuyến quá lâu → không đoán', () => {
    expect(positionAtTime(segs, start, start - 20 * 60_000)).toBeNull();
    expect(positionAtTime(segs, start, start + 660_000 + 16 * 60_000)).toBeNull();
    expect(positionAtTime([], start, start)).toBeNull();
  });
  it('khoảng cách tới vết', () => {
    expect(distToTrack({ lat: 10, lng: 106 }, segs)).toBe(0);
    expect(distToTrack({ lat: 10.1, lng: 106 }, segs)).toBeGreaterThan(10_000);
  });
});

describe('dòng dữ liệu', () => {
  it('bỏ dòng thiếu toạ độ, nguồn lạ thành manual, tên trống thì hiện toạ độ', () => {
    expect(normStop({ id: 'x', lat: null, lng: 1 })).toBeNull();
    const st = normStop({ id: 'x', lat: 10.95, lng: 106.7, source: 'abc', name: '' })!;
    expect(st.source).toBe('manual');
    expect(stopTitle(st)).toBe('Điểm 10.9500, 106.7000');
  });
});

describe('tìm công ty theo tên', () => {
  it('khớp khi gõ thiếu loại hình / dấu / 1 phần tên', () => {
    expect(nameMatchScore('pouchen', 'Công ty TNHH Pouchen Việt Nam')).toBeGreaterThan(0.9);
    expect(nameMatchScore('cty kumho ti', 'Kumho Tire Việt Nam')).toBeGreaterThanOrEqual(0.5);
    expect(nameMatchScore('nitori', 'NITORI FURNITURE VIETNAM EPE')).toBeGreaterThan(0.3);
    expect(nameMatchScore('Samsung', 'Công ty TNHH Pouchen Việt Nam')).toBe(0);
    expect(nameMatchScore('', 'ABC')).toBe(0);
  });
});
