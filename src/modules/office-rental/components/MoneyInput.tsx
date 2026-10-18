// Ô nhập tiền: gõ 5997000 → hiện 5,997,000 ngay khi gõ (không dùng đơn vị "triệu").
// VND chỉ nhận số nguyên, USD tối đa 2 số lẻ. Giữ đúng vị trí con trỏ khi thêm/bớt dấu phẩy.
import { useEffect, useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import type { Currency } from '../lib/calc/types';
import { formatMoneyInput, moneyInputText } from '../lib/calc/money';
import type { SaveState } from '../data/OfficeDataProvider';

const STATUS_RING: Record<SaveState, string> = {
  pending: 'ring-1 ring-amber-300 border-amber-300',
  saving: 'ring-1 ring-amber-300 border-amber-300',
  saved: 'ring-1 ring-emerald-300 border-emerald-300',
  error: 'ring-1 ring-red-400 border-red-400 bg-red-50',
};

/** Đếm ký tự "có nghĩa" (số, dấu chấm) bên trái vị trí `pos`. */
function significantBefore(text: string, pos: number): number {
  let n = 0;
  for (let i = 0; i < pos && i < text.length; i++) if (/[\d.]/.test(text[i])) n++;
  return n;
}
function positionAfter(text: string, count: number): number {
  if (count <= 0) return 0;
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    if (/[\d.]/.test(text[i])) n++;
    if (n === count) return i + 1;
  }
  return text.length;
}

export function MoneyInput({
  value, onChange, currency = 'VND', className = '', placeholder = '0', disabled, status, error, onRetry, ariaLabel, autoFocus,
}: {
  value: number | null | undefined;
  onChange: (raw: number) => void;
  currency?: Currency;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
  status?: SaveState;
  error?: string;
  onRetry?: () => void;
  ariaLabel?: string;
  autoFocus?: boolean;
}) {
  const [text, setText] = useState(() => moneyInputText(value, currency));
  const focused = useRef(false);
  const ref = useRef<HTMLInputElement>(null);
  const caret = useRef<number | null>(null);

  useEffect(() => {
    if (!focused.current) setText(moneyInputText(value, currency));
  }, [value, currency]);

  useEffect(() => {
    if (caret.current !== null && ref.current && document.activeElement === ref.current) {
      ref.current.setSelectionRange(caret.current, caret.current);
      caret.current = null;
    }
  }, [text]);

  return (
    <span className="relative inline-flex w-full items-center">
      <input
        ref={ref}
        type="text"
        inputMode={currency === 'USD' ? 'decimal' : 'numeric'}
        aria-label={ariaLabel}
        title={status === 'error' ? error : undefined}
        autoFocus={autoFocus}
        disabled={disabled}
        placeholder={placeholder}
        value={text}
        onFocus={() => { focused.current = true; }}
        onBlur={() => { focused.current = false; setText(moneyInputText(value, currency)); }}
        onChange={e => {
          const el = e.target;
          const keep = significantBefore(el.value, el.selectionStart ?? el.value.length);
          const r = formatMoneyInput(el.value, currency);
          caret.current = positionAfter(r.text, keep);
          setText(r.text);
          onChange(r.raw);
        }}
        className={`w-full border border-gray-200 rounded-md px-2 py-1 text-[12.5px] text-right tabular-nums bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 disabled:bg-gray-50 ${status ? STATUS_RING[status] : ''} ${onRetry && status === 'error' ? 'pr-6' : ''} ${className}`}
      />
      {status === 'error' && onRetry && (
        <button
          type="button" onClick={onRetry} title={`${error || 'Lỗi'} — bấm để thử lại`}
          className="absolute right-1 text-red-500 hover:text-red-700"
        >
          <RotateCcw size={12} />
        </button>
      )}
    </span>
  );
}

/** Ô nhập số nguyên ≥ 0 (số lượng xe…). */
export function CountInput({ value, onChange, className = '', status, error, onRetry, ariaLabel }: {
  value: number | null | undefined; onChange: (n: number) => void; className?: string;
  status?: SaveState; error?: string; onRetry?: () => void; ariaLabel?: string;
}) {
  const [text, setText] = useState(() => (value ? String(value) : ''));
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setText(value ? String(value) : ''); }, [value]);
  return (
    <span className="relative inline-flex w-full items-center">
      <input
        type="text" inputMode="numeric" aria-label={ariaLabel} placeholder="0" value={text}
        title={status === 'error' ? error : undefined}
        onFocus={() => { focused.current = true; }}
        onBlur={() => { focused.current = false; setText(value ? String(value) : ''); }}
        onChange={e => {
          const digits = e.target.value.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
          setText(digits);
          onChange(digits ? Number(digits) : 0);
        }}
        className={`w-full border border-gray-200 rounded-md px-2 py-1 text-[12.5px] text-right tabular-nums bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 ${status ? STATUS_RING[status] : ''} ${className}`}
      />
      {status === 'error' && onRetry && (
        <button type="button" onClick={onRetry} title={`${error || 'Lỗi'} — bấm để thử lại`} className="absolute right-1 text-red-500 hover:text-red-700">
          <RotateCcw size={12} />
        </button>
      )}
    </span>
  );
}

/** Ô số thập phân nhỏ (%, m², chỉ số công tơ) — không ép định dạng khi đang gõ. */
export function DecimalInput({ value, onChange, className = '', placeholder, ariaLabel, allowNegative, status }: {
  value: number | null | undefined; onChange: (n: number | null) => void; className?: string; placeholder?: string;
  ariaLabel?: string; allowNegative?: boolean; status?: SaveState;
}) {
  const [text, setText] = useState(() => (value === null || value === undefined ? '' : String(value)));
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setText(value === null || value === undefined ? '' : String(value)); }, [value]);
  return (
    <input
      type="text" inputMode="decimal" aria-label={ariaLabel} placeholder={placeholder} value={text}
      onFocus={() => { focused.current = true; }}
      onBlur={() => { focused.current = false; setText(value === null || value === undefined ? '' : String(value)); }}
      onChange={e => {
        let v = e.target.value.replace(',', '.').replace(allowNegative ? /[^\d.-]/g : /[^\d.]/g, '');
        const dot = v.indexOf('.');
        if (dot !== -1) v = v.slice(0, dot + 1) + v.slice(dot + 1).replace(/\./g, '');
        setText(v);
        const n = v === '' || v === '-' || v === '.' ? null : Number(v);
        onChange(n !== null && Number.isFinite(n) ? n : null);
      }}
      className={`w-full border border-gray-200 rounded-md px-2 py-1 text-[12.5px] text-right tabular-nums bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 ${status ? STATUS_RING[status] : ''} ${className}`}
    />
  );
}
