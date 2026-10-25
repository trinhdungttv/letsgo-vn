// Bản đồ nhỏ có 1 ghim nhà hiện tại (port PRM AddressPinMap): kéo ghim hoặc chạm vào bản đồ để
// chấm lại tay khi tra chữ ra sai. Điện thoại/iPad: vuốt 1 ngón vẫn cuộn hồ sơ (không kéo bản
// đồ), 2 ngón để phóng to. Khung có `isolation: isolate` để lớp Leaflet không đè nội dung khác
// khi cuộn trong hộp thoại.
import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { LatLng } from '../../../lib/cskh/nearby';
import { streetTiles } from '../../../lib/mapTiles';

const VIETNAM_CENTER: [number, number] = [16.0, 106.0];
const PIN_ZOOM = 17;

const pinIcon = (precise: boolean) => L.divIcon({
  className: 'lgmap-marker',
  html: `<span class="lgmap-pin${precise ? '' : ' lgmap-pin-approx'}" style="background:#D70015"></span>`,
  iconSize: [26, 34],
  iconAnchor: [13, 32],
});

export function AddressPinMap({ pin, precise, onPick, height = 200 }: {
  pin: LatLng | null;
  /** false = vị trí tương đối (tra chữ) → ghim viền đứt. */
  precise: boolean;
  onPick: (p: LatLng) => void;
  height?: number;
}) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const onPickRef = useRef(onPick);
  const pinRef = useRef(pin);
  const preciseRef = useRef(precise);
  onPickRef.current = onPick;
  pinRef.current = pin;
  preciseRef.current = precise;

  /** Đặt / dời ghim; recenter = đưa bản đồ về ghim (khi vị trí đổi từ bên ngoài). */
  const placeMarker = (p: LatLng, recenter: boolean) => {
    const map = mapRef.current;
    if (!map) return;
    if (!markerRef.current) {
      const marker = L.marker([p.lat, p.lng], { draggable: true, autoPan: true, keyboard: false, icon: pinIcon(preciseRef.current) }).addTo(map);
      marker.on('dragend', () => {
        const ll = marker.getLatLng();
        onPickRef.current({ lat: ll.lat, lng: ll.lng });
      });
      markerRef.current = marker;
    } else {
      markerRef.current.setLatLng([p.lat, p.lng]);
    }
    if (recenter) map.setView([p.lat, p.lng], Math.max(map.getZoom(), PIN_ZOOM - 1));
  };

  // Khởi tạo 1 lần
  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    const start = pinRef.current;
    const map = L.map(el, { dragging: !coarse, scrollWheelZoom: false })
      .setView(start ? [start.lat, start.lng] : VIETNAM_CENTER, start ? PIN_ZOOM : 5);
    map.attributionControl.setPrefix(false);
    streetTiles().addTo(map);
    map.on('click', (e: L.LeafletMouseEvent) => {
      placeMarker(e.latlng, false);
      onPickRef.current({ lat: e.latlng.lat, lng: e.latlng.lng });
    });
    mapRef.current = map;
    if (start) placeMarker(start, false);
    // Hộp hồ sơ có hiệu ứng mở → đo lại kích thước khi khung thật sự hiện
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(el);
    return () => { ro.disconnect(); map.remove(); mapRef.current = null; markerRef.current = null; };
    // placeMarker chỉ dùng ref — khởi tạo đúng 1 lần
  }, []);

  // Vị trí đổi từ bên ngoài (vừa tra địa chỉ / dán link) → đưa ghim + bản đồ tới đó
  useEffect(() => {
    const marker = markerRef.current;
    if (!pin) {
      marker?.remove();
      markerRef.current = null;
      return;
    }
    const cur = marker?.getLatLng();
    const same = cur && Math.abs(cur.lat - pin.lat) < 1e-7 && Math.abs(cur.lng - pin.lng) < 1e-7;
    if (!same) placeMarker(pin, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin?.lat, pin?.lng, pin === null]);

  useEffect(() => { markerRef.current?.setIcon(pinIcon(precise)); }, [precise]);

  return (
    <div ref={elRef} className="w-full rounded-[12px] shadow-[0_0_0_0.5px_rgba(0,0,0,0.1)]"
      style={{ height, position: 'relative', overflow: 'hidden', isolation: 'isolate' }} />
  );
}
