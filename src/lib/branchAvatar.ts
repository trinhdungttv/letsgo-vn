// Chữ cái đầu cho avatar chi nhánh khi chưa có ảnh.
// Tên chi nhánh thường bắt đầu bằng "LGV - " nên cắt phần tiền tố này đi, nếu không mọi dòng đều là "LG".

const PREFIX = /^(?:LGV|LG|Let'?s\s*Go(?:\s*VN)?)\s*[-–—:]\s*/i;

export function branchInitials(name: string | null | undefined, shortName?: string | null): string {
  let base = (shortName?.trim() || name?.trim() || '').normalize('NFC');
  const stripped = base.replace(PREFIX, '').trim();
  if (stripped) base = stripped;
  // "Biên Hoà - Ms Thương" → chỉ lấy phần đầu trước dấu gạch
  base = base.split(/\s[-–—]\s/)[0].replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').trim();
  const words = base.split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  const chars = (w: string) => Array.from(w);
  const letters = words.length >= 2 ? [chars(words[0])[0], chars(words[1])[0]] : chars(words[0]).slice(0, 2);
  return letters.join('').toLocaleUpperCase('vi');
}

const normName = (s: string | null | undefined) =>
  (s ?? '').normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('vi');

/**
 * Ảnh của một người quản lý. Hệ thống chỉ lưu ảnh ở Trưởng chi nhánh (branches.manager_avatar_url,
 * sửa trong module Chi nhánh), nên tra theo tên: ưu tiên chi nhánh của chính khách hàng, rồi tới
 * chi nhánh khác mà người này đang là Trưởng. Không ai khớp / chưa có ảnh → null.
 */
export function managerAvatarUrl(
  name: string | null | undefined,
  branches: { id: string; manager_name?: string | null; manager_avatar_url?: string | null }[],
  preferBranchId?: string | null,
): string | null {
  const key = normName(name);
  if (!key) return null;
  const hits = branches.filter(b => b.manager_avatar_url && normName(b.manager_name) === key);
  if (!hits.length) return null;
  return (hits.find(b => b.id === preferBranchId) ?? hits[0]).manager_avatar_url ?? null;
}
