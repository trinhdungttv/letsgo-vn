// ============================================================================
// SpecialDatesEditor — danh sách ngày đặc biệt của một người liên hệ (ngoài
// sinh nhật): kỷ niệm hợp tác, ngày thành lập công ty, lễ riêng...
// Mỗi ngày đều được coi là lặp lại HÀNG NĂM khi tính nhắc nhở.
// ============================================================================
import { useState } from 'react';
import { Plus, X, CalendarHeart } from 'lucide-react';

export interface SpecialDateDraft {
  id?: string;
  label: string;
  date: string; // yyyy-mm-dd
}

interface Props {
  items: SpecialDateDraft[];
  onChange: (items: SpecialDateDraft[]) => void;
}

export default function SpecialDatesEditor({ items, onChange }: Props) {
  const [label, setLabel] = useState('');
  const [date, setDate] = useState('');

  const add = () => {
    if (!label.trim() || !date) return;
    onChange([...items, { label: label.trim(), date }]);
    setLabel('');
    setDate('');
  };

  const remove = (idx: number) => onChange(items.filter((_, i) => i !== idx));

  const fmt = (d: string) => {
    const [, m, day] = d.split('-');
    return `${day}/${m}`;
  };

  return (
    <div>
      {items.length > 0 && (
        <ul className="space-y-1.5 mb-2">
          {items.map((it, i) => (
            <li key={i} className="flex items-center gap-2 px-2.5 py-1.5 bg-gray-50 border border-gray-200 rounded-lg">
              <CalendarHeart className="w-3.5 h-3.5 text-pink-500 shrink-0" />
              <span className="text-[13px] text-gray-800 flex-1">{it.label}</span>
              <span className="text-[12px] text-gray-500 whitespace-nowrap">{fmt(it.date)} hàng năm</span>
              <button type="button" onClick={() => remove(i)} className="text-gray-400 hover:text-red-600 shrink-0">
                <X className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-1.5">
        <input value={label} onChange={e => setLabel(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          placeholder="VD: Kỷ niệm hợp tác, ngày thành lập DN…"
          className="flex-1 px-2.5 py-1.5 text-[13px] border border-gray-300 rounded-lg outline-none focus:border-blue-500" />
        <input type="date" value={date} onChange={e => setDate(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          className="px-2.5 py-1.5 text-[13px] border border-gray-300 rounded-lg outline-none focus:border-blue-500" />
        <button type="button" onClick={add} disabled={!label.trim() || !date}
          className="p-2 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed shrink-0">
          <Plus className="w-4 h-4" />
        </button>
      </div>
      <p className="text-[10.5px] text-gray-500 mt-1">
        Mỗi ngày lặp lại hàng năm — hệ thống sẽ nhắc trước 7 ngày mỗi khi mở app.
      </p>
    </div>
  );
}
