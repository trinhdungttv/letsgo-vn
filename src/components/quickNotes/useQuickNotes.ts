// Kho ghi chú nhanh của người đang đăng nhập: tải từ DB, sửa tại chỗ rồi TỰ LƯU (chờ 0,7 giây sau lần gõ cuối),
// tải lại khi quay về tab (điện thoại ↔ máy tính dùng chung). Ghi chú mới chỉ lên DB khi đã có chữ / đổi gì đó.
import { useCallback, useEffect, useRef, useState } from 'react';
import { deleteNote, errText, listNotes, LockError, QuickNotesError, saveNote } from '../../lib/quickNotes/api';
import { nextColor, titleOf } from '../../lib/quickNotes/noteText';
import type { QuickNote, SaveState } from '../../lib/quickNotes/types';

const SAVE_DELAY_MS = 700;
const RETRY_MS = 5000;
const REFRESH_MIN_GAP_MS = 20_000;

export type NotesPhase = 'loading' | 'ready' | 'missing' | 'error';

export interface QuickNotesStore {
  notes: QuickNote[];
  phase: NotesPhase;
  error: string | null;
  saveState: Record<string, SaveState>;
  /** Có ghi chú chưa lưu xong (đang chờ / đang lưu / lỗi) */
  unsaved: boolean;
  /** Ghi chú mới tạo trên máy, chưa lên DB lần nào */
  isLocal: (id: string) => boolean;
  create: (init?: Partial<QuickNote>) => QuickNote;
  update: (id: string, patch: Partial<QuickNote>) => void;
  /** Lưu ngay (không chờ) — dùng trước khi gắn bản ghi âm. */
  flush: (id: string) => Promise<void>;
  /** Xoá mềm; mục đang khoá chống xoá phải kèm mã 4 số (sai → LockError). */
  remove: (id: string, pin?: string) => Promise<void>;
  /** Ghi chú mới mở ra rồi đóng mà chưa gõ gì → bỏ luôn, không tạo dòng rỗng trong DB. */
  discardIfEmpty: (id: string) => void;
  /** Nhận bản mới từ server (sau khi thêm / đổi tên / xoá bản ghi âm, khôi phục…). */
  replace: (note: QuickNote) => void;
  reload: () => Promise<void>;
}

export function useQuickNotes(userId: string): QuickNotesStore {
  const [notes, setNotes] = useState<QuickNote[]>([]);
  const [phase, setPhase] = useState<NotesPhase>('loading');
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<Record<string, SaveState>>({});

  const notesRef = useRef<QuickNote[]>([]);
  const stateRef = useRef<Record<string, SaveState>>({});
  const localOnly = useRef(new Set<string>());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const inflight = useRef(new Set<string>());
  const again = useRef(new Set<string>());
  const lastLoad = useRef(0);
  const alive = useRef(true);

  const commit = useCallback((next: QuickNote[]) => {
    notesRef.current = next;
    setNotes(next);
  }, []);

  const setOne = useCallback((id: string, s: SaveState | null) => {
    const next = { ...stateRef.current };
    if (s === null) delete next[id];
    else next[id] = s;
    stateRef.current = next;
    setSaveState(next);
  }, []);

  const save = useCallback(async (id: string): Promise<void> => {
    const t = timers.current.get(id);
    if (t) { clearTimeout(t); timers.current.delete(id); }
    if (inflight.current.has(id)) { again.current.add(id); return; }
    const note = notesRef.current.find(n => n.id === id);
    if (!note) { setOne(id, null); return; }
    inflight.current.add(id);
    setOne(id, 'saving');
    try {
      const saved = await saveNote(note);
      if (!alive.current) return;
      localOnly.current.delete(id);
      // Giữ chữ đang gõ trên máy; chỉ nhận các trường do server quyết
      commit(notesRef.current.map(n => (n.id === id
        ? { ...n, created_at: saved.created_at, updated_at: saved.updated_at, recordings: saved.recordings }
        : n)));
      setOne(id, again.current.has(id) ? 'dirty' : 'saved');
    } catch (e) {
      if (!alive.current) return;
      setOne(id, 'error');
      setError(errText(e));
      // Thử lại sau ít giây (mất mạng thoáng qua, đổi wifi…)
      if (!timers.current.has(id)) timers.current.set(id, setTimeout(() => { timers.current.delete(id); void save(id); }, RETRY_MS));
    } finally {
      inflight.current.delete(id);
      if (again.current.delete(id)) void save(id);
    }
  }, [commit, setOne]);

  const schedule = useCallback((id: string) => {
    setOne(id, 'dirty');
    const t = timers.current.get(id);
    if (t) clearTimeout(t);
    timers.current.set(id, setTimeout(() => { timers.current.delete(id); void save(id); }, SAVE_DELAY_MS));
  }, [save, setOne]);

  const update = useCallback((id: string, patch: Partial<QuickNote>) => {
    commit(notesRef.current.map(n => {
      if (n.id !== id) return n;
      const next = { ...n, ...patch };
      return patch.body !== undefined || patch.mindmap !== undefined || patch.view_mode !== undefined ? { ...next, title: titleOf(next) } : next;
    }));
    schedule(id);
  }, [commit, schedule]);

  const create = useCallback((init: Partial<QuickNote> = {}): QuickNote => {
    const now = new Date().toISOString();
    const body = init.body ?? '';
    const note: QuickNote = {
      id: crypto.randomUUID(),
      title: titleOf({ body, mindmap: init.mindmap ?? null, view_mode: init.view_mode ?? 'text' }),
      body,
      color: init.color ?? nextColor(notesRef.current.filter(n => !n.archived_at)),
      font_size: init.font_size ?? 15,
      font: init.font ?? 'sans',
      pinned: false,
      archived_at: null,
      deleted_at: null,
      created_at: now,
      updated_at: now,
      recordings: [],
      mindmap: init.mindmap ?? null,
      view_mode: init.view_mode ?? 'text',
      locked_at: null,
      tags: init.tags ?? [],
    };
    localOnly.current.add(note.id);
    commit([...notesRef.current, note]);
    if (body || note.mindmap) schedule(note.id);
    return note;
  }, [commit, schedule]);

  const flush = useCallback(async (id: string) => {
    if (stateRef.current[id] === 'saved' && !localOnly.current.has(id)) return;
    await save(id);
  }, [save]);

  const dropLocal = useCallback((id: string) => {
    const t = timers.current.get(id);
    if (t) { clearTimeout(t); timers.current.delete(id); }
    localOnly.current.delete(id);
    commit(notesRef.current.filter(n => n.id !== id));
    setOne(id, null);
  }, [commit, setOne]);

  const discardIfEmpty = useCallback((id: string) => {
    const n = notesRef.current.find(x => x.id === id);
    if (!n || !localOnly.current.has(id) || inflight.current.has(id)) return;
    if (n.body.trim() === '' && n.recordings.length === 0 && !n.mindmap) dropLocal(id);
  }, [dropLocal]);

  const remove = useCallback(async (id: string, pin?: string) => {
    // Chặn cả ở máy: mục đang khoá không bao giờ gọi xoá khi chưa có mã (server cũng chặn lần nữa)
    if (notesRef.current.find(n => n.id === id)?.locked_at && !pin) throw new LockError({ reason: 'note_locked' });
    if (localOnly.current.has(id) && !inflight.current.has(id)) { dropLocal(id); return; }
    await deleteNote(id, pin);
    if (alive.current) dropLocal(id);
  }, [dropLocal]);

  const replace = useCallback((note: QuickNote) => {
    localOnly.current.delete(note.id);
    const exists = notesRef.current.some(n => n.id === note.id);
    // Đang có chữ chưa lưu → giữ chữ trên máy, chỉ nhận danh sách ghi âm + mốc thời gian + trạng thái khoá
    const busy = ['dirty', 'saving', 'error'].includes(stateRef.current[note.id] ?? '');
    commit(exists
      ? notesRef.current.map(n => (n.id !== note.id ? n
        : busy ? { ...n, recordings: note.recordings, updated_at: note.updated_at, locked_at: note.locked_at } : note))
      : [...notesRef.current, note]);
  }, [commit]);

  const reload = useCallback(async () => {
    lastLoad.current = Date.now();
    try {
      const server = await listNotes();
      if (!alive.current) return;
      const local = new Map(notesRef.current.map(n => [n.id, n]));
      const busy = (id: string) => localOnly.current.has(id) || ['dirty', 'saving', 'error'].includes(stateRef.current[id] ?? '');
      // Đang sửa dở thì giữ bản trên máy, nhưng trạng thái khoá luôn theo server (khoá / mở ở máy khác)
      const merged = server.map(s => (busy(s.id) && local.has(s.id) ? { ...local.get(s.id)!, locked_at: s.locked_at } : s));
      const seen = new Set(server.map(s => s.id));
      // Ghi chú mới chưa lên DB (hoặc đang lưu dở) vẫn giữ; ghi chú đã xoá ở máy khác thì bỏ
      for (const n of notesRef.current) if (!seen.has(n.id) && busy(n.id)) merged.push(n);
      commit(merged);
      setPhase('ready');
      setError(null);
    } catch (e) {
      if (!alive.current) return;
      if (e instanceof QuickNotesError && e.missingMigration) setPhase('missing');
      else setPhase(p => (p === 'ready' ? p : 'error'));
      setError(errText(e));
    }
  }, [commit]);

  useEffect(() => {
    alive.current = true;
    notesRef.current = [];
    commit([]);
    setPhase('loading');
    void reload();
    const onWake = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastLoad.current > REFRESH_MIN_GAP_MS) void reload();
    };
    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('focus', onWake);
    const pending = timers.current;
    return () => {
      alive.current = false;
      document.removeEventListener('visibilitychange', onWake);
      window.removeEventListener('focus', onWake);
      pending.forEach(t => clearTimeout(t));
      pending.clear();
    };
  }, [userId, reload, commit]);

  const unsaved = Object.values(saveState).some(s => s !== 'saved');
  const isLocal = useCallback((id: string) => localOnly.current.has(id), []);

  return { notes, phase, error, saveState, unsaved, isLocal, create, update, flush, remove, discardIfEmpty, replace, reload };
}
