// Khung "Tóm tắt / Lời thoại" của 1 bản ghi âm (Gemini chép lời): đang chép thì hiện chữ chạy dần; xong thì 2 thẻ
// Tóm tắt (chèn được vào ghi chú) và Lời thoại (bấm mốc [mm:ss] để nghe lại đúng đoạn đó).
import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Check, ChevronDown, ChevronRight, Copy, Loader2, RotateCcw, Sparkles, TextQuote } from 'lucide-react';
import { copyText } from '../../lib/clipboard';
import { BOX_OPEN } from '../../lib/quickNotes/noteText';
import { parseTranscript } from '../../lib/quickNotes/transcript';
import type { QuickNoteRecording } from '../../lib/quickNotes/types';

export interface TranscribeJob {
  noteId: string;
  status: 'running' | 'error';
  stage: string;
  text: string;
  error?: string;
}

const pill = 'shrink-0 inline-flex items-center gap-1 h-6 px-2 rounded-full text-[11.5px] font-medium bg-black/[0.06] hover:bg-black/[0.1] transition disabled:opacity-40';

function SummaryView({ text }: { text: string }) {
  return (
    <div className="space-y-0.5 text-[12.5px] leading-[1.5]">
      {text.split('\n').map((raw, i) => {
        const t = raw.trim();
        if (!t) return <div key={i} className="h-1.5" />;
        if (t.startsWith('## ')) return <div key={i} className="pt-1 text-[10.5px] font-bold uppercase tracking-wide opacity-55">{t.slice(3)}</div>;
        const box = t.match(/^[-*•]\s*([☐☑])\s*(.*)$/);
        if (box) return <div key={i} className="flex gap-1.5"><span className="shrink-0">{box[1] === '☑' ? '☑' : BOX_OPEN}</span><span>{box[2]}</span></div>;
        const bullet = t.match(/^[-*•]\s+(.*)$/);
        if (bullet) return <div key={i} className="flex gap-1.5"><span className="shrink-0 opacity-50">•</span><span>{bullet[1]}</span></div>;
        return <div key={i}>{t}</div>;
      })}
    </div>
  );
}

function TranscriptView({ text, onJump }: { text: string; onJump: (sec: number) => void }) {
  const lines = useMemo(() => parseTranscript(text), [text]);
  return (
    <div className="space-y-1 text-[12.5px] leading-[1.5]">
      {lines.map((l, i) => (
        <div key={i} className="flex gap-1.5">
          {l.at !== null ? (
            <button type="button" onClick={() => onJump(l.at!)} title="Nghe lại từ đoạn này" aria-label={`Nghe lại từ ${l.stamp}`}
              className="shrink-0 h-5 px-1 rounded-md bg-black/[0.06] hover:bg-black/[0.12] text-[11px] font-semibold tabular-nums leading-5">
              {l.stamp}
            </button>
          ) : <span className="shrink-0 w-0" />}
          <span>{l.speaker && <b className="font-semibold">{l.speaker}: </b>}{l.text}</span>
        </div>
      ))}
    </div>
  );
}

export default function TranscriptPanel({ rec, job, readOnly, onTranscribe, onInsert, onJump }: {
  rec: QuickNoteRecording;
  job?: TranscribeJob;
  readOnly?: boolean;
  onTranscribe: () => void;
  onInsert: () => void;
  onJump: (sec: number) => void;
}) {
  const [tab, setTab] = useState<'summary' | 'transcript'>('summary');
  const [open, setOpen] = useState(true);
  const [copied, setCopied] = useState(false);
  const tail = useRef<HTMLDivElement>(null);
  const has = !!(rec.summary || rec.transcript);
  // Thẻ đang chọn chưa có nội dung (vd chỉ có lời thoại) → hiện thẻ còn lại
  const shownTab = tab === 'summary' && !rec.summary ? 'transcript' : tab === 'transcript' && !rec.transcript ? 'summary' : tab;

  // Chữ đang chạy → luôn cuộn xuống dòng mới nhất
  useEffect(() => {
    if (tail.current) tail.current.scrollTop = tail.current.scrollHeight;
  }, [job?.text]);

  if (job?.status === 'running') {
    return (
      <div className="rounded-[10px] bg-black/[0.04] px-2.5 py-2 text-[12px]">
        <div className="flex items-center gap-1.5 font-medium"><Loader2 size={13} className="animate-spin" /> {job.stage}</div>
        {job.text ? (
          <div ref={tail} className="mt-1 max-h-28 overflow-y-auto whitespace-pre-wrap leading-[1.45] opacity-75">{job.text}</div>
        ) : (
          <div className="mt-0.5 opacity-60">Bản ghi 1 giờ mất khoảng 1–3 phút. Có thể đóng ghi chú, đừng đóng trang.</div>
        )}
      </div>
    );
  }

  const errorRow = job?.status === 'error' && (
    <div className="flex items-start gap-1.5 text-[12px] text-[#B0000F]">
      <AlertCircle size={13} className="mt-0.5 shrink-0" />
      <span className="flex-1">{job.error}</span>
      {!readOnly && <button type="button" onClick={onTranscribe} className={pill}><RotateCcw size={11} /> Thử lại</button>}
    </div>
  );

  if (!has) {
    if (readOnly) return null;
    return errorRow || (
      <button type="button" onClick={onTranscribe}
        title="Gemini nghe bản ghi, chép lại lời thoại theo từng người nói và tóm tắt ý chính + việc cần làm (khoảng 5 nghìn đồng mỗi giờ ghi âm)"
        className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-[12px] font-semibold bg-white/70 hover:bg-white transition">
        <Sparkles size={13} /> Chép lời & tóm tắt
      </button>
    );
  }

  const current = shownTab === 'summary' ? (rec.summary ?? '') : (rec.transcript ?? '');
  const copy = async () => {
    if (await copyText(current)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <div className="rounded-[10px] bg-white/45 px-2.5 py-2 space-y-1.5">
      <div className="flex items-center gap-1 min-w-0">
        <button type="button" onClick={() => setOpen(o => !o)} aria-label={open ? 'Thu gọn' : 'Mở rộng'}
          className="shrink-0 w-5 h-5 rounded-md flex items-center justify-center opacity-60 hover:opacity-100">
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        {(['summary', 'transcript'] as const).map(k => (
          <button key={k} type="button" disabled={k === 'summary' ? !rec.summary : !rec.transcript}
            onClick={() => { setTab(k); setOpen(true); }}
            className={`shrink-0 h-6 px-2 rounded-full text-[11.5px] font-semibold transition disabled:opacity-35 ${shownTab === k && open ? 'bg-black/[0.1]' : 'opacity-70 hover:opacity-100'}`}>
            {k === 'summary' ? 'Tóm tắt' : 'Lời thoại'}
          </button>
        ))}
        <span className="flex-1" />
        {!readOnly && shownTab === 'summary' && rec.summary && (
          <button type="button" onClick={onInsert} className={pill} title="Chép tóm tắt + việc cần làm vào cuối ghi chú">
            <TextQuote size={11} /> <span className="hidden sm:inline">Chèn vào ghi chú</span><span className="sm:hidden">Chèn</span>
          </button>
        )}
        <button type="button" onClick={() => void copy()} title="Sao chép" aria-label="Sao chép"
          className="shrink-0 w-6 h-6 rounded-md flex items-center justify-center opacity-60 hover:opacity-100 hover:bg-black/[0.06]">
          {copied ? <Check size={12} /> : <Copy size={12} />}
        </button>
        {!readOnly && (
          <button type="button" onClick={onTranscribe} title="Chép lại từ đầu (tính thêm phí Gemini)" aria-label="Chép lại"
            className="shrink-0 w-6 h-6 rounded-md flex items-center justify-center opacity-60 hover:opacity-100 hover:bg-black/[0.06]">
            <RotateCcw size={12} />
          </button>
        )}
      </div>
      {errorRow}
      {open && (
        <div className="max-h-56 overflow-y-auto pr-1">
          {shownTab === 'summary' ? <SummaryView text={rec.summary ?? ''} /> : <TranscriptView text={rec.transcript ?? ''} onJump={onJump} />}
        </div>
      )}
    </div>
  );
}
