import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import { Crosshair } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { shortId } from '../../hooks/useHashSubRoute';
import { parseLatLngFromLink, nominatimGeocode, isValidVnLatLng, sleep } from '../../lib/geo';
import type { Branch } from '../../lib/types';
import type { MarketTabProps } from './shared';

type Group = 'branch' | 'kcn' | 'client' | 'prospect';

interface MapPoint {
  id: string;
  group: Group;
  name: string;
  lat: number;
  lng: number;
  sub: string;
  mapLink: string | null;
  onOpen?: () => void;
}

const GROUPS: { id: Group; label: string; color: string }[] = [
  { id: 'branch', label: 'Chi nhánh', color: '#1D4ED8' },
  { id: 'kcn', label: 'Khu công nghiệp', color: '#D97706' },
  { id: 'client', label: 'KH đang hợp tác', color: '#059669' },
  { id: 'prospect', label: 'KH tiềm năng', color: '#7C3AED' },
];

const GROUP_COLOR: Record<Group, string> = Object.fromEntries(GROUPS.map(g => [g.id, g.color])) as Record<Group, string>;

const VN_CENTER: [number, number] = [16.05, 107.5];

export default function MapViewTab({ marketZones, clients, goTab, onRefresh, toast }: MarketTabProps) {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [activeGroups, setActiveGroups] = useState<Group[]>(GROUPS.map(g => g.id));
  const [geoProgress, setGeoProgress] = useState<{ done: number; total: number; current: string } | null>(null);
  const [showMissing, setShowMissing] = useState(false);
  const [linkInputs, setLinkInputs] = useState<Record<string, string>>({});
  const [savingLink, setSavingLink] = useState<string | null>(null);
  const mapDivRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const clusterRef = useRef<L.MarkerClusterGroup | null>(null);

  useEffect(() => {
    supabase.from('branches').select('*').then(({ data, error }) => {
      if (error) toast('Lỗi tải chi nhánh: ' + error.message);
      setBranches((data as Branch[]) ?? []);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeClients = useMemo(() => clients.filter(c => !c.archived_at), [clients]);

  const points = useMemo<MapPoint[]>(() => {
    const pts: MapPoint[] = [];
    branches.forEach(b => {
      if (b.lat == null || b.lng == null) return;
      pts.push({
        id: b.id, group: 'branch', name: b.short_name || b.name, lat: b.lat, lng: b.lng,
        sub: [b.manager_name && `QL: ${b.manager_name}`, b.address].filter(Boolean).join(' · '),
        mapLink: b.map_link,
        onOpen: () => { window.location.hash = `#/branches/${shortId(b.id)}`; },
      });
    });
    marketZones.forEach(z => {
      if (z.lat == null || z.lng == null) return;
      pts.push({
        id: z.id, group: 'kcn', name: z.name, lat: z.lat, lng: z.lng,
        sub: [z.location, z.total_workers != null && `${z.total_workers.toLocaleString('vi-VN')} LĐ`, `${z.lgv_clients} KH LGV`].filter(Boolean).join(' · '),
        mapLink: z.map_link ?? null,
        onOpen: () => goTab('zones'),
      });
    });
    activeClients.forEach(c => {
      if (c.lat == null || c.lng == null) return;
      pts.push({
        id: c.id, group: c.client_type === 'active' ? 'client' : 'prospect', name: c.name, lat: c.lat, lng: c.lng,
        sub: [(c.industrial_zones ?? [])[0], c.region, c.current_workers ? `${c.current_workers} LĐ` : null].filter(Boolean).join(' · '),
        mapLink: c.map_link ?? null,
        onOpen: () => { window.location.hash = `#/client-detail/${shortId(c.id)}`; },
      });
    });
    return pts;
  }, [branches, marketZones, activeClients, goTab]);

  const missingList = useMemo(() => {
    const list: { table: string; id: string; name: string; group: Group; link: string | null }[] = [
      ...branches.filter(x => x.lat == null || x.lng == null)
        .map(b => ({ table: 'branches', id: b.id, name: b.name, group: 'branch' as Group, link: b.map_link })),
      ...marketZones.filter(x => x.lat == null || x.lng == null)
        .map(z => ({ table: 'market_zones', id: z.id, name: z.name, group: 'kcn' as Group, link: z.map_link ?? null })),
      ...activeClients.filter(x => x.lat == null || x.lng == null)
        .map(c => ({ table: 'clients', id: c.id, name: c.name, group: (c.client_type === 'active' ? 'client' : 'prospect') as Group, link: c.map_link ?? null })),
    ];
    return list;
  }, [branches, marketZones, activeClients]);

  // Khởi tạo map một lần
  useEffect(() => {
    if (!mapDivRef.current || mapRef.current) return;
    const map = L.map(mapDivRef.current, { center: VN_CENTER, zoom: 6, scrollWheelZoom: true });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    const cluster = L.markerClusterGroup({
      maxClusterRadius: 45,
      iconCreateFunction: c => L.divIcon({
        className: 'lgmap-cluster',
        html: `<div>${c.getChildCount()}</div>`,
        iconSize: [34, 34],
        iconAnchor: [17, 17],
      }),
    });
    map.addLayer(cluster);
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
      const icon = L.divIcon({
        className: 'lgmap-marker',
        html: `<span class="lgmap-dot" style="background:${color}"></span><span class="lgmap-label">${escapeHtml(p.name)}</span>`,
        iconSize: [12, 12],
        iconAnchor: [6, 6],
      });
      const marker = L.marker([p.lat, p.lng], { icon });
      const el = document.createElement('div');
      el.className = 'lgmap-popup';
      el.innerHTML = `
        <div class="lgmap-popup-title" style="color:${color}">${escapeHtml(p.name)}</div>
        ${p.sub ? `<div class="lgmap-popup-sub">${escapeHtml(p.sub)}</div>` : ''}`;
      const row = document.createElement('div');
      row.className = 'lgmap-popup-actions';
      if (p.onOpen) {
        const btn = document.createElement('button');
        btn.textContent = 'Mở hồ sơ';
        btn.onclick = p.onOpen;
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
    if (shown.length) {
      const bounds = L.latLngBounds(shown.map(p => [p.lat, p.lng] as [number, number]));
      map.fitBounds(bounds.pad(0.15), { maxZoom: 12 });
    }
  }, [points, activeGroups]);

  // Dán link Google Maps cho một bản ghi thiếu toạ độ: parse @lat,lng và lưu vào DB.
  const saveLink = async (table: string, id: string) => {
    const link = (linkInputs[id] ?? '').trim();
    const pos = parseLatLngFromLink(link);
    if (!isValidVnLatLng(pos)) {
      toast('Không đọc được toạ độ từ link — hãy dùng link có dạng .../@lat,lng hoặc ?q=lat,lng');
      return;
    }
    setSavingLink(id);
    const { error } = await supabase.from(table)
      .update({ map_link: link, lat: pos.lat, lng: pos.lng, geocoded_at: new Date().toISOString() })
      .eq('id', id);
    setSavingLink(null);
    if (error) { toast('Lỗi lưu: ' + error.message); return; }
    toast('Đã lưu toạ độ');
    setLinkInputs(prev => ({ ...prev, [id]: '' }));
    if (table === 'branches') {
      const { data } = await supabase.from('branches').select('*');
      if (data) setBranches(data as Branch[]);
    } else {
      await onRefresh();
    }
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
      ...activeClients.filter(c => c.lat == null || c.lng == null).map(c => ({
        table: 'clients', id: c.id, name: c.name, link: c.map_link ?? null,
        query: [c.name, (c.industrial_zones ?? [])[0], 'Việt Nam'].filter(Boolean).join(', '),
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
        const { error } = await supabase.from(j.table)
          .update({ lat: pos.lat, lng: pos.lng, geocoded_at: new Date().toISOString() })
          .eq('id', j.id);
        if (error) fail++; else ok++;
      } else {
        fail++;
      }
    }
    setGeoProgress(null);
    toast(`Đã sinh toạ độ: ${ok} thành công${fail ? `, ${fail} không tìm được` : ''}`);
    const { data } = await supabase.from('branches').select('*');
    if (data) setBranches(data as Branch[]);
    await onRefresh();
  };

  return (
    <div className="space-y-3">
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
        {missingList.length > 0 && !geoProgress && (
          <button onClick={runGeocode}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-blue-50 border border-blue-200 text-blue-700 hover:bg-blue-100 transition">
            <Crosshair size={13} /> Sinh toạ độ ({missingList.length} thiếu)
          </button>
        )}
        {geoProgress && (
          <span className="text-[12px] text-[#888] inline-flex items-center gap-1.5">
            <span className="w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            {geoProgress.done + 1}/{geoProgress.total} · {geoProgress.current}
          </span>
        )}
      </div>

      <div className="bg-white border border-[#E8E7E2] rounded-[10px] overflow-hidden">
        <div ref={mapDivRef} style={{ height: 'calc(100vh - 260px)', minHeight: 420 }} />
      </div>

      {missingList.length > 0 && (
        <div className="bg-white border border-[#E8E7E2] rounded-[10px] overflow-hidden">
          <button onClick={() => setShowMissing(v => !v)}
            className="w-full px-4 py-2.5 text-left text-[12.5px] font-semibold text-[#111] flex items-center justify-between hover:bg-[#F9F9F7]">
            <span>Chưa có toạ độ ({missingList.length})</span>
            <span className="text-[11px] text-[#888] font-normal">
              Dán link Google Maps để định vị chính xác, hoặc bấm «Sinh toạ độ» để tra tự động {showMissing ? '▲' : '▼'}
            </span>
          </button>
          {showMissing && (
            <div className="border-t border-[#E8E7E2] divide-y divide-[#F0EEE9] max-h-72 overflow-y-auto">
              {missingList.map(m => (
                <div key={m.id} className="px-4 py-2 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full flex-none" style={{ backgroundColor: GROUP_COLOR[m.group] }} />
                  <span className="text-[12px] font-medium text-[#333] w-56 truncate">{m.name}</span>
                  <input
                    value={linkInputs[m.id] ?? ''}
                    onChange={e => setLinkInputs(prev => ({ ...prev, [m.id]: e.target.value }))}
                    placeholder="Dán link Google Maps (…/@lat,lng…)"
                    className="flex-1 text-[12px] px-2.5 py-1.5 border border-[#E8E7E2] rounded-lg outline-none focus:border-[#1D4ED8]"
                  />
                  <button
                    onClick={() => saveLink(m.table, m.id)}
                    disabled={savingLink === m.id || !(linkInputs[m.id] ?? '').trim()}
                    className="text-[11.5px] font-medium px-2.5 py-1.5 rounded-lg bg-blue-50 border border-blue-200 text-blue-700 hover:bg-blue-100 disabled:opacity-40 transition">
                    {savingLink === m.id ? 'Đang lưu…' : 'Lưu'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {points.length === 0 && missingList.length === 0 && (
        <div className="text-center py-6 text-[#aaa] text-[12.5px]">Chưa có dữ liệu để hiển thị trên bản đồ</div>
      )}
    </div>
  );
}

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
