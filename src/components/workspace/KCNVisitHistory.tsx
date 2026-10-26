import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarPlus, Check, Trash2, ClipboardList, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { logActivity } from '../../lib/audit'
import { formatDate } from '../../lib/format'
import type { Client, Competitor, CompetitorClient, KCNVisit, MarketLead, MarketSurvey } from '../../lib/types'
import { deriveSupplyFromCompanies } from '../../pages/market/supplierLink'
import {
  addIndustryEntry, assignIndustryEntry, buildInitialCompetitorEntries, buildWageSnapshot, cleanWageEntries,
  competitorSnapshotToText, competitorsToRecord, foldSnapshotIntoNote, industryKey, isMissingBase8hColumnError,
  isMissingSnapshotColumnError, isSyncableWageEntry, parseCompetitorSnapshot, parseWageSnapshot, planWageSync,
  wageSnapshotToText, withoutBase8h,
  type IndustryOption, type SupplyRowLike, type SurveyCompetitorEntry, type SurveyWageEntry,
} from '../../lib/kcnSurveySnapshot'
import { sameZone } from '../../lib/zoneMatch'
import { notifyMarketChanged } from '../crm/MarketSupplyBlock'
import { BTN_PRIMARY, BTN_SECONDARY, BTN_TINTED, INPUT } from './wsTheme'
import { CompetitorEditor, CompetitorSnapshotView, WageEditor, WageSnapshotView } from './KCNSurveyParts'

const emptyReport = {
  report_summary: '',
  occupancy_note: '',
  labor_note: '',
  wage_note: '',
  competitor_note: '',
  notes: '',
}

type ReportKey = keyof typeof emptyReport

interface Props {
  zoneId: string
  zoneName: string
  toast: (msg: string) => void
  onChanged?: () => void
}

/** Dữ liệu Thị trường cần để điền sẵn báo cáo — tải khi mở form (Workspace không có sẵn các bảng này). */
interface MarketData {
  competitors: Competitor[]
  supplyRows: SupplyRowLike[]
  surveys: MarketSurvey[]
  /** Ngành của Thị trường → Ngành Nghề (bảng industries) — nguồn DUY NHẤT để chọn ngành trong báo cáo. */
  industries: IndustryOption[]
  /** true = bảng industries không đọc được (chưa chạy migration 099?) nên danh sách dựng tạm từ tên ngành trong Lương TT. */
  industriesFallback: boolean
  failed: boolean
}

async function fetchMarketData(): Promise<MarketData> {
  const [cr, ccr, clr, lr, sr, ir] = await Promise.all([
    supabase.from('competitors').select('*'),
    supabase.from('competitor_clients').select('*'),
    supabase.from('clients').select('id, name, industrial_zones, market_suppliers'),
    supabase.from('market_leads').select('id, company_name, region, suppliers'),
    supabase.from('market_surveys').select('*'),
    supabase.from('industries').select('id, name').order('name'),
  ])
  const competitors = (cr.data ?? []) as Competitor[]
  const ccRows = (ccr.data ?? []) as CompetitorClient[]
  // Dòng "đang cung ứng" suy ra từ thẻ Công ty/Dự án — để khớp đúng danh sách bên Thị trường.
  const derived = deriveSupplyFromCompanies(
    competitors,
    (clr.data ?? []) as Pick<Client, 'id' | 'name' | 'industrial_zones' | 'market_suppliers'>[],
    (lr.data ?? []) as Pick<MarketLead, 'id' | 'company_name' | 'region' | 'suppliers'>[],
    ccRows,
  )
  const surveys = (sr.data ?? []) as MarketSurvey[]
  const industriesFallback = !!ir.error || !ir.data
  const industries: IndustryOption[] = industriesFallback
    ? [...new Map(surveys.filter(s => s.industry?.trim()).map(s => [industryKey(s.industry), { id: null, name: s.industry!.trim() }])).values()]
    : (ir.data as { id: string; name: string }[]).map(i => ({ id: i.id, name: i.name }))
  return {
    competitors,
    supplyRows: [...ccRows, ...derived],
    surveys,
    industries,
    industriesFallback,
    // Đối thủ + lương là 2 nguồn chính; lỗi 2 bảng này mới coi là không tải được.
    failed: !!(cr.error || sr.error),
  }
}

/**
 * Lịch khảo sát + báo cáo cho 1 KCN (market_zones.id).
 * Dùng chung giữa Workspace > KCN Grid và Market > Hồ sơ khu vực — cùng đọc/ghi
 * bảng kcn_visits theo zone_id nên dữ liệu luôn đồng bộ ở cả 2 nơi.
 *
 * Form báo cáo tự điền sẵn từ Thị trường (đối thủ đang hoạt động tại KCN + Lương TT, ngành chọn từ Ngành Nghề)
 * dưới dạng bản lưu tại thời điểm khảo sát, riêng trong từng báo cáo — xem lib/kcnSurveySnapshot.ts.
 */
export function KCNVisitHistory({ zoneId, zoneName, toast, onChanged }: Props) {
  const { user } = useAuth()
  const [visits, setVisits] = useState<KCNVisit[]>([])
  const [loading, setLoading] = useState(true)
  const [showSchedule, setShowSchedule] = useState(false)
  const [visitDate, setVisitDate] = useState(new Date().toISOString().split('T')[0])
  const [saving, setSaving] = useState(false)
  const [reportingId, setReportingId] = useState<string | null>(null)
  const [reportForm, setReportForm] = useState(emptyReport)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // Ảnh chụp đang soạn trong form báo cáo
  const [market, setMarket] = useState<MarketData | null>(null)
  const [marketLoading, setMarketLoading] = useState(false)
  const [suggested, setSuggested] = useState<SurveyCompetitorEntry[]>([])
  const [compEntries, setCompEntries] = useState<SurveyCompetitorEntry[]>([])
  const [wageEntries, setWageEntries] = useState<SurveyWageEntry[]>([])
  const [hadMarketWage, setHadMarketWage] = useState(false)
  const [recordBack, setRecordBack] = useState(false)
  // Ghi lương của báo cáo sang Thị trường → Lương TT khi lưu (mặc định bật vì đây là nơi mọi người tra mức lương KCN)
  const [syncToMarket, setSyncToMarket] = useState(true)
  const [syncingId, setSyncingId] = useState<string | null>(null)
  const reportingRef = useRef<string | null>(null)

  useEffect(() => { load() }, [zoneId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('kcn_visits')
      .select('*')
      .eq('zone_id', zoneId)
      .order('visit_date', { ascending: false })
    if (data) setVisits(data as KCNVisit[])
    setLoading(false)
  }

  const planned = visits.filter(v => v.status === 'planned')
  const done = visits.filter(v => v.status === 'done')

  const handleSchedule = async () => {
    if (!user) return
    setSaving(true)
    const { data, error } = await supabase.from('kcn_visits').insert({
      zone_id: zoneId, user_id: user.id, visit_date: visitDate, status: 'planned',
    }).select().single()
    setSaving(false)
    if (error) { toast('Lỗi: ' + error.message); return }
    await logActivity({
      user, action: 'insert', table: 'kcn_visits', recordId: data.id,
      description: `Lên lịch khảo sát KCN "${zoneName}" vào ${formatDate(visitDate)}`,
      newData: data,
    })
    setShowSchedule(false)
    setVisitDate(new Date().toISOString().split('T')[0])
    await load()
    onChanged?.()
    toast('Đã lên lịch khảo sát')
  }

  const startReport = async (v: KCNVisit) => {
    reportingRef.current = v.id
    setReportingId(v.id)
    setReportForm({
      report_summary: v.report_summary || '',
      occupancy_note: v.occupancy_note || '',
      labor_note: v.labor_note || '',
      wage_note: v.wage_note || '',
      competitor_note: v.competitor_note || '',
      notes: v.notes || '',
    })
    setRecordBack(false)
    setSyncToMarket(true)
    setMarket(null)
    setSuggested([]); setCompEntries([]); setWageEntries([])
    setMarketLoading(true)
    let data: MarketData
    try {
      data = await fetchMarketData()
    } catch {
      data = { competitors: [], supplyRows: [], surveys: [], industries: [], industriesFallback: true, failed: true }
    }
    if (reportingRef.current !== v.id) return // đã Huỷ / mở lịch khác trong lúc tải
    const initial = buildInitialCompetitorEntries(zoneName, data.competitors, data.supplyRows)
    const wages = buildWageSnapshot(zoneName, data.surveys, data.industries)
    setMarket(data)
    setSuggested(initial)
    setCompEntries(initial)
    setWageEntries(wages)
    setHadMarketWage(wages.length > 0)
    setMarketLoading(false)
    if (data.failed) toast('Không tải đủ dữ liệu Thị trường — có thể nhập tay đối thủ / lương')
  }

  const cancelReport = () => {
    reportingRef.current = null
    setReportingId(null)
    setReportForm(emptyReport)
    setMarket(null)
    setMarketLoading(false)
    setCompEntries([]); setSuggested([]); setWageEntries([]); setRecordBack(false)
  }

  // Đối thủ trong báo cáo mà Thị trường chưa ghi nhận ở KCN này (ứng viên cho tuỳ chọn ghi nhận ngược).
  const toRecord = useMemo(
    () => (market ? competitorsToRecord(compEntries, market.competitors, zoneName) : []),
    [market, compEntries, zoneName],
  )

  /** Ghi nhận ngược: CHỈ thêm tên KCN vào competitors.active_zones, đọc lại dữ liệu mới nhất ngay
   *  trước khi ghi để không đè lên thay đổi của người khác; không bao giờ gỡ tên KCN nào. */
  const recordCompetitorsToZone = async (ids: string[]) => {
    const { data, error } = await supabase.from('competitors').select('id, company_name, active_zones').in('id', ids)
    if (error || !data) { toast('Đã lưu báo cáo, nhưng không ghi nhận được đối thủ vào Thị trường: ' + (error?.message ?? '')); return }
    let recorded = 0
    for (const c of data as Pick<Competitor, 'id' | 'company_name' | 'active_zones'>[]) {
      const zones = c.active_zones ?? []
      if (zones.some(z => sameZone(z, zoneName))) continue
      const next = [...zones, zoneName]
      const { error: ue } = await supabase.from('competitors').update({ active_zones: next }).eq('id', c.id)
      if (ue) { toast(`Lỗi ghi nhận "${c.company_name}": ${ue.message}`); continue }
      recorded++
      await logActivity({
        user, action: 'update', table: 'competitors', recordId: c.id,
        description: `Ghi nhận đối thủ "${c.company_name}" đang hoạt động tại "${zoneName}" (từ báo cáo khảo sát)`,
        oldData: { active_zones: zones }, newData: { active_zones: next },
      })
    }
    if (recorded) toast(`Đã ghi nhận ${recorded} đối thủ vào ${zoneName} trên Thị trường`)
  }

  /** Ghi lương của báo cáo vào Lương TT (market_surveys): mỗi ngành 1 dòng ở ngày đi — chưa có thì thêm, có rồi thì cập nhật dòng đó.
   *  KHÔNG sửa / xoá dòng của ngày khác. Chưa có cột lương 8h (chưa chạy migration 177) thì ghi các ô còn lại và báo rõ. */
  const syncWageToMarket = async (entries: SurveyWageEntry[], visitDate: string) => {
    const { data: existing, error: ee } = await supabase
      .from('market_surveys').select('id, zone_name, industry, survey_date').eq('survey_date', visitDate)
    if (ee) return { inserted: 0, updated: 0, no8h: false, error: ee.message }
    const plan = planWageSync(entries, existing ?? [], zoneName, visitDate, `Từ báo cáo khảo sát KCN ngày ${formatDate(visitDate)}`)
    let inserted = 0
    let updated = 0
    let no8h = false
    const why = `từ báo cáo khảo sát KCN ngày ${formatDate(visitDate)}`
    if (plan.inserts.length) {
      let res = await supabase.from('market_surveys').insert(plan.inserts).select()
      if (res.error && isMissingBase8hColumnError(res.error)) {
        no8h = true
        res = await supabase.from('market_surveys').insert(plan.inserts.map(withoutBase8h)).select()
      }
      if (res.error) return { inserted, updated, no8h, error: res.error.message }
      inserted = res.data?.length ?? 0
      for (const row of res.data ?? []) {
        await logActivity({
          user, action: 'insert', table: 'market_surveys', recordId: row.id,
          description: `Ghi lương ngành "${row.industry}" của KCN "${zoneName}" vào Lương TT ${why}`, newData: row,
        })
      }
    }
    for (const u of plan.updates) {
      let patch: Record<string, unknown> = u.patch
      let res = await supabase.from('market_surveys').update(patch).eq('id', u.id)
      if (res.error && isMissingBase8hColumnError(res.error)) {
        no8h = true
        patch = withoutBase8h(u.patch)
        res = await supabase.from('market_surveys').update(patch).eq('id', u.id)
      }
      if (res.error) return { inserted, updated, no8h, error: res.error.message }
      updated++
      await logActivity({
        user, action: 'update', table: 'market_surveys', recordId: u.id,
        description: `Cập nhật lương của KCN "${zoneName}" trong Lương TT ${why}`, newData: patch,
      })
    }
    return { inserted, updated, no8h }
  }

  /** Câu báo kết quả ghi sang Lương TT (dùng cho cả lúc lưu báo cáo và nút ghi lại ở lịch sử). */
  const syncMessage = (r: { inserted: number; updated: number; no8h: boolean; error?: string }) => {
    if (r.error) return `ghi vào Lương TT bị lỗi: ${r.error} (bấm "Ghi vào Lương TT" ở lịch sử để thử lại)`
    const n = r.inserted + r.updated
    const base = n ? `đã ghi ${n} ngành vào Lương TT` : 'không có ngành nào cần ghi vào Lương TT'
    return r.no8h ? `${base} — chưa chạy migration 177 nên lương cơ bản 8h chưa vào Lương TT (vẫn lưu trong báo cáo)` : base
  }

  /** Nút ở lịch sử: ghi (lại) lương của 1 báo cáo đã lưu sang Lương TT — dùng cho báo cáo lưu từ trước khi có tính năng này. */
  const resyncReport = async (v: KCNVisit, wage: SurveyWageEntry[]) => {
    setSyncingId(v.id)
    const r = await syncWageToMarket(wage, v.visit_date)
    setSyncingId(null)
    notifyMarketChanged()
    onChanged?.()
    toast(syncMessage(r).replace(/^./, c => c.toUpperCase()))
  }

  const saveReport = async (v: KCNVisit) => {
    const wageSnap = cleanWageEntries(wageEntries)
    const marketOk = !!market && !market.failed
    const recordIds = recordBack ? toRecord.map(t => t.id) : []
    if (recordIds.length && !confirm(
      `Ghi nhận ${recordIds.length} đối thủ vào "${zoneName}" trên Thị trường?\n\n`
      + toRecord.map(t => `• ${t.name}`).join('\n')
      + `\n\nChỉ THÊM tên KCN này vào ô "Khu vực hoạt động" trong hồ sơ từng đối thủ. Không ai bị gỡ khỏi KCN nào, `
      + `kể cả đối thủ bạn đã bỏ chọn trong báo cáo này.`,
    )) return

    setSaving(true)
    const now = new Date().toISOString()
    const base = { ...reportForm, status: 'done', completed_at: now, updated_at: now }
    let updates: Record<string, unknown> = {
      ...base,
      // null = không có gì đáng tin để chụp (không tải được Thị trường và người dùng chưa nhập gì)
      competitors_snapshot: marketOk || compEntries.length ? compEntries : null,
      wage_snapshot: marketOk || wageSnap.length ? wageSnap : null,
    }
    let { error } = await supabase.from('kcn_visits').update(updates).eq('id', v.id)
    let folded = false
    if (error && isMissingSnapshotColumnError(error)) {
      // Chưa chạy migration 176: gộp danh sách đối thủ + lương thành chữ vào 2 ô ghi chú cũ → không mất dữ liệu.
      folded = true
      updates = {
        ...base,
        competitor_note: foldSnapshotIntoNote(reportForm.competitor_note, 'Đối thủ ghi nhận lúc khảo sát', competitorSnapshotToText(compEntries)),
        wage_note: foldSnapshotIntoNote(reportForm.wage_note, 'Lương TT lúc khảo sát', wageSnapshotToText(wageSnap)),
      }
      ;({ error } = await supabase.from('kcn_visits').update(updates).eq('id', v.id))
    }
    setSaving(false)
    if (error) { toast('Lỗi: ' + error.message); return }
    await logActivity({
      user, action: 'update', table: 'kcn_visits', recordId: v.id,
      description: `Hoàn thành khảo sát KCN "${zoneName}" (${formatDate(v.visit_date)}) và ghi báo cáo`,
      oldData: v, newData: { ...v, ...updates },
    })
    if (recordIds.length) await recordCompetitorsToZone(recordIds)
    // Ghi lương sang Lương TT sau khi báo cáo đã lưu xong — lỗi ở bước này không làm mất báo cáo
    const syncResult = syncToMarket && wageSnap.some(isSyncableWageEntry) ? await syncWageToMarket(wageSnap, v.visit_date) : null
    if (syncResult) notifyMarketChanged()
    cancelReport()
    await load()
    onChanged?.()
    const saved = folded
      ? 'Đã lưu báo cáo — chưa chạy migration 176 nên đối thủ + lương được lưu dạng chữ trong ghi chú'
      : 'Đã lưu báo cáo khảo sát'
    toast(syncResult ? `${saved}; ${syncMessage(syncResult)}` : saved)
  }

  const removeVisit = async (v: KCNVisit) => {
    if (!confirm('Xoá lịch khảo sát này?')) return
    const { error } = await supabase.from('kcn_visits').delete().eq('id', v.id)
    if (error) { toast('Lỗi: ' + error.message); return }
    await logActivity({
      user, action: 'delete', table: 'kcn_visits', recordId: v.id,
      description: `Xoá lịch khảo sát KCN "${zoneName}" (${formatDate(v.visit_date)})`,
      oldData: v,
    })
    await load()
    onChanged?.()
    toast('Đã xoá')
  }

  const REPORT_FIELDS: { key: ReportKey; label: string }[] = [
    { key: 'report_summary',  label: 'Tổng quan chuyến khảo sát' },
    { key: 'occupancy_note',  label: 'Tình hình lấp đầy / mở rộng' },
    { key: 'labor_note',      label: 'Nguồn lao động' },
    { key: 'wage_note',       label: 'Mức lương khu vực' },
    { key: 'competitor_note', label: 'Đối thủ ghi nhận' },
    { key: 'notes',           label: 'Ghi chú khác' },
  ]

  const textareaCls = `${INPUT} text-[12.5px] px-2.5 py-1.5 resize-none`

  /** Ô văn bản của form. Với 2 ô có ảnh chụp (lương / đối thủ) thì khối ảnh chụp nằm trên, ô chữ thành "ghi chú thêm". */
  const renderField = (f: { key: ReportKey; label: string }) => {
    const hasSnapshotBlock = f.key === 'wage_note' || f.key === 'competitor_note'
    return (
      <div key={f.key} className="flex flex-col gap-1.5">
        {f.key === 'wage_note' && (
          <WageEditor
            zoneName={zoneName} entries={wageEntries} loading={marketLoading} hadMarketData={hadMarketWage}
            industries={market?.industries ?? []} industriesFallback={market?.industriesFallback ?? false}
            onChange={setWageEntries}
            onAddIndustry={i => setWageEntries(es => addIndustryEntry(es, i, zoneName, market?.surveys ?? []))}
            onAssignIndustry={(idx, i) => setWageEntries(es => assignIndustryEntry(es, idx, i, zoneName, market?.surveys ?? []))}
            syncableCount={wageEntries.filter(isSyncableWageEntry).length} syncToMarket={syncToMarket} onSyncToMarket={setSyncToMarket}
          />
        )}
        {f.key === 'competitor_note' && (
          <CompetitorEditor
            zoneName={zoneName} entries={compEntries} suggested={suggested}
            allCompetitors={market?.competitors ?? []} supplyRows={market?.supplyRows ?? []} loading={marketLoading}
            onChange={setCompEntries}
            unrecorded={toRecord} recordBack={recordBack} onRecordBack={setRecordBack}
          />
        )}
        <label className="text-[11.5px] font-medium text-[#6E6E73]">{hasSnapshotBlock ? `${f.label} — ghi chú thêm` : f.label}</label>
        <textarea
          value={reportForm[f.key]}
          onChange={e => setReportForm(r => ({ ...r, [f.key]: e.target.value }))}
          rows={2}
          className={textareaCls}
        />
      </div>
    )
  }

  /** Báo cáo đã lưu: ảnh chụp đúng lúc khảo sát + chữ tự do (báo cáo cũ chỉ có chữ vẫn xem được). */
  const renderSavedField = (v: KCNVisit, f: { key: ReportKey; label: string }, comp: SurveyCompetitorEntry[] | null, wage: SurveyWageEntry[] | null) => {
    const snapshot = f.key === 'wage_note' ? wage : f.key === 'competitor_note' ? comp : null
    const text = v[f.key]
    if (!text && !snapshot) return null
    return (
      <div key={f.key}>
        <div className="text-[11.5px] text-[#6E6E73] font-medium mb-1">{f.label}</div>
        {f.key === 'wage_note' && wage && <WageSnapshotView entries={wage} />}
        {f.key === 'wage_note' && wage && wage.some(isSyncableWageEntry) && (
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => resyncReport(v, wage)} disabled={syncingId === v.id} className={`${BTN_TINTED} px-2.5 py-1 text-[11.5px]`}>
              {syncingId === v.id ? 'Đang ghi…' : 'Ghi vào Lương TT'}
            </button>
            <span className="text-[10.5px] text-[#86868B]">Thêm / cập nhật dòng lương ngày {formatDate(v.visit_date)} của KCN này trong Thị trường → Lương TT.</span>
          </div>
        )}
        {f.key === 'competitor_note' && comp && <CompetitorSnapshotView entries={comp} />}
        {text && (
          <div className={`text-[#1D1D1F] whitespace-pre-wrap ${snapshot ? 'mt-1.5 pt-1.5 border-t border-black/[0.06]' : ''}`}>
            {snapshot && <span className="block text-[10.5px] text-[#86868B] mb-0.5">Ghi chú thêm</span>}
            {text}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="bg-white border border-[#E8E7E2] rounded-[10px] overflow-hidden">
      <div className="px-4 py-2.5 border-b border-[#E8E7E2] flex items-center justify-between">
        <div className="text-[12.5px] font-semibold text-[#111] flex items-center gap-1.5"><ClipboardList size={12} /> Lịch khảo sát KCN</div>
        <button onClick={() => setShowSchedule(s => !s)} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11.5px] font-medium border border-[#E8E7E2] text-[#666] hover:bg-[#F9F9F7]">
          <CalendarPlus size={11} /> Lên lịch khảo sát
        </button>
      </div>

      {showSchedule && (
        <div className="px-4 py-2.5 border-b border-[#E8E7E2] bg-[#F9F9F7] flex items-center gap-2">
          <span className="text-[11.5px] text-[#888]">Ngày đi</span>
          <input type="date" value={visitDate} onChange={e => setVisitDate(e.target.value)} className="text-[12.5px] px-2 py-1 rounded border border-gray-200 outline-none bg-white" />
          <button onClick={handleSchedule} disabled={saving} className="ml-auto px-3 py-1 rounded-lg text-[11.5px] font-medium bg-[#1D4ED8] text-white hover:bg-[#1E40AF] disabled:opacity-60">{saving ? 'Đang lưu...' : 'Lưu'}</button>
          <button onClick={() => setShowSchedule(false)} className="px-3 py-1 rounded-lg text-[11.5px] font-medium border border-[#E8E7E2] text-[#666] hover:bg-white">Huỷ</button>
        </div>
      )}

      <div className="p-3 md:p-4 space-y-3">
        {loading ? (
          <div className="text-[11.5px] text-[#aaa] text-center py-2">Đang tải...</div>
        ) : (
          <>
            {/* Lịch sắp tới / chưa hoàn thành */}
            {planned.length > 0 && (
              <div className="space-y-2">
                <div className="text-[11px] font-medium text-[#888]">Lịch sắp tới / chưa hoàn thành</div>
                {planned.map(v => (
                  <div key={v.id} className="border border-[#E8E7E2] rounded-lg overflow-hidden">
                    <div className="flex items-center gap-2 px-3 py-2 bg-[#F9F9F7]">
                      <span className="text-[12px] font-medium text-[#333]">{formatDate(v.visit_date)}</span>
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">Chưa khảo sát</span>
                      <div className="ml-auto flex items-center gap-1.5">
                        {reportingId === v.id ? (
                          <button onClick={cancelReport} className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium border border-[#E8E7E2] text-[#666] hover:bg-white"><X size={11} /> Huỷ</button>
                        ) : (
                          <button onClick={() => startReport(v)} className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium bg-[#1D4ED8] text-white hover:bg-[#1E40AF]"><Check size={11} /> Hoàn thành & viết báo cáo</button>
                        )}
                        <button onClick={() => removeVisit(v)} className="p-1 rounded text-[#bbb] hover:text-red-500 hover:bg-red-50"><Trash2 size={12} /></button>
                      </div>
                    </div>
                    {reportingId === v.id && (
                      <div className="p-3 space-y-3 bg-white">
                        {REPORT_FIELDS.map(renderField)}
                        <div className="flex justify-end gap-2 pt-1">
                          <button onClick={cancelReport} className={`${BTN_SECONDARY} px-4 py-1.5 text-[12px]`}>Huỷ</button>
                          <button onClick={() => saveReport(v)} disabled={saving || marketLoading} className={`${BTN_PRIMARY} px-4 py-1.5 text-[12px]`}>{saving ? 'Đang lưu...' : 'Lưu báo cáo'}</button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Lịch sử báo cáo */}
            <div className="space-y-2">
              <div className="text-[11px] font-medium text-[#888]">Lịch sử khảo sát & báo cáo</div>
              {done.length === 0 ? (
                <div className="text-[11.5px] text-[#aaa] text-center py-2">Chưa có chuyến khảo sát nào hoàn thành.</div>
              ) : done.map(v => {
                const comp = parseCompetitorSnapshot(v.competitors_snapshot)
                const wage = parseWageSnapshot(v.wage_snapshot)
                const hasContent = REPORT_FIELDS.some(f => v[f.key]) || !!comp || !!wage
                return (
                  <div key={v.id} className="border border-[#E8E7E2] rounded-lg overflow-hidden">
                    <button onClick={() => setExpandedId(id => id === v.id ? null : v.id)} className="w-full flex items-center gap-2 px-3 py-2 bg-[#F9F9F7] text-left hover:bg-[#F3F2EE]">
                      <span className="text-[12px] font-medium text-[#333]">{formatDate(v.visit_date)}</span>
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">Đã khảo sát</span>
                      {comp && comp.length > 0 && <span className="hidden sm:inline text-[11px] text-[#888] shrink-0">{comp.length} đối thủ</span>}
                      {v.report_summary && <span className="text-[11px] text-[#888] truncate flex-1">{v.report_summary}</span>}
                      <Trash2 size={12} className="ml-auto text-[#ccc] hover:text-red-500" onClick={e => { e.stopPropagation(); removeVisit(v); }} />
                    </button>
                    {expandedId === v.id && (
                      <div className="p-3 space-y-3 bg-white text-[12.5px]">
                        {REPORT_FIELDS.map(f => renderSavedField(v, f, comp, wage))}
                        {!hasContent && <div className="text-[11.5px] text-[#aaa]">Không có nội dung báo cáo.</div>}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
