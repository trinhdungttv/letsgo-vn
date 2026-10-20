// ============================================================================
// Bản đồ Khách hàng (port PRM PrmMapPage) — Leaflet + OpenStreetMap, không cần API key.
// ----------------------------------------------------------------------------
// • Mặc định đặt người liên hệ tại VỊ TRÍ CÔNG TY (toạ độ clients.lat/lng sẵn có —
//   chốt 19/10/2026); chuyển "Nhà riêng" để xem theo toạ độ nhà (contacts.lat/lng).
// • Ghim màu theo nhóm, gom cụm khi thu nhỏ; popup: tên, nhóm, công ty, tỉnh + "Mở hồ sơ".
// • Lọc theo nhóm (chip có đếm) + Chi nhánh / Người phụ trách.
// • Định vị hàng loạt nhà riêng: toạ độ trong link Google Maps (tức thì, chính xác);
//   không có thì tra địa chỉ qua Nominatim tuần tự ~1 yêu cầu/giây.
// ============================================================================
import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import { LocateFixed, MapPinned } from 'lucide-react';
import { emitCskhDataChanged } from '../../lib/cskh/events';
import type { CskhContact } from '../../lib/cskh/types';
import { nominatimGeocode, parseLatLngFromLink, sleep } from '../../lib/geo';
import { escapeMapHtml, loadDefaultView, SOUTH_VN_BOUNDS } from '../../lib/mapGroups';
import { setContactGeo } from './data/api';
import { useCskh } from './context';
import { chipStyle, groupDisplayOf, type GroupDisplay } from './ui';
import { useCareScope } from './useCareScope';
import { MigrationBanner, Spinner } from './components/Card';
import { CareScopeBar } from './components/CareScopeBar';

type Mode = 'company' | 'home';

interface Point {
  contact: CskhContact;
  lat: number;
  lng: number;
  group: GroupDisplay;
  /** Dòng phụ trong popup: công ty · tỉnh. */
  sub: string;
}

export default function CskhMap() {
  const { data, loading, clients, toast, openProfile } = useCskh();
  const contacts = useMemo(() => data?.contacts ?? [], [data]);
  const scope = useCareScope(contacts, clients);
  const groupById = useMemo(() => new Map((data?.groups ?? []).map(g => [g.id, g])), [data]);
  const clientById = useMemo(() => new Map(clients.map(c => [c.id, c])), [clients]);
  const [mode, setMode] = useState<Mode>('company');
  const [includeOthers, setIncludeOthers] = useState(false);
  const [hiddenGroups, setHiddenGroups] = useState<ReadonlySet<string>>(() => new Set());
  const [geocoding, setGeocoding] = useState<{ done: number; total: number } | null>(null);
  const cancelRef = useRef(false);

  // Người được xét: đang chăm sóc (hoặc cả người chưa chăm sóc), chưa nghỉ, thuộc phạm vi lọc
  const people = useMemo(
    () => scope.scoped.filter(c => !c.isArchived && (includeOthers || c.tier !== 'unclassified')),
    [scope.scoped, includeOthers],
  );

  const { points, missing, locatable } = useMemo(() => {
    const pts: Point[] = [];
    const miss: CskhContact[] = [];
    const canLocate: CskhContact[] = [];
    for (const c of people) {
      const group = groupDisplayOf(c, groupById);
      if (mode === 'company') {
        const withGeo = [...c.primaryClientIds, ...c.clientIds]
          .map(id => clientById.get(id))
          .find(cl => cl && cl.lat != null && cl.lng != null);
        if (withGeo) {
          pts.push({ contact: c, lat: withGeo.lat as number, lng: withGeo.lng as number, group, sub: [withGeo.name, c.province].filter(Boolean).join(' · ') });
        } else miss.push(c);
      } else if (c.lat !== null && c.lng !== null) {
        pts.push({ contact: c, lat: c.lat, lng: c.lng, group, sub: [c.organization, c.province].filter(Boolean).join(' · ') });
      } else {
        miss.push(c);
        if (c.mapUrl.trim() || c.address.trim()) canLocate.push(c);
      }
    }
    return { points: pts, missing: miss, locatable: canLocate };
  }, [people, mode, groupById, clientById]);

  const groupCounts = useMemo(() => {
    const m = new Map<string, { group: GroupDisplay; n: number }>();
    for (const p of points) {
      const cur = m.get(p.group.key);
      if (cur) cur.n += 1; else m.set(p.group.key, { group: p.group, n: 1 });
    }
    return [...m.values()].sort((a, b) => b.n - a.n);
  }, [points]);
  const shown = useMemo(() => points.filter(p => !hiddenGroups.has(p.group.key)), [points, hiddenGroups]);

  // ── Định vị hàng loạt nhà riêng ──
  const geocodeAll = async () => {
    if (!locatable.length) return;
    cancelRef.current = false;
    setGeocoding({ done: 0, total: locatable.length });
    let ok = 0;
    let fail = 0;
    for (let i = 0; i < locatable.length; i += 1) {
      if (cancelRef.current) break;
      const c = locatable[i];
      try {
        const fromLink = parseLatLngFromLink(c.mapUrl);
        if (fromLink) {
          await setContactGeo(c.id, { ...fromLink, source: 'map_url' });
          ok += 1;
        } else if (c.address.trim()) {
          // Nominatim yêu cầu ≤ 1 yêu cầu/giây
          if (i > 0) await sleep(1100);
          const found = await nominatimGeocode([c.address, c.province].filter(Boolean).join(', '));
          if (found) { await setContactGeo(c.id, { ...found, source: 'address' }); ok += 1; } else fail += 1;
        } else fail += 1;
      } catch (e) {
        toast('Lỗi định vị: ' + (e as Error).message);
        break;
      }
      setGeocoding({ done: i + 1, total: locatable.length });
    }
    setGeocoding(null);
    emitCskhDataChanged();
    toast(`Đã định vị ${ok} người${fail ? ` · ${fail} người không tìm được địa chỉ (dán link Google Maps vào hồ sơ để chính xác)` : ''}`);
  };

  if (!data) return loading ? <Spinner /> : <p className="py-16 text-center text-[12.5px] text-[#999]">Chưa tải được dữ liệu CSKH.</p>;

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[19px] md:text-[20px] font-bold text-[#111] leading-tight">Bản đồ Khách hàng</h1>
          <p className="text-[12.5px] text-[#666] mt-0.5">
            {points.length} người trên bản đồ
            {mode === 'company'
              ? missing.length > 0 && ` — ${missing.length} người thuộc công ty chưa có toạ độ (định vị ở Thị trường → Bản đồ, hoặc dán link Maps vào hồ sơ khách hàng)`
              : locatable.length > 0 && ` — ${locatable.length} người có địa chỉ / link nhưng chưa định vị`}
          </p>
        </div>
        <div className="flex gap-0.5 bg-[#F4F3EF] border border-[#E8E7E2] rounded-lg p-0.5" role="group" aria-label="Đặt người liên hệ theo">
          {(['company', 'home'] as const).map(m => (
            <button key={m} type="button" onClick={() => { setMode(m); setHiddenGroups(new Set()); }} aria-pressed={mode === m}
              className={`px-3 h-9 md:h-7 rounded-md text-[12px] whitespace-nowrap ${mode === m ? 'bg-white text-[#333] font-medium border border-[#E0DFDA]' : 'text-[#888]'}`}>
              {m === 'company' ? 'Vị trí công ty' : 'Nhà riêng'}
            </button>
          ))}
        </div>
      </header>

      {!data.migrationReady && <MigrationBanner />}
      <CareScopeBar scope={scope} users={data.users} total={contacts.length} />

      <div className="flex flex-wrap items-center gap-1.5">
        {groupCounts.map(({ group, n }) => {
          const off = hiddenGroups.has(group.key);
          return (
            <button key={group.key} type="button" aria-pressed={!off}
              onClick={() => setHiddenGroups(prev => { const next = new Set(prev); if (off) next.delete(group.key); else next.add(group.key); return next; })}
              className={`inline-flex items-center gap-1 h-8 md:h-7 px-2.5 rounded-full text-[11.5px] font-medium border ${off ? 'opacity-40 border-transparent bg-[#F4F3EF] text-[#888]' : 'border-transparent'}`}
              style={off ? undefined : chipStyle(group.color)}>
              <i className="w-2 h-2 rounded-full" style={{ background: group.color }} />{group.label} <b>{n}</b>
            </button>
          );
        })}
        <label className="inline-flex items-center gap-1.5 text-[12px] text-[#666] cursor-pointer min-h-[32px] ml-auto">
          <input type="checkbox" checked={includeOthers} onChange={e => setIncludeOthers(e.target.checked)} className="w-4 h-4 accent-blue-600" />
          Cả người chưa chăm sóc
        </label>
      </div>

      {mode === 'home' && locatable.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 bg-blue-50 border border-blue-200 rounded-[10px] px-3 py-2 text-[12.5px] text-blue-900">
          <LocateFixed size={15} className="shrink-0" />
          {geocoding ? (
            <>
              <span>Đang định vị {geocoding.done}/{geocoding.total}… (tra địa chỉ ~1 người/giây)</span>
              <button type="button" onClick={() => { cancelRef.current = true; }} className="ml-auto h-8 md:h-7 px-3 rounded-lg border border-blue-300 bg-white text-[12px]">Dừng</button>
            </>
          ) : (
            <>
              <span>{locatable.length} người có địa chỉ / link Google Maps nhưng chưa định vị.</span>
              <button type="button" disabled={!data.migrationReady} onClick={() => void geocodeAll()}
                className="ml-auto h-8 md:h-7 px-3 rounded-lg bg-[#1D4ED8] text-white text-[12px] font-semibold disabled:bg-gray-400">
                Định vị {locatable.length} người
              </button>
            </>
          )}
        </div>
      )}

      <div className="relative bg-white border border-[#E8E7E2] rounded-[10px] overflow-hidden">
        <MapCanvas points={shown} fitKey={mode} onOpen={openProfile} />
        {points.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-white/80 text-[12.5px] text-[#888] text-center px-6 pointer-events-none">
            <MapPinned size={20} className="text-[#1D4ED8]" />
            {mode === 'company'
              ? 'Chưa có ai để đặt lên bản đồ — chọn người chăm sóc, hoặc định vị công ty khách hàng ở Thị trường → Bản đồ.'
              : 'Chưa ai có toạ độ nhà riêng — dán link Google Maps hoặc địa chỉ nhà trong hồ sơ rồi bấm "Định vị".'}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Khung Leaflet: dựng bản đồ 1 lần, vẽ lại ghim khi `points` đổi. Lần đầu và mỗi lần
 * đổi `fitKey` (chế độ công ty / nhà riêng) thì phóng vừa khít các ghim.
 */
function MapCanvas({ points, fitKey, onOpen }: { points: readonly Point[]; fitKey: string; onOpen: (contactId: string) => void }) {
  const divRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const clusterRef = useRef<L.MarkerClusterGroup | null>(null);
  const fittedRef = useRef('');
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;

  useEffect(() => {
    const el = divRef.current;
    if (!el) return;
    const map = L.map(el, { scrollWheelZoom: true });
    const saved = loadDefaultView();
    if (saved) map.setView(saved.center, saved.zoom);
    else map.fitBounds(SOUTH_VN_BOUNDS);
    map.attributionControl.setPrefix(false);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    const cluster = L.markerClusterGroup({
      maxClusterRadius: 45,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
      iconCreateFunction: c => L.divIcon({ className: 'lgmap-cluster', html: `<div>${c.getChildCount()}</div>`, iconSize: [34, 34], iconAnchor: [17, 17] }),
    });
    map.addLayer(cluster);
    mapRef.current = map;
    clusterRef.current = cluster;
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(el);
    return () => { ro.disconnect(); map.remove(); mapRef.current = null; clusterRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const cluster = clusterRef.current;
    if (!map || !cluster) return;
    cluster.clearLayers();
    for (const p of points) {
      const icon = L.divIcon({
        className: 'lgmap-marker',
        html: `<span class="lgmap-pin" style="background:${p.group.color}"></span>`,
        iconSize: [26, 34],
        iconAnchor: [13, 32],
        popupAnchor: [0, -30],
      });
      const marker = L.marker([p.lat, p.lng], { icon });
      marker.bindTooltip(escapeMapHtml(p.contact.fullName), { direction: 'top', offset: [0, -30], className: 'lgmap-tooltip' });
      const el = document.createElement('div');
      el.className = 'lgmap-popup';
      el.innerHTML = `
        <div class="lgmap-popup-title" style="color:${p.group.color}">${escapeMapHtml(p.contact.fullName)}</div>
        <div class="lgmap-popup-sub">${escapeMapHtml([p.group.label, p.contact.jobTitle].filter(Boolean).join(' · '))}</div>
        ${p.sub ? `<div class="lgmap-popup-sub">${escapeMapHtml(p.sub)}</div>` : ''}`;
      const row = document.createElement('div');
      row.className = 'lgmap-popup-actions';
      const btn = document.createElement('button');
      btn.textContent = 'Mở hồ sơ';
      btn.onclick = () => onOpenRef.current(p.contact.id);
      row.appendChild(btn);
      el.appendChild(row);
      marker.bindPopup(el, { closeButton: true, minWidth: 180 });
      cluster.addLayer(marker);
    }
    const key = `${fitKey}:${points.length > 0}`;
    if (points.length && fittedRef.current !== key) {
      fittedRef.current = key;
      map.fitBounds(L.latLngBounds(points.map(p => [p.lat, p.lng] as [number, number])), { padding: [40, 40], maxZoom: 14 });
    }
  }, [points, fitKey]);

  return <div ref={divRef} className="h-[62vh] md:h-[640px] w-full" />;
}
