// Lương tối thiểu vùng — dạng BATCH có mốc hiệu lực, nguồn dùng chung cho cả app.
//
// VÌ SAO LÀ BATCH CHỨ KHÔNG PHẢI 1 BỘ SỐ: mỗi Nghị định đổi cả 4 vùng cùng lúc, và hợp đồng cũ
// vẫn phải tra được mức áp dụng ở thời điểm ký. Giữ 1 bộ số "hiện hành" duy nhất thì mỗi lần
// Chính phủ ban hành nghị định mới là mất luôn mốc cũ.
//
// ⚠ QUY TẮC BẤT DI BẤT DỊCH — KHÔNG TỰ ĐIỀN SỐ LƯƠNG TỐI THIỂU VÀO ĐÂY.
// Chỉ thêm batch mới sau khi người dùng đã tự đối chiếu công báo và xác nhận từng con số. Sai
// ngưỡng pháp lý nghĩa là để lọt mức lương vi phạm luật, hoặc chặn oan mức hợp lệ — cả hai đều
// tệ hơn là để dữ liệu cũ kèm cảnh báo lỗi thời (xem isMinWageStale bên dưới).
//
// BATCH ĐÃ XÁC THỰC CUỐI CÙNG: Nghị định 74/2024/NĐ-CP, hiệu lực 01/7/2024.
// (Bộ số monthly + hourly dưới đây lấy đúng theo SPEC §4.7 do người dùng cung cấp.)
//
// TODO — CHỜ XÁC NHẬN: có dấu hiệu NĐ 74/2024 đã bị thay bởi một nghị định mới hiệu lực
// 01/01/2026. Bảng số đề xuất đã trình cho người dùng đối chiếu công báo; CHƯA được xác nhận nên
// CHƯA ghi vào đây. Khi có xác nhận: thêm 1 phần tử vào MIN_WAGE_BATCHES (không sửa batch cũ) và
// chạy migration template supabase/migrations/*_region_wage_batch.sql.

export type RegionZone = 'I' | 'II' | 'III' | 'IV';

/** `hourly` = null khi nguồn không khai mức giờ — bảng region_wage_batches chỉ lưu mức THÁNG. */
export interface MinWageAmounts { monthly: number; hourly: number | null }

export interface MinWageBatch {
  effectiveFrom: string;                        // ISO date
  decree: string;
  /** null = batch này không khai mức giờ (vd batch đọc từ DB — bảng chỉ có mức tháng). */
  wages: Record<RegionZone, MinWageAmounts | null>;
}

/** 1 mức đã giải cho 1 vùng tại 1 thời điểm. */
export interface MinWageRule {
  region: RegionZone;
  effectiveFrom: string;
  monthly: number;
  hourly: number | null;
  decree: string;
}

export const REGION_ZONES: RegionZone[] = ['I', 'II', 'III', 'IV'];

/** Seed hardcode — CHỈ dùng khi DB (region_wage_batches) chưa có dữ liệu. DB luôn thắng. */
export const MIN_WAGE_BATCHES: MinWageBatch[] = [
  {
    effectiveFrom: '2024-07-01',
    decree: 'NĐ 74/2024/NĐ-CP',
    wages: {
      I: { monthly: 4_960_000, hourly: 23_800 },
      II: { monthly: 4_410_000, hourly: 21_200 },
      III: { monthly: 3_860_000, hourly: 18_600 },
      IV: { monthly: 3_450_000, hourly: 16_600 },
    },
  },
];

export const MIN_WAGE_STALE_WARNING =
  'Dữ liệu lương tối thiểu vùng có thể đã lỗi thời — kiểm tra nghị định hiện hành';

/** Ngưỡng coi là lỗi thời: batch mới nhất cách hôm nay quá 12 tháng. */
export const MIN_WAGE_STALE_MONTHS = 12;

const toIso = (d: string | Date): string =>
  typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10);

/** Gộp seed hardcode với batch đọc từ DB. Cùng effectiveFrom thì DB THẮNG — người dùng đã nhập
 *  tay ở tab Lương TT nên đó là số họ chủ động xác nhận, đáng tin hơn hằng số trong code.
 *  Batch DB không có mức giờ thì kế thừa mức giờ của seed cùng ngày (nếu có). */
export function mergeBatches(dbBatches: MinWageBatch[] = []): MinWageBatch[] {
  const byDate = new Map<string, MinWageBatch>();
  for (const b of MIN_WAGE_BATCHES) byDate.set(b.effectiveFrom, b);
  for (const b of dbBatches) {
    const seed = byDate.get(b.effectiveFrom);
    byDate.set(b.effectiveFrom, seed
      ? {
        ...b,
        wages: Object.fromEntries(REGION_ZONES.map(z => {
          const dbW = b.wages[z];
          const seedW = seed.wages[z];
          return [z, dbW ? { monthly: dbW.monthly, hourly: dbW.hourly ?? seedW?.hourly ?? null } : seedW];
        })) as Record<RegionZone, MinWageAmounts | null>,
      }
      : b);
  }
  return [...byDate.values()].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
}

/** Batch có hiệu lực gần nhất ≤ atDate. null nếu atDate sớm hơn mọi mốc đã biết. */
export function resolveMinWageBatch(
  atDate: string | Date = new Date(), dbBatches: MinWageBatch[] = [],
): MinWageBatch | null {
  const iso = toIso(atDate);
  const applicable = mergeBatches(dbBatches).filter(b => b.effectiveFrom <= iso);
  return applicable.length > 0 ? applicable[applicable.length - 1] : null;
}

/** Mức áp dụng cho 1 vùng tại 1 thời điểm. null = chưa tra được — nơi gọi PHẢI xử lý null chứ
 *  không được thay bằng 0 hay một mức đoán, vì đó là ngưỡng pháp lý. */
export function resolveMinWage(
  region: RegionZone, atDate: string | Date = new Date(), dbBatches: MinWageBatch[] = [],
): MinWageRule | null {
  const batch = resolveMinWageBatch(atDate, dbBatches);
  const w = batch?.wages[region];
  if (!batch || !w) return null;
  return { region, effectiveFrom: batch.effectiveFrom, monthly: w.monthly, hourly: w.hourly, decree: batch.decree };
}

export const minWageMonthly = (
  region: RegionZone, atDate: string | Date = new Date(), dbBatches: MinWageBatch[] = [],
): number | null => resolveMinWage(region, atDate, dbBatches)?.monthly ?? null;

export const minWageHourly = (
  region: RegionZone, atDate: string | Date = new Date(), dbBatches: MinWageBatch[] = [],
): number | null => resolveMinWage(region, atDate, dbBatches)?.hourly ?? null;

/** Dữ liệu lương tối thiểu đã quá cũ để tin hay chưa. Không có batch nào cũng coi là lỗi thời. */
export function isMinWageStale(
  atDate: string | Date = new Date(), dbBatches: MinWageBatch[] = [],
): boolean {
  const batch = resolveMinWageBatch(atDate, dbBatches);
  if (!batch) return true;
  const at = new Date(toIso(atDate));
  const eff = new Date(batch.effectiveFrom);
  const months = (at.getFullYear() - eff.getFullYear()) * 12 + (at.getMonth() - eff.getMonth());
  return months > MIN_WAGE_STALE_MONTHS;
}

/** Câu cảnh báo kèm ngữ cảnh, hoặc null khi dữ liệu còn mới. Dùng chung để mọi trang hiện y
 *  hệt một câu, không mỗi nơi viết một kiểu. */
export function minWageStaleNotice(
  atDate: string | Date = new Date(), dbBatches: MinWageBatch[] = [],
): string | null {
  if (!isMinWageStale(atDate, dbBatches)) return null;
  const batch = resolveMinWageBatch(atDate, dbBatches);
  return batch
    ? `${MIN_WAGE_STALE_WARNING} (đang dùng ${batch.decree}, hiệu lực ${batch.effectiveFrom}).`
    : `${MIN_WAGE_STALE_WARNING} (chưa có mốc lương tối thiểu nào).`;
}
