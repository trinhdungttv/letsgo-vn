// ============================================================================
// CSKH — Danh mục tỉnh / thành để chọn QUÊ QUÁN (chỉ cần tỉnh).
// Dùng 63 tỉnh / thành truyền thống (trước sáp nhập 1/7/2025): người ta vẫn nói quê theo tỉnh
// cũ ("quê Nam Định", "quê Thái Bình"), AI "Tìm hiểu vùng miền" hiểu đúng bản sắc vùng đó và
// Nominatim vẫn tra được tâm tỉnh để vẽ lên bản đồ.
// ============================================================================

export const VN_PROVINCES: readonly string[] = [
  'An Giang', 'Bà Rịa - Vũng Tàu', 'Bạc Liêu', 'Bắc Giang', 'Bắc Kạn', 'Bắc Ninh', 'Bến Tre', 'Bình Dương',
  'Bình Định', 'Bình Phước', 'Bình Thuận', 'Cà Mau', 'Cao Bằng', 'Cần Thơ', 'Đà Nẵng', 'Đắk Lắk', 'Đắk Nông',
  'Điện Biên', 'Đồng Nai', 'Đồng Tháp', 'Gia Lai', 'Hà Giang', 'Hà Nam', 'Hà Nội', 'Hà Tĩnh', 'Hải Dương',
  'Hải Phòng', 'Hậu Giang', 'Hòa Bình', 'Hồ Chí Minh', 'Hưng Yên', 'Khánh Hòa', 'Kiên Giang', 'Kon Tum',
  'Lai Châu', 'Lạng Sơn', 'Lào Cai', 'Lâm Đồng', 'Long An', 'Nam Định', 'Nghệ An', 'Ninh Bình', 'Ninh Thuận',
  'Phú Thọ', 'Phú Yên', 'Quảng Bình', 'Quảng Nam', 'Quảng Ngãi', 'Quảng Ninh', 'Quảng Trị', 'Sóc Trăng',
  'Sơn La', 'Tây Ninh', 'Thái Bình', 'Thái Nguyên', 'Thanh Hóa', 'Thừa Thiên Huế', 'Tiền Giang', 'Trà Vinh',
  'Tuyên Quang', 'Vĩnh Long', 'Vĩnh Phúc', 'Yên Bái',
];

/** Danh sách cho ô chọn: 63 tỉnh + tên khác đang có trong dữ liệu (giữ được giá trị cũ), xếp A→Z tiếng Việt. */
export function provinceOptions(extra: readonly string[] = []): string[] {
  const set = new Set(VN_PROVINCES);
  for (const p of extra) if (p.trim()) set.add(p.trim());
  return [...set].sort((a, b) => a.localeCompare(b, 'vi'));
}
