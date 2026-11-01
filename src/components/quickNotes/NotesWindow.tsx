// Cửa sổ danh sách ghi chú (như cửa sổ MFinder): Tất cả ghi chú / Lưu trữ / Đã xoá, ô tìm, danh sách bên trái +
// khung soạn bên phải. Điện thoại: toàn màn, bấm 1 dòng → mở ghi chú toàn màn, nút ‹ để quay lại danh sách.
// Nút Phóng to trong khung soạn → cửa sổ gần kín màn hình (nhớ riêng cho Văn bản / Sơ đồ tư duy).
import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { AlertCircle, Circle, Loader2, Mic, Network, Pin, Plus, StickyNote, X } from 'lucide-react';
import { Segmented, SearchField } from '../../modules/cskh/components/apple';
import { errText, listTrash, restoreNote } from '../../lib/quickNotes/api';
import { PALETTE } from '../../lib/quickNotes/colors';
import { checklistCount, DEFAULT_TITLE, listOrder, noteMatches, notePreview, relativeTime, titleOf } from '../../lib/quickNotes/noteText';
import type { NoteView, QuickNote } from '../../lib/quickNotes/types';
import type { QuickNotesStore } from './useQuickNotes';

export type NotesTab = 'all' | 'archive' | 'trash';

export interface EditorExtra {
  onBack?: () => void;
  readOnly?: boolean;
  onRestore?: () => void;
  autoFocus?: boolean;
  expanded?: boolean;
  onToggleExpand?: () => void;
}

const WIN_KEY = 'qn-window-expanded';
const WIN_DEFAULT: Record<NoteView, boolean> = { text: false, mindmap: true };

function loadWinExpanded(): Record<NoteView, boolean> {
  try {
    const raw = JSON.parse(localStorage.getItem(WIN_KEY) ?? 'null') as Partial<Record<NoteView, boolean>> | null;
    return { text: raw?.text ?? WIN_DEFAULT.text, mindmap: raw?.mindmap ?? WIN_DEFAULT.mindmap };
  } catch {
    return WIN_DEFAULT;
  }
}

function NoteRow({ note, selected, recording, attention, onClick }: {
  note: QuickNote;
  selected: boolean;
  recording: boolean;
  attention: boolean;
  onClick: () => void;
}) {
  const cl = checklistCount(note.body);
  const preview = notePreview(note, 1)[0] ?? '';
  return (
    <button type="button" onClick={onClick}
      className={`w-full text-left flex gap-3 px-3 py-2.5 rounded-[10px] transition ${selected ? 'bg-black/[0.09]' : 'hover:bg-black/[0.04] active:bg-black/[0.06]'}`}>
      <span className="w-1 self-stretch rounded-full shrink-0" style={{ background: PALETTE[note.color].dot }} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 min-w-0">
          <span className="truncate text-[15px] md:text-[14px] font-semibold text-[#1D1D1F]">{titleOf(note) || DEFAULT_TITLE}</span>
          {note.pinned && <Pin size={11} className="shrink-0 text-[#86868B]" fill="currentColor" />}
          {recording && <span className="shrink-0 w-2 h-2 rounded-full bg-[#FF3B30] qn-rec-pulse" title="Đang ghi âm" />}
          {attention && <span title="Có bản ghi âm chưa tải lên" className="shrink-0 text-[#D70015]"><AlertCircle size={12} /></span>}
        </span>
        <span className="flex items-center gap-2 text-[13px] md:text-[12px] text-[#86868B] min-w-0 mt-0.5">
          <span className="shrink-0">{relativeTime(note.deleted_at ?? note.updated_at)}</span>
          {cl.total > 0 && <span className="shrink-0 inline-flex items-center gap-1"><Circle size={11} /> {cl.done}/{cl.total}</span>}
          {note.recordings.length > 0 && <span className="shrink-0 inline-flex items-center gap-0.5"><Mic size={11} /> {note.recordings.length}</span>}
          {note.mindmap && <span className="shrink-0 inline-flex items-center" title="Có sơ đồ tư duy"><Network size={11} /></span>}
          <span className="truncate text-[#AEAEB2]">{preview}</span>
        </span>
      </span>
    </button>
  );
}

export default function NotesWindow({
  store, isMobile, initialSelectedId, initialTab, recordingNoteId, attentionNoteIds, canRecord,
  onClose, onNew, onNewMeeting, renderEditor,
}: {
  store: QuickNotesStore;
  isMobile: boolean;
  initialSelectedId: string | null;
  initialTab: NotesTab;
  recordingNoteId: string | null;
  attentionNoteIds: Set<string>;
  canRecord: boolean;
  onClose: () => void;
  onNew: () => string;
  onNewMeeting: () => string;
  renderEditor: (note: QuickNote, variant: 'pane' | 'sheet', extra: EditorExtra) => ReactNode;
}) {
  const [tab, setTab] = useState<NotesTab>(initialTab);
  const [q, setQ] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);
  const [trash, setTrash] = useState<QuickNote[] | null>(null);
  const [trashErr, setTrashErr] = useState<string | null>(null);
  const [winExpanded, setWinExpanded] = useState(loadWinExpanded);

  const live = store.notes;
  const activeCount = live.filter(n => !n.archived_at).length;
  const archivedCount = live.length - activeCount;

  useEffect(() => {
    if (tab !== 'trash') return;
    let alive = true;
    setTrashErr(null);
    listTrash()
      .then(list => { if (alive) setTrash(list); })
      .catch(e => { if (alive) { setTrash([]); setTrashErr(errText(e)); } });
    return () => { alive = false; };
  }, [tab, live.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('[data-qn-confirm]')) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const rows = useMemo(() => {
    const base = tab === 'trash' ? (trash ?? []) : live.filter(n => (tab === 'archive' ? !!n.archived_at : !n.archived_at));
    const hit = base.filter(n => noteMatches(n, q));
    return tab === 'trash' ? hit : listOrder(hit);
  }, [tab, trash, live, q]);

  const selected = (selectedId && (live.find(n => n.id === selectedId) ?? trash?.find(n => n.id === selectedId))) || null;
  const selectedInTrash = !!selected && !live.some(n => n.id === selected.id);

  const restore = async (id: string) => {
    try {
      const note = await restoreNote(id);
      store.replace(note);
      setTrash(t => (t ?? []).filter(n => n.id !== id));
      setTab(note.archived_at ? 'archive' : 'all');
      setSelectedId(id);
    } catch (e) {
      setTrashErr(errText(e));
    }
  };

  const createNew = () => { setTab('all'); setQ(''); setSelectedId(onNew()); };
  const createMeeting = () => { setTab('all'); setQ(''); setSelectedId(onNewMeeting()); };

  const viewMode: NoteView = selected?.view_mode ?? 'text';
  const expanded = !isMobile && winExpanded[viewMode];
  const toggleExpand = () => {
    const next = { ...winExpanded, [viewMode]: !winExpanded[viewMode] };
    setWinExpanded(next);
    try { localStorage.setItem(WIN_KEY, JSON.stringify(next)); } catch { /* chỉ nhớ trong phiên */ }
  };

  const editor = selected && renderEditor(selected, isMobile ? 'sheet' : 'pane', {
    onBack: isMobile ? () => setSelectedId(null) : undefined,
    readOnly: selectedInTrash,
    onRestore: selectedInTrash ? () => void restore(selected.id) : undefined,
    expanded,
    onToggleExpand: isMobile ? undefined : toggleExpand,
  });

  const emptyText = store.phase === 'missing' ? (store.error ?? 'Chưa cài Ghi chú nhanh trên cơ sở dữ liệu.')
    : store.phase === 'loading' ? 'Đang tải…'
      : q.trim() ? 'Không tìm thấy ghi chú nào.'
        : tab === 'trash' ? 'Ghi chú đã xoá trong 30 ngày gần đây sẽ hiện ở đây để khôi phục.'
          : tab === 'archive' ? 'Chưa cất ghi chú nào. Bấm “Lưu trữ” trong ghi chú để cất khỏi dải mép phải.'
            : 'Chưa có ghi chú nào — bấm ＋ để ghi nhanh.';

  const list = (
    <>
      <div className={isMobile ? 'px-4' : 'px-3'}>
        <Segmented label="Nhóm ghi chú" value={tab} onChange={v => { setTab(v); if (!isMobile) setSelectedId(null); }} options={[
          { key: 'all', label: 'Tất cả', badge: activeCount },
          { key: 'archive', label: 'Lưu trữ', badge: archivedCount },
          { key: 'trash', label: 'Đã xoá' },
        ]} />
      </div>
      <div className={`${isMobile ? 'px-4' : 'px-3'} py-2`}>
        <SearchField value={q} onChange={setQ} placeholder="Tìm ghi chú" />
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-2">
        {(store.phase === 'error' || trashErr) && (
          <div className="mx-1 mb-2 flex items-start gap-2 rounded-[10px] bg-[#FF3B30]/10 px-3 py-2 text-[12.5px] text-[#B0000F]">
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <span className="flex-1">{trashErr ?? store.error}</span>
            {!trashErr && <button type="button" onClick={() => void store.reload()} className="shrink-0 font-semibold underline">Thử lại</button>}
          </div>
        )}
        {tab === 'trash' && trash === null ? (
          <div className="flex justify-center py-8 text-[#86868B]"><Loader2 size={18} className="animate-spin" /></div>
        ) : rows.length === 0 ? (
          <div className="px-4 py-10 text-center text-[13px] text-[#86868B]">{emptyText}</div>
        ) : rows.map(n => (
          <NoteRow key={n.id} note={n} selected={n.id === selectedId} recording={n.id === recordingNoteId}
            attention={attentionNoteIds.has(n.id)} onClick={() => setSelectedId(n.id)} />
        ))}
      </div>
      <div className={`flex items-center gap-2 border-t border-black/[0.06] ${isMobile ? 'px-4 h-14 pb-[env(safe-area-inset-bottom)] box-content' : 'px-3 h-12'}`}>
        <button type="button" onClick={createNew} disabled={store.phase === 'missing'}
          className="inline-flex items-center gap-1.5 h-9 px-2 rounded-lg text-[14px] font-medium text-[#1D1D1F] hover:bg-black/[0.05] disabled:opacity-40">
          <Plus size={17} /> Ghi chú mới
        </button>
        <span className="flex-1" />
        <span className="text-[13px] text-[#86868B] tabular-nums">{rows.length}</span>
        <button type="button" onClick={createMeeting} disabled={!canRecord || store.phase === 'missing'}
          title={canRecord ? 'Ghi chú mới + bắt đầu ghi âm cuộc họp' : 'Đang ghi âm ở ghi chú khác'}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-full bg-[#FF3B30]/10 text-[#D70015] text-[13px] font-semibold hover:bg-[#FF3B30]/15 disabled:opacity-40">
          <Mic size={15} /> Ghi âm
        </button>
      </div>
    </>
  );

  if (isMobile) {
    return (
      <div className="fixed inset-0 z-[85] bg-[#F5F5F7] flex flex-col pt-[env(safe-area-inset-top)]" data-qn-keep>
        {selected ? (
          <div className="flex-1 min-h-0 flex flex-col">{editor}</div>
        ) : (
          <>
            <div className="flex items-center justify-between px-4 h-14 shrink-0">
              <h2 className="text-[24px] font-bold text-[#1D1D1F] tracking-tight">Ghi chú</h2>
              <button type="button" onClick={onClose} className="h-9 px-2 text-[16px] font-semibold text-[#0071E3]">Xong</button>
            </div>
            {list}
          </>
        )}
      </div>
    );
  }

  return (
    <div className={`fixed inset-0 z-[85] bg-black/30 flex items-center justify-center ${expanded ? 'p-3' : 'p-6'}`} data-qn-keep
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`qn-pop w-full rounded-[16px] overflow-hidden flex bg-white shadow-[0_0_0_0.5px_rgba(0,0,0,0.12),0_30px_80px_-20px_rgba(0,0,0,0.45)] ${expanded ? 'h-full' : 'max-w-[1000px] h-[min(700px,calc(100vh-48px))]'}`}>
        <aside className={`${expanded ? 'w-[280px]' : 'w-[330px]'} shrink-0 flex flex-col bg-[#F2F2F4] border-r border-black/[0.06]`}>
          <div className="flex items-center gap-2 px-4 h-12 shrink-0">
            <StickyNote size={16} className="text-[#86868B]" />
            <span className="flex-1 text-[14px] font-semibold text-[#1D1D1F]">Ghi chú nhanh</span>
            <button type="button" onClick={onClose} aria-label="Đóng" title="Đóng (Esc)"
              className="w-7 h-7 rounded-full flex items-center justify-center text-[#86868B] hover:bg-black/[0.06] hover:text-[#1D1D1F]"><X size={16} /></button>
          </div>
          {list}
        </aside>
        <section className="flex-1 min-w-0 flex flex-col">
          {editor ?? (
            <div className="flex-1 flex flex-col items-center justify-center gap-2 text-[#86868B] bg-[#FAFAFB]">
              <StickyNote size={34} strokeWidth={1.4} />
              <div className="text-[13px]">Chọn 1 ghi chú bên trái, hoặc bấm ＋ Ghi chú mới</div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
