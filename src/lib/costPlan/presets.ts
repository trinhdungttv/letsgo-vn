// Phương án giá — bộ khoản mục gợi ý theo NGÀNH NGHỀ.
//
// Nguyên tắc: chỉ tự điền những khoản có công thức luật định (BHXH, công đoàn, phép năm) và các
// con số lấy từ bảng mẫu thật của công ty (Hóa chất). Khoản khác chỉ là CHIP gợi ý (số = 0) để
// bấm thêm — không tự bịa đơn giá cho ngành mà công ty chưa có dữ liệu. Số tiền sẽ được gợi ý
// tiếp từ chính các phương án đã lưu ở lần trước (xem suggest.ts).

import type { CostLine } from './types';
import { INSURANCE_CAP_MONTHLY, newLine } from './engine';

/** Bỏ dấu tiếng Việt + hạ chữ thường — dùng so khớp tên ngành / tên khoản. */
export function normalizeText(s: string | null | undefined): string {
  return (s ?? '')
    .toLowerCase()
    .replace(/đ/g, 'd')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Tên khoản dùng để nhận ra "cùng một khoản" giữa các phương án: bỏ phần ngoặc & số. */
export function lineKey(name: string): string {
  return normalizeText(name).replace(/\([^)]*\)/g, ' ').replace(/[0-9.,%÷x×/]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export interface IndustryPreset {
  key: string;
  label: string;
  /** Từ khoá (đã bỏ dấu) — tên ngành chứa 1 trong các từ này thì khớp */
  match: string[];
  /** Tự thêm khi chọn ngành cho phương án trống */
  core: () => CostLine[];
  /** Chip gợi ý — bấm mới thêm */
  optional: () => CostLine[];
  hints: string[];
}

const money = (name: string, p: Partial<CostLine> = {}): CostLine =>
  newLine({ name, group: 'other', unit: 'day', value: 0, ...p });
const toWorker = (name: string, p: Partial<CostLine> = {}): CostLine =>
  money(name, { group: 'worker', paidToWorker: true, ...p });
const compliance = (name: string, p: Partial<CostLine> = {}): CostLine =>
  money(name, { group: 'compliance', ...p });

/** Chip dùng chung cho mọi ngành. */
export const COMMON_OPTIONAL = (): CostLine[] => [
  toWorker('Phụ cấp chuyên cần', { unit: 'month', note: 'Chuyên cần đủ công chuẩn' }),
  toWorker('Phụ cấp đi lại', { unit: 'month' }),
  toWorker('Phụ cấp nhà ở / nhà trọ', { unit: 'month' }),
  toWorker('Phụ cấp cơm ca', { unit: 'month', note: 'Ăn trưa không chịu thuế TNCN trong mức quy định' }),
  toWorker('Phụ cấp ca đêm', { unit: 'day', note: 'Giờ đêm tối thiểu +30% (Điều 98 BLLĐ 2019)' }),
  toWorker('Thưởng Tết / tháng 13 (dự phòng)', { mode: 'percent', base: 'base_wage', value: 8.33, note: '1 tháng lương chia đều 12 tháng' }),
  compliance('Khám sức khoẻ định kỳ', { note: 'Khám định kỳ 6 tháng / 1 lần' }),
  compliance('Đồng phục / bảo hộ lao động'),
  compliance('Bảo hiểm tai nạn 24/24'),
  money('Chi phí tuyển dụng & đào tạo ban đầu', { group: 'other' }),
  money('Chi phí quản lý tại chỗ (tổ trưởng, giám sát)', { group: 'other' }),
];

export const INDUSTRY_PRESETS: IndustryPreset[] = [
  {
    key: 'hoa_chat',
    label: 'Hóa chất / Sơn / Nhựa',
    match: ['hoa chat', 'son', 'nhua nhu tuong', 'acrylic', 'hoa dau', 'phan bon', 'thuoc bao ve'],
    // Số liệu lấy từ bảng mẫu "Nhựa nhũ tương acrylic dùng cho sơn tường" của công ty
    core: () => [
      toWorker('Phụ cấp độc hại (tiền mặt / hiện vật)', { unit: 'day', value: 29000, note: 'Thỏa thuận tính vào bảng lương' }),
      toWorker('Phụ cấp chuyên cần', { unit: 'month', value: 301_600, note: 'Chuyên cần đủ công chuẩn' }),
      compliance('Khám SK định kỳ 6 tháng & thẻ an toàn', { unit: 'day', value: 4000, note: 'Khám định kỳ & bệnh nghề nghiệp' }),
    ],
    optional: () => [compliance('Huấn luyện an toàn hóa chất (ATVSLĐ)'), compliance('Bảo hộ chuyên dụng (găng, mặt nạ, quần áo hóa chất)')],
    hints: ['Nghề độc hại: phép năm 14 ngày (Điều 113 BLLĐ 2019) — kiểm tra khách có xếp loại nặng nhọc độc hại không.', 'Phải có khám bệnh nghề nghiệp + huấn luyện ATVSLĐ định kỳ.'],
  },
  {
    key: 'det_may',
    label: 'Dệt may / Da giày',
    match: ['det may', 'may mac', 'giay dep', 'da giay', 'giay da', 'soi', 'det', 'thoi trang'],
    core: () => [],
    optional: () => [toWorker('Thưởng năng suất / chuyên cần', { unit: 'month' }), compliance('Đồng phục', { note: 'Thường công ty khách cấp' })],
    hints: ['Mùa vụ mạnh: khách thường cần tăng ca dồn đơn — cân nhắc đưa OT vào giá hay tính riêng.'],
  },
  {
    key: 'dien_tu',
    label: 'Điện tử / Linh kiện',
    match: ['dien tu', 'linh kien', 'ban dan', 'vi mach', 'dien lanh', 'dien gia dung', 'cong nghe'],
    core: () => [],
    optional: () => [compliance('Đồng phục chống tĩnh điện (ESD)'), money('Xe đưa đón công nhân', { group: 'other', unit: 'month' })],
    hints: ['Ca kíp 12 giờ + làm đêm phổ biến: tính phụ cấp ca đêm và hệ số OT đêm.'],
  },
  {
    key: 'co_khi',
    label: 'Cơ khí / Kim loại / Ô tô',
    match: ['co khi', 'kim loai', 'duc', 'han', 'o to', 'xe may', 'phu tung', 'che tao may', 'thep'],
    core: () => [],
    optional: () => [toWorker('Phụ cấp tay nghề (thợ hàn / CNC)', { unit: 'month' }), compliance('Bảo hộ lao động (PPE: kính, găng, giày)'), compliance('Khám bệnh nghề nghiệp')],
    hints: ['Thợ có tay nghề (hàn, CNC) nên báo riêng 1 phương án — mặt bằng lương cao hơn phổ thông.'],
  },
  {
    key: 'thuc_pham',
    label: 'Thực phẩm / Thủy sản',
    match: ['thuc pham', 'thuy san', 'do uong', 'che bien', 'nong san', 'sua', 'banh keo', 'dong lanh'],
    core: () => [],
    optional: () => [compliance('Khám SK + xét nghiệm vệ sinh ATTP', { note: 'Bắt buộc với người trực tiếp chế biến' }), toWorker('Phụ cấp môi trường lạnh / ẩm', { unit: 'day' }), compliance('Đồng phục & ủng chuyên dụng')],
    hints: ['Yêu cầu giấy khám ATTP trước khi vào làm — tính chi phí khám ban đầu.'],
  },
  {
    key: 'go_noi_that',
    label: 'Gỗ / Nội thất',
    match: ['go', 'noi that', 'moc', 'dam go', 'van ep'],
    core: () => [],
    optional: () => [toWorker('Phụ cấp bụi / độc hại', { unit: 'day' }), compliance('Bảo hộ (khẩu trang, nút tai)'), compliance('Khám bệnh nghề nghiệp (bụi phổi)')],
    hints: ['Ngành bụi gỗ: bệnh nghề nghiệp bụi phổi — chi phí khám chuyên sâu cao hơn.'],
  },
  {
    key: 'nhua_cao_su',
    label: 'Nhựa / Cao su / Bao bì',
    match: ['nhua', 'cao su', 'bao bi', 'giay bia', 'in an', 'thung carton'],
    core: () => [],
    optional: () => [toWorker('Phụ cấp nóng / độc hại', { unit: 'day' }), compliance('Bảo hộ lao động'), compliance('Khám bệnh nghề nghiệp')],
    hints: ['Xưởng ép/đùn nhựa nóng: cân nhắc phụ cấp nóng + nước uống bù điện giải.'],
  },
  {
    key: 'logistics',
    label: 'Kho vận / Logistics',
    match: ['kho van', 'logistics', 'boc xep', 'van tai', 'thuong mai', 'phan phoi', 'ban le'],
    core: () => [],
    optional: () => [toWorker('Phụ cấp bốc xếp / nặng nhọc', { unit: 'day' }), compliance('Bảo hiểm tai nạn lao động bổ sung')],
    hints: ['Lượng việc dao động theo mùa/đợt hàng — nên chốt số lao động tối thiểu cam kết.'],
  },
];

export function findPreset(industry: string | null | undefined): IndustryPreset | null {
  const k = normalizeText(industry);
  if (!k) return null;
  // So khớp theo TỪ nguyên (không khớp giữa chữ): "han" không dính vào "nhan su".
  const padded = ` ${k.replace(/[^a-z0-9]+/g, ' ').trim()} `;
  return INDUSTRY_PRESETS.find(p => p.match.some(m => padded.includes(` ${m} `))) ?? null;
}

/** Các dòng "nền" cho MỌI ngành — đủ để ra giá có cơ sở pháp lý. */
export function baseLines(opts: { baseWageMonthly: number; leaveDays?: number }): CostLine[] {
  return [
    newLine({
      name: 'Lương cơ bản', group: 'worker', unit: 'month', value: Math.round(opts.baseWageMonthly),
      paidToWorker: true, isBaseWage: true, insurable: true,
      note: 'Trả trực tiếp cho NLĐ — không được thấp hơn lương tối thiểu vùng',
    }),
    newLine({
      name: 'BHXH, BHYT, BHTN (DN đóng 21,5%)', group: 'compliance', mode: 'percent', base: 'insurable', value: 21.5,
      cap: INSURANCE_CAP_MONTHLY, note: 'BHXH 17,5% + BHTN 1% + BHYT 3% trên lương đóng BH (trần 20 lần lương cơ sở)',
    }),
    newLine({
      name: 'Dự phòng phép năm có lương', group: 'compliance', mode: 'leave', value: opts.leaveDays ?? 12,
      note: 'Điều 113 BLLĐ 2019: 12 ngày/năm (nặng nhọc, độc hại: 14)',
    }),
    newLine({
      name: 'Kinh phí Công đoàn (DN nộp 2%)', group: 'compliance', mode: 'percent', base: 'insurable', value: 2,
      note: '2% quỹ lương đóng BHXH',
    }),
    newLine({
      name: 'Phí dịch vụ nhà thầu cung ứng', group: 'service', unit: 'day', value: 0, isServiceFee: true,
      note: 'Quản lý nhân sự, chấm công & vận hành — phần lợi nhuận',
    }),
  ];
}

/**
 * Bộ dòng khởi tạo cho 1 phương án MỚI theo ngành: nền + khoản "core" của ngành,
 * đặt trước dòng Phí DV. Ngành chưa có preset → chỉ có dòng nền.
 */
export function starterLines(industry: string | null | undefined, opts: { baseWageMonthly: number }): CostLine[] {
  const preset = findPreset(industry);
  const heavy = preset?.key === 'hoa_chat';
  const base = baseLines({ ...opts, leaveDays: heavy ? 14 : 12 });
  const fee = base.filter(l => l.isServiceFee);
  const rest = base.filter(l => !l.isServiceFee);
  const wageIdx = rest.findIndex(l => l.isBaseWage);
  const core = preset?.core() ?? [];
  // Lương CB → các khoản trả NLĐ của ngành → các khoản nghĩa vụ → Phí DV
  const workerCore = core.filter(l => l.paidToWorker);
  const otherCore = core.filter(l => !l.paidToWorker);
  return [
    ...rest.slice(0, wageIdx + 1), ...workerCore,
    ...rest.slice(wageIdx + 1), ...otherCore,
    ...fee,
  ];
}

/** Chip gợi ý của ngành + chip chung, bỏ những khoản đã có trong bảng. */
export function optionalFor(industry: string | null | undefined, currentLines: CostLine[]): CostLine[] {
  const have = new Set(currentLines.map(l => lineKey(l.name)));
  const preset = findPreset(industry);
  const all = [...(preset?.optional() ?? []), ...COMMON_OPTIONAL()];
  const seen = new Set<string>();
  return all.filter(l => {
    const k = lineKey(l.name);
    if (have.has(k) || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
