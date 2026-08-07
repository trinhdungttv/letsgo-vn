import { EOM, EOM_1, EOM_LABEL, EOM_1_LABEL, isDynamicDay } from '../utils/timelineDays';

/**
 * Ô nhập 1 mốc ngày trong tháng: số 1–31, hoặc nút mốc động
 *   CT   = cuối tháng      (lưu -1 → 28/29/30/31 tuỳ tháng)
 *   CT-1 = cuối tháng -1   (lưu -2 → 27/28/29/30 tuỳ tháng)
 * Để trống = chưa đặt.
 *
 * `quick` chọn nút nào hiện ra:
 *   'eom1' — ô bắt đầu (bên trái): chỉ CT-1
 *   'eom'  — ô kết thúc (bên phải): chỉ CT
 *   'both' — ô đơn lẻ (vd. Xuất HĐ): cả hai
 */
export default function DayCell({
  value, onChange, className = '', quick = 'eom',
}: {
  value: number | null | undefined;
  onChange: (v: number | null) => void;
  className?: string;
  quick?: 'eom' | 'eom1' | 'both';
}) {
  const showEom1 = quick === 'eom1' || quick === 'both';
  const showEom = quick === 'eom' || quick === 'both';

  if (isDynamicDay(value)) {
    return (
      <div className={`flex items-center gap-1 ${className}`}>
        <span className="text-[12px] text-blue-600 font-medium whitespace-nowrap">
          {value === EOM ? EOM_LABEL : EOM_1_LABEL}
        </span>
        <button type="button" onClick={() => onChange(null)} className="text-[10px] text-gray-400 hover:text-red-500">&times;</button>
      </div>
    );
  }

  const btnCls = 'text-[9px] px-1 py-0.5 rounded border border-gray-300 text-gray-500 hover:bg-blue-50 hover:text-blue-600 hover:border-blue-300 whitespace-nowrap';
  return (
    <div className={`flex items-center gap-1 ${className}`}>
      <input
        type="number" min={1} max={31} placeholder="—" value={value ?? ''}
        onChange={e => { const v = e.target.value; onChange(v === '' ? null : Math.max(1, Math.min(31, +v))); }}
        className="w-full text-[13px] px-2.5 py-1.5 border border-gray-300 rounded-lg outline-none focus:border-blue-500"
      />
      {showEom1 && (
        <button type="button" onClick={() => onChange(EOM_1)} title={EOM_1_LABEL} className={btnCls}>CT-1</button>
      )}
      {showEom && (
        <button type="button" onClick={() => onChange(EOM)} title={EOM_LABEL} className={btnCls}>CT</button>
      )}
    </div>
  );
}
