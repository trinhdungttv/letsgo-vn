import { fmtVnd as formatCurrencyFull } from '../../../lib/payroll/format';
import type { PayrollMatrixResult } from '../../../lib/payroll/reverseCalcEngine';

interface Props { result: PayrollMatrixResult; vatRate: number }

export default function Block4ClientInvoice({ result, vatRate }: Props) {
  const { invoice, agency } = result;
  return (
    <div className="space-y-3">
      <div className="bg-[#FBFAF7] border border-[#E8E7E2] rounded-lg p-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[12px] text-[#666]">{agency.customerPriceMode ? 'Tổng trước VAT (= Giá khách trả trực tiếp)' : 'Tổng trước VAT (Direct Labor Cost + Phí dịch vụ)'}</span>
          <span className="text-[13px] font-semibold text-[#111]">{formatCurrencyFull(invoice.subtotal)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[12px] text-[#666]">VAT ({(vatRate * 100).toFixed(0)}%)</span>
          <span className="text-[13px] font-semibold text-[#111]">{formatCurrencyFull(invoice.vat)}</span>
        </div>
        <div className="flex items-center justify-between pt-1.5 border-t border-[#E8E7E2]">
          <span className="text-[12.5px] font-semibold text-[#333]">Tổng Invoice</span>
          <span className="text-[17px] font-bold text-blue-700">{formatCurrencyFull(invoice.total)}</span>
        </div>
      </div>
    </div>
  );
}
