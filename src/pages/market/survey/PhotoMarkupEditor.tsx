// Ghi chú lên ảnh chỉ tiêu: bút, khoanh tròn, mũi tên, ghi chữ (VD khoanh "Tuyển 50 CN", mũi tên chỉ cổng phụ).
// Nét vẽ lưu riêng (ảnh gốc giữ nguyên) → mở lại sửa / xoá nét được.
import { useRef, useState } from 'react';
import { ArrowUpRight, Circle, PenLine, Trash2, Type, Undo2 } from 'lucide-react';
import { DEFAULT_STROKE, DEFAULT_TEXT, MARK_COLORS, simplifyPath, type PhotoMark, type Pt } from '../../../lib/kcnSurvey/markup';
import { MarksSvg } from './PhotoMarks';
import { useImageBox } from './useImageBox';

type Tool = 'pen' | 'ellipse' | 'arrow' | 'text';
const SIZES = [{ label: 'Mảnh', k: 0.6 }, { label: 'Vừa', k: 1 }, { label: 'Đậm', k: 1.7 }];

interface Props {
  src: string;
  initial: readonly PhotoMark[];
  onCancel: () => void;
  onDone: (marks: PhotoMark[]) => void;
}

export default function PhotoMarkupEditor({ src, initial, onCancel, onDone }: Props) {
  const [marks, setMarks] = useState<PhotoMark[]>(() => [...initial]);
  const [tool, setTool] = useState<Tool>('ellipse');
  const [color, setColor] = useState<string>(MARK_COLORS[0]);
  const [size, setSize] = useState(1);
  const [draft, setDraft] = useState<PhotoMark | null>(null);
  const [textAt, setTextAt] = useState<{ x: number; y: number } | null>(null);
  const [textValue, setTextValue] = useState('');
  const { imgRef, box, measure } = useImageBox();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const drawing = useRef(false);

  const toPt = (e: React.PointerEvent): Pt => {
    const r = svgRef.current!.getBoundingClientRect();
    return [Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (e.clientY - r.top) / r.height))];
  };
  const stroke = DEFAULT_STROKE * SIZES[size].k;

  // Nét đang vẽ giữ trong ref (cập nhật đồng bộ theo từng lần kéo) + state để vẽ lại
  const draftRef = useRef<PhotoMark | null>(null);
  const setDraftBoth = (d: PhotoMark | null) => { draftRef.current = d; setDraft(d); };

  const down = (e: React.PointerEvent<SVGSVGElement>) => {
    if (textAt) return;
    const p = toPt(e);
    if (tool === 'text') { setTextAt({ x: p[0], y: p[1] }); setTextValue(''); return; }
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drawing.current = true;
    setDraftBoth(tool === 'pen' ? { t: 'pen', c: color, w: stroke, p: [p] } : { t: tool, c: color, w: stroke, a: p, b: p });
  };
  const move = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = draftRef.current;
    if (!drawing.current || !d) return;
    const p = toPt(e);
    if (d.t === 'pen') setDraftBoth({ ...d, p: [...d.p, p] });
    else if (d.t === 'arrow' || d.t === 'ellipse') setDraftBoth({ ...d, b: p });
  };
  const up = () => {
    if (!drawing.current) return;
    drawing.current = false;
    const d = draftRef.current;
    setDraftBoth(null);
    if (!d) return;
    if (d.t === 'pen' && d.p.length >= 2) setMarks(list => [...list, { ...d, p: simplifyPath(d.p) }]);
    else if ((d.t === 'arrow' || d.t === 'ellipse') && Math.hypot(d.b[0] - d.a[0], d.b[1] - d.a[1]) > 0.015) setMarks(list => [...list, d]);
  };
  const addText = () => {
    const t = textValue.trim();
    if (t && textAt) setMarks(list => [...list, { t: 'text', c: color, s: DEFAULT_TEXT * SIZES[size].k, x: textAt.x, y: textAt.y, text: t }]);
    setTextAt(null);
    setTextValue('');
  };

  const tools: { id: Tool; label: string; icon: React.ReactNode }[] = [
    { id: 'ellipse', label: 'Khoanh', icon: <Circle size={19} /> },
    { id: 'arrow', label: 'Mũi tên', icon: <ArrowUpRight size={19} /> },
    { id: 'pen', label: 'Bút', icon: <PenLine size={19} /> },
    { id: 'text', label: 'Chữ', icon: <Type size={19} /> },
  ];

  return (
    <div className="fixed inset-0 z-[1400] bg-black flex flex-col pt-[env(safe-area-inset-top)] select-none">
      <div className="flex items-center justify-between h-12 px-2 shrink-0 text-white">
        <button onClick={onCancel} className="h-10 px-3 text-[16px]">Huỷ</button>
        <div className="text-[15px] font-semibold">Ghi chú lên ảnh</div>
        <button onClick={() => onDone(marks)} className="h-10 px-3 text-[16px] font-semibold text-[#0A84FF]">Xong</button>
      </div>

      <div className="flex-1 min-h-0 relative flex items-center justify-center">
        <img ref={imgRef} src={src} alt="Ảnh chỉ tiêu" onLoad={measure} draggable={false} className="max-w-full max-h-full object-contain" />
        {box && (
          <MarksSvg marks={draft ? [...marks, draft] : marks} aspect={box.aspect} svgRef={svgRef}
            className="absolute" style={{ left: box.l, top: box.t, width: box.w, height: box.h, touchAction: 'none', cursor: tool === 'text' ? 'text' : 'crosshair' }}
            onPointerDown={down} onPointerMove={move} onPointerUp={up}>
            {textAt && <circle cx={textAt.x * 1000} cy={textAt.y * 1000 * box.aspect} r={10} fill={color} stroke="#000" strokeWidth={2} />}
          </MarksSvg>
        )}
        {!marks.length && !draft && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 rounded-full bg-black/60 text-white/90 text-[12.5px] px-3 py-1.5 pointer-events-none whitespace-nowrap">
            {tool === 'text' ? 'Chạm vào chỗ cần ghi chữ' : 'Kéo trên ảnh để vẽ'}
          </div>
        )}
      </div>

      {textAt && (
        <div className="shrink-0 bg-[#1C1C1E] px-3 py-2 flex gap-2">
          <input value={textValue} onChange={e => setTextValue(e.target.value)} autoFocus maxLength={200}
            onKeyDown={e => { if (e.key === 'Enter') addText(); if (e.key === 'Escape') setTextAt(null); }}
            placeholder="VD: Tuyển 50 CN, 8tr" className="flex-1 min-w-0 h-11 px-3 rounded-xl bg-white/10 text-white text-[15px] outline-none placeholder:text-white/40" />
          <button onClick={addText} className="h-11 px-4 rounded-xl bg-[#0A84FF] text-white text-[14px] font-semibold shrink-0">Thêm</button>
          <button onClick={() => setTextAt(null)} className="h-11 px-3 rounded-xl bg-white/10 text-white text-[14px] shrink-0">Huỷ</button>
        </div>
      )}

      <div className="shrink-0 bg-[#1C1C1E] text-white px-3 pt-2 pb-[calc(10px+env(safe-area-inset-bottom))] space-y-2">
        <div className="flex items-center gap-1.5">
          {tools.map(t => (
            <button key={t.id} onClick={() => { setTool(t.id); setTextAt(null); }}
              className={`flex-1 h-12 rounded-xl flex flex-col items-center justify-center gap-0.5 text-[10.5px] font-medium ${tool === t.id ? 'bg-[#0A84FF] text-white' : 'bg-white/10 text-white/85'}`}>
              {t.icon}{t.label}
            </button>
          ))}
          <button onClick={() => setMarks(list => list.slice(0, -1))} disabled={!marks.length}
            className="w-12 h-12 rounded-xl bg-white/10 flex flex-col items-center justify-center gap-0.5 text-[10.5px] disabled:opacity-30" aria-label="Hoàn tác">
            <Undo2 size={18} />Lùi
          </button>
          <button onClick={() => { if (window.confirm('Xoá hết nét vẽ trên ảnh?')) setMarks([]); }} disabled={!marks.length}
            className="w-12 h-12 rounded-xl bg-white/10 flex flex-col items-center justify-center gap-0.5 text-[10.5px] disabled:opacity-30" aria-label="Xoá hết">
            <Trash2 size={18} />Xoá
          </button>
        </div>
        <div className="flex items-center gap-2">
          {MARK_COLORS.map(c => (
            <button key={c} onClick={() => setColor(c)} aria-label={`Màu ${c}`}
              className={`w-8 h-8 rounded-full border-2 ${color === c ? 'border-white scale-110' : 'border-white/20'} transition`} style={{ background: c }} />
          ))}
          <div className="flex-1" />
          {SIZES.map((s, i) => (
            <button key={s.label} onClick={() => setSize(i)}
              className={`h-8 px-2.5 rounded-full text-[12px] font-medium ${size === i ? 'bg-white text-black' : 'bg-white/10 text-white/85'}`}>{s.label}</button>
          ))}
        </div>
      </div>
    </div>
  );
}
