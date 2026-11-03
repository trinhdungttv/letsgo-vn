// Chế độ Khảo sát KCN (Thị trường → Bản đồ → nút "Khảo sát KCN") — toàn màn hình, làm cho điện thoại cầm tay khi chạy xe:
//  - Bấm Bắt đầu: ghi vết GPS, vẽ đường đã đi (xanh dương) chồng lên vết các lần trước (xám) và tô cam các con đường
//    trong KCN chưa đi (mạng đường OpenStreetMap) → nhìn là biết rẽ hướng nào.
//  - Đi ngang công ty nào thì hiện tên; khách hàng / pipeline / KH tiềm năng hiện luôn thẻ tổng quan.
//  - Chụp bảng chỉ tiêu tuyển dụng ngoài cổng → lưu ảnh kèm toạ độ chỗ chụp (vẽ / ghi chữ lên ảnh được), xem lại ở Lịch sử.
//  - Ghi âm nhanh những gì không chụp được, kèm chỗ ghi + công ty gần đó.
//  - Mũi tên vị trí xoay theo la bàn / hướng chạy, trượt mượt giữa các lần GPS báo (useSurveyCamera); "Dẫn đường" lập
//    lộ trình đi 1 lượt qua hết đường chưa đi (coverTour) hoặc tới 1 công ty.
//  - Xoay ngang điện thoại → giao diện gọn: bản đồ gần kín màn hình, chức năng gom vào nút nổi (SurveyQuickMenu).
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  Camera, ChevronLeft, ChevronRight, ExternalLink, Factory, History, ImagePlus, Info, Layers, Loader2, LocateFixed, Maximize, Mic, Minus, Navigation, NavigationOff, Pause, PenLine, Play, Plus, RefreshCw, Settings, Square, X, AlertTriangle, MapPin,
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
import { areaKey, cachedArea, fetchArea, pickZoneBoundary, piecesInZone, type AreaMap, type OsmZone } from '../../../lib/kcnSurvey/overpass';
import { ringsBounds, ringsCenter } from '../../../lib/kcnSurvey/areaSearch';
import { readFileExif } from '../../../lib/kcnSurvey/exif';
import { buildRoadGraph, pointAlong, type NavRoute } from '../../../lib/kcnSurvey/navigate';
import { angleDiff, bearing, displayHeading } from '../../../lib/kcnSurvey/heading';
import { fitRotated, rotatedSize, smartZoom } from '../../../lib/kcnSurvey/mapView';
import {
  countTripsBetween, listPhotos, listSurveyAreas, listTrips, listVoiceNotes, loadTracks, markupColumnMissing, MARKUP_MIGRATION_HINT, titleColumnMissing, TITLE_MIGRATION_HINT,
  updateTrip, uploadPhoto, uploadVoiceNote,
  type PhotoMeta, type SurveyPhoto, type SurveyTrip, type SurveyVoiceNote, type VoiceMeta,
} from '../../../lib/kcnSurvey/api';
import { useAudioRecorder, type RecordedAudio } from '../../../components/quickNotes/useAudioRecorder';
import { useSurveyRecorder, pendingActiveTrip, type SummaryResult } from './useSurveyRecorder';
import { useSurveyData, loadSurveyPrefs, saveSurveyPrefs, fold, NAV_SOUND_LABEL, ROAD_DONE_COLORS, ROAD_TODO_COLORS, type QuickActionId, type SurveyPrefs } from './surveyData';
import SurveyCompanyCard, { StatusDot, statusLabel, type CompanyLookup } from './SurveyCompanyCard';
import SurveyPhotoSheet, { type PhotoFormValue, type PhotoPosition } from './SurveyPhotoSheet';
import SurveySettingsPanel, { type AreaStatus } from './SurveySettingsPanel';
import SurveyHistoryPanel, { type PhotoFilter } from './SurveyHistoryPanel';
import { MarkedImage } from './PhotoMarks';
import SurveyVoiceSheet from './SurveyVoiceSheet';
import { fmtClock } from './surveyFormat';
import SurveyNavBanner from './SurveyNavBanner';
import SurveyAreaFinder, { type AreaSaved } from './SurveyAreaFinder';
import SurveyScanPanel from './SurveyScanPanel';
import { readScanCache, type ScanPlace } from '../../../lib/kcnSurvey/marketScan';
import { useDeviceHeading } from './useDeviceHeading';
import { useSurveyNavigation } from './useSurveyNavigation';
import { useSurveyCamera } from './useSurveyCamera';
import { AssistiveTouch, RailBtn, type QuickItem } from './SurveyQuickMenu';

interface Props {
  marketZones: MarketZone[];
  marketLeads: MarketLead[];
  branches: Branch[];
  laborHistory: Record<string, LaborHistoryEntry[]>;
  goTab: (tab: MarketTab) => void;
  onClose: () => void;
  /** Mở thẳng màn "Thêm KCN / vùng khảo sát" (nút ở tab Khảo sát KCN) */
  startWith?: 'area';
}

type Panel = 'none' | 'settings' | 'history' | 'zone' | 'nearby' | 'todo' | 'area' | 'scan';

type UploadJob = {
  id: string;
  label: string;
  state: 'uploading' | 'failed';
  error?: string;
} & ({ kind: 'photo'; file: File; meta: PhotoMeta } | { kind: 'voice'; blob: Blob; ext: string; meta: VoiceMeta });

/** Ghi âm khảo sát tự dừng + lưu sau bấy lâu (ghi chú nhanh, không phải ghi cuộc họp). */
const VOICE_MAX_MS = 15 * 60 * 1000;

const toLatLngs = (seg: TrackSegment) => seg.map(p => [p[0], p[1]] as [number, number]);

export default function KcnSurveyMode({ marketZones, marketLeads, branches, laborHistory, goTab, onClose, startWith }: Props) {
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
  // KCN vừa thêm nhanh ở màn khoanh vùng — dùng ngay, trong lúc App nạp lại danh sách Thị trường
  const [extraZones, setExtraZones] = useState<MarketZone[]>([]);
  const allZones = useMemo(() => [...marketZones, ...extraZones.filter(z => !marketZones.some(m => m.id === z.id))], [marketZones, extraZones]);
  // Vùng đã khoanh & lưu theo KCN (kcn_survey_areas, migration 194) — ưu tiên hơn ranh giới tự đoán trên OSM
  const [savedAreas, setSavedAreas] = useState<{ zoneId: string; name: string; rings: [number, number][][]; source: string }[]>([]);
  useEffect(() => {
    listSurveyAreas()
      .then(list => setSavedAreas(prev => [...list.filter(a => a.zone_id).map(a => ({ zoneId: a.zone_id!, name: a.name, rings: a.rings, source: a.source })), ...prev.filter(p => !list.some(a => a.zone_id === p.zoneId))]))
      .catch(() => { /* chưa chạy 194 — dùng ranh giới OSM như cũ */ });
  }, []);
  /** undefined = chưa chọn (tự gợi ý theo GPS lần đầu), null = không gắn KCN */
  const [zoneId, setZoneId] = useState<string | null | undefined>(() => pending?.trip.zone_id ?? undefined);
  const zone = useMemo(() => (zoneId ? allZones.find(z => z.id === zoneId) ?? null : null), [zoneId, allZones]);
  const savedArea = useMemo(() => (zone ? savedAreas.find(a => a.zoneId === zone.id) ?? null : null), [zone, savedAreas]);
  const zoneName = zone?.name ?? (zoneId && pending?.trip.zone_id === zoneId ? pending.trip.zone_name : '') ?? '';
  /** auto = app tự chọn theo tâm KCN gần nhất · boundary = đứng trong ranh giới OSM · manual = tự chọn · trip = theo chuyến dở */
  const zoneSourceRef = useRef<'auto' | 'boundary' | 'manual' | 'trip'>(pending ? 'trip' : 'auto');
  /** Tên chuyến do app đặt — còn giữ nguyên (chưa sửa tay) thì đổi KCN sẽ đặt lại tên */
  const autoTitleRef = useRef(pending?.trip.title ?? '');

  // Tâm vùng: KCN có toạ độ → tâm KCN; không thì vị trí GPS đầu tiên
  const [gpsAnchor, setGpsAnchor] = useState<{ lat: number; lng: number } | null>(null);
  useEffect(() => { if (fix && !gpsAnchor) setGpsAnchor({ lat: fix.lat, lng: fix.lng }); }, [fix, gpsAnchor]);
  const anchor = useMemo(() => (savedArea ? ringsCenter(savedArea.rings)
    : zone?.lat != null && zone?.lng != null ? { lat: zone.lat, lng: zone.lng } : gpsAnchor), [savedArea, zone, gpsAnchor]);
  const [areaOverride, setAreaOverride] = useState<Bounds | null>(null);
  // Có vùng đã khoanh → tải đường theo khung vùng (+ 300 m viền); không thì hình vuông quanh tâm KCN
  const areaBounds = useMemo(() => {
    if (areaOverride) return areaOverride;
    if (savedArea) {
      const b = ringsBounds(savedArea.rings);
      if (b) {
        const pad = boundsAround({ lat: (b.minLat + b.maxLat) / 2, lng: (b.minLng + b.maxLng) / 2 }, 300);
        const dLat = (pad.maxLat - pad.minLat) / 2, dLng = (pad.maxLng - pad.minLng) / 2;
        return { minLat: b.minLat - dLat, maxLat: b.maxLat + dLat, minLng: b.minLng - dLng, maxLng: b.maxLng + dLng };
      }
    }
    return anchor ? boundsAround(anchor, prefs.areaRadiusM) : null;
  }, [areaOverride, savedArea, anchor, prefs.areaRadiusM]);
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
    const d = detectZone(fix, area?.zones ?? [], allZones, 3000, savedAreas);
    setZoneId(d.best ? d.best.zone.id : null);
    zoneSourceRef.current = d.best?.inside ? 'boundary' : 'auto';
    if (d.best) say(d.best.inside ? `Đang trong ranh giới ${d.best.zone.name}` : `Đang ở gần ${d.best.zone.name}`);
  }, [fix, zoneId, allZones, area, savedAreas, say]);
  useEffect(() => {
    if (!fix || !area?.zones?.length || recorder.trip || pending) return;
    if (zoneSourceRef.current === 'manual' || zoneSourceRef.current === 'trip') return;
    const d = detectZone(fix, area.zones, allZones, 3000, savedAreas);
    if (d.best?.inside && d.best.zone.id !== zoneId) {
      setZoneId(d.best.zone.id);
      zoneSourceRef.current = 'boundary';
      say(`Đang trong ranh giới ${d.best.zone.name}`);
    }
  }, [fix, area, allZones, zoneId, recorder.trip, pending, savedAreas, say]);

  // ── Chuyến cũ + ảnh quanh vùng ─────────────────────────────────────────────
  const [oldTrips, setOldTrips] = useState<SurveyTrip[]>([]);
  const [oldTracks, setOldTracks] = useState<Map<string, TrackSegment[]>>(new Map());
  const [photos, setPhotos] = useState<SurveyPhoto[]>([]);
  const [voiceNotes, setVoiceNotes] = useState<SurveyVoiceNote[]>([]);
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
        // Bảng ghi âm (migration 193) chưa có thì thôi — không làm hỏng phần còn lại
        const voices = await listVoiceNotes({ zoneId: zoneId ?? null, bounds: areaBounds, limit: 300 }).catch(() => [] as SurveyVoiceNote[]);
        if (!alive) return;
        setVoiceNotes(voices);
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
  // Công ty quét được ở "Tải thông tin KCN" (nhớ trong máy 30 ngày) → hiện như nhà máy trên bản đồ, đi ngang là báo tên
  const [scanPlaces, setScanPlaces] = useState<ScanPlace[]>([]);
  const [scanHint, setScanHint] = useState(true);
  const scanZoneId = zone?.id ?? null;
  useEffect(() => { setScanPlaces(scanZoneId ? readScanCache(scanZoneId)?.places ?? [] : []); }, [scanZoneId]);
  const allCompanies = useMemo(() => mergeOsmPlaces(data.companies, [
    ...(area?.places ?? []),
    ...scanPlaces.filter(p => p.kind === 'company').map(p => ({ id: `scan-${p.key}`, name: p.name, point: { lat: p.lat, lng: p.lng } })),
  ]), [data.companies, area, scanPlaces]);
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
  // Vùng đã khoanh & lưu cho KCN này → dùng luôn (đúng ý người khảo sát, không phải đoán)
  const boundary = useMemo<OsmZone | null>(() => {
    if (savedArea) return { id: `saved:${savedArea.zoneId}`, name: savedArea.name || zone?.name || 'Vùng đã khoanh', rings: savedArea.rings };
    return area && anchor ? pickZoneBoundary(area.zones ?? [], anchor, zone?.name ?? null) : null;
  }, [savedArea, area, anchor, zone?.name]);
  // Ranh giới CỤM (1 khối bao nhiều KCN) → chỉ lấy phần gần tâm KCN đang chọn hơn tâm các KCN khác trong cụm
  const share = useMemo(() => (boundary && zone && !savedArea ? clusterShare(boundary, zone.id, allZones) : null), [boundary, zone, savedArea, allZones]);
  // Mọi khúc đường trong vùng tải (để dẫn đường đi qua cả đường ngoài KCN) + chỉ số các khúc thuộc KCN (để tô / tính phủ)
  const allPieces = useMemo(() => (area && prefs.showRoads ? splitRoads(area.roads) : []), [area, prefs.showRoads]);
  const zoneIdx = useMemo(() => {
    const idx = allPieces.map((_, i) => i);
    if (!boundary || !prefs.clipToZone) return idx;
    const inZone = new Set(piecesInZone(allPieces, boundary));
    return idx.filter(i => inZone.has(allPieces[i]) && (!share || share({ lat: allPieces[i].mid[0], lng: allPieces[i].mid[1] })));
  }, [allPieces, boundary, prefs.clipToZone, share]);
  const pieces = useMemo(() => zoneIdx.map(i => allPieces[i]), [zoneIdx, allPieces]);
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

  // ── Hướng đi + la bàn ─────────────────────────────────────────────────────
  const compass = useDeviceHeading(prefs.compass);
  const readCompassRef = useRef(compass.read);
  readCompassRef.current = compass.read;
  /** Hướng + tốc độ đang chạy: GPS báo sẵn, không có thì tính từ 2 điểm cách nhau ≥ 8 m */
  const [motion, setMotion] = useState<{ course: number | null; speed: number | null }>({ course: null, speed: null });
  const motionRef = useRef(motion);
  motionRef.current = motion;
  const prevPosRef = useRef<{ lat: number; lng: number; at: number } | null>(null);
  useEffect(() => {
    if (!fix) return;
    const prev = prevPosRef.current;
    const d = prev ? distM(prev, fix) : 0;
    const dt = prev ? (fix.at - prev.at) / 1000 : 0;
    const derivedSpeed = prev && dt > 0 && dt < 20 ? d / dt : null;
    const speed = fix.speed ?? derivedSpeed;
    const cur = motionRef.current;
    let next: typeof cur | null = null;
    if (fix.heading != null && (fix.speed ?? 0) > 1) next = { course: fix.heading, speed };
    else if (prev && d >= 8 && dt < 20) next = { course: bearing(prev, fix), speed };
    else if (dt >= 20) next = { course: cur.course, speed: 0 };
    else if (fix.speed != null && fix.speed !== cur.speed) next = { course: cur.course, speed: fix.speed }; // dừng đèn đỏ → tốc độ về 0 ngay
    // Ghi ref ngay để hiệu ứng bám bản đồ (chạy sau trong cùng lượt) thấy hướng mới
    if (next) { motionRef.current = next; setMotion(next); }
    if (!prev || d >= 8 || dt >= 20) prevPosRef.current = { lat: fix.lat, lng: fix.lng, at: fix.at };
  }, [fix]);
  const movingCourse = (motion.speed ?? 0) >= 2 ? motion.course : null;

  // ── Dẫn đường ─────────────────────────────────────────────────────────────
  const graph = useMemo(() => (area && allPieces.length ? buildRoadGraph(allPieces, area.roads) : null), [area, allPieces]);
  const navTargets = useMemo(() => (coverage ? zoneIdx.filter((_, j) => !coverage.covered[j]) : []), [coverage, zoneIdx]);
  const navScores = useMemo(() => {
    const a = new Float32Array(allPieces.length);
    zoneIdx.forEach((i, j) => { a[i] = roadScores[j] ?? 0; });
    return a;
  }, [allPieces.length, zoneIdx, roadScores]);
  const nav = useSurveyNavigation({
    graph, fix, course: movingCourse, targets: navTargets, scores: navScores,
    preferFactories: prefs.navPreferFactories, strategy: prefs.navStrategy, sound: prefs.navSound, say,
  });

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
  // Khung bản đồ VUÔNG cạnh = đường chéo màn hình, đặt giữa màn hình → xoay theo hướng đi bằng CSS mà vẫn phủ kín
  const viewRef = useRef<HTMLDivElement>(null);
  const [viewBox, setViewBox] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const viewBoxRef = useRef(viewBox);
  viewBoxRef.current = viewBox;
  const mapSide = rotatedSize(viewBox.w, viewBox.h);
  /** Hướng đi gần nhất khi đang chạy (để xoay bản đồ); đứng yên thì giữ hướng cũ */
  const lastCourseRef = useRef<number | null>(null);
  /** Hướng cho mũi tên: hướng của lộ trình khi đang bám đường dẫn, không thì hướng GPS */
  const courseRef = useRef<number | null>(null);
  const zoomChangedAt = useRef(0);
  const navDistRef = useRef<number | null>(null);
  navDistRef.current = nav.route && nav.next && nav.next.kind !== 'arrive' ? nav.distToNext : null;
  const mapDivRef = useRef<HTMLDivElement>(null);
  const needleRef = useRef<SVGSVGElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layersRef = useRef<{
    street: L.LayerGroup; sat: L.TileLayer; satLabels: L.TileLayer; renderer: L.Canvas;
    roads: L.LayerGroup; outline: L.LayerGroup; old: L.LayerGroup; highlight: L.LayerGroup; companies: L.LayerGroup; photos: L.LayerGroup; voice: L.LayerGroup;
    route: L.LayerGroup; curCasing: L.Polyline; curLine: L.Polyline; pos: L.Marker | null;
  } | null>(null);
  const [follow, setFollow] = useState(true);
  const followRef = useRef(follow);
  followRef.current = follow;
  const [zoom, setZoom] = useState(prefs.followZoom);
  const [viewTick, setViewTick] = useState(0);

  useEffect(() => {
    if (!mapDivRef.current || mapRef.current) return;
    // Kéo bản đồ do useSurveyCamera tự làm (đúng hướng cả khi khung đang xoay) → tắt kéo của Leaflet
    const map = L.map(mapDivRef.current, { zoomControl: false, attributionControl: true, maxZoom: 19, dragging: false, boxZoom: false });
    map.attributionControl.setPrefix(false);
    if (anchor) map.setView([anchor.lat, anchor.lng], prefs.followZoom);
    else map.fitBounds(SOUTH_VN_BOUNDS);
    // Lớp vẽ đường chỉ vẽ lại khi bản đồ dịch xong — đệm 35% mỗi bên là đủ cho bám vị trí liên tục, vẽ lại nhẹ hơn
    const renderer = L.canvas({ padding: 0.35 });
    const street = streetTiles();
    const sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Tiles &copy; Esri' });
    const satLabels = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 });
    const outline = L.layerGroup().addTo(map);
    const roads = L.layerGroup().addTo(map);
    const old = L.layerGroup().addTo(map);
    const highlight = L.layerGroup().addTo(map);
    const route = L.layerGroup().addTo(map);
    const curCasing = L.polyline([], { color: '#fff', weight: 10, opacity: 0.9, renderer, interactive: false }).addTo(map);
    const curLine = L.polyline([], { color: '#2563EB', weight: 5.5, opacity: 1, renderer, interactive: false }).addTo(map);
    const companies = L.layerGroup().addTo(map);
    const photosLayer = L.layerGroup().addTo(map);
    const voiceLayer = L.layerGroup().addTo(map);
    layersRef.current = { street, sat, satLabels, renderer, roads, outline, old, highlight, companies, photos: photosLayer, voice: voiceLayer, route, curCasing, curLine, pos: null };
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

  // Camera kiểu Google Maps: mũi tên trượt mượt giữa các lần GPS báo, bản đồ bám từng khung hình, xoay dần theo hướng
  // đi; kéo / chụm ngón trên bản đồ đang xoay vẫn đúng hướng (gọi SAU khi tạo bản đồ ở trên)
  const camera = useSurveyCamera({
    mapRef, frameRef: mapDivRef, needleRef,
    getMarker: () => layersRef.current?.pos ?? null,
    heading: () => displayHeading({ course: courseRef.current, speed: motionRef.current.speed, compass: prefs.compass ? readCompassRef.current() : null }),
    onUserPan: () => { followRef.current = false; setFollow(false); },
    onUserZoom: () => { zoomChangedAt.current = Date.now() + 4000; },
  });
  /**
   * Góc xoay bản đồ muốn tới: "Bắc ở trên" → 0; xoay theo hướng đi + đang bám → hướng đi gần nhất (chưa chạy lần nào thì
   * theo la bàn); đang xem tự do (đã kéo bản đồ) → null = GIỮ NGUYÊN góc đang xoay, không tự xoay làm rối mắt.
   */
  const rotGoal = () => (prefs.mapOrientation === 'north' ? 0
    : followRef.current ? lastCourseRef.current ?? (prefs.compass ? readCompassRef.current() : null) : null);
  /** Thôi bám (xem chỗ khác): bản đồ đứng yên ở góc đang xoay. */
  const stopFollow = () => {
    followRef.current = false;
    setFollow(false);
    camera.goal.current.follow = false;
    camera.goal.current.rot = prefs.mapOrientation === 'north' ? 0 : null;
  };
  /** Bám lại theo vị trí ngay (bấm Bắt đầu / Dẫn đường / ◎): giữ nguyên kiểu xoay đang chọn. */
  const followNow = (zoomTo?: number) => {
    followRef.current = true;
    setFollow(true);
    camera.goal.current.follow = true;
    camera.goal.current.rot = rotGoal();
    if (zoomTo != null) zoomChangedAt.current = Date.now();
    camera.jump(zoomTo);
  };

  // Đo màn hình (xoay ngang / dọc điện thoại, thanh địa chỉ ẩn / hiện) → khung bản đồ đổi cỡ → Leaflet đo lại + bám lại
  useEffect(() => {
    const el = viewRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      if (r.width && r.height) setViewBox(v => (Math.abs(v.w - r.width) < 1 && Math.abs(v.h - r.height) < 1 ? v : { w: r.width, h: r.height }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.invalidateSize();
    if (followRef.current) camera.jump();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapSide, viewBox.w, viewBox.h]);

  // Nền đường phố / vệ tinh
  useEffect(() => {
    const map = mapRef.current, ly = layersRef.current;
    if (!map || !ly) return;
    if (prefs.satellite) { ly.street.remove(); ly.sat.addTo(map); ly.satLabels.addTo(map); ly.sat.bringToBack(); }
    else { ly.sat.remove(); ly.satLabels.remove(); ly.street.addTo(map); }
  }, [prefs.satellite]);

  // Mỗi điểm GPS (hoặc vị trí trên lộ trình đổi): đích mới cho mũi tên + hướng xoay bản đồ. Đang dẫn đường mà GPS
  // nằm sát lộ trình → mũi tên chạy dọc lộ trình (GPS lệch ngang vài mét không làm mũi tên / bản đồ lắc qua lại)
  useEffect(() => {
    if (!fix) return;
    const snapped = nav.route && nav.status === 'routing' && nav.progress.off <= 20 ? pointAlong(nav.route, nav.progress.s) : null;
    camera.setTarget(snapped ? { lat: snapped.lat, lng: snapped.lng } : { lat: fix.lat, lng: fix.lng }, fix.at);
    camera.setAccuracy(fix.acc);
    const m = motionRef.current;
    const moving = (m.speed ?? 0) >= 1.5;
    const c = moving ? snapped?.bearing ?? m.course : null;
    if (c != null && (lastCourseRef.current == null || Math.abs(angleDiff(lastCourseRef.current, c)) >= 3)) lastCourseRef.current = c;
    courseRef.current = moving && snapped?.bearing != null ? snapped.bearing : m.course;
    camera.goal.current.rot = rotGoal();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fix, nav.route, nav.progress, nav.status]);

  // Lần đầu có GPS: đặt ngay bản đồ vào vị trí. Sau đó tự zoom kiểu dẫn đường (chạy nhanh nhìn xa, sắp rẽ thì canh vừa)
  const firstFixRef = useRef(true);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !fix) return;
    if (firstFixRef.current) {
      firstFixRef.current = false;
      if (followRef.current) camera.jump(prefs.followZoom);
      return;
    }
    if (!followRef.current || !prefs.smartZoom || Date.now() - zoomChangedAt.current < 4000) return;
    const want = smartZoom({ speed: motionRef.current.speed, navDist: navDistRef.current, lat: fix.lat, viewH: viewBoxRef.current.h, base: prefs.followZoom });
    if (want !== map.getZoom()) { zoomChangedAt.current = Date.now(); camera.zoomAroundUser(want); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fix]);

  const setMapZoom = useCallback((z: number) => {
    const map = mapRef.current;
    if (!map) return;
    const nz = Math.max(12, Math.min(19, Math.round(z)));
    setPref({ followZoom: nz });
    // Bấm +/− thì tôn trọng mức vừa chọn ít nhất 8 giây trước khi tự zoom lại
    zoomChangedAt.current = Date.now() + 4000;
    camera.zoomAroundUser(nz);
  }, [setPref, camera]);

  /** Nút ◎: bám lại theo vị trí, GIỮ kiểu xoay đang chọn (đổi kiểu xoay bằng nút la bàn). */
  const recenter = () => {
    if (prefs.compass && compass.status === 'need-permission') void compass.request();
    setPinnedKey(null);
    if (!fix) { setFollow(true); say(recorder.gpsError ?? 'Đang chờ tín hiệu GPS…'); return; }
    followRef.current = true;
    setFollow(true);
    camera.goal.current.follow = true;
    camera.goal.current.rot = rotGoal();
    zoomChangedAt.current = 0; // điểm GPS tới là tự zoom lại theo tốc độ
  };

  /** Nút la bàn: xoay theo hướng đi ↔ hướng Bắc luôn ở trên. Bật xoay thì bám lại luôn (đang xem tự do thì không xoay). */
  const toggleOrientation = () => {
    const next = prefs.mapOrientation === 'heading' ? 'north' : 'heading';
    setPref({ mapOrientation: next });
    if (next === 'heading') {
      if (prefs.compass && compass.status === 'need-permission') void compass.request();
      followRef.current = true;
      setFollow(true);
    }
    say(next === 'heading' ? 'Bản đồ xoay theo hướng đi' : 'Hướng Bắc luôn ở trên');
  };

  // Vị trí hiện tại: chấm xanh + vòng sai số + mũi tên — camera di chuyển / xoay mỗi khung hình
  useEffect(() => {
    const map = mapRef.current, ly = layersRef.current;
    if (!map || !ly || !fix || ly.pos) return;
    const icon = L.divIcon({
      className: 'kcs-pos',
      html: '<span class="kcs-pos-acc"></span><span class="kcs-pos-beam"></span><span class="kcs-pos-arrow"><svg viewBox="0 0 40 40" width="40" height="40"><path d="M20 3 L34 35 L20 27.5 L6 35 Z" fill="#2563EB" stroke="#fff" stroke-width="3" stroke-linejoin="round"/></svg></span><span class="kcs-pos-dot"></span>',
      iconSize: [44, 44], iconAnchor: [22, 22],
    });
    ly.pos = L.marker([fix.lat, fix.lng], { icon, zIndexOffset: 2000, interactive: false }).addTo(map);
  }, [fix]);

  /** Phần màn hình bị nút / thanh che (px) — để canh vùng vừa phần còn thấy (ghi lại mỗi lần vẽ, theo bố cục) */
  const fitInsetsRef = useRef({ top: 70, bottom: 150, left: 0, right: 64 });
  /**
   * Canh 1 nhóm điểm vừa phần màn hình đang thấy, GIỮ NGUYÊN góc xoay bản đồ (khung bản đồ to hơn màn hình, có thể đang
   * xoay; trên / dưới / bên có thanh nút). Thôi bám vị trí.
   */
  const fitVisible = (pts: readonly [number, number][], pad = 24) => {
    const map = mapRef.current;
    if (!map || !pts.length) return;
    stopFollow();
    const z0 = map.getZoom();
    const step = Math.max(1, Math.floor(pts.length / 800));
    const xy = pts.filter((_, i) => i % step === 0).map(p => map.project(p, z0));
    const ins = fitInsetsRef.current;
    const r = fitRotated(xy, camera.rotRef.current, z0, viewBoxRef.current,
      { top: ins.top + pad, bottom: ins.bottom + pad, left: ins.left + pad, right: ins.right + pad });
    if (r) map.setView(map.unproject(L.point(r.center.x, r.center.y), r.zoom), r.zoom, { animate: true });
  };
  const cornersOf = (b: L.LatLngBounds): [number, number][] => [
    [b.getSouth(), b.getWest()], [b.getSouth(), b.getEast()], [b.getNorth(), b.getEast()], [b.getNorth(), b.getWest()],
  ];

  const fitArea = () => {
    const map = mapRef.current;
    if (!map) return;
    if (boundary) fitVisible(boundary.rings.flat());
    else if (areaBounds) fitVisible([[areaBounds.minLat, areaBounds.minLng], [areaBounds.minLat, areaBounds.maxLng], [areaBounds.maxLat, areaBounds.maxLng], [areaBounds.maxLat, areaBounds.minLng]], 20);
    else if (anchor) { stopFollow(); map.setView([anchor.lat, anchor.lng], 15); }
  };

  // Lộ trình dẫn đường: xanh = đường tới / đoạn đi lại, tím = đường chưa đi sẽ khảo sát. Chỉ vẽ phần CÒN LẠI (đi qua
  // rồi thì mất), ~600 m sắp đi vẽ đậm, phần sau vẽ mờ (lộ trình 1 lượt dài cả chục km — nhìn là biết đi đâu trước).
  // Vẽ lại mỗi khi đi thêm ~25 m cho nhẹ máy.
  const routeDrawn = useRef<{ r: NavRoute | null; s: number }>({ r: null, s: -1e9 });
  useEffect(() => {
    const ly = layersRef.current;
    if (!ly) return;
    const r = nav.route;
    const s = nav.progress.s;
    if (r === routeDrawn.current.r && Math.abs(s - routeDrawn.current.s) < 25) return;
    routeDrawn.current = { r, s };
    ly.route.clearLayers();
    if (!r || r.coords.length < 2) return;
    const from = Math.max(0, s - 5);
    if (from >= r.total - 1) return;
    /** Các điểm lộ trình trong khoảng quãng [a, b] (m) */
    const slice = (a: number, b: number): [number, number][] => {
      const pa = pointAlong(r, a), pb = pointAlong(r, b);
      const pts: [number, number][] = [[pa.lat, pa.lng]];
      for (let i = 1; i < r.coords.length; i++) if (r.cum[i] > a && r.cum[i] < b) pts.push(r.coords[i]);
      pts.push([pb.lat, pb.lng]);
      return pts;
    };
    const line = (pts: [number, number][], color: string, weight: number, opacity: number) => {
      if (pts.length >= 2) L.polyline(pts, { color, weight, opacity, renderer: ly.renderer, interactive: false }).addTo(ly.route);
    };
    // Khoảng tím: đoạn chưa đi lần đầu qua (1 lượt) / từ đầu đoạn tới hết (từng đoạn)
    const purple: [number, number][] = [];
    if (r.target.kind === 'tour' && r.coverAt) {
      for (let i = 1; i < r.coords.length; i++) {
        if (!r.coverAt[i]) continue;
        const last = purple[purple.length - 1];
        if (last && Math.abs(last[1] - r.cum[i - 1]) < 0.01) last[1] = r.cum[i];
        else purple.push([r.cum[i - 1], r.cum[i]]);
      }
    } else if (r.target.kind === 'run') purple.push([r.approach, r.total]);
    const draw = (a: number, b: number, faded: boolean) => {
      if (b - a < 0.5) return;
      const base = slice(a, b);
      if (!faded) line(base, '#fff', 11, 0.95);
      line(base, '#1A73E8', faded ? 5 : 7, faded ? 0.35 : 1);
      for (const [p, q] of purple) {
        const x = Math.max(p, a), y = Math.min(q, b);
        if (y - x > 0.5) line(slice(x, y), '#7C3AED', faded ? 5 : 7, faded ? 0.4 : 1);
      }
    };
    const near = Math.min(r.total, from + 600);
    draw(near, r.total, true);
    draw(from, near, false);
    if (r.target.kind === 'point') {
      L.circleMarker([r.target.point.lat, r.target.point.lng], { radius: 8, color: '#fff', weight: 3, fillColor: '#1A73E8', fillOpacity: 1, renderer: ly.renderer, interactive: false }).addTo(ly.route);
    }
  }, [nav.route, nav.progress.s]);

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
    const todo = ROAD_TODO_COLORS[prefs.roadTodo], done = ROAD_DONE_COLORS[prefs.roadDone].color;
    draw(i => cov(i) && !pieces[i].main, { color: done, weight: 3, opacity: 0.55 });
    draw(i => cov(i) && pieces[i].main, { color: done, weight: 5, opacity: 0.6 });
    draw(i => !cov(i) && !busy(i) && !pieces[i].main, { color: todo.light, weight: 3, opacity: 0.95, dashArray: '6 6' });
    draw(i => !cov(i) && !busy(i) && pieces[i].main, { color: todo.lightMain, weight: 5, opacity: 0.95, dashArray: '8 6' });
    draw(i => !cov(i) && busy(i) && !pieces[i].main, { color: todo.mid, weight: 5, opacity: 0.95 });
    draw(i => !cov(i) && busy(i) && pieces[i].main, { color: todo.strong, weight: 7, opacity: 0.95 });
  }, [coverage, pieces, roadScores, prefs.roadTodo, prefs.roadDone]);

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
      if (showLabels && i < 150) m.bindTooltip(`<span class="kcs-up">${escapeMapHtml(c.name)}</span>`, { permanent: true, direction: 'right', offset: [8, 0], className: 'kcs-label' });
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

  // Ghi âm khảo sát (micro đỏ) — bấm để nghe lại
  const openVoiceRef = useRef<(n: SurveyVoiceNote) => void>(() => {});
  useEffect(() => {
    const ly = layersRef.current;
    if (!ly) return;
    ly.voice.clearLayers();
    if (!prefs.showPhotos) return;
    for (const n of voiceNotes) {
      if (n.lat == null || n.lng == null) continue;
      const icon = L.divIcon({ className: 'kcs-voice', html: '<span>🎙</span>', iconSize: [30, 30], iconAnchor: [15, 15] });
      const m = L.marker([n.lat, n.lng], { icon, zIndexOffset: 450 });
      m.bindTooltip(escapeMapHtml([n.company_name || 'Ghi âm', fmtClock(n.duration_s), new Date(n.recorded_at).toLocaleDateString('vi-VN')].join(' · ')), { direction: 'top', offset: [0, -14], className: 'lgmap-tooltip' });
      m.on('click', () => openVoiceRef.current(n));
      m.addTo(ly.voice);
    }
  }, [voiceNotes, prefs.showPhotos]);

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
    fitVisible(cornersOf(pl.getBounds()), 40);
    setHighlightTrip(trip);
    setPanel('none');
  };
  const clearHighlight = () => { layersRef.current?.highlight.clearLayers(); setHighlightTrip(null); };

  // ── Panel / sheet ─────────────────────────────────────────────────────────
  const [panel, setPanel] = useState<Panel>(startWith === 'area' ? 'area' : 'none');
  /** Giao diện gọn: đang mở xem chú thích màu đường (từ nút nổi) */
  const [legendPeek, setLegendPeek] = useState(false);
  /** Màn khoanh vùng: null = thêm KCN / vùng mới, có giá trị = khoanh lại vùng cho KCN đó */
  const [areaTarget, setAreaTarget] = useState<MarketZone | null>(null);
  const [historyInit, setHistoryInit] = useState<{ tab: 'trips' | 'photos'; filter: PhotoFilter | null }>({ tab: 'trips', filter: null });
  const [viewerPhoto, setViewerPhoto] = useState<SurveyPhoto | null>(null);
  openViewerRef.current = p => setViewerPhoto(p);
  const [voiceSheet, setVoiceSheet] = useState<SurveyVoiceNote | null>(null);
  openVoiceRef.current = n => setVoiceSheet(n);

  const showPhoto = (p: SurveyPhoto) => {
    const map = mapRef.current;
    setPanel('none');
    stopFollow();
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
    const fail = (e: unknown) => setUploads(list => list.map(j => (j.id === job.id ? { ...j, state: 'failed', error: (e as Error).message } : j)));
    if (job.kind === 'photo') {
      uploadPhoto(job.id, job.file, job.meta)
        .then(photo => {
          setUploads(list => list.filter(j => j.id !== job.id));
          setPhotos(list => [photo, ...list.filter(p => p.id !== photo.id)]);
          say(job.meta.annotations.length && markupColumnMissing()
            ? `Đã lưu ảnh — ${MARKUP_MIGRATION_HINT}`
            : `Đã lưu ảnh chỉ tiêu${photo.company_name ? ` — ${photo.company_name}` : ''}`);
        })
        .catch(fail);
    } else {
      uploadVoiceNote(job.id, job.blob, job.ext, job.meta)
        .then(note => {
          setUploads(list => list.filter(j => j.id !== job.id));
          setVoiceNotes(list => [note, ...list.filter(n => n.id !== note.id)]);
          say(`Đã lưu ghi âm ${fmtClock(note.duration_s)}${note.company_name ? ` — gần ${note.company_name}` : ''}`);
        })
        .catch(fail);
    }
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
      positions: v.positions, headcount: v.headcount, wage_text: v.wage_text, note: v.note, annotations: v.annotations,
      user_id: user?.id ?? null, user_name: user?.full_name ?? '',
    };
    runUpload({ kind: 'photo', id: crypto.randomUUID(), label: v.companyName || 'Ảnh chỉ tiêu', state: 'uploading', file: draft.file, meta });
    setDraft(null);
  };

  // ── Ghi âm nhanh ──────────────────────────────────────────────────────────
  // Ghim theo chỗ BẮT ĐẦU ghi (chỗ nhìn thấy thông tin), gắn công ty đang hiện thẻ / gần nhất. Bấm dừng là lưu luôn —
  // đang chạy xe không phải điền gì; ghi chú chữ thêm sau ở Lịch sử / tab Khảo sát KCN.
  const voiceStartRef = useRef<{ position: PhotoPosition | null; company: SurveyCompany | null } | null>(null);
  const onVoiceDone = (rec: RecordedAudio) => {
    const st = voiceStartRef.current;
    voiceStartRef.current = null;
    if (rec.durationSec < 1) { say('Bản ghi quá ngắn (dưới 1 giây) — không lưu'); return; }
    const pos = st?.position ?? fixPosition();
    const c = st?.company ?? null;
    const meta: VoiceMeta = {
      trip_id: recorder.trip?.id ?? null, zone_id: zone?.id ?? null, zone_name: zone?.name ?? '',
      lat: pos?.lat ?? null, lng: pos?.lng ?? null, accuracy_m: pos?.acc ?? null,
      recorded_at: rec.startedAt.toISOString(), duration_s: Math.round(rec.durationSec * 10) / 10, mime_type: rec.mime,
      company_name: c?.name ?? '', client_id: c?.clientId ?? null, lead_id: c?.leadId ?? null, crm_id: c?.crmId ?? null,
      note: '', user_id: user?.id ?? null, user_name: user?.full_name ?? '',
    };
    runUpload({ kind: 'voice', id: rec.noteId, label: `Ghi âm ${fmtClock(rec.durationSec)}`, state: 'uploading', blob: rec.blob, ext: rec.ext, meta });
  };
  const audio = useAudioRecorder(onVoiceDone, { enhance: prefs.voiceEnhance });
  const toggleVoice = () => {
    if (audio.active) { audio.stop(); return; }
    const pos = fixPosition();
    const near = pos ? companiesNear(pos, allCompanies, Math.min(prefs.radiusM, 150))[0]?.company ?? null : null;
    voiceStartRef.current = { position: pos, company: cardItem?.company ?? near };
    void audio.start(crypto.randomUUID());
  };
  const { phase: audioPhase, elapsedMs: audioMs, error: audioError, stop: stopAudio, clearError: clearAudioError } = audio;
  useEffect(() => {
    if (audioPhase === 'recording' && audioMs >= VOICE_MAX_MS) { stopAudio(); say('Ghi âm đã 15 phút nên tự dừng và lưu — bấm Ghi âm để ghi tiếp'); }
  }, [audioPhase, audioMs, stopAudio, say]);
  useEffect(() => {
    if (audioError) { say(audioError); clearAudioError(); }
  }, [audioError, clearAudioError, say]);
  const recordingCompany = voiceStartRef.current?.company?.name ?? null;

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
      if (fix) followNow(prefs.followZoom); else setFollow(true);
      say(fix ? `Bắt đầu: ${title}` : `Bắt đầu: ${title} — đang chờ tín hiệu GPS…`);
    } catch (e) {
      say((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /** Nút Bắt đầu: KCN do app tự đoán theo tâm mà KCN thứ 2 cũng gần ngang → hỏi lại trước. */
  const requestStart = () => {
    // iPhone: xin quyền la bàn ngay trong lần bấm này
    if (prefs.compass && compass.status === 'need-permission') void compass.request();
    if (fix && zoneSourceRef.current === 'auto') {
      const d = detectZone(fix, area?.zones ?? [], allZones, 3000, savedAreas);
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
    if (fix) followNow(); else setFollow(true);
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

  const changeZone = async (id: string | null, known?: { id: string; name: string; lat?: number | null; lng?: number | null } | null) => {
    setZoneId(id);
    zoneSourceRef.current = 'manual';
    setPanel('none');
    const z = known ?? (id ? allZones.find(x => x.id === id) : null);
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

  /** Lưu xong vùng ở màn khoanh vùng: dùng ngay KCN + vùng đó (kể cả khi chưa chạy 194 — chỉ trong phiên này). */
  const onAreaSaved = async (r: AreaSaved) => {
    setPanel('none');
    if (r.createdZone) setExtraZones(list => [...list.filter(z => z.id !== r.zone.id), quickZone(r.zone)]);
    setSavedAreas(list => [...list.filter(a => a.zoneId !== r.zone.id), { zoneId: r.zone.id, name: r.zone.name, rings: r.rings, source: r.area?.source ?? 'drawn' }]);
    setAreaOverride(null);
    if (zoneId !== r.zone.id) await changeZone(r.zone.id, r.zone);
    const map = mapRef.current;
    if (map && r.rings.length) fitVisible(r.rings.flat(), 30);
    say(r.areaError
      ? `${r.createdZone ? `Đã thêm ${r.zone.name}. ` : ''}Vùng chỉ dùng trong lần này: ${r.areaError}`
      : `${r.createdZone ? `Đã thêm ${r.zone.name} vào Thị trường → Khu vực. ` : ''}Đã lưu vùng — đang tải đường trong vùng…`);
  };
  const openAreaFinder = (target: MarketZone | null) => { setAreaTarget(target); setPanel('area'); };

  /** Đưa bản đồ tới 1 công ty và mở thẻ của nó (từ danh sách "chưa đi ngang"). */
  const focusCompany = (c: SurveyCompany) => {
    const map = mapRef.current;
    const p = c.points[0] ?? (c.rings[0]?.[0] ? { lat: c.rings[0][0][0], lng: c.rings[0][0][1] } : null);
    setPinnedKey(c.key);
    setExpanded(true);
    setPanel('none');
    if (map && p) { stopFollow(); map.setView([p.lat, p.lng], Math.max(map.getZoom(), 17)); }
  };

  const startNavAuto = () => {
    if (!allPieces.length) { say(prefs.showRoads ? 'Chưa tải xong mạng đường OSM — chờ chút rồi bấm lại' : 'Bật "Tô màu đường chưa đi" trong Cài đặt để dẫn đường'); return; }
    if (prefs.compass && compass.status === 'need-permission') void compass.request();
    clearHighlight();
    setPinnedKey(null);
    if (fix) followNow(Math.max(prefs.followZoom, 16)); else setFollow(true);
    nav.start({ kind: 'auto' });
  };
  const navToCompany = (c: SurveyCompany) => {
    const p = c.points[0] ?? (c.rings[0]?.[0] ? { lat: c.rings[0][0][0], lng: c.rings[0][0][1] } : null);
    if (!p) return;
    if (!allPieces.length) { say('Chưa có mạng đường OSM — dùng nút Google Maps'); return; }
    setPanel('none');
    if (fix) followNow(Math.max(prefs.followZoom, 16)); else setFollow(true);
    nav.start({ kind: 'point', name: c.name, point: p });
  };

  const tryClose = async () => {
    if (audio.active) {
      if (!window.confirm('Đang ghi âm — thoát sẽ dừng ghi và lưu phần đã ghi. Thoát?')) return;
      audio.stop();
    }
    if (uploads.length && !window.confirm(`Còn ${uploads.length} ảnh / ghi âm chưa lưu xong${uploads.some(u => u.state === 'failed') ? ' (có cái bị lỗi)' : ''} — thoát bây giờ sẽ MẤT. Vẫn thoát?`)) return;
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
    return [...allZones]
      .map(z => ({ z, d: p && z.lat != null && z.lng != null ? distM(p, { lat: z.lat, lng: z.lng }) : null }))
      .sort((a, b) => (a.d ?? 1e12) - (b.d ?? 1e12) || a.z.name.localeCompare(b.z.name, 'vi'));
  }, [allZones, fix, anchor]);
  const [zoneQuery, setZoneQuery] = useState('');

  const recording = recorder.status === 'recording';
  const hasTrip = !!recorder.trip;
  const failedUploads = uploads.filter(u => u.state === 'failed');
  const uploading = uploads.filter(u => u.state === 'uploading');

  // ── Bố cục: thường (cầm dọc) · gọn (xoay ngang, hoặc bật "Luôn gọn") ─────
  // Gọn: bỏ thanh nút dưới + chú thích, chỉ giữ nút người dùng chọn "luôn hiện" ở mép phải, còn lại gom vào nút nổi
  const landscape = viewBox.w > viewBox.h;
  const compact = prefs.compactMode === 'always' || (prefs.compactMode === 'auto' && landscape && viewBox.h < 560);
  /** Gọn + ngang: băng dẫn đường / thẻ công ty xếp thành cột bên trái, mũi tên dời sang phần bản đồ bên phải */
  const sideCol = compact && landscape;
  const colW = sideCol ? Math.min(360, Math.max(270, Math.round(viewBox.w * 0.38))) : 0;
  /** Bề ngang cột nút bên phải (kể cả lề) */
  const RAIL = compact ? 72 : 64;
  const tallLeft = nav.mode.kind !== 'off' || !!cardItem || !!pending || !!highlightTrip;
  const headingUp = follow && prefs.mapOrientation === 'heading';
  // Chỗ đặt mũi tên khi bám: xoay theo hướng đi → phần dưới màn hình (nhìn xa phía trước); có cột trái → giữa phần bản đồ còn lại
  camera.goal.current = {
    follow,
    rot: rotGoal(),
    offset: sideCol
      ? { x: Math.round(tallLeft ? (colW + 12 - RAIL) / 2 : -RAIL / 2), y: headingUp ? Math.round(Math.max(0, Math.min(viewBox.h * 0.2, viewBox.h / 2 - 70))) : 0 }
      : { x: 0, y: headingUp ? Math.round(Math.max(0, Math.min(viewBox.h * (compact ? 0.2 : 0.15), viewBox.h / 2 - (compact ? 90 : 140)))) : 0 },
  };
  fitInsetsRef.current = sideCol ? { top: 12, bottom: 12, left: colW + 12, right: RAIL }
    : compact ? { top: 70, bottom: 20, left: 0, right: RAIL } : { top: 70, bottom: 150, left: 0, right: 64 };
  const showLegend = compact ? prefs.pinned.includes('legend') || legendPeek : !prefs.legendCollapsed;

  const tripStatus = hasTrip ? (
    <>
      <span className={recording ? 'text-[#D70015]' : 'text-[#8E8E93]'}>{recording ? '● Đang ghi' : '❚❚ Tạm dừng'}</span>
      {' · '}{fmtDuration(elapsed / 1000)} · {fmtDistance(distance)}
      {coverage?.pct != null && ` · phủ ${coverage.pct.toLocaleString('vi-VN')}%`}
    </>
  ) : null;

  // Các khối dùng chung cho 2 bố cục
  const alerts = (
    <>
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
      {zone && !hasTrip && !pending && scanHint && !readScanCache(zone.id) && panel === 'none' && (
        <div className="pointer-events-auto rounded-2xl bg-white/95 backdrop-blur shadow-lg px-3.5 py-2.5 flex items-center gap-2">
          <RefreshCw size={16} className="text-[#137333] shrink-0" />
          <div className="flex-1 min-w-0 text-[12.5px] text-[#1D1D1F] leading-snug">
            Trước khi đi: tải thông tin <b>{zone.name}</b> — công ty trong KCN và nhà cung ứng lao động quanh đây
          </div>
          <button onClick={() => setPanel('scan')} className="h-8 px-3 rounded-full bg-[#137333] text-white text-[12.5px] font-semibold shrink-0">Tải</button>
          <button onClick={() => setScanHint(false)} className="w-7 h-7 rounded-full text-[#8E8E93] flex items-center justify-center shrink-0" aria-label="Để sau"><X size={15} /></button>
        </div>
      )}
      {highlightTrip && (
        <div className="pointer-events-auto rounded-xl bg-[#FFF8E6] shadow px-3 py-2 flex items-center gap-2 text-[12.5px] text-[#7A4B00]">
          <span className="w-3 h-1.5 rounded-full bg-[#F59E0B] shrink-0" />
          <span className="flex-1 min-w-0 truncate">Đang xem chuyến {new Date(highlightTrip.started_at).toLocaleDateString('vi-VN')} · {highlightTrip.zone_name || 'không gắn KCN'} · {fmtDistance(highlightTrip.distance_m)}</span>
          <button onClick={clearHighlight} className="font-semibold shrink-0">Ẩn</button>
        </div>
      )}
    </>
  );
  const navBanner = (
    <SurveyNavBanner mode={nav.mode} status={nav.status} route={nav.route} next={nav.next} after={nav.after}
      distToNext={nav.distToNext} remaining={nav.remaining} toApproach={nav.toApproach} compact={compact}
      sound={prefs.navSound} onSound={v => { setPref({ navSound: v }); nav.previewSound(v); say(`Âm thanh dẫn đường: ${NAV_SOUND_LABEL[v]}`); }}
      onReplan={nav.replan} onStop={nav.stop} />
  );
  const companyCard = cardItem && panel === 'none' && (
    <div className={compact ? 'max-h-[46vh] overflow-y-auto overscroll-contain rounded-2xl pointer-events-auto' : ''}>
      <SurveyCompanyCard
        item={cardItem} lookup={lookup} photos={photosOf(cardItem.company)}
        expanded={expanded} onToggle={() => setExpanded(v => !v)}
        onClose={() => { if (pinnedKey) setPinnedKey(null); else if (current) setDismissed(prev => new Set(prev).add(current.company.key)); }}
        onOpenProfile={openProfile} onPhoto={c => beginCapture(c)} onAddToMarket={addOsmCompany}
        onShowPhotos={c => { setHistoryInit({ tab: 'photos', filter: { label: c.name, match: p => photosOf(c).some(x => x.id === p.id) } }); setPanel('history'); }}
        otherCount={pinned ? 0 : Math.max(0, nearby.length - 1)} onShowNearby={() => setPanel('nearby')}
      />
    </div>
  );
  const areaNotice = (
    <>
      {prefs.showRoads && areaStatus.state === 'ok' && !boundary && (
        <button onClick={e => { e.stopPropagation(); openAreaFinder(zone); }} className="text-[#0A84FF] font-semibold text-left">
          {zone ? 'KCN chưa có ranh giới — khoanh vùng để chỉ tô đường trong KCN' : 'Chưa chọn KCN — thêm / khoanh vùng khảo sát'}
        </button>
      )}
      {prefs.showRoads && areaStatus.state === 'loading' && <div className="flex items-center gap-1 text-[#8E8E93]"><Loader2 size={10} className="animate-spin" /> Đang tải mạng đường…</div>}
      {prefs.showRoads && areaStatus.state === 'error' && (
        <div className="text-[#D70015]">
          Chưa tải được mạng đường{areaRetries.current < 3 ? ' — tự thử lại sau 30 giây' : ''}{' '}
          <button onClick={e => { e.stopPropagation(); setAreaReload(n => n + 1); }} className="font-semibold underline">Thử ngay</button>
        </div>
      )}
    </>
  );
  const gpsText = `${fix ? `GPS ±${Math.round(fix.acc)} m` : 'Chờ GPS…'}${hasTrip && passedCount > 0 ? ` · ${passedCount} công ty đã qua` : ''}${recorder.unsynced > 0 ? ` · ${recorder.unsynced} đoạn chờ gửi` : ''}${recording && prefs.keepAwake && !recorder.wakeLockOn ? ' · ⚠ màn hình có thể tự tắt' : ''}`;
  const legendBox = (
    <div onClick={() => { if (compact) setLegendPeek(false); else setPref({ legendCollapsed: true }); }}
      className="pointer-events-auto rounded-xl bg-white/90 backdrop-blur shadow px-2.5 py-1.5 text-[11px] text-[#3A3A3C] space-y-0.5 max-w-full cursor-pointer">
      {nav.route && (
        <div className="flex items-center gap-1.5"><span className="w-4 h-1.5 rounded-full bg-[#1A73E8]" /> {nav.route.target.kind === 'tour' ? 'Đi nối / đi lại' : 'Đường tới'}
          {nav.route.target.kind !== 'point' && <><span className="w-4 h-1.5 rounded-full bg-[#7C3AED] ml-1.5" /> {nav.route.target.kind === 'tour' ? 'Đường chưa đi sẽ qua' : 'Đoạn sẽ khảo sát'}</>}
        </div>
      )}
      <div className="flex items-center gap-1.5"><span className="w-4 h-1.5 rounded-full bg-[#2563EB]" /> Chuyến này
        {prefs.showOldTracks && <><span className="w-4 h-1.5 rounded-full bg-[#64748B]/60 ml-1.5" /> Lần trước{oldTrips.filter(t => t.id !== recorder.trip?.id).length ? ` (${oldTrips.filter(t => t.id !== recorder.trip?.id).length})` : ''}</>}
      </div>
      {prefs.showRoads && coverage && (
        <>
          <div className="flex items-center gap-1.5"><span className="w-4 h-[3px] rounded-full shrink-0" style={{ background: ROAD_TODO_COLORS[prefs.roadTodo].strong }} /> Cần đi, có nhà máy
            <span className="text-[#8E8E93]">{fmtDistance(unvisitedFactoryM)}</span></div>
          <div className="flex items-center gap-1.5"><span className="w-4 border-t-2 border-dashed shrink-0" style={{ borderColor: ROAD_TODO_COLORS[prefs.roadTodo].light }} /> Cần đi, đường trống
            <span className="text-[#8E8E93]">{fmtDistance(Math.max(0, coverage.totalM - coverage.coveredM - unvisitedFactoryM))}</span></div>
          <div className="flex items-center gap-1.5"><span className="w-4 h-[3px] rounded-full shrink-0" style={{ background: ROAD_DONE_COLORS[prefs.roadDone].color }} /> Đã đi
            <span className="text-[#8E8E93]">{fmtDistance(coverage.coveredM)}</span></div>
        </>
      )}
      {areaNotice}
      <div className="text-[#8E8E93] tabular-nums">{gpsText}</div>
    </div>
  );
  const audioBar = audio.active && (
    <div className="pointer-events-auto w-full flex items-center gap-2 rounded-2xl bg-[#1D1D1F]/90 backdrop-blur text-white pl-3 pr-1.5 py-1.5 shadow-lg">
      <span className="w-2.5 h-2.5 rounded-full bg-[#FF3B30] animate-pulse shrink-0" />
      <span className="flex-1 min-w-0 text-[13px] truncate">
        {audio.phase === 'starting' ? 'Đang bật micro…' : <>Đang ghi âm <b className="tabular-nums">{fmtClock(audio.elapsedMs / 1000)}</b></>}
        {recordingCompany && <span className="text-white/70"> · gần {recordingCompany}</span>}
      </span>
      <button onClick={() => { if (window.confirm('Huỷ bản ghi âm này (không lưu)?')) audio.cancel(); }} className="h-8 px-3 rounded-full bg-white/15 text-[12.5px] shrink-0">Huỷ</button>
      <button onClick={() => audio.stop()} className="h-8 px-3 rounded-full bg-[#FF3B30] text-[12.5px] font-semibold shrink-0 inline-flex items-center gap-1"><Square size={11} fill="currentColor" /> Dừng & lưu</button>
    </div>
  );
  const uploadsBox = (uploading.length > 0 || failedUploads.length > 0 || recorder.syncError) && (
    <div className="space-y-1.5 w-full">
      {uploading.length > 0 && (
        <div className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full bg-[#1D1D1F]/85 text-white text-[12px] px-3 py-1.5">
          <Loader2 size={12} className="animate-spin" /> Đang lưu {uploading.length} {uploading.every(u => u.kind === 'voice') ? 'ghi âm' : uploading.every(u => u.kind === 'photo') ? 'ảnh' : 'ảnh / ghi âm'}…
        </div>
      )}
      {failedUploads.map(u => (
        <div key={u.id} className="pointer-events-auto flex items-center gap-2 rounded-xl bg-[#FFECEC] text-[#B00020] text-[12px] px-3 py-1.5 shadow">
          <span className="flex-1 min-w-0 truncate">Chưa lưu được {u.kind === 'voice' ? '' : 'ảnh '}“{u.label}”: {u.error}</span>
          <button onClick={() => runUpload(u)} className="font-semibold shrink-0">Thử lại</button>
          <button onClick={() => { if (window.confirm(`Bỏ ${u.kind === 'voice' ? 'bản ghi âm' : 'ảnh'} này (chưa được lưu)?`)) setUploads(list => list.filter(j => j.id !== u.id)); }} className="shrink-0" aria-label="Bỏ"><X size={14} /></button>
        </div>
      ))}
      {recorder.syncError && (
        <div className="pointer-events-auto flex items-center gap-2 rounded-xl bg-[#FFF4E5] text-[#8A4B00] text-[12px] px-3 py-1.5 shadow">
          <span className="flex-1 min-w-0">Vết GPS chưa gửi được (đã lưu trong máy, sẽ gửi lại khi có mạng): {recorder.syncError}</span>
          <button onClick={() => void recorder.retrySync()} className="font-semibold shrink-0">Gửi lại</button>
        </div>
      )}
    </div>
  );
  // Kim la bàn: hướng Bắc trên bản đồ (camera xoay kim theo bản đồ mỗi khung hình)
  const needle = (
    <svg ref={needleRef} viewBox="0 0 24 24" width={compact ? 22 : 26} height={compact ? 22 : 26} aria-hidden>
      <path d="M12 2.5 L16 12 H8 Z" fill="#FF3B30" /><path d="M12 21.5 L8 12 H16 Z" fill="#8E8E93" />
    </svg>
  );
  const orientationLabel = prefs.mapOrientation === 'heading' ? 'Đang xoay theo hướng đi — bấm để Bắc lên trên' : 'Bắc ở trên — bấm để xoay theo hướng đi';
  const recenterLabel = follow ? 'Đang bám theo vị trí' : 'Bám theo vị trí';

  // Chức năng cho nút gắn mép phải / bảng nút nổi (giao diện gọn)
  const openHistory = () => { setHistoryInit({ tab: 'trips', filter: null }); setPanel('history'); };
  const quick = (id: QuickActionId): QuickItem[] => {
    switch (id) {
      case 'photo': return [{ id, label: hasTrip ? 'Chụp chỉ tiêu' : 'Chụp', short: 'Chụp', icon: <Camera size={22} />, tone: 'primary', onClick: () => beginCapture(null) }];
      case 'voice': return [{ id, label: audio.active ? fmtClock(audio.elapsedMs / 1000) : 'Ghi âm', icon: <Mic size={22} />, tone: audio.active ? 'rec' : undefined, onClick: toggleVoice }];
      case 'library': return [{ id, label: 'Ảnh có sẵn', short: 'Ảnh sẵn', icon: <ImagePlus size={22} />, onClick: () => beginCapture(null, true) }];
      case 'pause': return !hasTrip ? [] : recording
        ? [{ id, label: 'Tạm dừng', icon: <Pause size={22} />, onClick: () => void recorder.pause() }]
        : [{ id, label: 'Đi tiếp', icon: <Play size={22} />, tone: 'blue', onClick: () => recorder.resume(prefs.keepAwake) }];
      case 'finish': return hasTrip ? [{ id, label: 'Kết thúc', icon: <Square size={19} fill="currentColor" />, tone: 'red', disabled: busy, onClick: () => void finish() }] : [];
      case 'nav': return !allPieces.length ? [] : nav.mode.kind === 'off'
        ? [{ id, label: 'Dẫn đường', short: 'Dẫn', icon: <Navigation size={22} fill="currentColor" />, tone: 'green', onClick: startNavAuto }]
        : [{ id, label: 'Tắt dẫn', icon: <NavigationOff size={22} />, onClick: nav.stop }];
      case 'todo': return zoneCompanies.length ? [{ id, label: `${todo.never.length} chưa qua`, icon: <Factory size={22} />, onClick: () => setPanel('todo') }] : [];
      case 'zoom': return [
        { id: 'zoom-in', label: 'Phóng to', icon: <Plus size={22} />, onClick: () => setMapZoom(zoom + 1), keepOpen: true },
        { id: 'zoom-out', label: 'Thu nhỏ', icon: <Minus size={22} />, onClick: () => setMapZoom(zoom - 1), keepOpen: true },
      ];
      case 'fit': return [{ id, label: 'Cả KCN', icon: <Maximize size={21} />, onClick: fitArea }];
      case 'satellite': return [{ id, label: 'Vệ tinh', icon: <Layers size={21} />, active: prefs.satellite, onClick: () => setPref({ satellite: !prefs.satellite }) }];
      case 'legend': return [{ id, label: 'Chú thích', icon: <Info size={21} />, active: showLegend, onClick: () => setLegendPeek(v => !v) }];
      case 'history': return [{ id, label: 'Lịch sử', icon: <History size={21} />, onClick: openHistory }];
      case 'settings': return [{ id, label: 'Cài đặt', icon: <Settings size={21} />, onClick: () => setPanel('settings') }];
    }
  };
  const railItems = compact ? prefs.pinned.filter(id => id !== 'legend').flatMap(quick) : [];
  const menuItems: QuickItem[] = compact ? [
    ...(hasTrip ? quick('pause') : [{ id: 'start', label: 'Bắt đầu', icon: <Play size={22} fill="currentColor" />, tone: 'primary' as const, disabled: busy || !!pending, onClick: requestStart }]),
    ...(['photo', 'voice', 'library', 'nav', 'todo', 'fit', 'satellite'] as QuickActionId[]).flatMap(quick),
    { id: 'orientation', label: prefs.mapOrientation === 'heading' ? 'Bắc lên trên' : 'Xoay theo hướng', icon: <Navigation size={21} />, onClick: toggleOrientation },
    ...(prefs.pinned.includes('legend') ? [] : quick('legend')),
    ...(['zoom', 'history', 'settings', 'finish'] as QuickActionId[]).flatMap(quick),
  ] : [];

  return createPortal(
    <div className="fixed inset-0 z-[1200] bg-[#E5E3DF] select-none" style={{ touchAction: 'manipulation' }}>
      <div ref={viewRef} className="absolute inset-0 overflow-hidden">
        {/* Góc xoay + biến --kcs-bearing do camera đặt trực tiếp mỗi khung hình (không qua React) */}
        <div ref={mapDivRef} className="absolute kcs-rot"
          style={{ width: mapSide, height: mapSide, left: (viewBox.w - mapSide) / 2, top: (viewBox.h - mapSide) / 2, touchAction: 'none' }} />
      </div>

      {!compact ? (
        <>
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
                  {tripStatus && <span className="block text-[11px] text-[#3A3A3C] leading-tight tabular-nums truncate">{tripStatus}</span>}
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
              {alerts}
              {navBanner}
              {companyCard}
            </div>
          </div>

          {/* ── Nút bên phải: neo sát thanh dưới (gần ngón cái, không bị thẻ công ty phía trên che) ── */}
          <div className="absolute right-3 bottom-[calc(96px+env(safe-area-inset-bottom))] z-[1050] flex flex-col gap-2">
            <MapBtn onClick={toggleOrientation} label={orientationLabel} active={prefs.mapOrientation === 'heading'} light>{needle}</MapBtn>
            <MapBtn onClick={fitArea} label="Xem cả KCN"><Maximize size={19} /></MapBtn>
            <MapBtn onClick={recenter} label={recenterLabel} active={follow}>
              {headingUp ? <Navigation size={19} fill="currentColor" /> : <LocateFixed size={20} />}
            </MapBtn>
            <MapBtn onClick={() => setMapZoom(zoom + 1)} label="Phóng to"><Plus size={22} /></MapBtn>
            <MapBtn onClick={() => setMapZoom(zoom - 1)} label="Thu nhỏ"><Minus size={22} /></MapBtn>
          </div>

          {/* ── Thanh dưới ── */}
          <div className="absolute inset-x-0 bottom-0 z-[1100] pointer-events-none pb-[env(safe-area-inset-bottom)]">
            {audioBar && <div className="pl-3 pb-1.5 pr-[72px] md:pr-3"><div className="md:mx-auto md:w-[560px]">{audioBar}</div></div>}
            {(zoneCompanies.length > 0 || (allPieces.length > 0 && nav.mode.kind === 'off')) && (
              <div className="px-3 pb-1.5 flex items-center gap-2 pr-[72px] md:pr-3">
                {zoneCompanies.length > 0 && <button onClick={() => setPanel('todo')}
                  className="pointer-events-auto inline-flex items-center gap-1.5 h-9 pl-3 pr-3.5 rounded-full bg-white/95 backdrop-blur shadow text-[12.5px] font-medium text-[#1D1D1F] min-w-0">
                  <Factory size={14} className="text-[#D97706] shrink-0" />
                  <span className="truncate">
                    {todo.never.length
                      ? <><b>{todo.never.length}</b> công ty chưa qua{todo.never.filter(r => STATUS_META[r.c.status].rich).length ? ` · ${todo.never.filter(r => STATUS_META[r.c.status].rich).length} KH/Pipeline` : ''}</>
                      : todo.before.length ? `Đã qua hết — ${todo.before.length} công ty chỉ qua ở lần trước` : 'Đã đi ngang hết công ty trong KCN'}
                  </span>
                  <ChevronRight size={14} className="text-[#C7C7CC] shrink-0" />
                </button>}
                {allPieces.length > 0 && nav.mode.kind === 'off' && (
                  <button onClick={startNavAuto}
                    className="pointer-events-auto shrink-0 inline-flex items-center gap-1.5 h-9 pl-3 pr-3.5 rounded-full bg-[#137333] text-white shadow text-[12.5px] font-semibold">
                    <Navigation size={14} fill="currentColor" /> Dẫn đường
                  </button>
                )}
              </div>
            )}
            <div className="px-3 pb-1.5 flex items-end justify-between gap-2">
              {showLegend ? <div className="max-w-[calc(100%-72px)]">{legendBox}</div> : (
                <button onClick={() => setPref({ legendCollapsed: false })}
                  className="pointer-events-auto inline-flex items-center gap-1 h-7 px-2.5 rounded-full bg-white/90 backdrop-blur shadow text-[11px] text-[#3A3A3C] tabular-nums max-w-[calc(100%-72px)] truncate">
                  <Info size={12} className="shrink-0" /> Chú thích · {gpsText}
                </button>
              )}
            </div>
            {uploadsBox && <div className="px-3 pb-1.5">{uploadsBox}</div>}
            <div className="pointer-events-auto mx-3 md:mx-auto md:w-[560px] mb-3 rounded-[22px] bg-white/95 backdrop-blur-xl shadow-[0_8px_30px_rgba(0,0,0,0.2)] p-2 flex items-center gap-2">
              {!hasTrip ? (
                <>
                  <BarBtn onClick={openHistory} label="Lịch sử" narrow><History size={20} /></BarBtn>
                  <button onClick={requestStart} disabled={busy || !!pending}
                    className="flex-1 min-w-0 h-14 rounded-2xl bg-[#0A84FF] text-white text-[15px] font-semibold flex items-center justify-center gap-1.5 active:scale-[0.98] transition disabled:opacity-50 whitespace-nowrap">
                    {busy ? <Loader2 size={20} className="animate-spin" /> : <Play size={19} fill="currentColor" />} Bắt đầu<span className="hidden min-[390px]:inline"> khảo sát</span>
                  </button>
                  <BarBtn onClick={toggleVoice} label={audio.active ? fmtClock(audio.elapsedMs / 1000) : 'Ghi âm'} tone={audio.active ? 'rec' : undefined} narrow><Mic size={20} /></BarBtn>
                  <BarBtn onClick={() => beginCapture(null)} label="Chụp" narrow><Camera size={20} /></BarBtn>
                </>
              ) : (
                <>
                  {recording
                    ? <BarBtn onClick={() => void recorder.pause()} label="Tạm dừng" grow><Pause size={20} /></BarBtn>
                    : <BarBtn onClick={() => recorder.resume(prefs.keepAwake)} label="Đi tiếp" tone="blue" grow><Play size={20} /></BarBtn>}
                  <BarBtn onClick={() => beginCapture(null)} label="Chụp chỉ tiêu" tone="primary" grow><Camera size={21} /></BarBtn>
                  <BarBtn onClick={toggleVoice} label={audio.active ? fmtClock(audio.elapsedMs / 1000) : 'Ghi âm'} tone={audio.active ? 'rec' : undefined} grow><Mic size={20} /></BarBtn>
                  <BarBtn onClick={() => beginCapture(null, true)} label="Ảnh có sẵn" grow><ImagePlus size={20} /></BarBtn>
                  <BarBtn onClick={() => void finish()} label="Kết thúc" tone="red" disabled={busy} grow><Square size={18} fill="currentColor" /></BarBtn>
                </>
              )}
            </div>
          </div>
        </>
      ) : (
        <>
          {/* ── Giao diện gọn: cột trên (bên trái khi xoay ngang) ── */}
          <div className="absolute z-[1100] pointer-events-none flex flex-col gap-2"
            style={{ left: 'calc(10px + env(safe-area-inset-left))', top: 'calc(10px + env(safe-area-inset-top))', width: sideCol ? colW : `calc(100% - ${20 + RAIL}px)` }}>
            <div className="flex items-center gap-2">
              <button onClick={tryClose} aria-label="Thoát" title="Thoát"
                className="pointer-events-auto w-10 h-10 shrink-0 rounded-full bg-white/95 backdrop-blur shadow-lg flex items-center justify-center text-[#1D1D1F]">
                <ChevronLeft size={20} />
              </button>
              <button onClick={() => setPanel(panel === 'zone' ? 'none' : 'zone')}
                className="pointer-events-auto flex-1 min-w-0 h-10 px-3 rounded-full bg-white/95 backdrop-blur shadow-lg text-left flex flex-col justify-center">
                <span className="block text-[13px] font-semibold text-[#1D1D1F] truncate leading-tight">{zoneName || (zoneId === undefined ? 'Đang tìm KCN gần nhất…' : 'Chọn KCN')}</span>
                <span className="block text-[10.5px] text-[#3A3A3C] leading-tight tabular-nums truncate">
                  {tripStatus ?? (coverage?.pct != null ? `Đã đi ${coverage.pct.toLocaleString('vi-VN')}% đường (các lần trước)` : null)}
                  {(tripStatus || coverage?.pct != null) ? ' · ' : ''}{fix ? `GPS ±${Math.round(fix.acc)} m` : 'Chờ GPS…'}
                  {recorder.unsynced > 0 && ` · ${recorder.unsynced} đoạn chờ gửi`}
                </span>
              </button>
            </div>
            {alerts}
            {prefs.showRoads && areaStatus.state === 'error' && !showLegend && (
              <button onClick={() => setAreaReload(n => n + 1)} className="pointer-events-auto self-start rounded-full bg-[#FFECEC] text-[#B00020] text-[11.5px] px-3 py-1.5 shadow font-medium">
                Chưa tải được mạng đường — bấm để thử lại
              </button>
            )}
            {navBanner}
            {companyCard}
          </div>

          {/* ── Dưới trái: chú thích / ghi âm / đang lưu / nút Bắt đầu ── */}
          <div className="absolute z-[1100] pointer-events-none flex flex-col items-start gap-1.5"
            style={{ left: 'calc(10px + env(safe-area-inset-left))', bottom: 'calc(10px + env(safe-area-inset-bottom))', width: sideCol ? colW : `calc(100% - ${20 + RAIL}px)` }}>
            {showLegend && legendBox}
            {audioBar}
            {uploadsBox}
            {!hasTrip && (
              <div className="pointer-events-auto flex items-center gap-1.5 rounded-[18px] bg-white/95 backdrop-blur-xl shadow-lg p-1.5">
                <button onClick={openHistory} aria-label="Lịch sử" className="w-10 h-10 rounded-xl bg-[#F2F2F7] text-[#1D1D1F] flex items-center justify-center"><History size={18} /></button>
                <button onClick={requestStart} disabled={busy || !!pending}
                  className="h-10 px-4 rounded-xl bg-[#0A84FF] text-white text-[14px] font-semibold inline-flex items-center gap-1.5 disabled:opacity-50 whitespace-nowrap">
                  {busy ? <Loader2 size={17} className="animate-spin" /> : <Play size={16} fill="currentColor" />} Bắt đầu khảo sát
                </button>
              </div>
            )}
          </div>

          {/* ── Mép phải: nút luôn hiện (chọn trong Cài đặt) + bám vị trí + la bàn ── */}
          <div className="absolute z-[1050] pointer-events-none flex flex-col-reverse flex-wrap-reverse content-start gap-2"
            style={{ right: 'calc(10px + env(safe-area-inset-right))', bottom: 'calc(10px + env(safe-area-inset-bottom))', top: 'calc(10px + env(safe-area-inset-top))' }}>
            {railItems.map(it => <RailBtn key={it.id} item={it} />)}
            <RailBtn item={{ id: 'recenter', label: follow ? 'Đang bám' : 'Về vị trí', icon: headingUp ? <Navigation size={21} fill="currentColor" /> : <LocateFixed size={22} />, active: follow, onClick: recenter }} />
            <RailBtn item={{ id: 'orientation', label: prefs.mapOrientation === 'heading' ? 'Hướng đi' : 'Bắc trên', icon: null, onClick: toggleOrientation }}>{needle}</RailBtn>
          </div>

          <AssistiveTouch items={menuItems} pos={prefs.assistive} onMove={p => setPref({ assistive: p })} view={viewBox}
            title={[zoneName || 'Khảo sát KCN', hasTrip ? (recording ? 'đang ghi' : 'tạm dừng') : null].filter(Boolean).join(' · ')} />
        </>
      )}

      {flashMsg && (
        <div className="absolute -translate-x-1/2 z-[1400] max-w-[90vw] rounded-xl bg-[#1D1D1F]/90 text-white text-[13px] px-4 py-2.5 shadow-lg pointer-events-none text-center"
          style={compact
            ? { left: sideCol ? colW + 10 + (viewBox.w - colW - 10 - RAIL) / 2 : '50%', bottom: 'calc(16px + env(safe-area-inset-bottom))', maxWidth: sideCol ? viewBox.w - colW - RAIL - 20 : undefined }
            : { left: '50%', bottom: 'calc(150px + env(safe-area-inset-bottom))' }}>
          {flashMsg}
        </div>
      )}

      <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={e => { void onFile(e.target.files?.[0], false); e.target.value = ''; }} />
      <input ref={libraryRef} type="file" accept="image/*" hidden onChange={e => { void onFile(e.target.files?.[0], true); e.target.value = ''; }} />

      {/* ── Panels ── */}
      {panel === 'settings' && (
        <SurveySettingsPanel prefs={prefs} onChange={setPref} zoom={zoom} onZoom={setMapZoom} onFitArea={fitArea}
          compassStatus={compass.status} onRequestCompass={() => void compass.request()}
          onEditArea={() => openAreaFinder(zone)} areaSaved={!!savedArea}
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
          {zone && (
            <button onClick={() => setPanel('scan')} className="w-full h-10 mb-2 rounded-xl bg-[#137333] text-white text-[13px] font-semibold inline-flex items-center justify-center gap-1.5">
              <RefreshCw size={15} /> Tải thông tin {zone.name}: công ty + nhà cung ứng lao động
            </button>
          )}
          <div className="flex gap-2 mb-2">
            <button onClick={() => openAreaFinder(null)} className="flex-1 h-10 rounded-xl bg-[#0A84FF] text-white text-[13px] font-semibold inline-flex items-center justify-center gap-1.5">
              <Plus size={16} /> Thêm KCN / vùng mới
            </button>
            {zone && (
              <button onClick={() => openAreaFinder(zone)} className="flex-1 min-w-0 h-10 px-2 rounded-xl bg-white text-[13px] font-medium text-[#1D1D1F] inline-flex items-center justify-center gap-1.5">
                <PenLine size={15} className="shrink-0" /> <span className="truncate">{savedArea ? 'Khoanh lại vùng' : 'Khoanh vùng KCN này'}</span>
              </button>
            )}
          </div>
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
                        {p && allPieces.length > 0 && (
                          <button onClick={() => navToCompany(c)}
                            className="shrink-0 h-8 px-2.5 rounded-full bg-[#E6F4EA] text-[11.5px] font-semibold text-[#137333] inline-flex items-center gap-1">
                            <Navigation size={12} /> Dẫn đường
                          </button>
                        )}
                        {p && (
                          <a href={`https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`} target="_blank" rel="noopener noreferrer"
                            aria-label="Chỉ đường bằng Google Maps" title="Chỉ đường bằng Google Maps"
                            className="shrink-0 w-8 h-8 rounded-full bg-[#F2F2F7] text-[#0A84FF] inline-flex items-center justify-center">
                            <ExternalLink size={13} />
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

      {panel === 'scan' && zone && (
        <SurveyScanPanel zone={zone} rings={boundary?.rings ?? null} center={anchor ?? { lat: zone.lat ?? 0, lng: zone.lng ?? 0 }}
          companies={allCompanies} say={say} onClose={() => setPanel('none')}
          onResults={list => setScanPlaces(list)}
          onFocus={p => {
            setPanel('none');
            stopFollow();
            mapRef.current?.setView([p.lat, p.lng], Math.max(mapRef.current.getZoom(), 17));
            const hit = allCompanies.find(c => c.key === `o:scan-${p.key}`) ?? allCompanies.find(c => c.points.some(q => distM(q, p) < 60) && c.name === p.name);
            if (hit) { setPinnedKey(hit.key); setExpanded(true); }
            else say(p.kind === 'supplier' ? `Nhà cung ứng: ${p.name}${p.address ? ` — ${p.address}` : ''}` : p.name);
          }} />
      )}

      {panel === 'area' && (
        <SurveyAreaFinder zones={allZones} target={areaTarget}
          existing={areaTarget && areaTarget.id === zone?.id && boundary ? boundary.rings : null}
          fix={fix ? { lat: fix.lat, lng: fix.lng } : null}
          viewCenter={mapRef.current ? { lat: mapRef.current.getCenter().lat, lng: mapRef.current.getCenter().lng } : null}
          onCancel={() => setPanel('none')} onSaved={r => void onAreaSaved(r)} />
      )}

      {panel === 'history' && (
        <SurveyHistoryPanel
          zones={allZones} defaultZoneId={zoneId ?? null} initialTab={historyInit.tab} photoFilter={historyInit.filter}
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

      {voiceSheet && (
        <SurveyVoiceSheet note={voiceSheet} say={say} onClose={() => setVoiceSheet(null)}
          onShowOnMap={voiceSheet.lat != null && voiceSheet.lng != null ? () => {
            const n = voiceSheet;
            setVoiceSheet(null);
            stopFollow();
            mapRef.current?.setView([n.lat!, n.lng!], Math.max(mapRef.current.getZoom(), 18));
          } : null}
          onSaved={n => { setVoiceNotes(list => list.map(x => (x.id === n.id ? n : x))); setVoiceSheet(n); }}
          onDeleted={id => { setVoiceNotes(list => list.filter(x => x.id !== id)); setVoiceSheet(null); }} />
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
            <Stat label="Ảnh chỉ tiêu · Ghi âm" value={`${photos.filter(p => p.trip_id === summary.trip.id).length} · ${voiceNotes.filter(n => n.trip_id === summary.trip.id).length}`} />
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

function MapBtn({ onClick, label, active, light, children }: {
  onClick: () => void; label: string; active?: boolean;
  /** đang bật mà vẫn nền trắng, viền xanh (nút la bàn — kim đỏ / xám trên nền xanh khó nhìn) */ light?: boolean;
  children: ReactNode;
}) {
  const on = active ? (light ? 'bg-white text-[#1D1D1F] ring-2 ring-[#0A84FF]' : 'bg-[#0A84FF] text-white') : 'bg-white/95 backdrop-blur text-[#1D1D1F]';
  return (
    <button onClick={onClick} aria-label={label} title={label}
      className={`w-12 h-12 rounded-2xl shadow-lg flex items-center justify-center active:scale-95 transition ${on}`}>
      {children}
    </button>
  );
}

function BarBtn({ onClick, label, tone, disabled, grow, narrow, children }: {
  onClick: () => void; label: string; tone?: 'red' | 'blue' | 'primary' | 'rec'; disabled?: boolean;
  /** chia đều bề ngang (thanh 5 nút khi đang đi) */ grow?: boolean;
  /** hẹp hơn để nút Bắt đầu đủ chỗ */ narrow?: boolean;
  children: ReactNode;
}) {
  const cls = tone === 'primary' ? 'bg-[#0A84FF] text-white'
    : tone === 'rec' ? 'bg-[#FF3B30] text-white'
    : tone === 'red' ? 'bg-[#F2F2F7] text-[#D70015]' : tone === 'blue' ? 'bg-[#F2F2F7] text-[#0A84FF]' : 'bg-[#F2F2F7] text-[#1D1D1F]';
  return (
    <button onClick={onClick} disabled={disabled} aria-label={label}
      className={`${grow ? 'flex-1 min-w-0' : narrow ? 'w-[54px] shrink-0' : 'w-[60px] shrink-0'} h-14 rounded-2xl flex flex-col items-center justify-center gap-0.5 active:scale-95 transition disabled:opacity-40 ${cls}`}>
      {children}
      <span className="text-[10px] font-medium leading-none whitespace-nowrap tabular-nums">{label}</span>
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
        <button onClick={e => { e.stopPropagation(); onOpenHistory(); }} className="h-10 px-3 text-[14px] text-white/85">Sửa / ghi chú / xoá</button>
      </div>
      <div className="flex-1 min-h-0 flex items-center justify-center" onClick={e => e.stopPropagation()}>
        <MarkedImage src={photo.url} alt={photo.company_name} marks={photo.annotations} className="w-full h-full" />
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

/** KCN vừa thêm nhanh → đủ trường MarketZone để dùng ngay (App nạp lại danh sách thật sau). */
function quickZone(z: AreaSaved['zone']): MarketZone {
  const now = new Date().toISOString();
  return {
    id: z.id, name: z.name, full_name: null, location: z.location, operator: null, area: null, established_year: null, occupancy_pct: null,
    total_companies: null, fdi_companies: null, total_workers: null, industries: [], countries: [], characteristics: null, strengths: null,
    weaknesses: null, labor_availability: 'Trung bình', lgv_clients: 0, lgv_workers: 0, potential: 3, notes: null, updated_at: now, created_at: now,
    lat: z.lat, lng: z.lng,
  } as MarketZone;
}
