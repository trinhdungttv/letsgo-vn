import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Trash2, Copy, ChevronLeft, ChevronRight, ChevronDown, ChevronUp,
  GripVertical, Settings2, Plus, Check, X, Pencil, Star,
  Building2, Zap, Wifi, Droplets, FileText, Car, Coffee, Phone, Package, Wrench, Shield, Landmark, CircleDollarSign,
} from 'lucide-react';
import { Bar, Line } from 'react-chartjs-2';
import { supabase } from '../../lib/supabase';
import { shiftMonth, monthLabel, calcPnl } from '../../lib/format';
import type { Branch, ProjectPnl, ProjectPnlCost, BranchStaff, OverheadCategory } from '../../lib/types';

interface OverheadRow { id: string; branch_id: string; month: string; label: string; value: number; cost_type: string; sort_order?: number }

const ICON_MAP: Record<string, React.ReactNode> = {
  building: <Building2 size={13} />,
  zap: <Zap size={13} />,
  wifi: <Wifi size={13} />,
  droplets: <Droplets size={13} />,
  file: <FileText size={13} />,
  car: <Car size={13} />,
  coffee: <Coffee size={13} />,
  phone: <Phone size={13} />,
  package: <Package size={13} />,
  wrench: <Wrench size={13} />,
  shield: <Shield size={13} />,
  landmark: <Landmark size={13} />,
  dollar: <CircleDollarSign size={13} />,
};

const ICON_KEYS = Object.keys(ICON_MAP);

function getIconForLabel(label: string, icon?: string): React.ReactNode {
  if (icon && ICON_MAP[icon]) return ICON_MAP[icon];
  const l = label.toLowerCase();
  if (l.includes('thuê') || l.includes('mặt bằng')) return ICON_MAP.building;
  if (l.includes('điện')) return ICON_MAP.zap;
  if (l.includes('internet') || l.includes('wifi')) return ICON_MAP.wifi;
  if (l.includes('nước')) return ICON_MAP.droplets;
  if (l.includes('văn phòng')) return ICON_MAP.file;
  if (l.includes('xăng') || l.includes('xe')) return ICON_MAP.car;
  if (l.includes('tiếp khách') || l.includes('ăn')) return ICON_MAP.coffee;
  if (l.includes('điện thoại')) return ICON_MAP.phone;
  if (l.includes('lương') || l.includes('bhxh')) return ICON_MAP.dollar;
  if (l.includes('sale')) return ICON_MAP.landmark;
  return ICON_MAP.package;
}

interface Props {
  branch: Branch;
  projectsPnl: ProjectPnl[];
  pnlCostsMap: Record<string, ProjectPnlCost[]>;
  branchStaffs?: BranchStaff[];
  overheadCategories: OverheadCategory[];
  onCategoryAdd: (label: string, costType: 'fixed' | 'operational') => Promise<OverheadCategory>;
  onCategoryRename: (id: string, label: string) => Promise<void>;
  onCategoryRemove: (id: string) => Promise<void>;
  onCategoryToggleDefault: (id: string, isDefault: boolean) => Promise<void>;
  onCategoryUpdateCostType: (id: string, costType: 'fixed' | 'operational') => Promise<void>;
  onCategoryUpdateIcon: (id: string, icon: string) => Promise<void>;
  onCategoryReorder: (reordered: OverheadCategory[]) => Promise<void>;
  toast: (msg: string) => void;
}

export default function BranchFinance({
  branch, projectsPnl, pnlCostsMap, branchStaffs = [],
  overheadCategories, onCategoryAdd, onCategoryRename, onCategoryRemove,
  onCategoryToggleDefault, onCategoryUpdateCostType, onCategoryUpdateIcon, onCategoryReorder,
  toast,
}: Props) {
  const now = new Date();
  const curMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  // Persist month in URL hash segment (e.g. #/branches/xxx/finance/2026-05)
  function parseMonthFromHash(): string {
    const parts = window.location.hash.replace('#/', '').split('/');
    const seg = parts[3];
    if (seg && /^\d{4}-\d{2}$/.test(seg)) return seg;
    return curMonth;
  }

  const [month, setMonthRaw] = useState(parseMonthFromHash);

  const setMonth = useCallback((m: string) => {
    setMonthRaw(m);
    const parts = window.location.hash.replace('#/', '').split('/');
    if (parts.length >= 3) {
      parts[3] = m;
      window.history.replaceState(null, '', '#/' + parts.join('/'));
    }
  }, []);
  const [overhead, setOverhead] = useState<OverheadRow[]>([]);
  const [extraMonths, setExtraMonths] = useState<string[]>([]);
  const [catMgrOpen, setCatMgrOpen] = useState(false);
  const [newCatLabel, setNewCatLabel] = useState('');
  const [editingCatId, setEditingCatId] = useState<string | null>(null);
  const [editingCatLabel, setEditingCatLabel] = useState('');
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const catMgrRef = useRef<HTMLDivElement>(null);

  const loadOverhead = useCallback(async () => {
    // branch_id là khoá chính thức; vẫn vét thêm các dòng cũ còn khoá bằng text
    // (tên chuẩn / tên cũ / tên rút gọn) để không sót chi phí nào.
    const legacyKeys = [branch.name, branch.region, branch.short_name].filter(Boolean) as string[];
    const { data } = await supabase.from('branch_overhead')
      .select('*')
      .or(`branch_id.eq.${branch.id},branch_manager.in.(${legacyKeys.map(k => `"${k}"`).join(',')})`)
      .order('sort_order');
    setOverhead((data ?? []) as OverheadRow[]);
  }, [branch.id, branch.name, branch.region, branch.short_name]);

  useEffect(() => { loadOverhead(); }, [loadOverhead]);

  // Close category manager on outside click
  useEffect(() => {
    if (!catMgrOpen) return;
    const handler = (e: MouseEvent) => {
      if (catMgrRef.current && !catMgrRef.current.contains(e.target as Node)) setCatMgrOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [catMgrOpen]);

  const matchesBranch = useCallback((p: { branch_id?: string | null; branch_manager: string | null }) => {
    if (p.branch_id) return p.branch_id === branch.id;
    const k = (p.branch_manager ?? '').trim().toLowerCase();
    return [branch.name, branch.region, branch.short_name]
      .filter(Boolean).some(v => (v as string).trim().toLowerCase() === k);
  }, [branch.id, branch.name, branch.region, branch.short_name]);

  const branchProjects = useMemo(() => projectsPnl.filter(matchesBranch), [projectsPnl, matchesBranch]);

  const monthOverhead = useMemo(() =>
    overhead.filter(o => o.month === month).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
    [overhead, month]
  );
  const monthProjects = branchProjects.filter(p => p.month === month);

  // Separate fixed vs operational
  const fixedOverhead = monthOverhead.filter(o => o.cost_type !== 'Vận hành');
  const operationalOverhead = monthOverhead.filter(o => o.cost_type === 'Vận hành');
  const fixedTotal = fixedOverhead.reduce((s, o) => s + (o.value || 0), 0);
  const operationalTotal = operationalOverhead.reduce((s, o) => s + (o.value || 0), 0);
  const staffSalaryTotal = branchStaffs.reduce((s, st) => s + (st.salary || 0), 0);
  const overheadTotal = fixedTotal + operationalTotal;
  const totalCpCn = overheadTotal + staffSalaryTotal;

  const projectRows = monthProjects.map(p => {
    const costs = pnlCostsMap[p.id] || [];
    const r = calcPnl(p, costs);
    return { ...p, ...r };
  });

  // Extract Phi Sale from project costs for display
  const projectSaleCosts = useMemo(() => {
    const result: { projectName: string; value: number }[] = [];
    for (const p of monthProjects) {
      const costs = pnlCostsMap[p.id] || [];
      for (const c of costs) {
        if (c.label.toLowerCase().includes('sale') || c.label.toLowerCase().includes('phi sale')) {
          result.push({ projectName: p.clients?.name || '—', value: c.value || 0 });
        }
      }
    }
    return result;
  }, [monthProjects, pnlCostsMap]);

  const totalRevenue = projectRows.reduce((s, p) => s + p.revenue, 0);
  const totalCost = projectRows.reduce((s, p) => s + p.tc, 0);
  const totalLnCn = projectRows.reduce((s, p) => s + p.cnP, 0);
  const lnRong = totalLnCn - totalCpCn;

  const addOverheadFromCategory = async (cat: OverheadCategory) => {
    if (monthOverhead.some(o => o.label === cat.label)) { toast('Đã có mục này'); return; }
    const { data, error } = await supabase.from('branch_overhead')
      .insert({
        branch_id: branch.id,
        branch_manager: branch.name,
        month, label: cat.label, value: 0,
        cost_type: cat.cost_type === 'operational' ? 'Vận hành' : 'Cố định',
        sort_order: monthOverhead.length,
      })
      .select().single();
    if (error) { toast('Lỗi: ' + error.message); return; }
    setOverhead(prev => [...prev, data as OverheadRow]);
  };

  const addCustomRow = async () => {
    const { data, error } = await supabase.from('branch_overhead')
      .insert({ branch_id: branch.id, branch_manager: branch.name, month, label: 'Chi phí mới', value: 0, cost_type: 'Cố định', sort_order: monthOverhead.length })
      .select().single();
    if (error) { toast('Lỗi: ' + error.message); return; }
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

  const toggleCostType = async (id: string) => {
    const row = overhead.find(o => o.id === id);
    if (!row) return;
    const newType = row.cost_type === 'Vận hành' ? 'Cố định' : 'Vận hành';
    await updateOverheadRow(id, { cost_type: newType });
  };

  const moveRow = async (id: string, dir: -1 | 1) => {
    const idx = monthOverhead.findIndex(o => o.id === id);
    if (idx < 0) return;
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= monthOverhead.length) return;
    const reordered = [...monthOverhead];
    [reordered[idx], reordered[newIdx]] = [reordered[newIdx], reordered[idx]];
    const updated = reordered.map((o, i) => ({ ...o, sort_order: i }));
    setOverhead(prev => {
      const others = prev.filter(o => o.month !== month);
      return [...others, ...updated];
    });
    for (const o of updated) {
      await supabase.from('branch_overhead').update({ sort_order: o.sort_order }).eq('id', o.id);
    }
  };

  const copyFromPrevMonth = async () => {
    const prev = shiftMonth(month, -1);
    const prevRows = overhead.filter(o => o.month === prev);
    if (!prevRows.length) { toast('Tháng trước chưa có dữ liệu'); return; }
    for (const r of prevRows) {
      if (monthOverhead.some(o => o.label === r.label)) continue;
      const { data } = await supabase.from('branch_overhead')
        .insert({ branch_id: branch.id, branch_manager: branch.name, month, label: r.label, value: r.value, cost_type: r.cost_type, sort_order: r.sort_order ?? 0 })
        .select().single();
      if (data) setOverhead(prev2 => [...prev2, data as OverheadRow]);
    }
    toast('Đã sao chép từ tháng trước');
  };

  // Auto-add default categories for new month
  useEffect(() => {
    if (monthOverhead.length > 0) return;
    const defaults = overheadCategories.filter(c => c.is_default);
    if (!defaults.length) return;
    (async () => {
      for (const cat of defaults) {
        const { data } = await supabase.from('branch_overhead')
          .insert({
            branch_id: branch.id,
            branch_manager: branch.name,
            month, label: cat.label, value: 0,
            cost_type: cat.cost_type === 'operational' ? 'Vận hành' : 'Cố định',
            sort_order: cat.sort_order,
          })
          .select().single();
        if (data) setOverhead(prev => [...prev, data as OverheadRow]);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, monthOverhead.length, overheadCategories]);

  const fmtVnd = (v: number) => v.toLocaleString('vi-VN');

  // Month options: T1/2026 → current month + extra months
  const baseMonths = useMemo(() => {
    const arr: string[] = [];
    const curY = parseInt(curMonth.split('-')[0]);
    const curM = parseInt(curMonth.split('-')[1]);
    for (let y = 2026; y <= curY; y++) {
      const startM = 1;
      const endM = y === curY ? curM : 12;
      for (let m = startM; m <= endM; m++) {
        arr.push(`${y}-${String(m).padStart(2, '0')}`);
      }
    }
    return arr;
  }, [curMonth]);

  const allMonths = useMemo(() => {
    const set = new Set([...baseMonths, ...extraMonths]);
    if (month) set.add(month);
    return Array.from(set).sort().reverse();
  }, [baseMonths, extraMonths, month]);

  const [addMonthOpen, setAddMonthOpen] = useState(false);
  const [addMonthValue, setAddMonthValue] = useState('');

  const isFirstMonth = allMonths.indexOf(month) === allMonths.length - 1;
  const isLastMonth = allMonths.indexOf(month) === 0;

  const prevMonthNav = () => {
    const idx = allMonths.indexOf(month);
    if (idx < allMonths.length - 1) setMonth(allMonths[idx + 1]);
  };
  const nextMonthNav = () => {
    const idx = allMonths.indexOf(month);
    if (idx > 0) setMonth(allMonths[idx - 1]);
  };

  const confirmAddMonth = () => {
    if (!addMonthValue) return;
    if (allMonths.includes(addMonthValue)) { toast('Tháng này đã tồn tại'); return; }
    setExtraMonths(em => [...em, addMonthValue]);
    setMonth(addMonthValue);
    setAddMonthOpen(false);
    setAddMonthValue('');
    toast(`Đã tạo ${monthLabel(addMonthValue)}`);
  };

  // Chart data (6 months around current)
  const chartMonths = useMemo(() => {
    const arr: string[] = [];
    for (let i = 5; i >= 0; i--) arr.push(shiftMonth(curMonth, -i));
    return arr;
  }, [curMonth]);

  const chartData = useMemo(() => {
    return chartMonths.map(m => {
      const mp = projectsPnl.filter(p => p.month === m && matchesBranch(p));
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
  }, [chartMonths, projectsPnl, pnlCostsMap, overhead, staffSalaryTotal, matchesBranch]);

  const handleAddCategory = async () => {
    const label = newCatLabel.trim();
    if (!label) return;
    try {
      await onCategoryAdd(label, 'fixed');
      setNewCatLabel('');
    } catch { toast('Lỗi thêm hạng mục'); }
  };

  const handleRenameCategory = async (id: string) => {
    const label = editingCatLabel.trim();
    if (!label) return;
    try {
      await onCategoryRename(id, label);
      setEditingCatId(null);
    } catch { toast('Lỗi đổi tên'); }
  };

  const moveCat = (idx: number, dir: -1 | 1) => {
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= overheadCategories.length) return;
    const reordered = [...overheadCategories];
    [reordered[idx], reordered[newIdx]] = [reordered[newIdx], reordered[idx]];
    onCategoryReorder(reordered.map((c, i) => ({ ...c, sort_order: i })));
  };

  const renderOverheadRow = (o: OverheadRow, idx: number, list: OverheadRow[]) => {
    const cat = overheadCategories.find(c => c.label === o.label);
    const icon = getIconForLabel(o.label, cat?.icon);
    return (
      <div key={o.id} className="flex items-center gap-1.5 group py-1 hover:bg-[#FAFAF8] rounded-lg px-1 -mx-1">
        <div className="flex flex-col opacity-0 group-hover:opacity-100 transition">
          <button onClick={() => moveRow(o.id, -1)} disabled={idx === 0} className="text-[#bbb] hover:text-[#666] disabled:opacity-30"><ChevronUp size={10} /></button>
          <button onClick={() => moveRow(o.id, 1)} disabled={idx === list.length - 1} className="text-[#bbb] hover:text-[#666] disabled:opacity-30"><ChevronDown size={10} /></button>
        </div>
        <span className="text-[#999] shrink-0">{icon}</span>
        <input key={`ol-${o.id}`} defaultValue={o.label} onBlur={e => updateOverheadRow(o.id, { label: e.target.value })}
          className="flex-1 text-[12px] px-1.5 py-1 border-b border-transparent hover:border-dashed hover:border-gray-300 focus:border-blue-500 outline-none bg-transparent" />
        <button onClick={() => toggleCostType(o.id)}
          className={`text-[9px] px-1.5 py-0.5 rounded-full border shrink-0 transition ${o.cost_type === 'Vận hành' ? 'bg-amber-50 border-amber-200 text-amber-700' : 'bg-blue-50 border-blue-200 text-blue-700'}`}>
          {o.cost_type === 'Vận hành' ? 'VH' : 'CĐ'}
        </button>
        <div className="relative w-[140px]">
          <input key={`ov-${o.id}`} type="text" defaultValue={o.value ? fmtVnd(o.value) : '0'}
            onFocus={e => { e.target.value = String(o.value || 0); }}
            onBlur={e => { const v = +e.target.value.replace(/\D/g, '') || 0; updateOverheadRow(o.id, { value: v }); e.target.value = fmtVnd(v); }}
            className="w-full text-[12px] px-2 py-1 pr-5 border border-gray-200 rounded-lg outline-none focus:border-blue-500 text-right bg-white" />
          <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[9px] text-[#bbb]">đ</span>
        </div>
        <button onClick={() => deleteOverheadRow(o.id)} className="text-[#ccc] hover:text-red-500 opacity-0 group-hover:opacity-100 transition"><Trash2 size={12} /></button>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Month selector — compact */}
      <div className="flex items-center gap-2">
        <button onClick={prevMonthNav} disabled={isFirstMonth}
          className="p-1 rounded hover:bg-[#F5F4EF] text-[#999] hover:text-[#111] transition disabled:opacity-30 disabled:cursor-not-allowed"><ChevronLeft size={16} /></button>
        <select value={month} onChange={e => setMonth(e.target.value)}
          className="text-[13px] font-medium text-[#111] bg-transparent border border-[#E8E7E2] rounded-lg px-2.5 py-1.5 outline-none cursor-pointer hover:border-[#ccc]">
          {allMonths.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
        </select>
        <button onClick={nextMonthNav} disabled={isLastMonth}
          className="p-1 rounded hover:bg-[#F5F4EF] text-[#999] hover:text-[#111] transition disabled:opacity-30 disabled:cursor-not-allowed"><ChevronRight size={16} /></button>

        {/* Add month */}
        <div className="relative">
          <button onClick={() => { setAddMonthOpen(!addMonthOpen); setAddMonthValue(''); }}
            className="text-[11px] text-blue-600 hover:text-blue-800 border border-blue-200 px-2 py-1 rounded-lg transition bg-blue-50" title="Tạo tháng mới">
            <Plus size={12} />
          </button>
          {addMonthOpen && (
            <div className="absolute left-0 top-full mt-1 bg-white border border-[#E8E7E2] rounded-xl shadow-xl z-50 p-3 w-[220px]">
              <div className="text-[12px] font-semibold text-[#111] mb-2">Tạo tháng mới</div>
              <input type="month" value={addMonthValue} onChange={e => setAddMonthValue(e.target.value)}
                className="w-full text-[12px] px-2 py-1.5 border border-gray-200 rounded-lg outline-none focus:border-blue-500 mb-2" />
              <div className="flex gap-1.5">
                <button onClick={confirmAddMonth} disabled={!addMonthValue}
                  className="flex-1 text-[11px] text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-40 px-2 py-1.5 rounded-lg transition flex items-center justify-center gap-1">
                  <Check size={12} /> Xác nhận
                </button>
                <button onClick={() => setAddMonthOpen(false)}
                  className="text-[11px] text-[#666] hover:text-[#111] border border-gray-200 px-2 py-1.5 rounded-lg transition">
                  Hủy
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-2.5">
        <div className="bg-[#F5F4EF] rounded-lg p-3 text-center">
          <div className="text-[10px] uppercase text-[#999] mb-1">Doanh thu</div>
          <div className="text-[18px] font-semibold text-[#0F6E56]">{fmtVnd(totalRevenue)} đ</div>
        </div>
        <div className="bg-[#F5F4EF] rounded-lg p-3 text-center">
          <div className="text-[10px] uppercase text-[#999] mb-1">LN từ dự án (phần CN)</div>
          <div className="text-[18px] font-semibold text-[#185FA5]">{fmtVnd(totalLnCn)} đ</div>
        </div>
        <div className="bg-[#F5F4EF] rounded-lg p-3 text-center">
          <div className="text-[10px] uppercase text-[#999] mb-1">Tổng CP chi nhánh</div>
          <div className="text-[18px] font-semibold text-red-600">{fmtVnd(totalCpCn)} đ</div>
        </div>
        <div className="bg-white border-2 border-[#E8E7E2] rounded-lg p-3 text-center">
          <div className="text-[10px] uppercase text-[#999] mb-1">LN ròng CN</div>
          <div className={`text-[18px] font-semibold ${lnRong >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{fmtVnd(lnRong)} đ</div>
        </div>
      </div>

      {/* Project rows */}
      {projectRows.length > 0 && (
        <div className="bg-white border border-[#E8E7E2] rounded-xl overflow-hidden">
          <div className="px-3.5 py-2.5 border-b border-[#E8E7E2] text-[12px] font-medium text-[#111]">Dự án {monthLabel(month)}</div>
          <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-[10px] text-[#999] uppercase bg-[#F5F4EF]">
                <th className="text-left font-medium px-3.5 py-2">Dự án</th>
                <th className="text-right font-medium px-3 py-2">Doanh thu</th>
                <th className="text-right font-medium px-3 py-2">Chi phí</th>
                <th className="text-right font-medium px-3 py-2">LN dự án</th>
                <th className="text-right font-medium px-3 py-2">Phần CN</th>
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
                <td className="px-3.5 py-2 font-semibold">Tổng</td>
                <td className="px-3 py-2 text-right font-semibold">{fmtVnd(totalRevenue)}</td>
                <td className="px-3 py-2 text-right font-semibold text-red-600">{fmtVnd(totalCost)}</td>
                <td className="px-3 py-2 text-right font-semibold">{fmtVnd(totalRevenue - totalCost)}</td>
                <td className="px-3 py-2 text-right font-semibold text-[#185FA5]">{fmtVnd(totalLnCn)}</td>
              </tr>
            </tfoot>
          </table>
          </div>
        </div>
      )}

      {/* Overhead costs */}
      <div className="bg-white border border-[#E8E7E2] rounded-xl overflow-hidden">
        <div className="px-3.5 py-2.5 border-b border-[#E8E7E2] flex items-center justify-between">
          <div className="text-[12px] font-medium text-[#111]">Chi phí chi nhánh — {monthLabel(month)}</div>
          <div className="flex gap-1.5 items-center">
            <button onClick={copyFromPrevMonth} className="flex items-center gap-1 text-[11px] text-[#666] hover:text-[#111] border border-gray-200 px-2 py-1 rounded-lg transition">
              <Copy size={11} /> Sao chép T.trước
            </button>

            {/* Category manager dropdown */}
            <div className="relative" ref={catMgrRef}>
              <button onClick={() => setCatMgrOpen(!catMgrOpen)}
                className="flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-800 border border-blue-200 px-2 py-1 rounded-lg transition bg-blue-50">
                <Settings2 size={11} /> Hạng mục
              </button>
              {catMgrOpen && (
                <div className="absolute right-0 top-full mt-1 w-[320px] bg-white border border-[#E8E7E2] rounded-xl shadow-xl z-50 p-3">
                  <div className="text-[12px] font-semibold text-[#111] mb-2">Quản lý hạng mục chi phí</div>
                  <div className="text-[10px] text-[#999] mb-3">Bật ★ để hạng mục tự hiện khi tạo tháng mới</div>
                  <div className="space-y-1 max-h-[280px] overflow-y-auto mb-3">
                    {overheadCategories.map((cat, idx) => (
                      <div key={cat.id} className="flex items-center gap-1.5 group py-0.5">
                        {/* Reorder */}
                        <div className="flex flex-col">
                          <button onClick={() => moveCat(idx, -1)} disabled={idx === 0} className="text-[#ccc] hover:text-[#666] disabled:opacity-30"><ChevronUp size={9} /></button>
                          <button onClick={() => moveCat(idx, 1)} disabled={idx === overheadCategories.length - 1} className="text-[#ccc] hover:text-[#666] disabled:opacity-30"><ChevronDown size={9} /></button>
                        </div>
                        {/* Default toggle */}
                        <button onClick={() => onCategoryToggleDefault(cat.id, !cat.is_default)}
                          className={`shrink-0 ${cat.is_default ? 'text-amber-500' : 'text-[#ddd] hover:text-amber-400'}`}>
                          <Star size={12} fill={cat.is_default ? 'currentColor' : 'none'} />
                        </button>
                        {/* Icon selector */}
                        <select value={cat.icon || ''} onChange={e => onCategoryUpdateIcon(cat.id, e.target.value)}
                          className="text-[10px] w-[50px] border border-gray-200 rounded px-0.5 py-0.5 outline-none bg-white">
                          <option value="">auto</option>
                          {ICON_KEYS.map(k => <option key={k} value={k}>{k}</option>)}
                        </select>
                        {editingCatId === cat.id ? (
                          <div className="flex-1 flex items-center gap-1">
                            <input autoFocus value={editingCatLabel} onChange={e => setEditingCatLabel(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') handleRenameCategory(cat.id); if (e.key === 'Escape') setEditingCatId(null); }}
                              className="flex-1 text-[11px] px-1.5 py-0.5 border border-blue-400 rounded outline-none" />
                            <button onClick={() => handleRenameCategory(cat.id)} className="text-emerald-600"><Check size={12} /></button>
                            <button onClick={() => setEditingCatId(null)} className="text-gray-400"><X size={12} /></button>
                          </div>
                        ) : (
                          <span className="flex-1 text-[11px] text-[#333] cursor-pointer" onDoubleClick={() => { setEditingCatId(cat.id); setEditingCatLabel(cat.label); }}>
                            {cat.label}
                          </span>
                        )}
                        {/* Cost type toggle */}
                        <button onClick={() => onCategoryUpdateCostType(cat.id, cat.cost_type === 'operational' ? 'fixed' : 'operational')}
                          className={`text-[9px] px-1.5 py-0.5 rounded-full border shrink-0 ${cat.cost_type === 'operational' ? 'bg-amber-50 border-amber-200 text-amber-700' : 'bg-blue-50 border-blue-200 text-blue-700'}`}>
                          {cat.cost_type === 'operational' ? 'VH' : 'CĐ'}
                        </button>
                        {/* Edit / Delete */}
                        <button onClick={() => { setEditingCatId(cat.id); setEditingCatLabel(cat.label); }}
                          className="text-[#ccc] hover:text-blue-600 opacity-0 group-hover:opacity-100"><Pencil size={11} /></button>
                        <button onClick={() => onCategoryRemove(cat.id)}
                          className="text-[#ccc] hover:text-red-500 opacity-0 group-hover:opacity-100"><Trash2 size={11} /></button>
                      </div>
                    ))}
                  </div>
                  {/* Add new category */}
                  <div className="flex items-center gap-1.5 border-t border-gray-100 pt-2">
                    <input value={newCatLabel} onChange={e => setNewCatLabel(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handleAddCategory(); }}
                      placeholder="Thêm hạng mục mới..."
                      className="flex-1 text-[11px] px-2 py-1 border border-gray-200 rounded-lg outline-none focus:border-blue-400" />
                    <button onClick={handleAddCategory} disabled={!newCatLabel.trim()}
                      className="text-[11px] text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-40 px-2.5 py-1 rounded-lg transition">
                      <Plus size={12} />
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Quick add from categories */}
            <select onChange={e => {
              if (!e.target.value) return;
              if (e.target.value === '__custom__') { addCustomRow(); e.target.value = ''; return; }
              const cat = overheadCategories.find(c => c.id === e.target.value);
              if (cat) addOverheadFromCategory(cat);
              e.target.value = '';
            }} className="text-[11px] px-1.5 py-1 rounded-lg border border-gray-200 outline-none bg-white text-blue-600 cursor-pointer">
              <option value="">+ Thêm</option>
              {overheadCategories.filter(c => !monthOverhead.some(o => o.label === c.label)).map(c => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
              <option disabled>──────</option>
              <option value="__custom__">✎ Tự nhập...</option>
            </select>
          </div>
        </div>

        {monthOverhead.length === 0 ? (
          <div className="px-3.5 py-6 text-center text-[12px] text-[#999]">Chưa có chi phí. Bấm "Thêm" hoặc "Sao chép T.trước".</div>
        ) : (
          <div className="p-3.5 space-y-0.5">
            {/* Fixed costs */}
            {fixedOverhead.length > 0 && (
              <>
                <div className="text-[10px] text-blue-600 uppercase font-semibold tracking-wide mb-1 flex items-center gap-1">
                  <Shield size={11} /> Chi phí cố định
                </div>
                {fixedOverhead.map((o, i) => renderOverheadRow(o, i, fixedOverhead))}
                <div className="flex justify-between pt-1.5 pb-2 border-t border-gray-100 text-[12px] font-medium mt-1">
                  <span className="text-[#666]">Tổng CP cố định</span>
                  <span className="text-red-600">{fmtVnd(fixedTotal)} đ</span>
                </div>
              </>
            )}

            {/* Operational costs */}
            {operationalOverhead.length > 0 && (
              <>
                <div className="text-[10px] text-amber-600 uppercase font-semibold tracking-wide mb-1 flex items-center gap-1 mt-2">
                  <Wrench size={11} /> Chi phí vận hành
                </div>
                {operationalOverhead.map((o, i) => renderOverheadRow(o, i, operationalOverhead))}
                <div className="flex justify-between pt-1.5 pb-2 border-t border-gray-100 text-[12px] font-medium mt-1">
                  <span className="text-[#666]">Tổng CP vận hành</span>
                  <span className="text-red-600">{fmtVnd(operationalTotal)} đ</span>
                </div>
              </>
            )}

            {/* Staff salary */}
            {staffSalaryTotal > 0 && (
              <div className="mt-2 pt-2 border-t border-gray-100 space-y-1">
                <div className="text-[10px] text-[#999] uppercase font-semibold tracking-wide flex items-center gap-1">
                  <CircleDollarSign size={11} /> Lương nhân sự VP
                </div>
                {branchStaffs.filter(st => st.salary > 0).map(st => (
                  <div key={st.id} className="flex justify-between text-[12px] px-1">
                    <span className="text-[#555]">{st.name} — {st.role || 'NV'}</span>
                    <span className="text-[#111]">{fmtVnd(st.salary)} đ</span>
                  </div>
                ))}
                <div className="flex justify-between text-[12px] font-medium pt-1 border-t border-gray-50">
                  <span className="text-[#666]">Tổng lương NS</span>
                  <span className="text-red-600">{fmtVnd(staffSalaryTotal)} đ</span>
                </div>
              </div>
            )}

            {/* Phi Sale from projects (read-only) */}
            {projectSaleCosts.length > 0 && (
              <div className="mt-2 pt-2 border-t border-gray-100 space-y-1">
                <div className="text-[10px] text-emerald-600 uppercase font-semibold tracking-wide flex items-center gap-1">
                  <Landmark size={11} /> Phí Sale (từ PnL dự án)
                </div>
                {projectSaleCosts.map((sc, i) => (
                  <div key={i} className="flex justify-between text-[12px] px-1">
                    <span className="text-[#555]">{sc.projectName}</span>
                    <span className="text-[#111]">{fmtVnd(sc.value)} đ</span>
                  </div>
                ))}
              </div>
            )}

            {/* Grand total */}
            <div className="flex justify-between pt-3 border-t-2 border-gray-200 text-[12px] font-bold mt-3">
              <span>Tổng chi phí vận hành CN</span>
              <span className="text-red-600">{fmtVnd(totalCpCn)} đ</span>
            </div>
          </div>
        )}
      </div>

      {/* Summary */}
      <div className="bg-white border border-[#E8E7E2] rounded-xl overflow-hidden p-3.5">
        <div className="text-[12px] font-medium text-[#111] mb-1">Kết quả kinh doanh {monthLabel(month)}</div>
        <div className="text-[11px] text-[#666] bg-[#F5F4EF] rounded-lg px-3 py-2">
          LN dự án (phần CN): <strong className="text-[#185FA5]">{fmtVnd(totalLnCn)}</strong>
          {' − '}CP vận hành: <strong className="text-red-600">{fmtVnd(totalCpCn)}</strong>
          {staffSalaryTotal > 0 && <span className="text-[10px] text-[#999]"> (CĐ {fmtVnd(fixedTotal)} + VH {fmtVnd(operationalTotal)} + Lương {fmtVnd(staffSalaryTotal)})</span>}
          {' = '}LN ròng: <strong className={lnRong >= 0 ? 'text-emerald-600' : 'text-red-600'}>{fmtVnd(lnRong)}</strong> đ
        </div>
      </div>

      {/* Charts */}
      {chartData.some(d => d.rev > 0) && (
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-white border border-[#E8E7E2] rounded-xl p-3.5">
            <div className="text-[11px] font-medium text-[#111] mb-2">DT / CP / LN (6 tháng)</div>
            <Bar
              data={{
                labels: chartData.map(d => 'T' + Number(d.month.split('-')[1])),
                datasets: [
                  { label: 'Doanh thu', data: chartData.map(d => d.rev), backgroundColor: '#6EE7B7' },
                  { label: 'Chi phí', data: chartData.map(d => d.cost), backgroundColor: '#FCA5A5' },
                  { label: 'LN dự án', data: chartData.map(d => d.lnCn), backgroundColor: '#93C5FD' },
                ],
              }}
              options={{ responsive: true, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } } }, scales: { y: { ticks: { font: { size: 9 }, callback: v => (Number(v) / 1e6).toFixed(0) + 'tr' } }, x: { ticks: { font: { size: 10 } } } } }}
            />
          </div>
          <div className="bg-white border border-[#E8E7E2] rounded-xl p-3.5">
            <div className="text-[11px] font-medium text-[#111] mb-2">LN ròng CN (6 tháng)</div>
            <Line
              data={{
                labels: chartData.map(d => 'T' + Number(d.month.split('-')[1])),
                datasets: [
                  { label: 'LN dự án', data: chartData.map(d => d.lnCn), borderColor: '#3B82F6', backgroundColor: '#93C5FD', tension: 0.3, fill: false },
                  { label: 'CP cố định', data: chartData.map(d => d.oh), borderColor: '#EF4444', backgroundColor: '#FCA5A5', tension: 0.3, fill: false },
                  { label: 'LN ròng', data: chartData.map(d => d.lnRong), borderColor: '#10B981', backgroundColor: '#6EE7B7', tension: 0.3, fill: true },
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
