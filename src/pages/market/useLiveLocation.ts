// Định vị trực tiếp trên bản đồ Thị trường kiểu Google Maps: chấm xanh + mũi tên xoay theo hướng đi, trượt mượt giữa các
// lần GPS báo, bản đồ tự bám theo, tự zoom theo tốc độ (chạy nhanh → thu xa, đi chậm → phóng gần).
// Kéo bản đồ thì thôi bám (bấm lại để bám tiếp); bấm khi đang bám thì tắt định vị.
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import L from 'leaflet';
import { bearing, smoothAngle } from '../../lib/kcnSurvey/heading';
import { glideMs, smartZoom } from '../../lib/kcnSurvey/mapView';

interface Pt { lat: number; lng: number }
const BASE_ZOOM = 16;

const ICON_HTML = `<div style="position:relative;width:44px;height:44px">
  <div style="position:absolute;inset:11px;border-radius:50%;background:#2563EB;border:3px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.15),0 2px 6px rgba(0,0,0,.35)"></div>
  <svg class="lgl-arrow" viewBox="0 0 44 44" width="44" height="44" style="position:absolute;inset:0;opacity:0;transition:opacity .3s">
    <path d="M22 1 L31 14 L22 10.5 L13 14 Z" fill="#2563EB" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/>
  </svg></div>`;

export function useLiveLocation(mapRef: MutableRefObject<L.Map | null>, onError: (msg: string) => void) {
  const [active, setActive] = useState(false);
  const [follow, setFollow] = useState(true);
  const followRef = useRef(true);
  const setFollowBoth = (v: boolean) => { followRef.current = v; setFollow(v); };

  const watchId = useRef<number | null>(null);
  const raf = useRef<number | null>(null);
  const marker = useRef<L.Marker | null>(null);
  const cur = useRef<Pt | null>(null);
  const anim = useRef<{ from: Pt; to: Pt; start: number; dur: number } | null>(null);
  const lastFix = useRef<{ p: Pt; at: number } | null>(null);
  const headTarget = useRef<number | null>(null);
  const headCur = useRef<number | null>(null);
  const speed = useRef<number | null>(null);
  const selfZoomUntil = useRef(0);
  const userZoomAt = useRef(0);
  const unbind = useRef<(() => void) | null>(null);

  const frame = useCallback(() => {
    raf.current = requestAnimationFrame(frame);
    const map = mapRef.current;
    const a = anim.current;
    if (!map || !a || !marker.current) return;
    const k = a.dur <= 0 ? 1 : Math.min(1, (performance.now() - a.start) / a.dur);
    const p = { lat: a.from.lat + (a.to.lat - a.from.lat) * k, lng: a.from.lng + (a.to.lng - a.from.lng) * k };
    cur.current = p;
    marker.current.setLatLng([p.lat, p.lng]);
    if (headTarget.current != null) {
      headCur.current = smoothAngle(headCur.current, headTarget.current, 0.15);
      const el = marker.current.getElement()?.querySelector<SVGElement>('.lgl-arrow');
      if (el) { el.style.opacity = '1'; el.style.transform = `rotate(${headCur.current}deg)`; }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (followRef.current && !(map as any)._animatingZoom) map.setView([p.lat, p.lng], map.getZoom(), { animate: false });
  }, [mapRef]);

  const onFix = useCallback((pos: GeolocationPosition) => {
    const map = mapRef.current;
    if (!map) return;
    const now = Date.now();
    const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    const prev = lastFix.current;
    const dM = prev ? map.distance([prev.p.lat, prev.p.lng], [p.lat, p.lng]) : 0;
    const dtS = prev ? (now - prev.at) / 1000 : 0;
    const sp = pos.coords.speed != null && Number.isFinite(pos.coords.speed) ? pos.coords.speed : prev && dtS > 0 && dtS < 20 ? dM / dtS : null;
    speed.current = sp;
    if (pos.coords.heading != null && Number.isFinite(pos.coords.heading) && (sp ?? 0) > 1) headTarget.current = pos.coords.heading;
    else if (prev && dM >= 8 && dtS < 20) headTarget.current = bearing(prev.p, p);
    if (!prev || dM >= 3) lastFix.current = { p, at: now };

    if (!marker.current) {
      marker.current = L.marker([p.lat, p.lng], {
        icon: L.divIcon({ className: '', html: ICON_HTML, iconSize: [44, 44], iconAnchor: [22, 22] }),
        zIndexOffset: 2000, interactive: false, keyboard: false,
      }).addTo(map);
      cur.current = p;
      anim.current = { from: p, to: p, start: performance.now(), dur: 0 };
      selfZoomUntil.current = now + 1500;
      map.setView([p.lat, p.lng], Math.max(map.getZoom(), BASE_ZOOM), { animate: true });
    } else {
      anim.current = { from: cur.current ?? p, to: p, start: performance.now(), dur: glideMs(prev ? now - prev.at : null, dM) };
    }
    // Tự zoom theo tốc độ (không làm khi người dùng vừa tự zoom)
    if (followRef.current && now - userZoomAt.current > 8000) {
      const z = smartZoom({ speed: sp, navDist: null, lat: p.lat, viewH: map.getSize().y, base: BASE_ZOOM });
      if (z !== map.getZoom() && Math.abs(z - map.getZoom()) >= 1 && prev) { selfZoomUntil.current = now + 1500; map.setZoom(z, { animate: true }); }
    }
  }, [mapRef]);

  const stop = useCallback(() => {
    if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current);
    watchId.current = null;
    if (raf.current != null) cancelAnimationFrame(raf.current);
    raf.current = null;
    unbind.current?.(); unbind.current = null;
    marker.current?.remove(); marker.current = null;
    cur.current = null; anim.current = null; lastFix.current = null; headTarget.current = null; headCur.current = null; speed.current = null;
    setActive(false);
  }, []);

  const start = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!navigator.geolocation) { onError('Trình duyệt không hỗ trợ định vị'); return; }
    setFollowBoth(true);
    setActive(true);
    const onDrag = () => setFollowBoth(false);
    const onZoomStart = () => { if (Date.now() > selfZoomUntil.current) userZoomAt.current = Date.now(); };
    map.on('dragstart', onDrag);
    map.on('zoomstart', onZoomStart);
    unbind.current = () => { map.off('dragstart', onDrag); map.off('zoomstart', onZoomStart); };
    watchId.current = navigator.geolocation.watchPosition(onFix, err => {
      onError('Không lấy được vị trí: ' + (err.code === 1 ? 'bạn chưa cấp quyền định vị' : err.message));
      if (err.code === 1) stop();
    }, { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 });
    raf.current = requestAnimationFrame(frame);
  }, [mapRef, onFix, onError, frame, stop]);

  /** Chưa bật → bật · đang xem chỗ khác → bám lại · đang bám → tắt */
  const toggle = useCallback(() => {
    if (!active) { start(); return; }
    if (!followRef.current) {
      setFollowBoth(true);
      const map = mapRef.current, p = cur.current;
      if (map && p) { selfZoomUntil.current = Date.now() + 1500; userZoomAt.current = 0; map.setView([p.lat, p.lng], Math.max(map.getZoom(), BASE_ZOOM), { animate: true }); }
      return;
    }
    stop();
  }, [active, start, stop, mapRef]);

  useEffect(() => stop, [stop]);
  return { active, follow, toggle };
}
