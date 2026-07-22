import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Plus, Trash2, Settings, X as XIcon, Check, Pencil } from 'lucide-react';
import type { Client, ProjectPnl, ProjectPnlCost, CostPayer, ProjectPnlType, PnlSplitSettings, Branch, CostCategory, CostGroupType, BranchZone, BranchZoneCost, BranchStaff, PnlRevenueLine, PnlInvoiceSettings, ServiceType } from '../../lib/types';
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
  invoiceSettings: Record<string, PnlInvoiceSettings>;
  onSaveInvoiceSettings: (clientId: string, fields: Partial<Omit<PnlInvoiceSettings, 'client_id' | 'updated_at'>>) => Promise<PnlInvoiceSettings>;
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
const PERIOD_LABELS = ['Kỳ 1', 'Kỳ 2', 'Kỳ 3', 'Kỳ 4'];

export default function PnLProjectTab({
  clients, month, projectsPnl, pnlCosts,
  onAddProject, onUpdateProject, onDeleteProject,
  onLoadCosts, onAddCost, onUpdateCost, onDeleteCost,
  splitSettings, onSaveSplitSettings,
  invoiceSettings, onSaveInvoiceSettings,
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
  // Khoán Theo Công: đơn giá vnd/công của tháng đang chọn.
  const [rateInput, setRateInput] = useState('');
  const [rateEditOpen, setRateEditOpen] = useState(false);
  const [pendingRate, setPendingRate] = useState<number | null>(null);
  const [rateSaveAsDefault, setRateSaveAsDefault] = useState(true);
  // HOH: tỷ lệ phân chia riêng cho phần doanh thu HOH (mặc định 100% LGVN).
  const [hohLgInput, setHohLgInput] = useState('100');
  const [hohCnInput, setHohCnInput] = useState('0');

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

  // Nạp trước doanh thu chi tiết của mọi dự án trong tháng — để sidebar hiện được
  // nhãn "GTLĐ: x" ngay khi lướt danh sách, không cần bấm vào từng dự án.
  useEffect(() => {
    for (const p of monthProjects) {
      if (!revLines[p.id]) loadRevLines(p.id).catch(() => {});
    }
  }, [monthProjects, revLines, loadRevLines]);

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
      setRateInput(String(selected.manday_rate || ''));
      setHohLgInput(String(selected.hoh_lg_pct ?? 100));
      setHohCnInput(String(selected.hoh_cn_pct ?? 0));
    }
  }, [selId, selected?.lg_pct, selected?.cn_pct, selected?.manday_rate, selected?.hoh_lg_pct, selected?.hoh_cn_pct]);

  const onHohSplitChange = (side: 'lg' | 'cn', val: string) => {
    const v = Math.min(100, Math.max(0, +val || 0));
    const other = Math.round((100 - v) * 10) / 10;
    if (side === 'lg') { setHohLgInput(val); setHohCnInput(String(other)); }
    else { setHohCnInput(val); setHohLgInput(String(other)); }
  };

  const onHohSplitBlur = () => {
    if (!selected) return;
    const lg = Math.min(100, Math.max(0, +hohLgInput || 0));
    const cn = Math.round((100 - lg) * 10) / 10;
    if (lg === (selected.hoh_lg_pct ?? 100) && cn === (selected.hoh_cn_pct ?? 0)) return;
    guard(
      () => updateField({ hoh_lg_pct: lg, hoh_cn_pct: cn }),
      () => { setHohLgInput(String(selected.hoh_lg_pct ?? 100)); setHohCnInput(String(selected.hoh_cn_pct ?? 0)); }
    );
  };

  const taxOptsFor = useCallback((clientId: string) => {
    const s = splitSettings[clientId];
    return { categories: costCategories, taxPct: s?.tax_pct ?? 20, taxExempt: s?.tax_exempt ?? false };
  }, [splitSettings, costCategories]);

  const invoiceSettingsFor = useCallback((clientId: string): PnlInvoiceSettings => {
    return invoiceSettings[clientId] ?? {
      client_id: clientId, period_count: 3, period_labels: PERIOD_LABELS,
      invoice_label_template: 'Hoa don', invoice_days: [10, 20, 30, 31], updated_at: '',
    };
  }, [invoiceSettings]);

  const periodLabelsFor = useCallback((clientId: string): string[] => {
    const s = invoiceSettingsFor(clientId);
    return Array.from({ length: Math.max(1, s.period_count) }, (_, i) => s.period_labels[i] || `Kỳ ${i + 1}`);
  }, [invoiceSettingsFor]);

  const costs = selId ? (pnlCosts[selId] || []) : [];
  const hohRevenue = selId ? (revLines[selId] || []).filter(l => l.service_type === 'hoh').reduce((s, l) => s + (l.amount || 0), 0) : 0;
  const hasHoh = hohRevenue > 0 || costs.some(c => c.service_type === 'hoh');
  const r = selected ? calcPnl(selected, costs, taxOptsFor(selected.client_id), {
    revenue: hohRevenue, lgPct: selected.hoh_lg_pct ?? 100, cnPct: selected.hoh_cn_pct ?? 0,
  }) : null;

  // Tự dọn dữ liệu chi phí Lương/BHXH ở dự án "Nhiều kỳ":
  // - Dòng chưa gắn kỳ (tạo từ trước khi bật chế độ này) → coi như thuộc kỳ đầu tiên.
  // - Nếu việc đó khiến 2+ dòng cùng hạng mục + cùng kỳ tồn tại song song (vd vừa có dòng cũ
  //   164.199.000 vừa có dòng người dùng tự nhập 50.000.000 cho Kỳ 1) → gộp làm 1, cộng dồn giá trị,
  //   xoá các dòng thừa, tránh cộng dư "Tổng chi phí".
  useEffect(() => {
    if (!selected || selected.invoice_mode !== 'periodic') return;
    const lines = revLines[selected.id] || [];
    if (lines.length === 0) return;
    const firstPeriod = periodLabelsFor(selected.client_id)[0];
    if (!firstPeriod) return;

    const isSalary = (c: ProjectPnlCost) => (costCategories.find(cat => cat.label === c.label)?.group_type ?? 'general') === 'salary';
    const salaryRows = costs.filter(isSalary);

    const groups = new Map<string, ProjectPnlCost[]>();
    for (const c of salaryRows) {
      const period = c.period_label || firstPeriod;
      const key = `${c.label}::${period}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(c);
    }

    const work = [...groups.entries()].filter(([, rows]) => rows.length > 1 || !rows[0].period_label);
    if (work.length === 0) return;

    (async () => {
      for (const [key, rows] of work) {
        const period = key.slice(key.lastIndexOf('::') + 2);
        if (rows.length === 1) {
          try { await onUpdateCost(rows[0].id, { period_label: period }); } catch { /* thử lại ở lần render sau */ }
          continue;
        }
        const keep = rows.find(r => r.period_label === period) ?? rows[0];
        const total = rows.reduce((s, r) => s + (r.value || 0), 0);
        try {
          await onUpdateCost(keep.id, { value: total, period_label: period });
          for (const r of rows) {
            if (r.id !== keep.id) await onDeleteCost(r.id, selected.id);
          }
        } catch { /* thử lại ở lần render sau */ }
      }
      toast('Đã tự gộp các dòng chi phí lương bị trùng kỳ/hạng mục');
    })();
  }, [selected, costs, revLines, costCategories, periodLabelsFor, onUpdateCost, onDeleteCost, toast]);

  // Dự án đã có lợi nhuận TỪ TRƯỚC khi mở lên (chốt ở lần truy cập trước) — mọi chỉnh sửa
  // trong phiên này phải xác nhận trước khi lưu, tránh sửa nhầm số liệu đã chốt.
  // Chỉ chốt trạng thái khoá MỘT LẦN khi chọn dự án, không tính lại theo từng phím gõ —
  // để nhập liệu lần đầu (revenue → công → chi phí...) không tự khoá lẫn nhau giữa các trường.
  const pnlCostsRef = useRef(pnlCosts);
  pnlCostsRef.current = pnlCosts;
  const [lockedSnapshot, setLockedSnapshot] = useState(false);
  useEffect(() => {
    if (!selected) { setLockedSnapshot(false); return; }
    const c = pnlCostsRef.current[selected.id] || [];
    const rr = calcPnl(selected, c, taxOptsFor(selected.client_id));
    setLockedSnapshot(rr.profit !== 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selId]);

  const [confirmAction, setConfirmAction] = useState<{ run: () => void; revert?: () => void } | null>(null);
  const guard = (run: () => void, revert?: () => void) => {
    if (lockedSnapshot) setConfirmAction({ run, revert });
    else run();
  };

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

        // Khoán Theo Công: kế thừa loại + đơn giá từ tháng trước (trừ khi chi nhánh
        // đã chuyển thành chi nhánh công ty — 'company' giữ ưu tiên managed).
        let mandayRate = settings?.manday_rate ?? 0;
        if (branchKhoan?.type !== 'company' && prevEntry?.project_type === 'per_manday') {
          clientProjectType = 'per_manday';
          mandayRate = prevEntry.manday_rate || mandayRate;
        }

        const created = await onAddProject({
          client_id: clientId,
          month,
          branch_manager: prevEntry?.branch_manager || getBranchForMonth(allBranchHistory.filter(h => h.client_id === clientId), month) || client?.region || null,
          project_type: clientProjectType,
          lg_pct: lgPct,
          cn_pct: cnPct,
          revenue: 0,
          total_man_days: 0,
          manday_rate: mandayRate,
          created_by: currentUser || null,
          split_temp_until: splitTempUntil,
          split_reverted: splitReverted,
          invoice_mode: 'single',
        });

        if (prevCosts.length > 0) {
          for (let i = 0; i < prevCosts.length; i++) {
            await onAddCost({ pnl_id: created.id, label: prevCosts[i].label, value: 0, payer: prevCosts[i].payer, sort_order: i, period_label: null });
          }
        } else {
          const defaults = costCategories.filter(c => c.is_default);
          for (let i = 0; i < defaults.length; i++) {
            await onAddCost({ pnl_id: created.id, label: defaults[i].label, value: 0, payer: defaults[i].default_payer ?? 'ch', sort_order: i, period_label: null });
          }
          if (!defaults.length) {
            await onAddCost({ pnl_id: created.id, label: 'Chi phi moi', value: 0, payer: 'ch', sort_order: 0, period_label: null });
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

  // Khoán Theo Công: blur ô đơn giá → hỏi lưu làm mặc định KH hay chỉ tháng này.
  const onRateBlur = () => {
    if (!selected) return;
    const rate = Math.max(0, Math.round(+rateInput || 0));
    if (rate === (selected.manday_rate || 0)) return;
    setPendingRate(rate);
    setRateSaveAsDefault(true);
    setRateEditOpen(true);
  };

  const applyRateEdit = async () => {
    if (!selected || pendingRate === null) return;
    try {
      await onUpdateProject(selected.id, { manday_rate: pendingRate });
      if (rateSaveAsDefault) {
        await onSaveSplitSettings(selected.client_id, { manday_rate: pendingRate });
        toast('Đã lưu đơn giá khoán làm mặc định cho khách hàng');
      } else {
        toast('Đã áp dụng đơn giá cho riêng tháng này');
      }
    } catch (e) {
      toast('Lỗi: ' + (e instanceof Error ? e.message : String(e)));
    }
    setPendingRate(null);
    setRateEditOpen(false);
  };

  const cancelRateEdit = () => {
    if (selected) setRateInput(String(selected.manday_rate || ''));
    setPendingRate(null);
    setRateEditOpen(false);
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

  const [newCostPeriod, setNewCostPeriod] = useState('Kỳ 1');
  const [costSettingsOpen, setCostSettingsOpen] = useState(false);
  const [invoiceSettingsOpen, setInvoiceSettingsOpen] = useState(false);
  const [invSettingsForm, setInvSettingsForm] = useState<{ periodCount: number; periodLabels: string[]; invoiceLabel: string; invoiceDays: number[] }>({
    periodCount: 3, periodLabels: ['Kỳ 1', 'Kỳ 2', 'Kỳ 3', 'Kỳ 4'], invoiceLabel: 'Hoa don', invoiceDays: [10, 20, 30, 31],
  });

  useEffect(() => {
    if (!selected || !invoiceSettingsOpen) return;
    const s = invoiceSettingsFor(selected.client_id);
    setInvSettingsForm({
      periodCount: s.period_count,
      periodLabels: Array.from({ length: 4 }, (_, i) => s.period_labels[i] || `Kỳ ${i + 1}`),
      invoiceLabel: s.invoice_label_template,
      invoiceDays: Array.from({ length: 4 }, (_, i) => s.invoice_days[i] || [10, 20, 30, 31][i]),
    });
  }, [selected, invoiceSettingsOpen, invoiceSettingsFor]);

  const saveInvoiceSettingsForm = async () => {
    if (!selected) return;
    try {
      await onSaveInvoiceSettings(selected.client_id, {
        period_count: Math.min(4, Math.max(1, invSettingsForm.periodCount)),
        period_labels: invSettingsForm.periodLabels,
        invoice_label_template: invSettingsForm.invoiceLabel.trim() || 'Hoa don',
        invoice_days: invSettingsForm.invoiceDays,
      });
      toast('Đã lưu cài đặt — áp dụng cho các tháng sau của dự án này');
      setInvoiceSettingsOpen(false);
    } catch (e) { toast('Lỗi: ' + (e instanceof Error ? e.message : String(e))); }
  };
  const [newCatLabel, setNewCatLabel] = useState('');
  const [editingCatId, setEditingCatId] = useState<string | null>(null);
  const [editingCatLabel, setEditingCatLabel] = useState('');

  const addCostFromCategory = async (catLabel: string, periodLabel: string | null = null) => {
    if (!selected) return;
    const isPeriodic = selected.invoice_mode === 'periodic';
    if (periodLabel) {
      if (costs.some(c => c.label === catLabel && c.period_label === periodLabel)) { toast('Hang muc nay da co trong ky nay'); return; }
    } else if (costs.some(c => c.label === catLabel)) { toast('Hang muc nay da co'); return; }
    const defaultPayer = costCategories.find(cat => cat.label === catLabel)?.default_payer ?? 'lg';
    try {
      await onAddCost({ pnl_id: selected.id, label: catLabel, value: 0, payer: defaultPayer, sort_order: costs.length, period_label: periodLabel });
      if (!isPeriodic) {
        for (const p of monthProjects) {
          if (p.id === selected.id) continue;
          const existing = pnlCosts[p.id] || [];
          if (!existing.some(c => c.label === catLabel)) {
            await onAddCost({ pnl_id: p.id, label: catLabel, value: 0, payer: defaultPayer, sort_order: existing.length, period_label: null });
          }
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
            const gtldRevenue = (revLines[p.id] || []).filter(l => l.service_type === 'recruitment').reduce((s, l) => s + (l.amount || 0), 0);
            const hohLineRevenue = (revLines[p.id] || []).filter(l => l.service_type === 'hoh').reduce((s, l) => s + (l.amount || 0), 0);
            return (
              <div
                key={p.id}
                onClick={() => setSelId(p.id)}
                className={`px-3 py-2.5 border-b border-[#E8E7E2] border-l-2 cursor-pointer transition hover:bg-white ${p.id === selId ? 'bg-white border-l-[#0F6E56]' : 'border-l-transparent'}`}
              >
                <div className="text-[12px] font-medium text-[#111] truncate">{p.clients?.name || mergedClients.find(x => x.id === p.client_id)?.name || '—'}</div>
                <div className="text-[10px] text-[#999] mb-1">{p.branch_manager || '—'}</div>
                <div className="flex items-start justify-between">
                  <div className="flex flex-col gap-0.5">
                    <span className={`w-fit text-[10px] px-1.5 py-0.5 rounded font-medium ${p.project_type === 'managed' ? 'bg-[#E6F1FB] text-[#0C447C]' : p.project_type === 'per_manday' ? 'bg-[#FFF3E0] text-[#9A4E00]' : 'bg-[#EAF3DE] text-[#27500A]'}`}>
                      {p.project_type === 'managed' ? 'Nhận lương' : p.project_type === 'per_manday' ? `${(p.manday_rate || 0).toLocaleString('vi-VN')}đ/công` : `${p.lg_pct}/${p.cn_pct}`}
                    </span>
                    {(p.total_man_days ?? 0) > 0 && (
                      <div className="text-[10px] text-[#888]">{(p.total_man_days ?? 0).toLocaleString('vi-VN')} cong</div>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-0.5">
                    <span className={`text-[11px] font-medium ${rr.profit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>LN: {fmtTrieu(rr.profit)}</span>
                    {gtldRevenue > 0 && (
                      <span className="text-[10px] text-purple-500">GTLĐ: {fmtTrieu(gtldRevenue)}</span>
                    )}
                    {hohLineRevenue > 0 && (
                      <span className="text-[10px] text-sky-500">HOH: {fmtTrieu(hohLineRevenue)}</span>
                    )}
                  </div>
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
                <span className={`text-[10px] px-2 py-1 rounded font-medium ${selected.project_type === 'managed' ? 'bg-[#E6F1FB] text-[#0C447C]' : selected.project_type === 'per_manday' ? 'bg-[#FFF3E0] text-[#9A4E00]' : 'bg-[#EAF3DE] text-[#27500A]'}`}>
                  {selected.project_type === 'managed' ? 'Không Khoán - Nhận Lương' : selected.project_type === 'per_manday' ? 'Khoán Theo Công' : 'Đã Nhận Khoán'}
                </span>
                <div className="flex border border-gray-300 rounded-lg overflow-hidden text-[10px] font-medium shrink-0">
                  <button
                    onClick={() => guard(() => updateField({ invoice_mode: 'single' }))}
                    title="Xuất 1 hoá đơn cho cả tháng"
                    className={`px-2 py-1 transition ${selected.invoice_mode !== 'periodic' ? 'bg-[#F5F4EF] text-[#111]' : 'text-[#999] hover:text-[#555]'}`}
                  >
                    1 hoá đơn
                  </button>
                  <button
                    onClick={() => guard(() => updateField({ invoice_mode: 'periodic' }))}
                    title="Xuất nhiều hoá đơn theo kỳ trong tháng (vd: chốt công 10 ngày/lần)"
                    className={`px-2 py-1 transition border-l border-gray-300 ${selected.invoice_mode === 'periodic' ? 'bg-[#F5F4EF] text-[#111]' : 'text-[#999] hover:text-[#555]'}`}
                  >
                    Nhiều kỳ
                  </button>
                </div>
                <button onClick={() => handleDelete(selected.id)} className="text-red-600 hover:bg-red-50 rounded-md p-1.5 transition">
                  <Trash2 size={14} />
                </button>
              </div>
              <div className="p-3.5 flex items-center gap-3 flex-wrap">
                <span className="text-[12px] text-[#666]">Truong chi nhanh:</span>
                <select
                  key={selected.id + '-branch'}
                  value={selected.branch_manager || ''}
                  onChange={e => { const v = e.target.value || null; guard(() => updateField({ branch_manager: v })); }}
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
                        onBlur={e => {
                          const target = e.target;
                          const v = +target.value.replace(/\D/g, '') || 0;
                          guard(
                            () => { updateField({ revenue: v }); target.value = v.toLocaleString('vi-VN'); },
                            () => { target.value = (selected.revenue || 0).toLocaleString('vi-VN'); }
                          );
                        }}
                        className="w-full text-[12px] px-2.5 py-1.5 pr-6 border border-gray-300 rounded-lg outline-none focus:border-blue-500 text-right"
                      />
                      <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-[#999]">đ</span>
                    </>
                  )}
                </div>
                <span className="text-[12px] text-[#666]">Tong so cong:</span>
                <div className="relative w-[120px]">
                  {(revLines[selected.id]?.length ?? 0) > 0 ? (
                    <div className="text-[12px] px-2.5 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-right font-medium text-[#111]">
                      {(selected.total_man_days || 0).toLocaleString('vi-VN')} <span className="text-[10px] text-[#999]">cong</span>
                    </div>
                  ) : (
                    <>
                      <input
                        key={`md-${selected.id}`}
                        type="number"
                        defaultValue={selected.total_man_days || 0}
                        onBlur={e => {
                          const target = e.target;
                          const v = +target.value || 0;
                          guard(
                            () => updateField({ total_man_days: v }),
                            () => { target.value = String(selected.total_man_days || 0); }
                          );
                        }}
                        className="w-full text-[12px] px-2.5 py-1.5 pr-8 border border-gray-300 rounded-lg outline-none focus:border-blue-500 text-right"
                      />
                      <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-[#999]">cong</span>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Revenue lines */}
            {(() => {
              const lines = revLines[selected.id] || [];
              const isPeriodic = selected.invoice_mode === 'periodic';
              const settings = invoiceSettingsFor(selected.client_id);
              const periodLabels = periodLabelsFor(selected.client_id);
              const addLine = async (serviceType: ServiceType = 'leasing') => {
                let currentLines = lines;
                // Dòng đầu tiên của dự án: nếu doanh thu/công đã được nhập trực tiếp (chưa tách hoá đơn)
                // → giữ lại thành 1 dòng "Cho thuê lao động" trước, để khi thêm dòng mới (vd GTLD) sẽ
                // CỘNG DỒN vào doanh thu hiện có thay vì bị dòng mới (giá trị 0) ghi đè mất.
                if (currentLines.length === 0 && ((selected.revenue || 0) > 0 || (selected.total_man_days || 0) > 0)) {
                  const { data: preserved, error: perr } = await supabase.from('pnl_revenue_lines')
                    .insert({
                      pnl_id: selected.id, label: 'Cho thuê lao động', amount: selected.revenue || 0, man_days: selected.total_man_days || 0,
                      sort_order: 0, period_label: isPeriodic ? periodLabels[0] : null, invoice_date: null, service_type: 'leasing',
                    })
                    .select().single();
                  if (perr) { toast('Loi: ' + perr.message); return; }
                  const preservedLine = preserved as PnlRevenueLine;
                  setRevLines(prev => ({ ...prev, [selected.id]: [preservedLine] }));
                  currentLines = [preservedLine];
                }

                const periodIndex = Math.min(currentLines.length, periodLabels.length - 1);
                const periodLabel = isPeriodic ? periodLabels[periodIndex] : null;
                const invoiceDate = isPeriodic && settings.invoice_days[periodIndex]
                  ? `${month}-${String(Math.min(settings.invoice_days[periodIndex], 28)).padStart(2, '0')}`
                  : null;
                const label = serviceType === 'recruitment' ? 'Giới thiệu lao động' : serviceType === 'hoh' ? 'HOH' : (settings.invoice_label_template || 'Hoa don');
                const { data, error } = await supabase.from('pnl_revenue_lines')
                  .insert({ pnl_id: selected.id, label, amount: 0, sort_order: currentLines.length, period_label: periodLabel, invoice_date: invoiceDate, service_type: serviceType })
                  .select().single();
                if (error) { toast('Loi: ' + error.message); return; }
                setRevLines(prev => ({ ...prev, [selected.id]: [...(prev[selected.id] || []), data as PnlRevenueLine] }));

                if (periodLabel) {
                  const salaryRows = costs.filter(c => (costCategories.find(cat => cat.label === c.label)?.group_type ?? 'general') === 'salary');
                  const unassigned = salaryRows.filter(c => !c.period_label);
                  if (currentLines.length === 0 && unassigned.length > 0) {
                    // Kỳ đầu tiên — gắn các dòng chi phí lương chưa thuộc kỳ nào vào kỳ này, không tạo dòng mới trùng lặp.
                    for (const c of unassigned) {
                      try { await onUpdateCost(c.id, { period_label: periodLabel }); }
                      catch (e) { toast('Loi: ' + (e instanceof Error ? e.message : String(e))); }
                    }
                  } else {
                    const knownLabels = [...new Set(salaryRows.map(c => c.label))];
                    const templates = knownLabels.length > 0
                      ? knownLabels.map(label => ({ label, payer: salaryRows.find(c => c.label === label)?.payer ?? 'ch' }))
                      : costCategories.filter(cat => cat.group_type === 'salary').map(cat => ({ label: cat.label, payer: cat.default_payer ?? 'ch' }));
                    for (let i = 0; i < templates.length; i++) {
                      const t = templates[i];
                      if (costs.some(c => c.label === t.label && c.period_label === periodLabel)) continue;
                      try {
                        await onAddCost({ pnl_id: selected.id, label: t.label, value: 0, payer: t.payer, sort_order: costs.length + i, period_label: periodLabel });
                      } catch (e) { toast('Loi: ' + (e instanceof Error ? e.message : String(e))); }
                    }
                  }
                }
              };
              const updateLine = async (lineId: string, fields: Partial<PnlRevenueLine>) => {
                await supabase.from('pnl_revenue_lines').update(fields).eq('id', lineId);
                setRevLines(prev => ({ ...prev, [selected.id]: (prev[selected.id] || []).map(l => l.id === lineId ? { ...l, ...fields } : l) }));
                const updated = (revLines[selected.id] || []).map(l => l.id === lineId ? { ...l, ...fields } : l);
                if ('amount' in fields) {
                  const total = updated.reduce((s, l) => s + (l.amount || 0), 0);
                  updateField({ revenue: total });
                }
                if ('man_days' in fields) {
                  const totalDays = updated.reduce((s, l) => s + (l.man_days || 0), 0);
                  updateField({ total_man_days: totalDays });
                }
              };
              const deleteLine = async (lineId: string) => {
                await supabase.from('pnl_revenue_lines').delete().eq('id', lineId);
                const updated = (revLines[selected.id] || []).filter(l => l.id !== lineId);
                setRevLines(prev => ({ ...prev, [selected.id]: updated }));
                if (updated.length > 0) {
                  updateField({
                    revenue: updated.reduce((s, l) => s + (l.amount || 0), 0),
                    total_man_days: updated.reduce((s, l) => s + (l.man_days || 0), 0),
                  });
                }
              };
              return (
                <div className="bg-white border border-[#E8E7E2] rounded-xl overflow-hidden">
                  <div className="px-3.5 py-2 border-b border-[#E8E7E2] flex items-center justify-between">
                    <div className="text-[12px] font-medium text-[#111]">Doanh thu chi tiet</div>
                    <div className="flex items-center gap-2">
                      {lines.length > 0 && <span className="text-[11px] text-[#888]">{lines.length} hoa don · Tong: {selected.revenue.toLocaleString('vi-VN')} d · {(selected.total_man_days || 0).toLocaleString('vi-VN')} cong</span>}
                      {isPeriodic && (
                        <button onClick={() => setInvoiceSettingsOpen(true)} title="Cai dat ky / ten hoa don mac dinh"
                          className="p-1 rounded-md border border-gray-200 text-[#999] hover:text-[#555] hover:border-gray-400 transition">
                          <Settings size={12} />
                        </button>
                      )}
                      <button onClick={() => addLine()} className="flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-800 font-medium">
                        <Plus size={12} /> Them HD
                      </button>
                      <button onClick={() => addLine('recruitment')} title="Thêm dòng doanh thu Giới thiệu Lao động (GTLD) — dịch vụ phụ, ít khi dùng"
                        className="flex items-center gap-1 text-[10px] text-[#bbb] hover:text-purple-600 font-medium">
                        <Plus size={10} /> GTLD
                      </button>
                      <button onClick={() => addLine('hoh')} title="Thêm dòng doanh thu HOH (xuất hộ khách hàng, lấy phí) — dịch vụ phụ, ít khi dùng"
                        className="flex items-center gap-1 text-[10px] text-[#bbb] hover:text-sky-600 font-medium">
                        <Plus size={10} /> HOH
                      </button>
                    </div>
                  </div>
                  {lines.length > 0 && (
                    <div className="p-3.5">
                      <div className="overflow-x-auto">
                      <table className="w-full text-[12px]">
                        <thead>
                          <tr className="text-[10px] text-[#999] uppercase">
                            {isPeriodic && <th className="text-left font-medium pb-1.5 w-[90px]">Kỳ</th>}
                            <th className="text-left font-medium pb-1.5">Ten hoa don</th>
                            <th className="text-right font-medium pb-1.5 w-[160px]">So tien</th>
                            <th className="text-right font-medium pb-1.5 w-[90px]">So cong</th>
                            <th className="text-center font-medium pb-1.5 w-[120px]">Ngay XHD</th>
                            <th className="w-[28px]"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {lines.map(l => (
                            <tr key={l.id} className="border-t border-[#F0EEE9]">
                              {isPeriodic && (
                                <td className="py-1.5 pr-2">
                                  <select
                                    value={l.period_label || ''}
                                    onChange={e => { const v = e.target.value || null; guard(() => updateLine(l.id, { period_label: v })); }}
                                    className="w-full text-[12px] px-1.5 py-1 border border-gray-300 rounded-lg outline-none focus:border-blue-500"
                                  >
                                    <option value="">-- Chọn kỳ --</option>
                                    {periodLabels.map(p => <option key={p} value={p}>{p}</option>)}
                                  </select>
                                </td>
                              )}
                              <td className="py-1.5 pr-2">
                                <div className="flex items-center gap-1">
                                  {l.service_type === 'recruitment' && (
                                    <span title="Giới thiệu Lao động" className="shrink-0 text-[9px] px-1 py-0.5 rounded bg-purple-50 text-purple-500 border border-purple-200">GTLD</span>
                                  )}
                                  {l.service_type === 'hoh' && (
                                    <span title="HOH — xuất hộ khách hàng" className="shrink-0 text-[9px] px-1 py-0.5 rounded bg-sky-50 text-sky-600 border border-sky-200">HOH</span>
                                  )}
                                  <input key={`rl-${l.id}`} defaultValue={l.label} onBlur={e => {
                                      const target = e.target; const v = target.value;
                                      guard(() => updateLine(l.id, { label: v }), () => { target.value = l.label; });
                                    }}
                                    className="w-full text-[12px] px-1.5 py-1 border-b border-dashed border-gray-300 outline-none focus:border-blue-500 bg-transparent" />
                                </div>
                              </td>
                              <td className="py-1.5">
                                <div className="relative">
                                  <input key={`ra-${l.id}`} type="text" defaultValue={l.amount ? l.amount.toLocaleString('vi-VN') : '0'}
                                    onFocus={e => { e.target.value = String(l.amount || 0); }}
                                    onBlur={e => {
                                      const target = e.target;
                                      const v = +target.value.replace(/\D/g, '') || 0;
                                      guard(
                                        () => { updateLine(l.id, { amount: v }); target.value = v.toLocaleString('vi-VN'); },
                                        () => { target.value = (l.amount || 0).toLocaleString('vi-VN'); }
                                      );
                                    }}
                                    className="w-full text-[12px] px-2 py-1 pr-6 border border-gray-300 rounded-lg outline-none focus:border-blue-500 text-right" />
                                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-[#999]">d</span>
                                </div>
                              </td>
                              <td className="py-1.5">
                                <input key={`rm-${l.id}`} type="number" defaultValue={l.man_days || 0}
                                  onBlur={e => {
                                    const target = e.target;
                                    const v = +target.value || 0;
                                    guard(
                                      () => updateLine(l.id, { man_days: v }),
                                      () => { target.value = String(l.man_days || 0); }
                                    );
                                  }}
                                  className="w-full text-[12px] px-2 py-1 border border-gray-300 rounded-lg outline-none focus:border-blue-500 text-right" />
                              </td>
                              <td className="py-1.5 text-center">
                                <input key={`rd-${l.id}`} type="date" defaultValue={l.invoice_date || ''} onChange={e => {
                                    const target = e.target; const v = target.value || null;
                                    guard(() => updateLine(l.id, { invoice_date: v }), () => { target.value = l.invoice_date || ''; });
                                  }}
                                  className="text-[11px] px-1.5 py-1 border border-gray-300 rounded-lg outline-none focus:border-blue-500" />
                              </td>
                              <td className="py-1.5 text-center">
                                <button onClick={() => guard(() => deleteLine(l.id))} className="text-[#bbb] hover:text-red-600 transition"><Trash2 size={13} /></button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      </div>
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
                    onClick={() => guard(() => updateField({ project_type: 'managed' as ProjectPnlType }))}
                    className={`flex-1 py-1.5 text-[11.5px] font-medium transition ${selected.project_type === 'managed' ? 'bg-[#F5F4EF] text-[#111]' : 'text-[#999] hover:text-[#555]'}`}
                  >
                    Không Khoán - Nhận Lương
                  </button>
                  <button
                    onClick={() => guard(() => updateField({ project_type: 'shared' as ProjectPnlType }))}
                    className={`flex-1 py-1.5 text-[11.5px] font-medium transition border-l border-gray-300 ${selected.project_type === 'shared' ? 'bg-[#F5F4EF] text-[#111]' : 'text-[#999] hover:text-[#555]'}`}
                  >
                    Đã Nhận Khoán
                  </button>
                  <button
                    onClick={() => guard(() => updateField({
                      project_type: 'per_manday' as ProjectPnlType,
                      manday_rate: selected.manday_rate || splitSettings[selected.client_id]?.manday_rate || 0,
                    }))}
                    className={`flex-1 py-1.5 text-[11.5px] font-medium transition border-l border-gray-300 ${selected.project_type === 'per_manday' ? 'bg-[#F5F4EF] text-[#111]' : 'text-[#999] hover:text-[#555]'}`}
                  >
                    Khoán Theo Công
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
                ) : selected.project_type === 'per_manday' ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <span className="text-[12px] text-[#666]">Đơn giá khoán:</span>
                      <div className="relative w-[130px]">
                        <input
                          type="number" min={0} step={1000}
                          value={rateInput}
                          onChange={e => setRateInput(e.target.value)}
                          onBlur={onRateBlur}
                          placeholder="35000"
                          className="w-full text-[12px] px-2 py-1.5 pr-12 border border-gray-300 rounded-lg outline-none focus:border-blue-500 text-right"
                        />
                        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-[#999]">đ/công</span>
                      </div>
                      <span className="text-[12px] text-[#666]">
                        × <strong className="text-[#111]">{(selected.total_man_days ?? 0).toLocaleString('vi-VN')}</strong> công
                        {' = '}
                        <strong className="text-emerald-700">{fmtTrieu((selected.manday_rate || 0) * (selected.total_man_days || 0))}</strong> đ cho chi nhánh
                      </span>
                    </div>
                    <div className="text-[11px] text-[#999]">
                      Chi nhánh nhận đơn giá × tổng số công (đảm bảo đủ kể cả khi dự án lỗ). Let's Go VN nhận phần LN sau thuế còn lại.
                    </div>
                    {(selected.total_man_days ?? 0) === 0 && (
                      <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 inline-block">
                        ⚠ Chưa nhập "Tổng số công" — tiền khoán chi nhánh đang là 0. Nhập số công ở ô trên header dự án.
                      </div>
                    )}

                    {rateEditOpen && pendingRate !== null && (
                      <div className="border border-gray-200 rounded-lg p-3 space-y-2.5 max-w-[420px] bg-[#FAFAF8]">
                        <div className="text-[12px] font-medium text-[#111]">
                          Đơn giá {pendingRate.toLocaleString('vi-VN')} đ/công. Áp dụng như thế nào?
                        </div>
                        <label className="flex items-center gap-2 text-[12px] cursor-pointer">
                          <input type="radio" checked={rateSaveAsDefault} onChange={() => setRateSaveAsDefault(true)} />
                          Lưu làm đơn giá mặc định của khách hàng — các tháng sau tự dùng
                        </label>
                        <label className="flex items-center gap-2 text-[12px] cursor-pointer">
                          <input type="radio" checked={!rateSaveAsDefault} onChange={() => setRateSaveAsDefault(false)} />
                          Chỉ áp dụng riêng tháng này
                        </label>
                        <div className="flex gap-2">
                          <button onClick={applyRateEdit} className="px-3 py-1.5 rounded-lg text-[12px] font-medium bg-[#0F6E56] text-white hover:opacity-90 transition">
                            Áp dụng
                          </button>
                          <button onClick={cancelRateEdit} className="px-3 py-1.5 rounded-lg text-[12px] font-medium border border-gray-300 text-[#666] hover:bg-white transition">
                            Hủy
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-[12px] text-[#666]">LGV trả toàn bộ chi phí &amp; nhận 100% LN. Chi nhánh nhận lương cố định.</div>
                )}
                {hasHoh && (
                  <div className="border border-sky-200 bg-sky-50/40 rounded-lg p-2.5 flex items-center gap-2.5 flex-wrap">
                    <span className="text-[11px] text-sky-700 font-medium shrink-0">Phân chia HOH:</span>
                    <span className="text-[11px] text-[#666]">Let's Go VN:</span>
                    <div className="relative w-[70px]">
                      <input
                        type="number" min={0} max={100}
                        value={hohLgInput}
                        onChange={e => onHohSplitChange('lg', e.target.value)}
                        onBlur={onHohSplitBlur}
                        className="w-full text-[12px] px-2 py-1 pr-5 border border-gray-300 rounded-lg outline-none focus:border-sky-500 text-right bg-white"
                      />
                      <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-[#999]">%</span>
                    </div>
                    <span className="text-[11px] text-[#666]">Chi nhánh:</span>
                    <div className="relative w-[70px]">
                      <input
                        type="number" min={0} max={100}
                        value={hohCnInput}
                        onChange={e => onHohSplitChange('cn', e.target.value)}
                        onBlur={onHohSplitBlur}
                        className="w-full text-[12px] px-2 py-1 pr-5 border border-gray-300 rounded-lg outline-none focus:border-sky-500 text-right bg-white"
                      />
                      <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-[#999]">%</span>
                    </div>
                    <span className="text-[10px] text-sky-700">— riêng cho phần doanh thu HOH, mặc định 100% Let's Go VN</span>
                  </div>
                )}
              </div>
            </div>

            {/* Row 3: Costs */}
            {(() => {
              const isPeriodic = selected.invoice_mode === 'periodic';
              const periodOptions = periodLabelsFor(selected.client_id);
              const selectedNewCostPeriod = periodOptions.includes(newCostPeriod) ? newCostPeriod : periodOptions[0];
              const groupOf = (label: string): CostGroupType => costCategories.find(cat => cat.label === label)?.group_type ?? 'general';
              const isReferral = (c: ProjectPnlCost) => c.service_type === 'recruitment';
              const isHoh = (c: ProjectPnlCost) => c.service_type === 'hoh';
              const salaryCosts = costs.filter(c => groupOf(c.label) === 'salary' && !isReferral(c) && !isHoh(c));
              const generalCosts = costs.filter(c => groupOf(c.label) !== 'salary' && !isReferral(c) && !isHoh(c));
              const referralCosts = costs.filter(isReferral);
              const hohCosts = costs.filter(isHoh);
              const addReferralCost = async () => {
                if (!selected) return;
                try {
                  await onAddCost({ pnl_id: selected.id, label: 'Chi phí Giới thiệu Lao động', value: 0, payer: 'lg', sort_order: costs.length, period_label: null, service_type: 'recruitment' });
                } catch (e) { toast('Loi: ' + (e instanceof Error ? e.message : String(e))); }
              };
              const addHohCost = async () => {
                if (!selected) return;
                try {
                  await onAddCost({ pnl_id: selected.id, label: 'Chi phí HOH', value: 0, payer: 'lg', sort_order: costs.length, period_label: null, service_type: 'hoh' });
                } catch (e) { toast('Loi: ' + (e instanceof Error ? e.message : String(e))); }
              };

              const renderRow = (c: ProjectPnlCost, showPeriod: boolean) => {
                const isVP = c.label === 'Chi Phí Văn Phòng';
                const vpInfo = isVP && selected ? getZoneVpCost(selected.client_id) : null;
                return (
                  <React.Fragment key={c.id}>
                    <tr className="border-t border-[#F0EEE9]">
                      {showPeriod && (
                        <td className="py-1.5 pr-2">
                          <select
                            value={c.period_label || ''}
                            onChange={e => { const v = e.target.value || null; guard(() => updateCostField(c, { period_label: v })); }}
                            className="w-full text-[12px] px-1.5 py-1 border border-gray-300 rounded-lg outline-none focus:border-blue-500"
                          >
                            <option value="">-- Chọn kỳ --</option>
                            {periodOptions.map(p => <option key={p} value={p}>{p}</option>)}
                          </select>
                        </td>
                      )}
                      <td className="py-1.5 pr-2">
                        <select
                          value={c.label}
                          onChange={e => { const v = e.target.value; guard(() => updateCostField(c, { label: v })); }}
                          className="w-full text-[12px] px-1.5 py-1 border-b border-dashed border-gray-300 outline-none focus:border-blue-500 bg-transparent"
                        >
                          <option value={c.label}>{c.label}</option>
                          {costCategories.filter(cat => cat.label !== c.label && (showPeriod || !costs.some(x => x.label === cat.label))).map(cat => (
                            <option key={cat.id} value={cat.label}>{cat.label}</option>
                          ))}
                        </select>
                      </td>
                      <td className="py-1.5">
                        <div className="relative">
                          <input
                            type="text" defaultValue={c.value ? c.value.toLocaleString('vi-VN') : '0'}
                            onFocus={e => { e.target.value = String(c.value || 0); }}
                            onBlur={e => {
                              const target = e.target;
                              const v = +target.value.replace(/\D/g, '') || 0;
                              guard(
                                () => { updateCostField(c, { value: v }); target.value = v.toLocaleString('vi-VN'); },
                                () => { target.value = (c.value || 0).toLocaleString('vi-VN'); }
                              );
                            }}
                            className="w-full text-[12px] px-2 py-1 pr-8 border border-gray-300 rounded-lg outline-none focus:border-blue-500 text-right"
                          />
                          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-[#999]">đ</span>
                        </div>
                      </td>
                      <td className="py-1.5 text-center">
                        <select
                          value={c.payer}
                          onChange={e => { const v = e.target.value as CostPayer; guard(() => updateCostField(c, { payer: v })); }}
                          className="text-[11px] px-1.5 py-1 border border-gray-300 rounded-lg outline-none"
                        >
                          {Object.entries(PAYER_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                        </select>
                      </td>
                      <td className="py-1.5 text-center">
                        <button onClick={() => guard(() => removeCostRow(c))} className="text-[#bbb] hover:text-red-600 transition">
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                    {isVP && vpInfo && (
                      <tr className="bg-blue-50/50">
                        <td colSpan={showPeriod ? 5 : 4} className="px-3 py-1.5 text-[10px] text-blue-600">
                          Tu tinh: VP "{vpInfo.zoneName}" — Tong CP: {vpInfo.totalCost.toLocaleString('vi-VN')} d
                          (CP co dinh: {vpInfo.fixedCosts.toLocaleString('vi-VN')} + Luong NS: {vpInfo.staffCosts.toLocaleString('vi-VN')})
                          / {vpInfo.projectCount} du an = {vpInfo.amount.toLocaleString('vi-VN')} d/du an
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              };

              const sumVal = (rows: ProjectPnlCost[]) => rows.reduce((s, c) => s + (Number(c.value) || 0), 0);
              const ACCENT_STYLES: Record<'salary' | 'general' | 'referral' | 'hoh', { bar: string; badge: string; total: string; container: string; headerBorder: string }> = {
                salary: { bar: 'bg-amber-400', badge: 'bg-[#FDF1D6] text-amber-800 border-amber-300', total: 'text-amber-700', container: 'border-amber-200 bg-[#FFFCF5]', headerBorder: 'border-amber-200' },
                general: { bar: 'bg-[#9DB7D8]', badge: 'bg-[#E6F1FB] text-[#0C447C] border-[#B5D4F4]', total: 'text-[#185FA5]', container: 'border-[#D8E6F5] bg-[#F8FBFE]', headerBorder: 'border-[#D8E6F5]' },
                referral: { bar: 'bg-purple-300', badge: 'bg-purple-50 text-purple-600 border-purple-200', total: 'text-purple-600', container: 'border-purple-200 bg-purple-50/30', headerBorder: 'border-purple-200' },
                hoh: { bar: 'bg-sky-300', badge: 'bg-sky-50 text-sky-600 border-sky-200', total: 'text-sky-600', container: 'border-sky-200 bg-sky-50/30', headerBorder: 'border-sky-200' },
              };
              const renderTable = (title: string, rows: ProjectPnlCost[], subtotal: number, emptyHint: string, accent: 'salary' | 'general' | 'referral' | 'hoh') => {
                const showPeriod = isPeriodic && accent === 'salary';
                const accentCls = ACCENT_STYLES[accent];
                const containerCls = accentCls.container;
                const headerBorderCls = accentCls.headerBorder;
                return (
                  <div className={`rounded-lg border ${containerCls} overflow-hidden`}>
                    <div className={`flex items-center gap-2 px-3 py-2 border-b ${headerBorderCls}`}>
                      <span className={`w-1.5 h-4 rounded-full ${accentCls.bar}`} />
                      <span className={`text-[11.5px] font-semibold px-2 py-0.5 rounded-md border ${accentCls.badge}`}>{title}</span>
                    </div>
                    <div className="px-3 pt-2">
                      {rows.length === 0 ? (
                        <div className="text-[10.5px] text-[#bbb] pb-2">{emptyHint}</div>
                      ) : (
                        <div className="overflow-x-auto">
                        <table className="w-full text-[12px] mb-1">
                          <thead>
                            <tr className="text-[10px] text-[#999] uppercase">
                              {showPeriod && <th className="text-left font-medium pb-1.5 w-[90px]">Kỳ</th>}
                              <th className="text-left font-medium pb-1.5">Khoản chi phí</th>
                              <th className="text-right font-medium pb-1.5 w-[120px]">Giá trị</th>
                              <th className="text-center font-medium pb-1.5 w-[95px]">Bên chi trả</th>
                              <th className="w-[28px]"></th>
                            </tr>
                          </thead>
                          <tbody>{rows.map(c => renderRow(c, showPeriod))}</tbody>
                        </table>
                        </div>
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
                    {renderTable('Chi phí Lương + BHXH', salaryCosts, sumVal(salaryCosts), 'Chưa có khoản lương/BHXH nào — gán nhóm "Lương/BHXH" cho hạng mục trong Quản lý hạng mục.', 'salary')}
                    {renderTable('Chi phí chung', generalCosts, sumVal(generalCosts), 'Chưa có khoản chi phí chung nào.', 'general')}
                    {referralCosts.length > 0 && renderTable('Chi phí Giới thiệu Lao động (GTLD)', referralCosts, sumVal(referralCosts), '', 'referral')}
                    {hohCosts.length > 0 && renderTable('Chi phí HOH', hohCosts, sumVal(hohCosts), '', 'hoh')}
                    <div className="pt-1 flex items-center gap-2">
                      {isPeriodic && (
                        <select
                          value={selectedNewCostPeriod}
                          onChange={e => setNewCostPeriod(e.target.value)}
                          title="Kỳ áp dụng cho khoản chi phí sắp thêm"
                          className="w-[90px] text-[11px] px-2 py-1.5 border border-gray-300 rounded-lg outline-none text-[#666]"
                        >
                          {periodOptions.map(p => <option key={p} value={p}>{p}</option>)}
                        </select>
                      )}
                      {(() => {
                        const available = costCategories.filter(cat => (isPeriodic && cat.group_type === 'salary') || !costs.some(c => c.label === cat.label));
                        return available.length > 0 ? (
                          <select
                            value=""
                            onChange={e => {
                              const v = e.target.value;
                              if (v) {
                                const isSalary = costCategories.find(cat => cat.label === v)?.group_type === 'salary';
                                guard(() => addCostFromCategory(v, isPeriodic && isSalary ? selectedNewCostPeriod : null));
                              }
                              e.target.value = '';
                            }}
                            className="flex-1 text-[11px] px-2 py-1.5 border border-gray-300 rounded-lg outline-none text-[#666]"
                          >
                            <option value="">+ Them hang muc chi phi...</option>
                            {available.map(cat => <option key={cat.id} value={cat.label}>{cat.label}</option>)}
                          </select>
                        ) : (
                          <span className="flex-1 text-[10px] text-[#bbb]">Da them tat ca hang muc</span>
                        );
                      })()}
                      <button onClick={() => guard(addReferralCost)} title="Thêm chi phí riêng cho Giới thiệu Lao động (GTLD) — dịch vụ phụ, ít khi dùng"
                        className="text-[10px] text-[#bbb] hover:text-purple-600 font-medium shrink-0 whitespace-nowrap">
                        + CP GTLD
                      </button>
                      <button onClick={() => guard(addHohCost)} title="Thêm chi phí riêng cho HOH — dịch vụ phụ, ít khi dùng"
                        className="text-[10px] text-[#bbb] hover:text-sky-600 font-medium shrink-0 whitespace-nowrap">
                        + CP HOH
                      </button>
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

            {/* Row 3b: Period summary — only when project xuất hoá đơn nhiều kỳ trong tháng */}
            {selected.invoice_mode === 'periodic' && (() => {
              const lines = revLines[selected.id] || [];
              const periodKeys = [...new Set([
                ...lines.map(l => l.period_label).filter((p): p is string => !!p),
                ...costs.map(c => c.period_label).filter((p): p is string => !!p),
              ])].sort();
              const chiPhiChung = costs.filter(c => !c.period_label).reduce((s, c) => s + (Number(c.value) || 0), 0);
              if (periodKeys.length === 0 && chiPhiChung === 0) return null;
              return (
                <div className="bg-white border border-[#E8E7E2] rounded-xl overflow-hidden">
                  <div className="px-3.5 py-2.5 border-b border-[#E8E7E2] text-[12px] font-medium text-[#111]">
                    Tổng hợp theo kỳ
                  </div>
                  <div className="p-3.5 space-y-2">
                    {periodKeys.map(pk => {
                      const periodRevenue = lines.filter(l => l.period_label === pk).reduce((s, l) => s + (l.amount || 0), 0);
                      const periodCost = costs.filter(c => c.period_label === pk).reduce((s, c) => s + (Number(c.value) || 0), 0);
                      const periodProfit = periodRevenue - periodCost;
                      return (
                        <div key={pk} className="flex items-center justify-between text-[12px] border border-[#E8E7E2] rounded-lg px-3 py-2">
                          <span className="font-medium text-[#111] w-[90px] truncate">{pk}</span>
                          <span className="text-[#666]">DT <strong className="text-[#111]">{fmtTrieu(periodRevenue)}</strong></span>
                          <span className="text-[#666]">CP <strong className="text-red-600">{fmtTrieu(periodCost)}</strong></span>
                          <span className={`font-semibold ${periodProfit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>LN {fmtTrieu(periodProfit)} đ</span>
                        </div>
                      );
                    })}
                    {chiPhiChung > 0 && (
                      <div className="flex items-center justify-between text-[12px] border border-dashed border-[#E8E7E2] rounded-lg px-3 py-2 text-[#888]">
                        <span className="font-medium w-[90px] truncate">Chi phí chung</span>
                        <span>theo tháng, không tính riêng kỳ</span>
                        <span>CP <strong className="text-red-600">{fmtTrieu(chiPhiChung)}</strong></span>
                        <span></span>
                      </div>
                    )}
                    <div className="flex items-center justify-between text-[12px] bg-[#F5F4EF] rounded-lg px-3 py-2 mt-1">
                      <span className="font-semibold text-[#111] w-[90px] truncate">Tổng cộng</span>
                      <span className="text-[#666]">DT <strong className="text-[#111]">{fmtTrieu(selected.revenue)}</strong></span>
                      <span className="text-[#666]">CP <strong className="text-red-600">{fmtTrieu(r?.tc ?? 0)}</strong></span>
                      <span className={`font-semibold ${(r?.profit ?? 0) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>LN {fmtTrieu(r?.profit ?? 0)} đ</span>
                    </div>
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
                    {selected.project_type === 'shared'
                      ? ` → Chia ${selected.lg_pct}/${selected.cn_pct}`
                      : selected.project_type === 'per_manday'
                        ? ` → CN nhận ${(selected.manday_rate || 0).toLocaleString('vi-VN')}đ × ${(selected.total_man_days || 0).toLocaleString('vi-VN')} công`
                        : " → 100% Let's Go VN"}
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
                    <div className={`text-[20px] font-medium ${r.lgP >= 0 ? 'text-[#185FA5]' : 'text-red-600'}`}>{fmtTrieu(r.lgP)}</div>
                    <div className="text-[10px] text-[#378ADD] mt-0.5">{selected.project_type === 'shared' ? `${selected.lg_pct}% LN` : selected.project_type === 'per_manday' ? 'LN còn lại sau khoán công' : '100% (khoán)'}</div>
                  </div>
                  <div className="rounded-lg p-3 text-center bg-[#EAF3DE] border border-[#C0DD97]">
                    <div className="text-[10px] uppercase text-[#27500A] mb-1">Chi nhánh</div>
                    <div className="text-[20px] font-medium text-emerald-700">{fmtTrieu(r.cnP)}</div>
                    <div className="text-[10px] text-emerald-600 mt-0.5">{selected.project_type === 'shared' ? `${selected.cn_pct}% LN` : selected.project_type === 'per_manday' ? `${(selected.manday_rate || 0).toLocaleString('vi-VN')}đ/công × ${(selected.total_man_days || 0).toLocaleString('vi-VN')} công` : 'Nhận lương CĐ'}</div>
                  </div>
                </div>
                {hasHoh && (
                  <div className="mt-2.5 text-[11px] text-sky-700 bg-sky-50/60 border border-sky-200 rounded-lg px-2.5 py-2">
                    <strong>Trong đó HOH</strong> (chia {selected.hoh_lg_pct ?? 100}/{selected.hoh_cn_pct ?? 0}):
                    {' '}LN <strong>{fmtTrieu(r.hohProfit)}</strong>
                    {' → '}LGV <strong>{fmtTrieu(r.hohLgP)}</strong>{' · '}CN <strong>{fmtTrieu(r.hohCnP)}</strong> đ
                  </div>
                )}
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

      {invoiceSettingsOpen && selected && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={e => { if (e.target === e.currentTarget) setInvoiceSettingsOpen(false); }}>
          <div className="bg-white rounded-xl shadow-2xl p-5 w-[420px]">
            <div className="flex items-center justify-between mb-4">
              <div className="text-[13px] font-semibold text-[#111]">Cai dat hoa don nhieu ky</div>
              <button onClick={() => setInvoiceSettingsOpen(false)} className="text-[#aaa] hover:text-[#666]"><XIcon size={15} /></button>
            </div>
            <div className="text-[10.5px] text-[#888] mb-3">
              Ap dung cho khach hang <strong>{selected.clients?.name || mergedClients.find(x => x.id === selected.client_id)?.name}</strong> — nho cai dat nay cho cac thang sau, khong can go lai.
            </div>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-[12px] text-[#666] w-[110px]">So ky / thang:</span>
              <input
                type="number" min={1} max={4}
                value={invSettingsForm.periodCount}
                onChange={e => setInvSettingsForm(f => ({ ...f, periodCount: Math.min(4, Math.max(1, +e.target.value || 1)) }))}
                className="w-[70px] text-[12px] px-2 py-1.5 border border-gray-300 rounded-lg outline-none focus:border-blue-500 text-right"
              />
            </div>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-[12px] text-[#666] w-[110px]">Ten hoa don:</span>
              <input
                value={invSettingsForm.invoiceLabel}
                onChange={e => setInvSettingsForm(f => ({ ...f, invoiceLabel: e.target.value }))}
                placeholder="Hoa don"
                className="flex-1 text-[12px] px-2 py-1.5 border border-gray-300 rounded-lg outline-none focus:border-blue-500"
              />
            </div>
            <div className="text-[10px] text-[#999] uppercase mb-1.5">Ten ky &amp; ngay xuat hoa don mac dinh</div>
            <div className="space-y-1.5 mb-4">
              {Array.from({ length: invSettingsForm.periodCount }).map((_, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    value={invSettingsForm.periodLabels[i] || ''}
                    onChange={e => setInvSettingsForm(f => { const labels = [...f.periodLabels]; labels[i] = e.target.value; return { ...f, periodLabels: labels }; })}
                    placeholder={`Kỳ ${i + 1}`}
                    className="flex-1 text-[12px] px-2 py-1.5 border border-gray-300 rounded-lg outline-none focus:border-blue-500"
                  />
                  <div className="relative w-[80px]">
                    <input
                      type="number" min={1} max={31}
                      value={invSettingsForm.invoiceDays[i] || ''}
                      onChange={e => setInvSettingsForm(f => { const days = [...f.invoiceDays]; days[i] = Math.min(31, Math.max(1, +e.target.value || 1)); return { ...f, invoiceDays: days }; })}
                      className="w-full text-[12px] px-2 py-1.5 pr-7 border border-gray-300 rounded-lg outline-none focus:border-blue-500 text-right"
                    />
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-[#999]">ngày</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <button onClick={saveInvoiceSettingsForm} className="flex-1 py-1.5 rounded-lg text-[12px] font-medium bg-[#0F6E56] text-white hover:opacity-90 transition">
                Luu
              </button>
              <button onClick={() => setInvoiceSettingsOpen(false)} className="px-3 py-1.5 rounded-lg text-[12px] font-medium border border-gray-300 text-[#666] hover:bg-white transition">
                Huy
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmAction && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60]" onClick={e => { if (e.target === e.currentTarget) { confirmAction.revert?.(); setConfirmAction(null); } }}>
          <div className="bg-white rounded-xl shadow-2xl p-5 w-[360px]">
            <div className="text-[13px] font-semibold text-[#111] mb-2">Xác nhận thay đổi</div>
            <div className="text-[12px] text-[#666] mb-4">
              Dự án này đã có lợi nhuận (dữ liệu đã chốt). Bạn có chắc muốn lưu thay đổi này không?
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => { confirmAction.run(); setConfirmAction(null); setLockedSnapshot(false); }}
                className="flex-1 py-1.5 rounded-lg text-[12px] font-medium bg-[#0F6E56] text-white hover:opacity-90 transition"
              >
                Lưu thay đổi
              </button>
              <button
                onClick={() => { confirmAction.revert?.(); setConfirmAction(null); }}
                className="flex-1 py-1.5 rounded-lg text-[12px] font-medium border border-gray-300 text-[#666] hover:bg-[#F5F4EF] transition"
              >
                Huỷ
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
