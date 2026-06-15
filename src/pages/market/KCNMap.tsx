import { useEffect, useMemo, useState } from 'react';
import { Map } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type { Competitor, CompetitorClient } from '../../lib/types';

interface Props {
  competitors: Competitor[];
  toast: (msg: string) => void;
}

interface LgClient { name: string; current_workers: number | null; industrial_zones: string[] }

const COLORS = ['#DC2626', '#D97706', '#7C3AED', '#059669', '#DB2777', '#0891B2', '#65A30D', '#9333EA'];
const LG_COLOR = '#1D4ED8';

export default function KCNMap({ competitors, toast }: Props) {
  const [clients, setClients] = useState<LgClient[]>([]);
  const [compClients, setCompClients] = useState<CompetitorClient[]>([]);
  const [selectedKCN, setSelectedKCN] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [{ data: clientsData, error: e1 }, { data: ccData, error: e2 }] = await Promise.all([
        supabase.from('clients').select('name, current_workers, industrial_zones').is('archived_at', null),
        supabase.from('competitor_clients').select('*'),
      ]);
      if (e1 || e2) toast('Lỗi tải dữ liệu: ' + (e1?.message || e2?.message));
      setClients(clientsData ?? []);
      setCompClients(ccData ?? []);
      setLoading(false);
    })();
  }, []);

  const kcnList = useMemo(() => {
    const set = new Set<string>();
    clients.forEach(c => (c.industrial_zones ?? []).forEach(z => z && set.add(z)));
    compClients.forEach(c => c.kcn && set.add(c.kcn));
    return Array.from(set).sort();
  }, [clients, compClients]);

  useEffect(() => {
    if (!selectedKCN && kcnList.length) setSelectedKCN(kcnList[0]);
  }, [kcnList, selectedKCN]);

  const rows = useMemo(() => {
    if (!selectedKCN) return [];
    const lgTotal = clients
      .filter(c => (c.industrial_zones ?? []).includes(selectedKCN))
      .reduce((s, c) => s + (c.current_workers ?? 0), 0);

    const byCompetitor = new Map<string, number>();
    compClients.filter(c => c.kcn === selectedKCN).forEach(c => {
      byCompetitor.set(c.competitor_id, (byCompetitor.get(c.competitor_id) ?? 0) + (c.worker_count ?? 0));
    });

    const competitorRows = Array.from(byCompetitor.entries())
      .map(([id, total]) => ({ name: competitors.find(c => c.id === id)?.company_name ?? 'Không rõ', total, isLg: false }))
      .filter(r => r.total > 0);

    return [{ name: 'LetsGo', total: lgTotal, isLg: true }, ...competitorRows].sort((a, b) => b.total - a.total);
  }, [selectedKCN, clients, compClients, competitors]);

  const totalWorkers = rows.reduce((s, r) => s + r.total, 0);
  const lgRow = rows.find(r => r.isLg);
  const lgRank = rows.findIndex(r => r.isLg) + 1;
  const lgPct = totalWorkers > 0 && lgRow ? (lgRow.total / totalWorkers) * 100 : 0;
  const maxTotal = Math.max(...rows.map(r => r.total), 1);

  const potentialClients = useMemo(() => {
    if (!selectedKCN) return [];
    const lgNames = clients.map(c => c.name.trim().toLowerCase());
    return compClients.filter(c => {
      if (c.kcn !== selectedKCN) return false;
      const cn = c.client_name.trim().toLowerCase();
      return !lgNames.some(n => n === cn || n.includes(cn) || cn.includes(n));
    });
  }, [selectedKCN, clients, compClients]);

  if (loading) return <div className="text-center py-12 text-[#aaa] text-[13px]">Đang tải...</div>;

  return (
    <div className="space-y-3">
      <div className="bg-white border border-[#E8E7E2] rounded-[10px] p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Map size={14} className="text-[#1D4ED8]" />
          <span className="text-[12.5px] font-semibold text-[#111]">Bản đồ thị phần theo KCN</span>
        </div>
        <select value={selectedKCN} onChange={e => setSelectedKCN(e.target.value)}
          className="text-[12.5px] px-2.5 py-1.5 border border-[#E8E7E2] rounded-lg outline-none focus:border-[#1D4ED8] max-w-xs">
          {kcnList.length === 0 && <option value="">Chưa có KCN</option>}
          {kcnList.map(k => <option key={k} value={k}>{k}</option>)}
        </select>

        {rows.length > 0 ? (
          <div className="space-y-2 pt-2">
            {rows.map((r, i) => {
              const color = r.isLg ? LG_COLOR : COLORS[i % COLORS.length];
              const pct = maxTotal > 0 ? (r.total / maxTotal) * 100 : 0;
              return (
                <div key={r.name + i} className="flex items-center gap-2">
                  <div className="w-32 text-[12px] text-[#555] truncate flex items-center gap-1.5">
                    {r.isLg && <span className="text-[10px]">⭐</span>}{r.name}
                  </div>
                  <div className="flex-1 bg-[#F9F9F7] rounded-full h-5 overflow-hidden">
                    <div className="h-full rounded-full flex items-center px-2 text-[10.5px] text-white font-medium" style={{ width: `${Math.max(pct, 8)}%`, backgroundColor: color }}>
                      {r.total.toLocaleString('vi-VN')}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-6 text-[#aaa] text-[12.5px]">Chưa có dữ liệu lao động cho KCN này</div>
        )}

        {rows.length > 0 && (
          <div className="grid grid-cols-3 gap-2.5 pt-2">
            <div className="bg-[#F9F9F7] rounded-lg p-3">
              <div className="text-[11px] text-[#888]">Tổng LĐ trong KCN</div>
              <div className="text-[16px] font-semibold text-[#111]">{totalWorkers.toLocaleString('vi-VN')}</div>
            </div>
            <div className="bg-[#F9F9F7] rounded-lg p-3">
              <div className="text-[11px] text-[#888]">LetsGo chiếm</div>
              <div className="text-[16px] font-semibold text-[#1D4ED8]">{lgPct.toFixed(1)}%</div>
            </div>
            <div className="bg-[#F9F9F7] rounded-lg p-3">
              <div className="text-[11px] text-[#888]">Xếp thứ</div>
              <div className="text-[16px] font-semibold text-[#111]">{lgRank > 0 ? `#${lgRank} / ${rows.length}` : '—'}</div>
            </div>
          </div>
        )}
      </div>

      <div className="bg-white border border-[#E8E7E2] rounded-[10px] overflow-hidden">
        <div className="px-4 py-2.5 border-b border-[#E8E7E2] text-[12.5px] font-semibold text-[#111]">KH tiềm năng tại {selectedKCN || '—'}</div>
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead><tr className="border-b border-[#E8E7E2]">
              {['Tên nhà máy', 'Đối thủ đang dùng', 'Số LĐ'].map(h => (
                <th key={h} className="text-left px-3 py-2 text-[11px] text-[#888] font-medium bg-[#F9F9F7] whitespace-nowrap">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {potentialClients.map(c => {
                const comp = competitors.find(cm => cm.id === c.competitor_id);
                return (
                  <tr key={c.id} className="border-b border-[#F0EEE9] last:border-0">
                    <td className="px-3 py-2 font-medium">{c.client_name}</td>
                    <td className="px-3 py-2 text-[#666]">{comp?.company_name ?? '—'}</td>
                    <td className="px-3 py-2">{(c.worker_count ?? 0).toLocaleString('vi-VN')}</td>
                  </tr>
                );
              })}
              {potentialClients.length === 0 && (
                <tr><td colSpan={3} className="text-center py-5 text-[#aaa]">Không có KH tiềm năng</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
