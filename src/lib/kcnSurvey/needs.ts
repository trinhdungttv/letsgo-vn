// Nhu cầu của công ty treo bảng tuyển (migration 225 — cột kcn_survey_photos.labor_needs):
//   nhóm "Nhu cầu":   Cung ứng (cho thuê lại lao động) / Giới thiệu (tuyển hộ)
//   nhóm "Hình thức": Thời vụ / Chính thức
// Chọn cả 2 trong 1 nhóm = cần cả hai. Để lọc nhanh ở tab Khảo sát KCN.

export type LaborNeed = 'cung_ung' | 'gioi_thieu' | 'thoi_vu' | 'chinh_thuc';

export const NEED_GROUPS: { id: 'service' | 'term'; label: string; items: { id: LaborNeed; label: string }[] }[] = [
  { id: 'service', label: 'Nhu cầu', items: [{ id: 'cung_ung', label: 'Cung ứng' }, { id: 'gioi_thieu', label: 'Giới thiệu' }] },
  { id: 'term', label: 'Hình thức', items: [{ id: 'thoi_vu', label: 'Thời vụ' }, { id: 'chinh_thuc', label: 'Chính thức' }] },
];

const ORDER: LaborNeed[] = NEED_GROUPS.flatMap(g => g.items.map(i => i.id));
export const NEED_LABEL: Record<LaborNeed, string> = Object.fromEntries(NEED_GROUPS.flatMap(g => g.items.map(i => [i.id, i.label]))) as Record<LaborNeed, string>;

export const isLaborNeed = (v: unknown): v is LaborNeed => typeof v === 'string' && (ORDER as string[]).includes(v);

/** Dữ liệu DB / localStorage → danh sách hợp lệ, đúng thứ tự, không trùng */
export function sanitizeNeeds(v: unknown): LaborNeed[] {
  if (!Array.isArray(v)) return [];
  const set = new Set(v.filter(isLaborNeed));
  return ORDER.filter(n => set.has(n));
}

export function toggleNeed(list: readonly LaborNeed[], n: LaborNeed): LaborNeed[] {
  return list.includes(n) ? list.filter(x => x !== n) : sanitizeNeeds([...list, n]);
}

export const sameNeeds = (a: readonly LaborNeed[], b: readonly LaborNeed[]) => sanitizeNeeds(a).join() === sanitizeNeeds(b).join();

/** "Giới thiệu · Thời vụ + Chính thức" ('' = chưa ghi) */
export function needsText(list: readonly LaborNeed[]): string {
  const set = new Set(list);
  return NEED_GROUPS.map(g => g.items.filter(i => set.has(i.id)).map(i => i.label).join(' + ')).filter(Boolean).join(' · ');
}

/** Lọc: ảnh phải có ĐỦ các nhu cầu đang chọn (bộ lọc rỗng = không lọc) */
export const matchesNeeds = (photo: readonly LaborNeed[], filter: readonly LaborNeed[]) => filter.every(n => photo.includes(n));
