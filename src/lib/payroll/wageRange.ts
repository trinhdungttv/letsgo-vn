// Khoảng lương cho 1 trường chi tiết lương (VD Lương CB: 240.000 – 260.000, vì 1 công ty có nhiều bộ phận).
//
// Cách lưu: giá trị THẤP vẫn nằm ở khoá gốc (wage_detail["Lương CB"] = 240000) nên MỌI phép tính cũ
// (đơn giá giờ, tổng tháng, so sánh) tiếp tục chạy bằng mức thấp; giá trị CAO nằm ở khoá phụ
// "<tên trường>__max" cùng trong object đó (không cần cột/migration mới, đi theo cả NCC, báo giá…).
// Mọi chỗ DUYỆT toàn bộ khoá của wage_detail phải bỏ khoá phụ này bằng isRangeKey()/withoutRange().
export const RANGE_SUFFIX = '__max';
export const rangeKey = (field: string) => field + RANGE_SUFFIX;
export const isRangeKey = (key: string) => key.endsWith(RANGE_SUFFIX);

export function withoutRange<T>(d: Record<string, T> | null | undefined): Record<string, T> {
  return Object.fromEntries(Object.entries(d ?? {}).filter(([k]) => !isRangeKey(k)));
}

/** "240.000 – 260.000" nếu có khoảng, "240.000" nếu 1 giá trị, '—' nếu trống. */
export function rangeLabel(d: Record<string, number> | null | undefined, field: string, fmt: (n: number) => string): string {
  const lo = d?.[field];
  if (lo == null) return '—';
  const hi = d?.[rangeKey(field)];
  return hi != null && hi > lo ? `${fmt(lo)} – ${fmt(hi)}` : fmt(lo);
}
