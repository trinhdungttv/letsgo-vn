// Báo cáo khảo sát KCN (kcn_visits) — phần ẢNH CHỤP dữ liệu Thị trường tại thời điểm khảo sát.
//
// Vì sao là ảnh chụp: mỗi lần đi khảo sát số đối thủ và mức lương khu vực khác nhau (tháng 1 có
// 10 đối thủ, tháng 10 chỉ còn 3). Báo cáo phải giữ NGUYÊN danh sách lúc đó, không đổi theo khi
// dữ liệu Thị trường thay đổi về sau. Nên báo cáo lưu bản sao (id + tên + ghi chú), không lưu
// tham chiếu sống tới competitors / market_surveys.
//
// File này chỉ chứa hàm thuần (không gọi database) để test được; phần tải dữ liệu nằm ở
// components/workspace/KCNVisitHistory.tsx.
import type { MarketSurvey } from './types'
import { sameZone } from './zoneMatch'

/* ───────────────────────────── Đối thủ ───────────────────────────── */

/** Vì sao đối thủ hiện trong danh sách — cùng 3 tín hiệu với khối "Đối thủ đang hoạt động tại
 *  KCN này" bên Thị trường; 'added' = người dùng tự thêm và Thị trường chưa có tín hiệu nào. */
export type CompetitorSignal = 'recorded' | 'hq' | 'supplying' | 'added'

export interface SurveyCompetitorEntry {
  id: string
  name: string
  /** Ghi chú ngắn riêng của chuyến khảo sát này (vd "đang tuyển gấp 200 LĐ"). */
  note: string
  signals: CompetitorSignal[]
  /** Số LĐ đối thủ biết tại KCN lúc chụp (cộng các nhà máy đã biết); 0 = chưa rõ. */
  workers: number
}

/** Phần hồ sơ đối thủ mà logic ở đây cần — `Competitor` đầy đủ truyền vào được. */
export interface CompetitorLike {
  id: string
  company_name: string
  zone_name?: string | null
  active_zones?: string[] | null
}

/** Dòng "đang cung ứng" tối thiểu: competitor_clients thật HOẶC dòng suy ra từ thẻ Công ty/Dự án
 *  (dòng suy ra mang thêm `zones` = mọi KCN của công ty đó). */
export interface SupplyRowLike {
  competitor_id: string
  kcn?: string | null
  worker_count?: number | null
  zones?: string[]
}

const supplyAtZone = (r: SupplyRowLike, zoneName: string) =>
  sameZone(r.kcn, zoneName) || (r.zones ?? []).some(z => sameZone(z, zoneName))

export function competitorPresence(zoneName: string, c: CompetitorLike, supplyRows: SupplyRowLike[]) {
  const signals: CompetitorSignal[] = []
  if ((c.active_zones ?? []).some(z => sameZone(z, zoneName))) signals.push('recorded')
  if (sameZone(c.zone_name, zoneName)) signals.push('hq')
  const factories = supplyRows.filter(r => r.competitor_id === c.id && supplyAtZone(r, zoneName))
  if (factories.length) signals.push('supplying')
  return { signals, workers: factories.reduce((s, r) => s + (r.worker_count ?? 0), 0) }
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'vi')

/** Danh sách mặc định khi mở form báo cáo: mọi đối thủ có ít nhất 1 tín hiệu tại KCN này.
 *  Thứ tự giống bảng bên Thị trường: đã ghi nhận trước, rồi theo số LĐ, rồi theo tên. */
export function buildInitialCompetitorEntries(
  zoneName: string, competitors: CompetitorLike[], supplyRows: SupplyRowLike[],
): SurveyCompetitorEntry[] {
  const out: SurveyCompetitorEntry[] = []
  for (const c of competitors) {
    const { signals, workers } = competitorPresence(zoneName, c, supplyRows)
    if (!signals.length) continue
    out.push({ id: c.id, name: c.company_name, note: '', signals, workers })
  }
  return out.sort((a, b) =>
    Number(b.signals.includes('recorded')) - Number(a.signals.includes('recorded'))
    || b.workers - a.workers
    || byName(a, b))
}

/** Thêm đối thủ vào danh sách báo cáo (đối thủ chưa ghi nhận ở KCN này cũng được). Không trùng id. */
export function addCompetitorEntry(
  entries: SurveyCompetitorEntry[], c: CompetitorLike, zoneName: string, supplyRows: SupplyRowLike[],
): SurveyCompetitorEntry[] {
  if (entries.some(e => e.id === c.id)) return entries
  const { signals, workers } = competitorPresence(zoneName, c, supplyRows)
  return [...entries, { id: c.id, name: c.company_name, note: '', signals: signals.length ? signals : ['added'], workers }]
}

export const removeCompetitorEntry = (entries: SurveyCompetitorEntry[], id: string) =>
  entries.filter(e => e.id !== id)

export const setCompetitorEntryNote = (entries: SurveyCompetitorEntry[], id: string, note: string) =>
  entries.map(e => (e.id === id ? { ...e, note } : e))

/** So khớp để tìm kiếm: bỏ dấu, không phân biệt hoa thường (đ ≡ d). */
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase()

/** Đối thủ toàn hệ thống CHƯA có trong báo cáo, cho hộp "Chọn / thêm đối thủ khác".
 *  Đối thủ có tín hiệu tại KCN này (vừa bị bỏ chọn) xếp lên đầu để thêm lại cho dễ. */
export function pickableCompetitors<T extends CompetitorLike>(
  competitors: T[], entries: SurveyCompetitorEntry[], zoneName: string, query: string,
): T[] {
  const taken = new Set(entries.map(e => e.id))
  const q = fold(query.trim())
  const here = (c: T) => [c.zone_name, ...(c.active_zones ?? [])].some(z => sameZone(z, zoneName))
  return competitors
    .filter(c => !taken.has(c.id))
    .filter(c => !q || fold(c.company_name).includes(q))
    .sort((a, b) => Number(here(b)) - Number(here(a)) || a.company_name.localeCompare(b.company_name, 'vi'))
}

/** Đối thủ trong báo cáo mà hồ sơ chưa có tên KCN này trong "Khu vực hoạt động" — ứng viên cho
 *  tuỳ chọn "ghi nhận luôn vào Thị trường". CHỈ thêm tên KCN, không bao giờ gỡ khỏi active_zones. */
export function competitorsToRecord(
  entries: SurveyCompetitorEntry[], competitors: CompetitorLike[], zoneName: string,
): { id: string; name: string; nextZones: string[] }[] {
  const byId = new Map(competitors.map(c => [c.id, c]))
  const out: { id: string; name: string; nextZones: string[] }[] = []
  for (const e of entries) {
    const c = byId.get(e.id)
    if (!c) continue // hồ sơ đối thủ đã bị xoá → không có gì để ghi nhận
    const zones = c.active_zones ?? []
    if (zones.some(z => sameZone(z, zoneName))) continue
    out.push({ id: c.id, name: c.company_name, nextZones: [...zones, zoneName] })
  }
  return out
}

export const SIGNAL_LABEL: Record<CompetitorSignal, string> = {
  recorded: 'Đã ghi nhận',
  hq: 'Trụ sở / KV chính',
  supplying: 'Đang cung ứng',
  added: 'Thêm tay',
}

/** Chữ thường để đọc / xuất MD / dự phòng khi database chưa có cột snapshot. */
export function competitorSnapshotToText(entries: SurveyCompetitorEntry[]): string {
  return entries.map(e => {
    const tags = [
      e.signals.includes('hq') ? 'trụ sở / KV chính' : '',
      e.workers > 0 ? `${e.workers} LĐ tại KCN` : '',
      !e.signals.includes('recorded') && !e.signals.includes('added') ? 'chưa ghi nhận ở Thị trường' : '',
    ].filter(Boolean).join(', ')
    return `• ${e.name}${tags ? ` (${tags})` : ''}${e.note.trim() ? ` — ${e.note.trim()}` : ''}`
  }).join('\n')
}

/** Đọc cột jsonb — null/undefined (báo cáo cũ chưa có ảnh chụp) trả về null, phân biệt với [] (đi khảo sát, không thấy đối thủ). */
export function parseCompetitorSnapshot(raw: unknown): SurveyCompetitorEntry[] | null {
  if (!Array.isArray(raw)) return null
  const out: SurveyCompetitorEntry[] = []
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue
    const o = r as Record<string, unknown>
    if (typeof o.id !== 'string' || typeof o.name !== 'string') continue
    const signals = Array.isArray(o.signals)
      ? (o.signals.filter(s => typeof s === 'string' && s in SIGNAL_LABEL) as CompetitorSignal[])
      : []
    out.push({
      id: o.id, name: o.name,
      note: typeof o.note === 'string' ? o.note : '',
      signals: signals.length ? signals : ['added'],
      workers: typeof o.workers === 'number' && o.workers > 0 ? o.workers : 0,
    })
  }
  return out
}

/* ───────────────────────────── Lương TT ───────────────────────────── */

export type WageField =
  | 'unskilled_min' | 'unskilled_max'
  | 'seasonal_min' | 'seasonal_max'
  | 'skilled_min' | 'skilled_max'

export const WAGE_FIELDS: WageField[] = [
  'unskilled_min', 'unskilled_max', 'seasonal_min', 'seasonal_max', 'skilled_min', 'skilled_max',
]

/** 1 dòng lương theo ngành. Giá trị bằng ĐỒNG, giống cột market_surveys.wage_* (giao diện hiện/nhập bằng triệu). */
export interface SurveyWageEntry {
  /** Id ngành trong Thị trường → Ngành Nghề (bảng industries); null = báo cáo cũ chỉ có tên chữ, hoặc tên chưa có trong danh sách. */
  industry_id: string | null
  /** Tên ngành LÚC khảo sát — giữ lại để báo cáo cũ vẫn đọc được khi sau này ngành bị đổi tên. */
  industry: string
  unskilled_min: number | null
  unskilled_max: number | null
  seasonal_min: number | null
  seasonal_max: number | null
  skilled_min: number | null
  skilled_max: number | null
  labor_availability: string
  /** Ngày khảo sát của dòng Lương TT gốc (null với dòng nhập tay). */
  survey_date: string | null
  source: 'market' | 'manual'
  /** Dòng lấy từ Thị trường nhưng đã chỉnh số ngay trong báo cáo. */
  edited?: boolean
}

type SurveyLike = Pick<MarketSurvey,
  'zone_name' | 'industry' | 'labor_availability' | 'survey_date'
  | 'wage_unskilled_min' | 'wage_unskilled_max' | 'wage_seasonal_min' | 'wage_seasonal_max'
  | 'wage_skilled_min' | 'wage_skilled_max'>

/** Ngành trong Thị trường → Ngành Nghề. id = null khi danh sách phải dựng tạm từ tên trong Lương TT (chưa có bảng industries). */
export interface IndustryOption {
  id: string | null
  name: string
}

/** So khớp tên ngành giữa Lương TT (market_surveys.industry là CHỮ) và Ngành Nghề: bỏ dấu, hoa/thường, khoảng trắng thừa. */
export const industryKey = (s?: string | null) => fold((s ?? '').trim()).replace(/\s+/g, ' ')

/** Ngành trong danh sách trùng tên (theo industryKey) với `name`; không có → null. */
export const matchIndustry = (name: string | null | undefined, industries: IndustryOption[]): IndustryOption | null =>
  industries.find(i => industryKey(i.name) === industryKey(name) && industryKey(name) !== '') ?? null

/** Lương TT mới nhất của MỘT ngành ở đúng KCN này (khớp KCN bằng sameZone, ngành bằng industryKey). Chưa có → null. */
function latestSurvey(zoneName: string, industryName: string, surveys: SurveyLike[]): SurveyLike | null {
  let best: SurveyLike | null = null
  for (const s of surveys) {
    if (!sameZone(s.zone_name, zoneName) || industryKey(s.industry) !== industryKey(industryName)) continue
    if (!best || (s.survey_date ?? '') > (best.survey_date ?? '')) best = s
  }
  return best
}

const entryFromSurvey = (s: SurveyLike, industry: IndustryOption | null): SurveyWageEntry => ({
  industry_id: industry?.id ?? null,
  industry: industry?.name ?? (s.industry ?? '').trim(),
  unskilled_min: s.wage_unskilled_min, unskilled_max: s.wage_unskilled_max,
  seasonal_min: s.wage_seasonal_min, seasonal_max: s.wage_seasonal_max,
  skilled_min: s.wage_skilled_min, skilled_max: s.wage_skilled_max,
  labor_availability: s.labor_availability || 'Trung bình',
  survey_date: s.survey_date ?? null,
  source: 'market',
})

/** Dòng trống cho 1 ngành chưa có Lương TT ở KCN này — nhập tay. */
export const emptyWageEntry = (industry: IndustryOption): SurveyWageEntry => ({
  industry_id: industry.id, industry: industry.name,
  unskilled_min: null, unskilled_max: null, seasonal_min: null, seasonal_max: null, skilled_min: null, skilled_max: null,
  labor_availability: 'Trung bình', survey_date: null, source: 'manual',
})

/** Lương TT của đúng KCN này, tự điền lúc mở form: mỗi ngành lấy bản khảo sát MỚI NHẤT (Thị trường có thể giữ nhiều
 *  lần khảo sát cho cùng một ngành). Gắn id ngành nếu tên khớp một ngành trong danh sách Ngành Nghề. */
export function buildWageSnapshot(zoneName: string, surveys: SurveyLike[], industries: IndustryOption[] = []): SurveyWageEntry[] {
  const latest = new Map<string, SurveyLike>()
  for (const s of surveys) {
    if (!sameZone(s.zone_name, zoneName)) continue
    const k = industryKey(s.industry)
    const cur = latest.get(k)
    if (!cur || (s.survey_date ?? '') > (cur.survey_date ?? '')) latest.set(k, s)
  }
  return [...latest.values()]
    .map(s => entryFromSurvey(s, matchIndustry(s.industry, industries)))
    .sort((a, b) => a.industry.localeCompare(b.industry, 'vi'))
}

/** Ngành này đã có trong báo cáo chưa (theo id, hoặc theo tên khi dòng chưa có id). */
const sameIndustry = (e: SurveyWageEntry, i: IndustryOption) =>
  (e.industry_id !== null && e.industry_id === i.id) || industryKey(e.industry) === industryKey(i.name)

/** Ngành còn có thể chọn: chưa có trong báo cáo, lọc không dấu theo `query`, xếp theo tên. */
export function pickableIndustries(industries: IndustryOption[], entries: SurveyWageEntry[], query: string): IndustryOption[] {
  const q = industryKey(query)
  return industries
    .filter(i => !entries.some(e => sameIndustry(e, i)))
    .filter(i => !q || industryKey(i.name).includes(q))
    .sort((a, b) => a.name.localeCompare(b.name, 'vi'))
}

/** Thêm 1 ngành đã CHỌN từ Ngành Nghề vào báo cáo và tự điền Lương TT mới nhất của đúng KCN + ngành đó.
 *  Chưa có số cho cặp này → dòng trống (source 'manual') để nhập tay. Ngành đã có trong báo cáo → giữ nguyên. */
export function addIndustryEntry(entries: SurveyWageEntry[], industry: IndustryOption, zoneName: string, surveys: SurveyLike[]): SurveyWageEntry[] {
  if (entries.some(e => sameIndustry(e, industry))) return entries
  const s = latestSurvey(zoneName, industry.name, surveys)
  return [...entries, s ? entryFromSurvey(s, industry) : emptyWageEntry(industry)]
}

/** Gắn lại ngành cho 1 dòng (dòng lấy từ Lương TT nhưng tên ngành chưa khớp danh sách, hoặc dòng nhập tay). Số đã có trong
 *  dòng được giữ nguyên; dòng chưa có số nào thì tự điền Lương TT của ngành mới. Ngành đã nằm ở dòng khác → không đổi. */
export function assignIndustryEntry(entries: SurveyWageEntry[], index: number, industry: IndustryOption, zoneName: string, surveys: SurveyLike[]): SurveyWageEntry[] {
  const cur = entries[index]
  if (!cur || entries.some((e, i) => i !== index && sameIndustry(e, industry))) return entries
  const filled = hasWage(cur) ? null : latestSurvey(zoneName, industry.name, surveys)
  const next: SurveyWageEntry = filled
    ? entryFromSurvey(filled, industry)
    : { ...cur, industry_id: industry.id, industry: industry.name }
  return entries.map((e, i) => (i === index ? next : e))
}

/** Ô nhập bằng TRIỆU ("7,5" hoặc "7.5") → đồng. Rỗng / không phải số / âm → null. */
export function trInputToVnd(text: string): number | null {
  const t = text.trim().replace(',', '.')
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 1_000_000) : null
}

/** Đồng → chuỗi triệu để đưa vào ô nhập ("7.5"); null → "". */
export function vndToTrInput(v: number | null | undefined): string {
  if (v == null) return ''
  return String(Math.round((v / 1_000_000) * 100) / 100)
}

export function setWageEntryField(entries: SurveyWageEntry[], index: number, patch: Partial<Pick<SurveyWageEntry, WageField | 'labor_availability'>>): SurveyWageEntry[] {
  return entries.map((e, i) => (i === index ? { ...e, ...patch, ...(e.source === 'market' ? { edited: true } : {}) } : e))
}

export const removeWageEntry = (entries: SurveyWageEntry[], index: number) => entries.filter((_, i) => i !== index)

const hasWage = (e: SurveyWageEntry) => WAGE_FIELDS.some(f => e[f] != null)

/** "6.5 – 7.2tr"; chỉ có 1 đầu thì hiện 1 số; không có gì → "—". */
export function formatWageRange(min: number | null, max: number | null): string {
  const a = vndToTrInput(min); const b = vndToTrInput(max)
  if (a && b) return a === b ? `${a}tr` : `${a} – ${b}tr`
  if (a || b) return `${a || b}tr`
  return '—'
}

/** Bỏ dòng hoàn toàn trống (không tên ngành, không số) trước khi lưu. */
export const cleanWageEntries = (entries: SurveyWageEntry[]) =>
  entries.filter(e => e.industry.trim() || hasWage(e)).map(e => ({ ...e, industry: e.industry.trim() }))

export function wageSnapshotToText(entries: SurveyWageEntry[]): string {
  return entries.map(e => {
    const parts = [
      `PT ${formatWageRange(e.unskilled_min, e.unskilled_max)}`,
      `TV ${formatWageRange(e.seasonal_min, e.seasonal_max)}`,
      `CT ${formatWageRange(e.skilled_min, e.skilled_max)}`,
      `nguồn LĐ ${e.labor_availability}`,
    ]
    return `• ${e.industry || '(chưa ghi ngành)'}: ${parts.join(' · ')}`
  }).join('\n')
}

const numOrNull = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

export function parseWageSnapshot(raw: unknown): SurveyWageEntry[] | null {
  if (!Array.isArray(raw)) return null
  const out: SurveyWageEntry[] = []
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue
    const o = r as Record<string, unknown>
    out.push({
      industry_id: typeof o.industry_id === 'string' && o.industry_id ? o.industry_id : null,
      industry: typeof o.industry === 'string' ? o.industry : '',
      unskilled_min: numOrNull(o.unskilled_min), unskilled_max: numOrNull(o.unskilled_max),
      seasonal_min: numOrNull(o.seasonal_min), seasonal_max: numOrNull(o.seasonal_max),
      skilled_min: numOrNull(o.skilled_min), skilled_max: numOrNull(o.skilled_max),
      labor_availability: typeof o.labor_availability === 'string' && o.labor_availability ? o.labor_availability : 'Trung bình',
      survey_date: typeof o.survey_date === 'string' ? o.survey_date : null,
      source: o.source === 'manual' ? 'manual' : 'market',
      ...(o.edited === true ? { edited: true } : {}),
    })
  }
  return out
}

/* ─────────────────── Chạy khi database chưa có cột mới ─────────────────── */

export const SNAPSHOT_COLUMNS = ['competitors_snapshot', 'wage_snapshot'] as const

/** Lỗi PostgREST/Postgres khi cột snapshot chưa tồn tại (chưa chạy migration 176). */
export function isMissingSnapshotColumnError(error: { message?: string; code?: string } | null | undefined): boolean {
  if (!error) return false
  const msg = error.message ?? ''
  const mentionsColumn = SNAPSHOT_COLUMNS.some(c => msg.includes(c))
  return mentionsColumn && (error.code === 'PGRST204' || error.code === '42703' || /column|schema cache/i.test(msg))
}

/** Gộp phần ảnh chụp thành chữ vào ô ghi chú — dự phòng để không mất dữ liệu khi chưa có cột snapshot. */
export function foldSnapshotIntoNote(note: string, heading: string, text: string): string {
  if (!text.trim()) return note
  const block = `— ${heading} —\n${text}`
  return note.trim() ? `${note.trim()}\n\n${block}` : block
}
