// Nháp v2 của màn "Tính bảng lương" (SPEC §8).
//
// Nháp v1 KHÔNG bị xoá khi đọc — chỉ đọc rồi migrate sang v2. Nếu bản v2 có sự cố phải quay lại
// bản cũ, dữ liệu người dùng vẫn còn nguyên ở khoá cũ. Xoá đi là mất đường lui.
import { migrate, MIGRATION_NOTICE } from './migrate';
import { loadDraft as loadLegacyDraft } from '../../lib/payroll/draft';
import type { Scenario, WageCode } from './types';

const KEY_V2 = 'payroll_calc_draft_v2';

/** State của màn hình KHÔNG thuộc mô hình tài chính (id bản ghi đang chọn, cách gõ liệu…).
 *  Tách khỏi Scenario để Scenario giữ đúng vai trò "mô hình thuần" mà engine nhận. */
export interface DraftUiState {
  companySelect: string;
  kcnSelect: string;
  /** Mã đơn giá đang dùng để GÕ cho ta — chỉ là cách nhập, không đổi bản chất SHR. */
  entryCode: WageCode;
  /** Tên khoản bên Thị trường đã chọn (nếu gõ theo tên khoản thay vì mã luật). */
  entrySourceField: string | null;
  /** Mã đơn giá đang dùng để gõ cho từng đối thủ, theo id NCC. */
  competitorEntryCodes: Record<string, WageCode>;
  deltaPercent: number;
}

export const DEFAULT_UI: DraftUiState = {
  companySelect: '', kcnSelect: '', entryCode: 'day_wage_8h', entrySourceField: null,
  competitorEntryCodes: {}, deltaPercent: 2,
};

export interface DraftV2 {
  scenario: Scenario;
  ui: DraftUiState;
  /** Vừa được nâng từ nháp v1 lên — để hiện MIGRATION_NOTICE đúng một lần. */
  migratedFromV1?: boolean;
}

export { MIGRATION_NOTICE };

export function loadDraftV2(): DraftV2 {
  try {
    const raw = localStorage.getItem(KEY_V2);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<DraftV2>;
      if (parsed?.scenario) {
        return { scenario: migrate(parsed.scenario), ui: { ...DEFAULT_UI, ...parsed.ui } };
      }
    }
  } catch { /* nháp v2 hỏng → rơi xuống thử v1 bên dưới, không chặn người dùng làm việc */ }

  // Chưa có v2: nâng từ v1. loadLegacyDraft() đã tự nuốt lỗi và trả {} khi hỏng.
  const legacy = loadLegacyDraft();
  const scenario = migrate(legacy);
  const hadContent = Object.keys(legacy).length > 0;
  return {
    scenario,
    ui: {
      ...DEFAULT_UI,
      companySelect: legacy.companySelect ?? '',
      kcnSelect: legacy.kcnSelect ?? '',
      entrySourceField: legacy.inputSourceField ?? null,
    },
    migratedFromV1: hadContent,
  };
}

export function saveDraftV2(scenario: Scenario, ui: DraftUiState): void {
  try { localStorage.setItem(KEY_V2, JSON.stringify({ scenario, ui })); } catch { /* hết quota — bỏ qua */ }
}

export function clearDraftV2(): void {
  try { localStorage.removeItem(KEY_V2); } catch { /* bỏ qua */ }
}

/** Có nội dung đáng kể chưa — để không nhắc "đang có nháp" khi người dùng chỉ mở rồi đóng. */
export function draftV2HasContent(d: DraftV2): boolean {
  const s = d.scenario;
  return !!(
    s.customerName.trim() || s.industrialZone.trim()
    || s.us.basis.shrPay > 0
    || s.us.allowances.length > 0
    || s.competitors.length > 0
    || Object.keys(s.us.basis.overrides).length > 0
    || Object.keys(s.priceBook.manual).length > 0
  );
}
