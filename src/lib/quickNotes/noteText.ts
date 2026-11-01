// Ghi chú nhanh — các phép xử lý chữ thuần (không đụng React / Supabase) để test được.
import type { MindMapDoc, MindTopic } from './mindmap/types';
import { NOTE_COLORS, type NoteColor, type QuickNote } from './types';

export const BOX_OPEN = '☐';
export const BOX_DONE = '☑';
const BOX_RE = /^([☐☑]) ?/;

export const DEFAULT_TITLE = 'Ghi chú mới';

/** Tiêu đề = dòng đầu có chữ (bỏ ô checklist ở đầu dòng), tối đa 120 ký tự. */
export function noteTitle(body: string): string {
  for (const raw of body.split('\n')) {
    const line = raw.replace(BOX_RE, '').trim();
    if (line) return line.length > 120 ? `${line.slice(0, 119)}…` : line;
  }
  return '';
}

/** Tiêu đề hiển thị: dòng đầu của văn bản, không có thì chủ đề trung tâm của sơ đồ tư duy. */
export function titleOf(note: { body: string; mindmap?: MindMapDoc | null }): string {
  const t = noteTitle(note.body);
  if (t || !note.mindmap) return t;
  const root = note.mindmap.root.text.replace(/\s*\n\s*/g, ' ').trim();
  return root.length > 120 ? `${root.slice(0, 119)}…` : root;
}

/** Mọi chữ trong sơ đồ tư duy (chủ đề, ghi chú, nhãn) — cho ô tìm. */
export function mindmapText(doc: MindMapDoc | null | undefined): string {
  if (!doc) return '';
  const parts: string[] = [];
  const go = (t: MindTopic) => {
    parts.push(t.text);
    if (t.note) parts.push(t.note);
    if (t.labels) parts.push(...t.labels);
    t.summaries?.forEach(s => parts.push(s.text));
    t.children.forEach(go);
  };
  go(doc.root);
  doc.floating.forEach(go);
  doc.relations.forEach(r => parts.push(r.text));
  return parts.join('\n');
}

/** Vài dòng xem trước: văn bản, không có thì các chủ đề chính của sơ đồ. */
export function notePreview(note: { body: string; mindmap?: MindMapDoc | null }, max = 4): string[] {
  const lines = previewLines(note.body, max);
  if (lines.length || !note.mindmap || note.body.trim()) return lines;
  return note.mindmap.root.children.slice(0, max).map(c => `• ${c.text.replace(/\s*\n\s*/g, ' ')}`);
}

/** Vài dòng sau dòng tiêu đề — cho thẻ xem nhanh và danh sách. */
export function previewLines(body: string, max = 4): string[] {
  const lines = body.split('\n').map(l => l.trim()).filter(Boolean);
  return lines.slice(1, 1 + max);
}

export function checklistCount(body: string): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const line of body.split('\n')) {
    const m = line.match(BOX_RE);
    if (!m) continue;
    total += 1;
    if (m[1] === BOX_DONE) done += 1;
  }
  return { done, total };
}

const lineStartOf = (text: string, pos: number) => (pos <= 0 ? 0 : text.lastIndexOf('\n', pos - 1) + 1);

/** Bấm chuột vào ô ☐/☑ ở đầu dòng (con trỏ rơi ngay trước / sau ô) → đổi trạng thái. null = không phải ô. */
export function toggleBoxAt(text: string, pos: number): string | null {
  const start = lineStartOf(text, pos);
  const ch = text[start];
  if ((ch !== BOX_OPEN && ch !== BOX_DONE) || pos - start > 1) return null;
  return text.slice(0, start) + (ch === BOX_OPEN ? BOX_DONE : BOX_OPEN) + text.slice(start + 1);
}

/**
 * Nút checklist: các dòng đang chọn đều có ô → bỏ ô; ngược lại thêm "☐ " cho dòng chưa có.
 * Trả về chữ mới + vùng chọn đã dời theo số ký tự thêm / bớt.
 */
export function toggleChecklist(text: string, selStart: number, selEnd: number): { text: string; selStart: number; selEnd: number } {
  const from = lineStartOf(text, selStart);
  // Chọn tới đầu dòng sau (con trỏ ngay sau dấu xuống dòng) thì không tính dòng sau
  const last = selEnd > selStart && text[selEnd - 1] === '\n' ? selEnd - 1 : Math.max(selEnd, selStart);
  const endNl = text.indexOf('\n', last);
  const to = endNl === -1 ? text.length : endNl;
  const lines = text.slice(from, to).split('\n');
  const allBoxed = lines.every(l => BOX_RE.test(l));
  let shiftFirst = 0;
  let shiftTotal = 0;
  const next = lines.map((l, i) => {
    let out: string;
    if (allBoxed) out = l.replace(BOX_RE, '');
    else out = BOX_RE.test(l) ? l : `${BOX_OPEN} ${l}`;
    const d = out.length - l.length;
    if (i === 0) shiftFirst = d;
    shiftTotal += d;
    return out;
  });
  const result = text.slice(0, from) + next.join('\n') + text.slice(to);
  const clamp = (p: number) => Math.max(from, p);
  return { text: result, selStart: clamp(selStart + shiftFirst), selEnd: clamp(selEnd + shiftTotal) };
}

/**
 * Enter trên dòng checklist: dòng có chữ → xuống dòng kèm "☐ "; dòng chỉ có ô trống → bỏ ô (kết thúc danh sách).
 * null = dòng thường, để textarea tự xử lý.
 */
export function continueChecklist(text: string, pos: number): { text: string; pos: number } | null {
  const start = lineStartOf(text, pos);
  const m = text.slice(start).match(BOX_RE);
  if (!m || pos < start + m[0].length) return null;
  const endNl = text.indexOf('\n', start);
  const lineEnd = endNl === -1 ? text.length : endNl;
  if (text.slice(start + m[0].length, lineEnd).trim() === '') {
    return { text: text.slice(0, start) + text.slice(start + m[0].length), pos: start };
  }
  const ins = `\n${BOX_OPEN} `;
  return { text: text.slice(0, pos) + ins + text.slice(pos), pos: pos + ins.length };
}

/** Bỏ dấu + chữ thường, GIỮ NGUYÊN độ dài (từng ký tự đổi 1-1) để vị trí tìm thấy khớp với chữ gốc. */
export function foldKeepLength(s: string): string {
  let out = '';
  for (const ch of s) {
    if (ch === 'đ' || ch === 'Đ') { out += 'd'; continue; }
    const f = ch.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    out += f.length === ch.length ? f : ch.toLowerCase().length === ch.length ? ch.toLowerCase() : ch;
  }
  return out;
}

/** Vị trí các lần xuất hiện của `q` trong `text` (không phân biệt hoa thường / dấu). */
export function findMatches(text: string, q: string): number[] {
  const needle = foldKeepLength(q.trim());
  if (!needle) return [];
  const hay = foldKeepLength(text);
  const out: number[] = [];
  for (let i = hay.indexOf(needle); i !== -1 && out.length < 500; i = hay.indexOf(needle, i + needle.length)) out.push(i);
  return out;
}

export function noteMatches(note: Pick<QuickNote, 'body' | 'recordings'> & { mindmap?: MindMapDoc | null }, q: string): boolean {
  if (!q.trim()) return true;
  // Tìm cả trong tên / tóm tắt / lời thoại bản ghi âm → gõ 1 câu khách đã nói cũng ra đúng ghi chú
  return findMatches(note.body, q).length > 0
    || (!!note.mindmap && findMatches(mindmapText(note.mindmap), q).length > 0)
    || note.recordings.some(r => [r.title, r.summary ?? '', r.transcript ?? ''].some(t => findMatches(t, q).length > 0));
}

/** Thứ tự trên dải thẻ: ghim trước, rồi theo lúc tạo (thẻ không nhảy chỗ khi đang gõ). */
export function railOrder<T extends Pick<QuickNote, 'pinned' | 'created_at'>>(notes: T[]): T[] {
  return [...notes].sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.created_at.localeCompare(b.created_at));
}

/** Thứ tự trong danh sách: ghim trước, rồi sửa gần nhất trước (như MFinder / Apple Notes). */
export function listOrder<T extends Pick<QuickNote, 'pinned' | 'updated_at'>>(notes: T[]): T[] {
  return [...notes].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updated_at.localeCompare(a.updated_at));
}

/** Màu cho ghi chú mới: màu ít dùng nhất trong các ghi chú đang có (cùng ít thì theo thứ tự bảng màu). */
export function nextColor(notes: Pick<QuickNote, 'color'>[]): NoteColor {
  const used = new Map<NoteColor, number>(NOTE_COLORS.map(c => [c, 0]));
  for (const n of notes) used.set(n.color, (used.get(n.color) ?? 0) + 1);
  return [...NOTE_COLORS].sort((a, b) => (used.get(a) ?? 0) - (used.get(b) ?? 0))[0];
}

/** "vừa xong", "5 phút trước", "hôm qua", "2 tuần trước"… */
export function relativeTime(iso: string, now = Date.now()): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return 'vừa xong';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} phút trước`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} giờ trước`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'hôm qua';
  if (d < 7) return `${d} ngày trước`;
  if (d < 30) return `${Math.floor(d / 7)} tuần trước`;
  if (d < 365) return `${Math.floor(d / 30)} tháng trước`;
  return `${Math.floor(d / 365)} năm trước`;
}

/** 75 → "1:15"; 3725 → "1:02:05". */
export function formatDuration(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export function formatBytes(n: number): string {
  if (!n) return '';
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** "14:30 · 31/10" theo giờ máy. */
export function clockDate(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())} · ${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}`;
}

/** Tên bản ghi: tên đã đặt, không có thì "Ghi âm 14:30 · 31/10". */
export const recordingName = (r: { title: string; created_at: string }) =>
  r.title.trim() || `Ghi âm ${clockDate(new Date(r.created_at))}`;

/** Nội dung mở đầu cho ghi chú "Ghi âm cuộc họp". */
export function meetingTemplate(d: Date): string {
  return `Cuộc họp ${clockDate(d)}\nNgười tham gia: \n\n${BOX_OPEN} `;
}

/** Định dạng ghi âm trình duyệt hỗ trợ: Chrome/Edge/Firefox → webm (opus), Safari → mp4. */
export function pickRecorderMime(isSupported: (type: string) => boolean): { mime: string; ext: string } {
  const candidates: [string, string][] = [
    ['audio/webm;codecs=opus', 'webm'],
    ['audio/webm', 'webm'],
    ['audio/mp4;codecs=mp4a.40.2', 'mp4'],
    ['audio/mp4', 'mp4'],
    ['audio/ogg;codecs=opus', 'ogg'],
  ];
  for (const [mime, ext] of candidates) {
    try {
      if (isSupported(mime)) return { mime, ext };
    } catch {
      // trình duyệt cũ ném lỗi với chuỗi lạ — thử chuỗi kế
    }
  }
  return { mime: '', ext: 'webm' };
}

/** Phần "audio/webm" của "audio/webm;codecs=opus" — dùng làm Content-Type khi tải lên. */
export const baseMime = (mime: string) => (mime.split(';')[0] || 'audio/webm').trim();
