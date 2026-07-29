import { describe, expect, it } from 'vitest';
import { computeCompareRow, averageOf, type CompareRowInput } from './compareEngine';
import { computePayrollMatrix } from './reverseCalcEngine';

const baseRow: CompareRowInput = {
  type: 'base_salary', value: 5_500_000, priorDayOt: false,
  workerSupport: 0, clientSupportPaid: 0, customerPriceValue: 0,
};

describe('computeCompareRow', () => {
  it('1. Chưa nhập giá khách trả → không suy ra phí dịch vụ (null, không phải số âm)', () => {
    const s = computeCompareRow(baseRow, 'II', 26);
    expect(s.monthly).toBeGreaterThan(0);
    expect(s.laborCost).toBeGreaterThan(s.monthly); // đã cộng BHXH NSDLĐ đóng
    expect(s.customerRevenue).toBeNull();
    expect(s.serviceFee).toBeNull();
  });

  it('2. Hỗ trợ NLĐ nhận cộng vào CẢ tổng gói NLĐ lẫn chi phí lao động', () => {
    const withoutSupport = computeCompareRow(baseRow, 'II', 26);
    const withSupport = computeCompareRow({ ...baseRow, workerSupport: 500_000 }, 'II', 26);
    expect(withSupport.workerTotal).toBeCloseTo(withoutSupport.workerTotal + 500_000, 4);
    expect(withSupport.laborCost).toBeCloseTo(withoutSupport.laborCost + 500_000, 4);
    // Lương tháng chuẩn (nền tính BHXH + đối chiếu lương tối thiểu) KHÔNG đổi khi thêm phụ cấp
    expect(withSupport.monthly).toBeCloseTo(withoutSupport.monthly, 4);
  });

  it('3. Khách trả đúng bằng phần trả NLĐ → khoản hỗ trợ trung lập, không sinh thêm phí dịch vụ', () => {
    const noSupport = computeCompareRow({ ...baseRow, customerPriceValue: 400_000 }, 'II', 26);
    const neutral = computeCompareRow({ ...baseRow, customerPriceValue: 400_000, workerSupport: 600_000, clientSupportPaid: 600_000 }, 'II', 26);
    expect(neutral.serviceFee).toBeCloseTo(noSupport.serviceFee!, 4);
  });

  it('4. Khách trả NHIỀU hơn phần trả NLĐ → phần chênh lệch thành phí dịch vụ tăng thêm', () => {
    const neutral = computeCompareRow({ ...baseRow, customerPriceValue: 400_000, workerSupport: 600_000, clientSupportPaid: 600_000 }, 'II', 26);
    const kept = computeCompareRow({ ...baseRow, customerPriceValue: 400_000, workerSupport: 600_000, clientSupportPaid: 800_000 }, 'II', 26);
    expect(kept.serviceFee! - neutral.serviceFee!).toBeCloseTo(200_000, 4);
  });

  it('5. Chỉ có hỗ trợ khách trả (chưa có giá/ngày) vẫn suy ra được phí dịch vụ', () => {
    const s = computeCompareRow({ ...baseRow, clientSupportPaid: 500_000 }, 'II', 26);
    expect(s.customerRevenue).toBeCloseTo(500_000, 4);
    expect(s.serviceFee).toBeCloseTo(500_000 - s.laborCost, 4);
    expect(s.serviceFee).toBeLessThan(0); // lỗ, vì khách chưa trả tiền công
  });

  it('6. Mỗi nguồn nhập loại đơn giá khác nhau vẫn quy về cùng lương tháng để so sánh ngang hàng', () => {
    const monthly = computeCompareRow({ ...baseRow, type: 'base_salary', value: 5_200_000 }, 'II', 26);
    // 5.200.000đ/tháng ÷ 26 ngày = 200.000đ/ngày công 8 tiếng → phải ra đúng cùng lương tháng
    const daily = computeCompareRow({ ...baseRow, type: 'day_wage_8h', value: 200_000 }, 'II', 26);
    expect(daily.monthly).toBeCloseTo(monthly.monthly, 4);
  });

  it('7. Số ngày công thay đổi làm lương tháng của đơn giá THEO NGÀY đổi theo, lương tháng cố định thì không', () => {
    const fixed26 = computeCompareRow({ ...baseRow, type: 'base_salary', value: 5_200_000 }, 'II', 26);
    const fixed24 = computeCompareRow({ ...baseRow, type: 'base_salary', value: 5_200_000 }, 'II', 24);
    expect(fixed24.monthly).toBeCloseTo(fixed26.monthly, 4);

    const daily26 = computeCompareRow({ ...baseRow, type: 'day_wage_8h', value: 200_000 }, 'II', 26);
    const daily24 = computeCompareRow({ ...baseRow, type: 'day_wage_8h', value: 200_000 }, 'II', 24);
    expect(daily24.monthly).toBeCloseTo(200_000 * 24, 4);
    expect(daily24.monthly).toBeLessThan(daily26.monthly);
  });
});

describe('Khớp số giữa tab "Tính 1 bảng lương" và bảng "So sánh giá vùng"', () => {
  const workingDays = 26;

  it('8. Chế độ nhập thẳng giá khách trả: phí dịch vụ 2 bên ra CÙNG một con số', () => {
    const customerPriceValue = 420_000;
    const workerSupport = 700_000;   // phụ phí đánh dấu "Trả NLĐ"
    const keptByAgency = 150_000;    // phụ phí công ty giữ lại
    const clientSupportPaid = workerSupport + keptByAgency;

    // Bên "Tính 1 bảng lương"
    const single = computePayrollMatrix({
      inputType: 'base_salary', inputValue: 5_500_000, priorDayOt: false, region: 'II', regionMinWage: 4_730_000,
      workingDaysPerMonth: workingDays, serviceFeeType: 'per_day_worked', serviceFeeValue: 0, vatRate: 0.08,
      customerPriceMode: true, customerPriceValue,
      customerExtraFeesTotal: clientSupportPaid, customerExtraFeesPassThrough: workerSupport,
    });

    // Bên "So sánh giá vùng"
    const compare = computeCompareRow(
      { type: 'base_salary', value: 5_500_000, priorDayOt: false, workerSupport, clientSupportPaid, customerPriceValue },
      'II', workingDays,
    );

    expect(compare.serviceFee).toBeCloseTo(single.agency.serviceFee, 4);
    expect(compare.customerRevenue).toBeCloseTo(single.agency.customerRevenue!, 4);
  });

  it('9. Chế độ phí theo công thức: quy tổng invoice trước VAT về giá/ngày cho ra ĐÚNG lại phí dịch vụ ban đầu', () => {
    const single = computePayrollMatrix({
      inputType: 'base_salary', inputValue: 5_500_000, priorDayOt: false, region: 'II', regionMinWage: 4_730_000,
      workingDaysPerMonth: workingDays, serviceFeeType: 'per_day_worked', serviceFeeValue: 50_000, vatRate: 0.08,
    });
    // Cách quy đổi đang dùng khi bấm "Lấy từ tab Tính 1 bảng lương" / lấy từ báo giá đã lưu
    const derivedPricePerDay = single.invoice.subtotal / workingDays;

    const compare = computeCompareRow(
      { type: 'base_salary', value: 5_500_000, priorDayOt: false, workerSupport: 0, clientSupportPaid: 0, customerPriceValue: derivedPricePerDay },
      'II', workingDays,
    );

    expect(compare.serviceFee).toBeCloseTo(single.agency.serviceFee, 4);
  });

  it('10. Đi vòng tròn: so sánh → báo giá → so sánh lại vẫn giữ nguyên phí dịch vụ', () => {
    const row: CompareRowInput = {
      type: 'day_wage_8h', value: 230_000, priorDayOt: false,
      workerSupport: 400_000, clientSupportPaid: 550_000, customerPriceValue: 380_000,
    };
    const first = computeCompareRow(row, 'II', workingDays);

    // Bảng so sánh đẩy sang tab báo giá: tách 2 dòng phụ phí (trả NLĐ / công ty giữ lại)
    const keptByAgency = row.clientSupportPaid - row.workerSupport;
    const single = computePayrollMatrix({
      inputType: row.type, inputValue: row.value, priorDayOt: row.priorDayOt, region: 'II', regionMinWage: 4_730_000,
      workingDaysPerMonth: workingDays, serviceFeeType: 'per_day_worked', serviceFeeValue: 0, vatRate: 0.08,
      customerPriceMode: true, customerPriceValue: row.customerPriceValue,
      customerExtraFeesTotal: row.workerSupport + keptByAgency, customerExtraFeesPassThrough: row.workerSupport,
    });
    expect(single.agency.serviceFee).toBeCloseTo(first.serviceFee!, 4);

    // Rồi lấy ngược lại từ tab báo giá về bảng so sánh
    const back = computeCompareRow(
      { ...row, workerSupport: row.workerSupport, clientSupportPaid: row.workerSupport + keptByAgency },
      'II', workingDays,
    );
    expect(back.serviceFee).toBeCloseTo(first.serviceFee!, 4);
  });
});

describe('averageOf', () => {
  it('11. Bỏ qua nguồn chưa đủ dữ liệu, không có nguồn nào hợp lệ thì trả null', () => {
    expect(averageOf([100, null, 200])).toBeCloseTo(150, 6);
    expect(averageOf([null, null])).toBeNull();
    expect(averageOf([])).toBeNull();
  });
});
