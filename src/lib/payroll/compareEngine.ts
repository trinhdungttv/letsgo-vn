// Phép tính cho bảng "So sánh giá vùng" — tách khỏi component để test được độc lập, vì đây là
// chỗ dễ sai nhất: 1 khoản hỗ trợ có 2 mặt (chi phí và doanh thu), lẫn với chi phí bảo hiểm.
//
// Quy ước số (giữ nguyên khi sửa, mọi nơi khác đều dựa vào đây):
//   Lương tháng chuẩn  = monthlyGrossNormal (theo luật, KHÔNG gồm phụ cấp) — dùng đối chiếu
//                        lương tối thiểu vùng, đúng Điều 90 BLLĐ 2019.
//   Tổng gói NLĐ nhận  = Lương tháng chuẩn + workerSupport → con số so sánh "ai trả NLĐ cao hơn".
//   Chi phí LĐ         = Lương tháng chuẩn + BHXH NSDLĐ đóng + workerSupport.
//   Tiền khách trả     = customerPriceValue × ngày công + clientSupportPaid.
//   Phí dịch vụ        = Tiền khách trả − Chi phí LĐ  (null khi chưa nhập gì về phía khách trả).
import { computePayrollMatrix, type RegionZone } from './reverseCalcEngine';
import type { PayrollInputType } from './coefficients';

export interface CompareRowInput {
  type: PayrollInputType;
  value: number;
  priorDayOt: boolean;
  workerSupport: number;      // hỗ trợ/tháng NLĐ THỰC NHẬN — là chi phí
  clientSupportPaid: number;  // hỗ trợ/tháng KHÁCH TRẢ cho khoản đó — là doanh thu
  customerPriceValue: number; // giá khách trả (đ/ngày công)
}

export interface CompareRowStats {
  monthly: number;
  workerTotal: number;
  laborCost: number;
  customerRevenue: number | null;
  serviceFee: number | null;
}

export function computeCompareRow(row: CompareRowInput, region: RegionZone, workingDaysPerMonth: number): CompareRowStats {
  if (row.value <= 0) {
    return { monthly: 0, workerTotal: 0, laborCost: 0, customerRevenue: null, serviceFee: null };
  }
  // Dùng lại nguyên engine của "Tính bảng lương" cho phần theo luật (SHR → lương tháng → BHXH),
  // không viết lại công thức pháp lý ở đây. regionMinWage=0 vì cảnh báo lương tối thiểu được
  // kiểm tra riêng ở tầng UI (cần cảnh báo cho TỪNG dòng, không chỉ dòng "của mình").
  const result = computePayrollMatrix({
    inputType: row.type, inputValue: row.value, priorDayOt: row.priorDayOt, region, regionMinWage: 0,
    workingDaysPerMonth, serviceFeeType: 'per_day_worked', serviceFeeValue: 0, vatRate: 0,
  });
  const monthly = result.employee.monthlyGrossNormal;
  const workerTotal = monthly + row.workerSupport;
  const laborCost = result.employer.directLaborCost + row.workerSupport;
  const hasRevenue = row.customerPriceValue > 0 || row.clientSupportPaid > 0;
  const customerRevenue = hasRevenue ? row.customerPriceValue * workingDaysPerMonth + row.clientSupportPaid : null;
  const serviceFee = customerRevenue !== null ? customerRevenue - laborCost : null;
  return { monthly, workerTotal, laborCost, customerRevenue, serviceFee };
}

// Trung bình 1 chỉ số của các nguồn KHÁC (không tính dòng "của mình"), bỏ qua dòng chưa đủ dữ liệu.
export function averageOf(values: (number | null)[]): number | null {
  const valid = values.filter((v): v is number => v !== null);
  return valid.length > 0 ? valid.reduce((s, v) => s + v, 0) / valid.length : null;
}
