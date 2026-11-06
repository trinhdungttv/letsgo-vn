import { describe, expect, it } from 'vitest';
import { newTopic } from '../quickNotes/mindmap/model';
import type { MindMapDoc, MindTopic } from '../quickNotes/mindmap/types';
import { chunkRows, fromMindmap, moveItem, parseTimeline, splitLabel, starterTimeline } from './timelineChart';

const t = (text: string, children: MindTopic[] = [], extra: Partial<MindTopic> = {}): MindTopic => ({ ...newTopic(text, extra), children });

describe('timelineChart', () => {
  it('splitLabel tách năm / bước khỏi tiêu đề', () => {
    expect(splitLabel('2020 – Thành lập')).toEqual({ label: '2020', title: 'Thành lập' });
    expect(splitLabel('2024: Đổi tên')).toEqual({ label: '2024', title: 'Đổi tên' });
    expect(splitLabel('Bước 2 Nộp hồ sơ')).toEqual({ label: 'Bước 2', title: 'Nộp hồ sơ' });
    expect(splitLabel('Không có năm')).toEqual({ label: '', title: 'Không có năm' });
  });

  it('fromMindmap: mỗi nhánh cấp 1 = 1 mốc, nhánh con gộp thành mô tả, giữ màu nhánh', () => {
    const doc: MindMapDoc = {
      v: 1, floating: [], relations: [], structure: 'map', theme: 'rainbow',
      root: t('Gốc', [t('2020 – A', [t('x'), t('y', [t('z')])], { style: { branch: '#112233' } }), t('B')]),
    };
    const tl = fromMindmap(doc, 'snake');
    expect(tl.style).toBe('snake');
    expect(tl.items).toHaveLength(2);
    expect(tl.items[0]).toMatchObject({ label: '2020', title: 'A', text: 'x · y · z', color: '#112233' });
    expect(tl.items[1]).toMatchObject({ label: '2', title: 'B' });
  });

  it('parseTimeline chịu được dữ liệu hỏng', () => {
    expect(parseTimeline(null)).toBeNull();
    expect(parseTimeline({})).toBeNull();
    const p = parseTimeline({ style: 'xxx', items: [{ label: 5, color: 'red' }, null] })!;
    expect(p.style).toBe('dots');
    expect(p.items).toHaveLength(1);
    expect(p.items[0].color).toMatch(/^#/);
    expect(parseTimeline(starterTimeline('arrows'))!.style).toBe('arrows');
  });

  it('chunkRows / moveItem', () => {
    expect(chunkRows([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunkRows([1], 0)).toEqual([[1]]);
    expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
    const same = ['a', 'b'];
    expect(moveItem(same, 0, 5)).toBe(same);
  });
});
