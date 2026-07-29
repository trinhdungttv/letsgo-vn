// Cảnh báo compliance cho PayrollCalculatorModal. Theo quyết định phạm vi v1 (công cụ tính
// tạm, chưa có nguồn dữ liệu giờ OT thực tế hay thời hạn hợp đồng theo từng lao động), có 2
// cảnh báo: lương suy ra thấp hơn lương tối thiểu vùng (đỏ, CHẶN lưu) và — khi bật chế độ nhập
// giá khách trả trực tiếp — margin âm tức đang lỗ (vàng, KHÔNG chặn lưu vì đây chỉ là công cụ
// so sánh/kiểm tra, không phải xác nhận giao dịch thật).
import type { PayrollMatrixResult, RegionZone } from './reverseCalcEngine';

export interface ComplianceBanner {
  level: 'red' | 'amber';
  message: string;
  blocksSave: boolean;
}

const REGION_LABEL: Record<RegionZone, string> = { I: 'Vùng I', II: 'Vùng II', III: 'Vùng III', IV: 'Vùng IV' };

export function checkCompliance(result: PayrollMatrixResult, region: RegionZone, regionMinWage: number): ComplianceBanner[] {
  const banners: ComplianceBanner[] = [];
  if (result.compliance.belowRegionMinWage) {
    banners.push({
      level: 'red',
      blocksSave: true,
      message: `Lương tháng suy ra (${Math.round(result.employee.monthlyGrossNormal).toLocaleString('vi-VN')}đ) thấp hơn lương tối thiểu ${REGION_LABEL[region]} (${Math.round(regionMinWage).toLocaleString('vi-VN')}đ).`,
    });
  }
  if (result.agency.customerPriceMode && result.agency.serviceFee < 0) {
    banners.push({
      level: 'amber',
      blocksSave: false,
      message: `Giá khách trả thấp hơn chi phí lao động — đang LỖ ${Math.round(Math.abs(result.agency.serviceFee)).toLocaleString('vi-VN')}đ/tháng.`,
    });
  }
  return banners;
}
