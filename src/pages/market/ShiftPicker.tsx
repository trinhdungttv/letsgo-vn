import { useState } from 'react';
import { Wand2 } from 'lucide-react';
import { computeShift, baseTypeOfPattern, allowsExtraOt, SHIFT_PATTERN_LABELS, type ShiftPattern } from './shiftCalc';
import type { PayrollInputType } from '../../lib/payroll/coefficients';
import { fmtVnd } from '../../lib/payroll/format';

/** Chọn "ca làm việc" (ngày 8h/đêm 8h/ngày 12h/đêm 12h, + OT rời nếu là ca 8h) rồi tự điền các
 *  trường lương chi tiết tương ứng — suy từ "Lương cơ bản" theo công chuẩn 26 ngày công, thay
 *  vì phải gõ tay từng mức (dễ nhầm, dễ cộng sai vì các mức này KHÔNG cộng dồn được với nhau). */
export default function ShiftPicker({ baseSalary, fieldNameByType, onApply }: {
  baseSalary: number;
  fieldNameByType: Partial<Record<PayrollInputType, string>>;
  onApply: (patch: Record<string, string>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pattern, setPattern] = useState<ShiftPattern>('day8');
  const [otHours, setOtHours] = useState('0');

  const available = (Object.keys(SHIFT_PATTERN_LABELS) as ShiftPattern[]).filter(p => fieldNameByType[baseTypeOfPattern(p)]);
  if (!available.length) return null;

  if (!baseSalary) {
    return (
      <div className="text-[10.5px] text-[#999] px-0.5 pt-1 border-t border-[#F0EEE9] mt-1">
        Nhập "Lương cơ bản" ở trên trước để tự tính ca theo công chuẩn 26 ngày công.
      </div>
    );
  }

  const otType: PayrollInputType = pattern === 'night8' ? 'ot_night_weekday' : 'ot_day_weekday';
  const otFieldName = fieldNameByType[otType];
  const result = computeShift(baseSalary, pattern, parseFloat(otHours) || 0);

  const apply = () => {
    const patch: Record<string, string> = {};
    for (const [type, val] of Object.entries(result.patch)) {
      const name = fieldNameByType[type as PayrollInputType];
      if (name) patch[name] = String(val);
    }
    onApply(patch);
    setOpen(false);
  };

  return (
    <div className="border-t border-[#F0EEE9] pt-1.5 mt-1">
      {!open ? (
        <button type="button" onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1 text-[10.5px] text-blue-600 hover:text-blue-800">
          <Wand2 size={11} /> Tính theo ca làm việc (từ lương cơ bản, công chuẩn 26 ngày)
        </button>
      ) : (
        <div className="space-y-1.5 bg-[#FAFAF8] rounded p-1.5">
          <div className="flex items-center gap-1.5 flex-wrap">
            <select value={pattern} onChange={e => setPattern(e.target.value as ShiftPattern)}
              className="text-[11px] px-1.5 py-1 rounded border border-gray-300 outline-none">
              {available.map(p => <option key={p} value={p}>{SHIFT_PATTERN_LABELS[p]}</option>)}
            </select>
            {allowsExtraOt(pattern) && otFieldName && (
              <>
                <span className="text-[10.5px] text-[#888]">+ OT</span>
                <input type="number" min="0" step="0.5" value={otHours} onChange={e => setOtHours(e.target.value)}
                  className="w-14 text-[11px] px-1.5 py-1 rounded border border-gray-300 outline-none text-right" />
                <span className="text-[10.5px] text-[#888]">giờ</span>
              </>
            )}
          </div>
          <div className="text-[10.5px] text-[#666]">
            Dự kiến ~{fmtVnd(result.previewTotal)} cho {result.previewHours}h công đó
            {(pattern === 'day12' || pattern === 'night12') && ' (đã gồm 4h OT trong hệ số ca 12h)'}.
          </div>
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={apply} className="px-2 py-1 rounded bg-blue-600 text-white text-[10.5px]">Điền vào bảng</button>
            <button type="button" onClick={() => setOpen(false)} className="px-2 py-1 rounded border border-gray-300 text-[10.5px] text-[#666]">Đóng</button>
          </div>
        </div>
      )}
    </div>
  );
}
