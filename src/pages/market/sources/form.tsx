// Khối form kiểu iOS dùng chung cho các hộp thoại của tab Nguồn LĐ (giống hồ sơ liên hệ CSKH).
import type { ReactNode } from 'react';
import { SHEET_FOOTER } from '../../../modules/cskh/components/Sheet';

export const FOOT_BTN = 'inline-flex items-center gap-1.5 h-10 md:h-9 px-3.5 rounded-full text-[13px] font-medium active:scale-[0.97] transition disabled:opacity-40';
export const FOOT_GRAY = `${FOOT_BTN} px-4 bg-[rgba(118,118,128,0.12)] text-[#1D1D1F] hover:bg-[rgba(118,118,128,0.2)]`;
export const FOOT_BLUE = `${FOOT_BTN} px-5 bg-[#0071E3] text-white font-semibold hover:bg-[#0077ED]`;
export const FOOT_RED = `${FOOT_BTN} bg-[#FF3B30]/10 text-[#D70015] hover:bg-[#FF3B30]/[0.16]`;

export function Field({ label, hint, children, full }: { label: string; hint?: ReactNode; children: ReactNode; full?: boolean }) {
  return (
    <div className={full ? 'md:col-span-2' : undefined}>
      <label className="block text-[12px] font-medium text-[#6E6E73] mb-1">{label}</label>
      {children}
      {hint && <p className="text-[11.5px] text-[#86868B] mt-1 leading-snug">{hint}</p>}
    </div>
  );
}

export function Section({ title, children, note, cols = 2 }: { title: string; children: ReactNode; note?: ReactNode; cols?: 1 | 2 }) {
  return (
    <section className="mt-5">
      <h3 className="px-1 text-[12px] font-semibold uppercase tracking-[0.04em] text-[#86868B] mb-1.5">{title}</h3>
      <div className={`grid grid-cols-1 ${cols === 2 ? 'md:grid-cols-2' : ''} gap-3 rounded-[14px] bg-white md:bg-[#F5F5F7] p-3.5 md:p-4`}>{children}</div>
      {note && <p className="px-1 mt-1.5 text-[11.5px] text-[#86868B] leading-snug">{note}</p>}
    </section>
  );
}

export function SheetFooter({ children }: { children: ReactNode }) {
  return (
    <div className={`${SHEET_FOOTER} mt-5 bg-[#F2F2F7]/90 md:bg-white/90`}>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

export function SheetHead({ title, sub }: { title: string; sub?: ReactNode }) {
  return (
    <div className="md:pr-10">
      <p className="text-[22px] md:text-[24px] font-bold tracking-[-0.02em] leading-tight text-[#1D1D1F]">{title}</p>
      {sub && <p className="text-[13.5px] text-[#6E6E73] mt-1">{sub}</p>}
    </div>
  );
}

/** Số nguyên ≥ 0 từ ô nhập ('' → null). */
export const intOrNull = (v: string): number | null => {
  const n = parseInt(v.replace(/[^\d]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
};
