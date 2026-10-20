// "Việc tiếp theo" + hạn nhanh (Ngày mai / 3 ngày / 1 tuần / Chọn ngày) — port PRM FollowUpPicker.
// Gõ việc mà chưa chọn hạn → tự đặt hạn = ngày mai (việc đã hứa luôn cần hạn để vào hàng đợi).
import { useState } from 'react';
import { addDaysIso } from '../../../lib/cskh/lunar';
import { inputCls, type FollowUpValue } from '../ui';
import { ChoiceChip } from './Sheet';

const PRESETS: ReadonlyArray<{ days: number; label: string }> = [
  { days: 1, label: 'Ngày mai' },
  { days: 3, label: '3 ngày' },
  { days: 7, label: '1 tuần' },
];

export function FollowUpPicker({ value, onChange, today, placeholder }: {
  value: FollowUpValue;
  onChange: (next: FollowUpValue) => void;
  /** Hôm nay (giờ VN) để tính hạn nhanh. */
  today: string;
  placeholder?: string;
}) {
  const [customOpen, setCustomOpen] = useState(false);
  const matched = PRESETS.find(p => addDaysIso(today, p.days) === value.due);
  const customActive = customOpen || (value.due !== '' && !matched);

  return (
    <div className="space-y-2">
      <input
        type="text"
        value={value.action}
        onChange={e => {
          const action = e.target.value;
          onChange({ action, due: action.trim() !== '' && value.due === '' ? addDaysIso(today, 1) : value.due });
        }}
        className={inputCls}
        placeholder={placeholder ?? 'VD: gửi báo giá tháng 11, hỏi lại số LĐ cần tăng ca…'}
        aria-label="Việc tiếp theo"
      />
      {value.action.trim() !== '' && (
        <div className="flex flex-wrap gap-1.5 items-center">
          <span className="text-[11.5px] text-[#888]">Hạn:</span>
          {PRESETS.map(p => (
            <ChoiceChip
              key={p.days}
              active={matched?.days === p.days && !customOpen}
              onClick={() => { setCustomOpen(false); onChange({ ...value, due: addDaysIso(today, p.days) }); }}
            >
              {p.label}
            </ChoiceChip>
          ))}
          <ChoiceChip active={customActive} onClick={() => setCustomOpen(true)}>Chọn ngày</ChoiceChip>
          {customActive && (
            <input
              type="date"
              value={value.due}
              min={today}
              onChange={e => onChange({ ...value, due: e.target.value })}
              aria-label="Hạn xử lý"
              className="text-[13px] px-2 py-1 rounded-lg border border-gray-300 bg-white outline-none focus:border-blue-500"
            />
          )}
        </div>
      )}
    </div>
  );
}
