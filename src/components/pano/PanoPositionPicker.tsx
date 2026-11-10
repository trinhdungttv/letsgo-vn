// Chọn chỗ đứng chụp ảnh 360 trên bản đồ nhỏ: kéo ghim / bấm vào bản đồ, hoặc lấy GPS trong ảnh, vị trí điện thoại,
// dán link Google Maps (cả link rút gọn maps.app.goo.gl).
import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Camera, Layers, Link2, Loader2, LocateFixed } from 'lucide-react';
import { streetTiles } from '../../lib/mapTiles';
import { isValidVnLatLng, type LatLng } from '../../lib/geo';
import { mapLinkCoords } from '../../modules/cskh/data/mapLink';
import { getStoredSessionToken } from '../../lib/sessionToken';

export default function PanoPositionPicker({ value, onChange, fallbackCenter, photoGps, height = 260 }: {
  value: LatLng | null;
  onChange: (p: LatLng) => void;
  fallbackCenter: LatLng;
  /** Toạ độ đọc được trong ảnh (nếu có). */
  photoGps?: LatLng | null;
  height?: number;
}) {
  const divRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const satRef = useRef<L.TileLayer | null>(null);
  const streetRef = useRef<L.LayerGroup | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [sat, setSat] = useState(true);
  const [link, setLink] = useState('');
  const [linkBusy, setLinkBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [locating, setLocating] = useState(false);

  useEffect(() => {
    if (!divRef.current || mapRef.current) return;
    const start = value ?? fallbackCenter;
    const map = L.map(divRef.current, { center: [start.lat, start.lng], zoom: value ? 17 : 15, zoomControl: true, attributionControl: false });
    streetRef.current = streetTiles();
    satRef.current = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 });
    satRef.current.addTo(map);
    const icon = L.divIcon({
      className: 'lgmap-marker',
      html: '<span class="lgmap-pin lgmap-pin-has-icon" style="background:#0A84FF"><span class="lgmap-pin-icon">📷</span></span>',
      iconSize: [26, 34], iconAnchor: [13, 32],
    });
    const marker = L.marker([start.lat, start.lng], { icon, draggable: true }).addTo(map);
    marker.on('dragend', () => { const p = marker.getLatLng(); onChangeRef.current({ lat: round(p.lat), lng: round(p.lng) }); });
    map.on('click', e => { marker.setLatLng(e.latlng); onChangeRef.current({ lat: round(e.latlng.lat), lng: round(e.latlng.lng) }); });
    mapRef.current = map;
    markerRef.current = marker;
    if (!value) onChangeRef.current({ lat: round(start.lat), lng: round(start.lng) });
    const t = setTimeout(() => map.invalidateSize(), 80);
    return () => { clearTimeout(t); map.remove(); mapRef.current = null; markerRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Giá trị đổi từ ngoài (GPS trong ảnh, vị trí điện thoại, link) → dời ghim
  useEffect(() => {
    const m = markerRef.current, map = mapRef.current;
    if (!m || !map || !value) return;
    const cur = m.getLatLng();
    if (Math.abs(cur.lat - value.lat) > 1e-7 || Math.abs(cur.lng - value.lng) > 1e-7) {
      m.setLatLng([value.lat, value.lng]);
      map.setView([value.lat, value.lng], Math.max(map.getZoom(), 17));
    }
  }, [value]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !satRef.current || !streetRef.current) return;
    if (sat) { map.removeLayer(streetRef.current); satRef.current.addTo(map); }
    else { map.removeLayer(satRef.current); streetRef.current.addTo(map); }
  }, [sat]);

  const useMyLocation = () => {
    if (!navigator.geolocation) { setMsg('Máy không hỗ trợ định vị.'); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      p => { setLocating(false); setMsg(''); onChange({ lat: round(p.coords.latitude), lng: round(p.coords.longitude) }); },
      () => { setLocating(false); setMsg('Không lấy được vị trí (chưa cho phép định vị?).'); },
      { enableHighAccuracy: true, timeout: 12_000 },
    );
  };

  const applyLink = async () => {
    setLinkBusy(true);
    setMsg('');
    const p = await mapLinkCoords(link, getStoredSessionToken()).catch(() => null);
    setLinkBusy(false);
    if (p && isValidVnLatLng(p)) { onChange({ lat: round(p.lat), lng: round(p.lng) }); setLink(''); }
    else setMsg('Chưa đọc được toạ độ trong link — dán link Google Maps có dạng …/@10.97,106.63,…');
  };

  return (
    <div className="space-y-2">
      <div className="relative rounded-xl overflow-hidden border border-[#E0E0E5]" style={{ height }}>
        <div ref={divRef} className="absolute inset-0" />
        <button type="button" onClick={() => setSat(s => !s)}
          className="absolute top-2 right-2 z-[500] h-8 px-2.5 rounded-lg bg-white/95 border border-[#D8D6D0] text-[11.5px] font-medium text-[#333] shadow inline-flex items-center gap-1">
          <Layers size={13} /> {sat ? 'Bản đồ đường' : 'Vệ tinh'}
        </button>
        <div className="absolute bottom-2 left-2 z-[500] px-2 py-1 rounded-md bg-black/60 text-white text-[11px] pointer-events-none">
          Kéo ghim 📷 hoặc bấm vào chỗ đứng chụp
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {photoGps && isValidVnLatLng(photoGps) && (
          <button type="button" onClick={() => onChange(photoGps)}
            className="h-8 px-2.5 rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-700 text-[12px] font-medium inline-flex items-center gap-1.5">
            <Camera size={13} /> Dùng GPS trong ảnh
          </button>
        )}
        <button type="button" onClick={useMyLocation} disabled={locating}
          className="h-8 px-2.5 rounded-lg border border-[#D8D6D0] bg-white text-[#333] text-[12px] font-medium inline-flex items-center gap-1.5 disabled:opacity-50">
          {locating ? <Loader2 size={13} className="animate-spin" /> : <LocateFixed size={13} />} Vị trí của tôi
        </button>
        <div className="flex-1 min-w-[200px] flex items-center gap-1.5">
          <div className="relative flex-1">
            <Link2 size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#999]" />
            <input value={link} onChange={e => setLink(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && link.trim()) void applyLink(); }}
              placeholder="hoặc dán link Google Maps"
              className="w-full h-8 pl-7 pr-2 rounded-lg border border-[#D8D6D0] text-[12px] outline-none focus:border-[#1D4ED8]" />
          </div>
          <button type="button" onClick={() => void applyLink()} disabled={!link.trim() || linkBusy}
            className="h-8 px-2.5 rounded-lg bg-[#1D4ED8] text-white text-[12px] font-medium disabled:opacity-40">
            {linkBusy ? <Loader2 size={13} className="animate-spin" /> : 'Đặt'}
          </button>
        </div>
      </div>
      {value && <div className="text-[11px] text-[#888] tabular-nums">Vị trí chụp: {value.lat.toFixed(6)}, {value.lng.toFixed(6)}</div>}
      {msg && <div className="text-[11.5px] text-amber-700">{msg}</div>}
    </div>
  );
}

const round = (n: number) => Math.round(n * 1e7) / 1e7;
