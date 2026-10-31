// Khối giao diện dùng chung của module Tuyển dụng — cùng ngôn ngữ Apple với CSKH / Workspace
// (thẻ trắng bo 18px, viên nang màu, nút viên). Khối gốc: cskh/components/apple.tsx + Sheet.tsx.
import { useState } from 'react';
import type { ReactNode } from 'react';
import { AlertTriangle, Database } from 'lucide-react';
import { TINT } from '../../components/workspace/wsTheme';
import { STAGE_META } from '../../lib/recruit/stages';
import type { RecruitStage } from '../../lib/recruit/types';
import { inputCls } from '../cskh/ui';

export { inputCls };
export { PageTitle, Panel, Segmented, PillSelect, SearchField, Switch, Quiet, Row, MoreButton, FilterChip } from '../cskh/components/apple';
export { Sheet, SHEET_FOOTER, ChoiceChip } from '../cskh/components/Sheet';
export { PANEL, CAPTION, LINK, PILL_PRIMARY, PILL_TINTED, PILL_GRAY, ROUND_ICON } from '../cskh/ui';

export const labelCls = 'block text-[12px] font-medium text-[#6E6E73] mb-1';
export const sectionCls = 'rounded-[14px] bg-white md:bg-[#F5F5F7] p-3.5 md:p-4 space-y-3';

export function Field({ label, hint, children, className = '' }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={`block min-w-0 ${className}`}>
      <span className={labelCls}>{label}</span>
      {children}
      {hint && <span className="block text-[11.5px] text-[#86868B] mt-1 leading-snug">{hint}</span>}
    </label>
  );
}

export function StageBadge({ stage, className = '' }: { stage: RecruitStage; className?: string }) {
  const m = STAGE_META[stage];
  return <span className={`inline-flex items-center h-6 px-2.5 rounded-full text-[11.5px] font-semibold whitespace-nowrap ${TINT[m.tint]} ${className}`}>{m.label}</span>;
}

export function Spinner({ className = '' }: { className?: string }) {
  return <div className={`w-5 h-5 border-2 border-black/[0.08] border-t-[#0071E3] rounded-full animate-spin ${className}`} />;
}

export function ErrorBanner({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-[12px] bg-[#FF3B30]/[0.08] text-[#D70015] text-[13px] px-3.5 py-2.5">
      <AlertTriangle size={15} className="mt-0.5 shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** DB chưa chạy migration → hướng dẫn thay vì câu lỗi kỹ thuật. */
export function SetupNotice({ migration }: { migration: string }) {
  return (
    <div className="bg-white rounded-[18px] p-6 md:p-8 text-center max-w-xl mx-auto shadow-[0_0_0_0.5px_rgba(0,0,0,0.06),0_8px_24px_-12px_rgba(0,0,0,0.08)]">
      <span className="mx-auto w-12 h-12 rounded-full bg-[#FF9500]/[0.14] text-[#B25000] flex items-center justify-center"><Database size={22} /></span>
      <h2 className="text-[19px] font-bold text-[#1D1D1F] mt-3">Module Tuyển dụng chưa được cài trên cơ sở dữ liệu</h2>
      <p className="text-[13.5px] text-[#6E6E73] mt-2 leading-relaxed">
        Mở Supabase → SQL Editor, chạy file <b>{migration}</b> (trong thư mục supabase/migrations) rồi tải lại trang.
        Dữ liệu ứng viên được khoá riêng, chỉ đọc được khi đã đăng nhập app.
      </p>
    </div>
  );
}

// ── Định dạng ──
export const fmtDate = (d: string | null | undefined): string => {
  if (!d) return '';
  const [y, m, day] = d.slice(0, 10).split('-');
  return `${day}/${m}/${y.slice(2)}`;
};
export const fmtDateTime = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
};
export const fmtNum = (n: number | null | undefined): string => (n == null ? '' : Math.round(n).toLocaleString('vi-VN'));

/** Ngày hôm nay theo máy người dùng (giờ VN) 'YYYY-MM-DD'. */
export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export const currentMonth = (): string => todayIso().slice(0, 7);

/** 'YYYY-MM-DDTHH:mm' (ô datetime-local) ↔ ISO có múi giờ. */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
export const fromLocalInput = (v: string): string | null => (v ? new Date(v).toISOString() : null);

/** Ô nhập tiền: hiện 12.000.000, giữ số. */
export function MoneyInput({ value, onChange, placeholder, className = '' }: {
  value: number | null;
  onChange: (v: number | null) => void;
  placeholder?: string;
  className?: string;
}) {
  const [text, setText] = useState<string | null>(null);
  const shown = text ?? (value == null ? '' : value.toLocaleString('vi-VN'));
  return (
    <input
      inputMode="numeric"
      value={shown}
      placeholder={placeholder}
      onFocus={() => setText(value == null ? '' : String(value))}
      onChange={e => {
        const raw = e.target.value.replace(/[^\d]/g, '');
        setText(raw);
        onChange(raw === '' ? null : Number(raw));
      }}
      onBlur={() => setText(null)}
      className={`${inputCls} tabular-nums ${className}`}
    />
  );
}

/** Ô có/không/chưa rõ (boolean | null). */
export function TriState({ value, onChange, yes = 'Có', no = 'Không' }: { value: boolean | null; onChange: (v: boolean | null) => void; yes?: string; no?: string }) {
  const opt = (v: boolean | null, label: string) => (
    <button type="button" onClick={() => onChange(v)} aria-pressed={value === v}
      className={`flex-1 h-9 md:h-8 rounded-[8px] text-[12.5px] font-medium transition ${value === v ? 'bg-white text-[#1D1D1F] shadow-[0_2px_6px_rgba(0,0,0,0.12)]' : 'text-[#6E6E73] hover:text-[#1D1D1F]'}`}>
      {label}
    </button>
  );
  return (
    <div className="flex p-[2px] rounded-[10px] bg-[rgba(118,118,128,0.12)]">
      {opt(true, yes)}{opt(false, no)}{opt(null, 'Chưa rõ')}
    </div>
  );
}
