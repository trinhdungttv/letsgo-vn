// Pháp lý — "Bài học trực quan": trình bày tài liệu tự soạn bằng KHỐI MÀU để học bằng hình ảnh / màu sắc.
// 2 chế độ: Xem (trình bày đẹp, tích được danh sách kiểm) · Soạn (sửa từng khối, thêm / đổi chỗ / xoá khối).
// Định dạng trong dòng: **đậm**  ==tô vàng==  !!chữ đỏ!!  (xem lib/legal/lesson.ts).
import { Fragment, useLayoutEffect, useRef, useState, type ClipboardEvent, type ReactNode } from 'react';
import {
  AlertTriangle, ArrowDown, Check, ArrowRight, ArrowUp, Ban, BookOpen, Brain, CheckCircle2, Columns3, Eye, Heading2, ImagePlus, ListChecks,
  ListOrdered, Loader2, Minus, MonitorPlay, PencilLine, Plus, Quote, Scale, Trash2, Type, Upload, X,
} from 'lucide-react';
import {
  BLOCK_TYPES, CALLOUT_TONE_IDS, CALLOUT_TONES, moveBlock, newBlock, parseInline,
  type BlockType, type CalloutTone, type LessonBlock, type LessonDoc,
} from '../../lib/legal/lesson';
import { rid, SWATCHES } from '../../lib/legal/types';
import { uploadLegalImage } from '../../lib/legal/upload';
import { EmbedFrame } from './Embed';
import { INPUT_CLS, shade, soft, Swatches } from './ui';
import { POPOVER } from '../workspace/wsTheme';

const TONE_ICON: Record<CalloutTone, typeof BookOpen> = {
  define: BookOpen, note: AlertTriangle, danger: Ban, tip: Brain, example: CheckCircle2, law: Scale,
};
const BLOCK_ICON: Record<BlockType, typeof BookOpen> = {
  h: Heading2, p: Type, callout: BookOpen, steps: ListOrdered, check: ListChecks, compare: Columns3,
  quote: Quote, image: ImagePlus, embed: MonitorPlay, divider: Minus,
};
const STEP_COLORS = ['#0071E3', '#5856D6', '#AF52DE', '#FF2D55', '#FF9500', '#34C759', '#30B0C7'];
const COL_COLORS = ['#6E6E73', '#0071E3', '#AF52DE', '#FF9500', '#34C759'];

// ── Chữ có định dạng ──────────────────────────────────────────────────────
export function RichText({ text, className = '' }: { text: string; className?: string }) {
  if (!text) return null;
  return (
    <span className={`whitespace-pre-wrap ${className}`}>
      {parseInline(text).map((p, i) => (
        p.mark === 'bold' ? <strong key={i} className="font-semibold text-[#1D1D1F]">{p.text}</strong>
          : p.mark === 'hl' ? <mark key={i} className="bg-[#FFE066]/80 text-inherit rounded-[3px] px-[3px] -mx-[1px] [box-decoration-break:clone]">{p.text}</mark>
            : p.mark === 'red' ? <strong key={i} className="font-semibold text-[#D70015]">{p.text}</strong>
              : <Fragment key={i}>{p.text}</Fragment>
      ))}
    </span>
  );
}

function AutoText({ value, onChange, placeholder, className = '', minRows = 1, onPaste }: {
  value: string; onChange: (v: string) => void; placeholder?: string; className?: string; minRows?: number;
  onPaste?: (e: ClipboardEvent<HTMLTextAreaElement>) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <textarea ref={ref} value={value} rows={minRows} placeholder={placeholder} onPaste={onPaste}
      onChange={e => onChange(e.target.value)}
      className={`w-full resize-none bg-transparent outline-none placeholder:text-[#AEAEB2] overflow-hidden ${className}`} />
  );
}

// ── Khối ở chế độ Xem ─────────────────────────────────────────────────────
function ViewBlock({ b, accent, onToggleCheck, onZoom }: {
  b: LessonBlock; accent: string; onToggleCheck?: (blockId: string, itemId: string) => void; onZoom: (url: string) => void;
}) {
  switch (b.t) {
    case 'h':
      return (
        <h2 className="flex items-center gap-3 text-[20px] md:text-[22px] font-semibold tracking-[-0.02em] text-[#1D1D1F] pt-4">
          <span className="w-1.5 h-6 rounded-full shrink-0" style={{ background: accent }} />
          <RichText text={b.text || 'Tiêu đề'} />
        </h2>
      );
    case 'p':
      return <p className="text-[15px] md:text-[15.5px] leading-[1.75] text-[#3A3A3C]"><RichText text={b.text} /></p>;
    case 'callout': {
      const tone = CALLOUT_TONES[b.tone];
      const Icon = TONE_ICON[b.tone];
      return (
        <div className="relative rounded-[16px] pl-4 pr-4 py-3.5 md:pl-5 md:pr-5 md:py-4 overflow-hidden" style={{ background: tone.bg }}>
          <span className="absolute left-0 top-0 bottom-0 w-[5px]" style={{ background: tone.color }} />
          <div className="flex items-center gap-2 mb-1">
            <span className="w-7 h-7 rounded-[9px] inline-flex items-center justify-center text-white shrink-0" style={{ background: `linear-gradient(180deg, ${shade(tone.color, 0.2)}, ${tone.color})` }}><Icon size={15} /></span>
            <span className="text-[11.5px] font-bold uppercase tracking-[0.08em]" style={{ color: tone.color }}>{b.title || tone.label}</span>
          </div>
          <div className="text-[14.5px] md:text-[15px] leading-[1.7]" style={{ color: tone.ink }}><RichText text={b.text} /></div>
        </div>
      );
    }
    case 'steps':
      return (
        <ol className="grid gap-2.5 md:gap-3" style={{ gridTemplateColumns: `repeat(auto-fit, minmax(${b.items.length > 4 ? 150 : 180}px, 1fr))` }}>
          {b.items.map((it, i) => {
            const c = STEP_COLORS[i % STEP_COLORS.length];
            return (
              <li key={it.id} className="relative rounded-[16px] p-3.5 bg-white shadow-[0_0_0_0.5px_rgba(0,0,0,0.08),0_6px_18px_-10px_rgba(0,0,0,0.18)]" style={{ borderTop: `4px solid ${c}` }}>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="w-7 h-7 rounded-full text-white text-[13px] font-bold inline-flex items-center justify-center shrink-0" style={{ background: c }}>{i + 1}</span>
                  {i < b.items.length - 1 && <ArrowRight size={14} className="ml-auto text-[#C7C7CC] hidden md:block" />}
                </div>
                <div className="text-[14px] font-semibold text-[#1D1D1F] leading-snug"><RichText text={it.title} /></div>
                {it.text && <div className="text-[13px] text-[#6E6E73] leading-relaxed mt-1"><RichText text={it.text} /></div>}
              </li>
            );
          })}
        </ol>
      );
    case 'check': {
      const done = b.items.filter(i => i.done).length;
      return (
        <div className="rounded-[16px] bg-white shadow-[0_0_0_0.5px_rgba(0,0,0,0.08)] p-1.5">
          {b.items.length > 1 && (
            <div className="flex items-center gap-2 px-2.5 pt-1.5 pb-2">
              <div className="flex-1 h-1.5 rounded-full bg-black/[0.06] overflow-hidden"><div className="h-full rounded-full bg-[#34C759] transition-all" style={{ width: `${(done / b.items.length) * 100}%` }} /></div>
              <span className="text-[11.5px] text-[#86868B] tabular-nums">{done}/{b.items.length}</span>
            </div>
          )}
          {b.items.map(it => (
            <button key={it.id} type="button" disabled={!onToggleCheck} onClick={() => onToggleCheck?.(b.id, it.id)}
              className="w-full flex items-start gap-2.5 px-2.5 py-2 rounded-[10px] text-left hover:bg-black/[0.03] disabled:hover:bg-transparent">
              <span className={`mt-[2px] w-[19px] h-[19px] rounded-full shrink-0 inline-flex items-center justify-center transition ${it.done ? 'bg-[#34C759] text-white' : 'border-[1.5px] border-[#C7C7CC]'}`}>
                {it.done && <Check size={12} strokeWidth={3.2} />}
              </span>
              <span className={`text-[14.5px] leading-[1.6] ${it.done ? 'text-[#86868B] line-through' : 'text-[#1D1D1F]'}`}><RichText text={it.text} /></span>
            </button>
          ))}
        </div>
      );
    }
    case 'quote':
      return (
        <figure className="relative rounded-[16px] bg-[#FBFAF7] px-5 md:px-7 py-4 md:py-5 shadow-[inset_0_0_0_0.5px_rgba(0,0,0,0.08)]">
          <Quote size={28} className="absolute -top-3 left-4 text-[#C7A86B] bg-[#FBFAF7] rounded-full p-1" />
          <blockquote className="text-[15px] md:text-[16px] leading-[1.75] text-[#2C2C2E] italic" style={{ fontFamily: '"New York", "Iowan Old Style", Georgia, serif' }}>
            <RichText text={b.text} />
          </blockquote>
          {b.source && <figcaption className="text-[12px] text-[#86868B] mt-2 font-medium">— {b.source}</figcaption>}
        </figure>
      );
    case 'compare':
      return (
        <div className="overflow-x-auto rounded-[16px] shadow-[0_0_0_0.5px_rgba(0,0,0,0.1)] bg-white">
          <table className="w-full text-[13.5px] border-collapse min-w-[480px]">
            <thead>
              <tr>{b.cols.map((c, i) => (
                <th key={i} className="text-left font-semibold text-white px-3.5 py-2.5" style={{ background: COL_COLORS[i % COL_COLORS.length] }}>{c}</th>
              ))}</tr>
            </thead>
            <tbody>
              {b.rows.map((row, r) => (
                <tr key={r} className="border-t border-black/[0.06] even:bg-black/[0.015]">
                  {row.map((cell, i) => (
                    <td key={i} className={`align-top px-3.5 py-2.5 leading-relaxed ${i === 0 ? 'font-semibold text-[#1D1D1F]' : 'text-[#3A3A3C]'}`}
                      style={i > 0 ? { background: soft(COL_COLORS[i % COL_COLORS.length], 0.04) } : undefined}><RichText text={cell} /></td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'image':
      if (!b.url) return null;
      return (
        <figure>
          <button type="button" onClick={() => onZoom(b.url)} className="block w-full rounded-[16px] overflow-hidden bg-black/[0.03] shadow-[0_0_0_0.5px_rgba(0,0,0,0.08)] cursor-zoom-in">
            <img src={b.url} alt={b.caption} className="w-full max-h-[560px] object-contain" />
          </button>
          {b.caption && <figcaption className="text-[12.5px] text-[#86868B] text-center mt-1.5">{b.caption}</figcaption>}
        </figure>
      );
    case 'embed':
      if (!b.url) return null;
      return (
        <figure>
          <EmbedFrame url={b.url} title={b.caption || 'Tài liệu nhúng'} className="w-full aspect-[4/3] md:aspect-video shadow-[0_0_0_0.5px_rgba(0,0,0,0.1)]" />
          {b.caption && <figcaption className="text-[12.5px] text-[#86868B] text-center mt-1.5">{b.caption}</figcaption>}
        </figure>
      );
    case 'divider':
      return <hr className="border-0 h-px bg-black/[0.08] my-2" />;
  }
}

// ── Khối ở chế độ Soạn ────────────────────────────────────────────────────
function EditBlock({ b, onChange, toast }: { b: LessonBlock; onChange: (b: LessonBlock) => void; toast: (m: string) => void }) {
  const [uploading, setUploading] = useState(false);
  const upload = async (file: File) => {
    setUploading(true);
    try {
      const url = await uploadLegalImage(file);
      if (b.t === 'image') onChange({ ...b, url });
    } catch (e) { toast((e as Error).message); }
    setUploading(false);
  };
  const pasteImage = (e: ClipboardEvent<HTMLTextAreaElement | HTMLInputElement>) => {
    const file = [...e.clipboardData.files].find(f => f.type.startsWith('image/'));
    if (file && b.t === 'image') { e.preventDefault(); void upload(file); }
  };

  switch (b.t) {
    case 'h':
      return <AutoText value={b.text} onChange={text => onChange({ ...b, text })} placeholder="Tiêu đề mục…" className="text-[20px] font-semibold tracking-[-0.02em] text-[#1D1D1F]" />;
    case 'p':
      return <AutoText value={b.text} onChange={text => onChange({ ...b, text })} minRows={2} placeholder="Viết nội dung… (**đậm**  ==tô vàng==  !!chữ đỏ!!)" className="text-[15px] leading-[1.75] text-[#3A3A3C]" />;
    case 'callout': {
      const tone = CALLOUT_TONES[b.tone];
      return (
        <div className="rounded-[16px] p-3.5" style={{ background: tone.bg, boxShadow: `inset 4px 0 0 ${tone.color}` }}>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {CALLOUT_TONE_IDS.map(id => {
              const t = CALLOUT_TONES[id];
              const Icon = TONE_ICON[id];
              const on = id === b.tone;
              return (
                <button key={id} type="button" onClick={() => onChange({ ...b, tone: id })}
                  className={`inline-flex items-center gap-1 h-7 px-2.5 rounded-full text-[12px] font-medium transition ${on ? 'text-white' : 'bg-white/70 text-[#3A3A3C] hover:bg-white'}`}
                  style={on ? { background: t.color } : undefined}>
                  <Icon size={12} /> {t.label}
                </button>
              );
            })}
          </div>
          <input value={b.title} onChange={e => onChange({ ...b, title: e.target.value })} placeholder={`Tiêu đề (mặc định: ${tone.label})`}
            className="w-full bg-transparent outline-none text-[12px] font-bold uppercase tracking-[0.08em] placeholder:normal-case placeholder:font-medium placeholder:tracking-normal placeholder:text-black/30" style={{ color: tone.color }} />
          <AutoText value={b.text} onChange={text => onChange({ ...b, text })} minRows={2} placeholder="Nội dung…" className="text-[15px] leading-[1.7] mt-1" />
        </div>
      );
    }
    case 'steps':
      return (
        <div className="space-y-2">
          {b.items.map((it, i) => {
            const c = STEP_COLORS[i % STEP_COLORS.length];
            const setItem = (patch: Partial<typeof it>) => onChange({ ...b, items: b.items.map(x => (x.id === it.id ? { ...x, ...patch } : x)) });
            return (
              <div key={it.id} className="group/step flex gap-2.5 items-start rounded-[14px] bg-white p-2.5 shadow-[0_0_0_0.5px_rgba(0,0,0,0.1)]">
                <span className="w-7 h-7 mt-0.5 rounded-full text-white text-[13px] font-bold inline-flex items-center justify-center shrink-0" style={{ background: c }}>{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <input value={it.title} onChange={e => setItem({ title: e.target.value })} placeholder={`Bước ${i + 1}`} className="w-full bg-transparent outline-none text-[14px] font-semibold text-[#1D1D1F] placeholder:text-[#AEAEB2]" />
                  <AutoText value={it.text} onChange={text => setItem({ text })} placeholder="Chi tiết (tuỳ chọn)" className="text-[13px] text-[#6E6E73] leading-relaxed" />
                </div>
                <div className="flex flex-col opacity-0 group-hover/step:opacity-100 transition">
                  <button type="button" title="Lên" onClick={() => { const n = [...b.items]; if (i > 0) { [n[i - 1], n[i]] = [n[i], n[i - 1]]; onChange({ ...b, items: n }); } }} className="p-1 text-[#86868B] hover:text-[#1D1D1F]"><ArrowUp size={13} /></button>
                  <button type="button" title="Xoá bước" onClick={() => onChange({ ...b, items: b.items.filter(x => x.id !== it.id) })} className="p-1 text-[#86868B] hover:text-[#D70015]"><X size={13} /></button>
                </div>
              </div>
            );
          })}
          <button type="button" onClick={() => onChange({ ...b, items: [...b.items, { id: rid(), title: '', text: '' }] })} className="inline-flex items-center gap-1 text-[12.5px] font-medium text-[#0066CC] hover:underline"><Plus size={13} /> Thêm bước</button>
        </div>
      );
    case 'check':
      return (
        <div className="rounded-[14px] bg-white p-2 shadow-[0_0_0_0.5px_rgba(0,0,0,0.1)] space-y-0.5">
          {b.items.map(it => (
            <div key={it.id} className="group/ck flex items-center gap-2 px-1.5">
              <input type="checkbox" checked={it.done} onChange={e => onChange({ ...b, items: b.items.map(x => (x.id === it.id ? { ...x, done: e.target.checked } : x)) })} className="w-4 h-4 accent-[#34C759] shrink-0" />
              <input value={it.text} onChange={e => onChange({ ...b, items: b.items.map(x => (x.id === it.id ? { ...x, text: e.target.value } : x)) })}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onChange({ ...b, items: [...b.items, { id: rid(), text: '', done: false }] }); } }}
                placeholder="Mục cần chuẩn bị… (Enter = thêm dòng)" className="flex-1 min-w-0 h-8 bg-transparent outline-none text-[14px] text-[#1D1D1F] placeholder:text-[#AEAEB2]" />
              <button type="button" title="Xoá dòng" onClick={() => onChange({ ...b, items: b.items.filter(x => x.id !== it.id) })} className="p-1 text-[#86868B] hover:text-[#D70015] opacity-0 group-hover/ck:opacity-100"><X size={13} /></button>
            </div>
          ))}
          <button type="button" onClick={() => onChange({ ...b, items: [...b.items, { id: rid(), text: '', done: false }] })} className="inline-flex items-center gap-1 px-1.5 py-1 text-[12.5px] font-medium text-[#0066CC] hover:underline"><Plus size={13} /> Thêm dòng</button>
        </div>
      );
    case 'quote':
      return (
        <div className="rounded-[14px] bg-[#FBFAF7] p-3.5 shadow-[inset_0_0_0_0.5px_rgba(0,0,0,0.08)]">
          <AutoText value={b.text} onChange={text => onChange({ ...b, text })} minRows={2} placeholder="Trích nguyên văn điều khoản…" className="text-[15px] leading-[1.75] italic text-[#2C2C2E]" />
          <input value={b.source} onChange={e => onChange({ ...b, source: e.target.value })} placeholder="Nguồn — vd Điều 54, Bộ luật Lao động 2019" className="w-full bg-transparent outline-none text-[12.5px] text-[#86868B] mt-1 placeholder:text-[#AEAEB2]" />
        </div>
      );
    case 'compare': {
      const width = b.cols.length;
      const setCol = (i: number, v: string) => onChange({ ...b, cols: b.cols.map((c, j) => (j === i ? v : c)) });
      const setCell = (r: number, i: number, v: string) => onChange({ ...b, rows: b.rows.map((row, k) => (k === r ? row.map((c, j) => (j === i ? v : c)) : row)) });
      return (
        <div className="space-y-2">
          <div className="overflow-x-auto rounded-[14px] shadow-[0_0_0_0.5px_rgba(0,0,0,0.12)] bg-white">
            <table className="w-full border-collapse min-w-[480px] text-[13.5px]">
              <thead>
                <tr>{b.cols.map((c, i) => (
                  <th key={i} className="p-0" style={{ background: COL_COLORS[i % COL_COLORS.length] }}>
                    <div className="flex items-center">
                      <input value={c} onChange={e => setCol(i, e.target.value)} className="flex-1 min-w-0 bg-transparent outline-none text-white font-semibold px-3 py-2 placeholder:text-white/60" placeholder={`Cột ${i + 1}`} />
                      {width > 2 && <button type="button" title="Xoá cột" onClick={() => onChange({ ...b, cols: b.cols.filter((_, j) => j !== i), rows: b.rows.map(row => row.filter((_, j) => j !== i)) })} className="px-1.5 text-white/70 hover:text-white"><X size={12} /></button>}
                    </div>
                  </th>
                ))}</tr>
              </thead>
              <tbody>
                {b.rows.map((row, r) => (
                  <tr key={r} className="group/row border-t border-black/[0.06]">
                    {row.map((cell, i) => (
                      <td key={i} className="align-top p-0 relative">
                        <AutoText value={cell} onChange={v => setCell(r, i, v)} placeholder="…" className={`px-3 py-2 text-[13.5px] leading-relaxed ${i === 0 ? 'font-semibold' : ''}`} />
                        {i === row.length - 1 && <button type="button" title="Xoá dòng" onClick={() => onChange({ ...b, rows: b.rows.filter((_, k) => k !== r) })} className="absolute right-1 top-1.5 p-1 text-[#86868B] hover:text-[#D70015] opacity-0 group-hover/row:opacity-100"><X size={12} /></button>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex gap-3">
            <button type="button" onClick={() => onChange({ ...b, rows: [...b.rows, Array(width).fill('')] })} className="inline-flex items-center gap-1 text-[12.5px] font-medium text-[#0066CC] hover:underline"><Plus size={13} /> Thêm dòng</button>
            {width < 5 && <button type="button" onClick={() => onChange({ ...b, cols: [...b.cols, `Phương án ${String.fromCharCode(64 + width)}`], rows: b.rows.map(row => [...row, '']) })} className="inline-flex items-center gap-1 text-[12.5px] font-medium text-[#0066CC] hover:underline"><Plus size={13} /> Thêm cột</button>}
          </div>
        </div>
      );
    }
    case 'image':
      return (
        <div className="rounded-[14px] bg-white p-3 shadow-[0_0_0_0.5px_rgba(0,0,0,0.1)] space-y-2">
          {b.url && <img src={b.url} alt="" className="w-full max-h-[360px] object-contain rounded-[10px] bg-black/[0.03]" />}
          <div className="flex gap-2">
            <input value={b.url} onChange={e => onChange({ ...b, url: e.target.value })} onPaste={pasteImage} placeholder="Dán link ảnh, hoặc dán ảnh (⌘V) / tải ảnh lên" className={`${INPUT_CLS} flex-1`} />
            <label className="shrink-0 inline-flex items-center gap-1.5 h-10 md:h-9 px-3 rounded-[10px] bg-black/[0.05] text-[13px] font-medium cursor-pointer hover:bg-black/[0.08]">
              {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} Tải ảnh
              <input type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void upload(f); }} />
            </label>
          </div>
          <input value={b.caption} onChange={e => onChange({ ...b, caption: e.target.value })} placeholder="Chú thích ảnh (tuỳ chọn)" className={INPUT_CLS} />
        </div>
      );
    case 'embed':
      return (
        <div className="rounded-[14px] bg-white p-3 shadow-[0_0_0_0.5px_rgba(0,0,0,0.1)] space-y-2">
          <input value={b.url} onChange={e => onChange({ ...b, url: e.target.value })} placeholder="Link Google Drive / Docs / Sheets / Slides / YouTube" className={INPUT_CLS} />
          <input value={b.caption} onChange={e => onChange({ ...b, caption: e.target.value })} placeholder="Chú thích (tuỳ chọn)" className={INPUT_CLS} />
          {b.url && <EmbedFrame url={b.url} title={b.caption || 'Xem trước'} className="w-full aspect-video shadow-[0_0_0_0.5px_rgba(0,0,0,0.1)]" />}
        </div>
      );
    case 'divider':
      return <hr className="border-0 h-px bg-black/[0.12] my-3" />;
  }
}

function BlockPicker({ onPick, onClose }: { onPick: (t: BlockType) => void; onClose: () => void }) {
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className={`absolute left-1/2 -translate-x-1/2 top-8 z-50 w-[min(92vw,460px)] p-2 grid grid-cols-2 gap-1 ${POPOVER}`}>
        {BLOCK_TYPES.map(bt => {
          const Icon = BLOCK_ICON[bt.t];
          return (
            <button key={bt.t} type="button" onClick={() => { onPick(bt.t); onClose(); }} className="flex items-start gap-2.5 p-2 rounded-[10px] text-left hover:bg-black/[0.05]">
              <span className="w-8 h-8 rounded-[9px] bg-black/[0.05] text-[#1D1D1F] inline-flex items-center justify-center shrink-0"><Icon size={16} /></span>
              <span className="min-w-0">
                <span className="block text-[13px] font-medium text-[#1D1D1F]">{bt.label}</span>
                {bt.hint && <span className="block text-[11px] text-[#86868B] leading-snug">{bt.hint}</span>}
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}

function Inserter({ onPick, big = false }: { onPick: (t: BlockType) => void; big?: boolean }) {
  const [open, setOpen] = useState(false);
  if (big) {
    return (
      <div className="relative flex justify-center pt-2">
        <button type="button" onClick={() => setOpen(o => !o)} className="inline-flex items-center gap-1.5 h-10 px-5 rounded-full bg-[#0071E3]/10 text-[#0066CC] text-[13.5px] font-medium hover:bg-[#0071E3]/[0.16]">
          <Plus size={16} /> Thêm khối
        </button>
        {open && <BlockPicker onPick={onPick} onClose={() => setOpen(false)} />}
      </div>
    );
  }
  return (
    <div className="relative h-4 group/ins flex items-center justify-center">
      <span className="absolute inset-x-0 top-1/2 h-px bg-[#0071E3]/0 group-hover/ins:bg-[#0071E3]/30 transition" />
      <button type="button" title="Chèn khối vào đây" onClick={() => setOpen(o => !o)}
        className="relative w-6 h-6 rounded-full bg-white text-[#0071E3] shadow-[0_0_0_0.5px_rgba(0,0,0,0.15),0_2px_6px_rgba(0,0,0,0.1)] inline-flex items-center justify-center opacity-0 group-hover/ins:opacity-100 transition">
        <Plus size={14} />
      </button>
      {open && <BlockPicker onPick={onPick} onClose={() => setOpen(false)} />}
    </div>
  );
}

export default function LessonEditor({ value, onChange, canEdit, title, toast, toolbarExtra }: {
  value: LessonDoc; onChange: (v: LessonDoc) => void; canEdit: boolean; title: string; toast: (m: string) => void; toolbarExtra?: ReactNode;
}) {
  const [editing, setEditing] = useState(() => canEdit && value.blocks.length === 0);
  const [zoom, setZoom] = useState<string | null>(null);
  const blocks = value.blocks;
  const set = (next: LessonBlock[]) => onChange({ ...value, blocks: next });
  const insertAt = (i: number, t: BlockType) => set([...blocks.slice(0, i), newBlock(t), ...blocks.slice(i)]);
  const toggleCheck = (blockId: string, itemId: string) => set(blocks.map(b => (b.id === blockId && b.t === 'check'
    ? { ...b, items: b.items.map(i => (i.id === itemId ? { ...i, done: !i.done } : i)) } : b)));

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      {/* thanh công cụ */}
      <div className="sticky top-0 z-20 bg-[#F5F5F7]/85 backdrop-blur-xl border-b border-black/[0.05]">
        <div className="max-w-[880px] mx-auto px-3 md:px-6 h-12 flex items-center gap-2">
          {canEdit && (
            <div className="inline-flex bg-[#767680]/[0.12] rounded-[9px] p-[2px]">
              {([[false, 'Xem', Eye], [true, 'Soạn', PencilLine]] as const).map(([v, label, Icon]) => (
                <button key={label} type="button" onClick={() => setEditing(v)}
                  className={`inline-flex items-center gap-1.5 h-7 px-3 rounded-[7px] text-[12.5px] font-medium transition ${editing === v ? 'bg-white shadow-[0_2px_6px_rgba(0,0,0,0.12)] text-[#1D1D1F]' : 'text-[#3A3A3C]'}`}>
                  <Icon size={13} /> {label}
                </button>
              ))}
            </div>
          )}
          {editing && <span className="hidden lg:inline text-[11.5px] text-[#86868B]">**đậm** · ==tô vàng== · !!chữ đỏ!!</span>}
          <div className="ml-auto flex items-center gap-1.5">{toolbarExtra}</div>
        </div>
      </div>

      <div className="max-w-[880px] mx-auto px-3 md:px-6 py-4 md:py-8">
        <article className="bg-white rounded-[22px] shadow-[0_0_0_0.5px_rgba(0,0,0,0.06),0_20px_50px_-30px_rgba(0,0,0,0.3)] overflow-hidden">
          <div className="h-2" style={{ background: `linear-gradient(90deg, ${value.accent}, ${shade(value.accent, 0.35)})` }} />
          <div className="px-4 md:px-10 pt-5 md:pt-8 pb-8 md:pb-12">
            <h1 className="text-[24px] md:text-[30px] font-semibold tracking-[-0.025em] leading-tight text-[#1D1D1F]">{title}</h1>
            {editing && (
              <div className="mt-3 flex items-center gap-2 flex-wrap">
                <span className="text-[12px] text-[#86868B]">Màu chủ đạo</span>
                <Swatches value={value.accent} onChange={accent => onChange({ ...value, accent })} colors={SWATCHES.slice(0, 9)} />
              </div>
            )}
            <div className="mt-5 md:mt-6 space-y-4">
              {!editing && blocks.map(b => (
                <ViewBlock key={b.id} b={b} accent={value.accent} onToggleCheck={canEdit ? toggleCheck : undefined} onZoom={setZoom} />
              ))}
              {!editing && !blocks.length && <div className="text-[14px] text-[#86868B]">Bài học chưa có nội dung.{canEdit ? ' Bấm "Soạn" để bắt đầu.' : ''}</div>}
              {editing && (
                <div className="space-y-1">
                  {blocks.map((b, i) => (
                    <div key={b.id}>
                      <Inserter onPick={t => insertAt(i, t)} />
                      <div className="group relative md:-mx-3 md:px-3 py-1.5 rounded-[14px] hover:bg-black/[0.015]">
                        <div className="flex items-center gap-1 mb-1 text-[11px] text-[#AEAEB2] md:absolute md:-left-9 md:top-2 md:flex-col md:mb-0 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition">
                          <button type="button" title="Lên" disabled={i === 0} onClick={() => set(moveBlock(blocks, b.id, -1))} className="p-1 rounded hover:bg-black/[0.06] hover:text-[#1D1D1F] disabled:opacity-30"><ArrowUp size={14} /></button>
                          <button type="button" title="Xuống" disabled={i === blocks.length - 1} onClick={() => set(moveBlock(blocks, b.id, 1))} className="p-1 rounded hover:bg-black/[0.06] hover:text-[#1D1D1F] disabled:opacity-30"><ArrowDown size={14} /></button>
                          <button type="button" title="Xoá khối" onClick={() => set(blocks.filter(x => x.id !== b.id))} className="p-1 rounded hover:bg-[#FF3B30]/10 hover:text-[#D70015]"><Trash2 size={14} /></button>
                          <span className="md:hidden ml-1">{BLOCK_TYPES.find(x => x.t === b.t)?.label}</span>
                        </div>
                        <EditBlock b={b} toast={toast} onChange={nb => set(blocks.map(x => (x.id === b.id ? nb : x)))} />
                      </div>
                    </div>
                  ))}
                  <Inserter big onPick={t => insertAt(blocks.length, t)} />
                </div>
              )}
            </div>
          </div>
        </article>
      </div>

      {zoom && (
        <div className="fixed inset-0 z-[96] bg-black/85 flex items-center justify-center p-4 cursor-zoom-out" onClick={() => setZoom(null)} role="presentation">
          <img src={zoom} alt="" className="max-w-full max-h-full object-contain rounded-lg" />
          <button type="button" aria-label="Đóng" className="absolute top-4 right-4 w-9 h-9 rounded-full bg-white/15 text-white inline-flex items-center justify-center"><X size={18} /></button>
        </div>
      )}
    </div>
  );
}
