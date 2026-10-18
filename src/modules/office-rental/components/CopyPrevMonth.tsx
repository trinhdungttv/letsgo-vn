import { useState } from 'react';
import { CopyPlus } from 'lucide-react';
import { addMonths, monthLabel } from '../lib/calc/months';
import type { MonthKey } from '../lib/calc/types';
import { MonthSelect, cls } from './ui';

/** "Chép từ tháng trước sang tháng X" — chỉ điền ô đang trống, không ghi đè số đã nhập. */
export default function CopyPrevMonth({ months, defaultMonth, what, onCopy }: {
  months: MonthKey[];
  defaultMonth: MonthKey;
  what: string;
  onCopy: (target: MonthKey, source: MonthKey) => number;
}) {
  const [target, setTarget] = useState<MonthKey>(defaultMonth);
  const [msg, setMsg] = useState<string | null>(null);
  const t = months.includes(target) ? target : months[0];
  const source = addMonths(t, -1);
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[11.5px] text-gray-500">
      <span>Chép {what} {monthLabel(source)} →</span>
      <MonthSelect months={months.filter(m => m !== months[0])} value={t} onChange={m => { setTarget(m); setMsg(null); }} />
      <button
        className={`${cls.btn} ${cls.secondary} !py-1`}
        onClick={() => {
          const n = onCopy(t, source);
          setMsg(n ? `Đã điền ${n} ô` : 'Không có ô trống nào để điền');
          setTimeout(() => setMsg(null), 3000);
        }}
      >
        <CopyPlus size={12} /> Chép (chỉ ô trống)
      </button>
      {msg && <span className="text-emerald-700">{msg}</span>}
    </div>
  );
}
