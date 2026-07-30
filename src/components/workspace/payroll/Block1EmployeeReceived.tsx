import { Fragment } from 'react';
import { Plus, RotateCcw, Trash2 } from 'lucide-react';
import { fmtVnd as formatCurrencyFull } from '../../../lib/payroll/format';
import { INSURANCE_CAP_MULTIPLE, BASE_SALARY_FOR_CAP, EMPLOYEE_INSURANCE_RATE, type PayrollInputType } from '../../../lib/payroll/coefficients';
import type { PayrollMatrixResult } from '../../../lib/payroll/reverseCalcEngine';
import { sumAllowances, type AllowanceItem, type EffectiveRateRow } from '../../../lib/payroll/rateCard';

interface Props {
  result: PayrollMatrixResult;
  workingDaysPerMonth: number;
  inputType: PayrollInputType;
  /** Bảng đơn giá đã áp phần chỉnh tay — xem rateCard.applyRateOverrides. */
  rateRows: EffectiveRateRow[];
  rawOverrides: Partial<Record<PayrollInputType, string>>;
  onRateInput: (type: PayrollInputType, raw: string) => void;
  /** Mặt DOANH THU: đơn giá khách trả cho ta theo từng loại giờ (cùng đơn vị với cột chi phí). */
  clientRates: Partial<Record<PayrollInputType, string>>;
  onClientRateInput: (type: PayrollInputType, raw: string) => void;
  customerPriceMode: boolean;
  onEnableCustomerPriceMode: () => void;
  allowances: AllowanceItem[];
  /** Tên khoản gợi ý, lấy từ danh sách trường lương dùng chung bên Thị trường. */
  allowanceSuggestions: string[];
  onAddAllowance: () => void;
  onUpdateAllowance: (id: string, patch: Partial<AllowanceItem>) => void;
  onRemoveAllowance: (id: string) => void;
}

// Hiển thị % thay vì số thập phân (×1.3000) — dễ nhân nhẩm hơn khi tính tay: "nhân 130%".
function fmtCoefficientPct(coefficient: number): string {
  const pct = coefficient * 100;
  return (Number.isInteger(pct) ? pct.toFixed(0) : pct.toFixed(1)) + '%';
}

// 2 loại giờ này định nghĩa "lương tháng chuẩn" (nền tính BHXH) — sửa chúng thì cả ma trận tính
// lại; sửa OT/đêm chỉ đổi bảng đơn giá và số đem đồng bộ sang Thị trường. Xem rateCard.ts.
const DRIVES_MONTHLY = new Set<PayrollInputType>(['base_salary', 'day_wage_8h']);

// Cột "Lương Full" = tổng tiền cho TRỌN đơn vị của dòng đó (cả tháng / trọn ca 8h / trọn ca 12h
// / 1 giờ OT). Bằng đơn giá giờ × số giờ của đơn vị — cũng chính là basisHours, TRỪ 2 dòng "Ca 12
// tiếng": basisHours của chúng là 1 vì hệ số đã là đơn giá BÌNH QUÂN/giờ trong suốt ca (xem
// SHIFT_12H_DAY/NIGHT ở coefficients.ts), nên phải nhân lại đúng 12h mới ra tiền trọn ca.
function fullHoursOf(row: EffectiveRateRow): number {
  if (row.type === 'shift12_day' || row.type === 'shift12_night') return 12;
  return row.basisHours;
}

// Gom các loại giờ cùng bản chất vào 1 nhóm — bảng 15 dòng phẳng rất khó dò, nhất là khi các cặp
// ngày/đêm và thường/Chủ nhật/Lễ Tết đan xen nhau.
const RATE_GROUPS: { label: string; hint: string; types: PayrollInputType[]; headCls: string }[] = [
  {
    label: 'Lương cơ bản', hint: 'nền tính BHXH & lương tối thiểu vùng',
    types: ['base_salary'], headCls: 'bg-slate-100 text-slate-700',
  },
  {
    label: 'Lương trọn ca 8 tiếng', hint: 'đi làm đủ 1 ca — ngày thường, Chủ nhật, Lễ Tết',
    types: ['day_wage_8h', 'night_wage_8h', 'sunday_day_wage_8h', 'sunday_night_wage_8h', 'holiday_wage_8h'],
    headCls: 'bg-blue-100/70 text-blue-800',
  },
  {
    label: 'Tăng ca (OT) — tính lẻ theo giờ', hint: 'phần làm thêm ngoài ca chuẩn',
    types: ['ot_day_weekday', 'ot_night_weekday', 'ot_day_sunday', 'ot_night_sunday', 'ot_day_holiday', 'ot_night_holiday'],
    headCls: 'bg-amber-100/70 text-amber-800',
  },
  {
    label: 'Ca 12 tiếng', hint: '8h định mức + 4h OT, hệ số là đơn giá bình quân/giờ cả ca',
    types: ['shift12_day', 'shift12_night'], headCls: 'bg-violet-100/70 text-violet-800',
  },
];

export default function Block1EmployeeReceived({
  result, workingDaysPerMonth, inputType, rateRows, rawOverrides, onRateInput,
  clientRates, onClientRateInput, customerPriceMode, onEnableCustomerPriceMode,
  allowances, allowanceSuggestions, onAddAllowance, onUpdateAllowance, onRemoveAllowance,
}: Props) {
  const { employee } = result;
  const cap = INSURANCE_CAP_MULTIPLE * BASE_SALARY_FOR_CAP;
  const isCapped = employee.monthlyGrossNormal > cap;
  const workerAllowance = sumAllowances(allowances, 'worker');
  const clientAllowance = sumAllowances(allowances, 'client');
  const anyOverride = rateRows.some(r => r.overridden);
  const anyClientRate = Object.values(clientRates).some(v => (parseFloat(v ?? '') || 0) > 0);
  const groupedTypes = new Set(RATE_GROUPS.flatMap(g => g.types));
  const ungroupedRows = rateRows.filter(r => !groupedTypes.has(r.type));

  const renderRateRow = (row: EffectiveRateRow) => (
    <tr key={row.type} className={`border-t border-[#F0EFEB] ${row.type === inputType ? 'bg-blue-50' : ''}`}>
      <td className="px-2.5 py-1 pl-4 text-[#333]">
        {row.label}
        {row.type === inputType && <span className="ml-1 text-[10px] text-blue-600 font-semibold">(đã nhập)</span>}
        {row.overridden && DRIVES_MONTHLY.has(row.type) && <span className="ml-1 text-[10px] text-amber-600 font-semibold">(tính lại cả bảng)</span>}
      </td>
      <td className="px-2.5 py-1 text-right text-[#666]">{fmtCoefficientPct(row.coefficient)}</td>
      <td className="px-2.5 py-1 text-right text-[#888]">{formatCurrencyFull(row.effectiveHourly)}</td>
      <td className="px-2.5 py-1 text-right font-medium text-[#333]">{formatCurrencyFull(row.effectiveHourly * fullHoursOf(row))}</td>
      <td className="px-2.5 py-1 text-right bg-blue-50/40">
        <div className="flex items-center justify-end gap-1">
          <input
            type="number" min={0} step={1000}
            value={rawOverrides[row.type] ?? ''}
            onChange={e => onRateInput(row.type, e.target.value)}
            placeholder={String(Math.round(row.naturalRate))}
            className={`w-24 text-[11.5px] px-1.5 py-1 border rounded-md outline-none text-right focus:border-blue-500 ${row.overridden ? 'border-amber-300 bg-amber-50 font-semibold text-[#111]' : 'border-gray-200 bg-white text-[#111]'}`}
          />
          <span className="text-[9.5px] text-[#aaa] w-[70px] text-left leading-tight">{row.unitLabel}</span>
        </div>
      </td>
      <td className="px-2.5 py-1 text-right bg-emerald-50/40">
        <input
          type="number" min={0} step={1000}
          value={clientRates[row.type] ?? ''}
          onChange={e => onClientRateInput(row.type, e.target.value)}
          placeholder="—"
          title={`Khách trả ta bao nhiêu cho khoản này (${row.unitLabel})`}
          className="w-24 text-[11.5px] px-1.5 py-1 border border-gray-200 bg-white rounded-md outline-none text-right focus:border-emerald-500 text-[#111]"
        />
      </td>
      <td className="px-2.5 py-1 text-right bg-emerald-50/40">
        {(() => {
          const client = parseFloat(clientRates[row.type] ?? '') || 0;
          if (client <= 0) return <span className="text-[#ccc]">—</span>;
          const gap = client - row.effectiveNatural;
          return (
            <span className={`font-semibold ${gap > 0 ? 'text-emerald-700' : gap < 0 ? 'text-red-600' : 'text-[#888]'}`}>
              {gap > 0 ? '+' : ''}{formatCurrencyFull(gap)}
            </span>
          );
        })()}
      </td>
      <td className="px-1 py-1">
        {row.overridden && (
          <button onClick={() => onRateInput(row.type, '')} title="Bỏ số đã sửa, quay lại số tính theo luật"
            className="text-gray-400 hover:text-blue-600"><RotateCcw size={12} /></button>
        )}
      </td>
    </tr>
  );

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-baseline justify-between mb-1.5 gap-2 flex-wrap">
          <div className="text-[12px] font-semibold text-[#333]">Bảng đơn giá quy đổi theo loại giờ</div>
          <div className="text-[10.5px] text-[#999]">Cột xanh dương = ta/NCC trả NLĐ (chi phí) · cột xanh lá = khách trả ta (doanh thu)</div>
        </div>
        <div className="border border-[#E8E7E2] rounded-lg overflow-x-auto">
          <table className="w-full text-[11.5px] min-w-[820px]">
            <thead className="bg-[#F9F9F7] text-[#888]">
              <tr>
                <th rowSpan={2} className="text-left px-2.5 py-1.5 font-medium align-bottom">Loại giờ</th>
                <th colSpan={3} className="text-center px-2.5 py-1 font-medium border-b border-[#E8E7E2]">Tính theo luật</th>
                <th className="text-center px-2.5 py-1 font-semibold border-b border-l border-[#E8E7E2] bg-blue-100/60 text-blue-800">CHI PHÍ — ta/NCC trả NLĐ</th>
                <th colSpan={2} className="text-center px-2.5 py-1 font-semibold border-b border-l border-[#E8E7E2] bg-emerald-100/60 text-emerald-800">DOANH THU — khách trả ta</th>
                <th rowSpan={2} className="px-1 py-1.5"></th>
              </tr>
              <tr>
                <th className="text-right px-2.5 py-1.5 font-medium">Nhân với (%)</th>
                <th className="text-right px-2.5 py-1.5 font-medium">Quy ra đ/giờ</th>
                <th className="text-right px-2.5 py-1.5 font-medium" title="Tổng tiền cho trọn đơn vị của dòng đó: cả tháng / trọn ca 8h / trọn ca 12h / 1 giờ OT">Lương Full</th>
                <th className="text-right px-2.5 py-1.5 font-medium border-l border-[#E8E7E2] bg-blue-50/60">Đơn giá dùng thật</th>
                <th className="text-right px-2.5 py-1.5 font-medium border-l border-[#E8E7E2] bg-emerald-50/60">Khách trả ta</th>
                <th className="text-right px-2.5 py-1.5 font-medium bg-emerald-50/60" title="Khách trả ta − ta trả NLĐ. Dương = lời, âm = lỗ.">Chênh lệch</th>
              </tr>
            </thead>
            <tbody>
              {RATE_GROUPS.map(group => {
                const groupRows = rateRows.filter(r => group.types.includes(r.type));
                if (groupRows.length === 0) return null;
                return (
                  <Fragment key={group.label}>
                    <tr>
                      <td colSpan={8} className={`px-2.5 py-1 border-t border-[#E8E7E2] ${group.headCls}`}>
                        <span className="text-[10.5px] font-semibold uppercase tracking-wide">{group.label}</span>
                        <span className="ml-1.5 text-[10px] font-normal opacity-70">· {group.hint}</span>
                      </td>
                    </tr>
                    {groupRows.map(renderRateRow)}
                  </Fragment>
                );
              })}
              {/* Loại giờ mới thêm sau này mà chưa xếp vào nhóm nào — vẫn hiện, không bị mất khỏi bảng. */}
              {ungroupedRows.length > 0 && (
                <Fragment>
                  <tr>
                    <td colSpan={8} className="px-2.5 py-1 border-t border-[#E8E7E2] bg-[#F1F0EC] text-[#666]">
                      <span className="text-[10.5px] font-semibold uppercase tracking-wide">Khác</span>
                    </td>
                  </tr>
                  {ungroupedRows.map(renderRateRow)}
                </Fragment>
              )}
            </tbody>
          </table>
        </div>
        {anyOverride && (
          <div className="text-[10.5px] text-amber-700 mt-1">
            Có đơn giá đã sửa tay — số này (không phải số theo luật) là số được lưu và đồng bộ sang bảng lương NCC ở Thị trường.
          </div>
        )}
        {anyClientRate && !customerPriceMode && (
          <div className="flex items-start gap-2 mt-1.5 bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-2">
            <span className="text-[11px] text-emerald-800 flex-1">
              Đã có đơn giá khách trả — bật chế độ tính theo giá khách trả để xem lãi/lỗ cả tháng ở khối "Doanh thu Agency".
            </span>
            <button type="button" onClick={onEnableCustomerPriceMode}
              className="shrink-0 text-[11px] font-medium text-emerald-700 hover:underline whitespace-nowrap">Bật ngay</button>
          </div>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <div className="text-[12px] font-semibold text-[#333]">Phụ cấp / khoản thêm</div>
          <button type="button" onClick={onAddAllowance} className="flex items-center gap-0.5 text-[11px] text-blue-600 hover:underline">
            <Plus size={12} /> Thêm khoản
          </button>
        </div>
        <div className="text-[10.5px] text-[#999] mb-1.5">
          Mỗi khoản có 2 mặt: <b>khách trả ta</b> (doanh thu) và <b>ta trả NLĐ</b> (chi phí). Trả toàn phần thì 2 ô bằng nhau;
          khách trả nhiều hơn phần ta chi ra thì chênh lệch chính là tiền công ty giữ lại.
        </div>
        {allowances.length === 0 ? (
          <div className="text-[11px] text-gray-400 border border-dashed border-gray-300 rounded-lg py-2.5 text-center">Chưa có khoản phụ cấp nào</div>
        ) : (
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-[9.5px] text-[#999] font-medium">
              <span className="flex-1 min-w-0">Tên khoản</span>
              <span className="w-24 shrink-0 text-right text-emerald-700">Khách trả ta</span>
              <span className="w-24 shrink-0 text-right text-blue-700">Ta trả NLĐ</span>
              <span className="w-20 shrink-0 text-right">Giữ lại</span>
              <span className="w-[13px] shrink-0" />
            </div>
            {allowances.map(item => {
              const kept = (parseFloat(item.amountClient) || 0) - (parseFloat(item.amountWorker) || 0);
              return (
                <div key={item.id} className="flex items-center gap-1.5">
                  <input list="payroll-allowance-names" value={item.label} onChange={e => onUpdateAllowance(item.id, { label: e.target.value })}
                    placeholder="Tên khoản (vd: Ăn ca)"
                    className="flex-1 min-w-0 text-[11.5px] px-2 py-1 border border-gray-300 rounded-md outline-none focus:border-blue-500" />
                  <input type="number" min={0} step={1000} value={item.amountClient} onChange={e => onUpdateAllowance(item.id, { amountClient: e.target.value })}
                    placeholder="đ/tháng" title="Khách trả ta khoản này bao nhiêu/tháng"
                    className="w-24 shrink-0 text-[11.5px] px-2 py-1 border border-gray-300 rounded-md outline-none focus:border-emerald-500 text-right bg-emerald-50/40" />
                  <input type="number" min={0} step={1000} value={item.amountWorker} onChange={e => onUpdateAllowance(item.id, { amountWorker: e.target.value })}
                    placeholder="đ/tháng" title="Ta thực trả cho NLĐ bao nhiêu/tháng"
                    className="w-24 shrink-0 text-[11.5px] px-2 py-1 border border-gray-300 rounded-md outline-none focus:border-blue-500 text-right bg-blue-50/40" />
                  <span className={`w-20 shrink-0 text-right text-[11px] font-semibold ${kept > 0 ? 'text-emerald-700' : kept < 0 ? 'text-red-600' : 'text-[#bbb]'}`}>
                    {kept === 0 ? '—' : `${kept > 0 ? '+' : ''}${formatCurrencyFull(kept)}`}
                  </span>
                  <button type="button" onClick={() => onRemoveAllowance(item.id)} className="shrink-0 text-gray-400 hover:text-red-500"><Trash2 size={13} /></button>
                </div>
              );
            })}
            <div className="flex items-center gap-1.5 pt-1 border-t border-[#F0EFEB] text-[11px] font-semibold">
              <span className="flex-1 min-w-0 text-[#666]">Tổng</span>
              <span className="w-24 shrink-0 text-right text-emerald-700">{formatCurrencyFull(clientAllowance)}</span>
              <span className="w-24 shrink-0 text-right text-blue-700">{formatCurrencyFull(workerAllowance)}</span>
              <span className={`w-20 shrink-0 text-right ${clientAllowance - workerAllowance > 0 ? 'text-emerald-700' : clientAllowance - workerAllowance < 0 ? 'text-red-600' : 'text-[#bbb]'}`}>
                {clientAllowance - workerAllowance === 0 ? '—' : formatCurrencyFull(clientAllowance - workerAllowance)}
              </span>
              <span className="w-[13px] shrink-0" />
            </div>
          </div>
        )}
        <datalist id="payroll-allowance-names">
          {allowanceSuggestions.map(n => <option key={n} value={n} />)}
        </datalist>
      </div>

      <div className="bg-[#FBFAF7] border border-[#E8E7E2] rounded-lg p-3 space-y-2">
        <div>
          <div className="text-[12px] font-semibold text-[#333]">Lương tháng cơ bản (chuẩn, không OT)</div>
          <div className="text-[11px] text-[#888] mt-0.5">
            {formatCurrencyFull(employee.monthlyGrossNormal)} = {formatCurrencyFull(result.shr)} (SHR) × 1.00 × 8h × {workingDaysPerMonth} ngày
          </div>
        </div>
        <div>
          <div className="text-[12px] font-semibold text-[#333]">
            Trừ BHXH/BHYT/BHTN NLĐ ({(EMPLOYEE_INSURANCE_RATE * 100).toFixed(1)}%)
          </div>
          <div className="text-[11px] text-[#888] mt-0.5">
            {formatCurrencyFull(employee.employeeInsurance)} = {formatCurrencyFull(employee.baseSalaryForBHXH)}{isCapped ? ' (đã chặn trần)' : ''} × {(EMPLOYEE_INSURANCE_RATE * 100).toFixed(1)}%
          </div>
          {isCapped && <div className="text-[10.5px] text-amber-700 mt-0.5">Lương vượt trần đóng BHXH ({formatCurrencyFull(cap)} = 20 lần lương cơ sở) — phần vượt không tính thêm bảo hiểm.</div>}
        </div>
        <div className="pt-1.5 border-t border-[#E8E7E2]">
          <div className="text-[12px] font-semibold text-[#333]">Net ước tính / tháng</div>
          <div className="text-[15px] font-bold text-emerald-700 mt-0.5">{formatCurrencyFull(employee.netEstimate + workerAllowance)}</div>
          <div className="text-[10.5px] text-[#aaa] mt-0.5">
            {workerAllowance > 0 && <>Gồm {formatCurrencyFull(workerAllowance)} phụ cấp NLĐ nhận. </>}
            Chỉ trừ BHXH/BHYT/BHTN — chưa trừ thuế TNCN luỹ tiến (cần biểu thuế đầy đủ mới tính chính xác).
          </div>
        </div>
      </div>

      {employee.otTaxNote && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
          <div className="text-[12px] font-semibold text-amber-800">Minh hoạ phần OT miễn thuế TNCN (mỗi giờ)</div>
          <div className="text-[11px] text-amber-700 mt-1 space-y-0.5">
            <div>Phần chịu thuế: {formatCurrencyFull(employee.otTaxNote.taxablePerHour)}/giờ (tương đương giờ làm việc bình thường)</div>
            <div>Phần miễn thuế: {formatCurrencyFull(employee.otTaxNote.exemptPerHour)}/giờ (phần trả cao hơn — Điều 12 TT 111/2013/TT-BTC)</div>
          </div>
        </div>
      )}
    </div>
  );
}
