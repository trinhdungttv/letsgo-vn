// "Mức lương đóng BHXH" — căn cứ tính BHXH 21,5% và công đoàn 2%.
// Đa số dự án đóng theo LƯƠNG TỐI THIỂU VÙNG của KCN (mặc định phương án mới); dự án nào cho phép thì đóng mức cao hơn;
// "Theo lương trả NLĐ" là cách tính cũ (lương cơ bản + các khoản bật "Tính vào lương đóng BHXH").
import type { InsuranceBaseMode, PlanData, PlanResult, PlanSettings } from '../../../lib/costPlan/types';
import { MoneyInput, fmt } from './fields';
import { Seg, btnLink, card, field } from './ui';

export default function InsuranceBase({ data, result, minWage, readOnly, onSettings, compact }: {
  data: PlanData; result: PlanResult;
  /** Lương tối thiểu vùng của KCN đang chọn */
  minWage?: { monthly: number; label: string } | null;
  readOnly?: boolean;
  onSettings: (p: Partial<PlanSettings>) => void;
  /** Dạng gọn để đặt trong thẻ khác (không viền thẻ riêng) */
  compact?: boolean;
}) {
  const s = data.settings;
  const mode: InsuranceBaseMode = s.insuranceBase ?? 'wage';
  const used = result.insuranceBaseUsed;
  // Các khoản tính % trên lương đóng BHXH (BHXH 21,5%, công đoàn 2%…)
  const insLines = data.lines.filter(l => !l.isServiceFee && l.mode === 'percent' && (l.base ?? 'base_wage') === 'insurable');
  const monthly = insLines.reduce((a, l) => a + (result.lines[l.id]?.monthly ?? 0), 0);
  const daily = insLines.reduce((a, l) => a + (result.lines[l.id]?.daily ?? 0), 0);
  const regionLabel = minWage ? `Tối thiểu ${minWage.label}` : 'Tối thiểu vùng';

  const pick = (v: InsuranceBaseMode) => {
    if (v === 'custom' && !s.insuranceSalary) onSettings({ insuranceBase: v, insuranceSalary: Math.round(minWage?.monthly ?? result.insuranceSalaryMonthly) });
    else onSettings({ insuranceBase: v });
  };

  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className={`${compact ? 'text-[13px]' : 'text-[14px]'} font-semibold text-[#1d1d1f]`}>Mức lương đóng BHXH</div>
          <div className="text-[12px] text-[#86868b] leading-snug">
            {insLines.length ? <>BHXH, công đoàn tính trên mức này: <b className="text-[#1d1d1f] tabular-nums">{fmt(monthly)} đ/tháng</b> · {fmt(daily)} đ/công</> : 'Chưa có khoản BHXH / công đoàn ở bảng chi phí.'}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[18px] leading-tight font-semibold tabular-nums text-[#0a7d6e]">{fmt(result.insuranceSalaryMonthly)}</div>
          <div className="text-[11px] text-[#86868b]">đ / tháng</div>
        </div>
      </div>
      <div className="mt-2.5 max-w-[460px]">
        <Seg value={mode} disabled={readOnly} onChange={pick}
          options={[{ value: 'region', label: regionLabel }, { value: 'custom', label: 'Mức cao hơn' }, { value: 'wage', label: 'Theo lương trả NLĐ' }]} />
      </div>
      {mode === 'custom' && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <MoneyInput value={s.insuranceSalary ?? 0} disabled={readOnly} onChange={n => onSettings({ insuranceSalary: n })}
            className={`${field} w-40 text-right font-semibold`} />
          <span className="text-[12px] text-[#86868b]">đ/tháng — dự án cho phép đóng cao hơn{minWage ? ` (tối thiểu ${minWage.label}: ${fmt(minWage.monthly)})` : ''}</span>
        </div>
      )}
      {(mode === 'region' || mode === 'custom') && used === 'wage' && (
        <div className="mt-2 text-[12px] text-[#8a5a00]">Chưa chọn KCN nên chưa biết lương tối thiểu vùng — đang tạm tính theo lương trả người lao động.</div>
      )}
      {mode === 'region' && used === 'region' && minWage && (
        <div className="mt-2 text-[12px] text-[#86868b]">Lấy theo KCN đã chọn: {minWage.label} = {fmt(minWage.monthly)} đ/tháng. Đổi KCN thì mức này tự đổi theo.</div>
      )}
      {mode === 'wage' && (
        <div className="mt-2 text-[12px] text-[#86868b] leading-snug">
          = Lương cơ bản + các khoản bật “Tính vào lương đóng BHXH”.
          {minWage && !readOnly && <> Phần lớn dự án đóng theo tối thiểu vùng — <button type="button" onClick={() => pick('region')} className={btnLink + ' !text-[12px]'}>chuyển sang {regionLabel.toLowerCase()} ({fmt(minWage.monthly)})</button></>}
        </div>
      )}
    </>
  );
  return compact ? <div className="mt-3 pt-3 border-t border-[#f0f0f2]">{body}</div> : <div className={`${card} p-5`}>{body}</div>;
}
