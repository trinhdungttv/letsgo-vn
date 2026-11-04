// Tab "Mặt bằng" trong hồ sơ Khách hàng. Mỗi khách nhiều mặt bằng (nhà máy 1, nhà máy 2…), 2 loại:
//   • Ảnh: tải ảnh sơ đồ nhà xưởng (ảnh chụp, bản vẽ…) rồi vẽ khu vực lên (B3, B5 Gia vị, Kho TN…) + bảng chú thích bên cạnh.
//     Ảnh lưu Cloudflare R2 (lib/clientMaps/siteMaps.ts), khu vực lưu riêng dạng toạ độ 0..1 (lib/clientMaps/siteZones.ts).
//     Thêm ảnh: nút "Thêm ảnh", kéo thả file vào, hoặc dán (⌘V) ảnh chụp màn hình.
//   • Bản đồ vệ tinh (migration 202): mở ở vị trí nhà máy đã ghim, khoanh từng khối nhà + ghi tên / công năng, xoay cho thẳng
//     — xem SatelliteSiteEditor.tsx.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent as ReactDragEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import {
  AlertTriangle, Check, ImagePlus, Loader2, MapPin, Maximize2, Minimize2, MoreHorizontal, MousePointer2, Pencil, RefreshCw, Satellite, Square, Tag,
  Trash2, Undo2, X, ZoomIn, ZoomOut,
} from 'lucide-react';
import type { Client } from '../../lib/types';
import { useAuth } from '../../lib/auth';
import { useIsMobile } from '../../hooks/useIsMobile';
import { CLIENT_MAPS_MIGRATION_HINT, isMissingTableError } from '../../lib/clientMaps/orgChart';
import {
  SITE_GEO_MIGRATION_HINT, archiveSiteMap, createGeoMap, createSiteMap, listSiteMaps, updateSiteMap, uploadSiteImage,
  type ClientSiteMap, type SiteMapPatch,
} from '../../lib/clientMaps/siteMaps';
import {
  LABEL_FONT_RATIO, MIN_RECT, ZONE_COLORS, moveZone, nextZoneLabel, rectFrom, resizeZone, sortZones, zoneId,
  type SiteZone,
} from '../../lib/clientMaps/siteZones';
import { newSiteGeo, type GeoPt, type SiteGeo } from '../../lib/clientMaps/siteGeo';
import { SOURCE_HINT, loadSiteLocations, type SiteLocation } from '../../lib/clientMaps/siteLocations';
import { isValidVnLatLng, mapLinkStatus, parseLatLngFromLink } from '../../lib/geo';
import SatelliteSiteEditor from './SatelliteSiteEditor';
import { ZoneEditor } from './siteMapParts';

type Tool = 'select' | 'label' | 'rect';
interface Pt { x: number; y: number }
type Drag =
  | { kind: 'move'; id: string; start: Pt; orig: SiteZone; snapshot: SiteZone[]; moved: boolean }
  | { kind: 'resize'; id: string; orig: SiteZone; snapshot: SiteZone[] }
  | { kind: 'draw'; start: Pt };
type SaveState = { s: 'idle' } | { s: 'saving' } | { s: 'saved'; at: string } | { s: 'error'; msg: string };

const ZOOMS = [1, 1.5, 2, 3, 4];
const SAVE_DELAY_MS = 800;
const HISTORY_MAX = 60;
const ACTIVE_KEY = (clientId: string) => `lgvn_site_map_active:${clientId}`;

const zoneCount = (m: ClientSiteMap) => (m.kind === 'map' ? m.geo?.zones.length ?? 0 : m.zones.length);
const errText = (e: unknown) => (e as { message?: string })?.message ?? String(e);
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
const readStored = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const writeStored = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* chỉ nhớ trong phiên */ } };

export default function ClientSiteMaps({ client }: { client: Client }) {
  const { user } = useAuth();
  const userName = user?.full_name || user?.username || '';
  const mobile = useIsMobile();
  const clientId = client.id;

  const [phase, setPhase] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [loadError, setLoadError] = useState('');
  const [maps, setMaps] = useState<ClientSiteMap[]>([]);
  const [geoReady, setGeoReady] = useState(true);
  const [satMenu, setSatMenu] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [tool, setTool] = useState<Tool>('label');
  const [zoom, setZoom] = useState(1);
  const [full, setFull] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [save, setSave] = useState<SaveState>({ s: 'idle' });
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [draft, setDraft] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [focusZone, setFocusZone] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [view, setView] = useState({ w: 0, h: 0 });
  const [natAspect, setNatAspect] = useState<number | null>(null);
  const [imgBroken, setImgBroken] = useState(false);

  const active = maps.find(m => m.id === activeId) ?? null;
  const zones = useMemo(() => active?.zones ?? [], [active]);
  const zonesRef = useRef(zones);
  zonesRef.current = zones;
  const history = useRef<SiteZone[][]>([]);
  const pending = useRef<{ id: string; patch: SiteMapPatch } | null>(null);
  const saving = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drag = useRef<Drag | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const addInput = useRef<HTMLInputElement>(null);
  const replaceInput = useRef<HTMLInputElement>(null);

  // Đổi sang bản đồ vệ tinh thì thôi chế độ vẽ của ảnh (bản đồ vệ tinh có chế độ vẽ riêng)
  useEffect(() => { if (active?.kind === 'map') { setEditing(false); setDraft(null); } }, [active?.kind]);

  // ── Tải danh sách ─────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setPhase('loading');
    try {
      const { maps: rows, geoReady: ready } = await listSiteMaps(clientId);
      setMaps(rows);
      setGeoReady(ready);
      const remembered = readStored(ACTIVE_KEY(clientId));
      setActiveId(rows.find(r => r.id === remembered)?.id ?? rows[0]?.id ?? null);
      setPhase('ready');
    } catch (e) {
      if (isMissingTableError(e as { code?: string; message?: string })) setPhase('missing');
      else { setLoadError(errText(e)); setPhase('error'); }
    }
  }, [clientId]);
  useEffect(() => { load(); }, [load]);

  // ── Lưu khu vực (tự lưu sau mỗi lần sửa) ─────────────────────────────────
  const flush = useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (saving.current || !pending.current) return;
    const job = pending.current;
    pending.current = null;
    saving.current = true;
    setSave({ s: 'saving' });
    try {
      const row = await updateSiteMap(job.id, job.patch, userName);
      setSave({ s: 'saved', at: row.updated_at });
    } catch (e) {
      if (!pending.current) pending.current = job;
      setSave({ s: 'error', msg: errText(e) });
    } finally {
      saving.current = false;
    }
    if (pending.current) timer.current = setTimeout(() => { void flush(); }, SAVE_DELAY_MS);
  }, [userName]);

  const flushRef = useRef(flush);
  flushRef.current = flush;
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

  /** Đổi khu vực của ảnh đang mở. snapshot = trạng thái trước đó để Hoàn tác (bỏ trống khi đang kéo / đang gõ). */
  const applyZones = useCallback((next: SiteZone[], snapshot?: SiteZone[]) => {
    const id = activeId;
    if (!id) return;
    if (snapshot) {
      history.current = [...history.current.slice(-(HISTORY_MAX - 1)), snapshot];
      setCanUndo(true);
    }
    zonesRef.current = next;
    setMaps(ms => ms.map(m => (m.id === id ? { ...m, zones: next } : m)));
    if (pending.current && pending.current.id !== id) void flush();
    pending.current = { id, patch: { zones: next } };
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void flush(); }, SAVE_DELAY_MS);
  }, [activeId, flush]);

  /** Bản đồ vệ tinh: khối / góc xoay / khung nhìn đổi → lưu cả cục geo (tự gom 0,8 s). */
  const applyGeo = useCallback((id: string, geo: SiteGeo) => {
    setMaps(ms => ms.map(m => (m.id === id ? { ...m, geo } : m)));
    if (pending.current && pending.current.id !== id) void flush();
    pending.current = { id, patch: { geo } };
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void flush(); }, SAVE_DELAY_MS);
  }, [flush]);

  const commit = useCallback((next: SiteZone[]) => applyZones(next, zonesRef.current), [applyZones]);

  const undo = useCallback(() => {
    const prev = history.current.pop();
    setCanUndo(history.current.length > 0);
    if (prev) {
      applyZones(prev);
      if (selected && !prev.some(z => z.id === selected)) setSelected(null);
    }
  }, [applyZones, selected]);

  const selectMap = useCallback((id: string | null) => {
    void flush();
    history.current = [];
    setCanUndo(false);
    setSelected(null);
    setActiveId(id);
    setZoom(1);
    setNatAspect(null);
    setImgBroken(false);
    setRenaming(null);
    if (id) writeStored(ACTIVE_KEY(clientId), id);
  }, [clientId, flush]);

  // ── Thêm / thay / xoá ảnh ────────────────────────────────────────────────
  const addMap = useCallback(async (file: File) => {
    if (phase === 'missing') { setBanner(CLIENT_MAPS_MIGRATION_HINT); return; }
    if (!file.type.startsWith('image/')) { setBanner('Chỉ nhận file ảnh (JPG, PNG, WebP…).'); return; }
    setBanner(null);
    setBusy('Đang tải ảnh lên…');
    try {
      const image = await uploadSiteImage(clientId, file);
      const title = maps.length ? `Mặt bằng ${maps.length + 1}` : 'Mặt bằng nhà xưởng';
      const sortOrder = maps.reduce((m, r) => Math.max(m, r.sort_order), 0) + 1;
      const row = await createSiteMap({ clientId, title, image, sortOrder, userName });
      setMaps(ms => [...ms, row]);
      selectMap(row.id);
      setEditing(true);
      setTool('label');
    } catch (e) {
      if (isMissingTableError(e as { code?: string; message?: string })) { setPhase('missing'); setBanner(CLIENT_MAPS_MIGRATION_HINT); }
      else setBanner('Không thêm được ảnh: ' + errText(e));
    } finally {
      setBusy(null);
    }
  }, [clientId, maps, phase, selectMap, userName]);

  const addGeoMap = useCallback(async (at: GeoPt, title: string) => {
    setSatMenu(false);
    if (phase === 'missing') { setBanner(CLIENT_MAPS_MIGRATION_HINT); return; }
    if (!geoReady) { setBanner(SITE_GEO_MIGRATION_HINT); return; }
    setBanner(null);
    setBusy('Đang mở bản đồ vệ tinh…');
    try {
      const sortOrder = maps.reduce((m, r) => Math.max(m, r.sort_order), 0) + 1;
      const row = await createGeoMap({ clientId, title, geo: newSiteGeo(at), sortOrder, userName });
      setMaps(ms => [...ms, row]);
      selectMap(row.id);
    } catch (e) {
      setBanner('Không tạo được bản đồ vệ tinh: ' + errText(e));
    } finally {
      setBusy(null);
    }
  }, [clientId, geoReady, maps, phase, selectMap, userName]);

  const replaceImage = async (file: File) => {
    if (!active) return;
    if (!file.type.startsWith('image/')) { setBanner('Chỉ nhận file ảnh (JPG, PNG, WebP…).'); return; }
    setBusy('Đang thay ảnh…');
    try {
      const image = await uploadSiteImage(clientId, file);
      const row = await updateSiteMap(active.id, { image_url: image.url, storage_path: image.storagePath, width: image.width, height: image.height }, userName);
      setMaps(ms => ms.map(m => (m.id === row.id ? { ...row, zones: m.zones } : m)));
      setNatAspect(null);
      setImgBroken(false);
    } catch (e) {
      setBanner('Không thay được ảnh: ' + errText(e));
    } finally {
      setBusy(null);
    }
  };

  const removeMap = async () => {
    if (!active) return;
    setMenuOpen(false);
    const ok = window.confirm(`Xoá ${active.kind === 'map' ? 'bản đồ vệ tinh' : 'ảnh mặt bằng'} "${active.title || 'không tên'}" cùng ${zoneCount(active)} khu vực đã vẽ khỏi hồ sơ khách?\n\n(Dữ liệu vẫn giữ trong hệ thống — khôi phục được ở Lịch sử dữ liệu.)`);
    if (!ok) return;
    await flush();
    try {
      await archiveSiteMap(active.id, userName);
      const rest = maps.filter(m => m.id !== active.id);
      setMaps(rest);
      selectMap(rest[0]?.id ?? null);
      setEditing(false);
    } catch (e) {
      setBanner('Không xoá được: ' + errText(e));
    }
  };

  const rename = async (title: string) => {
    const id = renaming;
    setRenaming(null);
    const m = maps.find(x => x.id === id);
    if (!m || title.trim() === m.title) return;
    setMaps(ms => ms.map(x => (x.id === m.id ? { ...x, title: title.trim() } : x)));
    try { await updateSiteMap(m.id, { title: title.trim() }, userName); } catch (e) { setBanner('Không đổi được tên: ' + errText(e)); }
  };

  // Dán ảnh chụp màn hình (⌘V / Ctrl+V) = thêm ảnh mới
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (isTyping(e.target) || busy) return;
      const file = Array.from(e.clipboardData?.files ?? []).find(f => f.type.startsWith('image/'));
      if (!file) return;
      e.preventDefault();
      void addMap(file);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [addMap, busy]);

  // ── Phím tắt khi đang vẽ ────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isTyping(e.target)) {
        if (selected) setSelected(null);
        else if (full) setFull(false);
        return;
      }
      if (!editing || isTyping(e.target)) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
        e.preventDefault();
        commit(zonesRef.current.filter(z => z.id !== selected));
        setSelected(null);
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [commit, editing, full, selected, undo]);

  // Ô tên khu vực mới tạo: focus + chọn sẵn chữ → gõ luôn tên thật
  useEffect(() => {
    if (!focusZone) return;
    const el = document.getElementById(`zone-label-${focusZone}`) as HTMLInputElement | null;
    if (el) { el.focus(); el.select(); }
    setFocusZone(null);
  }, [focusZone]);

  // ── Kích thước khung xem: mặc định vừa trọn ảnh, phóng to thì cuộn ─────
  useEffect(() => {
    const el = viewRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setView({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setView({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, [activeId, full, phase]);

  const aspect = active?.width && active?.height ? active.height / active.width : natAspect ?? 0.75;
  const pad = mobile ? 16 : 32;
  const fitW = Math.max(160, Math.min(view.w - pad, (view.h - pad) / aspect));
  const dispW = Math.round(fitW * zoom);
  const fontPx = (z: SiteZone) => Math.max(9, dispW * LABEL_FONT_RATIO * (z.size ?? 1));

  // ── Thao tác chuột / ngón tay trên ảnh ─────────────────────────────────
  const toPt = (e: { clientX: number; clientY: number }): Pt => {
    const r = overlayRef.current!.getBoundingClientRect();
    const k = (n: number) => Math.round(Math.max(0, Math.min(1, n)) * 10_000) / 10_000;
    return { x: k((e.clientX - r.left) / r.width), y: k((e.clientY - r.top) / r.height) };
  };

  const createZone = (base: Omit<SiteZone, 'id' | 'label' | 'note' | 'color'>) => {
    const cur = zonesRef.current;
    const last = cur[cur.length - 1];
    const zone: SiteZone = { id: zoneId(), label: nextZoneLabel(cur), note: '', color: last?.color ?? ZONE_COLORS[0], ...base };
    commit([...cur, zone]);
    setSelected(zone.id);
    setFocusZone(zone.id);
  };

  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const el = e.target instanceof Element ? e.target : null;
    const handle = el?.closest('[data-handle]')?.getAttribute('data-handle');
    const hitId = el?.closest('[data-zone]')?.getAttribute('data-zone') ?? null;
    const p = toPt(e);
    if (hitId) document.getElementById(`legend-row-${hitId}`)?.scrollIntoView({ block: 'nearest' });
    if (!editing) { setSelected(hitId && hitId !== selected ? hitId : null); return; }
    const cur = zonesRef.current;
    if (handle) {
      const z = cur.find(x => x.id === handle);
      if (!z) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { kind: 'resize', id: z.id, orig: z, snapshot: cur };
      e.preventDefault();
      return;
    }
    if (hitId) {
      const z = cur.find(x => x.id === hitId);
      if (!z) return;
      setSelected(hitId);
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { kind: 'move', id: hitId, start: p, orig: z, snapshot: cur, moved: false };
      e.preventDefault();
      return;
    }
    if (tool === 'label') { createZone({ x: p.x, y: p.y }); e.preventDefault(); return; }
    if (tool === 'rect') {
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { kind: 'draw', start: p };
      setDraft({ x: p.x, y: p.y, w: 0, h: 0 });
      e.preventDefault();
      return;
    }
    setSelected(null);
  };

  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const p = toPt(e);
    if (d.kind === 'draw') { setDraft(rectFrom(d.start, p)); return; }
    if (d.kind === 'move') {
      const dx = p.x - d.start.x, dy = p.y - d.start.y;
      if (!d.moved && Math.hypot(dx * dispW, dy * dispW * aspect) < 3) return;
      d.moved = true;
      applyZones(zonesRef.current.map(z => (z.id === d.id ? moveZone(d.orig, dx, dy) : z)));
      return;
    }
    applyZones(zonesRef.current.map(z => (z.id === d.id ? resizeZone(d.orig, p) : z)));
  };

  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.kind === 'draw') {
      const r = rectFrom(d.start, toPt(e));
      setDraft(null);
      if (r.w < MIN_RECT || r.h < MIN_RECT) createZone({ x: d.start.x, y: d.start.y });
      else createZone(r);
      return;
    }
    // Kéo xong mới ghi 1 bước Hoàn tác (không ghi từng li kéo)
    if (d.kind === 'resize' || d.moved) {
      history.current = [...history.current.slice(-(HISTORY_MAX - 1)), d.snapshot];
      setCanUndo(true);
    }
  };

  // Gõ tên / ghi chú: cả đợt gõ trong 1 ô = 1 bước Hoàn tác (ghi trạng thái lúc vào ô, chỉ khi thật sự sửa)
  const textSnap = useRef<SiteZone[] | null>(null);
  const updateZone = (id: string, patch: Partial<SiteZone>, withHistory: boolean) => {
    const next = zonesRef.current.map(z => (z.id === id ? { ...z, ...patch } : z));
    if (withHistory) { commit(next); return; }
    const snap = textSnap.current;
    textSnap.current = null;
    applyZones(next, snap ?? undefined);
  };
  const markTextStart = () => { textSnap.current = zonesRef.current; };

  const focusOnMap = (id: string) => {
    setSelected(id);
    document.getElementById(`site-zone-${id}`)?.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
  };

  const sorted = useMemo(() => sortZones(zones), [zones]);

  // ── Giao diện ──────────────────────────────────────────────────────────
  if (phase === 'loading') {
    return <div className="flex-1 flex items-center justify-center gap-2 text-[12.5px] text-[#999]"><Loader2 size={16} className="animate-spin" /> Đang tải mặt bằng…</div>;
  }
  if (phase === 'error') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6 text-center text-[13px] text-[#666]">
        <AlertTriangle size={22} className="text-amber-500" />
        <div>Không tải được ảnh mặt bằng: {loadError}</div>
        <button onClick={load} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 text-[12.5px] hover:bg-gray-50"><RefreshCw size={13} /> Thử lại</button>
      </div>
    );
  }

  const onDropFile = (e: ReactDragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = Array.from(e.dataTransfer.files).find(f => f.type.startsWith('image/'));
    if (file) void addMap(file);
  };

  const toolBtn = (t: Tool, icon: ReactNode, label: string) => (
    <button key={t} onClick={() => setTool(t)} title={label}
      className={`inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-[12px] font-medium transition ${tool === t ? 'bg-[#1D4ED8] text-white' : 'text-[#333] hover:bg-black/[0.06]'}`}>
      {icon}<span className={mobile ? 'hidden' : ''}>{label}</span>
    </button>
  );

  return (
    <div
      className={full ? 'fixed inset-0 z-[300] bg-white flex flex-col' : 'flex-1 min-h-0 flex flex-col'}
      onDragOver={e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragOver(true); } }}
      onDragLeave={e => { if (e.currentTarget === e.target) setDragOver(false); }}
      onDrop={onDropFile}
    >
      <input ref={addInput} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void addMap(f); }} />
      <input ref={replaceInput} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void replaceImage(f); }} />

      {/* Hàng 1: các ảnh mặt bằng + nút thao tác */}
      <div className="shrink-0 flex flex-wrap items-center gap-2 px-3 md:px-5 py-2 border-b border-[#E8E7E2] bg-white">
        <div className="flex items-center gap-1.5 min-w-0 overflow-x-auto">
          {maps.map(m => (
            renaming === m.id ? (
              <input key={m.id} autoFocus defaultValue={m.title} maxLength={80}
                onBlur={e => rename(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setRenaming(null); }}
                className="h-8 w-44 px-2 rounded-lg border border-blue-400 text-[12.5px] outline-none" />
            ) : (
              <button key={m.id} onClick={() => selectMap(m.id)} onDoubleClick={() => setRenaming(m.id)} title="Bấm đúp để đổi tên"
                className={`shrink-0 h-8 px-3 rounded-lg text-[12.5px] font-medium border transition whitespace-nowrap ${m.id === activeId ? 'border-[#1D4ED8] bg-[#1D4ED8]/[0.07] text-[#1D4ED8]' : 'border-[#E0E0E5] text-[#555] hover:bg-[#F5F5F7]'}`}>
                {m.kind === 'map' && <Satellite size={12} className="inline -mt-0.5 mr-1 opacity-70" />}{m.title || 'Không tên'}{zoneCount(m) ? <span className="ml-1.5 text-[11px] opacity-60">{zoneCount(m)}</span> : null}
              </button>
            )
          ))}
          <button onClick={() => (geoReady ? setSatMenu(true) : setBanner(SITE_GEO_MIGRATION_HINT))} disabled={!!busy || phase === 'missing'}
            className="shrink-0 inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-dashed border-[#1D4ED8]/50 text-[12px] font-medium text-[#1D4ED8] hover:bg-[#1D4ED8]/[0.06] disabled:opacity-50">
            <Satellite size={14} /> Bản đồ vệ tinh
          </button>
          <button onClick={() => addInput.current?.click()} disabled={!!busy || phase === 'missing'}
            className="shrink-0 inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-dashed border-[#B9B9C3] text-[12px] font-medium text-[#555] hover:bg-[#F5F5F7] disabled:opacity-50">
            <ImagePlus size={14} /> {maps.length ? 'Thêm ảnh' : 'Tải ảnh mặt bằng'}
          </button>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          {busy && <span className="text-[11.5px] text-[#888] inline-flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> {busy}</span>}
          {!busy && <SaveBadge save={save} onRetry={() => { void flush(); }} />}
          {active && (
            <>
              {active.kind !== 'map' && <div className="flex items-center rounded-lg border border-[#E0E0E5]">
                <button onClick={() => setZoom(z => ZOOMS[Math.max(0, ZOOMS.indexOf(z) - 1)] ?? 1)} disabled={zoom === ZOOMS[0]} title="Thu nhỏ"
                  className="w-8 h-8 inline-flex items-center justify-center text-[#555] disabled:opacity-30 hover:bg-black/[0.04] rounded-l-lg"><ZoomOut size={14} /></button>
                <button onClick={() => setZoom(1)} title="Vừa khung" className="h-8 px-1 text-[11px] tabular-nums text-[#555] hover:bg-black/[0.04]">{Math.round(zoom * 100)}%</button>
                <button onClick={() => setZoom(z => ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.indexOf(z) + 1)] ?? z)} disabled={zoom === ZOOMS[ZOOMS.length - 1]} title="Phóng to"
                  className="w-8 h-8 inline-flex items-center justify-center text-[#555] disabled:opacity-30 hover:bg-black/[0.04] rounded-r-lg"><ZoomIn size={14} /></button>
              </div>}
              <button onClick={() => setFull(f => !f)} title={full ? 'Thu về' : 'Toàn màn hình'}
                className="w-8 h-8 inline-flex items-center justify-center rounded-lg border border-[#E0E0E5] text-[#555] hover:bg-black/[0.04]">
                {full ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
              </button>
              <div className="relative">
                <button onClick={() => setMenuOpen(o => !o)} title="Thêm thao tác"
                  className="w-8 h-8 inline-flex items-center justify-center rounded-lg border border-[#E0E0E5] text-[#555] hover:bg-black/[0.04]"><MoreHorizontal size={15} /></button>
                {menuOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                    <div className="absolute right-0 top-9 z-50 w-52 rounded-xl border border-[#E8E7E2] bg-white shadow-lg py-1 text-[12.5px]">
                      <button onClick={() => { setMenuOpen(false); setRenaming(active.id); }} className="w-full flex items-center gap-2 px-3 py-2 hover:bg-[#F5F5F7]"><Pencil size={13} /> Đổi tên</button>
                      {active.kind !== 'map' && <button onClick={() => { setMenuOpen(false); replaceInput.current?.click(); }} className="w-full flex items-center gap-2 px-3 py-2 hover:bg-[#F5F5F7]"><RefreshCw size={13} /> Thay ảnh (giữ khu vực)</button>}
                      <button onClick={removeMap} className="w-full flex items-center gap-2 px-3 py-2 text-red-600 hover:bg-red-50"><Trash2 size={13} /> {active.kind === 'map' ? 'Xoá bản đồ này' : 'Xoá ảnh này'}</button>
                    </div>
                  </>
                )}
              </div>
              {!editing && active.kind !== 'map' && (
                <button onClick={() => { setEditing(true); setTool(zones.length ? 'select' : 'label'); }}
                  className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-[#1D4ED8] text-white text-[12px] font-medium hover:bg-[#1E40AF]">
                  <Pencil size={13} /> Vẽ khu vực
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Hàng 2 (đang vẽ): công cụ */}
      {editing && active && active.kind !== 'map' && (
        <div className="shrink-0 flex flex-wrap items-center gap-1.5 px-3 md:px-5 py-1.5 border-b border-[#E8E7E2] bg-[#F7F8FC]">
          {toolBtn('select', <MousePointer2 size={14} />, 'Chọn / di chuyển')}
          {toolBtn('label', <Tag size={14} />, 'Đặt nhãn')}
          {toolBtn('rect', <Square size={14} />, 'Khoanh vùng')}
          <span className="hidden md:inline text-[11.5px] text-[#888] ml-2">
            {tool === 'label' ? 'Bấm vào ảnh để đặt nhãn (B3, B5…)' : tool === 'rect' ? 'Kéo trên ảnh để khoanh 1 khu' : 'Kéo nhãn để dời · kéo góc để đổi cỡ · Delete để xoá'}
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            <button onClick={undo} disabled={!canUndo} title="Hoàn tác (⌘Z)"
              className="inline-flex items-center gap-1 h-8 px-2.5 rounded-lg text-[12px] text-[#333] hover:bg-black/[0.06] disabled:opacity-30"><Undo2 size={14} /> <span className={mobile ? 'hidden' : ''}>Hoàn tác</span></button>
            <button onClick={() => { setEditing(false); setDraft(null); void flush(); }}
              className="inline-flex items-center gap-1 h-8 px-3 rounded-lg bg-emerald-600 text-white text-[12px] font-medium hover:bg-emerald-700"><Check size={14} /> Xong</button>
          </div>
        </div>
      )}

      {(banner || phase === 'missing') && (
        <div className="shrink-0 flex items-start gap-2 px-3 md:px-5 py-2 bg-amber-50 border-b border-amber-200 text-[12px] text-amber-800">
          <AlertTriangle size={14} className="shrink-0 mt-px" />
          <span className="flex-1">{phase === 'missing' ? `${CLIENT_MAPS_MIGRATION_HINT}. Chưa chạy thì chưa lưu được ảnh mặt bằng.` : banner}</span>
          {banner && phase !== 'missing' && <button onClick={() => setBanner(null)} aria-label="Đóng"><X size={14} /></button>}
        </div>
      )}

      {!active ? (
        <div className={`flex-1 flex flex-col items-center justify-center gap-3 p-6 text-center ${dragOver ? 'bg-blue-50' : ''}`}>
          <div className="w-14 h-14 rounded-2xl bg-[#EEF2FF] text-[#1D4ED8] flex items-center justify-center"><Satellite size={26} /></div>
          <div className="text-[14px] font-semibold text-[#111]">Chưa có mặt bằng nhà xưởng</div>
          <div className="text-[12.5px] text-[#777] max-w-md">
            Mở <b>bản đồ vệ tinh</b> ngay tại vị trí nhà máy đã ghim, tự khoanh từng khối nhà của công ty rồi ghi tên xưởng (B3, B5 Gia vị, Kho TN…) lên đó —
            xoay bản đồ cho nhà xưởng nằm thẳng. Hoặc tải ảnh sơ đồ có sẵn (ảnh chụp, bản vẽ…).
            {!mobile && ' Ảnh có thể kéo thả vào đây hoặc dán ảnh chụp màn hình (⌘V).'}
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button onClick={() => (geoReady ? setSatMenu(true) : setBanner(SITE_GEO_MIGRATION_HINT))} disabled={!!busy || phase === 'missing'}
              className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-[#1D4ED8] text-white text-[12.5px] font-medium hover:bg-[#1E40AF] disabled:opacity-50">
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Satellite size={14} />} Mở bản đồ vệ tinh
            </button>
            <button onClick={() => addInput.current?.click()} disabled={!!busy || phase === 'missing'}
              className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg border border-[#C9CAD3] bg-white text-[#333] text-[12.5px] font-medium hover:bg-[#F5F5F7] disabled:opacity-50">
              <ImagePlus size={14} /> Tải ảnh mặt bằng
            </button>
          </div>
        </div>
      ) : active.kind === 'map' ? (
        active.geo ? (
          <SatelliteSiteEditor key={active.id} map={active} onChange={geo => applyGeo(active.id, geo)} />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 p-6 text-center text-[12.5px] text-[#666]">
            <AlertTriangle size={20} className="text-amber-500" />
            Dữ liệu bản đồ vệ tinh này bị thiếu toạ độ tâm nên không mở được. Xoá bản đồ này (nút ⋯) rồi tạo lại.
          </div>
        )
      ) : (
        <div className="flex-1 min-h-0 flex flex-col md:flex-row">
          {/* Ảnh + khu vực */}
          <div ref={viewRef} className={`relative flex-1 min-h-[280px] overflow-auto flex ${dragOver ? 'bg-blue-50' : 'bg-[#EEEEF1]'}`}>
            <div className="m-auto" style={{ padding: pad / 2 }}>
              <div className="relative shadow-sm bg-white select-none" style={{ width: dispW }}>
                {imgBroken ? (
                  <div className="flex flex-col items-center justify-center gap-2 text-[12.5px] text-[#888]" style={{ height: dispW * aspect }}>
                    <AlertTriangle size={20} className="text-amber-500" /> Không mở được ảnh — thử "Thay ảnh" trong nút ⋯
                  </div>
                ) : (
                  <img src={active.image_url} alt={active.title} draggable={false} className="block w-full h-auto pointer-events-none"
                    onLoad={e => { const i = e.currentTarget; if (i.naturalWidth) setNatAspect(i.naturalHeight / i.naturalWidth); }}
                    onError={() => setImgBroken(true)} />
                )}
                <div
                  ref={overlayRef}
                  className="absolute inset-0"
                  style={{ cursor: editing ? (tool === 'select' ? 'default' : 'crosshair') : 'default', touchAction: editing && tool !== 'select' ? 'none' : 'auto' }}
                  onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
                >
                  {zones.map(z => (
                    <ZoneMark key={z.id} z={z} fontPx={fontPx(z)} selected={z.id === selected} editing={editing} />
                  ))}
                  {draft && (
                    <div className="absolute border-2 border-dashed border-[#1D4ED8] bg-[#1D4ED8]/10 rounded-[3px] pointer-events-none"
                      style={{ left: `${draft.x * 100}%`, top: `${draft.y * 100}%`, width: `${draft.w * 100}%`, height: `${draft.h * 100}%` }} />
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Bảng chú thích */}
          <aside className="shrink-0 md:w-72 max-h-[42vh] md:max-h-none overflow-y-auto border-t md:border-t-0 md:border-l border-[#E8E7E2] bg-white">
            <div className="sticky top-0 z-10 bg-white px-4 pt-3 pb-2 border-b border-[#F0F0F2]">
              <div className="text-[12px] font-semibold text-[#111]">Chú thích <span className="text-[#999] font-normal">({zones.length})</span></div>
              {editing && <div className="text-[11px] text-[#999] mt-0.5">Ghi chú = khu đó làm gì (Gia vị, H. Nhân, Kho…)</div>}
            </div>
            {sorted.length === 0 ? (
              <div className="px-4 py-6 text-[12px] text-[#999] text-center">
                {editing ? 'Bấm vào ảnh để đặt nhãn đầu tiên.' : 'Chưa có khu vực nào. Bấm "Vẽ khu vực" để đặt nhãn B3, B5… lên ảnh.'}
              </div>
            ) : (
              <ul className="py-1">
                {sorted.map(z => (
                  <li key={z.id} id={`legend-row-${z.id}`}>
                    {editing && z.id === selected ? (
                      <ZoneEditor z={z} mobile={mobile}
                        onFocusText={markTextStart}
                        onText={patch => updateZone(z.id, patch, false)}
                        onStyle={patch => updateZone(z.id, patch, true)}
                        onDelete={() => { commit(zonesRef.current.filter(x => x.id !== z.id)); setSelected(null); }}
                        onClose={() => setSelected(null)} />
                    ) : (
                      <button onClick={() => focusOnMap(z.id)}
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
          </aside>
        </div>
      )}

      {satMenu && <SatelliteStartMenu client={client} onPick={addGeoMap} onClose={() => setSatMenu(false)} />}
    </div>
  );
}

/** 1 khu vực trên ảnh: nhãn rời (chữ to trên nền trắng như ảnh mẫu) hoặc vùng chữ nhật có nhãn ở giữa. */
function ZoneMark({ z, fontPx, selected, editing }: { z: SiteZone; fontPx: number; selected: boolean; editing: boolean }) {
  const pill = (
    <span className="whitespace-nowrap font-bold leading-none rounded-[0.22em] shadow-[0_1px_3px_rgba(0,0,0,0.18)]"
      style={{
        fontSize: fontPx, color: z.color, background: 'rgba(255,255,255,0.9)', padding: '0.16em 0.32em',
        outline: selected ? `2px solid ${editing ? '#1D4ED8' : z.color}` : undefined, outlineOffset: 2,
      }}>
      {z.label || '?'}
    </span>
  );
  const title = z.note ? `${z.label}: ${z.note}` : z.label;
  const touch = editing ? 'none' : 'auto';
  if (z.w != null && z.h != null) {
    return (
      <div id={`site-zone-${z.id}`} data-zone={z.id} title={title}
        className={`absolute rounded-[3px] flex items-center justify-center ${editing ? 'cursor-move' : 'cursor-pointer'}`}
        style={{
          left: `${z.x * 100}%`, top: `${z.y * 100}%`, width: `${z.w * 100}%`, height: `${z.h * 100}%`,
          border: `${Math.max(1.5, fontPx * 0.09)}px solid ${z.color}`, background: `${z.color}1f`, touchAction: touch,
          boxShadow: selected ? '0 0 0 2px #fff, 0 0 0 4px #1D4ED8' : undefined,
        }}>
        {pill}
        {editing && selected && (
          <span data-handle={z.id} className="absolute -right-2 -bottom-2 w-4 h-4 rounded-full bg-white border-2 border-[#1D4ED8] cursor-nwse-resize" style={{ touchAction: 'none' }} />
        )}
      </div>
    );
  }
  return (
    <div id={`site-zone-${z.id}`} data-zone={z.id} title={title}
      className={`absolute ${editing ? 'cursor-move' : 'cursor-pointer'}`}
      style={{ left: `${z.x * 100}%`, top: `${z.y * 100}%`, transform: 'translate(-50%, -50%)', touchAction: touch }}>
      {pill}
    </div>
  );
}

function SaveBadge({ save, onRetry }: { save: SaveState; onRetry: () => void }) {
  if (save.s === 'saving') return <span className="text-[11.5px] text-[#888] inline-flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> Đang lưu…</span>;
  if (save.s === 'error') {
    return (
      <button onClick={onRetry} title={save.msg} className="text-[11.5px] text-red-600 inline-flex items-center gap-1 hover:underline">
        <AlertTriangle size={12} /> Chưa lưu — thử lại
      </button>
    );
  }
  if (save.s === 'saved') return <span className="hidden sm:inline-flex text-[11.5px] text-[#888] items-center gap-1"><Check size={12} className="text-emerald-600" /> Đã lưu {fmtTime(save.at)}</span>;
  return null;
}

/** Hộp chọn nơi mở bản đồ vệ tinh: các vị trí nhà máy ĐÃ GHIM của khách (CRM Pipeline → Nhà máy theo KCN, vị trí chính,
 *  Thị trường) — bấm là mở đúng chỗ đó; chưa ghim thì dán link Google Maps. */
function SatelliteStartMenu({ client, onPick, onClose }: {
  client: Client;
  onPick: (at: GeoPt, title: string) => void;
  onClose: () => void;
}) {
  const [locs, setLocs] = useState<SiteLocation[] | null>(null);
  const [link, setLink] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    let alive = true;
    loadSiteLocations(client).then(l => { if (alive) setLocs(l); }).catch(() => { if (alive) setLocs([]); });
    return () => { alive = false; };
  }, [client]);

  const openLink = () => {
    const pt = parseLatLngFromLink(link);
    if (pt && isValidVnLatLng(pt)) { onPick(pt, 'Mặt bằng vệ tinh'); return; }
    setErr(mapLinkStatus(link) === 'short'
      ? 'Link rút gọn (maps.app.goo.gl) không đọc được toạ độ — mở link đó trong trình duyệt rồi dán lại link dài có dạng …/@10.97,106.63,…'
      : 'Chưa đọc được toạ độ trong link — dán link Google Maps của nhà máy (có dạng …/@10.97,106.63,…).');
  };

  return (
    <div className="fixed inset-0 z-[400] bg-black/35 flex items-end md:items-center justify-center p-0 md:p-4" onClick={onClose}>
      <div className="w-full md:max-w-md bg-white rounded-t-2xl md:rounded-2xl shadow-2xl p-4 md:p-5 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-start gap-2">
          <div className="w-9 h-9 rounded-xl bg-[#EEF2FF] text-[#1D4ED8] flex items-center justify-center shrink-0"><Satellite size={18} /></div>
          <div className="flex-1 min-w-0">
            <div className="text-[14px] font-semibold text-[#111]">Bản đồ vệ tinh — chọn nhà máy</div>
            <div className="text-[12px] text-[#777] mt-0.5">Mở ngay tại vị trí đã ghim, rồi bạn khoanh các khối nhà của {client.name}.</div>
          </div>
          <button onClick={onClose} aria-label="Đóng" className="text-[#999] hover:text-[#555]"><X size={16} /></button>
        </div>

        <div className="mt-3 space-y-1.5">
          {locs === null && <div className="flex items-center gap-2 text-[12.5px] text-[#999] py-3"><Loader2 size={14} className="animate-spin" /> Đang lấy vị trí nhà máy đã ghim…</div>}
          {locs?.map(l => (
            <button key={l.key} onClick={() => onPick({ lat: l.lat, lng: l.lng }, l.source === 'factory' ? l.label : l.source === 'zone' ? `Mặt bằng — ${l.label}` : 'Mặt bằng vệ tinh')}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border border-[#E4E4EA] text-left hover:border-[#1D4ED8] hover:bg-[#1D4ED8]/[0.04] transition">
              <MapPin size={16} className={l.source === 'zone' ? 'text-[#999]' : 'text-[#DC2626]'} />
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium text-[#111] truncate">{l.label}</span>
                <span className="block text-[11.5px] text-[#888]">{SOURCE_HINT[l.source]} · {l.lat.toFixed(5)}, {l.lng.toFixed(5)}</span>
              </span>
            </button>
          ))}
          {locs && locs.length === 0 && (
            <div className="text-[12.5px] text-[#666] bg-[#FAFAF8] border border-[#EEE] rounded-xl px-3 py-2.5">
              Khách này chưa có vị trí nhà máy nào được ghim. Ghim ở <b>Hồ sơ chăm sóc → Vị trí trên bản đồ</b>, hoặc dán link Google Maps của nhà máy bên dưới.
            </div>
          )}
        </div>

        <div className="mt-3 pt-3 border-t border-[#F0F0F2]">
          <div className="text-[11.5px] font-medium text-[#555] mb-1.5">Hoặc dán link Google Maps của nhà máy</div>
          <div className="flex gap-2">
            <input value={link} onChange={e => { setLink(e.target.value); setErr(''); }} onKeyDown={e => { if (e.key === 'Enter') openLink(); }}
              placeholder="https://www.google.com/maps/@10.97,106.63,…" className="flex-1 min-w-0 h-9 px-3 rounded-lg border border-[#D5D5DC] text-[12.5px] outline-none focus:border-[#1D4ED8]" />
            <button onClick={openLink} disabled={!link.trim()} className="h-9 px-3.5 rounded-lg bg-[#1D4ED8] text-white text-[12.5px] font-medium hover:bg-[#1E40AF] disabled:opacity-40">Mở</button>
          </div>
          {err && <div className="text-[11.5px] text-amber-700 mt-1.5">{err}</div>}
        </div>
      </div>
    </div>
  );
}
