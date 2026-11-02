// Chế độ Khảo sát KCN (Thị trường → Bản đồ → nút "Khảo sát KCN") — toàn màn hình, làm cho điện thoại cầm tay khi chạy xe:
//  - Bấm Bắt đầu: ghi vết GPS, vẽ đường đã đi (xanh dương) chồng lên vết các lần trước (xám) và tô cam các con đường
//    trong KCN chưa đi (mạng đường OpenStreetMap) → nhìn là biết rẽ hướng nào.
//  - Đi ngang công ty nào thì hiện tên; khách hàng / pipeline / KH tiềm năng hiện luôn thẻ tổng quan.
//  - Chụp bảng chỉ tiêu tuyển dụng ngoài cổng → lưu ảnh kèm toạ độ chỗ chụp, xem lại ở Lịch sử.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  Camera, ChevronLeft, ChevronRight, Factory, History, ImagePlus, Layers, Loader2, LocateFixed, Maximize, Minus, Navigation, Pause, Play, Plus, Settings, Square, X, AlertTriangle, MapPin,
} from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { useAuth } from '../../../lib/auth';
import { logActivity } from '../../../lib/audit';
import { pruneMissing } from '../../../lib/serviceMode';
import { shortId } from '../../../hooks/useHashSubRoute';
import { invalidateCompanyIndex } from '../../../hooks/useCompanyDuplicates';
import { streetTiles } from '../../../lib/mapTiles';
import { escapeMapHtml, SOUTH_VN_BOUNDS } from '../../../lib/mapGroups';
import type { Branch, LaborHistoryEntry, MarketLead, MarketZone } from '../../../lib/types';
import type { MarketTab } from '../../Market';
import {
  boundsAround, distM, distToShape, fmtDistance, fmtDuration, roadCoverage, splitRoads, mergePieces, TrackIndex,
  type Bounds, type TrackSegment,
} from '../../../lib/kcnSurvey/track';
import {
  companiesNear, mergeOsmPlaces, notePassed, pickCurrent, roadFactoryScores, STATUS_META, type NearbyCompany, type PassedCompany, type SurveyCompany,
} from '../../../lib/kcnSurvey/companies';
import { clusterShare, companiesInArea, dayRange, detectZone, surveyTitle, type ZoneCandidate } from '../../../lib/kcnSurvey/zones';
import { areaKey, cachedArea, fetchArea, pickZoneBoundary, piecesInZone, type AreaMap } from '../../../lib/kcnSurvey/overpass';
import { readFileExif } from '../../../lib/kcnSurvey/exif';
import {
  countTripsBetween, listPhotos, listTrips, loadTracks, titleColumnMissing, TITLE_MIGRATION_HINT, updateTrip, uploadPhoto,
  type PhotoMeta, type SurveyPhoto, type SurveyTrip,
} from '../../../lib/kcnSurvey/api';
import { useSurveyRecorder, pendingActiveTrip, type SummaryResult } from './useSurveyRecorder';
import { useSurveyData, loadSurveyPrefs, saveSurveyPrefs, zoomForSpeed, fold, type SurveyPrefs } from './surveyData';
import SurveyCompanyCard, { StatusDot, statusLabel, type CompanyLookup } from './SurveyCompanyCard';
import SurveyPhotoSheet, { type PhotoFormValue, type PhotoPosition } from './SurveyPhotoSheet';
import SurveySettingsPanel, { type AreaStatus } from './SurveySettingsPanel';
import SurveyHistoryPanel, { type PhotoFilter } from './SurveyHistoryPanel';

interface Props {
  marketZones: MarketZone[];
  marketLeads: MarketLead[];
  branches: Branch[];
  laborHistory: Record<string, LaborHistoryEntry[]>;
  goTab: (tab: MarketTab) => void;
  onClose: () => void;
}

type Panel = 'none' | 'settings' | 'history' | 'zone' | 'nearby' | 'todo';

interface UploadJob {
  id: string;
  label: string;
  state: 'uploading' | 'failed';
  error?: string;
  file: File;
  meta: PhotoMeta;
}

const toLatLngs = (seg: TrackSegment) => seg.map(p => [p[0], p[1]] as [number, number]);

export default function KcnSurveyMode({ marketZones, marketLeads, branches, laborHistory, goTab, onClose }: Props) {
  const { user } = useAuth();
  const [prefs, setPrefs] = useState<SurveyPrefs>(() => loadSurveyPrefs());
  const setPref = useCallback((p: Partial<SurveyPrefs>) => setPrefs(prev => { const next = { ...prev, ...p }; saveSurveyPrefs(next); return next; }), []);

  const [flashMsg, setFlashMsg] = useState<string | null>(null);
  const flashTimer = useRef<number | null>(null);
  const say = useCallback((m: string) => {
    setFlashMsg(m);
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlashMsg(null), 3500);
  }, []);

  const recorder = useSurveyRecorder({ maxAccuracy: prefs.maxAccuracy });
  const { fix } = recorder;
  const data = useSurveyData(marketLeads);
  const [pending, setPending] = useState(() => pendingActiveTrip());

  // ── KCN đang khảo sát ─────────────────────────────────────────────────────
  /** undefined = chưa chọn (tự gợi ý theo GPS lần đầu), null = không gắn KCN */
  const [zoneId, setZoneId] = useState<string | null | undefined>(() => pending?.trip.zone_id ?? undefined);
  const zone = useMemo(() => (zoneId ? marketZones.find(z => z.id === zoneId) ?? null : null), [zoneId, marketZones]);
  const zoneName = zone?.name ?? (zoneId && pending?.trip.zone_id === zoneId ? pending.trip.zone_name : '') ?? '';
  /** auto = app tự chọn theo tâm KCN gần nhất · boundary = đứng trong ranh giới OSM · manual = tự chọn · trip = theo chuyến dở */
  const zoneSourceRef = useRef<'auto' | 'boundary' | 'manual' | 'trip'>(pending ? 'trip' : 'auto');
  /** Tên chuyến do app đặt — còn giữ nguyên (chưa sửa tay) thì đổi KCN sẽ đặt lại tên */
  const autoTitleRef = useRef(pending?.trip.title ?? '');

  // Tâm vùng: KCN có toạ độ → tâm KCN; không thì vị trí GPS đầu tiên
  const [gpsAnchor, setGpsAnchor] = useState<{ lat: number; lng: number } | null>(null);
  useEffect(() => { if (fix && !gpsAnchor) setGpsAnchor({ lat: fix.lat, lng: fix.lng }); }, [fix, gpsAnchor]);
  const anchor = useMemo(() => (zone?.lat != null && zone?.lng != null ? { lat: zone.lat, lng: zone.lng } : gpsAnchor), [zone, gpsAnchor]);
  const [areaOverride, setAreaOverride] = useState<Bounds | null>(null);
  const areaBounds = useMemo(() => areaOverride ?? (anchor ? boundsAround(anchor, prefs.areaRadiusM) : null), [areaOverride, anchor, prefs.areaRadiusM]);
  useEffect(() => { setAreaOverride(null); }, [zoneId]);

  // ── Bản đồ đường + nhà máy OSM ────────────────────────────────────────────
  const [area, setArea] = useState<AreaMap | null>(null);
  const [areaStatus, setAreaStatus] = useState<AreaStatus>({ state: 'idle', roads: 0, places: 0, fetchedAt: null, error: null });
  const [areaReload, setAreaReload] = useState(0);
  /** Bấm "Tải theo khung nhìn" = tải mới, bỏ qua bản nhớ trong máy */
  const areaForceRef = useRef(false);
  useEffect(() => {
    if (!areaBounds) return;
    const key = areaKey(areaBounds, prefs.includeService);
    const cached = areaForceRef.current ? null : cachedArea(key);
    areaForceRef.current = false;
    if (cached) {
      setArea(cached);
      setAreaStatus({ state: 'ok', roads: cached.roads.length, places: cached.places.length, fetchedAt: cached.fetchedAt, error: null });
      return;
    }
    const ctrl = new AbortController();
    setAreaStatus(s => ({ ...s, state: 'loading', error: null }));
    fetchArea(areaBounds, prefs.includeService, ctrl.signal)
      .then(a => {
        setArea(a);
        setAreaStatus({ state: 'ok', roads: a.roads.length, places: a.places.length, fetchedAt: a.fetchedAt, error: null });
      })
      .catch(e => { if (!ctrl.signal.aborted) setAreaStatus(s => ({ ...s, state: 'error', error: (e as Error).message })); });
    return () => ctrl.abort();
  }, [areaBounds, prefs.includeService, areaReload]);
  // Máy chủ OSM công cộng hay quá tải theo đợt → tự thử lại sau 30 giây, tối đa 3 lần (bấm "Tải theo khung nhìn" để thử ngay)
  const areaRetries = useRef(0);
  useEffect(() => { areaRetries.current = 0; }, [areaBounds, prefs.includeService]);
  useEffect(() => {
    if (areaStatus.state !== 'error' || !prefs.showRoads || areaRetries.current >= 3) return;
    const t = window.setTimeout(() => { areaRetries.current += 1; setAreaReload(n => n + 1); }, 30_000);
    return () => window.clearTimeout(t);
  }, [areaStatus.state, prefs.showRoads]);

  // ── Đang ở KCN nào ─────────────────────────────────────────────────────────
  // Lần đầu có GPS: chọn ngay theo tâm KCN gần nhất (≤ 3 km) để có vùng tải bản đồ. Khi bản đồ OSM về mà đang đứng
  // TRONG ranh giới 1 KCN khác → đổi sang KCN đó (chỉ khi chưa bắt đầu chuyến và chưa tự chọn tay).
  useEffect(() => {
    if (zoneId !== undefined || !fix) return;
    const d = detectZone(fix, area?.zones ?? [], marketZones);
    setZoneId(d.best ? d.best.zone.id : null);
    zoneSourceRef.current = d.best?.inside ? 'boundary' : 'auto';
    if (d.best) say(d.best.inside ? `Đang trong ranh giới ${d.best.zone.name}` : `Đang ở gần ${d.best.zone.name}`);
  }, [fix, zoneId, marketZones, area, say]);
  useEffect(() => {
    if (!fix || !area?.zones?.length || recorder.trip || pending) return;
    if (zoneSourceRef.current === 'manual' || zoneSourceRef.current === 'trip') return;
    const d = detectZone(fix, area.zones, marketZones);
    if (d.best?.inside && d.best.zone.id !== zoneId) {
      setZoneId(d.best.zone.id);
      zoneSourceRef.current = 'boundary';
      say(`Đang trong ranh giới ${d.best.zone.name}`);
    }
  }, [fix, area, marketZones, zoneId, recorder.trip, pending, say]);

  // ── Chuyến cũ + ảnh quanh vùng ─────────────────────────────────────────────
  const [oldTrips, setOldTrips] = useState<SurveyTrip[]>([]);
  const [oldTracks, setOldTracks] = useState<Map<string, TrackSegment[]>>(new Map());
  const [photos, setPhotos] = useState<SurveyPhoto[]>([]);
  const [dbError, setDbError] = useState<string | null>(null);
  const [historyTick, setHistoryTick] = useState(0);
  useEffect(() => {
    if (zoneId === undefined && !areaBounds) return;
    let alive = true;
    (async () => {
      try {
        const [trips, ph] = await Promise.all([
          listTrips({ zoneId: zoneId ?? null, bounds: areaBounds, limit: 40 }),
          listPhotos({ zoneId: zoneId ?? null, bounds: areaBounds, limit: 300 }),
        ]);
        const tracks = await loadTracks(trips.map(t => t.id));
        if (!alive) return;
        setOldTrips(trips);
        setOldTracks(tracks);
        setPhotos(ph);
        setDbError(null);
      } catch (e) {
        if (alive) setDbError((e as Error).message);
      }
    })();
    return () => { alive = false; };
  }, [zoneId, areaBounds, historyTick]);

  // ── Công ty: hệ thống + OSM ───────────────────────────────────────────────
  const allCompanies = useMemo(() => mergeOsmPlaces(data.companies, area?.places ?? []), [data.companies, area]);
  const branchName = useCallback((id: string | null | undefined) => {
    if (!id) return null;
    const b = branches.find(x => x.id === id);
    return b ? b.name : null;
  }, [branches]);
  const lookup: CompanyLookup = useMemo(() => ({
    clientById: data.clientById, pipelineById: data.pipelineById, leadById: data.leadById, laborHistory, branchName,
  }), [data.clientById, data.pipelineById, data.leadById, laborHistory, branchName]);

  const photosOf = useCallback((c: SurveyCompany) => photos.filter(p =>
    (c.clientId && p.client_id === c.clientId) || (c.crmId && p.crm_id === c.crmId) || (c.leadId && p.lead_id === c.leadId)
    || (!p.client_id && !p.crm_id && !p.lead_id && p.company_name && fold(p.company_name) === fold(c.name))), [photos]);

  // ── Công ty đang đi ngang ─────────────────────────────────────────────────
  const nearby = useMemo<NearbyCompany[]>(() => (fix ? companiesNear(fix, allCompanies, prefs.radiusM) : []), [fix, allCompanies, prefs.radiusM]);
  const [currentKey, setCurrentKey] = useState<string | null>(null);
  const current = useMemo(() => pickCurrent(nearby, currentKey), [nearby, currentKey]);
  const [expanded, setExpanded] = useState(true);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [pinnedKey, setPinnedKey] = useState<string | null>(null);
  useEffect(() => {
    const key = current?.company.key ?? null;
    if (key !== currentKey) {
      setCurrentKey(key);
      if (current) setExpanded(STATUS_META[current.company.status].rich);
    }
  }, [current, currentKey]);
  // Đi khỏi bán kính thì "ẩn thẻ" hết hiệu lực — lần sau quay lại vẫn báo
  useEffect(() => {
    setDismissed(prev => {
      if (!prev.size) return prev;
      const keys = new Set(nearby.map(n => n.company.key));
      const next = new Set([...prev].filter(k => keys.has(k)));
      return next.size === prev.size ? prev : next;
    });
  }, [nearby]);

  const passedRef = useRef<Map<string, PassedCompany>>(new Map((pending?.passed ?? []).map(p => [p.key, p])));
  const [passedCount, setPassedCount] = useState(passedRef.current.size);
  const prevNearRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const keys = new Set(nearby.map(n => n.company.key));
    if (recorder.status === 'recording') {
      if (notePassed(passedRef.current, nearby, new Date().toISOString())) {
        setPassedCount(passedRef.current.size);
        recorder.setPassed([...passedRef.current.values()]);
      }
      const fresh = nearby.some(n => STATUS_META[n.company.status].rich && n.company.status !== 'declined' && !prevNearRef.current.has(n.company.key));
      if (fresh && prefs.vibrate && 'vibrate' in navigator) navigator.vibrate?.([60, 40, 60]);
    }
    prevNearRef.current = keys;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nearby, recorder.status, prefs.vibrate]);

  const pinned = useMemo<NearbyCompany | null>(() => {
    if (!pinnedKey) return null;
    const c = allCompanies.find(x => x.key === pinnedKey);
    if (!c) return null;
    const near = nearby.find(n => n.company.key === pinnedKey);
    return near ?? { company: c, dist: fix && (c.points.length || c.rings.length) ? distToShape(fix, c.points, c.rings) : NaN };
  }, [pinnedKey, allCompanies, nearby, fix]);
  const cardItem = pinned ?? (current && !dismissed.has(current.company.key) ? current : null);

  // ── Độ phủ đường ──────────────────────────────────────────────────────────
  // Ranh giới KCN trên OSM → chỉ tính đường bên trong (vùng tải là hình vuông nên dính cả khu dân cư xung quanh)
  const boundary = useMemo(() => (area && anchor ? pickZoneBoundary(area.zones ?? [], anchor, zone?.name ?? null) : null), [area, anchor, zone?.name]);
  // Ranh giới CỤM (1 khối bao nhiều KCN) → chỉ lấy phần gần tâm KCN đang chọn hơn tâm các KCN khác trong cụm
  const share = useMemo(() => (boundary && zone ? clusterShare(boundary, zone.id, marketZones) : null), [boundary, zone, marketZones]);
  const pieces = useMemo(() => {
    if (!area || !prefs.showRoads) return [];
    const all = splitRoads(area.roads);
    if (!boundary || !prefs.clipToZone) return all;
    const inZone = piecesInZone(all, boundary);
    return share ? inZone.filter(p => share({ lat: p.mid[0], lng: p.mid[1] })) : inZone;
  }, [area, prefs.showRoads, boundary, prefs.clipToZone, share]);
  const [covTick, setCovTick] = useState(0);
  const covTimer = useRef<number | null>(null);
  useEffect(() => {
    if (covTimer.current) return;
    covTimer.current = window.setTimeout(() => { covTimer.current = null; setCovTick(t => t + 1); }, 2500);
  }, [recorder.version]);
  useEffect(() => () => { if (covTimer.current) window.clearTimeout(covTimer.current); }, []);
  const coverage = useMemo(() => {
    if (!pieces.length || !anchor) return null;
    const idx = new TrackIndex(anchor.lat, anchor.lng);
    if (prefs.showOldTracks) {
      for (const [id, segs] of oldTracks) if (id !== recorder.trip?.id) idx.addSegments(segs);
    }
    idx.addSegments(recorder.segments);
    return roadCoverage(pieces, idx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pieces, anchor, oldTracks, prefs.showOldTracks, covTick, recorder.trip?.id]);
  // Khúc đường có nhà máy 2 bên (> 0) → tô đậm "nên đi"; đường trống tô nhạt
  const roadScores = useMemo(() => roadFactoryScores(pieces, allCompanies), [pieces, allCompanies]);
  const unvisitedFactoryM = useMemo(() => (coverage ? pieces.reduce((m, p, i) => (!coverage.covered[i] && roadScores[i] > 0 ? m + p.len : m), 0) : 0), [coverage, pieces, roadScores]);

  // ── Công ty trong KCN chưa đi ngang ───────────────────────────────────────
  const zoneCompanies = useMemo(() => {
    const list = companiesInArea(allCompanies, boundary, anchor);
    return share ? list.filter(c => { const p = c.points[0] ?? (c.rings[0]?.[0] ? { lat: c.rings[0][0][0], lng: c.rings[0][0][1] } : null); return !!p && share(p); }) : list;
  }, [allCompanies, boundary, anchor, share]);
  /** Công ty đã đi ngang ở các chuyến TRƯỚC → lần gần nhất */
  const passedBefore = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of oldTrips) {
      if (t.id === recorder.trip?.id) continue;
      for (const p of t.passed) if (!m.has(p.key)) m.set(p.key, t.started_at);
    }
    return m;
  }, [oldTrips, recorder.trip?.id]);
  const [todoRich, setTodoRich] = useState(false);
  const todo = useMemo(() => {
    const from = fix ?? anchor;
    const rows = zoneCompanies
      .filter(c => !passedRef.current.has(c.key))
      .map(c => ({ c, dist: from ? distToShape(from, c.points, c.rings) : NaN, before: prefs.showOldTracks ? passedBefore.get(c.key) ?? null : null }))
      .sort((a, b) => STATUS_META[a.c.status].rank - STATUS_META[b.c.status].rank || a.dist - b.dist);
    return { never: rows.filter(r => !r.before), before: rows.filter(r => r.before) };
    // passedCount: passedRef đổi bên trong → đếm để tính lại
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoneCompanies, passedCount, passedBefore, prefs.showOldTracks, fix?.lat, fix?.lng, anchor]);

  // ── Bản đồ ────────────────────────────────────────────────────────────────
  const mapDivRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layersRef = useRef<{
    street: L.LayerGroup; sat: L.TileLayer; satLabels: L.TileLayer; renderer: L.Canvas;
    roads: L.LayerGroup; outline: L.LayerGroup; old: L.LayerGroup; highlight: L.LayerGroup; companies: L.LayerGroup; photos: L.LayerGroup;
    curCasing: L.Polyline; curLine: L.Polyline; pos: L.Marker | null; acc: L.Circle | null;
  } | null>(null);
  const [follow, setFollow] = useState(true);
  const followRef = useRef(follow);
  followRef.current = follow;
  const [zoom, setZoom] = useState(prefs.followZoom);
  const [viewTick, setViewTick] = useState(0);

  useEffect(() => {
    if (!mapDivRef.current || mapRef.current) return;
    const map = L.map(mapDivRef.current, { zoomControl: false, attributionControl: true, maxZoom: 19 });
    map.attributionControl.setPrefix(false);
    if (anchor) map.setView([anchor.lat, anchor.lng], prefs.followZoom);
    else map.fitBounds(SOUTH_VN_BOUNDS);
    const renderer = L.canvas({ padding: 0.5 });
    const street = streetTiles();
    const sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Tiles &copy; Esri' });
    const satLabels = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 });
    const outline = L.layerGroup().addTo(map);
    const roads = L.layerGroup().addTo(map);
    const old = L.layerGroup().addTo(map);
    const highlight = L.layerGroup().addTo(map);
    const curCasing = L.polyline([], { color: '#fff', weight: 10, opacity: 0.9, renderer, interactive: false }).addTo(map);
    const curLine = L.polyline([], { color: '#2563EB', weight: 5.5, opacity: 1, renderer, interactive: false }).addTo(map);
    const companies = L.layerGroup().addTo(map);
    const photosLayer = L.layerGroup().addTo(map);
    layersRef.current = { street, sat, satLabels, renderer, roads, outline, old, highlight, companies, photos: photosLayer, curCasing, curLine, pos: null, acc: null };
    map.on('dragstart', () => setFollow(false));
    map.on('zoomend', () => setZoom(map.getZoom()));
    // Bám theo GPS là bản đồ dịch liên tục → chỉ vẽ lại ghim công ty khi đã dịch quá 1/4 khung nhìn hoặc đổi zoom
    let viewKey = '';
    map.on('moveend', () => {
      const b = map.getBounds(), c = map.getCenter();
      const stepLat = (b.getNorth() - b.getSouth()) / 4 || 1, stepLng = (b.getEast() - b.getWest()) / 4 || 1;
      const key = `${map.getZoom()}:${Math.round(c.lat / stepLat)}:${Math.round(c.lng / stepLng)}`;
      if (key !== viewKey) { viewKey = key; setViewTick(t => t + 1); }
    });
    mapRef.current = map;
    setTimeout(() => map.invalidateSize(), 50);
    return () => { map.remove(); mapRef.current = null; layersRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Nền đường phố / vệ tinh
  useEffect(() => {
    const map = mapRef.current, ly = layersRef.current;
    if (!map || !ly) return;
    if (prefs.satellite) { ly.street.remove(); ly.sat.addTo(map); ly.satLabels.addTo(map); ly.sat.bringToBack(); }
    else { ly.sat.remove(); ly.satLabels.remove(); ly.street.addTo(map); }
  }, [prefs.satellite]);

  // Bám theo vị trí (+ tự zoom theo tốc độ)
  const firstFixRef = useRef(true);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !fix) return;
    if (firstFixRef.current) {
      firstFixRef.current = false;
      if (followRef.current) map.setView([fix.lat, fix.lng], prefs.followZoom, { animate: false });
      return;
    }
    if (!followRef.current) return;
    const target = prefs.autoZoom ? zoomForSpeed(fix.speed, prefs.followZoom) : map.getZoom();
    if (target !== map.getZoom()) map.setView([fix.lat, fix.lng], target, { animate: true });
    else map.panTo([fix.lat, fix.lng], { animate: true, duration: 0.5 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fix]);

  const setMapZoom = useCallback((z: number) => {
    const map = mapRef.current;
    if (!map) return;
    const nz = Math.max(12, Math.min(19, Math.round(z)));
    setPref({ followZoom: nz });
    if (followRef.current && fix) map.setView([fix.lat, fix.lng], nz);
    else map.setZoom(nz);
  }, [fix, setPref]);

  const recenter = () => {
    setFollow(true);
    setPinnedKey(null);
    if (fix && mapRef.current) mapRef.current.setView([fix.lat, fix.lng], prefs.followZoom);
    else if (!fix) say(recorder.gpsError ?? 'Đang chờ tín hiệu GPS…');
  };

  const fitArea = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    setFollow(false);
    if (boundary) map.fitBounds(L.polygon(boundary.rings).getBounds(), { padding: [24, 24] });
    else if (areaBounds) map.fitBounds([[areaBounds.minLat, areaBounds.minLng], [areaBounds.maxLat, areaBounds.maxLng]], { padding: [20, 20] });
    else if (anchor) map.setView([anchor.lat, anchor.lng], 15);
  }, [boundary, areaBounds, anchor]);

  // Vị trí hiện tại: chấm xanh + vòng sai số + mũi tên hướng đi
  useEffect(() => {
    const map = mapRef.current, ly = layersRef.current;
    if (!map || !ly || !fix) return;
    const head = fix.heading != null && (fix.speed ?? 0) > 1 ? `<span class="kcs-pos-head" style="transform:rotate(${Math.round(fix.heading)}deg)"></span>` : '';
    const icon = L.divIcon({ className: 'kcs-pos', html: `${head}<span class="kcs-pos-dot"></span>`, iconSize: [44, 44], iconAnchor: [22, 22] });
    if (!ly.pos) ly.pos = L.marker([fix.lat, fix.lng], { icon, zIndexOffset: 2000, interactive: false }).addTo(map);
    else { ly.pos.setLatLng([fix.lat, fix.lng]); ly.pos.setIcon(icon); }
    if (!ly.acc) ly.acc = L.circle([fix.lat, fix.lng], { radius: fix.acc, color: '#2563EB', weight: 1, opacity: 0.4, fillOpacity: 0.08, interactive: false, renderer: ly.renderer }).addTo(map);
    else { ly.acc.setLatLng([fix.lat, fix.lng]); ly.acc.setRadius(fix.acc); }
  }, [fix]);

  // Vết chuyến đang đi
  useEffect(() => {
    const ly = layersRef.current;
    if (!ly) return;
    const lines = recorder.segments.filter(s => s.length).map(toLatLngs);
    ly.curCasing.setLatLngs(lines);
    ly.curLine.setLatLngs(lines);
  }, [recorder.version, recorder.segments]);

  // Vết các lần trước
  useEffect(() => {
    const ly = layersRef.current;
    if (!ly) return;
    ly.old.clearLayers();
    if (!prefs.showOldTracks) return;
    for (const [id, segs] of oldTracks) {
      if (id === recorder.trip?.id) continue;
      for (const seg of segs) {
        if (seg.length < 2) continue;
        L.polyline(toLatLngs(seg), { color: '#64748B', weight: 5, opacity: 0.5, renderer: ly.renderer, interactive: false }).addTo(ly.old);
      }
    }
  }, [oldTracks, prefs.showOldTracks, recorder.trip?.id]);

  // Viền ranh giới KCN
  useEffect(() => {
    const ly = layersRef.current;
    if (!ly) return;
    ly.outline.clearLayers();
    if (!boundary) return;
    L.polygon(boundary.rings, { color: '#D97706', weight: 2, opacity: 0.85, dashArray: '2 6', fillColor: '#F59E0B', fillOpacity: 0.04, renderer: ly.renderer, interactive: false }).addTo(ly.outline);
  }, [boundary]);

  // Đường đã đi / chưa đi — đường trục đậm hơn đường nhánh; chưa đi mà có nhà máy 2 bên: cam đặc (nên đi), đường trống: cam nhạt nét đứt
  useEffect(() => {
    const ly = layersRef.current;
    if (!ly) return;
    ly.roads.clearLayers();
    if (!coverage || !pieces.length) return;
    const draw = (pick: (i: number) => boolean, style: L.PolylineOptions) => {
      for (const line of mergePieces(pieces, pick)) L.polyline(line, { ...style, renderer: ly.renderer, interactive: false }).addTo(ly.roads);
    };
    const cov = (i: number) => coverage.covered[i];
    const busy = (i: number) => roadScores[i] > 0;
    draw(i => cov(i) && !pieces[i].main, { color: '#16A34A', weight: 3, opacity: 0.45 });
    draw(i => cov(i) && pieces[i].main, { color: '#16A34A', weight: 5, opacity: 0.5 });
    draw(i => !cov(i) && !busy(i) && !pieces[i].main, { color: '#FDBA74', weight: 3, opacity: 0.95, dashArray: '6 6' });
    draw(i => !cov(i) && !busy(i) && pieces[i].main, { color: '#FB923C', weight: 5, opacity: 0.95, dashArray: '8 6' });
    draw(i => !cov(i) && busy(i) && !pieces[i].main, { color: '#F97316', weight: 5, opacity: 0.95 });
    draw(i => !cov(i) && busy(i) && pieces[i].main, { color: '#EA580C', weight: 7, opacity: 0.95 });
  }, [coverage, pieces, roadScores]);

  // Ghim công ty trong khung nhìn (nhãn tên khi phóng gần)
  const passedKeysVersion = passedCount;
  useEffect(() => {
    const map = mapRef.current, ly = layersRef.current;
    if (!map || !ly) return;
    ly.companies.clearLayers();
    const view = map.getBounds().pad(0.25);
    const showLabels = prefs.labels && zoom >= 16;
    const center = map.getCenter();
    const shown: { c: SurveyCompany; p: { lat: number; lng: number }; d: number }[] = [];
    for (const c of allCompanies) {
      const p = c.points.find(q => view.contains([q.lat, q.lng])) ?? (c.rings.length && c.points[0] && view.contains([c.points[0].lat, c.points[0].lng]) ? c.points[0] : null);
      if (!p) continue;
      shown.push({ c, p, d: distM({ lat: center.lat, lng: center.lng }, p) });
    }
    shown.sort((a, b) => a.d - b.d);
    // Khối nhà xưởng (OSM) tô theo màu trạng thái — vẽ trước để chấm nằm trên
    if (zoom >= 15) {
      for (const { c } of shown.slice(0, 600)) {
        if (!c.rings.length) continue;
        const meta = STATUS_META[c.status];
        const poly = L.polygon(c.rings, {
          color: meta.color, weight: 1.5, opacity: 0.9, fillColor: meta.color, fillOpacity: c.status === 'osm' ? 0.12 : 0.3, renderer: ly.renderer,
        });
        poly.on('click', () => { setPinnedKey(c.key); setExpanded(true); });
        poly.addTo(ly.companies);
      }
    }
    shown.slice(0, 600).forEach(({ c, p }, i) => {
      const meta = STATUS_META[c.status];
      const passed = passedRef.current.has(c.key);
      const m = L.circleMarker([p.lat, p.lng], {
        radius: meta.rich ? 7 : 5, color: passed ? '#111' : '#fff', weight: passed ? 2.5 : 2, fillColor: meta.color, fillOpacity: c.status === 'osm' ? 0.7 : 0.95, renderer: ly.renderer,
      });
      if (showLabels && i < 150) m.bindTooltip(escapeMapHtml(c.name), { permanent: true, direction: 'right', offset: [8, 0], className: 'kcs-label' });
      m.on('click', () => { setPinnedKey(c.key); setExpanded(true); });
      m.addTo(ly.companies);
    });
  }, [allCompanies, viewTick, zoom, prefs.labels, passedKeysVersion]);

  // Ảnh chỉ tiêu
  const openViewerRef = useRef<(p: SurveyPhoto) => void>(() => {});
  useEffect(() => {
    const ly = layersRef.current;
    if (!ly) return;
    ly.photos.clearLayers();
    if (!prefs.showPhotos) return;
    for (const p of photos) {
      const icon = L.divIcon({
        className: 'kcs-photo',
        html: p.thumb_url ? `<img src="${escapeMapHtml(p.thumb_url)}" alt="" />` : '<span>📷</span>',
        iconSize: [34, 34], iconAnchor: [17, 17],
      });
      const m = L.marker([p.lat, p.lng], { icon, zIndexOffset: 500 });
      m.bindTooltip(escapeMapHtml([p.company_name || 'Ảnh chỉ tiêu', new Date(p.taken_at).toLocaleDateString('vi-VN')].join(' · ')), { direction: 'top', offset: [0, -16], className: 'lgmap-tooltip' });
      m.on('click', () => openViewerRef.current(p));
      m.addTo(ly.photos);
    }
  }, [photos, prefs.showPhotos]);

  // Chuyến đang xem lại từ Lịch sử
  const [highlightTrip, setHighlightTrip] = useState<SurveyTrip | null>(null);
  const showTripOnMap = (trip: SurveyTrip, segs: TrackSegment[]) => {
    const map = mapRef.current, ly = layersRef.current;
    if (!map || !ly) return;
    ly.highlight.clearLayers();
    const lines = segs.filter(s => s.length >= 2).map(toLatLngs);
    if (!lines.length) { say('Chuyến này chưa có vết GPS'); return; }
    L.polyline(lines, { color: '#fff', weight: 10, opacity: 0.9, renderer: ly.renderer, interactive: false }).addTo(ly.highlight);
    const pl = L.polyline(lines, { color: '#F59E0B', weight: 6, opacity: 1, renderer: ly.renderer, interactive: false }).addTo(ly.highlight);
    setFollow(false);
    map.fitBounds(pl.getBounds(), { padding: [40, 40] });
    setHighlightTrip(trip);
    setPanel('none');
  };
  const clearHighlight = () => { layersRef.current?.highlight.clearLayers(); setHighlightTrip(null); };

  // ── Panel / sheet ─────────────────────────────────────────────────────────
  const [panel, setPanel] = useState<Panel>('none');
  const [historyInit, setHistoryInit] = useState<{ tab: 'trips' | 'photos'; filter: PhotoFilter | null }>({ tab: 'trips', filter: null });
  const [viewerPhoto, setViewerPhoto] = useState<SurveyPhoto | null>(null);
  openViewerRef.current = p => setViewerPhoto(p);

  const showPhoto = (p: SurveyPhoto) => {
    const map = mapRef.current;
    setPanel('none');
    setFollow(false);
    setPref({ showPhotos: true });
    map?.setView([p.lat, p.lng], Math.max(map.getZoom(), 18));
    setPhotos(list => (list.some(x => x.id === p.id) ? list : [p, ...list]));
  };

  // ── Chụp ảnh ──────────────────────────────────────────────────────────────
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const captureRef = useRef<{ position: PhotoPosition | null; preset: SurveyCompany | null; at: string }>({ position: null, preset: null, at: '' });
  const [draft, setDraft] = useState<{ file: File; position: PhotoPosition | null; preset: SurveyCompany | null; takenAt: string } | null>(null);
  const [uploads, setUploads] = useState<UploadJob[]>([]);

  const fixPosition = (): PhotoPosition | null =>
    fix && Date.now() - fix.at < 60_000 && fix.acc <= 150 ? { lat: fix.lat, lng: fix.lng, acc: fix.acc, source: 'gps' } : null;

  const beginCapture = (preset: SurveyCompany | null, fromLibrary = false) => {
    captureRef.current = { position: fixPosition(), preset: preset ?? cardItem?.company ?? null, at: new Date().toISOString() };
    (fromLibrary ? libraryRef : cameraRef).current?.click();
  };
  const onFile = async (file: File | undefined, fromLibrary: boolean) => {
    if (!file) return;
    let position = captureRef.current.position;
    let takenAt = captureRef.current.at || new Date().toISOString();
    if (fromLibrary) {
      const exif = await readFileExif(file);
      if (exif?.lat != null && exif.lng != null) position = { lat: exif.lat, lng: exif.lng, acc: null, source: 'exif' };
      if (exif?.takenAt) {
        const t = new Date(exif.takenAt); // giờ máy ảnh = giờ địa phương
        if (!Number.isNaN(t.getTime())) takenAt = t.toISOString();
      }
    }
    setDraft({ file, position, preset: captureRef.current.preset, takenAt });
  };
  // Mở màn lưu khi chưa có GPS → lấy vị trí đầu tiên tới sau đó
  const draftPosition = draft ? (draft.position ?? fixPosition()) : null;
  const draftSuggestions = useMemo(
    () => (draftPosition ? companiesNear(draftPosition, allCompanies, Math.max(300, prefs.radiusM)) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [draft, draftPosition?.lat, draftPosition?.lng, allCompanies, prefs.radiusM],
  );

  const runUpload = useCallback((job: UploadJob) => {
    setUploads(list => [...list.filter(j => j.id !== job.id), { ...job, state: 'uploading', error: undefined }]);
    uploadPhoto(job.id, job.file, job.meta)
      .then(photo => {
        setUploads(list => list.filter(j => j.id !== job.id));
        setPhotos(list => [photo, ...list.filter(p => p.id !== photo.id)]);
        say(`Đã lưu ảnh chỉ tiêu${photo.company_name ? ` — ${photo.company_name}` : ''}`);
      })
      .catch(e => setUploads(list => list.map(j => (j.id === job.id ? { ...j, state: 'failed', error: (e as Error).message } : j))));
  }, [say]);

  const savePhoto = async (v: PhotoFormValue) => {
    if (!draft || !draftPosition) return;
    const pos = draftPosition;
    let leadId = v.company?.leadId ?? null;
    if (v.addToMarket && v.companyName) {
      try {
        const now = new Date().toISOString();
        const row = await pruneMissing('market_leads', {
          company_name: v.companyName, region: zone?.name ?? null, industry: null, workers_needed: 0,
          source: 'Khảo sát KCN', status: 'Chưa LH', suppliers: [{ name: "Let's Go VN", qty: 0, is_us: true }],
          map_link: `https://www.google.com/maps?q=${pos.lat.toFixed(6)},${pos.lng.toFixed(6)}`, lat: pos.lat, lng: pos.lng, geocoded_at: now,
        }, ['geocoded_at']);
        const { data: ins, error } = await supabase.from('market_leads').insert(row).select('id').single();
        if (error) throw error;
        leadId = ins.id;
        await logActivity({ user, action: 'insert', table: 'market_leads', recordId: ins.id, description: `Thêm công ty "${v.companyName}" từ Khảo sát KCN (ghim tại chỗ chụp ảnh chỉ tiêu)`, newData: row });
        invalidateCompanyIndex();
        // App nạp lại Thị trường → công ty mới hiện trên bản đồ khảo sát
        window.dispatchEvent(new Event('lgvn:market-changed'));
      } catch (e) {
        say('Không thêm được công ty vào Thị trường: ' + ((e as Error).message ?? '') + ' — ảnh vẫn được lưu');
      }
    }
    const meta: PhotoMeta = {
      trip_id: recorder.trip?.id ?? null,
      zone_id: zone?.id ?? null, zone_name: zone?.name ?? '',
      lat: pos.lat, lng: pos.lng, accuracy_m: pos.acc, position_source: pos.source,
      taken_at: draft.takenAt,
      company_name: v.companyName, client_id: v.company?.clientId ?? null, lead_id: leadId, crm_id: v.company?.crmId ?? null,
      positions: v.positions, headcount: v.headcount, wage_text: v.wage_text, note: v.note,
      user_id: user?.id ?? null, user_name: user?.full_name ?? '',
    };
    runUpload({ id: crypto.randomUUID(), label: v.companyName || 'Ảnh chỉ tiêu', state: 'uploading', file: draft.file, meta });
    setDraft(null);
  };

  // ── Thêm công ty OSM vào Thị trường ───────────────────────────────────────
  const addOsmCompany = async (c: SurveyCompany) => {
    const p = c.points[0];
    if (!p) return;
    if (!window.confirm(`Thêm “${c.name}” vào Thị trường → Công ty/Dự án?\n\nGhim theo vị trí trên bản đồ OSM${zone ? `, KCN ${zone.name}` : ''}. Kiểm tra trùng tên ở tab Công ty/Dự án nếu chưa chắc.`)) return;
    try {
      const row = await pruneMissing('market_leads', {
        company_name: c.name, region: zone?.name ?? null, industry: null, workers_needed: 0, source: 'Khảo sát KCN', status: 'Chưa LH',
        suppliers: [{ name: "Let's Go VN", qty: 0, is_us: true }],
        map_link: `https://www.google.com/maps?q=${p.lat.toFixed(6)},${p.lng.toFixed(6)}`, lat: p.lat, lng: p.lng, geocoded_at: new Date().toISOString(),
      }, ['geocoded_at']);
      const { data: ins, error } = await supabase.from('market_leads').insert(row).select('id').single();
      if (error) throw error;
      await logActivity({ user, action: 'insert', table: 'market_leads', recordId: ins.id, description: `Thêm công ty "${c.name}" từ Khảo sát KCN (bản đồ OSM)`, newData: row });
      invalidateCompanyIndex();
      window.dispatchEvent(new Event('lgvn:market-changed'));
      say(`Đã thêm ${c.name} vào Thị trường`);
    } catch (e) {
      say('Lỗi thêm công ty: ' + (e as Error).message);
    }
  };

  // ── Mở hồ sơ (rời màn khảo sát) ───────────────────────────────────────────
  const openProfile = async (c: SurveyCompany) => {
    if (recorder.status === 'recording') {
      if (!window.confirm('Đang ghi đường đi — mở hồ sơ sẽ TẠM DỪNG khảo sát.\nQuay lại Bản đồ → Khảo sát KCN để đi tiếp. Mở hồ sơ?')) return;
      await recorder.pause();
    }
    if (c.clientId) window.location.hash = `#/client-detail/${shortId(c.clientId)}`;
    else if (c.crmId) window.dispatchEvent(new CustomEvent('lgvn:open-pipeline', { detail: c.crmId }));
    else if (c.leadId) { onClose(); goTab('leads'); }
  };

  // ── Bắt đầu / dừng / kết thúc ─────────────────────────────────────────────
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<SummaryResult | null>(null);
  const [summaryNote, setSummaryNote] = useState('');
  const [summaryTitle, setSummaryTitle] = useState('');
  /** Bấm Bắt đầu mà 2 KCN gần ngang nhau (cụm Nhơn Trạch…) → hỏi lại đang ở KCN nào */
  const [zonePrompt, setZonePrompt] = useState<ZoneCandidate[] | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (recorder.status !== 'recording') return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [recorder.status]);

  /** Tên tự đặt: "KCN … – Khảo sát dd/mm/yyyy", thêm "(lần n)" nếu hôm nay đã khảo sát KCN này. */
  const makeTitle = async (z: { id: string; name: string } | null, at: Date) => {
    if (!z) return surveyTitle(null, at);
    const r = dayRange(at);
    return surveyTitle(z.name, at, (await countTripsBetween(z.id, r.from, r.to)) + 1);
  };

  const start = async (z: { id: string; name: string } | null) => {
    setBusy(true);
    try {
      const title = await makeTitle(z, new Date());
      autoTitleRef.current = title;
      await recorder.start({ id: z?.id ?? null, name: z?.name ?? '' }, { id: user?.id ?? null, name: user?.full_name ?? '' }, prefs.keepAwake, title);
      passedRef.current = new Map();
      setPassedCount(0);
      setPending(null);
      clearHighlight();
      setFollow(true);
      if (fix && mapRef.current) mapRef.current.setView([fix.lat, fix.lng], prefs.followZoom);
      say(fix ? `Bắt đầu: ${title}` : `Bắt đầu: ${title} — đang chờ tín hiệu GPS…`);
    } catch (e) {
      say((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /** Nút Bắt đầu: KCN do app tự đoán theo tâm mà KCN thứ 2 cũng gần ngang → hỏi lại trước. */
  const requestStart = () => {
    if (fix && zoneSourceRef.current === 'auto') {
      const d = detectZone(fix, area?.zones ?? [], marketZones);
      if (!d.sure && d.candidates.length >= 2) { setZonePrompt(d.candidates.slice(0, 3)); return; }
    }
    void start(zone ? { id: zone.id, name: zone.name } : null);
  };
  const startWithZone = (z: { id: string; name: string } | null) => {
    setZonePrompt(null);
    setZoneId(z?.id ?? null);
    zoneSourceRef.current = 'manual';
    void start(z);
  };

  const resumePending = () => {
    if (!pending) return;
    passedRef.current = new Map(pending.passed.map(p => [p.key, p]));
    setPassedCount(passedRef.current.size);
    if (pending.trip.zone_id) setZoneId(pending.trip.zone_id);
    recorder.resume(prefs.keepAwake);
    setPending(null);
    setFollow(true);
    say('Đi tiếp chuyến khảo sát');
  };

  const finish = async (fromPending = false) => {
    if (!window.confirm('Kết thúc chuyến khảo sát?')) return;
    if (fromPending) {
      if (!pending) return;
      passedRef.current = new Map(pending.passed.map(p => [p.key, p]));
      recorder.restorePaused();
      setPending(null);
    }
    setBusy(true);
    try {
      const res = await recorder.finish({ passed: [...passedRef.current.values()], roadCoverage: coverage?.pct ?? null });
      if (res) {
        setSummary(res);
        setSummaryNote(res.trip.note ?? '');
        setSummaryTitle(res.trip.title ?? '');
      }
      setHistoryTick(t => t + 1);
    } catch (e) {
      say((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const changeZone = async (id: string | null) => {
    setZoneId(id);
    zoneSourceRef.current = 'manual';
    setPanel('none');
    const z = id ? marketZones.find(x => x.id === id) : null;
    if (z?.lat != null && z?.lng != null && !fix) mapRef.current?.setView([z.lat, z.lng], 15);
    const trip = recorder.trip;
    if (trip) {
      const patch: { zone_id: string | null; zone_name: string; title?: string } = { zone_id: id, zone_name: z?.name ?? '' };
      // Tên vẫn là tên app tự đặt (chưa sửa tay) → đặt lại theo KCN mới
      if (!trip.title || trip.title === autoTitleRef.current) {
        patch.title = await makeTitle(z ? { id: z.id, name: z.name } : null, new Date(trip.started_at));
        autoTitleRef.current = patch.title;
      }
      recorder.patchTrip(patch);
      try { await updateTrip(trip.id, patch); }
      catch (e) { say((e as Error).message); }
    }
  };

  /** Đưa bản đồ tới 1 công ty và mở thẻ của nó (từ danh sách "chưa đi ngang"). */
  const focusCompany = (c: SurveyCompany) => {
    const map = mapRef.current;
    const p = c.points[0] ?? (c.rings[0]?.[0] ? { lat: c.rings[0][0][0], lng: c.rings[0][0][1] } : null);
    setPinnedKey(c.key);
    setExpanded(true);
    setPanel('none');
    if (map && p) { setFollow(false); map.setView([p.lat, p.lng], Math.max(map.getZoom(), 17)); }
  };

  const tryClose = async () => {
    if (recorder.status === 'recording' && !window.confirm('Đang ghi đường đi — thoát sẽ TẠM DỪNG khảo sát (mở lại để đi tiếp). Thoát?')) return;
    if (recorder.status === 'recording') await recorder.pause();
    onClose();
  };

  const elapsed = recorder.startedAt ? (recorder.status === 'recording' ? now : Date.now()) - recorder.startedAt : 0;
  const distance = useMemo(() => {
    let m = 0;
    for (const seg of recorder.segments) for (let i = 1; i < seg.length; i++) m += distM({ lat: seg[i - 1][0], lng: seg[i - 1][1] }, { lat: seg[i][0], lng: seg[i][1] });
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recorder.version, recorder.segments]);

  const zonesByDistance = useMemo(() => {
    const p = fix ?? anchor;
    return [...marketZones]
      .map(z => ({ z, d: p && z.lat != null && z.lng != null ? distM(p, { lat: z.lat, lng: z.lng }) : null }))
      .sort((a, b) => (a.d ?? 1e12) - (b.d ?? 1e12) || a.z.name.localeCompare(b.z.name, 'vi'));
  }, [marketZones, fix, anchor]);
  const [zoneQuery, setZoneQuery] = useState('');

  const recording = recorder.status === 'recording';
  const hasTrip = !!recorder.trip;
  const failedUploads = uploads.filter(u => u.state === 'failed');
  const uploading = uploads.filter(u => u.state === 'uploading');

  return createPortal(
    <div className="fixed inset-0 z-[1200] bg-[#E5E3DF] select-none" style={{ touchAction: 'manipulation' }}>
      <div ref={mapDivRef} className="absolute inset-0" />

      {/* ── Thanh trên ── */}
      <div className="absolute inset-x-0 top-0 z-[1100] pointer-events-none pt-[env(safe-area-inset-top)]">
        <div className="flex items-start gap-2 px-3 pt-3">
          <button onClick={tryClose} className="pointer-events-auto h-11 pl-2.5 pr-3.5 rounded-full bg-white/95 backdrop-blur shadow-lg flex items-center gap-1 text-[14px] font-medium text-[#1D1D1F]">
            <ChevronLeft size={19} /> Thoát
          </button>
          <button onClick={() => setPanel(panel === 'zone' ? 'none' : 'zone')}
            className="pointer-events-auto flex-1 md:flex-none md:w-[400px] min-w-0 h-11 px-3.5 rounded-full bg-white/95 backdrop-blur shadow-lg text-left flex items-center gap-2">
            <MapPin size={15} className="text-[#D97706] shrink-0" />
            <span className="flex-1 min-w-0">
              <span className="block text-[14px] font-semibold text-[#1D1D1F] truncate leading-tight">{zoneName || (zoneId === undefined ? 'Đang tìm KCN gần nhất…' : 'Chọn KCN')}</span>
              {hasTrip && (
                <span className="block text-[11px] text-[#3A3A3C] leading-tight tabular-nums">
                  <span className={recording ? 'text-[#D70015]' : 'text-[#8E8E93]'}>{recording ? '● Đang ghi' : '❚❚ Tạm dừng'}</span>
                  {' · '}{fmtDuration(elapsed / 1000)} · {fmtDistance(distance)}
                  {coverage?.pct != null && ` · phủ ${coverage.pct.toLocaleString('vi-VN')}%`}
                </span>
              )}
              {!hasTrip && coverage?.pct != null && (
                <span className="block text-[11px] text-[#8E8E93] leading-tight">Đã đi {coverage.pct.toLocaleString('vi-VN')}% đường trong vùng (các lần trước)</span>
              )}
            </span>
          </button>
          <button onClick={() => setPanel(panel === 'settings' ? 'none' : 'settings')} aria-label="Cài đặt"
            className={`pointer-events-auto md:ml-auto shrink-0 w-11 h-11 rounded-full shadow-lg flex items-center justify-center ${panel === 'settings' ? 'bg-[#0A84FF] text-white' : 'bg-white/95 backdrop-blur text-[#1D1D1F]'}`}>
            <Settings size={19} />
          </button>
        </div>

        {/* Báo lỗi / trạng thái */}
        <div className="px-3 mt-2 space-y-2 md:max-w-[440px]">
          {recorder.gpsError && (
            <div className="pointer-events-auto rounded-xl bg-[#FFF4E5] text-[#8A4B00] text-[12.5px] px-3 py-2 shadow flex items-start gap-1.5">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" /> {recorder.gpsError}
            </div>
          )}
          {dbError && (
            <div className="pointer-events-auto rounded-xl bg-[#FFECEC] text-[#B00020] text-[12.5px] px-3 py-2 shadow">{dbError}</div>
          )}
          {pending && !hasTrip && (
            <div className="pointer-events-auto rounded-2xl bg-white/95 backdrop-blur shadow-lg px-3.5 py-3">
              <div className="text-[13.5px] font-semibold text-[#1D1D1F]">Chuyến khảo sát đang dở</div>
              <div className="text-[12px] text-[#3A3A3C] mt-0.5">
                {pending.trip.title || pending.trip.zone_name || 'Không gắn KCN'} · bắt đầu {new Date(pending.trip.started_at).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })} · {fmtDistance(pending.distance)}
              </div>
              <div className="flex gap-2 mt-2.5">
                <button onClick={resumePending} className="flex-1 h-10 rounded-full bg-[#0A84FF] text-white text-[13.5px] font-semibold">Đi tiếp</button>
                <button onClick={() => finish(true)} className="flex-1 h-10 rounded-full bg-[#F2F2F7] text-[13.5px] font-medium text-[#1D1D1F]">Kết thúc</button>
              </div>
            </div>
          )}
          {highlightTrip && (
            <div className="pointer-events-auto rounded-xl bg-[#FFF8E6] shadow px-3 py-2 flex items-center gap-2 text-[12.5px] text-[#7A4B00]">
              <span className="w-3 h-1.5 rounded-full bg-[#F59E0B] shrink-0" />
              <span className="flex-1 min-w-0 truncate">Đang xem chuyến {new Date(highlightTrip.started_at).toLocaleDateString('vi-VN')} · {highlightTrip.zone_name || 'không gắn KCN'} · {fmtDistance(highlightTrip.distance_m)}</span>
              <button onClick={clearHighlight} className="font-semibold shrink-0">Ẩn</button>
            </div>
          )}
          {cardItem && panel === 'none' && (
            <SurveyCompanyCard
              item={cardItem} lookup={lookup} photos={photosOf(cardItem.company)}
              expanded={expanded} onToggle={() => setExpanded(v => !v)}
              onClose={() => { if (pinnedKey) setPinnedKey(null); else if (current) setDismissed(prev => new Set(prev).add(current.company.key)); }}
              onOpenProfile={openProfile} onPhoto={c => beginCapture(c)} onAddToMarket={addOsmCompany}
              onShowPhotos={c => { setHistoryInit({ tab: 'photos', filter: { label: c.name, match: p => photosOf(c).some(x => x.id === p.id) } }); setPanel('history'); }}
              otherCount={pinned ? 0 : Math.max(0, nearby.length - 1)} onShowNearby={() => setPanel('nearby')}
            />
          )}
        </div>
      </div>

      {/* ── Nút bên phải: neo sát thanh dưới (gần ngón cái, không bị thẻ công ty phía trên che) ── */}
      <div className="absolute right-3 bottom-[calc(96px+env(safe-area-inset-bottom))] z-[1050] flex flex-col gap-2">
        <MapBtn onClick={() => setPref({ satellite: !prefs.satellite })} label="Nền vệ tinh" active={prefs.satellite}><Layers size={19} /></MapBtn>
        <MapBtn onClick={fitArea} label="Xem cả KCN"><Maximize size={19} /></MapBtn>
        <MapBtn onClick={recenter} label="Bám theo vị trí" active={follow}><LocateFixed size={20} /></MapBtn>
        <MapBtn onClick={() => setMapZoom(zoom + 1)} label="Phóng to"><Plus size={22} /></MapBtn>
        <MapBtn onClick={() => setMapZoom(zoom - 1)} label="Thu nhỏ"><Minus size={22} /></MapBtn>
      </div>

      {/* ── Thanh dưới ── */}
      <div className="absolute inset-x-0 bottom-0 z-[1100] pointer-events-none pb-[env(safe-area-inset-bottom)]">
        {zoneCompanies.length > 0 && (
          <div className="px-3 pb-1.5">
            <button onClick={() => setPanel('todo')}
              className="pointer-events-auto inline-flex items-center gap-1.5 h-9 pl-3 pr-3.5 rounded-full bg-white/95 backdrop-blur shadow text-[12.5px] font-medium text-[#1D1D1F] max-w-[calc(100%-72px)]">
              <Factory size={14} className="text-[#D97706] shrink-0" />
              <span className="truncate">
                {todo.never.length
                  ? <><b>{todo.never.length}</b> công ty chưa qua{todo.never.filter(r => STATUS_META[r.c.status].rich).length ? ` · ${todo.never.filter(r => STATUS_META[r.c.status].rich).length} KH/Pipeline` : ''}</>
                  : todo.before.length ? `Đã qua hết — ${todo.before.length} công ty chỉ qua ở lần trước` : 'Đã đi ngang hết công ty trong KCN'}
              </span>
              <ChevronRight size={14} className="text-[#C7C7CC] shrink-0" />
            </button>
          </div>
        )}
        <div className="px-3 pb-1.5 flex items-end justify-between gap-2">
          <div className="pointer-events-auto rounded-xl bg-white/90 backdrop-blur shadow px-2.5 py-1.5 text-[11px] text-[#3A3A3C] space-y-0.5 max-w-[calc(100%-72px)]">
            <div className="flex items-center gap-1.5"><span className="w-4 h-1.5 rounded-full bg-[#2563EB]" /> Chuyến này
              {prefs.showOldTracks && <><span className="w-4 h-1.5 rounded-full bg-[#64748B]/60 ml-1.5" /> Lần trước{oldTrips.filter(t => t.id !== recorder.trip?.id).length ? ` (${oldTrips.filter(t => t.id !== recorder.trip?.id).length})` : ''}</>}
            </div>
            {prefs.showRoads && coverage && (
              <>
                <div className="flex items-center gap-1.5"><span className="w-4 h-[3px] rounded-full bg-[#EA580C] shrink-0" /> Chưa đi, có nhà máy
                  <span className="text-[#8E8E93]">{fmtDistance(unvisitedFactoryM)}</span></div>
                <div className="flex items-center gap-1.5"><span className="w-4 border-t-2 border-dashed border-[#FDBA74] shrink-0" /> Chưa đi, đường trống
                  <span className="text-[#8E8E93]">{fmtDistance(Math.max(0, coverage.totalM - coverage.coveredM - unvisitedFactoryM))}</span></div>
              </>
            )}
            {prefs.showRoads && areaStatus.state === 'loading' && <div className="flex items-center gap-1 text-[#8E8E93]"><Loader2 size={10} className="animate-spin" /> Đang tải mạng đường…</div>}
            {prefs.showRoads && areaStatus.state === 'error' && (
              <div className="text-[#D70015]">
                Chưa tải được mạng đường{areaRetries.current < 3 ? ' — tự thử lại sau 30 giây' : ''}{' '}
                <button onClick={() => setAreaReload(n => n + 1)} className="font-semibold underline">Thử ngay</button>
              </div>
            )}
            <div className="text-[#8E8E93] tabular-nums">
              {fix ? `GPS ±${Math.round(fix.acc)} m` : 'Chờ GPS…'}
              {hasTrip && passedCount > 0 && ` · ${passedCount} công ty đã qua`}
              {recorder.unsynced > 0 && ` · ${recorder.unsynced} đoạn chờ gửi`}
              {recording && prefs.keepAwake && !recorder.wakeLockOn && ' · ⚠ màn hình có thể tự tắt'}
            </div>
          </div>
        </div>
        {(uploading.length > 0 || failedUploads.length > 0 || recorder.syncError) && (
          <div className="px-3 pb-1.5 space-y-1.5">
            {uploading.length > 0 && (
              <div className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full bg-[#1D1D1F]/85 text-white text-[12px] px-3 py-1.5">
                <Loader2 size={12} className="animate-spin" /> Đang lưu {uploading.length} ảnh…
              </div>
            )}
            {failedUploads.map(u => (
              <div key={u.id} className="pointer-events-auto flex items-center gap-2 rounded-xl bg-[#FFECEC] text-[#B00020] text-[12px] px-3 py-1.5 shadow">
                <span className="flex-1 min-w-0 truncate">Chưa lưu được ảnh “{u.label}”: {u.error}</span>
                <button onClick={() => runUpload(u)} className="font-semibold shrink-0">Thử lại</button>
                <button onClick={() => { if (window.confirm('Bỏ ảnh này (chưa được lưu)?')) setUploads(list => list.filter(j => j.id !== u.id)); }} className="shrink-0" aria-label="Bỏ ảnh"><X size={14} /></button>
              </div>
            ))}
            {recorder.syncError && (
              <div className="pointer-events-auto flex items-center gap-2 rounded-xl bg-[#FFF4E5] text-[#8A4B00] text-[12px] px-3 py-1.5 shadow">
                <span className="flex-1 min-w-0">Vết GPS chưa gửi được (đã lưu trong máy, sẽ gửi lại khi có mạng): {recorder.syncError}</span>
                <button onClick={() => void recorder.retrySync()} className="font-semibold shrink-0">Gửi lại</button>
              </div>
            )}
          </div>
        )}
        <div className="pointer-events-auto mx-3 md:mx-auto md:w-[560px] mb-3 rounded-[22px] bg-white/95 backdrop-blur-xl shadow-[0_8px_30px_rgba(0,0,0,0.2)] p-2 flex items-center gap-2">
          {!hasTrip ? (
            <>
              <BarBtn onClick={() => { setHistoryInit({ tab: 'trips', filter: null }); setPanel('history'); }} label="Lịch sử"><History size={20} /></BarBtn>
              <button onClick={requestStart} disabled={busy || !!pending}
                className="flex-1 h-14 rounded-2xl bg-[#0A84FF] text-white text-[16px] font-semibold flex items-center justify-center gap-2 active:scale-[0.98] transition disabled:opacity-50">
                {busy ? <Loader2 size={20} className="animate-spin" /> : <Play size={20} fill="currentColor" />} Bắt đầu khảo sát
              </button>
              <BarBtn onClick={() => beginCapture(null)} label="Chụp"><Camera size={20} /></BarBtn>
            </>
          ) : (
            <>
              {recording
                ? <BarBtn onClick={() => void recorder.pause()} label="Tạm dừng"><Pause size={20} /></BarBtn>
                : <BarBtn onClick={() => recorder.resume(prefs.keepAwake)} label="Đi tiếp" tone="blue"><Play size={20} /></BarBtn>}
              <button onClick={() => beginCapture(null)}
                className="flex-1 h-14 rounded-2xl bg-[#0A84FF] text-white text-[16px] font-semibold flex items-center justify-center gap-2 active:scale-[0.98] transition">
                <Camera size={21} /> Chụp chỉ tiêu
              </button>
              <BarBtn onClick={() => beginCapture(null, true)} label="Ảnh có sẵn"><ImagePlus size={20} /></BarBtn>
              <BarBtn onClick={() => void finish()} label="Kết thúc" tone="red" disabled={busy}><Square size={18} fill="currentColor" /></BarBtn>
            </>
          )}
        </div>
      </div>

      {flashMsg && (
        <div className="absolute left-1/2 -translate-x-1/2 bottom-[calc(150px+env(safe-area-inset-bottom))] z-[1400] max-w-[90vw] rounded-xl bg-[#1D1D1F]/90 text-white text-[13px] px-4 py-2.5 shadow-lg pointer-events-none text-center">
          {flashMsg}
        </div>
      )}

      <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={e => { void onFile(e.target.files?.[0], false); e.target.value = ''; }} />
      <input ref={libraryRef} type="file" accept="image/*" hidden onChange={e => { void onFile(e.target.files?.[0], true); e.target.value = ''; }} />

      {/* ── Panels ── */}
      {panel === 'settings' && (
        <SurveySettingsPanel prefs={prefs} onChange={setPref} zoom={zoom} onZoom={setMapZoom} onFitArea={fitArea}
          area={areaStatus} boundaryName={boundary ? `${boundary.name}${share ? ' (cụm — chỉ lấy phần gần tâm KCN này)' : ''}` : null} onClose={() => setPanel('none')}
          onReloadArea={() => {
            const b = mapRef.current?.getBounds();
            if (!b) return;
            setAreaOverride({ minLat: b.getSouth(), minLng: b.getWest(), maxLat: b.getNorth(), maxLng: b.getEast() });
            areaForceRef.current = true;
            setAreaReload(t => t + 1);
          }} />
      )}

      {panel === 'zone' && (
        <Sheet title="Chọn KCN đang khảo sát" onClose={() => setPanel('none')}>
          <input value={zoneQuery} onChange={e => setZoneQuery(e.target.value)} placeholder="Tìm KCN…"
            className="w-full h-10 px-3 rounded-xl bg-[#F2F2F7] text-[15px] outline-none mb-2 placeholder:text-[#8E8E93]" />
          <div className="rounded-xl bg-white divide-y divide-black/5 overflow-hidden">
            <button onClick={() => changeZone(null)} className="w-full px-3 py-3 text-left text-[14px] text-[#3A3A3C]">Không gắn KCN</button>
            {zonesByDistance.filter(({ z }) => !zoneQuery.trim() || fold(z.name + ' ' + (z.location ?? '')).includes(fold(zoneQuery.trim()))).map(({ z, d }) => (
              <button key={z.id} onClick={() => changeZone(z.id)} className="w-full px-3 py-3 text-left flex items-center gap-2">
                <span className="flex-1 min-w-0">
                  <span className={`block text-[14.5px] truncate ${z.id === zoneId ? 'font-semibold text-[#0A84FF]' : 'text-[#1D1D1F]'}`}>{z.name}</span>
                  <span className="block text-[11.5px] text-[#8E8E93]">{z.location ?? '—'}{z.lat == null ? ' · chưa có toạ độ' : ''}</span>
                </span>
                {d != null && <span className="text-[12px] text-[#8E8E93] shrink-0">{fmtDistance(d)}</span>}
              </button>
            ))}
          </div>
        </Sheet>
      )}

      {panel === 'nearby' && (
        <Sheet title={`Công ty trong bán kính ${prefs.radiusM} m`} onClose={() => setPanel('none')}>
          <div className="rounded-xl bg-white divide-y divide-black/5 overflow-hidden">
            {nearby.map(n => (
              <button key={n.company.key} onClick={() => { setPinnedKey(n.company.key); setExpanded(true); setPanel('none'); }}
                className="w-full px-3 py-3 text-left flex items-center gap-2">
                <StatusDot status={n.company.status} />
                <span className="flex-1 min-w-0">
                  <span className="block text-[14.5px] text-[#1D1D1F] truncate">{n.company.name}</span>
                  <span className="block text-[11.5px] text-[#8E8E93]">{statusLabel(n.company, lookup)}</span>
                </span>
                <span className="text-[12px] text-[#8E8E93] shrink-0">{fmtDistance(n.dist)}</span>
              </button>
            ))}
            {!nearby.length && <div className="px-3 py-6 text-center text-[13px] text-[#8E8E93]">Không có công ty nào trong bán kính</div>}
          </div>
        </Sheet>
      )}

      {panel === 'todo' && (
        <Sheet title={`${zoneName || 'Vùng này'} — công ty chưa đi ngang`} onClose={() => setPanel('none')}>
          <div className="text-[11.5px] text-[#8E8E93] mb-2 leading-snug">
            {boundary ? `Công ty có ghim trong ranh giới ${boundary.name}${share ? ', phần gần tâm KCN này hơn các KCN khác trong cụm' : ''}.` : 'KCN chưa có ranh giới trên OSM — lấy công ty trong 1,5 km quanh tâm KCN.'}
            {' '}Khách hàng / Pipeline xếp trước, rồi tới gần nhất. Bấm 1 công ty để bản đồ chỉ tới.
          </div>
          <div className="flex gap-1.5 mb-2">
            {[{ v: false, label: `Tất cả (${todo.never.length + todo.before.length})` }, { v: true, label: `KH & Pipeline (${[...todo.never, ...todo.before].filter(r => STATUS_META[r.c.status].rich).length})` }].map(o => (
              <button key={String(o.v)} onClick={() => setTodoRich(o.v)}
                className={`h-8 px-3 rounded-full text-[12.5px] font-medium ${todoRich === o.v ? 'bg-[#0A84FF] text-white' : 'bg-white text-[#1D1D1F]'}`}>{o.label}</button>
            ))}
          </div>
          {([['Chưa đi ngang lần nào', todo.never], ['Chỉ đi ngang ở lần trước', todo.before]] as const).map(([label, rows]) => {
            const list = rows.filter(r => !todoRich || STATUS_META[r.c.status].rich);
            if (!list.length) return null;
            return (
              <div key={label} className="mb-3">
                <div className="text-[12px] font-semibold text-[#8E8E93] uppercase tracking-wide mb-1">{label} ({list.length})</div>
                <div className="rounded-xl bg-white divide-y divide-black/5 overflow-hidden">
                  {list.slice(0, 150).map(({ c, dist, before }) => {
                    const p = c.points[0];
                    return (
                      <div key={c.key} className="flex items-center gap-2 px-3 py-2.5">
                        <button onClick={() => focusCompany(c)} className="flex-1 min-w-0 flex items-center gap-2 text-left">
                          <StatusDot status={c.status} />
                          <span className="flex-1 min-w-0">
                            <span className="block text-[14px] text-[#1D1D1F] truncate">{c.name}</span>
                            <span className="block text-[11.5px] text-[#8E8E93] truncate">
                              {statusLabel(c, lookup)}{before ? ` · qua lần trước ${new Date(before).toLocaleDateString('vi-VN')}` : ''}
                            </span>
                          </span>
                          {Number.isFinite(dist) && <span className="text-[12px] text-[#8E8E93] shrink-0">{fmtDistance(dist)}</span>}
                        </button>
                        {p && (
                          <a href={`https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`} target="_blank" rel="noopener noreferrer"
                            className="shrink-0 h-8 px-2.5 rounded-full bg-[#F2F2F7] text-[11.5px] font-medium text-[#0A84FF] inline-flex items-center gap-1">
                            <Navigation size={12} /> Chỉ đường
                          </a>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {!todo.never.length && !todo.before.length && <div className="py-6 text-center text-[13px] text-[#8E8E93]">Đã đi ngang hết công ty trong KCN 🎉</div>}
        </Sheet>
      )}

      {zonePrompt && (
        <Sheet title="Đang ở KCN nào?" onClose={() => setZonePrompt(null)}>
          <div className="text-[12.5px] text-[#3A3A3C] mb-2 leading-snug">Có {zonePrompt.length} KCN ở gần ngang nhau — chọn đúng KCN để chuyến được đặt tên và lưu đúng chỗ.</div>
          <div className="rounded-xl bg-white divide-y divide-black/5 overflow-hidden">
            {zonePrompt.map(c => (
              <button key={c.zone.id} onClick={() => startWithZone({ id: c.zone.id, name: c.zone.name })} className="w-full px-3 py-3 text-left flex items-center gap-2">
                <MapPin size={15} className="text-[#D97706] shrink-0" />
                <span className="flex-1 min-w-0 text-[15px] text-[#1D1D1F] truncate">{c.zone.name}</span>
                <span className="text-[12px] text-[#8E8E93] shrink-0">tâm cách {fmtDistance(c.dist)}</span>
              </button>
            ))}
            <button onClick={() => { setZonePrompt(null); setPanel('zone'); }} className="w-full px-3 py-3 text-left text-[14px] text-[#0A84FF]">KCN khác…</button>
            <button onClick={() => startWithZone(null)} className="w-full px-3 py-3 text-left text-[14px] text-[#3A3A3C]">Không gắn KCN</button>
          </div>
        </Sheet>
      )}

      {panel === 'history' && (
        <SurveyHistoryPanel
          zones={marketZones} defaultZoneId={zoneId ?? null} initialTab={historyInit.tab} photoFilter={historyInit.filter}
          activeTripId={recorder.trip?.id ?? null}
          onShowTrip={showTripOnMap} onShowPhoto={showPhoto}
          onChanged={() => setHistoryTick(t => t + 1)} onClose={() => setPanel('none')} say={say}
        />
      )}

      {viewerPhoto && (
        <QuickPhotoView photo={viewerPhoto} onClose={() => setViewerPhoto(null)}
          onOpenHistory={() => {
            const p = viewerPhoto;
            setViewerPhoto(null);
            setHistoryInit({ tab: 'photos', filter: { label: p.company_name || 'ảnh này', match: x => x.id === p.id } });
            setPanel('history');
          }} />
      )}

      {draft && (
        <SurveyPhotoSheet file={draft.file} position={draftPosition} suggestions={draftSuggestions} allCompanies={allCompanies}
          preset={draft.preset} zoneName={zone?.name ?? null} lookup={lookup}
          onCancel={() => setDraft(null)} onSave={v => void savePhoto(v)} />
      )}

      {summary && (
        <Sheet title="Đã kết thúc khảo sát" onClose={() => setSummary(null)}>
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Quãng đường" value={fmtDistance(summary.trip.distance_m)} />
            <Stat label="Thời gian" value={summary.trip.ended_at ? fmtDuration((new Date(summary.trip.ended_at).getTime() - new Date(summary.trip.started_at).getTime()) / 1000) : '—'} />
            <Stat label="Phủ đường trong vùng" value={summary.trip.road_coverage != null ? `${summary.trip.road_coverage.toLocaleString('vi-VN')}%` : '—'} />
            <Stat label="Ảnh chỉ tiêu" value={String(photos.filter(p => p.trip_id === summary.trip.id).length)} />
          </div>
          {summary.unsynced > 0 && (
            <div className="mt-2 rounded-xl bg-[#FFF4E5] text-[#8A4B00] text-[12.5px] px-3 py-2">
              Còn {summary.unsynced} đoạn vết chưa gửi được (mất mạng) — đã lưu trong máy, mở lại Khảo sát KCN khi có mạng để gửi nốt.
            </div>
          )}
          {summary.passed.length > 0 && (
            <div className="mt-3">
              <div className="text-[12px] font-semibold text-[#8E8E93] uppercase tracking-wide mb-1">Đã đi ngang {summary.passed.length} công ty</div>
              <div className="rounded-xl bg-white divide-y divide-black/5 overflow-hidden max-h-[30vh] overflow-y-auto">
                {[...summary.passed].sort((a, b) => STATUS_META[a.status].rank - STATUS_META[b.status].rank || a.name.localeCompare(b.name, 'vi')).map(p => (
                  <div key={p.key} className="px-3 py-2 flex items-center gap-2">
                    <StatusDot status={p.status} />
                    <span className="flex-1 min-w-0 text-[13.5px] text-[#1D1D1F] truncate">{p.name}</span>
                    <span className="text-[11px] text-[#8E8E93] shrink-0">{STATUS_META[p.status].label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="mt-3 text-[12px] font-semibold text-[#8E8E93] uppercase tracking-wide mb-1">Tên chuyến</div>
          <input value={summaryTitle} onChange={e => setSummaryTitle(e.target.value)} placeholder={surveyTitle(summary.trip.zone_name, new Date(summary.trip.started_at))}
            className="w-full h-11 px-3 rounded-xl bg-white text-[14px] outline-none border border-black/5 placeholder:text-[#8E8E93]" />
          <textarea value={summaryNote} onChange={e => setSummaryNote(e.target.value)} rows={3}
            placeholder="Ghi chú chuyến đi — VD: đường số 5 đang sửa, cổng sau Changshin tuyển nhiều…"
            className="mt-2 w-full px-3 py-2.5 rounded-xl bg-white text-[14px] outline-none border border-black/5 resize-none placeholder:text-[#8E8E93]" />
          <div className="flex gap-2 mt-3">
            <button onClick={async () => {
              const patch: { note?: string; title?: string } = {};
              if (summaryNote.trim() !== (summary.trip.note ?? '')) patch.note = summaryNote.trim();
              const t = summaryTitle.trim() || surveyTitle(summary.trip.zone_name, new Date(summary.trip.started_at));
              if (t !== (summary.trip.title ?? '')) patch.title = t;
              try {
                if (Object.keys(patch).length) await updateTrip(summary.trip.id, patch);
                if (patch.title && titleColumnMissing()) say(TITLE_MIGRATION_HINT);
                setSummary(null);
                setHistoryTick(n => n + 1);
              } catch (e) { say((e as Error).message); }
            }} className="flex-1 h-11 rounded-full bg-[#0A84FF] text-white text-[14px] font-semibold">Xong</button>
          </div>
        </Sheet>
      )}
    </div>,
    document.body,
  );
}

function MapBtn({ onClick, label, active, children }: { onClick: () => void; label: string; active?: boolean; children: ReactNode }) {
  return (
    <button onClick={onClick} aria-label={label} title={label}
      className={`w-12 h-12 rounded-2xl shadow-lg flex items-center justify-center active:scale-95 transition ${active ? 'bg-[#0A84FF] text-white' : 'bg-white/95 backdrop-blur text-[#1D1D1F]'}`}>
      {children}
    </button>
  );
}

function BarBtn({ onClick, label, tone, disabled, children }: { onClick: () => void; label: string; tone?: 'red' | 'blue'; disabled?: boolean; children: ReactNode }) {
  const cls = tone === 'red' ? 'text-[#D70015]' : tone === 'blue' ? 'text-[#0A84FF]' : 'text-[#1D1D1F]';
  return (
    <button onClick={onClick} disabled={disabled} aria-label={label}
      className={`w-[60px] h-14 rounded-2xl bg-[#F2F2F7] flex flex-col items-center justify-center gap-0.5 active:scale-95 transition disabled:opacity-40 ${cls}`}>
      {children}
      <span className="text-[10px] font-medium leading-none">{label}</span>
    </button>
  );
}

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-[1260] flex items-end md:items-center justify-center bg-black/30" onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        className="w-full md:w-[440px] max-h-[82vh] bg-[#F2F2F7] rounded-t-2xl md:rounded-2xl shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-4 pt-3 pb-2 shrink-0">
          <div className="text-[16px] font-semibold text-[#1D1D1F]">{title}</div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-[#E5E5EA] flex items-center justify-center text-[#3A3A3C]" aria-label="Đóng"><X size={16} /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 pb-[calc(16px+env(safe-area-inset-bottom))]">{children}</div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white px-3 py-2">
      <div className="text-[11px] text-[#8E8E93]">{label}</div>
      <div className="text-[17px] font-semibold text-[#1D1D1F] tabular-nums">{value}</div>
    </div>
  );
}

/** Bấm ghim ảnh trên bản đồ: xem nhanh ảnh + thông tin, mở Lịch sử để sửa / xoá. */
function QuickPhotoView({ photo, onClose, onOpenHistory }: { photo: SurveyPhoto; onClose: () => void; onOpenHistory: () => void }) {
  return (
    <div className="fixed inset-0 z-[1350] bg-black/90 flex flex-col pt-[env(safe-area-inset-top)]" onClick={onClose}>
      <div className="flex items-center justify-between h-12 px-2 shrink-0">
        <button onClick={onClose} className="h-10 px-3 text-[16px] text-white inline-flex items-center gap-1"><X size={18} /> Đóng</button>
        <button onClick={e => { e.stopPropagation(); onOpenHistory(); }} className="h-10 px-3 text-[14px] text-white/85">Sửa / xoá</button>
      </div>
      <div className="flex-1 min-h-0 flex items-center justify-center" onClick={e => e.stopPropagation()}>
        <img src={photo.url} alt={photo.company_name} className="max-w-full max-h-full object-contain" />
      </div>
      <div className="shrink-0 bg-[#1C1C1E] text-white px-4 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))]" onClick={e => e.stopPropagation()}>
        <div className="text-[15.5px] font-semibold">{photo.company_name || 'Chưa rõ công ty'}</div>
        <div className="text-[12px] text-white/70 mt-0.5">{new Date(photo.taken_at).toLocaleString('vi-VN')}{photo.zone_name ? ` · ${photo.zone_name}` : ''}{photo.user_name ? ` · ${photo.user_name}` : ''}</div>
        {(photo.positions || photo.headcount != null || photo.wage_text) && (
          <div className="text-[13px] mt-1">{[photo.positions && `Tuyển: ${photo.positions}`, photo.headcount != null && `SL: ${photo.headcount}`, photo.wage_text && `Lương: ${photo.wage_text}`].filter(Boolean).join(' · ')}</div>
        )}
        {photo.note && <div className="text-[12.5px] text-white/80 mt-1 whitespace-pre-line">{photo.note}</div>}
      </div>
    </div>
  );
}
