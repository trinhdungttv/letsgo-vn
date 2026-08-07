import { EOM } from '../utils/timelineDays';

/**
 * Ô nhập 1 mốc ngày trong tháng: số 1–31, hoặc nút CT = "cuối tháng"
 * (lưu -1, khi hiển thị tự nhảy theo số ngày thực tế của tháng: 28/29/30/31).
 * Để trống = chưa đặt.
 */
export default function DayCell({
  value, onChange, className = '',
}: { value: number | null | undefined; onChange: (v: number | null) => void; className?: string }) {
  if (value === EOM) {
    return (
      <div className={`flex items-center gap-1 ${className}`}>
        <span className="text-[12px] text-blue-600 font-medium">Cuối tháng</span>
        <button type="button" onClick={() => onChange(null)} className="text-[10px] text-gray-400 hover:text-red-500">&times;</button>
      </div>
    );
  }
  return (
    <div className={`flex items-center gap-1 ${className}`}>
      <input
        type="number" min={1} max={31} placeholder="—" value={value ?? ''}
        onChange={e => { const v = e.target.value; onChange(v === '' ? null : Math.max(1, Math.min(31, +v))); }}
        className="w-full text-[13px] px-2.5 py-1.5 border border-gray-300 rounded-lg outline-none focus:border-blue-500"
      />
      <button
        type="button" onClick={() => onChange(EOM)} title="Cuối tháng"
        className="text-[9px] px-1 py-0.5 rounded border border-gray-300 text-gray-500 hover:bg-blue-50 hover:text-blue-600 hover:border-blue-300 whitespace-nowrap"
      >CT</button>
    </div>
  );
}
