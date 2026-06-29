import { useState, useEffect, useMemo, useCallback } from 'react';
import { Plus, Trash2, Copy } from 'lucide-react';
import { Bar, Line } from 'react-chartjs-2';
import { supabase } from '../../lib/supabase';
import { shiftMonth, monthLabel, calcPnl } from '../../lib/format';
import type { Branch, ProjectPnl, ProjectPnlCost, BranchStaff } from '../../lib/types';

interface OverheadRow { id: string; branch_id: string; month: string; label: string; value: number; cost_type: string }

const DEFAULT_OVERHEAD_LABELS = [
  'CP Thuê mặt bằng', 'CP Điện sinh hoạt', 'CP Internet', 'CP Văn phòng phẩm', 'CP Phát sinh khác',
  'CP Xăng xe', 'CP Tiếp khách', 'CP Điện thoại',
];

interface Props {
  branch: Branch;
  projectsPnl: ProjectPnl[];
  pnlCostsMap: Record<string, ProjectPnlCost[]>;
  branchStaffs?: BranchStaff[];
  toast: (msg: string) => void;
}

export default function BranchFinance({ branch, projectsPnl, pnlCostsMap, branchStaffs = [], toast }: Props) {
  const now = new Date();
  const curMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const months = useMemo(() => {
    const arr: string[] = [];
    for (let i = 5; i >= 0; i--) arr.push(shiftMonth(curMonth, -i));
    return arr;
  }, [curMonth]);

  const [month, setMonth] = useState(curMonth);
  const [overhead, setOverhead] = useState<OverheadRow[]>([]);

  const loadOverhead = useCallback(async () => {
    const ohMatchValues = [branch.name, branch.region, branch.short_name].filter(Boolean) as string[];
    const { data } = await supabase.from('branch_overhead').select('*').in('branch_manager', ohMatchValues);
    setOverhead((data ?? []) as OverheadRow[]);
  }, [branch.name, branch.region, branch.short_name]);

  useEffect(() => { loadOverhead(); }, [loadOverhead]);

  const branchProjects = useMemo(() => {
    const matchValues = new Set([branch.name, branch.region, branch.short_name].filter(Boolean));
    return projectsPnl.filter(p => matchValues.has(p.branch_manager || ''));
  }, [projectsPnl, branch.name, branch.region, branch.short_name]);

  const monthOverhead = overhead.filter(o => o.month === month);
  const monthProjects = branchProjects.filter(p => p.month === month);
  const overheadTotal = monthOverhead.reduce((s, o) => s + (o.value || 0), 0);
  const staffSalaryTotal = branchStaffs.reduce((s, st) => s + (st.salary || 0), 0);
  const totalCpCn = overheadTotal + staffSalaryTotal;

  const projectRows = monthProjects.map(p => {
    const costs = pnlCostsMap[p.id] || [];
    const r = calcPnl(p, costs);
    return { ...p, ...r };
  });

  const totalRevenue = projectRows.reduce((s, p) => s + p.revenue, 0);
  const totalCost = projectRows.reduce((s, p) => s + p.tc, 0);
  const totalLnCn = projectRows.reduce((s, p) => s + p.cnP, 0);
  const lnRong = totalLnCn - totalCpCn;

  const addOverheadRow = async () => {
    const { data, error } = await supabase.from('branch_overhead')
      .insert({ branch_manager: branch.region || branch.name, month, label: 'Chi phi moi', value: 0, cost_type: 'Cố định' })
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
        .insert({ branch_manager: branch.region || branch.name, month, label: r.label, value: r.value, cost_type: r.cost_type })
        .select().single();
      if (data) setOverhead(prev2 => [...prev2, data as OverheadRow]);
    }
    toast('Da sao chep tu thang truoc');
  };

  const fmtVnd = (v: number) => v.toLocaleString('vi-VN');

  const chartMonths = months;
  const chartData = useMemo(() => {
    const matchValues = new Set([branch.name, branch.region, branch.short_name].filter(Boolean));
    return chartMonths.map(m => {
      const mp = projectsPnl.filter(p => p.month === m && matchValues.has(p.branch_manager || ''));
      const rev = mp.reduce((s, p) => s + p.revenue, 0);
      const cost = mp.reduce((s, p) => {
        const cs = pnlCostsMap[p.id] || [];
        return s + cs.reduce((ss, c) => ss + (c.value || 0), 0);
      }, 0);
      const lnCn = mp.reduce((s, p) => {
        const cs = pnlCostsMap[p.id] || [];
        const r = calcPnl(p, cs);
        return s + r.cnP;
      }, 0);
      const oh = overhead.filter(o => o.month === m).reduce((s, o) => s + (o.value || 0), 0) + staffSalaryTotal;
      return { month: m, rev, cost, lnCn, oh, lnRong: lnCn - oh };
    });
  }, [chartMonths, projectsPnl, pnlCostsMap, overhead, staffSalaryTotal, branch.name, branch.region, branch.short_name]);

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
          <div className="text-[18px] font-semibold text-red-600">{fmtVnd(totalCpCn)} d</div>
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
            <select onChange={async e => {
              if (!e.target.value) return;
              const label = e.target.value;
              e.target.value = '';
              if (monthOverhead.some(o => o.label === label)) { toast('Da co muc nay'); return; }
              const { data, error } = await supabase.from('branch_overhead')
                .insert({ branch_manager: branch.region || branch.name, month, label, value: 0, cost_type: 'Cố định' })
                .select().single();
              if (error) { toast('Loi: ' + error.message); return; }
              setOverhead(prev => [...prev, data as OverheadRow]);
            }} className="text-[11px] px-1.5 py-1 rounded border border-gray-300 outline-none bg-white text-blue-600">
              <option value="">+ Them</option>
              {DEFAULT_OVERHEAD_LABELS.filter(l => !monthOverhead.some(o => o.label === l)).map(l => <option key={l} value={l}>{l}</option>)}
              <option value="__custom__" disabled>——————</option>
            </select>
            <button onClick={addOverheadRow} className="text-[11px] text-[#999] hover:text-blue-600" title="Them muc tu do">
              <Plus size={12} />
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
            {staffSalaryTotal > 0 && (
              <div className="mt-2 pt-2 border-t border-gray-100 space-y-1">
                <div className="text-[10.5px] text-[#999] uppercase font-medium">Luong nhan su VP</div>
                {branchStaffs.filter(st => st.salary > 0).map(st => (
                  <div key={st.id} className="flex justify-between text-[12px]">
                    <span className="text-[#555]">{st.name} — {st.role || 'NV'}</span>
                    <span className="text-[#111]">{fmtVnd(st.salary)} d</span>
                  </div>
                ))}
                <div className="flex justify-between text-[12px] font-medium pt-1 border-t border-gray-50">
                  <span>Tong luong NS</span>
                  <span className="text-red-600">{fmtVnd(staffSalaryTotal)} d</span>
                </div>
              </div>
            )}
            <div className="flex justify-between pt-2 border-t border-gray-200 text-[12px] font-semibold mt-2">
              <span>Tong CP van hanh</span>
              <span className="text-red-600">{fmtVnd(totalCpCn)} d</span>
            </div>
          </div>
        )}
      </div>

      <div className="bg-white border border-[#E8E7E2] rounded-xl overflow-hidden p-3.5">
        <div className="text-[12px] font-medium text-[#111] mb-1">Ket qua kinh doanh {monthLabel(month)}</div>
        <div className="text-[11px] text-[#666] bg-[#F5F4EF] rounded-lg px-3 py-2">
          LN du an (phan CN): <strong className="text-[#185FA5]">{fmtVnd(totalLnCn)}</strong>
          {' - '}CP van hanh: <strong className="text-red-600">{fmtVnd(totalCpCn)}</strong>
          {staffSalaryTotal > 0 && <span className="text-[10px] text-[#999]"> (CP {fmtVnd(overheadTotal)} + Luong {fmtVnd(staffSalaryTotal)})</span>}
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
                  { label: 'Chi phi', data: chartData.map(d => d.cost), backgroundColor: '#FCA5A5' },
                  { label: 'LN du an', data: chartData.map(d => d.lnCn), backgroundColor: '#93C5FD' },
                ],
              }}
              options={{ responsive: true, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } } }, scales: { y: { ticks: { font: { size: 9 }, callback: v => (Number(v) / 1e6).toFixed(0) + 'tr' } }, x: { ticks: { font: { size: 10 } } } } }}
            />
          </div>
          <div className="bg-white border border-[#E8E7E2] rounded-xl p-3.5">
            <div className="text-[11px] font-medium text-[#111] mb-2">LN rong CN (6 thang)</div>
            <Line
              data={{
                labels: chartData.map(d => 'T' + Number(d.month.split('-')[1])),
                datasets: [
                  { label: 'LN du an', data: chartData.map(d => d.lnCn), borderColor: '#3B82F6', backgroundColor: '#93C5FD', tension: 0.3, fill: false },
                  { label: 'CP co dinh', data: chartData.map(d => d.oh), borderColor: '#EF4444', backgroundColor: '#FCA5A5', tension: 0.3, fill: false },
                  { label: 'LN rong', data: chartData.map(d => d.lnRong), borderColor: '#10B981', backgroundColor: '#6EE7B7', tension: 0.3, fill: true },
                ],
              }}
              options={{ responsive: true, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } } }, scales: { y: { ticks: { font: { size: 9 }, callback: v => (Number(v) / 1e6).toFixed(0) + 'tr' } }, x: { ticks: { font: { size: 10 } } } } }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
