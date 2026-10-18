/* eslint-disable react-refresh/only-export-components */
// Bộ khối giao diện dùng chung trong module — bám kiểu thẻ/bảng của app (Tailwind, chữ 11–13px).
import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';
import type { Currency, MonthKey, VatCategory, VatMode } from '../lib/calc/types';
import { monthLabel } from '../lib/calc/months';

export const cls = {
  input: 'w-full border border-gray-200 rounded-md px-2 py-1.5 text-[12.5px] bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 disabled:bg-gray-50 disabled:text-gray-400',
  inputSm: 'border border-gray-200 rounded-md px-1.5 py-1 text-[12px] bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400',
  btn: 'inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap',
  primary: 'bg-blue-600 text-white hover:bg-blue-700',
  secondary: 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50',
  danger: 'border border-red-200 bg-white text-red-600 hover:bg-red-50',
  ghost: 'text-gray-500 hover:text-gray-800 hover:bg-gray-100',
  label: 'block text-[10.5px] font-semibold text-gray-500 uppercase tracking-wide mb-1',
  th: 'px-2.5 py-2 text-[10.5px] font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap',
  td: 'px-2.5 py-1.5 whitespace-nowrap',
  num: 'tabular-nums text-right',
};

export function Card({ title, desc, actions, children, className = '', pad = true }: {
  title?: ReactNode; desc?: ReactNode; actions?: ReactNode; children?: ReactNode; className?: string; pad?: boolean;
}) {
  return (
    <section className={`bg-white rounded-xl border border-[#E8E7E2] ${pad ? 'p-3 md:p-4' : ''} ${className}`}>
      {(title || actions) && (
        <div className={`flex flex-wrap items-start justify-between gap-2 ${pad ? 'mb-3' : 'px-3 md:px-4 pt-3 md:pt-4 mb-3'}`}>
          <div className="min-w-0">
            {title && <h3 className="text-[13px] font-semibold text-[#111] flex items-center gap-1.5 flex-wrap">{title}</h3>}
            {desc && <div className="text-[11.5px] text-[#888] mt-0.5">{desc}</div>}
          </div>
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Kpi({ label, value, sub, tone = 'default', accent }: {
  label: ReactNode; value: ReactNode; sub?: ReactNode; tone?: 'default' | 'pos' | 'neg' | 'muted' | 'purple'; accent?: string;
}) {
  const color = tone === 'pos' ? 'text-emerald-600' : tone === 'neg' ? 'text-red-600' : tone === 'purple' ? 'text-violet-600' : tone === 'muted' ? 'text-gray-500' : 'text-[#111]';
  return (
    <div className="bg-white rounded-xl border border-[#E8E7E2] p-3 md:p-4 relative overflow-hidden min-w-0">
      {accent && <span className="absolute left-0 top-0 bottom-0 w-1" style={{ background: accent }} />}
      <div className="text-[10.5px] font-semibold text-gray-400 uppercase tracking-wide truncate">{label}</div>
      <div className={`text-[17px] md:text-[19px] font-semibold leading-tight mt-1 tabular-nums break-words ${color}`}>{value}</div>
      {sub && <div className="text-[11px] text-gray-400 mt-1">{sub}</div>}
    </div>
  );
}

export function Badge({ children, tone = 'gray', title }: { children: ReactNode; tone?: 'gray' | 'blue' | 'green' | 'red' | 'amber' | 'purple' | 'teal'; title?: string }) {
  const map = {
    gray: 'bg-gray-100 text-gray-600',
    blue: 'bg-blue-50 text-blue-700',
    green: 'bg-emerald-50 text-emerald-700',
    red: 'bg-red-50 text-red-700',
    amber: 'bg-amber-50 text-amber-700',
    purple: 'bg-violet-50 text-violet-700',
    teal: 'bg-teal-50 text-teal-700',
  } as const;
  return <span title={title} className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10.5px] font-semibold whitespace-nowrap ${map[tone]}`}>{children}</span>;
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean }) {
  return (
    <label className={`inline-flex items-center gap-2 select-none ${disabled ? 'opacity-50' : 'cursor-pointer'}`}>
      <button
        type="button" role="switch" aria-checked={checked} disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative w-9 h-5 rounded-full transition shrink-0 ${checked ? 'bg-blue-600' : 'bg-gray-300'}`}
      >
        <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-4' : ''}`} />
      </button>
      {label && <span className="text-[12px] text-gray-700">{label}</span>}
    </label>
  );
}

export function SubTabs<T extends string>({ tabs, value, onChange }: { tabs: { key: T; label: string; icon?: ReactNode }[]; value: T; onChange: (t: T) => void }) {
  return (
    <div className="flex gap-0 border-b border-gray-200 overflow-x-auto no-scrollbar">
      {tabs.map(t => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={`shrink-0 flex items-center gap-1.5 px-3 py-2 text-[12px] font-medium border-b-2 whitespace-nowrap transition ${
            value === t.key ? 'border-b-teal-600 text-gray-900' : 'border-b-transparent text-gray-400 hover:text-gray-600'
          }`}
        >
          {t.icon}{t.label}
        </button>
      ))}
    </div>
  );
}

export function MonthSelect({ months, value, onChange, className = '' }: { months: MonthKey[]; value: MonthKey; onChange: (m: MonthKey) => void; className?: string }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} className={`${cls.inputSm} ${className}`}>
      {months.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
    </select>
  );
}

export const VAT_LABEL: Record<VatMode, string> = { none: 'Không tính VAT', incl: 'Giá đã gồm VAT', excl: 'Giá chưa gồm VAT (+VAT)' };

export function VatSelect({ value, onChange, className = '' }: { value: VatMode; onChange: (v: VatMode) => void; className?: string }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value as VatMode)} className={`${cls.inputSm} ${className}`}>
      {(Object.keys(VAT_LABEL) as VatMode[]).map(k => <option key={k} value={k}>{VAT_LABEL[k]}</option>)}
    </select>
  );
}

export function VatCategorySelect({ value, onChange, className = '' }: { value: VatCategory; onChange: (v: VatCategory) => void; className?: string }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value as VatCategory)} className={`${cls.inputSm} ${className}`}>
      <option value="rent">Thuế thuê mặt bằng</option>
      <option value="util">Thuế điện &amp; bãi xe</option>
    </select>
  );
}

export function CurrencySelect({ value, onChange, className = '', disabled }: { value: Currency; onChange: (v: Currency) => void; className?: string; disabled?: boolean }) {
  return (
    <select value={value} disabled={disabled} onChange={e => onChange(e.target.value as Currency)} className={`${cls.inputSm} ${className}`}>
      <option value="VND">VNĐ</option>
      <option value="USD">USD</option>
    </select>
  );
}

export function VatBadge({ mode, rate }: { mode: VatMode; rate: number }) {
  if (mode === 'incl') return <Badge tone="green">Đã gồm VAT</Badge>;
  if (mode === 'excl') return <Badge tone="amber">+VAT {rate}%</Badge>;
  return <Badge>Không VAT</Badge>;
}

export function CurrencyBadge({ currency }: { currency: Currency }) {
  return <Badge tone={currency === 'USD' ? 'teal' : 'gray'}>{currency}</Badge>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="text-center py-8 text-[12.5px] text-gray-400">{children}</div>;
}

export function Banner({ tone = 'blue', children }: { tone?: 'blue' | 'amber' | 'red' | 'purple' | 'green'; children: ReactNode }) {
  const map = {
    blue: 'bg-blue-50 border-blue-200 text-blue-900',
    amber: 'bg-amber-50 border-amber-200 text-amber-900',
    red: 'bg-red-50 border-red-200 text-red-900',
    purple: 'bg-violet-50 border-violet-200 text-violet-900',
    green: 'bg-emerald-50 border-emerald-200 text-emerald-900',
  } as const;
  return <div className={`border rounded-lg px-3 py-2 text-[12px] leading-relaxed ${map[tone]}`}>{children}</div>;
}

export function Modal({ open, onClose, title, children, footer, wide }: {
  open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-3 md:p-0" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`bg-white rounded-xl shadow-xl w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} max-h-[90dvh] flex flex-col`}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <div className="text-[14px] font-semibold text-[#111]">{title}</div>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 text-gray-400" aria-label="Đóng"><X size={16} /></button>
        </div>
        <div className="px-4 py-3 overflow-y-auto flex-1">{children}</div>
        {footer && <div className="px-4 py-3 border-t border-gray-100 flex flex-wrap justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, children, hint, className = '' }: { label: ReactNode; children: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <div className={`min-w-0 ${className}`}>
      <label className={cls.label}>{label}</label>
      {children}
      {hint && <div className="text-[10.5px] text-gray-400 mt-1">{hint}</div>}
    </div>
  );
}

/** Ô chọn tháng <input type=month> nhận/trả 'YYYY-MM'. */
export function MonthInput({ value, onChange, className = '', allowEmpty }: { value: MonthKey | null; onChange: (m: MonthKey | null) => void; className?: string; allowEmpty?: boolean }) {
  return (
    <input
      type="month" value={value || ''} className={`${cls.inputSm} ${className}`}
      onChange={e => { const v = e.target.value; if (v || allowEmpty) onChange(v || null); }}
    />
  );
}

export function TextInput({ value, onChange, className = '', placeholder, ...rest }: {
  value: string; onChange: (v: string) => void; className?: string; placeholder?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  return <input value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} className={`${cls.inputSm} ${className}`} {...rest} />;
}

export function pnlTone(v: number): 'pos' | 'neg' {
  return v >= 0 ? 'pos' : 'neg';
}

export function signed(s: string, v: number): string {
  return v > 0 ? '+' + s : s;
}
