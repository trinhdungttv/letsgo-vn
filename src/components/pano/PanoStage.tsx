// Khung xem ảnh 360°: vẽ ảnh bằng WebGL (panoGL.ts) + lớp phủ HTML/SVG (nét vẽ, ghim công ty) do component cha vẽ
// qua render-prop `overlay(view)`. Kéo để xoay, lăn chuột / chụm 2 ngón để phóng, thả tay có quán tính.
// Chạm nhẹ (không kéo) → onTap(hướng trong ảnh). Kéo phần tử có data-drag="…" → onItemDrag (dời đỉnh, dời nhãn, căn ghim).
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { GpuMemoryError, PanoRenderer, loadPanoImage, type Coverage, type PanoDrawer } from './panoGL';
import { PanoSoftRenderer } from './panoSoft';
import { HFOV_DEFAULT, HFOV_MAX, HFOV_MIN, clamp, unproject, wrapYaw, type PanoView, type SphPt } from '../../lib/pano/sphere';
import {
  RENDER_BUDGET_DESKTOP, RENDER_BUDGET_PHONE, TEX_BUDGET_DESKTOP, TEX_BUDGET_LOW, TEX_BUDGET_PHONE, renderDpr,
} from '../../lib/pano/quality';

export interface PanoStageHandle {
  getView(): { yaw: number; pitch: number; hfov: number };
  /** Quay mượt tới hướng (yaw, pitch) — giữ hfov nếu không truyền. */
  lookAt(yaw: number, pitch?: number, hfov?: number): void;
  zoomBy(k: number): void;
}

export interface PanoStageProps {
  sources: string[];
  coverage: Coverage;
  initialView?: { yaw: number; pitch: number; hfov: number } | null;
  /** Điện thoại (kể cả xoay ngang): góc nhìn đầu hẹp hơn, trần bộ nhớ / điểm ảnh của điện thoại. */
  mobile: boolean;
  /** Khoảng cách từ đáy khung tới dòng báo "chế độ nhẹ" (CSS) — để không đè la bàn / nút phóng to của màn cha. */
  noticeBottom?: string;
  overlay: (v: PanoView) => ReactNode;
  onTap?: (pt: SphPt, target: Element | null, sx: number, sy: number) => void;
  /** Bắt đầu kéo phần tử data-drag → trả false để bỏ qua (khi đó kéo = xoay ảnh). */
  onItemDrag?: (key: string, pt: SphPt, phase: 'start' | 'move' | 'end') => boolean | void;
  onHover?: (pt: SphPt | null) => void;
  onDoubleTap?: (pt: SphPt) => void;
  cursor?: string;
}

type Ptr = { x: number; y: number };
type Gesture =
  | { kind: 'idle' }
  | { kind: 'press'; id: number; start: Ptr; t: number; target: Element | null; dragKey: string | null }
  | { kind: 'pan'; id: number; last: Ptr; lastT: number; vx: number; vy: number }
  | { kind: 'item'; id: number; key: string }
  | { kind: 'pinch'; d0: number; hfov0: number };

const TAP_PX = 6;
const MAX_FLING = 2.2;

const PanoStage = forwardRef<PanoStageHandle, PanoStageProps>(function PanoStage(props, ref) {
  const { sources, coverage, initialView, mobile, overlay, cursor, noticeBottom } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<PanoDrawer | null>(null);
  // Bộ vẽ: WebGL, hoặc CPU khi máy không có WebGL (localStorage lgpano_engine = 'soft' để ép thử)
  const [engine, setEngine] = useState<'webgl' | 'soft'>(() => { try { return localStorage.getItem('lgpano_engine') === 'soft' ? 'soft' : 'webgl'; } catch { return 'webgl'; } });
  // Mất WebGL / hết bộ nhớ đồ hoạ với ảnh cỡ gốc → thử lại 1 lần với ảnh nhỏ hơn rồi mới chuyển sang vẽ CPU
  const [lowMem, setLowMem] = useState(false);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setViewState] = useState(() => {
    // Điện thoại cầm dọc: góc ngang hẹp lại để góc dọc ~100° (không giãn méo trên / dưới), giống Google Photos
    const w = window.innerWidth, h = window.innerHeight;
    const portraitMax = h > w ? clamp((2 * Math.atan(Math.tan((50 * Math.PI) / 180) * (w / h)) * 180) / Math.PI, 45, 80) : 120;
    const base = initialView?.hfov ?? (mobile ? 80 : HFOV_DEFAULT);
    return { yaw: initialView?.yaw ?? 0, pitch: initialView?.pitch ?? 0, hfov: Math.min(base, portraitMax) };
  });
  const viewRef = useRef(view);
  const [status, setStatus] = useState<{ s: 'loading'; msg: string } | { s: 'ready' } | { s: 'error'; msg: string }>({ s: 'loading', msg: 'Đang tải ảnh 360…' });
  const anim = useRef<number | null>(null);
  const pointers = useRef(new Map<number, Ptr>());
  const gesture = useRef<Gesture>({ kind: 'idle' });
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  const maxPitch = coverage.vaov >= 179 ? 90 : Math.max(0, coverage.voffset + coverage.vaov / 2);
  const minPitch = coverage.vaov >= 179 ? -90 : Math.min(0, coverage.voffset - coverage.vaov / 2);

  const setView = useCallback((v: { yaw: number; pitch: number; hfov: number }) => {
    const next = { yaw: wrapYaw(v.yaw), pitch: clamp(v.pitch, minPitch, maxPitch), hfov: clamp(v.hfov, HFOV_MIN, HFOV_MAX) };
    viewRef.current = next;
    setViewState(next);
  }, [minPitch, maxPitch]);

  const stopAnim = () => { if (anim.current != null) { cancelAnimationFrame(anim.current); anim.current = null; } };

  useImperativeHandle(ref, () => ({
    getView: () => viewRef.current,
    lookAt(yaw, pitch, hfov) {
      stopAnim();
      const from = viewRef.current;
      const to = { yaw: from.yaw + wrapYaw(yaw - from.yaw), pitch: pitch ?? from.pitch, hfov: hfov ?? from.hfov };
      const t0 = performance.now(), dur = 550;
      const step = (now: number) => {
        const k = Math.min(1, (now - t0) / dur);
        const e = 1 - Math.pow(1 - k, 3);
        setView({ yaw: from.yaw + (to.yaw - from.yaw) * e, pitch: from.pitch + (to.pitch - from.pitch) * e, hfov: from.hfov + (to.hfov - from.hfov) * e });
        anim.current = k < 1 ? requestAnimationFrame(step) : null;
      };
      anim.current = requestAnimationFrame(step);
    },
    zoomBy(k) { stopAnim(); const v = viewRef.current; setView({ ...v, hfov: v.hfov * k }); },
  }), [setView]);

  // ── Kích thước khung ── (lấy số lẻ — làm tròn thì canvas bị kéo giãn chút xíu khi hiển thị, cả khung nhoè)
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const read = () => { const r = el.getBoundingClientRect(); setSize(s => (s.w === r.width && s.h === r.height ? s : { w: r.width, h: r.height })); };
    const ro = new ResizeObserver(read);
    ro.observe(el);
    read();
    return () => ro.disconnect();
  }, []);

  // ── Dựng bộ vẽ + tải ảnh ──
  // WebGL trước; máy không có WebGL (tắt tăng tốc đồ hoạ / GPU bị chặn) → vẽ bằng CPU (panoSoft.ts). Hết bộ nhớ đồ hoạ với ảnh
  // cỡ gốc → thử lại 1 lần với ảnh nhỏ hơn (lowMem), vẫn hỏng mới sang CPU.
  // Mỗi lần dựng = 1 canvas MỚI: 1 canvas chỉ có 1 kiểu context, và context WebGL đã giải phóng (loseContext) thì không dùng lại được
  // (React StrictMode dựng 2 lần → trước đây lần 2 luôn rơi xuống chế độ CPU).
  const srcKey = sources.join('|');
  useEffect(() => {
    const host = canvasHostRef.current;
    if (!host) return;
    const canvas = document.createElement('canvas');
    canvas.className = 'absolute inset-0 w-full h-full block';
    host.appendChild(canvas);
    let alive = true;
    let r: PanoDrawer;
    const toSoft = (why: unknown) => {
      console.warn('Ảnh 360: chuyển sang chế độ vẽ không cần WebGL —', (why as Error)?.message ?? why);
      if (alive) setEngine('soft');
    };
    const gpuTrouble = (why: unknown) => {
      if (lowMem) { toSoft(why); return; }
      console.warn('Ảnh 360: thiếu bộ nhớ đồ hoạ — nạp lại ảnh nhỏ hơn —', (why as Error)?.message ?? why);
      if (alive) setLowMem(true);
    };
    try {
      r = engine === 'webgl' ? new PanoRenderer(canvas) : new PanoSoftRenderer(canvas);
    } catch (e) {
      canvas.remove();
      if (engine === 'webgl') toSoft(e);
      else setStatus({ s: 'error', msg: (e as Error).message });
      return;
    }
    rendererRef.current = r;
    setStatus({ s: 'loading', msg: 'Đang tải ảnh 360…' });
    const budget = lowMem ? TEX_BUDGET_LOW : mobile ? TEX_BUDGET_PHONE : TEX_BUDGET_DESKTOP;
    loadPanoImage(sources, msg => { if (alive) setStatus({ s: 'loading', msg }); })
      .then(({ img }) => {
        if (!alive) return;
        try {
          r.setImage(img, coverage, budget);
        } catch (e) {
          if (engine === 'webgl') { if (e instanceof GpuMemoryError) gpuTrouble(e); else toSoft(e); return; }
          throw e;
        }
        setStatus({ s: 'ready' });
      })
      .catch(e => { if (alive) setStatus({ s: 'error', msg: (e as Error).message }); });
    const onLost = (ev: Event) => { ev.preventDefault(); gpuTrouble(new Error('mất WebGL (hết bộ nhớ đồ hoạ)')); };
    canvas.addEventListener('webglcontextlost', onLost);
    return () => {
      alive = false;
      canvas.removeEventListener('webglcontextlost', onLost);
      r.dispose();
      rendererRef.current = null;
      canvas.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [srcKey, coverage.haov, coverage.vaov, coverage.voffset, engine, lowMem]);

  // ── Vẽ lại khi khung nhìn / cỡ đổi ── (đúng mật độ điểm ảnh màn hình: iPhone 3×, có trần số điểm ảnh)
  useEffect(() => {
    const r = rendererRef.current;
    if (!r || !size.w || !size.h) return;
    r.render({ ...view, w: size.w, h: size.h }, renderDpr(size.w, size.h, window.devicePixelRatio, mobile ? RENDER_BUDGET_PHONE : RENDER_BUDGET_DESKTOP));
  }, [view, size, status, mobile]);

  useEffect(() => () => stopAnim(), []);

  // ── Thao tác ──
  const local = (e: { clientX: number; clientY: number }): Ptr => {
    const r = wrapRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const ptAt = (p: Ptr): SphPt => unproject(p.x, p.y, { ...viewRef.current, w: size.w, h: size.h });
  const degPerPx = () => viewRef.current.hfov / Math.max(1, size.w);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    if ((e.target as Element).closest('[data-ui]')) return;
    stopAnim();
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* con trỏ đã nhả (chạm rất nhanh) — vẫn xử lý bình thường */ }
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      if (gesture.current.kind === 'item') propsRef.current.onItemDrag?.(gesture.current.key, ptAt(p), 'end');
      gesture.current = { kind: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, hfov0: viewRef.current.hfov };
      return;
    }
    const target = e.target instanceof Element ? e.target : null;
    const dragKey = target?.closest('[data-drag]')?.getAttribute('data-drag') ?? null;
    gesture.current = { kind: 'press', id: e.pointerId, start: p, t: performance.now(), target, dragKey };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = local(e);
    const g = gesture.current;
    if (!pointers.current.has(e.pointerId)) {
      if (e.pointerType === 'mouse') propsRef.current.onHover?.(ptAt(p));
      return;
    }
    pointers.current.set(e.pointerId, p);
    if (g.kind === 'pinch') {
      const [a, b] = [...pointers.current.values()];
      if (!a || !b) return;
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      setView({ ...viewRef.current, hfov: g.hfov0 * (g.d0 / d) });
      return;
    }
    if (g.kind === 'press' && g.id === e.pointerId) {
      if (Math.hypot(p.x - g.start.x, p.y - g.start.y) < TAP_PX) return;
      if (g.dragKey && propsRef.current.onItemDrag?.(g.dragKey, ptAt(p), 'start') !== false) {
        gesture.current = { kind: 'item', id: e.pointerId, key: g.dragKey };
        propsRef.current.onItemDrag?.(g.dragKey, ptAt(p), 'move');
        return;
      }
      gesture.current = { kind: 'pan', id: e.pointerId, last: g.start, lastT: g.t, vx: 0, vy: 0 };
    }
    const g2 = gesture.current;
    if (g2.kind === 'item' && g2.id === e.pointerId) { propsRef.current.onItemDrag?.(g2.key, ptAt(p), 'move'); return; }
    if (g2.kind === 'pan' && g2.id === e.pointerId) {
      const k = degPerPx();
      const dx = p.x - g2.last.x, dy = p.y - g2.last.y;
      const now = performance.now(), dt = Math.max(16, now - g2.lastT);
      const v = viewRef.current;
      setView({ ...v, yaw: v.yaw - dx * k, pitch: v.pitch + dy * k });
      // Vận tốc (px/ms) để trôi quán tính — chặn trần để cú vuốt giật không làm ảnh quay loạn
      const cap = (n: number) => Math.max(-MAX_FLING, Math.min(MAX_FLING, n));
      g2.vx = cap(0.8 * (dx / dt) + 0.2 * g2.vx);
      g2.vy = cap(0.8 * (dy / dt) + 0.2 * g2.vy) * 0.6;
      g2.last = p;
      g2.lastT = now;
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = local(e);
    const g = gesture.current;
    pointers.current.delete(e.pointerId);
    if (g.kind === 'pinch') {
      if (pointers.current.size === 0) gesture.current = { kind: 'idle' };
      else {
        const [id, last] = [...pointers.current.entries()][0];
        gesture.current = { kind: 'pan', id, last, lastT: performance.now(), vx: 0, vy: 0 };
      }
      return;
    }
    gesture.current = { kind: 'idle' };
    if (e.type === 'pointercancel') return;
    if (g.kind === 'press' && g.id === e.pointerId) {
      const now = performance.now();
      const pt = ptAt(p);
      const prev = lastTap.current;
      if (prev && now - prev.t < 320 && Math.hypot(prev.x - p.x, prev.y - p.y) < 24 && propsRef.current.onDoubleTap) {
        lastTap.current = null;
        propsRef.current.onDoubleTap(pt);
        return;
      }
      lastTap.current = { t: now, x: p.x, y: p.y };
      propsRef.current.onTap?.(pt, g.target, p.x, p.y);
      return;
    }
    if (g.kind === 'item' && g.id === e.pointerId) { propsRef.current.onItemDrag?.(g.key, ptAt(p), 'end'); return; }
    if (g.kind === 'pan' && g.id === e.pointerId && performance.now() - g.lastT < 80) {
      // Quán tính: thả tay khi đang vuốt → trôi tiếp rồi chậm dần
      let vx = g.vx, vy = g.vy, t = performance.now();
      const k = degPerPx();
      const step = (now: number) => {
        const dt = now - t; t = now;
        const decay = Math.pow(0.0045, dt / 1000);
        vx *= decay; vy *= decay;
        const v = viewRef.current;
        setView({ ...v, yaw: v.yaw - vx * dt * k, pitch: v.pitch + vy * dt * k });
        anim.current = Math.hypot(vx, vy) > 0.02 ? requestAnimationFrame(step) : null;
      };
      if (Math.hypot(vx, vy) > 0.15) anim.current = requestAnimationFrame(step);
    }
  };

  // Lăn chuột = phóng to / thu nhỏ (cần listener không passive để chặn cuộn trang)
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if ((e.target as Element).closest('[data-ui]')) return;
      e.preventDefault();
      stopAnim();
      const v = viewRef.current;
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      setView({ ...v, hfov: v.hfov * Math.exp(dy * 0.0012) });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [setView]);

  const pv: PanoView = { ...view, w: size.w, h: size.h };

  return (
    <div ref={wrapRef} className="absolute inset-0 overflow-hidden select-none bg-[#1C1C1E]"
      style={{ touchAction: 'none', cursor: cursor ?? (gesture.current.kind === 'pan' ? 'grabbing' : 'grab') }}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
      onPointerLeave={e => { if (e.pointerType === 'mouse' && !pointers.current.size) propsRef.current.onHover?.(null); }}
      onContextMenu={e => e.preventDefault()}>
      <div ref={canvasHostRef} className="absolute inset-0" />
      {status.s === 'ready' && size.w > 0 && overlay(pv)}
      {engine === 'soft' && status.s === 'ready' && <SoftModeNotice bottom={noticeBottom} />}
      {status.s === 'loading' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/80 text-[13px] pointer-events-none">
          <Loader2 size={22} className="animate-spin" /> {status.msg}
        </div>
      )}
      {status.s === 'error' && (
        <div className="absolute inset-0 flex items-center justify-center p-6">
          <div className="max-w-sm text-center text-white/85 text-[13px] space-y-2">
            <AlertTriangle size={24} className="mx-auto text-amber-400" />
            <div>{status.msg}</div>
          </div>
        </div>
      )}
    </div>
  );
});

export default PanoStage;

/** Đang vẽ bằng CPU (máy không có WebGL): dòng báo nhỏ + cách bật tăng tốc đồ hoạ để xem mượt như Google Photos. */
function SoftModeNotice({ bottom = '12px' }: { bottom?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div data-ui className="absolute left-1/2 -translate-x-1/2 z-[6] flex flex-col items-center gap-2 max-w-[calc(100%-24px)]" style={{ bottom }}>
      {open && (
        <div className="w-[min(440px,calc(100vw-24px))] rounded-2xl bg-white/95 backdrop-blur shadow-2xl p-3.5 text-[12.5px] text-[#333] space-y-2">
          <div className="flex items-start gap-2">
            <div className="flex-1 text-[13.5px] font-semibold text-[#111]">Xem mượt như Google Photos</div>
            <button onClick={() => setOpen(false)} aria-label="Đóng" className="text-[#999] hover:text-[#444] text-[16px] leading-none">×</button>
          </div>
          <div>Trình duyệt đang <b>tắt tăng tốc đồ hoạ (WebGL)</b> nên ảnh được vẽ bằng bộ xử lý — xem được nhưng hơi mờ khi kéo. Bật lại 1 lần là mượt:</div>
          <ol className="list-decimal pl-5 space-y-1">
            <li><b>Chrome / Cốc Cốc / Edge:</b> Cài đặt → Hệ thống → bật <i>“Sử dụng tăng tốc đồ hoạ khi có thể”</i> (Use graphics acceleration when available) → bấm <b>Chạy lại</b>.</li>
            <li>Vẫn chưa được: gõ <code className="px-1 rounded bg-[#F2F2F7]">chrome://flags/#ignore-gpu-blocklist</code> → chọn <b>Enabled</b> → Chạy lại.</li>
            <li>Máy Mac: mở app bằng <b>Safari</b> cũng xem mượt ngay.</li>
          </ol>
          <div className="text-[11.5px] text-[#888]">Kiểm tra: mở <code className="px-1 rounded bg-[#F2F2F7]">chrome://gpu</code>, dòng “WebGL” ghi <i>Hardware accelerated</i> là đã bật.</div>
        </div>
      )}
      <button onClick={() => setOpen(o => !o)}
        className="px-3 py-1.5 rounded-full bg-black/60 hover:bg-black/75 text-white/90 text-[11.5px] whitespace-nowrap max-w-full truncate">
        Máy chưa bật tăng tốc đồ hoạ — đang xem chế độ nhẹ · <span className="underline">Cách xem mượt</span>
      </button>
    </div>
  );
}
