import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

/** Bản đồ nhỏ 1 điểm (OpenStreetMap, không cần API key) — cùng kiểu ghim `lgmap-pin` với tab
 *  Bản đồ Thị trường. Bọc `isolate` để các lớp z-index của Leaflet (400–1000) không đè lên
 *  hộp thoại mở chồng trong cùng modal. Tự `invalidateSize` khi khung đổi kích thước (đổi
 *  kiểu hiển thị bên phải / giữa / toàn màn hình). */
export default function MiniMap({ lat, lng, label, color = '#7C3AED', zoom = 15, className = '' }: {
  lat: number;
  lng: number;
  label?: string;
  color?: string;
  zoom?: number;
  className?: string;
}) {
  const divRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const initView = useRef({ lat, lng, zoom });

  useEffect(() => {
    const el = divRef.current;
    if (!el) return;
    const { lat: la, lng: ln, zoom: z } = initView.current;
    // Cuộn chuột trong modal là để cuộn hồ sơ — không zoom bản đồ (dùng nút +/−).
    const map = L.map(el, { center: [la, ln], zoom: z, scrollWheelZoom: false });
    map.attributionControl.setPrefix(false);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    mapRef.current = map;
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(el);
    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    markerRef.current?.remove();
    const icon = L.divIcon({
      className: 'lgmap-marker',
      html: `<span class="lgmap-pin" style="background:${color}"></span>`,
      iconSize: [26, 34],
      iconAnchor: [13, 32],
    });
    const marker = L.marker([lat, lng], { icon }).addTo(map);
    if (label) marker.bindTooltip(label.replace(/[<>&"]/g, ''), { direction: 'top', offset: [0, -30], className: 'lgmap-tooltip' });
    markerRef.current = marker;
    map.setView([lat, lng], map.getZoom());
  }, [lat, lng, label, color]);

  return <div ref={divRef} className={`isolate z-0 ${className}`} />;
}
