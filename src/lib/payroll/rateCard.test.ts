import { describe, expect, it } from 'vitest';
import {
  applyRateOverrides, monthlyGrossFromOverrides, inputValueForMonthlyGross,
  toWageDetail, pickPayrollInputFromWageDetail, allowancesFromWageDetail,
  sumAllowances, allowanceRecord, type WageFieldMapping, type AllowanceItem,
} from './rateCard';
import { computePayrollMatrix } from './reverseCalcEngine';
import type { PayrollInputType } from './coefficients';

// Bộ trường lương giống thực tế người dùng đang dùng bên Thị trường (migration 126): vài khoản
// gán được loại đơn giá theo luật, vài khoản là phụ cấp thuần.
const FIELDS: WageFieldMapping[] = [
  { name: 'Lương cơ bản', payrollInputType: 'base_salary' },
  { name: 'Ca ngày 8h (Ca 1+2)', payrollInputType: 'day_wage_8h' },
  { name: 'Ca đêm 8h (130%)', payrollInputType: 'night_wage_8h' },
  { name: 'Ăn ca', payrollInputType: null },
  { name: 'Phụ cấp xăng xe', payrollInputType: null },
];

const baseInput = {
  inputType: 'base_salary' as PayrollInputType, inputValue: 5_500_000, priorDayOt: false,
  region: 'II' as const, regionMinWage: 4_730_000, workingDaysPerMonth: 26,
  serviceFeeType: 'per_day_worked' as const, serviceFeeValue: 50_000, vatRate: 0.08,
};

describe('applyRateOverrides', () => {
  it('1. Không sửa gì thì đơn giá dùng thật = đơn giá theo luật', () => {
    const r = computePayrollMatrix(baseInput);
    const rows = applyRateOverrides(r.rateCard, {}, 26);
    expect(rows.every(x => !x.overridden)).toBe(true);
    expect(rows.every(x => x.effectiveNatural === x.naturalRate)).toBe(true);
  });

  it('2. Sửa 1 dòng chỉ đổi đúng dòng đó, các dòng khác giữ nguyên số theo luật', () => {
    const r = computePayrollMatrix(baseInput);
    const rows = applyRateOverrides(r.rateCard, { ot_day_sunday: 99_000 }, 26);
    const sunday = rows.find(x => x.type === 'ot_day_sunday')!;
    expect(sunday.overridden).toBe(true);
    expect(sunday.effectiveNatural).toBe(99_000);
    expect(rows.filter(x => x.type !== 'ot_day_sunday').every(x => !x.overridden)).toBe(true);
  });

  it('3. ĐƠN VỊ: lương cơ bản quy ra đ/tháng, ca 8h ra đ/ca, OT giữ đ/giờ', () => {
    const r = computePayrollMatrix(baseInput); // nhập 5.500.000đ/tháng
    const rows = applyRateOverrides(r.rateCard, {}, 26);
    const base = rows.find(x => x.type === 'base_salary')!;
    const day8h = rows.find(x => x.type === 'day_wage_8h')!;
    const otDay = rows.find(x => x.type === 'ot_day_weekday')!;

    expect(base.naturalRate).toBeCloseTo(5_500_000, 4);          // đúng bằng số đã nhập
    expect(base.unitLabel).toBe('đ/tháng');
    expect(day8h.naturalRate).toBeCloseTo(5_500_000 / 26, 4);    // 1 ca 8h
    expect(day8h.unitLabel).toBe('đ/ca 8h');
    expect(otDay.naturalRate).toBeCloseTo(otDay.rate, 6);        // OT vốn đã là đ/giờ
    expect(otDay.unitLabel).toBe('đ/giờ');
    // Quy về đ/giờ thì mọi loại đều so sánh ngang được với nhau
    expect(base.effectiveHourly).toBeCloseTo(r.shr, 6);
  });
});

describe('Sửa tay đơn giá giờ thường → tính lại đúng lương tháng', () => {
  it('3. Sửa "Lương cơ bản" thì lương tháng chuẩn ra đúng bằng số vừa gõ', () => {
    const target = 6_240_000;
    const monthly = monthlyGrossFromOverrides({ base_salary: target }, 26);
    expect(monthly).toBe(target);

    const iv = inputValueForMonthlyGross(monthly!, 'base_salary', false, 26);
    const r = computePayrollMatrix({ ...baseInput, inputValue: iv });
    expect(r.employee.monthlyGrossNormal).toBeCloseTo(target, 4);
  });

  it('4. Sửa "Lương ngày (8 tiếng)" thì lương tháng = đơn giá ngày × số ngày công', () => {
    const dayRate = 260_000;
    const monthly = monthlyGrossFromOverrides({ day_wage_8h: dayRate }, 26);
    expect(monthly).toBeCloseTo(dayRate * 26, 6);

    const iv = inputValueForMonthlyGross(monthly!, 'day_wage_8h', false, 26);
    const r = computePayrollMatrix({ ...baseInput, inputType: 'day_wage_8h', inputValue: iv });
    expect(r.employee.monthlyGrossNormal).toBeCloseTo(dayRate * 26, 4);
    // Bảo hiểm/chi phí phải bám theo lương tháng MỚI, không phải số nhập ban đầu
    expect(r.employer.directLaborCost).toBeGreaterThan(dayRate * 26);
  });

  it('5. Quy ngược giữ nguyên loại đơn giá đang chọn — nhập theo ca đêm vẫn ra đúng lương tháng đích', () => {
    const target = 7_000_000;
    for (const type of ['night_wage_8h', 'shift12_day', 'ot_day_weekday'] as PayrollInputType[]) {
      const iv = inputValueForMonthlyGross(target, type, false, 26);
      const r = computePayrollMatrix({ ...baseInput, inputType: type, inputValue: iv });
      expect(r.employee.monthlyGrossNormal).toBeCloseTo(target, 4);
    }
  });

  it('6. Sửa dòng OT/đêm KHÔNG làm đổi lương tháng chuẩn (lương tháng vốn không gồm giờ OT)', () => {
    expect(monthlyGrossFromOverrides({ ot_day_sunday: 99_000, ot_night_holiday: 120_000 }, 26)).toBeNull();
  });
});

describe('Đồng bộ 2 chiều với bảng lương NCC ở Thị trường', () => {
  it('7. Ghi sang Thị trường: đơn giá đã sửa tay được ghi, không phải số theo luật', () => {
    const r = computePayrollMatrix(baseInput);
    const rows = applyRateOverrides(r.rateCard, { day_wage_8h: 250_000 }, 26);
    const wd = toWageDetail(rows, FIELDS, { 'Ăn ca': 730_000 });
    expect(wd['Ca ngày 8h (Ca 1+2)']).toBe(250_000);
    expect(wd['Ăn ca']).toBe(730_000);
    // Khoản không nằm trong bảng đơn giá lẫn phụ cấp thì không tự sinh ra
    expect(wd['Phụ cấp xăng xe']).toBeUndefined();
  });

  it('8. Ghi đè chỉ động vào khoản có trong bảng, khoản cũ khác được giữ nguyên', () => {
    const r = computePayrollMatrix(baseInput);
    const rows = applyRateOverrides(r.rateCard, {}, 26);
    const previous = { 'Phụ cấp xăng xe': 300_000, 'Khoản lạ ngoài hệ thống': 111_000 };
    const wd = toWageDetail(rows, FIELDS, {}, previous);
    expect(wd['Phụ cấp xăng xe']).toBe(300_000);
    expect(wd['Khoản lạ ngoài hệ thống']).toBe(111_000);
    expect(wd['Lương cơ bản']).toBeGreaterThan(0);
  });

  it('9. Đọc ngược từ Thị trường: ưu tiên lương cơ bản, và lấy đúng số đã lưu', () => {
    const picked = pickPayrollInputFromWageDetail(
      { 'Lương cơ bản': 5_800_000, 'Ca ngày 8h (Ca 1+2)': 230_000, 'Ăn ca': 730_000 }, FIELDS,
    );
    expect(picked).toEqual({ type: 'base_salary', value: 5_800_000, fieldName: 'Lương cơ bản' });
  });

  it('10. Không có lương cơ bản thì rơi xuống lương ngày', () => {
    const picked = pickPayrollInputFromWageDetail({ 'Ca ngày 8h (Ca 1+2)': 230_000, 'Ăn ca': 730_000 }, FIELDS);
    expect(picked?.type).toBe('day_wage_8h');
    expect(picked?.value).toBe(230_000);
  });

  it('11. Bảng lương chỉ toàn phụ cấp thì không suy ngược được (báo cho người dùng, không đoán bừa)', () => {
    expect(pickPayrollInputFromWageDetail({ 'Ăn ca': 730_000 }, FIELDS)).toBeNull();
    expect(pickPayrollInputFromWageDetail(null, FIELDS)).toBeNull();
  });

  it('12. Phụ cấp tách đúng khỏi đơn giá giờ khi kéo về', () => {
    const rest = allowancesFromWageDetail(
      { 'Lương cơ bản': 5_800_000, 'Ca ngày 8h (Ca 1+2)': 230_000, 'Ăn ca': 730_000, 'Phụ cấp xăng xe': 300_000 }, FIELDS,
    );
    expect(rest).toEqual({ 'Ăn ca': 730_000, 'Phụ cấp xăng xe': 300_000 });
  });

  it('13. Đi vòng tròn Thị trường → tính → ghi lại: lương cơ bản không đổi khi không sửa tay', () => {
    const stored = { 'Lương cơ bản': 5_800_000, 'Ăn ca': 730_000 };
    const picked = pickPayrollInputFromWageDetail(stored, FIELDS)!;
    const r = computePayrollMatrix({ ...baseInput, inputType: picked.type, inputValue: picked.value });
    const rows = applyRateOverrides(r.rateCard, {}, 26);
    const back = toWageDetail(rows, FIELDS, allowancesFromWageDetail(stored, FIELDS), stored);
    expect(back['Lương cơ bản']).toBeCloseTo(5_800_000, 0);
    expect(back['Ăn ca']).toBe(730_000);
  });
});

describe('Phụ cấp 2 mặt (NLĐ nhận / công ty giữ lại)', () => {
  const items: AllowanceItem[] = [
    { id: 'a', label: 'Ăn ca', amount: '730000', passThrough: true },
    { id: 'b', label: 'Phí quản lý', amount: '200000', passThrough: false },
    { id: 'c', label: '', amount: '', passThrough: true },
  ];

  it('14. Tổng và phần về tay NLĐ tách đúng', () => {
    expect(sumAllowances(items)).toBe(930_000);
    expect(sumAllowances(items, true)).toBe(730_000);
    expect(sumAllowances(items, false)).toBe(200_000);
  });

  it('15. Chỉ khoản có tên và có số mới đem đi đồng bộ', () => {
    expect(allowanceRecord(items)).toEqual({ 'Ăn ca': 730_000, 'Phí quản lý': 200_000 });
  });
});
