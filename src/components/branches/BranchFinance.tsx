import { useState, useEffect, useMemo, useCallback } from 'react';
import { Plus, Trash2, Copy } from 'lucide-react';
import { Bar, Line } from 'react-chartjs-2';
import { supabase } from '../../lib/supabase';
import { shiftMonth, monthLabel, calcPnl } from '../../lib/format';
import type { Branch, ProjectPnl, ProjectPnlCost } from '../../lib/types';

interface OverheadRow { id: string; branch_id: string; month: string; label: string; value: number; cost_type: string }

interface Props {
  branch: Branch;
  toast: (msg: string) => void;
}

export default function BranchFinance({ branch, toast }: Props) {
  const now = new Date();
  const curMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const months = useMemo(() => {
    const arr: string[] = [];
    for (let i = 5; i >= 0; i--) arr.push(shiftMonth(curMonth, -i));
    return arr;
  }, [curMonth]);

  const [month, setMonth] = useState(curMonth);
  const [overhead, setOverhead] = useState<OverheadRow[]>([]);
  const [pnlData, setPnlData] = useState<{ projects: ProjectPnl[]; costs: Record<string, ProjectPnlCost[]> }>({ projects: [], costs: {} });

  const loadOverhead = useCallback(async () => {
    const { data } = await supabase.from('branch_overhead').select('*').eq('branch_manager', branch.name);
    setOverhead((data ?? []) as OverheadRow[]);
  }, [branch.name]);

  const loadPnl = useCallback(async () => {
    const { data: pj } = await supabase.from('projects_pnl').select('*, clients(name)').eq('branch_manager', branch.name);
    const projects = (pj ?? []) as ProjectPnl[];
    const allIds = projects.map(p => p.id);
    let allCosts: ProjectPnlCost[] = [];
    if (allIds.length) {
      const { data: cs } = await supabase.from('project_pnl_costs').select('*').in('pnl_id', allIds);
      allCosts = (cs ?? []) as ProjectPnlCost[];
    }
    const grouped: Record<string, ProjectPnlCost[]> = {};
    for (const c of allCosts) (grouped[c.pnl_id] ??= []).push(c);
    setPnlData({ projects, costs: grouped });
  }, [branch.name]);

  useEffect(() => { loadOverhead(); loadPnl(); }, [loadOverhead, loadPnl]);

  const monthOverhead = overhead.filter(o => o.month === month);
  const monthProjects = pnlData.projects.filter(p => p.month === month);
  const overheadTotal = monthOverhead.reduce((s, o) => s + (o.value || 0), 0);

  const projectRows = monthProjects.map(p => {
    const costs = pnlData.costs[p.id] || [];
    const r = calcPnl(p, costs);
    return { ...p, ...r };
  });

  const totalRevenue = projectRows.reduce((s, p) => s + p.revenue, 0);
  const totalCost = projectRows.reduce((s, p) => s + p.tc, 0);
  const totalLnCn = projectRows.reduce((s, p) => s + p.cnP, 0);
  const lnRong = totalLnCn - overheadTotal;

  const addOverheadRow = async () => {
    const { data, error } = await supabase.from('branch_overhead')
      .insert({ branch_manager: branch.name, month, label: 'Chi phi moi', value: 0, cost_type: 'Cố định' })
      .select().single();
    if (error) { toast('Loi: ' + error.message); return; }
    setOverhead(prev => [...prev, data as OverheadRow]);
  };

  const updateOverheadRow = async (id: string, fields: Partial<OverheadRow>) => {
    await supabase.from('branch_overhead').update(fields).eq('id', id);
    setOverhead(prev => prev.map(o => o.id === id ? { ...o, ...fields } : o));
  };

  const deleteOverheadRow = async (id: string) => {
    await supabase.from('branch_overhead').delete().eq('id', id);
    setOverhead(prev => prev.filter(o => o.id !== id));
  };

  const copyFromPrevMonth = async () => {
    const prev = shiftMonth(month, -1);
    const prevRows = overhead.filter(o => o.month === prev);
    if (!prevRows.length) { toast('Thang truoc chua co du lieu'); return; }
    for (const r of prevRows) {
      if (monthOverhead.some(o => o.label === r.label)) continue;
      const { data } = await supabase.from('branch_overhead')
        .insert({ branch_manager: branch.name, month, label: r.label, value: r.value, cost_type: r.cost_type })
        .select().single();
      if (data) setOverhead(prev2 => [...prev2, data as OverheadRow]);
    }
    toast('Da sao chep tu thang truoc');
  };

  const fmtVnd = (v: number) => v.toLocaleString('vi-VN');

  const chartMonths = months;
  const chartData = useMemo(() => {
    return chartMonths.map(m => {
      const mp = pnlData.projects.filter(p => p.month === m);
      const rev = mp.reduce((s, p) => s + p.revenue, 0);
      const cost = mp.reduce((s, p) => {
        const cs = pnlData.costs[p.id] || [];
        return s + cs.reduce((ss, c) => ss + (c.value || 0), 0);
      }, 0);
      const lnCn = mp.reduce((s, p) => {
        const cs = pnlData.costs[p.id] || [];
        const r = calcPnl(p, cs);
        return s + r.cnP;
      }, 0);
      const oh = overhead.filter(o => o.month === m).reduce((s, o) => s + (o.value || 0), 0);
      return { month: m, rev, cost, lnCn, oh, lnRong: lnCn - oh };
    });
  }, [chartMonths, pnlData, overhead]);

  return (
    <div className="space-y-4">
      <div className="flex gap-1.5 items-center flex-wrap">
        <span className="text-[11px] text-[#999]">Thang:</span>
        {months.map(m => (
          <button key={m} onClick={() => setMonth(m)}
            className={`px-2.5 py-1 text-[11px] rounded-full border transition ${month === m ? 'bg-[#F5F4EF] border-[#ccc] text-[#111] font-medium' : 'border-gray-300 text-[#666] hover:bg-[#F5F4EF]'}`}>
            {monthLabel(m)}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-4 gap-2.5">
        <div className="bg-[#F5F4EF] rounded-lg p-3 text-center">
          <div className="text-[10px] uppercase text-[#999] mb-1">Doanh thu</div>
          <div className="text-[18px] font-semibold text-[#0F6E56]">{fmtVnd(totalRevenue)} d</div>
        </div>
        <div className="bg-[#F5F4EF] rounded-lg p-3 text-center">
          <div className="text-[10px] uppercase text-[#999] mb-1">LN tu du an (phan CN)</div>
          <div className="text-[18px] font-semibold text-[#185FA5]">{fmtVnd(totalLnCn)} d</div>
        </div>
        <div className="bg-[#F5F4EF] rounded-lg p-3 text-center">
          <div className="text-[10px] uppercase text-[#999] mb-1">CP co dinh CN</div>
          <div className="text-[18px] font-semibold text-red-600">{fmtVnd(overheadTotal)} d</div>
        </div>
        <div className="bg-white border-2 border-[#E8E7E2] rounded-lg p-3 text-center">
          <div className="text-[10px] uppercase text-[#999] mb-1">LN rong CN</div>
          <div className={`text-[18px] font-semibold ${lnRong >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{fmtVnd(lnRong)} d</div>
        </div>
      </div>

      {projectRows.length > 0 && (
        <div className="bg-white border border-[#E8E7E2] rounded-xl overflow-hidden">
          <div className="px-3.5 py-2.5 border-b border-[#E8E7E2] text-[12px] font-medium text-[#111]">Du an {monthLabel(month)}</div>
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-[10px] text-[#999] uppercase bg-[#F5F4EF]">
                <th className="text-left font-medium px-3.5 py-2">Du an</th>
                <th className="text-right font-medium px-3 py-2">Doanh thu</th>
                <th className="text-right font-medium px-3 py-2">Chi phi</th>
                <th className="text-right font-medium px-3 py-2">LN du an</th>
                <th className="text-right font-medium px-3 py-2">Phan CN</th>
              </tr>
            </thead>
            <tbody>
              {projectRows.map(p => (
                <tr key={p.id} className="border-t border-[#F0EEE9]">
                  <td className="px-3.5 py-2 font-medium">{p.clients?.name || '—'}</td>
                  <td className="px-3 py-2 text-right">{fmtVnd(p.revenue)}</td>
                  <td className="px-3 py-2 text-right text-red-600">{fmtVnd(p.tc)}</td>
                  <td className="px-3 py-2 text-right font-medium">{fmtVnd(p.profit)}</td>
                  <td className="px-3 py-2 text-right font-semibold text-[#185FA5]">{fmtVnd(p.cnP)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-[#F5F4EF] border-t border-[#E8E7E2]">
                <td className="px-3.5 py-2 font-semibold">Tong</td>
                <td className="px-3 py-2 text-right font-semibold">{fmtVnd(totalRevenue)}</td>
                <td className="px-3 py-2 text-right font-semibold text-red-600">{fmtVnd(totalCost)}</td>
                <td className="px-3 py-2 text-right font-semibold">{fmtVnd(totalRevenue - totalCost)}</td>
                <td className="px-3 py-2 text-right font-semibold text-[#185FA5]">{fmtVnd(totalLnCn)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <div className="bg-white border border-[#E8E7E2] rounded-xl overflow-hidden">
        <div className="px-3.5 py-2.5 border-b border-[#E8E7E2] flex items-center justify-between">
          <div className="text-[12px] font-medium text-[#111]">Chi phi co dinh chi nhanh — {monthLabel(month)}</div>
          <div className="flex gap-2">
            <button onClick={copyFromPrevMonth} className="flex items-center gap-1 text-[11px] text-[#666] hover:text-[#111] border border-gray-300 px-2 py-1 rounded-lg transition">
              <Copy size={11} /> Sao chep thang truoc
            </button>
            <button onClick={addOverheadRow} className="flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-800 font-medium">
              <Plus size={12} /> Them
            </button>
          </div>
        </div>
        {monthOverhead.length === 0 ? (
          <div className="px-3.5 py-6 text-center text-[12px] text-[#999]">Chua co chi phi. Bam "Them" hoac "Sao chep thang truoc".</div>
        ) : (
          <div className="p-3.5 space-y-1.5">
            {monthOverhead.map(o => (
              <div key={o.id} className="flex items-center gap-2">
                <input key={`ol-${o.id}`} defaultValue={o.label} onBlur={e => updateOverheadRow(o.id, { label: e.target.value })}
                  className="flex-1 text-[12px] px-2 py-1.5 border-b border-dashed border-gray-300 outline-none focus:border-blue-500 bg-transparent" />
                <div className="relative w-[150px]">
                  <input key={`ov-${o.id}`} type="text" defaultValue={o.value ? fmtVnd(o.value) : '0'}
                    onFocus={e => { e.target.value = String(o.value || 0); }}
                    onBlur={e => { const v = +e.target.value.replace(/\D/g, '') || 0; updateOverheadRow(o.id, { value: v }); e.target.value = fmtVnd(v); }}
                    className="w-full text-[12px] px-2 py-1.5 pr-6 border border-gray-300 rounded-lg outline-none focus:border-blue-500 text-right" />
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-[#999]">d</span>
                </div>
                <button onClick={() => deleteOverheadRow(o.id)} className="text-[#bbb] hover:text-red-600"><Trash2 size={13} /></button>
              </div>
            ))}
            <div className="flex justify-between pt-2 border-t border-gray-100 text-[12px] font-medium">
              <span>Tong CP co dinh</span>
              <span className="text-red-600">{fmtVnd(overheadTotal)} d</span>
            </div>
          </div>
        )}
      </div>

      <div className="bg-white border border-[#E8E7E2] rounded-xl overflow-hidden p-3.5">
        <div className="text-[12px] font-medium text-[#111] mb-1">Ket qua kinh doanh {monthLabel(month)}</div>
        <div className="text-[11px] text-[#666] bg-[#F5F4EF] rounded-lg px-3 py-2">
          LN du an (phan CN): <strong className="text-[#185FA5]">{fmtVnd(totalLnCn)}</strong>
          {' - '}CP co dinh: <strong className="text-red-600">{fmtVnd(overheadTotal)}</strong>
          {' = '}LN rong: <strong className={lnRong >= 0 ? 'text-emerald-600' : 'text-red-600'}>{fmtVnd(lnRong)}</strong> d
        </div>
      </div>

      {chartData.some(d => d.rev > 0) && (
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-white border border-[#E8E7E2] rounded-xl p-3.5">
            <div className="text-[11px] font-medium text-[#111] mb-2">DT / CP / LN (6 thang)</div>
            <Bar
              data={{
                labels: chartData.map(d => 'T' + Number(d.month.split('-')[1])),
                datasets: [
                  { label: 'Doanh thu', data: chartData.map(d => d.rev), backgroundColor: '#6EE7B7' },
                  { label: 'Chi phi', data: chartData.map(d => d.cost + d.oh), backgroundColor: '#FCA5A5' },
                  { label: 'LN rong', data: chartData.map(d => d.lnRong), backgroundColor: '#93C5FD' },
                ],
              }}
              options={{ responsive: true, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } } }, scales: { y: { beginAtZero: true } } }}
              height={180}
            />
          </div>
          <div className="bg-white border border-[#E8E7E2] rounded-xl p-3.5">
            <div className="text-[11px] font-medium text-[#111] mb-2">LN rong trend</div>
            <Line
              data={{
                labels: chartData.map(d => 'T' + Number(d.month.split('-')[1])),
                datasets: [{
                  label: 'LN rong CN',
                  data: chartData.map(d => d.lnRong),
                  borderColor: '#10B981',
                  backgroundColor: 'rgba(16,185,129,0.1)',
                  fill: true,
                  tension: 0.3,
                }],
              }}
              options={{ responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: false } } }}
              height={180}
            />
          </div>
        </div>
      )}
    </div>
  );
}
