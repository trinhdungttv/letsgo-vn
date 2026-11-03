// Giao diện gọn của màn Khảo sát KCN (xoay ngang / bật "Luôn gọn"): bản đồ chiếm gần hết màn hình.
//  - Nút gắn mép phải (RailBtn): chức năng người dùng chọn "luôn hiện" trong Cài đặt.
//  - Nút nổi kiểu AssistiveTouch của iPhone: kéo tới chỗ tiện tay (tự dính mép trái / phải), bấm để mở bảng mọi chức năng.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Camera, Factory, History, ImagePlus, Info, Layers, Maximize, Mic, Navigation, Pause, Settings, Square, ZoomIn } from 'lucide-react';
import type { QuickActionId } from './surveyData';

/** Tên + biểu tượng từng chức năng gắn được (dùng ở Cài đặt → Nút luôn hiện). */
export const QUICK_META: Record<QuickActionId, { label: string; icon: (size: number) => ReactNode }> = {
  photo: { label: 'Chụp chỉ tiêu', icon: s => <Camera size={s} /> },
  voice: { label: 'Ghi âm', icon: s => <Mic size={s} /> },
  library: { label: 'Ảnh có sẵn', icon: s => <ImagePlus size={s} /> },
  pause: { label: 'Tạm dừng / đi tiếp', icon: s => <Pause size={s} /> },
  finish: { label: 'Kết thúc', icon: s => <Square size={s - 3} fill="currentColor" /> },
  nav: { label: 'Dẫn đường', icon: s => <Navigation size={s} /> },
  todo: { label: 'Công ty chưa qua', icon: s => <Factory size={s} /> },
  zoom: { label: 'Phóng to / thu nhỏ', icon: s => <ZoomIn size={s} /> },
  fit: { label: 'Xem cả KCN', icon: s => <Maximize size={s} /> },
  satellite: { label: 'Nền vệ tinh', icon: s => <Layers size={s} /> },
  legend: { label: 'Chú thích màu đường', icon: s => <Info size={s} /> },
  history: { label: 'Lịch sử', icon: s => <History size={s} /> },
  settings: { label: 'Cài đặt', icon: s => <Settings size={s} /> },
};

export interface QuickItem {
  id: string;
  label: string;
  /** chữ ngắn cho nút mép phải (nút nhỏ, chữ dài bị cắt) */
  short?: string;
  icon: ReactNode;
  onClick: () => void;
  tone?: 'primary' | 'rec' | 'red' | 'blue' | 'green';
  active?: boolean;
  disabled?: boolean;
  /** bấm trong bảng nút nổi xong vẫn để bảng mở (phóng to / thu nhỏ) */
  keepOpen?: boolean;
}

const RAIL_TONE: Record<NonNullable<QuickItem['tone']>, string> = {
  primary: 'bg-[#0A84FF] text-white',
  rec: 'bg-[#FF3B30] text-white',
  red: 'bg-white/95 text-[#D70015]',
  blue: 'bg-white/95 text-[#0A84FF]',
  green: 'bg-[#137333] text-white',
};

/** Nút vuông ở mép phải (giao diện gọn): biểu tượng + chữ nhỏ. */
export function RailBtn({ item, children }: { item: QuickItem; children?: ReactNode }) {
  const cls = item.active ? 'bg-[#0A84FF] text-white' : item.tone ? RAIL_TONE[item.tone] : 'bg-white/95 text-[#1D1D1F]';
  return (
    <button onClick={item.onClick} disabled={item.disabled} aria-label={item.label} title={item.label}
      className={`pointer-events-auto w-[52px] h-[52px] rounded-2xl shadow-lg backdrop-blur flex flex-col items-center justify-center gap-0.5 active:scale-95 transition disabled:opacity-40 ${cls}`}>
      {children ?? item.icon}
      <span className="text-[9px] font-semibold leading-none max-w-[48px] truncate tabular-nums">{item.short ?? item.label}</span>
    </button>
  );
}

const MENU_TONE: Record<NonNullable<QuickItem['tone']>, string> = {
  primary: 'bg-[#0A84FF] text-white',
  rec: 'bg-[#FF3B30] text-white',
  red: 'bg-white/10 text-[#FF6961]',
  blue: 'bg-white/10 text-[#64D2FF]',
  green: 'bg-[#1E8E3E] text-white',
};

const SIZE = 56;

interface AssistiveProps {
  items: QuickItem[];
  pos: { side: 'left' | 'right'; y: number };
  onMove: (p: { side: 'left' | 'right'; y: number }) => void;
  view: { w: number; h: number };
  /** dòng chữ nhỏ trên bảng (VD tên KCN + trạng thái ghi) */
  title?: string;
}

/** Nút nổi kiểu AssistiveTouch: kéo để dời (dính mép gần nhất), bấm để mở bảng chức năng; để yên 3 giây thì mờ đi. */
export function AssistiveTouch({ items, pos, onMove, view, title }: AssistiveProps) {
  const [open, setOpen] = useState(false);
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const [idle, setIdle] = useState(false);
  const startRef = useRef<{ px: number; py: number; x: number; y: number; moved: boolean } | null>(null);
  const idleTimer = useRef<number | null>(null);
  const wake = () => {
    setIdle(false);
    if (idleTimer.current) window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => setIdle(true), 3000);
  };
  useEffect(() => {
    idleTimer.current = window.setTimeout(() => setIdle(true), 3000);
    return () => { if (idleTimer.current) window.clearTimeout(idleTimer.current); };
  }, []);

  const maxTop = Math.max(8, view.h - SIZE - 8);
  const top = Math.max(8, Math.min(maxTop, pos.y * (view.h - SIZE)));
  const style: CSSProperties = drag
    ? { left: drag.x, top: drag.y, transition: 'none' }
    : pos.side === 'left'
      ? { left: 'calc(10px + env(safe-area-inset-left))', top }
      : { right: 'calc(10px + env(safe-area-inset-right))', top };

  const landscape = view.w > view.h;
  const cols = landscape ? 5 : 3;

  return (
    <>
      <button
        aria-label="Mở bảng chức năng" title="Chức năng (kéo để dời chỗ)"
        className={`absolute z-[1150] pointer-events-auto rounded-[18px] bg-[#1C1C1E]/60 backdrop-blur-md shadow-[0_4px_18px_rgba(0,0,0,0.35)] flex items-center justify-center touch-none select-none transition-[opacity,top,left,right] duration-200 ${idle && !open ? 'opacity-45' : 'opacity-100'}`}
        style={{ width: SIZE, height: SIZE, ...style }}
        onPointerDown={e => {
          wake();
          const r = e.currentTarget.getBoundingClientRect();
          startRef.current = { px: e.clientX, py: e.clientY, x: r.left, y: r.top, moved: false };
          try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* bỏ qua */ }
        }}
        onPointerMove={e => {
          const st = startRef.current;
          if (!st) return;
          const dx = e.clientX - st.px, dy = e.clientY - st.py;
          if (!st.moved && Math.hypot(dx, dy) < 6) return;
          st.moved = true;
          setDrag({ x: Math.max(0, Math.min(view.w - SIZE, st.x + dx)), y: Math.max(0, Math.min(view.h - SIZE, st.y + dy)) });
        }}
        onPointerUp={() => {
          const st = startRef.current;
          startRef.current = null;
          wake();
          if (!st) return;
          if (!st.moved) { setOpen(v => !v); return; }
          if (drag) onMove({ side: drag.x + SIZE / 2 < view.w / 2 ? 'left' : 'right', y: Math.max(0, Math.min(1, drag.y / Math.max(1, view.h - SIZE))) });
          setDrag(null);
        }}
        onPointerCancel={() => { startRef.current = null; setDrag(null); }}
      >
        {/* 3 vòng tròn đồng tâm như AssistiveTouch */}
        <span className="w-[38px] h-[38px] rounded-full bg-white/25 flex items-center justify-center">
          <span className="w-[28px] h-[28px] rounded-full bg-white/45 flex items-center justify-center">
            <span className="w-[19px] h-[19px] rounded-full bg-white/95" />
          </span>
        </span>
      </button>

      {open && (
        <div className="absolute inset-0 z-[1300] pointer-events-auto flex items-center justify-center bg-black/20" onClick={() => setOpen(false)}>
          <div onClick={e => e.stopPropagation()}
            className="rounded-[28px] bg-[#1C1C1E]/88 backdrop-blur-xl shadow-2xl p-3 max-w-[calc(100vw-24px)] max-h-[calc(100%-24px)] overflow-y-auto">
            {title && <div className="px-1 pb-2 text-[12px] text-white/60 text-center truncate">{title}</div>}
            <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${cols}, 76px)` }}>
              {items.map(it => (
                <button key={it.id} disabled={it.disabled}
                  onClick={() => { it.onClick(); if (!it.keepOpen) setOpen(false); wake(); }}
                  className={`h-[76px] rounded-2xl flex flex-col items-center justify-center gap-1 active:scale-95 transition disabled:opacity-35 ${it.active ? 'bg-[#0A84FF] text-white' : it.tone ? MENU_TONE[it.tone] : 'bg-white/10 text-white'}`}>
                  {it.icon}
                  <span className="text-[10.5px] font-medium leading-tight text-center px-1 line-clamp-2 tabular-nums">{it.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
