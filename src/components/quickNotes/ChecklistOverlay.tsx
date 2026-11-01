// Ô việc cần làm dạng tròn (kiểu Lời nhắc của iPhone / TickTick) phủ lên ký tự ☐ / ☑ ở đầu dòng của ô soạn.
// Dữ liệu vẫn là chữ ☐ / ☑ trong nội dung (đếm 0/2, tạo sơ đồ… dùng chung); lớp này che ký tự đó rồi vẽ vòng tròn to
// treo ra lề trái (cách chữ 1 khoảng như TickTick) + vùng bấm rộng từ mép trái tới sát chữ. Vị trí đo bằng 1 bản sao
// ẩn của chữ, ngắt dòng y hệt ô soạn.
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode, RefObject } from 'react';
import { Check } from 'lucide-react';

const BOX_OPEN = '☐';
const BOX_DONE = '☑';

interface Box { pos: number; x: number; y: number; w: number; h: number; done: boolean }

function alpha(hex: string, a: number): string {
  const h = hex.replace('#', '');
  if (h.length !== 6) return hex;
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

export default function ChecklistOverlay({ text, font, ta, ink, paper, accent, readOnly, onToggle }: {
  text: string;
  font: { fontSize: number; fontFamily: string; lineHeight: number };
  ta: RefObject<HTMLTextAreaElement>;
  ink: string;
  paper: string;
  accent: string;
  readOnly?: boolean;
  onToggle: (pos: number) => void;
}) {
  const mirror = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [scrollbarW, setScrollbarW] = useState(0);

  // Vị trí các ô ở đầu dòng
  const starts = useMemo(() => {
    const out: number[] = [];
    for (let i = 0; i < text.length; i++) {
      if ((i === 0 || text[i - 1] === '\n') && (text[i] === BOX_OPEN || text[i] === BOX_DONE)) out.push(i);
    }
    return out;
  }, [text]);

  const content = useMemo(() => {
    if (!starts.length) return null;
    const parts: ReactNode[] = [];
    let last = 0;
    for (const p of starts) {
      const len = text[p + 1] === ' ' ? 2 : 1;
      parts.push(text.slice(last, p));
      parts.push(<span key={p} data-pos={p}>{text.slice(p, p + len)}</span>);
      last = p + len;
    }
    parts.push(`${text.slice(last)}\n`);
    return parts;
  }, [text, starts]);

  const measure = useCallback(() => {
    const m = mirror.current;
    const t = ta.current;
    if (!m || !t || !starts.length) { setBoxes(b => (b.length ? [] : b)); return; }
    const sbw = t.offsetWidth - t.clientWidth;
    if (sbw !== scrollbarW) { setScrollbarW(sbw); return; }
    const base = m.getBoundingClientRect();
    const next: Box[] = [];
    m.querySelectorAll<HTMLSpanElement>('span[data-pos]').forEach(s => {
      const r = s.getClientRects()[0] ?? s.getBoundingClientRect();
      const pos = Number(s.dataset.pos);
      next.push({ pos, x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height, done: text[pos] === BOX_DONE });
    });
    setBoxes(next);
  }, [ta, starts, text, scrollbarW]);

  useLayoutEffect(measure, [measure, font.fontSize, font.fontFamily]);

  // Ô soạn đổi cỡ (phóng to thẻ, kéo góc…) → đo lại; cuộn → dời lớp ô tròn theo
  useLayoutEffect(() => {
    const t = ta.current;
    if (!t) return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(t);
    const onScroll = () => { if (layer.current) layer.current.style.transform = `translateY(${-t.scrollTop}px)`; };
    onScroll();
    t.addEventListener('scroll', onScroll);
    return () => { ro.disconnect(); t.removeEventListener('scroll', onScroll); };
  }, [ta, measure]);

  if (!content) return null;

  const fs = font.fontSize;
  const lh = fs * font.lineHeight;
  const d = Math.max(18, Math.min(Math.round(fs * 1.3), Math.round(lh) - 2));
  const gap = Math.round(fs * 0.55);
  const mirrorStyle: CSSProperties = { ...font, paddingRight: 16 + scrollbarW };

  return (
    <>
      <div ref={mirror} aria-hidden
        className="absolute inset-0 overflow-hidden whitespace-pre-wrap break-words px-4 py-3 pointer-events-none invisible"
        style={mirrorStyle}>
        {content}
      </div>
      <div className="absolute inset-0 overflow-hidden pointer-events-none z-[1]">
        <div ref={layer} className="absolute inset-x-0 top-0">
          {boxes.map(b => {
            const textStart = b.x + b.w;
            const left = Math.max(2, textStart - gap - d);
            const cy = b.y + b.h / 2;
            const label = b.done ? 'Bỏ đánh dấu đã xong' : 'Đánh dấu đã xong';
            return (
              <button key={b.pos} type="button" tabIndex={-1} title={label} aria-label={label} disabled={readOnly}
                onMouseDown={e => e.preventDefault()} onClick={() => onToggle(b.pos)}
                className="group absolute pointer-events-auto disabled:pointer-events-none"
                style={{ left: 0, top: cy - lh / 2, width: textStart - 2, height: lh }}>
                {/* che ký tự ☐ / ☑ của ô soạn */}
                <span className="absolute" style={{ left: b.x - 1, top: (lh - b.h) / 2 - 1, width: b.w, height: b.h + 2, background: paper }} />
                <span className="absolute rounded-full flex items-center justify-center transition-[transform,background-color] duration-150 group-hover:scale-110 group-active:scale-95"
                  style={{
                    left, top: (lh - d) / 2, width: d, height: d,
                    background: b.done ? accent : paper,
                    boxShadow: b.done ? 'none' : `inset 0 0 0 1.7px ${alpha(ink, 0.42)}`,
                  }}>
                  {b.done && <Check size={Math.round(d * 0.62)} strokeWidth={3.2} color="#fff" />}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}
