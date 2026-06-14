// src/components/workspace/KCNGridSection.tsx
import { useState, useEffect, Fragment } from 'react'
import { MapPin, TrendingUp, Settings, ChevronDown, ChevronUp, CalendarClock } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { formatDate } from '../../lib/format'
import type { KCNSummary } from '../../lib/types'
import { KCNVisitHistory } from './KCNVisitHistory'

// Màu theo số ngày chưa ghé thăm
function visitColor(days: number | null): { row: string; badge: string; label: string } {
  if (days === null)  return { row: 'bg-[#fafafa]',                badge: 'bg-gray-100 text-gray-500 border-gray-200',   label: 'Chưa có KH' }
  if (days >= 21)     return { row: 'bg-red-50/60',               badge: 'bg-red-50 text-red-700 border-red-200',        label: `${days} ngày` }
  if (days >= 10)     return { row: 'bg-yellow-50/60',            badge: 'bg-yellow-50 text-yellow-700 border-yellow-200', label: `${days} ngày` }
  return               { row: 'bg-green-50/40',                   badge: 'bg-green-50 text-green-700 border-green-200',  label: `${days} ngày` }
}

function PotentialDots({ score }: { score: number }) {
  return (
    <div className="flex gap-0.5">
      {[1,2,3,4,5].map(i => (
        <div key={i} className={`w-2 h-2 rounded-full ${i <= score ? 'bg-blue-500' : 'bg-[#E8E7E2]'}`} />
      ))}
    </div>
  )
}

interface Props {
  toast: (msg: string) => void
}

export function KCNGridSection({ toast }: Props) {
  const { user } = useAuth()
  const [zones, setZones] = useState<KCNSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [sortBy, setSortBy] = useState<'risk' | 'clients' | 'potential'>('risk')
  const [filterProvince, setFilterProvince] = useState<string>('all')
  const [expandedZoneId, setExpandedZoneId] = useState<string | null>(null)
  const isAdmin = user?.role === 'admin'

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('kcn_summary')
      .select('*')
    if (data) setZones(data as KCNSummary[])
    setLoading(false)
  }

  const provinces = ['all', ...Array.from(new Set(zones.map(z => z.province).filter(Boolean)))]

  const sorted = [...zones]
    .filter(z => filterProvince === 'all' || z.province === filterProvince)
    .sort((a, b) => {
      if (sortBy === 'risk') {
        const dA = a.days_since_visit ?? 999
        const dB = b.days_since_visit ?? 999
        return dB - dA
      }
      if (sortBy === 'clients') return (b.client_count ?? 0) - (a.client_count ?? 0)
      return (b.potential_score ?? 0) - (a.potential_score ?? 0)
    })

  // Tóm tắt
  const uncovered   = zones.filter(z => !z.client_count).length
  const redZones    = zones.filter(z => (z.days_since_visit ?? 999) >= 21 && z.client_count > 0).length

  return (
    <div className="flex flex-col">

      {/* Summary bar */}
      <div className="grid grid-cols-3 border-b border-[#E8E7E2]">
        {[
          { label: 'KCN có KH',      value: zones.filter(z => z.client_count > 0).length, sub: `/ ${zones.length} KCN`, color: 'text-blue-600' },
          { label: 'KCN chưa khai thác', value: uncovered,    sub: 'cơ hội mở rộng', color: 'text-[#333]' },
          { label: 'KCN cần ghé thăm',   value: redZones,     sub: '>21 ngày không ghé', color: redZones > 0 ? 'text-red-600' : 'text-green-600' },
        ].map((s, i) => (
          <div key={i} className="flex flex-col items-center py-2.5 border-r border-[#E8E7E2] last:border-r-0">
            <span className="text-[10px] text-[#999] mb-0.5">{s.label}</span>
            <span className={`text-[18px] font-medium ${s.color}`}>{s.value}</span>
            <span className="text-[10px] text-[#bbb]">{s.sub}</span>
          </div>
        ))}
      </div>

      {/* Filter + Sort */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[#E8E7E2]">
        {/* Province filter */}
        <div className="flex gap-1">
          {provinces.map(p => (
            <button
              key={p}
              onClick={() => setFilterProvince(p)}
              className={`text-[11px] px-2.5 py-1 rounded-full border transition-all ${
                filterProvince === p
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-[#666] border-[#E8E7E2] hover:border-blue-200'
              }`}
            >
              {p === 'all' ? 'Tất cả' : p}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <span className="text-[10px] text-[#999]">Sắp xếp:</span>
          <select
            className="text-[11px] border border-[#E8E7E2] rounded px-2 py-1 bg-white text-[#555] focus:outline-none"
            value={sortBy}
            onChange={e => setSortBy(e.target.value as typeof sortBy)}
          >
            <option value="risk">Rủi ro cao nhất</option>
            <option value="clients">Nhiều KH nhất</option>
            <option value="potential">Tiềm năng cao nhất</option>
          </select>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 px-3 py-1.5 border-b border-[#E8E7E2] bg-[#fafafa]">
        {[
          { color: 'bg-red-400',    label: 'Cần ghé ngay (>21 ngày)' },
          { color: 'bg-yellow-400', label: 'Theo dõi (10–21 ngày)' },
          { color: 'bg-green-400',  label: 'Đang chăm tốt (<10 ngày)' },
          { color: 'bg-gray-300',   label: 'Chưa có KH' },
        ].map(l => (
          <div key={l.label} className="flex items-center gap-1">
            <div className={`w-2 h-2 rounded-full ${l.color}`} />
            <span className="text-[10px] text-[#888]">{l.label}</span>
          </div>
        ))}
      </div>

      {/* KCN Table */}
      {loading
        ? <div className="text-[11px] text-[#999] p-4 text-center">Đang tải...</div>
        : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#E8E7E2] bg-[#fafafa]">
                  {['KCN', 'Tỉnh', 'KH active', 'Tiềm năng', 'Lần ghé gần nhất', 'Lịch khảo sát', 'Trạng thái', ''].map(h => (
                    <th key={h} className="text-left text-[10px] font-medium text-[#999] uppercase tracking-wide px-3 py-2">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F0EFEB]">
                {sorted.map(zone => {
                  const vc = visitColor(zone.days_since_visit)
                  const isExpanded = expandedZoneId === zone.id
                  return (
                    <Fragment key={zone.id}>
                    <tr className={`${vc.row} hover:brightness-95 transition-all cursor-pointer`} onClick={() => setExpandedZoneId(isExpanded ? null : zone.id)}>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <MapPin size={11} className="text-[#bbb] shrink-0" />
                          <span className="text-[12px] font-medium text-[#333]">{zone.name}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-[11px] text-[#888]">{zone.province}</td>
                      <td className="px-3 py-2.5">
                        <span className={`text-[13px] font-medium ${zone.client_count > 0 ? 'text-[#333]' : 'text-[#ccc]'}`}>
                          {zone.client_count || '—'}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <PotentialDots score={zone.potential_score ?? 0} />
                      </td>
                      <td className="px-3 py-2.5">
                        {zone.last_visit_date
                          ? <span className="text-[11px] text-[#666]">
                              {new Date(zone.last_visit_date).toLocaleDateString('vi-VN')}
                            </span>
                          : <span className="text-[11px] text-[#ccc]">Chưa ghé thăm</span>
                        }
                      </td>
                      <td className="px-3 py-2.5">
                        {zone.next_visit_date
                          ? <span className="text-[11px] text-blue-600 inline-flex items-center gap-1"><CalendarClock size={10} /> {formatDate(zone.next_visit_date)}</span>
                          : <span className="text-[11px] text-[#ccc]">—</span>
                        }
                      </td>
                      <td className="px-3 py-2.5">
                        {zone.client_count === 0
                          ? <span className="text-[11px] px-2 py-0.5 rounded-full border bg-blue-50 text-blue-600 border-blue-200">
                              <TrendingUp size={10} className="inline mr-0.5" />Cơ hội
                            </span>
                          : <span className={`text-[11px] px-2 py-0.5 rounded-full border ${vc.badge}`}>
                              {vc.label} trước
                            </span>
                        }
                      </td>
                      <td className="px-3 py-2.5 text-[#bbb]">
                        {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan={8} className="p-3 bg-[#fafafa]">
                          <KCNVisitHistory zoneId={zone.id} zoneName={zone.name} toast={toast} onChanged={load} />
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )
      }

      {isAdmin && (
        <div className="border-t border-[#E8E7E2] px-3 py-2 text-[10px] text-[#bbb] flex items-center gap-1">
          <Settings size={11} />
          <span>
            Quản lý danh sách KCN:{' '}
            <a href="/admin" className="text-blue-500 hover:underline">Admin → KCN Settings</a>
          </span>
        </div>
      )}
    </div>
  )
}
