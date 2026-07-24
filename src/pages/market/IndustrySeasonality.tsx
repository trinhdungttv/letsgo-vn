import { useState } from 'react';
import { CalendarRange, Info } from 'lucide-react';

// Mức nhu cầu LĐ theo tháng: 0 = chưa nhập, 1 = rất thấp … 5 = cao điểm
export const SEASON_LEVELS = [
  { v: 0, label: 'Chưa nhập', bg: 'bg-[#F4F3EF]', text: 'text-[#bbb]', dot: '#E8E7E2' },
  { v: 1, label: 'Rất thấp', bg: 'bg-blue-50', text: 'text-blue-700', dot: '#DBEAFE' },
  { v: 2, label: 'Thấp', bg: 'bg-emerald-50', text: 'text-emerald-700', dot: '#D1FAE5' },
  { v: 3, label: 'Bình thường', bg: 'bg-amber-100', text: 'text-amber-800', dot: '#FDE68A' },
  { v: 4, label: 'Cao', bg: 'bg-orange-200', text: 'text-orange-900', dot: '#FED7AA' },
  { v: 5, label: 'Cao điểm', bg: 'bg-red-300', text: 'text-red-900', dot: '#FCA5A5' },
];

interface Props {
  levels: number[];
  notes: string[];
  onChange: (levels: number[], notes: string[]) => void;
}

export default function IndustrySeasonality({ levels, notes, onChange }: Props) {
  const [sel, setSel] = useState<number | null>(null);
  const thisMonth = new Date().getMonth();

  const setLevel = (i: number, v: number) => {
    const next = [...levels];
    next[i] = v;
    onChange(next, notes);
  };
  const setNote = (i: number, text: string) => {
    const next = [...notes];
    next[i] = text;
    onChange(levels, next);
  };

  const peak = levels.map((v, i) => ({ v, i })).filter(x => x.v >= 4).map(x => x.i + 1);
  const nextMonth = (thisMonth + 1) % 12;
  const alert = levels[nextMonth] >= 4
    ? `Tháng ${nextMonth + 1} ngành này vào ${SEASON_LEVELS[levels[nextMonth]].label.toLowerCase()} — chuẩn bị nguồn LĐ từ bây giờ.`
    : null;

  return (
    <div className="bg-white border border-[#E8E7E2] rounded-[10px] overflow-hidden">
      <div className="px-4 py-2.5 border-b border-[#E8E7E2] flex items-center gap-2 flex-wrap">
        <CalendarRange size={13} className="text-orange-600" />
        <div className="text-[12.5px] font-semibold text-[#111]">Lịch mùa vụ · nhu cầu lao động 12 tháng</div>
        <span className="text-[10.5px] text-[#999]">click chọn tháng, rồi bấm đúng mức muốn đặt — tránh lỡ tay đổi mức</span>
        <div className="ml-auto flex items-center gap-2">
          {SEASON_LEVELS.slice(1).map(l => (
            <span key={l.v} className="inline-flex items-center gap-1 text-[10px] text-[#888]">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ background: l.dot }} /> {l.label}
            </span>
          ))}
        </div>
      </div>

      <div className="p-3">
        <div className="grid grid-cols-12 gap-1">
          {levels.map((v, i) => {
            const L = SEASON_LEVELS[v] ?? SEASON_LEVELS[0];
            return (
              <button key={i} onClick={() => setSel(sel === i ? null : i)}
                title={notes[i] || L.label}
                className={`relative rounded-lg py-2 transition ${L.bg} ${sel === i ? 'ring-2 ring-blue-500' : ''} ${i === thisMonth ? 'outline outline-1 outline-offset-1 outline-[#111]' : ''} hover:opacity-80`}>
                <div className={`text-[11px] font-medium ${L.text}`}>T{i + 1}</div>
                <div className={`text-[10px] ${L.text} opacity-80`}>{v || '–'}</div>
                {notes[i] && <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-[#111]/30" />}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-3 mt-2 text-[11px] text-[#888] flex-wrap">
          <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm outline outline-1 outline-[#111]" /> tháng hiện tại</span>
          {peak.length > 0 && <span>Cao điểm: <b className="text-red-700">{peak.map(m => 'T' + m).join(', ')}</b></span>}
        </div>

        {alert && (
          <div className="mt-2 flex items-start gap-1.5 px-3 py-2 rounded-lg bg-orange-50 text-[11.5px] text-orange-900 leading-relaxed">
            <Info size={12} className="shrink-0 mt-0.5" /> {alert}
          </div>
        )}

        {sel != null && (
          <div className="mt-2 p-2.5 rounded-lg bg-[#F9F9F7] border border-[#E8E7E2]">
            <label className="text-[11px] text-[#888]">Đặt mức cho tháng {sel + 1} — bấm đúng mức muốn chọn</label>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {SEASON_LEVELS.map(l => (
                <button key={l.v} onClick={() => setLevel(sel, l.v)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border transition ${l.bg} ${l.text} ${levels[sel] === l.v ? 'border-blue-500 ring-1 ring-blue-500' : 'border-transparent hover:opacity-80'}`}>
                  {l.label}
                </button>
              ))}
            </div>
            <label className="text-[11px] text-[#888] mt-2 block">Ghi chú tháng {sel + 1} — vì sao tăng/giảm, khách nào bị ảnh hưởng</label>
            <textarea value={notes[sel] || ''} onChange={e => setNote(sel, e.target.value)} rows={2}
              placeholder="VD: Vào mùa hàng Tết, 3 KH tăng 30% quân số, cần tuyển thời vụ từ giữa T8"
              title={notes[sel] || ''}
              className="w-full text-[12.5px] px-2.5 py-1.5 rounded-lg border border-[#E8E7E2] outline-none focus:border-blue-500 resize-y leading-relaxed" />
          </div>
        )}
      </div>
    </div>
  );
}
