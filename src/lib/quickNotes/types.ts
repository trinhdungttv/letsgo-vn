// Ghi chú nhanh (dải thẻ dính mép phải) — kiểu dữ liệu khớp bảng quick_notes / quick_note_recordings (migration 188, 189, 196).
import type { MindMapDoc } from './mindmap/types';

export const NOTE_COLORS = ['yellow', 'orange', 'pink', 'purple', 'blue', 'green', 'slate', 'gray'] as const;
export type NoteColor = typeof NOTE_COLORS[number];

export const NOTE_FONTS = ['sans', 'serif', 'mono'] as const;
export type NoteFont = typeof NOTE_FONTS[number];

/** Loại mục, cố định từ lúc tạo: 'text' = Ghi chú văn bản, 'mindmap' = Sơ đồ tư duy (cột view_mode). */
export type NoteView = 'text' | 'mindmap';

/** Nhóm trong cửa sổ danh sách. */
export type NotesTab = 'all' | 'archive' | 'trash';

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
  /** Nội dung của mục Sơ đồ tư duy (null = sơ đồ mới chưa vẽ gì) — migration 189 */
  mindmap: MindMapDoc | null;
  view_mode: NoteView;
  /** Khoá chống xoá (migration 196): có giá trị = không xoá được nếu không nhập đúng mã 4 số */
  locked_at: string | null;
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
