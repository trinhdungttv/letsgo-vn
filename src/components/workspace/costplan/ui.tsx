// Phương án giá — bộ thành phần giao diện dùng chung, phong cách tối giản kiểu Apple:
// nền xám nhạt, thẻ trắng bo tròn, chữ đậm-nhạt phân cấp, MỘT màu nhấn xanh, bóng rất nhẹ.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown } from 'lucide-react';

export const FONT = `-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Inter', 'Helvetica Neue', Arial, sans-serif`;

export const ink = 'text-[#1d1d1f]';
export const sub = 'text-[#6e6e73]';
export const faint = 'text-[#86868b]';

export const card = 'bg-white rounded-2xl shadow-[0_0_0_1px_rgba(0,0,0,0.05),0_1px_3px_rgba(0,0,0,0.04)]';
export const field = 'h-9 px-3 rounded-[10px] bg-[#f5f5f7] text-[13px] text-[#1d1d1f] placeholder:text-[#a1a1a6] outline-none border border-transparent focus:bg-white focus:border-[#0071e3] focus:ring-4 focus:ring-[#0071e3]/15 transition disabled:opacity-60 disabled:cursor-default';
export const labelCls = 'block text-[11px] font-medium text-[#6e6e73] mb-1';
export const btnPrimary = 'inline-flex items-center justify-center gap-1.5 h-8 px-4 rounded-full bg-[#0071e3] text-white text-[13px] font-medium hover:bg-[#0077ed] active:scale-[0.98] disabled:opacity-35 disabled:cursor-default transition';
export const btnGhost = 'inline-flex items-center justify-center gap-1.5 h-8 px-3.5 rounded-full bg-[#f5f5f7] text-[#1d1d1f] text-[13px] font-medium hover:bg-[#e8e8ed] active:scale-[0.98] disabled:opacity-35 transition';
export const btnLink = 'text-[13px] font-medium text-[#0071e3] hover:text-[#0077ed] disabled:opacity-40 transition';

function useClickOutside(ref: React.RefObject<HTMLElement>, onOut: () => void, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onOut(); };
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onOut(); };
    document.addEventListener('mousedown', h);
    document.addEventListener('keydown', k);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k); };
  }, [ref, onOut, active]);
}

/** Ô chọn gọn kiểu Apple (thay <select> mặc định của trình duyệt). */
export function Select({ value, onChange, children, disabled, className = '' }: {
  value: string | number; onChange: (v: string) => void; children: ReactNode; disabled?: boolean; className?: string;
}) {
  return (
    <div className={`relative ${className}`}>
      <select value={value} disabled={disabled} onChange={e => onChange(e.target.value)} className={`${field} w-full appearance-none pr-8 cursor-pointer`}>{children}</select>
      <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#86868b] pointer-events-none" />
    </div>
  );
}

/** Ô chọn có ô tìm kiếm (khách, ngành, KCN). `allowAdd`: cho gõ giá trị mới chưa có trong danh sách. */
export function Combo({ value, onChange, options, placeholder, allowAdd, disabled }: {
  value: string; onChange: (v: string) => void; options: { value: string; label: string }[];
  placeholder?: string; allowAdd?: boolean; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setOpen(false), open);
  const selected = options.find(o => o.value === value);
  const display = selected?.label ?? value;
  const k = q.trim().toLowerCase();
  const filtered = k ? options.filter(o => o.label.toLowerCase().includes(k)) : options;
  const canAdd = !!allowAdd && !!k && !options.some(o => o.label.toLowerCase() === k);
  const pick = (v: string) => { onChange(v); setOpen(false); setQ(''); };

  return (
    <div ref={ref} className="relative">
      <button type="button" disabled={disabled} onClick={() => { setOpen(o => !o); setQ(''); }} className={`${field} w-full flex items-center justify-between gap-2 text-left`}>
        <span className={`truncate ${display ? '' : 'text-[#a1a1a6]'}`}>{display || placeholder || 'Chọn…'}</span>
        <ChevronDown size={14} className="text-[#86868b] shrink-0" />
      </button>
      {open && (
        <div className="absolute z-30 left-0 right-0 mt-1.5 bg-white rounded-xl shadow-[0_10px_40px_rgba(0,0,0,0.16)] ring-1 ring-black/5 overflow-hidden">
          <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Tìm…"
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (filtered[0]) pick(filtered[0].value); else if (canAdd) pick(q.trim()); } }}
            className="w-full h-10 px-3.5 text-[13px] border-b border-[#f0f0f2] outline-none placeholder:text-[#a1a1a6]" />
          <div className="max-h-56 overflow-y-auto py-1">
            {filtered.map(o => (
              <button key={o.value} type="button" onClick={() => pick(o.value)}
                className="w-full flex items-center justify-between gap-2 px-3.5 py-2 text-left text-[13px] text-[#1d1d1f] hover:bg-[#f5f5f7]">
                <span className="truncate">{o.label}</span>{o.value === value && <Check size={13} className="text-[#0071e3] shrink-0" />}
              </button>
            ))}
            {canAdd && <button type="button" onClick={() => pick(q.trim())} className="w-full px-3.5 py-2 text-left text-[13px] font-medium text-[#0071e3] hover:bg-[#f5f5f7]">Dùng “{q.trim()}”</button>}
            {!filtered.length && !canAdd && <div className="px-3.5 py-3 text-[12px] text-[#86868b]">Không tìm thấy</div>}
          </div>
        </div>
      )}
    </div>
  );
}

/** Menu nổi (nút ⋯, nút “Thêm khoản”…). */
export function Popover({ button, children, align = 'right', width = 'w-72' }: {
  button: (p: { open: boolean; toggle: () => void }) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: 'left' | 'right';
  width?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setOpen(false), open);
  return (
    <div ref={ref} className="relative">
      {button({ open, toggle: () => setOpen(o => !o) })}
      {open && (
        <div className={`absolute z-40 mt-1.5 ${align === 'right' ? 'right-0' : 'left-0'} ${width} max-w-[86vw] bg-white rounded-xl shadow-[0_10px_40px_rgba(0,0,0,0.16)] ring-1 ring-black/5 overflow-hidden`}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function MenuItem({ children, onClick, danger, hint, disabled }: { children: ReactNode; onClick: () => void; danger?: boolean; hint?: string; disabled?: boolean }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick}
      className={`w-full flex items-center justify-between gap-3 px-3.5 py-2 text-left text-[13px] hover:bg-[#f5f5f7] disabled:opacity-40 ${danger ? 'text-[#d70015]' : 'text-[#1d1d1f]'}`}>
      <span className="truncate">{children}</span>{hint && <span className="text-[11px] text-[#86868b] whitespace-nowrap">{hint}</span>}
    </button>
  );
}

/** Thanh chọn 1 trong vài mục (như segmented control của iOS). */
export function Seg<T extends string | number>({ value, onChange, options, disabled }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; disabled?: boolean;
}) {
  return (
    <div className="inline-flex p-0.5 rounded-[9px] bg-[#e8e8ed] w-full">
      {options.map(o => (
        <button key={String(o.value)} type="button" disabled={disabled} onClick={() => onChange(o.value)}
          className={`flex-1 h-7 px-2.5 rounded-[7px] text-[12px] font-medium whitespace-nowrap transition disabled:cursor-default ${value === o.value ? 'bg-white text-[#1d1d1f] shadow-[0_1px_3px_rgba(0,0,0,0.12)]' : 'text-[#6e6e73] hover:text-[#1d1d1f]'}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Công tắc bật/tắt kiểu iOS. */
export function Switch({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} disabled={disabled} onClick={() => onChange(!on)}
      className={`relative w-[38px] h-[22px] rounded-full transition shrink-0 disabled:opacity-40 ${on ? 'bg-[#34c759]' : 'bg-[#d1d1d6]'}`}>
      <span className={`absolute top-[2px] left-[2px] w-[18px] h-[18px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.3)] transition-transform ${on ? 'translate-x-4' : ''}`} />
    </button>
  );
}

/** Hàng "nhãn ... điều khiển" trong khối cài đặt (giống Cài đặt của iOS). */
export function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div className="min-w-0"><div className="text-[13px] text-[#1d1d1f]">{label}</div>{hint && <div className="text-[11px] text-[#86868b]">{hint}</div>}</div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
