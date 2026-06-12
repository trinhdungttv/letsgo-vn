import { useState, useEffect, useMemo } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { Client, ProjectPnl, ProjectPnlCost, CostPayer, ProjectPnlType, PnlSplitSettings } from '../../lib/types';
import { fmtTrieu, calcPnl, shiftMonth, monthLabel } from '../../lib/format';

interface PnLProjectTabProps {
  clients: Client[];
  month: string;
  projectsPnl: ProjectPnl[];
  pnlCosts: Record<string, ProjectPnlCost[]>;
  onAddProject: (fields: Omit<ProjectPnl, 'id' | 'created_at' | 'updated_at' | 'clients'>) => Promise<ProjectPnl>;
  onUpdateProject: (id: string, fields: Partial<Omit<ProjectPnl, 'id' | 'created_at' | 'clients'>>) => Promise<ProjectPnl>;
  onDeleteProject: (id: string) => Promise<void>;
  onLoadCosts: (pnlId: string) => Promise<ProjectPnlCost[]>;
  onAddCost: (fields: Omit<ProjectPnlCost, 'id'>) => Promise<ProjectPnlCost>;
  onUpdateCost: (id: string, fields: Partial<Omit<ProjectPnlCost, 'id' | 'pnl_id'>>) => Promise<ProjectPnlCost>;
  onDeleteCost: (id: string, pnlId: string) => Promise<void>;
  splitSettings: Record<string, PnlSplitSettings>;
  onSaveSplitSettings: (clientId: string, fields: Partial<Omit<PnlSplitSettings, 'id' | 'client_id' | 'updated_at'>>) => Promise<PnlSplitSettings>;
  currentUser?: string | null;
  toast: (msg: string) => void;
}

const PAYER_LABEL: Record<CostPayer, string> = { lg: 'LGV trả', cn: 'CN trả', ch: 'Chung' };

export default function PnLProjectTab({
  clients, month, projectsPnl, pnlCosts,
  onAddProject, onUpdateProject, onDeleteProject,
  onLoadCosts, onAddCost, onUpdateCost, onDeleteCost,
  splitSettings, onSaveSplitSettings,
  currentUser, toast,
}: PnLProjectTabProps) {
  const monthProjects = useMemo(() => projectsPnl.filter(p => p.month === month), [projectsPnl, month]);
  const [selId, setSelId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newClientIds, setNewClientIds] = useState<string[]>([]);
  const [filterBranch, setFilterBranch] = useState('all');
  const [splitEditOpen, setSplitEditOpen] = useState(false);
  const [splitEditMode, setSplitEditMode] = useState<'permanent' | 'temporary'>('permanent');
  const [splitEditMonths, setSplitEditMonths] = useState('2');
  const [lgInput, setLgInput] = useState('');
  const [cnInput, setCnInput] = useState('');
  const [pendingSplit, setPendingSplit] = useState<{ lg: number; cn: number } | null>(null);

  const branchOptions = useMemo(
    () => [...new Set(monthProjects.map(p => p.branch_manager || '—'))].sort(),
    [monthProjects]
  );

  const visibleProjects = useMemo(
    () => filterBranch === 'all' ? monthProjects : monthProjects.filter(p => (p.branch_manager || '—') === filterBranch),
    [monthProjects, filterBranch]
  );

  useEffect(() => {
    if (selId && !monthProjects.find(p => p.id === selId)) setSelId(monthProjects[0]?.id || null);
    if (!selId && monthProjects.length) setSelId(monthProjects[0].id);
  }, [monthProjects, selId]);

  useEffect(() => {
    if (selId && !pnlCosts[selId]) onLoadCosts(selId).catch(() => {});
  }, [selId, pnlCosts, onLoadCosts]);

  useEffect(() => {
    setSplitEditOpen(false);
    setSplitEditMode('permanent');
    setSplitEditMonths('2');
    setPendingSplit(null);
  }, [selId]);

  // Đồng bộ chi nhánh từ hồ sơ Khách hàng (trường "Chi nhánh") — nguồn dữ liệu chuẩn.
  useEffect(() => {
    monthProjects.forEach(p => {
      const client = clients.find(c => c.id === p.client_id);
      if (client?.region && p.branch_manager !== client.region) {
        onUpdateProject(p.id, { branch_manager: client.region }).catch(() => {});
      }
    });
  }, [monthProjects, clients, onUpdateProject]);

  const availableClients = useMemo(
    () => clients.filter(c => !monthProjects.some(p => p.client_id === c.id)),
    [clients, monthProjects]
  );

  const selected = monthProjects.find(p => p.id === selId) || null;

  useEffect(() => {
    if (selected) {
      setLgInput(String(selected.lg_pct));
      setCnInput(String(selected.cn_pct));
    }
  }, [selId, selected?.lg_pct, selected?.cn_pct]);

  const costs = selId ? (pnlCosts[selId] || []) : [];
  const r = selected ? calcPnl(selected, costs) : null;

  const handleAdd = async () => {
    if (newClientIds.length === 0) { toast('Vui lòng chọn khách hàng'); return; }
    try {
      let lastId: string | null = null;
      for (const clientId of newClientIds) {
        const client = clients.find(c => c.id === clientId);
        const settings = splitSettings[clientId];
        const defaultLg = settings?.lg_pct ?? 40;
        const defaultCn = settings?.cn_pct ?? 60;

        let lgPct = defaultLg;
        let cnPct = defaultCn;
        let splitTempUntil: string | null = null;
        let splitReverted = false;

        if (settings?.pending_until_month) {
          if (month <= settings.pending_until_month) {
            lgPct = settings.pending_lg_pct ?? defaultLg;
            cnPct = settings.pending_cn_pct ?? defaultCn;
            splitTempUntil = settings.pending_until_month;
          } else {
            if (month === shiftMonth(settings.pending_until_month, 1)) splitReverted = true;
            await onSaveSplitSettings(clientId, { pending_lg_pct: null, pending_cn_pct: null, pending_until_month: null });
          }
        }

        const created = await onAddProject({
          client_id: clientId,
          month,
          branch_manager: client?.region || null,
          project_type: 'shared',
          lg_pct: lgPct,
          cn_pct: cnPct,
          revenue: 0,
          created_by: currentUser || null,
          split_temp_until: splitTempUntil,
          split_reverted: splitReverted,
        });
        await onAddCost({ pnl_id: created.id, label: 'Lương cơ bản NLĐ', value: 0, payer: 'lg', sort_order: 0 });
        await onAddCost({ pnl_id: created.id, label: 'Chi phí quản lý', value: 0, payer: 'cn', sort_order: 1 });
        lastId = created.id;
      }
      if (lastId) setSelId(lastId);
      setAdding(false);
      setNewClientIds([]);
      toast(`Đã thêm ${newClientIds.length} dự án`);
    } catch (e) {
      toast('Lỗi: ' + (e instanceof Error ? e.message : String(e)));
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Xoá dự án này?')) return;
    try {
      await onDeleteProject(id);
      if (selId === id) setSelId(null);
      toast('Đã xoá dự án');
    } catch (e) {
      toast('Lỗi: ' + (e instanceof Error ? e.message : String(e)));
    }
  };

  const updateField = async (fields: Partial<Omit<ProjectPnl, 'id' | 'created_at' | 'clients'>>) => {
    if (!selected) return;
    try { await onUpdateProject(selected.id, fields); } catch (e) { toast('Lỗi: ' + (e instanceof Error ? e.message : String(e))); }
  };

  const onSplitChange = (side: 'lg' | 'cn', val: string) => {
    const v = Math.min(100, Math.max(0, +val || 0));
    const other = Math.round((100 - v) * 10) / 10;
    if (side === 'lg') { setLgInput(val); setCnInput(String(other)); }
    else { setCnInput(val); setLgInput(String(other)); }
  };

  const onSplitBlur = () => {
    if (!selected) return;
    const lg = Math.min(100, Math.max(0, +lgInput || 0));
    const cn = Math.round((100 - lg) * 10) / 10;
    if (lg === selected.lg_pct && cn === selected.cn_pct) return;
    setPendingSplit({ lg, cn });
    setSplitEditOpen(true);
  };

  const cancelSplitEdit = () => {
    if (selected) {
      setLgInput(String(selected.lg_pct));
      setCnInput(String(selected.cn_pct));
    }
    setPendingSplit(null);
    setSplitEditOpen(false);
  };

  const addCostRow = async () => {
    if (!selected) return;
    try {
      await onAddCost({ pnl_id: selected.id, label: 'Chi phí mới', value: 0, payer: 'lg', sort_order: costs.length });
    } catch (e) { toast('Lỗi: ' + (e instanceof Error ? e.message : String(e))); }
  };

  const updateCostField = async (cost: ProjectPnlCost, fields: Partial<Omit<ProjectPnlCost, 'id' | 'pnl_id'>>) => {
    try { await onUpdateCost(cost.id, fields); } catch (e) { toast('Lỗi: ' + (e instanceof Error ? e.message : String(e))); }
  };

  const removeCostRow = async (cost: ProjectPnlCost) => {
    try { await onDeleteCost(cost.id, cost.pnl_id); } catch (e) { toast('Lỗi: ' + (e instanceof Error ? e.message : String(e))); }
  };

  const applySplitPolicy = async () => {
    if (!selected || !pendingSplit) return;
    try {
      const { lg, cn } = pendingSplit;
      await onUpdateProject(selected.id, { lg_pct: lg, cn_pct: cn });
      if (splitEditMode === 'permanent') {
        await onSaveSplitSettings(selected.client_id, {
          lg_pct: lg,
          cn_pct: cn,
          pending_lg_pct: null,
          pending_cn_pct: null,
          pending_until_month: null,
        });
        toast('Đã đặt tỷ lệ này làm mặc định cho các tháng sau');
      } else {
        const months = Math.max(1, parseInt(splitEditMonths) || 1);
        const untilMonth = shiftMonth(month, months);
        await onSaveSplitSettings(selected.client_id, {
          pending_lg_pct: lg,
          pending_cn_pct: cn,
          pending_until_month: untilMonth,
        });
        toast(`Đã áp dụng tỷ lệ này trong ${months} tháng tới (đến ${monthLabel(untilMonth)})`);
      }
      setPendingSplit(null);
      setSplitEditOpen(false);
    } catch (e) {
      toast('Lỗi: ' + (e instanceof Error ? e.message : String(e)));
    }
  };

  return (
    <div className="grid grid-cols-[230px_1fr] gap-3 min-h-[540px]">
      {/* Sidebar */}
      <div className="bg-[#F5F4EF] border border-[#E8E7E2] rounded-xl overflow-hidden self-start">
        <div className="px-3 py-2.5 border-b border-[#E8E7E2] flex items-center justify-between text-[12px] font-medium">
          Dự án
          <button onClick={() => setAdding(v => !v)} className="w-6 h-6 rounded-md border border-gray-300 flex items-center justify-center hover:bg-white transition">
            <Plus size={13} />
          </button>
        </div>
        {adding && (
          <div className="p-2.5 border-b border-[#E8E7E2] space-y-2">
            <div className="max-h-[260px] overflow-y-auto border border-gray-300 rounded-lg bg-white">
              <label className="flex items-center gap-2 px-2 py-1.5 text-[12px] font-medium border-b border-gray-200 cursor-pointer hover:bg-[#F5F4EF]">
                <input
                  type="checkbox"
                  checked={availableClients.length > 0 && newClientIds.length === availableClients.length}
                  onChange={e => setNewClientIds(e.target.checked ? availableClients.map(c => c.id) : [])}
                  className="w-3.5 h-3.5"
                />
                Chọn tất cả ({availableClients.length})
              </label>
              {availableClients.map(c => (
                <label key={c.id} className="flex items-center gap-2 px-2 py-1.5 text-[12px] cursor-pointer hover:bg-[#F5F4EF]">
                  <input
                    type="checkbox"
                    checked={newClientIds.includes(c.id)}
                    onChange={e => setNewClientIds(prev => e.target.checked ? [...prev, c.id] : prev.filter(id => id !== c.id))}
                    className="w-3.5 h-3.5"
                  />
                  {c.name}
                </label>
              ))}
            </div>
            <button onClick={handleAdd} className="w-full py-1.5 rounded-lg text-[12px] font-medium bg-[#0F6E56] text-white hover:opacity-90 transition">
              Thêm {newClientIds.length > 0 ? `${newClientIds.length} dự án` : 'dự án'}
            </button>
          </div>
        )}
        {monthProjects.length > 0 && (
          <div className="px-2.5 py-2 border-b border-[#E8E7E2]">
            <select
              value={filterBranch}
              onChange={e => setFilterBranch(e.target.value)}
              className="w-full text-[12px] px-2 py-1.5 border border-gray-300 rounded-lg outline-none bg-white"
            >
              <option value="all">Tất cả chi nhánh ({monthProjects.length})</option>
              {branchOptions.map(b => (
                <option key={b} value={b}>{b} ({monthProjects.filter(p => (p.branch_manager || '—') === b).length})</option>
              ))}
            </select>
          </div>
        )}
        <div>
          {visibleProjects.length === 0 ? (
            <div className="px-3 py-6 text-center text-[12px] text-[#999]">Chưa có dự án nào</div>
          ) : visibleProjects.map(p => {
            const c = pnlCosts[p.id] || [];
            const rr = calcPnl(p, c);
            return (
              <div
                key={p.id}
                onClick={() => setSelId(p.id)}
                className={`px-3 py-2.5 border-b border-[#E8E7E2] border-l-2 cursor-pointer transition hover:bg-white ${p.id === selId ? 'bg-white border-l-[#0F6E56]' : 'border-l-transparent'}`}
              >
                <div className="text-[12px] font-medium text-[#111] truncate">{p.clients?.name || clients.find(x => x.id === p.client_id)?.name || '—'}</div>
                <div className="text-[10px] text-[#999] mb-1">{p.branch_manager || '—'}</div>
                <div className="flex items-center justify-between">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${p.project_type === 'managed' ? 'bg-[#E6F1FB] text-[#0C447C]' : 'bg-[#EAF3DE] text-[#27500A]'}`}>
                    {p.project_type === 'managed' ? 'Nhận lương' : `${p.lg_pct}/${p.cn_pct}`}
                  </span>
                  <span className={`text-[11px] font-medium ${rr.profit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>LN: {fmtTrieu(rr.profit)}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Main panel */}
      <div className="space-y-3">
        {!selected || !r ? (
          <div className="h-[300px] flex items-center justify-center text-[12px] text-[#999]">
            ← Chọn dự án để xem chi tiết
          </div>
        ) : (
          <>
            {/* Row 1: Info */}
            <div className="bg-white border border-[#E8E7E2] rounded-xl overflow-hidden">
              <div className="px-3.5 py-2.5 border-b border-[#E8E7E2] flex items-center gap-2">
                <div className="text-[14px] font-medium text-[#111] flex-1 truncate">
                  {selected.clients?.name || clients.find(x => x.id === selected.client_id)?.name}
                </div>
                <span className={`text-[10px] px-2 py-1 rounded font-medium ${selected.project_type === 'managed' ? 'bg-[#E6F1FB] text-[#0C447C]' : 'bg-[#EAF3DE] text-[#27500A]'}`}>
                  {selected.project_type === 'managed' ? 'Không Khoán - Nhận Lương' : 'Đã Nhận Khoán'}
                </span>
                <button onClick={() => handleDelete(selected.id)} className="text-red-600 hover:bg-red-50 rounded-md p-1.5 transition">
                  <Trash2 size={14} />
                </button>
              </div>
              <div className="p-3.5 flex items-center gap-3 flex-wrap">
                <span className="text-[12px] text-[#666]">Chi nhánh / quản lý:</span>
                {clients.find(c => c.id === selected.client_id)?.region ? (
                  <div className="flex-1 min-w-[140px] text-[12px] px-2.5 py-1.5 border border-gray-200 rounded-lg bg-[#F5F4EF] text-[#444] flex items-center gap-1.5">
                    {selected.branch_manager}
                    <span className="text-[10px] text-[#999]">(đồng bộ từ Khách hàng)</span>
                  </div>
                ) : (
                  <input
                    type="text"
                    defaultValue={selected.branch_manager || ''}
                    onBlur={e => updateField({ branch_manager: e.target.value || null })}
                    className="flex-1 min-w-[140px] text-[12px] px-2.5 py-1.5 border border-gray-300 rounded-lg outline-none focus:border-blue-500"
                  />
                )}
                <span className="text-[12px] text-[#666]">Doanh thu:</span>
                <div className="relative w-[140px]">
                  <input
                    type="number"
                    defaultValue={selected.revenue}
                    onBlur={e => updateField({ revenue: +e.target.value || 0 })}
                    className="w-full text-[12px] px-2.5 py-1.5 pr-8 border border-gray-300 rounded-lg outline-none focus:border-blue-500 text-right"
                  />
                  <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-[#999]">tr.đ</span>
                </div>
              </div>
            </div>

            {/* Row 2: Type + split */}
            <div className="bg-white border border-[#E8E7E2] rounded-xl overflow-hidden">
              <div className="px-3.5 py-2.5 border-b border-[#E8E7E2] text-[12px] font-medium text-[#111]">
                Loại dự án &amp; phân chia lợi nhuận
              </div>
              <div className="p-3.5 space-y-3">
                <div className="flex border border-gray-300 rounded-lg overflow-hidden max-w-[420px]">
                  <button
                    onClick={() => updateField({ project_type: 'managed' as ProjectPnlType })}
                    className={`flex-1 py-1.5 text-[11.5px] font-medium transition ${selected.project_type === 'managed' ? 'bg-[#F5F4EF] text-[#111]' : 'text-[#999] hover:text-[#555]'}`}
                  >
                    Không Khoán - Nhận Lương
                  </button>
                  <button
                    onClick={() => updateField({ project_type: 'shared' as ProjectPnlType })}
                    className={`flex-1 py-1.5 text-[11.5px] font-medium transition border-l border-gray-300 ${selected.project_type === 'shared' ? 'bg-[#F5F4EF] text-[#111]' : 'text-[#999] hover:text-[#555]'}`}
                  >
                    Đã Nhận Khoán
                  </button>
                </div>
                {selected.project_type === 'shared' ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <span className="text-[12px] text-[#666]">Let's Go VN:</span>
                      <div className="relative w-[80px]">
                        <input
                          type="number" min={0} max={100}
                          value={lgInput}
                          onChange={e => onSplitChange('lg', e.target.value)}
                          onBlur={onSplitBlur}
                          className="w-full text-[12px] px-2 py-1.5 pr-6 border border-gray-300 rounded-lg outline-none focus:border-blue-500 text-right"
                        />
                        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-[#999]">%</span>
                      </div>
                      <span className="text-[12px] text-[#666]">Chi nhánh:</span>
                      <div className="relative w-[80px]">
                        <input
                          type="number" min={0} max={100}
                          value={cnInput}
                          onChange={e => onSplitChange('cn', e.target.value)}
                          onBlur={onSplitBlur}
                          className="w-full text-[12px] px-2 py-1.5 pr-6 border border-gray-300 rounded-lg outline-none focus:border-blue-500 text-right"
                        />
                        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-[#999]">%</span>
                      </div>
                      <span className="text-[11px] font-medium text-emerald-600">
                        ✓ Tổng = 100%
                      </span>
                    </div>

                    {selected.split_temp_until && (
                      <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 inline-block">
                        ⏱ Tỷ lệ tạm thời — áp dụng đến hết {monthLabel(selected.split_temp_until)}, sau đó tự trở về mức thông thường
                      </div>
                    )}
                    {selected.split_reverted && (
                      <div className="text-[11px] text-[#666] bg-[#F5F4EF] border border-gray-200 rounded-lg px-2.5 py-1.5 inline-block">
                        ↩ Đã hết thời hạn áp dụng tạm thời, tỷ lệ đã trở về mức thông thường
                      </div>
                    )}

                    {splitEditOpen && pendingSplit && (
                      <div className="border border-gray-200 rounded-lg p-3 space-y-2.5 max-w-[420px] bg-[#FAFAF8]">
                        <div className="text-[12px] font-medium text-[#111]">
                          Đổi tỷ lệ thành {pendingSplit.lg}/{pendingSplit.cn}. Áp dụng cho các tháng sau như thế nào?
                        </div>
                        <label className="flex items-center gap-2 text-[12px] cursor-pointer">
                          <input type="radio" checked={splitEditMode === 'permanent'} onChange={() => setSplitEditMode('permanent')} />
                          Thay đổi luôn — áp dụng vĩnh viễn từ tháng sau
                        </label>
                        <label className="flex items-center gap-2 text-[12px] cursor-pointer">
                          <input type="radio" checked={splitEditMode === 'temporary'} onChange={() => setSplitEditMode('temporary')} />
                          Chỉ áp dụng trong
                          <input
                            type="number" min={1}
                            value={splitEditMonths}
                            onChange={e => { setSplitEditMonths(e.target.value); setSplitEditMode('temporary'); }}
                            className="w-[50px] text-[12px] px-1.5 py-1 border border-gray-300 rounded-lg outline-none text-right"
                          />
                          tháng tới, rồi tự trở về mức thông thường
                        </label>
                        <div className="flex gap-2">
                          <button onClick={applySplitPolicy} className="px-3 py-1.5 rounded-lg text-[12px] font-medium bg-[#0F6E56] text-white hover:opacity-90 transition">
                            Áp dụng
                          </button>
                          <button onClick={cancelSplitEdit} className="px-3 py-1.5 rounded-lg text-[12px] font-medium border border-gray-300 text-[#666] hover:bg-white transition">
                            Hủy
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-[12px] text-[#666]">LGV trả toàn bộ chi phí &amp; nhận 100% LN. Chi nhánh nhận lương cố định.</div>
                )}
              </div>
            </div>

            {/* Row 3: Costs */}
            <div className="bg-white border border-[#E8E7E2] rounded-xl overflow-hidden">
              <div className="px-3.5 py-2.5 border-b border-[#E8E7E2] flex items-center justify-between">
                <div className="text-[12px] font-medium text-[#111]">Chi phí dự án</div>
                <div className="flex gap-1.5 text-[10px]">
                  <span className="px-1.5 py-0.5 rounded font-medium bg-[#E6F1FB] text-[#0C447C]">LGV trả</span>
                  <span className="px-1.5 py-0.5 rounded font-medium bg-[#EAF3DE] text-[#27500A]">CN trả</span>
                  <span className="px-1.5 py-0.5 rounded font-medium bg-[#F5F4EF] border border-gray-300 text-[#666]">Chung</span>
                </div>
              </div>
              <div className="p-3.5">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="text-[10px] text-[#999] uppercase">
                      <th className="text-left font-medium pb-1.5">Khoản chi phí</th>
                      <th className="text-right font-medium pb-1.5 w-[120px]">Giá trị</th>
                      <th className="text-center font-medium pb-1.5 w-[95px]">Bên chi trả</th>
                      <th className="w-[28px]"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {costs.map(c => (
                      <tr key={c.id} className="border-t border-[#F0EEE9]">
                        <td className="py-1.5 pr-2">
                          <input
                            type="text" defaultValue={c.label}
                            onBlur={e => updateCostField(c, { label: e.target.value })}
                            className="w-full text-[12px] px-1.5 py-1 border-b border-dashed border-gray-300 outline-none focus:border-blue-500 bg-transparent"
                          />
                        </td>
                        <td className="py-1.5">
                          <div className="relative">
                            <input
                              type="number" defaultValue={c.value}
                              onBlur={e => updateCostField(c, { value: +e.target.value || 0 })}
                              className="w-full text-[12px] px-2 py-1 pr-8 border border-gray-300 rounded-lg outline-none focus:border-blue-500 text-right"
                            />
                            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-[#999]">tr.đ</span>
                          </div>
                        </td>
                        <td className="py-1.5 text-center">
                          <select
                            value={c.payer}
                            onChange={e => updateCostField(c, { payer: e.target.value as CostPayer })}
                            className="text-[11px] px-1.5 py-1 border border-gray-300 rounded-lg outline-none"
                          >
                            {Object.entries(PAYER_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                          </select>
                        </td>
                        <td className="py-1.5 text-center">
                          <button onClick={() => removeCostRow(c)} className="text-[#bbb] hover:text-red-600 transition">
                            <Trash2 size={13} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button onClick={addCostRow} className="w-full text-left text-[11px] text-[#999] hover:text-[#555] pt-2 mt-1 border-t border-dashed border-gray-200 flex items-center gap-1 transition">
                  <Plus size={12} /> Thêm khoản chi phí
                </button>
              </div>
              <div className="px-3.5 py-2 bg-[#F5F4EF] border-t border-[#E8E7E2] flex items-center justify-between text-[12px] font-medium">
                <span>Tổng chi phí</span>
                <span className="text-red-600">{fmtTrieu(r.tc)} tr.đ</span>
              </div>
            </div>

            {/* Row 4: Result */}
            <div className="bg-white border border-[#E8E7E2] rounded-xl overflow-hidden">
              <div className="px-3.5 py-2.5 border-b border-[#E8E7E2] text-[12px] font-medium text-[#111]">
                Kết quả phân chia
              </div>
              <div className="p-3.5">
                <div className="text-[11px] text-[#666] bg-[#F5F4EF] rounded-lg px-2.5 py-2 mb-3">
                  DT <strong className="text-[#111]">{fmtTrieu(selected.revenue)}</strong>
                  {' − '}CP <strong className="text-red-600">{fmtTrieu(r.tc)}</strong>
                  {' = '}LN <strong className={r.profit >= 0 ? 'text-emerald-600' : 'text-red-600'}>{fmtTrieu(r.profit)}</strong> tr.đ
                  {selected.project_type === 'shared' ? ` → Chia ${selected.lg_pct}/${selected.cn_pct}` : " → 100% Let's Go VN"}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-lg p-3 text-center bg-[#F5F4EF] border border-[#E8E7E2]">
                    <div className="text-[10px] uppercase text-[#999] mb-1">Lợi nhuận dự án</div>
                    <div className={`text-[20px] font-medium ${r.profit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{fmtTrieu(r.profit)}</div>
                    <div className="text-[10px] text-[#999] mt-0.5">triệu đồng</div>
                  </div>
                  <div className="rounded-lg p-3 text-center bg-[#E6F1FB] border border-[#B5D4F4]">
                    <div className="text-[10px] uppercase text-[#0C447C] mb-1">Let's Go VN</div>
                    <div className="text-[20px] font-medium text-[#185FA5]">{fmtTrieu(r.lgP)}</div>
                    <div className="text-[10px] text-[#378ADD] mt-0.5">{selected.project_type === 'shared' ? `${selected.lg_pct}% LN` : '100% (khoán)'}</div>
                  </div>
                  <div className="rounded-lg p-3 text-center bg-[#EAF3DE] border border-[#C0DD97]">
                    <div className="text-[10px] uppercase text-[#27500A] mb-1">Chi nhánh</div>
                    <div className="text-[20px] font-medium text-emerald-700">{fmtTrieu(r.cnP)}</div>
                    <div className="text-[10px] text-emerald-600 mt-0.5">{selected.project_type === 'shared' ? `${selected.cn_pct}% LN` : 'Nhận lương CĐ'}</div>
                  </div>
                </div>
                {selected.project_type === 'shared' && (
                  <div className="mt-2.5 text-[11px] text-[#666] bg-[#F5F4EF] rounded-lg px-2.5 py-2">
                    <strong className="text-[#555]">CP theo bên: </strong>
                    LGV chịu <strong className="text-[#185FA5]">{fmtTrieu(r.lgC)}</strong>{' · '}
                    CN chịu <strong className="text-emerald-700">{fmtTrieu(r.cnC)}</strong>{' · '}
                    Chung <strong>{fmtTrieu(r.shC)}</strong> tr.đ
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
