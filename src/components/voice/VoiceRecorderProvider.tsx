// Ghi âm CRM dùng chung cho cả app (gắn 1 lần ở App): bấm Ghi âm ở Ghi chú công ty / Nhật ký ghé chi nhánh rồi chuyển qua lại các tab
// (Quy trình, Mặt bằng, Hồ sơ chăm sóc…) trong CÙNG 1 công ty / chi nhánh thì vẫn ghi tiếp.
//   • Chuyển hẳn sang trang / công ty khác → tự dừng và LƯU tới đó.
//   • Tắt / tải lại trang → phần đã ghi được lưu nháp trên máy mỗi ~10 giây, lần mở app sau tự tải lên nốt.
//   • Quên tắt: im lặng 3 phút thì nhắc, thêm 2 phút nữa vẫn im lặng thì tự dừng, lưu tới đoạn cuối còn tiếng.
// Dừng xong tự tải lên (không cần nút Lưu); nơi hiển thị nghe tín hiệu 'crm-voice:saved' để nạp lại danh sách.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Mic, Pause, Square, X } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { useAudioRecorder, type AudioRecorder, type RecordedAudio } from '../quickNotes/useAudioRecorder';
import { formatDuration } from '../../lib/quickNotes/noteText';
import { isMissingVoiceSetup, uploadVoice, VOICE_MIGRATION_HINT, type VoiceSubject } from '../../lib/voiceRec/api';
import { dropVoice, listStashedVoice, stashVoice, type PendingVoice } from '../../lib/voiceRec/pending';

export interface VoiceTarget {
  type: VoiceSubject;
  subjectId: string;
  relatedDate?: string | null;
  /** tên hiện trên thanh đang ghi: "Ghi chú AQUA" */
  label: string;
  /** tên đặt cho bản ghi (để trống = "Bản ghi âm") */
  title?: string;
}

interface Ctx {
  rec: AudioRecorder;
  target: VoiceTarget | null;
  start: (t: VoiceTarget) => Promise<boolean>;
  /** huỷ hẳn: bỏ bản ghi, xoá cả nháp trên máy */
  cancel: () => void;
  /** thông báo ngắn sau khi lưu / lỗi (hiện trên thanh) */
  notice: string | null;
}
const VoiceCtx = createContext<Ctx | null>(null);

export const useCrmVoice = () => useContext(VoiceCtx);

const SAVED = 'crm-voice:saved';
export const emitVoiceSaved = (type: VoiceSubject, subjectId: string) =>
  window.dispatchEvent(new CustomEvent(SAVED, { detail: { type, subjectId } }));
/** Nạp lại danh sách khi có bản ghi mới lưu cho (type, subjectId). */
export function useVoiceSaved(type: VoiceSubject, subjectId: string, cb: () => void) {
  const ref = useRef(cb);
  ref.current = cb;
  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent<{ type: VoiceSubject; subjectId: string }>).detail;
      if (d.type === type && d.subjectId === subjectId) ref.current();
    };
    window.addEventListener(SAVED, h);
    return () => window.removeEventListener(SAVED, h);
  }, [type, subjectId]);
}

/** Trang + mục đang xem: 2 đoạn đầu của hash ('client-detail/<id>', 'branches/<id>'); trang không có mục thì 1 đoạn. */
const scopeOfHash = (hash = window.location.hash) => hash.replace(/^#\/?/, '').split('/').slice(0, 2).join('/');

export const SILENCE = { warnAfterMs: 3 * 60_000, stopAfterMs: 5 * 60_000 } as const;
const DRAFT_EVERY_MS = 10_000;

export function VoiceRecorderProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const userRef = useRef(user);
  userRef.current = user;
  const [target, setTarget] = useState<VoiceTarget | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const targetRef = useRef<VoiceTarget | null>(null);
  const scopeRef = useRef('');
  const recordId = useRef('');

  const flash = useCallback((msg: string) => { setNotice(msg); window.setTimeout(() => setNotice(n => (n === msg ? null : n)), 6000); }, []);

  const persist = useCallback(async (audio: RecordedAudio, t: VoiceTarget, id: string) => {
    const u = userRef.current;
    const item: PendingVoice = {
      id, userId: u?.id ?? '', userName: u?.full_name || u?.username || '', type: t.type, subjectId: t.subjectId,
      relatedDate: t.relatedDate ?? null, title: t.title ?? '', blob: audio.blob, mime: audio.mime, ext: audio.ext,
      durationSec: audio.durationSec, recordedAt: audio.startedAt.toISOString(), draft: false,
    };
    await stashVoice(item); // giữ trên máy trước — tải lên lỗi hay tắt trang giữa chừng vẫn không mất
    try {
      await uploadVoice({ ...item, relatedDate: item.relatedDate, recordedAt: audio.startedAt, durationSec: item.durationSec });
      await dropVoice(id);
      emitVoiceSaved(t.type, t.subjectId);
      flash(audio.autoStopped === 'silence'
        ? `Lâu không có tiếng nên đã tự dừng — đã lưu bản ghi ${formatDuration(audio.durationSec)} (tới đoạn cuối còn tiếng).`
        : `Đã lưu bản ghi âm ${formatDuration(audio.durationSec)}.`);
    } catch (e) {
      flash(isMissingVoiceSetup(e as { code?: string; message?: string })
        ? `${VOICE_MIGRATION_HINT} — bản ghi đang giữ trên máy này, sẽ tự tải lên sau.`
        : `Chưa tải lên được (${(e as Error).message}) — bản ghi đang giữ trên máy này, sẽ tự thử lại lần mở app sau.`);
    }
  }, [flash]);

  const rec = useAudioRecorder(audio => {
    const t = targetRef.current;
    const id = recordId.current;
    targetRef.current = null;
    setTarget(null);
    if (t) void persist(audio, t, id);
  }, { enhance: true, silence: SILENCE });

  const start = useCallback(async (t: VoiceTarget): Promise<boolean> => {
    if (rec.active) return false;
    targetRef.current = t;
    scopeRef.current = scopeOfHash();
    recordId.current = crypto.randomUUID();
    setTarget(t);
    setNotice(null);
    const ok = await rec.start('crm-voice');
    if (!ok) { targetRef.current = null; setTarget(null); }
    return ok;
  }, [rec]);

  const recRef = useRef(rec);
  recRef.current = rec;

  const cancel = useCallback(() => {
    const id = recordId.current;
    targetRef.current = null;
    setTarget(null);
    recRef.current.cancel();
    window.setTimeout(() => { void dropVoice(id); }, 400); // sau khi nháp đang dở (nếu có) đã ghi xong
  }, []);

  // Chuyển hẳn sang trang / công ty khác → dừng và lưu
  useEffect(() => {
    const onNav = () => {
      if (recRef.current.active && scopeOfHash() !== scopeRef.current) {
        flash('Bạn đã chuyển sang trang khác — bản ghi âm được dừng và lưu.');
        recRef.current.stop();
      }
    };
    window.addEventListener('hashchange', onNav);
    window.addEventListener('popstate', onNav);
    return () => { window.removeEventListener('hashchange', onNav); window.removeEventListener('popstate', onNav); };
  }, [flash]);

  // Lưu NHÁP mỗi ~10 giây khi đang ghi + ngay lúc ẩn / đóng trang
  const saveDraft = useCallback(() => {
    const t = targetRef.current;
    const u = userRef.current;
    const snap = recRef.current.snapshot();
    if (!t || !u || !snap) return;
    void stashVoice({
      id: recordId.current, userId: u.id, userName: u.full_name || u.username || '', type: t.type, subjectId: t.subjectId,
      relatedDate: t.relatedDate ?? null, title: t.title ?? '', blob: snap.blob, mime: snap.mime, ext: snap.ext,
      durationSec: snap.durationSec, recordedAt: snap.startedAt.toISOString(), draft: true,
    });
  }, []);
  useEffect(() => {
    if (!rec.active) return;
    const iv = window.setInterval(saveDraft, DRAFT_EVERY_MS);
    const onHide = () => { if (document.visibilityState === 'hidden') saveDraft(); };
    window.addEventListener('pagehide', saveDraft);
    document.addEventListener('visibilitychange', onHide);
    return () => { window.clearInterval(iv); window.removeEventListener('pagehide', saveDraft); document.removeEventListener('visibilitychange', onHide); };
  }, [rec.active, saveDraft]);

  // Mở app: tải lên các bản còn nằm trong kho tạm (nháp của lần tắt trang đột ngột, bản tải lỗi lần trước)
  const userId = user?.id;
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    (async () => {
      const items = await listStashedVoice(userId);
      for (const it of items) {
        if (!alive || (it.id === recordId.current && recRef.current.active)) continue;
        try {
          await uploadVoice({
            id: it.id, type: it.type, subjectId: it.subjectId, relatedDate: it.relatedDate,
            title: it.title || (it.draft ? 'Bản ghi bị ngắt giữa chừng' : ''), blob: it.blob, mime: it.mime, ext: it.ext,
            durationSec: it.durationSec, recordedAt: new Date(it.recordedAt), userId: it.userId, userName: it.userName,
          });
          await dropVoice(it.id);
          emitVoiceSaved(it.type, it.subjectId);
          if (it.draft) flash('Đã khôi phục và lưu một bản ghi âm bị ngắt giữa chừng lần trước.');
        } catch { /* giữ lại, lần mở sau thử tiếp */ }
      }
    })();
    return () => { alive = false; };
  }, [userId, flash]);

  const value = useMemo<Ctx>(() => ({ rec, target, start, cancel, notice }), [rec, target, start, cancel, notice]);
  return <VoiceCtx.Provider value={value}>{children}<RecordingBar /></VoiceCtx.Provider>;
}

/** Thanh nổi ở mọi trang khi đang ghi: giờ chạy, vạch âm, nhắc "quên tắt?", Dừng / Huỷ. */
function RecordingBar() {
  const ctx = useContext(VoiceCtx);
  const barRef = useRef<HTMLDivElement>(null);
  const rec = ctx?.rec;
  useEffect(() => {
    if (!rec?.active) return;
    let raf = 0;
    const tick = () => {
      const lv = rec.getLevel();
      barRef.current?.querySelectorAll<HTMLElement>('i').forEach((el, i) => {
        el.style.height = `${Math.max(3, 4 + lv * 18 * (0.5 + 0.5 * Math.sin(Date.now() / 140 + i * 1.3)))}px`;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [rec]);
  if (!ctx || !rec) return null;
  const { target, notice } = ctx;

  if (!rec.active) {
    if (!notice) return null;
    return (
      <div className="fixed left-1/2 -translate-x-1/2 bottom-4 z-[90] max-w-[92vw] rounded-xl bg-[#1D1D1F] text-white text-[12.5px] px-4 py-2.5 shadow-lg">
        {notice}
      </div>
    );
  }
  const paused = rec.phase === 'paused';
  const warn = rec.silenceLeftMs !== null;
  return (
    <div className="fixed left-1/2 -translate-x-1/2 bottom-4 z-[90] max-w-[94vw] flex flex-col items-stretch gap-1.5">
      {warn && (
        <div className="rounded-xl bg-amber-500 text-white text-[12.5px] px-4 py-2.5 shadow-lg flex items-center gap-3">
          <span className="flex-1">Đã lâu không nghe thấy tiếng — bạn quên tắt ghi âm? Sẽ tự dừng và lưu sau {Math.max(1, Math.ceil((rec.silenceLeftMs ?? 0) / 1000))} giây nữa nếu vẫn im lặng.</span>
          <button onClick={rec.keepAlive} className="shrink-0 px-2.5 py-1 rounded-lg bg-white/25 hover:bg-white/35 font-medium">Vẫn đang ghi</button>
        </div>
      )}
      <div ref={barRef} className="rounded-full bg-[#1D1D1F] text-white shadow-lg pl-4 pr-1.5 py-1.5 flex items-center gap-3">
        <span className={`w-2.5 h-2.5 rounded-full bg-red-500 ${paused ? '' : 'animate-pulse'}`} />
        <span className="text-[13px] font-semibold tabular-nums">{formatDuration(rec.elapsedMs / 1000)}</span>
        {paused ? <span className="text-[11.5px] text-white/60">tạm dừng</span>
          : <span className="flex items-center gap-[2px] h-5">{Array.from({ length: 7 }, (_, i) => <i key={i} className="block w-[3px] rounded bg-red-400" style={{ height: 4 }} />)}</span>}
        <span className="hidden sm:block text-[12px] text-white/70 max-w-[220px] truncate">Đang ghi · {target?.label ?? 'ghi âm'}</span>
        <button onClick={paused ? rec.resume : rec.pause} title={paused ? 'Ghi tiếp' : 'Tạm dừng'}
          className="w-8 h-8 rounded-full bg-white/15 hover:bg-white/25 flex items-center justify-center">{paused ? <Mic size={14} /> : <Pause size={14} />}</button>
        <button onClick={rec.stop} className="h-8 px-3 rounded-full bg-red-600 hover:bg-red-700 text-[12.5px] font-medium inline-flex items-center gap-1.5">
          <Square size={11} fill="currentColor" /> Dừng & lưu
        </button>
        <button onClick={() => { if (window.confirm('Huỷ và bỏ bản ghi âm đang ghi? Không khôi phục được.')) ctx.cancel(); }}
          title="Huỷ — không lưu" className="w-8 h-8 rounded-full text-white/60 hover:bg-white/15 flex items-center justify-center"><X size={14} /></button>
      </div>
    </div>
  );
}
