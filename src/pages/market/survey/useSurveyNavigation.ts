// Dẫn đường khi khảo sát: giữ lộ trình đang đi, theo dõi vị trí trên lộ trình, tự tính lại khi lạc / đi xong đoạn.
// Âm thanh 3 chế độ: tắt hẳn · chỉ tiếng bíp (báo sắp rẽ / rẽ ngay, rẽ trái kêu bên tai trái, rẽ phải bên phải; Android
// rung kèm) · đọc to bằng giọng tiếng Việt của máy (speechSynthesis — không cần mạng, không tốn tiền).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LatLng } from '../../../lib/geo';
import {
  nextManeuvers, planNextRun, planToPoint, routeProgress, spokenInstruction, type NavRoute, type RoadGraph,
} from '../../../lib/kcnSurvey/navigate';
import type { GpsFix } from './useSurveyRecorder';
import type { NavSound } from './surveyData';

export type NavMode = { kind: 'off' } | { kind: 'auto' } | { kind: 'point'; name: string; point: LatLng };
export type NavStatus = 'off' | 'waiting-gps' | 'no-road' | 'no-target' | 'routing';

interface Inputs {
  graph: RoadGraph | null;
  fix: GpsFix | null;
  /** hướng đang chạy (độ) — null khi đứng yên */
  course: number | null;
  /** chỉ số khúc chưa đi trong KCN (theo đồ thị) */
  targets: readonly number[];
  scores: ArrayLike<number>;
  preferFactories: boolean;
  sound: NavSound;
  say: (msg: string) => void;
}

type Chime = 'soon' | 'now' | 'done' | 'reroute';
/** Nốt (Hz, bắt đầu giây, dài giây) cho từng loại tiếng bíp */
const CHIMES: Record<Chime, [number, number, number][]> = {
  soon: [[880, 0, 0.14]],
  now: [[988, 0, 0.12], [1319, 0.16, 0.2]],
  done: [[784, 0, 0.12], [988, 0.14, 0.12], [1175, 0.28, 0.22]],
  reroute: [[523, 0, 0.12], [392, 0.18, 0.16]],
};
const VIBRATE: Record<Chime, number[]> = { soon: [80], now: [90, 60, 90], done: [60, 40, 60, 40, 120], reroute: [200] };

/** Tiếng bíp bằng Web Audio (iPhone phải "mở khoá" trong 1 lần bấm → gọi unlock() ở nút Dẫn đường / nút loa). */
function useChime(enabled: boolean) {
  const ctxRef = useRef<AudioContext | null>(null);
  const unlock = useCallback(() => {
    try {
      if (!ctxRef.current) {
        const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        ctxRef.current = new Ctx();
      }
      void ctxRef.current.resume();
    } catch { /* máy không hỗ trợ Web Audio */ }
  }, []);
  useEffect(() => () => { void ctxRef.current?.close().catch(() => {}); }, []);
  const play = useCallback((kind: Chime, side: -1 | 0 | 1 = 0, force = false) => {
    if (!enabled && !force) return;
    try { navigator.vibrate?.(VIBRATE[kind]); } catch { /* iPhone không rung từ web */ }
    const ctx = ctxRef.current;
    if (!ctx) return;
    if (ctx.state === 'suspended') void ctx.resume();
    const t0 = ctx.currentTime + 0.02;
    for (const [hz, at, dur] of CHIMES[kind]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = hz;
      gain.gain.setValueAtTime(0, t0 + at);
      gain.gain.linearRampToValueAtTime(0.35, t0 + at + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + at + dur);
      osc.connect(gain);
      let out: AudioNode = gain;
      if (side && typeof ctx.createStereoPanner === 'function') {
        const pan = ctx.createStereoPanner();
        pan.pan.value = side * 0.8;
        gain.connect(pan);
        out = pan;
      }
      out.connect(ctx.destination);
      osc.start(t0 + at);
      osc.stop(t0 + at + dur + 0.05);
    }
  }, [enabled]);
  return { unlock, play };
}

const sideOf = (kind: string): -1 | 0 | 1 => (kind.includes('left') ? -1 : kind.includes('right') ? 1 : 0);

const REPLAN_MIN_MS = 4000;

function useSpeech(enabled: boolean) {
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const pick = () => { voiceRef.current = speechSynthesis.getVoices().find(v => v.lang?.toLowerCase().startsWith('vi')) ?? null; };
    pick();
    speechSynthesis.addEventListener?.('voiceschanged', pick);
    return () => speechSynthesis.removeEventListener?.('voiceschanged', pick);
  }, []);
  return useCallback((text: string, force = false) => {
    if ((!enabled && !force) || typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'vi-VN';
      if (voiceRef.current) u.voice = voiceRef.current;
      u.rate = 1.05;
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    } catch { /* máy không có giọng đọc — vẫn có chữ trên màn hình */ }
  }, [enabled]);
}

export function useSurveyNavigation({ graph, fix, course, targets, scores, preferFactories, sound, say }: Inputs) {
  const [mode, setMode] = useState<NavMode>({ kind: 'off' });
  const [route, setRoute] = useState<NavRoute | null>(null);
  const [progress, setProgress] = useState<{ s: number; off: number }>({ s: 0, off: 0 });
  const [status, setStatus] = useState<NavStatus>('off');
  const speak = useSpeech(sound === 'voice');
  const chime = useChime(sound === 'beep');
  /** Báo theo chế độ âm thanh: giọng đọc câu `text`, hoặc tiếng bíp loại `kind` */
  const announce = useCallback((text: string, kind: Chime, side: -1 | 0 | 1 = 0) => {
    if (sound === 'voice') speak(text);
    else if (sound === 'beep') chime.play(kind, side);
  }, [sound, speak, chime]);

  const inputsRef = useRef({ graph, targets, scores, preferFactories, course });
  inputsRef.current = { graph, targets, scores, preferFactories, course };
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const routeRef = useRef(route);
  routeRef.current = route;
  const skipRef = useRef<Set<number>>(new Set());
  const lastPlanAt = useRef(0);
  const offCount = useRef(0);
  const sRef = useRef(0);
  const spoken = useRef<Set<string>>(new Set());
  const routeId = useRef(0);

  const plan = useCallback((p: LatLng, why: 'start' | 'reroute' | 'next' | 'coverage') => {
    const m = modeRef.current;
    const { graph: g, targets: t, scores: sc, preferFactories: pf, course: h } = inputsRef.current;
    if (m.kind === 'off') return;
    lastPlanAt.current = Date.now();
    if (!g || !g.edges.length) { setRoute(null); setStatus('no-road'); return; }
    const r = m.kind === 'auto'
      ? planNextRun(g, p, { heading: h, targets: t, scores: sc, preferFactories: pf, skip: skipRef.current })
      : planToPoint(g, p, m.point, m.name, h);
    routeId.current += 1;
    spoken.current = new Set();
    sRef.current = 0;
    offCount.current = 0;
    setRoute(r);
    setProgress({ s: 0, off: 0 });
    if (!r) {
      setStatus(m.kind === 'auto' && !t.length ? 'no-target' : 'no-road');
      if (why !== 'coverage') {
        if (m.kind === 'auto') say(t.length ? 'Chưa dẫn được: đang ở xa đường, hoặc chỉ còn vài khúc lẻ chưa đi' : 'Đã đi hết đường trong KCN 🎉');
        else say('Không tìm được đường tới công ty này trên bản đồ đường đã tải');
      }
      return;
    }
    setStatus('routing');
    const first = r.maneuvers[0];
    if (why === 'reroute') announce('Đã tính lại đường', 'reroute');
    else if (why === 'next') announce(`Đoạn tiếp theo cách ${Math.max(50, Math.round(r.approach / 50) * 50)} mét`, 'soon');
    else if (why === 'start' && first && sound === 'voice') speak(first.s < 40 ? first.text : spokenInstruction(first, first.s));
  }, [say, speak, announce, sound]);

  const start = useCallback((m: Exclude<NavMode, { kind: 'off' }>) => {
    skipRef.current = new Set();
    setMode(m);
    modeRef.current = m;
    // iPhone chỉ cho phát tiếng khi lần đầu nằm trong 1 lần bấm → đọc / bíp ngay 1 tiếng ngắn
    chime.unlock();
    if (sound === 'voice') speak(m.kind === 'auto' ? 'Bắt đầu dẫn đường tới đoạn chưa đi' : `Dẫn đường tới ${m.name}`, true);
    else if (sound === 'beep') chime.play('now', 0, true);
    if (fix) plan(fix, 'start');
    else { setStatus('waiting-gps'); setRoute(null); }
  }, [fix, plan, speak, chime, sound]);

  const stop = useCallback(() => {
    setMode({ kind: 'off' });
    modeRef.current = { kind: 'off' };
    setRoute(null);
    setStatus('off');
    try { if ('speechSynthesis' in window) speechSynthesis.cancel(); } catch { /* bỏ qua */ }
  }, []);

  // Mỗi điểm GPS: vị trí trên lộ trình, lạc đường, tới nơi, đọc chỗ rẽ
  useEffect(() => {
    if (mode.kind === 'off' || !fix) return;
    const p = { lat: fix.lat, lng: fix.lng };
    const r = routeRef.current;
    if (!r) {
      if (Date.now() - lastPlanAt.current > 6000) plan(p, 'start');
      return;
    }
    const pr = routeProgress(r, p, sRef.current);
    // Lạc đường: lệch xa lộ trình 2 điểm liền → tính lại
    if (pr.off > Math.max(35, Math.min(60, fix.acc + 15))) {
      offCount.current += 1;
      if (offCount.current >= 2 && Date.now() - lastPlanAt.current > REPLAN_MIN_MS) { plan(p, 'reroute'); return; }
    } else {
      offCount.current = 0;
      sRef.current = Math.max(sRef.current - 15, pr.s);
    }
    const s = sRef.current;
    setProgress({ s, off: pr.off });
    // Tới nơi
    if (s >= r.total - 12) {
      if (mode.kind === 'auto' && r.target.kind === 'run') {
        r.target.pieces.forEach(i => skipRef.current.add(i));
        announce('Hết đoạn chưa đi', 'done');
        plan(p, 'next');
      } else if (mode.kind === 'point') {
        announce(`Đã đến ${mode.name}`, 'done');
        say(`Đã đến ${mode.name}`);
        stop();
      }
      return;
    }
    // Đọc chỗ rẽ: báo trước (xa) + báo ngay tại chỗ (gần), mỗi chỗ 1 lần
    const { next } = nextManeuvers(r, s);
    if (!next || next.kind === 'arrive') return;
    const d = next.s - s;
    const speed = fix.speed ?? 0;
    const far = Math.min(400, Math.max(150, speed * 12));
    const near = Math.max(35, speed * 4);
    const key = `${routeId.current}:${next.s.toFixed(0)}:${next.kind}`;
    if (d <= near) {
      if (!spoken.current.has(`${key}:near`)) { spoken.current.add(`${key}:near`); spoken.current.add(`${key}:far`); announce(next.text, 'now', sideOf(next.kind)); }
    } else if (d <= far && d > near + 40 && !spoken.current.has(`${key}:far`)) {
      spoken.current.add(`${key}:far`);
      announce(spokenInstruction(next, d), 'soon', sideOf(next.kind));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fix]);

  // Đoạn đang dẫn tới bị đi qua từ phía khác (đã tô xanh) mà chưa tới nơi → tìm đoạn khác
  const targetSet = useMemo(() => new Set(targets), [targets]);
  useEffect(() => {
    const r = routeRef.current;
    if (mode.kind !== 'auto' || !r || r.target.kind !== 'run' || !fix) return;
    if (sRef.current >= r.approach - 20) return;
    const left = r.target.pieces.filter(i => targetSet.has(i)).length;
    if (left / r.target.pieces.length < 0.3 && Date.now() - lastPlanAt.current > REPLAN_MIN_MS) plan({ lat: fix.lat, lng: fix.lng }, 'coverage');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetSet]);

  // Vừa tải xong bản đồ đường mà đang chờ → lập lộ trình
  useEffect(() => {
    if (mode.kind !== 'off' && !routeRef.current && graph && fix) plan({ lat: fix.lat, lng: fix.lng }, 'start');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph]);

  const { next, after } = route ? nextManeuvers(route, progress.s) : { next: null, after: null };
  return {
    mode, status, route, progress, next, after,
    distToNext: next ? Math.max(0, next.s - progress.s) : null,
    remaining: route ? Math.max(0, route.total - progress.s) : null,
    toApproach: route ? Math.max(0, route.approach - progress.s) : null,
    start, stop,
    replan: () => { if (fix) plan({ lat: fix.lat, lng: fix.lng }, 'reroute'); },
    /** Gọi trong lần bấm đổi chế độ âm thanh (iPhone) + phát thử 1 tiếng của chế độ mới */
    previewSound: (next: NavSound) => {
      chime.unlock();
      if (next === 'beep') chime.play('soon', 0, true);
      else if (next === 'voice') speak('Bật giọng đọc', true);
      else try { if ('speechSynthesis' in window) speechSynthesis.cancel(); } catch { /* bỏ qua */ }
    },
  };
}
