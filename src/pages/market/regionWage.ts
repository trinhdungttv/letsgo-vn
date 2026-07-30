// ── Lương tối thiểu vùng (Vùng I–IV) — dùng chung cho Khu vực, Lương TT, Công ty/Dự án ──
// Vùng gắn theo TỪNG KCN (market_zones.region_zone). 4 mức tiền là giá trị "hiện hành" ở
// bảng region_wages (migration 111), được tính lại tự động từ region_wage_batches
// (migration 113) — nơi lưu từng lần đổi lương, sửa/xoá trực tiếp được.
import { supabase } from '../../lib/supabase';
import {
  MIN_WAGE_BATCHES, resolveMinWageBatch, resolveMinWage, minWageStaleNotice, isMinWageStale,
  REGION_ZONES as MIN_WAGE_REGIONS, type MinWageBatch, type RegionZone as MinWageRegionZone,
} from '../../lib/minWage';

export type RegionZone = MinWageRegionZone;

// ── Nguồn mức lương tối thiểu ─────────────────────────────────────────────────────────────
// Bảng số nằm ở src/lib/minWage.ts dạng BATCH có effectiveFrom + decree (không phải 1 bộ số
// "hiện hành"), để hợp đồng cũ vẫn tra được mức áp dụng lúc ký. Batch xác thực cuối cùng là
// NĐ 74/2024/NĐ-CP.
//
// THỨ TỰ ƯU TIÊN: region_wage_batches (DB — người dùng tự nhập ở tab Lương TT) THẮNG hardcode.
// Hardcode chỉ là seed dự phòng khi DB trống. Xem mergeBatches() trong lib/minWage.ts.
//
// ⚠ KHÔNG tự điền số nghị định mới vào lib/minWage.ts. Nếu batch mới nhất đã quá 12 tháng,
// isMinWageStale() trả true và UI phải hiện cảnh báo lỗi thời (MinWageStaleBanner) thay vì âm
// thầm dùng số cũ như thể còn hiệu lực.
export {
  MIN_WAGE_BATCHES, resolveMinWageBatch, resolveMinWage, minWageStaleNotice, isMinWageStale,
  type MinWageBatch,
};

/** Batch seed mới nhất, dạng Record — GIỮ cho nút "Khôi phục mức đã xác thực" và giá trị mặc
 *  định của tab Lương TT. Là số DẪN XUẤT từ MIN_WAGE_BATCHES, không phải nguồn riêng. */
const LATEST_SEED = MIN_WAGE_BATCHES[MIN_WAGE_BATCHES.length - 1];

export const OFFICIAL_REGION_WAGES: Record<RegionZone, number> = Object.fromEntries(
  MIN_WAGE_REGIONS.map(z => [z, LATEST_SEED.wages[z]?.monthly ?? 0]),
) as Record<RegionZone, number>;

export const OFFICIAL_EFFECTIVE_DATE = LATEST_SEED.effectiveFrom;
export const OFFICIAL_DECREE = LATEST_SEED.decree;

export const REGION_ZONES: { key: RegionZone; label: string }[] = [
  { key: 'I', label: 'V1' }, { key: 'II', label: 'V2' }, { key: 'III', label: 'V3' }, { key: 'IV', label: 'V4' },
];

export interface RegionWageRow { amount: number; effectiveDate: string }
const defaultRows = (): Record<RegionZone, RegionWageRow> => ({
  I: { amount: OFFICIAL_REGION_WAGES.I, effectiveDate: OFFICIAL_EFFECTIVE_DATE },
  II: { amount: OFFICIAL_REGION_WAGES.II, effectiveDate: OFFICIAL_EFFECTIVE_DATE },
  III: { amount: OFFICIAL_REGION_WAGES.III, effectiveDate: OFFICIAL_EFFECTIVE_DATE },
  IV: { amount: OFFICIAL_REGION_WAGES.IV, effectiveDate: OFFICIAL_EFFECTIVE_DATE },
});

export async function fetchRegionWageRows(): Promise<Record<RegionZone, RegionWageRow>> {
  const { data, error } = await supabase.from('region_wages').select('zone, wage_amount, effective_date');
  if (error || !data || data.length === 0) return defaultRows();
  const rows = defaultRows();
  data.forEach(row => { rows[row.zone as RegionZone] = { amount: Number(row.wage_amount), effectiveDate: row.effective_date }; });
  return rows;
}

// Tương thích các nơi chỉ cần số tiền (Khu vực, Công ty/Dự án) — không cần biết mốc áp dụng.
export async function fetchRegionWages(): Promise<Record<RegionZone, number>> {
  const rows = await fetchRegionWageRows();
  return { I: rows.I.amount, II: rows.II.amount, III: rows.III.amount, IV: rows.IV.amount };
}

// ── Lần nhập lương (region_wage_batches, migration 113) — mỗi lần đổi lương là 1 batch có
// ngày áp dụng riêng, SỬA/XOÁ trực tiếp được (khác data_history chỉ đọc). region_wages
// (bảng "hiện hành") được 1 trigger phía DB tự tính lại từ batch có hiệu lực gần nhất mỗi
// khi bảng batch này thay đổi — không cần gọi lại bằng tay.
export interface RegionWageBatch {
  id: string;
  effectiveDate: string;
  wages: Record<RegionZone, number>;
  note: string | null;
  createdAt: string;
}

const rowToBatch = (r: any): RegionWageBatch => ({
  id: r.id,
  effectiveDate: r.effective_date,
  wages: { I: Number(r.wage_i), II: Number(r.wage_ii), III: Number(r.wage_iii), IV: Number(r.wage_iv) },
  note: r.note,
  createdAt: r.created_at,
});

export async function fetchRegionWageBatches(): Promise<RegionWageBatch[]> {
  const { data, error } = await supabase.from('region_wage_batches').select('*').order('effective_date', { ascending: false });
  if (error || !data) return [];
  return data.map(rowToBatch);
}

/** Các lần nhập lương vùng ở DB, quy về dạng MinWageBatch để đưa vào resolveMinWage().
 *  Bảng region_wage_batches CHỈ có mức THÁNG (migration 113) — mức GIỜ để null, mergeBatches()
 *  sẽ kế thừa mức giờ của seed cùng mốc hiệu lực nếu có. Muốn DB giữ luôn mức giờ thì chạy
 *  migration template supabase/migrations/*_region_wage_batch.sql. */
export async function fetchMinWageBatches(): Promise<MinWageBatch[]> {
  const { data, error } = await supabase.from('region_wage_batches').select('*')
    .order('effective_date', { ascending: false });
  if (error || !data) return [];
  // Cột mức giờ có thể CHƯA tồn tại (migration 113 chỉ có mức tháng) — đọc phòng thủ để hàm này
  // chạy được cả trước và sau khi migration thêm cột, không cần deploy đồng bộ.
  const hourly = (row: Record<string, unknown>, key: string): number | null => {
    const v = row[key];
    return v == null ? null : Number(v) || null;
  };
  return data.map(r => {
    const row = r as Record<string, unknown>;
    return {
      effectiveFrom: String(row.effective_date),
      decree: String(row.note ?? '').trim() || `Lần nhập ${row.effective_date}`,
      wages: {
        I: { monthly: Number(row.wage_i), hourly: hourly(row, 'wage_i_hourly') },
        II: { monthly: Number(row.wage_ii), hourly: hourly(row, 'wage_ii_hourly') },
        III: { monthly: Number(row.wage_iii), hourly: hourly(row, 'wage_iii_hourly') },
        IV: { monthly: Number(row.wage_iv), hourly: hourly(row, 'wage_iv_hourly') },
      },
    };
  });
}

// Thêm/gộp 1 lần nhập — nếu đã có batch đúng ngày này thì cập nhật đè (coi như "sửa" batch
// đó), không tạo ngày trùng nhau.
export async function saveRegionWageBatch(effectiveDate: string, wages: Record<RegionZone, number>, note?: string): Promise<string | null> {
  const { error } = await supabase.from('region_wage_batches').upsert({
    effective_date: effectiveDate, wage_i: wages.I, wage_ii: wages.II, wage_iii: wages.III, wage_iv: wages.IV,
    note: note?.trim() || null,
  }, { onConflict: 'effective_date' });
  return error ? error.message : null;
}

export async function updateRegionWageBatch(id: string, effectiveDate: string, wages: Record<RegionZone, number>, note?: string): Promise<string | null> {
  const { error } = await supabase.from('region_wage_batches').update({
    effective_date: effectiveDate, wage_i: wages.I, wage_ii: wages.II, wage_iii: wages.III, wage_iv: wages.IV,
    note: note?.trim() || null,
  }).eq('id', id);
  return error ? error.message : null;
}

export async function deleteRegionWageBatch(id: string): Promise<string | null> {
  const { error } = await supabase.from('region_wage_batches').delete().eq('id', id);
  return error ? error.message : null;
}

// Nhãn ngắn "V1".."V4" cho 1 mã vùng ('I'..'IV'); null nếu KCN chưa gán vùng.
export const regionZoneLabel = (zone?: string | null): string | null =>
  REGION_ZONES.find(z => z.key === zone)?.label ?? null;

// Màu badge tối giản kiểu Apple, mỗi vùng 1 màu để phân biệt bằng mắt — không cần chữ giải
// thích kèm theo. V1 (đắt đỏ nhất) → xanh dương, giảm dần tới V4 → xám.
const REGION_ZONE_COLOR_CLS: Record<RegionZone, string> = {
  I: 'bg-blue-50 text-blue-600',
  II: 'bg-teal-50 text-teal-600',
  III: 'bg-amber-50 text-amber-600',
  IV: 'bg-slate-100 text-slate-500',
};
export const regionZoneColorCls = (zone?: string | null): string =>
  (zone && REGION_ZONE_COLOR_CLS[zone as RegionZone]) || 'bg-gray-100 text-gray-500';

// Mức lương tối thiểu (đồng) của 1 KCN theo vùng đã gán; null nếu chưa gán vùng.
export const regionWageOf = (zone: string | null | undefined, wages: Record<RegionZone, number>): number | null =>
  zone && zone in wages ? wages[zone as RegionZone] : null;

// Hiển thị lương vùng ĐÚNG số đã nhập (vd 4.96, không làm tròn thành 5.0 như fmtTr dùng
// chung cho khoảng lương ngành nghề) — chỉ bỏ số 0 thừa ở cuối, không ép về 1 chữ số thập phân.
export const fmtRegionWage = (v: number | null | undefined): string =>
  v == null ? '—' : String(Math.round((v / 1_000_000) * 100) / 100);

// Gán 1 vùng cho nhiều KCN cùng lúc — trước đây phải mở từng hồ sơ KCN ở tab Khu vực để
// gán tay từng cái, rất chậm khi có hàng chục KCN cùng 1 tỉnh/vùng.
export async function bulkAssignRegionZone(zoneIds: string[], regionZone: RegionZone): Promise<string | null> {
  if (zoneIds.length === 0) return 'Chưa chọn KCN nào';
  const { error } = await supabase.from('market_zones').update({ region_zone: regionZone }).in('id', zoneIds);
  return error ? error.message : null;
}
