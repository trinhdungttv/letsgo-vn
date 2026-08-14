// ─────────────────────────────────────────────────────────────────────────────
// Chi nhánh — một nguồn dữ liệu duy nhất.
//
// Trước đây mỗi màn hình tự nối Khách hàng ↔ Chi nhánh theo kiểu riêng: chỗ thì
// so `client.region === branch.region`, chỗ thì so mò trong `[name, region,
// short_name]`, chỗ thì hiển thị `branch.region || branch.name`. Vì `region` là
// TÊN CŨ nên tên cũ rò rỉ ra khắp giao diện và không bao giờ xoá được.
//
// Từ migration 138, `clients.branch_id` là khoá thật. Mọi màn hình dùng các hàm
// dưới đây thay vì tự so chuỗi — sửa quy tắc thì sửa một chỗ.
// ─────────────────────────────────────────────────────────────────────────────
import type { Branch } from './types'

/** Thứ gì có thể gắn với một chi nhánh: khách hàng, dòng pipeline, việc... */
type HasBranch = { branch_id?: string | null; region?: string | null }

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase()

/**
 * Tên hiển thị chuẩn của chi nhánh. LUÔN dùng hàm này khi in tên chi nhánh ra
 * màn hình — không đọc `branch.region` (tên cũ) hay `branch.short_name`.
 */
export function branchLabel(b: Branch | null | undefined): string {
  return b?.name?.trim() || '—'
}

/**
 * Tra chi nhánh từ một chuỗi text cũ (region / name / short_name).
 * Chỉ dùng cho dữ liệu chưa kịp backfill sang branch_id — không dùng cho code mới.
 */
export function resolveBranchByLegacyText(
  text: string | null | undefined,
  branches: Branch[]
): Branch | null {
  const key = norm(text)
  if (!key) return null
  return (
    branches.find(b => norm(b.region) === key) ??
    branches.find(b => norm(b.name) === key) ??
    branches.find(b => norm(b.short_name) === key) ??
    null
  )
}

/**
 * Chi nhánh của một bản ghi. Ưu tiên tuyệt đối `branch_id`; chỉ khi bản ghi cũ
 * chưa có branch_id mới dò theo chuỗi `region` để màn hình không bị trống.
 */
export function branchOf(row: HasBranch | null | undefined, branches: Branch[]): Branch | null {
  if (!row) return null
  if (row.branch_id) return branches.find(b => b.id === row.branch_id) ?? null
  return resolveBranchByLegacyText(row.region, branches)
}

/** Tên chi nhánh của một bản ghi, sẵn sàng để in ra màn hình. */
export function branchLabelOf(row: HasBranch | null | undefined, branches: Branch[]): string {
  return branchLabel(branchOf(row, branches))
}

/** Bản ghi đã được gán chi nhánh chưa — dùng để hiện cảnh báo "Chưa gán chi nhánh". */
export function hasBranch(row: HasBranch | null | undefined, branches: Branch[]): boolean {
  return branchOf(row, branches) !== null
}

/** Danh sách chi nhánh cho <select>, sắp theo tên chuẩn. */
export function branchOptions(branches: Branch[]): { id: string; label: string }[] {
  return branches
    .map(b => ({ id: b.id, label: branchLabel(b) }))
    .sort((a, b) => a.label.localeCompare(b.label, 'vi'))
}
