import { describe, expect, it } from 'vitest';
import { computePayrollMatrix, type PayrollMatrixInput } from './reverseCalcEngine';
import { checkCompliance } from './complianceGuard';
import { computeNightOTCoefficient, SHIFT_12H_NIGHT } from './coefficients';

const baseInput: PayrollMatrixInput = {
  inputType: 'base_salary',
  inputValue: 0,
  priorDayOt: false,
  region: 'II',
  regionMinWage: 4_730_000,
  workingDaysPerMonth: 26,
  serviceFeeType: 'per_day_worked',
  serviceFeeValue: 50_000,
  vatRate: 0.08,
};

describe('computePayrollMatrix', () => {
  it('1. Lương căn bản 4.960.000đ, Vùng II → SHR đúng, không cảnh báo', () => {
    const result = computePayrollMatrix({ ...baseInput, inputType: 'base_salary', inputValue: 4_960_000, region: 'II', regionMinWage: 4_730_000 });
    expect(result.shr).toBeCloseTo(4_960_000 / (26 * 8), 4);
    expect(result.employee.monthlyGrossNormal).toBeCloseTo(4_960_000, 4);
    expect(result.compliance.belowRegionMinWage).toBe(false);
  });

  it('2. Ca 12h đêm 350.000đ → SHR suy ngược đúng bằng công thức SHIFT_12H_NIGHT', () => {
    const result = computePayrollMatrix({ ...baseInput, inputType: 'shift12_night', inputValue: 350_000 });
    expect(result.shr).toBeCloseTo(350_000 / SHIFT_12H_NIGHT, 6);
  });

  it('3. Lương tháng suy ra thấp hơn lương tối thiểu Vùng I → cảnh báo compliance (đỏ, chặn lưu)', () => {
    const result = computePayrollMatrix({ ...baseInput, inputType: 'base_salary', inputValue: 4_000_000, region: 'I', regionMinWage: 5_310_000 });
    expect(result.compliance.belowRegionMinWage).toBe(true);
    const banners = checkCompliance(result, 'I', 5_310_000);
    expect(banners).toHaveLength(1);
    expect(banners[0].level).toBe('red');
    expect(banners[0].blocksSave).toBe(true);
  });

  it('4. computeNightOTCoefficient(1.5, false/true) đúng 2.00 / 2.10', () => {
    expect(computeNightOTCoefficient(1.5, false)).toBeCloseTo(2.00, 6);
    expect(computeNightOTCoefficient(1.5, true)).toBeCloseTo(2.10, 6);
  });

  it('5. computeNightOTCoefficient(3.0, false) đúng 3.90 (300%+30%+60%)', () => {
    expect(computeNightOTCoefficient(3.0, false)).toBeCloseTo(3.90, 6);
  });

  it('6. Doanh thu Agency: phí theo ngày công = đơn giá/ngày × ngày công/tháng, invoice cộng đúng VAT', () => {
    const result = computePayrollMatrix({
      ...baseInput, inputType: 'base_salary', inputValue: 5_000_000, workingDaysPerMonth: 26,
      serviceFeeType: 'per_day_worked', serviceFeeValue: 50_000, vatRate: 0.08,
    });
    expect(result.agency.serviceFee).toBeCloseTo(50_000 * 26, 4);
    expect(result.invoice.subtotal).toBeCloseTo(result.employer.directLaborCost + 50_000 * 26, 4);
    expect(result.invoice.vat).toBeCloseTo(result.invoice.subtotal * 0.08, 4);
    expect(result.invoice.total).toBeCloseTo(result.invoice.subtotal * 1.08, 4);
  });

  it('8. Phí giới thiệu theo ngày có thời hạn: hết N tháng thì không còn nguồn thu (ghi rõ trong durationNote)', () => {
    const result = computePayrollMatrix({
      ...baseInput, inputType: 'base_salary', inputValue: 5_000_000, workingDaysPerMonth: 26,
      serviceFeeType: 'referral_daily_limited', serviceFeeValue: 30_000, referralMonths: 4, vatRate: 0.08,
    });
    expect(result.agency.serviceFee).toBeCloseTo(30_000 * 26, 4);
    expect(result.agency.durationNote).toMatch(/4 tháng/);
  });

  it('9. Phí giới thiệu theo giờ, thu 1 lần: đơn giá/giờ × tổng giờ chuẩn/tháng, durationNote báo rõ không lặp lại', () => {
    const result = computePayrollMatrix({
      ...baseInput, inputType: 'base_salary', inputValue: 5_000_000, workingDaysPerMonth: 26,
      serviceFeeType: 'referral_hourly', serviceFeeValue: 5_000, referralDurationMode: 'one_time', vatRate: 0.08,
    });
    expect(result.agency.serviceFee).toBeCloseTo(5_000 * 26 * 8, 4);
    expect(result.agency.durationNote).toMatch(/1 LẦN/);
  });

  it('7. Trần đóng BHXH: lương rất cao vẫn bị chặn ở 20 lần lương cơ sở', () => {
    const result = computePayrollMatrix({ ...baseInput, inputType: 'base_salary', inputValue: 200_000_000, region: 'I', regionMinWage: 5_310_000 });
    expect(result.employee.baseSalaryForBHXH).toBeCloseTo(20 * 2_340_000, 4);
  });

  it('10. Lương ngày (8 tiếng) 250.000đ → SHR = 250.000 / 8 (đơn vị 1 ngày công, không phải giờ)', () => {
    const result = computePayrollMatrix({ ...baseInput, inputType: 'day_wage_8h', inputValue: 250_000 });
    expect(result.shr).toBeCloseTo(250_000 / 8, 4);
    expect(result.employee.otTaxNote).toBeNull();
  });

  it('11. Lương đêm (8 tiếng) 320.000đ → SHR = 320.000 / (1.30 × 8), có otTaxNote (30% đêm miễn thuế)', () => {
    const result = computePayrollMatrix({ ...baseInput, inputType: 'night_wage_8h', inputValue: 320_000 });
    expect(result.shr).toBeCloseTo(320_000 / (1.30 * 8), 4);
    expect(result.employee.otTaxNote).not.toBeNull();
  });

  it('12. Lương ngày Lễ, Tết (8 tiếng) 900.000đ → SHR = 900.000 / (3.00 × 8)', () => {
    const result = computePayrollMatrix({ ...baseInput, inputType: 'holiday_wage_8h', inputValue: 900_000 });
    expect(result.shr).toBeCloseTo(900_000 / (3.00 * 8), 4);
  });

  it('13. Chế độ nhập giá khách trả trực tiếp: margin = giá khách trả - Direct Labor Cost (dương → còn dư)', () => {
    const result = computePayrollMatrix({
      ...baseInput, inputType: 'base_salary', inputValue: 5_000_000, workingDaysPerMonth: 26,
      customerPriceMode: true, customerPriceValue: 400_000,
    });
    expect(result.agency.customerPriceMode).toBe(true);
    expect(result.agency.customerRevenue).toBeCloseTo(400_000 * 26, 4);
    expect(result.agency.serviceFee).toBeCloseTo(400_000 * 26 - result.employer.directLaborCost, 4);
    expect(result.invoice.subtotal).toBeCloseTo(400_000 * 26, 4);
    const banners = checkCompliance(result, 'II', 4_730_000);
    expect(banners.some(b => b.level === 'amber')).toBe(false);
  });

  it('14. Chế độ nhập giá khách trả trực tiếp: giá khách trả thấp hơn chi phí → cảnh báo LỖ (vàng, không chặn lưu)', () => {
    const result = computePayrollMatrix({
      ...baseInput, inputType: 'base_salary', inputValue: 10_000_000, workingDaysPerMonth: 26,
      customerPriceMode: true, customerPriceValue: 100_000,
    });
    expect(result.agency.serviceFee).toBeLessThan(0);
    const banners = checkCompliance(result, 'II', 4_730_000);
    const lossBanner = banners.find(b => b.level === 'amber');
    expect(lossBanner).toBeDefined();
    expect(lossBanner?.blocksSave).toBe(false);
  });

  it('15. Phí giới thiệu theo giờ với feeHoursPerDay tuỳ chỉnh (vd 10 thay vì mặc định 8)', () => {
    const result = computePayrollMatrix({
      ...baseInput, inputType: 'base_salary', inputValue: 5_000_000, workingDaysPerMonth: 26,
      serviceFeeType: 'referral_hourly', serviceFeeValue: 5_000, referralDurationMode: 'one_time',
      feeHoursPerDay: 10,
    });
    expect(result.agency.serviceFee).toBeCloseTo(5_000 * 26 * 10, 4);
  });

  it('16. Giá khách trả kèm phụ phí (phụ cấp, phép năm, phí quản lý): phần "đi thẳng cho NLĐ" không tính vào margin, nhưng vẫn cộng vào invoice subtotal', () => {
    const result = computePayrollMatrix({
      ...baseInput, inputType: 'base_salary', inputValue: 5_000_000, workingDaysPerMonth: 26,
      customerPriceMode: true, customerPriceValue: 0,
      customerExtraFeesTotal: 469_400 + 241_408 + 600_000, // phụ cấp nhà ở + phép năm + phí dịch vụ quản lý
      customerExtraFeesPassThrough: 469_400 + 241_408, // chỉ phụ cấp + phép năm là trả thẳng cho NLĐ, phí quản lý là margin
    });
    const extraTotal = 469_400 + 241_408 + 600_000;
    const passThrough = 469_400 + 241_408;
    expect(result.agency.customerRevenue).toBeCloseTo(extraTotal, 4);
    expect(result.agency.serviceFee).toBeCloseTo(extraTotal - result.employer.directLaborCost - passThrough, 4);
    expect(result.invoice.subtotal).toBeCloseTo(extraTotal, 4); // khách vẫn trả đủ, kể cả phần đi thẳng cho NLĐ
  });
});
