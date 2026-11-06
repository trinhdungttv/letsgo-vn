// Cửa sổ danh sách (như cửa sổ MFinder): 2 khu riêng Ghi chú / Sơ đồ tư duy, mỗi khu có Tất cả / Lưu trữ / Đã xoá
// + ô tìm; danh sách bên trái + khung soạn bên phải. Điện thoại: toàn màn, bấm 1 dòng → mở toàn màn, nút ‹ để quay lại.
// Nút Phóng to trong khung soạn → cửa sổ gần kín màn hình; 1 cỡ chung cho cả 2 khu (đổi khu không bị phóng / thu).
// Mục đang khoá chống xoá có ổ khoá trong danh sách; nút 🔑 cạnh tiêu đề = đặt / đổi / quên mã khoá. Khu / nhóm / mục
// đang chọn báo lên QuickNotesDock (onPlaceChange) để lần sau mở lại đúng chỗ.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AlertCircle, Circle, KeyRound, Loader2, Lock, Mic, Network, Pin, Plus, StickyNote, X } from 'lucide-react';
import { Segmented, SearchField } from '../../modules/cskh/components/apple';
import { errText, listTrash, restoreNote } from '../../lib/quickNotes/api';
import { PALETTE } from '../../lib/quickNotes/colors';
import {
  checklistCount, displayTitle, hasAllTags, isMindmap, listOrder, mindmapCount, noteMatches, notePreview, relativeTime, tagCounts,
} from '../../lib/quickNotes/noteText';
import { TagChip } from './TagBar';
import type { WinPlace } from '../../lib/quickNotes/lastPlace';
import type { NotesTab, NoteView, QuickNote } from '../../lib/quickNotes/types';
import type { QuickNotesStore } from './useQuickNotes';

export type { NotesTab };

export interface EditorExtra {
  onBack?: () => void;
  readOnly?: boolean;
  onRestore?: () => void;
  autoFocus?: boolean;
  expanded?: boolean;
  onToggleExpand?: () => void;
  /** Mục mới vừa tạo từ mục đang mở (ghi chú → sơ đồ, sơ đồ → ghi chú) → chuyển sang khu của nó và mở */
  onOpenCreated?: (id: string, kind: NoteView) => void;
}

const kindOf = (n: Pick<QuickNote, 'view_mode'>): NoteView => (isMindmap(n) ? 'mindmap' : 'text');

const WIN_KEY = 'qn-window-expanded';

function loadWinExpanded(): boolean {
  try {
    const raw = JSON.parse(localStorage.getItem(WIN_KEY) ?? 'null') as boolean | { text?: boolean } | null;
    // Bản cũ nhớ riêng từng loại { text, mindmap } → lấy theo cỡ đang dùng cho ghi chú
    return typeof raw === 'boolean' ? raw : !!raw?.text;
  } catch {
    return false;
  }
}

function NoteRow({ note, selected, recording, attention, onClick }: {
  note: QuickNote;
  selected: boolean;
  recording: boolean;
  attention: boolean;
  onClick: () => void;
}) {
  const map = isMindmap(note);
  const cl = map ? { done: 0, total: 0 } : checklistCount(note.body);
  const preview = notePreview(note, 1)[0] ?? '';
  return (
    <button type="button" onClick={onClick}
      className={`w-full text-left flex gap-3 px-3 py-2.5 rounded-[10px] transition ${selected ? 'bg-black/[0.09]' : 'hover:bg-black/[0.04] active:bg-black/[0.06]'}`}>
      <span className="w-1 self-stretch rounded-full shrink-0" style={{ background: PALETTE[note.color].dot }} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 min-w-0">
          <span className="truncate text-[15px] md:text-[14px] font-semibold text-[#1D1D1F]">{displayTitle(note)}</span>
          {note.pinned && <Pin size={11} className="shrink-0 text-[#86868B]" fill="currentColor" />}
          {note.locked_at && <span title="Đang khoá chống xoá" className="shrink-0 text-[#86868B]"><Lock size={11} /></span>}
          {recording && <span className="shrink-0 w-2 h-2 rounded-full bg-[#FF3B30] qn-rec-pulse" title="Đang ghi âm" />}
          {attention && <span title="Có bản ghi âm chưa tải lên" className="shrink-0 text-[#D70015]"><AlertCircle size={12} /></span>}
        </span>
        <span className="flex items-center gap-2 text-[13px] md:text-[12px] text-[#86868B] min-w-0 mt-0.5">
          <span className="shrink-0">{relativeTime(note.deleted_at ?? note.updated_at)}</span>
          {cl.total > 0 && <span className="shrink-0 inline-flex items-center gap-1"><Circle size={11} /> {cl.done}/{cl.total}</span>}
          {note.recordings.length > 0 && <span className="shrink-0 inline-flex items-center gap-0.5"><Mic size={11} /> {note.recordings.length}</span>}
          {map && note.mindmap && <span className="shrink-0 inline-flex items-center gap-0.5"><Network size={11} /> {mindmapCount(note.mindmap)}</span>}
          <span className="truncate text-[#AEAEB2]">{preview}</span>
        </span>
        {note.tags.length > 0 && (
          <span className="flex gap-1 mt-1 overflow-hidden">
            {note.tags.slice(0, 4).map(t => <TagChip key={t} tag={t} />)}
            {note.tags.length > 4 && <span className="text-[11px] text-[#86868B] self-center">+{note.tags.length - 4}</span>}
          </span>
        )}
      </span>
    </button>
  );
}

export default function NotesWindow({
  store, isMobile, initialSelectedId, initialTab, initialSection, recordingNoteId, attentionNoteIds, canRecord,
  onClose, onNew, onNewMeeting, onNewMap, onPlaceChange, onPinSettings, renderEditor,
}: {
  store: QuickNotesStore;
  isMobile: boolean;
  initialSelectedId: string | null;
  initialTab: NotesTab;
  /** khu mở sẵn khi chưa chọn mục nào (mở lại chỗ cũ) */
  initialSection?: NoteView;
  recordingNoteId: string | null;
  attentionNoteIds: Set<string>;
  canRecord: boolean;
  onClose: () => void;
  onNew: () => string;
  onNewMeeting: () => string;
  onNewMap: () => string;
  /** khu / nhóm / mục đang chọn đổi → lưu lại để lần sau mở đúng chỗ */
  onPlaceChange?: (p: WinPlace) => void;
  /** mở hộp đặt / đổi / quên mã khoá chống xoá */
  onPinSettings?: () => void;
  renderEditor: (note: QuickNote, variant: 'pane' | 'sheet', extra: EditorExtra) => ReactNode;
}) {
  const [tab, setTab] = useState<NotesTab>(initialTab);
  const [q, setQ] = useState('');
  const [tagSel, setTagSel] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);
  const [trash, setTrash] = useState<QuickNote[] | null>(null);
  const [trashErr, setTrashErr] = useState<string | null>(null);
  const [winExpanded, setWinExpanded] = useState(loadWinExpanded);
  const [section, setSection] = useState<NoteView>(() => {
    const n = initialSelectedId ? store.notes.find(x => x.id === initialSelectedId) : null;
    return n ? kindOf(n) : initialSection ?? 'text';
  });

  const placeCb = useRef(onPlaceChange);
  placeCb.current = onPlaceChange;
  useEffect(() => { placeCb.current?.({ selectedId, tab, section }); }, [selectedId, tab, section]);

  const live = store.notes;
  const inSection = (n: QuickNote) => kindOf(n) === section;
  const sectionLive = live.filter(inSection);
  const activeCount = sectionLive.filter(n => !n.archived_at).length;
  const archivedCount = sectionLive.length - activeCount;
  const sectionCount = (k: NoteView) => live.filter(n => !n.archived_at && kindOf(n) === k).length;
  const isMap = section === 'mindmap';

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
    const hit = base.filter(n => kindOf(n) === section && hasAllTags(n, tagSel) && noteMatches(n, q));
    return tab === 'trash' ? hit : listOrder(hit);
  }, [tab, trash, live, q, section, tagSel]);
  const sectionTags = useMemo(() => tagCounts(live.filter(n => kindOf(n) === section && (tab === 'archive' ? !!n.archived_at : !n.archived_at))), [live, section, tab]);
  const toggleTag = (t: string) => setTagSel(s => (s.includes(t) ? s.filter(x => x !== t) : [...s, t]));

  const selected = (selectedId && (live.find(n => n.id === selectedId) ?? trash?.find(n => n.id === selectedId))) || null;
  const selectedInTrash = !!selected && !live.some(n => n.id === selected.id);

  const restore = async (id: string) => {
    try {
      const note = await restoreNote(id);
      store.replace(note);
      setTrash(t => (t ?? []).filter(n => n.id !== id));
      setSection(kindOf(note));
      setTab(note.archived_at ? 'archive' : 'all');
      setSelectedId(id);
    } catch (e) {
      setTrashErr(errText(e));
    }
  };

  const openIn = (k: NoteView, id: string) => { setSection(k); setTab('all'); setQ(''); setSelectedId(id); };
  const createNew = () => openIn('text', onNew());
  const createMeeting = () => openIn('text', onNewMeeting());
  const createMap = () => openIn('mindmap', onNewMap());

  const switchSection = (k: NoteView) => {
    if (k === section) return;
    setSection(k);
    setTab('all');
    setQ('');
    if (!isMobile || (selected && kindOf(selected) !== k)) setSelectedId(null);
  };

  const expanded = !isMobile && winExpanded;
  const toggleExpand = () => {
    const next = !winExpanded;
    setWinExpanded(next);
    try { localStorage.setItem(WIN_KEY, JSON.stringify(next)); } catch { /* chỉ nhớ trong phiên */ }
  };

  const editor = selected && renderEditor(selected, isMobile ? 'sheet' : 'pane', {
    onBack: isMobile ? () => setSelectedId(null) : undefined,
    readOnly: selectedInTrash,
    onRestore: selectedInTrash ? () => void restore(selected.id) : undefined,
    expanded,
    onToggleExpand: isMobile ? undefined : toggleExpand,
    onOpenCreated: (id, kind) => openIn(kind, id),
  });

  const noun = isMap ? 'sơ đồ' : 'ghi chú';
  const emptyText = store.phase === 'missing' ? (store.error ?? 'Chưa cài Ghi chú nhanh trên cơ sở dữ liệu.')
    : store.phase === 'loading' ? 'Đang tải…'
      : q.trim() ? `Không tìm thấy ${noun} nào.`
        : tab === 'trash' ? `${isMap ? 'Sơ đồ' : 'Ghi chú'} đã xoá trong 30 ngày gần đây sẽ hiện ở đây để khôi phục.`
          : tab === 'archive' ? `Chưa cất ${noun} nào. Bấm “Lưu trữ” trong ${noun} để cất khỏi dải mép phải.`
            : isMap ? 'Chưa có sơ đồ tư duy nào — bấm ＋ Sơ đồ mới để vẽ.' : 'Chưa có ghi chú nào — bấm ＋ để ghi nhanh.';

  const sectionSwitch = (
    <div className={`grid grid-cols-2 gap-1 p-1 mb-2 rounded-[12px] bg-black/[0.05] ${isMobile ? 'mx-4' : 'mx-3'}`} role="tablist" aria-label="Khu lưu trữ">
      {([['text', StickyNote, 'Ghi chú', 'bg-[#F5B400]/20 text-[#9A6B00]'], ['mindmap', Network, 'Sơ đồ tư duy', 'bg-[#2C7BF6]/15 text-[#2C7BF6]']] as const).map(([k, Icon, label, tint]) => (
        <button key={k} type="button" role="tab" aria-selected={section === k} onClick={() => switchSection(k)}
          className={`flex items-center gap-2 h-10 px-2 rounded-[9px] text-left transition ${section === k ? 'bg-white shadow-[0_1px_3px_rgba(0,0,0,0.12)] text-[#1D1D1F]' : 'text-[#6E6E73] hover:text-[#1D1D1F]'}`}>
          <span className={`w-6 h-6 shrink-0 rounded-md flex items-center justify-center ${tint}`}><Icon size={14} /></span>
          <span className="flex-1 min-w-0 truncate text-[13px] font-semibold">{label}</span>
          <span className="text-[12px] tabular-nums opacity-55">{sectionCount(k)}</span>
        </button>
      ))}
    </div>
  );

  const list = (
    <>
      {sectionSwitch}
      <div className={isMobile ? 'px-4' : 'px-3'}>
        <Segmented label={isMap ? 'Nhóm sơ đồ' : 'Nhóm ghi chú'} value={tab} onChange={v => { setTab(v); if (!isMobile) setSelectedId(null); }} options={[
          { key: 'all', label: 'Tất cả', badge: activeCount },
          { key: 'archive', label: 'Lưu trữ', badge: archivedCount },
          { key: 'trash', label: 'Đã xoá' },
        ]} />
      </div>
      <div className={`${isMobile ? 'px-4' : 'px-3'} py-2`}>
        <SearchField value={q} onChange={setQ} placeholder={isMap ? 'Tìm sơ đồ · gõ #thẻ để lọc theo thẻ' : 'Tìm ghi chú · gõ #thẻ để lọc theo thẻ'} />
      </div>
      {(sectionTags.length > 0 || tagSel.length > 0) && tab !== 'trash' && (
        <div className={`${isMobile ? 'px-4' : 'px-3'} pb-2 flex gap-1.5 overflow-x-auto no-scrollbar`}>
          {tagSel.length > 0 && <button type="button" onClick={() => setTagSel([])} className="shrink-0 h-[22px] px-2 rounded-full bg-black/[0.07] text-[12px] font-medium hover:bg-black/[0.12]">Bỏ lọc ✕</button>}
          {[...sectionTags, ...tagSel.filter(t => !sectionTags.some(x => x.tag === t)).map(tag => ({ tag, count: 0 }))].map(({ tag, count }) => (
            <TagChip key={tag} tag={tag} count={count || undefined} active={tagSel.includes(tag)} onClick={() => toggleTag(tag)} />
          ))}
        </div>
      )}
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
        <button type="button" onClick={isMap ? createMap : createNew} disabled={store.phase === 'missing'}
          className="inline-flex items-center gap-1.5 h-9 px-2 rounded-lg text-[14px] font-medium text-[#1D1D1F] hover:bg-black/[0.05] disabled:opacity-40">
          <Plus size={17} /> {isMap ? 'Sơ đồ mới' : 'Ghi chú mới'}
        </button>
        <span className="flex-1" />
        <span className="text-[13px] text-[#86868B] tabular-nums">{rows.length}</span>
        {!isMap && (
          <button type="button" onClick={createMeeting} disabled={!canRecord || store.phase === 'missing'}
            title={canRecord ? 'Ghi chú mới + bắt đầu ghi âm cuộc họp' : 'Đang ghi âm ở ghi chú khác'}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-full bg-[#FF3B30]/10 text-[#D70015] text-[13px] font-semibold hover:bg-[#FF3B30]/15 disabled:opacity-40">
            <Mic size={15} /> Ghi âm
          </button>
        )}
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
              <h2 className="text-[24px] font-bold text-[#1D1D1F] tracking-tight">Ghi chú nhanh</h2>
              <span className="flex items-center gap-1">
                {onPinSettings && (
                  <button type="button" onClick={onPinSettings} aria-label="Mã khoá chống xoá" title="Mã khoá chống xoá"
                    className="w-9 h-9 rounded-full flex items-center justify-center text-[#0071E3] active:bg-black/[0.06]"><KeyRound size={19} /></button>
                )}
                <button type="button" onClick={onClose} className="h-9 px-2 text-[16px] font-semibold text-[#0071E3]">Xong</button>
              </span>
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
        <aside className="w-[330px] shrink-0 flex flex-col bg-[#F2F2F4] border-r border-black/[0.06]">
          <div className="flex items-center gap-2 px-4 h-12 shrink-0">
            <StickyNote size={16} className="text-[#86868B]" />
            <span className="flex-1 text-[14px] font-semibold text-[#1D1D1F]">Ghi chú nhanh</span>
            {onPinSettings && (
              <button type="button" onClick={onPinSettings} aria-label="Mã khoá chống xoá" title="Mã khoá chống xoá (đặt / đổi / quên mã)"
                className="w-7 h-7 rounded-full flex items-center justify-center text-[#86868B] hover:bg-black/[0.06] hover:text-[#1D1D1F]"><KeyRound size={15} /></button>
            )}
            <button type="button" onClick={onClose} aria-label="Đóng" title="Đóng (Esc)"
              className="w-7 h-7 rounded-full flex items-center justify-center text-[#86868B] hover:bg-black/[0.06] hover:text-[#1D1D1F]"><X size={16} /></button>
          </div>
          {list}
        </aside>
        <section className="flex-1 min-w-0 flex flex-col">
          {editor ?? (
            <div className="flex-1 flex flex-col items-center justify-center gap-2 text-[#86868B] bg-[#FAFAFB]">
              {isMap ? <Network size={34} strokeWidth={1.4} /> : <StickyNote size={34} strokeWidth={1.4} />}
              <div className="text-[13px]">Chọn 1 {noun} bên trái, hoặc bấm ＋ {isMap ? 'Sơ đồ mới' : 'Ghi chú mới'}</div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
