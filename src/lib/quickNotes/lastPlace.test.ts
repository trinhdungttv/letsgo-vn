import { describe, expect, it } from 'vitest';
import { DEFAULT_PLACE, parseMapUi, parsePlace, rememberMapUi, type MapUi } from './lastPlace';

describe('nhớ chỗ đang mở', () => {
  it('bản hỏng / trống → mặc định', () => {
    expect(parsePlace(null)).toEqual(DEFAULT_PLACE);
    expect(parsePlace('abc')).toEqual(DEFAULT_PLACE);
    expect(parsePlace({ open: { kind: 'card' } })).toEqual(DEFAULT_PLACE);
  });

  it('đọc lại thẻ đang mở', () => {
    expect(parsePlace({ open: { kind: 'card', id: 'n1', anchorY: 300 } }).open).toEqual({ kind: 'card', id: 'n1', anchorY: 300 });
  });

  it('đọc lại cửa sổ: khu, nhóm, mục — giá trị lạ về mặc định', () => {
    const p = parsePlace({
      open: { kind: 'window', selectedId: 'm1', tab: 'trash', section: 'mindmap' },
      win: { selectedId: 'm1', tab: 'xyz', section: 'abc' },
    });
    expect(p.open).toEqual({ kind: 'window', selectedId: 'm1', tab: 'trash', section: 'mindmap' });
    expect(p.win).toEqual({ selectedId: 'm1', tab: 'all', section: 'text' });
  });
});

describe('nhớ từng sơ đồ tư duy', () => {
  it('bỏ khung nhìn hỏng, chế độ / tab lạ', () => {
    const all = parseMapUi({
      a: { mode: 'outline', panel: 'marker', view: { x: 1, y: 2, z: 1.5 }, sel: 't1', t: 5 },
      b: { mode: 'zzz', panel: 'abc', view: { x: 'x', y: 0, z: 0 }, t: 'nope' },
    });
    expect(all.a).toEqual({ mode: 'outline', panel: 'marker', view: { x: 1, y: 2, z: 1.5 }, sel: 't1', t: 5 });
    expect(all.b).toEqual({ mode: 'map', panel: null, t: 0 });
    expect(parseMapUi([1, 2])).toEqual({});
  });

  it('chỉ giữ các sơ đồ mở gần nhất', () => {
    const ui = (t: number): MapUi => ({ mode: 'map', panel: null, t });
    let all: Record<string, MapUi> = {};
    for (let i = 1; i <= 5; i += 1) all = rememberMapUi(all, `m${i}`, ui(i), 3);
    expect(Object.keys(all).sort()).toEqual(['m3', 'm4', 'm5']);
    all = rememberMapUi(all, 'm3', ui(9), 3);
    all = rememberMapUi(all, 'm6', ui(10), 3);
    expect(Object.keys(all).sort()).toEqual(['m3', 'm5', 'm6']);
  });
});
