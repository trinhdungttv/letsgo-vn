import { useEffect, useState } from 'react'
import { CalendarPlus, Check, Trash2, ClipboardList, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { logActivity } from '../../lib/audit'
import { formatDate } from '../../lib/format'
import type { KCNVisit } from '../../lib/types'

const emptyReport = {
  report_summary: '',
  occupancy_note: '',
  labor_note: '',
  wage_note: '',
  competitor_note: '',
  notes: '',
}

interface Props {
  zoneId: string
  zoneName: string
  toast: (msg: string) => void
  onChanged?: () => void
}

/**
 * Lịch khảo sát + báo cáo cho 1 KCN (market_zones.id).
 * Dùng chung giữa Workspace > KCN Grid và Market > Hồ sơ khu vực — cùng đọc/ghi
 * bảng kcn_visits theo zone_id nên dữ liệu luôn đồng bộ ở cả 2 nơi.
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

  const startReport = (v: KCNVisit) => {
    setReportingId(v.id)
    setReportForm({
      report_summary: v.report_summary || '',
      occupancy_note: v.occupancy_note || '',
      labor_note: v.labor_note || '',
      wage_note: v.wage_note || '',
      competitor_note: v.competitor_note || '',
      notes: v.notes || '',
    })
  }

  const cancelReport = () => { setReportingId(null); setReportForm(emptyReport) }

  const saveReport = async (v: KCNVisit) => {
    setSaving(true)
    const updates = { ...reportForm, status: 'done', completed_at: new Date().toISOString(), updated_at: new Date().toISOString() }
    const { error } = await supabase.from('kcn_visits').update(updates).eq('id', v.id)
    setSaving(false)
    if (error) { toast('Lỗi: ' + error.message); return }
    await logActivity({
      user, action: 'update', table: 'kcn_visits', recordId: v.id,
      description: `Hoàn thành khảo sát KCN "${zoneName}" (${formatDate(v.visit_date)}) và ghi báo cáo`,
      oldData: v, newData: { ...v, ...updates },
    })
    cancelReport()
    await load()
    onChanged?.()
    toast('Đã lưu báo cáo khảo sát')
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

  const REPORT_FIELDS: { key: keyof typeof emptyReport; label: string }[] = [
    { key: 'report_summary',  label: 'Tổng quan chuyến khảo sát' },
    { key: 'occupancy_note',  label: 'Tình hình lấp đầy / mở rộng' },
    { key: 'labor_note',      label: 'Nguồn lao động' },
    { key: 'wage_note',       label: 'Mức lương khu vực' },
    { key: 'competitor_note', label: 'Đối thủ ghi nhận' },
    { key: 'notes',           label: 'Ghi chú khác' },
  ]

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

      <div className="p-4 space-y-3">
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
                      <div className="p-3 space-y-2 bg-white">
                        {REPORT_FIELDS.map(f => (
                          <div key={f.key} className="flex flex-col gap-1">
                            <label className="text-[11px] text-[#888]">{f.label}</label>
                            <textarea
                              value={reportForm[f.key]}
                              onChange={e => setReportForm(r => ({ ...r, [f.key]: e.target.value }))}
                              rows={2}
                              className="text-[12.5px] px-2 py-1 rounded border border-gray-200 outline-none focus:border-blue-400 resize-none"
                            />
                          </div>
                        ))}
                        <div className="flex justify-end gap-2 pt-1">
                          <button onClick={cancelReport} className="px-3 py-1.5 rounded-lg text-[11.5px] font-medium border border-[#E8E7E2] text-[#666] hover:bg-[#F9F9F7]">Huỷ</button>
                          <button onClick={() => saveReport(v)} disabled={saving} className="px-3 py-1.5 rounded-lg text-[11.5px] font-medium bg-[#1D4ED8] text-white hover:bg-[#1E40AF] disabled:opacity-60">{saving ? 'Đang lưu...' : 'Lưu báo cáo'}</button>
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
              ) : done.map(v => (
                <div key={v.id} className="border border-[#E8E7E2] rounded-lg overflow-hidden">
                  <button onClick={() => setExpandedId(id => id === v.id ? null : v.id)} className="w-full flex items-center gap-2 px-3 py-2 bg-[#F9F9F7] text-left hover:bg-[#F3F2EE]">
                    <span className="text-[12px] font-medium text-[#333]">{formatDate(v.visit_date)}</span>
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">Đã khảo sát</span>
                    {v.report_summary && <span className="text-[11px] text-[#888] truncate flex-1">{v.report_summary}</span>}
                    <Trash2 size={12} className="ml-auto text-[#ccc] hover:text-red-500" onClick={e => { e.stopPropagation(); removeVisit(v); }} />
                  </button>
                  {expandedId === v.id && (
                    <div className="p-3 space-y-2 bg-white text-[12.5px]">
                      {REPORT_FIELDS.map(f => v[f.key] && (
                        <div key={f.key}>
                          <div className="text-[11px] text-[#888] font-medium mb-0.5">{f.label}</div>
                          <div className="text-[#333] whitespace-pre-wrap">{v[f.key]}</div>
                        </div>
                      ))}
                      {!REPORT_FIELDS.some(f => v[f.key]) && <div className="text-[11.5px] text-[#aaa]">Không có nội dung báo cáo.</div>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
