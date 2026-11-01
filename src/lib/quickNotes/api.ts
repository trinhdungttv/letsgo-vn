// Gọi Ghi chú nhanh — MỌI thao tác dữ liệu đi qua 1 hàm DB quick_notes_rpc(p_token, p_action, p_args) (migration 188):
// bảng khoá với anon key vì là ghi chú riêng; hàm kiểm phiên đăng nhập và chỉ chạm ghi chú của chính người đó.
// File ghi âm: bucket riêng tư 'quick-notes'; link tải lên / nghe lại do server cấp (api/quick-notes-audio.ts).
import { supabase } from '../supabase';
import { getStoredSessionToken } from '../sessionToken';
import { isMissingFunction } from '../recruit/api';
import type { TranscribeEvent } from './transcript';
import { NOTE_COLORS, NOTE_FONTS, type PendingAudio, type QuickNote, type QuickNoteRecording } from './types';

export const AUDIO_BUCKET = 'quick-notes';

export class QuickNotesError extends Error {
  /** true = DB chưa có hàm quick_notes_rpc (chưa chạy migration 188) */
  readonly missingMigration: boolean;
  constructor(message: string, missingMigration = false) {
    super(message);
    this.missingMigration = missingMigration;
  }
}

export const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

async function notesRpc<T>(action: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc('quick_notes_rpc', { p_token: getStoredSessionToken(), p_action: action, p_args: args });
  if (error) {
    if (isMissingFunction(error, 'quick_notes_rpc')) {
      throw new QuickNotesError('Ghi chú nhanh chưa được cài trên cơ sở dữ liệu (chưa chạy migration 188).', true);
    }
    throw new QuickNotesError(error.message);
  }
  return data as T;
}

function toRecording(r: Record<string, unknown>): QuickNoteRecording {
  return {
    id: String(r.id),
    note_id: String(r.note_id),
    storage_path: String(r.storage_path ?? ''),
    mime_type: String(r.mime_type ?? 'audio/webm'),
    duration_sec: Number(r.duration_sec) || 0,
    size_bytes: Number(r.size_bytes) || 0,
    title: String(r.title ?? ''),
    transcript: typeof r.transcript === 'string' ? r.transcript : null,
    summary: typeof r.summary === 'string' ? r.summary : null,
    created_at: String(r.created_at ?? ''),
  };
}

/** Dòng từ DB → QuickNote (numeric về number, giá trị lạ về mặc định). */
export function toNote(raw: unknown): QuickNote {
  const r = (raw ?? {}) as Record<string, unknown>;
  const color = NOTE_COLORS.includes(r.color as never) ? (r.color as QuickNote['color']) : 'yellow';
  const font = NOTE_FONTS.includes(r.font as never) ? (r.font as QuickNote['font']) : 'sans';
  return {
    id: String(r.id),
    title: String(r.title ?? ''),
    body: String(r.body ?? ''),
    color,
    font_size: Number(r.font_size) || 15,
    font,
    pinned: !!r.pinned,
    archived_at: typeof r.archived_at === 'string' ? r.archived_at : null,
    deleted_at: typeof r.deleted_at === 'string' ? r.deleted_at : null,
    created_at: String(r.created_at ?? new Date().toISOString()),
    updated_at: String(r.updated_at ?? new Date().toISOString()),
    recordings: Array.isArray(r.recordings) ? (r.recordings as Record<string, unknown>[]).map(toRecording) : [],
  };
}

const toNotes = (raw: unknown) => (Array.isArray(raw) ? raw.map(toNote) : []);

export const listNotes = async () => toNotes(await notesRpc<unknown>('list'));
export const listTrash = async () => toNotes(await notesRpc<unknown>('trash'));

export async function saveNote(n: QuickNote): Promise<QuickNote> {
  return toNote(await notesRpc<unknown>('save', {
    id: n.id, title: n.title, body: n.body, color: n.color, font_size: n.font_size, font: n.font,
    pinned: n.pinned, archived: !!n.archived_at,
  }));
}

export const deleteNote = (id: string) => notesRpc<unknown>('delete', { id });
export const restoreNote = async (id: string) => toNote(await notesRpc<unknown>('restore', { id }));
export const renameRecording = async (id: string, title: string) => toNote(await notesRpc<unknown>('recording.rename', { id, title }));
export const deleteRecording = async (id: string) => toNote(await notesRpc<unknown>('recording.delete', { id }));

// ── File ghi âm ──

async function audioApi<T>(body: Record<string, unknown>): Promise<T> {
  const token = getStoredSessionToken();
  let res: Response;
  try {
    res = await fetch('/api/quick-notes-audio', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { 'x-letsgo-token': token } : {}) },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('Mất kết nối mạng');
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error || `Máy chủ báo lỗi ${res.status}`);
  return data as T;
}

/** Đưa 1 bản ghi đã thu lên Storage rồi gắn vào ghi chú; trả về ghi chú mới (kèm danh sách bản ghi) + bản ghi vừa thêm. */
export async function uploadRecording(p: PendingAudio): Promise<{ note: QuickNote; recording: QuickNoteRecording | null }> {
  const { path, token } = await audioApi<{ path: string; token: string }>({ action: 'upload', ext: p.ext });
  const { error } = await supabase.storage.from(AUDIO_BUCKET).uploadToSignedUrl(path, token, p.blob, {
    contentType: p.mime || 'audio/webm',
  });
  if (error) throw new Error(`Tải file lên không được: ${error.message}`);
  const note = toNote(await notesRpc<unknown>('recording.add', {
    note_id: p.noteId, storage_path: path, mime_type: p.mime, duration_sec: Math.round(p.durationSec * 10) / 10,
    size_bytes: p.blob.size, title: p.title,
  }));
  return { note, recording: note.recordings.find(r => r.storage_path === path) ?? null };
}

// Link nghe lại hết hạn sau 1 giờ → nhớ 50 phút trong phiên để bấm phát lại không phải hỏi server
const playCache = new Map<string, { url: string; until: number }>();

export async function recordingUrl(path: string): Promise<string> {
  const hit = playCache.get(path);
  if (hit && hit.until > Date.now()) return hit.url;
  const { url } = await audioApi<{ url: string }>({ action: 'play', path });
  playCache.set(path, { url, until: Date.now() + 50 * 60 * 1000 });
  return url;
}

/**
 * Gemini chép lời + tóm tắt 1 bản ghi (api/quick-notes-transcribe.ts). Server trả luồng NDJSON: onEvent nhận từng
 * bước / đoạn chữ; xong thì trả { summary, transcript } (server đã lưu vào DB).
 */
export async function transcribeRecording(
  recordingId: string,
  onEvent: (e: TranscribeEvent) => void,
): Promise<{ summary: string; transcript: string; truncated: boolean }> {
  const token = getStoredSessionToken();
  let res: Response;
  try {
    res = await fetch('/api/quick-notes-transcribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { 'x-letsgo-token': token } : {}) },
      body: JSON.stringify({ recording_id: recordingId }),
    });
  } catch {
    throw new Error('Mất kết nối mạng');
  }
  if (!res.ok || !res.body) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || `Máy chủ báo lỗi ${res.status}`);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const handle = (line: string) => {
    if (!line.trim()) return null;
    let e: TranscribeEvent;
    try {
      e = JSON.parse(line) as TranscribeEvent;
    } catch {
      return null;
    }
    if (e.type === 'error') throw new Error(e.error);
    if (e.type === 'done') return e;
    onEvent(e);
    return null;
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const r = handle(buf.slice(0, nl));
      buf = buf.slice(nl + 1);
      if (r) return r;
    }
  }
  const last = handle(buf);
  if (last) return last;
  throw new Error('Bị ngắt giữa chừng — phần đã chép (nếu có) vẫn được lưu; bấm Thử lại để chép lại.');
}
