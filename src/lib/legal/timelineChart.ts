// Pháp lý — SƠ ĐỒ DÒNG THỜI GIAN (3 kiểu): dots = trục + chấm tròn · arrows = dải mũi tên · snake = mũi tên uốn lượn nhiều hàng.
// Lưu ở legal_docs.content (kind = 'timeline'). Thuần, có test (timelineChart.test.ts). Dùng chung với Sơ đồ tư duy (fromMindmap).
import type { MindMapDoc, MindTopic } from '../quickNotes/mindmap/types';
import { rid } from './types';

export type TimelineStyle = 'dots' | 'arrows' | 'snake';

export const TIMELINE_STYLES: { id: TimelineStyle; label: string; hint: string }[] = [
  { id: 'dots', label: 'Trục & chấm tròn', hint: 'Mốc là chấm tròn trên trục, thẻ nằm trên / dưới' },
  { id: 'arrows', label: 'Dải mũi tên', hint: 'Các mũi tên màu nối tiếp, ghi chú đan xen trên / dưới' },
  { id: 'snake', label: 'Uốn lượn', hint: 'Nhiều hàng mũi tên, hàng sau quay đầu lại' },
];

export interface TimelineItem {
  id: string;
  /** nhãn ngắn trên mốc: năm / ngày / "Bước 1" */
  label: string;
  title: string;
  text: string;
  /** màu mốc (hex) */
  color: string;
}

export interface TimelineDoc {
  v: 1;
  style: TimelineStyle;
  items: TimelineItem[];
}

export const TIMELINE_COLORS = ['#FF3B30', '#FF9500', '#FFCC00', '#34C759', '#30B0C7', '#0071E3', '#5856D6', '#AF52DE', '#FF2D55', '#8E8E93'] as const;
export const colorAt = (i: number) => TIMELINE_COLORS[i % TIMELINE_COLORS.length];

export function newItem(i: number, patch: Partial<TimelineItem> = {}): TimelineItem {
  return { id: rid(), label: '', title: '', text: '', color: colorAt(i), ...patch };
}

export function starterTimeline(style: TimelineStyle = 'dots'): TimelineDoc {
  return {
    v: 1, style,
    items: [
      newItem(0, { label: '2020', title: 'Mốc đầu tiên', text: 'Mô tả ngắn sự kiện' }),
      newItem(1, { label: '2022', title: 'Mốc thứ hai', text: 'Mô tả ngắn sự kiện' }),
      newItem(2, { label: '2024', title: 'Mốc thứ ba', text: 'Mô tả ngắn sự kiện' }),
      newItem(3, { label: '2026', title: 'Mốc thứ tư', text: 'Mô tả ngắn sự kiện' }),
    ],
  };
}

const isHex = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** Đọc JSON lưu trong DB; sai định dạng → null. */
export function parseTimeline(raw: unknown): TimelineDoc | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.items)) return null;
  const items = r.items.filter(x => x && typeof x === 'object').map((x, i) => {
    const o = x as Record<string, unknown>;
    return { id: str(o.id) || rid(), label: str(o.label), title: str(o.title), text: str(o.text), color: isHex(o.color) ? o.color : colorAt(i) };
  });
  const style = (['dots', 'arrows', 'snake'] as const).find(s => s === r.style) ?? 'dots';
  return { v: 1, style, items };
}

/** Tách "2020 – Tên mốc" / "2020: Tên mốc" / "Q1/2025 Tên" thành nhãn + tiêu đề; không có nhãn → để trống. */
export function splitLabel(text: string): { label: string; title: string } {
  const t = text.trim();
  const m = /^((?:\d{1,2}[/.-]){0,2}\d{4}|Q[1-4][/ -]?\d{2,4}|(?:Bước|Buoc|Step)\s*\d+)\s*[:–—-]?\s*(.*)$/i.exec(t);
  if (m && m[2].trim()) return { label: m[1].trim(), title: m[2].trim() };
  if (m) return { label: m[1].trim(), title: '' };
  return { label: '', title: t };
}

const flat = (t: MindTopic, depth = 0, out: string[] = []): string[] => {
  for (const c of t.children) { out.push(`${'  '.repeat(depth)}${c.text}`.trimEnd()); flat(c, depth + 1, out); }
  return out;
};

/** Sơ đồ tư duy → dòng thời gian: mỗi nhánh cấp 1 = 1 mốc, nhánh con = phần mô tả. Màu theo nhánh nếu đã chọn. */
export function fromMindmap(doc: MindMapDoc, style: TimelineStyle = 'dots'): TimelineDoc {
  const items = doc.root.children.map((c, i) => {
    const { label, title } = splitLabel(c.text);
    const kids = flat(c).map(s => s.trim()).filter(Boolean);
    const color = isHex(c.style?.branch) ? c.style!.branch! : isHex(c.style?.fill) ? c.style!.fill! : colorAt(i);
    return newItem(i, { label: label || String(i + 1), title: title || (label ? '' : c.text), text: kids.join(' · '), color });
  });
  return { v: 1, style, items };
}

/** Chia mốc thành các hàng (kiểu uốn lượn). */
export function chunkRows<T>(list: T[], perRow: number): T[][] {
  const n = Math.max(1, Math.floor(perRow));
  const rows: T[][] = [];
  for (let i = 0; i < list.length; i += n) rows.push(list.slice(i, i + n));
  return rows;
}

export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = [...list];
  const [it] = next.splice(from, 1);
  next.splice(to, 0, it);
  return next;
}
