import { describe, expect, it } from 'vitest';
import {
  checklistCount, continueChecklist, displayTitle, findMatches, foldKeepLength, formatDuration, listOrder, mindmapCount,
  nextColor, noteMatches, notePreview, noteTitle, pickRecorderMime, previewLines, railOrder, relativeTime, titleOf,
  toggleBoxAt, toggleChecklist,
} from './noteText';
import type { MindMapDoc } from './mindmap/types';

describe('noteTitle / previewLines', () => {
  it('lấy dòng đầu có chữ, bỏ ô checklist', () => {
    expect(noteTitle('\n\n  Hỏi Tuân  \n☐ Hai chrome')).toBe('Hỏi Tuân');
    expect(noteTitle('☐ Gọi khách Canon')).toBe('Gọi khách Canon');
    expect(noteTitle('   \n ')).toBe('');
  });
  it('xem trước bỏ dòng tiêu đề và dòng trống', () => {
    expect(previewLines('Tiêu đề\n\nA\nB\nC', 2)).toEqual(['A', 'B']);
  });
});

describe('checklist', () => {
  it('đếm ô đã xong / tổng', () => {
    expect(checklistCount('Hỏi Tuân\n☐ Hai chrome\n☑ Lấy bài\nthường')).toEqual({ done: 1, total: 2 });
  });

  it('bấm vào ô ở đầu dòng thì đổi trạng thái, chỗ khác thì không', () => {
    const t = 'Việc\n☐ Gọi điện';
    expect(toggleBoxAt(t, 5)).toBe('Việc\n☑ Gọi điện');
    expect(toggleBoxAt(t, 6)).toBe('Việc\n☑ Gọi điện');
    expect(toggleBoxAt(t, 9)).toBeNull();
    expect(toggleBoxAt('☑ xong', 0)).toBe('☐ xong');
    expect(toggleBoxAt('\n☐ a', 0)).toBeNull();
  });

  it('nút checklist thêm ô cho các dòng đang chọn, bấm lần nữa thì bỏ', () => {
    const t = 'A\nB\nC';
    const on = toggleChecklist(t, 0, 3); // chọn A..B
    expect(on.text).toBe('☐ A\n☐ B\nC');
    expect(on.selStart).toBe(2);
    expect(on.selEnd).toBe(7);
    const off = toggleChecklist(on.text, on.selStart, on.selEnd);
    expect(off.text).toBe(t);
  });

  it('nút checklist trên ghi chú trống / dòng trống', () => {
    expect(toggleChecklist('', 0, 0)).toEqual({ text: '☐ ', selStart: 2, selEnd: 2 });
    expect(toggleChecklist('A\n', 2, 2).text).toBe('A\n☐ ');
  });

  it('chọn tới đầu dòng sau thì không đụng dòng sau', () => {
    expect(toggleChecklist('A\nB', 0, 2).text).toBe('☐ A\nB');
  });

  it('Enter trên dòng checklist: có chữ → thêm ô mới; ô trống → kết thúc danh sách', () => {
    expect(continueChecklist('☐ Gọi', 5)).toEqual({ text: '☐ Gọi\n☐ ', pos: 8 });
    expect(continueChecklist('A\n☐ ', 4)).toEqual({ text: 'A\n', pos: 2 });
    expect(continueChecklist('dòng thường', 4)).toBeNull();
  });
});

describe('tìm trong ghi chú', () => {
  it('không phân biệt hoa thường / dấu và giữ đúng vị trí', () => {
    expect(foldKeepLength('Đường ĐI')).toHaveLength('Đường ĐI'.length);
    const text = 'Hỏi Tuân về hội thảo; HOI lại sau';
    expect(findMatches(text, 'hoi')).toEqual([0, 12, 22]);
    expect(findMatches(text, '  ')).toEqual([]);
  });
});

describe('thứ tự & màu', () => {
  const n = (id: string, pinned: boolean, created: string, updated: string) =>
    ({ id, pinned, created_at: created, updated_at: updated });
  const notes = [n('a', false, '2026-10-01', '2026-10-30'), n('b', true, '2026-10-05', '2026-10-06'), n('c', false, '2026-10-02', '2026-10-31')];

  it('dải thẻ: ghim trước, rồi theo lúc tạo', () => {
    expect(railOrder(notes).map(x => x.id)).toEqual(['b', 'a', 'c']);
  });
  it('danh sách: ghim trước, rồi sửa gần nhất', () => {
    expect(listOrder(notes).map(x => x.id)).toEqual(['b', 'c', 'a']);
  });
  it('màu mới = màu ít dùng nhất', () => {
    expect(nextColor([])).toBe('yellow');
    expect(nextColor([{ color: 'yellow' }, { color: 'orange' }])).toBe('pink');
  });
});

describe('định dạng', () => {
  it('thời gian tương đối', () => {
    const now = new Date('2026-10-31T12:00:00Z').getTime();
    expect(relativeTime('2026-10-31T11:59:30Z', now)).toBe('vừa xong');
    expect(relativeTime('2026-10-31T11:15:00Z', now)).toBe('45 phút trước');
    expect(relativeTime('2026-10-30T10:00:00Z', now)).toBe('hôm qua');
    expect(relativeTime('2026-10-27T12:00:00Z', now)).toBe('4 ngày trước');
    expect(relativeTime('2026-10-14T12:00:00Z', now)).toBe('2 tuần trước');
  });
  it('thời lượng ghi âm', () => {
    expect(formatDuration(75)).toBe('1:15');
    expect(formatDuration(3725)).toBe('1:02:05');
  });
  it('chọn định dạng ghi âm theo trình duyệt', () => {
    expect(pickRecorderMime(t => t.startsWith('audio/webm'))).toEqual({ mime: 'audio/webm;codecs=opus', ext: 'webm' });
    expect(pickRecorderMime(t => t === 'audio/mp4')).toEqual({ mime: 'audio/mp4', ext: 'mp4' });
    expect(pickRecorderMime(() => false)).toEqual({ mime: '', ext: 'webm' });
  });
});

describe('Ghi chú / Sơ đồ tư duy là 2 loại mục riêng', () => {
  const doc: MindMapDoc = {
    v: 1, structure: 'map', theme: 'rainbow', floating: [], relations: [],
    root: { id: 'r', text: 'Kế hoạch\nquý 4', children: [{ id: 'a', text: 'Tuyển dụng', children: [{ id: 'b', text: 'Kỹ sư Samsung', children: [] }] }] },
  };
  const map = { body: 'chữ cũ bị ẩn', mindmap: doc, view_mode: 'mindmap' as const, recordings: [] };
  const note = { body: 'Gọi khách\nGửi báo giá', mindmap: doc, view_mode: 'text' as const, recordings: [] };

  it('tiêu đề: sơ đồ = chủ đề trung tâm, ghi chú = dòng đầu; trống thì tên mặc định theo loại', () => {
    expect(titleOf(map)).toBe('Kế hoạch quý 4');
    expect(titleOf(note)).toBe('Gọi khách');
    expect(displayTitle({ body: '', mindmap: null, view_mode: 'mindmap' })).toBe('Sơ đồ tư duy mới');
    expect(displayTitle({ body: '', mindmap: null, view_mode: 'text' })).toBe('Ghi chú mới');
  });

  it('xem trước + tìm chỉ theo nội dung của đúng loại', () => {
    expect(notePreview(map)).toEqual(['• Tuyển dụng']);
    expect(notePreview(note)).toEqual(['Gửi báo giá']);
    expect(noteMatches(map, 'samsung')).toBe(true);
    expect(noteMatches(map, 'chữ cũ')).toBe(false);
    expect(noteMatches(note, 'samsung')).toBe(false);
    expect(noteMatches(note, 'bao gia')).toBe(true);
    expect(mindmapCount(doc)).toBe(3);
  });
});
