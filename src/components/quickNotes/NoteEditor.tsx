// Khung soạn 1 ghi chú (kiểu MFinder): tiêu đề = dòng đầu, checklist ☐, cỡ chữ A / A, ghim, kiểu chữ Aa, tìm trong
// ghi chú, ghi âm, 8 màu, Lưu trữ / Khoá chống xoá / Xoá / Đóng, tự lưu ("Đã lưu"). Mục đang khoá: có ổ khoá cạnh tiêu đề,
// bấm Xoá thì phải nhập mã 4 số (PinDialog).
// 3 kiểu: 'card' = thẻ nổi cạnh dải (máy tính), 'pane' = khung phải của cửa sổ danh sách, 'sheet' = toàn màn (điện thoại).
// 2 loại mục, cố định từ lúc tạo: Ghi chú văn bản / Sơ đồ tư duy kiểu XMind (mindmap/MindMapEditor — tải riêng khi mở).
// Từ ghi chú có thể tạo 1 sơ đồ MỚI (ghi chú giữ nguyên); từ sơ đồ có thể tạo 1 ghi chú MỚI chứa dàn ý.
import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import {
  AlertCircle, Archive, ArchiveRestore, ChevronDown, ChevronLeft, ChevronUp, Flag, List, ListChecks, Loader2, Lock,
  Maximize2, Mic, Minimize2, Network, Pause, Pin, Play, RotateCcw, Search, Square, Trash2, Unlock, X,
} from 'lucide-react';
import { FONT_FAMILY, FONT_LABEL, FONT_SIZES, PALETTE, stepFontSize } from '../../lib/quickNotes/colors';
import {
  continueChecklist, displayTitle, findMatches, formatDuration, isMindmap, relativeTime, toggleChecklist,
} from '../../lib/quickNotes/noteText';
import { NOTE_COLORS, NOTE_FONTS, type QuickNote, type QuickNoteRecording, type SaveState } from '../../lib/quickNotes/types';
import ChecklistOverlay from './ChecklistOverlay';
import TagBar from './TagBar';
import RecordingList, { type UploadItem } from './RecordingList';
import type { TranscribeJob } from './TranscriptPanel';
import type { AudioRecorder } from './useAudioRecorder';

const MindMapEditor = lazy(() => import('./mindmap/MindMapEditor'));

export interface NoteEditorProps {
  note: QuickNote;
  variant: 'card' | 'pane' | 'sheet';
  saveState?: SaveState;
  saveError?: string | null;
  /** Ghi chú trong mục Đã xoá: chỉ xem + Khôi phục */
  readOnly?: boolean;
  autoFocus?: boolean;
  recorder: AudioRecorder;
  recordError?: string | null;
  uploads: UploadItem[];
  /** Lượt Gemini chép lời đang chạy / lỗi, theo mã bản ghi */
  jobs: Record<string, TranscribeJob>;
  onChange: (patch: Partial<QuickNote>) => void;
  onClose?: () => void;
  onBack?: () => void;
  onOpenList?: () => void;
  /** Thẻ / cửa sổ đang phóng to */
  expanded?: boolean;
  onToggleExpand?: () => void;
  /** Ghi chú chữ → tạo 1 sơ đồ tư duy mới từ nội dung */
  onCreateMindmap?: () => void;
  /** Sơ đồ → tạo 1 ghi chú mới chứa dàn ý */
  onCreateNote?: (body: string) => void;
  /** Mục từng đổi qua lại Văn bản ⇄ Sơ đồ (bản thử 01/11) còn giấu phần kia → tách ra mục riêng */
  onSplitLegacy?: () => void;
  onArchive: () => void;
  onDelete: () => void;
  /** Khoá / mở khoá chống xoá (mở khoá cần mã 4 số) */
  onToggleLock?: () => void;
  /** Mục đang khoá và chưa nhập mã: chỉ xem; bấm nút nhập mã để sửa / thêm */
  editLocked?: boolean;
  /** Mọi thẻ đã dùng (gợi ý khi gõ thẻ mới) */
  allTags?: string[];
  onUnlockEdit?: () => void;
  onRestore?: () => void;
  onStartRecording: () => void;
  onStopRecording: () => void;
  onCancelRecording: () => void;
  onDismissRecordError: () => void;
  onRenameRecording: (rec: QuickNoteRecording, title: string) => void;
  onDeleteRecording: (rec: QuickNoteRecording) => void;
  onRetryUpload: (id: string) => void;
  onDownloadUpload: (id: string) => void;
  onTranscribe: (rec: QuickNoteRecording) => void;
  onInsertSummary: (rec: QuickNoteRecording) => void;
}

const BAR_COUNT = 18;

/** Vạch âm lượng tự vẽ (requestAnimationFrame) — không làm cả khung soạn vẽ lại. */
function LevelMeter({ getLevel, paused, color }: { getLevel: () => number; paused: boolean; color: string }) {
  const bars = useRef<(HTMLSpanElement | null)[]>([]);
  useEffect(() => {
    let raf = 0;
    let last = 0;
    const hist = new Array<number>(BAR_COUNT).fill(0);
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      if (t - last < 70) return;
      last = t;
      hist.shift();
      hist.push(paused ? 0 : getLevel());
      hist.forEach((v, i) => {
        const el = bars.current[i];
        if (el) el.style.transform = `scaleY(${0.14 + v * 0.86})`;
      });
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [getLevel, paused]);
  return (
    <div className="flex items-center gap-[2px] h-5" aria-hidden>
      {Array.from({ length: BAR_COUNT }, (_, i) => (
        <span key={i} ref={el => { bars.current[i] = el; }} className="w-[3px] h-full rounded-full"
          style={{ background: color, transform: 'scaleY(0.14)', transition: 'transform 70ms linear' }} />
      ))}
    </div>
  );
}

function ToolBtn({ title, onClick, active, disabled, keepFocus = true, big, children }: {
  title: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  /** Giữ con trỏ trong ô soạn khi bấm (nút checklist / cỡ chữ…) */
  keepFocus?: boolean;
  big?: boolean;
  children: ReactNode;
}) {
  return (
    <button type="button" title={title} aria-label={title} onClick={onClick} disabled={disabled}
      onMouseDown={keepFocus ? e => e.preventDefault() : undefined}
      className={`${big ? 'w-10 h-10' : 'w-7 h-7'} shrink-0 inline-flex items-center justify-center rounded-lg transition disabled:opacity-30 ${active ? 'bg-black/[0.1]' : 'hover:bg-black/[0.06]'}`}>
      {children}
    </button>
  );
}

export default function NoteEditor(props: NoteEditorProps) {
  const { note, variant, saveState, recorder } = props;
  const trash = !!props.readOnly;
  const readOnly = trash || !!props.editLocked;
  const pal = PALETTE[note.color];
  const ta = useRef<HTMLTextAreaElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const findInput = useRef<HTMLInputElement>(null);
  const pendingSel = useRef<[number, number] | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hit, setHit] = useState(0);
  const [scrollbarW, setScrollbarW] = useState(0);

  const title = displayTitle(note);
  const archived = !!note.archived_at;
  const locked = !!note.locked_at;
  const isMap = isMindmap(note);
  const big = variant === 'sheet';
  const recHere = recorder.active && recorder.noteId === note.id;
  const recElsewhere = recorder.active && recorder.noteId !== note.id;
  // Điện thoại: chữ dưới 16px làm Safari iPhone tự phóng to trang khi bấm vào ô soạn → tối thiểu 16px
  const font = { fontSize: big ? Math.max(16, note.font_size) : note.font_size, fontFamily: FONT_FAMILY[note.font], lineHeight: 1.55 };

  const matches = useMemo(() => (findOpen ? findMatches(note.body, q) : []), [findOpen, note.body, q]);

  // Đặt lại con trỏ sau khi đổi chữ bằng code (checklist, Enter, chèn mốc)
  useLayoutEffect(() => {
    if (pendingSel.current && ta.current) {
      const [s, e] = pendingSel.current;
      pendingSel.current = null;
      ta.current.setSelectionRange(s, e);
    }
  });

  useEffect(() => {
    setFindOpen(false);
    setQ('');
    if (props.autoFocus && !readOnly && ta.current) {
      const el = ta.current;
      el.focus({ preventScroll: true });
      el.setSelectionRange(el.value.length, el.value.length);
    }
    // chỉ khi đổi sang ghi chú khác
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.id]);

  useEffect(() => { setHit(0); }, [q]);

  // Lớp tô sáng kết quả tìm phải ngắt dòng y hệt ô soạn → trừ đúng bề rộng thanh cuộn của ô soạn
  useEffect(() => {
    if (!findOpen) return;
    const measure = () => { if (ta.current) setScrollbarW(ta.current.offsetWidth - ta.current.clientWidth); };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [findOpen, note.body.length]);

  useEffect(() => {
    if (!findOpen || !matches.length) return;
    const mark = layer.current?.querySelector<HTMLElement>('mark.qn-current');
    const el = ta.current;
    if (!mark || !el) return;
    const top = mark.offsetTop - el.clientHeight / 3;
    if (mark.offsetTop < el.scrollTop || mark.offsetTop > el.scrollTop + el.clientHeight - 24) el.scrollTop = Math.max(0, top);
    if (layer.current) layer.current.scrollTop = el.scrollTop;
  }, [hit, matches, findOpen]);

  const setBody = (body: string, sel?: [number, number]) => {
    if (sel) pendingSel.current = sel;
    props.onChange({ body });
  };

  // Ô tìm tự nhận focus khi hiện (autoFocus); đang mở sẵn thì chọn lại chữ cũ để gõ đè
  const openFind = () => {
    if (findOpen) findInput.current?.select();
    else setFindOpen(true);
  };

  const go = (dir: 1 | -1) => {
    if (!matches.length) return;
    setHit(h => (h + dir + matches.length) % matches.length);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      openFind();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey && !e.nativeEvent.isComposing) {
      const el = e.currentTarget;
      if (el.selectionStart !== el.selectionEnd) return;
      const r = continueChecklist(el.value, el.selectionStart);
      if (r) {
        e.preventDefault();
        setBody(r.text, [r.pos, r.pos]);
      }
    }
  };

  // Bấm ô tròn: đổi ☐ ⇄ ☑, giữ nguyên chỗ con trỏ đang gõ
  const toggleBox = (pos: number) => {
    if (readOnly) return;
    const v = note.body;
    const ch = v[pos];
    if (ch !== '☐' && ch !== '☑') return;
    const el = ta.current;
    const sel: [number, number] | undefined = el && document.activeElement === el ? [el.selectionStart, el.selectionEnd] : undefined;
    setBody(v.slice(0, pos) + (ch === '☐' ? '☑' : '☐') + v.slice(pos + 1), sel);
  };

  const onChecklist = () => {
    const el = ta.current;
    if (!el) return;
    const r = toggleChecklist(el.value, el.selectionStart, el.selectionEnd);
    el.focus({ preventScroll: true });
    setBody(r.text, [r.selStart, r.selEnd]);
  };

  const insertMark = () => {
    const el = ta.current;
    if (!el) return;
    const at = el.selectionEnd;
    const v = el.value;
    const ins = `${at > 0 && v[at - 1] !== '\n' ? '\n' : ''}⏱ ${formatDuration(recorder.elapsedMs / 1000)} — `;
    el.focus({ preventScroll: true });
    setBody(v.slice(0, at) + ins + v.slice(at), [at + ins.length, at + ins.length]);
  };

  const cycleFont = () => {
    const i = NOTE_FONTS.indexOf(note.font);
    props.onChange({ font: NOTE_FONTS[(i + 1) % NOTE_FONTS.length] });
  };

  const layerContent = useMemo(() => {
    if (!findOpen || !matches.length) return null;
    const len = q.trim().length;
    const parts: ReactNode[] = [];
    let last = 0;
    matches.forEach((m, i) => {
      parts.push(note.body.slice(last, m));
      parts.push(<mark key={i} className={i === hit ? 'qn-current' : ''}>{note.body.slice(m, m + len)}</mark>);
      last = m + len;
    });
    parts.push(`${note.body.slice(last)}\n`);
    return parts;
  }, [findOpen, matches, note.body, q, hit]);

  const saveLabel = saveState === 'saved' ? 'Đã lưu'
    : saveState === 'dirty' || saveState === 'saving' ? 'Đang lưu…'
      : saveState === 'error' ? 'Chưa lưu' : '';

  // Ghi chú chữ: nút tạo 1 sơ đồ tư duy MỚI từ nội dung (thẻ: nằm trên dải tiêu đề trái; khung khác: thanh công cụ)
  const toMapBtn = !readOnly && !isMap && props.onCreateMindmap && (
    <ToolBtn big={big} keepFocus={false} disabled={!note.body.trim()} onClick={props.onCreateMindmap}
      title={note.body.trim() ? 'Tạo sơ đồ tư duy mới từ ghi chú này (ghi chú giữ nguyên)' : 'Viết ghi chú trước rồi tạo sơ đồ tư duy từ nội dung'}>
      <Network size={big ? 18 : 15} />
    </ToolBtn>
  );

  const expandBtn = props.onToggleExpand && (
    <ToolBtn big={big} keepFocus={false} title={props.expanded ? 'Thu nhỏ lại' : 'Phóng to'} onClick={props.onToggleExpand}>
      {props.expanded ? <Minimize2 size={big ? 17 : 15} /> : <Maximize2 size={big ? 17 : 15} />}
    </ToolBtn>
  );

  const tools = !readOnly && (
    <>
      {!isMap && (
        <>
      <ToolBtn big={big} title="Chữ nhỏ hơn" disabled={note.font_size <= FONT_SIZES[0]} onClick={() => props.onChange({ font_size: stepFontSize(note.font_size, -1) })}>
        <span className="text-[11px] font-semibold leading-none">A</span>
      </ToolBtn>
      <ToolBtn big={big} title="Chữ to hơn" disabled={note.font_size >= FONT_SIZES[FONT_SIZES.length - 1]} onClick={() => props.onChange({ font_size: stepFontSize(note.font_size, 1) })}>
        <span className="text-[17px] font-semibold leading-none">A</span>
      </ToolBtn>
      <ToolBtn big={big} title={note.pinned ? 'Bỏ ghim' : 'Ghim lên đầu'} active={note.pinned} onClick={() => props.onChange({ pinned: !note.pinned })}>
        <Pin size={big ? 18 : 15} fill={note.pinned ? 'currentColor' : 'none'} />
      </ToolBtn>
      <ToolBtn big={big} title="Thêm / bỏ ô việc cần làm ☐" onClick={onChecklist}>
        <ListChecks size={big ? 19 : 16} />
      </ToolBtn>
      <ToolBtn big={big} title={`Kiểu chữ: ${FONT_LABEL[note.font]}`} onClick={cycleFont}>
        <span className="text-[14px] font-medium leading-none" style={{ fontFamily: FONT_FAMILY[note.font] }}>Aa</span>
      </ToolBtn>
      <ToolBtn big={big} title="Tìm trong ghi chú (Ctrl/⌘ F)" active={findOpen} keepFocus={false} onClick={() => (findOpen ? setFindOpen(false) : openFind())}>
        <Search size={big ? 18 : 15} />
      </ToolBtn>
      {variant !== 'card' && toMapBtn}
        </>
      )}
      {isMap && (
        <ToolBtn big={big} title={note.pinned ? 'Bỏ ghim' : 'Ghim lên đầu'} active={note.pinned} onClick={() => props.onChange({ pinned: !note.pinned })}>
          <Pin size={big ? 18 : 15} fill={note.pinned ? 'currentColor' : 'none'} />
        </ToolBtn>
      )}
      <ToolBtn big={big} keepFocus={false}
        title={recHere ? 'Đang ghi âm' : recElsewhere ? 'Đang ghi âm ở ghi chú khác' : 'Ghi âm cuộc trò chuyện / cuộc họp'}
        disabled={recElsewhere || !recorder.supported} active={recHere} onClick={() => { if (!recHere) props.onStartRecording(); }}>
        <Mic size={big ? 18 : 15} className={recHere ? 'text-[#FF3B30]' : ''} />
      </ToolBtn>
      {props.onOpenList && (
        <ToolBtn big={big} title={isMap ? 'Tất cả sơ đồ tư duy' : 'Tất cả ghi chú'} keepFocus={false} onClick={props.onOpenList}>
          <List size={big ? 18 : 16} />
        </ToolBtn>
      )}
      {expandBtn}
    </>
  );

  const saveBadge = !readOnly && saveLabel && (
    <span title={saveState === 'error' ? props.saveError ?? '' : undefined}
      className={`shrink-0 text-[12px] ${saveState === 'error' ? 'text-[#D70015] font-medium' : 'opacity-55'}`}>
      {saveLabel}
    </span>
  );

  const main = (
    <div className="flex-1 min-w-0 flex flex-col min-h-0">
      {variant === 'sheet' ? (
        <>
          <div className="flex items-center gap-2 px-2 h-12 shrink-0" style={{ background: pal.header }}>
            <button type="button" onClick={props.onBack} className="inline-flex items-center gap-0.5 h-9 pr-2 rounded-lg text-[15px] font-medium active:opacity-60">
              <ChevronLeft size={22} /> {isMap ? 'Sơ đồ' : 'Ghi chú'}
            </button>
            <span className="flex-1" />
            {locked && <span className="inline-flex items-center gap-1 text-[12px] opacity-60"><Lock size={12} /> Đã khoá</span>}
            {saveBadge}
          </div>
          {tools && <div className="flex items-center justify-between gap-1 px-2 h-11 shrink-0 border-b border-black/[0.06]" style={{ background: pal.header }}>{tools}</div>}
        </>
      ) : (
        <div className="flex items-center gap-1 pl-4 pr-2 h-12 shrink-0 border-b border-black/[0.05]" style={{ background: pal.header }}>
          {locked && <span title="Đang khoá chống xoá" className="shrink-0 mr-1 opacity-60"><Lock size={13} /></span>}
          <div className="flex-1 min-w-0 truncate text-[15px] font-semibold" title={title}>{title}</div>
          {saveBadge}
          <div className="flex items-center gap-0.5 ml-1">{tools || (readOnly && expandBtn)}</div>
        </div>
      )}

      {!readOnly && props.onSplitLegacy && (isMap ? !!note.body.trim() : !!note.mindmap) && (
        <div className="flex items-center gap-2 px-3 py-1.5 shrink-0 bg-black/[0.045] text-[12.5px] border-b border-black/[0.05]">
          <AlertCircle size={13} className="shrink-0 opacity-70" />
          <span className="flex-1 min-w-0">
            {isMap ? 'Sơ đồ này còn kèm phần chữ ghi chú cũ (đang bị ẩn).' : 'Ghi chú này còn kèm 1 sơ đồ tư duy cũ (đang bị ẩn).'}
          </span>
          <button type="button" onClick={props.onSplitLegacy}
            className="shrink-0 h-7 px-2.5 rounded-full bg-white/70 hover:bg-white font-semibold shadow-[0_0_0_0.5px_rgba(0,0,0,0.1)]">
            {isMap ? 'Tách ra ghi chú riêng' : 'Tách ra sơ đồ riêng'}
          </button>
        </div>
      )}

      <TagBar tags={note.tags} suggestions={props.allTags ?? []} editable={!readOnly} onChange={tags => props.onChange({ tags })} />

      {findOpen && !isMap && (
        <div className="flex items-center gap-1.5 px-3 py-1.5 shrink-0 border-b border-black/[0.06] bg-white/45">
          <Search size={14} className="opacity-60 shrink-0" />
          <input ref={findInput} autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Tìm trong ghi chú"
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); go(e.shiftKey ? -1 : 1); }
              if (e.key === 'Escape') { e.stopPropagation(); setFindOpen(false); }
            }}
            className="flex-1 min-w-0 bg-transparent outline-none text-[16px] md:text-[13px] placeholder:opacity-50" />
          <span className="text-[12px] tabular-nums opacity-60 shrink-0">{q.trim() ? (matches.length ? `${hit + 1}/${matches.length}` : '0 kết quả') : ''}</span>
          <ToolBtn title="Kết quả trước (Shift Enter)" keepFocus={false} disabled={!matches.length} onClick={() => go(-1)}><ChevronUp size={15} /></ToolBtn>
          <ToolBtn title="Kết quả sau (Enter)" keepFocus={false} disabled={!matches.length} onClick={() => go(1)}><ChevronDown size={15} /></ToolBtn>
          <ToolBtn title="Đóng tìm kiếm" keepFocus={false} onClick={() => setFindOpen(false)}><X size={15} /></ToolBtn>
        </div>
      )}

      {recHere && (
        <div className="flex items-center gap-2 px-3 py-2 shrink-0 border-b border-black/[0.06] bg-white/55">
          {recorder.phase === 'starting' || recorder.phase === 'stopping' ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              <span className="text-[13px] font-medium">{recorder.phase === 'starting' ? 'Đang bật micro…' : 'Đang lưu bản ghi…'}</span>
            </>
          ) : (
            <>
              <span className={`w-2.5 h-2.5 rounded-full bg-[#FF3B30] shrink-0 ${recorder.phase === 'recording' ? 'qn-rec-pulse' : 'opacity-40'}`} />
              <span className="text-[13px] font-semibold tabular-nums shrink-0">{formatDuration(recorder.elapsedMs / 1000)}</span>
              <div className="min-w-0 overflow-hidden hidden sm:block">
                <LevelMeter getLevel={recorder.getLevel} paused={recorder.phase === 'paused'} color={pal.ink} />
              </div>
              <span className="flex-1" />
              <button type="button" onMouseDown={e => e.preventDefault()} onClick={insertMark} title="Chèn mốc thời gian của bản ghi vào ghi chú"
                className="shrink-0 inline-flex items-center gap-1 h-7 px-2 rounded-full bg-black/[0.06] hover:bg-black/[0.1] text-[12px] font-medium">
                <Flag size={12} /> Mốc
              </button>
              {recorder.phase === 'paused' ? (
                <ToolBtn title="Ghi tiếp" onClick={recorder.resume}><Play size={14} fill="currentColor" /></ToolBtn>
              ) : (
                <ToolBtn title="Tạm dừng" onClick={recorder.pause}><Pause size={14} fill="currentColor" /></ToolBtn>
              )}
              <button type="button" onClick={props.onStopRecording} title="Dừng và lưu bản ghi"
                className="shrink-0 inline-flex items-center gap-1 h-7 px-2.5 rounded-full bg-[#FF3B30] text-white text-[12px] font-semibold hover:bg-[#E5352B] active:scale-95 transition">
                <Square size={10} fill="currentColor" /> Dừng
              </button>
              <ToolBtn title="Huỷ bản ghi" onClick={props.onCancelRecording}><X size={15} /></ToolBtn>
            </>
          )}
        </div>
      )}

      {props.recordError && (
        <div className="flex items-start gap-2 px-3 py-2 shrink-0 bg-[#FF3B30]/10 text-[#B0000F] text-[12.5px]">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <span className="flex-1">{props.recordError}</span>
          <button type="button" onClick={props.onDismissRecordError} aria-label="Đóng" className="shrink-0 opacity-70 hover:opacity-100"><X size={14} /></button>
        </div>
      )}

      {isMap ? (
        <div className="relative flex-1 min-h-[200px] flex flex-col">
          <Suspense fallback={<div className="flex-1 flex items-center justify-center opacity-60"><Loader2 size={20} className="animate-spin" /></div>}>
            <MindMapEditor key={note.id} noteId={note.id} doc={note.mindmap} seedText={note.body} palette={pal} title={title}
              readOnly={readOnly} mobile={variant === 'sheet'}
              saveError={saveState === 'error' ? props.saveError ?? 'lỗi không rõ' : null}
              onChange={doc => props.onChange({ mindmap: doc })}
              onCreateNote={props.onCreateNote} />
          </Suspense>
        </div>
      ) : (
      <div className="relative flex-1 min-h-[120px]">
        {layerContent && (
          <div ref={layer} aria-hidden
            className="qn-find-layer absolute inset-0 overflow-hidden whitespace-pre-wrap break-words px-4 py-3 pointer-events-none"
            style={{ ...font, color: 'transparent', paddingRight: 16 + scrollbarW }}>
            {layerContent}
          </div>
        )}
        <textarea ref={ta} value={note.body} readOnly={readOnly}
          onChange={e => setBody(e.target.value)} onKeyDown={onKeyDown}
          onScroll={e => { if (layer.current) layer.current.scrollTop = e.currentTarget.scrollTop; }}
          placeholder={'Ghi nhanh cuộc trò chuyện, việc cần làm…\nDòng đầu là tiêu đề · bấm ☐ trên thanh công cụ để thêm việc'}
          spellCheck
          className="relative block w-full h-full resize-none bg-transparent outline-none px-4 py-3 whitespace-pre-wrap break-words placeholder:opacity-45"
          style={{ ...font, color: pal.ink }} />
        <ChecklistOverlay text={note.body} font={font} ta={ta} ink={pal.ink} paper={pal.paper} accent={pal.dot}
          readOnly={readOnly} onToggle={toggleBox} />
      </div>
      )}

      {(note.recordings.length > 0 || props.uploads.length > 0) && (
        <div className={`shrink-0 ${isMap ? 'max-h-[26%]' : 'max-h-[50%]'} overflow-y-auto px-3 pt-2 pb-2 border-t border-black/[0.06]`}>
          <div className="text-[11px] font-semibold uppercase tracking-wide opacity-55 mb-1.5">
            Ghi âm ({note.recordings.length + props.uploads.length})
          </div>
          <RecordingList recordings={note.recordings} uploads={props.uploads} jobs={props.jobs} ink={pal.ink} readOnly={readOnly}
            onRename={props.onRenameRecording} onDelete={props.onDeleteRecording}
            onRetry={props.onRetryUpload} onDownload={props.onDownloadUpload}
            onTranscribe={props.onTranscribe} onInsertSummary={props.onInsertSummary} />
        </div>
      )}

      <div className={`flex items-center gap-1.5 px-3 shrink-0 ${big ? 'h-14 pb-[env(safe-area-inset-bottom)]' : 'h-12'}`}>
        {trash ? (
          <>
            <span className="text-[12px] opacity-60">Đã xoá {note.deleted_at ? relativeTime(note.deleted_at) : ''}</span>
            <span className="flex-1" />
            {props.onRestore && (
              <button type="button" onClick={props.onRestore}
                className="inline-flex items-center gap-1 h-8 px-3 rounded-full bg-black/[0.07] hover:bg-black/[0.12] text-[13px] font-medium">
                <RotateCcw size={13} /> Khôi phục
              </button>
            )}
          </>
        ) : (
          <>
            {props.editLocked ? (
              <button type="button" onClick={props.onUnlockEdit}
                className="shrink-0 inline-flex items-center gap-1.5 h-8 px-3 rounded-full bg-[#0071E3] text-white text-[13px] font-semibold hover:bg-[#0077ED] active:scale-[0.97] transition">
                <Lock size={13} /> Nhập mã để chỉnh sửa
              </button>
            ) : (
            <div className="flex items-center gap-1.5 md:gap-2 min-w-0">
              {NOTE_COLORS.map(c => (
                <button key={c} type="button" title={PALETTE[c].label} aria-label={`Màu ${PALETTE[c].label}`}
                  onMouseDown={e => e.preventDefault()} onClick={() => props.onChange({ color: c })}
                  className={`w-[18px] h-[18px] shrink-0 rounded-full transition ${note.color === c ? 'ring-2 ring-offset-2' : 'hover:scale-110'}`}
                  style={{ background: PALETTE[c].dot, ['--tw-ring-color' as string]: PALETTE[c].dot, ['--tw-ring-offset-color' as string]: pal.paper }} />
              ))}
            </div>
            )}
            <span className="flex-1" />
            {!props.editLocked && <button type="button" onClick={props.onArchive} title={archived ? 'Đưa lại lên dải ghi chú' : 'Cất khỏi dải ghi chú (xem lại ở mục Lưu trữ)'}
              className="shrink-0 inline-flex items-center gap-1 h-8 px-2 rounded-lg text-[13px] font-medium hover:bg-black/[0.06]">
              {archived ? <ArchiveRestore size={14} /> : <Archive size={14} className="md:hidden" />}
              <span className={archived ? '' : 'hidden md:inline'}>{archived ? 'Bỏ lưu trữ' : 'Lưu trữ'}</span>
            </button>}
            {props.onToggleLock && (
              <button type="button" onClick={props.onToggleLock} aria-label={locked ? 'Mở khoá chống xoá' : 'Khoá chống xoá'}
                title={locked ? 'Đang khoá — bấm để mở khoá hẳn (cần mã 4 số)' : 'Khoá: muốn sửa / thêm / xoá phải nhập mã 4 số'}
                className={`shrink-0 w-8 h-8 inline-flex items-center justify-center rounded-lg ${locked ? 'bg-black/[0.08]' : 'hover:bg-black/[0.06]'}`}>
                {locked ? <Lock size={15} /> : <Unlock size={15} className="opacity-70" />}
              </button>
            )}
            <button type="button" onClick={props.onDelete} aria-label={isMap ? 'Xoá sơ đồ tư duy' : 'Xoá ghi chú'}
              title={locked ? 'Đang khoá chống xoá — cần nhập mã 4 số để xoá' : isMap ? 'Xoá sơ đồ tư duy' : 'Xoá ghi chú'}
              disabled={recHere}
              className="shrink-0 w-8 h-8 inline-flex items-center justify-center rounded-lg hover:bg-[#FF3B30]/10 hover:text-[#D70015] disabled:opacity-30">
              <Trash2 size={15} />
            </button>
            {variant === 'card' && props.onClose && (
              <button type="button" onClick={props.onClose} className="shrink-0 h-8 px-2 rounded-lg text-[13px] font-semibold hover:bg-black/[0.06]">Đóng</button>
            )}
          </>
        )}
      </div>
    </div>
  );

  if (variant === 'card') {
    return (
      <div className="flex h-full rounded-[18px] overflow-hidden shadow-[0_0_0_0.5px_rgba(0,0,0,0.1),0_24px_60px_-16px_rgba(0,0,0,0.38)]"
        style={{ background: pal.paper, color: pal.ink }}>
        <div className="w-9 shrink-0 flex flex-col items-center gap-3 pt-2.5 pb-4" style={{ background: pal.strip }}>
          {isMap ? (
            <span title="Sơ đồ tư duy" className="w-7 h-7 shrink-0 rounded-lg flex items-center justify-center bg-white/55"><Network size={15} /></span>
          ) : toMapBtn}
          <div className="flex-1 min-h-0 flex items-center justify-center">
            <span className="qn-vertical max-h-full text-[11px] font-bold uppercase tracking-[0.08em] opacity-70">{title}</span>
          </div>
          {locked && <span title="Đang khoá chống xoá" className="shrink-0 opacity-70"><Lock size={13} /></span>}
        </div>
        {main}
      </div>
    );
  }
  return <div className="flex h-full" style={{ background: pal.paper, color: pal.ink }}>{main}</div>;
}
