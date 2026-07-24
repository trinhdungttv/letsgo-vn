// ── Lương tối thiểu vùng (Vùng I–IV) — dùng chung cho Khu vực, Lương TT, Công ty/Dự án ──
// Vùng gắn theo TỪNG KCN (market_zones.region_zone). 4 mức tiền là giá trị "hiện hành" ở
// bảng region_wages (migration 111), được tính lại tự động từ region_wage_batches
// (migration 113) — nơi lưu từng lần đổi lương, sửa/xoá trực tiếp được.
import { supabase } from '../../lib/supabase';

export type RegionZone = 'I' | 'II' | 'III' | 'IV';

// Nghị định 74/2024/NĐ-CP, áp dụng từ 01/7/2024 (đồng/tháng) — dùng làm giá trị mặc định
// khi bảng chưa có dữ liệu, và cho nút "Khôi phục mức 2024".
export const OFFICIAL_REGION_WAGES: Record<RegionZone, number> = {
  I: 4_960_000, II: 4_410_000, III: 3_860_000, IV: 3_450_000,
};
export const OFFICIAL_EFFECTIVE_DATE = '2024-07-01';

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
