// ============================================================================
// QuickNotesDock — "Ghi chú nhanh": dải thẻ ghi chú dính mép phải trên MỌI trang (ý tưởng từ app MFinder).
// ----------------------------------------------------------------------------
// Máy tính: bình thường chỉ còn các vạch màu mỏng ở mép phải; rê chuột vào → hiện thẻ có tiêu đề dọc; rê lên 1 thẻ →
// thẻ xem nhanh trượt ra; bấm → mở khung soạn đầy đủ (NoteEditor). Cuối dải: ＋ ghi chú mới, ⧉ sơ đồ tư duy mới,
// 🎙 ghi âm cuộc họp, ☰ cửa sổ danh sách (2 khu Ghi chú / Sơ đồ tư duy, mỗi khu có Tất cả / Lưu trữ / Đã xoá).
// Trên dải: ghi chú xếp trước, sơ đồ xếp sau (thẻ sơ đồ có biểu tượng ⧉).
// Điện thoại (< 768px, không có rê chuột): tay nắm nhỏ ở mép phải → bấm mở danh sách toàn màn.
// Ghi chú riêng từng người (migration 188, qua quick_notes_rpc), tự lưu; ghi âm chạy tiếp khi đóng thẻ / đổi trang,
// file lên Storage qua api/quick-notes-audio.ts — chưa lên được thì giữ trong IndexedDB của máy để thử lại.
// Thẻ soạn: nút Phóng to (gần kín màn hình) + kéo góc dưới trái để đổi cỡ; nhớ riêng cho dạng Văn bản / Sơ đồ tư duy
// (sơ đồ mặc định mở to) trong localStorage của máy.
// ============================================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { AlertCircle, List, Mic, Network, Plus } from 'lucide-react';
import { useIsMobile } from '../../hooks/useIsMobile';
import { useBeforeUnloadWarning } from '../../hooks/useBeforeUnloadWarning';
import { deleteRecording, errText, markMindmapCleared, renameRecording, transcribeRecording, uploadRecording } from '../../lib/quickNotes/api';
import { PALETTE } from '../../lib/quickNotes/colors';
import {
  baseMime, checklistCount, clockDate, displayTitle, formatDuration, isMindmap, meetingTemplate, mindmapCount, notePreview, railOrder,
  recordingName, relativeTime,
} from '../../lib/quickNotes/noteText';
import { downloadBlob, dropStashedAudio, listStashedAudio, stashAudio } from '../../lib/quickNotes/pendingAudio';
import { summaryForNote, TRANSCRIBE_ENABLED } from '../../lib/quickNotes/transcript';
import type { NoteView, PendingAudio, QuickNote, QuickNoteRecording } from '../../lib/quickNotes/types';
import ConfirmDialog, { type ConfirmRequest } from './ConfirmDialog';
import NoteEditor from './NoteEditor';
import NotesWindow, { type EditorExtra, type NotesTab } from './NotesWindow';
import type { UploadItem } from './RecordingList';
import type { TranscribeJob } from './TranscriptPanel';
import { useAudioRecorder, type RecordedAudio } from './useAudioRecorder';
import { useQuickNotes } from './useQuickNotes';

const RAIL_TOP = 92;
const TAB_W = 34;
const TAB_HIDDEN = 24; // lúc thu gọn chỉ lộ TAB_W - TAB_HIDDEN = 10px
const TAB_MAX = 116;
const TAB_MIN = 60;
const OVERLAP = 10;
const BUTTONS_SPACE = 192;
/** Ghi âm xong + tải lên xong thì tự cho Gemini chép lời & tóm tắt (như Notion AI meeting notes). Bản ghi quá ngắn thì bỏ qua. */
const AUTO_TRANSCRIBE = TRANSCRIBE_ENABLED;
const AUTO_TRANSCRIBE_MIN_SEC = 5;

const tabShadow = '-1px 0 0 rgba(0,0,0,0.05), -6px 2px 14px -6px rgba(0,0,0,0.3)';

/** Cỡ thẻ soạn, nhớ riêng cho dạng văn bản / sơ đồ tư duy. */
type CardLayout = Record<NoteView, { expanded: boolean; w: number; h: number }>;
const CARD_KEY = 'qn-card-layout';
const CARD_MIN = { w: 340, h: 320 };
const CARD_DEFAULT: CardLayout = { text: { expanded: false, w: 460, h: 540 }, mindmap: { expanded: true, w: 760, h: 600 } };

function loadCardLayout(): CardLayout {
  try {
    const raw = JSON.parse(localStorage.getItem(CARD_KEY) ?? 'null') as Partial<CardLayout> | null;
    if (!raw) return CARD_DEFAULT;
    const pick = (k: NoteView) => {
      const v = raw[k];
      return v && Number.isFinite(v.w) && Number.isFinite(v.h) ? { expanded: !!v.expanded, w: v.w, h: v.h } : CARD_DEFAULT[k];
    };
    return { text: pick('text'), mindmap: pick('mindmap') };
  } catch {
    return CARD_DEFAULT;
  }
}
const fileSafe = (s: string) => s.replace(/[\\/:*?"<>|·]+/g, '-').replace(/\s+/g, ' ').trim();

function upsertUpload(list: UploadItem[], u: UploadItem): UploadItem[] {
  return list.some(x => x.item.id === u.item.id) ? list.map(x => (x.item.id === u.item.id ? u : x)) : [...list, u];
}

function RoundBtn({ title, onClick, disabled, children, badge }: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
  badge?: number;
}) {
  return (
    <button type="button" title={title} aria-label={title} onClick={onClick} disabled={disabled}
      className="relative w-8 h-8 rounded-full flex items-center justify-center bg-white/90 backdrop-blur text-[#1D1D1F] shadow-[0_0_0_0.5px_rgba(0,0,0,0.1),0_4px_12px_-2px_rgba(0,0,0,0.25)] hover:bg-white active:scale-95 transition disabled:opacity-40">
      {children}
      {!!badge && (
        <span className="absolute -top-1 -left-1 min-w-[16px] h-4 px-1 rounded-full bg-[#FF3B30] text-white text-[10px] font-bold flex items-center justify-center">{badge}</span>
      )}
    </button>
  );
}

export default function QuickNotesDock({ userId }: { userId: string }) {
  const isMobile = useIsMobile();
  const store = useQuickNotes(userId);
  const storeRef = useRef(store);
  storeRef.current = store;

  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const uploading = useRef(new Set<string>());
  const [jobs, setJobs] = useState<Record<string, TranscribeJob>>({});
  const transcribing = useRef(new Set<string>());
  const [openId, setOpenId] = useState<string | null>(null);
  const [anchorY, setAnchorY] = useState(RAIL_TOP + 40);
  const [win, setWin] = useState<{ selectedId: string | null; tab: NotesTab } | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [hover, setHover] = useState(false);
  const [peekId, setPeekId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [view, setView] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recTarget = useRef<string | null>(null);
  const [cardLayout, setCardLayout] = useState<CardLayout>(loadCardLayout);
  const [resizing, setResizing] = useState(false);

  const saveCardLayout = (next: CardLayout) => {
    setCardLayout(next);
    try { localStorage.setItem(CARD_KEY, JSON.stringify(next)); } catch { /* máy chặn lưu — chỉ nhớ trong phiên */ }
  };

  useEffect(() => {
    const onResize = () => setView({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 2600);
    return () => clearTimeout(t);
  }, [notice]);

  // ── Gemini chép lời + tóm tắt (chạy ở gốc: đóng thẻ / đổi trang vẫn chạy tiếp) ──
  const runTranscribe = useCallback(async (noteId: string, recId: string) => {
    if (transcribing.current.has(recId)) return;
    transcribing.current.add(recId);
    const patchJob = (fn: (j: TranscribeJob) => TranscribeJob) => setJobs(all => (all[recId] ? { ...all, [recId]: fn(all[recId]) } : all));
    setJobs(all => ({ ...all, [recId]: { noteId, status: 'running', stage: 'Đang gửi bản ghi cho Gemini…', text: '' } }));
    try {
      const r = await transcribeRecording(recId, e => {
        if (e.type === 'status') patchJob(j => ({ ...j, stage: e.text }));
        if (e.type === 'delta') patchJob(j => ({ ...j, stage: 'Đang chép lời…', text: j.text + e.text }));
      });
      const note = storeRef.current.notes.find(n => n.id === noteId);
      if (note) {
        storeRef.current.replace({
          ...note,
          recordings: note.recordings.map(x => (x.id === recId ? { ...x, summary: r.summary || null, transcript: r.transcript || null } : x)),
        });
      }
      setJobs(all => {
        const next = { ...all };
        delete next[recId];
        return next;
      });
      if (r.truncated) setNotice('Bản ghi dài quá — Gemini chỉ chép được phần đầu');
    } catch (e) {
      patchJob(j => ({ ...j, status: 'error', stage: '', error: errText(e) }));
      // Server có thể đã lưu phần chép dở → tải lại để hiện
      void storeRef.current.reload();
    } finally {
      transcribing.current.delete(recId);
    }
  }, []);

  // ── Tải bản ghi âm lên ──
  const runUpload = useCallback(async (item: PendingAudio) => {
    if (uploading.current.has(item.id)) return;
    uploading.current.add(item.id);
    setUploads(list => upsertUpload(list, { item, state: 'uploading' }));
    try {
      const { note, recording } = await uploadRecording(item);
      storeRef.current.replace(note);
      await dropStashedAudio(item.id);
      setUploads(list => list.filter(u => u.item.id !== item.id));
      if (AUTO_TRANSCRIBE && recording && item.durationSec >= AUTO_TRANSCRIBE_MIN_SEC) void runTranscribe(note.id, recording.id);
    } catch (e) {
      setUploads(list => upsertUpload(list, { item, state: 'error', error: errText(e) }));
    } finally {
      uploading.current.delete(item.id);
    }
  }, [runTranscribe]);

  const onRecorded = useCallback(async (audio: RecordedAudio) => {
    const item: PendingAudio = {
      id: crypto.randomUUID(),
      userId,
      noteId: audio.noteId,
      blob: audio.blob,
      mime: baseMime(audio.mime),
      ext: audio.ext,
      durationSec: audio.durationSec,
      title: `Ghi âm ${clockDate(audio.startedAt)}`,
      createdAt: new Date().toISOString(),
    };
    setUploads(list => upsertUpload(list, { item, state: 'uploading' }));
    // Giữ trên máy TRƯỚC khi tải lên: mất mạng / đóng tab giữa chừng vẫn còn bản ghi
    await stashAudio(item);
    await runUpload(item);
  }, [userId, runUpload]);

  const recorder = useAudioRecorder(onRecorded);

  // Bản ghi lần trước chưa lên được (còn trong IndexedDB) → thử lại khi mở app
  useEffect(() => {
    let alive = true;
    void listStashedAudio(userId).then(items => { if (alive) items.forEach(it => void runUpload(it)); });
    return () => { alive = false; };
  }, [userId, runUpload]);

  useBeforeUnloadWarning(store.unsaved || recorder.active || uploads.some(u => u.state === 'uploading')
    || Object.values(jobs).some(j => j.status === 'running'));

  // ── Thao tác ──
  const openEditor = (id: string, y?: number) => {
    if (openId && openId !== id) store.discardIfEmpty(openId);
    setOpenId(id);
    if (y !== undefined) setAnchorY(y);
    setPeekId(null);
  };

  const closeEditor = () => {
    if (openId) store.discardIfEmpty(openId);
    setOpenId(null);
  };

  const startRecording = (noteId: string) => {
    recTarget.current = noteId;
    // Lưu ghi chú lên DB trước để bản ghi có chỗ gắn (không chờ — micro phải bật ngay trong cú bấm)
    void store.flush(noteId);
    void recorder.start(noteId);
  };

  const newNote = (meeting = false): string => {
    const n = store.create(meeting ? { body: meetingTemplate(new Date()) } : {});
    if (meeting) startRecording(n.id);
    return n.id;
  };

  /** Sơ đồ tư duy mới (trống, hoặc dựng sẵn từ 1 ghi chú) — chưa sửa gì mà đóng thì tự bỏ. */
  const newMap = (init: Partial<QuickNote> = {}): string => store.create({ ...init, view_mode: 'mindmap' }).id;

  const openNewOnRail = (kind: 'note' | 'meeting' | 'map' = 'note') => {
    const id = kind === 'map' ? newMap() : newNote(kind === 'meeting');
    if (isMobile) setWin({ selectedId: id, tab: 'all' });
    else openEditor(id, RAIL_TOP + 40);
  };

  const openWindow = (selectedId: string | null = openId, tab: NotesTab = 'all') => {
    if (openId) store.discardIfEmpty(openId);
    setOpenId(null);
    setWin({ selectedId, tab });
  };

  const toggleArchive = (n: QuickNote) => {
    const archiving = !n.archived_at;
    store.update(n.id, { archived_at: archiving ? new Date().toISOString() : null });
    if (archiving && openId === n.id) setOpenId(null);
    setNotice(archiving ? `Đã cất vào Lưu trữ (${isMindmap(n) ? 'Sơ đồ tư duy' : 'Ghi chú'})` : 'Đã đưa lại lên dải ghi chú');
  };

  const askDelete = (n: QuickNote) => {
    const recs = n.recordings.length;
    const doDelete = async () => {
      await store.remove(n.id);
      if (openId === n.id) setOpenId(null);
    };
    if (!n.body.trim() && !recs && !n.mindmap) { void doDelete().catch(e => setNotice(errText(e))); return; }
    setConfirm({
      title: isMindmap(n) ? 'Xoá sơ đồ tư duy này?' : 'Xoá ghi chú này?',
      message: `“${displayTitle(n)}”${recs ? ` cùng ${recs} bản ghi âm` : ''} sẽ chuyển vào mục Đã xoá — khôi phục được trong 30 ngày.`,
      confirmLabel: 'Xoá',
      danger: true,
      onConfirm: doDelete,
    });
  };

  const askDeleteRecording = (rec: QuickNoteRecording) => setConfirm({
    title: 'Xoá bản ghi âm?',
    message: `“${recordingName(rec)}” (${formatDuration(rec.duration_sec)}) sẽ không còn trong ghi chú.`,
    confirmLabel: 'Xoá',
    danger: true,
    onConfirm: async () => { store.replace(await deleteRecording(rec.id)); },
  });

  const renameRec = (rec: QuickNoteRecording, title: string) => {
    renameRecording(rec.id, title).then(store.replace, e => setNotice(errText(e)));
  };

  const askCancelRecording = () => setConfirm({
    title: 'Huỷ bản ghi đang thu?',
    message: `Phần đã ghi (${formatDuration(recorder.elapsedMs / 1000)}) sẽ bị bỏ, không lưu lại.`,
    confirmLabel: 'Huỷ bản ghi',
    danger: true,
    onConfirm: () => recorder.cancel(),
  });

  const insertSummary = (note: QuickNote, rec: QuickNoteRecording) => {
    if (!rec.summary) return;
    const current = store.notes.find(n => n.id === note.id) ?? note;
    store.update(note.id, { body: `${current.body.trimEnd()}\n\n${summaryForNote(rec.summary, recordingName(rec))}\n` });
    setNotice('Đã chèn tóm tắt vào cuối ghi chú');
  };

  const downloadUpload = (id: string) => {
    const u = uploads.find(x => x.item.id === id);
    if (u) downloadBlob(u.item.blob, `${fileSafe(u.item.title)}.${u.item.ext}`);
  };

  const retryUpload = (id: string) => {
    const u = uploads.find(x => x.item.id === id);
    if (u) void runUpload(u.item);
  };

  // Tạo mục mới từ mục đang mở (ghi chú → sơ đồ, sơ đồ → ghi chú dàn ý) rồi mở luôn mục mới
  const openCreated = (id: string, kind: NoteView, extra: EditorExtra, msg?: string) => {
    if (extra.onOpenCreated) extra.onOpenCreated(id, kind);
    else openEditor(id);
    setNotice(msg ?? (kind === 'mindmap' ? 'Đã tạo sơ đồ tư duy mới — ghi chú gốc giữ nguyên' : 'Đã tạo ghi chú mới từ dàn ý của sơ đồ'));
  };
  // Mục từ bản thử đổi qua lại Văn bản ⇄ Sơ đồ: chuyển phần đang ẩn sang 1 mục riêng. Chỉ gỡ khỏi mục cũ SAU KHI mục
  // mới đã lưu lên DB → mất mạng giữa chừng cũng không mất chữ / sơ đồ.
  const splitLegacy = async (note: QuickNote, extra: EditorExtra) => {
    const toNote = isMindmap(note);
    const id = toNote ? store.create({ body: note.body, color: note.color }).id : newMap({ mindmap: note.mindmap, color: note.color });
    await store.flush(id);
    if (storeRef.current.isLocal(id)) { setNotice('Chưa lưu được mục mới — kiểm tra mạng rồi bấm lại'); return; }
    if (toNote) store.update(note.id, { body: '' });
    else { markMindmapCleared(note.id); store.update(note.id, { mindmap: null }); }
    openCreated(id, toNote ? 'text' : 'mindmap', extra, toNote ? 'Đã tách phần chữ ra ghi chú riêng' : 'Đã tách sơ đồ ra mục Sơ đồ tư duy riêng');
  };
  const mapFromNote = async (note: QuickNote, extra: EditorExtra) => {
    const { docFromText } = await import('../../lib/quickNotes/mindmap/model');
    openCreated(newMap({ mindmap: docFromText(note.body), color: note.color }), 'mindmap', extra);
  };

  const editorFor = (note: QuickNote, variant: 'card' | 'pane' | 'sheet', extra: EditorExtra & { onClose?: () => void; onOpenList?: () => void } = {}) => (
    <NoteEditor key={note.id} note={note} variant={variant}
      onCreateMindmap={() => void mapFromNote(note, extra).catch(e => setNotice(errText(e)))}
      onCreateNote={body => openCreated(store.create({ body }).id, 'text', extra)}
      onSplitLegacy={() => void splitLegacy(note, extra).catch(e => setNotice(errText(e)))}
      saveState={store.saveState[note.id] ?? (store.isLocal(note.id) ? undefined : 'saved')} saveError={store.error}
      recorder={recorder}
      recordError={recorder.error && recTarget.current === note.id ? recorder.error : null}
      uploads={uploads.filter(u => u.item.noteId === note.id)}
      jobs={jobs}
      onChange={patch => store.update(note.id, patch)}
      onArchive={() => toggleArchive(note)}
      onDelete={() => askDelete(note)}
      onStartRecording={() => startRecording(note.id)}
      onStopRecording={recorder.stop}
      onCancelRecording={askCancelRecording}
      onDismissRecordError={recorder.clearError}
      onRenameRecording={renameRec}
      onDeleteRecording={askDeleteRecording}
      onRetryUpload={retryUpload}
      onDownloadUpload={downloadUpload}
      onTranscribe={rec => void runTranscribe(note.id, rec.id)}
      onInsertSummary={rec => insertSummary(note, rec)}
      {...extra} />
  );

  // ── Dữ liệu cho dải ──
  const onRail = store.notes.filter(n => !n.archived_at);
  const railNotes = [...railOrder(onRail.filter(n => !isMindmap(n))), ...railOrder(onRail.filter(isMindmap))];
  const failedUploads = uploads.filter(u => u.state === 'error');
  const attentionIds = new Set(failedUploads.map(u => u.item.noteId));
  const openNote = openId ? store.notes.find(n => n.id === openId) ?? null : null;
  const recordingNoteId = recorder.active ? recorder.noteId : null;

  // Ghi chú đang mở bị xoá / mất (tải lại từ máy khác) → đóng khung
  useEffect(() => {
    if (openId && store.phase === 'ready' && !store.notes.some(n => n.id === openId)) setOpenId(null);
  }, [openId, store.notes, store.phase]);

  const overlays = (
    <>
      {win && (
        <NotesWindow store={store} isMobile={isMobile} initialSelectedId={win.selectedId} initialTab={win.tab}
          recordingNoteId={recordingNoteId} attentionNoteIds={attentionIds} canRecord={!recorder.active && recorder.supported}
          onClose={() => setWin(null)}
          onNew={() => newNote(false)} onNewMeeting={() => newNote(true)} onNewMap={() => newMap()}
          renderEditor={(note, variant, extra) => editorFor(note, variant, { ...extra, autoFocus: !extra.readOnly && !note.body.trim() })} />
      )}
      {confirm && <ConfirmDialog req={confirm} onClose={() => setConfirm(null)} />}
      {notice && (
        <div className="fixed left-4 right-4 md:left-auto md:right-14 bottom-[calc(68px+env(safe-area-inset-bottom))] md:bottom-20 z-[96] text-center bg-[#1D1D1F]/90 backdrop-blur-xl text-white px-4 py-2.5 rounded-[12px] text-[13px] pointer-events-none">
          {notice}
        </div>
      )}
    </>
  );

  // ── Điện thoại: tay nắm mép phải ──
  if (isMobile) {
    const slivers = railNotes.slice(0, 4);
    return (
      <>
        {!win && (
          <button type="button" aria-label="Mở ghi chú nhanh"
            onClick={() => setWin({ selectedId: recordingNoteId, tab: 'all' })}
            className="fixed right-0 top-[38%] z-[48] w-6 py-1 flex flex-col items-end gap-[3px]">
            {recordingNoteId && <span className="w-2 h-7 rounded-l-full bg-[#FF3B30] qn-rec-pulse" />}
            {failedUploads.length > 0 && <span className="w-2 h-3 rounded-l-full bg-[#D70015]" />}
            {(slivers.length ? slivers.map(n => PALETTE[n.color].tab) : ['#C7C7CC']).map((c, i) => (
              <span key={i} className="w-2 h-7 rounded-l-full" style={{ background: c, boxShadow: tabShadow }} />
            ))}
          </button>
        )}
        {overlays}
      </>
    );
  }

  // ── Máy tính: dải thẻ ──
  const expanded = hover || !!openId;
  const avail = Math.max(TAB_MIN * 2, view.h - RAIL_TOP - BUTTONS_SPACE - (recordingNoteId ? 58 : 0));
  const maxTabs = Math.max(1, Math.floor((avail - OVERLAP) / (TAB_MIN - OVERLAP)));
  const overflow = railNotes.length > maxTabs ? railNotes.length - (maxTabs - 1) : 0;
  const shown = overflow ? railNotes.slice(0, maxTabs - 1) : railNotes;
  const slots = shown.length + (overflow ? 1 : 0);
  const tabH = slots ? Math.max(TAB_MIN, Math.min(TAB_MAX, (avail + OVERLAP * (slots - 1)) / slots)) : TAB_MAX;
  const step = tabH - OVERLAP;
  const stackH = slots ? step * (slots - 1) + tabH : TAB_MAX;
  const placeholder = !shown.length;

  const peekNote = peekId && !openId && expanded ? shown.find(n => n.id === peekId) ?? null : null;
  const peekIndex = peekNote ? shown.indexOf(peekNote) : -1;

  const enter = () => {
    if (hoverTimer.current) { clearTimeout(hoverTimer.current); hoverTimer.current = null; }
    setHover(true);
  };
  const leave = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => { setHover(false); setPeekId(null); }, 280);
  };

  const tabStyle = (i: number, bg: string, ink: string, active: boolean): CSSProperties => ({
    top: i * step,
    height: tabH,
    width: TAB_W,
    background: bg,
    color: ink,
    zIndex: 10 + i,
    boxShadow: tabShadow,
    transform: expanded ? `translateX(${active ? -6 : 0}px)` : `translateX(${TAB_HIDDEN}px)`,
  });

  const cardMode: NoteView = openNote && isMindmap(openNote) ? 'mindmap' : 'text';
  const card = cardLayout[cardMode];
  const cardW = Math.max(CARD_MIN.w, Math.min(card.w, view.w - 90));
  const cardH = Math.max(Math.min(CARD_MIN.h, view.h - 24), Math.min(card.h, view.h - 24));
  const cardTop = Math.min(Math.max(anchorY - 12, 12), view.h - cardH - 12);
  const cardStyle: CSSProperties = card.expanded
    ? { right: TAB_W + 12, left: 16, top: 12, bottom: 12 }
    : { right: TAB_W + 12, top: cardTop, width: cardW, height: cardH };

  const toggleCardExpand = () => saveCardLayout({ ...cardLayout, [cardMode]: { ...card, expanded: !card.expanded } });

  // Kéo góc dưới bên trái để đổi cỡ thẻ (thẻ bám mép phải nên kéo sang trái = rộng ra)
  const startResize = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const sx = e.clientX;
    const sy = e.clientY;
    const w0 = cardW;
    const h0 = cardH;
    const top = cardTop;
    let last = { w: w0, h: h0 };
    setResizing(true);
    const move = (ev: PointerEvent) => {
      last = {
        w: Math.round(Math.max(CARD_MIN.w, Math.min(view.w - TAB_W - 40, w0 + (sx - ev.clientX)))),
        h: Math.round(Math.max(CARD_MIN.h, Math.min(view.h - top - 12, h0 + (ev.clientY - sy)))),
      };
      setCardLayout(cl => ({ ...cl, [cardMode]: { ...cl[cardMode], expanded: false, ...last } }));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setResizing(false);
      saveCardLayout({ ...cardLayout, [cardMode]: { ...card, expanded: false, ...last } });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const peekPal = peekNote ? PALETTE[peekNote.color] : null;
  const peekLines = peekNote ? notePreview(peekNote, 5) : [];
  const peekCl = peekNote ? checklistCount(peekNote.body) : null;

  const statusText = store.phase === 'missing' ? (store.error ?? 'Chưa cài Ghi chú nhanh trên cơ sở dữ liệu.')
    : store.phase === 'error' ? `Không tải được ghi chú: ${store.error ?? ''}`
      : store.phase === 'loading' ? 'Đang tải ghi chú…' : null;

  return (
    <>
      <div className="fixed right-0 z-[48] flex flex-col items-end" style={{ top: RAIL_TOP }}
        onMouseEnter={enter} onMouseLeave={leave}>
        {recordingNoteId && (
          <button type="button" onClick={() => openEditor(recordingNoteId, RAIL_TOP)}
            title="Đang ghi âm — bấm để mở ghi chú"
            className={`mb-1.5 rounded-l-[11px] bg-[#FF3B30] text-white flex flex-col items-center justify-center gap-1 transition-transform duration-200 ${expanded ? '' : 'qn-rec-pulse'}`}
            style={{ width: TAB_W, height: 52, boxShadow: tabShadow, transform: expanded ? 'none' : `translateX(${TAB_HIDDEN}px)` }}>
            <span className={`w-2 h-2 rounded-full bg-white ${recorder.phase === 'recording' ? 'qn-rec-pulse' : ''}`} />
            <span className="text-[9.5px] font-semibold tabular-nums">{formatDuration(recorder.elapsedMs / 1000)}</span>
          </button>
        )}

        <div className="relative" style={{ width: TAB_W, height: stackH }}>
          {shown.map((n, i) => {
            const pal = PALETTE[n.color];
            const title = displayTitle(n);
            const map = isMindmap(n);
            return (
              <button key={n.id} type="button" aria-label={`${map ? 'Sơ đồ tư duy' : 'Ghi chú'}: ${title}`}
                onMouseEnter={() => setPeekId(n.id)}
                onFocus={() => { enter(); setPeekId(n.id); }}
                onClick={e => (openId === n.id ? closeEditor() : openEditor(n.id, e.currentTarget.getBoundingClientRect().top))}
                className="absolute right-0 rounded-l-[11px] flex items-center justify-center transition-transform duration-200 ease-out outline-none focus-visible:ring-2 focus-visible:ring-[#0071E3]"
                style={tabStyle(i, pal.tab, pal.ink, openId === n.id)}>
                {map && (
                  <Network size={11} className="absolute top-2 left-1/2 -translate-x-1/2 transition-opacity duration-200" style={{ opacity: expanded ? 0.75 : 0 }} />
                )}
                <span className="qn-vertical text-[10.5px] font-bold uppercase tracking-[0.06em] transition-opacity duration-200"
                  style={{ maxHeight: tabH - (map ? 34 : 16), marginTop: map ? 14 : 0, opacity: expanded ? 0.78 : 0 }}>
                  {title}
                </span>
                {attentionIds.has(n.id) && <span className="absolute top-1.5 left-1.5 w-1.5 h-1.5 rounded-full bg-[#D70015]" />}
              </button>
            );
          })}

          {overflow > 0 && (
            <button type="button" onClick={() => openWindow(null)} title={`Còn ${overflow} ghi chú — mở danh sách`}
              className="absolute right-0 rounded-l-[11px] flex items-center justify-center bg-[#E5E5EA] text-[#3A3A3C] transition-transform duration-200"
              style={tabStyle(shown.length, '#E5E5EA', '#3A3A3C', false)}>
              <span className="qn-vertical text-[10.5px] font-bold transition-opacity" style={{ opacity: expanded ? 0.8 : 0 }}>+{overflow} GHI CHÚ</span>
            </button>
          )}

          {placeholder && (
            <button type="button" onClick={() => store.phase === 'ready' && openNewOnRail('note')} onMouseEnter={() => setPeekId('__status')}
              className="absolute right-0 rounded-l-[11px] flex items-center justify-center transition-transform duration-200"
              style={tabStyle(0, '#E5E5EA', '#6E6E73', false)} aria-label="Ghi chú nhanh">
              <span className="qn-vertical text-[10.5px] font-bold uppercase tracking-[0.06em] transition-opacity" style={{ maxHeight: tabH - 16, opacity: expanded ? 0.8 : 0 }}>
                Ghi chú
              </span>
            </button>
          )}

          {/* Thẻ xem nhanh: trượt ra từ sau dải thẻ */}
          {peekNote && peekPal && (
            <div key={peekNote.id} className="qn-peek absolute cursor-pointer"
              style={{ top: Math.max(0, Math.min(peekIndex * step - 4, stackH - 120)), right: TAB_W - 8, width: 300, zIndex: 5 }}
              onClick={() => openEditor(peekNote.id, RAIL_TOP + peekIndex * step)}>
              <div className="flex rounded-[16px] overflow-hidden shadow-[0_0_0_0.5px_rgba(0,0,0,0.1),0_18px_40px_-14px_rgba(0,0,0,0.4)]"
                style={{ background: peekPal.paper, color: peekPal.ink, minHeight: Math.min(tabH + 8, 150), maxHeight: 220 }}>
                <div className="w-8 shrink-0 flex items-center justify-center py-3" style={{ background: peekPal.strip }}>
                  <span className="qn-vertical max-h-full text-[10.5px] font-bold uppercase tracking-[0.06em] opacity-70">{displayTitle(peekNote)}</span>
                </div>
                <div className="flex-1 min-w-0 pl-3.5 pr-4 py-3 flex flex-col">
                  <div className="flex items-center gap-1.5 min-w-0">
                    {isMindmap(peekNote) && <Network size={13} className="shrink-0 opacity-70" />}
                    <div className="text-[14px] font-semibold truncate">{displayTitle(peekNote)}</div>
                  </div>
                  <div className="h-px bg-black/10 my-2 shrink-0" />
                  {peekLines.length ? (
                    <div className="text-[13px] leading-[1.45] space-y-0.5 overflow-hidden">
                      {peekLines.map((l, i) => <div key={i} className="truncate">{l}</div>)}
                    </div>
                  ) : (
                    <div className="text-[13px] opacity-50">{(isMindmap(peekNote) ? peekNote.mindmap : peekNote.body.trim()) ? '' : 'Chưa có nội dung'}</div>
                  )}
                  <div className="mt-auto pt-2 flex items-center gap-2 text-[11px] opacity-60">
                    <span>{relativeTime(peekNote.updated_at)}</span>
                    {peekCl && peekCl.total > 0 && <span>☑ {peekCl.done}/{peekCl.total}</span>}
                    {peekNote.recordings.length > 0 && <span className="inline-flex items-center gap-0.5"><Mic size={10} /> {peekNote.recordings.length}</span>}
                    {isMindmap(peekNote) && peekNote.mindmap && <span className="inline-flex items-center gap-0.5"><Network size={10} /> {mindmapCount(peekNote.mindmap)} chủ đề</span>}
                  </div>
                </div>
              </div>
            </div>
          )}

          {peekId === '__status' && placeholder && expanded && !openId && (
            <div className="qn-peek absolute" style={{ top: 0, right: TAB_W - 8, width: 280, zIndex: 5 }}>
              <div className="rounded-[16px] bg-white px-4 py-3 text-[13px] text-[#3A3A3C] shadow-[0_0_0_0.5px_rgba(0,0,0,0.1),0_18px_40px_-14px_rgba(0,0,0,0.4)]">
                {statusText ? (
                  <div className="flex items-start gap-2">
                    {store.phase !== 'loading' && <AlertCircle size={14} className="mt-0.5 shrink-0 text-[#D70015]" />}
                    <span className="flex-1">{statusText}</span>
                  </div>
                ) : (
                  <>
                    <div className="font-semibold text-[#1D1D1F]">Ghi chú nhanh</div>
                    <div className="mt-0.5 text-[#6E6E73]">Bấm ＋ để ghi nhanh, ⧉ để vẽ sơ đồ tư duy, 🎙 để ghi âm cuộc họp.</div>
                  </>
                )}
                {store.phase === 'error' && (
                  <button type="button" onClick={() => void store.reload()} className="mt-2 text-[#0071E3] font-semibold">Thử lại</button>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-col items-center gap-1.5 mt-2.5 mr-[1px] transition-opacity duration-200"
          style={{ width: TAB_W, opacity: expanded ? 1 : 0, pointerEvents: expanded ? 'auto' : 'none' }}>
          <RoundBtn title="Ghi chú mới" onClick={() => openNewOnRail('note')} disabled={store.phase === 'missing'}>
            <Plus size={17} />
          </RoundBtn>
          <RoundBtn title="Sơ đồ tư duy mới (kiểu XMind)" onClick={() => openNewOnRail('map')} disabled={store.phase === 'missing'}>
            <Network size={15} className="text-[#2C7BF6]" />
          </RoundBtn>
          <RoundBtn title={recorder.active ? 'Đang ghi âm ở ghi chú khác' : 'Ghi âm cuộc họp (tạo ghi chú mới + bật micro)'}
            onClick={() => openNewOnRail('meeting')} disabled={recorder.active || !recorder.supported || store.phase === 'missing'}>
            <Mic size={15} className="text-[#FF3B30]" />
          </RoundBtn>
          <RoundBtn title="Tất cả ghi chú & sơ đồ" onClick={() => openWindow()} badge={failedUploads.length}>
            <List size={16} />
          </RoundBtn>
        </div>
      </div>

      {openNote && !win && (
        <div className={`fixed z-[49] qn-pop ${resizing ? 'select-none' : ''}`} style={cardStyle}
          onKeyDown={e => { if (e.key === 'Escape' && !confirm) { e.stopPropagation(); closeEditor(); } }}>
          {editorFor(openNote, 'card', {
            onClose: closeEditor,
            onOpenList: () => openWindow(openNote.id, openNote.archived_at ? 'archive' : 'all'),
            autoFocus: true,
            expanded: card.expanded,
            onToggleExpand: toggleCardExpand,
          })}
          {!card.expanded && (
            <div onPointerDown={startResize} title="Kéo để đổi cỡ thẻ" aria-hidden
              className="absolute -left-1 -bottom-1 w-5 h-5 cursor-nesw-resize z-[3] flex items-end justify-start p-[5px] opacity-40 hover:opacity-80">
              <svg width={9} height={9} viewBox="0 0 9 9"><path d="M1 1v7h7M1 4.5L4.5 8" fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" /></svg>
            </div>
          )}
        </div>
      )}

      {overlays}
    </>
  );
}
