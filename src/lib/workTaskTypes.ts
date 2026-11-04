// ============================================================================
// Loại việc (work_tasks.task_type) — GỘP GỌN 04/11/2026.
// ----------------------------------------------------------------------------
// Trước: 9 loại phẳng (Tái ký HĐ, Hợp đồng, Phụ lục, Báo giá, Thăm quan, Hỏi thăm CN, Xử lý phát sinh,
// Văn phòng, Khác). Nay ô "Loại việc" chỉ còn 5 NHÓM:
//
//   Hợp đồng        ← chọn tiếp 1 trong 3: HĐ mới / Tái ký / Phụ lục
//   Báo giá
//   Gặp khách       ← gộp Thăm quan + Hỏi thăm CN
//   Xử lý phát sinh
//   Nội bộ / Khác   ← gộp Văn phòng + Khác (+ việc CSKH / Sale tự tạo từ nhật ký CSKH)
//
// KHÔNG ĐỔI DỮ LIỆU CŨ: cột task_type giữ nguyên giá trị đã lưu, chỉ GỘP LÚC ĐỌC (taskGroupOf).
// Ba loại con của Hợp đồng vẫn LƯU ĐÚNG giá trị cũ ('Hợp đồng' / 'Tái ký HĐ' / 'Phụ lục') vì nhiều luồng
// đọc thẳng các giá trị đó:
//   • 'Tái ký HĐ' — các bước hồ sơ (Chưa soạn → Hoàn tất / Ngưng HĐ), bấm Xong thì cập nhật ngày HĐ của
//     khách, rail "HĐ cần xử lý", AlertsTasksPanel, Báo cáo (lọc .eq('task_type','Tái ký HĐ')).
//   • 'Hợp đồng' / 'Phụ lục' — bảng thay đổi & nội dung HĐ (ContractCompareTables), Phụ lục thuộc HĐ cha,
//     khối "Hợp đồng & Phụ lục" ở hồ sơ Khách hàng (.in('task_type', ['Hợp đồng','Phụ lục'])).
// Việc TẠO MỚI ở 3 nhóm còn lại lưu đúng tên nhóm ('Gặp khách', 'Nội bộ / Khác'…); việc cũ 'Thăm quan',
// 'Văn phòng'… vẫn nằm yên trong DB và tự rơi vào đúng nhóm khi hiển thị / lọc.
// ============================================================================

export type TaskGroup = 'Hợp đồng' | 'Báo giá' | 'Gặp khách' | 'Xử lý phát sinh' | 'Nội bộ / Khác';

/** Thứ tự hiện trong ô "Loại việc". */
export const TASK_GROUPS: readonly TaskGroup[] = ['Hợp đồng', 'Báo giá', 'Gặp khách', 'Xử lý phát sinh', 'Nội bộ / Khác'];

/** Loại con của nhóm Hợp đồng — `value` là giá trị LƯU VÀO DB (giữ nguyên như trước khi gộp). */
export const CONTRACT_KINDS: readonly { value: string; label: string; hint: string }[] = [
  { value: 'Hợp đồng', label: 'HĐ mới', hint: 'Có bảng thay đổi & nội dung HĐ, thêm Phụ lục thuộc HĐ' },
  { value: 'Tái ký HĐ', label: 'Tái ký', hint: 'Theo dõi các bước hồ sơ; bấm Xong sẽ cập nhật hạn HĐ mới của khách' },
  { value: 'Phụ lục', label: 'Phụ lục', hint: 'Thuộc 1 Hợp đồng đã có của khách' },
];

const CONTRACT_VALUES = new Set(CONTRACT_KINDS.map(k => k.value));

/** Giá trị cũ (trước khi gộp) → nhóm mới. Giá trị nào không có ở đây và không phải tên nhóm → Nội bộ / Khác. */
const LEGACY_GROUP: Readonly<Record<string, TaskGroup>> = {
  'Thăm quan': 'Gặp khách',
  'Hỏi thăm CN': 'Gặp khách',
  'Văn phòng': 'Nội bộ / Khác',
  'Khác': 'Nội bộ / Khác',
};

/** Nhóm của 1 việc theo task_type đã lưu (cả giá trị cũ lẫn mới). */
export function taskGroupOf(taskType: string | null | undefined): TaskGroup {
  const t = (taskType ?? '').trim();
  if (CONTRACT_VALUES.has(t)) return 'Hợp đồng';
  if ((TASK_GROUPS as readonly string[]).includes(t)) return t as TaskGroup;
  return LEGACY_GROUP[t] ?? 'Nội bộ / Khác';
}

/** Giá trị lưu khi chọn 1 nhóm trong ô "Loại việc" (Hợp đồng: mặc định HĐ mới, đổi ở nút loại con). */
export function storedTypeOfGroup(group: TaskGroup, contractKind?: string): string {
  if (group === 'Hợp đồng') return contractKind && CONTRACT_VALUES.has(contractKind) ? contractKind : 'Hợp đồng';
  return group;
}

/**
 * Đưa 1 lựa chọn đã nhớ (localStorage "loại việc lần trước", có thể là giá trị cũ như 'Thăm quan')
 * về giá trị chọn được trong form mới.
 */
export function normalizeTaskTypeChoice(stored: string | null | undefined): string {
  const t = (stored ?? '').trim();
  if (CONTRACT_VALUES.has(t)) return t;
  return storedTypeOfGroup(taskGroupOf(t));
}

/**
 * Nhãn hiển thị trên dòng việc / lịch sử: "Hợp đồng · Tái ký", "Gặp khách · Thăm quan" (việc cũ giữ chi tiết
 * loại gốc), "Báo giá"… Việc CSKH / Sale tự tạo thì giữ đúng tên đó (dễ nhận ra hơn "Nội bộ / Khác").
 */
export function taskTypeLabel(taskType: string | null | undefined): string {
  const t = (taskType ?? '').trim();
  if (!t) return 'Nội bộ / Khác';
  const kind = CONTRACT_KINDS.find(k => k.value === t);
  if (kind) return `Hợp đồng · ${kind.label}`;
  if ((TASK_GROUPS as readonly string[]).includes(t)) return t;
  const g = LEGACY_GROUP[t];
  if (g === 'Gặp khách') return `${g} · ${t}`;
  if (g) return g;
  return t; // CSKH, Sale, giá trị lạ — giữ nguyên chữ đã lưu
}
