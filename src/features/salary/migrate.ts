// §8 — Migration nháp localStorage v1 → v2.
//
// HAI RÀNG BUỘC TUYỆT ĐỐI: không được mất dữ liệu, và không được ném lỗi. Nháp là việc đang làm
// dở của người dùng; migrate hỏng nghĩa là họ mất trắng công đã gõ. Mọi field đều đọc phòng thủ.
//
// ⚠ CỐ Ý tái tạo ĐÚNG con số cũ (unionFeePercent = 0, shrBhxhMode = 'linked',
// includeHolidayBasePay = false) để mở lại nháp không bị "sốc" vì số nhảy — dù đó KHÔNG phải cấu
// hình đúng nhất về nghiệp vụ. Bù lại phải hiện banner một lần nhắc bật thêm (xem MIGRATION_NOTICE).
import { deriveShr, priceBookFromServiceFee } from './salaryEngine';
import { applyPreset, DEFAULT_VOLUME_PRESET_ID } from './volumePresets';
import { WAGE_ROWS } from './wageRows';
import {
  DEFAULT_OVERHEAD, DEFAULT_PRICE_BOOK,
  type Scenario, type WageCode, type WageBasis, type PriceBook, type AllowanceLine,
  type ServiceFeeConfig, type ServiceFeeType, type ReferralDurationMode, type RegionZone,
} from './types';

export const MIGRATION_NOTICE =
  'Bảng đã nâng cấp. Bật thêm KPCĐ 2%, phần lương ngày lễ và cấu trúc giờ OT để có số chính xác hơn.';

/** 5 option legacy `field:*` của v1 → mã canonical (BUG-6 / §8). */
export const LEGACY_FIELD_MAP: Record<string, WageCode> = {
  'Lương cơ bản': 'base_salary',
  'Ca ngày 8h (Ca 1+2)': 'day_wage_8h',
  'Ca đêm 8h (130%)': 'night_wage_8h',
  'Ca ngày 12h': 'shift12_day',
  'Ca đêm 12h': 'shift12_night',
};

const VALID_CODES = new Set<string>(WAGE_ROWS.map(r => r.code));
const VALID_REGIONS = new Set<string>(['I', 'II', 'III', 'IV']);

/** Nháp v1 — shape thực tế của lib/payroll/draft.ts, mọi field đều có thể thiếu/sai kiểu. */
export interface LegacyDraft {
  companyName?: string; supplierName?: string; contactNote?: string; kcnName?: string;
  companySelect?: string; kcnSelect?: string;
  inputType?: string; inputSourceField?: string | null; inputValue?: string;
  priorDayOt?: boolean;
  serviceFeeType?: string; serviceFeeValue?: string;
  referralDurationMode?: string; referralMonths?: number;
  customerPriceMode?: boolean;
  allowances?: { id?: string; label?: string; amountClient?: string; amountWorker?: string }[];
  rawOverrides?: Record<string, string>;
  clientRates?: Record<string, string>;
  workingDaysPerMonth?: number; region?: string; vatPercent?: string;
}

const num = (v: unknown, fallback = 0): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : fallback;
};

/** Chuẩn hoá loại đơn giá của v1 — chấp cả mã canonical, `field:<tên>` và tên khoản trần. */
export function normalizeWageCode(raw: unknown, sourceField?: string | null): WageCode {
  const s = typeof raw === 'string' ? raw : '';
  if (VALID_CODES.has(s)) return s as WageCode;
  const stripped = s.startsWith('field:') ? s.slice(6) : s;
  if (LEGACY_FIELD_MAP[stripped]) return LEGACY_FIELD_MAP[stripped];
  if (sourceField && LEGACY_FIELD_MAP[sourceField]) return LEGACY_FIELD_MAP[sourceField];
  return 'day_wage_8h';   // mặc định an toàn nhất: mốc chắc chắn nhất trong thực tế
}

const numericRecord = (src: Record<string, string> | undefined): Partial<Record<WageCode, number>> => {
  const out: Partial<Record<WageCode, number>> = {};
  for (const [k, v] of Object.entries(src ?? {})) {
    const code = VALID_CODES.has(k) ? k as WageCode : LEGACY_FIELD_MAP[k.replace(/^field:/, '')];
    const n = num(v);
    if (code && n > 0) out[code] = n;
  }
  return out;
};

export function migrateV1toV2(d: LegacyDraft): Scenario {
  const workdaysPerMonth = Math.max(1, num(d.workingDaysPerMonth, 26));
  const region = (VALID_REGIONS.has(String(d.region)) ? d.region : 'II') as RegionZone;
  const code = normalizeWageCode(d.inputType, d.inputSourceField);
  const overrides = numericRecord(d.rawOverrides);
  const clientRates = numericRecord(d.clientRates);

  // v1 cho phép sửa tay đơn giá giờ thường và coi đó là số thắng → suy SHR từ chính số đó nếu có,
  // đúng thứ tự ưu tiên của monthlyGrossFromOverrides() cũ.
  const inputAmount = num(d.inputValue);
  const shrPay = overrides.base_salary != null
    ? deriveShr('base_salary', overrides.base_salary, workdaysPerMonth)
    : overrides.day_wage_8h != null
      ? deriveShr('day_wage_8h', overrides.day_wage_8h, workdaysPerMonth)
      : deriveShr(code, inputAmount, workdaysPerMonth, { priorDayOt: !!d.priorDayOt });

  const basis: WageBasis = {
    shrPay,
    shrBhxhMode: 'linked',              // ⚠ cố ý: tái tạo đúng số cũ
    workdaysPerMonth,
    region,
    includeHolidayBasePay: false,       // ⚠ cố ý: tái tạo đúng số cũ
    overrides,
    priorDayOt: !!d.priorDayOt,
  };

  const allowances: AllowanceLine[] = (d.allowances ?? []).map((a, i) => ({
    id: a.id || `al_${i}`,
    name: a.label ?? '',
    customerPays: num(a.amountClient),
    weOweWorker: num(a.amountWorker),
    taxable: false,                     // v1 không có khái niệm này; false là phía an toàn
  }));

  // ⚠ VÁCH DOANH THU (BUG-4) chỉ đúng khi doanh thu CHÍNH LÀ phí giới thiệu.
  // Ở v1, bật "nhập thẳng giá khách trả" nghĩa là doanh thu đến từ giá khách — một hợp đồng cung
  // ứng thường xuyên, KHÔNG hết hạn — còn ô loại phí lúc đó không được dùng tới. Bê nguyên loại
  // phí giới thiệu sang v2 sẽ cắt doanh thu từ tháng N+1 và biến một hợp đồng đang lời thành lỗ
  // nặng, mà người dùng không hề đổi gì. Ép về phí lâu dài để giữ ĐÚNG ngữ nghĩa doanh thu của v1.
  const revenueFromCustomerPrice = !!d.customerPriceMode || Object.keys(clientRates).length > 0;
  const rawFeeType = (['per_day_worked', 'referral_hourly', 'referral_daily_limited'] as const)
    .includes(d.serviceFeeType as ServiceFeeType) ? d.serviceFeeType as ServiceFeeType : 'per_day_worked';

  const serviceFee: ServiceFeeConfig = {
    type: revenueFromCustomerPrice ? 'per_day_worked' : rawFeeType,
    value: num(d.serviceFeeValue),
    durationMode: (d.referralDurationMode === 'recurring_months' ? 'recurring_months' : 'one_time') as ReferralDurationMode,
    months: Math.max(1, num(d.referralMonths, 3)),
    feeHoursPerDay: 8,
  };

  const volume = applyPreset(DEFAULT_VOLUME_PRESET_ID, workdaysPerMonth);
  const overhead = { ...DEFAULT_OVERHEAD, unionFeePercent: 0 };   // ⚠ cố ý: tái tạo đúng số cũ
  const vatPercent = num(d.vatPercent, 8);

  // v1 có 2 đường doanh thu song song (BUG-1). Quy về DUY NHẤT priceBook, giữ nguyên ý nghĩa cũ:
  //  • bật "nhập thẳng giá khách trả"      → singleDayRate (1 ngày công = 1 ca 8h)
  //  • có gõ cột "Khách trả ta"            → manual theo từng dòng
  //  • không có gì                         → sinh từ phí dịch vụ (cost-plus), đúng cách v1 lập
  //    invoice; nếu để manual rỗng thì doanh thu tụt về 0 và người dùng tưởng mất dữ liệu.
  const singleDayRate = clientRates.day_wage_8h;
  const priceBook: PriceBook = d.customerPriceMode && singleDayRate != null
    ? { ...DEFAULT_PRICE_BOOK, mode: 'singleDayRate', singleDayRate, vatPercent }
    : Object.keys(clientRates).length > 0
      ? { ...DEFAULT_PRICE_BOOK, mode: 'manual', manual: clientRates, vatPercent }
      : {
        ...DEFAULT_PRICE_BOOK, mode: 'manual', vatPercent,
        manual: priceBookFromServiceFee(basis, volume, allowances, overhead, serviceFee),
      };

  return {
    version: 2,
    customerName: d.companyName ?? '',
    industrialZone: d.kcnName ?? '',
    us: {
      id: 'us',
      supplierName: d.supplierName ?? "Let's Go VN",
      isUs: (d.supplierName ?? "Let's Go VN").trim() === "Let's Go VN",
      contactNote: d.contactNote ?? '',
      basis,
      allowances,
    },
    competitors: [],
    volume,
    priceBook,
    overhead,
    serviceFee,
  };
}

/** Điểm vào duy nhất. Idempotent: migrate(migrate(x)) === migrate(x). */
export function migrate(raw: unknown): Scenario {
  const v = (raw as { version?: number } | null)?.version ?? 1;
  if (v === 2) return raw as Scenario;
  return migrateV1toV2((raw ?? {}) as LegacyDraft);
}
