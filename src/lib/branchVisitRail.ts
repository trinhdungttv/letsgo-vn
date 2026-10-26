// Khung «Cập nhật chi nhánh» ở Workspace: chọn chi nhánh nào được hiện / ẩn.
// Chi nhánh thuộc Dự án công ty do công ty tự quản lý → không có liên hệ để chăm sóc → thường muốn ẩn.
// Mọi quyết định ẩn/hiện là của người dùng; ở đây chỉ gợi ý (theo loại hình hiện tại) và lọc.
import type { Branch, BranchType, BranchTypeHistory } from './types';

/** 'YYYY-MM' theo giờ máy — cùng định dạng với branch_type_history.effective_from. */
export function currentMonthKey(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/** Gom lịch sử đổi loại hình theo chi nhánh. */
export function groupTypeHistory(rows: BranchTypeHistory[]): Record<string, BranchTypeHistory[]> {
  const map: Record<string, BranchTypeHistory[]> = {};
  for (const h of rows) (map[h.branch_id] ??= []).push(h);
  return map;
}

/**
 * Loại hình của chi nhánh tại tháng `month`: lấy mốc lịch sử mới nhất đã có hiệu lực
 * (effective_from ≤ month); chưa có mốc nào thì dùng cột branches.branch_type.
 */
export function currentBranchType(
  branch: Pick<Branch, 'branch_type'>,
  history: BranchTypeHistory[] | undefined,
  month: string,
): BranchType {
  let latest: BranchTypeHistory | null = null;
  for (const h of history ?? []) {
    if (h.effective_from.slice(0, 7) > month) continue;
    if (!latest || h.effective_from > latest.effective_from) latest = h;
  }
  return latest ? latest.branch_type : (branch.branch_type || 'contracted');
}

/** id các chi nhánh đang là Dự án công ty — chỉ để gợi ý ẩn. */
export function companyProjectBranchIds(
  branches: Pick<Branch, 'id' | 'branch_type'>[],
  historyByBranch: Record<string, BranchTypeHistory[]>,
  month: string,
): string[] {
  return branches.filter(b => currentBranchType(b, historyByBranch[b.id], month) === 'company').map(b => b.id);
}

/** Bỏ các dòng thuộc chi nhánh đã ẩn. */
export function visibleVisitBranches<T extends { branch: { id: string } }>(items: T[], hiddenIds: readonly string[]): T[] {
  if (!hiddenIds.length) return items;
  const hidden = new Set(hiddenIds);
  return items.filter(x => !hidden.has(x.branch.id));
}

/** Đảo ẩn/hiện một chi nhánh. */
export function toggleHiddenId(hiddenIds: readonly string[], id: string): string[] {
  return hiddenIds.includes(id) ? hiddenIds.filter(x => x !== id) : [...hiddenIds, id];
}

/** Ẩn (hide=true) hoặc hiện (hide=false) cả nhóm chi nhánh một lượt, không tạo trùng. */
export function setHiddenIds(hiddenIds: readonly string[], ids: readonly string[], hide: boolean): string[] {
  if (hide) return [...new Set([...hiddenIds, ...ids])];
  const drop = new Set(ids);
  return hiddenIds.filter(x => !drop.has(x));
}
