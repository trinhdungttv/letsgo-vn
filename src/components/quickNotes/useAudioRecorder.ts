// Ghi âm bằng micro của trình duyệt (MediaRecorder). Đặt ở gốc dải ghi chú nên đóng thẻ / chuyển trang vẫn ghi tiếp.
// Mức âm lượng đọc qua getLevel() (không re-render) để vạch sóng tự vẽ bằng requestAnimationFrame.
import { useCallback, useEffect, useRef, useState } from 'react';
import { pickRecorderMime } from '../../lib/quickNotes/noteText';

/** Tự dừng sau 3 giờ (file ~45 MB ở 32 kbps — dưới giới hạn 50 MB/file của Supabase). */
export const MAX_RECORD_MS = 3 * 60 * 60 * 1000;
/** Safari ghi mp4 có thể bỏ qua bitrate (file to hơn nhiều) → chạm 45 MB thì tự dừng và lưu. */
const MAX_BYTES = 45 * 1024 * 1024;
const BITRATE = 32_000;

export type RecorderPhase = 'idle' | 'starting' | 'recording' | 'paused' | 'stopping';

export interface RecordedAudio {
  noteId: string;
  blob: Blob;
  mime: string;
  ext: string;
  durationSec: number;
  startedAt: Date;
}

export interface AudioRecorder {
  phase: RecorderPhase;
  noteId: string | null;
  elapsedMs: number;
  error: string | null;
  supported: boolean;
  active: boolean;
  start: (noteId: string) => Promise<boolean>;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  cancel: () => void;
  getLevel: () => number;
  clearError: () => void;
}

type WakeLockLike = { release: () => Promise<void> };

function micError(e: unknown): string {
  const name = (e as { name?: string })?.name ?? '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Trình duyệt chưa cho dùng micro — bấm biểu tượng ổ khoá cạnh địa chỉ trang, cho phép Micro rồi thử lại.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'Không tìm thấy micro trên máy này.';
  if (name === 'NotReadableError') return 'Micro đang bị ứng dụng khác dùng (Zoom, Meet…) — tắt bớt rồi thử lại.';
  return `Không bật được micro: ${(e as Error)?.message ?? String(e)}`;
}

export interface RecorderOptions {
  /**
   * Lọc tạp âm cho ghi âm ngoài trời (khảo sát chạy xe): bật thêm tách giọng nếu máy có, cắt tiếng ù gió / máy xe
   * (< ~130 Hz), cắt rít cao (> 7,5 kHz), nén cho giọng đều to nhỏ. Ghi cuộc họp (Ghi chú nhanh) không bật.
   */
  enhance?: boolean;
}

/** Âm thanh micro → lọc → luồng mới để ghi. Lỗi gì cũng trả null (ghi luồng gốc như cũ). */
function enhanceStream(ctx: AudioContext, raw: MediaStream): { stream: MediaStream; tap: AudioNode } | null {
  try {
    const src = ctx.createMediaStreamSource(raw);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 130; hp.Q.value = 0.7;
    const hp2 = ctx.createBiquadFilter();
    hp2.type = 'highpass'; hp2.frequency.value = 90; hp2.Q.value = 0.5;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 7500; lp.Q.value = 0.7;
    // Giọng nói rõ hơn: nhấn nhẹ dải 2–4 kHz (độ rõ phụ âm)
    const presence = ctx.createBiquadFilter();
    presence.type = 'peaking'; presence.frequency.value = 3000; presence.Q.value = 1; presence.gain.value = 3;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -30; comp.knee.value = 18; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.25;
    const makeup = ctx.createGain();
    makeup.gain.value = 1.6;
    const dest = ctx.createMediaStreamDestination();
    src.connect(hp2).connect(hp).connect(lp).connect(presence).connect(comp).connect(makeup).connect(dest);
    return { stream: dest.stream, tap: makeup };
  } catch {
    return null;
  }
}

/** onDone nhận file khi bấm Dừng (hoặc micro bị rút / hết 3 giờ). */
export function useAudioRecorder(onDone: (audio: RecordedAudio) => void, options: RecorderOptions = {}): AudioRecorder {
  const enhanceRef = useRef(!!options.enhance);
  enhanceRef.current = !!options.enhance;
  const [phase, setPhase] = useState<RecorderPhase>('idle');
  const [noteId, setNoteId] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const recRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const bytes = useRef(0);
  const ctxRef = useRef<AudioContext | null>(null);
  const analyser = useRef<AnalyserNode | null>(null);
  const buf = useRef<Uint8Array | null>(null);
  const wake = useRef<WakeLockLike | null>(null);
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);
  const accMs = useRef(0);
  const since = useRef<number | null>(null);
  const meta = useRef<{ noteId: string; mime: string; ext: string; startedAt: Date } | null>(null);
  const discard = useRef(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const supported = typeof window !== 'undefined' && typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

  const elapsedNow = () => accMs.current + (since.current !== null ? Date.now() - since.current : 0);

  const teardown = useCallback(() => {
    if (tick.current) { clearInterval(tick.current); tick.current = null; }
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    void ctxRef.current?.close().catch(() => {});
    ctxRef.current = null;
    analyser.current = null;
    void wake.current?.release().catch(() => {});
    wake.current = null;
    recRef.current = null;
  }, []);

  const stop = useCallback(() => {
    const r = recRef.current;
    if (!r || r.state === 'inactive') return;
    if (since.current !== null) { accMs.current += Date.now() - since.current; since.current = null; }
    setPhase('stopping');
    try { r.requestData(); } catch { /* một số trình duyệt không cho gọi lúc tạm dừng */ }
    r.stop();
  }, []);

  const start = useCallback(async (forNote: string): Promise<boolean> => {
    if (recRef.current) return false;
    setError(null);
    if (!supported) {
      setError('Trình duyệt này không hỗ trợ ghi âm — dùng Chrome, Edge hoặc Safari bản mới.');
      return false;
    }
    setPhase('starting');
    setNoteId(forNote);
    let stream: MediaStream;
    const enhance = enhanceRef.current;
    try {
      const supportedC = navigator.mediaDevices.getSupportedConstraints?.() as Record<string, boolean> | undefined;
      const audio: MediaTrackConstraints & Record<string, unknown> = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
      if (enhance) {
        audio.channelCount = 1;
        // Tách giọng nói của máy (iPhone / Chrome bản mới có) — lọc gió, tiếng xe tốt hơn bộ lọc thường
        if (supportedC?.voiceIsolation) audio.voiceIsolation = true;
      }
      stream = await navigator.mediaDevices.getUserMedia({ audio });
    } catch (e) {
      setError(micError(e));
      setPhase('idle');
      setNoteId(null);
      return false;
    }
    const { mime, ext } = pickRecorderMime(t => MediaRecorder.isTypeSupported(t));
    // Lọc tạp âm: micro → bộ lọc → luồng mới để ghi (lỗi thì ghi luồng gốc)
    let recStream = stream;
    let enhanced: { ctx: AudioContext; tap: AudioNode } | null = null;
    if (enhance) {
      try {
        const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ctx = new Ctx();
        void ctx.resume();
        const out = enhanceStream(ctx, stream);
        if (out) { recStream = out.stream; enhanced = { ctx, tap: out.tap }; }
        else void ctx.close().catch(() => {});
      } catch { /* máy không có Web Audio — ghi luồng gốc */ }
    }
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(recStream, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: BITRATE });
    } catch (e) {
      stream.getTracks().forEach(t => t.stop());
      void enhanced?.ctx.close().catch(() => {});
      setError(`Không khởi động được ghi âm: ${(e as Error).message}`);
      setPhase('idle');
      setNoteId(null);
      return false;
    }
    streamRef.current = stream;
    recRef.current = rec;
    chunks.current = [];
    bytes.current = 0;
    discard.current = false;
    accMs.current = 0;
    since.current = Date.now();
    const realMime = rec.mimeType || mime || 'audio/webm';
    meta.current = { noteId: forNote, mime: realMime, ext: realMime.includes('mp4') ? 'mp4' : realMime.includes('ogg') ? 'ogg' : ext, startedAt: new Date() };

    rec.ondataavailable = e => {
      if (!e.data || e.data.size === 0) return;
      chunks.current.push(e.data);
      bytes.current += e.data.size;
      if (bytes.current > MAX_BYTES && rec.state === 'recording') {
        setError('Bản ghi đã tới 45 MB nên tự dừng và lưu — bấm micro để ghi tiếp phần sau.');
        stop();
      }
    };
    rec.onstop = () => {
      const m = meta.current;
      const parts = chunks.current;
      const durationSec = accMs.current / 1000;
      chunks.current = [];
      teardown();
      setPhase('idle');
      setNoteId(null);
      setElapsedMs(0);
      if (!m || discard.current || parts.length === 0) return;
      onDoneRef.current({ noteId: m.noteId, blob: new Blob(parts, { type: m.mime }), mime: m.mime, ext: m.ext, durationSec, startedAt: m.startedAt });
    };
    // Rút micro / đổi thiết bị giữa chừng → lưu phần đã ghi
    stream.getAudioTracks().forEach(t => { t.onended = () => stop(); });

    // Vạch âm lượng (đã lọc thì đo sau bộ lọc — đúng cái đang được ghi)
    try {
      if (enhanced) {
        ctxRef.current = enhanced.ctx;
        const node = enhanced.ctx.createAnalyser();
        node.fftSize = 512;
        enhanced.tap.connect(node);
        analyser.current = node;
        buf.current = new Uint8Array(node.fftSize);
      } else {
        const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ctx = new Ctx();
        const node = ctx.createAnalyser();
        node.fftSize = 512;
        ctx.createMediaStreamSource(stream).connect(node);
        ctxRef.current = ctx;
        analyser.current = node;
        buf.current = new Uint8Array(node.fftSize);
      }
    } catch {
      // không có vạch âm lượng cũng không sao
    }
    // Giữ màn hình sáng (điện thoại tắt màn hình là trình duyệt dừng micro)
    try {
      const wl = (navigator as unknown as { wakeLock?: { request: (t: 'screen') => Promise<WakeLockLike> } }).wakeLock;
      if (wl) wake.current = await wl.request('screen');
    } catch {
      // máy không hỗ trợ / pin yếu — bỏ qua
    }

    rec.start(1000);
    setPhase('recording');
    setElapsedMs(0);
    tick.current = setInterval(() => {
      const ms = elapsedNow();
      setElapsedMs(ms);
      if (ms >= MAX_RECORD_MS) stop();
    }, 500);
    return true;
  }, [supported, stop, teardown]);

  const pause = useCallback(() => {
    const r = recRef.current;
    if (!r || r.state !== 'recording') return;
    r.pause();
    if (since.current !== null) { accMs.current += Date.now() - since.current; since.current = null; }
    setPhase('paused');
  }, []);

  const resume = useCallback(() => {
    const r = recRef.current;
    if (!r || r.state !== 'paused') return;
    r.resume();
    since.current = Date.now();
    setPhase('recording');
  }, []);

  const cancel = useCallback(() => {
    discard.current = true;
    if (recRef.current && recRef.current.state !== 'inactive') recRef.current.stop();
    else { teardown(); setPhase('idle'); setNoteId(null); }
  }, [teardown]);

  const getLevel = useCallback(() => {
    const node = analyser.current;
    const data = buf.current;
    if (!node || !data) return 0;
    node.getByteTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i += 1) {
      const v = (data[i] - 128) / 128;
      sum += v * v;
    }
    return Math.min(1, Math.sqrt(sum / data.length) * 3);
  }, []);

  // Rời khỏi app (đăng xuất) giữa chừng → dừng và vẫn giao file đã ghi (cộng nốt đoạn đang ghi vào thời lượng)
  useEffect(() => () => {
    const r = recRef.current;
    if (r && r.state !== 'inactive') {
      if (since.current !== null) { accMs.current += Date.now() - since.current; since.current = null; }
      r.stop();
    }
  }, []);

  const active = phase === 'starting' || phase === 'recording' || phase === 'paused' || phase === 'stopping';

  return {
    phase, noteId, elapsedMs, error, supported, active,
    start, pause, resume, stop, cancel, getLevel, clearError: () => setError(null),
  };
}
