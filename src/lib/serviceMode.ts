// Hai dịch vụ của Let's Go VN — nhãn & quy tắc dùng chung (migration 184):
//   CHO THUÊ lao động (thời vụ): Let's Go ký HĐ với NLĐ, trả lương + BHXH, thu lương + phí dịch vụ theo công/tháng.
//   GIỚI THIỆU lao động (chính thức): khách ký HĐ trực tiếp với NLĐ, Let's Go thu phí / người khi làm đủ N ngày.
// Quy ước hiển thị: nhãn "GT" màu tím = giới thiệu (ServiceTypeBadge), không nhãn = cho thuê.
import { supabase } from './supabase';

/** Hình thức của đối thủ / báo giá CRM: làm 1 trong 2 hay cả hai. */
export type ServiceMode = 'leasing' | 'recruitment' | 'both';
/** Nhu cầu của khách: thời vụ (cho thuê) / chính thức (giới thiệu) / cả hai. */
export type NeedType = 'leasing' | 'direct' | 'both';

export const SERVICE_MODE_LABEL: Readonly<Record<ServiceMode, string>> = {
  leasing: 'Cho thuê lao động',
  recruitment: 'Giới thiệu lao động',
  both: 'Cả hai',
};
export const NEED_LABEL: Readonly<Record<NeedType, string>> = {
  leasing: 'Thời vụ (cho thuê)',
  direct: 'Chính thức (giới thiệu)',
  both: 'Cả thời vụ & chính thức',
};

/** Nhu cầu → hình thức dịch vụ chính của thẻ khách hàng khi chốt hợp tác. Cả hai → cho thuê (GT ghi ở P&L). */
export const needToServiceType = (n: NeedType | ServiceMode | null | undefined): 'leasing' | 'recruitment' =>
  n === 'direct' || n === 'recruitment' ? 'recruitment' : 'leasing';

export interface ReferralTerms {
  /** làm đủ bao nhiêu ngày thì tính phí */
  minDays: number;
  /** bảo hành: nghỉ trong N ngày sau khi tính phí → giới thiệu người thay miễn phí */
  guaranteeDays: number;
}
export const DEFAULT_REFERRAL_TERMS: ReferralTerms = { minDays: 30, guaranteeDays: 30 };

export function normalizeTerms(raw: unknown): ReferralTerms {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<ReferralTerms>;
  const n = (v: unknown, d: number) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.round(Number(v)) : d);
  return { minDays: n(r.minDays, DEFAULT_REFERRAL_TERMS.minDays), guaranteeDays: n(r.guaranteeDays, DEFAULT_REFERRAL_TERMS.guaranteeDays) };
}

/** Câu điều khoản giới thiệu in lên báo giá. */
export function referralTermsText(t: ReferralTerms, noWorkerFee = true): string[] {
  return [
    'Người lao động ký hợp đồng lao động và nhận lương trực tiếp từ Quý công ty.',
    `Phí giới thiệu tính cho mỗi người làm đủ ${t.minDays} ngày; nghỉ trước ${t.minDays} ngày không tính phí.`,
    ...(t.guaranteeDays > 0 ? [`Bảo hành ${t.guaranteeDays} ngày: người lao động nghỉ trong thời gian này được giới thiệu người thay miễn phí.`] : []),
    ...(noWorkerFee ? ["Let's Go VN không thu bất kỳ khoản phí nào của người lao động."] : []),
  ];
}

/** Trung bình phí giới thiệu của các đối thủ có làm giới thiệu (null = chưa có số liệu). */
export function avgReferralFee(list: { service_mode?: ServiceMode | null; referral_fee?: number | null }[]): { avg: number; min: number; max: number; n: number } | null {
  const fees = list.filter(c => (c.service_mode === 'recruitment' || c.service_mode === 'both') && c.referral_fee != null && c.referral_fee > 0)
    .map(c => c.referral_fee as number);
  if (!fees.length) return null;
  return { avg: fees.reduce((a, b) => a + b, 0) / fees.length, min: Math.min(...fees), max: Math.max(...fees), n: fees.length };
}

// ── Cột mới của migration 184: database chưa chạy migration thì bỏ cột khỏi lệnh ghi (không làm hỏng
//    thao tác chính) — cùng cách competitorClients.ts đang làm. Dò 1 lần mỗi phiên. ──
const probes = new Map<string, Promise<boolean>>();
export function hasColumn(table: string, column: string): Promise<boolean> {
  const key = `${table}.${column}`;
  if (!probes.has(key)) {
    probes.set(key, Promise.resolve(supabase.from(table).select(column).limit(1)).then(({ error }) => !error, () => false));
  }
  return probes.get(key)!;
}

/** Bỏ khỏi payload các cột (trong `optional`) mà database chưa có. */
export async function pruneMissing<T extends Record<string, unknown>>(table: string, payload: T, optional: readonly string[]): Promise<T> {
  const out: Record<string, unknown> = { ...payload };
  for (const col of optional) if (col in out && !(await hasColumn(table, col))) delete out[col];
  return out as T;
}
