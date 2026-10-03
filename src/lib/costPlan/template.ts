// Phương án giá — MẪU KHOẢN MỤC THEO NGÀNH do người dùng tự thiết lập.
// Mỗi ngành có mức hỗ trợ độc hại / khoản đặc thù khác nhau → lưu bảng chi phí chuẩn của ngành, lần sau chọn ngành đó
// là bảng tự điền theo mẫu (thay cho bộ gợi ý gắn cứng trong presets.ts, chỉ còn dùng khi ngành chưa có mẫu).
// Mẫu KHÔNG gồm Phí dịch vụ (phí đổi theo từng khách / KCN) và không ghi đè phương án đã lưu.
import { newLine, newLineId } from './engine';
import { baseLines, normalizeText } from './presets';
import type { CostLine } from './types';

export interface IndustryTemplate {
  industry: string;
  lines: CostLine[];
  updated_by_name: string | null;
  updated_at: string;
}

export const templateKey = (industry: string | null | undefined) => normalizeText(industry);

/** Các khoản đưa vào mẫu: toàn bộ chi phí lao động ở bước 1, bỏ Phí dịch vụ. */
export function linesForTemplate(lines: CostLine[]): CostLine[] {
  return lines.filter(l => !l.isServiceFee).map(l => ({ ...l }));
}

/**
 * Bảng khởi tạo từ mẫu: khoản của mẫu (id mới) + 1 dòng Phí DV trống. Lương cơ bản lấy theo lương tối thiểu vùng
 * của KCN (mỗi khách một mức), không lấy số của lần lưu mẫu. Mẫu thiếu dòng lương cơ bản thì thêm vào đầu.
 */
export function applyTemplate(tpl: Pick<IndustryTemplate, 'lines'>, opts: { baseWageMonthly: number }): CostLine[] {
  const lines = tpl.lines.filter(l => !l.isServiceFee).map(l =>
    l.isBaseWage ? { ...l, id: newLineId(), mode: 'fixed' as const, unit: 'month' as const, value: Math.round(opts.baseWageMonthly) } : { ...l, id: newLineId() });
  const std = baseLines({ baseWageMonthly: opts.baseWageMonthly });
  if (!lines.some(l => l.isBaseWage)) lines.unshift(std.find(l => l.isBaseWage)!);
  const fee = std.find(l => l.isServiceFee) ?? newLine({ name: 'Phí dịch vụ', isServiceFee: true, group: 'service' });
  return [...lines, { ...fee, id: newLineId() }];
}
