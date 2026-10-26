/** Chuẩn hoá tên KCN để SO KHỚP (không dùng để hiển thị): bỏ dấu, bỏ tiền tố loại hình
 * ("KCN", "Khu công nghiệp", "CCN", "KCX"…), gộp khoảng trắng. Nhờ vậy "BIÊN HOÀ 2" gõ tay
 * ở hồ sơ đối thủ vẫn khớp "KCN Biên Hoà 2" trong market_zones. */
export const zoneKey = (s?: string | null) => (s ?? '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase()
  .replace(/[.,\-–—()]/g, ' ')
  .replace(/\b(khu cong nghiep|cum cong nghiep|khu che xuat|khu kinh te|kcn|ccn|kcx|kkt)\b/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

/** So khớp CHẶT 2 tên khu vực (sau khi chuẩn hoá phải bằng nhau).
 * Khác zoneMatches() kiểu "includes" ở WageTab/Quotes: ở đây "Tân Phú" KHÔNG khớp
 * "Tân Phú Trung" — dùng cho việc ghi nhận đối thủ theo KCN, nơi khớp nhầm nguy hiểm hơn bỏ sót. */
export const sameZone = (a?: string | null, b?: string | null) => {
  const ka = zoneKey(a);
  return !!ka && ka === zoneKey(b);
};

/** Giá trị mang nghĩa "phủ toàn quốc" hay gặp trong ô Trụ sở/Khu vực hoạt động của đối thủ. */
export const isNationwide = (s?: string | null) => ['toan quoc', 'ca nuoc', 'toan mien nam', 'toan mien bac'].includes(zoneKey(s));
