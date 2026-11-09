// Bản đồ nhỏ trong hồ sơ đơn vị nguồn: ghim trường + KCN / công ty quanh đó + tuyến xe khách đang chọn.
import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { streetTiles } from '../../../lib/mapTiles';
import { escapeMapHtml } from '../../../lib/mapGroups';

export interface MiniPoint { id: string; lat: number; lng: number; label: string; color: string; sub?: string }

const dot = (color: string, size: number, ring = '#fff') => L.divIcon({
  className: '',
  html: `<span style="display:block;width:${size}px;height:${size}px;border-radius:50%;background:${color};border:2.5px solid ${ring};box-shadow:0 1px 4px rgba(0,0,0,.35)"></span>`,
  iconSize: [size, size],
  iconAnchor: [size / 2, size / 2],
});

export default function RouteMiniMap({ home, homeColor, points, route, focusId, onPick, className = '' }: {
  home: { lat: number; lng: number; label: string };
  homeColor: string;
  points: MiniPoint[];
  /** Tuyến đang chọn ([lat, lng][]) — null = chưa chọn. */
  route: [number, number][] | null;
  focusId: string | null;
  onPick?: (id: string) => void;
  className?: string;
}) {
  const divRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const routeRef = useRef<L.Polyline | null>(null);
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  const pointsRef = useRef(points);
  pointsRef.current = points;
  // Danh sách ghim tạo lại mỗi lần cha vẽ lại → so bằng chuỗi khoá để không vẽ lại / nhảy khung vô cớ
  const pointsKey = points.map(p => `${p.id}@${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join('|');

  useEffect(() => {
    const el = divRef.current;
    if (!el) return;
    const map = L.map(el, { scrollWheelZoom: false, zoomControl: true });
    map.attributionControl.setPrefix(false);
    streetTiles().addTo(map);
    map.setView([home.lat, home.lng], 11);
    mapRef.current = map;
    layerRef.current = L.layerGroup().addTo(map);
    // Bấm vào bản đồ mới cho cuộn chuột zoom (để cuộn hồ sơ không bị kẹt)
    map.on('click', () => map.scrollWheelZoom.enable());
    map.on('mouseout', () => map.scrollWheelZoom.disable());
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(el);
    return () => { ro.disconnect(); map.remove(); mapRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ghim
  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    for (const p of pointsRef.current) {
      const m = L.marker([p.lat, p.lng], { icon: dot(p.color, p.id === focusId ? 16 : 11) })
        .bindTooltip(`<b>${escapeMapHtml(p.label)}</b>${p.sub ? `<br/>${escapeMapHtml(p.sub)}` : ''}`, { direction: 'top', offset: [0, -6] });
      m.on('click', () => pickRef.current?.(p.id));
      m.addTo(layer);
    }
    L.marker([home.lat, home.lng], { icon: dot(homeColor, 20), zIndexOffset: 1000 })
      .bindTooltip(`<b>${escapeMapHtml(home.label)}</b>`, { direction: 'top', offset: [0, -10], permanent: false })
      .addTo(layer);
  }, [pointsKey, focusId, home.lat, home.lng, home.label, homeColor]);

  // Tuyến xe
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    routeRef.current?.remove();
    routeRef.current = null;
    if (route && route.length > 1) {
      routeRef.current = L.polyline(route, { color: '#0071E3', weight: 5, opacity: 0.85 }).addTo(map);
      map.fitBounds(routeRef.current.getBounds(), { padding: [24, 24], maxZoom: 15 });
    } else {
      const pts = pointsRef.current;
      const focus = pts.find(p => p.id === focusId);
      if (focus) map.fitBounds(L.latLngBounds([[home.lat, home.lng], [focus.lat, focus.lng]]), { padding: [36, 36], maxZoom: 14 });
      else {
        // Vừa khít trường + 5 điểm gần nhất
        const near = [...pts].sort((a, b) => Math.hypot(a.lat - home.lat, a.lng - home.lng) - Math.hypot(b.lat - home.lat, b.lng - home.lng)).slice(0, 5);
        if (near.length) map.fitBounds(L.latLngBounds([[home.lat, home.lng], ...near.map(p => [p.lat, p.lng] as [number, number])]), { padding: [30, 30], maxZoom: 13 });
      }
    }
    // Khung nhìn chỉ đổi khi chọn tuyến / KCN khác, không theo mỗi lần ghim vẽ lại
  }, [route, focusId, home.lat, home.lng]);

  return <div className={`isolate ${className}`}><div ref={divRef} className="w-full h-full rounded-[14px] overflow-hidden bg-[#E5E3DF]" /></div>;
}
