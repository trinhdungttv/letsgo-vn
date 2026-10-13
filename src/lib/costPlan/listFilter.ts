// Bộ lọc danh sách "Phương án giá": tìm chữ + ngành + tỉnh/TP + KCN + chi nhánh + trạng thái.
//
// Tỉnh/TP không lưu trên phương án — suy ra từ KCN (market_zones.location, cùng cách tab Thị trường
// làm), nên sửa tỉnh của KCN ở Thị trường thì bộ lọc tự theo. Phương án chưa gắn KCN thì không thuộc tỉnh nào.
import type { CostPlanRow, PlanStatus } from './types'
import { isReferralPlan } from './referral'

export interface ZoneRef { id: string; name: string; location?: string | null }
export interface BranchRef { id: string; name: string }

export interface PlanListFilter {
  q: string
  industry: string
  province: string
  zone: string
  branch: string
  /** '' = mọi loại dịch vụ */
  service: '' | 'supply' | 'referral'
  /** '' = đang dùng (mọi trạng thái trừ Lưu trữ) */
  status: '' | PlanStatus
}

export const EMPTY_PLAN_FILTER: PlanListFilter = { q: '', industry: '', province: '', zone: '', branch: '', service: '', status: '' }

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase()

/** Tra KCN của phương án: ưu tiên zone_id, rồi tới tên (không phân biệt hoa/thường). */
export function zoneOfPlan(p: Pick<CostPlanRow, 'zone_id' | 'zone_name'>, zones: ZoneRef[]): ZoneRef | null {
  if (p.zone_id) { const z = zones.find(x => x.id === p.zone_id); if (z) return z }
  const k = norm(p.zone_name)
  return k ? zones.find(x => norm(x.name) === k) ?? null : null
}

export function provinceOfPlan(p: Pick<CostPlanRow, 'zone_id' | 'zone_name'>, zones: ZoneRef[]): string | null {
  const z = zoneOfPlan(p, zones)
  return z?.location?.trim() || null
}

/** Tên KCN để lọc/hiển thị — tên chuẩn của hồ sơ KCN nếu tra được, không thì tên lưu trên phương án. */
export function zoneLabelOfPlan(p: Pick<CostPlanRow, 'zone_id' | 'zone_name'>, zones: ZoneRef[]): string | null {
  return zoneOfPlan(p, zones)?.name ?? (p.zone_name?.trim() || null)
}

export function matchesStatus(p: CostPlanRow, status: PlanListFilter['status']): boolean {
  return status ? p.status === status : p.status !== 'archived'
}

export function filterPlans(plans: CostPlanRow[], f: PlanListFilter, zones: ZoneRef[], branches: BranchRef[]): CostPlanRow[] {
  const k = norm(f.q)
  return plans.filter(p => {
    if (!matchesStatus(p, f.status)) return false
    if (f.industry && p.industry !== f.industry) return false
    if (f.province && provinceOfPlan(p, zones) !== f.province) return false
    if (f.zone && zoneLabelOfPlan(p, zones) !== f.zone) return false
    if (f.branch && p.branch_id !== f.branch) return false
    if (f.service && (isReferralPlan(p) ? 'referral' : 'supply') !== f.service) return false
    if (!k) return true
    const branchName = branches.find(b => b.id === p.branch_id)?.name
    return [p.title, p.company_name, p.zone_name, p.industry, provinceOfPlan(p, zones), branchName].some(x => norm(x).includes(k))
  })
}

export interface FilterOption { value: string; label: string; count: number }

const tally = (values: { value: string; label: string }[]): FilterOption[] => {
  const m = new Map<string, FilterOption>()
  for (const v of values) {
    const cur = m.get(v.value)
    if (cur) cur.count++
    else m.set(v.value, { ...v, count: 1 })
  }
  return [...m.values()].sort((a, b) => a.label.localeCompare(b.label, 'vi'))
}

/**
 * Lựa chọn cho các ô lọc, kèm số phương án — chỉ liệt kê giá trị THỰC SỰ có trong danh sách.
 * Đếm trên các phương án khớp trạng thái đang chọn; ô KCN chỉ hiện KCN thuộc tỉnh đang chọn.
 */
export function planFilterOptions(plans: CostPlanRow[], f: PlanListFilter, zones: ZoneRef[], branches: BranchRef[]) {
  const base = plans.filter(p => matchesStatus(p, f.status))
  const industries = tally(base.filter(p => p.industry).map(p => ({ value: p.industry!, label: p.industry! })))
  const provinces = tally(base.flatMap(p => { const v = provinceOfPlan(p, zones); return v ? [{ value: v, label: v }] : [] }))
  const zoneOpts = tally(base
    .filter(p => !f.province || provinceOfPlan(p, zones) === f.province)
    .flatMap(p => { const v = zoneLabelOfPlan(p, zones); return v ? [{ value: v, label: v }] : [] }))
  const branchOpts = tally(base.flatMap(p => {
    const b = branches.find(x => x.id === p.branch_id)
    return b ? [{ value: b.id, label: b.name.trim() }] : []
  }))
  // Giá trị đang chọn luôn có trong danh sách (đếm 0) — đổi trạng thái không làm ô chọn hiện sai "Mọi …".
  const keep = (opts: FilterOption[], value: string, label: string) =>
    value && !opts.some(o => o.value === value) ? [{ value, label, count: 0 }, ...opts] : opts
  return {
    industries: keep(industries, f.industry, f.industry),
    provinces: keep(provinces, f.province, f.province),
    zones: keep(zoneOpts, f.zone, f.zone),
    branches: keep(branchOpts, f.branch, branches.find(b => b.id === f.branch)?.name.trim() ?? f.branch),
  }
}

export const isFiltering = (f: PlanListFilter) => !!(f.q.trim() || f.industry || f.province || f.zone || f.branch || f.service)
