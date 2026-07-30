// Mảnh UI dùng chung cho màn "Tính bảng lương". Giữ đúng ngôn ngữ thị giác đang có ở app
// (cỡ chữ 11.5px, viền #E8E7E2, bo 8-10px) để màn mới không lạc lõng giữa các màn cũ.
import { type ReactNode, useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';

/** Tiền: luôn làm tròn tới ĐỒNG ở tầng hiển thị. Engine giữ số thực xuyên suốt, chỉ chỗ này mới
 *  được làm tròn — làm tròn giữa chuỗi tính toán là cách tích luỹ sai số nhanh nhất. */
export const fmtVnd = (n: number | null | undefined): string =>
  n == null || !Number.isFinite(n) ? '—' : Math.round(n).toLocaleString('vi-VN');

/** Tiền kèm dấu +/− — dùng cho lời/lỗ, để đọc lướt vẫn thấy ngay dấu. */
export const fmtSigned = (n: number): string =>
  !Number.isFinite(n) ? '—' : (n >= 0 ? '+' : '−') + Math.round(Math.abs(n)).toLocaleString('vi-VN');

export const fmtPct = (n: number, digits = 1): string =>
  !Number.isFinite(n) ? '—' : `${n >= 0 ? '' : '−'}${Math.abs(n).toFixed(digits)}%`;

/** Giờ: bỏ ".0" thừa nhưng giữ phần lẻ thật (EH hay ra 421,2). */
export const fmtHours = (n: number): string =>
  !Number.isFinite(n) ? '—' : (Math.round(n * 10) / 10).toLocaleString('vi-VN');

export const parseNum = (raw: string): number => {
  const n = parseFloat(raw.replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

export function Field({ label, hint, children, className = '' }: {
  label: string; hint?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <div className={className}>
      <label className="text-[11.5px] font-medium text-gray-700 block mb-1">{label}</label>
      {children}
      {hint && <div className="text-[10.5px] text-[#999] mt-0.5">{hint}</div>}
    </div>
  );
}

const INPUT_CLS = 'w-full text-[12.5px] px-2.5 py-1.5 border border-gray-300 rounded-lg outline-none focus:border-blue-500';

/** Ô số giữ CHUỖI khi đang gõ, chỉ báo ra ngoài bằng number.
 *  Vì sao không dùng thẳng value={number}: gõ "1000" mà mỗi ký tự đều bị parse rồi format lại thì
 *  xoá trắng ô hoặc gõ dấu chấm sẽ bị nhảy con trỏ. Giữ chuỗi nội bộ, đồng bộ lại khi giá trị
 *  ngoài đổi thật (vd bấm preset) — so sánh theo số để không tự ghi đè cái người dùng đang gõ. */
export function NumInput({ value, onChange, placeholder, min, max, step = 1000, disabled, align = 'right' }: {
  value: number; onChange: (v: number) => void; placeholder?: string;
  min?: number; max?: number; step?: number; disabled?: boolean; align?: 'left' | 'right';
}) {
  const [raw, setRaw] = useState(String(value ?? ''));
  useEffect(() => {
    if (parseNum(raw) !== value) setRaw(value === 0 ? '' : String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <input
      type="number" min={min} max={max} step={step} disabled={disabled} placeholder={placeholder ?? '0'}
      value={raw}
      onChange={e => { setRaw(e.target.value); onChange(parseNum(e.target.value)); }}
      className={`${INPUT_CLS} ${align === 'right' ? 'text-right' : ''} disabled:bg-gray-50 disabled:text-gray-400`}
    />
  );
}

export function TextInput({ value, onChange, placeholder }: {
  value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className={INPUT_CLS} />;
}

export function Select<T extends string>({ value, onChange, options }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: string }[];
}) {
  return (
    <select value={value} onChange={e => onChange(e.target.value as T)} className={`${INPUT_CLS} bg-white`}>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export function Check({ checked, onChange, children }: {
  checked: boolean; onChange: (v: boolean) => void; children: ReactNode;
}) {
  return (
    <label className="flex items-start gap-1.5 text-[11.5px] text-gray-700 cursor-pointer">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="accent-blue-600 mt-0.5" />
      <span>{children}</span>
    </label>
  );
}

/** Khối gập được. Mặc định mở hay đóng do nơi gọi quyết định — khối nhập nhiều mà mở hết thì
 *  form dài quá, người dùng phải cuộn mới thấy kết quả. */
export function Section({ title, tone = 'plain', defaultOpen = true, right, children }: {
  title: ReactNode; tone?: 'plain' | 'blue' | 'emerald' | 'amber' | 'violet';
  defaultOpen?: boolean; right?: ReactNode; children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const tones = {
    plain: 'border-[#E8E7E2] bg-white', blue: 'border-blue-200 bg-blue-50/40',
    emerald: 'border-emerald-200 bg-emerald-50/40', amber: 'border-amber-200 bg-amber-50/40',
    violet: 'border-violet-200 bg-violet-50/40',
  } as const;
  const titleTones = {
    plain: 'text-[#333]', blue: 'text-blue-700', emerald: 'text-emerald-700',
    amber: 'text-amber-700', violet: 'text-violet-700',
  } as const;
  return (
    <div className={`border rounded-lg ${tones[tone]}`}>
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <button type="button" onClick={() => setOpen(v => !v)} className="flex items-center gap-1 min-w-0">
          <ChevronDown size={13} className={`shrink-0 transition-transform ${open ? '' : '-rotate-90'} ${titleTones[tone]}`} />
          <span className={`text-[11px] font-semibold truncate ${titleTones[tone]}`}>{title}</span>
        </button>
        {right}
      </div>
      {open && <div className="px-3 pb-3 space-y-2.5">{children}</div>}
    </div>
  );
}

/** 1 dòng số liệu kết quả. `strong` cho dòng tổng, `tone` cho lời/lỗ. */
export function Stat({ label, value, sub, strong, tone = 'neutral' }: {
  label: ReactNode; value: ReactNode; sub?: ReactNode; strong?: boolean;
  tone?: 'neutral' | 'good' | 'bad' | 'muted';
}) {
  const tones = {
    neutral: 'text-[#111]', good: 'text-emerald-700', bad: 'text-red-600', muted: 'text-[#888]',
  } as const;
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <div className="min-w-0">
        <div className={`text-[11.5px] ${strong ? 'font-semibold text-[#333]' : 'text-[#666]'}`}>{label}</div>
        {sub && <div className="text-[10px] text-[#aaa] mt-0.5">{sub}</div>}
      </div>
      <div className={`shrink-0 tabular-nums ${strong ? 'text-[13.5px] font-semibold' : 'text-[12.5px]'} ${tones[tone]}`}>
        {value}
      </div>
    </div>
  );
}
