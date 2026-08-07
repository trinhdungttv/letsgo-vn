// ─── Ngưng hợp tác: mốc thời gian & quy tắc nhập liệu ────────────────────────
//
// Quy tắc gốc (áp dụng thống nhất toàn hệ thống):
//   THÁNG CHỨA NGÀY NGƯNG VẪN NHẬP LIỆU BÌNH THƯỜNG.
//   Ví dụ khách ngưng 30/06/2026 → tháng 06/2026 vẫn nhập được P&L Dự án và số
//   lao động; từ tháng 07/2026 trở đi mới coi là đã ngưng.
//
// Lý do: doanh thu/chi phí và số LĐ của tháng cuối cùng chỉ chốt được SAU khi
// tháng đó kết thúc, tức là sau ngày ngưng. Chặn ngay từ ngày ngưng sẽ làm mất
// dữ liệu tháng cuối.
//
// suspended_from = ngày ngưng thật (người dùng nhập).
// suspended_at   = thời điểm bấm nút trên hệ thống (dấu vết thao tác) — chỉ dùng
//                  làm phương án dự phòng cho dữ liệu cũ chưa có suspended_from.

type SuspendableClient = {
  cooperation_status?: 'active' | 'suspended' | string | null;
  suspended_from?: string | null;
  suspended_at?: string | null;
};

export function isSuspended(c: SuspendableClient | null | undefined): boolean {
  return c?.cooperation_status === 'suspended';
}

/** Ngày ngưng thật dạng 'YYYY-MM-DD' (fallback về ngày bấm nút cho dữ liệu cũ). */
export function suspensionDate(c: SuspendableClient | null | undefined): string | null {
  if (!isSuspended(c)) return null;
  if (c?.suspended_from) return c.suspended_from.slice(0, 10);
  if (c?.suspended_at) return c.suspended_at.slice(0, 10);
  return null;
}

/** Tháng ngưng dạng 'YYYY-MM' — tháng CUỐI CÙNG còn được nhập liệu. */
export function suspensionMonth(c: SuspendableClient | null | undefined): string | null {
  return suspensionDate(c)?.slice(0, 7) ?? null;
}

/**
 * Khách hàng còn "sống" trong tháng `month` ('YYYY-MM') hay không.
 * Dùng cho mọi màn hình có chọn tháng: P&L Dự án, timeline tài chính, báo cáo…
 * Khách chưa ngưng → luôn true. Khách ngưng nhưng thiếu mốc ngày → coi như đã
 * ngưng hẳn (an toàn: không tự bịa ra tháng còn hiệu lực).
 */
export function isActiveInMonth(c: SuspendableClient | null | undefined, month: string): boolean {
  if (!isSuspended(c)) return true;
  const sm = suspensionMonth(c);
  return sm != null && month <= sm;
}

/** Khách hàng còn hoạt động trong tuần thuộc tháng `month` ('YYYY-MM'). */
export const isActiveInWeekOfMonth = isActiveInMonth;

/** "30/06/2026" */
export function formatSuspensionDate(c: SuspendableClient | null | undefined): string | null {
  const d = suspensionDate(c);
  if (!d) return null;
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y}`;
}

/**
 * Đã ngưng bao lâu tính đến `now`: "2 năm 3 tháng", "5 tháng", "12 ngày".
 * Trả null nếu khách chưa ngưng hoặc không có mốc ngày.
 */
export function suspendedDuration(c: SuspendableClient | null | undefined, now = new Date()): string | null {
  const d = suspensionDate(c);
  if (!d) return null;
  const [y, m, day] = d.split('-').map(Number);
  const from = new Date(y, m - 1, day);
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayMs = 24 * 60 * 60 * 1000;
  const diffDays = Math.round((to.getTime() - from.getTime()) / dayMs);
  if (diffDays < 0) return 'chưa tới ngày ngưng';
  if (diffDays === 0) return 'hôm nay';
  if (diffDays < 31) return `${diffDays} ngày`;

  let months = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
  if (to.getDate() < from.getDate()) months -= 1;
  if (months < 12) return `${months} tháng`;
  const years = Math.floor(months / 12);
  const rem = months % 12;
  return rem ? `${years} năm ${rem} tháng` : `${years} năm`;
}

/** "Ngưng từ 30/06/2026 · đã ngưng 5 tháng" — nhãn hiển thị dùng chung. */
export function suspensionLabel(c: SuspendableClient | null | undefined, now = new Date()): string | null {
  const date = formatSuspensionDate(c);
  if (!date) return isSuspended(c) ? 'Đã ngưng hợp tác (chưa có ngày ngưng)' : null;
  const dur = suspendedDuration(c, now);
  return dur ? `Ngưng từ ${date} · đã ngưng ${dur}` : `Ngưng từ ${date}`;
}

/** Hôm nay dạng 'YYYY-MM-DD' theo giờ máy (dùng làm giá trị mặc định cho ô chọn ngày). */
export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 'YYYY-MM' → "T6/2026" */
export function shortMonth(month: string): string {
  const [y, m] = month.split('-');
  return `T${Number(m)}/${y}`;
}
