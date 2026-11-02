// Bộ ghi chuyến khảo sát KCN: theo dõi GPS, lọc điểm, ghi nối thêm từng đoạn ~20 giây lên Supabase, giữ màn hình sáng.
//
// Không để mất vết khi mất sóng / tắt app giữa chừng:
//   - điểm chưa gửi nằm trong hàng đợi, gửi lại theo thứ tự (cùng trip_id + seq không tạo bản trùng);
//   - toàn bộ trạng thái chuyến đang đi (vết, hàng đợi, công ty đã đi ngang) lưu ở localStorage của máy —
//     mở lại Bản đồ → Khảo sát KCN là thấy "Chuyến đang dở" để đi tiếp hoặc kết thúc.
// GPS của trình duyệt dừng khi tắt màn hình / chuyển app (nhất là iPhone) → giữ màn hình sáng (Wake Lock) khi đang ghi.
import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_FIX_FILTER, judgeFix, trackLength, trackBounds, type TrackPoint, type TrackSegment } from '../../../lib/kcnSurvey/track';
import { appendChunk, createTrip, updateTrip, type SurveyTrip, type TrackChunk } from '../../../lib/kcnSurvey/api';
import type { PassedCompany } from '../../../lib/kcnSurvey/companies';

export interface GpsFix {
  lat: number;
  lng: number;
  acc: number;
  heading: number | null;
  /** m/s */
  speed: number | null;
  at: number;
}

export type RecStatus = 'idle' | 'recording' | 'paused';

const ACTIVE_KEY = 'lgvn_kcn_survey_active_v1';
/** Mảng rỗng cố định — chưa có chuyến thì `segments` không đổi danh tính mỗi lần vẽ lại. */
const NO_SEGMENTS: TrackSegment[] = [];
const FLUSH_MS = 20_000;
const FLUSH_POINTS = 40;

interface ActiveState {
  trip: SurveyTrip;
  /** Mốc 0 của giây trong điểm vết */
  t0: number;
  seq: number;
  segment: number;
  segments: TrackSegment[];
  /** Điểm đã ghi nhận nhưng chưa đóng thành đoạn gửi đi */
  buffer: TrackPoint[];
  queue: TrackChunk[];
  passed: PassedCompany[];
}

function loadActive(): ActiveState | null {
  try {
    const raw = localStorage.getItem(ACTIVE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as ActiveState;
    if (!s?.trip?.id || !Array.isArray(s.segments)) return null;
    return { ...s, buffer: s.buffer ?? [], queue: s.queue ?? [], passed: s.passed ?? [] };
  } catch { return null; }
}
function saveActive(s: ActiveState | null) {
  try {
    if (s) localStorage.setItem(ACTIVE_KEY, JSON.stringify(s));
    else localStorage.removeItem(ACTIVE_KEY);
  } catch { /* đầy bộ nhớ — vết vẫn đang được gửi lên DB theo đoạn */ }
}

/** Chuyến đang dở lưu trong máy (để hỏi đi tiếp khi mở lại). */
export function pendingActiveTrip(): { trip: SurveyTrip; distance: number; points: number; passed: PassedCompany[] } | null {
  const s = loadActive();
  if (!s) return null;
  return { trip: s.trip, distance: trackLength(s.segments), points: s.segments.reduce((n, seg) => n + seg.length, 0), passed: s.passed };
}

export interface SummaryResult {
  trip: SurveyTrip;
  segments: TrackSegment[];
  passed: PassedCompany[];
  unsynced: number;
}

export function useSurveyRecorder(opts: { onFix?: (fix: GpsFix) => void; maxAccuracy?: number } = {}) {
  const [fix, setFix] = useState<GpsFix | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [status, setStatus] = useState<RecStatus>('idle');
  const [trip, setTrip] = useState<SurveyTrip | null>(null);
  const [version, setVersion] = useState(0); // tăng khi vết đổi → vẽ lại
  const [unsynced, setUnsynced] = useState(0);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [wakeLockOn, setWakeLockOn] = useState(false);

  const stateRef = useRef<ActiveState | null>(null);
  const statusRef = useRef<RecStatus>('idle');
  const onFixRef = useRef(opts.onFix);
  onFixRef.current = opts.onFix;
  const maxAccRef = useRef(opts.maxAccuracy ?? DEFAULT_FIX_FILTER.maxAccuracy);
  maxAccRef.current = opts.maxAccuracy ?? DEFAULT_FIX_FILTER.maxAccuracy;
  const sendingRef = useRef(false);
  const jumpsRef = useRef(0);
  const wakeRef = useRef<WakeLockSentinel | null>(null);
  const wantWakeRef = useRef(false);
  const saveTimerRef = useRef<number | null>(null);

  const setStatusBoth = (s: RecStatus) => { statusRef.current = s; setStatus(s); };

  // Chỉ GHI khi đang có chuyến. Không bao giờ xoá ở đây: mở màn khảo sát rồi ẩn app / thoát trước khi bấm "Đi tiếp"
  // mà xoá thì mất luôn chuyến đang dở. Xoá chỉ ở finish() / discardLocal().
  const persistSoon = useCallback(() => {
    if (saveTimerRef.current) return;
    saveTimerRef.current = window.setTimeout(() => { saveTimerRef.current = null; if (stateRef.current) saveActive(stateRef.current); }, 3000);
  }, []);
  const persistNow = useCallback(() => {
    if (saveTimerRef.current) { window.clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }
    if (stateRef.current) saveActive(stateRef.current);
  }, []);

  // ── Gửi hàng đợi ────────────────────────────────────────────────────────────
  const sendQueue = useCallback(async () => {
    const s = stateRef.current;
    if (!s || sendingRef.current) return;
    sendingRef.current = true;
    try {
      while (s.queue.length) {
        await appendChunk(s.queue[0]);
        s.queue.shift();
        setUnsynced(s.queue.length + (s.buffer.length ? 1 : 0));
        persistSoon();
      }
      setSyncError(null);
    } catch (e) {
      setSyncError((e as Error).message);
    } finally {
      sendingRef.current = false;
      setUnsynced(s.queue.length + (s.buffer.length ? 1 : 0));
    }
  }, [persistSoon]);

  /** Đóng các điểm đang gom thành 1 đoạn đưa vào hàng đợi, rồi gửi. */
  const flush = useCallback(async () => {
    const s = stateRef.current;
    if (!s) return;
    if (s.buffer.length) {
      s.queue.push({ trip_id: s.trip.id, seq: s.seq, segment: s.segment, points: s.buffer });
      s.seq += 1;
      s.buffer = [];
      persistNow();
    }
    await sendQueue();
  }, [persistNow, sendQueue]);

  // ── Giữ màn hình sáng ───────────────────────────────────────────────────────
  const acquireWake = useCallback(async () => {
    wantWakeRef.current = true;
    if (wakeRef.current || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
    try {
      const lock = await navigator.wakeLock.request('screen');
      wakeRef.current = lock;
      setWakeLockOn(true);
      lock.addEventListener('release', () => { wakeRef.current = null; setWakeLockOn(false); });
    } catch { setWakeLockOn(false); }
  }, []);
  const releaseWake = useCallback(() => {
    wantWakeRef.current = false;
    wakeRef.current?.release().catch(() => {});
    wakeRef.current = null;
    setWakeLockOn(false);
  }, []);

  // ── GPS: luôn theo dõi khi mở chế độ khảo sát (để hiện vị trí + công ty gần) ──
  useEffect(() => {
    if (!('geolocation' in navigator)) { setGpsError('Trình duyệt không hỗ trợ định vị'); return; }
    const id = navigator.geolocation.watchPosition(
      p => {
        const f: GpsFix = {
          lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy,
          heading: p.coords.heading != null && Number.isFinite(p.coords.heading) ? p.coords.heading : null,
          speed: p.coords.speed != null && Number.isFinite(p.coords.speed) ? p.coords.speed : null,
          at: p.timestamp || Date.now(),
        };
        setGpsError(null);
        setFix(f);
        const s = stateRef.current;
        if (s && statusRef.current === 'recording') {
          const seg = s.segments[s.segments.length - 1];
          const last = seg?.length ? seg[seg.length - 1] : null;
          const t = Math.round((f.at - s.t0) / 1000);
          const verdict = judgeFix(last, { lat: f.lat, lng: f.lng, t, acc: f.acc }, { ...DEFAULT_FIX_FILTER, maxAccuracy: maxAccRef.current });
          jumpsRef.current = verdict === 'jump' ? jumpsRef.current + 1 : 0;
          // GPS báo liên tục ở chỗ mới (vừa mất tín hiệu lâu, bật lại thì đã đi xa) → tin vị trí mới, mở đoạn mới để không nối thẳng
          const relocated = jumpsRef.current >= 5;
          if (verdict === 'accept' || relocated) {
            const pt: TrackPoint = [Math.round(f.lat * 1e6) / 1e6, Math.round(f.lng * 1e6) / 1e6, t, Math.round(f.acc)];
            if (relocated) {
              jumpsRef.current = 0;
              if (s.buffer.length) { s.queue.push({ trip_id: s.trip.id, seq: s.seq, segment: s.segment, points: s.buffer }); s.seq += 1; s.buffer = []; }
              s.segment += 1;
              s.segments.push([pt]);
            } else if (!seg) s.segments.push([pt]); else seg.push(pt);
            s.buffer.push(pt);
            setVersion(v => v + 1);
            setUnsynced(s.queue.length + 1);
            persistSoon();
            if (s.buffer.length >= FLUSH_POINTS) void flush();
          }
        }
        onFixRef.current?.(f);
      },
      err => {
        setGpsError(err.code === 1
          ? 'Chưa cấp quyền định vị — bật Vị trí cho trình duyệt / app rồi mở lại'
          : err.code === 3 ? 'Đang chờ tín hiệu GPS…' : 'Không lấy được vị trí: ' + err.message);
      },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [flush, persistSoon]);

  // Gửi định kỳ + gửi ngay khi app bị ẩn (chuyển app / tắt màn hình); quay lại thì xin giữ màn hình lần nữa
  useEffect(() => {
    const timer = window.setInterval(() => { if (stateRef.current) void flush(); }, FLUSH_MS);
    const onVis = () => {
      if (document.visibilityState === 'hidden') { persistNow(); void flush(); }
      else if (wantWakeRef.current) void acquireWake();
    };
    const onOnline = () => { void sendQueue(); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('online', onOnline);
    window.addEventListener('pagehide', persistNow);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('pagehide', persistNow);
    };
  }, [flush, persistNow, sendQueue, acquireWake]);

  // Rời màn hình khảo sát giữa chừng: lưu lại, gửi nốt, nhả khoá màn hình
  useEffect(() => () => {
    persistNow();
    void flush();
    releaseWake();
  }, [persistNow, flush, releaseWake]);

  // ── Điều khiển ──────────────────────────────────────────────────────────────
  const start = useCallback(async (zone: { id: string | null; name: string }, user: { id: string | null; name: string }, keepAwake: boolean) => {
    const t = await createTrip({ zone_id: zone.id, zone_name: zone.name, user_id: user.id, user_name: user.name });
    stateRef.current = { trip: t, t0: new Date(t.started_at).getTime(), seq: 0, segment: 0, segments: [[]], buffer: [], queue: [], passed: [] };
    persistNow();
    setTrip(t);
    setStatusBoth('recording');
    setVersion(v => v + 1);
    if (keepAwake) void acquireWake();
    return t;
  }, [persistNow, acquireWake]);

  /** Đi tiếp chuyến đang dở lưu trong máy — bắt đầu đoạn mới (không nối với chỗ đã dừng). */
  const resume = useCallback((keepAwake: boolean) => {
    const s = stateRef.current ?? loadActive();
    if (!s) return false;
    stateRef.current = s;
    if (s.segments.length && s.segments[s.segments.length - 1].length) {
      if (s.buffer.length) { s.queue.push({ trip_id: s.trip.id, seq: s.seq, segment: s.segment, points: s.buffer }); s.seq += 1; s.buffer = []; }
      s.segment += 1;
      s.segments.push([]);
    }
    persistNow();
    setTrip(s.trip);
    setStatusBoth('recording');
    setVersion(v => v + 1);
    setUnsynced(s.queue.length);
    if (keepAwake) void acquireWake();
    void sendQueue();
    return true;
  }, [persistNow, acquireWake, sendQueue]);

  /** Nạp chuyến đang dở để xem / kết thúc mà chưa ghi tiếp. */
  const restorePaused = useCallback(() => {
    const s = loadActive();
    if (!s) return false;
    stateRef.current = s;
    setTrip(s.trip);
    setStatusBoth('paused');
    setVersion(v => v + 1);
    setUnsynced(s.queue.length + (s.buffer.length ? 1 : 0));
    void sendQueue();
    return true;
  }, [sendQueue]);

  const pause = useCallback(async () => {
    setStatusBoth('paused');
    releaseWake();
    await flush();
  }, [flush, releaseWake]);

  /** Kết thúc: gửi nốt vết, ghi tổng kết vào chuyến, xoá trạng thái trong máy (chỉ khi đã gửi hết). */
  const finish = useCallback(async (extra: { passed: PassedCompany[]; roadCoverage: number | null }): Promise<SummaryResult | null> => {
    const s = stateRef.current;
    if (!s) return null;
    setStatusBoth('paused');
    releaseWake();
    await flush();
    const segments = s.segments.filter(seg => seg.length);
    const b = trackBounds(segments);
    const lastT = segments.length ? Math.max(...segments.map(seg => seg[seg.length - 1][2])) : 0;
    const endedAt = new Date(Math.max(Date.now(), s.t0 + lastT * 1000)).toISOString();
    const patch = {
      ended_at: endedAt,
      distance_m: Math.round(trackLength(segments) * 10) / 10,
      min_lat: b?.minLat ?? null, min_lng: b?.minLng ?? null, max_lat: b?.maxLat ?? null, max_lng: b?.maxLng ?? null,
      passed: extra.passed,
      road_coverage: extra.roadCoverage,
    };
    await updateTrip(s.trip.id, patch);
    const done: SummaryResult = { trip: { ...s.trip, ...patch }, segments, passed: extra.passed, unsynced: s.queue.length };
    if (!s.queue.length) {
      stateRef.current = null;
      saveActive(null);
      setTrip(null);
      setStatusBoth('idle');
    } else {
      // Còn đoạn chưa gửi được (mất mạng) → giữ trong máy, lần mở sau gửi tiếp
      s.trip = done.trip;
      persistNow();
    }
    setVersion(v => v + 1);
    return done;
  }, [flush, releaseWake, persistNow]);

  /** Bỏ chuyến đang dở khỏi máy (chuyến + vết đã gửi vẫn ở DB). */
  const discardLocal = useCallback(() => {
    stateRef.current = null;
    saveActive(null);
    releaseWake();
    setTrip(null);
    setStatusBoth('idle');
    setUnsynced(0);
    setVersion(v => v + 1);
  }, [releaseWake]);

  const setPassed = useCallback((passed: PassedCompany[]) => {
    const s = stateRef.current;
    if (!s) return;
    s.passed = passed;
    persistSoon();
  }, [persistSoon]);

  const segments = stateRef.current?.segments ?? NO_SEGMENTS;
  const startedAt = stateRef.current ? stateRef.current.t0 : null;

  return {
    fix, gpsError, status, trip, version, unsynced, syncError, wakeLockOn, segments, startedAt,
    initialPassed: stateRef.current?.passed ?? [],
    start, resume, restorePaused, pause, finish, discardLocal, setPassed, retrySync: sendQueue,
  };
}
