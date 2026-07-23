import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import { Crosshair, Ruler, Layers, Tag, Settings, RotateCcw, X, Users, Database, Loader2, DollarSign, LocateFixed, Wrench, ChevronRight, ChevronLeft, Maximize2, Minimize2 } from 'lucide-react';
import { createPopulationLayer, createCommuneLayer, createDensityLegend } from './populationDensity';
import { fetchCommunes } from './populationData';
import type { CommuneRow } from './populationData';
import PopulationDataPanel from './PopulationDataPanel';
import SearchSelect from './SearchSelect';
import { fetchIndustries } from './industries';
import { supabase } from '../../lib/supabase';
import { shortId } from '../../hooks/useHashSubRoute';
import { parseLatLngFromLink, nominatimGeocode, isValidVnLatLng, sleep, haversineKm } from '../../lib/geo';
import type { Branch, MarketLeadSupplier } from '../../lib/types';
import type { MarketTabProps } from './shared';

type Group = 'branch' | 'kcn' | 'client' | 'prospect' | 'lead';

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

const GROUPS: { id: Group; label: string; color: string }[] = [
  { id: 'branch', label: 'Chi nhánh', color: '#1D4ED8' },
  { id: 'kcn', label: 'Khu công nghiệp', color: '#D97706' },
  { id: 'client', label: 'KH đang hợp tác', color: '#059669' },
  { id: 'prospect', label: 'KH tiềm năng', color: '#7C3AED' },
  { id: 'lead', label: 'Công ty / Dự án', color: '#DB2777' },
];

const GROUP_COLOR: Record<Group, string> = Object.fromEntries(GROUPS.map(g => [g.id, g.color])) as Record<Group, string>;

// Icon (emoji) mặc định cho từng loại — người dùng tự đổi qua nút Cài đặt, lưu ở máy (localStorage).
const DEFAULT_GROUP_ICONS: Record<Group, string> = {
  branch: '', kcn: '🏭', client: '', prospect: '', lead: '',
};
const GROUP_ICONS_KEY = 'lgmap_group_icons_v1';

function loadGroupIcons(): Record<Group, string> {
  try {
    const raw = localStorage.getItem(GROUP_ICONS_KEY);
    if (!raw) return { ...DEFAULT_GROUP_ICONS };
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_GROUP_ICONS, ...parsed };
  } catch {
    return { ...DEFAULT_GROUP_ICONS };
  }
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
    return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
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

export default function MapViewTab({ marketZones, marketLeads, goTab, onRefresh, toast }: MarketTabProps) {
  const [prefsLoaded] = useState(() => loadMapPrefs());
  const [branches, setBranches] = useState<Branch[]>([]);
  const [allClients, setAllClients] = useState<MapClient[]>([]);
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
  const [locating, setLocating] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [densityOn, setDensityOn] = useState(prefsLoaded.densityOn);
  const [wageLayerOn, setWageLayerOn] = useState(prefsLoaded.wageLayerOn);
  const [provinceFilter, setProvinceFilter] = useState(prefsLoaded.provinceFilter);
  const [industryFilter, setIndustryFilter] = useState(prefsLoaded.industryFilter);
  const [industries, setIndustries] = useState<string[]>([]);
  const [communeRows, setCommuneRows] = useState<CommuneRow[] | null>(null);
  const [communeLoading, setCommuneLoading] = useState(false);
  const [showPopulationPanel, setShowPopulationPanel] = useState(false);
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [linkInputs, setLinkInputs] = useState<Record<string, string>>({});
  const [savingLink, setSavingLink] = useState<string | null>(null);
  const [routeInfo, setRouteInfo] = useState<{ km: number; geometry: [number, number][] } | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const mapDivRef = useRef<HTMLDivElement>(null);
  const mapWrapperRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const myLocationMarkerRef = useRef<L.Marker | L.Circle | null>(null);
  const clusterRef = useRef<L.MarkerClusterGroup | null>(null);
  const didFitRef = useRef(false);
  const osmLayerRef = useRef<L.TileLayer | null>(null);
  const satLayerRef = useRef<L.TileLayer | null>(null);
  const boundaryLayerRef = useRef<L.TileLayer | null>(null);
  const measureLineRef = useRef<L.Polyline | null>(null);
  const routeLineRef = useRef<L.Polyline | null>(null);
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
        .select('client_id, count, created_at').in('client_id', ids).order('created_at', { ascending: true });
      if (!laborErr && laborData) {
        const latest = new Map<string, number>();
        laborData.forEach(h => latest.set(h.client_id, h.count));
        rows.forEach(c => { c.current_workers = latest.get(c.id) ?? null; });
      }
    }
    setAllClients(rows);
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
    fetchIndustries([...marketLeads.map(l => l.industry)]).then(setIndustries);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Nhớ bộ lọc/hiển thị theo máy — F5 hoặc vào lại vẫn giữ nguyên lựa chọn.
  useEffect(() => {
    const prefs: MapPrefs = { activeGroups, densityOn, wageLayerOn, satView, labelMode, provinceFilter, industryFilter };
    localStorage.setItem(MAP_PREFS_KEY, JSON.stringify(prefs));
  }, [activeGroups, densityOn, wageLayerOn, satView, labelMode, provinceFilter, industryFilter]);

  // Tỉnh/TP suy ra từ tên KCN (marketZones.location), giống cách làm ở tab Lương TT / Công ty-Dự án.
  const zoneToProvince = useMemo(() => {
    const map: Record<string, string> = {};
    marketZones.forEach(z => { if (z.location) map[z.name] = z.location; });
    return map;
  }, [marketZones]);
  const provinces = useMemo(
    () => [...new Set([...marketZones.map(z => z.location), ...branches.map(b => b.location)].filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, 'vi')),
    [marketZones, branches],
  );
  const matchesProvinceFilter = (region: string | null | undefined, zones: string[] | undefined) => {
    if (provinceFilter === 'all') return true;
    if (region && (zoneToProvince[region] === provinceFilter || region === provinceFilter)) return true;
    if (zones?.some(z => zoneToProvince[z] === provinceFilter)) return true;
    return false;
  };
  const matchesIndustryFilter = (industry: string | null | undefined) => industryFilter === 'all' || industry === industryFilter;

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
  }, [branches, marketZones, marketLeads, allClients, goTab, provinceFilter, industryFilter, zoneToProvince]);

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
    osmLayerRef.current = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
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
    // Chỉ tự zoom lần đầu có dữ liệu — bấm filter chip không làm nhảy khung nhìn
    if (shown.length && !didFitRef.current) {
      didFitRef.current = true;
      const bounds = L.latLngBounds(shown.map(p => [p.lat, p.lng] as [number, number]));
      map.fitBounds(bounds.pad(0.15), { maxZoom: 12 });
    }
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

  // Đo khoảng cách: đường đi thực tế (OSRM, driving) là chính, đường chim bay là phụ.
  const measureFrom = useMemo(() => points.find(p => p.id === fromId) ?? null, [points, fromId]);
  const measureTo = useMemo(() => points.find(p => p.id === toId) ?? null, [points, toId]);
  const straightKm = measureOn && measureFrom && measureTo && measureFrom.id !== measureTo.id
    ? haversineKm(measureFrom, measureTo) : null;

  useEffect(() => {
    let cancelled = false;
    setRouteInfo(null);
    if (straightKm == null || !measureFrom || !measureTo) return;
    setRouteLoading(true);
    const url = `https://router.project-osrm.org/route/v1/driving/${measureFrom.lng},${measureFrom.lat};${measureTo.lng},${measureTo.lat}?overview=full&geometries=geojson`;
    fetch(url)
      .then(res => res.json())
      .then(data => {
        if (cancelled) return;
        const route = data?.routes?.[0];
        if (route?.geometry?.coordinates?.length) {
          setRouteInfo({
            km: route.distance / 1000,
            geometry: route.geometry.coordinates.map((c: [number, number]) => [c[1], c[0]]),
          });
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setRouteLoading(false); });
    return () => { cancelled = true; };
  }, [straightKm, measureFrom, measureTo]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (measureLineRef.current) { measureLineRef.current.remove(); measureLineRef.current = null; }
    if (routeLineRef.current) { routeLineRef.current.remove(); routeLineRef.current = null; }
    if (straightKm == null || !measureFrom || !measureTo) return;

    const straightLine = L.polyline(
      [[measureFrom.lat, measureFrom.lng], [measureTo.lat, measureTo.lng]],
      { color: '#DC2626', weight: 2, dashArray: '6 6', opacity: routeInfo ? 0.55 : 1 },
    ).addTo(map);
    measureLineRef.current = straightLine;

    let bounds = straightLine.getBounds();
    if (routeInfo) {
      const routeLine = L.polyline(routeInfo.geometry, { color: '#1D4ED8', weight: 4, opacity: 0.85 }).addTo(map);
      routeLine.bindTooltip(`${fmtKm(routeInfo.km)} km · đi đường bộ`, {
        permanent: true, direction: 'center', className: 'lgmap-distance',
      });
      routeLineRef.current = routeLine;
      bounds = routeLine.getBounds();
    } else if (!routeLoading) {
      straightLine.bindTooltip(`≈ ${fmtKm(straightKm)} km (chim bay)`, {
        permanent: true, direction: 'center', className: 'lgmap-distance lgmap-distance-alt',
      });
    }
    map.fitBounds(bounds.pad(0.3), { maxZoom: 13 });
    return () => {
      straightLine.remove();
      if (routeLineRef.current) routeLineRef.current.remove();
      measureLineRef.current = null;
      routeLineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [straightKm, measureFrom, measureTo, routeInfo, routeLoading]);

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

  // Định vị bằng GPS trình duyệt — zoom mức 15 (nhìn rõ khu vực xung quanh, không quá gần).
  const locateMe = () => {
    if (!navigator.geolocation) { toast('Trình duyệt không hỗ trợ định vị'); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      pos => {
        setLocating(false);
        const map = mapRef.current;
        if (!map) return;
        const { latitude, longitude } = pos.coords;
        if (myLocationMarkerRef.current) myLocationMarkerRef.current.remove();
        const icon = L.divIcon({
          className: 'lgmap-my-location',
          html: '<span class="lgmap-my-location-dot"></span>',
          iconSize: [18, 18],
          iconAnchor: [9, 9],
        });
        myLocationMarkerRef.current = L.marker([latitude, longitude], { icon, zIndexOffset: 1000 })
          .addTo(map).bindTooltip('Vị trí của tôi', { direction: 'top', offset: [0, -10] });
        map.setView([latitude, longitude], 15);
      },
      err => {
        setLocating(false);
        toast('Không lấy được vị trí: ' + (err.code === 1 ? 'bạn chưa cấp quyền định vị' : err.message));
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  // Xem toàn màn hình — bấm nút hoặc phím tắt "F" (bỏ qua khi đang gõ trong ô nhập liệu).
  const toggleFullscreen = () => {
    const el = mapWrapperRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else el.requestFullscreen().catch(() => toast('Trình duyệt không hỗ trợ xem toàn màn hình'));
  };

  useEffect(() => {
    const onChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
      // Kích thước khung map đổi đột ngột khi vào/thoát fullscreen — Leaflet cần được báo lại.
      setTimeout(() => mapRef.current?.invalidateSize(), 50);
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

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
        <button onClick={() => { setMeasureOn(v => !v); if (measureOn) { setFromId(''); setToId(''); } }}
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11.5px] font-medium border transition ${
            measureOn ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-[#D8D6D0] text-[#666]'
          }`}>
          <Ruler size={12} /> Đo khoảng cách
        </button>
        {measureOn && (
          <>
            <SearchSelect
              value={fromId}
              onChange={setFromId}
              options={points.map(p => ({ value: p.id, label: `${GROUPS.find(g => g.id === p.group)?.label} — ${p.name}` }))}
              placeholder="Từ điểm… (gõ để tìm)"
              className="w-52"
            />
            <span className="text-[12px] text-[#888]">→</span>
            <SearchSelect
              value={toId}
              onChange={setToId}
              options={points.filter(p => p.id !== fromId).map(p => ({ value: p.id, label: `${GROUPS.find(g => g.id === p.group)?.label} — ${p.name}` }))}
              placeholder="Đến điểm… (gõ để tìm)"
              className="w-52"
            />
            {routeLoading && straightKm != null && (
              <span className="text-[12px] text-[#888] inline-flex items-center gap-1.5">
                <span className="w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                Đang tính đường đi…
              </span>
            )}
            {!routeLoading && routeInfo && (
              <span className="text-[12px] font-semibold text-blue-700">
                ≈ {fmtKm(routeInfo.km)} km <span className="font-normal text-[#888]">đường bộ</span>
                <span className="font-normal text-[#aaa]"> · {fmtKm(straightKm!)} km chim bay</span>
              </span>
            )}
            {!routeLoading && !routeInfo && straightKm != null && (
              <span className="text-[12px] font-semibold text-red-600">
                ≈ {fmtKm(straightKm)} km
                <span className="font-normal text-[#888]"> (chim bay — không lấy được đường đi)</span>
              </span>
            )}
          </>
        )}

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
              className="w-full flex items-center gap-2 px-3 py-2.5 text-left text-[12.5px] text-[#333] hover:bg-[#F9F9F7]">
              <Settings size={13} className="text-[#666]" />
              <span className="flex-1">Icon theo loại</span>
              <ChevronRight size={13} className="text-[#ccc]" />
            </button>
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
    </>
  );

  return (
    <div className="space-y-3">
      {!isFullscreen && controls}

      <div ref={mapWrapperRef} className={`relative bg-white border border-[#E8E7E2] overflow-hidden ${isFullscreen ? '' : 'rounded-[10px]'}`}>
        <div ref={mapDivRef} style={{ height: isFullscreen ? '100vh' : 'calc(100vh - 260px)', minHeight: 420 }} />
        {isFullscreen && <FullscreenControlsOverlay>{controls}</FullscreenControlsOverlay>}
        <div className="absolute top-3 right-3 z-[1000] flex flex-col gap-1.5">
          <button onClick={locateMe} disabled={locating} title="Vị trí của tôi"
            className="w-9 h-9 flex items-center justify-center rounded-lg bg-white border border-[#D8D6D0] text-[#444] shadow hover:bg-[#F9F9F7] disabled:opacity-50">
            {locating ? <Loader2 size={16} className="animate-spin" /> : <LocateFixed size={16} />}
          </button>
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

/** Menu bộ lọc nổi trên bản đồ khi ở chế độ toàn màn hình — kiểu Apple: ẩn theo mặc định,
 * di chuột vào dải mỏng trên cùng (hoặc vào chính menu) để hiện, tự ẩn sau 30s không thao tác. */
function FullscreenControlsOverlay({ children }: { children: ReactNode }) {
  const [revealed, setRevealed] = useState(true);
  const hideTimerRef = useRef<number | null>(null);

  const scheduleHide = () => {
    if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(() => setRevealed(false), 30000);
  };
  const wake = () => { setRevealed(true); scheduleHide(); };

  useEffect(() => {
    scheduleHide();
    return () => { if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <div onMouseEnter={wake} className="absolute top-0 left-0 right-0 h-3 z-[1001]" />
      {!revealed && (
        <div onMouseEnter={wake}
          className="absolute top-2 left-1/2 -translate-x-1/2 z-[1001] w-10 h-1.5 rounded-full bg-white/50 hover:bg-white/80 cursor-pointer transition" />
      )}
      <div
        onMouseMove={wake}
        onClick={wake}
        className={`absolute top-3 left-1/2 -translate-x-1/2 z-[1001] transition-all duration-300 ease-out ${
          revealed ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2 pointer-events-none'
        }`}>
        <div className="bg-white/75 backdrop-blur-xl border border-white/60 shadow-2xl rounded-2xl px-3 py-2.5 max-w-[92vw] max-h-[85vh] overflow-y-auto space-y-2">
          {children}
        </div>
      </div>
    </>
  );
}

function fmtKm(km: number) {
  return km < 10 ? km.toFixed(1) : Math.round(km).toString();
}

function wageFmt(min: number | null | undefined, max: number | null | undefined) {
  if (min == null || max == null) return null;
  return `${(min / 1_000_000).toFixed(1)}–${(max / 1_000_000).toFixed(1)}tr`;
}

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
