// Danh sách bản ghi âm trong 1 ghi chú: nghe lại (tua, đổi tốc độ), đổi tên, tải về, xoá — kèm bản đang / chưa tải lên.
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { AlertCircle, AudioLines, Download, Loader2, Pause, Pencil, Play, RotateCcw, Trash2 } from 'lucide-react';
import { errText, recordingUrl } from '../../lib/quickNotes/api';
import { formatBytes, formatDuration, recordingName } from '../../lib/quickNotes/noteText';
import type { PendingAudio, QuickNoteRecording } from '../../lib/quickNotes/types';
import TranscriptPanel, { type TranscribeJob } from './TranscriptPanel';

export interface UploadItem {
  item: PendingAudio;
  state: 'uploading' | 'error';
  error?: string;
}

const SPEEDS = [1, 1.25, 1.5, 2] as const;

interface PlayerHandle {
  /** Nhảy tới giây thứ `sec` rồi phát (bấm mốc [mm:ss] trong lời thoại). */
  jumpTo: (sec: number) => void;
}

const AudioPlayer = forwardRef<PlayerHandle, { rec: QuickNoteRecording; ink: string }>(function AudioPlayer({ rec, ink }, ref) {
  const audio = useRef<HTMLAudioElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(rec.duration_sec);
  const [rate, setRate] = useState<number>(1);
  const [busy, setBusy] = useState(false);
  // File webm của Chrome không ghi độ dài → muốn tua phải cho trình duyệt dò tới cuối 1 lần
  const seekAfterProbe = useRef<number | null>(null);
  const playAfterSeek = useRef(false);

  // Lấy sẵn link (server cấp, hạn 1 giờ) để bấm Phát chạy ngay trong cú bấm — Safari/iPhone bắt buộc vậy
  useEffect(() => {
    let alive = true;
    recordingUrl(rec.storage_path)
      .then(u => { if (alive) setUrl(u); })
      .catch(e => { if (alive) setErr(errText(e)); });
    return () => { alive = false; };
  }, [rec.storage_path]);

  const toggle = () => {
    const a = audio.current;
    if (!a || !url) return;
    if (a.paused) {
      a.playbackRate = rate;
      void a.play().catch(e => setErr(`Không phát được: ${errText(e)}`));
    } else a.pause();
  };

  const seek = (t: number) => {
    const a = audio.current;
    if (!a || !url) return;
    setCur(t);
    if (Number.isFinite(a.duration) && a.duration > 0) {
      a.currentTime = t;
      return;
    }
    seekAfterProbe.current = t;
    setBusy(true);
    if (a.readyState === 0) {
      a.preload = 'auto';
      a.load();
    } else a.currentTime = 1e101;
  };

  const onDurationKnown = () => {
    const a = audio.current;
    if (!a) return;
    if (Number.isFinite(a.duration) && a.duration > 0) {
      setDur(a.duration);
      if (seekAfterProbe.current !== null) {
        a.currentTime = Math.min(seekAfterProbe.current, a.duration);
        seekAfterProbe.current = null;
        setBusy(false);
        if (playAfterSeek.current) {
          playAfterSeek.current = false;
          a.playbackRate = rate;
          void a.play().catch(() => {});
        }
      }
    } else if (a.duration === Infinity && seekAfterProbe.current !== null) {
      a.currentTime = 1e101; // dò tới cuối để trình duyệt tính độ dài → durationchange gọi lại hàm này
    }
  };

  useImperativeHandle(ref, () => ({
    jumpTo: (sec: number) => {
      const a = audio.current;
      if (!a || !url) return;
      if (Number.isFinite(a.duration) && a.duration > 0) {
        a.currentTime = Math.min(sec, a.duration);
        setCur(sec);
        a.playbackRate = rate;
        void a.play().catch(e => setErr(`Không phát được: ${errText(e)}`));
        return;
      }
      playAfterSeek.current = true;
      seek(sec);
    },
  }));

  const cycleRate = () => {
    const next = SPEEDS[(SPEEDS.indexOf(rate as typeof SPEEDS[number]) + 1) % SPEEDS.length];
    setRate(next);
    if (audio.current) audio.current.playbackRate = next;
  };

  if (err) {
    return <div className="flex items-center gap-1.5 text-[12px] text-[#D70015]"><AlertCircle size={13} /> {err}</div>;
  }

  return (
    <div className="flex items-center gap-2">
      {url && (
        <audio ref={audio} src={url} preload="none"
          onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
          onTimeUpdate={e => { if (seekAfterProbe.current === null) setCur(e.currentTarget.currentTime); }}
          onDurationChange={onDurationKnown} onLoadedMetadata={onDurationKnown}
          onError={() => setErr('Trình duyệt không mở được file ghi âm này (thử tải về máy để nghe).')} />
      )}
      <button type="button" onClick={toggle} disabled={!url}
        aria-label={playing ? 'Tạm dừng' : 'Phát'} title={playing ? 'Tạm dừng' : 'Phát'}
        className="w-8 h-8 shrink-0 rounded-full flex items-center justify-center text-white disabled:opacity-40 active:scale-95 transition"
        style={{ background: ink }}>
        {!url || busy ? <Loader2 size={14} className="animate-spin" /> : playing ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" className="ml-0.5" />}
      </button>
      <input type="range" min={0} max={Math.max(dur, 0.1)} step={0.1} value={Math.min(cur, dur || cur)}
        onChange={e => seek(Number(e.target.value))} disabled={!url} aria-label="Tua"
        className="flex-1 min-w-0 h-1 cursor-pointer" style={{ accentColor: ink }} />
      <span className="text-[11px] tabular-nums shrink-0 opacity-70">{formatDuration(cur)} / {formatDuration(dur)}</span>
      <button type="button" onClick={cycleRate} title="Tốc độ phát"
        className="shrink-0 h-6 px-1.5 rounded-md text-[11px] font-semibold tabular-nums hover:bg-black/[0.06] transition">
        {rate}×
      </button>
    </div>
  );
});

function RecordingItem({ rec, ink, readOnly, job, onRename, onDelete, onTranscribe, onInsertSummary }: {
  rec: QuickNoteRecording;
  ink: string;
  readOnly?: boolean;
  job?: TranscribeJob;
  onRename: (title: string) => void;
  onDelete: () => void;
  onTranscribe: () => void;
  onInsertSummary: () => void;
}) {
  const player = useRef<PlayerHandle>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const name = recordingName(rec);

  const download = async () => {
    try {
      const url = await recordingUrl(rec.storage_path);
      const ext = rec.storage_path.split('.').pop() || 'webm';
      window.open(`${url}&download=${encodeURIComponent(`${name}.${ext}`)}`, '_blank', 'noopener');
    } catch (e) {
      alert(errText(e));
    }
  };

  const commit = () => {
    setEditing(false);
    const t = draft.trim();
    if (t !== rec.title.trim()) onRename(t);
  };

  return (
    <div className="rounded-[12px] bg-white/55 px-2.5 py-2 space-y-1.5">
      <div className="flex items-center gap-2 min-w-0">
        <AudioLines size={14} className="shrink-0 opacity-70" />
        {editing ? (
          <input autoFocus value={draft} onChange={e => setDraft(e.target.value)} onBlur={commit}
            onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
            className="flex-1 min-w-0 bg-white rounded-md px-1.5 py-0.5 text-[13px] outline-none ring-2 ring-[#0071E3]/30" />
        ) : (
          <span className="flex-1 min-w-0 truncate text-[13px] font-semibold" title={name}>{name}</span>
        )}
        <span className="shrink-0 text-[11px] opacity-60 tabular-nums">{formatBytes(rec.size_bytes)}</span>
        {!readOnly && (
          <button type="button" onClick={() => { setDraft(rec.title || name); setEditing(true); }} title="Đổi tên"
            className="shrink-0 w-6 h-6 rounded-md flex items-center justify-center opacity-60 hover:opacity-100 hover:bg-black/[0.06]"><Pencil size={12} /></button>
        )}
        <button type="button" onClick={() => void download()} title="Tải về máy"
          className="shrink-0 w-6 h-6 rounded-md flex items-center justify-center opacity-60 hover:opacity-100 hover:bg-black/[0.06]"><Download size={13} /></button>
        {!readOnly && (
          <button type="button" onClick={onDelete} title="Xoá bản ghi âm"
            className="shrink-0 w-6 h-6 rounded-md flex items-center justify-center opacity-60 hover:opacity-100 hover:bg-[#FF3B30]/10 hover:text-[#D70015]"><Trash2 size={12} /></button>
        )}
      </div>
      <AudioPlayer ref={player} rec={rec} ink={ink} />
      <TranscriptPanel rec={rec} job={job} readOnly={readOnly} onTranscribe={onTranscribe} onInsert={onInsertSummary}
        onJump={sec => player.current?.jumpTo(sec)} />
    </div>
  );
}

export default function RecordingList({
  recordings, uploads, jobs, ink, readOnly, onRename, onDelete, onRetry, onDownload, onTranscribe, onInsertSummary,
}: {
  recordings: QuickNoteRecording[];
  uploads: UploadItem[];
  jobs: Record<string, TranscribeJob>;
  ink: string;
  readOnly?: boolean;
  onRename: (rec: QuickNoteRecording, title: string) => void;
  onDelete: (rec: QuickNoteRecording) => void;
  onTranscribe: (rec: QuickNoteRecording) => void;
  onInsertSummary: (rec: QuickNoteRecording) => void;
  onRetry: (id: string) => void;
  onDownload: (id: string) => void;
}) {
  if (!recordings.length && !uploads.length) return null;
  return (
    <div className="space-y-1.5">
      {uploads.map(u => (
        <div key={u.item.id} className="rounded-[12px] bg-white/55 px-2.5 py-2 text-[12px]">
          <div className="flex items-center gap-2">
            {u.state === 'uploading'
              ? <Loader2 size={14} className="animate-spin shrink-0" />
              : <AlertCircle size={14} className="shrink-0 text-[#D70015]" />}
            <span className="flex-1 min-w-0 truncate font-semibold">{u.item.title} · {formatDuration(u.item.durationSec)}</span>
            {u.state === 'error' && (
              <>
                <button type="button" onClick={() => onRetry(u.item.id)}
                  className="shrink-0 inline-flex items-center gap-1 h-6 px-2 rounded-full bg-black/[0.07] hover:bg-black/[0.12] font-medium"><RotateCcw size={11} /> Thử lại</button>
                <button type="button" onClick={() => onDownload(u.item.id)} title="Lưu file về máy"
                  className="shrink-0 inline-flex items-center gap-1 h-6 px-2 rounded-full bg-black/[0.07] hover:bg-black/[0.12] font-medium"><Download size={11} /> Tải về</button>
              </>
            )}
          </div>
          <div className="mt-1 opacity-70">
            {u.state === 'uploading' ? 'Đang tải bản ghi lên…' : `Chưa tải lên được: ${u.error ?? 'lỗi không rõ'} — bản ghi vẫn giữ trên máy này.`}
          </div>
        </div>
      ))}
      {/* Mới nhất lên đầu — vừa ghi xong là thấy ngay */}
      {[...recordings].reverse().map(r => (
        <RecordingItem key={r.id} rec={r} ink={ink} readOnly={readOnly} job={jobs[r.id]}
          onRename={t => onRename(r, t)} onDelete={() => onDelete(r)}
          onTranscribe={() => onTranscribe(r)} onInsertSummary={() => onInsertSummary(r)} />
      ))}
    </div>
  );
}
