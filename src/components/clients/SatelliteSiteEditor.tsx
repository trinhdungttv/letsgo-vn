// Mặt bằng nhà xưởng vẽ TRỰC TIẾP trên bản đồ vệ tinh (tab "Mặt bằng" → loại "Bản đồ vệ tinh").
// Bản đồ mở ở vị trí nhà máy đã ghim; người dùng khoanh từng khối nhà (khung chữ nhật / đa giác), ghi tên + công năng
// lên mỗi khối, và xoay bản đồ cho nhà xưởng nằm thẳng. Khối lưu theo toạ độ thật (lib/clientMaps/siteGeo.ts).
// Bản đồ tự dựng (ô ảnh Esri xếp trong khung xoay) vì Leaflet không xoay được; mọi toạ độ màn hình ↔ bản đồ
// đi qua toScreen / fromScreen nên bấm, kéo luôn đúng chỗ dù đang xoay bao nhiêu độ.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import {
  Check, Compass, Eye, EyeOff, MapPin, Minus, MousePointer2, Pencil, Pentagon, Plus, RotateCcw, RotateCw, Ruler, Scan, Square, Tag, Undo2, X,
} from 'lucide-react';
import { useIsMobile } from '../../hooks/useIsMobile';
import type { ClientSiteMap } from '../../lib/clientMaps/siteMaps';
import {
  MAX_NATIVE_ZOOM, MAX_ZOOM, MIN_ZOOM, TILE_URL, bearingAround, bearingToLevel, centroid, fitPoints, fromScreen, geoZoneId,
  labelPx, longestEdge, panBy, rectToGeo, roundPt, scaleBar, shiftPts, tileZoomFor, toScreen, visibleTiles, zoomAround,
  type GeoPt, type GeoZone, type Pt, type SiteGeo, type View,
} from '../../lib/clientMaps/siteGeo';
import { ZONE_COLORS, nextZoneLabel, sortZones } from '../../lib/clientMaps/siteZones';
import { ZoneEditor } from './siteMapParts';

type Tool = 'select' | 'rect' | 'poly' | 'label' | 'align';
interface Cam { center: GeoPt; zoom: number; bearing: number }
type Drag =
  | { kind: 'pan'; last: Pt }
  | { kind: 'rotate'; last: Pt }
  | { kind: 'tap'; start: Pt; hitId: string | null }
  | { kind: 'vertex'; id: string; idx: number; snapshot: GeoZone[]; moved: boolean }
  | { kind: 'move'; id: string; start: GeoPt; orig: GeoPt[]; snapshot: GeoZone[]; moved: boolean }
  | { kind: 'rect'; start: Pt };

const HISTORY_MAX = 60;
const TAP_SLOP = 4;
const NOTES_KEY = 'lgvn_site_geo_notes';
const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
const readStored = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const writeStored = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* chỉ nhớ trong phiên */ } };
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const ptsAttr = (pts: Pt[]) => pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

export default function SatelliteSiteEditor({ map, onChange }: {
  map: ClientSiteMap;
  /** Gọi mỗi khi khối / khung nhìn đổi — nơi gọi tự gom và lưu. */
  onChange: (geo: SiteGeo) => void;
}) {
  const mobile = useIsMobile();
  const initial = map.geo as SiteGeo;

  const [size, setSize] = useState({ w: 0, h: 0 });
  const [cam, setCam] = useState<Cam>({ center: initial.center, zoom: initial.zoom, bearing: initial.bearing });
  const [zones, setZones] = useState<GeoZone[]>(initial.zones);
  const [editing, setEditing] = useState(false);
  const [tool, setToolState] = useState<Tool>('select');
  const [selected, setSelected] = useState<string | null>(null);
  const [poly, setPolyState] = useState<GeoPt[]>([]);
  const [hover, setHover] = useState<Pt | null>(null);
  const [rectDraft, setRectDraft] = useState<{ a: Pt; b: Pt } | null>(null);
  const [alignFirst, setAlignFirst] = useState<GeoPt | null>(null);
  const [showNotes, setShowNotes] = useState(() => readStored(NOTES_KEY) !== '0');
  const [canUndo, setCanUndo] = useState(false);
  const [focusZone, setFocusZone] = useState<string | null>(null);

  const origin = initial.origin;
  const camRef = useRef(cam);
  const zonesRef = useRef(zones);
  const polyRef = useRef(poly);
  const sizeRef = useRef(size);
  const viewRef = useRef<View>({ ...cam, w: 0, h: 0 });
  const history = useRef<GeoZone[][]>([]);
  const textSnap = useRef<GeoZone[] | null>(null);
  const drag = useRef<Drag | null>(null);
  const pointers = useRef(new Map<number, Pt>());
  const pinch = useRef<{ dist: number; mid: Pt } | null>(null);
  const spaceDown = useRef(false);
  const emitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const view: View = { ...cam, w: size.w, h: size.h };
  viewRef.current = view;
  sizeRef.current = size;

  // ── Gửi dữ liệu ra ngoài (nơi gọi tự lưu) ─────────────────────────────────
  const emit = useCallback(() => {
    if (emitTimer.current) { clearTimeout(emitTimer.current); emitTimer.current = null; }
    const c = camRef.current;
    onChangeRef.current({ v: 1, center: c.center, zoom: c.zoom, bearing: c.bearing, ...(origin ? { origin } : {}), zones: zonesRef.current });
  }, [origin]);
  const emitSoon = useCallback(() => {
    if (emitTimer.current) clearTimeout(emitTimer.current);
    emitTimer.current = setTimeout(emit, 350);
  }, [emit]);
  const emitRef = useRef(emit);
  emitRef.current = emit;
  useEffect(() => () => { if (emitTimer.current) emitRef.current(); }, []);

  const setCamera = useCallback((patch: Partial<Cam>) => {
    const next = { ...camRef.current, ...patch };
    camRef.current = next;
    viewRef.current = { ...viewRef.current, ...next };
    setCam(next);
    emitSoon();
  }, [emitSoon]);

  const applyZones = useCallback((next: GeoZone[], snapshot?: GeoZone[]) => {
    if (snapshot) {
      history.current = [...history.current.slice(-(HISTORY_MAX - 1)), snapshot];
      setCanUndo(true);
    }
    zonesRef.current = next;
    setZones(next);
    emit();
  }, [emit]);
  const commit = useCallback((next: GeoZone[]) => applyZones(next, zonesRef.current), [applyZones]);

  const undo = useCallback(() => {
    const prev = history.current.pop();
    setCanUndo(history.current.length > 0);
    if (prev) {
      applyZones(prev);
      setSelected(s => (s && prev.some(z => z.id === s) ? s : null));
    }
  }, [applyZones]);

  const setPoly = (p: GeoPt[]) => { polyRef.current = p; setPolyState(p); };
  const setTool = (t: Tool) => {
    setToolState(t);
    setPoly([]); setRectDraft(null); setAlignFirst(null); setHover(null);
    if (t !== 'select') setSelected(null);
  };

  // ── Kích thước khung ──────────────────────────────────────────────────────
  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // ── Cuộn chuột = phóng / thu theo con trỏ (phải gắn tay: React không cho chặn cuộn trang) ──
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const v = viewRef.current;
      const unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1;
      const dz = -e.deltaY * unit * (e.ctrlKey ? 0.01 : 0.0022);
      setCamera(zoomAround(v, { x: e.clientX - r.left, y: e.clientY - r.top }, v.zoom + dz));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [setCamera]);

  const geoAt = (p: Pt) => roundPt(fromScreen(viewRef.current, p));
  const local = (e: { clientX: number; clientY: number }): Pt => {
    const r = boxRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  // ── Tạo khối / nhãn ───────────────────────────────────────────────────────
  const addZone = (pts: GeoPt[]) => {
    const cur = zonesRef.current;
    const last = cur[cur.length - 1];
    const z: GeoZone = { id: geoZoneId(), label: nextZoneLabel(cur), note: '', color: last?.color ?? ZONE_COLORS[0], pts };
    commit([...cur, z]);
    setSelected(z.id);
    setFocusZone(z.id);
  };
  const finishPoly = () => {
    const pts = polyRef.current;
    setPoly([]); setHover(null);
    if (pts.length >= 3) addZone(pts);
  };

  const alignTo = (a: GeoPt, b: GeoPt) => setCamera(bearingAround(viewRef.current, { x: viewRef.current.w / 2, y: viewRef.current.h / 2 }, bearingToLevel(a, b, viewRef.current.bearing)));
  const alignToZone = (id: string) => {
    const edge = longestEdge(zonesRef.current.find(z => z.id === id)?.pts ?? []);
    if (edge) alignTo(edge[0], edge[1]);
  };

  // ── Bấm (không kéo) ───────────────────────────────────────────────────────
  const onTap = (p: Pt, hitId: string | null) => {
    if (tool === 'align') {
      const g = geoAt(p);
      if (!alignFirst) { setAlignFirst(g); return; }
      alignTo(alignFirst, g);
      setTool('select');
      return;
    }
    if (!editing || tool === 'select') { setSelected(hitId && hitId !== selected ? hitId : null); return; }
    if (tool === 'label') { addZone([geoAt(p)]); return; }
    if (tool === 'poly') {
      const draft = polyRef.current;
      const v = viewRef.current;
      if (draft.length >= 3 && dist(toScreen(v, draft[0]), p) < (mobile ? 18 : 12)) { finishPoly(); return; }
      const last = draft[draft.length - 1];
      if (last && dist(toScreen(v, last), p) < 6) { if (draft.length >= 3) finishPoly(); return; }
      setPoly([...draft, geoAt(p)]);
    }
  };

  // ── Con trỏ ───────────────────────────────────────────────────────────────
  const startPinch = () => {
    const [a, b] = [...pointers.current.values()];
    pinch.current = { dist: Math.max(1, dist(a, b)), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  };

  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* bỏ qua */ }
    if (pointers.current.size === 2) { drag.current = null; setRectDraft(null); startPinch(); return; }
    if (pointers.current.size > 2) return;
    if (e.button === 1 || (e.button === 0 && spaceDown.current)) { drag.current = { kind: 'pan', last: p }; e.preventDefault(); return; }
    if (e.button !== 0) return;
    if (e.shiftKey) { drag.current = { kind: 'rotate', last: p }; return; }

    const el = e.target instanceof Element ? e.target : null;
    const vertex = el?.closest('[data-vertex]')?.getAttribute('data-vertex');
    const mid = el?.closest('[data-mid]')?.getAttribute('data-mid');
    const hitId = tool === 'select' ? el?.closest('[data-zone]')?.getAttribute('data-zone') ?? null : null;
    const cur = zonesRef.current;

    if (editing && tool === 'select') {
      if (vertex) {
        const i = vertex.lastIndexOf(':');
        drag.current = { kind: 'vertex', id: vertex.slice(0, i), idx: Number(vertex.slice(i + 1)), snapshot: cur, moved: false };
        e.preventDefault();
        return;
      }
      if (mid) {
        const i = mid.lastIndexOf(':');
        const id = mid.slice(0, i), at = Number(mid.slice(i + 1));
        const z = cur.find(x => x.id === id);
        if (z) {
          const a = z.pts[at], b = z.pts[(at + 1) % z.pts.length];
          const m = roundPt({ lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 });
          const next = cur.map(x => (x.id === id ? { ...x, pts: [...x.pts.slice(0, at + 1), m, ...x.pts.slice(at + 1)] } : x));
          zonesRef.current = next;
          setZones(next);
          drag.current = { kind: 'vertex', id, idx: at + 1, snapshot: cur, moved: true };
          e.preventDefault();
          return;
        }
      }
      if (hitId) {
        const z = cur.find(x => x.id === hitId);
        if (z) {
          setSelected(hitId);
          drag.current = { kind: 'move', id: hitId, start: geoAt(p), orig: z.pts, snapshot: cur, moved: false };
          e.preventDefault();
          return;
        }
      }
    }
    if (editing && tool === 'rect') {
      drag.current = { kind: 'rect', start: p };
      setRectDraft({ a: p, b: p });
      e.preventDefault();
      return;
    }
    drag.current = { kind: 'tap', start: p, hitId };
  };

  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const p = local(e);
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, p);
    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.max(1, dist(a, b));
      const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const prev = pinch.current;
      const v = viewRef.current;
      const z = zoomAround(v, m, v.zoom + Math.log2(d / prev.dist));
      const c = panBy({ ...v, ...z }, m.x - prev.mid.x, m.y - prev.mid.y);
      setCamera({ center: c, zoom: z.zoom });
      pinch.current = { dist: d, mid: m };
      return;
    }
    if ((tool === 'poly' && polyRef.current.length) || (tool === 'align' && alignFirst)) setHover(p);
    const d = drag.current;
    if (!d) return;
    const v = viewRef.current;
    switch (d.kind) {
      case 'tap':
        // Kéo quá vài điểm ảnh = kéo bản đồ (không còn là bấm)
        if (dist(d.start, p) > TAP_SLOP) {
          setCamera({ center: panBy(v, p.x - d.start.x, p.y - d.start.y) });
          drag.current = { kind: 'pan', last: p };
        }
        return;
      case 'pan':
        setCamera({ center: panBy(v, p.x - d.last.x, p.y - d.last.y) });
        d.last = p;
        return;
      case 'rotate':
        setCamera(bearingAround(v, { x: v.w / 2, y: v.h / 2 }, v.bearing + (p.x - d.last.x) * 0.3));
        d.last = p;
        return;
      case 'rect':
        setRectDraft({ a: d.start, b: p });
        return;
      case 'vertex': {
        const g = geoAt(p);
        d.moved = true;
        const next = zonesRef.current.map(z => (z.id === d.id ? { ...z, pts: z.pts.map((q, i) => (i === d.idx ? g : q)) } : z));
        zonesRef.current = next;
        setZones(next);
        return;
      }
      case 'move': {
        const g = geoAt(p);
        const dLat = g.lat - d.start.lat, dLng = g.lng - d.start.lng;
        const s0 = toScreen(v, d.start);
        if (!d.moved && Math.hypot(p.x - s0.x, p.y - s0.y) < TAP_SLOP) return;
        d.moved = true;
        const next = zonesRef.current.map(z => (z.id === d.id ? { ...z, pts: shiftPts(d.orig, dLat, dLng) } : z));
        zonesRef.current = next;
        setZones(next);
      }
    }
  };

  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const p = local(e);
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    switch (d.kind) {
      case 'tap':
        if (e.type === 'pointerup') onTap(p, d.hitId);
        return;
      case 'rect': {
        setRectDraft(null);
        if (e.type !== 'pointerup') return;
        if (Math.abs(p.x - d.start.x) > 10 && Math.abs(p.y - d.start.y) > 10) addZone(rectToGeo(viewRef.current, d.start, p));
        return;
      }
      case 'vertex':
      case 'move':
        if (d.moved) {
          history.current = [...history.current.slice(-(HISTORY_MAX - 1)), d.snapshot];
          setCanUndo(true);
          emit();
        }
        return;
      default:
        emit();
    }
  };

  const onDoubleClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (!editing || tool !== 'select') return;
    const v = (e.target instanceof Element ? e.target.closest('[data-vertex]')?.getAttribute('data-vertex') : null);
    if (!v) return;
    const i = v.lastIndexOf(':');
    const id = v.slice(0, i), idx = Number(v.slice(i + 1));
    const z = zonesRef.current.find(x => x.id === id);
    if (!z || z.pts.length <= 3) return;
    commit(zonesRef.current.map(x => (x.id === id ? { ...x, pts: x.pts.filter((_, k) => k !== idx) } : x)));
  };

  // ── Phím tắt ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      if (e.key === ' ') { spaceDown.current = true; return; }
      if (e.key === 'Escape') {
        // Việc nào Esc xử lý được thì chặn không cho thoát toàn màn hình
        if (polyRef.current.length) { e.stopPropagation(); setPoly([]); setHover(null); }
        else if (tool === 'align') { e.stopPropagation(); setTool('select'); }
        else if (selected) { e.stopPropagation(); setSelected(null); }
        return;
      }
      if (!editing) return;
      if (e.key === 'Enter' && polyRef.current.length >= 3) { e.preventDefault(); finishPoly(); }
      else if ((e.key === 'Backspace' || e.key === 'Delete') && polyRef.current.length) { e.preventDefault(); setPoly(polyRef.current.slice(0, -1)); }
      else if ((e.key === 'Backspace' || e.key === 'Delete') && selected) {
        e.preventDefault();
        commit(zonesRef.current.filter(z => z.id !== selected));
        setSelected(null);
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        if (polyRef.current.length) setPoly(polyRef.current.slice(0, -1)); else undo();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => { if (e.key === ' ') spaceDown.current = false; };
    const onBlur = () => { spaceDown.current = false; };
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => { window.removeEventListener('keydown', onKeyDown, true); window.removeEventListener('keyup', onKeyUp); window.removeEventListener('blur', onBlur); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, tool, selected, commit, undo]);

  // Ô tên khối mới tạo: focus + chọn sẵn chữ → gõ luôn tên thật
  useEffect(() => {
    if (!focusZone) return;
    const el = document.getElementById(`zone-label-${focusZone}`) as HTMLInputElement | null;
    if (el) { el.focus(); el.select(); }
    setFocusZone(null);
  }, [focusZone]);

  // Gõ tên / ghi chú: cả đợt gõ trong 1 ô = 1 bước Hoàn tác
  const updateZone = (id: string, patch: Partial<GeoZone>, withHistory: boolean) => {
    const next = zonesRef.current.map(z => (z.id === id ? { ...z, ...patch } : z));
    if (withHistory) { commit(next); return; }
    const snap = textSnap.current;
    textSnap.current = null;
    applyZones(next, snap ?? undefined);
  };

  const focusOnZone = (id: string) => {
    setSelected(id);
    const z = zonesRef.current.find(x => x.id === id);
    if (z) setCamera({ center: centroid(z.pts) });
  };

  const fitAll = () => {
    const pts = zones.flatMap(z => z.pts);
    const f = fitPoints(pts.length ? pts : origin ? [origin] : [cam.center], cam.bearing, size.w, size.h, mobile ? 40 : 90);
    if (f) setCamera({ center: f.center, zoom: pts.length >= 2 ? f.zoom : initial.zoom });
  };

  // ── Vẽ ────────────────────────────────────────────────────────────────────
  const ready = size.w > 0 && size.h > 0;
  const tz = tileZoomFor(cam.zoom);
  const tiles = useMemo(() => (ready ? visibleTiles(view, tz) : []), [ready, cam, size]); // eslint-disable-line react-hooks/exhaustive-deps
  const under = useMemo(() => (ready && tz > 4 ? visibleTiles(view, tz - 1) : []), [ready, cam, size]); // eslint-disable-line react-hooks/exhaustive-deps
  const sorted = useMemo(() => sortZones(zones), [zones]);
  const sel = zones.find(z => z.id === selected) ?? null;
  const showHandles = editing && tool === 'select' && !!sel && sel.pts.length >= 3;
  const bar = scaleBar(cam.center.lat, cam.zoom);
  const originPt = ready && origin ? toScreen(view, origin) : null;

  const hint = (() => {
    if (tool === 'align') return alignFirst ? 'Bấm điểm thứ 2 trên CÙNG cạnh đó — bản đồ tự xoay cho cạnh nằm ngang' : 'Bấm 1 điểm ở đầu một cạnh nhà (mép mái, tường…) rồi điểm thứ 2 ở đầu kia';
    if (!editing) return mobile ? 'Kéo để di chuyển · chụm 2 ngón để phóng to · kéo thanh bên dưới để xoay cho thẳng nhà xưởng' : 'Kéo để di chuyển · cuộn chuột để phóng to · kéo thanh bên dưới để xoay cho thẳng nhà xưởng';
    if (tool === 'poly') return poly.length ? 'Bấm thêm góc · bấm lại điểm đầu / nháy đúp / Enter để khép · Backspace lùi 1 góc · Esc huỷ' : 'Bấm lần lượt các góc của 1 khối nhà (kéo để di chuyển bản đồ)';
    if (tool === 'rect') return mobile ? 'Kéo 1 khung chữ nhật quanh khối nhà · dùng 2 ngón để di chuyển / phóng bản đồ' : 'Kéo 1 khung chữ nhật quanh khối nhà (xoay bản đồ cho thẳng trước) · giữ Space để kéo bản đồ';
    if (tool === 'label') return 'Bấm vào bản đồ để đặt chữ rời (Cổng, Nhà ăn, Bãi xe…)';
    return mobile ? 'Bấm khối để chọn · kéo khối để dời · kéo chấm góc để chỉnh hình' : 'Bấm khối để chọn · kéo khối để dời · kéo chấm góc để chỉnh hình · chấm nhỏ giữa cạnh = thêm góc · nháy đúp góc = xoá góc';
  })();

  const toolBtn = (t: Tool, icon: ReactNode, label: string) => (
    <button key={t} onClick={() => setTool(t)} title={label}
      className={`inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-[12px] font-medium transition ${tool === t ? 'bg-[#1D4ED8] text-white' : 'text-[#333] hover:bg-black/[0.06]'}`}>
      {icon}<span className={mobile ? 'hidden' : ''}>{label}</span>
    </button>
  );
  const iconBtn = 'w-8 h-8 inline-flex items-center justify-center text-[#333] hover:bg-black/[0.05] disabled:opacity-30';
  const cursor = (editing && tool !== 'select') || tool === 'align' ? 'crosshair' : 'grab';

  const zoomBy = (dz: number) => setCamera(zoomAround(view, { x: size.w / 2, y: size.h / 2 }, cam.zoom + dz));
  const setBearing = (b: number) => setCamera(bearingAround(view, { x: size.w / 2, y: size.h / 2 }, b));

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* Hàng công cụ */}
      <div className="shrink-0 flex flex-wrap items-center gap-1.5 px-3 md:px-5 py-1.5 border-b border-[#E8E7E2] bg-[#F7F8FC]">
        {editing ? (
          <>
            {toolBtn('select', <MousePointer2 size={14} />, 'Chọn / dời')}
            {toolBtn('rect', <Square size={14} />, 'Khung chữ nhật')}
            {toolBtn('poly', <Pentagon size={14} />, 'Khoanh đa giác')}
            {toolBtn('label', <Tag size={14} />, 'Chữ rời')}
          </>
        ) : (
          <span className="text-[12px] text-[#555] inline-flex items-center gap-1.5"><MapPin size={14} className="text-[#DC2626]" /> Bản đồ vệ tinh tại vị trí nhà máy</span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <button onClick={() => { const v = !showNotes; setShowNotes(v); writeStored(NOTES_KEY, v ? '1' : '0'); }}
            title={showNotes ? 'Ẩn dòng công năng trên bản đồ' : 'Hiện dòng công năng trên bản đồ'}
            className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-[12px] text-[#333] hover:bg-black/[0.06]">
            {showNotes ? <Eye size={14} /> : <EyeOff size={14} />}<span className={mobile ? 'hidden' : ''}>Công năng</span>
          </button>
          {editing ? (
            <>
              <button onClick={undo} disabled={!canUndo} title="Hoàn tác (⌘Z)"
                className="inline-flex items-center gap-1 h-8 px-2.5 rounded-lg text-[12px] text-[#333] hover:bg-black/[0.06] disabled:opacity-30"><Undo2 size={14} /> <span className={mobile ? 'hidden' : ''}>Hoàn tác</span></button>
              <button onClick={() => { setEditing(false); setTool('select'); setSelected(null); emit(); }}
                className="inline-flex items-center gap-1 h-8 px-3 rounded-lg bg-emerald-600 text-white text-[12px] font-medium hover:bg-emerald-700"><Check size={14} /> Xong</button>
            </>
          ) : (
            <button onClick={() => { setEditing(true); setTool(zones.length ? 'select' : 'rect'); }}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-[#1D4ED8] text-white text-[12px] font-medium hover:bg-[#1E40AF]">
              <Pencil size={13} /> Vẽ khối nhà
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col md:flex-row">
        {/* Bản đồ */}
        <div className="relative flex-1 min-h-[300px] overflow-hidden bg-[#cfd5dc] select-none">
          <div ref={boxRef} className="absolute inset-0 overflow-hidden"
            style={{ touchAction: 'none', cursor }}
            onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onDoubleClick={onDoubleClick}>
            {ready && (
              <>
                {/* Ảnh vệ tinh — xếp trong khung xoay quanh tâm; lớp mức thấp hơn nằm dưới làm nền khi ô mới chưa tải xong */}
                <div className="absolute left-1/2 top-1/2 w-0 h-0" style={{ transform: `rotate(${cam.bearing}deg)` }}>
                  {[...under, ...tiles].map(t => (
                    <img key={t.key} src={TILE_URL(t.z, t.x, t.y)} alt="" draggable={false} decoding="async"
                      style={{ position: 'absolute', left: t.left, top: t.top, width: t.size + 1, height: t.size + 1, maxWidth: 'none', pointerEvents: 'none' }}
                      onError={e => { e.currentTarget.style.visibility = 'hidden'; }} />
                  ))}
                </div>

                {/* Khối nhà */}
                <svg className="absolute inset-0 pointer-events-none" width={size.w} height={size.h}>
                  {zones.map(z => {
                    if (z.pts.length < 3) return null;
                    const pts = ptsAttr(z.pts.map(p => toScreen(view, p)));
                    const isSel = z.id === selected;
                    return (
                      <g key={z.id}>
                        {isSel && <polygon points={pts} fill="none" stroke="#fff" strokeWidth={6} strokeLinejoin="round" opacity={0.95} />}
                        <polygon data-zone={z.id} points={pts} fill={`${z.color}3d`} stroke={z.color} strokeWidth={isSel ? 3 : 2.5} strokeLinejoin="round"
                          style={{ pointerEvents: tool === 'select' ? 'visiblePainted' : 'none', cursor: editing && tool === 'select' ? 'move' : 'pointer' }} />
                      </g>
                    );
                  })}

                  {/* Đang khoanh đa giác */}
                  {poly.length > 0 && (() => {
                    const s = poly.map(p => toScreen(view, p));
                    const close = poly.length >= 3 && hover && dist(s[0], hover) < (mobile ? 18 : 12);
                    return (
                      <g>
                        <polyline points={ptsAttr(hover ? [...s, hover] : s)} fill="none" stroke="#fff" strokeWidth={5} strokeLinejoin="round" opacity={0.9} />
                        <polyline points={ptsAttr(hover ? [...s, hover] : s)} fill="none" stroke="#1D4ED8" strokeWidth={2.5} strokeDasharray="6 4" strokeLinejoin="round" />
                        {s.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={i === 0 ? (close ? 9 : 6) : 4} fill={i === 0 ? '#1D4ED8' : '#fff'} stroke="#1D4ED8" strokeWidth={2} />)}
                      </g>
                    );
                  })()}
                  {rectDraft && (
                    <rect x={Math.min(rectDraft.a.x, rectDraft.b.x)} y={Math.min(rectDraft.a.y, rectDraft.b.y)}
                      width={Math.abs(rectDraft.a.x - rectDraft.b.x)} height={Math.abs(rectDraft.a.y - rectDraft.b.y)}
                      fill="#1D4ED822" stroke="#1D4ED8" strokeWidth={2.5} strokeDasharray="6 4" />
                  )}
                  {alignFirst && (() => {
                    const a = toScreen(view, alignFirst);
                    return (
                      <g>
                        {hover && <line x1={a.x} y1={a.y} x2={hover.x} y2={hover.y} stroke="#fff" strokeWidth={4} opacity={0.9} />}
                        {hover && <line x1={a.x} y1={a.y} x2={hover.x} y2={hover.y} stroke="#F08A12" strokeWidth={2.5} strokeDasharray="6 4" />}
                        <circle cx={a.x} cy={a.y} r={6} fill="#F08A12" stroke="#fff" strokeWidth={2} />
                      </g>
                    );
                  })()}

                  {/* Chấm chỉnh hình của khối đang chọn */}
                  {showHandles && sel && (
                    <g>
                      {sel.pts.map((a, i) => {
                        const b = sel.pts[(i + 1) % sel.pts.length];
                        const m = toScreen(view, { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 });
                        return <circle key={`m${i}`} data-mid={`${sel.id}:${i}`} cx={m.x} cy={m.y} r={mobile ? 7 : 4.5} fill="#fff" stroke="#1D4ED8" strokeWidth={1.5} opacity={0.8} style={{ pointerEvents: 'all', cursor: 'copy' }} />;
                      })}
                      {sel.pts.map((p, i) => {
                        const s = toScreen(view, p);
                        return <circle key={`v${i}`} data-vertex={`${sel.id}:${i}`} cx={s.x} cy={s.y} r={mobile ? 10 : 7} fill="#fff" stroke="#1D4ED8" strokeWidth={2.5} style={{ pointerEvents: 'all', cursor: 'pointer' }} />;
                      })}
                    </g>
                  )}

                  {/* Ghim nhà máy đã lưu sẵn */}
                  {originPt && (
                    <g transform={`translate(${originPt.x.toFixed(1)} ${originPt.y.toFixed(1)})`}>
                      <title>Vị trí nhà máy đã ghim</title>
                      <path d="M0 0 C-7 -9 -11 -13 -11 -19 A11 11 0 1 1 11 -19 C11 -13 7 -9 0 0 Z" fill="#DC2626" stroke="#fff" strokeWidth={2} />
                      <circle cy={-19} r={4} fill="#fff" />
                    </g>
                  )}
                </svg>

                {/* Chữ trên từng khối — luôn nằm ngang dù bản đồ xoay */}
                <div className="absolute inset-0 pointer-events-none overflow-hidden">
                  {zones.map(z => {
                    const a = toScreen(view, centroid(z.pts));
                    if (a.x < -160 || a.y < -80 || a.x > size.w + 160 || a.y > size.h + 80) return null;
                    const fs = labelPx(cam.zoom, z.size ?? 1);
                    const isSel = z.id === selected;
                    const single = z.pts.length === 1;
                    return (
                      <div key={z.id} data-zone={single ? z.id : undefined}
                        className="absolute text-center leading-tight"
                        style={{
                          left: a.x, top: a.y, transform: 'translate(-50%, -50%)', fontSize: fs, pointerEvents: single && tool === 'select' ? 'auto' : 'none',
                          cursor: editing && tool === 'select' ? 'move' : 'pointer',
                        }}>
                        <div className="inline-block rounded-[0.25em] shadow-[0_1px_4px_rgba(0,0,0,0.35)] px-[0.38em] py-[0.18em]"
                          style={{ background: 'rgba(255,255,255,0.92)', outline: isSel ? `2px solid ${editing ? '#1D4ED8' : z.color}` : undefined, outlineOffset: 2 }}>
                          <div className="whitespace-nowrap font-bold" style={{ color: z.color }}>{z.label || '?'}</div>
                          {showNotes && z.note && <div className="whitespace-nowrap font-medium text-[#222]" style={{ fontSize: '0.72em', marginTop: '0.05em' }}>{z.note}</div>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          {/* Gợi ý thao tác */}
          <div className="absolute left-2 top-2 right-14 pointer-events-none">
            <span className="inline-block max-w-full rounded-lg bg-black/60 text-white text-[11.5px] leading-snug px-2.5 py-1.5 backdrop-blur-sm">{hint}</span>
          </div>

          {/* Phóng / thu, la bàn, vừa khối, về ghim */}
          <div className="absolute right-2 top-2 flex flex-col rounded-lg bg-white/95 shadow-md overflow-hidden divide-y divide-[#ECECEF]">
            <button onClick={() => zoomBy(1)} disabled={cam.zoom >= MAX_ZOOM} title="Phóng to" className={iconBtn}><Plus size={15} /></button>
            <button onClick={() => zoomBy(-1)} disabled={cam.zoom <= MIN_ZOOM} title="Thu nhỏ" className={iconBtn}><Minus size={15} /></button>
            <button onClick={() => setBearing(0)} title={`Hướng Bắc lên trên (đang xoay ${cam.bearing}°)`} className={iconBtn}>
              <Compass size={16} style={{ transform: `rotate(${cam.bearing}deg)` }} className="text-[#DC2626]" />
            </button>
            <button onClick={fitAll} disabled={!zones.length} title="Vừa tất cả các khối" className={iconBtn}><Scan size={15} /></button>
            {origin && <button onClick={() => setCamera({ center: origin })} title="Về ghim nhà máy" className={iconBtn}><MapPin size={15} className="text-[#DC2626]" /></button>}
          </div>

          {/* Xoay hướng cho thẳng */}
          <div className="absolute left-2 right-2 bottom-8 md:right-auto md:w-[430px] rounded-xl bg-white/95 shadow-lg px-3 py-2 flex flex-wrap items-center gap-x-2 gap-y-1.5">
            <button onClick={() => setBearing(cam.bearing - 1)} title="Xoay trái 1°" className="w-7 h-7 rounded-md hover:bg-black/[0.06] inline-flex items-center justify-center text-[#333]"><RotateCcw size={14} /></button>
            <input type="range" min={-180} max={180} step={0.5} value={cam.bearing} onChange={e => setBearing(Number(e.target.value))}
              aria-label="Xoay bản đồ" className="flex-1 min-w-[120px] accent-[#1D4ED8]" />
            <button onClick={() => setBearing(cam.bearing + 1)} title="Xoay phải 1°" className="w-7 h-7 rounded-md hover:bg-black/[0.06] inline-flex items-center justify-center text-[#333]"><RotateCw size={14} /></button>
            <span className="w-12 text-right text-[12px] tabular-nums font-semibold text-[#111]">{cam.bearing.toFixed(1)}°</span>
            <div className="basis-full flex flex-wrap items-center gap-1.5">
              <button onClick={() => (tool === 'align' ? setTool('select') : setTool('align'))}
                className={`inline-flex items-center gap-1 h-7 px-2 rounded-md text-[11.5px] font-medium ${tool === 'align' ? 'bg-[#F08A12] text-white' : 'bg-[#F3F4F8] text-[#333] hover:bg-[#E8EAF2]'}`}>
                <Ruler size={12} /> {tool === 'align' ? 'Đang chọn cạnh… (Esc)' : 'Căn thẳng theo cạnh'}
              </button>
              {sel && sel.pts.length >= 3 && (
                <button onClick={() => alignToZone(sel.id)} className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-[11.5px] font-medium bg-[#F3F4F8] text-[#333] hover:bg-[#E8EAF2]">
                  Căn theo khối "{sel.label || '?'}"
                </button>
              )}
              {cam.bearing !== 0 && <button onClick={() => setBearing(0)} className="inline-flex items-center h-7 px-2 rounded-md text-[11.5px] text-[#555] hover:bg-black/[0.05]">Về hướng Bắc</button>}
            </div>
          </div>

          {/* Thước tỉ lệ + nguồn ảnh */}
          <div className="absolute left-2 bottom-2 pointer-events-none flex items-end gap-2 text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.9)]">
            <div className="text-[10.5px] font-medium">
              <div className="border-b-2 border-x-2 border-white h-1.5" style={{ width: bar.px }} />
              {bar.meters >= 1000 ? `${bar.meters / 1000} km` : `${bar.meters} m`}
            </div>
            {cam.zoom > MAX_NATIVE_ZOOM + 0.4 && <span className="text-[10.5px] opacity-90">· ảnh đã giãn quá mức gốc</span>}
          </div>
          <div className="absolute right-2 bottom-2 pointer-events-none text-[10px] text-white/90 [text-shadow:0_1px_3px_rgba(0,0,0,0.9)]">Ảnh vệ tinh © Esri</div>
        </div>

        {/* Bảng chú thích */}
        <aside className="shrink-0 md:w-72 max-h-[42vh] md:max-h-none overflow-y-auto border-t md:border-t-0 md:border-l border-[#E8E7E2] bg-white">
          <div className="sticky top-0 z-10 bg-white px-4 pt-3 pb-2 border-b border-[#F0F0F2]">
            <div className="text-[12px] font-semibold text-[#111]">Chú thích <span className="text-[#999] font-normal">({zones.length})</span></div>
            {editing && <div className="text-[11px] text-[#999] mt-0.5">Tên khu = chữ to trên khối · Ghi chú = xưởng làm gì (Gia vị, H. Nhân, Kho…)</div>}
          </div>
          {sorted.length === 0 ? (
            <div className="px-4 py-6 text-[12px] text-[#999] text-center">
              {editing ? 'Chọn "Khung chữ nhật" hoặc "Khoanh đa giác" rồi vẽ quanh khối nhà đầu tiên.' : 'Chưa có khối nhà nào. Bấm "Vẽ khối nhà" để khoanh từng xưởng của công ty và ghi tên lên.'}
            </div>
          ) : (
            <ul className="py-1">
              {sorted.map(z => (
                <li key={z.id} id={`legend-row-${z.id}`}>
                  {editing && z.id === selected ? (
                    <ZoneEditor z={z} mobile={mobile}
                      onFocusText={() => { textSnap.current = zonesRef.current; }}
                      onText={patch => updateZone(z.id, patch, false)}
                      onStyle={patch => updateZone(z.id, patch, true)}
                      onDelete={() => { commit(zonesRef.current.filter(x => x.id !== z.id)); setSelected(null); }}
                      onClose={() => setSelected(null)}
                      extra={z.pts.length >= 3 ? (
                        <button onClick={() => alignToZone(z.id)} title="Xoay bản đồ cho cạnh dài nhất của khối nằm ngang"
                          className="h-7 px-2 rounded-md text-[11.5px] bg-white border border-[#E0E0E5] text-[#555] hover:bg-[#F5F5F7]">Căn thẳng</button>
                      ) : null} />
                  ) : (
                    <button onClick={() => focusOnZone(z.id)}
                      className={`w-full flex items-start gap-2.5 px-4 py-1.5 text-left transition ${z.id === selected ? 'bg-[#1D4ED8]/[0.07]' : 'hover:bg-[#F5F5F7]'}`}>
                      <span className="shrink-0 mt-[3px] w-3 h-3 rounded-[3px]" style={{ background: z.color }} />
                      <span className="min-w-0 flex-1 text-[13px] leading-snug">
                        <span className="font-bold" style={{ color: z.color }}>{z.label || '(chưa đặt tên)'}</span>
                        {z.note && <span className="text-[#333]"> : {z.note}</span>}
                      </span>
                      {editing && <Pencil size={12} className="shrink-0 mt-1 text-[#BBB]" />}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {selected && !editing && (
            <button onClick={() => setSelected(null)} className="mx-4 my-2 inline-flex items-center gap-1 text-[11.5px] text-[#888] hover:text-[#555]"><X size={12} /> Bỏ chọn</button>
          )}
        </aside>
      </div>
    </div>
  );
}

