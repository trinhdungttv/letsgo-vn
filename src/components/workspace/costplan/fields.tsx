import { useEffect, useRef, useState } from 'react';

export const fmt = (n: number) => Math.round(Number.isFinite(n) ? n : 0).toLocaleString('vi-VN');
export const fmtD = (n: number) => `${fmt(n)} đ`;
export const fmtPct = (n: number, d = 1) => `${(Math.round(n * 10 ** d) / 10 ** d).toLocaleString('vi-VN')}%`;

/** Rút gọn số tiền lớn: 31.200.000 → "31,2 tr", 2.500.000.000 → "2,5 tỷ". */
export function fmtShort(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toLocaleString('vi-VN', { maximumFractionDigits: 2 })} tỷ`;
  if (a >= 1e6) return `${(n / 1e6).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} tr`;
  return fmt(n);
}

/**
 * Ô nhập tiền có dấu chấm ngăn nghìn (240.000). Chỉ nhận chữ số; đang gõ thì giữ nguyên nội dung
 * người dùng, chỉ định dạng lại khi rời ô hoặc khi giá trị đổi từ bên ngoài.
 */
export function MoneyInput({ value, onChange, className = '', disabled, title, placeholder = '0' }: {
  value: number; onChange: (n: number) => void; className?: string; disabled?: boolean; title?: string; placeholder?: string;
}) {
  const [text, setText] = useState(() => (value ? fmt(value) : ''));
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setText(value ? fmt(value) : ''); }, [value]);
  return (
    <input
      inputMode="numeric" disabled={disabled} title={title} placeholder={placeholder} value={text}
      onFocus={e => { focused.current = true; e.target.select(); }}
      onBlur={() => { focused.current = false; setText(value ? fmt(value) : ''); }}
      onChange={e => {
        const digits = e.target.value.replace(/\D/g, '');
        setText(digits ? Number(digits).toLocaleString('vi-VN') : '');
        onChange(digits ? Number(digits) : 0);
      }}
      className={className}
    />
  );
}

/** Ô nhập số thường (cho %, số ngày, số LĐ) — cho phép số lẻ, không ép định dạng khi đang gõ. */
export function NumInput({ value, onChange, min = 0, max, step = 1, className = '', disabled, title }: {
  value: number; onChange: (n: number) => void; min?: number; max?: number; step?: number; className?: string; disabled?: boolean; title?: string;
}) {
  const [text, setText] = useState(String(value));
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setText(String(value)); }, [value]);
  return (
    <input
      type="text" inputMode="decimal" disabled={disabled} title={title} value={text}
      onFocus={e => { focused.current = true; e.target.select(); }}
      onBlur={() => { focused.current = false; setText(String(value)); }}
      onChange={e => {
        const raw = e.target.value.replace(',', '.');
        if (!/^\d*\.?\d*$/.test(raw)) return;
        setText(e.target.value);
        let n = raw === '' || raw === '.' ? 0 : Number(raw);
        n = Math.max(min, max != null ? Math.min(max, n) : n);
        if (step >= 1) n = Math.round(n);
        onChange(n);
      }}
      className={className}
    />
  );
}

export { field as inputCls } from './ui';
