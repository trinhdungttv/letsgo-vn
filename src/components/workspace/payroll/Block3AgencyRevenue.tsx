import { fmtVnd as formatCurrencyFull } from '../../../lib/payroll/format';
import { SERVICE_FEE_LABELS, type PayrollMatrixResult, type ServiceFeeType } from '../../../lib/payroll/reverseCalcEngine';

interface Props {
  result: PayrollMatrixResult; serviceFeeType: ServiceFeeType; serviceFeeValue: number; workingDaysPerMonth: number; standardHoursPerMonth: number;
  customerPriceValue?: number; customerExtraFeesTotal?: number; customerExtraFeesPassThrough?: number;
  // Sửa thẳng tại khối kết quả, khỏi phải cuộn ngược lên form nhập.
  rawCustomerPrice: string;
  onCustomerPriceChange: (raw: string) => void;
  rawServiceFeeValue: string;
  onServiceFeeValueChange: (raw: string) => void;
}

const inputCls = 'w-32 text-[12px] px-2 py-1 border border-gray-300 rounded-md outline-none focus:border-blue-500 text-right';

export default function Block3AgencyRevenue({
  result, serviceFeeType, serviceFeeValue, workingDaysPerMonth, standardHoursPerMonth,
  customerPriceValue = 0, customerExtraFeesTotal = 0, customerExtraFeesPassThrough = 0,
  rawCustomerPrice, onCustomerPriceChange, rawServiceFeeValue, onServiceFeeValueChange,
}: Props) {
  const { agency } = result;
  const isLoss = agency.customerPriceMode && agency.serviceFee < 0;
  const dayBasedRevenue = customerPriceValue * workingDaysPerMonth;
  // Con số hay được hỏi nhất khi đi chào giá: quy phí dịch vụ cả tháng về 1 ngày công.
  const feePerDay = workingDaysPerMonth > 0 ? agency.serviceFee / workingDaysPerMonth : 0;

  if (agency.customerPriceMode) {
    return (
      <div className="space-y-3">
        <div className="bg-[#FBFAF7] border border-[#E8E7E2] rounded-lg p-3 space-y-2">
          <div>
            <div className="flex items-center justify-between gap-2">
              <div className="text-[12px] font-semibold text-[#333]">Giá khách trả (đ/ngày công)</div>
              <input type="number" min={0} step={1000} value={rawCustomerPrice} onChange={e => onCustomerPriceChange(e.target.value)} placeholder="0" className={inputCls} />
            </div>
            <div className="text-[11px] text-[#888] mt-1 space-y-0.5">
              <div>{formatCurrencyFull(dayBasedRevenue)} (theo ngày công) = {formatCurrencyFull(customerPriceValue)}/ngày × {workingDaysPerMonth} ngày</div>
              {customerExtraFeesTotal > 0 && (
                <div>+ {formatCurrencyFull(customerExtraFeesTotal)} (phụ cấp/phụ phí đi kèm{customerExtraFeesPassThrough > 0 ? `, trong đó ${formatCurrencyFull(customerExtraFeesPassThrough)} về tay NLĐ` : ''})</div>
              )}
            </div>
            <div className="text-[15px] font-bold text-[#0c2340] mt-1">{formatCurrencyFull(agency.customerRevenue ?? 0)}</div>
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2 text-[11px] text-amber-700">{agency.durationNote}</div>
          <div className="pt-1.5 border-t border-[#E8E7E2]">
            <div className="text-[12px] font-semibold text-[#333]">{isLoss ? 'Đang lỗ (Giá khách trả thấp hơn chi phí)' : 'Còn dư (Margin thực) sau khi trả NLĐ + bảo hiểm + phụ cấp trả NLĐ'}</div>
            <div className="text-[11px] text-[#888] mt-0.5">Giá khách trả − Direct Labor Cost − Phụ cấp về tay NLĐ</div>
            <div className={`text-[15px] font-bold mt-1 ${isLoss ? 'text-red-700' : 'text-emerald-700'}`}>{formatCurrencyFull(agency.serviceFee)}</div>
            <div className={`text-[12px] font-semibold mt-0.5 ${isLoss ? 'text-red-700' : 'text-emerald-700'}`}>
              ≈ {formatCurrencyFull(feePerDay)} / ngày công
            </div>
          </div>
          <div className="pt-1.5 border-t border-[#E8E7E2]">
            <div className="text-[12px] font-semibold text-[#333]">Biên lợi nhuận ước tính</div>
            <div className={`text-[15px] font-bold mt-1 ${isLoss ? 'text-red-700' : 'text-emerald-700'}`}>{(agency.grossMargin * 100).toFixed(1)}%</div>
          </div>
        </div>
      </div>
    );
  }

  const formula = serviceFeeType === 'referral_hourly'
    ? `${formatCurrencyFull(agency.serviceFee)} = ${formatCurrencyFull(serviceFeeValue)}/giờ × ${standardHoursPerMonth}h`
    : `${formatCurrencyFull(agency.serviceFee)} = ${formatCurrencyFull(serviceFeeValue)}/ngày × ${workingDaysPerMonth} ngày`;

  return (
    <div className="space-y-3">
      <div className="bg-[#FBFAF7] border border-[#E8E7E2] rounded-lg p-3 space-y-2">
        <div>
          <div className="flex items-center justify-between gap-2">
            <div className="text-[12px] font-semibold text-[#333]">
              Phí dịch vụ — {SERVICE_FEE_LABELS[serviceFeeType]}
              <span className="font-normal text-[#999]"> ({serviceFeeType === 'referral_hourly' ? 'đ/giờ' : 'đ/ngày'})</span>
            </div>
            <input type="number" min={0} step={1000} value={rawServiceFeeValue} onChange={e => onServiceFeeValueChange(e.target.value)} placeholder="0" className={inputCls} />
          </div>
          <div className="text-[11px] text-[#888] mt-1">{formula}</div>
          <div className="text-[15px] font-bold text-[#0c2340] mt-1">{formatCurrencyFull(agency.serviceFee)}</div>
          <div className="text-[12px] font-semibold text-[#0c2340] mt-0.5">≈ {formatCurrencyFull(feePerDay)} / ngày công</div>
        </div>
        {agency.durationNote && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2 text-[11px] text-amber-700">{agency.durationNote}</div>
        )}
        <div className="pt-1.5 border-t border-[#E8E7E2]">
          <div className="text-[12px] font-semibold text-[#333]">Biên lợi nhuận gộp ước tính</div>
          <div className="text-[11px] text-[#888] mt-0.5">Phí dịch vụ / (Direct Labor Cost + Phí dịch vụ)</div>
          <div className="text-[15px] font-bold text-emerald-700 mt-1">{(agency.grossMargin * 100).toFixed(1)}%</div>
        </div>
      </div>
    </div>
  );
}
