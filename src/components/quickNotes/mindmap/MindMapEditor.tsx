// ============================================================================
// MindMapEditor — Sơ đồ tư duy kiểu XMind trong Ghi chú nhanh (tải riêng khi mở, không làm nặng trang).
// ----------------------------------------------------------------------------
// Phím như XMind: Tab = chủ đề con · Enter = cùng cấp (Shift: phía trước) · ⌘/Ctrl+Enter = chủ đề cha · Delete = xoá ·
// F2 / Space / bấm đúp = sửa chữ, hoặc cứ chọn rồi gõ luôn (gõ tiếng Việt Telex/VNI được) · mũi tên = di chuyển ·
// Alt+↑↓ = đổi thứ tự · ⌘/ = thu gọn · ⌘Z / ⌘⇧Z · ⌘C/X/V (dán chữ nhiều dòng thành nhánh) · ⌘] = tóm tắt ·
// ⌘⇧B = vùng bao · ⌘B / ⌘I = đậm / nghiêng · ⌘+ / ⌘− / ⌘0 = phóng to / thu nhỏ / vừa màn hình.
// Chuột: kéo chủ đề để đổi chỗ / đổi cha (thả ra chỗ trống = chủ đề tự do) · kéo nền = di chuyển · Shift+kéo = chọn vùng ·
// cuộn = di chuyển, ⌘/Ctrl+cuộn hoặc chụm 2 ngón = phóng to · bấm đúp chỗ trống = chủ đề tự do · chuột phải = menu.
// Toàn bộ thao tác đi qua lib/quickNotes/mindmap/model.ts (thuần, có test); vẽ = layout.ts + MapContent.tsx.
// ============================================================================
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ClipboardEvent, CSSProperties, KeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import {
  AlertCircle, BoxSelect, Braces, Check, ChevronDown, Download, GitBranchPlus, HelpCircle, ListTree, Maximize, Minimize, Network,
  Paintbrush, Plus, Redo2, Scan, Smile, Spline, StickyNote, Trash2, Undo2, X, ZoomIn, ZoomOut,
} from 'lucide-react';
import { FONT_FAMILY, type NotePalette } from '../../../lib/quickNotes/colors';
import { canvasMeasure, hitTest, layoutMap, navigate, type MapLayout, type Pt, type TopicBox } from '../../../lib/quickNotes/mindmap/layout';
import * as M from '../../../lib/quickNotes/mindmap/model';
import { getTheme } from '../../../lib/quickNotes/mindmap/themes';
import type { MindMapDoc, MindTopic } from '../../../lib/quickNotes/mindmap/types';
import { exportMarkdown, exportPdf, exportPng, exportSvg, docToMarkdown } from './exportMap';
import FormatPanel, { type PanelTab } from './FormatPanel';
import MapContentRaw, { SELECT_COLOR, shapeRadius, TopicText } from './MapContent';
import OutlineView from './OutlineView';

const MapContent = memo(MapContentRaw);

interface View { x: number; y: number; z: number }
type Drop = { type: 'child' | 'before' | 'after'; target: string } | { type: 'float'; at: Pt };
type Drag =
  | { kind: 'pan'; pointerId: number; sx: number; sy: number; vx: number; vy: number; moved: boolean }
  | { kind: 'marquee'; pointerId: number; start: Pt; additive: boolean }
  | { kind: 'topic'; pointerId: number; ids: string[]; primary: string; grab: Pt; sx: number; sy: number; moved: boolean; drop: Drop | null }
  | { kind: 'pinch'; d0: number; mid0: Pt; v0: View };

const MIN_Z = 0.15;
const MAX_Z = 3.5;
const ZOOMS = [0.25, 0.33, 0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];
const HISTORY_MAX = 200;
const MERGE_MS = 1500;

/** Nhớ khung nhìn từng sơ đồ trong phiên (đóng / mở lại ghi chú không bị nhảy). */
const viewMemory = new Map<string, View>();
/** Bộ nhớ sao chép nội bộ (giữ định dạng khi dán trong cùng app). */
let clip: { text: string; topics: MindTopic[] } | null = null;

const clampZ = (z: number) => Math.min(MAX_Z, Math.max(MIN_Z, z));
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? '⌘' : 'Ctrl+';

function parseHit(target: EventTarget | null): { kind: string; id: string; extra?: string } | null {
  const el = target instanceof Element ? target.closest('[data-hit]') : null;
  if (!el) return null;
  const [kind, id, ...rest] = (el.getAttribute('data-hit') ?? '').split(':');
  return { kind, id, extra: rest.join(':') || undefined };
}

function TB({ title, onClick, children, label, active, disabled, wide }: {
  title: string; onClick: () => void; children: ReactNode; label?: string; active?: boolean; disabled?: boolean; wide: boolean;
}) {
  return (
    <button type="button" title={title} aria-label={title} onClick={onClick} disabled={disabled}
      onMouseDown={e => e.preventDefault()}
      className={`shrink-0 inline-flex items-center gap-1.5 h-8 rounded-lg text-[12.5px] font-medium transition disabled:opacity-30 ${wide && label ? 'px-2' : 'w-8 justify-center'} ${active ? 'bg-[#2C7BF6]/12 text-[#2C7BF6]' : 'hover:bg-black/[0.06]'}`}>
      {children}
      {wide && label && <span>{label}</span>}
    </button>
  );
}

const Sep = () => <span className="shrink-0 w-px h-5 bg-black/10 mx-0.5" />;

export interface MindMapEditorProps {
  noteId: string;
  doc: MindMapDoc | null;
  /** chữ đi kèm mục (sơ đồ cũ từng đổi qua lại với văn bản) — có thì dựng sơ đồ lần đầu từ đây */
  seedText: string;
  palette: NotePalette;
  title: string;
  readOnly?: boolean;
  mobile?: boolean;
  saveError?: string | null;
  onChange: (doc: MindMapDoc) => void;
  /** tạo 1 ghi chú văn bản MỚI chứa dàn ý của sơ đồ */
  onCreateNote?: (body: string) => void;
}

export default function MindMapEditor(props: MindMapEditorProps) {
  const { noteId, palette, readOnly, mobile } = props;
  const seeded = useRef<MindMapDoc | null>(props.doc ? null : M.docFromText(props.seedText));
  const doc = props.doc ?? seeded.current ?? M.defaultDoc();
  const docRef = useRef(doc);
  docRef.current = doc;
  const onChangeRef = useRef(props.onChange);
  onChangeRef.current = props.onChange;

  useEffect(() => {
    // Sơ đồ mới trống: chưa lưu tới khi sửa lần đầu (đóng ngay thì không để lại mục rỗng); dựng từ chữ thì lưu luôn
    if (!props.doc && seeded.current && props.seedText.trim()) onChangeRef.current(seeded.current);
    // chỉ lần đầu: lưu sơ đồ vừa dựng từ văn bản
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const theme = useMemo(() => getTheme(doc.theme, palette), [doc.theme, palette]);
  const family = FONT_FAMILY[doc.font ?? 'sans'];

  // ── Trạng thái giao diện ──
  const [sel, setSel] = useState<string[]>(() => [doc.root.id]);
  const [selRel, setSelRel] = useState<string | null>(null);
  const [selBoundary, setSelBoundary] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [view, setView] = useState<View>(() => viewMemory.get(noteId) ?? { x: 0, y: 0, z: 1 });
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [rootW, setRootW] = useState(800);
  const [panel, setPanel] = useState<PanelTab | null>(null);
  const [mode, setMode] = useState<'map' | 'outline'>('map');
  const [linkFrom, setLinkFrom] = useState<string | null>(null);
  const [linkPt, setLinkPt] = useState<Pt | null>(null);
  const [dragUI, setDragUI] = useState<{ ids: string[]; primary: string; cur: Pt; grab: Pt; drop: Drop | null } | null>(null);
  const [marquee, setMarquee] = useState<{ a: Pt; b: Pt } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; at: Pt; onTopic: boolean } | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [help, setHelp] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const [reveal, setReveal] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [, bump] = useState(0);

  const rootRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const contentRef = useRef<SVGGElement>(null);
  const drag = useRef<Drag | null>(null);
  const pointers = useRef(new Map<number, Pt>());
  const undoStack = useRef<MindMapDoc[]>([]);
  const redoStack = useRef<MindMapDoc[]>([]);
  const lastMerge = useRef<{ key: string; t: number } | null>(null);
  const lastDown = useRef<{ key: string; t: number; x: number; y: number } | null>(null);
  const inited = useRef(viewMemory.has(noteId));
  /** Khung nhìn còn đang do app tự canh (chưa kéo / phóng tay) → khung to ra thì canh lại cho vừa */
  const autoFit = useRef(!viewMemory.has(noteId));

  const viewRef = useRef(view);
  viewRef.current = view;
  const selRef = useRef(sel);
  selRef.current = sel;
  const editingRef = useRef(editing);
  editingRef.current = editing;

  const layout = useMemo<MapLayout>(
    () => layoutMap(doc, theme, canvasMeasure, { family, editId: editing, editText: editing ? draft : undefined }),
    [doc, theme, family, editing, draft],
  );
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  // Bỏ chọn những chủ đề không còn (hoàn tác, xoá ở máy khác…)
  useEffect(() => {
    const live = sel.filter(id => layout.byId.has(id));
    if (live.length !== sel.length) setSel(live);
    if (selRel && !doc.relations.some(r => r.id === selRel)) setSelRel(null);
    if (editing && !layout.byId.has(editing)) { setEditing(null); setDraft(''); }
  }, [doc, layout, sel, selRel, editing]);

  useEffect(() => { viewMemory.set(noteId, view); }, [noteId, view]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2400);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    const onFs = () => setFullscreen(document.fullscreenElement === rootRef.current && !!rootRef.current);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  // ── Lịch sử (hoàn tác / làm lại) ──
  const commit = useCallback((next: MindMapDoc, merge?: string) => {
    const cur = docRef.current;
    if (next === cur || readOnly) return;
    const now = Date.now();
    const same = merge && lastMerge.current?.key === merge && now - lastMerge.current.t < MERGE_MS;
    if (!same) {
      undoStack.current.push(cur);
      if (undoStack.current.length > HISTORY_MAX) undoStack.current.shift();
    }
    lastMerge.current = merge ? { key: merge, t: now } : null;
    redoStack.current = [];
    docRef.current = next;
    onChangeRef.current(next);
    bump(x => x + 1);
  }, [readOnly]);

  const getDoc = useCallback(() => docRef.current, []);

  const undo = () => {
    const prev = undoStack.current.pop();
    if (!prev) return;
    redoStack.current.push(docRef.current);
    lastMerge.current = null;
    docRef.current = prev;
    onChangeRef.current(prev);
    bump(x => x + 1);
  };
  const redo = () => {
    const next = redoStack.current.pop();
    if (!next) return;
    undoStack.current.push(docRef.current);
    lastMerge.current = null;
    docRef.current = next;
    onChangeRef.current(next);
    bump(x => x + 1);
  };

  // ── Khung nhìn ──
  const fitView = useCallback((mode: 'fit' | 'init' | 'center') => {
    const w = wrapRef.current?.clientWidth ?? 0;
    const h = wrapRef.current?.clientHeight ?? 0;
    if (!w || !h) return;
    const b = layoutRef.current.bounds;
    let z = viewRef.current.z;
    if (mode !== 'center') {
      z = Math.min((w - 64) / b.w, (h - 64) / b.h);
      z = clampZ(mode === 'init' ? Math.min(1, z) : Math.min(1.6, z));
    }
    setView({ z, x: w / 2 - (b.x + b.w / 2) * z, y: h / 2 - (b.y + b.h / 2) * z });
  }, []);

  const zoomAt = useCallback((cx: number, cy: number, z: number) => {
    setView(v => {
      const nz = clampZ(z);
      const mx = (cx - v.x) / v.z;
      const my = (cy - v.y) / v.z;
      return { z: nz, x: cx - mx * nz, y: cy - my * nz };
    });
  }, []);

  const zoomStep = (dir: 1 | -1) => {
    autoFit.current = false;
    const z = viewRef.current.z;
    const next = dir > 0 ? ZOOMS.find(s => s > z + 0.001) ?? MAX_Z : [...ZOOMS].reverse().find(s => s < z - 0.001) ?? MIN_Z;
    zoomAt(size.w / 2, size.h / 2, next);
  };

  // Theo dõi kích thước vùng vẽ: giữ nguyên tâm khi khung to / nhỏ lại (bấm Phóng to, đổi cỡ cửa sổ…)
  useLayoutEffect(() => {
    const el = wrapRef.current;
    const root = rootRef.current;
    if (!root) return;
    let prev = { w: el?.clientWidth ?? 0, h: el?.clientHeight ?? 0 };
    if (el) setSize(prev);
    setRootW(root.clientWidth);
    const ro = new ResizeObserver(() => {
      setRootW(root.clientWidth);
      if (!el) return;
      const cur = { w: el.clientWidth, h: el.clientHeight };
      const dx = (cur.w - prev.w) / 2;
      const dy = (cur.h - prev.h) / 2;
      prev = cur;
      setSize(cur);
      if (autoFit.current && inited.current) requestAnimationFrame(() => fitView('init'));
      else if (cur.w && cur.h && (dx || dy)) setView(v => ({ ...v, x: v.x + dx, y: v.y + dy }));
    });
    if (el) ro.observe(el);
    ro.observe(root);
    return () => ro.disconnect();
  }, [mode, fitView]);

  useLayoutEffect(() => {
    if (!inited.current && size.w > 0 && size.h > 0) {
      inited.current = true;
      fitView('init');
    }
  }, [size, fitView]);

  // Kéo khung nhìn tới chủ đề vừa chọn bằng bàn phím / vừa thêm
  useEffect(() => {
    if (!reveal) return;
    const b = layout.byId.get(reveal);
    setReveal(null);
    if (!b || !size.w) return;
    const m = 48;
    setView(v => {
      const sx1 = b.bx * v.z + v.x;
      const sy1 = b.by * v.z + v.y;
      const sx2 = (b.bx + b.bw) * v.z + v.x;
      const sy2 = (b.by + b.bh) * v.z + v.y;
      let dx = 0;
      let dy = 0;
      if (sx1 < m) dx = m - sx1; else if (sx2 > size.w - m) dx = size.w - m - sx2;
      if (sy1 < m) dy = m - sy1; else if (sy2 > size.h - m) dy = size.h - m - sy2;
      return dx || dy ? { ...v, x: v.x + dx, y: v.y + dy } : v;
    });
  }, [reveal, layout, size]);

  // ── Chọn / sửa chữ ──
  const focusSink = useCallback(() => {
    if (mobile && !editingRef.current) return;
    taRef.current?.focus({ preventScroll: true });
  }, [mobile]);

  const select = useCallback((ids: string[], opts: { reveal?: boolean } = {}) => {
    setSel(ids);
    setSelRel(null);
    setSelBoundary(null);
    if (opts.reveal && ids[0]) setReveal(ids[ids.length - 1]);
  }, []);

  const primary = sel[sel.length - 1] ?? null;
  const topicSel = sel.filter(id => !!M.findTopic(doc, id));
  const selTopics = topicSel.map(id => M.findTopic(doc, id)!.topic);

  const textOf = (id: string) => M.findTopic(docRef.current, id)?.topic.text ?? M.findSummary(docRef.current, id)?.summary.text ?? '';

  const startEdit = (id: string, how: 'all' | 'end') => {
    if (readOnly || (!M.findTopic(docRef.current, id) && !M.findSummary(docRef.current, id))) return;
    const text = textOf(id);
    setSel([id]);
    setSelRel(null);
    setEditing(id);
    setDraft(text);
    const ta = taRef.current;
    if (!ta) return;
    ta.value = text;
    ta.focus({ preventScroll: true });
    if (how === 'all') ta.select();
    else ta.setSelectionRange(text.length, text.length);
  };

  const finishEdit = useCallback(() => {
    const id = editingRef.current;
    if (!id) return;
    const ta = taRef.current;
    const text = (ta?.value ?? '').replace(/\s+$/, '');
    editingRef.current = null;
    setEditing(null);
    setDraft('');
    if (ta) ta.value = '';
    const cur = M.findTopic(docRef.current, id)?.topic.text ?? M.findSummary(docRef.current, id)?.summary.text;
    if (cur !== undefined && text !== cur) commit(M.setText(docRef.current, id, text));
  }, [commit]);

  // ── Lệnh ──
  const run = {
    addChild: (fromId?: string | null) => {
      const pid = fromId ?? primary ?? doc.root.id;
      const r = M.addChild(docRef.current, M.findTopic(docRef.current, pid) ? pid : docRef.current.root.id);
      if (!r.id) return;
      commit(r.doc);
      select([r.id], { reveal: true });
      if (mobile) startEdit(r.id, 'all');
    },
    addSibling: (before = false) => {
      if (!primary || !M.findTopic(docRef.current, primary)) return run.addChild(docRef.current.root.id);
      const r = M.addSibling(docRef.current, primary, before);
      if (!r.id) return;
      commit(r.doc);
      select([r.id], { reveal: true });
      if (mobile) startEdit(r.id, 'all');
    },
    insertParent: () => {
      if (!primary) return;
      const r = M.insertParent(docRef.current, primary);
      if (!r.id) return;
      commit(r.doc);
      select([r.id], { reveal: true });
    },
    remove: () => {
      if (selRel) { commit(M.removeRelations(docRef.current, [selRel])); setSelRel(null); return; }
      if (selBoundary && sel.length === 1 && sel[0] === selBoundary) {
        commit(M.toggleBoundary(docRef.current, [selBoundary]));
        setSelBoundary(null);
        return;
      }
      if (!sel.length) return;
      const r = M.removeTopics(docRef.current, sel);
      if (r.doc === docRef.current) return;
      commit(r.doc);
      select(r.next ? [r.next] : [], { reveal: true });
    },
    collapse: (ids = topicSel) => commit(M.toggleCollapse(docRef.current, ids)),
    boundary: () => {
      const ids = topicSel.filter(id => id !== doc.root.id);
      if (!ids.length) { setToast('Chọn chủ đề (không phải chủ đề trung tâm) để thêm vùng bao'); return; }
      commit(M.toggleBoundary(docRef.current, ids));
    },
    summary: () => {
      const r = M.addSummary(docRef.current, topicSel);
      if (!r.id) { setToast('Chọn 1 hoặc nhiều chủ đề cùng cấp (không phải chủ đề trung tâm) để tóm tắt'); return; }
      commit(r.doc);
      startEdit(r.id, 'all');
    },
    relation: () => {
      if (!primary || !M.findTopic(docRef.current, primary)) { setToast('Chọn chủ đề bắt đầu, rồi bấm Liên kết'); return; }
      setLinkFrom(primary);
      setLinkPt(null);
    },
    style: (patch: { bold?: boolean; italic?: boolean }) => {
      if (!topicSel.length) return;
      const key = Object.keys(patch)[0] as 'bold' | 'italic';
      const allOn = selTopics.every(t => t.style?.[key]);
      commit(M.setStyle(docRef.current, topicSel, { [key]: allOn ? undefined : true }));
    },
    copy: (cut: boolean, e?: ClipboardEvent) => {
      if (!topicSel.length) return;
      const topics = M.copyTopics(docRef.current, topicSel);
      const text = M.topicsToText(topics);
      clip = { text, topics };
      if (e) { e.preventDefault(); e.clipboardData.setData('text/plain', text); }
      else void navigator.clipboard?.writeText(text).catch(() => {});
      if (cut) run.remove();
    },
    paste: (text: string | null) => {
      const parent = primary && M.findTopic(docRef.current, primary) ? primary : docRef.current.root.id;
      const topics = clip && (text === null || clip.text === text) ? clip.topics : text ? M.outlineToTopics(text) : [];
      if (!topics.length) return;
      const r = M.pasteTopics(docRef.current, parent, topics);
      commit(r.doc);
      select(r.ids, { reveal: true });
    },
    reorder: (delta: -1 | 1) => { if (primary) commit(M.reorder(docRef.current, primary, delta)); },
    floatingAt: (at: Pt) => {
      const r = M.addFloating(docRef.current, at);
      commit(r.doc);
      startEdit(r.id, 'all');
    },
  };

  const cycleMarker = (id: string, marker: string) => {
    const [g, v] = marker.split('-');
    let next: string | null = null;
    if (g === 'task') next = `task-${({ 0: 25, 25: 50, 50: 75, 75: 100, 100: 0 } as Record<string, number>)[v] ?? 0}`;
    if (g === 'priority') next = `priority-${(Number(v) % 6) + 1}`;
    if (next) commit(M.toggleMarker(docRef.current, [id], next));
  };

  // ── Bàn phím (ô gõ ẩn luôn giữ focus khi đang chọn chủ đề) ──
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    const mod = e.metaKey || e.ctrlKey;
    const k = e.key;
    const stop = () => { e.preventDefault(); e.stopPropagation(); };

    if (editing) {
      if (k === 'Enter' && !e.shiftKey && !mod) { stop(); finishEdit(); return; }
      if (k === 'Tab') { stop(); const id = editing; finishEdit(); run.addChild(id); return; }
      if (k === 'Escape') { stop(); finishEdit(); return; }
      e.stopPropagation();
      return;
    }
    if (readOnly) {
      if (mod && (k === '=' || k === '+')) { stop(); zoomStep(1); }
      else if (mod && k === '-') { stop(); zoomStep(-1); }
      else if (mod && k === '0') { stop(); fitView('fit'); }
      return;
    }
    if (k === 'Escape') {
      if (linkFrom) { stop(); setLinkFrom(null); return; }
      if (menu || exportOpen || help) { stop(); setMenu(null); setExportOpen(false); setHelp(false); return; }
      if (sel.length || selRel) { stop(); select([]); return; }
      return;
    }
    if (mod) {
      const lk = k.toLowerCase();
      if (lk === 'z') { stop(); if (e.shiftKey) redo(); else undo(); return; }
      if (lk === 'y') { stop(); redo(); return; }
      if (lk === 'a') { stop(); select(layout.boxes.filter(b => b.kind === 'topic').map(b => b.id)); return; }
      if (k === 'Enter') { stop(); run.insertParent(); return; }
      if (k === '/') { stop(); run.collapse(); return; }
      if (k === ']') { stop(); run.summary(); return; }
      if (lk === 'b' && e.shiftKey) { stop(); run.boundary(); return; }
      if (lk === 'b') { stop(); run.style({ bold: true }); return; }
      if (lk === 'i') { stop(); run.style({ italic: true }); return; }
      if (k === '=' || k === '+') { stop(); zoomStep(1); return; }
      if (k === '-') { stop(); zoomStep(-1); return; }
      if (k === '0') { stop(); fitView('fit'); return; }
      return;
    }
    if (k === 'Tab') { stop(); run.addChild(); return; }
    if (k === 'Enter') { stop(); run.addSibling(e.shiftKey); return; }
    if (k === 'Delete' || k === 'Backspace') { stop(); run.remove(); return; }
    if (k === 'F2' || (k === ' ' && primary)) { stop(); if (primary) startEdit(primary, k === 'F2' ? 'all' : 'end'); return; }
    if (k.startsWith('Arrow')) {
      stop();
      if (!primary) { select([doc.root.id]); return; }
      if (e.altKey && (k === 'ArrowUp' || k === 'ArrowDown')) { run.reorder(k === 'ArrowUp' ? -1 : 1); return; }
      const next = navigate(layout, primary, k as 'ArrowUp');
      if (next) {
        if (e.shiftKey) select([...sel.filter(x => x !== next), next], { reveal: true });
        else select([next], { reveal: true });
      }
    }
  };

  const onInput = () => {
    const ta = taRef.current;
    if (!ta) return;
    if (editingRef.current) { setDraft(ta.value); return; }
    // Chọn rồi gõ luôn = thay chữ của chủ đề (như XMind)
    if (!primary || readOnly || !layout.byId.has(primary)) { ta.value = ''; return; }
    editingRef.current = primary;
    setSel([primary]);
    setEditing(primary);
    setDraft(ta.value);
  };

  const onCompositionStart = () => {
    if (editingRef.current || !primary || readOnly || !layout.byId.has(primary)) return;
    editingRef.current = primary;
    setSel([primary]);
    setEditing(primary);
    setDraft('');
  };

  // ── Chuột / cảm ứng ──
  const toMap = (cx: number, cy: number): Pt => {
    const r = wrapRef.current!.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (cx - r.left - v.x) / v.z, y: (cy - r.top - v.y) / v.z };
  };
  const toLocal = (cx: number, cy: number): Pt => {
    const r = wrapRef.current!.getBoundingClientRect();
    return { x: cx - r.left, y: cy - r.top };
  };

  const computeDrop = (p: Pt, ids: string[]): Drop => {
    const d = docRef.current;
    const skip = new Set<string>();
    ids.forEach(id => { const r = M.findTopic(d, id); if (r) M.subtreeIds(r.topic, skip); });
    layout.boxes.forEach(b => { if (b.kind === 'summary') skip.add(b.id); });
    const hit = hitTest(layout, p, 10, skip);
    if (!hit) return { type: 'float', at: p };
    if (hit.depth === 0 || !hit.parentId) return { type: 'child', target: hit.id };
    const horizontal = hit.link === 'd';
    const rel = horizontal ? (p.x - hit.bx) / hit.bw : (p.y - hit.by) / hit.bh;
    let type: 'child' | 'before' | 'after' = rel < 0.28 ? 'before' : rel > 0.72 ? 'after' : 'child';
    // Bên trái của sơ đồ toả 2 bên xếp ngược (theo chiều kim đồng hồ) → đảo trước / sau
    if (type !== 'child' && d.structure === 'map' && hit.parentId === d.root.id && hit.side < 0) type = type === 'before' ? 'after' : 'before';
    return { type, target: hit.id };
  };

  const applyDrop = (ids: string[], drop: Drop, grab: Pt, primaryId: string) => {
    const d = docRef.current;
    if (drop.type === 'float') {
      const b = layout.byId.get(primaryId);
      const at = { x: drop.at.x - grab.x + (b?.bw ?? 0) / 2, y: drop.at.y - grab.y + (b?.bh ?? 0) / 2 };
      const allFloating = ids.every(id => d.floating.some(f => f.id === id));
      if (allFloating) {
        const pb = d.floating.find(f => f.id === primaryId)?.pos ?? at;
        const dx = at.x - pb.x;
        const dy = at.y - pb.y;
        commit(M.setFloatingPos(d, ids.map(id => { const f = d.floating.find(x => x.id === id)!; return { id, x: (f.pos?.x ?? 0) + dx, y: (f.pos?.y ?? 0) + dy }; })));
      } else {
        commit(M.makeFloating(d, ids, at));
      }
      return;
    }
    if (drop.type === 'child') { commit(M.moveTopics(d, ids, drop.target)); return; }
    const r = M.findTopic(d, drop.target);
    if (!r?.parent) return;
    commit(M.moveTopics(d, ids, r.parent.id, r.index + (drop.type === 'after' ? 1 : 0)));
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.target === taRef.current) return;
    if (e.target instanceof Element && e.target.closest('[data-ui]')) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    setMenu(null);
    setExportOpen(false);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { wrapRef.current?.setPointerCapture(e.pointerId); } catch { /* bỏ qua */ }

    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      drag.current = { kind: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y), mid0: toLocal((a.x + b.x) / 2, (a.y + b.y) / 2), v0: viewRef.current };
      setDragUI(null);
      return;
    }
    if (e.pointerType === 'mouse') e.preventDefault();
    if (editingRef.current) finishEdit();

    const p = toMap(e.clientX, e.clientY);
    const hit = parseHit(e.target);
    const d = docRef.current;

    // Bấm đúp tự nhận (bắt con trỏ làm sự kiện dblclick mất đích thật)
    const now = Date.now();
    const key = hit ? `${hit.kind}:${hit.id}` : 'blank';
    const last = lastDown.current;
    if (!linkFrom && last && last.key === key && now - last.t < 420 && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 8) {
      lastDown.current = null;
      drag.current = null;
      onDouble(hit, p);
      return;
    }
    lastDown.current = { key, t: now, x: e.clientX, y: e.clientY };

    if (linkFrom) {
      if (hit && (hit.kind === 'topic' || hit.kind === 'marker' || hit.kind === 'icon') && hit.id !== linkFrom && M.findTopic(d, hit.id)) {
        const r = M.addRelation(d, linkFrom, hit.id);
        if (r.id) { commit(r.doc); setSel([]); setSelRel(r.id); }
      }
      setLinkFrom(null);
      setLinkPt(null);
      focusSink();
      return;
    }

    if (hit?.kind === 'toggle') { if (!readOnly) commit(M.toggleCollapse(d, [hit.id])); focusSink(); return; }
    if (hit?.kind === 'icon') {
      select([hit.id]);
      const t = M.findTopic(d, hit.id)?.topic;
      if (hit.extra === 'link' && t?.link) window.open(t.link, '_blank', 'noopener,noreferrer');
      else setPanel('note');
      focusSink();
      return;
    }
    if (hit?.kind === 'marker' && hit.extra) {
      if (!readOnly && sel.length === 1 && sel[0] === hit.id) cycleMarker(hit.id, hit.extra);
      else select([hit.id]);
      focusSink();
      return;
    }
    if (hit?.kind === 'rel') { setSel([]); setSelBoundary(null); setSelRel(hit.id); focusSink(); return; }
    if (hit?.kind === 'boundary') { setSel([hit.id]); setSelRel(null); setSelBoundary(hit.id); focusSink(); return; }

    if (hit?.kind === 'topic') {
      const id = hit.id;
      if (e.shiftKey || e.metaKey || e.ctrlKey) {
        select(sel.includes(id) ? sel.filter(x => x !== id) : [...sel, id]);
        focusSink();
        return;
      }
      const ids = sel.includes(id) ? sel : [id];
      if (!sel.includes(id) || selRel || selBoundary) select(ids);
      const b = layout.byId.get(id)!;
      const movable = ids.filter(x => layout.byId.get(x)?.kind === 'topic' && x !== d.root.id);
      drag.current = {
        kind: 'topic', pointerId: e.pointerId, ids: movable.includes(id) ? movable : [id], primary: id,
        grab: { x: p.x - b.bx, y: p.y - b.by }, sx: e.clientX, sy: e.clientY, moved: false, drop: null,
      };
      focusSink();
      return;
    }

    if (e.shiftKey && e.pointerType === 'mouse') {
      drag.current = { kind: 'marquee', pointerId: e.pointerId, start: p, additive: true };
      setMarquee({ a: p, b: p });
    } else {
      drag.current = { kind: 'pan', pointerId: e.pointerId, sx: e.clientX, sy: e.clientY, vx: viewRef.current.x, vy: viewRef.current.y, moved: false };
    }
    focusSink();
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const dr = drag.current;
    if (dr?.kind === 'pinch') {
      if (pointers.current.size < 2) return;
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = toLocal((a.x + b.x) / 2, (a.y + b.y) / 2);
      autoFit.current = false;
      const z = clampZ(dr.v0.z * (dist / (dr.d0 || 1)));
      const mx = (dr.mid0.x - dr.v0.x) / dr.v0.z;
      const my = (dr.mid0.y - dr.v0.y) / dr.v0.z;
      setView({ z, x: mid.x - mx * z, y: mid.y - my * z });
      return;
    }
    if (linkFrom) setLinkPt(toMap(e.clientX, e.clientY));
    if (!dr || dr.pointerId !== e.pointerId) {
      if (e.pointerType === 'mouse') {
        const h = parseHit(e.target);
        const id = h && (h.kind === 'topic' || h.kind === 'toggle' || h.kind === 'marker' || h.kind === 'icon') ? h.id : null;
        if (id !== hover) setHover(id);
      }
      return;
    }
    if (dr.kind === 'pan') {
      const dx = e.clientX - dr.sx;
      const dy = e.clientY - dr.sy;
      if (!dr.moved && Math.hypot(dx, dy) < 3) return;
      dr.moved = true;
      autoFit.current = false;
      setView(v => ({ ...v, x: dr.vx + dx, y: dr.vy + dy }));
      return;
    }
    const p = toMap(e.clientX, e.clientY);
    if (dr.kind === 'marquee') { setMarquee({ a: dr.start, b: p }); return; }
    if (dr.kind === 'topic') {
      if (!dr.moved) {
        if (Math.hypot(e.clientX - dr.sx, e.clientY - dr.sy) < 5) return;
        if (readOnly || dr.primary === docRef.current.root.id || layout.byId.get(dr.primary)?.kind === 'summary') {
          drag.current = { kind: 'pan', pointerId: dr.pointerId, sx: dr.sx, sy: dr.sy, vx: viewRef.current.x, vy: viewRef.current.y, moved: true };
          return;
        }
        dr.moved = true;
      }
      dr.drop = computeDrop(p, dr.ids);
      setDragUI({ ids: dr.ids, primary: dr.primary, cur: p, grab: dr.grab, drop: dr.drop });
    }
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    const dr = drag.current;
    if (dr?.kind === 'pinch') {
      if (pointers.current.size < 2) drag.current = null;
      return;
    }
    if (!dr || dr.pointerId !== e.pointerId) return;
    drag.current = null;
    if (dr.kind === 'pan') {
      if (!dr.moved && e.type === 'pointerup') { select([]); setLinkFrom(null); }
    } else if (dr.kind === 'marquee') {
      setMarquee(null);
      const p = toMap(e.clientX, e.clientY);
      const x1 = Math.min(dr.start.x, p.x); const x2 = Math.max(dr.start.x, p.x);
      const y1 = Math.min(dr.start.y, p.y); const y2 = Math.max(dr.start.y, p.y);
      const hits = layout.boxes.filter(b => b.bx < x2 && b.bx + b.bw > x1 && b.by < y2 && b.by + b.bh > y1).map(b => b.id);
      select([...new Set([...(dr.additive ? sel : []), ...hits])]);
    } else if (dr.kind === 'topic') {
      setDragUI(null);
      if (dr.moved && dr.drop && e.type === 'pointerup') {
        applyDrop(dr.ids, dr.drop, dr.grab, dr.primary);
      }
    }
  };

  const onDouble = (hit: ReturnType<typeof parseHit>, p: Pt) => {
    if (readOnly) return;
    if (hit?.kind === 'topic' || hit?.kind === 'marker') { startEdit(hit.id, 'all'); return; }
    if (hit?.kind === 'rel') { setSel([]); setSelRel(hit.id); setPanel('style'); return; }
    if (hit?.kind === 'boundary') { setSel([hit.id]); setSelBoundary(hit.id); setPanel('style'); return; }
    if (!hit) run.floatingAt(p);
  };

  const onContextMenu = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (e.target instanceof Element && e.target.closest('[data-ui]')) return;
    e.preventDefault();
    if (readOnly) return;
    if (editingRef.current) finishEdit();
    const hit = parseHit(e.target);
    const local = toLocal(e.clientX, e.clientY);
    const onTopic = !!hit && (hit.kind === 'topic' || hit.kind === 'marker' || hit.kind === 'icon') && layout.byId.has(hit.id);
    if (onTopic && !sel.includes(hit!.id)) select([hit!.id]);
    if (!onTopic) select([]);
    setMenu({ x: local.x, y: local.y, at: toMap(e.clientX, e.clientY), onTopic });
    focusSink();
  };

  // Cuộn = di chuyển; Ctrl/⌘ + cuộn (hoặc chụm trên touchpad) = phóng to quanh con trỏ
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.target instanceof Element && e.target.closest('[data-ui]')) return;
      e.preventDefault();
      autoFit.current = false;
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        const v = viewRef.current;
        const k = e.deltaMode === 1 ? 0.05 : 0.0025;
        zoomAt(e.clientX - r.left, e.clientY - r.top, v.z * Math.exp(-e.deltaY * k));
      } else {
        const k = e.deltaMode === 1 ? 18 : 1;
        setView(v => ({ ...v, x: v.x - e.deltaX * k, y: v.y - e.deltaY * k }));
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [mode, zoomAt]);

  // Lần đầu mở: giữ focus để gõ / dùng phím ngay
  useEffect(() => {
    if (!mobile && mode === 'map') setTimeout(() => taRef.current?.focus({ preventScroll: true }), 0);
  }, [mobile, mode]);

  // ── Xuất ──
  const doExport = async (kind: 'png' | 'svg' | 'pdf' | 'md' | 'copy' | 'toNote' | 'fromText') => {
    setExportOpen(false);
    if (editingRef.current) { finishEdit(); await new Promise(r => setTimeout(r, 40)); }
    const name = props.title || doc.root.text || 'Sơ đồ tư duy';
    try {
      if (kind === 'md') { exportMarkdown(docRef.current, name); return; }
      if (kind === 'copy') {
        await navigator.clipboard.writeText(docToMarkdown(docRef.current));
        setToast('Đã sao chép dàn ý (Markdown)');
        return;
      }
      if (kind === 'toNote') {
        props.onCreateNote?.(M.docToOutline(docRef.current));
        return;
      }
      if (kind === 'fromText') {
        const next = M.docFromText(props.seedText);
        commit({ ...next, theme: docRef.current.theme, structure: docRef.current.structure, line: docRef.current.line, font: docRef.current.font, rainbow: docRef.current.rainbow, compact: docRef.current.compact });
        select([next.root.id]);
        setTimeout(() => fitView('init'), 30);
        setToast(`Đã dựng lại sơ đồ từ chữ gốc (${MOD}Z để hoàn tác)`);
        return;
      }
      if (mode !== 'map') { setMode('map'); await new Promise(r => setTimeout(r, 60)); }
      const g = contentRef.current;
      if (!g) return;
      const l = layoutRef.current;
      if (kind === 'png') await exportPng(g, l.bounds, theme.bg, name);
      else if (kind === 'svg') exportSvg(g, l.bounds, theme.bg, name);
      else await exportPdf(g, l.bounds, theme.bg, name);
    } catch (err) {
      setToast(`Không xuất được: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const toggleFullscreen = () => {
    const el = rootRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.().catch(() => setToast('Trình duyệt không cho mở toàn màn hình'));
  };

  // ── Vẽ lớp giao diện (chọn, kéo thả…) ──
  const z = view.z;
  const outline = (b: TopicBox, color: string, opacity = 1, extra = 4) => (b.shape === 'ellipse'
    ? <ellipse key={`o-${b.id}`} cx={b.bx + b.bw / 2} cy={b.by + b.bh / 2} rx={b.bw / 2 + extra} ry={b.bh / 2 + extra} fill="none" stroke={color} strokeWidth={2 / z} opacity={opacity} />
    : <rect key={`o-${b.id}`} x={b.bx - extra} y={b.by - extra} width={b.bw + extra * 2} height={b.bh + extra * 2} rx={shapeRadius(b) + extra} fill="none" stroke={color} strokeWidth={2 / z} opacity={opacity} />);

  const dragPrimary = dragUI ? layout.byId.get(dragUI.primary) : null;
  const dropTarget = dragUI?.drop && dragUI.drop.type !== 'float' ? layout.byId.get(dragUI.drop.target) : null;
  const selRelShape = selRel ? layout.relations.find(r => r.id === selRel) : null;
  const selBd = selBoundary ? layout.boundaries.find(b => b.id === selBoundary) : null;
  const editBox = editing ? layout.byId.get(editing) : null;
  const caretBox = editBox ?? (primary ? layout.byId.get(primary) : null);
  const wide = rootW >= 1060;
  const count = useMemo(() => M.countTopics(doc), [doc]);

  const uiLayer = (
    <g data-layer="ui">
      {hover && !sel.includes(hover) && !dragUI && layout.byId.get(hover) && outline(layout.byId.get(hover)!, SELECT_COLOR, 0.35)}
      {sel.map(id => layout.byId.get(id)).filter((b): b is TopicBox => !!b).map(b => outline(b, SELECT_COLOR))}
      {!readOnly && layout.boxes.filter(b => b.toggle && b.hidden === 0 && (b.id === hover || sel.includes(b.id))).map(b => (
        <g key={`t-${b.id}`} data-hit={`toggle:${b.id}`} style={{ cursor: 'pointer' }}>
          <circle cx={b.toggle!.x} cy={b.toggle!.y} r={7.5} fill={theme.bg} stroke={b.color} strokeWidth={1.5} />
          <path d={`M${b.toggle!.x - 3.5},${b.toggle!.y}H${b.toggle!.x + 3.5}`} stroke={b.color} strokeWidth={1.8} strokeLinecap="round" />
        </g>
      ))}
      {selRelShape && (
        <g pointerEvents="none">
          <path d={selRelShape.d} fill="none" stroke={SELECT_COLOR} strokeWidth={3 / z} opacity={0.5} />
          <circle cx={selRelShape.s.x} cy={selRelShape.s.y} r={4 / z} fill={SELECT_COLOR} />
          <circle cx={selRelShape.e.x} cy={selRelShape.e.y} r={4 / z} fill={SELECT_COLOR} />
        </g>
      )}
      {selBd && <rect x={selBd.x - 2} y={selBd.y - 2} width={selBd.w + 4} height={selBd.h + 4} rx={16} fill="none" stroke={SELECT_COLOR} strokeWidth={2 / z} pointerEvents="none" />}
      {dropTarget && dragUI?.drop && dragUI.drop.type === 'child' && (
        <rect x={dropTarget.bx - 6} y={dropTarget.by - 6} width={dropTarget.bw + 12} height={dropTarget.bh + 12} rx={shapeRadius(dropTarget) + 6}
          fill={SELECT_COLOR} fillOpacity={0.1} stroke={SELECT_COLOR} strokeWidth={2.5 / z} pointerEvents="none" />
      )}
      {dropTarget && dragUI?.drop && dragUI.drop.type !== 'child' && dragUI.drop.type !== 'float' && (() => {
        const horizontal = dropTarget.link === 'd';
        const visualBefore = (dragUI.drop.type === 'before') !== (doc.structure === 'map' && dropTarget.parentId === doc.root.id && dropTarget.side < 0);
        return horizontal
          ? <path d={`M${visualBefore ? dropTarget.bx - 7 : dropTarget.bx + dropTarget.bw + 7},${dropTarget.by - 4}v${dropTarget.bh + 8}`} stroke={SELECT_COLOR} strokeWidth={3.5 / z} strokeLinecap="round" pointerEvents="none" />
          : <path d={`M${dropTarget.bx - 4},${visualBefore ? dropTarget.by - 6 : dropTarget.by + dropTarget.bh + 6}h${dropTarget.bw + 8}`} stroke={SELECT_COLOR} strokeWidth={3.5 / z} strokeLinecap="round" pointerEvents="none" />;
      })()}
      {dragUI && dragPrimary && (
        <g transform={`translate(${dragUI.cur.x - dragUI.grab.x - dragPrimary.bx} ${dragUI.cur.y - dragUI.grab.y - dragPrimary.by})`} opacity={0.72} pointerEvents="none">
          <rect x={dragPrimary.bx} y={dragPrimary.by} width={dragPrimary.bw} height={dragPrimary.bh} rx={shapeRadius(dragPrimary)}
            fill={dragPrimary.fill && dragPrimary.fill !== 'transparent' ? dragPrimary.fill : theme.bg} stroke={SELECT_COLOR} strokeWidth={1.5 / z} />
          <TopicText b={dragPrimary} />
          {dragUI.ids.length > 1 && (
            <g>
              <circle cx={dragPrimary.bx + dragPrimary.bw} cy={dragPrimary.by} r={10} fill={SELECT_COLOR} />
              <text x={dragPrimary.bx + dragPrimary.bw} y={dragPrimary.by + 4} textAnchor="middle" fontSize={11} fontWeight={700} fill="#fff">{dragUI.ids.length}</text>
            </g>
          )}
        </g>
      )}
      {linkFrom && linkPt && layout.byId.get(linkFrom) && (() => {
        const b = layout.byId.get(linkFrom)!;
        return <path d={`M${b.bx + b.bw / 2},${b.by + b.bh / 2}L${linkPt.x},${linkPt.y}`} stroke={theme.relation} strokeWidth={1.8 / z} strokeDasharray={`${6 / z} ${5 / z}`} pointerEvents="none" />;
      })()}
      {marquee && (
        <rect x={Math.min(marquee.a.x, marquee.b.x)} y={Math.min(marquee.a.y, marquee.b.y)} width={Math.abs(marquee.b.x - marquee.a.x)} height={Math.abs(marquee.b.y - marquee.a.y)}
          fill={SELECT_COLOR} fillOpacity={0.08} stroke={SELECT_COLOR} strokeWidth={1 / z} pointerEvents="none" />
      )}
    </g>
  );

  // Ô gõ: khi đang sửa thì nằm đúng chỗ chữ của chủ đề; khi không sửa thì ẩn nhưng vẫn giữ focus để bắt phím
  const taStyle: CSSProperties = caretBox && editBox ? {
    left: view.x + (editBox.textCx - editBox.textW / 2) * z - 3 * z,
    top: view.y + editBox.textTop * z,
    width: (editBox.textW + 6) * z + 2,
    height: editBox.lines.length * editBox.lineH * z + 2,
    font: `${editBox.italic ? 'italic ' : ''}${editBox.weight} ${editBox.size * z}px ${editBox.family}`,
    lineHeight: `${editBox.lineH * z}px`,
    color: editBox.textColor,
    caretColor: editBox.textColor,
    textAlign: 'center',
    opacity: 1,
  } : {
    left: caretBox ? view.x + caretBox.textCx * z : 0,
    top: caretBox ? view.y + caretBox.textTop * z : 0,
    width: 2,
    height: 20,
    opacity: 0,
    pointerEvents: 'none',
  };

  const menuItem = (label: string, onClick: () => void, opts: { kbd?: string; danger?: boolean; disabled?: boolean } = {}) => (
    <button key={label} type="button" disabled={opts.disabled} onMouseDown={e => e.preventDefault()}
      onClick={() => { setMenu(null); onClick(); focusSink(); }}
      className={`w-full flex items-center gap-3 px-3 h-8 text-left text-[13px] rounded-md disabled:opacity-35 ${opts.danger ? 'text-[#D70015] hover:bg-[#FF3B30]/10' : 'hover:bg-[#2C7BF6] hover:text-white'}`}>
      <span className="flex-1">{label}</span>
      {opts.kbd && <span className="text-[11px] opacity-55">{opts.kbd}</span>}
    </button>
  );

  const toolbar = (
    <div className="flex items-center gap-0.5 px-2 h-11 shrink-0 border-b border-black/[0.07] bg-white/80 backdrop-blur overflow-x-auto text-[#1D1D1F]" style={{ scrollbarWidth: 'none' }}>
      {!readOnly && (
        <>
          <TB wide={wide} title="Thêm chủ đề cùng cấp (Enter)" label="Chủ đề" onClick={() => run.addSibling()}><Plus size={16} /></TB>
          <TB wide={wide} title="Thêm chủ đề con (Tab)" label="Chủ đề con" onClick={() => run.addChild()}><GitBranchPlus size={16} /></TB>
          <Sep />
          <TB wide={wide} title="Đường liên kết: chọn chủ đề → bấm đây → bấm chủ đề đích" label="Liên kết" active={!!linkFrom} onClick={() => (linkFrom ? setLinkFrom(null) : run.relation())}><Spline size={16} /></TB>
          <TB wide={wide} title={`Tóm tắt các chủ đề đang chọn (${MOD}])`} label="Tóm tắt" onClick={run.summary}><Braces size={16} /></TB>
          <TB wide={wide} title={`Vùng bao (${MOD}⇧B)`} label="Vùng bao" onClick={run.boundary}><BoxSelect size={16} /></TB>
          <Sep />
          <TB wide={wide} title="Biểu tượng: ưu tiên, tiến độ, cờ…" label="Biểu tượng" active={panel === 'marker'} onClick={() => setPanel(p => (p === 'marker' ? null : 'marker'))}><Smile size={16} /></TB>
          <TB wide={wide} title="Ghi chú cho chủ đề" label="Ghi chú" active={panel === 'note'} onClick={() => setPanel(p => (p === 'note' ? null : 'note'))}><StickyNote size={16} /></TB>
          <Sep />
          <TB wide={false} title={`Hoàn tác (${MOD}Z)`} disabled={!undoStack.current.length} onClick={undo}><Undo2 size={16} /></TB>
          <TB wide={false} title={`Làm lại (${MOD}⇧Z)`} disabled={!redoStack.current.length} onClick={redo}><Redo2 size={16} /></TB>
        </>
      )}
      <span className="flex-1 min-w-2" />
      <div className="shrink-0 flex p-0.5 rounded-lg bg-black/[0.05]">
        {([['map', Network, 'Sơ đồ'], ['outline', ListTree, 'Dàn ý']] as const).map(([k, Icon, label]) => (
          <button key={k} type="button" title={k === 'map' ? 'Xem dạng sơ đồ' : 'Xem dạng dàn ý (như Outliner của XMind)'} onMouseDown={e => e.preventDefault()}
            onClick={() => { if (editingRef.current) finishEdit(); setMode(k); }}
            className={`inline-flex items-center gap-1 h-7 px-2 rounded-md text-[12px] font-medium ${mode === k ? 'bg-white shadow-[0_1px_2px_rgba(0,0,0,0.12)]' : 'text-[#6E6E73] hover:text-[#1D1D1F]'}`}>
            <Icon size={14} />{wide && label}
          </button>
        ))}
      </div>
      {!readOnly && <TB wide={wide} title="Định dạng chủ đề & bản đồ" label="Định dạng" active={panel === 'style' || panel === 'map'} onClick={() => setPanel(p => (p === 'style' || p === 'map' ? null : sel.length || selRel ? 'style' : 'map'))}><Paintbrush size={16} /></TB>}
      <div className="relative shrink-0">
        <TB wide={wide} title="Xuất ảnh / PDF / Markdown" label="Xuất" active={exportOpen} onClick={() => setExportOpen(o => !o)}><Download size={16} />{wide && <ChevronDown size={12} className="-ml-1" />}</TB>
      </div>
      {typeof document !== 'undefined' && document.fullscreenEnabled && (
        <TB wide={false} title={fullscreen ? 'Thoát toàn màn hình (Esc)' : 'Toàn màn hình'} onClick={toggleFullscreen}>{fullscreen ? <Minimize size={15} /> : <Maximize size={15} />}</TB>
      )}
      {!mobile && <TB wide={false} title="Phím tắt" active={help} onClick={() => setHelp(h => !h)}><HelpCircle size={16} /></TB>}
    </div>
  );

  const shortcuts: [string, string][] = [
    ['Tab', 'Thêm chủ đề con'], ['Enter / ⇧Enter', 'Chủ đề cùng cấp sau / trước'], [`${MOD}Enter`, 'Chèn chủ đề cha'],
    ['Gõ chữ · F2 · Space · bấm đúp', 'Sửa chữ (⇧Enter: xuống dòng)'], ['Delete', 'Xoá'], ['← ↑ → ↓', 'Di chuyển giữa các chủ đề'],
    ['Alt ↑ / ↓', 'Đổi thứ tự'], [`${MOD}/`, 'Thu gọn / mở nhánh'], [`${MOD}Z · ${MOD}⇧Z`, 'Hoàn tác · làm lại'],
    [`${MOD}C · ${MOD}X · ${MOD}V`, 'Sao chép · cắt · dán (dán chữ nhiều dòng thành nhánh)'], [`${MOD}]`, 'Tóm tắt'], [`${MOD}⇧B`, 'Vùng bao'],
    [`${MOD}B · ${MOD}I`, 'Đậm · nghiêng'], [`${MOD}+ · ${MOD}− · ${MOD}0`, 'Phóng to · thu nhỏ · vừa màn hình'],
    ['Kéo chủ đề', 'Đổi chỗ / đổi cha · thả chỗ trống = chủ đề tự do'], ['Kéo nền · cuộn', 'Di chuyển sơ đồ'],
    ['⇧ + kéo nền', 'Chọn nhiều chủ đề'], [`${MOD} + cuộn · chụm 2 ngón`, 'Phóng to / thu nhỏ'], ['Bấm đúp chỗ trống', 'Chủ đề tự do'],
  ];

  return (
    <div ref={rootRef} className="relative flex flex-col h-full min-h-0 w-full" style={{ background: theme.bg }}>
      {toolbar}
      {props.saveError && (
        <div className="flex items-start gap-2 px-3 py-1.5 shrink-0 bg-[#FFF4CE] text-[#7A5600] text-[12px] border-b border-[#F0DA8A]">
          <AlertCircle size={13} className="mt-0.5 shrink-0" />
          <span className="flex-1">Sơ đồ chưa lưu được lên máy chủ: {props.saveError} — đừng đóng trang, app sẽ tự thử lại.</span>
        </div>
      )}
      <div className="flex-1 min-h-0 flex relative">
        {mode === 'map' ? (
          <div ref={wrapRef} className="relative flex-1 min-w-0 overflow-hidden select-none"
            style={{ background: theme.bg, touchAction: 'none', cursor: linkFrom ? 'crosshair' : 'default' }}
            onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
            onPointerLeave={() => { if (hover) setHover(null); }}
            onMouseDown={e => { if (e.target !== taRef.current && !(e.target instanceof Element && e.target.closest('[data-ui]'))) e.preventDefault(); }}
            onContextMenu={onContextMenu}>
            <svg className="absolute inset-0 block w-full h-full" style={{ overflow: 'visible' }}>
              <g transform={`translate(${view.x} ${view.y}) scale(${z})`}>
                <g ref={contentRef}><MapContent layout={layout} theme={theme} editingId={editing} /></g>
                {uiLayer}
              </g>
            </svg>

            <textarea ref={taRef} aria-label="Chữ của chủ đề" spellCheck={!!editing} autoComplete="off" autoCorrect="off" rows={1}
              onKeyDown={onKeyDown} onInput={onInput} onCompositionStart={onCompositionStart}
              onBlur={() => { if (editingRef.current) finishEdit(); }}
              onCopy={e => { if (!editing) run.copy(false, e); }}
              onCut={e => { if (!editing && !readOnly) run.copy(true, e); }}
              onPaste={e => { if (editing || readOnly) return; e.preventDefault(); run.paste(e.clipboardData.getData('text/plain')); }}
              className="absolute z-[2] resize-none overflow-hidden bg-transparent outline-none border-0 p-0 m-0 whitespace-pre-wrap break-words"
              style={taStyle} />

            {linkFrom && (
              <div data-ui className="absolute top-3 left-1/2 -translate-x-1/2 z-[3] flex items-center gap-2 h-8 pl-3 pr-1 rounded-full bg-[#1D1D1F]/85 text-white text-[12.5px] shadow-lg">
                Bấm vào chủ đề cần nối tới
                <button type="button" onClick={() => setLinkFrom(null)} className="h-6 px-2 rounded-full bg-white/15 hover:bg-white/25">Huỷ</button>
              </div>
            )}

            {menu && (
              <div data-ui className="absolute z-[5] w-[230px] p-1 rounded-xl bg-white/95 backdrop-blur-xl text-[#1D1D1F] shadow-[0_0_0_0.5px_rgba(0,0,0,0.12),0_12px_32px_-8px_rgba(0,0,0,0.35)]"
                style={{
                  left: Math.max(8, Math.min(menu.x, size.w - 238)),
                  top: Math.max(8, Math.min(menu.y, size.h - (menu.onTopic ? 520 : 215) - 8)),
                  maxHeight: size.h - 16,
                  overflowY: 'auto',
                }}
                onPointerDown={e => e.stopPropagation()}>
                {menu.onTopic ? (
                  <>
                    {menuItem('Thêm chủ đề con', () => run.addChild(), { kbd: 'Tab' })}
                    {menuItem('Thêm chủ đề cùng cấp', () => run.addSibling(), { kbd: 'Enter' })}
                    {menuItem('Chèn chủ đề cha', run.insertParent, { kbd: `${MOD}↵`, disabled: primary === doc.root.id })}
                    <div className="h-px bg-black/[0.07] my-1" />
                    {menuItem('Sửa chữ', () => primary && startEdit(primary, 'all'), { kbd: 'F2' })}
                    {menuItem(selTopics.some(t => t.collapsed) ? 'Mở nhánh' : 'Thu gọn nhánh', () => run.collapse(), { kbd: `${MOD}/`, disabled: !selTopics.some(t => t.children.length) })}
                    {menuItem('Sao chép', () => run.copy(false), { kbd: `${MOD}C` })}
                    {menuItem('Cắt', () => run.copy(true), { kbd: `${MOD}X`, disabled: primary === doc.root.id })}
                    {menuItem('Dán', () => run.paste(null), { kbd: `${MOD}V`, disabled: !clip })}
                    <div className="h-px bg-black/[0.07] my-1" />
                    {menuItem('Đường liên kết tới…', run.relation)}
                    {menuItem('Tóm tắt', run.summary, { kbd: `${MOD}]` })}
                    {menuItem('Vùng bao', run.boundary, { kbd: `${MOD}⇧B` })}
                    {menuItem('Biểu tượng…', () => setPanel('marker'))}
                    {menuItem('Ghi chú…', () => setPanel('note'))}
                    {menuItem('Định dạng…', () => setPanel('style'))}
                    <div className="h-px bg-black/[0.07] my-1" />
                    {menuItem('Xoá', run.remove, { kbd: 'Del', danger: true, disabled: sel.length === 1 && primary === doc.root.id })}
                  </>
                ) : (
                  <>
                    {menuItem('Thêm chủ đề tự do ở đây', () => run.floatingAt(menu.at))}
                    {menuItem('Dán', () => run.paste(null), { kbd: `${MOD}V`, disabled: !clip })}
                    <div className="h-px bg-black/[0.07] my-1" />
                    {menuItem('Mở hết các nhánh', () => commit(M.collapseToLevel(docRef.current, Infinity)))}
                    {menuItem('Chỉ hiện chủ đề chính', () => commit(M.collapseToLevel(docRef.current, 1)))}
                    {menuItem('Vừa màn hình', () => fitView('fit'), { kbd: `${MOD}0` })}
                    {menuItem('Định dạng bản đồ…', () => setPanel('map'))}
                  </>
                )}
              </div>
            )}

            <div data-ui className="absolute right-3 bottom-3 z-[3] flex items-center gap-0.5 p-1 rounded-xl bg-white/90 backdrop-blur shadow-[0_0_0_0.5px_rgba(0,0,0,0.1),0_4px_14px_-4px_rgba(0,0,0,0.25)] text-[#1D1D1F]">
              <button type="button" title={`Thu nhỏ (${MOD}−)`} onClick={() => zoomStep(-1)} className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-black/[0.06]"><ZoomOut size={15} /></button>
              <button type="button" title="Về 100%" onClick={() => { autoFit.current = false; zoomAt(size.w / 2, size.h / 2, 1); }} className="min-w-[46px] h-7 px-1 rounded-lg text-[12px] font-medium tabular-nums hover:bg-black/[0.06]">{Math.round(z * 100)}%</button>
              <button type="button" title={`Phóng to (${MOD}+)`} onClick={() => zoomStep(1)} className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-black/[0.06]"><ZoomIn size={15} /></button>
              <button type="button" title={`Vừa màn hình (${MOD}0)`} onClick={() => fitView('fit')} className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-black/[0.06]"><Scan size={15} /></button>
            </div>
            <div className="absolute left-3 bottom-3 z-[1] text-[11.5px] pointer-events-none" style={{ color: theme.muted }}>
              {count} chủ đề{sel.length > 1 ? ` · đang chọn ${sel.length}` : ''}
            </div>

            {mobile && !readOnly && primary && !editing && layout.byId.has(primary) && (
              <div data-ui className="absolute left-2 right-2 bottom-14 z-[4] flex items-center justify-around gap-1 p-1 rounded-2xl bg-white/95 backdrop-blur shadow-[0_0_0_0.5px_rgba(0,0,0,0.1),0_8px_24px_-8px_rgba(0,0,0,0.35)] text-[#1D1D1F]">
                {([
                  ['Con', () => run.addChild(), <GitBranchPlus key="a" size={18} />],
                  ['Cùng cấp', () => run.addSibling(), <Plus key="b" size={18} />],
                  ['Sửa', () => startEdit(primary, 'all'), <Check key="c" size={18} />],
                  ['Thu / mở', () => run.collapse(), <ListTree key="d" size={18} />],
                  ['Xoá', run.remove, <Trash2 key="e" size={18} />],
                ] as [string, () => void, ReactNode][]).map(([label, fn, icon]) => (
                  <button key={label} type="button" onClick={fn} className="flex-1 flex flex-col items-center gap-0.5 py-1 rounded-xl text-[10.5px] font-medium active:bg-black/[0.06]">
                    {icon}{label}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 min-w-0">
            <OutlineView doc={doc} getDoc={getDoc} theme={theme} commit={commit} selectedId={primary} onSelect={id => setSel([id])} readOnly={readOnly} />
          </div>
        )}

        {panel && !readOnly && (
          <div className={mobile ? 'absolute inset-y-0 right-0 z-[6] shadow-2xl' : 'h-full'}>
            <FormatPanel tab={panel} onTab={setPanel} onClose={() => { setPanel(null); focusSink(); }}
              doc={doc} getDoc={getDoc} theme={theme} palette={palette}
              selIds={sel} selTopics={selTopics} selRelationId={selRel} selBoundaryId={selBoundary}
              commit={commit} onDeselectRelation={() => setSelRel(null)} />
          </div>
        )}

        {exportOpen && (
          <div data-ui className="absolute right-2 top-1 z-[7] w-[250px] p-1 rounded-xl bg-white/95 backdrop-blur-xl text-[#1D1D1F] shadow-[0_0_0_0.5px_rgba(0,0,0,0.12),0_12px_32px_-8px_rgba(0,0,0,0.35)]">
            {([
              ['png', 'Ảnh PNG (nét, nền theo chủ đề màu)'], ['pdf', 'File PDF'], ['svg', 'Ảnh SVG (phóng to không vỡ)'], ['md', 'Markdown (.md)'],
              ['copy', 'Sao chép dàn ý'],
            ] as const).map(([k, label]) => (
              <button key={k} type="button" onClick={() => void doExport(k)} className="w-full text-left px-3 h-8 rounded-md text-[13px] hover:bg-[#2C7BF6] hover:text-white">{label}</button>
            ))}
            {!readOnly && (
              <>
                <div className="h-px bg-black/[0.07] my-1" />
                {props.onCreateNote && <button type="button" onClick={() => void doExport('toNote')} className="w-full text-left px-3 h-8 rounded-md text-[13px] hover:bg-[#2C7BF6] hover:text-white">Tạo ghi chú mới từ dàn ý</button>}
                {props.seedText.trim() && <button type="button" onClick={() => void doExport('fromText')} className="w-full text-left px-3 h-8 rounded-md text-[13px] hover:bg-[#2C7BF6] hover:text-white">Dựng lại sơ đồ từ chữ gốc</button>}
              </>
            )}
          </div>
        )}

        {help && (
          <div data-ui className="absolute right-2 top-1 z-[7] w-[340px] max-h-[calc(100%-12px)] overflow-y-auto p-3 rounded-xl bg-white/97 backdrop-blur-xl text-[#1D1D1F] shadow-[0_0_0_0.5px_rgba(0,0,0,0.12),0_12px_32px_-8px_rgba(0,0,0,0.35)]">
            <div className="flex items-center mb-2">
              <div className="flex-1 text-[13px] font-semibold">Phím tắt (giống XMind)</div>
              <button type="button" onClick={() => setHelp(false)} className="w-6 h-6 rounded-md flex items-center justify-center hover:bg-black/[0.06]"><X size={14} /></button>
            </div>
            {shortcuts.map(([k, v]) => (
              <div key={k} className="flex gap-3 py-1 text-[12px] border-b border-black/[0.04] last:border-0">
                <span className="w-[128px] shrink-0 font-medium text-[#3A3A3C]">{k}</span>
                <span className="text-[#6E6E73]">{v}</span>
              </div>
            ))}
          </div>
        )}

        {toast && (
          <div className="absolute left-1/2 -translate-x-1/2 bottom-16 z-[8] max-w-[90%] text-center bg-[#1D1D1F]/90 text-white px-4 py-2 rounded-xl text-[12.5px] pointer-events-none">{toast}</div>
        )}
      </div>
    </div>
  );
}
