// Ghi âm dùng chung trong CRM (ghé chi nhánh · gọi chăm sóc · ghi chú công ty):
//   useVoiceCapture   hook ghi âm (dùng lại useAudioRecorder của Ghi chú nhanh) — giữ 1 bản ghi "chờ lưu"
//   RecorderControl   nút Ghi âm → thanh đang ghi (giờ, vạch âm lượng, Tạm dừng, Dừng, Huỷ)
//   PendingVoice      bản vừa ghi, nghe thử + Bỏ trước khi lưu
//   VoiceList         các bản đã lưu: nghe lại, đổi tên, xoá (hỏi trước)
import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Loader2, Mic, Pause, Pencil, Play, Square, Trash2, X } from 'lucide-react';
import { useAudioRecorder, type AudioRecorder, type RecordedAudio } from '../quickNotes/useAudioRecorder';
import { formatBytes, formatDuration } from '../../lib/quickNotes/noteText';
import { renameVoice, deleteVoice, type VoiceRecording } from '../../lib/voiceRec/api';

/** Ghi 1 bản; dừng xong thì nằm ở `pending` chờ người dùng lưu hoặc bỏ. */
export function useVoiceCapture() {
  const [pending, setPending] = useState<RecordedAudio | null>(null);
  const rec = useAudioRecorder(a => setPending(a), { enhance: true });
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

export function VoiceList({ items, onChanged, readOnly, compact }: {
  items: VoiceRecording[]; onChanged: () => void; readOnly?: boolean; compact?: boolean;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  if (!items.length) return null;

  const saveName = async (id: string) => {
    setBusy(true);
    try { await renameVoice(id, name.trim()); setEditing(null); onChanged(); } catch (e) { alert('Không đổi được tên: ' + (e as Error).message); } finally { setBusy(false); }
  };
  const remove = async (r: VoiceRecording) => {
    if (!window.confirm(`Xoá bản ghi âm ${fmtWhen(r.recorded_at)} (${formatDuration(r.duration_s)})? Bản ghi sẽ biến khỏi danh sách; file gốc vẫn giữ trong kho lưu trữ.`)) return;
    try { await deleteVoice(r.id); onChanged(); } catch (e) { alert('Không xoá được: ' + (e as Error).message); }
  };

  return (
    <ul className="space-y-1.5">
      {items.map(r => (
        <li key={r.id} className="rounded-lg border border-[#E8E7E2] bg-white px-2.5 py-2">
          <div className="flex items-center gap-2 flex-wrap">
            <Play size={12} className="text-red-500 shrink-0" />
            {editing === r.id ? (
              <>
                <input autoFocus value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void saveName(r.id); if (e.key === 'Escape') setEditing(null); }}
                  placeholder="Tên bản ghi" className="h-7 px-2 text-[12.5px] border border-gray-300 rounded-md outline-none focus:border-blue-500 flex-1 min-w-[140px]" />
                <button onClick={() => void saveName(r.id)} disabled={busy} className="p-1 rounded text-emerald-600 hover:bg-emerald-50"><Check size={14} /></button>
                <button onClick={() => setEditing(null)} className="p-1 rounded text-[#999] hover:bg-gray-100"><X size={14} /></button>
              </>
            ) : (
              <>
                <span className="text-[12.5px] font-medium text-[#222]">{r.title || 'Bản ghi âm'}</span>
                <span className="text-[11px] text-[#999]">{fmtWhen(r.recorded_at)} · {formatDuration(r.duration_s)}{r.size_bytes ? ` · ${formatBytes(r.size_bytes)}` : ''}{r.user_name ? ` · ${r.user_name}` : ''}</span>
                {!readOnly && (
                  <span className="ml-auto flex gap-0.5">
                    <button onClick={() => { setEditing(r.id); setName(r.title); }} title="Đặt tên" className="p-1 rounded text-[#bbb] hover:text-blue-600 hover:bg-blue-50"><Pencil size={12} /></button>
                    <button onClick={() => void remove(r)} title="Xoá bản ghi" className="p-1 rounded text-[#bbb] hover:text-red-600 hover:bg-red-50"><Trash2 size={12} /></button>
                  </span>
                )}
              </>
            )}
          </div>
          <audio src={r.url} controls preload="none" className={`w-full mt-1.5 ${compact ? 'h-8' : 'h-9'}`} />
        </li>
      ))}
    </ul>
  );
}
