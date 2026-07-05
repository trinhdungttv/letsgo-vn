import { Fragment, useEffect, useMemo, useState } from 'react';
import type { Manager, ProjectPnl, ProjectPnlCost, BranchOverhead, Client } from '../../lib/types';
import { fmtTrieu, monthLabel, shiftMonth, calcPnl } from '../../lib/format';

interface PerformanceTabProps {
  managers: Manager[];
  months: string[];
  selMonth: string;
  onSelMonthChange: (m: string) => void;
  projectsPnl: ProjectPnl[];
  pnlCosts: Record<string, ProjectPnlCost[]>;
  overhead: BranchOverhead[];
  clients: Client[];
  onLoadCosts: (pnlId: string) => Promise<ProjectPnlCost[]>;
}

const RANK_CLS = ['bg-[#FAEEDA] text-[#633806]', 'bg-[#F1EFE8] text-[#444441]', 'bg-[#EAF3DE] text-[#27500A]'];

function delta(v: number): string {
  if (v > 0) return '↑ +' + fmtTrieu(v);
  if (v < 0) return '↓ ' + fmtTrieu(v);
  return '→ 0';
}

export default function PerformanceTab({
  managers, months, selMonth, onSelMonthChange,
  projectsPnl, pnlCosts, overhead, clients, onLoadCosts,
}: PerformanceTabProps) {
  const cmpMonth = shiftMonth(selMonth, -1);
  const [selBranch, setSelBranch] = useState<string>('');
  const [detailMonth, setDetailMonth] = useState(selMonth);

  useEffect(() => { setDetailMonth(selMonth); }, [selMonth]);
  useEffect(() => {
    if (!selBranch && managers.length) setSelBranch(managers[0].name);
  }, [managers, selBranch]);

  useEffect(() => {
    projectsPnl.forEach(p => {
      if (!pnlCosts[p.id]) onLoadCosts(p.id).catch(() => {});
    });
  }, [projectsPnl, pnlCosts, onLoadCosts]);

  const projCnFor = (branchManager: string, m: string) =>
    projectsPnl
      .filter(p => p.branch_manager === branchManager && p.month === m)
      .reduce((s, p) => s + calcPnl(p, pnlCosts[p.id] || []).cnP, 0);

  const overheadFor = (branchManager: string, m: string) =>
    overhead.filter(o => o.branch_manager === branchManager && o.month === m).reduce((s, o) => s + (Number(o.value) || 0), 0);

  const revenueFor = (branchManager: string, m: string) =>
    projectsPnl.filter(p => p.branch_manager === branchManager && p.month === m).reduce((s, p) => s + (Number(p.revenue) || 0), 0);

  const projectCountFor = (branchManager: string, m: string) =>
    projectsPnl.filter(p => p.branch_manager === branchManager && p.month === m).length;

  const workersFor = (branchManager: string, m: string) =>
    clients
      .filter(c => projectsPnl.some(p => p.client_id === c.id && p.branch_manager === branchManager && p.month === m))
      .reduce((s, c) => s + (c.current_workers || 0), 0);

  const netOf = (branchManager: string, m: string) => projCnFor(branchManager, m) - overheadFor(branchManager, m);

  const sparkMonths = months.slice(-6);

  const sortedBranches = useMemo(
    () => [...managers].sort((a, b) => netOf(b.name, selMonth) - netOf(a.name, selMonth)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [managers, selMonth, projectsPnl, pnlCosts, overhead]
  );

  const branch = managers.find(b => b.name === selBranch) || null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2.5 flex-wrap">
        <span className="text-[11.5px] text-[#888]">Kỳ:</span>
        <select value={selMonth} onChange={e => onSelMonthChange(e.target.value)} className="text-[12px] px-2.5 py-1.5 border border-gray-300 rounded-lg outline-none">
          {months.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
        </select>
        <span className="ml-auto text-[11.5px] text-[#888]">So sánh: <strong className="text-[#185FA5]">{monthLabel(cmpMonth)}</strong></span>
      </div>

      {/* Branch cards */}
      <div className="grid grid-cols-3 gap-2.5">
        {sortedBranches.map((br, i) => {
          const nc = netOf(br.name, selMonth);
          const np = netOf(br.name, cmpMonth);
          const diff = nc - np;
          const maxN = Math.max(...sortedBranches.map(b => Math.abs(netOf(b.name, selMonth))), 1);
          const sparkV = sparkMonths.map(m => netOf(br.name, m));
          const maxS = Math.max(...sparkV.map(v => Math.abs(v)), 1);
          return (
            <div
              key={br.id}
              onClick={() => setSelBranch(br.name)}
              className={`bg-white border rounded-xl overflow-hidden cursor-pointer transition ${br.name === selBranch ? 'border-[#0F6E56] border-[1.5px]' : 'border-[#E8E7E2] hover:border-gray-300'}`}
            >
              <div className="px-3 py-2.5 border-b border-[#E8E7E2] flex items-center justify-between">
                <div>
                  <div className="text-[12px] font-medium text-[#111]">{br.name}</div>
                  <div className="text-[10px] text-[#999]">{projectCountFor(br.name, selMonth)} DA · {workersFor(br.name, selMonth)} LĐ</div>
                </div>
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${RANK_CLS[i] || RANK_CLS[2]}`}>#{i + 1}</span>
              </div>
              <div className="px-3 py-2.5">
                <div className="text-[10px] uppercase text-[#999] mb-0.5">LN ròng CN</div>
                <div className={`text-[20px] font-medium ${nc >= 0 ? 'text-[#0F6E56]' : 'text-red-600'}`}>{fmtTrieu(nc)}</div>
                <div className={`text-[11px] my-0.5 ${diff > 0 ? 'text-emerald-600' : diff < 0 ? 'text-red-600' : 'text-[#999]'}`}>
                  {delta(diff)} vs {monthLabel(cmpMonth)}
                </div>
                <div className="flex justify-between text-[10px] text-[#999] mb-1.5">
                  <span>DA phần: <strong>{fmtTrieu(projCnFor(br.name, selMonth))}</strong></span>
                  <span>CP cố định: <strong className="text-red-600">{fmtTrieu(overheadFor(br.name, selMonth))}</strong></span>
                </div>
                <div className="h-1 rounded-full bg-[#EBEBEA] overflow-hidden mb-1.5">
                  <div className="h-full rounded-full bg-[#0F6E56]" style={{ width: `${Math.max(0, Math.min(100, nc / maxN * 100))}%` }} />
                </div>
                <div className="flex items-end gap-0.5 h-5">
                  {sparkV.map((v, si) => (
                    <div
                      key={si}
                      className="flex-1 rounded-t"
                      style={{ height: `${Math.max(2, Math.abs(v) / maxS * 18)}px`, background: sparkMonths[si] === selMonth ? '#0F6E56' : '#EBEBEA' }}
                    />
                  ))}
                </div>
                <div className="text-[10px] text-[#999] mt-0.5">{monthLabel(sparkMonths[0] || selMonth)} → {monthLabel(sparkMonths[sparkMonths.length - 1] || selMonth)}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Detail panel */}
      {branch && (
        <div className="bg-white border border-[#E8E7E2] rounded-xl overflow-hidden">
          <div className="px-3.5 py-2.5 border-b border-[#E8E7E2] flex items-center justify-between gap-2">
            <div className="text-[12px] font-medium text-[#111]">{branch.name} — Chi tiết</div>
            <select value={detailMonth} onChange={e => setDetailMonth(e.target.value)} className="text-[11px] px-2 py-1 border border-gray-300 rounded-lg outline-none">
              {months.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
            </select>
          </div>
          <div className="p-3.5">
            {(() => {
              const d = detailMonth;
              const nc = netOf(branch.name, d);
              const workers = workersFor(branch.name, d);
              const rows: { label: string; getVal: (m: string) => number; color: string; bold?: boolean }[] = [
                { label: 'Doanh thu', getVal: m => revenueFor(branch.name, m), color: '#3B6D11' },
                { label: 'LN từ dự án (CN phần)', getVal: m => projCnFor(branch.name, m), color: '#185FA5' },
                { label: 'CP cố định chi nhánh', getVal: m => overheadFor(branch.name, m), color: '#A32D2D' },
                { label: 'LN ròng chi nhánh', getVal: m => netOf(branch.name, m), color: nc >= 0 ? '#0F6E56' : '#A32D2D', bold: true },
              ];
              return (
                <>
                  <div className="flex gap-2 flex-wrap mb-3">
                    <div className="flex-1 min-w-[90px] bg-[#F5F4EF] rounded-lg p-2 text-center">
                      <div className="text-[10px] uppercase text-[#999] mb-1">Doanh thu</div>
                      <div className="text-[17px] font-medium text-emerald-600">{fmtTrieu(revenueFor(branch.name, d))}</div>
                    </div>
                    <div className="flex-1 min-w-[90px] bg-[#F5F4EF] rounded-lg p-2 text-center">
                      <div className="text-[10px] uppercase text-[#999] mb-1">Số dự án</div>
                      <div className="text-[17px] font-medium text-[#111]">{projectCountFor(branch.name, d)}</div>
                    </div>
                    <div className="flex-1 min-w-[90px] bg-[#F5F4EF] rounded-lg p-2 text-center">
                      <div className="text-[10px] uppercase text-[#999] mb-1">Lao động</div>
                      <div className="text-[17px] font-medium text-[#111]">{workers}</div>
                    </div>
                    <div className="flex-1 min-w-[90px] bg-[#F5F4EF] rounded-lg p-2 text-center">
                      <div className="text-[10px] uppercase text-[#999] mb-1">LN/LĐ</div>
                      <div className={`text-[17px] font-medium ${nc >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{workers ? fmtTrieu(nc / workers * 1000) + 'k' : '—'}</div>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                  <table className="w-full text-[12px]">
                    <thead>
                      <tr className="text-[10px] text-[#999] uppercase">
                        <th className="text-left font-medium pb-1.5">Chỉ số</th>
                        <th className="text-right font-medium pb-1.5">{monthLabel(d)}</th>
                        <th className="text-right font-medium pb-1.5">{monthLabel(cmpMonth)}</th>
                        <th className="text-right font-medium pb-1.5">Chênh lệch</th>
                        <th className="text-center font-medium pb-1.5 w-[90px]">{sparkMonths[0] ? `${monthLabel(sparkMonths[0])}→${monthLabel(sparkMonths[sparkMonths.length - 1])}` : ''}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(row => {
                        const cur = row.getVal(d);
                        const prv = row.getVal(cmpMonth);
                        const diff = cur - prv;
                        const pctStr = prv !== 0 ? (diff / Math.abs(prv) * 100).toFixed(1) + '%' : '—';
                        const tv = sparkMonths.map(m => row.getVal(m));
                        const mx = Math.max(...tv.map(v => Math.abs(v)), 1);
                        return (
                          <tr key={row.label} className={`border-t border-[#F0EEE9] ${row.bold ? 'bg-[#F5F4EF] font-medium' : ''}`}>
                            <td className="py-1.5 text-[#666]">{row.label}</td>
                            <td className="py-1.5 text-right font-medium" style={{ color: row.color }}>{fmtTrieu(cur)}</td>
                            <td className="py-1.5 text-right text-[#999]">{fmtTrieu(prv)}</td>
                            <td className={`py-1.5 text-right ${diff > 0 ? 'text-emerald-600' : diff < 0 ? 'text-red-600' : 'text-[#999]'}`}>
                              {diff > 0 ? '↑ +' : ''}{fmtTrieu(diff)} {pctStr !== '—' ? `(${pctStr})` : ''}
                            </td>
                            <td className="py-1.5">
                              <div className="flex items-end justify-center gap-px h-4">
                                {tv.map((v, si) => (
                                  <div
                                    key={si}
                                    className="w-2 rounded-t"
                                    style={{ height: `${Math.max(2, Math.abs(v) / mx * 14)}px`, background: sparkMonths[si] === d ? row.color : '#EBEBEA' }}
                                  />
                                ))}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* Comparison table */}
      <div className="bg-white border border-[#E8E7E2] rounded-xl overflow-hidden">
        <div className="px-3.5 py-2.5 border-b border-[#E8E7E2] text-[12px] font-medium text-[#111]">
          Bảng so sánh tất cả chi nhánh
        </div>
        <div className="p-3.5">
          <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-[10px] text-[#999] uppercase">
                <th className="text-left font-medium pb-1.5">Chi nhánh</th>
                <th className="text-right font-medium pb-1.5">{monthLabel(cmpMonth)} LN ròng</th>
                <th className="text-right font-medium pb-1.5">DT</th>
                <th className="text-right font-medium pb-1.5">{monthLabel(selMonth)} LN ròng</th>
                <th className="text-right font-medium pb-1.5">DT</th>
                <th className="text-right font-medium pb-1.5">Tăng trưởng LN</th>
              </tr>
            </thead>
            <tbody>
              {managers.map(br => {
                const n0 = netOf(br.name, cmpMonth);
                const n1 = netOf(br.name, selMonth);
                const r0 = revenueFor(br.name, cmpMonth);
                const r1 = revenueFor(br.name, selMonth);
                const diff = n1 - n0;
                return (
                  <tr key={br.id} className="border-t border-[#F0EEE9]">
                    <td className="py-1.5 font-medium text-[#111]">{br.name}</td>
                    <td className={`py-1.5 text-right ${n0 >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{fmtTrieu(n0)}</td>
                    <td className="py-1.5 text-right text-[#999]">{fmtTrieu(r0)}</td>
                    <td className={`py-1.5 text-right ${n1 >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{fmtTrieu(n1)}</td>
                    <td className="py-1.5 text-right text-[#999]">{fmtTrieu(r1)}</td>
                    <td className={`py-1.5 text-right ${diff > 0 ? 'text-emerald-600' : diff < 0 ? 'text-red-600' : 'text-[#999]'}`}>
                      {diff > 0 ? '↑ +' : ''}{fmtTrieu(diff)} tr.đ
                    </td>
                  </tr>
                );
              })}
              <tr className="border-t border-[#F0EEE9] bg-[#F5F4EF] font-medium">
                <td className="py-1.5">Tổng</td>
                {[cmpMonth, selMonth].map(m => (
                  <Fragment key={m}>
                    <td className={`py-1.5 text-right ${managers.reduce((s, b) => s + netOf(b.name, m), 0) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                      {fmtTrieu(managers.reduce((s, b) => s + netOf(b.name, m), 0))}
                    </td>
                    <td className="py-1.5 text-right">{fmtTrieu(managers.reduce((s, b) => s + revenueFor(b.name, m), 0))}</td>
                  </Fragment>
                ))}
                <td className={`py-1.5 text-right ${managers.reduce((s, b) => s + netOf(b.name, selMonth) - netOf(b.name, cmpMonth), 0) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                  {(() => {
                    const d = managers.reduce((s, b) => s + netOf(b.name, selMonth) - netOf(b.name, cmpMonth), 0);
                    return (d >= 0 ? '↑ +' : '') + fmtTrieu(d) + ' tr.đ';
                  })()}
                </td>
              </tr>
            </tbody>
          </table>
          </div>
        </div>
      </div>
    </div>
  );
}
