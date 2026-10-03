// Phương án giá — kiểu dữ liệu dùng chung cho engine, giao diện, trang link chia sẻ.
// Toàn bộ phương án (settings + lines + notes) lưu nguyên 1 cục jsonb ở cost_plans.data.

/** fixed = nhập số tiền · percent = % của một "cơ sở" · leave = quy phép năm có lương ra đ/công */
export type LineMode = 'fixed' | 'percent' | 'leave';

/**
 * Cơ sở tính % — chia 2 nhóm để KHÔNG BAO GIỜ có vòng tròn phụ thuộc:
 *  • dòng thường  : base_wage | insurable | worker_fixed  (chỉ gồm các dòng NHẬP TAY)
 *  • dòng Phí DV  : thêm cost_total | worker_total        (gồm cả các dòng tính theo %)
 */
export type PercentBase = 'base_wage' | 'insurable' | 'worker_fixed' | 'cost_total' | 'worker_total';

export type LineGroup = 'worker' | 'compliance' | 'service' | 'other';

export interface CostLine {
  id: string;
  name: string;
  group: LineGroup;
  mode: LineMode;
  /** Chỉ dùng cho mode fixed: đơn vị người dùng nhập (đ/công hay đ/tháng). Giá trị gõ vào giữ NGUYÊN, ô còn lại là số quy đổi. */
  unit: 'day' | 'month';
  /** fixed: số tiền theo `unit` · percent: số % · leave: số ngày phép/năm */
  value: number;
  base?: PercentBase;
  /** Khoản này đi thẳng vào túi người lao động (lương, phụ cấp) */
  paidToWorker: boolean;
  /** Dòng lương cơ bản — gốc của mọi khoản tính theo % */
  isBaseWage?: boolean;
  /** Tính vào lương đóng BHXH (lương cơ bản luôn được tính) */
  insurable?: boolean;
  /** Phí dịch vụ = phần lợi nhuận của công ty/chi nhánh */
  isServiceFee?: boolean;
  /** Trần của cơ sở tính %, đ/tháng (vd trần đóng BHXH = 20 × lương cơ sở) */
  cap?: number;
  note: string;
}

export type TaxOption = 'profit20' | 'total20' | 'none';
export type RoundTo = 0 | 100 | 500 | 1000;

export interface PlanSettings {
  /** Định mức ngày công chuẩn / tháng — quy đổi ngày ⇄ tháng */
  baseDays: number;
  taxOption: TaxOption;
  /** VAT chỉ để HIỂN THỊ giá đã VAT, không ảnh hưởng lợi nhuận */
  vatRate: 0 | 0.08 | 0.1;
  /** Làm tròn LÊN giá báo khách / công; phần dôi ra cộng vào lợi nhuận */
  roundTo: RoundTo;
  workers: number;
  simDays: number;
  /** % lợi nhuận về công ty (Let's Go). Phần còn lại về chi nhánh. */
  companyPct: number;
}

/** Các dòng chuẩn của bảng giá dịch vụ gửi khách (theo luật: Điều 98 BLLĐ 2019, Điều 57 NĐ 145/2020). */
export type QuoteRowKind =
  | 'day8' | 'night8' | 'ot_day' | 'ot_night' | 'ot_sun' | 'ot_sun_night' | 'ot_hol' | 'ot_hol_night' | 'custom';

export interface QuoteRowCfg {
  id: string;
  kind: QuoteRowKind;
  name: string;
  /** Đơn vị tính (VNĐ/ngày, VNĐ/giờ…) */
  unit: string;
  /** Giá gõ tay — có thì thay cho giá tự tính. Dòng "custom" luôn dùng số này. */
  override?: number | null;
  hidden?: boolean;
}

/** Cấu hình "Bảng giá dịch vụ" (bước 2 — Báo giá khách). */
export interface QuoteSheet {
  rows: QuoteRowCfg[];
  /** "Bao gồm: …" — null = tự lấy từ tên các khoản ở bước 1 */
  includedNote: string | null;
  generalNotes: string;
  /** Cơ sở tính giờ tăng ca: chỉ lương cơ bản, hay toàn bộ thu nhập trả NLĐ (kể cả phụ cấp) */
  otBase: 'base' | 'worker';
  /** Cộng thêm % lên giá tăng ca (0 = bán đúng bằng chi phí lương tăng ca) */
  otMarkupPct: number;
  /** Tăng ca đêm ngày thường nối liền sau ca ngày (hệ số 210% thay vì 200%) */
  nightOtAfterDay: boolean;
}

export interface PlanData {
  settings: PlanSettings;
  lines: CostLine[];
  notes: string;
  quote?: QuoteSheet | null;
  /** Các trường người dùng đã điền/sửa trên tài liệu báo giá (bản PDF) — lưu cùng phương án */
  doc?: import('./quoteDoc').QuoteDoc | null;
  /** Ảnh chụp lương tối thiểu vùng lúc chủ phương án lưu — để người xem qua link cũng thấy cảnh báo lương thấp hơn mức tối thiểu. */
  minWage?: { monthly: number; label: string } | null;
}

export interface LineResult {
  daily: number;
  monthly: number;
  /** Số này do công thức tính ra (không phải gõ tay) */
  derived: boolean;
}

export interface PlanWarning {
  level: 'error' | 'warn' | 'info';
  text: string;
  lineId?: string;
}

export interface PlanResult {
  lines: Record<string, LineResult>;
  baseWageDaily: number;
  insurableDaily: number;
  workerDaily: number;
  workerMonthly: number;
  /** Tổng chi phí trực tiếp / công, gồm cả Phí DV, trước thuế */
  directDaily: number;
  /** Chi phí trực tiếp KHÔNG gồm Phí DV */
  costDaily: number;
  serviceFeeDaily: number;
  taxDaily: number;
  /** Giá / công trước khi làm tròn */
  quoteRawDaily: number;
  /** Giá báo khách / công (đã làm tròn, chưa VAT) */
  quoteDaily: number;
  roundingGainDaily: number;
  quoteMonthly: number;
  quoteWithVatDaily: number;
  /** Phí DV + phần làm tròn dôi ra = lợi nhuận / công */
  profitDaily: number;
  totalManDays: number;
  revenueMonthly: number;
  profitMonthly: number;
  companyProfit: number;
  branchProfit: number;
  companyPerDay: number;
  branchPerDay: number;
  marginPct: number;
  warnings: PlanWarning[];
}

/** Bản số đã chốt lưu kèm phương án (cost_plans.summary) — để gợi ý & liệt kê không phải tính lại. */
export interface PlanSummary {
  quoteDaily: number;
  workerDaily: number;
  serviceFeeDaily: number;
  profitDaily: number;
  profitMonthly: number;
  marginPct: number;
  workers: number;
  baseWageMonthly: number;
  companyPct: number;
  lineCount: number;
}

export interface SharedInfo {
  code: string;
  can_edit: boolean;
  expires_at: string | null;
  revoked: boolean;
  open_count: number;
  last_opened_at: string | null;
  locked_until: string | null;
}

export type PlanStatus = 'draft' | 'final' | 'archived';

/** 1 hàng cost_plans (thêm `share` khi lấy từ cost_plan_list). */
export interface CostPlanRow {
  id: string;
  title: string;
  industry: string | null;
  zone_name: string | null;
  zone_id: string | null;
  branch_id: string | null;
  pipeline_id: string | null;
  client_id: string | null;
  company_name: string | null;
  status: PlanStatus;
  data: PlanData;
  summary: PlanSummary | null;
  version: number;
  created_by: string | null;
  created_by_name: string | null;
  updated_by_name: string | null;
  created_at: string;
  updated_at: string;
  share?: SharedInfo | null;
}

export interface PlanRevision {
  id: number;
  plan_id: string;
  version: number;
  title: string | null;
  status: string | null;
  data: PlanData;
  summary: PlanSummary | null;
  editor: string | null;
  via: 'app' | 'link';
  note: string | null;
  created_at: string;
}
