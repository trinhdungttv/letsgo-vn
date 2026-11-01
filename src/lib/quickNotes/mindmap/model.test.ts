import { describe, expect, it } from 'vitest';
import { getTheme } from './themes';
import { PALETTE } from '../colors';
import { hitTest, layoutMap, navigate, wrapText, type Measure } from './layout';
import {
  addChild, addRelation, addSibling, addSummary, collapseToLevel, copyTopics, defaultDoc, docFromText, docToOutline, findTopic,
  insertParent, makeFloating, moveTopics, outlineToTopics, parseDoc, pasteTopics, removeTopics, reorder, toggleCollapse, toggleMarker,
} from './model';
import { STRUCTURES, type MindMapDoc } from './types';

const fakeMeasure: Measure = (text, font) => text.length * (Number(font.match(/(\d+)px/)?.[1]) || 14) * 0.55;
const theme = getTheme('rainbow', PALETTE.yellow);
const lay = (doc: MindMapDoc) => layoutMap(doc, theme, fakeMeasure, { family: 'sans-serif' });

const texts = (doc: MindMapDoc) => doc.root.children.map(c => c.text);

describe('outlineToTopics / docFromText', () => {
  it('dòng đầu là chủ đề trung tâm, các dòng sau là chủ đề chính', () => {
    const doc = docFromText('Chi nhánh Biên Hòa :\nNgày 21 : Cần làm 12 việc như sau');
    expect(doc.root.text).toBe('Chi nhánh Biên Hòa');
    expect(texts(doc)).toEqual(['Ngày 21 : Cần làm 12 việc như sau']);
  });

  it('dòng ☐ / gạch đầu dòng sau 1 dòng thường thành con của dòng đó', () => {
    const doc = docFromText('Việc tuần\nGặp khách:\n☐ Gọi anh Nam\n☑ Gửi báo giá\nNội bộ\n- Họp sale\n  - Chuẩn bị slide');
    expect(texts(doc)).toEqual(['Gặp khách', 'Nội bộ']);
    const [khach, noiBo] = doc.root.children;
    expect(khach.children.map(c => c.text)).toEqual(['Gọi anh Nam', 'Gửi báo giá']);
    expect(khach.children[0].markers).toEqual(['task-0']);
    expect(khach.children[1].markers).toEqual(['task-100']);
    expect(noiBo.children[0].children.map(c => c.text)).toEqual(['Chuẩn bị slide']);
  });

  it('tiêu đề Markdown tạo cấp', () => {
    const t = outlineToTopics('# A\n## B\nx\n## C');
    expect(t).toHaveLength(1);
    expect(t[0].children.map(c => c.text)).toEqual(['B', 'C']);
    expect(t[0].children[0].children.map(c => c.text)).toEqual(['x']);
  });

  it('ghi chú trống → sơ đồ mẫu 4 chủ đề chính', () => {
    expect(docFromText('  \n').root.children).toHaveLength(4);
  });

  it('sơ đồ → dàn ý → sơ đồ giữ nguyên cấu trúc', () => {
    const doc = docFromText('Gốc\n- A\n  - A1\n  ☑ A2\n- B');
    const again = docFromText(docToOutline(doc));
    expect(again.root.text).toBe('Gốc');
    expect(texts(again)).toEqual(['A', 'B']);
    expect(again.root.children[0].children.map(c => c.text)).toEqual(['A1', 'A2']);
    expect(again.root.children[0].children[1].markers).toEqual(['task-100']);
  });
});

describe('thao tác chủ đề', () => {
  it('Tab / Enter / Shift+Enter / chèn cha', () => {
    let doc = defaultDoc('Gốc');
    const first = doc.root.children[0].id;
    const r1 = addChild(doc, first);
    doc = r1.doc;
    expect(findTopic(doc, r1.id!)?.parent?.id).toBe(first);
    const r2 = addSibling(doc, first);
    doc = r2.doc;
    expect(doc.root.children[1].id).toBe(r2.id);
    const r3 = addSibling(doc, first, true);
    doc = r3.doc;
    expect(doc.root.children[0].id).toBe(r3.id);
    const r4 = insertParent(doc, first);
    doc = r4.doc;
    expect(findTopic(doc, first)?.parent?.id).toBe(r4.id);
  });

  it('Enter ở chủ đề trung tâm = thêm chủ đề con; không xoá được chủ đề trung tâm', () => {
    const doc = defaultDoc();
    const r = addSibling(doc, doc.root.id);
    expect(r.doc.root.children).toHaveLength(5);
    expect(removeTopics(doc, [doc.root.id]).doc).toBe(doc);
  });

  it('xoá chọn chủ đề cùng cấp kế tiếp, bỏ liên kết treo', () => {
    let doc = defaultDoc();
    const [a, b, c] = doc.root.children.map(x => x.id);
    doc = addRelation(doc, a, c).doc;
    const r = removeTopics(doc, [b]);
    expect(r.next).toBe(c);
    expect(r.doc.root.children).toHaveLength(3);
    const r2 = removeTopics(r.doc, [c]);
    expect(r2.doc.relations).toHaveLength(0);
  });

  it('di chuyển: không thả được vào chính nhánh của mình', () => {
    let doc = defaultDoc();
    const [a, b] = doc.root.children.map(x => x.id);
    const child = addChild(doc, a);
    doc = child.doc;
    expect(moveTopics(doc, [a], child.id!)).toBe(doc);
    const moved = moveTopics(doc, [b], a, 0);
    expect(findTopic(moved, b)?.parent?.id).toBe(a);
    expect(findTopic(moved, a)?.topic.children[0].id).toBe(b);
  });

  it('kéo ra chỗ trống thành chủ đề tự do, rồi gắn lại', () => {
    let doc = defaultDoc();
    const a = doc.root.children[0].id;
    doc = makeFloating(doc, [a], { x: 300, y: 200 });
    expect(doc.floating).toHaveLength(1);
    expect(doc.floating[0].pos).toEqual({ x: 300, y: 200 });
    doc = moveTopics(doc, [a], doc.root.id);
    expect(doc.floating).toHaveLength(0);
    expect(findTopic(doc, a)?.topic.pos).toBeUndefined();
  });

  it('đổi thứ tự, thu gọn, biểu tượng mỗi nhóm 1 cái', () => {
    let doc = defaultDoc();
    const [a, b] = doc.root.children.map(x => x.id);
    doc = reorder(doc, a, 1);
    expect(doc.root.children[0].id).toBe(b);
    doc = addChild(doc, a).doc;
    doc = toggleCollapse(doc, [a]);
    expect(findTopic(doc, a)?.topic.collapsed).toBe(true);
    doc = collapseToLevel(doc, Infinity);
    expect(findTopic(doc, a)?.topic.collapsed).toBeUndefined();
    doc = toggleMarker(doc, [a], 'priority-1');
    doc = toggleMarker(doc, [a], 'priority-2');
    doc = toggleMarker(doc, [a], 'flag-red');
    expect(findTopic(doc, a)?.topic.markers).toEqual(['priority-2', 'flag-red']);
    doc = toggleMarker(doc, [a], 'flag-red');
    expect(findTopic(doc, a)?.topic.markers).toEqual(['priority-2']);
  });

  it('tóm tắt co lại khi xoá chủ đề trong đoạn', () => {
    let doc = defaultDoc();
    const [a, b, c] = doc.root.children.map(x => x.id);
    doc = addSummary(doc, [a, c]).doc;
    expect(doc.root.summaries?.[0]).toMatchObject({ from: a, to: c });
    doc = removeTopics(doc, [a]).doc;
    expect(doc.root.summaries?.[0]).toMatchObject({ from: b, to: c });
  });

  it('dán nhánh: mã mới, giữ tóm tắt bên trong', () => {
    let doc = defaultDoc();
    const a = doc.root.children[0].id;
    doc = addChild(doc, a).doc;
    doc = addChild(doc, a).doc;
    const kids = findTopic(doc, a)!.topic.children.map(k => k.id);
    doc = addSummary(doc, kids).doc;
    const copied = copyTopics(doc, [a]);
    const pasted = pasteTopics(doc, doc.root.id, copied);
    const fresh = findTopic(pasted.doc, pasted.ids[0])!.topic;
    expect(fresh.id).not.toBe(a);
    expect(fresh.summaries?.[0].from).toBe(fresh.children[0].id);
  });

  it('parseDoc bỏ dữ liệu hỏng, giữ phần hợp lệ', () => {
    const doc = parseDoc({ root: { id: 'r', text: 'Gốc', children: [{ id: 'a', text: 'A', children: 'x' }, null] }, relations: [{ from: 'r', to: 'zz' }], structure: 'lạ' });
    expect(doc?.root.children.map(c => c.text)).toEqual(['A']);
    expect(doc?.relations).toEqual([]);
    expect(doc?.structure).toBe('map');
    expect(parseDoc(null)).toBeNull();
  });
});

describe('bố cục', () => {
  const overlap = (a: { x: number; y: number; w: number; h: number }, b: typeof a) =>
    a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;

  const big = () => docFromText('Kế hoạch quý\nKinh doanh\n- Khách mới\n  - KCN Amata\n  - KCN Long Đức\n- Khách cũ\nTuyển dụng\n- Công nhân\n- Kỹ sư\nTài chính\n- Thu\n- Chi\n  - Lương\n  - Thuê VP\nVận hành');

  it.each(STRUCTURES)('cấu trúc %s: chủ đề không chồng lên nhau, tâm ở (0,0)', s => {
    const doc = { ...big(), structure: s };
    const l = lay(doc);
    const root = l.byId.get(doc.root.id)!;
    expect(Math.abs(root.bx + root.bw / 2)).toBeLessThan(1);
    expect(Math.abs(root.by + root.bh / 2)).toBeLessThan(1);
    for (let i = 0; i < l.boxes.length; i++) {
      for (let j = i + 1; j < l.boxes.length; j++) expect(overlap(l.boxes[i], l.boxes[j])).toBe(false);
    }
    expect(l.connectors.length).toBe(s === 'timeline' ? l.boxes.length - 1 - doc.root.children.length : l.boxes.length - 1);
  });

  it('toả 2 bên: nửa đầu bên phải, nửa sau bên trái (theo chiều kim đồng hồ)', () => {
    const doc = defaultDoc();
    const l = lay(doc);
    const xs = doc.root.children.map(c => l.byId.get(c.id)!.bx);
    expect(xs[0]).toBeGreaterThan(0);
    expect(xs[1]).toBeGreaterThan(0);
    expect(xs[2]).toBeLessThan(0);
    expect(xs[3]).toBeLessThan(0);
    expect(l.byId.get(doc.root.children[3].id)!.by).toBeLessThan(l.byId.get(doc.root.children[2].id)!.by);
  });

  it('thu gọn ẩn nhánh con và đếm số chủ đề ẩn', () => {
    let doc = big();
    const kd = doc.root.children[0].id;
    doc = toggleCollapse(doc, [kd]);
    const l = lay(doc);
    expect(l.byId.get(kd)!.hidden).toBe(4);
    expect(l.byId.has(findTopic(doc, kd)!.topic.children[0].id)).toBe(false);
  });

  it('phím mũi tên và bấm trúng chủ đề', () => {
    const doc = { ...defaultDoc(), structure: 'right' as const };
    const l = lay(doc);
    const [a, b] = doc.root.children.map(c => c.id);
    expect(navigate(l, doc.root.id, 'ArrowRight')).toBeTruthy();
    expect(navigate(l, a, 'ArrowDown')).toBe(b);
    expect(navigate(l, a, 'ArrowLeft')).toBe(doc.root.id);
    const bb = l.byId.get(b)!;
    expect(hitTest(l, { x: bb.bx + 2, y: bb.by + 2 })?.id).toBe(b);
  });

  it('ngắt dòng chữ dài, cắt từ quá dài', () => {
    const lines = wrapText('một hai ba bốn năm sáu bảy tám chín mười', '14px x', 60, fakeMeasure);
    expect(lines.length).toBeGreaterThan(2);
    lines.forEach(l => expect(fakeMeasure(l, '14px x')).toBeLessThanOrEqual(60));
    expect(wrapText('aaaaaaaaaaaaaaaaaaaaaaaa', '14px x', 40, fakeMeasure).length).toBeGreaterThan(2);
  });
});
