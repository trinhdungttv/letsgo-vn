import { useState, useMemo } from 'react';
import type { Client } from '../lib/types';
import { useRegions } from '../hooks/useRegions';
import { useManagers } from '../hooks/useManagers';
import FilterDropdown, { ALL_OPTION } from './FilterDropdown';

interface Props {
  clients: Client[];
  onClientClick?: (c: Client) => void;
}

function TimelinePill({
  day, label, highlight,
}: { day: number; label: string; highlight: 'done' | 'active' | 'pending' }) {
  const styles = {
    done: 'bg-emerald-100 text-emerald-700 border-emerald-300',
    active: 'bg-amber-100 text-amber-700 border-amber-300',
    pending: 'bg-gray-100 text-gray-500 border-gray-200',
  };
  return (
    <div className="flex flex-col items-center gap-0.5 min-w-[52px]">
      <div className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${styles[highlight]}`}>
        Ngày {day}
      </div>
      <div className="text-[9.5px] text-[#999] whitespace-nowrap">{label}</div>
    </div>
  );
}

function Connector({ active }: { active: boolean }) {
  return <div className={`w-5 h-0.5 mb-4 flex-shrink-0 ${active ? 'bg-emerald-300' : 'bg-gray-200'}`} />;
}

export default function FinanceTimeline({ clients, onClientClick }: Props) {
  const todayNum = new Date().getDate();

  const { regions: regionList } = useRegions();
  const { managers: managerList } = useManagers();

  const regions = useMemo(() => [ALL_OPTION, ...regionList.map(r => r.name)], [regionList]);
  const managers = useMemo(() => [ALL_OPTION, ...managerList.map(m => m.name)], [managerList]);

  const [filterRegion, setFilterRegion] = useState<string[]>([ALL_OPTION]);
  const [filterManager, setFilterManager] = useState<string[]>([ALL_OPTION]);

  const filtered = useMemo(() => clients.filter(c => {
    const byRegion = filterRegion.includes(ALL_OPTION) || filterRegion.includes(c.region || '');
    const byManager = filterManager.includes(ALL_OPTION) || filterManager.includes(c.manager || '');
    return byRegion && byManager;
  }), [clients, filterRegion, filterManager]);

  return (
    <div className="bg-white border border-[#E8E7E2] rounded-[10px] overflow-hidden">
      {/* Filter bar */}
      <div className="px-4 py-2.5 border-b border-[#E8E7E2] flex items-center gap-3 flex-wrap">
        <span className="text-[12px] text-[#666] font-medium shrink-0">Lọc:</span>
        <FilterDropdown label="Chi nhánh" options={regions} selected={filterRegion} onChange={setFilterRegion} allLabel="Tất cả chi nhánh" />
        <FilterDropdown label="Quản lý" options={managers} selected={filterManager} onChange={setFilterManager} allLabel="Tất cả QL" />
        {(!filterRegion.includes(ALL_OPTION) || !filterManager.includes(ALL_OPTION)) && (
          <button
            onClick={() => { setFilterRegion([ALL_OPTION]); setFilterManager([ALL_OPTION]); }}
            className="text-[11.5px] text-blue-600 hover:underline"
          >
            Xóa lọc
          </button>
        )}
        <span className="ml-auto text-[11.5px] text-[#aaa]">{filtered.length} khách hàng</span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="bg-[#F9F9F7] border-b border-[#E8E7E2]">
              <th className="text-left px-4 py-2.5 font-medium text-[#666] w-8">STT</th>
              <th className="text-left px-4 py-2.5 font-medium text-[#666]">Tên khách hàng</th>
              <th className="text-left px-4 py-2.5 font-medium text-[#666]">Khu vực</th>
              <th className="text-left px-4 py-2.5 font-medium text-[#666]">Người quản lý</th>
              <th className="text-center px-4 py-2.5 font-medium text-[#666]">Timeline thanh toán</th>
              <th className="text-center px-4 py-2.5 font-medium text-[#666]">Phát lương</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#F0EEE9]">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center py-10 text-[#aaa]">Không có khách hàng nào</td>
              </tr>
            ) : filtered.map((c, idx) => {
              const cutoffHighlight = todayNum >= c.cutoff_day ? 'done' : todayNum === c.cutoff_day - 1 ? 'active' : 'pending';
              const payStartHighlight = todayNum >= c.payment_start ? 'done' : todayNum === c.payment_start - 1 ? 'active' : 'pending';
              const payEndHighlight = todayNum >= c.payment_end ? 'done' : todayNum >= c.payment_start ? 'active' : 'pending';
              const salaryHighlight = todayNum >= c.salary_day ? 'done' : todayNum === c.salary_day - 1 ? 'active' : 'pending';

              return (
                <tr key={c.id} className="hover:bg-[#FAFAF8] transition">
                  <td className="px-4 py-3 text-[#aaa]">{idx + 1}</td>
                  <td className="px-4 py-3">
                    {onClientClick ? (
                      <button onClick={() => onClientClick(c)} className="font-semibold text-[#111] hover:text-blue-600 hover:underline text-left">
                        {c.name}
                      </button>
                    ) : (
                      <div className="font-semibold text-[#111]">{c.name}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-[#555]">{c.region || '—'}</td>
                  <td className="px-4 py-3 text-[#555]">{c.manager || '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-center gap-0">
                      <TimelinePill day={c.cutoff_day} label="Chốt công" highlight={cutoffHighlight} />
                      <Connector active={cutoffHighlight === 'done'} />
                      <TimelinePill day={c.payment_start} label="Bắt đầu TT" highlight={payStartHighlight} />
                      <Connector active={payEndHighlight !== 'pending'} />
                      <TimelinePill day={c.payment_end} label="Hạn TT" highlight={payEndHighlight} />
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-center">
                      <TimelinePill day={c.salary_day} label="Phát lương" highlight={salaryHighlight} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
