// Hệ số quy đổi pháp lý — Điều 57 NĐ 145/2020/NĐ-CP, Điều 98 BLLĐ 2019.
// Nguồn số liệu khớp với bảng seed trong supabase/migrations/20260729110000_124_payroll_calculator.sql
// (bảng legal_coefficients) — sửa ở DB chỉ để tra cứu/hiển thị, phép tính vẫn dùng hằng số ở
// đây để computePayrollMatrix() là hàm thuần, test được mà không cần gọi DB.
export const NORM_DAY = 1.00;               // giờ thường, ban ngày
export const NORM_NIGHT = 1.30;             // giờ thường, ban đêm (không OT) — Điều 98.2 BLLĐ 2019
export const OT_DAY_WEEKDAY = 1.50;         // OT ngày thường, ban ngày — Điều 98.1.a
export const OT_DAY_SUNDAY = 2.00;          // OT ngày nghỉ hằng tuần, ban ngày — Điều 98.1.b
export const OT_DAY_HOLIDAY = 3.00;         // OT ngày lễ/Tết, ban ngày — Điều 98.1.c

// Công thức tổng quát cho OT đêm — dùng chung 1 hàm thay vì hardcode 4 số riêng lẻ, để khi
// luật đổi mức OT ngày chỉ cần sửa 1 chỗ (OT_DAY_WEEKDAY/SUNDAY/HOLIDAY ở trên).
// dayOtRate: hệ số OT ngày tương ứng (1.50 | 2.00 | 3.00).
// priorDayOt: có làm OT ban ngày ngay trước ca đêm cùng ngày hay không — CHỈ có ý nghĩa với
// OT đêm NGÀY THƯỜNG (dayOtRate = 1.50): không có → mốc tính thêm 20% là 100% (giờ thường),
// có → mốc là chính 150%. Với Chủ nhật/Lễ Tết (dayOtRate > 1.50), cả ngày đã ở mức OT ngày
// (200%/300%) nên không có mốc "giờ thường 100%" riêng — mốc luôn là chính dayOtRate, không
// phụ thuộc priorDayOt (vd 300%+30%+20%×300% = 3.90, đúng ví dụ minh hoạ luật sư).
export function computeNightOTCoefficient(dayOtRate: number, priorDayOt: boolean): number {
  const referenceRate = dayOtRate > OT_DAY_WEEKDAY || priorDayOt ? dayOtRate : 1.00;
  return dayOtRate + 0.30 + 0.20 * referenceRate;
}

export const OT_NIGHT_WEEKDAY_NOPRIOR = computeNightOTCoefficient(OT_DAY_WEEKDAY, false); // 2.00
export const OT_NIGHT_WEEKDAY_PRIOR = computeNightOTCoefficient(OT_DAY_WEEKDAY, true);     // 2.10
export const OT_NIGHT_SUNDAY = computeNightOTCoefficient(OT_DAY_SUNDAY, false);            // 2.70
export const OT_NIGHT_HOLIDAY = computeNightOTCoefficient(OT_DAY_HOLIDAY, false);          // 3.90

// Ca 12h không phải phạm trù luật riêng — là tổ hợp 8h định mức + 4h OT (ngày thường).
export const SHIFT_12H_DAY = (8 * NORM_DAY + 4 * OT_DAY_WEEKDAY) / 12;                              // 1.1667
export const SHIFT_12H_NIGHT = (8 * NORM_NIGHT + 4 * computeNightOTCoefficient(OT_DAY_WEEKDAY, false)) / 12; // 1.5333

// Tỷ lệ bảo hiểm — Luật BHXH 2024, hiệu lực từ 01/07/2025.
export const EMPLOYEE_INSURANCE_RATE = 0.105;  // NLĐ: BHXH 8% + BHTN 1% + BHYT 1.5%
export const EMPLOYER_INSURANCE_RATE = 0.215;  // NSDLĐ: BHXH 17.5% + BHTN 1% + BHYT 3%
export const UNION_FEE_RATE = 0.02;            // Kinh phí công đoàn (nếu áp dụng)
export const INSURANCE_CAP_MULTIPLE = 20;      // Trần đóng BHXH = 20 lần lương cơ sở
export const BASE_SALARY_FOR_CAP = 2_340_000;  // Lương cơ sở hiện hành, NĐ 73/2024/NĐ-CP từ 01/7/2024

export type PayrollInputType =
  | 'base_salary'
  | 'day_wage_8h'
  | 'night_wage_8h'
  | 'sunday_day_wage_8h'
  | 'sunday_night_wage_8h'
  | 'holiday_wage_8h'
  | 'ot_day_weekday'
  | 'ot_night_weekday'
  | 'ot_day_sunday'
  | 'ot_night_sunday'
  | 'ot_day_holiday'
  | 'ot_night_holiday'
  | 'shift12_day'
  | 'shift12_night';

// Mỗi label PHẢI ghi rõ đơn vị thời gian của số tiền cần nhập (tháng / 8 tiếng / 1 tiếng /
// ca) — dễ nhầm lẫn nếu không nói rõ do người quản lý report bằng nhiều đơn vị khác nhau.
export const PAYROLL_INPUT_LABELS: Record<PayrollInputType, string> = {
  base_salary: 'Lương cơ bản (cả 1 tháng)',
  day_wage_8h: 'Lương ngày (8 tiếng)',
  night_wage_8h: 'Lương đêm (8 tiếng)',
  sunday_day_wage_8h: 'Lương ngày Chủ nhật (8 tiếng)',
  sunday_night_wage_8h: 'Lương đêm Chủ nhật (8 tiếng)',
  holiday_wage_8h: 'Lương ngày Lễ, Tết (8 tiếng)',
  ot_day_weekday: 'OT ngày thường (1 tiếng)',
  ot_night_weekday: 'OT đêm ngày thường (1 tiếng)',
  ot_day_sunday: 'Tăng ca ngày Chủ nhật (1 tiếng)',
  ot_night_sunday: 'Tăng ca đêm Chủ nhật (1 tiếng)',
  ot_day_holiday: 'OT Lễ Tết ngày (1 tiếng)',
  ot_night_holiday: 'OT Lễ Tết đêm (1 tiếng)',
  shift12_day: 'Ca 12 tiếng, ban ngày',
  shift12_night: 'Ca 12 tiếng, ban đêm',
};

// Số tiền tương ứng của mỗi loại đơn giá được nhập cho ĐƠN VỊ THỜI GIAN nào — cần để suy
// ngược ra SHR đúng: 'base_salary' là cả tháng, 3 loại '_wage_8h' là 1 ngày công 8 tiếng,
// còn lại (OT theo giờ, ca 12h) giữ nguyên hành vi cũ — SHR = inputValue / coefficient (coi
// như số tiền đã là đơn giá BÌNH QUÂN/GIỜ của loại đó, đúng theo cách hệ số ca 12h được định
// nghĩa — xem SHIFT_12H_DAY/NIGHT).
export function basisHoursOf(type: PayrollInputType, workingDaysPerMonth: number): number {
  if (type === 'base_salary') return workingDaysPerMonth * 8;
  if (type === 'day_wage_8h' || type === 'night_wage_8h' || type === 'holiday_wage_8h'
    || type === 'sunday_day_wage_8h' || type === 'sunday_night_wage_8h') return 8;
  return 1;
}

export const NIGHT_OT_TYPES = new Set<PayrollInputType>(['ot_night_weekday', 'ot_night_sunday', 'ot_night_holiday', 'sunday_night_wage_8h']);

// Hệ số quy đổi của 1 loại đơn giá nhập vào, so với SHR (Standard Hourly Rate). priorDayOt
// chỉ ảnh hưởng tới 'ot_night_weekday' (theo mục 2.2 — 2 mốc PRIOR/NOPRIOR chỉ định nghĩa cho
// OT đêm ngày thường; OT đêm Chủ nhật/Lễ Tết trong bảng gốc chỉ có 1 mức, không tách priorDayOt).
export function coefficientOf(type: PayrollInputType, priorDayOt: boolean): number {
  switch (type) {
    case 'base_salary': return NORM_DAY;
    case 'day_wage_8h': return NORM_DAY;
    case 'night_wage_8h': return NORM_NIGHT;
    // Làm đủ 8h vào ngày nghỉ hằng tuần (Chủ nhật) tính OT cho CẢ 8 tiếng, không chỉ phần vượt
    // — cùng hệ số với ot_day_sunday/ot_night_sunday (Điều 98.1.b BLLĐ 2019), chỉ khác đơn vị
    // hiển thị (nguyên ca 8h thay vì từng giờ).
    case 'sunday_day_wage_8h': return OT_DAY_SUNDAY;
    case 'sunday_night_wage_8h': return OT_NIGHT_SUNDAY;
    case 'holiday_wage_8h': return OT_DAY_HOLIDAY;
    case 'ot_day_weekday': return OT_DAY_WEEKDAY;
    case 'ot_night_weekday': return computeNightOTCoefficient(OT_DAY_WEEKDAY, priorDayOt);
    case 'ot_day_sunday': return OT_DAY_SUNDAY;
    case 'ot_night_sunday': return OT_NIGHT_SUNDAY;
    case 'ot_day_holiday': return OT_DAY_HOLIDAY;
    case 'ot_night_holiday': return OT_NIGHT_HOLIDAY;
    case 'shift12_day': return SHIFT_12H_DAY;
    case 'shift12_night': return SHIFT_12H_NIGHT;
  }
}

// Bảng đầy đủ đơn giá theo từng loại giờ (dùng để hiển thị Khối 1 — Block1EmployeeReceived),
// luôn tính priorDayOt=false cho các mức tham khảo khác ngoài mức người dùng đã chọn.
export function fullRateCard(shr: number, selectedType: PayrollInputType, priorDayOt: boolean): { type: PayrollInputType; label: string; coefficient: number; rate: number }[] {
  return (Object.keys(PAYROLL_INPUT_LABELS) as PayrollInputType[]).map(type => {
    const coefficient = coefficientOf(type, type === selectedType ? priorDayOt : false);
    return { type, label: PAYROLL_INPUT_LABELS[type], coefficient, rate: shr * coefficient };
  });
}
