import { useEffect, useMemo } from 'react';
import { Plus, Trash2, Copy } from 'lucide-react';
import type { Manager, BranchOverhead, ProjectPnl, ProjectPnlCost, OverheadCostType } from '../../lib/types';
import { fmtTrieu, monthLabel, shiftMonth, calcPnl } from '../../lib/format';

interface OverheadTabProps {
  managers: Manager[];
  months: string[];
  branchManager: string;
  month: string;
  onBranchManagerChange: (v: string) => void;
  onMonthChange: (v: string) => void;
  overhead: BranchOverhead[];
  projectsPnl: ProjectPnl[];
  pnlCosts: Record<string, ProjectPnlCost[]>;
  onAdd: (fields: Omit<BranchOverhead, 'id'>) => Promise<BranchOverhead>;
  onUpdate: (id: string, fields: Partial<Omit<BranchOverhead, 'id'>>) => Promise<BranchOverhead>;
  onDelete: (id: string) => Promise<void>;
  onCopyFromMonth: (branchManager: string, fromMonth: string, toMonth: string) => Promise<BranchOverhead[]>;
  onLoadCosts: (pnlId: string) => Promise<ProjectPnlCost[]>;
  toast: (msg: string) => void;
}

export default function OverheadTab({
  managers, months, branchManager, month,
  onBranchManagerChange, onMonthChange,
  overhead, projectsPnl, pnlCosts,
  onAdd, onUpdate, onDelete, onCopyFromMonth, onLoadCosts,
  toast,
}: OverheadTabProps) {
  const branchProjects = useMemo(
    () => projectsPnl.filter(p => p.branch_manager === branchManager && p.month === month),
    [projectsPnl, branchManager, month]
  );

  useEffect(() => {
    branchProjects.forEach(p => {
      if (!pnlCosts[p.id]) onLoadCosts(p.id).catch(() => {});
    });
  }, [branchProjects, pnlCosts, onLoadCosts]);

  const projCn = useMemo(
    () => branchProjects.reduce((sum, p) => sum + calcPnl(p, pnlCosts[p.id] || []).cnP, 0),
    [branchProjects, pnlCosts]
  );

  const rows = useMemo(
    () => overhead.filter(o => o.branch_manager === branchManager && o.month === month).sort((a, b) => a.sort_order - b.sort_order),
    [overhead, branchManager, month]
  );

  const total = rows.reduce((s, row) => s + (Number(row.value) || 0), 0);
  const net = projCn - total;

  const addRow = async () => {
    try {
      await onAdd({ branch_manager: branchManager, month, label: 'Chi phí mới', value: 0, cost_type: 'Cố định', sort_order: rows.length });
    } catch (e) { toast('Lỗi: ' + (e instanceof Error ? e.message : String(e))); }
  };

  const updateRow = async (row: BranchOverhead, fields: Partial<Omit<BranchOverhead, 'id'>>) => {
    try { await onUpdate(row.id, fields); } catch (e) { toast('Lỗi: ' + (e instanceof Error ? e.message : String(e))); }
  };

  const removeRow = async (row: BranchOverhead) => {
    try { await onDelete(row.id); } catch (e) { toast('Lỗi: ' + (e instanceof Error ? e.message : String(e))); }
  };

  const copyFromLast = async () => {
    const from = shiftMonth(month, -1);
    try {
      const copied = await onCopyFromMonth(branchManager, from, month);
      if (copied.length === 0) toast(`Không có dữ liệu chi phí cố định ở ${monthLabel(from)}`);
      else toast(`Đã sao chép ${copied.length} khoản từ ${monthLabel(from)}`);
    } catch (e) { toast('Lỗi: ' + (e instanceof Error ? e.message : String(e))); }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2.5 flex-wrap">
        <span className="text-[11.5px] text-[#888]">Chi nhánh:</span>
        <select value={branchManager} onChange={e => onBranchManagerChange(e.target.value)} className="text-[12px] px-2.5 py-1.5 border border-gray-300 rounded-lg outline-none">
          {managers.map(m => <option key={m.id} value={m.name}>{m.name}</option>)}
        </select>
        <span className="text-[11.5px] text-[#888]">Tháng:</span>
        <select value={month} onChange={e => onMonthChange(e.target.value)} className="text-[12px] px-2.5 py-1.5 border border-gray-300 rounded-lg outline-none">
          {months.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
        </select>
        <button onClick={copyFromLast} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[12px] font-medium border border-[#B5D4F4] text-[#185FA5] hover:bg-[#E6F1FB] transition">
          <Copy size={12} /> Sao chép tháng trước
        </button>
      </div>

      <div className="bg-white border border-[#E8E7E2] rounded-xl overflow-hidden">
        <div className="px-3.5 py-2.5 border-b border-[#E8E7E2] flex items-center justify-between flex-wrap gap-1">
          <div className="text-[12px] font-medium text-[#111]">
            Chi phí cố định — {branchManager} · {monthLabel(month)}
          </div>
          <span className="text-[10px] text-[#999]">Trừ 1 lần/tháng · Không phân bổ vào từng DA</span>
        </div>
        <div className="p-3.5">
          <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-[10px] text-[#999] uppercase">
                <th className="text-left font-medium pb-1.5">Khoản chi phí cố định</th>
                <th className="text-right font-medium pb-1.5 w-[120px]">Giá trị</th>
                <th className="text-center font-medium pb-1.5 w-[90px]">Loại</th>
                <th className="w-[28px]"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.id} className="border-t border-[#F0EEE9]">
                  <td className="py-1.5 pr-2">
                    <input
                      type="text" defaultValue={row.label}
                      onBlur={e => updateRow(row, { label: e.target.value })}
                      className="w-full text-[12px] px-1.5 py-1 border-b border-dashed border-gray-300 outline-none focus:border-blue-500 bg-transparent"
                    />
                  </td>
                  <td className="py-1.5">
                    <div className="relative">
                      <input
                        type="number" defaultValue={row.value}
                        onBlur={e => updateRow(row, { value: +e.target.value || 0 })}
                        className="w-full text-[12px] px-2 py-1 pr-8 border border-gray-300 rounded-lg outline-none focus:border-blue-500 text-right"
                      />
                      <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-[#999]">tr.đ</span>
                    </div>
                  </td>
                  <td className="py-1.5 text-center">
                    <select
                      value={row.cost_type}
                      onChange={e => updateRow(row, { cost_type: e.target.value as OverheadCostType })}
                      className="text-[11px] px-1.5 py-1 border border-gray-300 rounded-lg outline-none"
                    >
                      <option value="Cố định">Cố định</option>
                      <option value="Biến đổi">Biến đổi</option>
                    </select>
                  </td>
                  <td className="py-1.5 text-center">
                    <button onClick={() => removeRow(row)} className="text-[#bbb] hover:text-red-600 transition">
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          <button onClick={addRow} className="w-full text-left text-[11px] text-[#999] hover:text-[#555] pt-2 mt-1 border-t border-dashed border-gray-200 flex items-center gap-1 transition">
            <Plus size={12} /> Thêm khoản
          </button>
        </div>
        <div className="px-3.5 py-2 bg-[#F5F4EF] border-t border-[#E8E7E2] flex items-center justify-between text-[12px] font-medium">
          <span>Tổng chi phí cố định tháng này</span>
          <span className="text-red-600">{fmtTrieu(total)} tr.đ</span>
        </div>
        <div className="px-3.5 py-1.5 border-t border-[#E8E7E2] text-[10px] text-[#999]">
          CP này được trừ thẳng vào phần LN chi nhánh nhận từ các dự án. Không chia vào dự án riêng lẻ.
        </div>
      </div>

      <div className="bg-white border border-[#E8E7E2] rounded-xl overflow-hidden">
        <div className="px-3.5 py-2.5 border-b border-[#E8E7E2] text-[12px] font-medium text-[#111]">
          Lợi nhuận ròng chi nhánh sau trừ chi phí cố định
        </div>
        <div className="p-3.5">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex-1 min-w-[110px] bg-[#F5F4EF] rounded-lg p-3 text-center">
              <div className="text-[10px] uppercase text-[#999] mb-1">LN từ dự án (CN phần)</div>
              <div className="text-[17px] font-medium text-emerald-600">{fmtTrieu(projCn)} tr.đ</div>
            </div>
            <div className="text-[20px] text-[#999] px-1">−</div>
            <div className="flex-1 min-w-[110px] bg-[#F5F4EF] rounded-lg p-3 text-center">
              <div className="text-[10px] uppercase text-[#999] mb-1">CP cố định CN</div>
              <div className="text-[17px] font-medium text-red-600">{fmtTrieu(total)} tr.đ</div>
            </div>
            <div className="text-[20px] text-[#999] px-1">=</div>
            <div className="flex-1 min-w-[110px] bg-[#F5F4EF] rounded-lg p-3 text-center border border-[#0F6E56]">
              <div className="text-[10px] uppercase text-[#999] mb-1">LN ròng CN</div>
              <div className={`text-[17px] font-medium ${net >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{fmtTrieu(net)} tr.đ</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
