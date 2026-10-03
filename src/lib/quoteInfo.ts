// Thông tin báo giá điền sẵn cho 1 công ty ở CRM Pipeline (crm_pipeline.quote_info, migration 156).
// Cố ý dùng đúng 3 bậc của tab Báo giá tự động (Phổ thông / Tay nghề / Kỹ thuật viên) để sau này
// đổ sang file báo giá không phải quy đổi lại.

export type QuoteUnit = 'ngày công' | 'giờ' | 'tháng';
export const QUOTE_UNITS: QuoteUnit[] = ['ngày công', 'giờ', 'tháng'];

export interface QuoteInfoLine {
  id: string;
  /** Hạng mục / vị trí, vd "Phổ thông", "Tay nghề", "Kỹ thuật viên", "Tổ trưởng". */
  label: string;
  /** Số lao động dự kiến — để chuỗi để cho phép ô trống. */
  workers: string;
  /** Đơn giá lương trả người lao động (đ / đơn vị). */
  wage: number | null;
  /** Phí dịch vụ Let's Go VN (đ / đơn vị). */
  fee: number | null;
  unit: QuoteUnit;
  note: string;
}

export interface QuoteInfo {
  tax_code: string;
  address: string;
  contact_person: string;
  contact_phone: string;
  zone: string;
  industry: string;
  /** yyyy-mm-dd */
  valid_until: string;
  payment_terms: string;
  note: string;
  lines: QuoteInfoLine[];
  updated_at?: string;
}

export const newLineId = () => Math.random().toString(36).slice(2, 10);

export const emptyLine = (label = ''): QuoteInfoLine => ({ id: newLineId(), label, workers: '', wage: null, fee: null, unit: 'ngày công', note: '' });

export const emptyQuoteInfo = (): QuoteInfo => ({
  tax_code: '', address: '', contact_person: '', contact_phone: '', zone: '', industry: '',
  valid_until: '', payment_terms: '', note: '', lines: [],
});

/** Ba dòng chuẩn theo tab Báo giá tự động. */
export const standardLines = (): QuoteInfoLine[] => ['Phổ thông', 'Tay nghề', 'Kỹ thuật viên'].map(l => emptyLine(l));

/** Giá bán ra / đơn vị = lương + phí dịch vụ (cùng cách tính ở bảng Báo giá tự động). */
export const lineTotal = (l: QuoteInfoLine): number => (l.wage ?? 0) + (l.fee ?? 0);

/** Chuẩn hoá giá trị đọc từ DB (có thể null/thiếu trường) về dạng đầy đủ. */
export function normalizeQuoteInfo(raw: unknown): QuoteInfo {
  const base = emptyQuoteInfo();
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Partial<QuoteInfo>;
  return {
    ...base, ...r,
    lines: Array.isArray(r.lines) ? r.lines.map(l => ({ ...emptyLine(), ...l, id: l.id || newLineId() })) : [],
  };
}

export const quoteInfoIsEmpty = (q: QuoteInfo) =>
  q.lines.length === 0 && !q.tax_code && !q.address && !q.contact_person && !q.contact_phone && !q.zone
  && !q.industry && !q.valid_until && !q.payment_terms && !q.note;
