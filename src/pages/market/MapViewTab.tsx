import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import { Crosshair, Ruler, Layers, Tag, Settings, RotateCcw, X, Users, Database, Loader2, DollarSign, LocateFixed, Wrench, ChevronRight, ChevronLeft, Maximize2, Minimize2, BookmarkPlus, Route, Navigation, SlidersHorizontal } from 'lucide-react';
import { createPopulationLayer, createCommuneLayer, createDensityLegend } from './populationDensity';
import { fetchCommunes } from './populationData';
import type { CommuneRow } from './populationData';
import PopulationDataPanel from './PopulationDataPanel';
import SearchSelect from './SearchSelect';
import { fetchIndustries } from './industries';
import { supabase } from '../../lib/supabase';
import { latestLaborEntry } from '../../lib/format';
import { shortId } from '../../hooks/useHashSubRoute';
import { parseLatLngFromLink, nominatimGeocode, isValidVnLatLng, sleep, haversineKm } from '../../lib/geo';
import type { Branch, MarketLeadSupplier } from '../../lib/types';
import type { MarketTabProps } from './shared';
import { streetTiles } from '../../lib/mapTiles';
import KcnSurveyMode from './survey/KcnSurveyMode';
import { useLiveLocation } from './useLiveLocation';
import { readZoneSites } from '../../lib/pipelineZones';
import { MAP_GROUPS, MAP_GROUP_COLOR, DEFAULT_GROUP_ICONS, GROUP_ICONS_KEY, loadGroupIcons, DEFAULT_VIEW_KEY, loadDefaultView, SOUTH_VN_BOUNDS, type MapGroup, type SavedMapView } from '../../lib/mapGroups';
import { useLaborLite } from './sources/useLaborLite';
import { requestOpenSource } from './sources/context';
import { KIND_LABEL as LABOR_KIND_LABEL } from '../../lib/laborSources/types';
import { provinceKey, provinceLabel } from '../../lib/kcnSurvey/province';
import { googleDirectionsLinks, orderOpenPath, pathCost } from '../../lib/kcnSurvey/planStops';
import { routeMatrix } from '../../lib/kcnSurvey/planStopsApi';
import MeasurePanel, { type StopRow } from './MeasurePanel';
import { MAX_STOPS, MY_LOCATION, fmtDuration, fmtKm, getMyLocation, multiRoute, stopColor, stopLetter, type MultiRoute } from './measureRoute';
import { sourceInProvinceFilter } from '../../lib/laborSources/provinces';

// Nhóm/màu/icon dùng chung với bản đồ nhỏ trong hồ sơ công ty (src/lib/mapGroups.ts).
type Group = MapGroup;
const GROUPS = MAP_GROUPS;
const GROUP_COLOR = MAP_GROUP_COLOR;

interface MapPoint {
  id: string;
  group: Group;
  name: string;
  lat: number;
  lng: number;
  sub: string;
  mapLink: string | null;
  onOpen?: () => void;
  // Lương công ty + chi tiết theo từng NCC — chỉ có ở client/prospect/lead đã nhập lương.
  wage?: { min: number; max: number } | null;
  suppliers?: MarketLeadSupplier[];
}

// Bộ lọc/hiển thị bản đồ — nhớ theo máy (localStorage) để mở lại/F5 không phải chọn lại.
const MAP_PREFS_KEY = 'lgmap_prefs_v1';
interface MapPrefs {
  activeGroups: Group[];
  densityOn: boolean;
  wageLayerOn: boolean;
  satView: boolean;
  labelMode: 'auto' | 'always';
  provinceFilter: string;
  industryFilter: string;
}
const DEFAULT_PREFS: MapPrefs = {
  activeGroups: GROUPS.map(g => g.id),
  densityOn: false, wageLayerOn: false, satView: false, labelMode: 'auto',
  provinceFilter: 'all', industryFilter: 'all',
};
function loadMapPrefs(): MapPrefs {
  try {
    const raw = localStorage.getItem(MAP_PREFS_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const saved = { ...DEFAULT_PREFS, ...JSON.parse(raw) } as MapPrefs & { seenGroups?: Group[] };
    // Nhóm mới thêm sau lần lưu bộ lọc (VD "Nguồn LĐ" 09/11) → tự bật, không bị ẩn vì bộ lọc cũ
    const seen = saved.seenGroups ?? ['branch', 'kcn', 'client', 'prospect', 'lead'];
    const fresh = GROUPS.map(g => g.id).filter(id => !seen.includes(id) && !saved.activeGroups.includes(id));
    return fresh.length ? { ...saved, activeGroups: [...saved.activeGroups, ...fresh] } : saved;
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

const VN_CENTER: [number, number] = [16.05, 107.5];

// Zoom >= mức này thì hiện tên cố định cạnh marker (không cần click/hover).
const LABEL_ZOOM = 12;

// UPDATE toạ độ có kèm geocoded_at; nếu DB chưa chạy migration 094/095 (thiếu cột
// geocoded_at) thì tự lưu lại không kèm cột đó thay vì báo lỗi.
async function updateGeo(table: string, id: string, patch: Record<string, unknown>) {
  let { error } = await supabase.from(table).update(patch).eq('id', id);
  if (error && 'geocoded_at' in patch && /geocoded_at/.test(error.message)) {
    const { geocoded_at: _omit, ...rest } = patch;
    void _omit;
    ({ error } = await supabase.from(table).update(rest).eq('id', id));
  }
  return error;
}

// App chỉ load clients active — bản đồ cần cả prospect nên tự fetch riêng.
interface MapClient {
  id: string;
  name: string;
  client_type: 'prospect' | 'active';
  region: string | null;
  industrial_zones: string[] | null;
  current_workers: number | null;
  map_link: string | null;
  lat: number | null;
  lng: number | null;
  industry: string | null;
  wage_min: number | null;
  wage_max: number | null;
  market_suppliers: MarketLeadSupplier[] | null;
}

export default function MapViewTab({ marketZones, marketLeads, laborHistory, goTab, onRefresh, toast }: MarketTabProps) {
  const [prefsLoaded] = useState(() => loadMapPrefs());
  // Chế độ Khảo sát KCN (toàn màn hình) — đang có chuyến dở trên máy thì nút báo "Đang dở"
  const [surveyOpen, setSurveyOpen] = useState(false);
  const [surveyPending, setSurveyPending] = useState(() => hasPendingSurvey());
  const [branches, setBranches] = useState<Branch[]>([]);
  const [allClients, setAllClients] = useState<MapClient[]>([]);
  // Nhà máy theo KCN của công ty trong CRM Pipeline (crm_pipeline.zone_sites, migration 187) — mỗi nhà máy 1 ghim
  const [pipelineSites, setPipelineSites] = useState<{ key: string; company: string; clientId: string | null; zoneId: string; lat: number; lng: number; link: string | null }[]>([]);
  const [activeGroups, setActiveGroups] = useState<Group[]>(prefsLoaded.activeGroups);
  const [geoProgress, setGeoProgress] = useState<{ done: number; total: number; current: string } | null>(null);
  const [showMissing, setShowMissing] = useState(false);
  const [missingGroupFilter, setMissingGroupFilter] = useState<Group | 'all'>('all');
  const [showLabels, setShowLabels] = useState(false);
  const [labelMode, setLabelMode] = useState<'auto' | 'always'>(prefsLoaded.labelMode);
  const [satView, setSatView] = useState(prefsLoaded.satView);
  const [measureOn, setMeasureOn] = useState(false);
  const [groupIcons, setGroupIcons] = useState<Record<Group, string>>(() => loadGroupIcons());
  const [showIconSettings, setShowIconSettings] = useState(false);
  const [showToolsMenu, setShowToolsMenu] = useState(false);
  const [hasCustomDefaultView, setHasCustomDefaultView] = useState(() => !!loadDefaultView());
  const [nativeFs, setNativeFs] = useState(false);
  // iPhone Safari không có Fullscreen API cho thẻ div → "toàn màn hình" bằng CSS (phủ kín màn hình)
  const [cssFs, setCssFs] = useState(false);
  const isFullscreen = nativeFs || cssFs;
  // Bảng bộ lọc nổi khi toàn màn hình — mặc định ẩn, bật/tắt bằng nút bộ lọc
  const [panelOpen, setPanelOpen] = useState(false);
  useEffect(() => { if (!isFullscreen) setPanelOpen(false); }, [isFullscreen]);
  const [densityOn, setDensityOn] = useState(prefsLoaded.densityOn);
  const [wageLayerOn, setWageLayerOn] = useState(prefsLoaded.wageLayerOn);
  const [provinceFilter, setProvinceFilter] = useState(prefsLoaded.provinceFilter);
  const [industryFilter, setIndustryFilter] = useState(prefsLoaded.industryFilter);
  const [industries, setIndustries] = useState<string[]>([]);
  const [communeRows, setCommuneRows] = useState<CommuneRow[] | null>(null);
  const [communeLoading, setCommuneLoading] = useState(false);
  const [showPopulationPanel, setShowPopulationPanel] = useState(false);
  // Đo khoảng cách qua nhiều điểm (A → B → C …) — mỗi dòng 1 điểm dừng, kéo để đổi thứ tự (MeasurePanel)
  const stopSeq = useRef(2);
  const [stops, setStops] = useState<StopRow[]>([{ key: 1, id: '' }, { key: 2, id: '' }]);
  const [myPos, setMyPos] = useState<{ lat: number; lng: number; acc: number; at: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [linkInputs, setLinkInputs] = useState<Record<string, string>>({});
  const [savingLink, setSavingLink] = useState<string | null>(null);
  const [routeInfo, setRouteInfo] = useState<MultiRoute | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const mapDivRef = useRef<HTMLDivElement>(null);
  const mapWrapperRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const clusterRef = useRef<L.MarkerClusterGroup | null>(null);
  const osmLayerRef = useRef<L.LayerGroup | null>(null);
  const satLayerRef = useRef<L.TileLayer | null>(null);
  const boundaryLayerRef = useRef<L.TileLayer | null>(null);
  const densityLayerRef = useRef<L.Layer | null>(null);
  const densityLegendRef = useRef<L.Control | null>(null);

  const loadBranches = async () => {
    const { data, error } = await supabase.from('branches').select('*');
    if (error) toast('Lỗi tải chi nhánh: ' + error.message);
    setBranches((data as Branch[]) ?? []);
  };

  const loadMapClients = async () => {
    // current_workers KHÔNG phải cột thật trong bảng clients — nó được tính từ dòng mới nhất
    // của client_labor_history (giống cách useAppData làm), nên phải fetch riêng rồi ghép vào.
    // industry/wage_min/wage_max/market_suppliers chỉ có nếu đã chạy migration 100 — thiếu
    // thì fallback về các cột cơ bản thay vì lỗi trắng cả danh sách khách hàng trên bản đồ.
    let { data, error } = await supabase.from('clients')
      .select('id, name, client_type, region, industrial_zones, map_link, lat, lng, industry, wage_min, wage_max, market_suppliers')
      .is('archived_at', null);
    if (error) {
      ({ data, error } = await supabase.from('clients')
        .select('id, name, client_type, region, industrial_zones, map_link, lat, lng')
        .is('archived_at', null));
    }
    if (error) { toast('Lỗi tải khách hàng: ' + error.message); return; }
    const rows = ((data ?? []) as Omit<MapClient, 'current_workers'>[]).map(c => ({ ...c, current_workers: null as number | null }));
    const ids = rows.map(c => c.id);
    if (ids.length) {
      const { data: laborData, error: laborErr } = await supabase.from('client_labor_history')
        .select('client_id, week_label, count, created_at').in('client_id', ids).order('created_at', { ascending: true });
      if (!laborErr && laborData) {
        const byClient = new Map<string, { week_label: string; count: number; created_at: string }[]>();
        laborData.forEach(h => (byClient.get(h.client_id) ?? byClient.set(h.client_id, []).get(h.client_id)!).push(h));
        rows.forEach(c => { c.current_workers = latestLaborEntry(byClient.get(c.id) ?? [])?.count ?? null; });
      }
    }
    setAllClients(rows);
  };

  const loadPipelineSites = async () => {
    const { data, error } = await supabase.from('crm_pipeline').select('id, company_name, client_id, zone_sites');
    if (error) return; // chưa chạy migration 187 → không có ghim nhà máy
    const rows: typeof pipelineSites = [];
    for (const r of (data ?? []) as { id: string; company_name: string; client_id: string | null; zone_sites: unknown }[]) {
      for (const [zoneId, site] of Object.entries(readZoneSites(r.zone_sites))) {
        const pos = site.lat != null && site.lng != null ? { lat: site.lat, lng: site.lng } : parseLatLngFromLink(site.map_link);
        if (!pos || !isValidVnLatLng(pos)) continue;
        rows.push({ key: `${r.id}:${zoneId}`, company: r.company_name, clientId: r.client_id, zoneId, lat: pos.lat, lng: pos.lng, link: site.map_link });
      }
    }
    setPipelineSites(rows);
  };

  const loadCommunes = async () => {
    setCommuneLoading(true);
    try {
      setCommuneRows(await fetchCommunes());
    } catch (e) {
      // Bảng population_communes có thể chưa chạy migration 098 trên DB — coi như chưa có dữ liệu.
      setCommuneRows([]);
      toast('Chưa tải được dữ liệu xã/phường: ' + (e as Error).message);
    }
    setCommuneLoading(false);
  };

  useEffect(() => {
    loadBranches();
    loadMapClients();
    void loadPipelineSites();
    fetchIndustries([...marketLeads.map(l => l.industry)]).then(setIndustries);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Nhớ bộ lọc/hiển thị theo máy — F5 hoặc vào lại vẫn giữ nguyên lựa chọn.
  useEffect(() => {
    const prefs: MapPrefs & { seenGroups: Group[] } = { activeGroups, densityOn, wageLayerOn, satView, labelMode, provinceFilter, industryFilter, seenGroups: GROUPS.map(g => g.id) };
    localStorage.setItem(MAP_PREFS_KEY, JSON.stringify(prefs));
  }, [activeGroups, densityOn, wageLayerOn, satView, labelMode, provinceFilter, industryFilter]);

  // Tỉnh/TP suy ra từ tên KCN (marketZones.location), giống cách làm ở tab Lương TT / Công ty-Dự án.
  const zoneToProvince = useMemo(() => {
    const map: Record<string, string> = {};
    marketZones.forEach(z => { if (z.location) map[z.name] = z.location; });
    return map;
  }, [marketZones]);
  // Nguồn LĐ: đơn vị nguồn + KCN gần nhất của từng đơn vị (theo đường xe khách đã tính ở tab Nguồn LĐ)
  const labor = useLaborLite();
  const provinces = useMemo(() => {
    const list = [...new Set([...marketZones.map(z => z.location), ...branches.map(b => b.location)].filter(Boolean) as string[])];
    // Tỉnh của trường chưa có KCN / chi nhánh nào (VD Cần Thơ, Đồng Tháp) → vẫn chọn được để lọc
    const have = new Set(list.map(provinceKey));
    for (const s of labor.sources) {
      const k = provinceKey(s.province);
      if (k && !have.has(k)) { have.add(k); list.push(provinceLabel(s.province)); }
    }
    return list.sort((a, b) => a.localeCompare(b, 'vi'));
  }, [marketZones, branches, labor.sources]);
  const matchesProvinceFilter = (region: string | null | undefined, zones: string[] | undefined) => {
    if (provinceFilter === 'all') return true;
    if (region && (zoneToProvince[region] === provinceFilter || region === provinceFilter)) return true;
    if (zones?.some(z => zoneToProvince[z] === provinceFilter)) return true;
    return false;
  };
  const matchesIndustryFilter = (industry: string | null | undefined) => industryFilter === 'all' || industry === industryFilter;

  const laborNearZone = useMemo(() => {
    const zoneName = new Map(marketZones.map(z => [z.id, z.name]));
    const m = new Map<string, { zone: string; min: number }>();
    for (const r of labor.routes) {
      if (r.target_type !== 'zone' || r.duration_min == null || !zoneName.has(r.target_id)) continue;
      const cur = m.get(r.source_id);
      if (!cur || r.duration_min < cur.min) m.set(r.source_id, { zone: zoneName.get(r.target_id)!, min: r.duration_min });
    }
    return m;
  }, [labor.routes, marketZones]);

  const points = useMemo<MapPoint[]>(() => {
    const pts: MapPoint[] = [];
    branches.forEach(b => {
      if (b.lat == null || b.lng == null) return;
      if (provinceFilter !== 'all' && b.location !== provinceFilter) return;
      pts.push({
        id: b.id, group: 'branch', name: b.short_name || b.name, lat: b.lat, lng: b.lng,
        sub: [b.manager_name && `QL: ${b.manager_name}`, b.address].filter(Boolean).join(' · '),
        mapLink: b.map_link,
        onOpen: () => { window.location.hash = `#/branches/${shortId(b.id)}`; },
      });
    });
    marketZones.forEach(z => {
      if (z.lat == null || z.lng == null) return;
      if (provinceFilter !== 'all' && z.location !== provinceFilter) return;
      pts.push({
        id: z.id, group: 'kcn', name: z.name, lat: z.lat, lng: z.lng,
        sub: [z.location, z.total_workers != null && `${z.total_workers.toLocaleString('vi-VN')} LĐ`, `${z.lgv_clients} KH LGV`].filter(Boolean).join(' · '),
        mapLink: z.map_link ?? null,
        onOpen: () => goTab('zones'),
      });
    });
    allClients.forEach(c => {
      if (c.lat == null || c.lng == null) return;
      if (!matchesProvinceFilter(c.region, c.industrial_zones ?? undefined)) return;
      if (!matchesIndustryFilter(c.industry)) return;
      pts.push({
        id: c.id, group: c.client_type === 'active' ? 'client' : 'prospect', name: c.name, lat: c.lat, lng: c.lng,
        sub: [(c.industrial_zones ?? [])[0], c.region, c.current_workers ? `${c.current_workers} LĐ` : null].filter(Boolean).join(' · '),
        mapLink: c.map_link ?? null,
        onOpen: () => { window.location.hash = `#/client-detail/${shortId(c.id)}`; },
        wage: c.wage_min != null && c.wage_max != null ? { min: c.wage_min, max: c.wage_max } : null,
        suppliers: c.market_suppliers ?? [],
      });
    });
    pipelineSites.forEach(ps => {
      const zone = marketZones.find(z => z.id === ps.zoneId);
      const client = ps.clientId ? allClients.find(c => c.id === ps.clientId) : null;
      if (!matchesProvinceFilter(null, zone ? [zone.name] : undefined) && !(zone && provinceFilter !== 'all' && zone.location === provinceFilter)) return;
      if (!matchesIndustryFilter(client?.industry)) return;
      pts.push({
        id: `site:${ps.key}`, group: client?.client_type === 'active' ? 'client' : 'prospect',
        name: zone ? `${ps.company} (${zone.name})` : ps.company, lat: ps.lat, lng: ps.lng,
        sub: ['Nhà máy', zone?.name].filter(Boolean).join(' · '),
        mapLink: ps.link,
        onOpen: ps.clientId ? () => { window.location.hash = `#/client-detail/${shortId(ps.clientId!)}`; } : undefined,
      });
    });
    // Nguồn LĐ (trường / trung tâm / địa phương) — kèm KCN gần nhất theo giờ xe khách đã tính
    labor.sources.forEach(s => {
      // Chưa lưu toạ độ nhưng có link Google Maps dài → đọc thẳng từ link (link rút gọn thì cần mở hồ sơ lưu lại)
      const pos = s.lat != null && s.lng != null ? { lat: s.lat, lng: s.lng } : parseLatLngFromLink(s.map_link);
      if (!pos || !isValidVnLatLng(pos)) return;
      // So tỉnh theo khoá chuẩn ("TP. Hồ Chí Minh" = "Hồ Chí Minh"); trường chưa ghi tỉnh vẫn hiện, không bị loại âm thầm
      if (!sourceInProvinceFilter(s.province, provinceFilter)) return;
      const near = laborNearZone.get(s.id);
      pts.push({
        id: s.id, group: 'source', name: s.short_name || s.name, lat: pos.lat, lng: pos.lng,
        sub: [LABOR_KIND_LABEL[s.kind], s.province.trim() || 'Chưa ghi tỉnh', near ? `Gần ${near.zone} · xe khách ${Math.round(near.min)} phút` : null].filter(Boolean).join(' · '),
        mapLink: s.map_link?.trim() || null,
        onOpen: () => requestOpenSource(s.id),
      });
    });
    marketLeads.forEach(l => {
      if (l.lat == null || l.lng == null) return;
      if (!matchesProvinceFilter(l.region, undefined)) return;
      if (!matchesIndustryFilter(l.industry)) return;
      pts.push({
        id: l.id, group: 'lead', name: l.company_name, lat: l.lat, lng: l.lng,
        sub: [l.region, l.industry, l.workers_needed ? `Nhu cầu ${l.workers_needed} LĐ` : null, l.status].filter(Boolean).join(' · '),
        mapLink: l.map_link ?? null,
        onOpen: () => goTab('leads'),
        wage: l.wage_min != null && l.wage_max != null ? { min: l.wage_min, max: l.wage_max } : null,
        suppliers: l.suppliers,
      });
    });
    return pts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branches, marketZones, marketLeads, allClients, pipelineSites, goTab, provinceFilter, industryFilter, zoneToProvince, labor, laborNearZone]);

  // Bản ghi thiếu link Google Maps HOẶC thiếu toạ độ — cả hai đều cần bổ sung.
  const missingList = useMemo(() => {
    const rows: { table: string; id: string; name: string; group: Group; link: string | null; hasCoords: boolean }[] = [
      ...branches.map(b => ({ table: 'branches', id: b.id, name: b.name, group: 'branch' as Group, link: b.map_link, hasCoords: b.lat != null && b.lng != null })),
      ...marketZones.map(z => ({ table: 'market_zones', id: z.id, name: z.name, group: 'kcn' as Group, link: z.map_link ?? null, hasCoords: z.lat != null && z.lng != null })),
      ...allClients.map(c => ({ table: 'clients', id: c.id, name: c.name, group: (c.client_type === 'active' ? 'client' : 'prospect') as Group, link: c.map_link ?? null, hasCoords: c.lat != null && c.lng != null })),
      ...marketLeads.map(l => ({ table: 'market_leads', id: l.id, name: l.company_name, group: 'lead' as Group, link: l.map_link ?? null, hasCoords: l.lat != null && l.lng != null })),
    ];
    return rows.filter(r => !r.link?.trim() || !r.hasCoords);
  }, [branches, marketZones, marketLeads, allClients]);

  const missingCoordsCount = useMemo(() => missingList.filter(m => !m.hasCoords).length, [missingList]);
  const missingShown = useMemo(
    () => missingGroupFilter === 'all' ? missingList : missingList.filter(m => m.group === missingGroupFilter),
    [missingList, missingGroupFilter],
  );

  // Khởi tạo map một lần
  useEffect(() => {
    if (!mapDivRef.current || mapRef.current) return;
    const map = L.map(mapDivRef.current, { center: VN_CENTER, zoom: 6, scrollWheelZoom: true });
    const savedView = loadDefaultView();
    if (savedView) map.setView(savedView.center, savedView.zoom);
    else map.fitBounds(SOUTH_VN_BOUNDS);
    // Nền đường phố: OSM bị chặn ở một số mạng → tự chuyển nguồn dự phòng (lib/mapTiles)
    osmLayerRef.current = streetTiles().addTo(map);
    // Lớp vệ tinh + ranh giới/địa danh (Esri) — chỉ add khi bật «Vệ tinh + ranh giới».
    satLayerRef.current = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      { maxZoom: 19, attribution: 'Tiles &copy; Esri' },
    );
    boundaryLayerRef.current = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
      { maxZoom: 19, attribution: 'Labels &copy; Esri' },
    );
    const cluster = L.markerClusterGroup({
      maxClusterRadius: 45,
      disableClusteringAtZoom: LABEL_ZOOM,
      iconCreateFunction: c => L.divIcon({
        className: 'lgmap-cluster',
        html: `<div>${c.getChildCount()}</div>`,
        iconSize: [34, 34],
        iconAnchor: [17, 17],
      }),
    });
    map.addLayer(cluster);
    // Bật/tắt nhãn tên theo mức zoom — chỉ setState khi vượt ngưỡng để tránh vẽ lại thừa.
    map.on('zoomend', () => setShowLabels(map.getZoom() >= LABEL_ZOOM));
    mapRef.current = map;
    clusterRef.current = cluster;
    return () => { map.remove(); mapRef.current = null; clusterRef.current = null; };
  }, []);

  // Mở từ hồ sơ Nguồn LĐ ("Xem trên Bản đồ") → phóng tới điểm đó, bật nhóm Nguồn LĐ
  useEffect(() => {
    let req: { lat?: number; lng?: number; zoom?: number; group?: Group } | null = null;
    try { req = JSON.parse(sessionStorage.getItem('lgmap_focus') || 'null'); sessionStorage.removeItem('lgmap_focus'); } catch { req = null; }
    if (!req || typeof req.lat !== 'number' || typeof req.lng !== 'number') return;
    const g = req.group;
    if (g && GROUPS.some(x => x.id === g)) setActiveGroups(list => (list.includes(g) ? list : [...list, g]));
    // Mở từ hồ sơ để xem 1 điểm cụ thể → bỏ lọc tỉnh / ngành kẻo điểm đó bị ẩn
    if (g) { setProvinceFilter('all'); setIndustryFilter('all'); }
    mapRef.current?.setView([req.lat, req.lng], req.zoom ?? 13);
  }, []);

  // Vẽ lại marker khi dữ liệu / filter đổi
  useEffect(() => {
    const cluster = clusterRef.current;
    const map = mapRef.current;
    if (!cluster || !map) return;
    cluster.clearLayers();
    const shown = points.filter(p => activeGroups.includes(p.group));
    shown.forEach(p => {
      const color = GROUP_COLOR[p.group];
      const glyph = groupIcons[p.group]?.trim();
      const icon = L.divIcon({
        className: 'lgmap-marker',
        html: `<span class="lgmap-pin${glyph ? ' lgmap-pin-has-icon' : ''}" style="background:${color}">${glyph ? `<span class="lgmap-pin-icon">${escapeHtml(glyph)}</span>` : ''}</span>`,
        iconSize: [26, 34],
        iconAnchor: [13, 32],
        popupAnchor: [0, -30],
      });
      const marker = L.marker([p.lat, p.lng], { icon });
      const labelsOn = labelMode === 'always' || showLabels;
      const wageLabel = wageLayerOn && p.wage ? ` · 💰${wageFmt(p.wage.min, p.wage.max)}` : '';
      marker.bindTooltip(escapeHtml(p.name) + escapeHtml(wageLabel), {
        direction: 'top',
        offset: [0, -30],
        className: 'lgmap-tooltip',
        permanent: labelsOn || (wageLayerOn && !!p.wage),
        opacity: labelsOn ? 0.95 : 1,
      });
      const el = document.createElement('div');
      el.className = 'lgmap-popup';
      el.innerHTML = `
        <div class="lgmap-popup-title" style="color:${color}">${escapeHtml(p.name)}</div>
        ${p.sub ? `<div class="lgmap-popup-sub">${escapeHtml(p.sub)}</div>` : ''}
        ${wageLayerOn && p.wage ? `
          <div class="lgmap-popup-wage">💰 Lương chung: <b>${escapeHtml(wageFmt(p.wage.min, p.wage.max)!)}</b></div>
          ${p.suppliers?.length ? `<div class="lgmap-popup-suppliers">${p.suppliers.map(s => `
            <div class="lgmap-popup-supplier-row">
              <span>${s.is_us ? '● ' : ''}${escapeHtml(s.name)}</span>
              <span>${s.wage_min != null && s.wage_max != null ? escapeHtml(wageFmt(s.wage_min, s.wage_max)!) : '—'}</span>
            </div>`).join('')}</div>` : ''}
        ` : ''}`;
      const row = document.createElement('div');
      row.className = 'lgmap-popup-actions';
      if (p.onOpen) {
        const btn = document.createElement('button');
        btn.textContent = 'Mở hồ sơ';
        btn.onclick = p.onOpen;
        row.appendChild(btn);
      }
      if (wageLayerOn && (p.wage || p.suppliers?.length)) {
        const btn = document.createElement('button');
        btn.textContent = 'Sửa lương NCC';
        btn.onclick = () => goTab('leads');
        row.appendChild(btn);
      }
      if (p.mapLink) {
        const a = document.createElement('a');
        a.textContent = 'Google Maps';
        a.href = p.mapLink;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        row.appendChild(a);
      }
      el.appendChild(row);
      marker.bindPopup(el, { closeButton: true, minWidth: 180 });
      cluster.addLayer(marker);
    });
  }, [points, activeGroups, showLabels, labelMode, groupIcons, wageLayerOn]);

  const setGroupIcon = (g: Group, value: string) => {
    setGroupIcons(prev => {
      const next = { ...prev, [g]: value };
      localStorage.setItem(GROUP_ICONS_KEY, JSON.stringify(next));
      return next;
    });
  };
  const resetGroupIcons = () => {
    setGroupIcons({ ...DEFAULT_GROUP_ICONS });
    localStorage.removeItem(GROUP_ICONS_KEY);
  };

  // Lưu khung nhìn hiện tại (tâm + zoom) làm mặc định mỗi lần mở lại Bản đồ.
  const saveCurrentViewAsDefault = () => {
    const map = mapRef.current;
    if (!map) return;
    const c = map.getCenter();
    const view: SavedMapView = { center: [c.lat, c.lng], zoom: map.getZoom() };
    localStorage.setItem(DEFAULT_VIEW_KEY, JSON.stringify(view));
    setHasCustomDefaultView(true);
    toast('Đã đặt khung nhìn hiện tại làm mặc định');
  };
  const resetDefaultView = () => {
    localStorage.removeItem(DEFAULT_VIEW_KEY);
    setHasCustomDefaultView(false);
    mapRef.current?.fitBounds(SOUTH_VN_BOUNDS);
    toast('Đã khôi phục khung nhìn mặc định gốc (miền Nam)');
  };

  // Bật/tắt nền vệ tinh + lớp ranh giới/địa danh
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !osmLayerRef.current || !satLayerRef.current || !boundaryLayerRef.current) return;
    if (satView) {
      map.removeLayer(osmLayerRef.current);
      satLayerRef.current.addTo(map);
      boundaryLayerRef.current.addTo(map);
    } else {
      map.removeLayer(satLayerRef.current);
      map.removeLayer(boundaryLayerRef.current);
      osmLayerRef.current.addTo(map);
    }
  }, [satView]);

  // Bật lớp mật độ dân số thì tải dữ liệu Xã/Phường thật từ DB (population_communes).
  useEffect(() => {
    if (densityOn && communeRows == null) loadCommunes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [densityOn]);

  // Vẽ lớp mật độ dân số + legend. Ưu tiên dữ liệu Xã/Phường thật đã nhập; nếu chưa có
  // dòng nào thì tạm hiện dữ liệu demo cấp Quận/Huyện cũ (chỉ để minh hoạ tính năng).
  // Polygon/marker ở overlayPane (z-index 400) luôn nằm dưới marker (markerPane 600).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !densityOn || communeLoading) return;
    const hasRealData = communeRows != null && communeRows.length > 0;
    const layer = (hasRealData ? createCommuneLayer(communeRows!) : createPopulationLayer()).addTo(map);
    const legend = createDensityLegend(
      hasRealData ? 'Dữ liệu Xã/Phường đã nhập' : 'Chưa có dữ liệu Xã/Phường — đang hiện demo cấp Quận/Huyện cũ',
    ).addTo(map);
    densityLayerRef.current = layer;
    densityLegendRef.current = legend;
    return () => {
      layer.remove();
      legend.remove();
      densityLayerRef.current = null;
      densityLegendRef.current = null;
    };
  }, [densityOn, communeRows, communeLoading]);

  // ── Đo khoảng cách qua nhiều điểm ──────────────────────────────────────────
  // Đường xe máy thật (Valhalla) là chính, ô tô (OSRM) dự phòng, đường chim bay là phụ.
  const newStop = (id = ''): StopRow => ({ key: ++stopSeq.current, id });
  const freshStops = () => [newStop(), newStop()];

  // Vị trí hiện tại lấy 1 lần (không bám theo); lỗi khi chưa có vị trí nào → bỏ «Vị trí hiện tại» khỏi lộ trình
  const locateMe = async () => {
    if (locating) return;
    setLocating(true);
    try {
      const p = await getMyLocation();
      setMyPos({ ...p, at: Date.now() });
    } catch (e) {
      toast('Không lấy được vị trí: ' + (e as Error).message);
      if (!myPos) setStops(rs => rs.map(r => (r.id === MY_LOCATION ? { key: r.key, id: '' } : r)));
    } finally {
      setLocating(false);
    }
  };
  // Đổi danh sách điểm: vừa thêm «Vị trí hiện tại» mà chưa có / đã cũ (> 2 phút) → lấy lại
  const changeStops = (next: StopRow[]) => {
    setStops(next);
    const addedMe = next.some(r => r.id === MY_LOCATION) && !stops.some(r => r.id === MY_LOCATION);
    if (addedMe && (!myPos || Date.now() - myPos.at > 120_000)) void locateMe();
  };
  const pickStop = (i: number, id: string) => {
    const pt = points.find(p => p.id === id);
    const row: StopRow = pt
      ? { key: stops[i].key, id, label: stopOptLabel(pt), name: pt.name, lat: pt.lat, lng: pt.lng }
      : { key: stops[i].key, id };
    changeStops(stops.map((r, k) => (k === i ? row : r)));
  };
  const startFromMe = () => {
    if (!stops[0].id) changeStops([{ key: stops[0].key, id: MY_LOCATION }, ...stops.slice(1)]);
    else if (stops.length < MAX_STOPS) changeStops([newStop(MY_LOCATION), ...stops]);
    else toast(`Tối đa ${MAX_STOPS} điểm — bỏ bớt 1 điểm trước`);
  };
  const addStop = () => { if (stops.length < MAX_STOPS) setStops([...stops, newStop()]); };

  // Điểm đã có toạ độ (bỏ dòng trống / vị trí chưa lấy được), giữ chỉ số dòng để ghép chữ cái A, B, C…
  const resolvedStops = useMemo(() => stops.map((r, idx) => {
    if (!measureOn || !r.id) return null;
    if (r.id === MY_LOCATION) return myPos ? { idx, id: r.id, name: 'Vị trí của bạn', lat: myPos.lat, lng: myPos.lng } : null;
    const live = points.find(p => p.id === r.id);
    if (live) return { idx, id: r.id, name: live.name, lat: live.lat, lng: live.lng };
    return r.lat != null && r.lng != null ? { idx, id: r.id, name: r.name ?? '', lat: r.lat, lng: r.lng } : null;
  }), [measureOn, stops, myPos, points]);
  const filledStops = useMemo(() => resolvedStops.filter((x): x is NonNullable<typeof x> => !!x), [resolvedStops]);
  const routeKey = filledStops.length >= 2 ? filledStops.map(f => `${f.lat.toFixed(6)},${f.lng.toFixed(6)}`).join(';') : '';
  const straightKm = filledStops.length >= 2
    ? filledStops.slice(1).reduce((s, f, k) => s + haversineKm(filledStops[k], f), 0) : null;

  useEffect(() => {
    setRouteInfo(null);
    if (!routeKey) { setRouteLoading(false); return; }
    const pts = routeKey.split(';').map(s => { const [lat, lng] = s.split(',').map(Number); return { lat, lng }; });
    const ctrl = new AbortController();
    setRouteLoading(true);
    multiRoute(pts, ctrl.signal)
      .then(r => { if (!ctrl.signal.aborted) setRouteInfo(r); })
      .finally(() => { if (!ctrl.signal.aborted) setRouteLoading(false); });
    return () => ctrl.abort();
  }, [routeKey]);

  // Chặng giữa 2 điểm liền nhau — hiện dưới dòng điểm đi (đường thật nếu có, không thì chim bay)
  const legsByRow = useMemo(() => {
    const m = new Map<number, { km: number; sec: number | null }>();
    if (routeLoading) return m;
    for (let k = 0; k < filledStops.length - 1; k++) {
      const leg = routeInfo?.legs[k];
      m.set(filledStops[k].idx, leg ? { km: leg.km, sec: leg.sec } : { km: haversineKm(filledStops[k], filledStops[k + 1]), sec: null });
    }
    return m;
  }, [filledStops, routeInfo, routeLoading]);

  // Vẽ: đường chim bay (nét đứt) + đường đi thật (xanh) + ghim chữ cái A, B, C…
  const drawSig = filledStops.map(f => `${f.idx}:${f.lat},${f.lng}:${f.name}`).join('|') + `#${stops.length}`;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !filledStops.length) return;
    const group = L.layerGroup().addTo(map);
    if (filledStops.length >= 2) {
      const straight = L.polyline(filledStops.map(f => [f.lat, f.lng] as [number, number]),
        { color: '#DC2626', weight: 2, dashArray: '6 6', opacity: routeInfo ? 0.45 : 1 }).addTo(group);
      if (!routeInfo && !routeLoading && straightKm != null) {
        straight.bindTooltip(`≈ ${fmtKm(straightKm)} km (chim bay)`, { permanent: true, direction: 'center', className: 'lgmap-distance lgmap-distance-alt' });
      }
    }
    if (routeInfo) {
      const perLeg = routeInfo.lines.length === routeInfo.legs.length && routeInfo.legs.length > 1;
      routeInfo.lines.forEach((ln, k) => {
        const line = L.polyline(ln, { color: '#1D4ED8', weight: 5, opacity: 0.85 }).addTo(group);
        const text = perLeg
          ? `${fmtKm(routeInfo.legs[k].km)} km`
          : `${fmtKm(routeInfo.km)} km · ${fmtDuration(routeInfo.sec)} ${routeInfo.mode === 'car' ? 'ô tô' : 'xe máy'}`;
        line.bindTooltip(text, { permanent: true, direction: 'center', className: 'lgmap-distance' });
      });
    }
    filledStops.forEach(f => {
      const letter = stopLetter(f.idx);
      L.marker([f.lat, f.lng], {
        icon: L.divIcon({
          className: '',
          html: `<div style="width:26px;height:26px;border-radius:50%;background:${stopColor(f.idx, stops.length)};color:#fff;font:700 12px/22px system-ui,sans-serif;text-align:center;border:2px solid #fff;box-shadow:0 1px 5px rgba(0,0,0,.4)">${letter}</div>`,
          iconSize: [26, 26], iconAnchor: [13, 13],
        }),
        zIndexOffset: 1500, keyboard: false,
      }).bindTooltip(escapeHtml(`${letter} · ${f.name}`), { direction: 'top', offset: [0, -12] }).addTo(group);
    });
    return () => { group.remove(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawSig, routeInfo, routeLoading]);

  // Phóng vừa lộ trình khi đổi điểm / có đường đi thật
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !routeKey) return;
    const pts: [number, number][] = routeInfo ? routeInfo.lines.flat() : filledStops.map(f => [f.lat, f.lng]);
    if (pts.length) map.fitBounds(L.latLngBounds(pts).pad(0.25), { maxZoom: 14 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeKey, routeInfo]);

  // Sắp thứ tự đi nhanh nhất: giữ điểm A, các điểm sau xếp theo ma trận thời gian xe máy thật (Valhalla)
  const optimizeStops = async () => {
    const withPts = stops.map((r, i) => ({ r, p: resolvedStops[i] })).filter(x => !!x.p);
    if (withPts.length < 3 || optimizing) return;
    setOptimizing(true);
    try {
      const m = await routeMatrix(withPts.map(x => ({ lat: x.p!.lat, lng: x.p!.lng })));
      const order = orderOpenPath(withPts.length, (i, j) => m.sec[i][j], 0);
      const same = order.every((k, i) => k === i);
      if (same) { toast('Thứ tự hiện tại đã là nhanh nhất'); return; }
      const kmCost = (i: number, j: number) => m.km[i][j];
      const before = pathCost(withPts.map((_, i) => i), kmCost), after = pathCost(order, kmCost);
      const rest = stops.filter((_, i) => !resolvedStops[i]);
      setStops([...order.map(k => withPts[k].r), ...rest]);
      toast(`Đã sắp lại, giữ điểm xuất phát: ${fmtKm(before)} → ${fmtKm(after)} km${m.engine === 'estimate' ? ' (ước tính theo chim bay)' : ''}`);
    } finally {
      setOptimizing(false);
    }
  };

  // Mở chỉ đường Google Maps theo đúng thứ tự (xuất phát từ vị trí hiện tại → để Google tự lấy GPS)
  const googleLink = useMemo(() => {
    if (filledStops.length < 2) return null;
    const [first, ...rest] = filledStops;
    const origin = first.id === MY_LOCATION ? null : { lat: first.lat, lng: first.lng };
    return googleDirectionsLinks(origin, rest.map(f => ({ lat: f.lat, lng: f.lng })))[0] ?? null;
  }, [filledStops]);

  const pointOptions = useMemo(
    () => points.map(p => ({ value: p.id, label: stopOptLabel(p) })),
    [points],
  );
  // Nhãn ngắn — ô chọn trên điện thoại chỉ rộng ~100px
  const meLabel = locating ? '📍 Đang lấy GPS…'
    : myPos ? `📍 Vị trí của tôi ±${Math.max(1, Math.round(myPos.acc))}m` : '📍 Vị trí hiện tại của tôi';
  const optionsFor = (i: number) => {
    const cur = stops[i];
    const neighbors = new Set([stops[i - 1]?.id, stops[i + 1]?.id].filter(id => id && id !== cur.id));
    const opts = neighbors.size ? pointOptions.filter(o => !neighbors.has(o.value)) : pointOptions.slice();
    // Điểm đã chọn nhưng đang bị bộ lọc tỉnh / ngành ẩn → vẫn hiện đúng tên
    if (cur.id && cur.id !== MY_LOCATION && cur.label && !opts.some(o => o.value === cur.id)) opts.unshift({ value: cur.id, label: cur.label });
    const meElsewhere = stops.some((r, j) => j !== i && r.id === MY_LOCATION);
    return meElsewhere ? opts : [{ value: MY_LOCATION, label: meLabel }, ...opts];
  };

  // Dán link Google Maps: parse được toạ độ thì lưu link + lat/lng; link ngắn (goo.gl)
  // không chứa toạ độ thì vẫn lưu link nếu bản ghi đã có toạ độ sẵn.
  const saveLink = async (table: string, id: string, hasCoords: boolean) => {
    const link = (linkInputs[id] ?? '').trim();
    const pos = parseLatLngFromLink(link);
    const parsed = isValidVnLatLng(pos);
    if (!parsed && !hasCoords) {
      toast('Không đọc được toạ độ từ link — hãy dùng link có dạng .../@lat,lng hoặc ?q=lat,lng');
      return;
    }
    setSavingLink(id);
    const patch = parsed
      ? { map_link: link, lat: pos.lat, lng: pos.lng, geocoded_at: new Date().toISOString() }
      : { map_link: link };
    const error = await updateGeo(table, id, patch);
    setSavingLink(null);
    if (error) { toast('Lỗi lưu: ' + error.message); return; }
    toast(parsed ? 'Đã lưu link + toạ độ' : 'Đã lưu link (giữ toạ độ hiện có)');
    setLinkInputs(prev => ({ ...prev, [id]: '' }));
    if (table === 'branches') await loadBranches();
    else if (table === 'clients') await loadMapClients();
    else await onRefresh();
  };

  const toggleGroup = (g: Group) =>
    setActiveGroups(prev => prev.includes(g) ? prev.filter(x => x !== g) : [...prev, g]);

  // Sinh toạ độ: parse map_link trước (không giới hạn), thiếu thì geocode Nominatim tuần tự 1 req/s.
  // Chỉ UPDATE cột lat/lng/geocoded_at — không đụng dữ liệu khác.
  const runGeocode = async () => {
    if (geoProgress) return;
    type Job = { table: string; id: string; name: string; link: string | null; query: string };
    const jobs: Job[] = [
      ...branches.filter(b => b.lat == null || b.lng == null).map(b => ({
        table: 'branches', id: b.id, name: b.name, link: b.map_link,
        query: [b.address || b.name, 'Việt Nam'].join(', '),
      })),
      ...marketZones.filter(z => z.lat == null || z.lng == null).map(z => ({
        table: 'market_zones', id: z.id, name: z.name, link: z.map_link ?? null,
        query: [z.full_name || `KCN ${z.name}`, z.location, 'Việt Nam'].filter(Boolean).join(', '),
      })),
      ...allClients.filter(c => c.lat == null || c.lng == null).map(c => ({
        table: 'clients', id: c.id, name: c.name, link: c.map_link ?? null,
        query: [c.name, (c.industrial_zones ?? [])[0], 'Việt Nam'].filter(Boolean).join(', '),
      })),
      ...marketLeads.filter(l => l.lat == null || l.lng == null).map(l => ({
        table: 'market_leads', id: l.id, name: l.company_name, link: l.map_link ?? null,
        query: [l.company_name, l.region, 'Việt Nam'].filter(Boolean).join(', '),
      })),
    ];
    if (!jobs.length) { toast('Tất cả bản ghi đã có toạ độ'); return; }

    let ok = 0, fail = 0;
    setGeoProgress({ done: 0, total: jobs.length, current: '' });
    for (let i = 0; i < jobs.length; i++) {
      const j = jobs[i];
      setGeoProgress({ done: i, total: jobs.length, current: j.name });
      let pos = parseLatLngFromLink(j.link);
      if (!isValidVnLatLng(pos)) {
        await sleep(1100); // rate limit Nominatim 1 req/s
        pos = await nominatimGeocode(j.query);
      }
      if (isValidVnLatLng(pos)) {
        const error = await updateGeo(j.table, j.id,
          { lat: pos.lat, lng: pos.lng, geocoded_at: new Date().toISOString() });
        if (error) fail++; else ok++;
      } else {
        fail++;
      }
    }
    setGeoProgress(null);
    toast(`Đã sinh toạ độ: ${ok} thành công${fail ? `, ${fail} không tìm được` : ''}`);
    await Promise.all([loadBranches(), loadMapClients(), onRefresh()]);
  };

  // Định vị trực tiếp kiểu Google Maps (mũi tên theo hướng đi, tự bám + tự zoom) — xem useLiveLocation.
  const live = useLiveLocation(mapRef, toast);

  // Xem toàn màn hình — bấm nút hoặc phím tắt "F" (bỏ qua khi đang gõ trong ô nhập liệu).
  const toggleFullscreen = () => {
    const el = mapWrapperRef.current;
    if (!el) return;
    if (document.fullscreenElement) { void document.exitFullscreen(); return; }
    if (cssFs) { setCssFs(false); return; }
    if (typeof el.requestFullscreen !== 'function') { setCssFs(true); return; }
    el.requestFullscreen().catch(() => setCssFs(true));
  };

  useEffect(() => {
    const onChange = () => setNativeFs(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  // Kích thước khung map đổi đột ngột khi vào/thoát toàn màn hình — Leaflet cần được báo lại.
  useEffect(() => {
    const t = setTimeout(() => mapRef.current?.invalidateSize(), 60);
    return () => clearTimeout(t);
  }, [isFullscreen]);

  // Toàn màn hình bằng CSS: khoá cuộn trang phía sau + Esc để thoát
  useEffect(() => {
    if (!cssFs) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setCssFs(false); };
    window.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey); };
  }, [cssFs]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'f' || e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (!mapWrapperRef.current?.matches(':hover') && !document.fullscreenElement) return;
      e.preventDefault();
      toggleFullscreen();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Toàn bộ thanh bộ lọc + toggle lớp + đo khoảng cách + công cụ — dùng lại y hệt cho cả
  // chế độ thường (nằm trong luồng trang) lẫn full màn hình (nổi trên bản đồ, ẩn/hiện khi
  // di chuột, kiểu Apple), tránh phải nhân đôi JSX.
  const controls = (
    <>
      <div className="bg-white border border-[#E8E7E2] rounded-[10px] px-3 py-2 flex items-center gap-2 flex-wrap">
        <span className="text-[12px] text-[#888] shrink-0">Tỉnh/TP:</span>
        <SearchSelect
          value={provinceFilter}
          onChange={setProvinceFilter}
          options={[{ value: 'all', label: `Tất cả (${provinces.length})` }, ...provinces.map(p => ({ value: p, label: p }))]}
          className="w-48"
        />
        <span className="text-[12px] text-[#888] shrink-0">Ngành nghề:</span>
        <SearchSelect
          value={industryFilter}
          onChange={setIndustryFilter}
          options={[{ value: 'all', label: `Tất cả (${industries.length})` }, ...industries.map(i => ({ value: i, label: i }))]}
          className="w-48"
        />
        {(provinceFilter !== 'all' || industryFilter !== 'all') && (
          <button onClick={() => { setProvinceFilter('all'); setIndustryFilter('all'); }} className="text-[11.5px] text-blue-600 hover:underline">Xoá lọc</button>
        )}
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        {GROUPS.map(g => {
          const on = activeGroups.includes(g.id);
          const count = points.filter(p => p.group === g.id).length;
          return (
            <button key={g.id} onClick={() => toggleGroup(g.id)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11.5px] font-medium border transition ${
                on ? 'bg-white border-[#D8D6D0] text-[#333]' : 'bg-[#F3F2EE] border-transparent text-[#aaa]'
              }`}>
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: on ? g.color : '#C7C5BF' }} />
              {g.label} · {count}
            </button>
          );
        })}
        <div className="flex-1" />
        {geoProgress && (
          <span className="text-[12px] text-[#888] inline-flex items-center gap-1.5">
            <span className="w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            {geoProgress.done + 1}/{geoProgress.total} · {geoProgress.current}
          </span>
        )}
      </div>

      <div className="flex items-center gap-1.5 flex-wrap relative">
        <button onClick={() => setLabelMode(m => m === 'always' ? 'auto' : 'always')}
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11.5px] font-medium border transition ${
            labelMode === 'always' ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-[#D8D6D0] text-[#666]'
          }`}>
          <Tag size={12} /> Tên địa điểm: {labelMode === 'always' ? 'Luôn hiện' : 'Tự động khi zoom gần'}
        </button>
        <button onClick={() => setSatView(v => !v)}
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11.5px] font-medium border transition ${
            satView ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-[#D8D6D0] text-[#666]'
          }`}>
          <Layers size={12} /> Vệ tinh + ranh giới
        </button>
        <button onClick={() => setDensityOn(v => !v)}
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11.5px] font-medium border transition ${
            densityOn ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-[#D8D6D0] text-[#666]'
          }`}>
          <Users size={12} /> Mật độ dân số
          {communeLoading && <Loader2 size={11} className="animate-spin" />}
        </button>
        <button onClick={() => setWageLayerOn(v => !v)}
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11.5px] font-medium border transition ${
            wageLayerOn ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-[#D8D6D0] text-[#666]'
          }`}>
          <DollarSign size={12} /> Lương công ty
        </button>
        <button onClick={() => { setMeasureOn(v => !v); if (measureOn) setStops(freshStops()); }}
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11.5px] font-medium border transition ${
            measureOn ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-[#D8D6D0] text-[#666]'
          }`}>
          <Ruler size={12} /> Đo khoảng cách
          {measureOn && routeInfo && !routeLoading && <span className="font-semibold">· {fmtKm(routeInfo.km)} km</span>}
        </button>

        <div className="flex-1" />
        <button onClick={() => { setShowToolsMenu(v => !v); setShowIconSettings(false); }}
          className={`relative inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11.5px] font-medium border transition ${
            showToolsMenu ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-[#D8D6D0] text-[#666]'
          }`}>
          <Wrench size={12} /> Công cụ
          {missingCoordsCount > 0 && (
            <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center leading-none">
              {missingCoordsCount > 9 ? '9+' : missingCoordsCount}
            </span>
          )}
        </button>

        {showToolsMenu && !showIconSettings && (
          <div className="absolute top-full right-0 mt-1.5 z-[1000] w-72 bg-white border border-[#E8E7E2] rounded-[10px] shadow-lg overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b border-[#F0EEE9]">
              <span className="text-[12.5px] font-semibold text-[#111]">Công cụ bản đồ</span>
              <button onClick={() => setShowToolsMenu(false)} className="text-[#999] hover:text-[#333]"><X size={14} /></button>
            </div>
            <button
              onClick={() => { setShowToolsMenu(false); if (missingCoordsCount > 0 && !geoProgress) runGeocode(); }}
              disabled={missingCoordsCount === 0 || !!geoProgress}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-left text-[12.5px] text-[#333] hover:bg-[#F9F9F7] disabled:opacity-40 disabled:hover:bg-transparent border-b border-[#F0EEE9]">
              <Crosshair size={13} className="text-[#666]" />
              <span className="flex-1">Sinh toạ độ</span>
              <span className="text-[11px] text-[#999]">{missingCoordsCount > 0 ? `${missingCoordsCount} thiếu` : 'Đã đủ'}</span>
            </button>
            <button
              onClick={() => { setShowToolsMenu(false); setShowPopulationPanel(true); }}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-left text-[12.5px] text-[#333] hover:bg-[#F9F9F7] border-b border-[#F0EEE9]">
              <Database size={13} className="text-[#666]" />
              <span className="flex-1">Quản lý dữ liệu dân số</span>
              <ChevronRight size={13} className="text-[#ccc]" />
            </button>
            <button
              onClick={() => setShowIconSettings(true)}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-left text-[12.5px] text-[#333] hover:bg-[#F9F9F7] border-b border-[#F0EEE9]">
              <Settings size={13} className="text-[#666]" />
              <span className="flex-1">Icon theo loại</span>
              <ChevronRight size={13} className="text-[#ccc]" />
            </button>
            <button
              onClick={() => { saveCurrentViewAsDefault(); setShowToolsMenu(false); }}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-left text-[12.5px] text-[#333] hover:bg-[#F9F9F7]">
              <BookmarkPlus size={13} className="text-[#666]" />
              <div className="flex-1">
                <div>Đặt view hiện tại làm mặc định</div>
                <div className="text-[10.5px] text-[#999] mt-0.5">Mỗi lần mở Bản đồ sẽ quay lại đúng khung nhìn này</div>
              </div>
            </button>
            {hasCustomDefaultView && (
              <button
                onClick={() => { resetDefaultView(); setShowToolsMenu(false); }}
                className="w-full flex items-center gap-2 px-3 py-2 pl-8 text-left text-[11.5px] text-[#666] hover:bg-[#F9F9F7] hover:text-[#333]">
                <RotateCcw size={11} /> Về mặc định gốc (miền Nam)
              </button>
            )}
          </div>
        )}

        {showToolsMenu && showIconSettings && (
          <div className="absolute top-full right-0 mt-1.5 z-[1000] w-80 bg-white border border-[#E8E7E2] rounded-[10px] shadow-lg p-3 space-y-2">
            <div className="flex items-center justify-between mb-1">
              <button onClick={() => setShowIconSettings(false)} className="text-[#999] hover:text-[#333] inline-flex items-center gap-1 text-[11.5px]">
                <ChevronLeft size={13} /> Quay lại
              </button>
              <button onClick={() => { setShowIconSettings(false); setShowToolsMenu(false); }} className="text-[#999] hover:text-[#333]">
                <X size={14} />
              </button>
            </div>
            <span className="text-[12.5px] font-semibold text-[#111] block">Tuỳ chỉnh icon marker</span>
            {GROUPS.map(g => (
              <div key={g.id} className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full flex-none" style={{ backgroundColor: g.color }} />
                <span className="text-[12px] text-[#333] flex-1">{g.label}</span>
                <input
                  value={groupIcons[g.id]}
                  onChange={e => setGroupIcon(g.id, e.target.value)}
                  placeholder="—"
                  maxLength={4}
                  className="w-14 text-center text-[15px] px-1.5 py-1 border border-[#E8E7E2] rounded-lg outline-none focus:border-[#1D4ED8]"
                />
              </div>
            ))}
            <div className="flex items-center justify-between pt-1.5 border-t border-[#F0EEE9]">
              <span className="text-[10.5px] text-[#999]">Dán emoji (🏢🤝🎯🏗️…) hoặc để trống dùng chấm màu</span>
              <button onClick={resetGroupIcons}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-[#666] hover:text-[#333]">
                <RotateCcw size={11} /> Đặt lại
              </button>
            </div>
          </div>
        )}
      </div>

      {measureOn && (
        <div data-measure-panel>
        <MeasurePanel
          rows={stops}
          onRows={changeStops}
          onPick={pickStop}
          optionsFor={optionsFor}
          legs={legsByRow}
          route={routeInfo}
          loading={routeLoading}
          straightKm={straightKm}
          filledCount={filledStops.length}
          locating={locating}
          onRefreshMe={() => void locateMe()}
          onAdd={addStop}
          onStartFromMe={startFromMe}
          onOptimize={filledStops.length >= 3 ? () => void optimizeStops() : null}
          optimizing={optimizing}
          googleLink={googleLink}
          onClear={() => setStops(freshStops())}
        />
        </div>
      )}
    </>
  );

  return (
    <div className="space-y-3">
      {!isFullscreen && controls}

      <div ref={mapWrapperRef} className={`bg-white border border-[#E8E7E2] overflow-hidden ${cssFs ? 'fixed inset-0 z-[1250]' : 'relative'} ${isFullscreen ? '' : 'rounded-[10px]'}`}>
        <div ref={mapDivRef} style={{ height: isFullscreen ? '100dvh' : 'calc(100dvh - 260px)', minHeight: 420 }} />
        {isFullscreen && <FullscreenControlsOverlay open={panelOpen} onClose={() => setPanelOpen(false)}>{controls}</FullscreenControlsOverlay>}
        {isFullscreen && !panelOpen && measureOn && filledStops.length >= 2 && (
          <button onClick={() => {
            setPanelOpen(true);
            // Bảng điểm dừng nằm cuối bảng bộ lọc → cuộn tới luôn (điện thoại phải cuộn qua cả bộ lọc)
            setTimeout(() => document.querySelector('[data-measure-panel]')?.scrollIntoView({ block: 'nearest' }), 50);
          }}
            className="absolute bottom-6 left-1/2 -translate-x-1/2 z-[1000] h-10 px-4 rounded-full bg-white/95 backdrop-blur border border-[#D8D6D0] shadow-lg text-[13px] text-[#222] inline-flex items-center gap-2 whitespace-nowrap max-w-[calc(100%-2rem)]">
            <Route size={15} className="text-blue-700 flex-none" />
            <span className="font-semibold">{filledStops.map(f => stopLetter(f.idx)).join(' → ')}</span>
            {routeLoading ? <Loader2 size={13} className="animate-spin text-blue-500" />
              : routeInfo ? <span className="truncate">{fmtKm(routeInfo.km)} km · {fmtDuration(routeInfo.sec)}</span>
              : straightKm != null ? <span className="truncate text-red-600">≈ {fmtKm(straightKm)} km chim bay</span> : null}
          </button>
        )}
        {!isFullscreen && (
          <button onClick={() => setSurveyOpen(true)}
            className="absolute bottom-4 left-1/2 -translate-x-1/2 z-[1000] h-11 pl-4 pr-5 rounded-full bg-[#0A84FF] text-white text-[14px] font-semibold shadow-[0_6px_20px_rgba(10,132,255,0.45)] inline-flex items-center gap-2 active:scale-95 transition whitespace-nowrap">
            <Route size={17} /> Khảo sát KCN
            {surveyPending && <span className="ml-1 px-1.5 py-0.5 rounded-full bg-white/25 text-[11px] font-semibold">Đang dở</span>}
          </button>
        )}
        <div className="absolute top-3 right-3 z-[1000] flex flex-col gap-1.5">
          <button onClick={live.toggle} title={!live.active ? 'Định vị & dẫn theo vị trí' : live.follow ? 'Đang bám theo vị trí — bấm để tắt' : 'Bám lại vị trí'}
            className={`w-9 h-9 flex items-center justify-center rounded-lg border shadow ${live.active ? 'bg-[#0A84FF] border-[#0A84FF] text-white' : 'bg-white border-[#D8D6D0] text-[#444] hover:bg-[#F9F9F7]'}`}>
            {live.active && live.follow ? <Navigation size={16} fill="currentColor" /> : <LocateFixed size={16} />}
          </button>
          {isFullscreen && (
            <button onClick={() => setPanelOpen(v => !v)} title={panelOpen ? 'Ẩn bộ lọc' : 'Hiện bộ lọc'}
              className={`w-9 h-9 flex items-center justify-center rounded-lg border shadow ${panelOpen ? 'bg-[#111] border-[#111] text-white' : 'bg-white border-[#D8D6D0] text-[#444] hover:bg-[#F9F9F7]'}`}>
              <SlidersHorizontal size={16} />
            </button>
          )}
          <button onClick={toggleFullscreen} title={isFullscreen ? 'Thoát toàn màn hình (F)' : 'Toàn màn hình (F)'}
            className="w-9 h-9 flex items-center justify-center rounded-lg bg-white border border-[#D8D6D0] text-[#444] shadow hover:bg-[#F9F9F7]">
            {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
        </div>
      </div>

      {missingList.length > 0 && (
        <div className="bg-white border border-[#E8E7E2] rounded-[10px] overflow-hidden">
          <button onClick={() => setShowMissing(v => !v)}
            className="w-full px-4 py-2.5 text-left text-[12.5px] font-semibold text-[#111] flex items-center justify-between hover:bg-[#F9F9F7]">
            <span>Thiếu link Google Maps / toạ độ ({missingList.length})</span>
            <span className="text-[11px] text-[#888] font-normal">
              Dán link Google Maps để định vị chính xác, hoặc bấm «Sinh toạ độ» để tra tự động {showMissing ? '▲' : '▼'}
            </span>
          </button>
          {showMissing && (
            <div className="border-t border-[#E8E7E2]">
              <div className="px-4 py-2 flex items-center gap-1.5 flex-wrap bg-[#FAFAF8] border-b border-[#F0EEE9]">
                <button onClick={() => setMissingGroupFilter('all')}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition ${missingGroupFilter === 'all' ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-[#D8D6D0] text-[#666]'}`}>
                  Tất cả ({missingList.length})
                </button>
                {GROUPS.map(g => {
                  const count = missingList.filter(m => m.group === g.id).length;
                  if (!count) return null;
                  return (
                    <button key={g.id} onClick={() => setMissingGroupFilter(g.id)}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border transition ${missingGroupFilter === g.id ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-[#D8D6D0] text-[#666]'}`}>
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: g.color }} />
                      {g.label} ({count})
                    </button>
                  );
                })}
              </div>
            <div className="divide-y divide-[#F0EEE9] max-h-72 overflow-y-auto">
              {missingShown.map(m => (
                <div key={m.id} className="px-4 py-2 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full flex-none" style={{ backgroundColor: GROUP_COLOR[m.group] }} />
                  <span className="text-[12px] font-medium text-[#333] w-56 truncate">{m.name}</span>
                  <span className="flex items-center gap-1 flex-none">
                    {!m.link?.trim() && (
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">thiếu link</span>
                    )}
                    {!m.hasCoords && (
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-red-50 text-red-600 border border-red-200">thiếu toạ độ</span>
                    )}
                  </span>
                  <input
                    value={linkInputs[m.id] ?? ''}
                    onChange={e => setLinkInputs(prev => ({ ...prev, [m.id]: e.target.value }))}
                    placeholder="Dán link Google Maps (…/@lat,lng…)"
                    className="flex-1 text-[12px] px-2.5 py-1.5 border border-[#E8E7E2] rounded-lg outline-none focus:border-[#1D4ED8]"
                  />
                  <button
                    onClick={() => saveLink(m.table, m.id, m.hasCoords)}
                    disabled={savingLink === m.id || !(linkInputs[m.id] ?? '').trim()}
                    className="text-[11.5px] font-medium px-2.5 py-1.5 rounded-lg bg-blue-50 border border-blue-200 text-blue-700 hover:bg-blue-100 disabled:opacity-40 transition">
                    {savingLink === m.id ? 'Đang lưu…' : 'Lưu'}
                  </button>
                </div>
              ))}
            </div>
            </div>
          )}
        </div>
      )}
      {points.length === 0 && missingList.length === 0 && (
        <div className="text-center py-6 text-[#aaa] text-[12.5px]">Chưa có dữ liệu để hiển thị trên bản đồ</div>
      )}

      {surveyOpen && (
        <KcnSurveyMode
          marketZones={marketZones} marketLeads={marketLeads} branches={branches} laborHistory={laborHistory}
          goTab={goTab}
          onClose={() => { setSurveyOpen(false); setSurveyPending(hasPendingSurvey()); }}
        />
      )}

      {showPopulationPanel && (
        <PopulationDataPanel
          onClose={() => setShowPopulationPanel(false)}
          onChanged={loadCommunes}
          toast={toast}
        />
      )}
    </div>
  );
}

/** Menu bộ lọc nổi trên bản đồ khi ở chế độ toàn màn hình: ẩn theo mặc định, hiện / ẩn bằng nút bộ lọc bên phải bản đồ. */
function FullscreenControlsOverlay({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  if (!open) return null;
  return (
    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1001] w-[calc(100%-5.5rem)] max-w-[92vw] md:w-auto">
      <div className="relative bg-white/85 backdrop-blur-xl border border-white/60 shadow-2xl rounded-2xl px-3 py-2.5 max-h-[80dvh] overflow-y-auto space-y-2">
        <button onClick={onClose} aria-label="Ẩn bộ lọc" className="absolute top-1.5 right-1.5 w-7 h-7 rounded-full bg-black/5 flex items-center justify-center text-[#555] z-10"><X size={14} /></button>
        {children}
      </div>
    </div>
  );
}

/** Tên trước, loại sau — ô chọn điểm hẹp trên điện thoại vẫn đọc được tên */
function stopOptLabel(p: Pick<MapPoint, 'name' | 'group'>) {
  return `${p.name} · ${GROUPS.find(g => g.id === p.group)?.label ?? ''}`;
}

function hasPendingSurvey() {
  try { return !!localStorage.getItem('lgvn_kcn_survey_active_v1'); } catch { return false; }
}

function wageFmt(min: number | null | undefined, max: number | null | undefined) {
  if (min == null || max == null) return null;
  return `${(min / 1_000_000).toFixed(1)}–${(max / 1_000_000).toFixed(1)}tr`;
}

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
