// ─────────────────────────────────────────────────────────────────────────────
// Nguồn của công ty trong CRM Pipeline — ai/đâu mang dự án về (migration 162).
//
//   sale     → 1 nhân viên sale        (source_name, gõ tự do có gợi ý)
//   partner  → đối tác giới thiệu      (source_name, gõ tự do có gợi ý)
//   company  → chính công ty Let's Go
//   branch   → 1 chi nhánh             (source_branch_id → luôn in branches.name)
//
// Không lấy từ danh sách Khách hàng. Khoá lọc gộp tên không phân biệt hoa/thường
// và khoảng trắng thừa, để "anh Hùng" và "Anh  Hùng" ra cùng một người giới thiệu.
// ─────────────────────────────────────────────────────────────────────────────
import type { Branch, CRMPipelineEntry } from './types'
import { branchLabel } from './branchRef'

export type PipelineSourceType = 'sale' | 'partner' | 'company' | 'branch'

export interface PipelineSource {
  source_type: PipelineSourceType | null
  source_name: string | null
  source_branch_id: string | null
}

export const EMPTY_SOURCE: PipelineSource = { source_type: null, source_name: null, source_branch_id: null }

export const SOURCE_TYPES: { id: PipelineSourceType; label: string; short: string; chip: string; groupAll?: string }[] = [
  { id: 'sale',    label: 'Sale',               short: 'Sale',      chip: 'bg-sky-50 text-sky-700 border-sky-200',             groupAll: 'Tất cả sale' },
  { id: 'partner', label: 'Đối tác giới thiệu', short: 'Đối tác GT', chip: 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200', groupAll: 'Tất cả đối tác' },
  { id: 'company', label: "Công ty (Let's Go)", short: 'Công ty',   chip: 'bg-slate-100 text-slate-600 border-slate-200' },
  { id: 'branch',  label: 'Chi nhánh',          short: 'Chi nhánh', chip: 'bg-teal-50 text-teal-700 border-teal-200',          groupAll: 'Tất cả chi nhánh' },
]

export const sourceTypeOf = (t: string | null | undefined) => SOURCE_TYPES.find(s => s.id === t) ?? null

/** Loại nguồn cần gõ tên người/đối tác. */
export const sourceNeedsName = (t: PipelineSourceType | null | undefined) => t === 'sale' || t === 'partner'

const normName = (s: string | null | undefined) => (s ?? '').trim().replace(/\s+/g, ' ').toLowerCase()

/** Lấy 3 trường nguồn của một dòng pipeline. */
export function sourceOf(e: Partial<CRMPipelineEntry>): PipelineSource {
  return {
    source_type: (e.source_type as PipelineSourceType | null) ?? null,
    source_name: e.source_name ?? null,
    source_branch_id: e.source_branch_id ?? null,
  }
}

/** Chuẩn hoá trước khi lưu: bỏ trường không thuộc loại nguồn đã chọn. */
export function cleanSource(s: PipelineSource): PipelineSource {
  switch (s.source_type) {
    case 'sale':
    case 'partner':
      return { source_type: s.source_type, source_name: s.source_name?.trim().replace(/\s+/g, ' ') || null, source_branch_id: null }
    case 'branch':
      return { source_type: 'branch', source_name: null, source_branch_id: s.source_branch_id || null }
    case 'company':
      return { source_type: 'company', source_name: null, source_branch_id: null }
    default:
      return EMPTY_SOURCE
  }
}

export const sameSource = (a: PipelineSource, b: PipelineSource) => {
  const x = cleanSource(a), y = cleanSource(b)
  return x.source_type === y.source_type && normName(x.source_name) === normName(y.source_name) && x.source_branch_id === y.source_branch_id
}

/** Nhãn gọn trên thẻ kanban: tên sale/đối tác, tên chi nhánh, hoặc "Công ty". null = chưa ghi nguồn. */
export function sourceShortLabel(e: Partial<CRMPipelineEntry>, branches: Branch[]): string | null {
  const t = sourceTypeOf(e.source_type)
  if (!t) return null
  if (t.id === 'branch') {
    const b = branches.find(x => x.id === e.source_branch_id)
    return b ? branchLabel(b) : t.short
  }
  if (t.id === 'company') return t.short
  return e.source_name?.trim() || t.short
}

/** Nhãn đầy đủ: "Đối tác giới thiệu — Minh Phát". Dùng cho tooltip và nhật ký. */
export function sourceFullLabel(e: Partial<CRMPipelineEntry>, branches: Branch[]): string {
  const t = sourceTypeOf(e.source_type)
  if (!t) return 'Chưa ghi nguồn'
  if (t.id === 'company') return t.label
  const detail = t.id === 'branch'
    ? branchLabel(branches.find(x => x.id === e.source_branch_id))
    : e.source_name?.trim() || ''
  return detail && detail !== '—' ? `${t.label} — ${detail}` : t.label
}

/** Khoá lọc của một dòng: 'none' | 'company' | 'branch:<id>' | 'sale:<tên>' | 'partner:<tên>'. */
export function sourceKey(e: Partial<CRMPipelineEntry>): string {
  const t = e.source_type
  if (!sourceTypeOf(t)) return 'none'
  if (t === 'company') return 'company'
  if (t === 'branch') return `branch:${e.source_branch_id ?? ''}`
  return `${t}:${normName(e.source_name)}`
}

/** Bộ lọc: 'all', 'type:<loại>' (cả nhóm), hoặc đúng một khoá của sourceKey. */
export function matchesSourceFilter(e: Partial<CRMPipelineEntry>, filter: string): boolean {
  if (filter === 'all') return true
  if (filter.startsWith('type:')) return e.source_type === filter.slice(5)
  return sourceKey(e) === filter
}

export interface SourceFilterGroup {
  label: string
  options: { key: string; label: string; count: number }[]
}

/** Các nhóm lựa chọn cho ô lọc "Nguồn", kèm số công ty mỗi lựa chọn. */
export function sourceFilterGroups(entries: CRMPipelineEntry[], branches: Branch[]): SourceFilterGroup[] {
  // Gom theo khoá lọc, giữ cách viết tên gặp đầu tiên.
  const itemsOf = (rows: CRMPipelineEntry[]) => {
    const byKey = new Map<string, { label: string; count: number }>()
    for (const e of rows) {
      const k = sourceKey(e)
      const cur = byKey.get(k)
      if (cur) cur.count++
      else byKey.set(k, { label: sourceShortLabel(e, branches) ?? '', count: 1 })
    }
    return [...byKey.entries()]
      .map(([key, v]) => ({ key, ...v }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'vi'))
  }
  const groups: SourceFilterGroup[] = []
  for (const t of SOURCE_TYPES.filter(x => sourceNeedsName(x.id))) {
    const rows = entries.filter(e => e.source_type === t.id)
    if (rows.length) groups.push({ label: t.label, options: [{ key: `type:${t.id}`, label: t.groupAll ?? t.label, count: rows.length }, ...itemsOf(rows)] })
  }
  const company = entries.filter(e => e.source_type === 'company').length
  const branchRows = entries.filter(e => e.source_type === 'branch')
  const internal = [
    ...(company ? [{ key: 'company', label: sourceTypeOf('company')!.label, count: company }] : []),
    ...(branchRows.length ? [{ key: 'type:branch', label: sourceTypeOf('branch')!.groupAll!, count: branchRows.length }, ...itemsOf(branchRows)] : []),
  ]
  if (internal.length) groups.push({ label: 'Công ty / Chi nhánh', options: internal })
  return groups
}

/** Gộp danh sách tên gợi ý, bỏ trùng không phân biệt hoa/thường. */
export function uniqueNames(names: (string | null | undefined)[]): string[] {
  const seen = new Map<string, string>()
  for (const n of names) {
    const v = n?.trim().replace(/\s+/g, ' ')
    if (v && !seen.has(normName(v))) seen.set(normName(v), v)
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b, 'vi'))
}

/** Lỗi lưu do chưa chạy migration 162 → câu nhắc dễ hiểu. */
export function sourceSaveErrorHint(message: string): string | null {
  return /source_(type|name|branch_id)/.test(message)
    ? 'Chưa lưu được Nguồn — cần chạy migration 162 (crm_pipeline_source) trên Supabase.'
    : null
}
