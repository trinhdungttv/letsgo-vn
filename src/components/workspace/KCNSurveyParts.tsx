import { useEffect, useMemo, useState } from 'react'
import { Plus, Search, Trash2, Info, Check } from 'lucide-react'
import type { Competitor } from '../../lib/types'
import { formatDate } from '../../lib/format'
import { LABOR_AVAIL_OPTIONS } from '../../pages/market/shared'
import { INPUT, TINT, BTN_TINTED, BTN_ICON } from './wsTheme'
import {
  SIGNAL_LABEL, addCompetitorEntry, formatDong, formatDongRange, formatWageRange, hasLegacyUnskilled, parseDongInput, pickableCompetitors,
  pickableIndustries, removeCompetitorEntry, removeWageEntry, setCompetitorEntryNote, setWageEntryField, trInputToVnd, vndToTrInput,
  type IndustryOption, type SupplyRowLike, type SurveyCompetitorEntry, type SurveyWageEntry, type WageField,
} from '../../lib/kcnSurveySnapshot'

/**
 * Các khối dữ liệu Thị trường lưu theo từng báo cáo khảo sát KCN: đối thủ đang hoạt động tại KCN và Lương TT.
 * Dữ liệu được sao ra (bản lưu tại thời điểm khảo sát) lúc mở form (xem lib/kcnSurveySnapshot.ts) nên sửa ở đây KHÔNG đổi dữ liệu Thị trường.
 */

const chip = 'px-2 py-0.5 rounded-full text-[10.5px] font-medium whitespace-nowrap'
const labelCls = 'text-[11.5px] font-medium text-[#6E6E73]'

function SignalChips({ e }: { e: SurveyCompetitorEntry }) {
  const recorded = e.signals.includes('recorded')
  return (
    <>
      {e.signals.includes('hq') && <span className={`${chip} ${TINT.purple}`}>{SIGNAL_LABEL.hq}</span>}
      {e.signals.includes('supplying') && (
        <span className={`${chip} ${TINT.blue}`}>{SIGNAL_LABEL.supplying}{e.workers > 0 ? ` · ${e.workers} LĐ` : ''}</span>
      )}
      {e.signals.includes('added') && <span className={`${chip} ${TINT.gray}`}>{SIGNAL_LABEL.added}</span>}
      <span className={`${chip} ${recorded ? TINT.green : TINT.orange}`}>{recorded ? SIGNAL_LABEL.recorded : 'Chưa ghi nhận'}</span>
    </>
  )
}

/* ─────────────────────────── Đối thủ — nhập ─────────────────────────── */

interface CompetitorEditorProps {
  zoneName: string
  entries: SurveyCompetitorEntry[]
  /** Gợi ý ban đầu từ Thị trường — để thêm lại 1 chạm đối thủ vừa bỏ chọn. */
  suggested: SurveyCompetitorEntry[]
  allCompetitors: Competitor[]
  supplyRows: SupplyRowLike[]
  loading: boolean
  onChange: (next: SurveyCompetitorEntry[]) => void
  /** Đối thủ trong báo cáo mà Thị trường chưa ghi nhận ở KCN này. */
  unrecorded: { id: string; name: string }[]
  recordBack: boolean
  onRecordBack: (v: boolean) => void
}

export function CompetitorEditor({
  zoneName, entries, suggested, allCompetitors, supplyRows, loading, onChange, unrecorded, recordBack, onRecordBack,
}: CompetitorEditorProps) {
  const [picking, setPicking] = useState(false)
  const [query, setQuery] = useState('')
  const options = useMemo(
    () => pickableCompetitors(allCompetitors, entries, zoneName, query),
    [allCompetitors, entries, zoneName, query],
  )
  const skipped = suggested.filter(s => !entries.some(e => e.id === s.id))
  const MAX_OPTIONS = 60

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <label className={labelCls}>Đối thủ ghi nhận <span className="font-normal text-[#86868B]">· {entries.length} đơn vị</span></label>
        <button type="button" onClick={() => setPicking(p => !p)} className={`${BTN_TINTED} ml-auto shrink-0 whitespace-nowrap px-2.5 py-1 text-[11.5px]`}>
          <Plus size={11} /> Chọn / thêm đối thủ khác
        </button>
      </div>

      {loading ? (
        <div className="text-[11.5px] text-[#86868B] py-3 text-center rounded-[12px] bg-black/[0.03]">Đang lấy đối thủ từ Thị trường…</div>
      ) : entries.length === 0 ? (
        <div className="text-[11.5px] text-[#86868B] py-3 px-3 text-center rounded-[12px] bg-black/[0.03]">
          Thị trường chưa ghi nhận đối thủ nào ở {zoneName}. Bấm "Chọn / thêm đối thủ khác" nếu chuyến này gặp đối thủ.
        </div>
      ) : (
        <ul className="rounded-[12px] bg-black/[0.03] divide-y divide-black/[0.06] overflow-hidden">
          {entries.map(e => (
            <li key={e.id} className="px-3 py-2 flex flex-col md:flex-row md:items-center gap-1.5 md:gap-3">
              <div className="flex items-center gap-2 min-w-0 md:w-[46%]">
                <button
                  type="button"
                  aria-label={`Bỏ chọn ${e.name}`}
                  title="Bỏ chọn khỏi báo cáo này (không đổi dữ liệu Thị trường)"
                  onClick={() => onChange(removeCompetitorEntry(entries, e.id))}
                  className="shrink-0 w-[18px] h-[18px] rounded-full bg-[#0071E3] text-white flex items-center justify-center hover:bg-[#0077ED]"
                ><Check size={11} strokeWidth={3} /></button>
                <div className="min-w-0">
                  <div className="text-[12.5px] font-medium text-[#1D1D1F] truncate">{e.name}</div>
                  <div className="flex flex-wrap gap-1 mt-0.5"><SignalChips e={e} /></div>
                </div>
              </div>
              <input
                value={e.note}
                onChange={ev => onChange(setCompetitorEntryNote(entries, e.id, ev.target.value))}
                placeholder="Ghi chú ngắn (vd: đang tuyển gấp…)"
                className={`${INPUT} flex-1 min-w-0 text-[12px] px-2.5 py-1.5`}
              />
            </li>
          ))}
        </ul>
      )}

      {!loading && skipped.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-[#86868B]">
          Đã bỏ chọn:
          {skipped.map(s => (
            <button
              key={s.id} type="button"
              onClick={() => onChange([...entries, s])}
              className={`${chip} ${TINT.gray} hover:bg-black/[0.08]`}
            >+ {s.name}</button>
          ))}
        </div>
      )}

      {picking && (
        <div className="rounded-[12px] border border-black/[0.08] bg-white p-2.5 space-y-2">
          <div className="relative">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#AEAEB2]" />
            <input
              autoFocus value={query} onChange={e => setQuery(e.target.value)}
              placeholder="Tìm đối thủ trong toàn hệ thống…"
              className={`${INPUT} w-full text-[12px] pl-7 pr-2.5 py-1.5`}
            />
          </div>
          <div className="max-h-[200px] overflow-y-auto -mx-1">
            {options.length === 0 ? (
              <div className="text-[11.5px] text-[#86868B] text-center py-3">Không còn đối thủ nào để thêm.</div>
            ) : options.slice(0, MAX_OPTIONS).map(c => (
              <button
                key={c.id} type="button"
                onClick={() => onChange(addCompetitorEntry(entries, c, zoneName, supplyRows))}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left hover:bg-black/[0.04]"
              >
                <Plus size={11} className="text-[#0066CC] shrink-0" />
                <span className="text-[12.5px] text-[#1D1D1F] truncate">{c.company_name}</span>
                {c.zone_name && <span className="ml-auto text-[10.5px] text-[#AEAEB2] truncate max-w-[40%]">{c.zone_name}</span>}
              </button>
            ))}
            {options.length > MAX_OPTIONS && <div className="text-[10.5px] text-[#AEAEB2] text-center py-1">Còn {options.length - MAX_OPTIONS} đối thủ — gõ để lọc thêm.</div>}
          </div>
          <div className="flex justify-end">
            <button type="button" onClick={() => { setPicking(false); setQuery('') }} className="text-[11.5px] font-medium text-[#0066CC] px-2 py-1 rounded-full hover:bg-[#0071E3]/10">Xong</button>
          </div>
        </div>
      )}

      {!loading && unrecorded.length > 0 && (
        <label className="flex items-start gap-2 text-[11.5px] text-[#6E6E73] rounded-[12px] bg-[#FF9500]/[0.08] px-3 py-2 cursor-pointer">
          <input type="checkbox" checked={recordBack} onChange={e => onRecordBack(e.target.checked)} className="mt-0.5 accent-[#0071E3]" />
          <span>
            Đồng thời ghi nhận {unrecorded.length} đối thủ chưa ghi nhận ({unrecorded.map(u => u.name).join(', ')}) vào {zoneName} trên Thị trường.
            <span className="block text-[10.5px] text-[#86868B]">Mặc định tắt. Chỉ thêm tên KCN vào ô "Khu vực hoạt động" của họ — không gỡ ai, kể cả đối thủ bạn bỏ chọn ở đây. Sẽ hỏi xác nhận trước khi lưu.</span>
          </span>
        </label>
      )}
    </div>
  )
}

/* ─────────────────────────── Đối thủ — xem lại ─────────────────────────── */

export function CompetitorSnapshotView({ entries }: { entries: SurveyCompetitorEntry[] }) {
  if (entries.length === 0) return <div className="text-[11.5px] text-[#86868B]">Lúc khảo sát không ghi nhận đối thủ nào.</div>
  return (
    <ul className="rounded-[12px] bg-black/[0.03] divide-y divide-black/[0.06] overflow-hidden">
      {entries.map(e => (
        <li key={e.id} className="px-3 py-2">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[12.5px] font-medium text-[#1D1D1F]">{e.name}</span>
            <SignalChips e={e} />
          </div>
          {e.note.trim() && <div className="text-[12px] text-[#3A3A3C] mt-0.5 whitespace-pre-wrap">{e.note}</div>}
        </li>
      ))}
    </ul>
  )
}

/* ─────────────────────────── Lương TT — nhập ─────────────────────────── */

/** Ô nhập số TRIỆU: giữ chữ người dùng đang gõ ("7." chưa thành "7") và chỉ đồng bộ lại khi giá trị bên ngoài đổi. */
function TrInput({ value, onChange, placeholder }: { value: number | null; onChange: (v: number | null) => void; placeholder: string }) {
  const [text, setText] = useState(vndToTrInput(value))
  useEffect(() => {
    if (trInputToVnd(text) !== value) setText(vndToTrInput(value))
  }, [value]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <input
      inputMode="decimal" value={text} placeholder={placeholder}
      onChange={e => { setText(e.target.value); onChange(trInputToVnd(e.target.value)) }}
      className={`${INPUT} w-full min-w-0 text-[12px] px-2 py-1.5 text-center`}
    />
  )
}

/** Ô nhập ĐỒNG (lương 8h/ngày): gõ "260.000" hoặc "260"; rời ô thì tự định dạng thành 260.000. */
function VndInput({ value, onChange, placeholder }: { value: number | null; onChange: (v: number | null) => void; placeholder: string }) {
  const [text, setText] = useState(formatDong(value))
  useEffect(() => {
    if (parseDongInput(text) !== value) setText(formatDong(value))
  }, [value]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <input
      inputMode="numeric" value={text} placeholder={placeholder}
      onChange={e => { setText(e.target.value); onChange(parseDongInput(e.target.value)) }}
      onBlur={() => setText(formatDong(value))}
      className={`${INPUT} w-full min-w-0 text-[14px] font-semibold px-2.5 py-2 text-center`}
    />
  )
}

/** Một khoảng "từ – đến" (triệu). */
function RangeInputs({ min, max, onMin, onMax }: { min: number | null; max: number | null; onMin: (v: number | null) => void; onMax: (v: number | null) => void }) {
  return (
    <div className="flex items-center gap-1">
      <TrInput value={min} onChange={onMin} placeholder="từ" />
      <span className="text-[#AEAEB2]">–</span>
      <TrInput value={max} onChange={onMax} placeholder="đến" />
    </div>
  )
}

/** Bộ chọn ngành lấy từ Thị trường → Ngành Nghề (không gõ tay): có tìm không dấu, ẩn ngành đã có trong báo cáo. */
function IndustryPicker({ industries, entries, onPick, onClose, fallback }: {
  industries: IndustryOption[]; entries: SurveyWageEntry[]; fallback: boolean
  onPick: (i: IndustryOption) => void; onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const options = useMemo(() => pickableIndustries(industries, entries, query), [industries, entries, query])
  return (
    <div className="rounded-[12px] border border-black/[0.08] bg-white p-2.5 space-y-2">
      <div className="relative">
        <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#AEAEB2]" />
        <input
          autoFocus value={query} onChange={e => setQuery(e.target.value)}
          placeholder="Tìm ngành nghề…"
          className={`${INPUT} w-full text-[12px] pl-7 pr-2.5 py-1.5`}
        />
      </div>
      <div className="max-h-[200px] overflow-y-auto -mx-1">
        {options.length === 0 ? (
          <div className="text-[11.5px] text-[#86868B] text-center py-3">
            {query.trim() ? 'Không có ngành khớp.' : 'Đã chọn hết các ngành.'}
          </div>
        ) : options.map(i => (
          <button
            key={i.id ?? i.name} type="button" onClick={() => onPick(i)}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left hover:bg-black/[0.04]"
          >
            <Plus size={11} className="text-[#0066CC] shrink-0" />
            <span className="text-[12.5px] text-[#1D1D1F] truncate">{i.name}</span>
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[10.5px] text-[#86868B]">
          {fallback
            ? 'Chưa tải được danh sách Ngành Nghề — đang dùng tạm các ngành có trong Lương TT.'
            : 'Thiếu ngành? Thêm ở Thị trường → Ngành Nghề.'}
        </span>
        <button type="button" onClick={onClose} className="ml-auto shrink-0 text-[11.5px] font-medium text-[#0066CC] px-2 py-1 rounded-full hover:bg-[#0071E3]/10">Xong</button>
      </div>
    </div>
  )
}

interface WageEditorProps {
  zoneName: string
  entries: SurveyWageEntry[]
  loading: boolean
  /** Thị trường có dòng Lương TT nào của KCN này lúc mở form không. */
  hadMarketData: boolean
  /** Danh sách ngành của Thị trường → Ngành Nghề; fallback = phải dựng tạm từ Lương TT (chưa có bảng industries). */
  industries: IndustryOption[]
  industriesFallback: boolean
  onChange: (next: SurveyWageEntry[]) => void
  /** Chọn ngành → thêm dòng mới và tự điền Lương TT của đúng KCN + ngành (logic ở lib, người gọi truyền dữ liệu Thị trường). */
  onAddIndustry: (i: IndustryOption) => void
  /** Gắn lại ngành cho 1 dòng chưa khớp danh sách. */
  onAssignIndustry: (index: number, i: IndustryOption) => void
  /** Số ngành do người dùng nhập / chỉnh — những ngành sẽ được ghi sang Lương TT khi lưu báo cáo. */
  syncableCount: number
  syncToMarket: boolean
  onSyncToMarket: (v: boolean) => void
}

export function WageEditor({ zoneName, entries, loading, hadMarketData, industries, industriesFallback, onChange, onAddIndustry, onAssignIndustry, syncableCount, syncToMarket, onSyncToMarket }: WageEditorProps) {
  const [picking, setPicking] = useState(false)
  const [assigning, setAssigning] = useState<number | null>(null)
  // Lương chính thức ít dùng (chỉ một số dự án giới thiệu LĐ) → ẩn mặc định, mở tay cho từng ngành; dòng đã có số thì luôn hiện.
  const [skilledOpen, setSkilledOpen] = useState<Set<string>>(new Set())
  const set = (i: number, patch: Partial<Record<WageField, number | null>>) => onChange(setWageEntryField(entries, i, patch))
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <label className={labelCls}>Mức lương khu vực <span className="font-normal text-[#86868B]">· Lương TT của {zoneName}</span></label>
        <button type="button" onClick={() => setPicking(p => !p)} className={`${BTN_TINTED} ml-auto shrink-0 whitespace-nowrap px-2.5 py-1 text-[11.5px]`}>
          <Plus size={11} /> Thêm ngành
        </button>
      </div>

      {picking && (
        <IndustryPicker
          industries={industries} entries={entries} fallback={industriesFallback}
          onPick={i => onAddIndustry(i)} onClose={() => setPicking(false)}
        />
      )}

      {loading ? (
        <div className="text-[11.5px] text-[#86868B] py-3 text-center rounded-[12px] bg-black/[0.03]">Đang lấy Lương TT từ Thị trường…</div>
      ) : (
        <>
          {!hadMarketData && (
            <div className="flex items-start gap-1.5 text-[11.5px] text-[#B25000] rounded-[12px] bg-[#FF9500]/[0.1] px-3 py-2">
              <Info size={12} className="mt-0.5 shrink-0" />
              <span>Chưa có dữ liệu lương — thêm ở tab Lương TT. Bấm "Thêm ngành" để chọn ngành và nhập tay, số nhập chỉ nằm trong báo cáo này.</span>
            </div>
          )}
          {entries.map((e, i) => {
            // Dòng lấy từ Lương TT nhưng tên ngành không có trong Ngành Nghề → báo để gắn lại cho khớp hệ thống.
            const unmatched = e.industry_id === null && !industriesFallback
            const rowKey = e.industry_id ?? e.industry
            return (
              <div key={rowKey} className="rounded-[12px] bg-black/[0.03] p-3 space-y-2">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-[12.5px] font-medium text-[#1D1D1F]">{e.industry || '(Chưa ghi ngành)'}</span>
                  {e.source === 'market' && e.survey_date && <span className={`${chip} ${TINT.blue}`}>Lương TT {formatDate(e.survey_date)}</span>}
                  {e.edited && <span className={`${chip} ${TINT.orange}`}>Đã chỉnh trong báo cáo</span>}
                  {unmatched && <span className={`${chip} ${TINT.orange}`}>Chưa khớp danh sách Ngành Nghề</span>}
                  {unmatched && (
                    <button type="button" onClick={() => setAssigning(a => (a === i ? null : i))} className="text-[11px] font-medium text-[#0066CC] hover:underline">Gắn ngành</button>
                  )}
                  <button type="button" onClick={() => { onChange(removeWageEntry(entries, i)); setAssigning(null) }} className={`${BTN_ICON} ml-auto`} title="Bỏ dòng này khỏi báo cáo (không đổi Lương TT)"><Trash2 size={12} /></button>
                </div>
                {assigning === i && (
                  <IndustryPicker
                    industries={industries} entries={entries} fallback={industriesFallback}
                    onPick={ind => { onAssignIndustry(i, ind); setAssigning(null) }} onClose={() => setAssigning(null)}
                  />
                )}
                {e.source === 'manual' && (
                  <div className="flex items-start gap-1.5 text-[11px] text-[#B25000]">
                    <Info size={11} className="mt-0.5 shrink-0" />
                    <span>Chưa có Lương TT của ngành này ở {zoneName} — thêm ở tab Lương TT, hoặc nhập tay ở đây.</span>
                  </div>
                )}
                <div className="grid grid-cols-1 md:grid-cols-[1.5fr_1.3fr_1fr] gap-2 md:gap-3">
                  {/* Mức căn cứ chính — nổi nhất trên dòng */}
                  <div className="min-w-0 rounded-[10px] bg-[#0071E3]/[0.07] p-2">
                    <div className="text-[11px] font-semibold text-[#0066CC] mb-1">Lương cơ bản 8h (đồng/ngày)</div>
                    <div className="flex items-center gap-1.5">
                      <VndInput value={e.base_wage_8h_min} onChange={v => set(i, { base_wage_8h_min: v })} placeholder="từ 260.000" />
                      <span className="text-[#AEAEB2]">–</span>
                      <VndInput value={e.base_wage_8h_max} onChange={v => set(i, { base_wage_8h_max: v })} placeholder="đến 280.000" />
                    </div>
                  </div>
                  <div className="min-w-0 p-2 md:p-0 md:pt-2">
                    <div className="text-[10.5px] text-[#86868B] mb-1">Thực nhận TB – Thời vụ (tr)</div>
                    <RangeInputs min={e.seasonal_min} max={e.seasonal_max} onMin={v => set(i, { seasonal_min: v })} onMax={v => set(i, { seasonal_max: v })} />
                  </div>
                  <div className="min-w-0 p-2 md:p-0 md:pt-2">
                    <div className="text-[10.5px] text-[#86868B] mb-1">Nguồn LĐ</div>
                    <select
                      value={e.labor_availability}
                      onChange={ev => onChange(setWageEntryField(entries, i, { labor_availability: ev.target.value }))}
                      className={`${INPUT} w-full text-[12px] px-2 py-1.5`}
                    >
                      {[...new Set([...LABOR_AVAIL_OPTIONS, e.labor_availability])].map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </div>
                </div>
                {(e.skilled_min != null || e.skilled_max != null || skilledOpen.has(rowKey)) ? (
                  <div className="p-2 md:px-0 md:pb-0 md:pt-1">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="text-[10.5px] text-[#86868B]">Chính thức (tr) · dự án giới thiệu LĐ</div>
                      {e.skilled_min == null && e.skilled_max == null && (
                        <button type="button" onClick={() => setSkilledOpen(o => { const n = new Set(o); n.delete(rowKey); return n })} className="text-[10.5px] text-[#86868B] hover:underline">Ẩn</button>
                      )}
                    </div>
                    <div className="max-w-[280px]">
                      <RangeInputs min={e.skilled_min} max={e.skilled_max} onMin={v => set(i, { skilled_min: v })} onMax={v => set(i, { skilled_max: v })} />
                    </div>
                  </div>
                ) : (
                  <button type="button" onClick={() => setSkilledOpen(o => new Set(o).add(rowKey))} className="text-[11px] font-medium text-[#0066CC] hover:underline px-2 md:px-0">
                    + Lương chính thức (dự án giới thiệu LĐ)
                  </button>
                )}
              </div>
            )
          })}
          {syncableCount > 0 && (
            <label className="flex items-start gap-2 text-[11.5px] text-[#6E6E73] rounded-[12px] bg-[#34C759]/[0.1] px-3 py-2 cursor-pointer">
              <input type="checkbox" checked={syncToMarket} onChange={e => onSyncToMarket(e.target.checked)} className="mt-0.5 accent-[#0071E3]" />
              <span>
                Ghi {syncableCount} ngành vừa nhập vào Thị trường → Lương TT của {zoneName}
                <span className="block text-[10.5px] text-[#86868B]">Thêm 1 dòng lương mới (ngày đi) cho từng ngành. Lưu lại lần nữa cùng ngày chỉ cập nhật dòng đó, không sửa hay xoá dòng Lương TT của ngày khác.</span>
              </span>
            </label>
          )}
          <div className="text-[10.5px] text-[#86868B]">Lấy bản Lương TT mới nhất của từng ngành. Số lấy sẵn mà chưa sửa thì không ghi lại. Bỏ tick ở trên nếu chỉ muốn lưu trong báo cáo này.</div>
        </>
      )}
    </div>
  )
}

/* ─────────────────────────── Lương TT — xem lại ─────────────────────────── */

const availCls = (v: string) => (v === 'Dồi dào' ? TINT.green : v === 'Khan hiếm' ? TINT.red : TINT.yellow)

export function WageSnapshotView({ entries }: { entries: SurveyWageEntry[] }) {
  if (entries.length === 0) return <div className="text-[11.5px] text-[#86868B]">Lúc khảo sát không có dòng lương nào.</div>
  // Báo cáo cũ (trước khi có lương cơ bản 8h) không hiện cột 8h trống; cột Phổ thông/Chính thức chỉ hiện khi báo cáo có số.
  const legacy = entries.some(hasLegacyUnskilled)
  const showBase = entries.some(e => e.base_wage_8h_min != null || e.base_wage_8h_max != null) || !legacy
  const showSkilled = entries.some(e => e.skilled_min != null || e.skilled_max != null)
  const headers = [
    'Ngành nghề',
    ...(showBase ? ['Lương cơ bản 8h (đ/ngày)'] : []),
    'Thực nhận TB – Thời vụ (tr)',
    ...(showSkilled ? ['Chính thức (tr)'] : []),
    ...(legacy ? ['Phổ thông (tr) · cũ'] : []),
    'Nguồn LĐ',
  ]
  return (
    <div className="rounded-[12px] bg-black/[0.03] overflow-x-auto">
      <table className="w-full text-[12px] min-w-[460px]">
        <thead>
          <tr className="text-left text-[10.5px] text-[#86868B]">
            {headers.map(h => <th key={h} className="px-3 py-1.5 font-medium whitespace-nowrap">{h}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-black/[0.06]">
          {entries.map((e, i) => (
            <tr key={i}>
              <td className="px-3 py-1.5 text-[#1D1D1F]">
                {e.industry || '—'}
                {e.edited && <span className={`${chip} ${TINT.orange} ml-1.5`}>đã chỉnh</span>}
                {e.source === 'manual' && <span className={`${chip} ${TINT.gray} ml-1.5`}>nhập tay</span>}
              </td>
              {showBase && <td className="px-3 py-1.5 whitespace-nowrap font-semibold text-[#0066CC]">{formatDongRange(e.base_wage_8h_min, e.base_wage_8h_max)}</td>}
              <td className="px-3 py-1.5 whitespace-nowrap">{formatWageRange(e.seasonal_min, e.seasonal_max)}</td>
              {showSkilled && <td className="px-3 py-1.5 whitespace-nowrap text-[#1E7B34]">{formatWageRange(e.skilled_min, e.skilled_max)}</td>}
              {legacy && <td className="px-3 py-1.5 whitespace-nowrap text-[#86868B]">{formatWageRange(e.unskilled_min, e.unskilled_max)}</td>}
              <td className="px-3 py-1.5"><span className={`${chip} ${availCls(e.labor_availability)}`}>{e.labor_availability}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
