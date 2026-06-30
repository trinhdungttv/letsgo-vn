import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Plus, Trash2, Settings, X as XIcon, Check, Pencil } from 'lucide-react';
import type { Client, ProjectPnl, ProjectPnlCost, CostPayer, ProjectPnlType, PnlSplitSettings, Branch, CostCategory, CostGroupType, BranchZone, BranchZoneCost, BranchStaff, PnlRevenueLine } from '../../lib/types';
import { fmtTrieu, calcPnl, shiftMonth, monthLabel, getBranchForMonth, getBranchTypeForMonth } from '../../lib/format';
import { supabase } from '../../lib/supabase';
import type { ClientBranchHistory, BranchTypeHistory } from '../../lib/types';

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
  branches: Branch[];
  costCategories: CostCategory[];
  onAddCategory: (label: string) => Promise<CostCategory>;
  onRenameCategory: (id: string, label: string) => Promise<void>;
  onDeleteCategory: (id: string) => Promise<void>;
  onToggleCategoryDefault: (id: string, val: boolean) => Promise<void>;
  onSetCategoryGroup: (id: string, val: CostGroupType) => Promise<void>;
  onSetCategoryPayer: (id: string, val: CostPayer) => Promise<void>;
  currentUser?: string | null;
  toast: (msg: string) => void;
}

const PAYER_LABEL: Record<CostPayer, string> = { lg: 'LGV trả', cn: 'CN trả', ch: 'Chung' };

export default function PnLProjectTab({
  clients, month, projectsPnl, pnlCosts,
  onAddProject, onUpdateProject, onDeleteProject,
  onLoadCosts, onAddCost, onUpdateCost, onDeleteCost,
  splitSettings, onSaveSplitSettings,
  branches = [], costCategories, onAddCategory, onRenameCategory, onDeleteCategory, onToggleCategoryDefault, onSetCategoryGroup, onSetCategoryPayer,
  currentUser, toast,
}: PnLProjectTabProps) {
  const monthProjects = useMemo(() => projectsPnl.filter(p => p.month === month), [projectsPnl, month]);
  const [selId, setSelId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newClientIds, setNewClientIds] = useState<string[]>([]);
  const [addSearch, setAddSearch] = useState('');
  const [filterBranch, setFilterBranch] = useState('all');
  const [splitEditOpen, setSplitEditOpen] = useState(false);
  const [splitEditMode, setSplitEditMode] = useState<'permanent' | 'temporary'>('permanent');
  const [splitEditMonths, setSplitEditMonths] = useState('2');
  const [lgInput, setLgInput] = useState('');
  const [cnInput, setCnInput] = useState('');
  const [pendingSplit, setPendingSplit] = useState<{ lg: number; cn: number } | null>(null);

  type MinClient = { id: string; name: string; region: string | null; archived_at: string | null; cooperation_status?: string | null; project_type?: string; default_lg_pct?: number; default_cn_pct?: number };
  const [extraClients, setExtraClients] = useState<MinClient[]>([]);
  const [allBranchHistory, setAllBranchHistory] = useState<ClientBranchHistory[]>([]);
  const [branchTypeHistoryMap, setBranchTypeHistoryMap] = useState<Record<string, BranchTypeHistory[]>>({});

  const [zoneData, setZoneData] = useState<{ zones: BranchZone[]; costs: Record<string, BranchZoneCost[]>; staffs: BranchStaff[] }>({ zones: [], costs: {}, staffs: [] });
  useEffect(() => {
    (async () => {
      const { data: zData } = await supabase.from('branch_zones').select('*').order('created_at');
      const zones = (zData ?? []) as BranchZone[];
      if (!zones.length) return;
      const [{ data: cData }, { data: sData }] = await Promise.all([
        supabase.from('branch_zone_costs').select('*').in('zone_id', zones.map(z => z.id)),
        supabase.from('branch_staffs').select('*').in('zone_id', zones.map(z => z.id)),
      ]);
      const grouped: Record<string, BranchZoneCost[]> = {};
      for (const c of (cData ?? []) as BranchZoneCost[]) (grouped[c.zone_id] ??= []).push(c);
      setZoneData({ zones, costs: grouped, staffs: (sData ?? []) as BranchStaff[] });
    })();
  }, []);

  const getZoneVpCost = useCallback((clientId: string): { amount: number; zoneName: string; totalCost: number; fixedCosts: number; staffCosts: number; projectCount: number } | null => {
    for (const zone of zoneData.zones) {
      const ids = (zone as BranchZone & { client_ids?: string[] }).client_ids || [];
      if (!ids.includes(clientId)) continue;
      const fixedCosts = (zoneData.costs[zone.id] || []).reduce((s, c) => s + (c.amount || 0), 0);
      const staffCosts = zoneData.staffs.filter(s => s.zone_id === zone.id).reduce((s, st) => s + (st.salary || 0), 0);
      const totalCost = fixedCosts + staffCosts;
      const projectCount = Math.max(ids.length, 1);
      return { amount: Math.round(totalCost / projectCount), zoneName: zone.name, totalCost, fixedCosts, staffCosts, projectCount };
    }
    return null;
  }, [zoneData]);
  useEffect(() => {
    supabase.from('clients').select('id, name, region, archived_at, cooperation_status, project_type, default_lg_pct, default_cn_pct')
      .order('name')
      .then(({ data }) => { if (data) setExtraClients(data as MinClient[]); });
    supabase.from('client_branch_history').select('*').order('effective_from')
      .then(({ data }) => { if (data) setAllBranchHistory(data as ClientBranchHistory[]); });
    supabase.from('branch_type_history').select('*').order('effective_from', { ascending: false })
      .then(({ data }) => {
        const map: Record<string, BranchTypeHistory[]> = {};
        for (const h of (data ?? []) as BranchTypeHistory[]) (map[h.branch_id] ??= []).push(h);
        setBranchTypeHistoryMap(map);
      });
  }, []);

  const mergedClients = useMemo(() => {
    const ids = new Set(clients.map(c => c.id));
    const extras = extraClients.filter(c => !ids.has(c.id));
    return [...clients.map(c => ({ id: c.id, name: c.name, region: c.region, archived_at: c.archived_at, cooperation_status: c.cooperation_status })), ...extras];
  }, [clients, extraClients]);

  const branchOptions = useMemo(
    () => [...new Set(monthProjects.map(p => p.branch_manager || '—'))].sort(),
    [monthProjects]
  );

  const visibleProjects = useMemo(
    () => filterBranch === 'all' ? monthProjects : monthProjects.filter(p => (p.branch_manager || '—') === filterBranch),
    [monthProjects, filterBranch]
  );

  const [revLines, setRevLines] = useState<Record<string, PnlRevenueLine[]>>({});
  const loadRevLines = useCallback(async (pnlId: string) => {
    const { data } = await supabase.from('pnl_revenue_lines').select('*').eq('pnl_id', pnlId).order('sort_order');
    if (data) setRevLines(prev => ({ ...prev, [pnlId]: data as PnlRevenueLine[] }));
  }, []);

  useEffect(() => {
    if (selId && !monthProjects.find(p => p.id === selId)) setSelId(monthProjects[0]?.id || null);
    if (!selId && monthProjects.length) setSelId(monthProjects[0].id);
  }, [monthProjects, selId]);

  useEffect(() => {
    if (selId && !revLines[selId]) loadRevLines(selId);
  }, [selId, revLines, loadRevLines]);

  useEffect(() => {
    if (selId && !pnlCosts[selId]) onLoadCosts(selId).catch(() => {});
  }, [selId, pnlCosts, onLoadCosts]);

  useEffect(() => {
    for (const p of monthProjects) {
      if (!pnlCosts[p.id]) onLoadCosts(p.id).catch(() => {});
    }
  }, [monthProjects, pnlCosts, onLoadCosts]);

  useEffect(() => {
    setSplitEditOpen(false);
    setSplitEditMode('permanent');
    setSplitEditMonths('2');
    setPendingSplit(null);
  }, [selId]);

  const availableClients = useMemo(
    () => mergedClients.filter(c => !monthProjects.some(p => p.client_id === c.id)),
    [mergedClients, monthProjects]
  );
  const filteredAddClients = useMemo(
    () => addSearch ? availableClients.filter(c => c.name.toLowerCase().includes(addSearch.toLowerCase())) : availableClients,
    [availableClients, addSearch]
  );

  const selected = monthProjects.find(p => p.id === selId) || null;

  useEffect(() => {
    if (selected) {
      setLgInput(String(selected.lg_pct));
      setCnInput(String(selected.cn_pct));
    }
  }, [selId, selected?.lg_pct, selected?.cn_pct]);

  const taxOptsFor = useCallback((clientId: string) => {
    const s = splitSettings[clientId];
    return { categories: costCategories, taxPct: s?.tax_pct ?? 20, taxExempt: s?.tax_exempt ?? false };
  }, [splitSettings, costCategories]);

  const costs = selId ? (pnlCosts[selId] || []) : [];
  const r = selected ? calcPnl(selected, costs, taxOptsFor(selected.client_id)) : null;

  const handleAdd = async () => {
    if (newClientIds.length === 0) { toast('Vui lòng chọn khách hàng'); return; }
    try {
      let lastId: string | null = null;
      for (const clientId of newClientIds) {
        const client = mergedClients.find(c => c.id === clientId);
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

        const ec = extraClients.find(c => c.id === clientId);
        let clientProjectType: ProjectPnlType = ec?.project_type === 'managed' ? 'managed' : 'shared';

        const clientRegion = ec?.region || client?.region;
        const matchedBranch = clientRegion ? branches.find(b => b.region === clientRegion) : null;
        const branchKhoan = matchedBranch ? getBranchTypeForMonth(branchTypeHistoryMap[matchedBranch.id] || [], month) : null;

        if (branchKhoan?.type === 'company') {
          clientProjectType = 'managed';
          lgPct = 100; cnPct = 0;
        } else if (branchKhoan?.type === 'contracted' && branchKhoan.khoanMode === 'common' && branchKhoan.lgPct > 0) {
          lgPct = branchKhoan.lgPct;
          cnPct = branchKhoan.cnPct;
        } else if (clientProjectType === 'managed') {
          lgPct = 100; cnPct = 0;
        } else if (!settings?.pending_lg_pct) {
          lgPct = ec?.default_lg_pct ?? lgPct;
          cnPct = ec?.default_cn_pct ?? cnPct;
        }

        const prevEntry = projectsPnl
          .filter(p => p.client_id === clientId && p.month < month)
          .sort((a, b) => b.month.localeCompare(a.month))[0] || null;
        const prevCosts = prevEntry ? (pnlCosts[prevEntry.id] || []) : [];

        const created = await onAddProject({
          client_id: clientId,
          month,
          branch_manager: prevEntry?.branch_manager || getBranchForMonth(allBranchHistory.filter(h => h.client_id === clientId), month) || client?.region || null,
          project_type: clientProjectType,
          lg_pct: lgPct,
          cn_pct: cnPct,
          revenue: 0,
          total_man_days: 0,
          created_by: currentUser || null,
          split_temp_until: splitTempUntil,
          split_reverted: splitReverted,
        });

        if (prevCosts.length > 0) {
          for (let i = 0; i < prevCosts.length; i++) {
            await onAddCost({ pnl_id: created.id, label: prevCosts[i].label, value: 0, payer: prevCosts[i].payer, sort_order: i });
          }
        } else {
          const defaults = costCategories.filter(c => c.is_default);
          for (let i = 0; i < defaults.length; i++) {
            await onAddCost({ pnl_id: created.id, label: defaults[i].label, value: 0, payer: defaults[i].default_payer ?? 'ch', sort_order: i });
          }
          if (!defaults.length) {
            await onAddCost({ pnl_id: created.id, label: 'Chi phi moi', value: 0, payer: 'ch', sort_order: 0 });
          }
        }
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

  const [taxSettingsOpen, setTaxSettingsOpen] = useState(false);
  const [taxPctInput, setTaxPctInput] = useState('20');
  const [taxExemptInput, setTaxExemptInput] = useState(false);

  useEffect(() => {
    if (!selected) return;
    const s = splitSettings[selected.client_id];
    setTaxPctInput(String(s?.tax_pct ?? 20));
    setTaxExemptInput(s?.tax_exempt ?? false);
  }, [selected?.client_id, selected, splitSettings]);

  const saveTaxSettings = async () => {
    if (!selected) return;
    try {
      const pct = Math.min(100, Math.max(0, +taxPctInput || 0));
      await onSaveSplitSettings(selected.client_id, { tax_pct: pct, tax_exempt: taxExemptInput });
      toast('Đã lưu cài đặt thuế TNDN');
      setTaxSettingsOpen(false);
    } catch (e) {
      toast('Lỗi: ' + (e instanceof Error ? e.message : String(e)));
    }
  };

  const [costSettingsOpen, setCostSettingsOpen] = useState(false);
  const [newCatLabel, setNewCatLabel] = useState('');
  const [editingCatId, setEditingCatId] = useState<string | null>(null);
  const [editingCatLabel, setEditingCatLabel] = useState('');

  const addCostFromCategory = async (catLabel: string) => {
    if (!selected) return;
    if (costs.some(c => c.label === catLabel)) { toast('Hang muc nay da co'); return; }
    const defaultPayer = costCategories.find(cat => cat.label === catLabel)?.default_payer ?? 'lg';
    try {
      await onAddCost({ pnl_id: selected.id, label: catLabel, value: 0, payer: defaultPayer, sort_order: costs.length });
      for (const p of monthProjects) {
        if (p.id === selected.id) continue;
        const existing = pnlCosts[p.id] || [];
        if (!existing.some(c => c.label === catLabel)) {
          await onAddCost({ pnl_id: p.id, label: catLabel, value: 0, payer: defaultPayer, sort_order: existing.length });
        }
      }
    } catch (e) { toast('Loi: ' + (e instanceof Error ? e.message : String(e))); }
  };

  const handleAddCategory = async () => {
    const label = newCatLabel.trim();
    if (!label) return;
    try {
      await onAddCategory(label);
      setNewCatLabel('');
    } catch (e) { toast('Loi: ' + (e instanceof Error ? e.message : String(e))); }
  };

  const handleRenameCategory = async (id: string) => {
    const label = editingCatLabel.trim();
    if (!label) return;
    const old = costCategories.find(c => c.id === id);
    try {
      await onRenameCategory(id, label);
      if (old) {
        for (const p of monthProjects) {
          const existing = pnlCosts[p.id] || [];
          const match = existing.find(c => c.label === old.label);
          if (match) await onUpdateCost(match.id, { label }).catch(() => {});
        }
      }
      setEditingCatId(null);
    } catch (e) { toast('Loi: ' + (e instanceof Error ? e.message : String(e))); }
  };

  const handleDeleteCategory = async (id: string) => {
    try { await onDeleteCategory(id); } catch (e) { toast('Loi: ' + (e instanceof Error ? e.message : String(e))); }
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
            <input
              type="text"
              placeholder="Tim ten cong ty..."
              value={addSearch}
              onChange={e => setAddSearch(e.target.value)}
              className="w-full text-[12px] px-2.5 py-1.5 border border-gray-300 rounded-lg outline-none focus:border-blue-500"
            />
            <div className="max-h-[260px] overflow-y-auto border border-gray-300 rounded-lg bg-white">
              <label className="flex items-center gap-2 px-2 py-1.5 text-[12px] font-medium border-b border-gray-200 cursor-pointer hover:bg-[#F5F4EF]">
                <input
                  type="checkbox"
                  checked={filteredAddClients.length > 0 && filteredAddClients.every(c => newClientIds.includes(c.id))}
                  onChange={e => setNewClientIds(e.target.checked ? [...new Set([...newClientIds, ...filteredAddClients.map(c => c.id)])] : newClientIds.filter(id => !filteredAddClients.some(c => c.id === id)))}
                  className="w-3.5 h-3.5"
                />
                Chon tat ca ({filteredAddClients.length})
              </label>
              {filteredAddClients.map(c => (
                <label key={c.id} className="flex items-center gap-2 px-2 py-1.5 text-[12px] cursor-pointer hover:bg-[#F5F4EF]">
                  <input
                    type="checkbox"
                    checked={newClientIds.includes(c.id)}
                    onChange={e => setNewClientIds(prev => e.target.checked ? [...prev, c.id] : prev.filter(id => id !== c.id))}
                    className="w-3.5 h-3.5"
                  />
                  {c.name}
                  {(c.archived_at || c.cooperation_status === 'suspended') && (
                    <span className="text-[10px] text-red-400 ml-1">(Da ngung)</span>
                  )}
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
            const rr = calcPnl(p, c, taxOptsFor(p.client_id));
            return (
              <div
                key={p.id}
                onClick={() => setSelId(p.id)}
                className={`px-3 py-2.5 border-b border-[#E8E7E2] border-l-2 cursor-pointer transition hover:bg-white ${p.id === selId ? 'bg-white border-l-[#0F6E56]' : 'border-l-transparent'}`}
              >
                <div className="text-[12px] font-medium text-[#111] truncate">{p.clients?.name || mergedClients.find(x => x.id === p.client_id)?.name || '—'}</div>
                <div className="text-[10px] text-[#999] mb-1">{p.branch_manager || '—'}</div>
                <div className="flex items-center justify-between">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${p.project_type === 'managed' ? 'bg-[#E6F1FB] text-[#0C447C]' : 'bg-[#EAF3DE] text-[#27500A]'}`}>
                    {p.project_type === 'managed' ? 'Nhận lương' : `${p.lg_pct}/${p.cn_pct}`}
                  </span>
                  <span className={`text-[11px] font-medium ${rr.profit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>LN: {fmtTrieu(rr.profit)}</span>
                </div>
                {(p.total_man_days ?? 0) > 0 && (
                  <div className="text-[10px] text-[#888] mt-0.5">{(p.total_man_days ?? 0).toLocaleString('vi-VN')} cong</div>
                )}
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
                <span className="text-[12px] text-[#666]">Truong chi nhanh:</span>
                <select
                  key={selected.id + '-branch'}
                  value={selected.branch_manager || ''}
                  onChange={e => updateField({ branch_manager: e.target.value || null })}
                  className="flex-1 min-w-[160px] text-[12px] px-2.5 py-1.5 border border-gray-300 rounded-lg outline-none focus:border-blue-500 bg-white"
                >
                  <option value="">-- Chon chi nhanh --</option>
                  {branches.map(b => (
                    <option key={b.id} value={b.name}>{b.name}</option>
                  ))}
                </select>
                <span className="text-[12px] text-[#666]">Doanh thu:</span>
                <div className="relative w-[180px]">
                  {(revLines[selected.id]?.length ?? 0) > 0 ? (
                    <div className="text-[12px] px-2.5 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-right font-medium text-[#111]">
                      {selected.revenue.toLocaleString('vi-VN')} <span className="text-[10px] text-[#999]">đ</span>
                    </div>
                  ) : (
                    <>
                      <input
                        key={`rev-${selected.id}`}
                        type="text"
                        defaultValue={selected.revenue ? selected.revenue.toLocaleString('vi-VN') : '0'}
                        onFocus={e => { e.target.value = String(selected.revenue || 0); }}
                        onBlur={e => { const v = +e.target.value.replace(/\D/g, '') || 0; updateField({ revenue: v }); e.target.value = v.toLocaleString('vi-VN'); }}
                        className="w-full text-[12px] px-2.5 py-1.5 pr-6 border border-gray-300 rounded-lg outline-none focus:border-blue-500 text-right"
                      />
                      <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-[#999]">đ</span>
                    </>
                  )}
                </div>
                <span className="text-[12px] text-[#666]">Tong so cong:</span>
                <div className="relative w-[120px]">
                  <input
                    key={`md-${selected.id}`}
                    type="number"
                    defaultValue={selected.total_man_days || 0}
                    onBlur={e => updateField({ total_man_days: +e.target.value || 0 })}
                    className="w-full text-[12px] px-2.5 py-1.5 pr-8 border border-gray-300 rounded-lg outline-none focus:border-blue-500 text-right"
                  />
                  <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-[#999]">cong</span>
                </div>
              </div>
            </div>

            {/* Revenue lines */}
            {(() => {
              const lines = revLines[selected.id] || [];
              const addLine = async () => {
                const { data, error } = await supabase.from('pnl_revenue_lines')
                  .insert({ pnl_id: selected.id, label: 'Hoa don', amount: 0, sort_order: lines.length })
                  .select().single();
                if (error) { toast('Loi: ' + error.message); return; }
                setRevLines(prev => ({ ...prev, [selected.id]: [...(prev[selected.id] || []), data as PnlRevenueLine] }));
              };
              const updateLine = async (lineId: string, fields: Partial<PnlRevenueLine>) => {
                await supabase.from('pnl_revenue_lines').update(fields).eq('id', lineId);
                setRevLines(prev => ({ ...prev, [selected.id]: (prev[selected.id] || []).map(l => l.id === lineId ? { ...l, ...fields } : l) }));
                if ('amount' in fields) {
                  const updated = (revLines[selected.id] || []).map(l => l.id === lineId ? { ...l, ...fields } : l);
                  const total = updated.reduce((s, l) => s + (l.amount || 0), 0);
                  updateField({ revenue: total });
                }
              };
              const deleteLine = async (lineId: string) => {
                await supabase.from('pnl_revenue_lines').delete().eq('id', lineId);
                const updated = (revLines[selected.id] || []).filter(l => l.id !== lineId);
                setRevLines(prev => ({ ...prev, [selected.id]: updated }));
                if (updated.length > 0) updateField({ revenue: updated.reduce((s, l) => s + (l.amount || 0), 0) });
              };
              return (
                <div className="bg-white border border-[#E8E7E2] rounded-xl overflow-hidden">
                  <div className="px-3.5 py-2 border-b border-[#E8E7E2] flex items-center justify-between">
                    <div className="text-[12px] font-medium text-[#111]">Doanh thu chi tiet</div>
                    <div className="flex items-center gap-2">
                      {lines.length > 0 && <span className="text-[11px] text-[#888]">{lines.length} hoa don · Tong: {selected.revenue.toLocaleString('vi-VN')} d</span>}
                      <button onClick={addLine} className="flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-800 font-medium">
                        <Plus size={12} /> Them HD
                      </button>
                    </div>
                  </div>
                  {lines.length > 0 && (
                    <div className="p-3.5">
                      <table className="w-full text-[12px]">
                        <thead>
                          <tr className="text-[10px] text-[#999] uppercase">
                            <th className="text-left font-medium pb-1.5">Ten hoa don</th>
                            <th className="text-right font-medium pb-1.5 w-[160px]">So tien</th>
                            <th className="text-center font-medium pb-1.5 w-[120px]">Ngay XHD</th>
                            <th className="w-[28px]"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {lines.map(l => (
                            <tr key={l.id} className="border-t border-[#F0EEE9]">
                              <td className="py-1.5 pr-2">
                                <input key={`rl-${l.id}`} defaultValue={l.label} onBlur={e => updateLine(l.id, { label: e.target.value })}
                                  className="w-full text-[12px] px-1.5 py-1 border-b border-dashed border-gray-300 outline-none focus:border-blue-500 bg-transparent" />
                              </td>
                              <td className="py-1.5">
                                <div className="relative">
                                  <input key={`ra-${l.id}`} type="text" defaultValue={l.amount ? l.amount.toLocaleString('vi-VN') : '0'}
                                    onFocus={e => { e.target.value = String(l.amount || 0); }}
                                    onBlur={e => { const v = +e.target.value.replace(/\D/g, '') || 0; updateLine(l.id, { amount: v }); e.target.value = v.toLocaleString('vi-VN'); }}
                                    className="w-full text-[12px] px-2 py-1 pr-6 border border-gray-300 rounded-lg outline-none focus:border-blue-500 text-right" />
                                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-[#999]">d</span>
                                </div>
                              </td>
                              <td className="py-1.5 text-center">
                                <input key={`rd-${l.id}`} type="date" defaultValue={l.invoice_date || ''} onChange={e => updateLine(l.id, { invoice_date: e.target.value || null })}
                                  className="text-[11px] px-1.5 py-1 border border-gray-300 rounded-lg outline-none focus:border-blue-500" />
                              </td>
                              <td className="py-1.5 text-center">
                                <button onClick={() => deleteLine(l.id)} className="text-[#bbb] hover:text-red-600 transition"><Trash2 size={13} /></button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })()}

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
            {(() => {
              const groupOf = (label: string): CostGroupType => costCategories.find(cat => cat.label === label)?.group_type ?? 'general';
              const salaryCosts = costs.filter(c => groupOf(c.label) === 'salary');
              const generalCosts = costs.filter(c => groupOf(c.label) !== 'salary');

              const renderRow = (c: ProjectPnlCost) => {
                const isVP = c.label === 'Chi Phí Văn Phòng';
                const vpInfo = isVP && selected ? getZoneVpCost(selected.client_id) : null;
                return (
                  <React.Fragment key={c.id}>
                    <tr className="border-t border-[#F0EEE9]">
                      <td className="py-1.5 pr-2">
                        <select
                          value={c.label}
                          onChange={e => updateCostField(c, { label: e.target.value })}
                          className="w-full text-[12px] px-1.5 py-1 border-b border-dashed border-gray-300 outline-none focus:border-blue-500 bg-transparent"
                        >
                          <option value={c.label}>{c.label}</option>
                          {costCategories.filter(cat => cat.label !== c.label && !costs.some(x => x.label === cat.label)).map(cat => (
                            <option key={cat.id} value={cat.label}>{cat.label}</option>
                          ))}
                        </select>
                      </td>
                      <td className="py-1.5">
                        <div className="relative">
                          <input
                            type="text" defaultValue={c.value ? c.value.toLocaleString('vi-VN') : '0'}
                            onFocus={e => { e.target.value = String(c.value || 0); }}
                            onBlur={e => { const v = +e.target.value.replace(/\D/g, '') || 0; updateCostField(c, { value: v }); e.target.value = v.toLocaleString('vi-VN'); }}
                            className="w-full text-[12px] px-2 py-1 pr-8 border border-gray-300 rounded-lg outline-none focus:border-blue-500 text-right"
                          />
                          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-[#999]">đ</span>
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
                    {isVP && vpInfo && (
                      <tr className="bg-blue-50/50">
                        <td colSpan={4} className="px-3 py-1.5 text-[10px] text-blue-600">
                          Tu tinh: VP "{vpInfo.zoneName}" — Tong CP: {vpInfo.totalCost.toLocaleString('vi-VN')} d
                          (CP co dinh: {vpInfo.fixedCosts.toLocaleString('vi-VN')} + Luong NS: {vpInfo.staffCosts.toLocaleString('vi-VN')})
                          / {vpInfo.projectCount} du an = {vpInfo.amount.toLocaleString('vi-VN')} d/du an
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              };

              const renderTable = (title: string, rows: ProjectPnlCost[], subtotal: number, emptyHint: string, accent: 'salary' | 'general') => {
                const accentCls = accent === 'salary'
                  ? { bar: 'bg-amber-400', badge: 'bg-[#FDF1D6] text-amber-800 border-amber-300', total: 'text-amber-700' }
                  : { bar: 'bg-[#9DB7D8]', badge: 'bg-[#E6F1FB] text-[#0C447C] border-[#B5D4F4]', total: 'text-[#185FA5]' };
                return (
                  <div className={`rounded-lg border ${accent === 'salary' ? 'border-amber-200 bg-[#FFFCF5]' : 'border-[#D8E6F5] bg-[#F8FBFE]'} overflow-hidden`}>
                    <div className={`flex items-center gap-2 px-3 py-2 border-b ${accent === 'salary' ? 'border-amber-200' : 'border-[#D8E6F5]'}`}>
                      <span className={`w-1.5 h-4 rounded-full ${accentCls.bar}`} />
                      <span className={`text-[11.5px] font-semibold px-2 py-0.5 rounded-md border ${accentCls.badge}`}>{title}</span>
                    </div>
                    <div className="px-3 pt-2">
                      {rows.length === 0 ? (
                        <div className="text-[10.5px] text-[#bbb] pb-2">{emptyHint}</div>
                      ) : (
                        <table className="w-full text-[12px] mb-1">
                          <thead>
                            <tr className="text-[10px] text-[#999] uppercase">
                              <th className="text-left font-medium pb-1.5">Khoản chi phí</th>
                              <th className="text-right font-medium pb-1.5 w-[120px]">Giá trị</th>
                              <th className="text-center font-medium pb-1.5 w-[95px]">Bên chi trả</th>
                              <th className="w-[28px]"></th>
                            </tr>
                          </thead>
                          <tbody>{rows.map(renderRow)}</tbody>
                        </table>
                      )}
                      <div className="flex items-center justify-between text-[11px] pt-1.5 pb-2 border-t border-dashed border-gray-300">
                        <span className="text-[#666]">Cộng {title.toLowerCase()}</span>
                        <span className={`font-semibold ${accentCls.total}`}>{fmtTrieu(subtotal)} đ</span>
                      </div>
                    </div>
                  </div>
                );
              };

              return (
                <div className="bg-white border border-[#E8E7E2] rounded-xl overflow-hidden">
                  <div className="px-3.5 py-2.5 border-b border-[#E8E7E2] flex items-center justify-between">
                    <div className="text-[12px] font-medium text-[#111]">Chi phí dự án</div>
                    <div className="flex gap-1.5 text-[10px]">
                      <span className="px-1.5 py-0.5 rounded font-medium bg-[#E6F1FB] text-[#0C447C]">LGV trả</span>
                      <span className="px-1.5 py-0.5 rounded font-medium bg-[#EAF3DE] text-[#27500A]">CN trả</span>
                      <span className="px-1.5 py-0.5 rounded font-medium bg-[#F5F4EF] border border-gray-300 text-[#666]">Chung</span>
                    </div>
                  </div>
                  <div className="p-3.5 space-y-4">
                    {renderTable('Chi phí Lương + BHXH', salaryCosts, r.salaryCost, 'Chưa có khoản lương/BHXH nào — gán nhóm "Lương/BHXH" cho hạng mục trong Quản lý hạng mục.', 'salary')}
                    {renderTable('Chi phí chung', generalCosts, r.generalCost, 'Chưa có khoản chi phí chung nào.', 'general')}
                    <div className="pt-1 flex items-center gap-2">
                      {(() => {
                        const available = costCategories.filter(cat => !costs.some(c => c.label === cat.label));
                        return available.length > 0 ? (
                          <select
                            value=""
                            onChange={e => { if (e.target.value) addCostFromCategory(e.target.value); e.target.value = ''; }}
                            className="flex-1 text-[11px] px-2 py-1.5 border border-gray-300 rounded-lg outline-none text-[#666]"
                          >
                            <option value="">+ Them hang muc chi phi...</option>
                            {available.map(cat => <option key={cat.id} value={cat.label}>{cat.label}</option>)}
                          </select>
                        ) : (
                          <span className="flex-1 text-[10px] text-[#bbb]">Da them tat ca hang muc</span>
                        );
                      })()}
                      <button onClick={() => setCostSettingsOpen(true)} title="Quan ly hang muc chi phi"
                        className="p-1.5 rounded-lg border border-gray-200 text-[#999] hover:text-[#555] hover:border-gray-400 transition">
                        <Settings size={12} />
                      </button>
                    </div>
                  </div>
                  <div className="px-3.5 py-2 bg-[#F5F4EF] border-t border-[#E8E7E2] flex items-center justify-between text-[12px] font-medium">
                    <span>Tổng chi phí</span>
                    <span className="text-red-600">{fmtTrieu(r.tc)} đ</span>
                  </div>
                </div>
              );
            })()}

            {/* Row 4: Result */}
            <div className="bg-white border border-[#E8E7E2] rounded-xl overflow-hidden">
              <div className="px-3.5 py-2.5 border-b border-[#E8E7E2] text-[12px] font-medium text-[#111]">
                Kết quả phân chia
              </div>
              <div className="p-3.5">
                <div className="text-[11px] text-[#666] bg-[#F5F4EF] rounded-lg px-2.5 py-2 mb-2">
                  DT <strong className="text-[#111]">{fmtTrieu(selected.revenue)}</strong>
                  {' − '}Lương/BHXH <strong className="text-red-600">{fmtTrieu(r.salaryCost)}</strong>
                  {' − '}CP chung <strong className="text-red-600">{fmtTrieu(r.generalCost)}</strong>
                  {' = '}LN trước thuế <strong className={r.profit >= 0 ? 'text-emerald-600' : 'text-red-600'}>{fmtTrieu(r.profit)}</strong> đ
                  {(selected.total_man_days ?? 0) > 0 && (
                    <span className="ml-2">· <strong className="text-[#111]">{(selected.total_man_days ?? 0).toLocaleString('vi-VN')}</strong> cong</span>
                  )}
                </div>
                <div className="flex items-center justify-between text-[11px] text-[#666] bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2 mb-3">
                  <span>
                    Thuế TNDN {r.taxExempt ? '(miễn)' : `(${r.taxPct}%)`}: <strong className="text-amber-700">− {fmtTrieu(r.tax)}</strong>
                    {' → '}LN sau thuế <strong className={r.profitAfterTax >= 0 ? 'text-emerald-600' : 'text-red-600'}>{fmtTrieu(r.profitAfterTax)}</strong> đ
                    {selected.project_type === 'shared' ? ` → Chia ${selected.lg_pct}/${selected.cn_pct}` : " → 100% Let's Go VN"}
                  </span>
                  <button onClick={() => setTaxSettingsOpen(true)} title="Cai dat thue TNDN"
                    className="p-1.5 rounded-lg border border-amber-300 text-amber-700 hover:bg-amber-100 transition shrink-0">
                    <Settings size={12} />
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-lg p-3 text-center bg-[#F5F4EF] border border-[#E8E7E2]">
                    <div className="text-[10px] uppercase text-[#999] mb-1">Lợi nhuận sau thuế</div>
                    <div className={`text-[20px] font-medium ${r.profitAfterTax >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{fmtTrieu(r.profitAfterTax)}</div>
                    <div className="text-[10px] text-[#999] mt-0.5">đồng</div>
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
                    Chung <strong>{fmtTrieu(r.shC)}</strong> đ
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {costSettingsOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={e => { if (e.target === e.currentTarget) setCostSettingsOpen(false); }}>
          <div className="bg-white rounded-xl shadow-2xl p-5 w-[400px]">
            <div className="flex items-center justify-between mb-4">
              <div className="text-[13px] font-semibold text-[#111]">Quan ly hang muc chi phi</div>
              <button onClick={() => setCostSettingsOpen(false)} className="text-[#aaa] hover:text-[#666]"><XIcon size={15} /></button>
            </div>
            <div className="text-[10.5px] text-[#888] mb-3">Bat "Mac dinh" de hang muc tu dong hien khi tao PL du an moi</div>
            <div className="space-y-1.5 mb-4 max-h-[300px] overflow-y-auto">
              {costCategories.map(cat => (
                <div key={cat.id} className="flex items-center gap-2 group">
                  {editingCatId === cat.id ? (
                    <>
                      <input autoFocus value={editingCatLabel} onChange={e => setEditingCatLabel(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleRenameCategory(cat.id); if (e.key === 'Escape') setEditingCatId(null); }}
                        className="flex-1 text-[12px] px-2 py-1.5 border border-blue-400 rounded-lg outline-none" />
                      <button onClick={() => handleRenameCategory(cat.id)} className="text-emerald-600 hover:text-emerald-800"><Check size={14} /></button>
                      <button onClick={() => setEditingCatId(null)} className="text-gray-400 hover:text-gray-600"><XIcon size={14} /></button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => onToggleCategoryDefault(cat.id, !cat.is_default)}
                        className={`w-4 h-4 rounded border shrink-0 flex items-center justify-center transition ${cat.is_default ? 'bg-blue-600 border-blue-600 text-white' : 'border-gray-300 hover:border-blue-400'}`}>
                        {cat.is_default && <Check size={10} />}
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="text-[12px] text-[#333] truncate">{cat.label}</div>
                        <div className="flex items-center gap-1 mt-0.5">
                          <select
                            value={cat.group_type ?? 'general'}
                            onChange={e => onSetCategoryGroup(cat.id, e.target.value as CostGroupType)}
                            title="Nhom chi phi"
                            className={`text-[10px] px-1.5 py-0.5 rounded border outline-none ${cat.group_type === 'salary' ? 'bg-[#FDF1D6] border-amber-300 text-amber-800' : 'bg-[#F5F4EF] border-gray-300 text-[#666]'}`}
                          >
                            <option value="general">Chi phí chung</option>
                            <option value="salary">Lương/BHXH</option>
                          </select>
                          <select
                            value={cat.default_payer ?? 'lg'}
                            onChange={e => onSetCategoryPayer(cat.id, e.target.value as CostPayer)}
                            title="Ben chi tra mac dinh"
                            className="text-[10px] px-1.5 py-0.5 rounded border border-gray-300 bg-white outline-none text-[#666]"
                          >
                            {Object.entries(PAYER_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                          </select>
                        </div>
                      </div>
                      <button onClick={() => { setEditingCatId(cat.id); setEditingCatLabel(cat.label); }}
                        className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-blue-600 transition shrink-0"><Pencil size={12} /></button>
                      <button onClick={() => handleDeleteCategory(cat.id)}
                        className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-600 transition shrink-0"><Trash2 size={12} /></button>
                    </>
                  )}
                </div>
              ))}
              {costCategories.length === 0 && <div className="text-[11px] text-[#999] text-center py-3">Chua co hang muc nao</div>}
            </div>
            <div className="flex gap-2">
              <input value={newCatLabel} onChange={e => setNewCatLabel(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleAddCategory(); }}
                placeholder="Ten hang muc moi..."
                className="flex-1 text-[12px] px-2.5 py-1.5 border border-gray-300 rounded-lg outline-none focus:border-blue-500" />
              <button onClick={handleAddCategory} disabled={!newCatLabel.trim()}
                className="px-3 py-1.5 rounded-lg text-[11px] font-medium bg-[#1D4ED8] text-white hover:bg-[#1E40AF] disabled:opacity-40 transition">
                <Plus size={12} />
              </button>
            </div>
          </div>
        </div>
      )}

      {taxSettingsOpen && selected && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={e => { if (e.target === e.currentTarget) setTaxSettingsOpen(false); }}>
          <div className="bg-white rounded-xl shadow-2xl p-5 w-[340px]">
            <div className="flex items-center justify-between mb-4">
              <div className="text-[13px] font-semibold text-[#111]">Cai dat thue TNDN</div>
              <button onClick={() => setTaxSettingsOpen(false)} className="text-[#aaa] hover:text-[#666]"><XIcon size={15} /></button>
            </div>
            <div className="text-[10.5px] text-[#888] mb-3">
              Ap dung cho khach hang <strong>{selected.clients?.name || mergedClients.find(x => x.id === selected.client_id)?.name}</strong> — tinh tren loi nhuan truoc thue cua moi thang.
            </div>
            <label className="flex items-center gap-2 text-[12px] mb-3 cursor-pointer">
              <input type="checkbox" checked={taxExemptInput} onChange={e => setTaxExemptInput(e.target.checked)} className="w-3.5 h-3.5" />
              Mien thue TNDN (0%) cho du an nay
            </label>
            <div className="flex items-center gap-2 mb-4">
              <span className="text-[12px] text-[#666]">Ty le thue:</span>
              <div className="relative w-[90px]">
                <input
                  type="number" min={0} max={100}
                  value={taxPctInput}
                  onChange={e => setTaxPctInput(e.target.value)}
                  disabled={taxExemptInput}
                  className="w-full text-[12px] px-2 py-1.5 pr-6 border border-gray-300 rounded-lg outline-none focus:border-blue-500 text-right disabled:bg-gray-50 disabled:text-gray-400"
                />
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-[#999]">%</span>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={saveTaxSettings} className="flex-1 py-1.5 rounded-lg text-[12px] font-medium bg-[#0F6E56] text-white hover:opacity-90 transition">
                Luu
              </button>
              <button onClick={() => setTaxSettingsOpen(false)} className="px-3 py-1.5 rounded-lg text-[12px] font-medium border border-gray-300 text-[#666] hover:bg-white transition">
                Huy
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
