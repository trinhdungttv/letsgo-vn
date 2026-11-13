// Màn xem ảnh 360° (mở từ Khảo sát KCN): xoay / phóng ảnh như Google Photos, hiện các công ty / dự án / KCN ở gần
// (ghim đặt theo hướng thật), và cho tự vẽ nhãn / đường / khoanh vùng + ghi tên, chọn màu giống "Mặt bằng" của khách hàng
// — dùng cho công ty chưa có trong hệ thống. Tự lưu sau mỗi lần sửa (0,8 s).
// Điện thoại (13/11): gắn thẳng vào <body> (portal — trước nằm trong `space-y-3` nên bị đẩy xuống 12 px), chừa safe-area
// (tai thỏ / thanh trạng thái / thanh home, cả màn ngang), mọi nút ≥ 44 px, nút đáy không bị ngăn kéo dưới che.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle, ArrowLeft, Check, Compass, ExternalLink, Loader2, MapPin, Minus, MoreHorizontal, MousePointer2, Pencil, Plus, Route,
  Square, Tag, Trash2, Undo2, X, Bookmark, ChevronUp, ChevronDown, Camera,
} from 'lucide-react';
import PanoStage, { type PanoStageHandle } from './PanoStage';
import { PanoPinsLayer, PanoRadar, PanoShapesLayer, type NearbyItem } from './PanoOverlay';
import PanoPositionPicker from './PanoPositionPicker';
import { ZoneEditor } from '../clients/siteMapParts';
import { useAuth } from '../../lib/auth';
import { useIsMobile } from '../../hooks/useIsMobile';
import { MAP_GROUPS, MAP_GROUP_COLOR, type MapGroup } from '../../lib/mapGroups';
import { sortZones } from '../../lib/clientMaps/siteZones';
import { KIND_LABEL, MIN_PTS, ZONE_COLORS, nextShapeLabel, roundPt, shapeAnchor, zoneId, type PanoShape, type PanoShapeKind } from '../../lib/pano/annotations';
import {
  bearingDeg, compassAt, dirName, distanceM, fmtDistance, placeInPano, rotateShape, wrap360, type SphPt,
} from '../../lib/pano/sphere';
import { archivePanorama, panoSources, updatePanorama, type MapPanorama, type PanoPatch } from '../../lib/pano/panoramas';
import type { LatLng } from '../../lib/geo';

export interface PanoMapPoint {
  id: string;
  group: MapGroup;
  name: string;
  lat: number;
  lng: number;
  sub: string;
  onOpen?: () => void;
  /** Màu / nhãn riêng (VD trạng thái công ty trong Khảo sát KCN) — mặc định theo nhóm bản đồ. */
  color?: string;
  groupLabel?: string;
}

type Tool = 'select' | PanoShapeKind;
type SaveState = { s: 'idle' } | { s: 'saving' } | { s: 'saved'; at: string } | { s: 'error'; msg: string };

const SAVE_DELAY_MS = 800;
const HISTORY_MAX = 60;
const RADII = [500, 1000, 2000, 5000, 10000];
const RADIUS_KEY = 'lgpano_radius';
const MAX_PINS = 40;
const PANO_COLOR = '#0A84FF';
const GROUP_LABEL = Object.fromEntries(MAP_GROUPS.map(g => [g.id, g.label])) as Record<MapGroup, string>;

/** Điện thoại: dọc (< 768 px) hoặc xoay ngang (màn cảm ứng thấp) — nút to 44 px, trần bộ nhớ ảnh của điện thoại. */
const PHONE_QUERY = '(max-width: 767px), (pointer: coarse) and (max-height: 540px)';
function usePhone(): boolean {
  const [on, setOn] = useState(() => typeof window !== 'undefined' && window.matchMedia(PHONE_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(PHONE_QUERY);
    const onChange = () => setOn(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return on;
}

const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
const errText = (e: unknown) => (e as { message?: string })?.message ?? String(e);
const readRadius = () => { try { const n = Number(localStorage.getItem(RADIUS_KEY)); return RADII.includes(n) ? n : 2000; } catch { return 2000; } };

export default function PanoModal({ pano, points, panos, onClose, onChanged, onDeleted, onSwitch, startCalibrate }: {
  pano: MapPanorama;
  /** Công ty / dự án / KCN có toạ độ — để tìm cái nào ở gần ảnh. */
  points: PanoMapPoint[];
  panos: MapPanorama[];
  onClose: () => void;
  onChanged: (p: MapPanorama) => void;
  onDeleted: (id: string) => void;
  onSwitch: (id: string) => void;
  /** Không dùng nữa: thông báo của trang nằm DƯỚI lớp phủ 360 nên không thấy — màn này tự hiện thông báo trong khung. */
  toast?: (msg: string) => void;
  startCalibrate?: boolean;
}) {
  const { user } = useAuth();
  const userName = user?.full_name || user?.username || '';
  /** Bố cục dọc: ảnh trên + ngăn kéo dưới. */
  const mobile = useIsMobile();
  /** Điện thoại (dọc hoặc ngang): nút 44 px. */
  const phone = usePhone() || mobile;
  const stageRef = useRef<PanoStageHandle>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const say = useCallback((msg: string) => {
    setNotice(msg);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 2800);
  }, []);
  useEffect(() => () => { if (noticeTimer.current) clearTimeout(noticeTimer.current); }, []);

  const [p, setP] = useState<MapPanorama>(pano);
  const pRef = useRef(p);
  pRef.current = p;
  const [editing, setEditing] = useState(false);
  const [tool, setTool] = useState<Tool>('select');
  const [draft, setDraft] = useState<{ kind: 'line' | 'area'; pts: SphPt[] } | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const [hover, setHover] = useState<SphPt | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [focusShape, setFocusShape] = useState<string | null>(null);
  const [calibrating, setCalibrating] = useState(!!startCalibrate);
  const [radius, setRadius] = useState(readRadius);
  const [focusPin, setFocusPin] = useState<string | null>(null);
  const [tab, setTab] = useState<'nearby' | 'marks'>('nearby');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [moving, setMoving] = useState(false);
  const [save, setSave] = useState<SaveState>({ s: 'idle' });
  const [canUndo, setCanUndo] = useState(false);

  const shapes = p.annotations;
  const shapesRef = useRef(shapes);
  shapesRef.current = shapes;
  const history = useRef<PanoShape[][]>([]);
  const pending = useRef<PanoPatch | null>(null);
  const saving = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragState = useRef<{ key: string; snapshot: PanoShape[]; start: SphPt; orig: SphPt[] } | null>(null);
  const textSnap = useRef<PanoShape[] | null>(null);

  // ── Tự lưu ────────────────────────────────────────────────────────────────
  const flush = useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (saving.current || !pending.current) return;
    const job = pending.current;
    pending.current = null;
    saving.current = true;
    setSave({ s: 'saving' });
    try {
      const row = await updatePanorama(pano.id, job, userName);
      setSave({ s: 'saved', at: row.updated_at });
      onChanged({ ...row, annotations: shapesRef.current, heading: pRef.current.heading, camera_height: pRef.current.camera_height });
    } catch (e) {
      pending.current = { ...job, ...(pending.current ?? {}) };
      setSave({ s: 'error', msg: errText(e) });
    } finally {
      saving.current = false;
    }
    if (pending.current) timer.current = setTimeout(() => { void flush(); }, SAVE_DELAY_MS);
  }, [pano.id, userName, onChanged]);
  const flushRef = useRef(flush);
  flushRef.current = flush;

  const queue = useCallback((patch: PanoPatch, now = false) => {
    pending.current = { ...(pending.current ?? {}), ...patch };
    if (timer.current) clearTimeout(timer.current);
    if (now) void flushRef.current();
    else timer.current = setTimeout(() => { void flushRef.current(); }, SAVE_DELAY_MS);
  }, []);

  useEffect(() => {
    const onHide = () => { void flushRef.current(); };
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onHide);
      void flushRef.current();
    };
  }, []);

  const patchLocal = (patch: Partial<MapPanorama>) => setP(cur => ({ ...cur, ...patch }));

  // ── Nét vẽ ────────────────────────────────────────────────────────────────
  const applyShapes = useCallback((next: PanoShape[], snapshot?: PanoShape[]) => {
    if (snapshot) {
      history.current = [...history.current.slice(-(HISTORY_MAX - 1)), snapshot];
      setCanUndo(true);
    }
    shapesRef.current = next;
    setP(cur => ({ ...cur, annotations: next }));
    queue({ annotations: next });
  }, [queue]);
  const commit = useCallback((next: PanoShape[]) => applyShapes(next, shapesRef.current), [applyShapes]);

  const undo = useCallback(() => {
    const prev = history.current.pop();
    setCanUndo(history.current.length > 0);
    if (!prev) return;
    applyShapes(prev);
    setSelected(s => (s && prev.some(x => x.id === s) ? s : null));
  }, [applyShapes]);

  const createShape = (kind: PanoShapeKind, pts: SphPt[]) => {
    const cur = shapesRef.current;
    const last = cur[cur.length - 1];
    const s: PanoShape = { id: zoneId(), kind, label: nextShapeLabel(cur, kind), note: '', color: last?.color ?? ZONE_COLORS[0], pts };
    commit([...cur, s]);
    setSelected(s.id);
    setFocusShape(s.id);
    setTab('marks');
    if (mobile) setSheetOpen(true);
  };

  const finishDraft = useCallback(() => {
    const d = draftRef.current;
    if (!d) return;
    setDraft(null);
    setHover(null);
    if (d.pts.length >= MIN_PTS[d.kind]) createShape(d.kind, d.pts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateShape = (id: string, patch: Partial<PanoShape>, withHistory: boolean) => {
    const next = shapesRef.current.map(s => (s.id === id ? { ...s, ...patch } : s));
    if (withHistory) { commit(next); return; }
    const snap = textSnap.current;
    textSnap.current = null;
    applyShapes(next, snap ?? undefined);
  };
  const deleteShape = (id: string) => { commit(shapesRef.current.filter(s => s.id !== id)); setSelected(null); };

  useEffect(() => {
    if (!focusShape) return;
    const t = setTimeout(() => {
      const el = document.getElementById(`zone-label-${focusShape}`) as HTMLInputElement | null;
      if (el) { el.focus({ preventScroll: false }); el.select(); }
      setFocusShape(null);
    }, 60);
    return () => clearTimeout(t);
  }, [focusShape]);

  // ── Công ty / ảnh 360 ở gần ───────────────────────────────────────────────
  const hasPos = p.lat != null && p.lng != null;
  const calibrated = p.heading != null;
  const heading = p.heading ?? 0;
  // Mọi điểm trong 10 km; bán kính đang chọn không có gì → tự nới lên mốc gần nhất có điểm (khỏi trống trơn)
  const nearAll = useMemo<NearbyItem[]>(() => {
    if (p.lat == null || p.lng == null) return [];
    const radius = RADII[RADII.length - 1];
    const origin = { lat: p.lat, lng: p.lng };
    const out: NearbyItem[] = [];
    const seen = new Set<string>();
    for (const pt of points) {
      const d = distanceM(origin, pt);
      if (d > radius) continue;
      // Nhà máy ghim ở CRM Pipeline trùng đúng chỗ khách hàng → 1 ghim
      const key = `${pt.name.trim().toLocaleLowerCase('vi')}|${Math.round(pt.lat * 5000)}|${Math.round(pt.lng * 5000)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        id: pt.id, kind: 'point', name: pt.name, sub: pt.sub, color: pt.color ?? MAP_GROUP_COLOR[pt.group], groupLabel: pt.groupLabel ?? GROUP_LABEL[pt.group],
        lat: pt.lat, lng: pt.lng, dist: d, bearing: bearingDeg(origin, pt), onOpen: pt.onOpen,
      });
    }
    for (const o of panos) {
      if (o.id === p.id || o.lat == null || o.lng == null) continue;
      const d = distanceM(origin, { lat: o.lat, lng: o.lng });
      if (d > radius) continue;
      out.push({ id: `pano:${o.id}`, kind: 'pano', name: o.title || 'Ảnh 360', sub: '', color: PANO_COLOR, groupLabel: 'Ảnh 360', lat: o.lat, lng: o.lng, dist: d, bearing: bearingDeg(origin, { lat: o.lat, lng: o.lng }) });
    }
    return out.sort((a, b) => a.dist - b.dist);
  }, [points, panos, p.id, p.lat, p.lng]);
  const shownRadius = useMemo(() => {
    if (nearAll.some(n => n.dist <= radius)) return radius;
    return RADII.find(r => r > radius && nearAll.some(n => n.dist <= r)) ?? radius;
  }, [nearAll, radius]);
  const nearby = useMemo(() => nearAll.filter(n => n.dist <= shownRadius), [nearAll, shownRadius]);
  const pins = useMemo(() => nearby.slice(0, MAX_PINS), [nearby]);
  const focusItem = nearby.find(n => n.id === focusPin) ?? null;

  const lookAtItem = (it: NearbyItem) => {
    const at = placeInPano(it.bearing, it.dist, heading, p.camera_height);
    stageRef.current?.lookAt(at.yaw, Math.max(-60, Math.min(20, at.pitch + 4)));
    setFocusPin(it.id);
  };

  const setRadiusSaved = (r: number) => { setRadius(r); try { localStorage.setItem(RADIUS_KEY, String(r)); } catch { /* chỉ nhớ trong phiên */ } };

  // ── Căn hướng ─────────────────────────────────────────────────────────────
  const setHeading = (h: number, save = true) => {
    const v = Math.round(wrap360(h) * 10) / 10;
    patchLocal({ heading: v });
    if (save) queue({ heading: v });
  };
  const setCameraHeight = (m: number) => {
    const v = Math.max(0, Math.min(2000, Math.round(m)));
    patchLocal({ camera_height: v });
    queue({ camera_height: v });
  };

  // ── Thao tác trên ảnh ─────────────────────────────────────────────────────
  const onItemDrag = (key: string, raw: SphPt, phase: 'start' | 'move' | 'end'): boolean | void => {
    const pt = roundPt(raw);
    if (key.startsWith('pin:')) {
      if (!calibrating) return false;
      const it = nearby.find(n => n.id === key.slice(4));
      if (!it) return false;
      setHeading(it.bearing - pt.yaw, phase === 'end');
      if (phase === 'start') setFocusPin(it.id);
      return true;
    }
    if (!editing) return false;
    const [k, id, idx] = key.split(':');
    if (phase === 'start') {
      const s = shapesRef.current.find(x => x.id === id);
      if (!s || (k === 'v' && selected !== id)) return false;
      dragState.current = { key, snapshot: shapesRef.current, start: pt, orig: s.pts };
      setSelected(id);
      return true;
    }
    const d = dragState.current;
    if (!d || d.key !== key) return;
    if (phase === 'move') {
      const pts = k === 'v' ? d.orig.map((q, i) => (i === Number(idx) ? pt : q)) : rotateShape(d.orig, d.start, pt);
      applyShapes(shapesRef.current.map(s => (s.id === id ? { ...s, pts } : s)));
      return;
    }
    history.current = [...history.current.slice(-(HISTORY_MAX - 1)), d.snapshot];
    setCanUndo(true);
    dragState.current = null;
  };

  const onTap = (raw: SphPt, target: Element | null) => {
    const pt = roundPt(raw);
    const pinId = target?.closest('[data-pin]')?.getAttribute('data-pin');
    if (pinId && !(editing && tool !== 'select')) {
      const it = nearby.find(n => n.id === pinId);
      if (it?.kind === 'pano') { void flush(); onSwitch(it.id.slice(5)); return; }
      setFocusPin(f => (f === pinId ? null : pinId));
      return;
    }
    const shapeId = target?.closest('[data-shape]')?.getAttribute('data-shape') ?? null;
    if (editing && tool !== 'select') {
      if (tool === 'label') { createShape('label', [pt]); return; }
      const d = draftRef.current;
      if (d && d.kind === 'area' && d.pts.length >= 3 && target?.closest('[data-draft-first]')) { finishDraft(); return; }
      setDraft({ kind: tool, pts: d && d.kind === tool ? [...d.pts, pt] : [pt] });
      return;
    }
    setFocusPin(null);
    if (shapeId) {
      setSelected(s => (s === shapeId && !editing ? null : shapeId));
      setTab('marks');
      requestAnimationFrame(() => document.getElementById(`pano-row-${shapeId}`)?.scrollIntoView({ block: 'nearest' }));
    } else setSelected(null);
  };

  const onDoubleTap = (raw: SphPt) => {
    const pt = roundPt(raw);
    const d = draftRef.current;
    if (d) {
      // chạm thứ 2 của cú đúp không thêm điểm: chạm thứ nhất đã thêm rồi
      if (d.pts.length >= MIN_PTS[d.kind]) finishDraft();
      return;
    }
    if (editing && tool === 'label') { createShape('label', [pt]); return; }
    const v = stageRef.current?.getView();
    if (v) stageRef.current?.lookAt(pt.yaw, pt.pitch, Math.max(20, v.hfov * 0.6));
  };

  const startEditing = (t: Tool = shapes.length ? 'select' : 'area') => {
    setCalibrating(false);
    setEditing(true);
    setTool(t);
    setTab('marks');
    setFocusPin(null);
  };
  const stopEditing = () => {
    const d = draftRef.current;
    if (d && d.pts.length >= MIN_PTS[d.kind]) finishDraft();
    setDraft(null);
    setHover(null);
    setEditing(false);
    void flush();
  };
  const pickTool = (t: Tool) => {
    const d = draftRef.current;
    if (d && d.kind !== t && d.pts.length >= MIN_PTS[d.kind]) finishDraft();
    else if (d && d.kind !== t) setDraft(null);
    setTool(t);
  };

  // ── Phím tắt ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) {
        if (e.key === 'Escape') (e.target as HTMLElement).blur();
        return;
      }
      if (e.key === 'Escape') {
        if (moving) return;
        if (draftRef.current) { setDraft(null); setHover(null); }
        else if (menuOpen) setMenuOpen(false);
        else if (focusPin) setFocusPin(null);
        else if (selected) setSelected(null);
        else if (calibrating) setCalibrating(false);
        else if (editing) stopEditing();
        else onClose();
        return;
      }
      if (e.key === 'Enter' && draftRef.current) { e.preventDefault(); finishDraft(); return; }
      if ((e.key === 'Backspace' || e.key === 'Delete') && editing) {
        e.preventDefault();
        const d = draftRef.current;
        if (d) setDraft(d.pts.length > 1 ? { ...d, pts: d.pts.slice(0, -1) } : null);
        else if (selected) deleteShape(selected);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !e.shiftKey && editing) { e.preventDefault(); undo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Khoá cuộn trang phía sau
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  // ── Thao tác ảnh ──────────────────────────────────────────────────────────
  const rename = (title: string) => {
    setRenaming(false);
    const t = title.trim();
    if (t === p.title) return;
    patchLocal({ title: t });
    queue({ title: t }, true);
  };
  const saveStartView = () => {
    const v = stageRef.current?.getView();
    if (!v) return;
    const view = { yaw: Math.round(v.yaw * 10) / 10, pitch: Math.round(v.pitch * 10) / 10, hfov: Math.round(v.hfov) };
    patchLocal({ view });
    queue({ view }, true);
    say('Lần sau mở ảnh này sẽ nhìn đúng hướng hiện tại');
  };
  const remove = async () => {
    setMenuOpen(false);
    if (!window.confirm(`Xoá ảnh 360 "${p.title || 'không tên'}" cùng ${shapes.length} nét vẽ khỏi bản đồ?\n\n(Dữ liệu vẫn giữ trong hệ thống — khôi phục được ở Lịch sử dữ liệu.)`)) return;
    await flush();
    try {
      await archivePanorama(p.id, userName);
      onDeleted(p.id);
    } catch (e) {
      say('Không xoá được: ' + errText(e));
    }
  };
  const savePosition = (pos: LatLng) => {
    setMoving(false);
    patchLocal({ lat: pos.lat, lng: pos.lng });
    queue({ lat: pos.lat, lng: pos.lng }, true);
  };

  const sortedShapes = useMemo(() => sortZones(shapes), [shapes]);
  const sources = useMemo(() => panoSources(p), [p.pano_url, p.google_url]); // eslint-disable-line react-hooks/exhaustive-deps
  const coverage = useMemo(() => ({ haov: p.haov, vaov: p.vaov, voffset: p.voffset }), [p.haov, p.vaov, p.voffset]);
  const showPins = hasPos && pins.length > 0;
  const drawing = editing && tool !== 'select';

  // ── Cỡ nút: điện thoại ≥ 44 px (chuẩn vùng chạm của iOS) ──
  /** Nút tròn trên ảnh (quay lại, vẽ, căn hướng, ⋯). */
  const roundBtn = phone ? 'h-11 min-w-11 px-0 justify-center' : 'h-9 px-3';
  /** Nút trong thanh công cụ / thẻ / bảng. */
  const tapH = phone ? 'h-11' : 'h-8';
  /** Khoảng cách các khối nổi phía dưới (la bàn, phóng to, căn hướng) tới đáy khung ảnh: dọc thì ngăn kéo đè 12 px lên ảnh. */
  const edgeBottom = mobile ? '24px' : 'max(12px, env(safe-area-inset-bottom))';
  const edgeLeft = 'max(12px, env(safe-area-inset-left))';
  /** Khối nổi phía trên nằm dưới thanh trên cùng. */
  const belowBar = phone ? 'top-[60px]' : 'top-14';

  const toolBtn = (t: Tool, icon: ReactNode, label: string) => (
    <button key={t} onClick={() => pickTool(t)} title={label} aria-label={label}
      className={`inline-flex items-center justify-center gap-1.5 ${phone ? 'h-11 min-w-11 px-2' : 'h-8 px-2.5'} rounded-lg text-[12px] font-medium transition ${tool === t ? 'bg-[#1D4ED8] text-white' : 'text-[#222] hover:bg-black/[0.06]'}`}>
      {icon}<span className={phone ? 'hidden' : ''}>{label}</span>
    </button>
  );
  const toolHint = tool === 'label' ? 'Chạm vào ảnh để đặt nhãn (tên công ty, lô đất…)'
    : tool === 'line' ? 'Chạm từng điểm dọc theo đường · chạm đúp hoặc Enter để xong'
    : tool === 'area' ? 'Chạm quanh mép toà nhà / khu đất · chạm lại điểm đầu để khép vùng'
    : 'Kéo nhãn để dời cả hình · chọn hình rồi kéo chấm tròn để sửa góc · Delete để xoá';

  // ── Giao diện ─────────────────────────────────────────────────────────────
  const panel = (
    <div className="flex flex-col min-h-0 h-full">
      <div className={`shrink-0 flex items-center gap-1 border-b border-[#EEE] ${phone ? 'px-2 py-1.5' : 'px-3 pt-2.5 pb-2'}`}>
        {([['nearby', `Gần đây (${nearby.length})`], ['marks', `Đánh dấu (${shapes.length})`]] as const).map(([k, label]) => (
          <button key={k} onClick={() => { setTab(k); if (mobile) setSheetOpen(true); }}
            className={`shrink-0 whitespace-nowrap ${phone ? 'h-11 px-3.5 rounded-xl text-[13.5px]' : 'h-8 px-3 rounded-lg text-[12.5px]'} font-semibold transition ${tab === k ? 'bg-[#111] text-white' : 'text-[#555] hover:bg-black/[0.05]'}`}>
            {label}
          </button>
        ))}
        {mobile && (
          <button onClick={() => setSheetOpen(o => !o)} aria-label={sheetOpen ? 'Thu gọn' : 'Mở rộng'} className="ml-auto w-11 h-11 inline-flex items-center justify-center rounded-xl text-[#555] hover:bg-black/[0.05]">
            {sheetOpen ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
          </button>
        )}
      </div>
      {(!mobile || sheetOpen) && (
        <div className="flex-1 min-h-0 overflow-y-auto">
          {tab === 'nearby' ? (
            !hasPos ? (
              <div className="p-4 text-[12.5px] text-[#666] space-y-2">
                <div>Ảnh này chưa có vị trí chụp nên chưa biết công ty nào ở gần.</div>
                <button onClick={() => setMoving(true)} className={`${tapH} px-3 rounded-lg bg-[#1D4ED8] text-white text-[12px] font-medium inline-flex items-center gap-1.5`}><MapPin size={13} /> Đặt vị trí chụp</button>
              </div>
            ) : (
              <>
                <div className="px-3 pt-2.5 pb-2 space-y-2">
                  <div className="flex items-center gap-1 flex-wrap">
                    <span className="text-[11.5px] text-[#888] mr-0.5">Bán kính</span>
                    {RADII.map(r => (
                      <button key={r} onClick={() => setRadiusSaved(r)}
                        className={`${phone ? 'h-11 px-2.5 text-[12.5px]' : 'h-7 px-2 text-[11.5px]'} rounded-full font-medium border ${radius === r ? 'bg-[#1D4ED8] border-[#1D4ED8] text-white' : 'border-[#DDD] text-[#555] hover:bg-[#F5F5F7]'}`}>
                        {fmtDistance(r)}
                      </button>
                    ))}
                  </div>
                  {!calibrated && (
                    <div className="flex items-start gap-2 p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-[11.5px] text-amber-800">
                      <Compass size={14} className="shrink-0 mt-px" />
                      <div className="flex-1">Chưa căn hướng Bắc nên ghim trên ảnh có thể lệch hướng. Kéo 1 ghim công ty bạn nhận ra vào đúng toà nhà là xong.
                        <button onClick={() => { setEditing(false); setCalibrating(true); if (mobile) setSheetOpen(false); }}
                          className={phone ? 'mt-1.5 h-11 px-3 rounded-lg bg-amber-100 font-semibold text-amber-900 inline-flex items-center' : 'block mt-1 font-semibold text-amber-900 underline'}>Căn hướng ngay</button>
                      </div>
                    </div>
                  )}
                </div>
                {shownRadius !== radius && nearby.length > 0 && (
                  <div className="px-3 pb-2 text-[11.5px] text-[#888]">Trong {fmtDistance(radius)} chưa có điểm nào đã ghim — đang hiện trong {fmtDistance(shownRadius)}.</div>
                )}
                {nearby.length === 0 ? (
                  <div className="px-4 pb-4 text-[12px] text-[#888]">
                    Không có công ty / dự án nào đã ghim trong bán kính {fmtDistance(RADII[RADII.length - 1])}. Tự khoanh các công ty chưa có trong hệ thống ở tab <button onClick={() => startEditing('area')} className="text-[#1D4ED8] font-medium underline">Đánh dấu</button>.
                  </div>
                ) : (
                  <ul className="pb-2">
                    {nearby.map(it => (
                      <li key={it.id}>
                        <div className={`flex items-center gap-2.5 px-3 ${phone ? 'py-0.5' : 'py-1.5'} ${it.id === focusPin ? 'bg-[#0A84FF]/[0.08]' : 'hover:bg-[#F5F5F7]'}`}>
                          <button onClick={() => (it.kind === 'pano' ? (void flush(), onSwitch(it.id.slice(5))) : lookAtItem(it))} className={`flex-1 min-w-0 flex items-center gap-2.5 text-left ${phone ? 'min-h-11 py-1' : ''}`}>
                            <span className="shrink-0 w-2.5 h-2.5 rounded-full" style={{ background: it.color }} />
                            <span className="min-w-0 flex-1">
                              <span className="block text-[12.5px] font-semibold text-[#111] truncate">{it.kind === 'pano' && <Camera size={11} className="inline -mt-0.5 mr-1" />}{it.name}</span>
                              <span className="block text-[11px] text-[#888] truncate">{it.groupLabel}{it.sub ? ` · ${it.sub}` : ''}</span>
                            </span>
                            <span className="shrink-0 text-right">
                              <span className="block text-[12px] font-semibold tabular-nums text-[#333]">{fmtDistance(it.dist)}</span>
                              <span className="block text-[10.5px] text-[#999]">{dirName(it.bearing)}</span>
                            </span>
                          </button>
                          {it.onOpen && (
                            <button onClick={() => { void flush(); onClose(); it.onOpen!(); }} title="Mở hồ sơ" aria-label="Mở hồ sơ"
                              className={`shrink-0 ${phone ? 'w-11 h-11 -mr-2' : 'w-7 h-7'} inline-flex items-center justify-center rounded-lg text-[#888] hover:bg-black/[0.06] hover:text-[#333]`}><ExternalLink size={phone ? 15 : 13} /></button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )
          ) : (
            <>
              <div className="px-3 pt-2.5 pb-2 border-b border-[#F3F3F3]">
                {editing ? (
                  <div className="text-[11.5px] text-[#888]">Tên = công ty / lô đất · Ghi chú = ngành, số LĐ, đang xây… (chưa có trong hệ thống cũng ghi được)</div>
                ) : (
                  <button onClick={() => startEditing()} className={`w-full ${phone ? 'h-11' : 'h-9'} rounded-xl bg-[#1D4ED8] text-white text-[12.5px] font-semibold inline-flex items-center justify-center gap-1.5 hover:bg-[#1E40AF]`}>
                    <Pencil size={14} /> Vẽ / đánh dấu trên ảnh
                  </button>
                )}
              </div>
              {sortedShapes.length === 0 ? (
                <div className="px-4 py-5 text-[12px] text-[#999] text-center">
                  {editing ? 'Chọn "Vùng" rồi chạm quanh 1 toà nhà để khoanh, "Đường" để vẽ đường, "Nhãn" để ghi tên.' : 'Chưa có đánh dấu nào trên ảnh này.'}
                </div>
              ) : (
                <ul className="py-1">
                  {sortedShapes.map(s => (
                    <li key={s.id} id={`pano-row-${s.id}`}>
                      {editing && s.id === selected ? (
                        <ZoneEditor z={s} mobile={mobile} labelPlaceholder="Tên (Cty ABC)" notePlaceholder="Ghi chú (may mặc, ~800 LĐ…)" labelMax={60}
                          onFocusText={() => { textSnap.current = shapesRef.current; }}
                          onText={patch => updateShape(s.id, patch, false)}
                          onStyle={patch => updateShape(s.id, patch, true)}
                          onDelete={() => deleteShape(s.id)}
                          onClose={() => setSelected(null)} />
                      ) : (
                        <button onClick={() => { setSelected(s.id); const a = shapeAnchor(s); stageRef.current?.lookAt(a.yaw, a.pitch); }}
                          className={`w-full flex items-start gap-2.5 px-3 ${phone ? 'py-3 min-h-11' : 'py-1.5'} text-left transition ${s.id === selected ? 'bg-[#1D4ED8]/[0.07]' : 'hover:bg-[#F5F5F7]'}`}>
                          <span className="shrink-0 mt-[3px] w-3 h-3 rounded-[3px]" style={{ background: s.color }} />
                          <span className="min-w-0 flex-1 text-[12.5px] leading-snug">
                            <span className="font-bold" style={{ color: s.color }}>{s.label || '(chưa đặt tên)'}</span>
                            {s.note && <span className="text-[#333]"> : {s.note}</span>}
                            <span className="ml-1.5 text-[10.5px] text-[#AAA]">{KIND_LABEL[s.kind]}</span>
                          </span>
                          {editing && <Pencil size={12} className="shrink-0 mt-1 text-[#BBB]" />}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <NoteBox value={p.note} onSave={note => { patchLocal({ note }); queue({ note }); }} />
            </>
          )}
        </div>
      )}
    </div>
  );

  return createPortal(
    // pt safe-area: ảnh + nút nằm DƯỚI thanh trạng thái / tai thỏ (dải đen phía trên, như màn sửa ảnh chỉ tiêu)
    <div className="fixed inset-0 z-[1300] m-0 bg-black flex flex-col md:flex-row pt-[env(safe-area-inset-top)]" role="dialog" aria-modal="true" aria-label="Ảnh 360">
      <div className="relative flex-1 min-h-0 min-w-0">
        <PanoStage
          ref={stageRef}
          sources={sources}
          coverage={coverage}
          initialView={p.view}
          mobile={phone}
          noticeBottom={phone ? `calc(${edgeBottom} + 132px)` : edgeBottom}
          cursor={editing && tool !== 'select' ? 'crosshair' : undefined}
          onTap={onTap}
          onDoubleTap={onDoubleTap}
          onItemDrag={onItemDrag}
          onHover={pt => { if (draftRef.current) setHover(pt); }}
          overlay={v => (
            <>
              <PanoShapesLayer v={v} shapes={shapes} selected={selected} editing={editing} draft={draft} hover={hover} />
              {showPins && <PanoPinsLayer v={v} items={pins} heading={heading} cameraHeight={p.camera_height} calibrated={calibrated} calibrating={calibrating} focus={focusPin} dim={drawing} />}
              {hasPos && !(phone && (calibrating || editing)) && (
                <PanoRadar v={v} items={nearby} radius={shownRadius} heading={heading} calibrated={calibrated} left={edgeLeft} bottom={edgeBottom}
                  onPick={it => (it.kind === 'pano' ? onSwitch(it.id.slice(5)) : lookAtItem(it))} />
              )}
            </>
          )}
        />

        {/* Thanh trên — nền đặc 90% (không mờ), lề trái chừa tai thỏ khi xoay ngang */}
        <div className="absolute top-0 inset-x-0 z-20 pt-2 pb-6 pl-[max(8px,env(safe-area-inset-left))] pr-2 md:pr-3 bg-gradient-to-b from-black/60 to-transparent flex items-center gap-1.5 pointer-events-none">
          <button onClick={() => { void flush(); onClose(); }} title="Đóng ảnh 360 (Esc)" aria-label="Quay lại"
            className={`pointer-events-auto shrink-0 ${phone ? 'w-11 h-11 justify-center' : 'h-9 pl-2 pr-3'} rounded-full bg-white/90 text-[#111] text-[12.5px] font-semibold inline-flex items-center gap-1 shadow hover:bg-white`}>
            <ArrowLeft size={phone ? 20 : 16} /> <span className={phone ? 'hidden' : 'hidden sm:inline'}>Quay lại</span>
          </button>
          <div className="min-w-0 flex-1 pointer-events-auto">
            {renaming ? (
              <input autoFocus defaultValue={p.title} maxLength={120} onBlur={e => rename(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setRenaming(false); }}
                className={`w-full max-w-md ${phone ? 'h-11 text-[16px]' : 'h-9 text-[13px]'} px-3 rounded-full bg-white font-semibold outline-none`} />
            ) : (
              <button onClick={() => setRenaming(true)} title="Bấm để đổi tên" className={`max-w-full text-left px-2 py-1 rounded-lg hover:bg-white/10 ${phone ? 'min-h-11' : ''}`}>
                <div className="text-white text-[14px] font-semibold truncate drop-shadow">{p.title || 'Ảnh 360'}</div>
                <div className="text-white/70 text-[11px] truncate">
                  {[p.taken_at && `Chụp ${new Date(p.taken_at).toLocaleDateString('vi-VN')}`, p.created_by && `Thêm bởi ${p.created_by}`].filter(Boolean).join(' · ') || 'Kéo để xoay · cuộn / chụm 2 ngón để phóng to'}
                </div>
              </button>
            )}
          </div>
          <SaveBadge save={save} phone={phone} onRetry={() => { void flush(); }} />
          {!editing && (
            <button onClick={() => startEditing()} title="Vẽ / đánh dấu" aria-label="Vẽ / đánh dấu"
              className={`pointer-events-auto shrink-0 ${roundBtn} rounded-full bg-[#1D4ED8] text-white text-[12.5px] font-semibold inline-flex items-center gap-1.5 shadow hover:bg-[#1E40AF]`}>
              <Pencil size={phone ? 18 : 14} /> <span className={phone ? 'hidden' : 'hidden sm:inline'}>Vẽ / đánh dấu</span>
            </button>
          )}
          {hasPos && !calibrating && (
            <button onClick={() => { setEditing(false); setDraft(null); setCalibrating(true); if (mobile) setSheetOpen(false); }} title="Căn hướng Bắc" aria-label="Căn hướng Bắc"
              className={`pointer-events-auto shrink-0 ${roundBtn} rounded-full text-[12.5px] font-semibold inline-flex items-center gap-1.5 shadow ${calibrated ? 'bg-white/90 text-[#111] hover:bg-white' : 'bg-amber-400 text-[#111] hover:bg-amber-300'}`}>
              <Compass size={phone ? 19 : 14} /> <span className={phone ? 'hidden' : 'hidden sm:inline'}>Căn hướng</span>
            </button>
          )}
          <div className="relative pointer-events-auto shrink-0">
            <button onClick={() => setMenuOpen(o => !o)} title="Thêm thao tác" aria-label="Thêm thao tác" aria-expanded={menuOpen}
              className={`${phone ? 'w-11 h-11' : 'w-9 h-9'} rounded-full bg-white/90 text-[#111] inline-flex items-center justify-center shadow hover:bg-white`}>
              <MoreHorizontal size={phone ? 20 : 17} />
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                <div className={`absolute right-0 ${phone ? 'top-[52px] text-[14px]' : 'top-11 text-[12.5px]'} z-50 w-64 rounded-xl border border-[#E8E7E2] bg-white shadow-xl py-1 text-[#222]`}>
                  {([
                    [() => setRenaming(true), <Pencil size={14} />, 'Đổi tên'],
                    [() => setMoving(true), <MapPin size={14} />, 'Đổi vị trí chụp'],
                    [saveStartView, <Bookmark size={14} />, 'Mở ảnh ở góc nhìn này'],
                  ] as const).map(([act, icon, label]) => (
                    <button key={label} onClick={() => { setMenuOpen(false); act(); }} className={`w-full flex items-center gap-2.5 px-3 ${phone ? 'min-h-11' : 'py-2'} hover:bg-[#F5F5F7]`}>{icon} {label}</button>
                  ))}
                  {/^https:\/\//.test(p.source_url) && (
                    <a href={p.source_url} target="_blank" rel="noopener noreferrer" onClick={() => setMenuOpen(false)} className={`w-full flex items-center gap-2.5 px-3 ${phone ? 'min-h-11' : 'py-2'} hover:bg-[#F5F5F7]`}>
                      <ExternalLink size={14} /> Mở link gốc ({p.source_kind === 'gdrive' ? 'Google Drive' : p.source_kind === 'gphotos' ? 'Google Photos' : 'nguồn'})
                    </a>
                  )}
                  <button onClick={remove} className={`w-full flex items-center gap-2.5 px-3 ${phone ? 'min-h-11' : 'py-2'} text-red-600 hover:bg-red-50`}><Trash2 size={14} /> Xoá ảnh 360 này</button>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Công cụ vẽ */}
        {editing && (
          <div className={`absolute ${belowBar} left-1/2 -translate-x-1/2 z-20 w-[calc(100%-16px)] md:w-auto max-w-[720px]`}>
            <div className="flex items-center gap-1 p-1 rounded-2xl bg-white/95 backdrop-blur shadow-xl">
              {toolBtn('select', <MousePointer2 size={phone ? 18 : 14} />, 'Chọn')}
              {toolBtn('area', <Square size={phone ? 18 : 14} />, 'Vùng')}
              {toolBtn('line', <Route size={phone ? 18 : 14} />, 'Đường')}
              {toolBtn('label', <Tag size={phone ? 18 : 14} />, 'Nhãn')}
              <div className="w-px h-5 bg-[#E3E3E8] mx-0.5" />
              <button onClick={undo} disabled={!canUndo} title="Hoàn tác (⌘Z)" aria-label="Hoàn tác"
                className={`inline-flex items-center justify-center gap-1 ${phone ? 'h-11 min-w-11 px-2' : 'h-8 px-2'} rounded-lg text-[12px] text-[#222] hover:bg-black/[0.06] disabled:opacity-30`}>
                <Undo2 size={phone ? 18 : 14} /><span className={phone ? 'hidden' : ''}>Hoàn tác</span>
              </button>
              <button onClick={stopEditing} className={`ml-auto inline-flex items-center gap-1 ${phone ? 'h-11 px-3.5 text-[13.5px]' : 'h-8 px-3 text-[12px]'} rounded-lg bg-emerald-600 text-white font-semibold hover:bg-emerald-700`}>
                <Check size={phone ? 16 : 14} /> Xong
              </button>
            </div>
            {draft ? (
              <div className={`mt-1.5 mx-auto w-fit max-w-full flex flex-wrap items-center justify-center gap-1.5 px-2 py-1.5 rounded-xl bg-[#1D4ED8] text-white shadow-lg ${phone ? 'text-[13px]' : 'text-[12px]'}`}>
                <span className="px-1">{draft.kind === 'area' ? 'Vùng' : 'Đường'}: {draft.pts.length} điểm</span>
                <button onClick={() => setDraft(d => (d && d.pts.length > 1 ? { ...d, pts: d.pts.slice(0, -1) } : null))} className={`${phone ? 'h-11 px-2.5' : 'h-7 px-2'} rounded-lg bg-white/15 hover:bg-white/25`}>Bỏ điểm cuối</button>
                <button onClick={() => { setDraft(null); setHover(null); }} className={`${phone ? 'h-11 px-2.5' : 'h-7 px-2'} rounded-lg bg-white/15 hover:bg-white/25`}>Huỷ</button>
                <button onClick={finishDraft} disabled={draft.pts.length < MIN_PTS[draft.kind]} className={`${phone ? 'h-11 px-3' : 'h-7 px-2.5'} rounded-lg bg-white text-[#1D4ED8] font-semibold disabled:opacity-50`}>Xong nét này</button>
              </div>
            ) : (
              <div className="mt-1.5 mx-auto w-fit max-w-full px-2.5 py-1 rounded-lg bg-black/55 text-white text-[11.5px] text-center pointer-events-none">{toolHint}</div>
            )}
          </div>
        )}

        {/* Thẻ công ty đang chọn */}
        {focusItem && !editing && !calibrating && (
          <div className={`absolute ${belowBar} left-1/2 -translate-x-1/2 z-20 w-[min(380px,calc(100%-16px))] rounded-2xl bg-white/95 backdrop-blur shadow-xl p-3`}>
            <div className="flex items-start gap-2.5">
              <span className="mt-1 w-3 h-3 rounded-full shrink-0" style={{ background: focusItem.color }} />
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-semibold text-[#111] truncate">{focusItem.name}</div>
                <div className="text-[11.5px] text-[#777] truncate">{focusItem.groupLabel}{focusItem.sub ? ` · ${focusItem.sub}` : ''}</div>
                <div className="text-[11.5px] text-[#333] mt-0.5">{fmtDistance(focusItem.dist)} về hướng {dirName(focusItem.bearing)}{!calibrated && ' (chưa căn hướng)'}</div>
              </div>
              <button onClick={() => setFocusPin(null)} aria-label="Đóng"
                className={`shrink-0 inline-flex items-center justify-center rounded-lg text-[#999] hover:text-[#444] hover:bg-black/[0.05] ${phone ? 'w-11 h-11 -mt-2.5 -mr-2.5' : 'w-6 h-6 -mt-0.5 -mr-1'}`}><X size={phone ? 18 : 15} /></button>
            </div>
            {focusItem.onOpen && (
              <button onClick={() => { void flush(); onClose(); focusItem.onOpen!(); }}
                className={`mt-2 w-full ${tapH} rounded-lg bg-[#F2F2F7] text-[12px] font-semibold text-[#1D4ED8] inline-flex items-center justify-center gap-1.5 hover:bg-[#E8E8EE]`}>
                <ExternalLink size={13} /> Mở hồ sơ
              </button>
            )}
          </div>
        )}

        {/* Căn hướng — neo trái / phải (chừa tai thỏ khi xoay ngang), căn giữa bằng mx-auto */}
        {calibrating && (
          <div className="absolute z-20 mx-auto max-w-[600px] rounded-2xl bg-white/95 backdrop-blur shadow-2xl p-3 space-y-2.5 max-h-[calc(100%-72px)] overflow-y-auto"
            style={{ left: 'max(8px, env(safe-area-inset-left))', right: 8, bottom: edgeBottom }}>
            <div className="flex items-start gap-2">
              <Compass size={18} className="text-[#1D4ED8] shrink-0 mt-0.5" />
              <div className="flex-1 text-[12px] text-[#444]">
                <div className="text-[13px] font-semibold text-[#111]">Căn hướng Bắc cho ảnh</div>
                {pins.length ? 'Kéo ghim của 1 công ty bạn nhận ra sang ngang tới đúng toà nhà của nó — các ghim khác tự xoay theo.'
                  : 'Chưa có công ty nào đã ghim gần đây. Xoay ảnh cho giữa màn hình nhìn đúng hướng Bắc rồi bấm "Hướng đang nhìn là Bắc".'}
              </div>
              <button onClick={() => setCalibrating(false)} className={`shrink-0 ${phone ? 'h-11 px-3.5 text-[13.5px]' : 'h-8 px-3 text-[12px]'} rounded-lg bg-emerald-600 text-white font-semibold inline-flex items-center gap-1 hover:bg-emerald-700`}><Check size={14} /> Xong</button>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="w-24 text-[11.5px] text-[#666]">Giữa ảnh nhìn về</span>
              <input type="range" min={0} max={359} step={1} value={Math.round(heading)} onChange={e => setHeading(Number(e.target.value))} className={`flex-1 min-w-[140px] accent-[#1D4ED8] ${phone ? 'h-8' : ''}`} />
              <span className="w-24 text-[12px] font-semibold tabular-nums text-[#111]">{calibrated ? `${Math.round(heading)}° ${dirName(heading, true)}` : '—'}</span>
              <button onClick={() => { const v = stageRef.current?.getView(); if (v) setHeading(-v.yaw); }} className={`${phone ? 'h-11 px-3 text-[12.5px]' : 'h-7 px-2 text-[11.5px]'} rounded-lg border border-[#D8D6D0] font-medium text-[#333] hover:bg-[#F5F5F7]`}>Hướng đang nhìn là Bắc</button>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="w-24 text-[11.5px] text-[#666]">Độ cao chụp</span>
              <input type="range" min={0} max={300} step={1} value={Math.min(300, p.camera_height)} onChange={e => setCameraHeight(Number(e.target.value))} className={`flex-1 min-w-[140px] accent-[#1D4ED8] ${phone ? 'h-8' : ''}`} />
              <span className="w-24 text-[12px] font-semibold tabular-nums text-[#111]">{p.camera_height} m</span>
              <button onClick={() => setCameraHeight(2)} className={`${phone ? 'h-11 px-3 text-[12.5px]' : 'h-7 px-2 text-[11.5px]'} rounded-lg border font-medium ${p.camera_height <= 3 ? 'border-[#1D4ED8] text-[#1D4ED8] bg-[#1D4ED8]/[0.06]' : 'border-[#D8D6D0] text-[#333]'}`}>Mặt đất</button>
              <button onClick={() => setCameraHeight(100)} className={`${phone ? 'h-11 px-3 text-[12.5px]' : 'h-7 px-2 text-[11.5px]'} rounded-lg border font-medium ${p.camera_height >= 60 ? 'border-[#1D4ED8] text-[#1D4ED8] bg-[#1D4ED8]/[0.06]' : 'border-[#D8D6D0] text-[#333]'}`}>Flycam 100 m</button>
            </div>
            {calibrated && <div className="text-[11px] text-[#888]">Đang nhìn: {dirName(compassAt(stageRef.current?.getView().yaw ?? 0, heading))}. Ảnh chụp từ trên cao: tăng "Độ cao chụp" để ghim hạ xuống đúng chân toà nhà.</div>}
          </div>
        )}

        {/* Phóng to / thu nhỏ — trên ngăn kéo dưới (không bị mép bo che) */}
        {!calibrating && (
          <div className="absolute right-3 z-10 flex flex-col rounded-xl overflow-hidden shadow-lg" style={{ bottom: edgeBottom }}>
            <button onClick={() => stageRef.current?.zoomBy(0.75)} aria-label="Phóng to" className={`${phone ? 'w-11 h-11' : 'w-9 h-9'} bg-white/90 text-[#111] inline-flex items-center justify-center hover:bg-white border-b border-black/10`}><Plus size={phone ? 19 : 16} /></button>
            <button onClick={() => stageRef.current?.zoomBy(1.33)} aria-label="Thu nhỏ" className={`${phone ? 'w-11 h-11' : 'w-9 h-9'} bg-white/90 text-[#111] inline-flex items-center justify-center hover:bg-white`}><Minus size={phone ? 19 : 16} /></button>
          </div>
        )}

        {/* Thông báo của màn này (toast của trang nằm dưới lớp phủ nên không thấy) */}
        {notice && (
          <div role="status" className={`absolute ${belowBar} left-1/2 -translate-x-1/2 z-40 w-max max-w-[calc(100%-32px)] rounded-xl bg-[#1D1D1F]/90 text-white text-[13px] px-4 py-2.5 shadow-lg text-center pointer-events-none`}>
            {notice}
          </div>
        )}
      </div>

      {/* Bảng bên: công ty gần + đánh dấu. Dọc: ngăn kéo dưới, chừa thanh home. Ngang: cột phải, chừa tai thỏ. */}
      <aside className={mobile
        ? `shrink-0 bg-white rounded-t-2xl -mt-3 relative z-30 pb-[env(safe-area-inset-bottom)] ${sheetOpen ? 'h-[46dvh]' : 'h-auto'}`
        : `${phone ? 'w-[calc(18rem+env(safe-area-inset-right))]' : 'w-[calc(20rem+env(safe-area-inset-right))]'} shrink-0 bg-white border-l border-[#222] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)]`}>
        {panel}
      </aside>

      {moving && (
        <PositionDialog phone={phone} initial={hasPos ? { lat: p.lat!, lng: p.lng! } : null} onCancel={() => setMoving(false)} onSave={savePosition} />
      )}
    </div>,
    document.body,
  );
}

function NoteBox({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  return (
    <div className="px-3 py-3 border-t border-[#F3F3F3]">
      <div className="text-[11px] font-medium text-[#888] mb-1">Ghi chú về ảnh này</div>
      <textarea value={v} onChange={e => setV(e.target.value)} onBlur={() => { if (v !== value) onSave(v.slice(0, 2000)); }} rows={2}
        placeholder="Chụp ở đâu, ngày nào, thấy gì đáng chú ý…"
        className="w-full px-2.5 py-2 rounded-lg border border-[#E3E3E8] text-[12.5px] outline-none focus:border-[#1D4ED8] resize-y" />
    </div>
  );
}

function PositionDialog({ phone, initial, onCancel, onSave }: { phone: boolean; initial: LatLng | null; onCancel: () => void; onSave: (p: LatLng) => void }) {
  const [pos, setPos] = useState<LatLng | null>(initial);
  const btnH = phone ? 'h-11' : 'h-9';
  return (
    <div className="fixed inset-0 z-[1400] bg-black/50 flex items-end md:items-center justify-center p-0 md:p-4" onClick={onCancel}>
      <div className="w-full md:max-w-lg bg-white rounded-t-2xl md:rounded-2xl shadow-2xl p-4 pb-[max(16px,env(safe-area-inset-bottom))] md:pb-4 space-y-3" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div className="text-[14px] font-semibold text-[#111]">Vị trí đứng chụp</div>
          <button onClick={onCancel} aria-label="Đóng" className={`inline-flex items-center justify-center rounded-lg text-[#999] hover:bg-black/[0.05] ${phone ? 'w-11 h-11 -m-2.5' : 'w-7 h-7 -m-1'}`}><X size={phone ? 18 : 16} /></button>
        </div>
        <PanoPositionPicker value={pos} onChange={setPos} fallbackCenter={initial ?? { lat: 10.98, lng: 106.67 }} />
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className={`${btnH} px-4 rounded-lg border border-[#D8D6D0] text-[12.5px] font-medium`}>Huỷ</button>
          <button onClick={() => pos && onSave(pos)} disabled={!pos} className={`${btnH} px-4 rounded-lg bg-[#1D4ED8] text-white text-[12.5px] font-semibold disabled:opacity-40`}>Lưu vị trí</button>
        </div>
      </div>
    </div>
  );
}

function SaveBadge({ save, phone, onRetry }: { save: SaveState; phone: boolean; onRetry: () => void }) {
  if (save.s === 'saving') return <span className="pointer-events-auto shrink-0 text-[11.5px] text-white/85 inline-flex items-center gap-1 px-2"><Loader2 size={12} className="animate-spin" /> <span className={phone ? 'hidden' : ''}>Đang lưu…</span></span>;
  if (save.s === 'error') {
    return (
      <button onClick={onRetry} title={save.msg} className={`pointer-events-auto shrink-0 ${phone ? 'h-11 px-3' : 'h-8 px-2.5'} rounded-full bg-red-600 text-white text-[11.5px] font-medium inline-flex items-center gap-1`}>
        <AlertTriangle size={12} /> {phone ? 'Lưu lại' : 'Chưa lưu — thử lại'}
      </button>
    );
  }
  if (save.s === 'saved') return <span className="hidden sm:inline-flex pointer-events-auto text-[11.5px] text-white/80 items-center gap-1 px-2"><Check size={12} className="text-emerald-400" /> Đã lưu</span>;
  return null;
}
