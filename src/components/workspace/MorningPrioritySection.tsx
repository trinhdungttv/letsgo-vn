// src/components/workspace/MorningPrioritySection.tsx
import { useState, useEffect } from 'react'
import { Sun, CheckCircle2, Circle, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import type { MorningPriority, GoalType, OutcomeStatus } from '../../lib/types'
import { GOAL_TYPE_LABELS } from '../../lib/types'
import { formatDate } from '../../lib/format'

const KCN_OPTIONS = [
  'VSIP I', 'VSIP II', 'Biên Hoà 1', 'Biên Hoà 2',
  'Amata', 'Long Thành', 'Nhơn Trạch', 'Bàu Bàng', 'Mỹ Phước', 'Khác',
]

const OUTCOME_CONFIG: Record<OutcomeStatus, { label: string; color: string; icon: JSX.Element }> = {
  done:    { label: 'Hoàn thành',       color: 'text-green-600 bg-green-50 border-green-200',  icon: <CheckCircle2 size={13} /> },
  partial: { label: 'Hoàn thành một phần', color: 'text-yellow-600 bg-yellow-50 border-yellow-200', icon: <AlertCircle size={13} /> },
  missed:  { label: 'Không thực hiện được', color: 'text-red-500 bg-red-50 border-red-200',   icon: <Circle size={13} /> },
}

function todayStr() {
  return new Date().toISOString().split('T')[0]
}

export function MorningPrioritySection() {
  const { user } = useAuth()
  const [today, setToday] = useState<MorningPriority | null>(null)
  const [history, setHistory] = useState<MorningPriority[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [showEOD, setShowEOD] = useState(false)

  // Form state – sáng
  const [client, setClient] = useState('')
  const [kcn, setKcn] = useState('')
  const [goalType, setGoalType] = useState<GoalType>('follow_up')
  const [goalNote, setGoalNote] = useState('')

  // Form state – EOD
  const [outcomeNote, setOutcomeNote] = useState('')
  const [outcomeStatus, setOutcomeStatus] = useState<OutcomeStatus>('done')

  useEffect(() => { load() }, [user])

  async function load() {
    if (!user) return
    setLoading(true)
    const { data } = await supabase
      .from('morning_priorities')
      .select('*')
      .eq('user_id', user.id)
      .order('priority_date', { ascending: false })
      .limit(8)
    if (data) {
      const td = data.find(d => d.priority_date === todayStr()) ?? null
      setToday(td)
      setHistory(data.filter(d => d.priority_date !== todayStr()))
      if (td) {
        setClient(td.target_client ?? '')
        setKcn(td.target_kcn ?? '')
        setGoalType((td.goal_type as GoalType) ?? 'follow_up')
        setGoalNote(td.goal_note ?? '')
        setOutcomeNote(td.outcome_note ?? '')
        setOutcomeStatus((td.outcome_status as OutcomeStatus) ?? 'done')
      }
    }
    setLoading(false)
  }

  async function saveMorning() {
    if (!user || !client.trim()) return
    setSaving(true)
    const payload = {
      user_id: user.id,
      priority_date: todayStr(),
      target_client: client.trim(),
      target_kcn: kcn || null,
      goal_type: goalType,
      goal_note: goalNote.trim() || null,
      updated_at: new Date().toISOString(),
    }
    const { data } = today
      ? await supabase.from('morning_priorities').update(payload).eq('id', today.id).select().single()
      : await supabase.from('morning_priorities').insert(payload).select().single()
    if (data) setToday(data)
    setSaving(false)
  }

  async function saveEOD() {
    if (!user || !today) return
    setSaving(true)
    const { data } = await supabase
      .from('morning_priorities')
      .update({ outcome_note: outcomeNote, outcome_status: outcomeStatus, updated_at: new Date().toISOString() })
      .eq('id', today.id)
      .select()
      .single()
    if (data) setToday(data)
    setShowEOD(false)
    setSaving(false)
  }

  const isLocked = !!today?.target_client

  if (loading) return (
    <div className="text-[11px] text-[#999] p-4">Đang tải...</div>
  )

  return (
    <div className="flex flex-col gap-0">

      {/* Sáng – khai báo */}
      <div className="p-3 border-b border-[#E8E7E2]">
        <div className="flex items-center gap-1.5 mb-2.5">
          <Sun size={13} className="text-yellow-500" />
          <span className="text-[11px] font-medium text-[#333]">
            Ưu tiên hôm nay — {new Date().toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit' })}
          </span>
          {isLocked && today?.outcome_status && (
            <span className={`ml-auto text-[10px] px-2 py-0.5 rounded-full border flex items-center gap-1 ${OUTCOME_CONFIG[today.outcome_status].color}`}>
              {OUTCOME_CONFIG[today.outcome_status].icon}
              {OUTCOME_CONFIG[today.outcome_status].label}
            </span>
          )}
        </div>

        <div className="flex flex-col gap-2">
          {/* Client + KCN */}
          <div className="flex gap-2">
            <input
              className="flex-1 text-[12px] border border-[#E8E7E2] rounded-md px-2.5 py-1.5 bg-white text-[#333] placeholder:text-[#bbb] focus:outline-none focus:border-blue-400"
              placeholder="Tên khách hàng sẽ thăm / liên hệ hôm nay..."
              value={client}
              onChange={e => setClient(e.target.value)}
              disabled={isLocked && !!today?.outcome_status}
            />
            <select
              className="text-[12px] border border-[#E8E7E2] rounded-md px-2 py-1.5 bg-white text-[#555] focus:outline-none focus:border-blue-400 min-w-[110px]"
              value={kcn}
              onChange={e => setKcn(e.target.value)}
              disabled={isLocked && !!today?.outcome_status}
            >
              <option value="">-- KCN --</option>
              {KCN_OPTIONS.map(k => <option key={k} value={k}>{k}</option>)}
            </select>
          </div>

          {/* Goal type */}
          <div className="flex gap-1.5 flex-wrap">
            {(Object.entries(GOAL_TYPE_LABELS) as [GoalType, string][]).map(([k, v]) => (
              <button
                key={k}
                onClick={() => setGoalType(k)}
                className={`text-[11px] px-2.5 py-1 rounded-full border transition-all ${
                  goalType === k
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-[#666] border-[#E8E7E2] hover:border-blue-300'
                }`}
              >
                {v}
              </button>
            ))}
          </div>

          {/* Goal note + Save */}
          <div className="flex gap-2">
            <input
              className="flex-1 text-[12px] border border-[#E8E7E2] rounded-md px-2.5 py-1.5 bg-white text-[#333] placeholder:text-[#bbb] focus:outline-none focus:border-blue-400"
              placeholder="Ghi chú thêm (không bắt buộc)..."
              value={goalNote}
              onChange={e => setGoalNote(e.target.value)}
            />
            <button
              onClick={saveMorning}
              disabled={saving || !client.trim()}
              className="text-[12px] px-3 py-1.5 rounded-md bg-blue-600 text-white font-medium disabled:opacity-40 hover:bg-blue-700 transition-colors whitespace-nowrap"
            >
              {saving ? '...' : isLocked ? 'Cập nhật' : 'Lưu kế hoạch'}
            </button>
          </div>
        </div>
      </div>

      {/* EOD – báo cáo kết quả (chỉ hiện khi đã set kế hoạch) */}
      {isLocked && (
        <div className="border-b border-[#E8E7E2]">
          <button
            onClick={() => setShowEOD(v => !v)}
            className="w-full flex items-center justify-between px-3 py-2 text-[11px] text-[#666] hover:bg-[#fafafa] transition-colors"
          >
            <span className="flex items-center gap-1.5">
              <CheckCircle2 size={12} className={today?.outcome_status ? 'text-green-500' : 'text-[#bbb]'} />
              {today?.outcome_status ? 'Kết quả đã cập nhật' : 'Cập nhật kết quả cuối ngày'}
            </span>
            {showEOD ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>

          {showEOD && (
            <div className="px-3 pb-3 flex flex-col gap-2">
              <div className="flex gap-2">
                {(['done', 'partial', 'missed'] as OutcomeStatus[]).map(s => (
                  <button
                    key={s}
                    onClick={() => setOutcomeStatus(s)}
                    className={`flex-1 text-[11px] py-1.5 rounded-md border transition-all flex items-center justify-center gap-1 ${
                      outcomeStatus === s ? OUTCOME_CONFIG[s].color : 'bg-white text-[#888] border-[#E8E7E2]'
                    }`}
                  >
                    {OUTCOME_CONFIG[s].icon} {OUTCOME_CONFIG[s].label}
                  </button>
                ))}
              </div>
              <textarea
                rows={2}
                className="text-[12px] border border-[#E8E7E2] rounded-md px-2.5 py-1.5 bg-white text-[#333] placeholder:text-[#bbb] focus:outline-none focus:border-blue-400 resize-none"
                placeholder="Kết quả thực tế: gặp ai, nói gì, bước tiếp theo..."
                value={outcomeNote}
                onChange={e => setOutcomeNote(e.target.value)}
              />
              <button
                onClick={saveEOD}
                disabled={saving}
                className="self-end text-[12px] px-3 py-1.5 rounded-md bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-40"
              >
                {saving ? '...' : 'Lưu kết quả'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Lịch sử 7 ngày */}
      {history.length > 0 && (
        <div>
          <button
            onClick={() => setShowHistory(v => !v)}
            className="w-full flex items-center justify-between px-3 py-2 text-[11px] text-[#999] hover:bg-[#fafafa]"
          >
            <span>Lịch sử 7 ngày gần nhất</span>
            {showHistory ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
          {showHistory && (
            <div className="flex flex-col divide-y divide-[#F0EFEB]">
              {history.slice(0, 7).map(h => (
                <div key={h.id} className="px-3 py-2 flex items-center gap-2">
                  <span className="text-[10px] text-[#999] w-16 shrink-0">{formatDate(h.priority_date)}</span>
                  <span className="text-[11.5px] text-[#555] flex-1 truncate">{h.target_client}</span>
                  {h.outcome_status && (
                    <span className={`text-[10px] px-2 py-0.5 rounded-full border flex items-center gap-1 ${OUTCOME_CONFIG[h.outcome_status].color}`}>
                      {OUTCOME_CONFIG[h.outcome_status].icon}
                      {OUTCOME_CONFIG[h.outcome_status].label}
                    </span>
                  )}
                  {!h.outcome_status && (
                    <span className="text-[10px] text-[#bbb]">Chưa cập nhật</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
