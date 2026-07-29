// Ghi nhớ lựa chọn dùng lần gần nhất trong "Tính bảng lương" (vùng, ngày công, VAT, loại phí…)
// để lần sau mở lại không phải chọn lại từ đầu — người dùng thường làm việc quanh 1 vùng/1 KCN
// trong nhiều ngày liền. Dùng localStorage vì đây là thói quen thao tác của từng người trên từng
// máy, không phải dữ liệu nghiệp vụ cần lưu DB. CẢ 2 TAB (Tính 1 bảng lương + So sánh giá vùng)
// đọc/ghi cùng bộ key này nên đổi ở tab nào thì tab kia mở lần sau cũng theo giá trị mới nhất.
const PREFIX = 'payroll_calc_';

export const PREF_KEYS = {
  region: 'region',
  workingDays: 'working_days',
  vatPercent: 'vat_percent',
  inputType: 'input_type',
  serviceFeeType: 'service_fee_type',
  serviceFeeValue: 'service_fee_value',
  feeHoursPerDay: 'fee_hours_per_day',
} as const;

export function readPref(key: string, fallback: string): string {
  try {
    const v = localStorage.getItem(PREFIX + key);
    return v === null || v === '' ? fallback : v;
  } catch {
    return fallback; // localStorage bị chặn (chế độ riêng tư) — chỉ mất tiện ích ghi nhớ
  }
}

export function writePref(key: string, value: string): void {
  try { localStorage.setItem(PREFIX + key, value); } catch { /* bỏ qua, không ảnh hưởng tính toán */ }
}
