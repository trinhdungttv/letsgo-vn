// Ghi chú nhanh (dải thẻ dính mép phải) — kiểu dữ liệu khớp bảng quick_notes / quick_note_recordings (migration 188, 189).
import type { MindMapDoc } from './mindmap/types';

export const NOTE_COLORS = ['yellow', 'orange', 'pink', 'purple', 'blue', 'green', 'slate', 'gray'] as const;
export type NoteColor = typeof NOTE_COLORS[number];

export const NOTE_FONTS = ['sans', 'serif', 'mono'] as const;
export type NoteFont = typeof NOTE_FONTS[number];

/** Ghi chú đang mở dạng văn bản hay sơ đồ tư duy. */
export type NoteView = 'text' | 'mindmap';

export interface QuickNoteRecording {
  id: string;
  note_id: string;
  storage_path: string;
  mime_type: string;
  duration_sec: number;
  size_bytes: number;
  title: string;
  /** Dành cho chuyển giọng nói thành chữ (chưa dùng). */
  transcript: string | null;
  summary: string | null;
  created_at: string;
}

export interface QuickNote {
  id: string;
  /** Dòng đầu của nội dung — app tự tính khi lưu (dùng cho danh sách / tìm kiếm). */
  title: string;
  body: string;
  color: NoteColor;
  font_size: number;
  font: NoteFont;
  pinned: boolean;
  archived_at: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  recordings: QuickNoteRecording[];
  /** Sơ đồ tư duy kiểu XMind của ghi chú (null = chưa tạo) — migration 189 */
  mindmap: MindMapDoc | null;
  view_mode: NoteView;
}

/** Trạng thái lưu của 1 ghi chú: dirty = vừa sửa, đang chờ tự lưu. */
export type SaveState = 'saved' | 'dirty' | 'saving' | 'error';

/** Bản ghi âm đã thu xong nhưng chưa lên được Storage — giữ trong IndexedDB của máy tới khi tải lên xong. */
export interface PendingAudio {
  id: string;
  userId: string;
  noteId: string;
  blob: Blob;
  mime: string;
  ext: string;
  durationSec: number;
  title: string;
  createdAt: string;
}
