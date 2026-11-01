import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import { streetTiles } from '../lib/mapTiles';
import {
  MAP_GROUPS, MAP_GROUP_COLOR, loadGroupIcons, loadDefaultView, SOUTH_VN_BOUNDS, escapeMapHtml,
  type MapContextPoint,
} from '../lib/mapGroups';

export interface LatLngLite { lat: number; lng: number }
/** Ghim phụ luôn hiện (nhà máy theo KCN): số thứ tự trong ghim, tên khi rê chuột. */
export interface MiniMapSite extends LatLngLite { key: string; label: string; badge: string }
/** Yêu cầu dời khung nhìn: 1 điểm → phóng tới, nhiều điểm → vừa khít tất cả. Đổi `key` để chạy lại. */
export interface MiniMapView { key: number; to: LatLngLite[] }

const GROUP_LABEL = Object.fromEntries(MAP_GROUPS.map(g => [g.id, g.label])) as Record<string, string>;
const PIN_COLOR = '#DC2626';

/** Bản đồ nhỏ trong hồ sơ công ty (OpenStreetMap, không cần API key):
 *  - Ghim đỏ nổi bật = công ty đang mở.
 *  - `others` = các điểm của tab Bản đồ Thị trường (chi nhánh, KCN, khách hàng, công ty/dự án) —
 *    cùng màu/icon, gom cụm khi thu nhỏ, để phóng ra là thấy xung quanh có gì.
 *  - `picking`: bấm lên bản đồ hoặc kéo ghim để chọn vị trí → `onPick`.
 *  Bọc `isolate` để các lớp z-index của Leaflet không đè hộp thoại mở chồng trong modal.
 *  Cuộn chuột chỉ zoom bản đồ sau khi bấm vào bản đồ (để cuộn hồ sơ không bị kẹt). */
export default function MiniMap({ pin, pinLabel, others, sites, view, picking = false, onPick, className = '' }: {
  pin: LatLngLite | null;
  pinLabel?: string;
  others?: MapContextPoint[];
  /** Ghim phụ của chính công ty (nhà máy ở các KCN khác) — không gom cụm. */
  sites?: MiniMapSite[];
  view?: MiniMapView | null;
  picking?: boolean;
  onPick?: (p: LatLngLite) => void;
  className?: string;
}) {
  const divRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const clusterRef = useRef<L.MarkerClusterGroup | null>(null);
  const sitesRef = useRef<L.LayerGroup | null>(null);
  const pickRef = useRef({ picking, onPick });
  pickRef.current = { picking, onPick };
  const initPin = useRef(pin);

  useEffect(() => {
    const el = divRef.current;
    if (!el) return;
    const map = L.map(el, { scrollWheelZoom: false });
    const p0 = initPin.current;
    const saved = loadDefaultView();
    if (p0) map.setView([p0.lat, p0.lng], 15);
    else if (saved) map.setView(saved.center, saved.zoom);
    else map.fitBounds(SOUTH_VN_BOUNDS);
    map.attributionControl.setPrefix(false);
    // OSM bị chặn ở một số mạng → tự chuyển nguồn dự phòng (lib/mapTiles)
    streetTiles().addTo(map);
    const cluster = L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 40, spiderfyOnMaxZoom: true });
    map.addLayer(cluster);
    clusterRef.current = cluster;
    sitesRef.current = L.layerGroup().addTo(map);
    map.on('click', e => {
      map.scrollWheelZoom.enable();
      const { picking: on, onPick: cb } = pickRef.current;
      if (on && cb) cb({ lat: e.latlng.lat, lng: e.latlng.lng });
    });
    map.on('mouseout', () => map.scrollWheelZoom.disable());
    mapRef.current = map;
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(el);
    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
      clusterRef.current = null;
      sitesRef.current = null;
    };
  }, []);

  // Ghim nhà máy theo KCN — vẽ lại khi đổi toạ độ / số thứ tự
  const sitesKey = (sites ?? []).map(s => `${s.key}:${s.lat},${s.lng}:${s.badge}:${s.label}`).join('|');
  useEffect(() => {
    const layer = sitesRef.current;
    if (!layer) return;
    layer.clearLayers();
    (sites ?? []).forEach(s => {
      const icon = L.divIcon({
        className: 'lgmap-marker',
        html: `<span class="lgmap-pin lgmap-pin-has-icon lgmap-pin-site" style="background:${PIN_COLOR}"><span class="lgmap-pin-icon">${escapeMapHtml(s.badge)}</span></span>`,
        iconSize: [26, 32],
        iconAnchor: [13, 31],
      });
      L.marker([s.lat, s.lng], { icon, zIndexOffset: 900 })
        .bindTooltip(escapeMapHtml(s.label), { direction: 'top', offset: [0, -28], className: 'lgmap-tooltip' })
        .addTo(layer);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sitesKey]);

  // Dời khung nhìn theo yêu cầu (xem 1 nhà máy / xem tất cả)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !view?.to.length) return;
    if (view.to.length === 1) map.setView([view.to[0].lat, view.to[0].lng], Math.max(map.getZoom(), 14));
    else map.fitBounds(L.latLngBounds(view.to.map(p => [p.lat, p.lng] as [number, number])), { padding: [28, 28], maxZoom: 15 });
  }, [view?.key]);

  // Lớp điểm xung quanh (giống tab Bản đồ Thị trường)
  useEffect(() => {
    const cluster = clusterRef.current;
    if (!cluster) return;
    cluster.clearLayers();
    if (!others?.length) return;
    const glyphs = loadGroupIcons();
    cluster.addLayers(others.map(p => {
      const glyph = glyphs[p.group]?.trim();
      const icon = L.divIcon({
        className: 'lgmap-marker',
        html: `<span class="lgmap-pin lgmap-pin-sm${glyph ? ' lgmap-pin-has-icon' : ''}" style="background:${MAP_GROUP_COLOR[p.group]}">${glyph ? `<span class="lgmap-pin-icon">${escapeMapHtml(glyph)}</span>` : ''}</span>`,
        iconSize: [20, 26],
        iconAnchor: [10, 25],
      });
      return L.marker([p.lat, p.lng], { icon }).bindTooltip(
        `${escapeMapHtml(p.name)} <span style="font-weight:400;color:#888">· ${GROUP_LABEL[p.group]}</span>`,
        { direction: 'top', offset: [0, -24], className: 'lgmap-tooltip' },
      );
    }));
  }, [others]);

  // Ghim của công ty đang mở — theo toạ độ (không theo object) để không vẽ lại mỗi lần render
  const pinLat = pin?.lat ?? null;
  const pinLng = pin?.lng ?? null;
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    markerRef.current?.remove();
    markerRef.current = null;
    if (pinLat == null || pinLng == null) return;
    const icon = L.divIcon({
      className: 'lgmap-marker',
      html: `<span class="lgmap-pin lgmap-pin-main" style="background:${PIN_COLOR}"></span>`,
      iconSize: [30, 38],
      iconAnchor: [15, 36],
    });
    const marker = L.marker([pinLat, pinLng], { icon, zIndexOffset: 1000, draggable: picking }).addTo(map);
    if (pinLabel) marker.bindTooltip(escapeMapHtml(pinLabel), { direction: 'top', offset: [0, -34], className: 'lgmap-tooltip' });
    marker.on('dragend', () => {
      const ll = marker.getLatLng();
      pickRef.current.onPick?.({ lat: ll.lat, lng: ll.lng });
    });
    markerRef.current = marker;
    if (!map.getBounds().contains([pinLat, pinLng])) map.setView([pinLat, pinLng], Math.max(map.getZoom(), 14));
  }, [pinLat, pinLng, pinLabel, picking]);

  useEffect(() => {
    const el = divRef.current;
    if (el) el.classList.toggle('lgmini-picking', picking);
  }, [picking]);

  // Khung ngoài do React đổi class (cao/thấp); khung trong để Leaflet tự gắn class của nó —
  // nếu dùng chung 1 div, mỗi lần React đổi className sẽ xoá mất class leaflet-container.
  return (
    <div className={`relative isolate z-0 ${className}`}>
      <div ref={divRef} className="absolute inset-0" />
    </div>
  );
}
