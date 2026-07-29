// Payroll Reverse-Calculation Engine — hàm thuần logic, không gọi Supabase, để test được độc
// lập. Nghiệp vụ: nhập 1 đơn giá lương bất kỳ + 1 thông số phí dịch vụ → suy ngược ra Đơn giá
// giờ chuẩn (SHR, pivot) → tính xuôi ra lương NLĐ / chi phí NSDLĐ / doanh thu Agency / invoice
// khách hàng (đã gồm VAT).
import {
  NORM_DAY, EMPLOYEE_INSURANCE_RATE, EMPLOYER_INSURANCE_RATE, UNION_FEE_RATE,
  INSURANCE_CAP_MULTIPLE, BASE_SALARY_FOR_CAP, NIGHT_OT_TYPES,
  coefficientOf, fullRateCard, basisHoursOf, type PayrollInputType,
} from './coefficients';

// 3 loại phí ĐÚNG thực tế công ty đang tính (thay hẳn cho mô hình %/cost-plus không dùng):
//  - per_day_worked: phí dịch vụ theo ngày công, ÁP DỤNG LÂU DÀI (không giới hạn thời gian).
//  - referral_hourly: phí giới thiệu theo giờ — tuỳ khách mà thu 1 LẦN DUY NHẤT hoặc lặp lại
//    hàng tháng trong 1 khoảng thời gian (referralDurationMode + referralMonths).
//  - referral_daily_limited: phí giới thiệu theo ngày công, LUÔN có thời hạn (thường 3-6
//    tháng — referralMonths), hết hạn thì NGƯNG thu hẳn (không chuyển sang loại phí khác).
export type ServiceFeeType = 'per_day_worked' | 'referral_hourly' | 'referral_daily_limited';
export type ReferralDurationMode = 'one_time' | 'recurring_months';
export type RegionZone = 'I' | 'II' | 'III' | 'IV';

export const SERVICE_FEE_LABELS: Record<ServiceFeeType, string> = {
  per_day_worked: 'Phí dịch vụ theo ngày công',
  referral_hourly: 'Phí giới thiệu theo giờ',
  referral_daily_limited: 'Phí giới thiệu theo ngày (có thời hạn)',
};

export interface PayrollMatrixInput {
  inputType: PayrollInputType;
  inputValue: number;
  priorDayOt: boolean;
  region: RegionZone;
  regionMinWage: number;
  workingDaysPerMonth: number;
  serviceFeeType: ServiceFeeType;
  serviceFeeValue: number;
  referralDurationMode?: ReferralDurationMode; // chỉ áp dụng cho 'referral_hourly'
  referralMonths?: number; // 'referral_hourly' (khi recurring_months) + luôn dùng cho 'referral_daily_limited'
  vatRate: number;
  unionFeeEnabled?: boolean;
  // Số giờ tối đa/ngày được tính phí giới thiệu theo giờ (mặc định 8, nhưng có công ty quy định
  // khác) — CHỈ ảnh hưởng cách tính standardHoursPerMonth cho 'referral_hourly', không đụng tới
  // basis 8 tiếng/ngày công chuẩn dùng để suy SHR (đó là quy định luật lao động, cố định).
  feeHoursPerDay?: number;
  // Chế độ thay thế: thay vì tính phí dịch vụ theo công thức, nhập THẲNG giá khách hàng trả
  // (đ/ngày công) — dùng khi công ty đã biết giá thị trường (do cũng tham gia cung ứng) và
  // muốn suy ngược xem sau khi trả NLĐ + đóng bảo hiểm thì còn dư (margin) bao nhiêu. Tắt theo
  // mặc định — chỉ bật khi cần so sánh/kiểm tra, không thay đổi hành vi tính phí dịch vụ chuẩn.
  customerPriceMode?: boolean;
  customerPriceValue?: number; // đ/ngày công khách trả — chỉ dùng khi customerPriceMode = true
  // Giá khách trả thực tế thường KÈM THEO nhiều khoản phụ phí khác (phụ cấp nhà ở, phép năm,
  // chuyên cần, phí dịch vụ quản lý…), không chỉ 1 đơn giá/ngày — customerExtraFeesTotal là tổng
  // các khoản đó; customerExtraFeesPassThrough là phần trong đó ĐI THẲNG cho NLĐ (không phải
  // margin của Agency) nên phải trừ ra khi tính margin thực (xem công thức bên dưới).
  customerExtraFeesTotal?: number;
  customerExtraFeesPassThrough?: number;
}

export interface RateCardRow { type: PayrollInputType; label: string; coefficient: number; rate: number }

export interface PayrollMatrixResult {
  shr: number;
  rateCard: RateCardRow[];
  employee: {
    monthlyGrossNormal: number;
    baseSalaryForBHXH: number;
    employeeInsurance: number;
    netEstimate: number;
    otTaxNote: { coefficient: number; exemptPerHour: number; taxablePerHour: number } | null;
  };
  employer: {
    employerInsurance: number;
    unionFee: number;
    directLaborCost: number;
  };
  agency: {
    serviceFee: number; // trong customerPriceMode, đây là MARGIN (dư ra) suy ngược từ giá khách trả, không phải phí dịch vụ tính theo công thức
    grossMargin: number;
    durationNote: string | null;
    customerPriceMode: boolean;
    customerRevenue: number | null; // tổng giá khách trả/tháng — chỉ có giá trị khi customerPriceMode = true
  };
  invoice: {
    subtotal: number;
    vat: number;
    total: number;
  };
  compliance: {
    belowRegionMinWage: boolean;
  };
}

const INSURANCE_CAP = INSURANCE_CAP_MULTIPLE * BASE_SALARY_FOR_CAP;

export function computePayrollMatrix(input: PayrollMatrixInput): PayrollMatrixResult {
  const {
    inputType, inputValue, priorDayOt, regionMinWage, workingDaysPerMonth,
    serviceFeeType, serviceFeeValue, referralDurationMode = 'one_time', referralMonths,
    vatRate, unionFeeEnabled = false, feeHoursPerDay = 8, customerPriceMode = false, customerPriceValue = 0,
    customerExtraFeesTotal = 0, customerExtraFeesPassThrough = 0,
  } = input;

  const coefficient = coefficientOf(inputType, priorDayOt);
  // Mỗi loại đơn giá nhập vào ứng với 1 đơn vị thời gian khác nhau (tháng / 8 tiếng / 1 tiếng)
  // — basisHoursOf() quy về đúng số giờ mà inputValue đang đại diện, rồi suy ngược ra SHR.
  // Lưu ý: standardHoursPerMonth ở đây dùng feeHoursPerDay (có thể khác 8, do người dùng cấu
  // hình riêng cho phí giới thiệu theo giờ) — KHÔNG dùng basis 8h cố định của basisHoursOf().
  const standardHoursPerMonth = workingDaysPerMonth * feeHoursPerDay;
  const basisHours = basisHoursOf(inputType, workingDaysPerMonth);
  const shr = inputValue / (coefficient * basisHours);

  const rateCard = fullRateCard(shr, inputType, priorDayOt);

  // Lương tháng "chuẩn" (giả định chỉ làm giờ thường, không quy đổi giờ OT thực tế đã làm vì
  // Modal không thu thập số giờ OT đã dùng) — dùng làm nền tính BHXH & so sánh lương tối thiểu vùng.
  const monthlyGrossNormal = shr * NORM_DAY * 8 * workingDaysPerMonth;
  const baseSalaryForBHXH = Math.min(monthlyGrossNormal, INSURANCE_CAP);

  const employeeInsurance = baseSalaryForBHXH * EMPLOYEE_INSURANCE_RATE;
  const netEstimate = monthlyGrossNormal - employeeInsurance;

  // Phần OT/ca đêm miễn thuế TNCN (Điều 12 TT 111/2013) = phần trả CAO HƠN so với giờ làm việc
  // bình thường. Chỉ mang tính minh hoạ mỗi-giờ (không cộng vào lương tháng vì không có số giờ
  // OT thực tế đã làm trong tháng).
  const otTaxNote = (inputType === 'base_salary' || inputType === 'day_wage_8h') ? null : (() => {
    const referenceCoefficient = NIGHT_OT_TYPES.has(inputType) ? 1.30 : NORM_DAY;
    const taxablePerHour = shr * Math.min(coefficient, referenceCoefficient);
    const exemptPerHour = Math.max(0, shr * coefficient - taxablePerHour);
    return { coefficient, exemptPerHour, taxablePerHour };
  })();

  const employerInsurance = baseSalaryForBHXH * EMPLOYER_INSURANCE_RATE;
  const unionFee = unionFeeEnabled ? monthlyGrossNormal * UNION_FEE_RATE : 0;
  const directLaborCost = monthlyGrossNormal + employerInsurance + unionFee;

  // Phí "theo ngày" (dịch vụ thường + giới thiệu) đều nhân với working_days_per_month — đơn
  // giản hoá cho công cụ tính TẠM, không tách riêng "số ngày công thực tế đã đi làm" (không có
  // nguồn dữ liệu đó trong Modal).
  let serviceFee: number;
  let durationNote: string | null;
  let customerRevenue: number | null = null;

  if (customerPriceMode) {
    // Suy ngược: đã biết giá khách trả (thị trường) → margin THỰC = giá khách trả (đơn giá/ngày
    // + mọi khoản phụ phí đi kèm) - chi phí lao động - phần phụ phí ĐI THẲNG cho NLĐ (khoản này
    // khách trả nhưng Agency không giữ lại, nên không phải margin, dù vẫn tính vào subtotal
    // invoice vì khách vẫn phải trả đủ số đó).
    customerRevenue = customerPriceValue * workingDaysPerMonth + customerExtraFeesTotal;
    serviceFee = customerRevenue - directLaborCost - customerExtraFeesPassThrough;
    durationNote = 'Giá khách trả nhập trực tiếp — không tính theo công thức phí dịch vụ chuẩn.';
  } else if (serviceFeeType === 'per_day_worked') {
    serviceFee = serviceFeeValue * workingDaysPerMonth;
    durationNote = null;
  } else if (serviceFeeType === 'referral_hourly') {
    serviceFee = serviceFeeValue * standardHoursPerMonth;
    durationNote = referralDurationMode === 'one_time'
      ? 'Phí giới thiệu — THU 1 LẦN DUY NHẤT, không lặp lại các tháng sau.'
      : `Phí giới thiệu — thu hàng tháng, chỉ áp dụng trong ${referralMonths ?? 3} tháng đầu; từ tháng thứ ${(referralMonths ?? 3) + 1} sẽ ngừng thu.`;
  } else {
    serviceFee = serviceFeeValue * workingDaysPerMonth;
    durationNote = `Phí giới thiệu — thu hàng tháng, chỉ áp dụng trong ${referralMonths ?? 3} tháng đầu; từ tháng thứ ${(referralMonths ?? 3) + 1} sẽ ngừng thu (chỉ còn Direct Labor Cost).`;
  }

  // subtotal = TỔNG khách hàng thực trả (invoice trước VAT). Ở chế độ thường, đó là chi phí lao
  // động + phí dịch vụ. Ở customerPriceMode, khách trả đủ customerRevenue (gồm cả phần phụ phí
  // đi thẳng cho NLĐ) — serviceFee lúc này chỉ còn là MARGIN thực, không cộng thẳng vào subtotal
  // được nữa (vì đã trừ customerExtraFeesPassThrough ra khỏi margin).
  const subtotal = customerPriceMode ? (customerRevenue ?? 0) : directLaborCost + serviceFee;
  const grossMargin = subtotal !== 0 ? serviceFee / subtotal : 0;

  const vat = subtotal * vatRate;
  const total = subtotal + vat;

  return {
    shr,
    rateCard,
    employee: { monthlyGrossNormal, baseSalaryForBHXH, employeeInsurance, netEstimate, otTaxNote },
    employer: { employerInsurance, unionFee, directLaborCost },
    agency: { serviceFee, grossMargin, durationNote, customerPriceMode, customerRevenue },
    invoice: { subtotal, vat, total },
    compliance: { belowRegionMinWage: monthlyGrossNormal < regionMinWage },
  };
}
