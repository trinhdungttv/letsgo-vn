import { describe, expect, it } from 'vitest';
import {
  UNTAGGED_KEY, addTag, appendImages, availableOptions, buildStore, competitorOptions, filterChips, parseStore,
  removeImageAt, removeTag, resolveTags, setTagsAt, tagsForImages, visibleIndexes,
  type CompetitorRow,
} from './recruitImages';

const ROWS: CompetitorRow[] = [
  { id: 'c1', company_name: 'Minh Khang Dona' },
  { id: 'c2', company_name: 'minh khang  dona' }, // cùng công ty, KCN khác
  { id: 'c3', company_name: 'Tâm Đức' },
  { id: 'c4', company_name: null },
];

describe('competitorOptions', () => {
  it('gộp các dòng cùng tên ở nhiều KCN, bỏ dòng trống, xếp theo tên', () => {
    expect(competitorOptions(ROWS)).toEqual([
      { id: 'c1', name: 'Minh Khang Dona' },
      { id: 'c3', name: 'Tâm Đức' },
    ]);
  });
});

describe('parseStore', () => {
  it('chịu được dữ liệu rỗng / sai dạng / chuỗi JSON', () => {
    expect(parseStore(null)).toEqual([]);
    expect(parseStore(undefined)).toEqual([]);
    expect(parseStore({ a: 1 })).toEqual([]);
    expect(parseStore('không phải json')).toEqual([]);
    expect(parseStore('[{"u":"a","c":[{"id":"c1","n":"X"}]}]')).toEqual([{ u: 'a', c: [{ id: 'c1', n: 'X' }] }]);
    expect(parseStore([null, 5, { u: 1, c: 'x' }])).toEqual([{ u: '', c: [] }, { u: '', c: [] }, { u: '', c: [] }]);
  });
  it('bỏ thẻ trống và thẻ trùng', () => {
    const s = parseStore([{ u: 'a', c: [{ id: 'c1', n: 'A' }, { id: 'c1', n: 'A' }, { id: '', n: '' }, 7] }]);
    expect(s[0].c).toEqual([{ id: 'c1', n: 'A' }]);
  });
});

describe('tagsForImages — ghép thẻ với ảnh', () => {
  const t1 = [{ id: 'c1', n: 'Minh Khang Dona' }];
  const t2 = [{ id: 'c3', n: 'Tâm Đức' }];

  it('dữ liệu cũ (chưa có thẻ) → mọi ảnh chưa gắn', () => {
    expect(tagsForImages(['a', 'b'], [])).toEqual([[], []]);
  });
  it('ghép theo vị trí khi link khớp', () => {
    expect(tagsForImages(['a', 'b'], [{ u: 'a', c: t1 }, { u: 'b', c: t2 }])).toEqual([t1, t2]);
  });
  it('ai đó sắp xếp lại danh sách ảnh → ghép theo link', () => {
    expect(tagsForImages(['b', 'a'], [{ u: 'a', c: t1 }, { u: 'b', c: t2 }])).toEqual([t2, t1]);
  });
  it('link bị tự đổi sang R2 nhưng số ảnh còn nguyên → theo vị trí cũ', () => {
    expect(tagsForImages(['r2/a', 'b'], [{ u: 'a', c: t1 }, { u: 'b', c: t2 }])).toEqual([t1, t2]);
  });
  it('số ảnh khác số mục thẻ và link không khớp → không đoán, để trống', () => {
    expect(tagsForImages(['x', 'y', 'z'], [{ u: 'a', c: t1 }, { u: 'b', c: t2 }])).toEqual([[], [], []]);
  });
  it('ảnh mới thêm ở nơi khác (không có thẻ) không ăn nhầm thẻ của ảnh khác', () => {
    expect(tagsForImages(['a', 'b', 'new'], [{ u: 'a', c: t1 }, { u: 'b', c: t2 }])).toEqual([t1, t2, []]);
  });
});

describe('thêm / bớt / sửa', () => {
  const t1 = [{ id: 'c1', n: 'Minh Khang Dona' }];
  it('thêm ảnh mới → chưa có thẻ, ảnh cũ giữ thẻ', () => {
    const r = appendImages(['a'], [t1], ['b', 'c']);
    expect(r.urls).toEqual(['a', 'b', 'c']);
    expect(r.tags).toEqual([t1, [], []]);
  });
  it('bỏ ảnh → thẻ của ảnh đó đi theo, ảnh sau không bị lệch thẻ', () => {
    const t2 = [{ id: 'c3', n: 'Tâm Đức' }];
    const r = removeImageAt(['a', 'b', 'c'], [t1, [], t2], 1);
    expect(r.urls).toEqual(['a', 'c']);
    expect(r.tags).toEqual([t1, t2]);
    expect(removeImageAt(['a', 'b', 'c'], [t1, [], t2], 0).tags).toEqual([[], t2]);
  });
  it('setTagsAt chỉ đổi ảnh được chọn và bỏ trùng', () => {
    const r = setTagsAt([[], t1], 0, [{ id: 'c3', n: 'Tâm Đức' }, { id: 'c3', n: 'Tâm Đức' }]);
    expect(r).toEqual([[{ id: 'c3', n: 'Tâm Đức' }], t1]);
  });
  it('buildStore ghi đủ mọi ảnh theo thứ tự', () => {
    expect(buildStore(['a', 'b'], [t1])).toEqual([{ u: 'a', c: t1 }, { u: 'b', c: [] }]);
  });
  it('vòng lưu → đọc → ghép trả lại đúng thẻ', () => {
    const urls = ['a', 'b', 'c'];
    const tags = [t1, [], [{ id: 'c3', n: 'Tâm Đức' }]];
    const json = JSON.parse(JSON.stringify(buildStore(urls, tags)));
    expect(tagsForImages(urls, parseStore(json))).toEqual(tags);
  });
});

describe('addTag / removeTag', () => {
  it('không gắn trùng cùng công ty (kể cả khác dòng KCN)', () => {
    const a = addTag([], { id: 'c1', name: 'Minh Khang Dona' });
    expect(a).toEqual([{ id: 'c1', n: 'Minh Khang Dona' }]);
    expect(addTag(a, { id: 'c2', name: 'minh khang dona' })).toEqual(a);
    expect(addTag(a, { id: 'c3', name: 'Tâm Đức' })).toHaveLength(2);
  });
  it('gỡ thẻ theo công ty', () => {
    const tags = [{ id: 'c1', n: 'Minh Khang Dona' }, { id: 'c3', n: 'Tâm Đức' }];
    expect(removeTag(tags, ROWS, 'tam duc')).toEqual([{ id: 'c1', n: 'Minh Khang Dona' }]);
  });
  it('availableOptions bỏ các công ty đã gắn', () => {
    const opts = competitorOptions(ROWS);
    const resolved = resolveTags([{ id: 'c2', n: 'Minh Khang Dona' }], ROWS);
    expect(availableOptions(opts, resolved)).toEqual([{ id: 'c3', name: 'Tâm Đức' }]);
    expect(availableOptions(opts, [])).toEqual(opts);
  });
  it('gỡ được cả thẻ mồ côi (đối thủ đã bị xoá)', () => {
    const tags = [{ id: 'gone', n: 'Công ty Đã Xoá' }];
    const [r] = resolveTags(tags, ROWS);
    expect(removeTag(tags, ROWS, r.key)).toEqual([]);
  });
});

describe('resolveTags', () => {
  it('lấy tên mới nhất theo mã (đổi tên đối thủ vẫn đúng)', () => {
    expect(resolveTags([{ id: 'c3', n: 'Tên cũ' }], ROWS)).toEqual([{ key: 'tam duc', id: 'c3', name: 'Tâm Đức', missing: false }]);
  });
  it('mã bị xoá nhưng công ty còn dòng khác cùng tên → theo tên', () => {
    const rows = [{ id: 'c2', company_name: 'Minh Khang Dona' }];
    const [r] = resolveTags([{ id: 'c1', n: 'Minh Khang Dona' }], rows);
    expect(r).toMatchObject({ id: 'c2', name: 'Minh Khang Dona', missing: false });
  });
  it('đối thủ không còn nữa → giữ tên đã lưu, đánh dấu missing', () => {
    expect(resolveTags([{ id: 'gone', n: 'ABC' }], ROWS)).toEqual([{ key: 'abc', id: 'gone', name: 'ABC', missing: true }]);
  });
  it('gộp 2 thẻ cùng công ty', () => {
    expect(resolveTags([{ id: 'c1', n: 'x' }, { id: 'c2', n: 'y' }], ROWS)).toHaveLength(1);
  });
});

describe('lọc theo đối thủ', () => {
  const r = (name: string) => resolveTags([{ id: '', n: name }], []);
  const resolved = [r('Tâm Đức'), [], r('Minh Khang'), [...r('Tâm Đức'), ...r('Minh Khang')]];

  it('chip: mỗi đối thủ + "Chưa gắn đối thủ" kèm số ảnh', () => {
    expect(filterChips(resolved)).toEqual([
      { key: 'minh khang', name: 'Minh Khang', count: 2 },
      { key: 'tam duc', name: 'Tâm Đức', count: 2 },
      { key: UNTAGGED_KEY, name: 'Chưa gắn đối thủ', count: 1 },
    ]);
  });
  it('chỉ có 1 loại thì không cần lọc', () => {
    expect(filterChips([[], []])).toEqual([]);
    expect(filterChips([r('A'), r('A')])).toEqual([]);
    expect(filterChips([])).toEqual([]);
  });
  it('visibleIndexes', () => {
    expect(visibleIndexes(resolved, null)).toEqual([0, 1, 2, 3]);
    expect(visibleIndexes(resolved, 'tam duc')).toEqual([0, 3]);
    expect(visibleIndexes(resolved, UNTAGGED_KEY)).toEqual([1]);
    expect(visibleIndexes(resolved, 'khong-co')).toEqual([]);
  });
});
