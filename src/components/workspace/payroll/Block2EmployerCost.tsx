import { fmtVnd as formatCurrencyFull } from '../../../lib/payroll/format';
import { EMPLOYER_INSURANCE_RATE, UNION_FEE_RATE } from '../../../lib/payroll/coefficients';
import type { PayrollMatrixResult } from '../../../lib/payroll/reverseCalcEngine';

interface Props { result: PayrollMatrixResult; unionFeeEnabled: boolean }

export default function Block2EmployerCost({ result, unionFeeEnabled }: Props) {
  const { employee, employer } = result;
  return (
    <div className="space-y-3">
      <div className="bg-[#FBFAF7] border border-[#E8E7E2] rounded-lg p-3 space-y-2">
        <div>
          <div className="text-[12px] font-semibold text-[#333]">BHXH/BHYT/BHTN NSDLĐ đóng ({(EMPLOYER_INSURANCE_RATE * 100).toFixed(1)}%)</div>
          <div className="text-[11px] text-[#888] mt-0.5">
            {formatCurrencyFull(employer.employerInsurance)} = {formatCurrencyFull(employee.baseSalaryForBHXH)} × {(EMPLOYER_INSURANCE_RATE * 100).toFixed(1)}%
          </div>
        </div>
        {unionFeeEnabled && (
          <div>
            <div className="text-[12px] font-semibold text-[#333]">Kinh phí công đoàn ({(UNION_FEE_RATE * 100).toFixed(0)}%)</div>
            <div className="text-[11px] text-[#888] mt-0.5">
              {formatCurrencyFull(employer.unionFee)} = {formatCurrencyFull(employee.monthlyGrossNormal)} × {(UNION_FEE_RATE * 100).toFixed(0)}%
            </div>
          </div>
        )}
        <div className="pt-1.5 border-t border-[#E8E7E2]">
          <div className="text-[12px] font-semibold text-[#333]">Tổng Direct Labor Cost</div>
          <div className="text-[11px] text-[#888] mt-0.5">
            {formatCurrencyFull(employer.directLaborCost)} = {formatCurrencyFull(employee.monthlyGrossNormal)} (lương gross) + {formatCurrencyFull(employer.employerInsurance)} (BH NSDLĐ){unionFeeEnabled ? ` + ${formatCurrencyFull(employer.unionFee)} (KPCĐ)` : ''}
          </div>
          <div className="text-[15px] font-bold text-[#0c2340] mt-1">{formatCurrencyFull(employer.directLaborCost)}</div>
        </div>
      </div>
    </div>
  );
}
