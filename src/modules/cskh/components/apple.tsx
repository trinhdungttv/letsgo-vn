// ============================================================================
// Khối giao diện kiểu Apple dùng chung cho mọi tab CSKH (cùng ngôn ngữ với Workspace,
// token gốc ở src/components/workspace/wsTheme.ts): tiêu đề lớn, thẻ trắng bo 18px,
// điều khiển phân đoạn iOS, dòng danh sách kẻ mảnh, ô lọc dạng viên, ô tìm kiếm iOS,
// công tắc iOS. Viết đủ chữ từng class (không ghép chuỗi động) để Tailwind sinh đúng CSS.
// ============================================================================
import type { ReactNode } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';
import { CAPTION, PANEL } from '../ui';

/** Đầu trang kiểu Apple: nhãn nhỏ in hoa · tiêu đề lớn · câu tóm tắt · nút viên. */
export function PageTitle({ eyebrow, title, subtitle, actions }: {
  eyebrow?: ReactNode;
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
      <div className="min-w-0">
        {eyebrow && <p className="text-[12px] font-semibold uppercase tracking-[0.06em] text-[#86868B]">{eyebrow}</p>}
        <h1 className="text-[26px] md:text-[30px] font-bold tracking-[-0.025em] leading-[1.1] text-[#1D1D1F] mt-1">{title}</h1>
        {subtitle && <p className="text-[14px] md:text-[15px] text-[#6E6E73] mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex gap-2 w-full md:w-auto [&>*]:flex-1 md:[&>*]:flex-none">{actions}</div>}
    </header>
  );
}

/** Thẻ có tiêu đề 17px, số đếm xám, nút phải, chân thẻ kẻ mảnh. */
export function Panel({ id, title, icon, count, meta, action, footer, children, flush = false }: {
  id?: string;
  title: string;
  /** Icon nhỏ cạnh tiêu đề (đã tô màu sẵn nếu cần). */
  icon?: ReactNode;
  count?: number;
  meta?: ReactNode;
  action?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  /** true = phần thân không chừa lề (bảng, bản đồ tràn mép thẻ). */
  flush?: boolean;
}) {
  return (
    <section id={id} className={`${PANEL} scroll-mt-4 min-w-0`} aria-label={title}>
      <header className="flex items-start justify-between gap-3 px-4 md:px-5 pt-4 pb-2.5">
        <div className="min-w-0">
          <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-[#1D1D1F] flex items-center gap-2">
            {icon && <span className="shrink-0 flex">{icon}</span>}
            <span className="min-w-0">
              {title}
              {count !== undefined && count > 0 && <span className="ml-1.5 font-normal text-[#86868B] tabular-nums">{count}</span>}
            </span>
          </h2>
          {meta && <p className={`${CAPTION} mt-0.5`}>{meta}</p>}
        </div>
        {action}
      </header>
      <div className={flush ? '' : 'px-4 md:px-5 pb-2'}>{children}</div>
      {footer && <div className="mx-4 md:mx-5 py-1.5 border-t border-[#E5E5EA]">{footer}</div>}
    </section>
  );
}

/** Điều khiển phân đoạn kiểu iOS. `fit` = co theo nội dung (không kéo hết bề ngang). */
export function Segmented<T extends string>({ label, value, options, onChange, fit = false }: {
  label: string;
  value: T;
  options: ReadonlyArray<{ key: T; label: ReactNode; badge?: number; icon?: ReactNode }>;
  onChange: (v: T) => void;
  fit?: boolean;
}) {
  return (
    <div role="tablist" aria-label={label}
      className={`flex p-[2px] rounded-[9px] bg-[rgba(118,118,128,0.12)] max-w-full overflow-x-auto no-scrollbar ${fit ? 'w-fit' : ''}`}>
      {options.map(o => {
        const active = o.key === value;
        return (
          <button key={o.key} type="button" role="tab" aria-selected={active} onClick={() => onChange(o.key)}
            className={`${fit ? 'shrink-0' : 'flex-1 min-w-0'} inline-flex items-center justify-center gap-1.5 h-9 md:h-7 px-3 rounded-[7px] text-[13px] whitespace-nowrap transition ${active
              ? 'bg-white text-[#1D1D1F] font-semibold shadow-[0_3px_8px_rgba(0,0,0,0.12),0_1px_1px_rgba(0,0,0,0.04)]'
              : 'text-[#3C3C43]/80 font-medium hover:text-[#1D1D1F]'}`}>
            {o.icon}
            <span className="truncate">{o.label}</span>
            {o.badge !== undefined && o.badge > 0 && <span className="font-normal text-[#86868B] tabular-nums">{o.badge}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** 1 dòng danh sách, đường kẻ mảnh thụt vào từ chỗ bắt đầu chữ (kiểu bảng iOS). */
export function Row({ first, inset, onClick, title, align = 'center', children }: {
  first: boolean;
  inset: number;
  onClick?: () => void;
  title?: string;
  align?: 'center' | 'start';
  children: ReactNode;
}) {
  const line = !first && <span aria-hidden className="absolute top-0 right-0 h-px bg-[#E5E5EA]" style={{ left: inset }} />;
  const cls = `relative w-full flex ${align === 'start' ? 'items-start' : 'items-center'} gap-3 py-2.5 text-left`;
  return onClick
    ? <button type="button" onClick={onClick} title={title} className={`${cls} hover:bg-[#FAFAFC] rounded-[10px] transition`}>{line}{children}</button>
    : <div className={cls}>{line}{children}</div>;
}

/** Trạng thái trống: chữ xám giữa thẻ, có icon tuỳ chọn. */
export const Quiet = ({ icon, children }: { icon?: ReactNode; children: ReactNode }) => (
  <div className="py-8 flex flex-col items-center gap-2 text-center text-[13px] text-[#86868B]">
    {icon && <span className="w-10 h-10 rounded-full bg-black/[0.04] text-[#AEAEB2] flex items-center justify-center">{icon}</span>}
    <p>{children}</p>
  </div>
);

/** Ô chọn dạng viên (bộ lọc) — tô xanh nhạt khi đang lọc. */
export function PillSelect({ value, active, label, onChange, children, disabled = false }: {
  value: string;
  active: boolean;
  label: string;
  onChange: (v: string) => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <span className={`relative inline-flex items-center rounded-full h-9 md:h-8 max-w-full transition ${disabled ? 'opacity-40' : ''} ${active ? 'bg-[#0071E3]/10 text-[#0066CC]' : 'bg-[rgba(118,118,128,0.12)] text-[#1D1D1F]'}`}>
      <select value={value} aria-label={label} disabled={disabled} onChange={e => onChange(e.target.value)}
        className="appearance-none bg-transparent pl-3.5 pr-8 h-full text-[13px] font-medium outline-none cursor-pointer disabled:cursor-not-allowed max-w-[220px] truncate rounded-full focus-visible:ring-2 focus-visible:ring-[#0071E3]/40">
        {children}
      </select>
      <ChevronDown size={14} strokeWidth={2.4} className={`absolute right-3 pointer-events-none ${active ? 'text-[#0066CC]' : 'text-[#86868B]'}`} />
    </span>
  );
}

/** Ô tìm kiếm kiểu iOS: nền xám nhạt, kính lúp, nút xoá tròn. */
export function SearchField({ value, onChange, placeholder, className = '' }: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  className?: string;
}) {
  return (
    <div className={`relative ${className}`}>
      <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#86868B] pointer-events-none" />
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} type="search"
        className="w-full h-10 md:h-9 pl-9 pr-9 rounded-[10px] bg-[rgba(118,118,128,0.12)] text-[14px] md:text-[13px] text-[#1D1D1F] placeholder:text-[#86868B] outline-none border border-transparent focus:bg-white focus:border-[#0071E3] focus:ring-4 focus:ring-[#0071E3]/15 transition [&::-webkit-search-cancel-button]:hidden" />
      {value && (
        <button type="button" onClick={() => onChange('')} aria-label="Xoá ô tìm"
          className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full flex items-center justify-center text-white">
          <span className="w-[18px] h-[18px] rounded-full bg-[#AEAEB2] hover:bg-[#8E8E93] flex items-center justify-center"><X size={11} strokeWidth={3} /></span>
        </button>
      )}
    </div>
  );
}

/** Công tắc iOS (thay ô tick cho bật/tắt bộ lọc). */
export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <label className="inline-flex items-center gap-2 text-[13px] text-[#1D1D1F] cursor-pointer select-none min-h-[36px] md:min-h-0">
      <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
        className={`relative w-[38px] h-[23px] rounded-full shrink-0 transition-colors ${checked ? 'bg-[#34C759]' : 'bg-[rgba(120,120,128,0.24)]'}`}>
        <span className={`absolute top-[2px] left-[2px] w-[19px] h-[19px] rounded-full bg-white shadow-[0_2px_4px_rgba(0,0,0,0.18)] transition-transform ${checked ? 'translate-x-[15px]' : ''}`} />
      </button>
      {label}
    </label>
  );
}

/** Chip bộ lọc đang bật (có nút ×). */
export function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 h-8 md:h-7 pl-3 pr-1 rounded-full bg-[#0071E3]/10 text-[#0066CC] text-[12.5px] font-medium">
      <span className="truncate max-w-[220px]">{label}</span>
      <button type="button" onClick={onClear} aria-label={`Bỏ lọc ${label}`}
        className="w-6 h-6 md:w-5 md:h-5 rounded-full hover:bg-[#0071E3]/15 flex items-center justify-center"><X size={11} strokeWidth={2.6} /></button>
    </span>
  );
}

/** "Hiện thêm N (còn M)" ở chân thẻ / cuối danh sách. */
export function MoreButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className="w-full min-h-[40px] md:min-h-[32px] text-[13px] font-medium text-[#0066CC] hover:opacity-70 transition">
      {children}
    </button>
  );
}
