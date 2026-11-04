// Pháp lý — "Bài học trực quan": tài liệu tự soạn dạng KHỐI MÀU (học bằng hình ảnh / màu sắc, dễ nhớ).
// Lưu ở legal_docs.content (kind = 'lesson'). Thuần, có test (lesson.test.ts).
import { rid } from './types';

export type CalloutTone = 'define' | 'note' | 'danger' | 'tip' | 'example' | 'law';

export const CALLOUT_TONES: Record<CalloutTone, { label: string; color: string; bg: string; ink: string }> = {
  define: { label: 'Định nghĩa', color: '#0071E3', bg: '#EAF3FE', ink: '#0B3D74' },
  note: { label: 'Lưu ý', color: '#FF9500', bg: '#FFF4E3', ink: '#6E3B00' },
  danger: { label: 'Cấm / Xử phạt', color: '#FF3B30', bg: '#FFECEA', ink: '#7A0E08' },
  tip: { label: 'Mẹo nhớ', color: '#AF52DE', bg: '#F6ECFC', ink: '#4D1B66' },
  example: { label: 'Ví dụ', color: '#34C759', bg: '#E9F8EE', ink: '#14532D' },
  law: { label: 'Căn cứ pháp lý', color: '#6E6E73', bg: '#F2F2F5', ink: '#2C2C2E' },
};
export const CALLOUT_TONE_IDS = Object.keys(CALLOUT_TONES) as CalloutTone[];

export interface StepItem { id: string; title: string; text: string }
export interface CheckItem { id: string; text: string; done: boolean }

export type LessonBlock =
  | { id: string; t: 'h'; text: string }
  | { id: string; t: 'p'; text: string }
  | { id: string; t: 'callout'; tone: CalloutTone; title: string; text: string }
  | { id: string; t: 'steps'; items: StepItem[] }
  | { id: string; t: 'check'; items: CheckItem[] }
  | { id: string; t: 'quote'; text: string; source: string }
  | { id: string; t: 'compare'; cols: string[]; rows: string[][] }
  | { id: string; t: 'image'; url: string; caption: string }
  | { id: string; t: 'embed'; url: string; caption: string }
  | { id: string; t: 'divider' };

export type BlockType = LessonBlock['t'];

export interface LessonDoc {
  v: 1;
  /** màu dải bìa trên đầu bài học */
  accent: string;
  blocks: LessonBlock[];
}

export const BLOCK_TYPES: { t: BlockType; label: string; hint: string }[] = [
  { t: 'h', label: 'Tiêu đề mục', hint: 'Chia bài thành từng phần' },
  { t: 'p', label: 'Đoạn văn', hint: '**đậm**  ==tô vàng==  !!đỏ!!' },
  { t: 'callout', label: 'Khối màu', hint: 'Định nghĩa, Lưu ý, Xử phạt, Mẹo nhớ…' },
  { t: 'steps', label: 'Các bước', hint: 'Thủ tục: bước 1 → 2 → 3' },
  { t: 'check', label: 'Danh sách kiểm', hint: 'Hồ sơ cần chuẩn bị' },
  { t: 'compare', label: 'Bảng so sánh', hint: 'Đặt 2–4 phương án cạnh nhau' },
  { t: 'quote', label: 'Trích điều luật', hint: 'Trích nguyên văn + nguồn' },
  { t: 'image', label: 'Hình ảnh', hint: 'Dán / tải ảnh, sơ đồ chụp lại' },
  { t: 'embed', label: 'Nhúng Drive / video', hint: 'PDF, Sheets, Slides, YouTube ngay trong bài' },
  { t: 'divider', label: 'Đường kẻ', hint: '' },
];

export function newBlock(t: BlockType): LessonBlock {
  const id = rid();
  switch (t) {
    case 'h': return { id, t, text: '' };
    case 'p': return { id, t, text: '' };
    case 'callout': return { id, t, tone: 'define', title: '', text: '' };
    case 'steps': return { id, t, items: [{ id: rid(), title: '', text: '' }, { id: rid(), title: '', text: '' }] };
    case 'check': return { id, t, items: [{ id: rid(), text: '', done: false }] };
    case 'quote': return { id, t, text: '', source: '' };
    case 'compare': return { id, t, cols: ['Tiêu chí', 'Phương án A', 'Phương án B'], rows: [['', '', ''], ['', '', '']] };
    case 'image': return { id, t, url: '', caption: '' };
    case 'embed': return { id, t, url: '', caption: '' };
    case 'divider': return { id, t };
  }
}

/** Bài học mẫu cho người mới — có đủ các loại khối để thấy cách trình bày. */
export function starterLesson(title: string): LessonDoc {
  return {
    v: 1,
    accent: '#FF9500',
    blocks: [
      { id: rid(), t: 'callout', tone: 'define', title: 'Hiểu nhanh', text: `${title || 'Chủ đề này'} là gì? Viết 1–2 câu thật ngắn, có ==từ khoá== được tô màu.` },
      { id: rid(), t: 'h', text: 'Thủ tục' },
      { id: rid(), t: 'steps', items: [
        { id: rid(), title: 'Chuẩn bị hồ sơ', text: 'Liệt kê giấy tờ cần có' },
        { id: rid(), title: 'Nộp hồ sơ', text: 'Nộp ở đâu, online hay trực tiếp' },
        { id: rid(), title: 'Nhận kết quả', text: 'Thời hạn giải quyết, lệ phí' },
      ] },
      { id: rid(), t: 'callout', tone: 'danger', title: 'Mức phạt', text: 'Vi phạm thì bị xử phạt **bao nhiêu**, theo điều nào.' },
      { id: rid(), t: 'callout', tone: 'tip', title: 'Mẹo nhớ', text: 'Một câu vần / hình ảnh giúp nhớ lâu.' },
    ],
  };
}

const TONES = new Set<string>(CALLOUT_TONE_IDS);
const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** Đọc JSON từ DB, bỏ khối hỏng — không bao giờ ném lỗi. */
export function parseLesson(raw: unknown): LessonDoc {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const blocks: LessonBlock[] = [];
  for (const b of Array.isArray(r.blocks) ? r.blocks : []) {
    if (!b || typeof b !== 'object') continue;
    const o = b as Record<string, unknown>;
    const id = str(o.id) || rid();
    switch (o.t) {
      case 'h': case 'p': blocks.push({ id, t: o.t, text: str(o.text) }); break;
      case 'callout': blocks.push({ id, t: 'callout', tone: TONES.has(str(o.tone)) ? (o.tone as CalloutTone) : 'define', title: str(o.title), text: str(o.text) }); break;
      case 'steps': blocks.push({ id, t: 'steps', items: (Array.isArray(o.items) ? o.items : []).map(i => ({ id: str((i as StepItem)?.id) || rid(), title: str((i as StepItem)?.title), text: str((i as StepItem)?.text) })) }); break;
      case 'check': blocks.push({ id, t: 'check', items: (Array.isArray(o.items) ? o.items : []).map(i => ({ id: str((i as CheckItem)?.id) || rid(), text: str((i as CheckItem)?.text), done: !!(i as CheckItem)?.done })) }); break;
      case 'quote': blocks.push({ id, t: 'quote', text: str(o.text), source: str(o.source) }); break;
      case 'compare': {
        const cols = (Array.isArray(o.cols) ? o.cols : []).map(str).slice(0, 5);
        const width = Math.max(2, cols.length);
        while (cols.length < width) cols.push('');
        const rows = (Array.isArray(o.rows) ? o.rows : []).map(row => {
          const cells = (Array.isArray(row) ? row : []).map(str).slice(0, width);
          while (cells.length < width) cells.push('');
          return cells;
        });
        blocks.push({ id, t: 'compare', cols, rows });
        break;
      }
      case 'image': case 'embed': blocks.push({ id, t: o.t, url: str(o.url), caption: str(o.caption) }); break;
      case 'divider': blocks.push({ id, t: 'divider' }); break;
    }
  }
  const accent = /^#[0-9a-f]{6}$/i.test(str(r.accent)) ? str(r.accent) : '#FF9500';
  return { v: 1, accent, blocks };
}

/** Chữ thuần của bài học (tìm kiếm, tạo thẻ ghi nhớ). */
export function lessonText(doc: LessonDoc): string {
  const out: string[] = [];
  for (const b of doc.blocks) {
    switch (b.t) {
      case 'h': case 'p': out.push(b.text); break;
      case 'callout': out.push(b.title, b.text); break;
      case 'steps': b.items.forEach(i => out.push(i.title, i.text)); break;
      case 'check': b.items.forEach(i => out.push(i.text)); break;
      case 'quote': out.push(b.text, b.source); break;
      case 'compare': out.push(b.cols.join(' '), ...b.rows.map(r => r.join(' '))); break;
      case 'image': case 'embed': out.push(b.caption); break;
    }
  }
  return out.filter(Boolean).join('\n');
}

export type InlinePart = { text: string; mark?: 'bold' | 'hl' | 'red' };

/** Định dạng trong dòng: **đậm**, ==tô vàng==, !!chữ đỏ!! (không lồng nhau). */
export function parseInline(text: string): InlinePart[] {
  const out: InlinePart[] = [];
  const re = /\*\*(.+?)\*\*|==(.+?)==|!!(.+?)!!/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ text: m[1], mark: 'bold' });
    else if (m[2] !== undefined) out.push({ text: m[2], mark: 'hl' });
    else out.push({ text: m[3], mark: 'red' });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

/** Đổi chỗ khối (dir -1 lên / +1 xuống). */
export function moveBlock(blocks: LessonBlock[], id: string, dir: -1 | 1): LessonBlock[] {
  const i = blocks.findIndex(b => b.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= blocks.length) return blocks;
  const next = [...blocks];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}
