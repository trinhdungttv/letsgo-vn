// Tỉnh / thành của đơn vị nguồn — theo 34 tỉnh, thành phố SAU SÁP NHẬP (có hiệu lực 1/7/2025, Nghị quyết 202/2025/QH15).
// Mỗi tỉnh mới ghi kèm các tỉnh cũ đã gộp vào để người dùng chọn đúng ("Bình Dương" nay thuộc TP. Hồ Chí Minh).
// Hàm thuần, có test. Cột lưu vẫn là labor_sources.province (chữ tự do) → không cần migration.
import { provinceKey, provinceLabel } from '../kcnSurvey/province';

export interface NewProvince {
  /** Tên lưu vào cột province. TP. trực thuộc TW có tiền tố "TP." chỉ ở Hồ Chí Minh (giống nhãn của Khảo sát KCN). */
  name: string;
  /** Các tỉnh / thành CŨ đã gộp vào (không kể chính tên này). */
  merged: readonly string[];
}

export const NEW_PROVINCES: readonly NewProvince[] = [
  // 11 tỉnh / thành giữ nguyên (Huế được nâng lên thành phố trực thuộc TW)
  { name: 'Hà Nội', merged: [] },
  { name: 'Huế', merged: ['Thừa Thiên Huế'] },
  { name: 'Lai Châu', merged: [] },
  { name: 'Điện Biên', merged: [] },
  { name: 'Sơn La', merged: [] },
  { name: 'Lạng Sơn', merged: [] },
  { name: 'Quảng Ninh', merged: [] },
  { name: 'Thanh Hóa', merged: [] },
  { name: 'Nghệ An', merged: [] },
  { name: 'Hà Tĩnh', merged: [] },
  { name: 'Cao Bằng', merged: [] },
  // 23 tỉnh / thành sau khi gộp
  { name: 'Tuyên Quang', merged: ['Hà Giang'] },
  { name: 'Lào Cai', merged: ['Yên Bái'] },
  { name: 'Thái Nguyên', merged: ['Bắc Kạn'] },
  { name: 'Phú Thọ', merged: ['Vĩnh Phúc', 'Hòa Bình'] },
  { name: 'Bắc Ninh', merged: ['Bắc Giang'] },
  { name: 'Hưng Yên', merged: ['Thái Bình'] },
  { name: 'Hải Phòng', merged: ['Hải Dương'] },
  { name: 'Ninh Bình', merged: ['Hà Nam', 'Nam Định'] },
  { name: 'Quảng Trị', merged: ['Quảng Bình'] },
  { name: 'Đà Nẵng', merged: ['Quảng Nam'] },
  { name: 'Quảng Ngãi', merged: ['Kon Tum'] },
  { name: 'Gia Lai', merged: ['Bình Định'] },
  { name: 'Khánh Hòa', merged: ['Ninh Thuận'] },
  { name: 'Lâm Đồng', merged: ['Đắk Nông', 'Bình Thuận'] },
  { name: 'Đắk Lắk', merged: ['Phú Yên'] },
  { name: 'TP. Hồ Chí Minh', merged: ['Bình Dương', 'Bà Rịa - Vũng Tàu'] },
  { name: 'Đồng Nai', merged: ['Bình Phước'] },
  { name: 'Tây Ninh', merged: ['Long An'] },
  { name: 'Cần Thơ', merged: ['Sóc Trăng', 'Hậu Giang'] },
  { name: 'Vĩnh Long', merged: ['Bến Tre', 'Trà Vinh'] },
  { name: 'Đồng Tháp', merged: ['Tiền Giang'] },
  { name: 'Cà Mau', merged: ['Bạc Liêu'] },
  { name: 'An Giang', merged: ['Kiên Giang'] },
];

/** Danh sách cho ô chọn: xếp A → Z tiếng Việt (TP. Hồ Chí Minh xếp theo chữ "Hồ"). */
export const NEW_PROVINCES_SORTED: readonly NewProvince[] = [...NEW_PROVINCES]
  .sort((a, b) => provinceLabel(a.name).localeCompare(provinceLabel(b.name), 'vi'));

const BY_OWN_KEY = new Map(NEW_PROVINCES.map(p => [provinceKey(p.name), p]));
const BY_OLD_KEY = new Map(NEW_PROVINCES.flatMap(p => p.merged.map(m => [provinceKey(m), p] as const)));

/** Chuỗi này đúng là tên 1 tỉnh MỚI (bất kể cách viết hoa / "TP." / "Tỉnh")? → tên chuẩn để lưu, ngược lại null. */
export function canonicalNewProvince(raw: string | null | undefined): string | null {
  const k = provinceKey(raw);
  return k ? BY_OWN_KEY.get(k)?.name ?? null : null;
}

/** Tỉnh MỚI chứa 1 tỉnh CŨ đã bị gộp ("Bình Dương" → TP. Hồ Chí Minh). Không phải tỉnh cũ đã gộp → null. */
export function newProvinceOfMerged(raw: string | null | undefined): string | null {
  const k = provinceKey(raw);
  return k ? BY_OLD_KEY.get(k)?.name ?? null : null;
}

/**
 * Bộ lọc tỉnh ở Bản đồ: đơn vị nguồn có khớp không? Tỉnh so theo khoá chuẩn ("TP. Hồ Chí Minh" = "Hồ Chí Minh").
 * Đơn vị CHƯA GHI TỈNH vẫn hiện — chưa biết thuộc đâu ≠ không thuộc, không được loại âm thầm (nếu loại, Bản đồ đếm
 * "Nguồn LĐ · 0" dù trường đã có toạ độ).
 */
export function sourceInProvinceFilter(sourceProvince: string | null | undefined, filter: string): boolean {
  if (filter === 'all') return true;
  const key = provinceKey(sourceProvince);
  if (!key) return true;
  return key === provinceKey(filter);
}
