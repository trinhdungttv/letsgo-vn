// Thị trường → Khảo sát KCN: nơi riêng cho mọi dữ liệu đi khảo sát — các chuyến (vết GPS), ảnh chỉ tiêu tuyển dụng
// (kèm ghi chú vẽ trên ảnh), ghi âm nhanh, tổng hợp theo KCN; nút bắt đầu khảo sát.
//  - Chuyến đi gom theo ngày, mỗi chuyến 1 dòng (ảnh xem ở tab Ảnh chỉ tiêu — nút "Xem n ảnh" lọc sẵn theo chuyến).
//  - Lọc theo tỉnh / thành để so sánh các KCN; nhớ tab + bộ lọc đang xem trên máy này (lần sau mở lại đúng chỗ đó).
//  - ★ công ty cần chú trọng (gắn lúc lưu ảnh); xuất PDF chữ thật theo từng KCN để đưa AI phân tích lương / tuyển dụng.
//  - Xoá → Lưu trữ 30 ngày (khôi phục được), quá hạn tự xoá hẳn (hàm SQL migration 195, giờ máy chủ).
//  - Nút Toàn màn hình (điện thoại xem rõ hơn) + phóng to bản đồ kín màn hình.
//  - Nhà trọ (migration 221) + Ảnh 360° (migration 220) ghi khi đi khảo sát: tab con riêng, ghim trên bản đồ.
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  Archive, Camera, ChevronDown, ChevronRight, Download, FileText, ImagePlus, ListChecks, Loader2, MapPin, Maximize2, Mic, Minimize2, Pencil, Play, Plus, RefreshCw, Globe, RotateCcw, Route, Search, Share2, Star, Trash2, X,
  Home, Orbit, Phone, Bike,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import type { Branch } from '../../lib/types';
import type { MarketTabProps } from './shared';
import {
  ARCHIVE_MIGRATION_HINT, listArchived, listPhotos, listStars, listTrips, listVoiceNotes, loadTracks, purgeArchive, restoreArchived, setStar, softDeletePhoto,
  deleteTripWithPin, purgeTripWithPin, titleColumnMissing, TITLE_MIGRATION_HINT, updateTrip, VOICE_MIGRATION_HINT,
  type ArchiveKind, type ArchivedPhoto, type ArchivedTrip, type ArchivedVoice, type SurveyPhoto, type SurveyTrip, type SurveyVoiceNote,
} from '../../lib/kcnSurvey/api';
import { STATUS_META, type SurveyStatus } from '../../lib/kcnSurvey/companies';
import { fmtDistance, fmtDuration, type TrackSegment } from '../../lib/kcnSurvey/track';
import { surveyTitle } from '../../lib/kcnSurvey/zones';
import { ARCHIVE_DAYS, daysLeft, findStar, foldName, groupByDay, photoStarRef, type StarRef, type SurveyStar } from '../../lib/kcnSurvey/stars';
import { NO_PROVINCE, normalizeSavedProvince, provinceKey, provinceLabel, provinceOptions as buildProvinceOptions } from '../../lib/kcnSurvey/province';
import { buildZoneReport } from '../../lib/kcnSurvey/zoneReport';
import { downloadBlob } from '../../lib/costPlan/pdf';
import KcnSurveyMode from './survey/KcnSurveyMode';
import SurveyTripMap from './survey/SurveyTripMap';
import SurveyPhotoViewer, { PhotoThumb } from './survey/SurveyPhotoViewer';
import SurveyVoiceSheet from './survey/SurveyVoiceSheet';
import SurveyShareDialog from './survey/SurveyShareDialog';
import SurveyPinGate from './survey/SurveyPinGate';
import type { PinRequest } from '../../components/quickNotes/PinDialog';
import OnlinePhotoDialog from './survey/OnlinePhotoDialog';
import { KIND_FILTERS, headcountText, matchesKind, type KindFilter } from '../../lib/kcnSurvey/online';
import type { ShareZone } from '../../lib/kcnSurvey/share';
import { fmtClock, fmtDateTime } from './survey/surveyFormat';
import { pendingActiveTrip } from './survey/useSurveyRecorder';
import { nearestSources, shortName, useLaborLite } from './sources/useLaborLite';
import { requestOpenSource } from './sources/context';
import { fold, useSurveyData } from './survey/surveyData';
import SurveyPlanDialog from './survey/SurveyPlanDialog';
import TripPhotoImportDialog from './survey/TripPhotoImportDialog';
import { listPlanStops, PlanMissingTable } from '../../lib/kcnSurvey/planStopsApi';
import type { PlanStop } from '../../lib/kcnSurvey/planStops';
import type { MarketLead } from '../../lib/types';
import LodgingSheet from './survey/LodgingSheet';
import { loadMapCandidates } from './survey/surveyExtras';
import PanoModal, { type PanoMapPoint } from '../../components/pano/PanoModal';
import AddPanoModal from '../../components/pano/AddPanoModal';
import { listPanoramas, panoThumb, PanoMissingTable, PANO_MIGRATION_HINT, type MapPanorama } from '../../lib/pano/panoramas';
import { listLodgings, LodgingMissingTable, LODGING_MIGRATION_HINT } from '../../lib/kcnSurvey/lodgings';
import { fmtMin, fmtRent, lodgingTitle, phoneDigits, type Lodging, type RouteCandidate } from '../../lib/kcnSurvey/lodgingCore';

type Sub = 'trips' | 'photos' | 'online' | 'voice' | 'lodgings' | 'panos' | 'zones' | 'archive';
const PERIODS = [{ d: 7, label: '7 ngày' }, { d: 30, label: '30 ngày' }, { d: 90, label: '3 tháng' }, { d: 0, label: 'Tất cả' }];

const card = 'bg-white border border-[#E8E7E2] rounded-[10px]';
// Nút phụ cạnh "Bắt đầu": điện thoại = ô vuông nhỏ chữ dưới biểu tượng; từ sm = viên thuốc như cũ
const SURVEY_SUB_BTN = 'min-w-0 h-14 sm:h-11 px-1 sm:px-4 rounded-2xl sm:rounded-full bg-white border border-[#D8D6D0] text-[#111] text-[11.5px] sm:text-[13.5px] leading-tight font-medium inline-flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-1.5 hover:bg-[#F9F9F7] whitespace-nowrap';

// ── Nhớ tab + bộ lọc theo máy (mở lại tab là thấy đúng mục lần trước) ───────
const PREFS_KEY = 'lgvn_survey_tab_v1';
interface TabPrefs { sub: Sub; period: number; province: string; zoneId: string; person: string; starOnly: boolean; kind: KindFilter }
const DEFAULT_PREFS: TabPrefs = { sub: 'trips', period: 30, province: 'all', zoneId: 'all', person: 'all', starOnly: false, kind: 'all' };
function readPrefs(): TabPrefs {
  try {
    const o = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') as Partial<TabPrefs>;
    const p = { ...DEFAULT_PREFS, ...o };
    if (!['trips', 'photos', 'voice', 'lodgings', 'panos', 'zones', 'archive'].includes(p.sub)) p.sub = 'trips';
    if (!PERIODS.some(x => x.d === p.period)) p.period = 30;
    if (!KIND_FILTERS.some(x => x.id === p.kind)) p.kind = 'all';
    p.province = normalizeSavedProvince(p.province); // bản cũ lưu nguyên văn "TP. Đồng Nai"
    return p;
  } catch { return { ...DEFAULT_PREFS }; }
}
/** Lần tự dọn Lưu trữ gần nhất trên máy này — dọn tối đa mỗi 6 giờ */
const PURGE_KEY = 'lgvn_survey_purge_at';

export default function SurveyTab({ marketZones, marketLeads, laborHistory, goTab, toast, zoneFilter, setZoneFilter }: MarketTabProps) {
  const { user, token } = useAuth();
  const [shareOpen, setShareOpen] = useState(false);
  /** Hộp nhập mã 4 số đang mở (xoá chuyến / xoá hẳn chuyến) */
  const [pinReq, setPinReq] = useState<Extract<PinRequest, { kind: 'verify' }> | null>(null);
  const [onlineOpen, setOnlineOpen] = useState(false);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [trips, setTrips] = useState<SurveyTrip[]>([]);
  const [photos, setPhotos] = useState<SurveyPhoto[]>([]);
  const [voiceNotes, setVoiceNotes] = useState<SurveyVoiceNote[]>([]);
  const [voiceMissing, setVoiceMissing] = useState(false);
  const [stars, setStars] = useState<SurveyStar[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [prefs, setPrefsState] = useState<TabPrefs>(readPrefs);
  const setPrefs = useCallback((p: Partial<TabPrefs>) => setPrefsState(prev => {
    const next = { ...prev, ...p };
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(next)); } catch { /* chế độ riêng tư */ }
    return next;
  }), []);
  const { sub, period, province, zoneId, person, starOnly, kind } = prefs;
  // KCN đã lưu trong bộ lọc không còn trong danh mục (VD đã gộp Nhơn Trạch 1/3/6 — migration 224) → về "Tất cả KCN"
  useEffect(() => {
    if (marketZones.length && zoneId !== 'all' && zoneId !== 'none' && !marketZones.some(z => z.id === zoneId)) setPrefs({ zoneId: 'all' });
  }, [marketZones, zoneId, setPrefs]);
  const [search, setSearch] = useState('');
  /** Ảnh / ghi âm đang lọc theo 1 chuyến (nút "Xem n ảnh" ở tab Chuyến đi) */
  const [tripFilter, setTripFilter] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [showPassed, setShowPassed] = useState(false);
  const [tracks, setTracks] = useState<Map<string, TrackSegment[]>>(new Map());
  const [viewer, setViewer] = useState<SurveyPhoto | null>(null);
  const [voiceSheet, setVoiceSheet] = useState<SurveyVoiceNote | null>(null);
  const [focus, setFocus] = useState<{ lat: number; lng: number; key: number } | null>(null);
  const [surveyOpen, setSurveyOpen] = useState<false | 'survey' | 'area'>(false);
  const [pending, setPending] = useState(() => pendingActiveTrip());
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const [archive, setArchive] = useState<{ trips: ArchivedTrip[]; photos: ArchivedPhoto[]; voice: ArchivedVoice[] } | null>(null);
  const [archiveMissing, setArchiveMissing] = useState(false);
  /** Xuất PDF: cả KCN (theo bộ lọc thời gian / người đi) hoặc 1 chuyến */
  const [pdfFor, setPdfFor] = useState<{ id: string; name: string; trip?: SurveyTrip } | null>(null);

  // ── Toàn màn hình: lớp phủ che thanh menu của app; toast của app nằm dưới → tự hiện thông báo ──
  const [full, setFull] = useState(false);
  const [mapBig, setMapBig] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const flashTimer = useRef<number | null>(null);
  const fullRef = useRef(full);
  fullRef.current = full || mapBig;
  const say = useCallback((m: string) => {
    if (!fullRef.current) { toast(m); return; }
    setFlash(m);
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), 3500);
  }, [toast]);
  useEffect(() => {
    if (!full && !mapBig) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { if (mapBig) setMapBig(false); else setFull(false); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [full, mapBig]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [t, p] = await Promise.all([listTrips({ limit: 400 }), listPhotos({ limit: 1000 })]);
      setTrips(t);
      setPhotos(p);
      try { setVoiceNotes(await listVoiceNotes({ limit: 1000 })); setVoiceMissing(false); }
      catch { setVoiceNotes([]); setVoiceMissing(true); }
      listStars().then(setStars).catch(() => { /* chưa chạy 195 */ });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  // Nhà trọ + ảnh 360° (migration 221 / 220) — thiếu bảng thì chỉ báo ở tab con, phần khác vẫn chạy
  const [lodgings, setLodgings] = useState<Lodging[]>([]);
  const [panos, setPanos] = useState<MapPanorama[]>([]);
  const [extrasMissing, setExtrasMissing] = useState({ lodging: false, pano: false });
  const [lodgingSheet, setLodgingSheet] = useState<{ lodging: Lodging | null } | null>(null);
  const [addPano, setAddPano] = useState(false);
  const [openPano, setOpenPano] = useState<{ id: string; calibrate: boolean } | null>(null);
  const [mapPts, setMapPts] = useState<{ candidates: RouteCandidate[]; panoPoints: PanoMapPoint[] }>({ candidates: [], panoPoints: [] });
  const loadExtras = useCallback(async () => {
    listLodgings().then(l => { setLodgings(l); setExtrasMissing(m => ({ ...m, lodging: false })); })
      .catch(e => { if (e instanceof LodgingMissingTable) setExtrasMissing(m => ({ ...m, lodging: true })); });
    listPanoramas().then(p => { setPanos(p); setExtrasMissing(m => ({ ...m, pano: false })); })
      .catch(e => { if (e instanceof PanoMissingTable) setExtrasMissing(m => ({ ...m, pano: true })); });
  }, []);
  useEffect(() => { void loadExtras(); }, [loadExtras]);
  // Kế hoạch ghé công ty theo KCN (migration 223) + bổ sung ảnh vào chuyến đã đi
  const [planStops, setPlanStops] = useState<PlanStop[]>([]);
  const [planMissing, setPlanMissing] = useState(false);
  const [planFor, setPlanFor] = useState<{ zoneId: string | null } | null>(null);
  const [importTrip, setImportTrip] = useState<SurveyTrip | null>(null);
  useEffect(() => {
    listPlanStops().then(l => { setPlanStops(l); setPlanMissing(false); })
      .catch(e => { if (e instanceof PlanMissingTable) setPlanMissing(true); });
  }, [surveyOpen]);
  const planCount = useMemo(() => {
    const m = new Map<string, number>();
    planStops.forEach(st => { if (st.zone_id) m.set(st.zone_id, (m.get(st.zone_id) ?? 0) + 1); });
    return m;
  }, [planStops]);
  // Điểm công ty / KCN để đo đường từ nhà trọ + hiện "gần ảnh 360" — chỉ nạp khi mở 1 trong 2 thứ đó
  const needPts = !!lodgingSheet || !!openPano;
  useEffect(() => {
    if (!needPts || mapPts.candidates.length) return;
    loadMapCandidates().then(setMapPts).catch(() => {});
  }, [needPts, mapPts.candidates.length]);

  const loadArchive = useCallback(async () => {
    try { setArchive(await listArchived()); } catch (e) { say((e as Error).message); }
  }, [say]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    supabase.from('branches').select('*').then(({ data }) => setBranches((data as Branch[]) ?? []));
  }, []);
  // Mở từ nơi khác kèm KCN (VD Nguồn LĐ → hồ sơ trường → "Khảo sát KCN này") → lọc sẵn KCN đó, 1 lần
  useEffect(() => {
    if (!zoneFilter || zoneFilter === 'all') return;
    const z = marketZones.find(x => x.name === zoneFilter);
    if (z) setPrefs({ zoneId: z.id, province: 'all', sub: 'trips' });
    setZoneFilter('all');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Nguồn LĐ (trường / trung tâm) gần KCN — theo giờ xe khách đã tính ở tab Nguồn LĐ (chưa tính thì ước tính ≈)
  const labor = useLaborLite();
  const nearOf = useCallback((id: string, n = 3) => {
    const z = marketZones.find(x => x.id === id);
    return z ? nearestSources(labor, { type: 'zone', id: z.id, lat: z.lat, lng: z.lng }, n) : [];
  }, [labor, marketZones]);
  // Mở tab: tự xoá hẳn mục nằm trong Lưu trữ quá 30 ngày (hạn tính bằng giờ máy chủ), rồi đọc Lưu trữ
  useEffect(() => {
    (async () => {
      let last = 0;
      try { last = Number(localStorage.getItem(PURGE_KEY) || 0); } catch { /* bỏ qua */ }
      if (Date.now() - last > 6 * 3600_000) {
        try {
          const n = await purgeArchive();
          if (n == null) setArchiveMissing(true);
          else {
            try { localStorage.setItem(PURGE_KEY, String(Date.now())); } catch { /* bỏ qua */ }
            if (n > 0) say(`Đã tự xoá hẳn ${n} mục nằm trong Lưu trữ quá ${ARCHIVE_DAYS} ngày`);
          }
        } catch { /* lỗi mạng — lần sau dọn */ }
      }
      await loadArchive();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Sao công ty ───────────────────────────────────────────────────────────
  const starOf = useCallback((p: SurveyPhoto) => !!findStar(stars, photoStarRef(p)), [stars]);
  const toggleStar = async (c: StarRef & { zoneName?: string }, on: boolean) => {
    try {
      const row = await setStar(c, on, { id: user?.id ?? null, name: user?.full_name ?? '' });
      setStars(list => { const rest = list.filter(x => x !== findStar(list, c)); return row ? [row, ...rest] : rest; });
      say(on ? `★ Đã gắn sao: ${c.name}` : `Đã bỏ sao: ${c.name}`);
    } catch (e) { say((e as Error).message); }
  };
  const togglePhotoStar = (p: SurveyPhoto) => void toggleStar({ ...photoStarRef(p), zoneName: p.zone_name }, !starOf(p));

  // ── Lọc ───────────────────────────────────────────────────────────────────
  // Tỉnh của KCN: khoá đã gộp các cách ghi ("TP. Đồng Nai" = "Đồng Nai"); '' = KCN chưa ghi tỉnh → nhóm "Chưa rõ tỉnh"
  const zoneProv = useMemo(() => new Map(marketZones.map(z => [z.id, provinceKey(z.location)])), [marketZones]);
  const zoneProvLabel = useMemo(() => new Map(marketZones.map(z => [z.id, provinceLabel(z.location)])), [marketZones]);
  const since = period ? Date.now() - period * 86_400_000 : 0;
  const okTime = useCallback((iso: string) => !since || new Date(iso).getTime() >= since, [since]);
  const okProvince = useCallback((z: string | null) => province === 'all' || (!!z && (province === NO_PROVINCE ? !zoneProv.get(z) : zoneProv.get(z) === province)), [province, zoneProv]);
  const okZone = useCallback((z: string | null) => okProvince(z) && (zoneId === 'all' || (zoneId === 'none' ? !z : z === zoneId)), [zoneId, okProvince]);
  const okPerson = useCallback((n: string) => person === 'all' || n === person, [person]);
  const q = fold(search.trim());
  const fTrips = useMemo(() => trips.filter(t => okTime(t.started_at) && okZone(t.zone_id) && okPerson(t.user_name)
    && (!q || fold([t.title, t.zone_name, t.note, t.user_name, ...t.passed.map(p => p.name)].join(' ')).includes(q))), [trips, okTime, okZone, okPerson, q]);
  const fPhotosAll = useMemo(() => photos.filter(p => okTime(p.taken_at) && okZone(p.zone_id) && okPerson(p.user_name) && matchesKind(p, kind)
    && (!q || fold([p.company_name, p.positions, p.wage_text, p.note, p.zone_name].join(' ')).includes(q))), [photos, okTime, okZone, okPerson, q, kind]);
  const fPhotosBoth = useMemo(() => fPhotosAll.filter(p => (!tripFilter || p.trip_id === tripFilter) && (!starOnly || starOf(p))), [fPhotosAll, tripFilter, starOnly, starOf]);
  // Ảnh ONLINE tách thành mục riêng (tab "Ảnh online"); tab "Ảnh chỉ tiêu" chỉ còn ảnh đi thực địa
  const fPhotos = useMemo(() => fPhotosBoth.filter(p => sub === 'online' ? p.survey_kind === 'online' : sub === 'photos' ? p.survey_kind !== 'online' : true), [fPhotosBoth, sub]);
  const [onlineSel, setOnlineSel] = useState<Set<string>>(new Set());
  const toggleOnlineSel = (id: string) => setOnlineSel(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const deleteOnlineSel = async () => {
    const ids = fPhotos.filter(p => onlineSel.has(p.id)).map(p => p.id);
    if (!ids.length || !window.confirm(`Xoá ${ids.length} ảnh online đã chọn?\n\nẢnh chuyển vào Lưu trữ 30 ngày — khôi phục được trong thời gian đó, quá 30 ngày mới tự xoá hẳn.`)) return;
    let ok = 0;
    for (const id of ids) { try { await softDeletePhoto(id); ok++; setPhotos(list => list.filter(x => x.id !== id)); } catch (e) { say((e as Error).message); break; } }
    setOnlineSel(new Set());
    if (ok) { say(`Đã chuyển ${ok} ảnh online vào Lưu trữ (30 ngày)`); void loadArchive(); }
  };
  const starredCount = useMemo(() => fPhotosAll.filter(p => (!tripFilter || p.trip_id === tripFilter) && starOf(p)).length, [fPhotosAll, tripFilter, starOf]);
  const fVoice = useMemo(() => voiceNotes.filter(n => okTime(n.recorded_at) && okZone(n.zone_id) && okPerson(n.user_name) && (!tripFilter || n.trip_id === tripFilter)
    && (!q || fold([n.company_name, n.note, n.zone_name].join(' ')).includes(q))), [voiceNotes, okTime, okZone, okPerson, q, tripFilter]);

  const fLodgings = useMemo(() => lodgings.filter(l => okTime(l.created_at) && okZone(l.zone_id) && okPerson(l.created_by)
    && (!q || fold([lodgingTitle(l), l.address, l.landlord_name, l.landlord_phone, l.note, l.zone_name, l.facilities.join(' ')].join(' ')).includes(q))), [lodgings, okTime, okZone, okPerson, q]);
  const fPanos = useMemo(() => panos.filter(p => okTime(p.created_at) && okZone(p.zone_id) && okPerson(p.created_by)
    && (!q || fold([p.title, p.note, p.zone_name, ...p.annotations.map(a => `${a.label} ${a.note}`)].join(' ')).includes(q))), [panos, okTime, okZone, okPerson, q]);

  const people = useMemo(() => [...new Set([...trips.map(t => t.user_name), ...photos.map(p => p.user_name), ...voiceNotes.map(n => n.user_name)].filter(Boolean))].sort((a, b) => a.localeCompare(b, 'vi')), [trips, photos, voiceNotes]);
  const usedZones = useMemo(() => new Set([...trips.map(t => t.zone_id), ...photos.map(p => p.zone_id), ...voiceNotes.map(n => n.zone_id)]), [trips, photos, voiceNotes]);
  // Tỉnh / thành: tỉnh có KCN đã khảo sát lên trước; KCN chưa ghi tỉnh có nhóm riêng (không bị loại âm thầm khi lọc)
  const provinces = useMemo(() => buildProvinceOptions(marketZones, usedZones), [marketZones, usedZones]);
  const provinceName = province === 'all' ? '' : province === NO_PROVINCE ? 'KCN chưa ghi tỉnh' : provinces.options.find(o => o.key === province)?.label ?? '';
  const zoneOptions = useMemo(() => [...marketZones]
    .filter(z => province === 'all' || (province === NO_PROVINCE ? !zoneProv.get(z.id) : zoneProv.get(z.id) === province))
    .sort((a, b) => Number(usedZones.has(b.id)) - Number(usedZones.has(a.id)) || a.name.localeCompare(b.name, 'vi'))
    .map(z => ({ id: z.id, name: z.name, used: usedZones.has(z.id) })), [marketZones, usedZones, province, zoneProv]);

  // KCN có dữ liệu để chia sẻ cho người ngoài (ảnh, chuyến hoặc nhà trọ), kèm số ảnh / chuyến / nhà trọ
  const shareZones = useMemo<ShareZone[]>(() => {
    const ph = new Map<string, number>(), tr = new Map<string, number>(), lo = new Map<string, number>();
    photos.forEach(p => { if (p.zone_id) ph.set(p.zone_id, (ph.get(p.zone_id) ?? 0) + 1); });
    trips.forEach(t => { if (t.zone_id) tr.set(t.zone_id, (tr.get(t.zone_id) ?? 0) + 1); });
    lodgings.forEach(l => { if (l.zone_id) lo.set(l.zone_id, (lo.get(l.zone_id) ?? 0) + 1); });
    return marketZones.filter(z => ph.has(z.id) || tr.has(z.id) || lo.has(z.id))
      .map(z => ({ id: z.id, name: z.name, location: z.location, photos: ph.get(z.id) ?? 0, trips: tr.get(z.id) ?? 0, lodgings: lo.get(z.id) ?? 0 }));
  }, [marketZones, photos, trips, lodgings]);
  const unzonedLodgings = useMemo(() => lodgings.filter(l => !l.zone_id).length, [lodgings]);

  // ── Vết: chuyến đang chọn, không thì 40 chuyến mới nhất trong bộ lọc ──────
  const trackIds = useMemo(() => (sub !== 'trips' ? [] : selected ? [selected] : fTrips.slice(0, 40).map(t => t.id)), [sub, selected, fTrips]);
  const trackKey = trackIds.join(',');
  useEffect(() => {
    if (!trackIds.length) { setTracks(new Map()); return; }
    let alive = true;
    loadTracks(trackIds).then(m => { if (alive) setTracks(m); }).catch(e => say((e as Error).message));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackKey]);

  const selTrip = selected ? trips.find(t => t.id === selected) ?? null : null;
  const extrasSub = sub === 'lodgings' || sub === 'panos';
  const mapPhotos = sub === 'voice' || extrasSub ? [] : sub === 'trips' && selTrip ? fPhotos.filter(p => p.trip_id === selTrip.id) : fPhotos;
  const mapVoice = sub === 'photos' || sub === 'online' || extrasSub ? [] : sub === 'trips' && selTrip ? fVoice.filter(n => n.trip_id === selTrip.id) : fVoice;
  const mapLodgings = sub === 'lodgings' ? fLodgings : sub === 'trips' && selTrip ? fLodgings.filter(l => l.trip_id === selTrip.id) : [];
  const mapPanos = sub === 'panos' ? fPanos : sub === 'trips' && selTrip ? fPanos.filter(p => p.trip_id === selTrip.id) : [];

  const byTrip = useMemo(() => {
    const ph = new Map<string, number>(), vo = new Map<string, number>();
    photos.forEach(p => { if (p.trip_id) ph.set(p.trip_id, (ph.get(p.trip_id) ?? 0) + 1); });
    voiceNotes.forEach(n => { if (n.trip_id) vo.set(n.trip_id, (vo.get(n.trip_id) ?? 0) + 1); });
    return { ph, vo };
  }, [photos, voiceNotes]);
  const tripDays = useMemo(() => groupByDay(fTrips, t => t.started_at), [fTrips]);

  // ── Theo KCN (bỏ qua bộ lọc KCN, giữ thời gian + người đi + tỉnh) ─────────
  const zoneRows = useMemo(() => {
    const m = new Map<string, { id: string; name: string; province: string; trips: number; km: number; last: string | null; cover: number | null; photos: number; voice: number; starCos: Set<string> }>();
    const row = (id: string | null, name: string) => {
      const k = id ?? 'none';
      let r = m.get(k);
      if (!r) {
        r = { id: k, name: id ? (marketZones.find(z => z.id === id)?.name ?? name) || 'KCN đã xoá' : 'Không gắn KCN', province: id ? zoneProvLabel.get(id) ?? '' : '', trips: 0, km: 0, last: null, cover: null, photos: 0, voice: 0, starCos: new Set() };
        m.set(k, r);
      }
      return r;
    };
    trips.filter(t => okTime(t.started_at) && okPerson(t.user_name) && okProvince(t.zone_id)).forEach(t => {
      const r = row(t.zone_id, t.zone_name);
      r.trips += 1; r.km += t.distance_m / 1000;
      if (!r.last || t.started_at > r.last) r.last = t.started_at;
      if (t.road_coverage != null) r.cover = Math.max(r.cover ?? 0, t.road_coverage);
    });
    const touch = (r: { last: string | null }, at: string) => { if (!r.last || at > r.last) r.last = at; };
    photos.filter(p => okTime(p.taken_at) && okPerson(p.user_name) && okProvince(p.zone_id) && matchesKind(p, kind)).forEach(p => {
      const r = row(p.zone_id, p.zone_name); r.photos += 1; touch(r, p.taken_at);
      if (starOf(p)) r.starCos.add(foldName(p.company_name));
    });
    voiceNotes.filter(n => okTime(n.recorded_at) && okPerson(n.user_name) && okProvince(n.zone_id)).forEach(n => { const r = row(n.zone_id, n.zone_name); r.voice += 1; touch(r, n.recorded_at); });
    return [...m.values()].sort((a, b) => (b.last ?? '').localeCompare(a.last ?? '') || b.photos - a.photos);
  }, [trips, photos, voiceNotes, okTime, okPerson, okProvince, marketZones, zoneProvLabel, starOf, kind]);

  const totalM = fTrips.reduce((s, t) => s + t.distance_m, 0);
  const zonesCount = new Set(fTrips.map(t => t.zone_id).filter(Boolean)).size;
  const archiveCount = archive ? archive.trips.length + archive.photos.length + archive.voice.length : 0;

  // ── Thao tác ──────────────────────────────────────────────────────────────
  const saveTitle = async (t: SurveyTrip) => {
    if (!renaming) return;
    const title = renaming.value.trim() || surveyTitle(t.zone_name, new Date(t.started_at));
    try {
      await updateTrip(t.id, { title });
      if (titleColumnMissing()) { say(TITLE_MIGRATION_HINT); return; }
      setTrips(list => list.map(x => (x.id === t.id ? { ...x, title } : x)));
      setRenaming(null);
    } catch (e) { say((e as Error).message); }
  };
  // Xoá chuyến BẮT BUỘC nhập mã 4 số (mã phụ của hệ thống, chung với khoá Ghi chú) — server cũng chặn nếu không có mã (migration 212)
  const deleteTrip = (t: SurveyTrip) => {
    setPinReq({
      kind: 'verify', danger: true, confirmLabel: 'Xoá chuyến',
      title: 'Nhập mã để xoá chuyến khảo sát',
      message: `${t.title || t.zone_name || 'Chuyến khảo sát'} · ${new Date(t.started_at).toLocaleDateString('vi-VN')}. Chuyến vào Lưu trữ ${ARCHIVE_DAYS} ngày (khôi phục được), không còn hiện trên bản đồ / tính là đường đã đi. Ảnh chỉ tiêu và ghi âm của chuyến vẫn giữ nguyên.`,
      run: async pin => {
        await deleteTripWithPin(t.id, pin);
        setTrips(list => list.filter(x => x.id !== t.id));
        setSelected(null);
        say(`Đã chuyển chuyến vào Lưu trữ (${ARCHIVE_DAYS} ngày)`);
        void loadArchive();
      },
    });
  };
  const restore = async (kind: ArchiveKind, id: string) => {
    try {
      await restoreArchived(kind, id);
      say('Đã khôi phục');
      await Promise.all([load(), loadArchive()]);
    } catch (e) { say((e as Error).message); }
  };
  const purgeOne = async (kind: ArchiveKind, id: string, label: string) => {
    if (kind === 'trip') {
      setPinReq({
        kind: 'verify', danger: true, confirmLabel: 'Xoá hẳn',
        title: 'Nhập mã để xoá hẳn chuyến',
        message: `“${label}” sẽ bị xoá hẳn khỏi hệ thống, không khôi phục lại được trong app (vết GPS của chuyến xoá theo; ảnh / ghi âm của chuyến vẫn giữ). Bản sao dòng dữ liệu vẫn còn trong Lịch sử dữ liệu.`,
        run: async pin => { await purgeTripWithPin(id, pin); say('Đã xoá hẳn'); await loadArchive(); },
      });
      return;
    }
    if (!window.confirm(`XOÁ HẲN “${label}” khỏi hệ thống?\n\nKhông khôi phục lại được trong app nữa. Bản sao dòng dữ liệu vẫn còn trong Lịch sử dữ liệu.`)) return;
    try {
      const n = await purgeArchive({ kind, id });
      if (n == null) { say(ARCHIVE_MIGRATION_HINT); setArchiveMissing(true); return; }
      say('Đã xoá hẳn');
      await loadArchive();
    } catch (e) { say((e as Error).message); }
  };
  const exportPhotos = () => {
    const head = ['Ngày chụp', 'Loại', 'Tỉnh/TP', 'KCN', 'Công ty', 'Gắn sao', 'Vị trí tuyển', 'Số lượng', 'Lương', 'Ghi chú', 'Người chụp', 'Vĩ độ', 'Kinh độ', 'Link ảnh', 'Google Maps'];
    const esc = (v: unknown) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const rows = fPhotos.map(p => [fmtDateTime(p.taken_at), p.survey_kind === 'online' ? (p.verified_at ? 'Online - đã xác thực' : 'Online - chưa xác thực') : 'Đi thực địa', p.zone_id ? zoneProvLabel.get(p.zone_id) ?? '' : '', p.zone_name, p.company_name, starOf(p) ? '★' : '', p.positions, headcountText(p) ?? '', p.wage_text, p.note, p.user_name,
      p.lat.toFixed(6), p.lng.toFixed(6), p.url, `https://www.google.com/maps?q=${p.lat},${p.lng}`]);
    const csv = '﻿' + [head, ...rows].map(r => r.map(esc).join(',')).join('\n');
    const d = new Date();
    downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `anh-chi-tieu-khao-sat-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.csv`);
  };
  const zoneLabel = (id: string) => (id === 'none' ? 'Không gắn KCN' : marketZones.find(z => z.id === id)?.name ?? zoneRows.find(r => r.id === id)?.name ?? 'KCN');
  const showTripMedia = (t: SurveyTrip, to: 'photos' | 'voice') => { setTripFilter(t.id); setSelected(null); setPrefs({ sub: to, starOnly: false }); };
  const goSub = (s: Sub) => { setPrefs({ sub: s }); setSelected(null); if (s === 'trips' || s === 'zones') setTripFilter(null); };

  const subTabs: { id: Sub; label: string; count?: number; icon: ReactNode }[] = [
    { id: 'trips', label: 'Chuyến đi', count: fTrips.length, icon: <Route size={13} /> },
    { id: 'photos', label: 'Ảnh chỉ tiêu', count: fPhotosBoth.filter(p => p.survey_kind !== 'online').length, icon: <Camera size={13} /> },
    { id: 'online', label: 'Ảnh online', count: fPhotosBoth.filter(p => p.survey_kind === 'online').length, icon: <Globe size={13} /> },
    { id: 'voice', label: 'Ghi âm', count: fVoice.length, icon: <Mic size={13} /> },
    { id: 'lodgings', label: 'Nhà trọ', count: fLodgings.length, icon: <Home size={13} /> },
    { id: 'panos', label: 'Ảnh 360°', count: fPanos.length, icon: <Orbit size={13} /> },
    { id: 'zones', label: 'Theo KCN', icon: <MapPin size={13} /> },
    { id: 'archive', label: 'Lưu trữ', count: archive ? archiveCount : undefined, icon: <Archive size={13} /> },
  ];
  const tripOfFilter = tripFilter ? trips.find(t => t.id === tripFilter) ?? null : null;

  const body = (
    <div className="space-y-3">
      {/* ── Bắt đầu + tổng quan ── */}
      <div className={`${card} p-3 md:p-4 flex flex-col xl:flex-row xl:items-center gap-3`}>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <div className="flex-1 text-[15px] font-semibold text-[#111]">Khảo sát KCN</div>
            <button onClick={() => (full ? setFull(false) : setFull(true))} title={full ? 'Thoát toàn màn hình (Esc)' : 'Toàn màn hình — xem rõ hơn trên điện thoại'}
              className="h-8 px-2.5 rounded-lg border border-[#E8E7E2] bg-white text-[12px] text-[#333] inline-flex items-center gap-1 hover:bg-[#F9F9F7] shrink-0">
              {full ? <><Minimize2 size={13} /> Thu nhỏ</> : <><Maximize2 size={13} /> Toàn màn hình</>}
            </button>
          </div>
          {!full && (
            <div className="text-[12px] text-[#888] leading-snug mt-0.5">
              Đi 1 vòng KCN: ghi vết GPS, tô đường chưa đi, dẫn đường tới đoạn còn thiếu, chụp bảng chỉ tiêu (vẽ ghi chú lên ảnh), ghi âm nhanh — mọi dữ liệu lưu ở đây. KCN chưa có trên hệ thống: bấm “Thêm KCN / vùng” để tra trên bản đồ và khoanh vùng.
            </div>
          )}
          {pending && (
            <div className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-[12px] px-2.5 py-1">
              Chuyến đang dở: <b>{pending.trip.title || pending.trip.zone_name || 'Không gắn KCN'}</b> · {fmtDistance(pending.distance)}
            </div>
          )}
        </div>
        {/* Điện thoại: 4 nút phụ thành lưới 4 ô (biểu tượng trên, chữ dưới) + nút Bắt đầu cả hàng.
            Trước 12/11 cả 5 nút nằm 1 hàng không xuống dòng → rộng hơn màn hình, kéo trang trượt ngang. */}
        <div className="grid grid-cols-4 gap-2 sm:flex sm:flex-wrap xl:flex-nowrap xl:shrink-0">
          <button onClick={() => setOnlineOpen(true)} title="Thêm ảnh tuyển dụng lấy trên mạng + vị trí Google Maps (không đi thực địa)"
            className={SURVEY_SUB_BTN}>
            <Globe size={15} className="shrink-0" /> Ảnh online
          </button>
          <button onClick={() => setPlanFor({ zoneId: zoneId !== 'all' && zoneId !== 'none' ? zoneId : null })} title="Lên trước danh sách công ty cần ghé ở 1 KCN — lúc đi app sắp thứ tự ngắn nhất và dẫn đường"
            className={SURVEY_SUB_BTN}>
            <ListChecks size={15} className="shrink-0" /> <span>Kế hoạch<span className="hidden lg:inline"> ghé</span></span>
          </button>
          <button onClick={() => setShareOpen(true)} title="Gửi link + mã 4 số cho người ngoài xem khảo sát"
            className={SURVEY_SUB_BTN}>
            <Share2 size={15} className="shrink-0" /> Chia sẻ
          </button>
          <button onClick={() => setSurveyOpen('area')}
            className={SURVEY_SUB_BTN}>
            <Plus size={16} className="shrink-0" /> <span>Thêm KCN<span className="hidden sm:inline"> / vùng</span></span>
          </button>
          <button onClick={() => setSurveyOpen('survey')}
            className="col-span-4 sm:flex-none h-11 px-5 rounded-full bg-[#0A84FF] text-white text-[14px] font-semibold inline-flex items-center justify-center gap-2 shadow-[0_6px_20px_rgba(10,132,255,0.35)] active:scale-95 transition whitespace-nowrap">
            <Play size={16} fill="currentColor" /> {pending ? 'Mở chuyến dở' : 'Bắt đầu'}<span className="hidden sm:inline">{pending ? '' : ' khảo sát'}</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 md:grid-cols-5 gap-2">
        <Stat label="Chuyến đi" value={String(fTrips.length)} />
        <Stat label="Quãng đường" value={fmtDistance(totalM)} />
        <Stat label="KCN đã đi" value={String(zonesCount)} />
        <Stat label="Ảnh chỉ tiêu" value={String(fPhotosAll.length)} />
        <Stat label="Ghi âm" value={voiceMissing ? '—' : String(fVoice.length)} />
      </div>

      {/* ── Bộ lọc ── */}
      <div className={`${card} p-2.5 flex flex-wrap items-center gap-2`}>
        <select value={province} onChange={e => { setPrefs({ province: e.target.value, zoneId: 'all' }); setSelected(null); }}
          className="h-9 px-2.5 rounded-lg border border-[#E8E7E2] text-[12.5px] bg-white max-w-full md:w-44" aria-label="Tỉnh / thành phố">
          <option value="all">Mọi tỉnh / thành</option>
          {provinces.options.map(p => <option key={p.key} value={p.key}>{p.label} · {p.zones} KCN{p.surveyed ? ` (${p.surveyed} đã khảo sát)` : ''}</option>)}
          {provinces.unknown > 0 && <option value={NO_PROVINCE}>Chưa ghi tỉnh · {provinces.unknown} KCN{provinces.unknownSurveyed ? ` (${provinces.unknownSurveyed} đã khảo sát)` : ''}</option>}
        </select>
        <select value={zoneId} onChange={e => { setPrefs({ zoneId: e.target.value }); setSelected(null); setTripFilter(null); }}
          className="h-9 px-2.5 rounded-lg border border-[#E8E7E2] text-[12.5px] bg-white max-w-full md:w-60" aria-label="KCN">
          <option value="all">{province === 'all' ? 'Tất cả KCN' : province === NO_PROVINCE ? 'Mọi KCN chưa ghi tỉnh' : `Mọi KCN ở ${provinceName}`}</option>
          {province === 'all' && <option value="none">Không gắn KCN</option>}
          {zoneOptions.map(z => <option key={z.id} value={z.id}>{z.name}{z.used ? '' : ' (chưa khảo sát)'}</option>)}
        </select>
        <div className="flex gap-1">
          {PERIODS.map(p => (
            <button key={p.d} onClick={() => setPrefs({ period: p.d })}
              className={`h-9 px-2.5 rounded-lg text-[12px] font-medium border transition ${period === p.d ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-[#E8E7E2] text-[#666]'}`}>{p.label}</button>
          ))}
        </div>
        {people.length > 1 && (
          <select value={person} onChange={e => setPrefs({ person: e.target.value })} className="h-9 px-2.5 rounded-lg border border-[#E8E7E2] text-[12.5px] bg-white">
            <option value="all">Mọi người đi</option>
            {people.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        )}
        <select value={kind} onChange={e => setPrefs({ kind: e.target.value as KindFilter })} className="h-9 px-2.5 rounded-lg border border-[#E8E7E2] text-[12.5px] bg-white" aria-label="Loại khảo sát">
          {KIND_FILTERS.map(k => <option key={k.id} value={k.id}>{k.label}</option>)}
        </select>
        <div className="relative flex-1 min-w-[180px]">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#aaa]" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Tìm công ty, vị trí tuyển, ghi chú…"
            className="w-full h-9 pl-8 pr-2.5 rounded-lg border border-[#E8E7E2] text-[12.5px] outline-none focus:border-[#1D4ED8]" />
        </div>
        {zoneId !== 'all' && (
          <button onClick={() => setPdfFor({ id: zoneId, name: zoneLabel(zoneId) })} title="Xuất PDF KCN này để đưa AI phân tích lương & tuyển dụng"
            className="h-9 px-2.5 rounded-lg border border-[#E8E7E2] bg-white text-[12px] text-[#333] inline-flex items-center gap-1 hover:bg-[#F9F9F7]">
            <FileText size={13} /> PDF KCN này
          </button>
        )}
        <button onClick={() => void load()} disabled={loading} title="Tải lại"
          className="h-9 w-9 rounded-lg border border-[#E8E7E2] flex items-center justify-center text-[#666] hover:bg-[#F9F9F7] disabled:opacity-40">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Trường / nguồn LĐ gần KCN đang lọc — bấm để mở hồ sơ ở Nguồn LĐ */}
      {zoneId !== 'all' && zoneId !== 'none' && labor.sources.length > 0 && (() => {
        const near = nearOf(zoneId, 4);
        if (!near.length) return null;
        return (
          <div className={`${card} px-3 py-2 flex items-center gap-2 overflow-x-auto no-scrollbar`}>
            <span className="shrink-0 text-[12px] font-medium text-[#666]">Nguồn LĐ gần:</span>
            {near.map(n => (
              <button key={n.source.id} onClick={() => requestOpenSource(n.source.id)} title={n.estimated ? 'Ước tính — mở hồ sơ để tính đường xe thật' : 'Giờ xe khách 16–45 chỗ'}
                className="shrink-0 h-7 px-2.5 rounded-full bg-[#0071E3]/10 text-[#0066CC] text-[12px] font-medium whitespace-nowrap">
                {shortName(n.source)} · {n.estimated ? '≈' : ''}{Math.round(n.min)} phút
              </button>
            ))}
            <button onClick={() => goTab('sources', zoneLabel(zoneId))} className="shrink-0 text-[12px] text-[#0066CC] hover:underline whitespace-nowrap">Xem tất cả →</button>
          </div>
        );
      })()}

      <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
        {subTabs.map(t => (
          <button key={t.id} onClick={() => goSub(t.id)}
            className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium border transition ${sub === t.id ? 'bg-[#111] border-[#111] text-white' : 'bg-white border-[#E8E7E2] text-[#666]'}`}>
            {t.icon}{t.label}{t.count != null && <span className={sub === t.id ? 'text-white/70' : 'text-[#aaa]'}>{t.count}</span>}
          </button>
        ))}
      </div>

      {error && <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-[12.5px] px-3 py-2">{error}</div>}
      {voiceMissing && sub === 'voice' && <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-[12.5px] px-3 py-2">{VOICE_MIGRATION_HINT}</div>}

      {sub === 'archive' ? (
        <ArchiveView archive={archive} missing={archiveMissing} onRestore={restore} onPurge={purgeOne} onReload={() => void loadArchive()} />
      ) : sub === 'zones' ? (
        <div className={`${card} overflow-x-auto`}>
          <table className="w-full text-[12.5px]">
            <thead className="text-[11px] text-[#888] bg-[#FAFAF8]">
              <tr>
                <th className="text-left font-medium px-3 py-2">KCN</th>
                <th className="text-left font-medium px-2 py-2">Tỉnh / TP</th>
                <th className="text-right font-medium px-2 py-2">Chuyến</th>
                <th className="text-right font-medium px-2 py-2">Quãng đường</th>
                <th className="text-right font-medium px-2 py-2">Phủ đường cao nhất</th>
                <th className="text-right font-medium px-2 py-2">Ảnh</th>
                <th className="text-right font-medium px-2 py-2" title="Công ty gắn sao (cần chú trọng)">★</th>
                <th className="text-right font-medium px-2 py-2">Ghi âm</th>
                <th className="text-right font-medium px-2 py-2">Lần gần nhất</th>
                <th className="text-right font-medium px-2 py-2" title="Công ty cần ghé đã lên kế hoạch">Cần ghé</th>
                {labor.sources.length > 0 && <th className="text-left font-medium px-2 py-2" title="Trường / nguồn LĐ gần nhất theo giờ xe khách (≈ = ước tính, mở Nguồn LĐ để tính đường thật)">Nguồn LĐ gần</th>}
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F0EEE9]">
              {zoneRows.map(r => (
                <tr key={r.id} onClick={() => { setPrefs({ zoneId: r.id, sub: 'trips' }); setTripFilter(null); }} className="cursor-pointer hover:bg-[#F9F9F7]">
                  <td className="px-3 py-2 font-medium text-[#111]">{r.name}</td>
                  <td className="px-2 py-2 text-[#666] whitespace-nowrap">{r.province || '—'}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{r.trips}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{r.km ? fmtDistance(r.km * 1000) : '—'}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{r.cover != null ? `${r.cover.toLocaleString('vi-VN')}%` : '—'}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{r.photos || '—'}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-[#B7791F]">{r.starCos.size || '—'}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{r.voice || '—'}</td>
                  <td className="px-2 py-2 text-right text-[#666] whitespace-nowrap">{r.last ? new Date(r.last).toLocaleDateString('vi-VN') : '—'}</td>
                  <td className="px-2 py-1.5 text-right">
                    {r.id !== 'none' && (
                      <button onClick={e => { e.stopPropagation(); setPlanFor({ zoneId: r.id }); }} title="Kế hoạch ghé công ty ở KCN này"
                        className="h-7 px-2 rounded-md border border-[#E8E7E2] bg-white text-[11.5px] text-[#3634A3] inline-flex items-center gap-1 hover:bg-[#F4F3FF] tabular-nums">
                        <ListChecks size={12} /> {planCount.get(r.id) ?? 0}
                      </button>
                    )}
                  </td>
                  {labor.sources.length > 0 && (() => {
                    const n = r.id !== 'none' ? nearOf(r.id, 1)[0] : undefined;
                    return (
                      <td className="px-2 py-2 whitespace-nowrap">
                        {n ? (
                          <button onClick={e => { e.stopPropagation(); requestOpenSource(n.source.id); }} title={`${n.source.name} — mở hồ sơ Nguồn LĐ`}
                            className="text-[12px] text-[#0066CC] hover:underline max-w-[160px] truncate inline-block align-middle">
                            {shortName(n.source)} · {n.estimated ? '≈' : ''}{Math.round(n.min)}′
                          </button>
                        ) : <span className="text-[#bbb]">—</span>}
                      </td>
                    );
                  })()}
                  <td className="px-3 py-1.5 text-right">
                    <button onClick={e => { e.stopPropagation(); setPdfFor({ id: r.id, name: r.name }); }} title="Xuất PDF để đưa AI phân tích lương & tuyển dụng"
                      className="h-7 px-2 rounded-md border border-[#E8E7E2] bg-white text-[11.5px] text-[#333] inline-flex items-center gap-1 hover:bg-[#F2F2F0]">
                      <FileText size={12} /> PDF
                    </button>
                  </td>
                </tr>
              ))}
              {!zoneRows.length && <tr><td colSpan={12} className="px-3 py-8 text-center text-[#aaa]">Chưa có dữ liệu khảo sát trong khoảng thời gian này</td></tr>}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="flex flex-col md:grid md:grid-cols-[minmax(320px,420px)_1fr] gap-3 md:items-start">
          {/* Bản đồ: bấm ⤢ để phóng kín màn hình */}
          {/* Cỡ bản đồ đặt ở khung bọc ngoài — KHÔNG đổi className của khung Leaflet (React ghi đè làm mất class Leaflet → trắng) */}
          <div className={mapBig ? 'fixed inset-0 z-[320] bg-[#E5E3DF]'
            : `relative order-first md:order-none md:col-start-2 md:row-start-1 md:sticky md:top-0 ${full ? 'h-[42vh]' : 'h-[280px]'} md:h-[calc(100dvh-330px)] md:min-h-[460px] rounded-[10px] border border-[#E8E7E2] overflow-hidden`}>
            <SurveyTripMap
              className="absolute inset-0"
              tracks={tracks} selectedId={selected} photos={mapPhotos} voiceNotes={mapVoice}
              lodgings={mapLodgings} panos={mapPanos}
              onLodging={l => setLodgingSheet({ lodging: l })} onPano={p => setOpenPano({ id: p.id, calibrate: false })}
              onPhoto={setViewer} onVoice={setVoiceSheet} onTrip={id => setSelected(id)}
              fitKey={`${sub}:${zoneId}:${province}:${period}:${person}:${selected ?? ''}:${tripFilter ?? ''}:${starOnly}:${mapBig}`} focus={focus} />
            <button onClick={() => setMapBig(v => !v)} title={mapBig ? 'Thu nhỏ bản đồ (Esc)' : 'Phóng bản đồ kín màn hình'}
              className={`absolute z-[1000] h-9 px-3 rounded-full bg-white/95 shadow-md text-[12.5px] font-medium text-[#111] inline-flex items-center gap-1.5 ${mapBig ? 'right-3 top-[calc(12px+env(safe-area-inset-top))]' : 'right-2 top-2'}`}>
              {mapBig ? <><Minimize2 size={14} /> Thu nhỏ</> : <Maximize2 size={14} />}
            </button>
            {mapBig && flash && <FlashMsg text={flash} />}
          </div>

          <div className="md:col-start-1 md:row-start-1 min-w-0">
            {loading && <div className="py-10 flex justify-center text-[#aaa]"><Loader2 size={20} className="animate-spin" /></div>}

            {!loading && sub === 'trips' && (
              fTrips.length === 0 ? <Empty icon={<Route size={22} />} text="Chưa có chuyến khảo sát nào trong bộ lọc" /> : (
                <div className="space-y-2.5">
                  {tripDays.map(g => (
                    <div key={g.key}>
                      <div className="px-1 pb-1 flex items-baseline gap-2 text-[11.5px]">
                        <span className="font-semibold text-[#333]">{g.label}</span>
                        <span className="text-[#999]">{g.items.length} chuyến · {fmtDistance(g.items.reduce((m, t) => m + t.distance_m, 0))}</span>
                      </div>
                      <div className={`${card} divide-y divide-[#F0EEE9] overflow-hidden`}>
                        {g.items.map(t => {
                          const open = selected === t.id;
                          const dur = t.ended_at ? (new Date(t.ended_at).getTime() - new Date(t.started_at).getTime()) / 1000 : null;
                          const nPh = byTrip.ph.get(t.id) ?? 0, nVo = byTrip.vo.get(t.id) ?? 0;
                          const name = t.title || t.zone_name || 'Không gắn KCN';
                          return (
                            <div key={t.id} className={open ? 'bg-[#FFFBF0]' : ''}>
                              <button onClick={() => { setSelected(open ? null : t.id); setShowPassed(false); }} className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-[#FAFAF8]">
                                <span className="text-[12.5px] font-semibold text-[#111] tabular-nums w-[38px] shrink-0">
                                  {new Date(t.started_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
                                </span>
                                <span className="flex-1 min-w-0">
                                  <span className="block text-[13px] font-medium text-[#111] truncate">{name}</span>
                                  <span className="block text-[11px] text-[#888] truncate">
                                    {[fmtDistance(t.distance_m), dur != null ? fmtDuration(dur) : null, t.road_coverage != null ? `phủ ${t.road_coverage.toLocaleString('vi-VN')}%` : null,
                                      t.title && t.zone_name && !t.title.includes(t.zone_name) ? t.zone_name : null, t.user_name || null].filter(Boolean).join(' · ')}
                                  </span>
                                </span>
                                <span className="flex items-center gap-1 text-[11px] text-[#555] shrink-0">
                                  {!t.ended_at && <span className="px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-700 font-medium">Dở</span>}
                                  {nPh > 0 && <span className="px-1.5 py-0.5 rounded-md bg-[#F2F2F0]">📷 {nPh}</span>}
                                  {nVo > 0 && <span className="px-1.5 py-0.5 rounded-md bg-[#F2F2F0]">🎙 {nVo}</span>}
                                </span>
                                {open ? <ChevronDown size={15} className="text-[#C7C7CC] shrink-0" /> : <ChevronRight size={15} className="text-[#C7C7CC] shrink-0" />}
                              </button>
                              {open && (
                                <div className="px-3 pb-3 pt-1 space-y-2">
                                  <div className="flex gap-1.5 flex-wrap">
                                    {nPh > 0 && (
                                      <button onClick={() => showTripMedia(t, 'photos')} className="h-8 px-2.5 rounded-lg bg-[#0A84FF] text-white text-[12px] font-medium inline-flex items-center gap-1">
                                        <Camera size={12} /> Xem {nPh} ảnh
                                      </button>
                                    )}
                                    {nVo > 0 && (
                                      <button onClick={() => showTripMedia(t, 'voice')} className="h-8 px-2.5 rounded-lg border border-[#E8E7E2] bg-white text-[12px] text-[#333] inline-flex items-center gap-1">
                                        <Mic size={12} /> Nghe {nVo} ghi âm
                                      </button>
                                    )}
                                    {(nPh > 0 || nVo > 0) && (
                                      <button onClick={() => setPdfFor({ id: t.zone_id ?? 'none', name: t.zone_name || (t.zone_id ? zoneLabel(t.zone_id) : 'Không gắn KCN'), trip: t })}
                                        title="PDF riêng chuyến này để đưa AI phân tích"
                                        className="h-8 px-2.5 rounded-lg border border-[#E8E7E2] bg-white text-[12px] text-[#333] inline-flex items-center gap-1"><FileText size={12} /> PDF chuyến này</button>
                                    )}
                                    <button onClick={() => setImportTrip(t)} title="Thêm ảnh đã chụp sẵn trong máy — tự ghim đúng chỗ chụp (vị trí trong ảnh / giờ chụp trên đường đã đi)"
                                      className="h-8 px-2.5 rounded-lg border border-[#E8E7E2] bg-white text-[12px] text-[#333] inline-flex items-center gap-1"><ImagePlus size={12} /> Bổ sung ảnh</button>
                                    <button onClick={() => setRenaming({ id: t.id, value: t.title || surveyTitle(t.zone_name, new Date(t.started_at)) })}
                                      className="h-8 px-2.5 rounded-lg border border-[#E8E7E2] bg-white text-[12px] text-[#333] inline-flex items-center gap-1"><Pencil size={12} /> Đổi tên</button>
                                    <button onClick={() => void deleteTrip(t)} className="h-8 px-2.5 rounded-lg border border-red-200 bg-red-50 text-[12px] text-red-600 inline-flex items-center gap-1"><Trash2 size={12} /> Xoá</button>
                                  </div>
                                  {renaming?.id === t.id && (
                                    <div className="flex gap-1.5">
                                      <input value={renaming.value} onChange={e => setRenaming({ id: t.id, value: e.target.value })} autoFocus
                                        onKeyDown={e => { if (e.key === 'Enter') void saveTitle(t); }}
                                        className="flex-1 min-w-0 h-9 px-2.5 rounded-lg border border-[#E8E7E2] text-[13px] outline-none focus:border-[#1D4ED8]" />
                                      <button onClick={() => void saveTitle(t)} className="h-9 px-3 rounded-lg bg-[#0A84FF] text-white text-[12.5px] font-semibold shrink-0">Lưu</button>
                                      <button onClick={() => setRenaming(null)} className="h-9 px-2.5 rounded-lg border border-[#E8E7E2] text-[12.5px] shrink-0">Huỷ</button>
                                    </div>
                                  )}
                                  {t.note && <div className="text-[12.5px] text-[#333] whitespace-pre-line">{t.note}</div>}
                                  {t.passed.length > 0 && (
                                    <div>
                                      <button onClick={() => setShowPassed(v => !v)} className="w-full text-left text-[12px] flex items-start gap-1">
                                        {showPassed ? <ChevronDown size={14} className="text-[#0A84FF] shrink-0 mt-px" /> : <ChevronRight size={14} className="text-[#0A84FF] shrink-0 mt-px" />}
                                        <span className="min-w-0">
                                          <span className="text-[#0A84FF] font-medium">Đã đi ngang {t.passed.length} công ty</span>
                                          <span className="text-[#999]"> · {groupPassed(t.passed).map(gr => `${gr.items.length} ${STATUS_META[gr.status].label.toLowerCase()}`).join(', ')}</span>
                                        </span>
                                      </button>
                                      {showPassed && (
                                        <div className="mt-1 space-y-1.5">
                                          {groupPassed(t.passed).map(gr => (
                                            <div key={gr.status}>
                                              <div className="text-[11px] font-semibold" style={{ color: STATUS_META[gr.status].color }}>{STATUS_META[gr.status].label} ({gr.items.length})</div>
                                              <div className="text-[12px] text-[#333] leading-relaxed">{gr.items.map(i => i.name).join(' · ')}</div>
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )
            )}

            {!loading && sub === 'photos' && (
              <div className="space-y-2">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <button onClick={() => setPrefs({ starOnly: !starOnly })}
                    className={`h-8 px-2.5 rounded-lg border text-[12px] font-medium inline-flex items-center gap-1 ${starOnly ? 'bg-[#FFF4D6] border-[#F5B400]/60 text-[#8A5A00]' : 'bg-white border-[#E8E7E2] text-[#555]'}`}>
                    <Star size={12} fill={starOnly ? '#F5B400' : 'none'} className={starOnly ? 'text-[#F5A300]' : ''} /> Công ty gắn sao ({starredCount})
                  </button>
                  {tripOfFilter && (
                    <span className="h-8 pl-2.5 pr-1 rounded-lg bg-[#EEF5FF] border border-blue-200 text-[12px] text-blue-800 inline-flex items-center gap-1 max-w-full">
                      <Route size={12} className="shrink-0" />
                      <span className="truncate">Chuyến {fmtDateTime(tripOfFilter.started_at)} · {tripOfFilter.title || tripOfFilter.zone_name}</span>
                      <button onClick={() => setTripFilter(null)} className="w-6 h-6 rounded-md hover:bg-blue-100 flex items-center justify-center shrink-0" aria-label="Bỏ lọc chuyến"><X size={13} /></button>
                    </span>
                  )}
                  {tripOfFilter && (
                    <button onClick={() => setPdfFor({ id: tripOfFilter.zone_id ?? 'none', name: tripOfFilter.zone_name || 'Không gắn KCN', trip: tripOfFilter })}
                      className="h-8 px-2.5 rounded-lg border border-[#E8E7E2] bg-white text-[12px] text-[#333] inline-flex items-center gap-1 hover:bg-[#F9F9F7]">
                      <FileText size={12} /> PDF chuyến này
                    </button>
                  )}
                  <span className="flex-1" />
                  {fPhotos.length > 0 && (
                    <button onClick={exportPhotos} className="h-8 px-2.5 rounded-lg border border-[#E8E7E2] bg-white text-[12px] text-[#333] inline-flex items-center gap-1 hover:bg-[#F9F9F7]">
                      <Download size={12} /> CSV / Excel
                    </button>
                  )}
                </div>
                {fPhotos.length === 0 ? <Empty icon={<Camera size={22} />} text={starOnly ? 'Chưa có ảnh của công ty gắn sao trong bộ lọc' : 'Chưa có ảnh chỉ tiêu nào trong bộ lọc'} /> : (
                  <div className={`grid gap-1.5 ${full ? 'grid-cols-3 sm:grid-cols-4' : 'grid-cols-3'}`}>
                    {fPhotos.map(p => {
                      const st = starOf(p);
                      return (
                        <button key={p.id} onClick={() => setViewer(p)} className={`relative aspect-square rounded-lg overflow-hidden bg-[#EEE] text-left ${st ? 'ring-2 ring-[#F5B400]' : ''}`}>
                          <PhotoThumb photo={p} />
                          {st && <span className="absolute top-1 left-1 w-5 h-5 rounded-full bg-[#F5B400] text-white flex items-center justify-center shadow" title="Công ty gắn sao"><Star size={11} fill="currentColor" /></span>}
                          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent px-1.5 pt-4 pb-1">
                            <div className="text-[10.5px] font-semibold text-white leading-tight line-clamp-2">{p.company_name || 'Chưa rõ công ty'}</div>
                            <div className="text-[9.5px] text-white/80">{new Date(p.taken_at).toLocaleDateString('vi-VN')}{headcountText(p) != null ? ` · SL ${headcountText(p)}` : ''}</div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {!loading && sub === 'online' && (
              <div className="space-y-2">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <button onClick={() => setOnlineOpen(true)} className="h-8 px-2.5 rounded-lg bg-[#0A84FF] text-white text-[12px] font-semibold inline-flex items-center gap-1"><Plus size={12} /> Thêm ảnh online</button>
                  {fPhotos.length > 0 && (
                    <button onClick={() => setOnlineSel(onlineSel.size === fPhotos.length ? new Set() : new Set(fPhotos.map(p => p.id)))}
                      className="h-8 px-2.5 rounded-lg border border-[#E8E7E2] bg-white text-[12px] text-[#333]">{onlineSel.size === fPhotos.length ? 'Bỏ chọn hết' : 'Chọn tất cả'}</button>
                  )}
                  {onlineSel.size > 0 && (
                    <button onClick={() => void deleteOnlineSel()} className="h-8 px-2.5 rounded-lg bg-[#D70015] text-white text-[12px] font-semibold inline-flex items-center gap-1"><Trash2 size={12} /> Xoá {onlineSel.size} ảnh</button>
                  )}
                  <span className="flex-1" />
                  {fPhotos.length > 0 && (
                    <button onClick={exportPhotos} className="h-8 px-2.5 rounded-lg border border-[#E8E7E2] bg-white text-[12px] text-[#333] inline-flex items-center gap-1"><Download size={12} /> CSV / Excel</button>
                  )}
                </div>
                {fPhotos.length === 0 ? <Empty icon={<Globe size={22} />} text="Chưa có ảnh khảo sát online nào trong bộ lọc" /> : (
                  <div className={`grid gap-1.5 ${full ? 'grid-cols-3 sm:grid-cols-4' : 'grid-cols-3'}`}>
                    {fPhotos.map(p => {
                      const sel = onlineSel.has(p.id);
                      return (
                        <div key={p.id} className={`relative aspect-square rounded-lg overflow-hidden bg-[#EEE] ${sel ? 'ring-2 ring-[#0A84FF]' : ''}`}>
                          <button onClick={() => setViewer(p)} className="absolute inset-0 text-left">
                            <PhotoThumb photo={p} />
                            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent px-1.5 pt-4 pb-1">
                              <div className="text-[10.5px] font-semibold text-white leading-tight line-clamp-2">{p.positions || p.company_name || 'Chưa ghi vị trí tuyển'}</div>
                              <div className="text-[9.5px] text-white/80">{new Date(p.taken_at).toLocaleDateString('vi-VN')}{headcountText(p) != null ? ` · SL ${headcountText(p)}` : ''}{p.verified_at ? ' · ✓ đã xác thực' : ''}</div>
                            </div>
                          </button>
                          <button onClick={() => toggleOnlineSel(p.id)} aria-label={sel ? 'Bỏ chọn' : 'Chọn ảnh'}
                            className={`absolute top-1 left-1 w-6 h-6 rounded-full border-2 flex items-center justify-center text-[12px] ${sel ? 'bg-[#0A84FF] border-[#0A84FF] text-white' : 'bg-black/30 border-white text-transparent'}`}>✓</button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {!loading && sub === 'voice' && (
              <div className="space-y-2">
                {tripOfFilter && (
                  <span className="h-8 pl-2.5 pr-1 rounded-lg bg-[#EEF5FF] border border-blue-200 text-[12px] text-blue-800 inline-flex items-center gap-1 max-w-full">
                    <Route size={12} className="shrink-0" />
                    <span className="truncate">Chuyến {fmtDateTime(tripOfFilter.started_at)} · {tripOfFilter.title || tripOfFilter.zone_name}</span>
                    <button onClick={() => setTripFilter(null)} className="w-6 h-6 rounded-md hover:bg-blue-100 flex items-center justify-center shrink-0" aria-label="Bỏ lọc chuyến"><X size={13} /></button>
                  </span>
                )}
                {fVoice.length === 0 ? <Empty icon={<Mic size={22} />} text={voiceMissing ? 'Chưa có bảng ghi âm (chạy migration 193)' : 'Chưa có bản ghi âm nào trong bộ lọc'} /> : (
                  <div className={`${card} divide-y divide-[#F0EEE9] overflow-hidden`}>
                    {fVoice.map(n => <VoiceRow key={n.id} n={n} onOpen={() => setVoiceSheet(n)} showZone />)}
                  </div>
                )}
              </div>
            )}

            {!loading && sub === 'lodgings' && (
              <div className="space-y-2">
                {extrasMissing.lodging && <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-[12.5px] px-3 py-2">{LODGING_MIGRATION_HINT}</div>}
                <button onClick={() => (extrasMissing.lodging ? say(LODGING_MIGRATION_HINT) : setLodgingSheet({ lodging: null }))}
                  className="w-full h-10 rounded-[10px] border border-dashed border-[#FF9500]/60 text-[#C76A00] text-[13px] font-semibold inline-flex items-center justify-center gap-1.5 hover:bg-[#FFF4E5]">
                  <Plus size={15} /> Thêm nhà trọ
                </button>
                <div className="text-[11.5px] text-[#999] px-1">Đang đi thực địa: bấm “Thêm” trong màn khảo sát để tự lấy vị trí GPS.</div>
                {fLodgings.length === 0 ? <Empty icon={<Home size={22} />} text="Chưa có nhà trọ nào trong bộ lọc" /> : (
                  <div className={`${card} divide-y divide-[#F0EEE9] overflow-hidden`}>
                    {fLodgings.map(l => <LodgingRow key={l.id} l={l} onOpen={() => setLodgingSheet({ lodging: l })} onMap={() => { if (l.lat != null && l.lng != null) setFocus({ lat: l.lat, lng: l.lng, key: Date.now() }); }} />)}
                  </div>
                )}
              </div>
            )}

            {!loading && sub === 'panos' && (
              <div className="space-y-2">
                {extrasMissing.pano && <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-[12.5px] px-3 py-2">{PANO_MIGRATION_HINT}</div>}
                <button onClick={() => (extrasMissing.pano ? say(PANO_MIGRATION_HINT) : setAddPano(true))}
                  className="w-full h-10 rounded-[10px] border border-dashed border-[#0A84FF]/60 text-[#0A84FF] text-[13px] font-semibold inline-flex items-center justify-center gap-1.5 hover:bg-[#EAF3FF]">
                  <Plus size={15} /> Thêm ảnh 360°
                </button>
                <div className="text-[11.5px] text-[#999] px-1">Link Google Photos / Google Drive hoặc ảnh 360 trong máy. Đang đi thực địa: bấm “Thêm” trong màn khảo sát để tự lấy GPS.</div>
                {fPanos.length === 0 ? <Empty icon={<Orbit size={22} />} text="Chưa có ảnh 360 nào trong bộ lọc" /> : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {fPanos.map(p => <PanoCard key={p.id} p={p} onOpen={() => setOpenPano({ id: p.id, calibrate: false })} />)}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {viewer && (
        <SurveyPhotoViewer photo={viewer} onClose={() => setViewer(null)} say={say}
          starred={starOf(viewer)} onStar={togglePhotoStar}
          nav={{ index: Math.max(0, fPhotosBoth.findIndex(x => x.id === viewer.id)), total: fPhotosBoth.length,
            onPrev: fPhotosBoth.findIndex(x => x.id === viewer.id) > 0 ? () => setViewer(fPhotosBoth[fPhotosBoth.findIndex(x => x.id === viewer.id) - 1]) : null,
            onNext: fPhotosBoth.findIndex(x => x.id === viewer.id) < fPhotosBoth.length - 1 ? () => setViewer(fPhotosBoth[fPhotosBoth.findIndex(x => x.id === viewer.id) + 1]) : null }}
          onShowOnMap={() => { const p = viewer; setViewer(null); setFocus({ lat: p.lat, lng: p.lng, key: Date.now() }); }}
          onSaved={p => { setPhotos(list => list.map(x => (x.id === p.id ? p : x))); setViewer(p); }}
          onDeleted={id => { setPhotos(list => list.filter(x => x.id !== id)); setViewer(null); void loadArchive(); }} />
      )}
      {lodgingSheet && (
        <LodgingSheet lodging={lodgingSheet.lodging} candidates={mapPts.candidates}
          start={lodgingSheet.lodging ? undefined : { position: null, zoneId: zoneId !== 'all' && zoneId !== 'none' ? zoneId : null, zoneName: zoneId !== 'all' && zoneId !== 'none' ? zoneLabel(zoneId) : '', tripId: null }}
          fallbackCenter={(() => { const z = marketZones.find(x => x.id === zoneId); return z?.lat != null && z.lng != null ? { lat: z.lat, lng: z.lng } : { lat: 10.98, lng: 106.67 }; })()}
          onClose={() => setLodgingSheet(null)}
          onSaved={l => setLodgings(list => [l, ...list.filter(x => x.id !== l.id)])}
          onDeleted={id => setLodgings(list => list.filter(x => x.id !== id))} />
      )}
      {addPano && (
        <AddPanoModal
          mapCenter={(() => { const z = marketZones.find(x => x.id === zoneId); return z?.lat != null && z.lng != null ? { lat: z.lat, lng: z.lng } : { lat: 10.98, lng: 106.67 }; })()}
          survey={{ tripId: null, zoneId: zoneId !== 'all' && zoneId !== 'none' ? zoneId : null, zoneName: zoneId !== 'all' && zoneId !== 'none' ? zoneLabel(zoneId) : '' }}
          zones={marketZones.filter(z => z.lat != null && z.lng != null).map(z => ({ name: z.name, lat: z.lat!, lng: z.lng! }))}
          onClose={() => setAddPano(false)}
          onCreated={row => { setAddPano(false); setPanos(list => [row, ...list]); setOpenPano({ id: row.id, calibrate: row.heading == null }); }} />
      )}
      {openPano && (() => {
        const pn = panos.find(x => x.id === openPano.id);
        if (!pn) return null;
        return (
          <PanoModal key={pn.id} pano={pn} points={mapPts.panoPoints} panos={panos} startCalibrate={openPano.calibrate} toast={say}
            onClose={() => setOpenPano(null)}
            onChanged={row => setPanos(list => list.map(x => (x.id === row.id ? row : x)))}
            onDeleted={id => { setOpenPano(null); setPanos(list => list.filter(x => x.id !== id)); say('Đã xoá ảnh 360'); }}
            onSwitch={id => setOpenPano({ id, calibrate: false })} />
        );
      })()}
      {voiceSheet && (
        <SurveyVoiceSheet note={voiceSheet} say={say} onClose={() => setVoiceSheet(null)}
          onShowOnMap={() => { const n = voiceSheet; setVoiceSheet(null); if (n.lat != null && n.lng != null) setFocus({ lat: n.lat, lng: n.lng, key: Date.now() }); }}
          onSaved={n => { setVoiceNotes(list => list.map(x => (x.id === n.id ? n : x))); setVoiceSheet(n); }}
          onDeleted={id => { setVoiceNotes(list => list.filter(x => x.id !== id)); setVoiceSheet(null); void loadArchive(); }} />
      )}
      {pdfFor && (
        <PdfDialog zone={pdfFor} trip={pdfFor.trip ?? null} province={pdfFor.id !== 'none' ? zoneProvLabel.get(pdfFor.id) || null : null} periodDays={period}
          trips={pdfFor.trip ? [pdfFor.trip] : trips.filter(t => okTime(t.started_at) && okPerson(t.user_name) && (pdfFor.id === 'none' ? !t.zone_id : t.zone_id === pdfFor.id))}
          photos={pdfFor.trip ? photos.filter(p => p.trip_id === pdfFor.trip!.id)
            : photos.filter(p => okTime(p.taken_at) && okPerson(p.user_name) && (pdfFor.id === 'none' ? !p.zone_id : p.zone_id === pdfFor.id))}
          voice={pdfFor.trip ? voiceNotes.filter(n => n.trip_id === pdfFor.trip!.id)
            : voiceNotes.filter(n => okTime(n.recorded_at) && okPerson(n.user_name) && (pdfFor.id === 'none' ? !n.zone_id : n.zone_id === pdfFor.id))}
          stars={stars} say={say} onClose={() => setPdfFor(null)} />
      )}
      {onlineOpen && <OnlinePhotoDialog zones={marketZones} leads={marketLeads} user={user ? { id: user.id, full_name: user.full_name } : null} defaultZoneId={zoneId !== 'all' && zoneId !== 'none' ? zoneId : null}
        say={say} isStarred={c => !!findStar(stars, c)} onToggleStar={(c, on) => void toggleStar(c, on)} onClose={() => setOnlineOpen(false)} onSaved={ps => setPhotos(list => [...ps, ...list])} />}
      {pinReq && <SurveyPinGate req={pinReq} onClose={() => setPinReq(null)} onDone={() => setPinReq(null)} />}
      {planFor && (
        <PlanDialogWithData marketLeads={marketLeads} zones={marketZones} initialZoneId={planFor.zoneId} stops={planStops} setStops={setPlanStops}
          missing={planMissing} token={token} userName={user?.full_name || user?.username || ''} say={say} onClose={() => setPlanFor(null)} />
      )}
      {importTrip && (() => {
        const z = importTrip.zone_id ? marketZones.find(x => x.id === importTrip.zone_id) : null;
        return (
          <TripPhotoImportDialog trip={importTrip} zoneCenter={z?.lat != null && z.lng != null ? { lat: z.lat, lng: z.lng } : null}
            user={user ? { id: user.id, full_name: user.full_name } : null} say={say} onClose={() => setImportTrip(null)}
            onSaved={ps => setPhotos(list => [...ps, ...list])} />
        );
      })()}
      {shareOpen && <SurveyShareDialog zones={shareZones} unzonedLodgings={unzonedLodgings} token={token} say={say} onClose={() => setShareOpen(false)} />}
      {surveyOpen && (
        <KcnSurveyMode marketZones={marketZones} marketLeads={marketLeads} branches={branches} laborHistory={laborHistory} goTab={goTab}
          startWith={surveyOpen === 'area' ? 'area' : undefined}
          onClose={() => { setSurveyOpen(false); setPending(pendingActiveTrip()); void load(); }} />
      )}
    </div>
  );

  if (!full) return body;
  return createPortal(
    <div className="fixed inset-0 z-[300] bg-[#F5F5F2] overflow-y-auto overscroll-contain pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      <div className="p-2.5 md:p-4 max-w-[1600px] mx-auto">{body}</div>
      {flash && !mapBig && <FlashMsg text={flash} />}
    </div>,
    document.body,
  );
}

function FlashMsg({ text }: { text: string }) {
  return (
    <div className="fixed left-1/2 -translate-x-1/2 bottom-[calc(20px+env(safe-area-inset-bottom))] z-[1100] max-w-[90vw] rounded-xl bg-[#1D1D1F]/90 text-white text-[13px] px-4 py-2.5 shadow-lg pointer-events-none text-center">
      {text}
    </div>
  );
}

// ── Lưu trữ ──────────────────────────────────────────────────────────────────
function ArchiveView({ archive, missing, onRestore, onPurge, onReload }: {
  archive: { trips: ArchivedTrip[]; photos: ArchivedPhoto[]; voice: ArchivedVoice[] } | null;
  missing: boolean;
  onRestore: (kind: ArchiveKind, id: string) => void;
  onPurge: (kind: ArchiveKind, id: string, label: string) => void;
  onReload: () => void;
}) {
  if (!archive) return <div className="py-10 flex justify-center text-[#aaa]"><Loader2 size={20} className="animate-spin" /></div>;
  const rows: { kind: ArchiveKind; id: string; label: string; sub: string; deletedAt: string; thumb: string | null }[] = [
    ...archive.trips.map(t => ({ kind: 'trip' as const, id: t.id, label: t.title || t.zone_name || 'Chuyến không gắn KCN', sub: `Chuyến đi · ${fmtDateTime(t.started_at)} · ${fmtDistance(t.distance_m)}`, deletedAt: t.deleted_at, thumb: null })),
    ...archive.photos.map(p => ({ kind: 'photo' as const, id: p.id, label: p.company_name || 'Ảnh chỉ tiêu', sub: `Ảnh chỉ tiêu · ${fmtDateTime(p.taken_at)}${p.zone_name ? ` · ${p.zone_name}` : ''}`, deletedAt: p.deleted_at, thumb: p.thumb_url || p.url })),
    ...archive.voice.map(n => ({ kind: 'voice' as const, id: n.id, label: n.company_name || 'Ghi âm khảo sát', sub: `Ghi âm ${fmtClock(n.duration_s)} · ${fmtDateTime(n.recorded_at)}${n.zone_name ? ` · ${n.zone_name}` : ''}`, deletedAt: n.deleted_at, thumb: null })),
  ].sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
  return (
    <div className="space-y-2">
      <div className="rounded-lg bg-[#F7F7F5] border border-[#E8E7E2] text-[12px] text-[#555] px-3 py-2 leading-snug flex items-start gap-2">
        <Archive size={14} className="shrink-0 mt-0.5 text-[#888]" />
        <span className="flex-1">
          Chuyến / ảnh / ghi âm đã xoá nằm ở đây {ARCHIVE_DAYS} ngày — bấm <b>Khôi phục</b> để lấy lại. Quá {ARCHIVE_DAYS} ngày hệ thống <b>tự xoá hẳn</b> (khi có người mở tab này).
          {missing && <span className="block text-amber-700 mt-1">{ARCHIVE_MIGRATION_HINT}. Tự xoá sau {ARCHIVE_DAYS} ngày chỉ chạy sau khi chạy migration 195.</span>}
        </span>
        <button onClick={onReload} className="w-7 h-7 rounded-md hover:bg-black/5 flex items-center justify-center shrink-0" aria-label="Tải lại"><RefreshCw size={13} /></button>
      </div>
      {!rows.length ? <Empty icon={<Archive size={22} />} text="Lưu trữ trống" /> : (
        <div className={`${card} divide-y divide-[#F0EEE9] overflow-hidden`}>
          {rows.map(r => {
            const left = daysLeft(r.deletedAt);
            return (
              <div key={`${r.kind}:${r.id}`} className="flex items-center gap-2.5 px-3 py-2">
                <span className="w-10 h-10 rounded-lg bg-[#F2F2F0] overflow-hidden shrink-0 flex items-center justify-center text-[#888]">
                  {r.thumb ? <img src={r.thumb} alt="" loading="lazy" className="w-full h-full object-cover" /> : r.kind === 'trip' ? <Route size={16} /> : r.kind === 'voice' ? <Mic size={16} /> : <Camera size={16} />}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-[13px] font-medium text-[#111] truncate">{r.label}</span>
                  <span className="block text-[11px] text-[#888] truncate">{r.sub}</span>
                  <span className={`block text-[11px] ${left <= 3 ? 'text-red-600 font-medium' : 'text-[#999]'}`}>
                    Xoá {new Date(r.deletedAt).toLocaleDateString('vi-VN')} · {left > 0 ? `còn ${left} ngày rồi tự xoá hẳn` : 'sẽ xoá hẳn ở lần mở tab tới'}
                  </span>
                </span>
                <button onClick={() => onRestore(r.kind, r.id)} className="h-8 px-2.5 rounded-lg bg-[#0A84FF] text-white text-[12px] font-medium inline-flex items-center gap-1 shrink-0">
                  <RotateCcw size={12} /> Khôi phục
                </button>
                <button onClick={() => onPurge(r.kind, r.id, r.label)} title="Xoá hẳn ngay (không khôi phục được)"
                  className="h-8 w-8 rounded-lg border border-red-200 bg-red-50 text-red-600 inline-flex items-center justify-center shrink-0" aria-label="Xoá hẳn">
                  <Trash2 size={13} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Xuất PDF theo KCN ────────────────────────────────────────────────────────
function PdfDialog({ zone, trip, province, periodDays, trips, photos, voice, stars, say, onClose }: {
  zone: { id: string; name: string };
  /** có = PDF của riêng chuyến này */
  trip: SurveyTrip | null;
  province: string | null;
  periodDays: number;
  trips: SurveyTrip[];
  photos: SurveyPhoto[];
  voice: SurveyVoiceNote[];
  stars: SurveyStar[];
  say: (m: string) => void;
  onClose: () => void;
}) {
  const [images, setImages] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const run = async () => {
    setBusy('Đang chuẩn bị…');
    try {
      const to = trip ? new Date(trip.ended_at ?? trip.started_at) : new Date();
      const report = buildZoneReport({
        zoneName: zone.name, province, from: trip ? new Date(trip.started_at) : periodDays ? new Date(to.getTime() - periodDays * 86_400_000) : null, to, trips, photos, voice, stars,
        scope: trip ? { label: `chuyến ${fmtDateTime(trip.started_at)}`, periodText: tripPeriod(trip) } : null,
      });
      const { zoneReportPdf } = await import('../../lib/kcnSurvey/zonePdf');
      const blob = await zoneReportPdf(report, { images, onProgress: (d, n) => setBusy(images ? `Đang thêm ảnh ${d}/${n}…` : 'Đang tạo PDF…') });
      const slug = foldName(zone.name).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'kcn';
      const d0 = trip ? new Date(trip.started_at) : to;
      const day = `${d0.getFullYear()}-${String(d0.getMonth() + 1).padStart(2, '0')}-${String(d0.getDate()).padStart(2, '0')}`;
      const hm = `${String(d0.getHours()).padStart(2, '0')}${String(d0.getMinutes()).padStart(2, '0')}`;
      downloadBlob(blob, trip ? `khao-sat-${slug}-chuyen-${day}-${hm}.pdf` : `khao-sat-${slug}-${day}.pdf`);
      say('Đã tải PDF — đưa file này cho Gemini / ChatGPT để phân tích lương & nhu cầu tuyển dụng');
      onClose();
    } catch (e) {
      say('Không tạo được PDF: ' + (e as Error).message);
      setBusy(null);
    }
  };
  return (
    <div className="fixed inset-0 z-[1260] flex items-end md:items-center justify-center bg-black/30" onClick={busy ? undefined : onClose}>
      <div onClick={e => e.stopPropagation()} className="w-full md:w-[440px] bg-white rounded-t-2xl md:rounded-2xl shadow-2xl p-4 pb-[calc(16px+env(safe-area-inset-bottom))] space-y-3">
        <div className="flex items-start gap-2">
          <FileText size={20} className="text-[#0A84FF] shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="text-[15px] font-semibold text-[#111]">{trip ? `PDF chuyến khảo sát: ${zone.name}` : `Xuất PDF cả KCN: ${zone.name}`}</div>
            <div className="text-[12px] text-[#888]">
              {province ? `${province} · ` : ''}{trip ? tripPeriod(trip) : periodDays ? `${periodDays} ngày gần đây` : 'Toàn bộ thời gian'} · {photos.length} ảnh chỉ tiêu · {voice.length} ghi âm{trip ? '' : ` · ${trips.length} chuyến`}
            </div>
          </div>
          <button onClick={onClose} disabled={!!busy} className="w-8 h-8 rounded-full bg-[#F2F2F7] flex items-center justify-center text-[#555] disabled:opacity-40" aria-label="Đóng"><X size={15} /></button>
        </div>
        <div className="text-[12.5px] text-[#555] leading-snug">
          PDF chữ thật (copy / trích được), có đoạn mở đầu giải thích cho AI, bảng tổng hợp theo công ty, chi tiết từng bảng tuyển dụng (vị trí, số lượng, lương, ghi chú),
          ghi chú ghi âm, công ty đã đi ngang. Công ty gắn sao ghi nhãn [Chú trọng].
          {trip ? ' Chỉ gồm ảnh / ghi âm của chuyến này — muốn tổng cả KCN thì dùng nút PDF ở tab Theo KCN.' : ' Khoảng thời gian / người đi theo bộ lọc đang chọn; muốn riêng 1 chuyến thì mở chuyến ở tab Chuyến đi.'}
        </div>
        <label className="flex items-start gap-2 text-[13px] text-[#111]">
          <input type="checkbox" checked={images} onChange={e => setImages(e.target.checked)} className="mt-0.5 w-4 h-4 accent-[#0A84FF]" />
          <span>Kèm ảnh bảng tuyển dụng <span className="text-[#888]">(AI đọc được cả chữ trên ảnh; file nặng hơn ~0,2 MB / ảnh)</span></span>
        </label>
        <button onClick={() => void run()} disabled={!!busy || (!photos.length && !voice.length && !trips.length)}
          className="w-full h-11 rounded-full bg-[#0A84FF] text-white text-[14px] font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-50">
          {busy ? <><Loader2 size={16} className="animate-spin" /> {busy}</> : <><Download size={16} /> Tải PDF</>}
        </button>
      </div>
    </div>
  );
}

/** "04/11/2026 08:15 – 09:40" (chuyến chưa kết thúc thì chỉ giờ bắt đầu) */
function tripPeriod(t: SurveyTrip): string {
  const end = t.ended_at ? new Date(t.ended_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : null;
  return `${fmtDateTime(t.started_at)}${end ? ` – ${end}` : ' (chưa kết thúc)'}`;
}

function VoiceRow({ n, onOpen, showZone }: { n: SurveyVoiceNote; onOpen: () => void; showZone?: boolean }) {
  return (
    <button onClick={onOpen} className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-[#FAFAF8]">
      <span className="w-8 h-8 rounded-full bg-[#FF3B30] text-white flex items-center justify-center shrink-0"><Mic size={15} /></span>
      <span className="flex-1 min-w-0">
        <span className="block text-[13px] font-medium text-[#111] truncate">{n.company_name || 'Ghi âm khảo sát'}</span>
        <span className="block text-[11.5px] text-[#888] truncate">
          {fmtDateTime(n.recorded_at)}{showZone && n.zone_name ? ` · ${n.zone_name}` : ''}{n.user_name ? ` · ${n.user_name}` : ''}
        </span>
        {n.note && <span className="block text-[12px] text-[#444] line-clamp-2 mt-0.5">{n.note}</span>}
      </span>
      <span className="text-[12px] text-[#666] tabular-nums shrink-0">{fmtClock(n.duration_s)}</span>
    </button>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className={`${card} px-3 py-2`}>
      <div className="text-[11px] text-[#888]">{label}</div>
      <div className="text-[17px] font-semibold text-[#111] tabular-nums">{value}</div>
    </div>
  );
}

function LodgingRow({ l, onOpen, onMap }: { l: Lodging; onOpen: () => void; onMap: () => void }) {
  const cover = l.photos.find(p => p.kind === 'house') ?? l.photos[0];
  const near = l.routes[0];
  const digits = phoneDigits(l.landlord_phone);
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 hover:bg-[#F9F9F7]">
      <button onClick={onOpen} className="w-14 h-14 rounded-lg overflow-hidden bg-[#FFF4E5] text-[#FF9500] flex items-center justify-center shrink-0">
        {cover ? <img src={cover.thumb_url} alt="" loading="lazy" className="w-full h-full object-cover" /> : <Home size={22} />}
      </button>
      <button onClick={onOpen} className="min-w-0 flex-1 text-left">
        <div className="text-[13px] font-semibold text-[#111] truncate">{lodgingTitle(l)}</div>
        <div className="text-[11.5px] text-[#666] truncate">
          {[l.total_rooms != null && `${l.total_rooms} phòng`, l.vacant_rooms != null && `trống ${l.vacant_rooms}`, fmtRent(l.rent_min, l.rent_max), l.zone_name].filter(Boolean).join(' · ') || 'Chưa ghi số phòng / giá'}
        </div>
        {near && (
          <div className="text-[11.5px] text-[#0A5FCC] truncate inline-flex items-center gap-1">
            <Bike size={12} /> {near.name} · {fmtMin(near.moto_min)}{near.walk_min != null ? ` · đi bộ ${fmtMin(near.walk_min)}` : ''}
          </div>
        )}
      </button>
      {digits && <a href={`tel:${digits}`} title={`Gọi ${l.landlord_phone}`} className="w-9 h-9 rounded-full bg-[#E8F7EE] text-[#137333] flex items-center justify-center shrink-0"><Phone size={15} /></a>}
      {l.lat != null && <button onClick={onMap} title="Xem trên bản đồ" className="w-9 h-9 rounded-full bg-[#F3F2EE] text-[#555] flex items-center justify-center shrink-0"><MapPin size={15} /></button>}
    </div>
  );
}

function PanoCard({ p, onOpen }: { p: MapPanorama; onOpen: () => void }) {
  const thumb = panoThumb(p, 640, 240);
  return (
    <button onClick={onOpen} className={`${card} overflow-hidden text-left hover:shadow-md transition`}>
      <div className="relative h-28 bg-gradient-to-br from-[#0A84FF] to-[#5E5CE6] flex items-center justify-center text-white">
        {thumb ? <img src={thumb} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" /> : <Orbit size={34} className="opacity-80" />}
        <span className="absolute top-2 left-2 px-1.5 py-0.5 rounded-md bg-black/55 text-white text-[10.5px] font-bold">360°</span>
        {p.heading == null && <span className="absolute top-2 right-2 px-1.5 py-0.5 rounded-md bg-amber-400 text-[#111] text-[10.5px] font-semibold">Chưa căn hướng</span>}
      </div>
      <div className="px-3 py-2">
        <div className="text-[13px] font-semibold text-[#111] truncate">{p.title || 'Ảnh 360'}</div>
        <div className="text-[11.5px] text-[#888] truncate">{[p.zone_name, p.created_by, new Date(p.created_at).toLocaleDateString('vi-VN'), p.annotations.length ? `${p.annotations.length} đánh dấu` : ''].filter(Boolean).join(' · ')}</div>
      </div>
    </button>
  );
}

function Empty({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <div className={`${card} py-12 flex flex-col items-center gap-2 text-[#aaa]`}>
      {icon}
      <div className="text-[12.5px]">{text}</div>
    </div>
  );
}

function groupPassed(passed: SurveyTrip['passed']) {
  const by = new Map<SurveyStatus, SurveyTrip['passed']>();
  for (const p of passed) {
    const st = (STATUS_META[p.status] ? p.status : 'osm') as SurveyStatus;
    const list = by.get(st);
    if (list) list.push(p); else by.set(st, [p]);
  }
  return [...by.entries()].sort((a, b) => STATUS_META[a[0]].rank - STATUS_META[b[0]].rank).map(([status, items]) => ({ status, items }));
}

/** Kế hoạch ghé — nạp công ty trong hệ thống (khách hàng / Pipeline) chỉ khi mở hộp thoại, để tìm theo tên */
function PlanDialogWithData({ marketLeads, ...rest }: { marketLeads: readonly MarketLead[] } & Omit<ComponentProps<typeof SurveyPlanDialog>, 'companies'>) {
  const data = useSurveyData(marketLeads);
  return <SurveyPlanDialog {...rest} companies={data.companies} />;
}
