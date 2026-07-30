// Bản nháp "Tính bảng lương" — modal bị unmount hẳn khi đóng (Workspace render có điều kiện),
// nên mọi thứ đang gõ dở sẽ mất sạch nếu không lưu lại. Khác với prefs.ts (chỉ nhớ vài lựa chọn
// mặc định như vùng/ngày công), file này chụp NGUYÊN form để mở lại là làm việc tiếp được.
//
// Lưu localStorage chứ không phải DB: đây là việc đang làm dở của từng người trên từng máy, chưa
// phải số liệu chốt (số chốt mới bấm "Lưu báo giá" → quote_requests).
import type { PayrollInputType } from './coefficients';
import type { AllowanceItem } from './rateCard';

const DRAFT_KEY = 'payroll_calc_draft_v1';

export interface PayrollDraft {
  companySelect: string;
  companyName: string;
  supplierName: string;
  contactNote: string;
  kcnSelect: string;
  kcnName: string;
  inputType: PayrollInputType;
  inputSourceField: string | null;
  inputValue: string;
  priorDayOt: boolean;
  serviceFeeType: string;
  serviceFeeValue: string;
  referralDurationMode: string;
  referralMonths: number;
  customerPriceMode: boolean;
  allowances: AllowanceItem[];
  rawOverrides: Partial<Record<PayrollInputType, string>>;
  clientRates: Partial<Record<PayrollInputType, string>>;
}

export function loadDraft(): Partial<PayrollDraft> {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed as Partial<PayrollDraft> : {};
  } catch {
    return {}; // nháp hỏng/không đọc được thì mở form trắng, không chặn người dùng làm việc
  }
}

export function saveDraft(draft: PayrollDraft): void {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch { /* hết quota/chặn — bỏ qua */ }
}

export function clearDraft(): void {
  try { localStorage.removeItem(DRAFT_KEY); } catch { /* bỏ qua */ }
}

/** Nháp có nội dung đáng kể hay không — dùng để chỉ hiện nhắc "đang có bản nháp" khi thật sự
 *  có số liệu, tránh làm phiền khi người dùng chỉ mở modal lên rồi đóng lại. */
export function draftHasContent(d: Partial<PayrollDraft>): boolean {
  return !!(
    d.companyName?.trim() || d.inputValue?.trim() || d.contactNote?.trim() || d.kcnName?.trim()
    || (d.allowances?.length ?? 0) > 0
    || Object.keys(d.rawOverrides ?? {}).length > 0
    || Object.keys(d.clientRates ?? {}).length > 0
  );
}
