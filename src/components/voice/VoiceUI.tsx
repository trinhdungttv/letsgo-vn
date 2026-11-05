// Ghi âm dùng chung trong CRM (ghé chi nhánh · gọi chăm sóc · ghi chú công ty):
//   useVoiceCapture   hook ghi âm (dùng lại useAudioRecorder của Ghi chú nhanh) — giữ 1 bản ghi "chờ lưu"
//   RecorderControl   nút Ghi âm → thanh đang ghi (giờ, vạch âm lượng, Tạm dừng, Dừng, Huỷ)
//   PendingVoice      bản vừa ghi, nghe thử + Bỏ trước khi lưu
//   VoiceList         các bản đã lưu: nghe lại, đổi tên, xoá (hỏi trước)
import { useEffect, useMemo, useRef, useState } from 'react';
import { AudioLines, ChevronDown, ChevronRight, Download, Loader2, Mic, Pause, Pencil, Play, Square, Trash2, X } from 'lucide-react';
import { useAudioRecorder, type AudioRecorder, type RecordedAudio } from '../quickNotes/useAudioRecorder';
import { SILENCE, useCrmVoice, type VoiceTarget } from './VoiceRecorderProvider';
import { formatBytes, formatDuration } from '../../lib/quickNotes/noteText';
import { renameVoice, deleteVoice, type VoiceRecording } from '../../lib/voiceRec/api';

/** Ghi 1 bản; dừng xong thì nằm ở `pending` chờ người dùng lưu hoặc bỏ. */
export function useVoiceCapture() {
  const [pending, setPending] = useState<RecordedAudio | null>(null);
  const rec = useAudioRecorder(a => setPending(a), { enhance: true, silence: SILENCE });
  return { rec, pending, setPending, start: () => rec.start('crm-voice') };
}

function LevelBars({ rec }: { rec: AudioRecorder }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const lv = rec.getLevel();
      ref.current?.querySelectorAll<HTMLElement>('i').forEach((el, i) => {
        const h = 4 + lv * 16 * (0.5 + 0.5 * Math.sin(Date.now() / 140 + i * 1.3));
        el.style.height = `${Math.max(3, h)}px`;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [rec]);
  return <div ref={ref} className="flex items-center gap-[2px] h-5">{Array.from({ length: 7 }, (_, i) => <i key={i} className="block w-[3px] rounded bg-red-500" style={{ height: 4 }} />)}</div>;
}

export function RecorderControl({ rec, onStart, size = 'md', label = 'Ghi âm' }: {
  rec: AudioRecorder; onStart: () => void; size?: 'sm' | 'md'; label?: string;
}) {
  const pad = size === 'sm' ? 'h-7 px-2.5 text-[12px]' : 'h-8 px-3 text-[12.5px]';
  if (!rec.supported) return null;
  if (rec.phase === 'idle' || rec.phase === 'starting') {
    return (
      <div className="inline-flex flex-col items-start gap-1">
        <button type="button" onClick={onStart} disabled={rec.phase === 'starting'}
          className={`inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-white text-red-600 font-medium hover:bg-red-50 transition disabled:opacity-50 ${pad}`}>
          {rec.phase === 'starting' ? <Loader2 size={13} className="animate-spin" /> : <Mic size={13} />} {label}
        </button>
        {rec.error && <span className="text-[11px] text-red-600 max-w-[320px]">{rec.error}</span>}
      </div>
    );
  }
  const paused = rec.phase === 'paused';
  return (
    <div className="inline-flex flex-col items-start gap-1">
    {rec.silenceLeftMs !== null && (
      <div className="text-[11.5px] rounded-md bg-amber-50 border border-amber-300 text-amber-800 px-2.5 py-1">
        Lâu không nghe thấy tiếng — quên tắt? Tự dừng sau {Math.max(1, Math.ceil(rec.silenceLeftMs / 1000))} giây.
        <button type="button" onClick={rec.keepAlive} className="ml-2 underline font-medium">Vẫn đang ghi</button>
      </div>
    )}
    <div className="inline-flex items-center gap-2 rounded-full border border-red-300 bg-red-50 pl-3 pr-1 py-1">
      <span className={`w-2 h-2 rounded-full bg-red-500 ${paused ? '' : 'animate-pulse'}`} />
      <span className="text-[12.5px] font-semibold tabular-nums text-red-700">{formatDuration(rec.elapsedMs / 1000)}</span>
      {paused ? <span className="text-[11px] text-red-600">đang tạm dừng</span> : <LevelBars rec={rec} />}
      <button type="button" onClick={paused ? rec.resume : rec.pause} title={paused ? 'Ghi tiếp' : 'Tạm dừng'}
        className="w-7 h-7 rounded-full bg-white text-red-600 border border-red-200 flex items-center justify-center hover:bg-red-100">
        {paused ? <Mic size={13} /> : <Pause size={13} />}
      </button>
      <button type="button" onClick={rec.stop} title="Dừng và giữ bản ghi"
        className="h-7 px-2.5 rounded-full bg-red-600 text-white text-[12px] font-medium inline-flex items-center gap-1 hover:bg-red-700">
        <Square size={11} fill="currentColor" /> Dừng
      </button>
      <button type="button" onClick={rec.cancel} title="Huỷ — không giữ bản ghi" className="w-7 h-7 rounded-full text-red-400 hover:bg-red-100 flex items-center justify-center"><X size={14} /></button>
    </div>
    </div>
  );
}

/** Bản vừa ghi, chờ lưu: nghe thử + Bỏ. */
export function PendingVoice({ audio, onDiscard, note }: { audio: RecordedAudio; onDiscard: () => void; note?: string }) {
  const url = useMemo(() => URL.createObjectURL(audio.blob), [audio]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return (
    <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50/50 px-2.5 py-1.5">
      <Mic size={14} className="text-red-500 shrink-0" />
      <span className="text-[12px] font-medium text-[#333] shrink-0">Bản ghi {formatDuration(audio.durationSec)}</span>
      <audio src={url} controls preload="metadata" className="h-8 flex-1 min-w-0 max-w-[360px]" />
      {note && <span className="hidden md:inline text-[11px] text-[#999]">{note}</span>}
      <button type="button" onClick={onDiscard} title="Bỏ bản ghi này" className="p-1.5 rounded-lg text-[#999] hover:bg-red-100 hover:text-red-600"><Trash2 size={13} /></button>
    </div>
  );
}


const fmtWhen = (iso: string) => new Date(iso).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' });
const SPEEDS = [1, 1.25, 1.5, 2] as const;

/** Trình nghe gọn (như Ghi chú nhanh): nút phát, thanh tua, giờ, tốc độ. File webm của Chrome không ghi độ dài → dò tới cuối 1 lần khi tua. */
function MiniPlayer({ url, durationS }: { url: string; durationS: number }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(durationS);
  const [rate, setRate] = useState<number>(1);
  const [err, setErr] = useState('');
  const probe = useRef<number | null>(null);

  const toggle = () => {
    const a = audio.current; if (!a) return;
    if (a.paused) { a.playbackRate = rate; void a.play().catch(e => setErr(`Không phát được: ${(e as Error).message}`)); } else a.pause();
  };
  const onDur = () => {
    const a = audio.current; if (!a) return;
    if (Number.isFinite(a.duration) && a.duration > 0) {
      setDur(a.duration);
      if (probe.current !== null) { a.currentTime = Math.min(probe.current, a.duration); probe.current = null; }
    } else if (a.duration === Infinity && probe.current !== null) a.currentTime = 1e101;
  };
  const seek = (t: number) => {
    const a = audio.current; if (!a) return;
    setCur(t);
    if (Number.isFinite(a.duration) && a.duration > 0) { a.currentTime = t; return; }
    probe.current = t;
    if (a.readyState === 0) { a.preload = 'auto'; a.load(); } else a.currentTime = 1e101;
  };
  if (err) return <div className="text-[11.5px] text-red-600">{err}</div>;
  return (
    <div className="flex items-center gap-2">
      <audio ref={audio} src={url} preload="none" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
        onTimeUpdate={e => { if (probe.current === null) setCur(e.currentTarget.currentTime); }}
        onDurationChange={onDur} onLoadedMetadata={onDur}
        onError={() => setErr('Trình duyệt không mở được file này — thử tải về máy để nghe.')} />
      <button type="button" onClick={toggle} aria-label={playing ? 'Tạm dừng' : 'Phát'}
        className="w-7 h-7 shrink-0 rounded-full bg-[#1D1D1F] text-white flex items-center justify-center active:scale-95 transition">
        {playing ? <Pause size={12} fill="currentColor" /> : <Play size={12} fill="currentColor" className="ml-0.5" />}
      </button>
      <input type="range" min={0} max={Math.max(dur, 0.1)} step={0.1} value={Math.min(cur, dur || cur)} onChange={e => seek(Number(e.target.value))}
        aria-label="Tua" className="flex-1 min-w-0 h-1 cursor-pointer accent-[#1D1D1F]" />
      <span className="text-[11px] tabular-nums shrink-0 text-[#777]">{formatDuration(cur)} / {formatDuration(dur)}</span>
      <button type="button" onClick={() => { const n = SPEEDS[(SPEEDS.indexOf(rate as typeof SPEEDS[number]) + 1) % SPEEDS.length]; setRate(n); if (audio.current) audio.current.playbackRate = n; }}
        title="Tốc độ phát" className="shrink-0 h-6 px-1.5 rounded-md text-[11px] font-semibold tabular-nums hover:bg-black/[0.06]">{rate}×</button>
    </div>
  );
}

function VoiceRow({ r, readOnly, onChanged }: { r: VoiceRecording; readOnly?: boolean; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const label = r.title || 'Bản ghi âm';
  const commit = async () => {
    setEditing(false);
    if (name.trim() === r.title.trim()) return;
    try { await renameVoice(r.id, name.trim()); onChanged(); } catch (e) { alert('Không đổi được tên: ' + (e as Error).message); }
  };
  const remove = async () => {
    if (!window.confirm(`Xoá bản ghi âm ${fmtWhen(r.recorded_at)} (${formatDuration(r.duration_s)})? Bản ghi biến khỏi danh sách; file gốc vẫn giữ trong kho lưu trữ.`)) return;
    try { await deleteVoice(r.id); onChanged(); } catch (e) { alert('Không xoá được: ' + (e as Error).message); }
  };
  const btn = 'shrink-0 w-6 h-6 rounded-md flex items-center justify-center text-[#999] hover:bg-black/[0.06]';
  return (
    <div className="rounded-[10px] bg-white border border-[#EEEDE8] px-2.5 py-1.5 space-y-1">
      <div className="flex items-center gap-1.5 min-w-0">
        <AudioLines size={13} className="shrink-0 text-red-500" />
        {editing ? (
          <input autoFocus value={name} onChange={e => setName(e.target.value)} onBlur={() => void commit()}
            onKeyDown={e => { if (e.key === 'Enter') void commit(); if (e.key === 'Escape') setEditing(false); }}
            className="flex-1 min-w-0 h-6 px-1.5 text-[12.5px] border border-blue-400 rounded outline-none" />
        ) : (
          <span className="flex-1 min-w-0 truncate text-[12.5px]"><b className="font-semibold text-[#222]">{label}</b>
            <span className="text-[#999]"> · {fmtWhen(r.recorded_at)}{r.user_name ? ` · ${r.user_name}` : ''}{r.size_bytes ? ` · ${formatBytes(r.size_bytes)}` : ''}</span></span>
        )}
        {!readOnly && <button type="button" onClick={() => { setName(r.title); setEditing(true); }} title="Đặt tên" className={btn}><Pencil size={12} /></button>}
        <a href={r.url} download target="_blank" rel="noreferrer" title="Tải về máy" className={btn}><Download size={12} /></a>
        {!readOnly && <button type="button" onClick={() => void remove()} title="Xoá bản ghi" className={`${btn} hover:text-red-600 hover:bg-red-50`}><Trash2 size={12} /></button>}
      </div>
      <MiniPlayer url={r.url} durationS={r.duration_s} />
    </div>
  );
}

/** Các bản ghi đã lưu. `collapsible` = gói trong mục "🎙 Ghi âm · n" bấm để mở / thu (như ngăn ghi âm của Ghi chú nhanh). */
export function VoiceList({ items, onChanged, readOnly, collapsible, defaultOpen = false, title = 'Ghi âm' }: {
  items: VoiceRecording[]; onChanged: () => void; readOnly?: boolean; compact?: boolean;
  collapsible?: boolean; defaultOpen?: boolean; title?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (!items.length) return null;
  const rows = (
    <div className="space-y-1.5">{items.map(r => <VoiceRow key={r.id} r={r} readOnly={readOnly} onChanged={onChanged} />)}</div>
  );
  if (!collapsible) return rows;
  const total = items.reduce((n, r) => n + r.duration_s, 0);
  return (
    <div>
      <button type="button" onClick={() => setOpen(o => !o)} className="flex items-center gap-1.5 text-[12px] font-semibold text-[#555] hover:text-[#111]">
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <AudioLines size={13} className="text-red-500" /> {title} · {items.length}
        <span className="font-normal text-[#999]">({formatDuration(total)})</span>
      </button>
      {open && <div className="mt-1.5">{rows}</div>}
    </div>
  );
}

/** Nút Ghi âm dùng bộ ghi TOÀN APP (không dừng khi đổi tab trong cùng công ty / chi nhánh). */
export function VoiceRecordButton({ target, size = 'md' }: { target: VoiceTarget; size?: 'sm' | 'md' }) {
  const ctx = useCrmVoice();
  const pad = size === 'sm' ? 'h-7 px-2.5 text-[12px]' : 'h-8 px-3 text-[12.5px]';
  if (!ctx || !ctx.rec.supported) return null;
  const { rec, target: cur } = ctx;
  const mine = rec.active && cur?.type === target.type && cur?.subjectId === target.subjectId;
  if (mine) {
    return (
      <button type="button" onClick={rec.stop}
        className={`inline-flex items-center gap-1.5 rounded-full border border-red-300 bg-red-50 text-red-700 font-medium hover:bg-red-100 transition ${pad}`}>
        <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
        <span className="tabular-nums">{formatDuration(rec.elapsedMs / 1000)}</span> Dừng & lưu
      </button>
    );
  }
  const elsewhere = rec.active;
  return (
    <div className="inline-flex flex-col items-start gap-1">
      <button type="button" disabled={elsewhere || rec.phase === 'starting'} onClick={() => { void ctx.start(target); }}
        title={elsewhere ? `Đang ghi âm ở nơi khác (${cur?.label ?? ''}) — dừng bản đó trước` : 'Ghi âm'}
        className={`inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-white text-red-600 font-medium hover:bg-red-50 transition disabled:opacity-40 disabled:hover:bg-white ${pad}`}>
        {rec.phase === 'starting' ? <Loader2 size={13} className="animate-spin" /> : <Mic size={13} />} Ghi âm
      </button>
      {rec.error && !elsewhere && <span className="text-[11px] text-red-600 max-w-[320px]">{rec.error}</span>}
    </div>
  );
}
