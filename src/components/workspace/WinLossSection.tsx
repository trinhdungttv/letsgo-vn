// src/components/workspace/WinLossSection.tsx
import { useState, useEffect, useMemo } from 'react'
import { Trophy, TrendingUp, TrendingDown, Clock, Plus, X, ChevronDown, ChevronUp } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import type { WinLossRecord, DealType, DealResult, LossReason } from '../../lib/types'
import { LOSS_REASON_LABELS, DEAL_TYPE_LABELS } from '../../lib/types'
import { formatCurrency } from '../../lib/format'

const RESULT_CONFIG = {
  win:     { label: 'Thắng',   bg: 'bg-green-50  border-green-200  text-green-700',  dot: 'bg-green-500'  },
  loss:    { label: 'Thua',    bg: 'bg-red-50    border-red-200    text-red-700',    dot: 'bg-red-500'    },
  pending: { label: 'Đang xử lý', bg: 'bg-blue-50  border-blue-200  text-blue-700', dot: 'bg-blue-400'   },
}

const DEAL_TYPES: DealType[]   = ['new_client', 'renewal', 'expansion']
const DEAL_RESULTS: DealResult[] = ['win', 'loss', 'pending']
const LOSS_REASONS: LossReason[] = ['price','labor_quality','competitor','relationship','timing','requirements','other']

const emptyForm = {
  client_name: '',
  client_id: null as string | null,
  deal_type: 'new_client' as DealType,
  result: 'pending' as DealResult,
  labor_count: '',
  monthly_value: '',
  loss_reason: '' as LossReason | '',
  competitor_name: '',
  competitor_price: '',
  decision_maker: '',
  first_contact_date: '',
  deal_closed_date: '',
  notes: '',
}

type FilterResult = 'all' | DealResult

export function WinLossSection() {
  const { user } = useAuth()
  const [records, setRecords] = useState<WinLossRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [filter, setFilter] = useState<FilterResult>('all')
  const [editId, setEditId] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [form, setForm] = useState({ ...emptyForm })

  useEffect(() => { load() }, [user])

  async function load() {
    if (!user) return
    setLoading(true)
    const { data } = await supabase
      .from('win_loss_records')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50)
    if (data) setRecords(data as WinLossRecord[])
    setLoading(false)
  }

  const stats = useMemo(() => {
    const thisMonth = new Date().toISOString().slice(0, 7)
    const monthly = records.filter(r => r.created_at.startsWith(thisMonth))
    const wins   = records.filter(r => r.result === 'win')
    const losses = records.filter(r => r.result === 'loss')
    const closed = wins.length + losses.length
    const winRate = closed > 0 ? Math.round((wins.length / closed) * 100) : 0
    const avgDays = wins
      .filter(r => r.days_to_close)
      .reduce((s, r, _, a) => s + (r.days_to_close ?? 0) / a.length, 0)
    const totalValue = wins.reduce((s, r) => s + (r.monthly_value ?? 0), 0)
    return { winRate, totalWins: wins.length, totalLosses: losses.length, avgDays: Math.round(avgDays), totalValue, monthlyCount: monthly.length }
  }, [records])

  const filtered = filter === 'all' ? records : records.filter(r => r.result === filter)

  function openForm(r?: WinLossRecord) {
    if (r) {
      setEditId(r.id)
      setForm({
        client_name: r.client_name,
        client_id: r.client_id,
        deal_type: r.deal_type,
        result: r.result,
        labor_count: r.labor_count?.toString() ?? '',
        monthly_value: r.monthly_value?.toString() ?? '',
        loss_reason: r.loss_reason ?? '',
        competitor_name: r.competitor_name ?? '',
        competitor_price: r.competitor_price?.toString() ?? '',
        decision_maker: r.decision_maker ?? '',
        first_contact_date: r.first_contact_date ?? '',
        deal_closed_date: r.deal_closed_date ?? '',
        notes: r.notes ?? '',
      })
    } else {
      setEditId(null)
      setForm({ ...emptyForm })
    }
    setShowForm(true)
  }

  async function save() {
    if (!user || !form.client_name.trim()) return
    setSaving(true)
    const payload = {
      user_id: user.id,
      client_name: form.client_name.trim(),
      client_id: form.client_id || null,
      deal_type: form.deal_type,
      result: form.result,
      labor_count: form.labor_count ? parseInt(form.labor_count) : null,
      monthly_value: form.monthly_value ? parseFloat(form.monthly_value) : null,
      loss_reason: form.loss_reason || null,
      competitor_name: form.competitor_name.trim() || null,
      competitor_price: form.competitor_price ? parseFloat(form.competitor_price) : null,
      decision_maker: form.decision_maker.trim() || null,
      first_contact_date: form.first_contact_date || null,
      deal_closed_date: form.deal_closed_date || null,
      notes: form.notes.trim() || null,
      updated_at: new Date().toISOString(),
    }
    if (editId) {
      await supabase.from('win_loss_records').update(payload).eq('id', editId)
    } else {
      await supabase.from('win_loss_records').insert(payload)
    }
    await load()
    setShowForm(false)
    setSaving(false)
  }

  const f = (k: keyof typeof emptyForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(prev => ({ ...prev, [k]: e.target.value }))

  const inputCls = "w-full text-[12px] border border-[#E8E7E2] rounded-md px-2.5 py-1.5 bg-white text-[#333] placeholder:text-[#bbb] focus:outline-none focus:border-blue-400"
  const labelCls = "text-[10px] font-medium text-[#888] uppercase tracking-wide mb-1 block"

  return (
    <div className="flex flex-col">

      {/* KPI bar */}
      <div className="grid grid-cols-4 gap-0 border-b border-[#E8E7E2]">
        {[
          { label: 'Tỷ lệ thắng', value: `${stats.winRate}%`, icon: <Trophy size={12} className="text-yellow-500" />, color: stats.winRate >= 60 ? 'text-green-600' : stats.winRate >= 40 ? 'text-yellow-600' : 'text-red-500' },
          { label: 'Deals thắng', value: stats.totalWins, icon: <TrendingUp size={12} className="text-green-500" />, color: 'text-green-600' },
          { label: 'Deals thua',  value: stats.totalLosses, icon: <TrendingDown size={12} className="text-red-400" />, color: 'text-red-500' },
          { label: 'Ngày TB/deal', value: stats.avgDays || '—', icon: <Clock size={12} className="text-blue-400" />, color: 'text-[#333]' },
        ].map((s, i) => (
          <div key={i} className="flex flex-col items-center py-2.5 border-r border-[#E8E7E2] last:border-r-0">
            <div className="flex items-center gap-1 mb-0.5">{s.icon}<span className="text-[10px] text-[#999]">{s.label}</span></div>
            <span className={`text-[18px] font-medium ${s.color}`}>{s.value}</span>
          </div>
        ))}
      </div>

      {/* Filter + Add */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#E8E7E2]">
        <div className="flex gap-1">
          {(['all', 'win', 'loss', 'pending'] as FilterResult[]).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`text-[11px] px-2.5 py-1 rounded-full border transition-all ${
                filter === f
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-[#666] border-[#E8E7E2] hover:border-blue-200'
              }`}
            >
              {f === 'all' ? `Tất cả (${records.length})` : `${RESULT_CONFIG[f as DealResult].label} (${records.filter(r => r.result === f).length})`}
            </button>
          ))}
        </div>
        <button
          onClick={() => openForm()}
          className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-md bg-blue-600 text-white hover:bg-blue-700 transition-colors"
        >
          <Plus size={12} /> Ghi deal
        </button>
      </div>

      {/* Form inline */}
      {showForm && (
        <div className="border-b border-[#E8E7E2] bg-[#fafafa] p-3">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[12px] font-medium text-[#333]">{editId ? 'Chỉnh sửa deal' : 'Ghi nhận deal mới'}</span>
            <button onClick={() => setShowForm(false)}><X size={14} className="text-[#999]" /></button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className={labelCls}>Tên khách hàng *</label>
              <input className={inputCls} placeholder="Tên công ty / nhà máy..." value={form.client_name} onChange={f('client_name')} />
            </div>

            <div>
              <label className={labelCls}>Loại deal</label>
              <select className={inputCls} value={form.deal_type} onChange={f('deal_type')}>
                {DEAL_TYPES.map(t => <option key={t} value={t}>{DEAL_TYPE_LABELS[t]}</option>)}
              </select>
            </div>

            <div>
              <label className={labelCls}>Kết quả</label>
              <select className={inputCls} value={form.result} onChange={f('result')}>
                {DEAL_RESULTS.map(r => <option key={r} value={r}>{RESULT_CONFIG[r].label}</option>)}
              </select>
            </div>

            <div>
              <label className={labelCls}>Số lao động</label>
              <input className={inputCls} type="number" placeholder="100" value={form.labor_count} onChange={f('labor_count')} />
            </div>

            <div>
              <label className={labelCls}>Doanh thu/tháng (tr VNĐ)</label>
              <input className={inputCls} type="number" placeholder="50000000" value={form.monthly_value} onChange={f('monthly_value')} />
            </div>

            <div>
              <label className={labelCls}>Ngày tiếp cận đầu</label>
              <input className={inputCls} type="date" value={form.first_contact_date} onChange={f('first_contact_date')} />
            </div>

            <div>
              <label className={labelCls}>Ngày chốt deal</label>
              <input className={inputCls} type="date" value={form.deal_closed_date} onChange={f('deal_closed_date')} />
            </div>

            <div>
              <label className={labelCls}>Người quyết định bên KH</label>
              <input className={inputCls} placeholder="Mr. Tanaka – HR Manager..." value={form.decision_maker} onChange={f('decision_maker')} />
            </div>

            {form.result === 'loss' && (
              <>
                <div>
                  <label className={labelCls}>Lý do thua *</label>
                  <select className={inputCls} value={form.loss_reason} onChange={f('loss_reason')}>
                    <option value="">-- Chọn lý do --</option>
                    {LOSS_REASONS.map(r => <option key={r} value={r}>{LOSS_REASON_LABELS[r]}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Đối thủ thắng</label>
                  <input className={inputCls} placeholder="Tên công ty đối thủ..." value={form.competitor_name} onChange={f('competitor_name')} />
                </div>
                <div>
                  <label className={labelCls}>Giá đối thủ offer (nếu biết)</label>
                  <input className={inputCls} type="number" placeholder="45000000" value={form.competitor_price} onChange={f('competitor_price')} />
                </div>
              </>
            )}

            <div className="col-span-2">
              <label className={labelCls}>Ghi chú</label>
              <textarea rows={2} className={`${inputCls} resize-none`} placeholder="Bài học rút ra, thông tin thêm..." value={form.notes} onChange={f('notes')} />
            </div>
          </div>

          <div className="flex justify-end gap-2 mt-3">
            <button onClick={() => setShowForm(false)} className="text-[12px] px-3 py-1.5 rounded-md border border-[#E8E7E2] text-[#666] hover:bg-[#f5f5f5]">Huỷ</button>
            <button onClick={save} disabled={saving || !form.client_name.trim()} className="text-[12px] px-4 py-1.5 rounded-md bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-40">
              {saving ? 'Đang lưu...' : editId ? 'Cập nhật' : 'Lưu deal'}
            </button>
          </div>
        </div>
      )}

      {/* Records list */}
      <div className="flex flex-col divide-y divide-[#F0EFEB] max-h-[360px] overflow-y-auto">
        {loading && <div className="text-[11px] text-[#999] p-4 text-center">Đang tải...</div>}
        {!loading && filtered.length === 0 && (
          <div className="text-[11px] text-[#bbb] p-6 text-center">Chưa có deal nào. Bấm "Ghi deal" để bắt đầu.</div>
        )}
        {filtered.map(r => (
          <div key={r.id} className="px-3 py-2">
            <div
              className="flex items-center gap-2 cursor-pointer"
              onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}
            >
              <div className={`w-2 h-2 rounded-full shrink-0 ${RESULT_CONFIG[r.result].dot}`} />
              <span className="text-[12px] font-medium text-[#333] flex-1 truncate">{r.client_name}</span>
              <span className={`text-[10px] px-2 py-0.5 rounded-full border ${RESULT_CONFIG[r.result].bg}`}>
                {RESULT_CONFIG[r.result].label}
              </span>
              <span className="text-[10px] text-[#bbb]">{DEAL_TYPE_LABELS[r.deal_type]}</span>
              {r.labor_count && <span className="text-[10px] text-[#888]">{r.labor_count} LĐ</span>}
              {r.monthly_value && <span className="text-[10px] font-medium text-blue-600">{formatCurrency(r.monthly_value)}</span>}
              {expandedId === r.id ? <ChevronUp size={12} className="text-[#bbb]" /> : <ChevronDown size={12} className="text-[#bbb]" />}
            </div>

            {expandedId === r.id && (
              <div className="mt-2 ml-4 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]">
                {r.loss_reason && (
                  <div className="col-span-2 flex items-center gap-1.5 bg-red-50 border border-red-100 rounded px-2 py-1">
                    <span className="text-red-500 font-medium">Lý do thua:</span>
                    <span className="text-red-700">{LOSS_REASON_LABELS[r.loss_reason]}</span>
                  </div>
                )}
                {r.competitor_name && <div><span className="text-[#999]">Đối thủ: </span><span className="text-[#555]">{r.competitor_name}</span></div>}
                {r.competitor_price && <div><span className="text-[#999]">Giá đối thủ: </span><span className="text-red-600">{formatCurrency(r.competitor_price)}</span></div>}
                {r.decision_maker && <div><span className="text-[#999]">Người quyết định: </span><span className="text-[#555]">{r.decision_maker}</span></div>}
                {r.days_to_close && <div><span className="text-[#999]">Thời gian chốt: </span><span className="text-[#555]">{r.days_to_close} ngày</span></div>}
                {r.notes && <div className="col-span-2 text-[#888] italic">{r.notes}</div>}
                <div className="col-span-2 flex justify-end mt-1">
                  <button onClick={() => openForm(r)} className="text-[10px] text-blue-500 hover:underline">Chỉnh sửa</button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
