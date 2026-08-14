// Kỳ TT Thực Tế — dùng chung giữa Tài chính > Timeline (modal sửa nhanh) và
// hồ sơ khách hàng > Điều khoản thanh toán, để 2 nơi luôn cùng 1 bộ field/logic,
// không viết trùng UI theo 2 kiểu khác nhau rồi lệch hành vi.
import DayCell from '../DayCell';
import { calcExpectedDueActual } from '../../lib/paymentDate';

export interface PaymentActualValue {
  payment_actual_mode?: 'days' | 'fixed' | null;
  payment_actual_days?: number | null;
  payment_actual_fixed_day?: number | null;
  payment_actual_cutoff?: number | null;
}

interface Props {
  value: PaymentActualValue;
  onChange: (patch: Partial<PaymentActualValue>) => void;
  /** Ngày xuất HĐ của tháng đang xem — dùng để xem trước "Tháng này: ...". */
  invoiceDate: Date | null;
  compact?: boolean;
}

export default function PaymentActualTermFields({ value, onChange, invoiceDate, compact }: Props) {
  const mode = value.payment_actual_mode ?? null;
  const preview = mode && invoiceDate ? calcExpectedDueActual(value, invoiceDate) : null;

  const pillCls = (active: boolean) =>
    `px-2.5 py-1 rounded-full text-[11.5px] font-medium border transition whitespace-nowrap ${active ? 'bg-[#F5F3FF] text-[#7C3AED] border-[#DDD6FE]' : 'bg-white text-[#888] border-[#E8E7E2] hover:border-[#ccc]'}`;

  return (
    <div className={compact ? 'space-y-2' : 'bg-[#F9F9F7] rounded-lg p-3 space-y-3'}>
      <div className="flex gap-1.5 flex-wrap">
        <button type="button" onClick={() => onChange({ payment_actual_mode: null })} className={pillCls(mode === null)}>Theo Kỳ TT Trên HĐ</button>
        <button type="button" onClick={() => onChange({ payment_actual_mode: 'days' })} className={pillCls(mode === 'days')}>Số ngày kể từ xuất HĐ</button>
        <button type="button" onClick={() => onChange({ payment_actual_mode: 'fixed' })} className={pillCls(mode === 'fixed')}>Ngày cố định trong tháng</button>
      </div>

      {mode === 'days' && (
        <div className="flex items-center gap-1.5">
          <input type="number" min={1} max={90} value={value.payment_actual_days ?? 15}
            onChange={e => onChange({ payment_actual_days: Math.max(1, Math.min(90, +e.target.value)) })}
            className="w-[70px] text-[13px] px-2.5 py-1.5 border border-gray-300 rounded-lg outline-none focus:border-[#7C3AED]" />
          <span className="text-[11px] text-[#888]">ngày lịch kể từ ngày xuất HĐ</span>
        </div>
      )}

      {mode === 'fixed' && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <div className="w-[110px]">
            <DayCell quick="eom" value={value.payment_actual_fixed_day ?? 10} onChange={v => onChange({ payment_actual_fixed_day: v ?? 10 })} />
          </div>
          <span className="text-[11px] text-[#888] whitespace-nowrap">chốt trước ngày</span>
          <input type="number" min={1} max={31} value={value.payment_actual_cutoff ?? 5}
            onChange={e => onChange({ payment_actual_cutoff: Math.max(1, Math.min(31, +e.target.value)) })}
            className="w-[52px] text-[13px] px-2 py-1.5 border border-gray-300 rounded-lg outline-none focus:border-[#7C3AED]" />
        </div>
      )}

      {preview && (
        <div className="text-[10.5px] text-[#7C3AED]">Tháng này: <strong>{preview.label}</strong></div>
      )}
      {mode === null && (
        <div className="text-[10.5px] text-[#aaa]">Chưa tuỳ chỉnh — đang dùng đúng số của Kỳ TT Trên HĐ.</div>
      )}
    </div>
  );
}
