// Bản đồ của hồ sơ đơn vị nguồn: ghim trường + KCN / công ty quanh đó + tuyến xe khách đang chọn.
// Dùng cho cả khung nhỏ trong hồ sơ lẫn chế độ toàn màn hình (SourceMapFull).
//   • badge: nhãn nhỏ luôn hiện cạnh ghim (VD "25′" = phút xe khách) — bật bằng showBadges.
//   • Nút ◎ đưa trường về giữa bản đồ; nút ⤢ (onExpand) mở toàn màn hình.
//   • fitKey đổi (VD đổi bộ lọc) → khung nhìn vừa khít trường + các ghim đang hiện.
import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Crosshair, Maximize2 } from 'lucide-react';
import { streetTiles } from '../../../lib/mapTiles';
import { escapeMapHtml } from '../../../lib/mapGroups';

export interface MiniPoint { id: string; lat: number; lng: number; label: string; color: string; sub?: string; badge?: string }

const dot = (color: string, size: number, ring = '#fff') => L.divIcon({
  className: '',
  html: `<span style="display:block;width:${size}px;height:${size}px;border-radius:50%;background:${color};border:2.5px solid ${ring};box-shadow:0 1px 4px rgba(0,0,0,.35)"></span>`,
  iconSize: [size, size],
  iconAnchor: [size / 2, size / 2],
});

/** Ghim trường: vòng to + nhãn tên luôn hiện. */
const homeIcon = (color: string, label: string) => L.divIcon({
  className: '',
  html: `<span style="position:relative;display:block;width:22px;height:22px">
    <span style="position:absolute;inset:-7px;border-radius:50%;background:${color};opacity:.18"></span>
    <span style="position:absolute;inset:0;border-radius:50%;background:${color};border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.4)"></span>
    <span style="position:absolute;left:28px;top:1px;white-space:nowrap;max-width:200px;overflow:hidden;text-overflow:ellipsis;font:600 12px -apple-system,system-ui,sans-serif;color:#1D1D1F;background:rgba(255,255,255,.92);padding:1px 7px;border-radius:999px;box-shadow:0 1px 3px rgba(0,0,0,.2)">${escapeMapHtml(label)}</span>
  </span>`,
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

export default function RouteMiniMap({ home, homeColor, points, route, focusId, onPick, className = '', showBadges = false, fitKey, onExpand, roundedClass = 'rounded-[14px]' }: {
  home: { lat: number; lng: number; label: string };
  homeColor: string;
  points: MiniPoint[];
  /** Tuyến đang chọn ([lat, lng][]) — null = chưa chọn. */
  route: [number, number][] | null;
  focusId: string | null;
  onPick?: (id: string) => void;
  className?: string;
  /** Hiện nhãn badge cạnh mọi ghim (chế độ toàn màn hình). */
  showBadges?: boolean;
  /** Đổi giá trị → vừa khít trường + mọi ghim đang hiện. */
  fitKey?: string;
  /** Có thì hiện nút ⤢ mở toàn màn hình. */
  onExpand?: () => void;
  roundedClass?: string;
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
  const pointsKey = points.map(p => `${p.id}@${p.lat.toFixed(5)},${p.lng.toFixed(5)}:${p.badge ?? ''}`).join('|');

  useEffect(() => {
    const el = divRef.current;
    if (!el) return;
    const map = L.map(el, { scrollWheelZoom: showBadges, zoomControl: false });
    // Toàn màn hình: nút zoom xuống góc dưới (góc trên trái là nút Đóng)
    L.control.zoom({ position: showBadges ? 'bottomright' : 'topleft' }).addTo(map);
    map.attributionControl.setPrefix(false);
    streetTiles().addTo(map);
    map.setView([home.lat, home.lng], 11);
    mapRef.current = map;
    layerRef.current = L.layerGroup().addTo(map);
    if (!showBadges) {
      // Khung nhỏ: bấm vào bản đồ mới cho cuộn chuột zoom (để cuộn hồ sơ không bị kẹt)
      map.on('click', () => map.scrollWheelZoom.enable());
      map.on('mouseout', () => map.scrollWheelZoom.disable());
    }
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
      const focused = p.id === focusId;
      const m = L.marker([p.lat, p.lng], { icon: dot(p.color, focused ? 16 : 11), zIndexOffset: focused ? 500 : 0 });
      const tip = `<b>${escapeMapHtml(p.label)}</b>${p.sub ? `<br/>${escapeMapHtml(p.sub)}` : ''}`;
      if (showBadges && p.badge) {
        m.bindTooltip(`${escapeMapHtml(p.badge)}`, { permanent: true, direction: 'right', offset: [6, 0], className: 'lgsrc-badge' });
        m.bindPopup(tip, { closeButton: false, offset: [0, -4] });
        m.on('mouseover', () => m.openPopup());
        m.on('mouseout', () => m.closePopup());
      } else {
        m.bindTooltip(tip, { direction: 'top', offset: [0, -6] });
      }
      m.on('click', () => pickRef.current?.(p.id));
      m.addTo(layer);
    }
    L.marker([home.lat, home.lng], { icon: homeIcon(homeColor, home.label), zIndexOffset: 1000 }).addTo(layer);
  }, [pointsKey, focusId, home.lat, home.lng, home.label, homeColor, showBadges]);

  // Tuyến xe / KCN đang chọn
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    routeRef.current?.remove();
    routeRef.current = null;
    if (route && route.length > 1) {
      routeRef.current = L.polyline(route, { color: '#0071E3', weight: 5, opacity: 0.85 }).addTo(map);
      map.fitBounds(routeRef.current.getBounds(), { padding: [32, 32], maxZoom: 15 });
      return;
    }
    const focus = pointsRef.current.find(p => p.id === focusId);
    if (focus) map.fitBounds(L.latLngBounds([[home.lat, home.lng], [focus.lat, focus.lng]]), { padding: [40, 40], maxZoom: 14 });
  }, [route, focusId, home.lat, home.lng]);

  // Vừa khít trường + các ghim (lần đầu và khi đổi bộ lọc)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const pts = pointsRef.current;
    const pick = showBadges ? pts : [...pts].sort((a, b) => Math.hypot(a.lat - home.lat, a.lng - home.lng) - Math.hypot(b.lat - home.lat, b.lng - home.lng)).slice(0, 5);
    if (pick.length) map.fitBounds(L.latLngBounds([[home.lat, home.lng], ...pick.map(p => [p.lat, p.lng] as [number, number])]), { padding: [36, 36], maxZoom: 13 });
    else map.setView([home.lat, home.lng], 12);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, home.lat, home.lng]);

  const locate = () => mapRef.current?.setView([home.lat, home.lng], Math.max(13, mapRef.current.getZoom()), { animate: true });

  return (
    <div className={`isolate relative ${className}`}>
      <div ref={divRef} className={`w-full h-full ${roundedClass} overflow-hidden bg-[#E5E3DF]`} />
      <div className="absolute right-2.5 top-2.5 z-[1000] flex flex-col gap-1.5">
        <button type="button" onClick={locate} title="Về vị trí trường" aria-label="Về vị trí trường"
          className="w-9 h-9 rounded-full bg-white/95 shadow-[0_1px_4px_rgba(0,0,0,0.25)] text-[#0071E3] flex items-center justify-center active:scale-95"><Crosshair size={17} /></button>
        {onExpand && (
          <button type="button" onClick={onExpand} title="Mở toàn màn hình" aria-label="Mở toàn màn hình"
            className="w-9 h-9 rounded-full bg-white/95 shadow-[0_1px_4px_rgba(0,0,0,0.25)] text-[#1D1D1F] flex items-center justify-center active:scale-95"><Maximize2 size={16} /></button>
        )}
      </div>
    </div>
  );
}
