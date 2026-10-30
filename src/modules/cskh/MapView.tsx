// ============================================================================
// Bản đồ Khách hàng (port PRM PrmMapPage) — Leaflet + OpenStreetMap, không cần API key.
// ----------------------------------------------------------------------------
// • 3 lớp: Vị trí công ty (mặc định — toạ độ clients.lat/lng, chốt 19/10/2026) · Nơi ở hiện
//   tại (contacts.lat/lng) · Quê quán theo tỉnh (vẽ ở tâm tỉnh, luôn "tương đối"). Ghim
//   chính xác (có link Maps / chấm tay) có ✓, ghim tương đối có "~".
// • Ghim màu theo nhóm, gom cụm khi thu nhỏ; popup: Mở hồ sơ / Chỉ đường.
// • Đo khoảng cách A → B: chọn người / chi nhánh / "Vị trí của tôi" bằng ô tìm hoặc chạm 2 ghim
//   → đường ô tô (OSRM, xanh) + chim bay (đỏ, nét đứt); OSRM lỗi vẫn có km chim bay.
// • Vị trí của tôi: chấm xanh nhấp nháy + vòng sai số + danh sách "Gần bạn" (km, chỉ đường).
// • Định vị hàng loạt: nơi ở (link Maps trước — nhanh, miễn phí; rồi tra chữ ~1 người/giây,
//   "1/24 — bấm để dừng"); quê quán: tra tâm mỗi tỉnh 1 lần rồi nhớ trong máy.
// ============================================================================
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import { Building2, Crosshair, Home, Loader2, LocateFixed, MapPinned, Navigation, Ruler, Sprout, X } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { useBranchLookup } from '../../hooks/useBranchLookup';
import { usePersistedState } from '../../hooks/usePersistedState';
import { emitCskhDataChanged } from '../../lib/cskh/events';
import {
  addressPrecision, currentPoint, fmtDistance, fmtDuration, haversineKm, layerPoints, MAP_LAYER_LABEL, nearestPoints,
  provinceGeoQuery, type MapLayer, type MapPoint,
} from '../../lib/cskh/mapPoints';
import { geocodeAddressDetailed, NOMINATIM_DELAY_MS, type LatLng } from '../../lib/cskh/nearby';
import { normalizeSearch } from '../../lib/cskh/search';
import { nominatimGeocode, sleep } from '../../lib/geo';
import { escapeMapHtml, loadDefaultView, SOUTH_VN_BOUNDS } from '../../lib/mapGroups';
import { streetTiles } from '../../lib/mapTiles';
import { setContactGeo } from './data/api';
import { mapLinkCoords } from './data/mapLink';
import { useCskh } from './context';
import { chipStyle, groupDisplayOf, PANEL, PILL_GRAY, type GroupDisplay } from './ui';
import { useCareScope } from './useCareScope';
import { MigrationBanner, Spinner } from './components/Card';
import { PageTitle, Segmented, Switch } from './components/apple';
import { CareScopeBar } from './components/CareScopeBar';
import { useSpace } from './space';

interface Point extends MapPoint {
  group: GroupDisplay;
  /** Lớp nơi ở: có link Maps / chấm tay. */
  verified: boolean;
}

/** Điểm đặc biệt trong bộ chọn đo khoảng cách. */
const ME = 'me';
const BRANCH = 'b:';

// ── Tâm tỉnh quê: tra 1 lần mỗi tỉnh (Nominatim, bị chặn thì Photon) rồi nhớ trong máy ──
const PROVINCE_CACHE_KEY = 'lgvn_cskh_province_geo_v1';
function readProvinceCache(): Map<string, LatLng> {
  try {
    const raw = JSON.parse(localStorage.getItem(PROVINCE_CACHE_KEY) ?? '{}') as Record<string, LatLng>;
    return new Map(Object.entries(raw).filter(([, v]) => v && Number.isFinite(v.lat) && Number.isFinite(v.lng)));
  } catch {
    return new Map();
  }
}
function writeProvinceCache(m: ReadonlyMap<string, LatLng>) {
  try {
    localStorage.setItem(PROVINCE_CACHE_KEY, JSON.stringify(Object.fromEntries(m)));
  } catch {
    // chế độ riêng tư — lần sau tra lại, chấp nhận được
  }
}

const TOOL = 'inline-flex items-center gap-1.5 h-9 md:h-8 px-3.5 rounded-full text-[13px] font-medium transition active:scale-[0.97] disabled:opacity-40';
const TOOL_OFF = `${TOOL} bg-[rgba(118,118,128,0.12)] text-[#1D1D1F] hover:bg-[rgba(118,118,128,0.2)]`;
const TOOL_ON = `${TOOL} bg-[#0071E3] text-white`;

/** Ô chọn điểm có tìm (gõ vài chữ, không dấu vẫn ra) — dùng cho Đo khoảng cách. */
function PointPicker({ options, value, onChange, placeholder }: {
  options: readonly { id: string; label: string }[];
  value: string;
  onChange: (id: string) => void;
  placeholder: string;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const selected = options.find(o => o.id === value);
  const list = useMemo(() => {
    const q = normalizeSearch(query);
    return options.filter(o => q === '' || normalizeSearch(o.label).includes(q)).slice(0, 40);
  }, [options, query]);
  return (
    <div className="relative flex-1 min-w-[150px]">
      <input type="text" value={open ? query : selected?.label ?? ''} placeholder={placeholder} aria-label={placeholder} autoComplete="off"
        onFocus={() => { setOpen(true); setQuery(''); }} onBlur={() => setOpen(false)} onChange={e => setQuery(e.target.value)}
        className="w-full h-10 md:h-9 px-3 rounded-[10px] bg-white text-[13px] text-[#1D1D1F] placeholder:text-[#86868B] outline-none border border-black/[0.12] focus:border-[#0071E3] focus:ring-4 focus:ring-[#0071E3]/15 transition" />
      {open && list.length > 0 && (
        <ul role="listbox" aria-label={placeholder}
          className="absolute z-[500] left-0 right-0 mt-1 max-h-60 overflow-y-auto rounded-[12px] bg-white py-1 shadow-[0_0_0_0.5px_rgba(0,0,0,0.1),0_12px_32px_-8px_rgba(0,0,0,0.25)]">
          {list.map(o => (
            <li key={o.id} role="option" aria-selected={o.id === value} onMouseDown={e => e.preventDefault()}
              onClick={() => { onChange(o.id); setOpen(false); }}
              className={`px-3 min-h-[38px] md:min-h-[32px] flex items-center text-[13px] cursor-pointer hover:bg-[#0071E3]/10 ${o.id === value ? 'text-[#0066CC] font-medium' : 'text-[#1D1D1F]'}`}>
              {o.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function CskhMap() {
  const { tierLabel, storageKey } = useSpace();
  const { space, data, loading, clients, toast, openProfile } = useCskh();
  const { token } = useAuth();
  const { branches } = useBranchLookup();
  const contacts = useMemo(() => data?.contacts ?? [], [data]);
  const scope = useCareScope(contacts, clients, space);
  const groupById = useMemo(() => new Map((data?.groups ?? []).map(g => [g.id, g])), [data]);
  // Sale không gắn công ty khách → không có lớp "Công ty", mặc định nơi ở
  const [storedLayer, setLayer] = usePersistedState<MapLayer>(storageKey('cskh_map_layer'), space === 'sale' ? 'current' : 'company');
  const layer: MapLayer = space === 'sale' && storedLayer === 'company' ? 'current' : storedLayer;
  const [includeOthers, setIncludeOthers] = useState(false);
  const [hiddenGroups, setHiddenGroups] = useState<ReadonlySet<string>>(() => new Set());
  const [provinceGeo, setProvinceGeo] = useState<Map<string, LatLng>>(readProvinceCache);
  const [locating, setLocating] = useState<{ done: number; total: number } | null>(null);
  const cancelRef = useRef(false);
  // Đo khoảng cách
  const [measureOn, setMeasureOn] = useState(false);
  const [pair, setPair] = useState<{ from: string; to: string }>({ from: '', to: '' });
  const [route, setRoute] = useState<{ key: string; km: number; sec: number; line: [number, number][] } | null>(null);
  const [routeFailed, setRouteFailed] = useState('');
  // Vị trí của tôi
  const [me, setMe] = useState<(LatLng & { acc: number }) | null>(null);
  const [meBusy, setMeBusy] = useState(false);
  const [meError, setMeError] = useState('');
  const focusRef = useRef<((id: string) => void) | null>(null);

  useEffect(() => () => { cancelRef.current = true; }, []);

  // Người được xét: đang chăm sóc (hoặc cả người chưa chăm sóc), chưa nghỉ, thuộc phạm vi lọc
  const people = useMemo(
    () => scope.scoped.filter(c => !c.isArchived && (includeOthers || c.tier !== 'unclassified')),
    [scope.scoped, includeOthers],
  );
  const companyGeo = useMemo(() => new Map(clients
    .filter(c => c.lat != null && c.lng != null)
    .map(c => [c.id, { lat: c.lat as number, lng: c.lng as number, name: c.name }] as const)), [clients]);

  const pointsOf = useCallback((l: MapLayer): Point[] => layerPoints(people, l, companyGeo, provinceGeo).map(p => ({
    ...p,
    group: groupDisplayOf(p.contact, groupById, tierLabel),
    verified: l === 'current' && addressPrecision(p.contact) === 'precise',
  })), [people, companyGeo, provinceGeo, groupById, tierLabel]);
  const points = useMemo(() => pointsOf(layer), [pointsOf, layer]);
  const counts = useMemo(() => ({
    company: pointsOf('company').length, current: pointsOf('current').length, origin: pointsOf('origin').length,
  }), [pointsOf]);

  /** Có dữ liệu để định vị nhưng chưa có toạ độ ở lớp này. */
  const locatable = useMemo(() => ({
    current: people.filter(c => !currentPoint(c) && (c.mapUrl.trim() !== '' || c.address.trim() !== '')),
    origin: [...new Set(people.map(c => c.originProvince.trim()).filter(p => p && !provinceGeo.has(p)))],
  }), [people, provinceGeo]);
  const missing = people.length - points.length;

  const groupCounts = useMemo(() => {
    const m = new Map<string, { group: GroupDisplay; n: number }>();
    for (const p of points) {
      const cur = m.get(p.group.key);
      if (cur) cur.n += 1; else m.set(p.group.key, { group: p.group, n: 1 });
    }
    return [...m.values()].sort((a, b) => b.n - a.n);
  }, [points]);
  const shown = useMemo(() => points.filter(p => !hiddenGroups.has(p.group.key)), [points, hiddenGroups]);

  // ── Đo khoảng cách ──
  const branchPoints = useMemo(() => branches.filter(b => b.lat != null && b.lng != null)
    .map(b => ({ id: `${BRANCH}${b.id}`, label: `Chi nhánh ${b.name}`, lat: b.lat as number, lng: b.lng as number })), [branches]);
  const pointOf = useCallback((id: string): LatLng | null => {
    if (id === ME) return me;
    if (id.startsWith(BRANCH)) return branchPoints.find(b => b.id === id) ?? null;
    return shown.find(p => p.contact.id === id) ?? null;
  }, [shown, me, branchPoints]);
  const from = pair.from ? pointOf(pair.from) : null;
  const to = pair.to ? pointOf(pair.to) : null;
  const straightKm = from && to && pair.from !== pair.to ? haversineKm(from, to) : null;
  const routeKey = from && to ? `${from.lat},${from.lng};${to.lat},${to.lng}` : '';
  const routeNow = route?.key === routeKey ? route : null;
  const routeLoading = straightKm !== null && !routeNow && routeFailed !== routeKey;
  const pickOptions = useMemo(() => [
    ...(me ? [{ id: ME, label: 'Vị trí của tôi' }] : []),
    ...branchPoints.map(b => ({ id: b.id, label: b.label })),
    ...shown.map(p => ({ id: p.contact.id, label: [p.contact.fullName, p.contact.organization].filter(Boolean).join(' · ') })),
  ], [me, branchPoints, shown]);

  // Đường đi thực tế (OSRM, ô tô) — máy chủ công cộng không bảo đảm, lỗi thì chỉ còn chim bay
  useEffect(() => {
    if (!routeKey || straightKm === null || route?.key === routeKey) return;
    const ctrl = new AbortController();
    const [a, b] = routeKey.split(';').map(s => s.split(',').map(Number));
    fetch(`https://router.project-osrm.org/route/v1/driving/${a[1]},${a[0]};${b[1]},${b[0]}?overview=full&geometries=geojson`, { signal: ctrl.signal })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { routes?: { distance: number; duration: number; geometry: { coordinates: [number, number][] } }[] }) => {
        const r0 = d.routes?.[0];
        if (!r0) throw new Error('no route');
        setRoute({ key: routeKey, km: r0.distance / 1000, sec: r0.duration, line: r0.geometry.coordinates.map(([lng, lat]) => [lat, lng]) });
      })
      .catch((e: unknown) => { if ((e as { name?: string })?.name !== 'AbortError') setRouteFailed(routeKey); });
    return () => ctrl.abort();
  }, [routeKey, straightKm, route?.key]);

  const locateMe = () => {
    if (!('geolocation' in navigator)) { setMeError('Trình duyệt không hỗ trợ định vị.'); return; }
    setMeBusy(true);
    setMeError('');
    navigator.geolocation.getCurrentPosition(
      pos => { setMe({ lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy }); setMeBusy(false); },
      err => {
        setMeBusy(false);
        setMeError(err.code === err.PERMISSION_DENIED
          ? 'Chưa cho phép định vị — bật quyền Vị trí cho trang này trong trình duyệt rồi bấm lại.'
          : 'Không lấy được vị trí lúc này — thử lại sau.');
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
    );
  };
  const nearby = useMemo(() => (me ? nearestPoints(shown, me, 8) : []), [me, shown]);
  // Giữ nguyên đối tượng giữa các lần vẽ — bản đồ chỉ vẽ lại / phóng khi đường đo thật sự đổi
  const endpoints = useMemo(() => (measureOn && from && to && straightKm !== null
    ? { from, to, route: routeNow?.line ?? null, label: routeNow ? `${fmtDistance(routeNow.km)} · đường bộ` : routeLoading ? '' : `${fmtDistance(straightKm)} · chim bay` }
    : null), [measureOn, from, to, straightKm, routeNow, routeLoading]);

  // ── Định vị hàng loạt ──
  const locateAll = async () => {
    cancelRef.current = false;
    let ok = 0;
    let fail = 0;
    if (layer === 'current') {
      // Link Maps trước (nhanh, không tốn lượt Nominatim), rồi mới tra chữ
      const list = [...locatable.current].sort((a, b) => Number(!a.mapUrl.trim()) - Number(!b.mapUrl.trim()));
      setLocating({ done: 0, total: list.length });
      for (let i = 0; i < list.length; i += 1) {
        if (cancelRef.current) break;
        const c = list[i];
        try {
          const fromLink = c.mapUrl.trim() ? await mapLinkCoords(c.mapUrl, token) : null;
          if (fromLink) {
            await setContactGeo(c.id, { ...fromLink, source: 'map_url' });
            ok += 1;
          } else if (c.address.trim()) {
            const found = await geocodeAddressDetailed(c.address);
            if (found) { await setContactGeo(c.id, { lat: found.lat, lng: found.lng, source: 'address' }); ok += 1; } else fail += 1;
            await sleep(NOMINATIM_DELAY_MS);
          } else fail += 1;
        } catch (e) {
          toast('Lỗi định vị: ' + (e as Error).message);
          break;
        }
        setLocating({ done: i + 1, total: list.length });
      }
      emitCskhDataChanged();
    } else if (layer === 'origin') {
      const list = locatable.origin;
      const next = new Map(provinceGeo);
      setLocating({ done: 0, total: list.length });
      for (let i = 0; i < list.length; i += 1) {
        if (cancelRef.current) break;
        const found = await nominatimGeocode(provinceGeoQuery(list[i]));
        if (found) { next.set(list[i], found); ok += 1; } else fail += 1;
        setLocating({ done: i + 1, total: list.length });
        if (i < list.length - 1) await sleep(NOMINATIM_DELAY_MS);
      }
      writeProvinceCache(next);
      setProvinceGeo(next);
    }
    setLocating(null);
    toast(`Đã định vị ${ok} ${layer === 'origin' ? 'tỉnh' : 'người'}${fail ? ` · ${fail} không tìm được${layer === 'current' ? ' (dán link Google Maps vào hồ sơ để chính xác)' : ''}` : ''}`);
  };
  const locateCount = layer === 'current' ? locatable.current.length : layer === 'origin' ? locatable.origin.length : 0;

  if (!data) return loading ? <Spinner /> : <p className="py-16 text-center text-[13px] text-[#86868B]">Chưa tải được dữ liệu CSKH.</p>;

  const emptyText = layer === 'company'
    ? 'Chưa có ai để đặt lên bản đồ — chọn người chăm sóc, hoặc định vị công ty khách hàng ở Thị trường → Bản đồ.'
    : layer === 'current'
      ? 'Chưa ai có vị trí nhà hiện tại — nhập địa chỉ / dán link Google Maps trong hồ sơ rồi bấm "Định vị".'
      : 'Chưa ai có quê quán — chọn "Quê quán (tỉnh)" trong hồ sơ rồi bấm "Định vị".';

  return (
    <div className="space-y-4 md:space-y-5">
      <PageTitle
        eyebrow="Ai ở đâu"
        title={space === 'sale' ? 'Bản đồ Sale' : 'Bản đồ Khách hàng'}
        subtitle={<>
          {points.length} người trên lớp {MAP_LAYER_LABEL[layer].toLowerCase()}
          {missing > 0 && layer === 'company' && ` — ${missing} người thuộc công ty chưa có toạ độ (định vị ở Thị trường → Bản đồ)`}
          {missing > 0 && layer !== 'company' && ` — ${missing} người chưa có vị trí`}
        </>}
      />

      {!data.migrationReady && <MigrationBanner />}

      <div className="flex flex-wrap items-center gap-2">
        <Segmented label="Lớp vị trí" fit value={layer}
          onChange={l => { setLayer(l); setHiddenGroups(new Set()); setPair({ from: '', to: '' }); }}
          options={[
            ...(space === 'sale' ? [] : [{ key: 'company' as const, label: 'Công ty', icon: <Building2 size={14} />, badge: counts.company }]),
            { key: 'current', label: 'Nơi ở hiện tại', icon: <Home size={14} />, badge: counts.current },
            { key: 'origin', label: 'Quê quán', icon: <Sprout size={14} />, badge: counts.origin },
          ]} />
        <span className="flex-1" />
        <button type="button" onClick={locateMe} disabled={meBusy} className={me ? TOOL_ON : TOOL_OFF}>
          {meBusy ? <Loader2 size={14} className="animate-spin" /> : <LocateFixed size={14} />} Vị trí của tôi
        </button>
        <button type="button" aria-pressed={measureOn} onClick={() => { setMeasureOn(v => !v); setPair({ from: '', to: '' }); }}
          className={measureOn ? TOOL_ON : TOOL_OFF}>
          <Ruler size={14} /> Đo khoảng cách
        </button>
        {locateCount > 0 && (
          <button type="button" disabled={!data.migrationReady && layer === 'current'}
            onClick={locating ? () => { cancelRef.current = true; } : () => void locateAll()}
            className={TOOL_OFF} title={layer === 'origin' ? 'Tra tâm tỉnh quê (mỗi tỉnh 1 lần, nhớ trong máy)' : 'Link Google Maps trước, rồi tra chữ địa chỉ ~1 người/giây'}>
            {locating
              ? <><Loader2 size={14} className="animate-spin" /> {locating.done}/{locating.total} — bấm để dừng</>
              : <><Crosshair size={14} /> Định vị {locateCount}{layer === 'origin' ? ' tỉnh' : ''}</>}
          </button>
        )}
      </div>

      <CareScopeBar scope={scope} users={data.users} total={contacts.length} />

      <div className="flex flex-wrap items-center gap-1.5">
        {groupCounts.map(({ group, n }) => {
          const off = hiddenGroups.has(group.key);
          return (
            <button key={group.key} type="button" aria-pressed={!off}
              onClick={() => setHiddenGroups(prev => { const next = new Set(prev); if (off) next.delete(group.key); else next.add(group.key); return next; })}
              className={`inline-flex items-center gap-1.5 h-9 md:h-8 px-3 rounded-full text-[13px] font-medium transition ${off ? 'bg-black/[0.04] text-[#AEAEB2]' : ''}`}
              style={off ? undefined : chipStyle(group.color)}>
              <i className="w-2 h-2 rounded-full" style={{ background: off ? '#C7C7CC' : group.color }} />{group.label} <b className="tabular-nums">{n}</b>
            </button>
          );
        })}
        <span className="ml-auto"><Switch checked={includeOthers} onChange={setIncludeOthers} label="Cả người chưa chăm sóc" /></span>
      </div>

      {measureOn && (
        <div className={`${PANEL} p-3 md:p-4 space-y-2`}>
          <div className="flex flex-wrap items-center gap-2">
            <PointPicker options={pickOptions} value={pair.from} placeholder="Từ… (chi nhánh, người, vị trí của tôi)"
              onChange={id => setPair(p => ({ from: id, to: p.to === id ? '' : p.to }))} />
            <span className="text-[#86868B]" aria-hidden>→</span>
            <PointPicker options={pickOptions.filter(o => o.id !== pair.from)} value={pair.to} placeholder="Đến… (gõ tên hoặc chạm ghim)"
              onChange={id => setPair(p => ({ ...p, to: id }))} />
            {(pair.from || pair.to) && (
              <button type="button" onClick={() => setPair({ from: '', to: '' })} aria-label="Xoá điểm đo" className={`${PILL_GRAY} !w-9 !px-0`}>
                <X size={14} />
              </button>
            )}
          </div>
          <p className="text-[13px]">
            {straightKm === null ? (
              <span className="text-[#86868B]">Chọn 2 điểm — hoặc chạm 2 ghim trên bản đồ.</span>
            ) : routeLoading ? (
              <span className="text-[#86868B]"><Loader2 size={12} className="inline animate-spin -mt-0.5" /> Đang tính đường đi… · {fmtDistance(straightKm)} chim bay</span>
            ) : routeNow ? (
              <>
                <b className="text-[#0071E3]">≈ {fmtDistance(routeNow.km)}</b> đường bộ · khoảng {fmtDuration(routeNow.sec)} ô tô
                <span className="text-[#AEAEB2]"> · {fmtDistance(straightKm)} chim bay</span>
              </>
            ) : (
              <>
                <b className="text-[#D70015]">≈ {fmtDistance(straightKm)}</b> chim bay
                <span className="text-[#AEAEB2]"> · không lấy được đường đi</span>
              </>
            )}
          </p>
        </div>
      )}

      <div className={`relative ${PANEL} overflow-hidden`}>
        <MapCanvas
          points={shown}
          layer={layer}
          measureOn={measureOn}
          pair={pair}
          endpoints={endpoints}
          me={me}
          onPick={id => setPair(cur => (!cur.from || (cur.from && cur.to) ? { from: id, to: '' } : cur.from === id ? cur : { from: cur.from, to: id }))}
          onOpen={openProfile}
          focusRef={focusRef}
        />
        {points.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-white/80 backdrop-blur-sm text-[13px] text-[#6E6E73] text-center px-6 pointer-events-none">
            <span className="w-11 h-11 rounded-full bg-[#0071E3]/10 text-[#0071E3] flex items-center justify-center"><MapPinned size={20} /></span>
            {emptyText}
          </div>
        )}
      </div>

      {meError && <p className="text-[12.5px] text-[#D70015]">{meError}</p>}

      {me && (
        <div className={`${PANEL} px-4 md:px-5 py-3`}>
          <p className="text-[12px] font-semibold uppercase tracking-[0.04em] text-[#86868B] mb-1">Gần bạn · {MAP_LAYER_LABEL[layer].toLowerCase()}</p>
          {nearby.length === 0 ? (
            <p className="py-2 text-[13px] text-[#86868B]">Chưa có ai trên lớp này.</p>
          ) : (
            <ul>
              {nearby.map(n => (
                <li key={n.contact.id} className="flex items-center gap-2 py-1.5 border-b border-[#F0F0F2] last:border-0">
                  <button type="button" onClick={() => focusRef.current?.(n.contact.id)} className="min-w-0 flex-1 flex items-center gap-2.5 text-left">
                    <i className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: n.group.color }} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13.5px] font-medium text-[#1D1D1F] truncate">{n.contact.fullName}{n.verified ? ' ✓' : ''}</span>
                      <span className="block text-[12px] text-[#86868B] truncate">{[n.group.label, n.sub, n.approx ? 'tương đối' : ''].filter(Boolean).join(' · ')}</span>
                    </span>
                    <span className="shrink-0 text-[13px] font-semibold text-[#0066CC] tabular-nums">{fmtDistance(n.km)}</span>
                  </button>
                  <a href={`https://www.google.com/maps/dir/?api=1&origin=${me.lat},${me.lng}&destination=${n.lat},${n.lng}`} target="_blank" rel="noopener noreferrer"
                    aria-label={`Chỉ đường tới ${n.contact.fullName}`} title="Chỉ đường"
                    className="shrink-0 w-9 h-9 md:w-8 md:h-8 rounded-full bg-[#0071E3]/10 text-[#0066CC] flex items-center justify-center hover:bg-[#0071E3]/[0.16] transition">
                    <Navigation size={15} />
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/** Dấu tích xanh "vị trí chính xác" (SVG, kiểu huy hiệu xác minh). */
const TICK_SVG = '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><circle cx="8" cy="8" r="8" fill="#0071E3"/><path d="M4.6 8.3l2.2 2.2 4.6-4.8" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/**
 * Ghim kiểu PRM Tony Study: chấm màu nhóm + nhãn tên luôn hiện; ✓ xanh = vị trí chính xác (có link
 * Maps / chấm tay), "~ " + chấm viền đứt = tương đối (tra chữ, tâm tỉnh quê). Lớp công ty không có dấu.
 */
function pinHtml(p: Point, layer: MapLayer): string {
  const approx = layer !== 'company' && p.approx;
  const tick = layer !== 'company' && p.verified ? `<span class="lgmap-label-tick">${TICK_SVG}</span>` : '';
  return `<span class="lgmap-label${approx ? ' lgmap-label-approx' : ''}">`
    + `<span class="lgmap-label-dot" style="background:${p.group.color}"></span>`
    + `<span class="lgmap-label-name">${approx ? '~ ' : ''}<span class="lgmap-label-text">${escapeMapHtml(p.contact.fullName)}</span>${tick}</span>`
    + '</span>';
}

/**
 * Khung Leaflet: dựng bản đồ 1 lần, vẽ lại ghim khi `points` / chế độ đo đổi. Lần đầu và mỗi lần
 * đổi lớp thì phóng vừa khít các ghim. Chế độ đo: chạm ghim = chọn điểm A rồi B.
 */
function MapCanvas({ points, layer, measureOn, pair, endpoints, me, onPick, onOpen, focusRef }: {
  points: readonly Point[];
  layer: MapLayer;
  measureOn: boolean;
  pair: { from: string; to: string };
  endpoints: { from: LatLng; to: LatLng; route: [number, number][] | null; label: string } | null;
  me: (LatLng & { acc: number }) | null;
  onPick: (contactId: string) => void;
  onOpen: (contactId: string) => void;
  focusRef: MutableRefObject<((id: string) => void) | null>;
}) {
  const divRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const clusterRef = useRef<L.MarkerClusterGroup | null>(null);
  const overlayRef = useRef<L.LayerGroup | null>(null);
  const meLayerRef = useRef<L.LayerGroup | null>(null);
  const markerById = useRef(new Map<string, L.Marker>());
  const fittedRef = useRef('');
  const onOpenRef = useRef(onOpen);
  const onPickRef = useRef(onPick);
  onOpenRef.current = onOpen;
  onPickRef.current = onPick;

  useEffect(() => {
    const el = divRef.current;
    if (!el) return;
    const map = L.map(el, { scrollWheelZoom: true });
    const saved = loadDefaultView();
    if (saved) map.setView(saved.center, saved.zoom);
    else map.fitBounds(SOUTH_VN_BOUNDS);
    map.attributionControl.setPrefix(false);
    // OSM bị chặn ở một số mạng → tự chuyển nguồn dự phòng (lib/mapTiles)
    streetTiles().addTo(map);
    const cluster = L.markerClusterGroup({
      maxClusterRadius: 45,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
      iconCreateFunction: c => L.divIcon({ className: 'lgmap-cluster', html: `<div>${c.getChildCount()}</div>`, iconSize: [34, 34], iconAnchor: [17, 17] }),
    });
    map.addLayer(cluster);
    overlayRef.current = L.layerGroup().addTo(map);
    meLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    clusterRef.current = cluster;
    focusRef.current = (id: string) => {
      const m = markerById.current.get(id);
      if (m) cluster.zoomToShowLayer(m, () => m.openPopup());
    };
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(el);
    return () => { ro.disconnect(); map.remove(); mapRef.current = null; clusterRef.current = null; focusRef.current = null; };
  }, [focusRef]);

  useEffect(() => {
    const map = mapRef.current;
    const cluster = clusterRef.current;
    if (!map || !cluster) return;
    cluster.clearLayers();
    markerById.current.clear();
    for (const p of points) {
      const picked = measureOn && (pair.from === p.contact.id || pair.to === p.contact.id);
      // Neo ở tâm chấm tròn (16px); nhãn tên tràn sang phải như bản đồ PRM
      const icon = L.divIcon({
        className: `lgmap-label-marker${picked ? ' lgmap-label-picked' : ''}`,
        html: pinHtml(p, layer),
        iconSize: [16, 16],
        iconAnchor: [8, 8],
        popupAnchor: [0, -10],
      });
      const marker = L.marker([p.lat, p.lng], { icon });
      if (measureOn) {
        marker.on('click', () => onPickRef.current(p.contact.id));
      } else {
        const el = document.createElement('div');
        el.className = 'lgmap-popup';
        const where = p.approx ? 'vị trí tương đối' : p.verified ? 'vị trí chính xác' : '';
        el.innerHTML = `
          <div class="lgmap-popup-title" style="color:${p.group.color}">${escapeMapHtml(p.contact.fullName)}</div>
          <div class="lgmap-popup-sub">${escapeMapHtml([p.group.label, p.contact.jobTitle].filter(Boolean).join(' · '))}</div>
          ${p.sub || where ? `<div class="lgmap-popup-sub">${escapeMapHtml([p.sub, where].filter(Boolean).join(' · '))}</div>` : ''}`;
        const row = document.createElement('div');
        row.className = 'lgmap-popup-actions';
        const btn = document.createElement('button');
        btn.textContent = 'Mở hồ sơ';
        btn.onclick = () => onOpenRef.current(p.contact.id);
        const dir = document.createElement('a');
        dir.textContent = 'Chỉ đường';
        dir.href = `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`;
        dir.target = '_blank';
        dir.rel = 'noopener noreferrer';
        row.append(btn, dir);
        el.appendChild(row);
        marker.bindPopup(el, { closeButton: true, minWidth: 180 });
      }
      cluster.addLayer(marker);
      markerById.current.set(p.contact.id, marker);
    }
    const key = `${layer}:${points.length > 0}`;
    if (points.length && fittedRef.current !== key) {
      fittedRef.current = key;
      map.fitBounds(L.latLngBounds(points.map(p => [p.lat, p.lng] as [number, number])), { padding: [40, 40], maxZoom: 14 });
    }
  }, [points, layer, measureOn, pair.from, pair.to]);

  // Đường đo: chim bay (đỏ, nét đứt) + đường bộ (xanh), nhãn km ở giữa, khung vừa 2 điểm
  useEffect(() => {
    const map = mapRef.current;
    const overlay = overlayRef.current;
    if (!map || !overlay) return;
    overlay.clearLayers();
    if (!endpoints) return;
    const { from, to } = endpoints;
    for (const p of [from, to]) L.circleMarker([p.lat, p.lng], { radius: 6, color: '#0071E3', weight: 2, fillColor: '#fff', fillOpacity: 1 }).addTo(overlay);
    const straight = L.polyline([[from.lat, from.lng], [to.lat, to.lng]], { color: '#D70015', weight: 2, dashArray: '6 6', opacity: endpoints.route ? 0.55 : 1 }).addTo(overlay);
    let bounds = straight.getBounds();
    if (endpoints.route) {
      const line = L.polyline(endpoints.route, { color: '#0071E3', weight: 4, opacity: 0.85 }).addTo(overlay);
      line.bindTooltip(endpoints.label, { permanent: true, direction: 'center', className: 'lgmap-distance' });
      bounds = line.getBounds();
    } else if (endpoints.label) {
      straight.bindTooltip(endpoints.label, { permanent: true, direction: 'center', className: 'lgmap-distance lgmap-distance-alt' });
    }
    map.fitBounds(bounds, { padding: [48, 48], maxZoom: 15 });
  }, [endpoints]);

  // Chấm xanh "Vị trí của tôi" + vòng sai số
  useEffect(() => {
    const map = mapRef.current;
    const layerGroup = meLayerRef.current;
    if (!map || !layerGroup) return;
    layerGroup.clearLayers();
    if (!me) return;
    if (me.acc > 30) L.circle([me.lat, me.lng], { radius: me.acc, color: '#0071E3', weight: 1, fillOpacity: 0.08 }).addTo(layerGroup);
    L.marker([me.lat, me.lng], {
      icon: L.divIcon({ html: '<span class="lgmap-me"></span>', className: '', iconSize: [16, 16], iconAnchor: [8, 8] }),
      zIndexOffset: 1000,
    }).bindTooltip('Vị trí của tôi', { direction: 'top', offset: [0, -8] }).addTo(layerGroup);
    map.flyTo([me.lat, me.lng], Math.max(map.getZoom(), 12), { duration: 0.8 });
  }, [me]);

  return <div ref={divRef} className="h-[62vh] md:h-[640px] w-full" style={{ position: 'relative', isolation: 'isolate' }} />;
}
