// Pháp lý — khung ĐỌC 1 tài liệu: link Drive / web (xem ngay trong app), sơ đồ tư duy, bài học trực quan, thẻ ghi nhớ.
// Chế độ Tập trung = phủ kín cửa sổ (ẩn menu app, cây chủ đề…), Toàn màn hình = Fullscreen của trình duyệt.
// Ghi chú khi đọc (cột phải) lưu vào legal_docs.summary; nội dung tự soạn tự lưu vào legal_docs.content.
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, Check, ChevronLeft, Expand, ExternalLink, Focus, Layers, Loader2, NotebookPen, Pencil, Pin, PinOff, Shrink, Trash2,
} from 'lucide-react';
import type { NotePalette } from '../../lib/quickNotes/colors';
import { defaultDoc } from '../../lib/quickNotes/mindmap/model';
import { parseDoc } from '../../lib/quickNotes/mindmap/parse';
import type { MindMapDoc } from '../../lib/quickNotes/mindmap/types';
import { archive, loadDocContent, saveDoc, saveDocContent } from '../../lib/legal/api';
import { cardsFromLesson, cardsFromMindmap, parseCards, type CardsDoc } from '../../lib/legal/cards';
import { parseDocLink } from '../../lib/legal/drive';
import { parseLesson, type LessonDoc } from '../../lib/legal/lesson';
import { fmtDate } from '../../lib/legal/timeline';
import { categoryOf, LAW_STATUS, type LegalDoc } from '../../lib/legal/types';
import { BTN_SECONDARY } from '../workspace/wsTheme';
import CardsView from './CardsView';
import { EmbedFrame, GoogleAccessHint, sourceLabel } from './Embed';
import LessonEditor from './LessonEditor';
import { Confirm, DocKindIcon, ColorTile, docColor, docTypeLabel, fmtWhen, MoreMenu, Pill } from './ui';
import { useAutosave, type SaveState } from './useAutosave';
import type { LegalStore } from './useLegal';

const MindMapEditor = lazy(() => import('../quickNotes/mindmap/MindMapEditor'));

const PAPER: NotePalette = { label: 'Trắng', dot: '#8E8E93', tab: '#D0D0D5', paper: '#FFFFFF', header: '#F5F5F7', strip: '#E5E5EA', ink: '#1D1D1F' };
const NOTES_KEY = 'legal-reader-notes';

type Content = { kind: 'mindmap'; v: MindMapDoc } | { kind: 'lesson'; v: LessonDoc } | { kind: 'cards'; v: CardsDoc };

export function SaveBadge({ state, onRetry }: { state: SaveState; onRetry: () => void }) {
  if (state.s === 'saving') return <span className="text-[11.5px] text-[#86868B] inline-flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> Đang lưu…</span>;
  if (state.s === 'error') return <button type="button" onClick={onRetry} title={state.msg} className="text-[11.5px] text-[#D70015] inline-flex items-center gap-1 hover:underline"><AlertTriangle size={12} /> Chưa lưu — thử lại</button>;
  if (state.s === 'saved') return <span className="text-[11.5px] text-[#86868B] inline-flex items-center gap-1"><Check size={12} className="text-[#34C759]" /> Đã lưu {fmtWhen(state.at)}</span>;
  return null;
}

export default function DocReader({ doc, store, canEdit, userName, toast, mobile, onClose, onEdit, onOpenDoc }: {
  doc: LegalDoc; store: LegalStore; canEdit: boolean; userName: string; toast: (m: string) => void; mobile: boolean;
  onClose: () => void; onEdit: () => void; onOpenDoc: (id: string) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [focus, setFocus] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const selfMade = doc.kind === 'mindmap' || doc.kind === 'lesson' || doc.kind === 'cards';
  const [notesOpen, setNotesOpen] = useState(() => {
    if (mobile || selfMade) return false;
    try { return localStorage.getItem(NOTES_KEY) !== '0'; } catch { return true; }
  });
  const [summary, setSummary] = useState(doc.summary);
  const [pageText, setPageText] = useState(doc.meta.bookmark?.page ? String(doc.meta.bookmark.page) : '');
  const [partNote, setPartNote] = useState(doc.meta.bookmark?.note ?? '');
  const startPage = useRef(doc.meta.bookmark?.page).current;
  const [content, setContent] = useState<Content | null>(null);
  const [loadErr, setLoadErr] = useState('');

  // ── nội dung tự soạn ──
  useEffect(() => {
    if (!selfMade) return;
    let alive = true;
    setContent(null);
    setLoadErr('');
    loadDocContent(doc.id).then(raw => {
      if (!alive) return;
      if (doc.kind === 'mindmap') setContent({ kind: 'mindmap', v: parseDoc(raw) ?? defaultDoc(doc.title || 'Chủ đề trung tâm') });
      else if (doc.kind === 'lesson') setContent({ kind: 'lesson', v: parseLesson(raw) });
      else setContent({ kind: 'cards', v: parseCards(raw) });
    }).catch(e => { if (alive) setLoadErr((e as Error).message); });
    return () => { alive = false; };
  }, [doc.id, doc.kind, doc.title, selfMade]);

  const contentSave = useAutosave<unknown>(useCallback(v => saveDocContent(doc.id, v, userName), [doc.id, userName]));
  const notesSave = useAutosave<string>(useCallback(async v => {
    const saved = await saveDoc({ id: doc.id, summary: v }, userName);
    store.putDoc(saved);
    return saved.updated_at;
  }, [doc.id, userName, store]));

  const bookmarkSave = useAutosave<{ page: string; note: string }>(useCallback(async v => {
    const page = Number(v.page);
    const bookmark = { ...(page > 0 ? { page: Math.round(page) } : {}), ...(v.note.trim() ? { note: v.note.trim() } : {}) };
    const saved = await saveDoc({ id: doc.id, meta: { ...doc.meta, bookmark: Object.keys(bookmark).length ? bookmark : undefined } }, userName);
    store.putDoc(saved);
    return saved.updated_at;
  }, [doc.id, doc.meta, userName, store]), 600);
  const changeBookmark = (page: string, note: string) => {
    setPageText(page); setPartNote(note);
    if (canEdit) bookmarkSave.queue({ page, note });
  };
  const link = (doc.kind === 'drive' || doc.kind === 'link') && doc.url ? parseDocLink(doc.url) : null;
  const [askPage, setAskPage] = useState(false);
  const [resumeDismissed, setResumeDismissed] = useState(false);
  const isPdfLike = !!link && (link.source === 'drive' || link.source === 'pdf');

  const changeContent = (c: Content) => { setContent(c); contentSave.queue(c.v); };

  // ── tập trung / toàn màn hình ──
  useEffect(() => {
    const onFs = () => setFullscreen(!!document.fullscreenElement && document.fullscreenElement === rootRef.current);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);
  const canFullscreen = typeof document !== 'undefined' && !!document.fullscreenEnabled;
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void rootRef.current?.requestFullscreen?.().catch(() => setFocus(true));
  };
  useEffect(() => {
    if (!focus) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.fullscreenElement) setFocus(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focus]);

  const toggleNotes = () => setNotesOpen(o => {
    try { localStorage.setItem(NOTES_KEY, o ? '0' : '1'); } catch { /* bỏ qua */ }
    return !o;
  });

  // ── vị trí tài liệu (breadcrumb) ──
  const where = useMemo(() => {
    const parts: string[] = [];
    if (doc.topic_id) {
      const t = store.topics.find(x => x.id === doc.topic_id);
      const p = t?.parent_id ? store.topics.find(x => x.id === t.parent_id) : null;
      if (p) parts.push(p.title);
      if (t) parts.push(t.title);
    }
    if (doc.entity_id) {
      const e = store.entities.find(x => x.id === doc.entity_id);
      if (e) parts.push(e.short_name || e.name);
      if (doc.category) parts.push(categoryOf(doc.category).label);
    }
    return parts.join(' › ');
  }, [doc, store.topics, store.entities]);

  const color = docColor(doc);

  const makeCards = async () => {
    if (!content || content.kind === 'cards') return;
    const cards = content.kind === 'mindmap' ? cardsFromMindmap(content.v) : cardsFromLesson(content.v, doc.title);
    if (!cards.length) { toast(content.kind === 'mindmap' ? 'Sơ đồ chưa có nhánh con để làm thẻ' : 'Bài học chưa có khối màu / các bước để làm thẻ'); return; }
    try {
      await contentSave.flush();
      const created = await saveDoc({
        kind: 'cards', title: `Thẻ ghi nhớ – ${doc.title}`, topic_id: doc.topic_id, entity_id: doc.entity_id, category: doc.category,
        content: { v: 1, cards }, color: '#34C759',
      }, userName);
      store.putDoc(created);
      toast(`Đã tạo ${cards.length} thẻ ghi nhớ`);
      onOpenDoc(created.id);
    } catch (e) { toast((e as Error).message); }
  };

  const togglePin = async () => {
    try { store.putDoc(await saveDoc({ id: doc.id, pinned: !doc.pinned }, userName)); }
    catch (e) { toast((e as Error).message); }
  };

  const remove = async () => {
    await archive('legal_docs', [doc.id], userName);
    store.drop('doc', [doc.id]);
    toast('Đã chuyển tài liệu vào Thùng rác');
    onClose();
  };

  const meta = doc.meta;
  const status = meta.status ? LAW_STATUS[meta.status] : null;
  const covering = focus || fullscreen;

  const cardsButton = canEdit && content && content.kind !== 'cards' && (
    <button type="button" onClick={makeCards} className={`${BTN_SECONDARY} h-8 px-3 text-[12.5px]`} title="Tạo bộ thẻ hỏi – đáp từ nội dung này">
      <Layers size={13} /> <span className="hidden sm:inline">Tạo thẻ ghi nhớ</span>
    </button>
  );

  return (
    <div ref={rootRef}
      className={`${covering ? 'fixed inset-0 z-[70]' : mobile ? 'fixed inset-0 z-[70]' : 'absolute inset-0 z-30'} flex flex-col bg-[#F5F5F7] animate-fade-in`}
      style={mobile ? { paddingTop: 'env(safe-area-inset-top)' } : undefined}>
      {/* ── thanh tiêu đề ── */}
      <header className="shrink-0 flex items-center gap-2 md:gap-3 px-2 md:px-4 h-[58px] bg-white/90 backdrop-blur-xl border-b border-black/[0.06]">
        <button type="button" onClick={() => {
          if (isPdfLike && canEdit) { setAskPage(true); return; }
          if (document.fullscreenElement) void document.exitFullscreen();
          onClose();
        }}
          className="inline-flex items-center h-9 pl-1 pr-2.5 rounded-full text-[#0071E3] text-[14px] font-medium hover:bg-[#0071E3]/[0.08]">
          <ChevronLeft size={22} /> <span className="hidden md:inline">Quay lại</span>
        </button>
        <ColorTile color={color} size={34} radius={9}><DocKindIcon kind={doc.kind} fileType={doc.file_type} size={17} /></ColorTile>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <h2 className="text-[14.5px] md:text-[15.5px] font-semibold text-[#1D1D1F] truncate tracking-[-0.01em]">{doc.title || 'Tài liệu'}</h2>
            {doc.pinned && <Pin size={12} className="shrink-0 text-[#FF9500] fill-[#FF9500]" />}
          </div>
          <div className="flex items-center gap-1.5 text-[11.5px] text-[#86868B] min-w-0">
            <span className="shrink-0">{link ? sourceLabel(link.source) : docTypeLabel(doc)}</span>
            {where && <span className="truncate">· {where}</span>}
            {meta.number && <span className="hidden md:inline shrink-0">· {meta.number}</span>}
            {status && <Pill tint={status.tint} className="hidden md:inline-flex !h-[18px] !text-[10.5px]">{status.label}</Pill>}
            {selfMade && <span className="hidden md:inline shrink-0 ml-1"><SaveBadge state={contentSave.state} onRetry={() => void contentSave.flush()} /></span>}
          </div>
        </div>
        <div className="flex items-center gap-1 md:gap-1.5 shrink-0">
          {isPdfLike && (
            <label className="hidden sm:flex items-center gap-1.5 h-8 pl-3 pr-1.5 rounded-full bg-[#FFF4D6] text-[12.5px] font-medium text-[#7A5600]" title="Gõ số trang đang học — lần sau mở lại tự nhảy tới trang này">
              Trang đang học
              <input value={pageText} onChange={e => changeBookmark(e.target.value.replace(/\D/g, '').slice(0, 5), partNote)} readOnly={!canEdit} inputMode="numeric" placeholder="—"
                className="w-12 h-6 rounded-full bg-white text-center text-[13px] font-semibold tabular-nums outline-none focus:ring-2 focus:ring-[#FFCC00]" />
            </label>
          )}
          {link && (
            <a href={link.openUrl} target="_blank" rel="noreferrer" className={`${BTN_SECONDARY} h-8 px-3 text-[12.5px]`} title="Mở trong tab mới (sửa trực tiếp trên Google)">
              <ExternalLink size={13} /> <span className="hidden sm:inline">{link.google ? 'Mở Drive' : 'Mở trang'}</span>
            </a>
          )}
          {!mobile && (
            <button type="button" onClick={toggleNotes} className={`h-8 px-3 rounded-full text-[12.5px] font-medium inline-flex items-center gap-1.5 transition ${notesOpen ? 'bg-[#0071E3]/10 text-[#0066CC]' : 'bg-black/[0.05] text-[#1D1D1F] hover:bg-black/[0.08]'}`} title="Ghi chú khi đọc">
              <NotebookPen size={13} /> <span className="hidden lg:inline">Ghi chú</span>
            </button>
          )}
          {!mobile && (
            <button type="button" onClick={() => setFocus(f => !f)} title={focus ? 'Thoát tập trung (Esc)' : 'Tập trung: phủ kín cửa sổ'}
              className={`w-8 h-8 rounded-full inline-flex items-center justify-center transition ${focus ? 'bg-[#0071E3] text-white' : 'bg-black/[0.05] text-[#1D1D1F] hover:bg-black/[0.08]'}`}>
              <Focus size={15} />
            </button>
          )}
          {canFullscreen && (
            <button type="button" onClick={toggleFullscreen} title={fullscreen ? 'Thoát toàn màn hình' : 'Toàn màn hình'}
              className="w-8 h-8 rounded-full inline-flex items-center justify-center bg-black/[0.05] text-[#1D1D1F] hover:bg-black/[0.08]">
              {fullscreen ? <Shrink size={15} /> : <Expand size={15} />}
            </button>
          )}
          <MoreMenu items={[
            canEdit && { label: 'Sửa thông tin', icon: <Pencil size={14} />, onClick: onEdit },
            canEdit && { label: doc.pinned ? 'Bỏ ghim' : 'Ghim lên đầu', icon: doc.pinned ? <PinOff size={14} /> : <Pin size={14} />, onClick: () => void togglePin() },
            mobile && { label: notesOpen ? 'Ẩn ghi chú' : 'Ghi chú khi đọc', icon: <NotebookPen size={14} />, onClick: toggleNotes },
            canEdit && { label: 'Xoá (vào Thùng rác)', icon: <Trash2 size={14} />, danger: true, onClick: () => setConfirmDel(true) },
          ]} />
        </div>
      </header>

      {/* ── nội dung ── */}
      <div className="flex-1 min-h-0 flex">
        <div className="flex-1 min-w-0 flex flex-col relative">
          {link && (
            <div className="flex-1 min-h-0 flex flex-col p-2 md:p-4 gap-2">
              {isPdfLike && !resumeDismissed && (startPage || doc.meta.bookmark?.note) && (
                <div className="shrink-0 flex items-center gap-2 px-3 py-2 rounded-[12px] bg-[#FFF4D6] text-[13px] text-[#7A5600]">
                  <span className="flex-1 min-w-0">Lần trước bạn dừng ở <b>{startPage ? `trang ${startPage}` : 'đoạn đã ghi'}</b>{doc.meta.bookmark?.note ? <> · {doc.meta.bookmark.note}</> : null}. Nếu file chưa tự nhảy tới đó, gõ số trang vào ô trang của trình xem.</span>
                  <button type="button" onClick={() => setResumeDismissed(true)} className="shrink-0 font-medium text-[#B25000] hover:underline">Đã hiểu</button>
                </div>
              )}
              <EmbedFrame url={doc.url} title={doc.title} startPage={startPage} className="flex-1 min-h-0 shadow-[0_0_0_0.5px_rgba(0,0,0,0.08),0_10px_30px_-18px_rgba(0,0,0,0.3)]" />
              <GoogleAccessHint url={doc.url} />
            </div>
          )}
          {(doc.kind === 'drive' || doc.kind === 'link') && !doc.url && (
            <div className="flex-1 flex items-center justify-center text-[13px] text-[#86868B]">Tài liệu chưa có link.{canEdit ? ' Bấm ⋯ → Sửa thông tin để thêm.' : ''}</div>
          )}
          {selfMade && !content && !loadErr && <div className="flex-1 flex items-center justify-center text-[#86868B]"><Loader2 size={20} className="animate-spin" /></div>}
          {loadErr && <div className="flex-1 flex items-center justify-center text-[13px] text-[#D70015] p-6 text-center">Không tải được nội dung: {loadErr}</div>}
          {content?.kind === 'mindmap' && (
            <div className="flex-1 min-h-0 flex flex-col relative bg-white">
              <div className="shrink-0 flex items-center gap-2 px-3 md:px-4 h-11 border-b border-black/[0.05]">
                <span className="text-[11.5px] text-[#86868B] hidden md:inline">Bấm đúp để sửa · Tab = nhánh con · Enter = cùng cấp · chuột phải = màu, biểu tượng, ghi chú</span>
                <span className="md:hidden"><SaveBadge state={contentSave.state} onRetry={() => void contentSave.flush()} /></span>
                <div className="ml-auto">{cardsButton}</div>
              </div>
              <div className="flex-1 min-h-0 flex flex-col relative">
                <Suspense fallback={<div className="flex-1 flex items-center justify-center text-[#86868B]"><Loader2 size={18} className="animate-spin" /></div>}>
                  <MindMapEditor
                    key={doc.id}
                    noteId={`legal:${doc.id}`}
                    doc={content.v}
                    seedText=""
                    palette={PAPER}
                    title={doc.title}
                    readOnly={!canEdit}
                    mobile={mobile}
                    saveError={contentSave.state.s === 'error' ? contentSave.state.msg : null}
                    onChange={v => changeContent({ kind: 'mindmap', v })}
                  />
                </Suspense>
              </div>
            </div>
          )}
          {content?.kind === 'lesson' && (
            <LessonEditor value={content.v} onChange={v => changeContent({ kind: 'lesson', v })} canEdit={canEdit} title={doc.title} toast={toast}
              toolbarExtra={<>{mobile && <SaveBadge state={contentSave.state} onRetry={() => void contentSave.flush()} />}{cardsButton}</>} />
          )}
          {content?.kind === 'cards' && (
            <CardsView docId={doc.id} value={content.v} onChange={v => changeContent({ kind: 'cards', v })} canEdit={canEdit}
              toolbarExtra={mobile ? <SaveBadge state={contentSave.state} onRetry={() => void contentSave.flush()} /> : undefined} />
          )}
        </div>

        {/* ── ghi chú khi đọc ── */}
        {notesOpen && (
          <aside className={`${mobile ? 'fixed inset-x-0 bottom-0 z-[75] max-h-[60dvh] rounded-t-[22px] shadow-[0_-12px_40px_rgba(0,0,0,0.2)]' : 'w-[320px] xl:w-[360px] border-l border-black/[0.06]'} shrink-0 bg-white flex flex-col`}>
            <div className="flex items-center gap-2 px-4 pt-3.5 pb-2">
              <NotebookPen size={14} className="text-[#86868B]" />
              <span className="text-[13.5px] font-semibold text-[#1D1D1F] flex-1">Ghi chú khi đọc</span>
              <SaveBadge state={notesSave.state} onRetry={() => void notesSave.flush()} />
              {mobile && <button type="button" onClick={toggleNotes} className="text-[13px] text-[#0071E3] font-medium ml-2">Xong</button>}
            </div>
            <div className="px-4 pb-3 flex-1 min-h-0 flex flex-col gap-3 overflow-y-auto">
              {isPdfLike && (
                <div className="rounded-[12px] bg-[#FFF4D6] p-3 space-y-2">
                  <div className="flex items-center gap-2 text-[12.5px] font-semibold text-[#7A5600]">Đang học dở <SaveBadge state={bookmarkSave.state} onRetry={() => void bookmarkSave.flush()} /></div>
                  <div className="flex gap-2">
                    <input value={pageText} onChange={e => changeBookmark(e.target.value.replace(/\D/g, '').slice(0, 5), partNote)} readOnly={!canEdit} inputMode="numeric" placeholder="Trang" className="w-16 h-8 rounded-[8px] bg-white px-2 text-center text-[13px] font-semibold outline-none" />
                    <input value={partNote} onChange={e => changeBookmark(pageText, e.target.value)} readOnly={!canEdit} placeholder="Đoạn: vd Điều 54, khoản 2" className="flex-1 min-w-0 h-8 rounded-[8px] bg-white px-2.5 text-[13px] outline-none" />
                  </div>
                  <div className="text-[11px] text-[#7A5600]/80">Mở lại tài liệu sẽ nhảy tới trang này (nếu Google cho phép); đoạn ghi chú luôn hiện ở đây.</div>
                </div>
              )}
              <textarea value={summary} readOnly={!canEdit}
                onChange={e => { setSummary(e.target.value); notesSave.queue(e.target.value); }}
                placeholder={canEdit ? 'Tóm tắt ý chính, điều khoản cần nhớ, số trang quan trọng…' : 'Chưa có ghi chú'}
                className="flex-1 min-h-[180px] w-full rounded-[12px] bg-[#FFFBEA] p-3 text-[13.5px] leading-[1.7] text-[#3A2E00] outline-none resize-none shadow-[inset_0_0_0_0.5px_rgba(0,0,0,0.08)] focus:shadow-[inset_0_0_0_1.5px_#FFCC00]" />
              {(meta.number || meta.issuer || meta.issued || meta.effective || meta.tags?.length) && (
                <dl className="grid grid-cols-[96px_1fr] gap-x-2 gap-y-1.5 text-[12.5px]">
                  {meta.number && <><dt className="text-[#86868B]">Số hiệu</dt><dd className="text-[#1D1D1F] font-medium">{meta.number}</dd></>}
                  {meta.issuer && <><dt className="text-[#86868B]">Cơ quan</dt><dd className="text-[#1D1D1F]">{meta.issuer}</dd></>}
                  {meta.issued && <><dt className="text-[#86868B]">Ban hành</dt><dd className="text-[#1D1D1F]">{fmtDate(meta.issued)}</dd></>}
                  {meta.effective && <><dt className="text-[#86868B]">Hiệu lực</dt><dd className="text-[#1D1D1F]">{fmtDate(meta.effective)}</dd></>}
                  {status && <><dt className="text-[#86868B]">Tình trạng</dt><dd><Pill tint={status.tint}>{status.label}</Pill></dd></>}
                  {!!meta.tags?.length && <><dt className="text-[#86868B]">Nhãn</dt><dd className="flex flex-wrap gap-1">{meta.tags.map(t => <Pill key={t} tint="gray">#{t}</Pill>)}</dd></>}
                </dl>
              )}
              <div className="text-[11px] text-[#AEAEB2]">Sửa lần cuối {fmtWhen(doc.updated_at)}{doc.updated_by ? ` · ${doc.updated_by}` : ''}</div>
            </div>
          </aside>
        )}
      </div>

      {askPage && (
        <div className="fixed inset-0 z-[95] flex items-center justify-center p-4" role="presentation" onClick={() => setAskPage(false)}>
          <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" />
          <div role="dialog" aria-modal="true" onClick={e => e.stopPropagation()} className="relative w-full max-w-[360px] bg-white rounded-[20px] p-5 shadow-[0_24px_64px_-12px_rgba(0,0,0,0.3)] animate-fade-in">
            <div className="text-[16px] font-semibold text-[#1D1D1F]">Bạn đang học tới trang mấy?</div>
            <div className="text-[12.5px] text-[#86868B] mt-1">Lần sau mở lại tài liệu, app nhắc đúng chỗ này.</div>
            <div className="flex gap-2 mt-3">
              <input value={pageText} onChange={e => changeBookmark(e.target.value.replace(/\D/g, '').slice(0, 5), partNote)} inputMode="numeric" placeholder="Trang" autoFocus
                className="w-20 h-10 rounded-[10px] bg-black/[0.05] text-center text-[15px] font-semibold outline-none focus:ring-2 focus:ring-[#FFCC00]" />
              <input value={partNote} onChange={e => changeBookmark(pageText, e.target.value)} placeholder="Đoạn (tuỳ chọn)" className="flex-1 min-w-0 h-10 rounded-[10px] bg-black/[0.05] px-3 text-[14px] outline-none" />
            </div>
            <div className="flex gap-2 justify-end mt-4">
              <button type="button" onClick={() => { setAskPage(false); void bookmarkSave.flush().then(onClose); }} className="h-9 px-4 rounded-full bg-[#0071E3] text-[13px] font-medium text-white">Lưu & thoát</button>
            </div>
          </div>
        </div>
      )}

      {confirmDel && (
        <Confirm title="Xoá tài liệu này?" confirmLabel="Xoá" onClose={() => setConfirmDel(false)} onConfirm={remove}
          text={<>"{doc.title}" sẽ vào <b>Thùng rác</b> của trang Pháp lý — khôi phục lại được bất cứ lúc nào. File gốc trên Google Drive không bị đụng tới.</>} />
      )}
    </div>
  );
}
