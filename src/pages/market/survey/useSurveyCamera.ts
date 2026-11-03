// Camera bản đồ khảo sát kiểu Google Maps dẫn đường — chạy mỗi khung hình (requestAnimationFrame), ngoài React:
//  - Mũi tên TRƯỢT đều giữa 2 lần GPS báo (GPS ~1 lần/giây). Trước đây mũi tên nhảy từng bước còn bản đồ pan 0,8 s
//    chồng lên nhau → giật cục. Giờ bản đồ bám theo từng khung → mũi tên đứng yên trên màn hình, đường chạy bên dưới.
//  - Xoay bản đồ theo hướng đi: góc tiến dần mỗi khung (không còn CSS transition 0,8 s chồng nhau mỗi lần GPS báo).
//  - Kéo / chụm ngón / bấm trên bản đồ ĐANG XOAY: tự xử lý kéo (đổi hướng ngón tay theo góc xoay) và đổi toạ độ chạm
//    cho Leaflet (bấm ghim, chụm 2 ngón, nhấp đúp) → không còn phải bật về hướng Bắc khi chạm bản đồ.
import { useCallback, useEffect, useMemo, useRef, type RefObject } from 'react';
import L from 'leaflet';
import type { LatLng } from '../../../lib/geo';
import { angleDiff, normDeg } from '../../../lib/kcnSurvey/heading';
import { centerForOffset, glideMs, metersPerPixel, screenToMap, unwrapBearing } from '../../../lib/kcnSurvey/mapView';
import { distM } from '../../../lib/kcnSurvey/track';

export interface CameraGoal {
  /** đang bám theo vị trí */
  follow: boolean;
  /** góc xoay bản đồ muốn tới (độ, hướng ở trên màn hình); null = giữ nguyên góc đang xoay (đang xem tự do) */
  rot: number | null;
  /** chỗ đặt mũi tên trên màn hình so với tâm màn hình (px; x sang phải, y xuống dưới) khi bám */
  offset: { x: number; y: number };
}

export type ArrowHeading = { deg: number; source: 'course' | 'compass' } | null;

interface Opts {
  mapRef: RefObject<L.Map | null>;
  /** khung chứa Leaflet — được xoay bằng CSS */
  frameRef: RefObject<HTMLDivElement | null>;
  /** kim la bàn trên nút hướng bản đồ (xoay theo bản đồ) */
  needleRef: RefObject<SVGSVGElement | null>;
  getMarker: () => L.Marker | null;
  /** hướng mũi tên vị trí — gọi mỗi khung (la bàn đổi liên tục) */
  heading: () => ArrowHeading;
  /** người dùng kéo bản đồ → thôi bám */
  onUserPan: () => void;
  /** người dùng tự zoom (chụm ngón / nhấp đúp / cuộn chuột) */
  onUserZoom: (zoom: number) => void;
}

/** Góc xoay bản đồ đuổi theo hướng đi: hằng số thời gian (s) — ~1 s là xoay xong 1 khúc cua. */
const ROT_TAU = 0.35;
/** Bản đồ đuổi theo mũi tên (s): nhỏ = bám sát; bấm ◎ từ xa thì trượt về trong ~0,4 s. */
const PAN_TAU = 0.12;
/** Giảm tốc khi buông tay sau khi kéo (px/ms²) — giống Leaflet. */
const INERTIA_DECEL = 0.0034;

export function useSurveyCamera(o: Opts) {
  const opts = useRef(o);
  opts.current = o;
  const goal = useRef<CameraGoal>({ follow: true, rot: null, offset: { x: 0, y: 0 } });
  /** Góc xoay bản đồ đang hiển thị (độ, liên tục — không nhảy 359 → 0) */
  const rotRef = useRef(0);
  const st = useRef({
    from: null as LatLng | null, to: null as LatLng | null, t0: 0, dur: 0,
    lastFixAt: 0, interval: null as number | null,
    acc: 0, accPx: -1,
    head: null as number | null, headMode: '', headShown: NaN,
    zooming: false, dragging: false, userZoom: false,
    movedPx: 0, lastEnd: 0,
    markerLL: null as LatLng | null, markerEl: null as HTMLElement | null,
    frameEl: null as HTMLElement | null, rotShown: NaN, bearingVar: NaN,
    needleEl: null as Element | null, needleRot: NaN,
    inertia: null as null | { ux: number; uy: number; sp: number; rot: number; t0: number; done: number; ax: number; ay: number },
  });

  const posAt = useCallback((now: number): LatLng | null => {
    const s = st.current;
    if (!s.to) return null;
    if (!s.from || s.dur <= 0) return s.to;
    const k = Math.min(1, (now - s.t0) / s.dur);
    return { lat: s.from.lat + (s.to.lat - s.from.lat) * k, lng: s.from.lng + (s.to.lng - s.from.lng) * k };
  }, []);

  /** Vị trí mới (GPS / điểm trên lộ trình) → mũi tên trượt từ chỗ đang hiện tới đó. `fixAt` = giờ của điểm GPS. */
  const setTarget = useCallback((p: LatLng, fixAt: number) => {
    const s = st.current;
    const now = performance.now();
    if (s.to && Math.abs(s.to.lat - p.lat) < 2e-7 && Math.abs(s.to.lng - p.lng) < 2e-7) return;
    let gap = 0;
    if (fixAt !== s.lastFixAt) {
      if (s.lastFixAt) {
        gap = fixAt - s.lastFixAt;
        if (gap > 0 && gap < 10_000) s.interval = s.interval == null ? gap : s.interval * 0.7 + gap * 0.3;
      }
      s.lastFixAt = fixAt;
    }
    const cur = posAt(now);
    s.from = cur;
    s.to = p;
    s.t0 = now;
    s.dur = cur && gap < 4000 ? glideMs(s.interval, distM(cur, p)) : 0;
  }, [posAt]);

  const setAccuracy = useCallback((m: number) => { st.current.acc = m; }, []);

  /** Vị trí mũi tên đang hiện (đã nội suy). */
  const position = useCallback(() => posAt(performance.now()), [posAt]);

  /** Tâm bản đồ (ở mức zoom z) để mũi tên nằm đúng chỗ đã đặt trên màn hình. */
  const centerFor = useCallback((z: number): L.LatLng | null => {
    const map = opts.current.mapRef.current;
    const pos = posAt(performance.now());
    if (!map || !pos) return null;
    const c = centerForOffset(map.project([pos.lat, pos.lng], z), rotRef.current, goal.current.offset);
    return map.unproject(L.point(c.x, c.y), z);
  }, [posAt]);

  /** Đặt ngay mũi tên tại vị trí mới nhất + canh bản đồ ngay (lần đầu có GPS, bấm Bắt đầu, xoay màn hình). */
  const jump = useCallback((zoom?: number) => {
    const s = st.current, map = opts.current.mapRef.current;
    s.from = null; s.dur = 0;
    s.inertia = null;
    if (!map) return;
    const z = zoom ?? map.getZoom();
    const c = goal.current.follow ? centerFor(z) : null;
    if (c) map.setView(c, z, { animate: false });
    else if (zoom != null) map.setZoom(zoom, { animate: false });
  }, [centerFor]);

  /** Đổi zoom mà mũi tên đứng yên trên màn hình (tự zoom khi chạy). */
  const zoomAroundUser = useCallback((z: number) => {
    const map = opts.current.mapRef.current;
    const pos = posAt(performance.now());
    if (!map) return;
    if (pos && goal.current.follow) map.setZoomAround(L.latLng(pos.lat, pos.lng), z, { animate: true });
    else map.setZoom(z);
  }, [posAt]);

  // ── Vòng vẽ mỗi khung ─────────────────────────────────────────────────────
  useEffect(() => {
    let raf = 0, last = performance.now();
    const panPx = (map: L.Map, dx: number, dy: number) => {
      const rx = Math.round(dx), ry = Math.round(dy);
      if (!rx && !ry) return;
      const pane = map.getPane('mapPane');
      if (!pane) return;
      L.DomUtil.setPosition(pane, L.DomUtil.getPosition(pane).subtract(L.point(rx, ry)));
      map.fire('move');
      st.current.movedPx += Math.abs(rx) + Math.abs(ry);
    };
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const { mapRef, frameRef, needleRef, getMarker, heading } = opts.current;
      const map = mapRef.current;
      if (!map) return;
      const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
      last = now;
      const s = st.current, g = goal.current;
      // Đang bám: chụm 2 ngón / nhấp đúp zoom quanh tâm (không kéo bản đồ đi chỗ khác), xem tự do thì quanh ngón tay
      const zoomMode = g.follow ? 'center' : true;
      if (map.options.touchZoom !== zoomMode) { map.options.touchZoom = zoomMode; map.options.doubleClickZoom = zoomMode; map.options.scrollWheelZoom = zoomMode; }

      // 1. Góc xoay
      if (g.rot != null) {
        const want = unwrapBearing(rotRef.current, g.rot);
        const d = want - rotRef.current;
        rotRef.current = Math.abs(d) < 0.05 ? want : rotRef.current + d * (1 - Math.exp(-dt / ROT_TAU));
      }
      const r = rotRef.current;
      const frame = frameRef.current;
      if (frame) {
        if (frame !== s.frameEl || !(Math.abs(r - s.rotShown) < 0.01)) { frame.style.transform = `rotate(${-r}deg)`; s.rotShown = r; }
        // Nhãn tên / ảnh xoay ngược cho đứng thẳng — đổi biến CSS ít thôi (mỗi 0,3°) cho đỡ tính lại kiểu chữ
        if (frame !== s.frameEl || !(Math.abs(r - s.bearingVar) < 0.3)) { frame.style.setProperty('--kcs-bearing', `${r.toFixed(2)}deg`); s.bearingVar = r; }
        s.frameEl = frame;
      }
      const needle = needleRef.current;
      if (needle && (needle !== s.needleEl || !(Math.abs(r - s.needleRot) < 0.05))) {
        (needle as unknown as HTMLElement).style.transform = `rotate(${-r}deg)`;
        s.needleEl = needle; s.needleRot = r;
      }

      // 2. Mũi tên: vị trí trượt + vòng sai số + hướng
      const pos = posAt(now);
      const marker = getMarker();
      const el = marker?.getElement() ?? null;
      if (el && el !== s.markerEl) { s.markerEl = el; s.headMode = ''; s.accPx = -1; s.headShown = NaN; s.markerLL = null; }
      if (marker && pos && !s.zooming && (!s.markerLL || s.markerLL.lat !== pos.lat || s.markerLL.lng !== pos.lng)) {
        marker.setLatLng([pos.lat, pos.lng]);
        s.markerLL = pos;
      }
      if (el && pos) {
        const px = Math.min(3000, Math.round((2 * s.acc) / metersPerPixel(pos.lat, map.getZoom())));
        if (px !== s.accPx) { el.style.setProperty('--kcs-acc', `${px}px`); s.accPx = px; }
        const h = heading();
        const mode = h ? h.source : 'none';
        if (mode !== s.headMode) { el.dataset.mode = mode; s.headMode = mode; if (!h) s.head = null; }
        if (h) {
          const k = 1 - Math.exp(-dt / (h.source === 'compass' ? 0.25 : 0.18));
          s.head = s.head == null ? normDeg(h.deg) : normDeg(s.head + angleDiff(s.head, h.deg) * k);
          if (!(Math.abs(angleDiff(s.head, s.headShown)) < 0.1)) { el.style.setProperty('--kcs-head', `${s.head.toFixed(1)}deg`); s.headShown = s.head; }
        }
      }

      // 3. Trôi tiếp sau khi buông tay kéo
      const I = s.inertia;
      if (I) {
        const t = now - I.t0, end = I.sp / INERTIA_DECEL, tt = Math.min(t, end);
        const dist = I.sp * tt - 0.5 * INERTIA_DECEL * tt * tt;
        const m = screenToMap({ x: I.ux * (dist - I.done), y: I.uy * (dist - I.done) }, I.rot);
        I.done = dist;
        I.ax += m.x; I.ay += m.y;
        const rx = Math.round(I.ax), ry = Math.round(I.ay);
        I.ax -= rx; I.ay -= ry;
        panPx(map, -rx, -ry);
        if (t >= end) { s.inertia = null; s.movedPx = 0; s.lastEnd = now; map.fire('moveend'); }
      }

      // 4. Bám theo mũi tên
      if (g.follow && pos && !s.zooming && !s.dragging && !s.inertia) {
        const z = map.getZoom();
        const want = centerForOffset(map.project([pos.lat, pos.lng], z), r, g.offset);
        const cur = map.project(map.getCenter(), z);
        const dx = want.x - cur.x, dy = want.y - cur.y, dist = Math.hypot(dx, dy);
        if (dist > 4000) map.setView(map.unproject(L.point(want.x, want.y), z), z, { animate: false });
        else if (dist >= 0.5) {
          const step = Math.min(dist, Math.max(1, dist * (1 - Math.exp(-dt / PAN_TAU))));
          panPx(map, (dx / dist) * step, (dy / dist) * step);
        }
      }
      // Báo "đã dịch xong" thưa thôi (vẽ lại lớp đường / tải ô bản đồ) — mỗi 1,5 s hoặc dịch quá 140 px
      if (s.movedPx > 0 && !s.dragging && !s.inertia && (s.movedPx >= 140 || now - s.lastEnd > 1500)) {
        s.movedPx = 0; s.lastEnd = now;
        map.fire('moveend');
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [posAt]);

  // ── Chạm / kéo trên bản đồ (kể cả khi đang xoay) ──────────────────────────
  useEffect(() => {
    const map = opts.current.mapRef.current, frame = opts.current.frameRef.current;
    if (!map || !frame) return;
    const s = st.current;
    // Toạ độ chạm cho Leaflet khi khung đang xoay (bấm ghim công ty, chụm 2 ngón, nhấp đúp, cuộn chuột)
    const base = map.mouseEventToContainerPoint.bind(map);
    (map as unknown as { mouseEventToContainerPoint: (e: MouseEvent | Touch) => L.Point }).mouseEventToContainerPoint = e => {
      const r = rotRef.current;
      if (Math.abs(angleDiff(0, r)) < 0.01) return base(e as MouseEvent);
      const rect = map.getContainer().getBoundingClientRect();
      const v = screenToMap({ x: e.clientX - (rect.left + rect.width / 2), y: e.clientY - (rect.top + rect.height / 2) }, r);
      const size = map.getSize();
      return L.point(size.x / 2 + v.x, size.y / 2 + v.y);
    };
    const onZoomStart = () => { s.zooming = true; };
    const onZoomEnd = () => {
      s.zooming = false; s.markerLL = null;
      if (s.userZoom) { s.userZoom = false; opts.current.onUserZoom(map.getZoom()); }
    };
    map.on('zoomstart', onZoomStart);
    map.on('zoomend', onZoomEnd);

    const pane = map.getPane('mapPane')!;
    const pointers = new Map<number, true>();
    let drag: null | { id: number; sx: number; sy: number; start: L.Point; rot: number; moved: boolean; samples: { t: number; x: number; y: number }[] } = null;
    const suppressClick = () => {
      const kill = (ev: Event) => { ev.stopPropagation(); ev.preventDefault(); };
      window.addEventListener('click', kill, { capture: true, once: true });
      window.setTimeout(() => window.removeEventListener('click', kill, { capture: true }), 350);
    };
    const endDrag = (inertia: boolean, at = 0) => {
      const d = drag;
      drag = null;
      if (!d?.moved) return;
      s.dragging = false;
      suppressClick();
      const a = d.samples[0], b = d.samples[d.samples.length - 1];
      if (inertia && a && b && b.t > a.t && at - b.t < 80) {
        const vx = (b.x - a.x) / (b.t - a.t), vy = (b.y - a.y) / (b.t - a.t);
        const sp = Math.min(1.6, Math.hypot(vx, vy)); // vuốt mạnh cũng chỉ trôi tối đa ~380 px
        if (sp > 0.25) {
          const n = Math.hypot(vx, vy);
          s.inertia = { ux: vx / n, uy: vy / n, sp, rot: d.rot, t0: performance.now(), done: 0, ax: 0, ay: 0 };
          return;
        }
      }
      s.movedPx = 0; s.lastEnd = performance.now();
      map.fire('moveend');
    };
    const onDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      pointers.set(e.pointerId, true);
      if (s.inertia) { s.inertia = null; map.fire('moveend'); }
      if (pointers.size === 1) {
        drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, start: L.DomUtil.getPosition(pane), rot: rotRef.current, moved: false, samples: [] };
      } else {
        // 2 ngón = chụm zoom (Leaflet lo) → bỏ kéo
        s.userZoom = true;
        endDrag(false);
      }
    };
    const onMove = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id || pointers.size > 1) return;
      if (!drag.moved) {
        if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 6) return;
        drag.moved = true;
        drag.sx = e.clientX; drag.sy = e.clientY;
        drag.start = L.DomUtil.getPosition(pane);
        drag.rot = rotRef.current;
        s.dragging = true;
        s.inertia = null;
        map.fire('movestart');
        opts.current.onUserPan();
        try { frame.setPointerCapture(e.pointerId); } catch { /* trình duyệt cũ */ }
      }
      // Ngón tay dịch trên màn hình → nội dung bản đồ dịch đúng theo ngón (đổi sang hệ toạ độ bản đồ chưa xoay)
      const m = screenToMap({ x: e.clientX - drag.sx, y: e.clientY - drag.sy }, drag.rot);
      L.DomUtil.setPosition(pane, drag.start.add(L.point(Math.round(m.x), Math.round(m.y))));
      map.fire('move');
      drag.samples.push({ t: e.timeStamp, x: e.clientX, y: e.clientY });
      while (drag.samples.length > 2 && e.timeStamp - drag.samples[0].t > 100) drag.samples.shift();
    };
    const onUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (drag && e.pointerId === drag.id) endDrag(e.type === 'pointerup', e.timeStamp);
    };
    const onWheel = () => { s.userZoom = true; };
    const onDbl = () => { s.userZoom = true; };
    // Nhả tay có thể ở ngoài khung (chuột) → nghe ở window để không kẹt "đang giữ 1 ngón"
    frame.addEventListener('pointerdown', onDown);
    frame.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    frame.addEventListener('wheel', onWheel, { passive: true });
    frame.addEventListener('dblclick', onDbl);
    return () => {
      map.off('zoomstart', onZoomStart);
      map.off('zoomend', onZoomEnd);
      frame.removeEventListener('pointerdown', onDown);
      frame.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      frame.removeEventListener('wheel', onWheel);
      frame.removeEventListener('dblclick', onDbl);
    };
  }, []);

  return useMemo(() => ({ goal, rotRef, setTarget, setAccuracy, position, centerFor, jump, zoomAroundUser }),
    [setTarget, setAccuracy, position, centerFor, jump, zoomAroundUser]);
}
