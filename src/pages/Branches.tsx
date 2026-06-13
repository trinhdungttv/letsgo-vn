import { useState, useEffect, useMemo, useRef } from 'react';
import {
  Building2, MapPin, ChevronRight, ArrowLeft, ClipboardList, Wallet, Users,
  Plus, Save, Trash2, AlertTriangle, BadgeCheck, LayoutGrid, List, User, RefreshCw,
} from 'lucide-react';
import { useBranchData } from '../hooks/useBranchData';
import { useManagers } from '../hooks/useManagers';
import { useRegions } from '../hooks/useRegions';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { logActivity } from '../lib/audit';
import type { Client, Branch, BranchStatus, ProjectPnl, BranchOverhead } from '../lib/types';
import { fmtTrieu, daysUntil, monthLabel, shiftMonth } from '../lib/format';

interface BranchesProps {
  clients: Client[];
  toast: (msg: string) => void;
  focusRegion?: string | null;
  onFocusConsumed?: () => void;
}

type Tab = 'profile' | 'operations' | 'finance' | 'staff';
type ViewMode = 'grid' | 'list';

function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message);
  return String(e);
}

function currentMonthStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
  { key: 'profile', label: 'Hồ sơ chi nhánh', icon: <BadgeCheck size={15} /> },
  { key: 'operations', label: 'Vận hành', icon: <ClipboardList size={15} /> },
  { key: 'finance', label: 'Tài chính', icon: <Wallet size={15} /> },
  { key: 'staff', label: 'Nhân sự VP', icon: <Users size={15} /> },
];

export default function Branches({ clients, toast, focusRegion, onFocusConsumed }: BranchesProps) {
  const { user } = useAuth();
  const { branches, addBranch, updateBranch, deleteBranch } = useBranchData();
  const { managers, add: addManager } = useManagers();
  const { regions, add: addRegion, remove: removeRegion } = useRegions();
  const regionNames = regions.map(r => r.name).filter(n => n !== 'Tất cả');
  const managerNames = managers.map(m => m.name);

  // Ensure a "Khu vực phụ trách" name exists in the regions table (creates it if new),
  // so it immediately shows up as a "Chi nhánh" filter option on the Clients page too.
  const ensureRegion = async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed || regionNames.includes(trimmed)) return;
    try {
      await addRegion(trimmed);
    } catch (e) {
      toast('Lỗi tạo khu vực: ' + errMsg(e));
    }
  };

  // Resolve a manager by name, creating a new manager record if it doesn't exist yet
  // so new people can be assigned without going through a separate "Manager" admin page.
  const resolveManager = async (name: string): Promise<{ id: string | null; name: string | null }> => {
    const trimmed = name.trim();
    if (!trimmed) return { id: null, name: null };
    const existing = managers.find(m => m.name.toLowerCase() === trimmed.toLowerCase());
    if (existing) return { id: existing.id, name: existing.name };
    try {
      const created = await addManager({ name: trimmed, phone: null, email: null, region: null });
      return { id: created.id, name: created.name };
    } catch (e) {
      toast('Lỗi tạo quản lý: ' + errMsg(e));
      return { id: null, name: trimmed };
    }
  };

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [activeTab, setActiveTab] = useState<Tab>('profile');

  const [adding, setAdding] = useState(false);
  const [newBranch, setNewBranch] = useState({ name: '', short_name: '', region: '', manager_name: '', location: '', map_link: '' });
  const [regionTouched, setRegionTouched] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<Branch | null>(null);
  const [deletePassword, setDeletePassword] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  const [month, setMonth] = useState(currentMonthStr());
  const [projectsPnl, setProjectsPnl] = useState<ProjectPnl[]>([]);
  const [overhead, setOverhead] = useState<BranchOverhead[]>([]);

  const months = useMemo(() => {
    const cur = currentMonthStr();
    return [shiftMonth(cur, -2), shiftMonth(cur, -1), cur];
  }, []);

  useEffect(() => {
    (async () => {
      const [{ data: pj }, { data: oh }] = await Promise.all([
        supabase.from('projects_pnl').select('*').eq('month', month),
        supabase.from('branch_overhead').select('*').eq('month', month),
      ]);
      setProjectsPnl((pj || []) as ProjectPnl[]);
      setOverhead((oh || []) as BranchOverhead[]);
    })();
  }, [month]);

  const selected = branches.find(b => b.id === selectedId) || null;

  // Open a specific branch when navigated here from another page (e.g. Dashboard region table)
  useEffect(() => {
    if (!focusRegion || !branches.length) return;
    const match = branches.find(b => b.region === focusRegion);
    if (match) setSelectedId(match.id);
    onFocusConsumed?.();
  }, [focusRegion, branches, onFocusConsumed]);

  // ── Profile form state ──────────────────────────────────────────
  const [form, setForm] = useState<Partial<Branch>>({});
  useEffect(() => {
    if (selected) setForm(selected);
    setActiveTab('profile');
  }, [selectedId, selected]);

  const setF = (fields: Partial<Branch>) => setForm(prev => ({ ...prev, ...fields }));

  const saveProfile = async () => {
    if (!selected) return;
    const region = (form.region ?? '').trim();
    if (region && branches.some(b => b.id !== selected.id && b.region === region)) {
      toast(`"${region}" đã được liên kết với chi nhánh khác — vui lòng đặt tên khu vực phụ trách khác`);
      return;
    }
    try {
      const mgr = await resolveManager(form.manager_name ?? '');
      await updateBranch(selected.id, {
        name: form.name || selected.name,
        short_name: form.short_name ?? null,
        manager_id: mgr.id,
        manager_name: mgr.name,
        region: form.region ?? null,
        location: form.location ?? null,
        map_link: form.map_link ?? null,
        address: form.address ?? null,
        phone: form.phone ?? null,
        email: form.email ?? null,
        established_date: form.established_date ?? null,
        status: (form.status as BranchStatus) || 'active',
        notes: form.notes ?? null,
      });
      if (form.region) await ensureRegion(form.region);
      toast('Đã lưu thông tin chi nhánh');
    } catch (e) {
      toast('Lỗi: ' + errMsg(e));
    }
  };

  const handleAddBranch = async () => {
    if (!newBranch.name.trim()) { toast('Vui lòng nhập tên chi nhánh'); return; }
    const region = newBranch.region.trim();
    if (region && branches.some(b => b.region === region)) {
      toast(`"${region}" đã được liên kết với chi nhánh khác — vui lòng đặt tên khu vực phụ trách khác`);
      return;
    }
    try {
      const mgr = await resolveManager(newBranch.manager_name);
      const created = await addBranch({
        name: newBranch.name.trim(),
        short_name: newBranch.short_name.trim() || null,
        manager_id: mgr.id,
        manager_name: mgr.name,
        region: region || null,
        location: newBranch.location.trim() || null,
        map_link: newBranch.map_link.trim() || null,
        address: null,
        phone: null,
        email: null,
        established_date: null,
        status: 'active',
        notes: null,
      });
      if (region) await ensureRegion(region);
      toast('Đã thêm chi nhánh');
      setAdding(false);
      setNewBranch({ name: '', short_name: '', region: '', manager_name: '', location: '', map_link: '' });
      setRegionTouched(false);
      setSelectedId(created.id);
    } catch (e) {
      toast('Lỗi: ' + errMsg(e));
    }
  };

  const locationNames = useMemo(
    () => Array.from(new Set(branches.map(b => b.location).filter((l): l is string => !!l))).sort(),
    [branches]
  );

  const missingRegions = useMemo(
    () => regionNames.filter(name => !branches.some(b => b.region === name)),
    [regionNames, branches]
  );

  const syncFromRegions = async (names: string[], silent: boolean) => {
    try {
      for (const name of names) {
        const parts = name.split(' - ');
        const shortName = parts.length > 1 ? parts[0].trim() : name.slice(0, 2).toUpperCase();
        const mgrName = parts.length > 1 ? parts[1].trim() : null;
        const mgr = mgrName ? managers.find(m => m.name === mgrName) : undefined;
        await addBranch({
          name,
          short_name: shortName,
          manager_id: mgr?.id || null,
          manager_name: mgr?.name || mgrName,
          region: name,
          location: null,
          map_link: null,
          address: null,
          phone: null,
          email: null,
          established_date: null,
          status: 'active',
          notes: null,
        });
      }
      if (!silent) toast(`Đã thêm ${names.length} chi nhánh từ Khu vực`);
    } catch (e) {
      toast('Lỗi: ' + errMsg(e));
    }
  };

  const handleSyncFromRegions = () => {
    if (!missingRegions.length) { toast('Tất cả khu vực đã có chi nhánh tương ứng'); return; }
    syncFromRegions(missingRegions, false);
  };

  // Auto-create a branch whenever a new "Chi nhánh" region is added on the Clients page,
  // so the two lists never drift apart without requiring a manual sync click.
  const autoSyncedRef = useRef(false);
  useEffect(() => {
    if (autoSyncedRef.current) return;
    if (!regionNames.length || !branches.length) return;
    if (!missingRegions.length) return;
    autoSyncedRef.current = true;
    syncFromRegions(missingRegions, true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missingRegions, regionNames, branches]);

  const handleDeleteBranch = (b: Branch) => {
    setDeleteTarget(b);
    setDeletePassword('');
  };

  const confirmDeleteBranch = async () => {
    if (!deleteTarget) return;
    if (!deletePassword) { toast('Vui lòng nhập mật khẩu'); return; }
    setIsDeleting(true);
    try {
      const { data: authCheck, error: authErr } = await supabase
        .from('app_users')
        .select('id')
        .eq('id', user?.id || '')
        .eq('password', deletePassword)
        .maybeSingle();
      if (authErr) throw authErr;
      if (!authCheck) { toast('Sai mật khẩu, vui lòng thử lại'); return; }

      await deleteBranch(deleteTarget.id);
      if (selectedId === deleteTarget.id) setSelectedId(null);
      await logActivity({
        user, action: 'delete', table: 'branches', recordId: deleteTarget.id,
        description: `Xóa chi nhánh "${deleteTarget.name}"`,
        oldData: deleteTarget,
      });
      // Also remove the linked "Khu vực phụ trách" region entry, otherwise the
      // auto-sync effect will detect it as a missing region and re-create the branch.
      if (deleteTarget.region) {
        const linkedRegion = regions.find(r => r.name === deleteTarget.region);
        if (linkedRegion) {
          await removeRegion(linkedRegion.id);
          await logActivity({
            user, action: 'delete', table: 'regions', recordId: linkedRegion.id,
            description: `Xóa khu vực phụ trách "${linkedRegion.name}" (theo chi nhánh "${deleteTarget.name}")`,
            oldData: linkedRegion,
          });
        }
      }
      toast('Đã xoá chi nhánh');
      setDeleteTarget(null);
      setDeletePassword('');
    } catch (e) {
      toast('Lỗi: ' + errMsg(e));
    } finally {
      setIsDeleting(false);
    }
  };

  // ── Per-branch stats (clients/workers/finance) ──────────────────
  const branchStats = useMemo(() => {
    const map: Record<string, {
      branchClients: Client[];
      workers: number;
      revenue: number;
      lnCn: number;
      overheadTotal: number;
      lnRong: number;
      alerts: string[];
    }> = {};
    for (const b of branches) {
      const branchClients = b.region ? clients.filter(c => c.region === b.region) : [];
      const workers = branchClients.reduce((s, c) => s + (c.current_workers || 0), 0);
      const projects = b.region ? projectsPnl.filter(p => p.branch_manager === b.region) : [];
      const revenue = projects.reduce((s, p) => s + (p.revenue || 0), 0);
      const lnCn = projects.reduce((s, p) => {
        if (p.project_type === 'shared') return s + (p.revenue || 0) * (p.cn_pct || 0) / 100;
        return s;
      }, 0);
      const overheadTotal = b.region ? overhead.filter(o => o.branch_manager === b.region).reduce((s, o) => s + (o.value || 0), 0) : 0;
      const lnRong = lnCn - overheadTotal;
      const alerts: string[] = [];
      const expiring = branchClients.filter(c => { const d = daysUntil(c.contract_end); return d !== null && d <= 30 && d >= 0; });
      if (expiring.length) alerts.push(`${expiring.length} HĐ sắp hết hạn`);
      const danger = branchClients.filter(c => c.status === 'danger');
      if (danger.length) alerts.push(`${danger.length} KH cần xử lý`);
      map[b.id] = { branchClients, workers, revenue, lnCn, overheadTotal, lnRong, alerts };
    }
    return map;
  }, [branches, clients, projectsPnl, overhead]);

  // ── KPI strip ─────────────────────────────────────────────────
  const totalWorkers = clients.reduce((s, c) => s + (c.current_workers || 0), 0);
  const totalActiveClients = clients.filter(c => c.client_type === 'active').length;
  const totalLnRong = Object.values(branchStats).reduce((s, v) => s + v.lnRong, 0);
  const needsAttention = branches.filter(b => (branchStats[b.id]?.alerts.length || 0) > 0).length;

  const initials = (b: Branch) => (b.short_name || b.name.slice(0, 2)).toUpperCase().slice(0, 2);

  // ════════════════════════════════════════════════════════════════
  // DETAIL VIEW
  // ════════════════════════════════════════════════════════════════
  if (selected) {
    const stats = branchStats[selected.id];
    const branchOverheadRows = selected.region ? overhead.filter(o => o.branch_manager === selected.region) : [];

    return (
      <div className="space-y-3">
        <datalist id="region-options">
          {regionNames.map(r => <option key={r} value={r} />)}
        </datalist>
        <datalist id="location-options">
          {locationNames.map(l => <option key={l} value={l} />)}
        </datalist>
        <datalist id="manager-options">
          {managerNames.map(m => <option key={m} value={m} />)}
        </datalist>
        <button onClick={() => setSelectedId(null)} className="flex items-center gap-1.5 text-[12.5px] text-[#666] hover:text-[#111] transition">
          <ArrowLeft size={14} /> Tất cả chi nhánh
        </button>

        <div className="grid grid-cols-[240px_1fr] gap-3 items-start">
          {/* Sidebar */}
          <div className="bg-white border border-[#E8E7E2] rounded-xl overflow-hidden self-start">
            <div className="px-4 py-4 border-b border-[#E8E7E2] text-center">
              <div className="w-12 h-12 rounded-full bg-[#E1F5EE] text-[#085041] flex items-center justify-center text-[15px] font-semibold mx-auto mb-2">
                {initials(selected)}
              </div>
              <div className="text-[14px] font-semibold text-[#111]">{selected.name}</div>
              <div className="text-[11.5px] text-[#666] flex items-center justify-center gap-1 mt-0.5">
                <User size={12} /> {selected.manager_name || '—'}
              </div>
              <div className="mt-2">
                {stats?.alerts.length ? (
                  <span className="inline-flex text-[10px] px-2 py-0.5 rounded-full font-semibold bg-[#FAEEDA] text-[#633806]">Cần xử lý</span>
                ) : (
                  <span className="inline-flex text-[10px] px-2 py-0.5 rounded-full font-semibold bg-[#E1F5EE] text-[#085041]">Hoạt động tốt</span>
                )}
              </div>
            </div>
            <div className="py-1.5">
              {TABS.map(t => (
                <button
                  key={t.key}
                  onClick={() => setActiveTab(t.key)}
                  className={`flex items-center gap-2.5 px-4 py-2 text-[12.5px] w-full text-left transition border-l-[2.5px] ${
                    activeTab === t.key ? 'bg-[#F5F4EF] text-[#111] border-l-[#0F6E56] font-medium' : 'text-[#666] border-l-transparent hover:bg-[#F5F4EF]'
                  }`}
                >
                  <span className={activeTab === t.key ? 'text-[#0F6E56]' : 'text-[#999]'}>{t.icon}</span>
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Main content */}
          <div className="space-y-3">
            {activeTab === 'profile' && (
              <div className="bg-white border border-[#E8E7E2] rounded-xl overflow-hidden">
                <div className="px-3.5 py-2.5 border-b border-[#E8E7E2] flex items-center gap-2">
                  <Building2 size={15} className="text-[#999]" />
                  <div className="text-[12.5px] font-semibold text-[#111] flex-1">Thông tin chi nhánh</div>
                  <button onClick={saveProfile} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[12px] font-medium bg-[#0F6E56] text-white hover:opacity-90 transition">
                    <Save size={12} /> Lưu
                  </button>
                  <button onClick={() => handleDeleteBranch(selected)} className="text-red-600 hover:bg-red-50 rounded-md p-1.5 transition">
                    <Trash2 size={14} />
                  </button>
                </div>
                <div className="p-3.5 grid grid-cols-2 gap-3">
                  <Field label="Tên chi nhánh">
                    <input value={form.name || ''} onChange={e => setF({ name: e.target.value })} className="field-input" />
                  </Field>
                  <Field label="Tên rút gọn">
                    <input value={form.short_name || ''} onChange={e => setF({ short_name: e.target.value })} className="field-input" />
                  </Field>
                  <Field label="Quản lý phụ trách">
                    <input value={form.manager_name || ''} onChange={e => setF({ manager_name: e.target.value })} className="field-input" list="manager-options" placeholder="Tên quản lý — gõ tên mới nếu chưa có" />
                  </Field>
                  <Field label="Khu vực phụ trách (liên kết KH)">
                    <input value={form.region || ''} onChange={e => setF({ region: e.target.value })} className="field-input" list="region-options" placeholder="Tên khu vực phụ trách của chi nhánh" />
                  </Field>
                  <Field label="Địa danh">
                    <input value={form.location || ''} onChange={e => setF({ location: e.target.value })} className="field-input" list="location-options" placeholder="VD: Biên Hòa, Nhơn Trạch, Củ Chi, Quận 9" />
                  </Field>
                  <Field label="Link Google Maps" full>
                    <div className="flex gap-2">
                      <input value={form.map_link || ''} onChange={e => setF({ map_link: e.target.value })} className="field-input flex-1" placeholder="https://maps.app.goo.gl/..." />
                      {form.map_link && (
                        <a href={form.map_link} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[12px] font-medium border border-gray-300 text-[#666] hover:bg-[#F5F4EF] transition shrink-0">
                          <MapPin size={13} /> Xem
                        </a>
                      )}
                    </div>
                  </Field>
                  <Field label="Số điện thoại">
                    <input value={form.phone || ''} onChange={e => setF({ phone: e.target.value })} className="field-input" />
                  </Field>
                  <Field label="Email">
                    <input value={form.email || ''} onChange={e => setF({ email: e.target.value })} className="field-input" />
                  </Field>
                  <Field label="Ngày thành lập">
                    <input type="date" value={form.established_date || ''} onChange={e => setF({ established_date: e.target.value })} className="field-input" />
                  </Field>
                  <Field label="Trạng thái">
                    <select value={form.status || 'active'} onChange={e => setF({ status: e.target.value as BranchStatus })} className="field-input">
                      <option value="active">Hoạt động</option>
                      <option value="paused">Tạm dừng</option>
                    </select>
                  </Field>
                  <Field label="Địa chỉ văn phòng" full>
                    <input value={form.address || ''} onChange={e => setF({ address: e.target.value })} className="field-input" />
                  </Field>
                  <Field label="Ghi chú" full>
                    <textarea value={form.notes || ''} onChange={e => setF({ notes: e.target.value })} className="field-input min-h-[72px] resize-y" />
                  </Field>
                </div>
              </div>
            )}

            {activeTab === 'operations' && (
              <div className="bg-white border border-[#E8E7E2] rounded-xl overflow-hidden">
                <div className="px-3.5 py-2.5 border-b border-[#E8E7E2] flex items-center gap-2">
                  <Building2 size={15} className="text-[#999]" />
                  <div className="text-[12.5px] font-semibold text-[#111] flex-1">Khách hàng đang phụ trách</div>
                  <span className="text-[11px] text-[#999]">{stats?.branchClients.length || 0} KH · {stats?.workers.toLocaleString() || 0} LĐ tổng</span>
                </div>
                {!stats?.branchClients.length ? (
                  <div className="px-3.5 py-8 text-center text-[12px] text-[#999]">
                    {selected.region ? 'Chưa có khách hàng nào trong khu vực này' : 'Chi nhánh chưa gán khu vực — vào tab Hồ sơ để thiết lập'}
                  </div>
                ) : (
                  <table className="w-full text-[12px]">
                    <thead>
                      <tr className="text-[10px] text-[#999] uppercase bg-[#F5F4EF]">
                        <th className="text-left font-medium px-3.5 py-2">Công ty</th>
                        <th className="text-right font-medium px-3 py-2">Lao động</th>
                        <th className="text-right font-medium px-3 py-2">HĐ còn</th>
                        <th className="text-center font-medium px-3 py-2">Trạng thái</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.branchClients.map(c => {
                        const d = daysUntil(c.contract_end);
                        return (
                          <tr key={c.id} className="border-t border-[#F0EEE9]">
                            <td className="px-3.5 py-2">
                              <div className="font-medium text-[#111]">{c.name}</div>
                              <div className="text-[10.5px] text-[#999]">{c.industrial_zones?.[0] || '—'}</div>
                            </td>
                            <td className="px-3 py-2 text-right font-semibold">{(c.current_workers || 0).toLocaleString()}</td>
                            <td className="px-3 py-2 text-right">
                              {d === null ? '—' : (
                                <span className={`font-semibold ${d <= 7 ? 'text-red-600' : d <= 30 ? 'text-amber-600' : 'text-[#666]'}`}>{d} ngày</span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-center">
                              <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                                c.status === 'danger' ? 'bg-[#FCEBEB] text-[#791F1F]' : c.status === 'warn' ? 'bg-[#FAEEDA] text-[#633806]' : 'bg-[#EAF3DE] text-[#27500A]'
                              }`}>
                                {c.status === 'danger' ? 'Khẩn cấp' : c.status === 'warn' ? 'Cần chú ý' : 'Ổn định'}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            {activeTab === 'finance' && (
              <>
                <div className="flex gap-1.5 items-center">
                  <span className="text-[11px] text-[#999]">Tháng:</span>
                  {months.map(m => (
                    <button
                      key={m}
                      onClick={() => setMonth(m)}
                      className={`px-2.5 py-1 text-[11px] rounded-full border transition ${month === m ? 'bg-[#F5F4EF] border-[#ccc] text-[#111] font-medium' : 'border-gray-300 text-[#666] hover:bg-[#F5F4EF]'}`}
                    >
                      {monthLabel(m)}
                    </button>
                  ))}
                </div>

                <div className="grid grid-cols-3 gap-2.5">
                  <div className="bg-[#F5F4EF] rounded-lg p-3 text-center">
                    <div className="text-[10px] uppercase text-[#999] mb-1">Doanh thu</div>
                    <div className="text-[19px] font-semibold text-[#0F6E56]">{fmtTrieu(stats?.revenue || 0)} tr</div>
                  </div>
                  <div className="bg-[#F5F4EF] rounded-lg p-3 text-center">
                    <div className="text-[10px] uppercase text-[#999] mb-1">LN từ dự án (phần CN)</div>
                    <div className="text-[19px] font-semibold text-[#185FA5]">{fmtTrieu(stats?.lnCn || 0)} tr</div>
                  </div>
                  <div className="bg-[#F5F4EF] rounded-lg p-3 text-center border border-gray-200">
                    <div className="text-[10px] uppercase text-[#999] mb-1">LN ròng CN</div>
                    <div className={`text-[19px] font-semibold ${(stats?.lnRong || 0) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{fmtTrieu(stats?.lnRong || 0)} tr</div>
                  </div>
                </div>

                <div className="bg-white border border-[#E8E7E2] rounded-xl overflow-hidden">
                  <div className="px-3.5 py-2.5 border-b border-[#E8E7E2] flex items-center gap-2">
                    <Building2 size={15} className="text-[#999]" />
                    <div className="text-[12.5px] font-semibold text-[#111] flex-1">Chi phí cố định {monthLabel(month)}</div>
                  </div>
                  {branchOverheadRows.length === 0 ? (
                    <div className="px-3.5 py-6 text-center text-[12px] text-[#999]">Chưa có chi phí cố định cho tháng này. Quản lý tại trang Tài chính.</div>
                  ) : (
                    <>
                      <table className="w-full text-[12px]">
                        <thead>
                          <tr className="text-[10px] text-[#999] uppercase bg-[#F5F4EF]">
                            <th className="text-left font-medium px-3.5 py-2">Khoản chi phí</th>
                            <th className="text-left font-medium px-3 py-2">Loại</th>
                            <th className="text-right font-medium px-3.5 py-2">Giá trị</th>
                          </tr>
                        </thead>
                        <tbody>
                          {branchOverheadRows.map(o => (
                            <tr key={o.id} className="border-t border-[#F0EEE9]">
                              <td className="px-3.5 py-2">{o.label}</td>
                              <td className="px-3 py-2">
                                <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${o.cost_type === 'Cố định' ? 'bg-[#E6F1FB] text-[#0C447C]' : 'bg-[#E1F5EE] text-[#085041]'}`}>{o.cost_type}</span>
                              </td>
                              <td className="px-3.5 py-2 text-right font-semibold">{fmtTrieu(o.value)} tr</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <div className="px-3.5 py-2 bg-[#F5F4EF] border-t border-[#E8E7E2] flex items-center justify-between text-[12px] font-medium">
                        <span>Tổng chi phí cố định</span>
                        <span className="text-red-600">{fmtTrieu(stats?.overheadTotal || 0)} tr.đ</span>
                      </div>
                    </>
                  )}
                </div>
              </>
            )}

            {activeTab === 'staff' && (
              <div className="bg-white border border-[#E8E7E2] rounded-xl overflow-hidden">
                <div className="px-3.5 py-2.5 border-b border-[#E8E7E2] flex items-center gap-2">
                  <Users size={15} className="text-[#999]" />
                  <div className="text-[12.5px] font-semibold text-[#111] flex-1">Nhân sự văn phòng chi nhánh</div>
                  <button onClick={() => toast('Tính năng quản lý nhân sự VP đang được phát triển')} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[12px] font-medium bg-[#0F6E56] text-white hover:opacity-90 transition">
                    <Plus size={12} /> Thêm
                  </button>
                </div>
                <div className="px-3.5 py-8 text-center text-[12px] text-[#999]">
                  Chưa có dữ liệu nhân sự văn phòng. Tính năng này sẽ sớm được bổ sung.
                </div>
              </div>
            )}
          </div>
        </div>
        <DeleteBranchModal
          deleteTarget={deleteTarget}
          deletePassword={deletePassword}
          setDeletePassword={setDeletePassword}
          isDeleting={isDeleting}
          onCancel={() => { setDeleteTarget(null); setDeletePassword(''); }}
          onConfirm={confirmDeleteBranch}
        />
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════════
  // GRID / LIST VIEW
  // ════════════════════════════════════════════════════════════════
  return (
    <div className="space-y-3">
      <datalist id="region-options">
        {regionNames.map(r => <option key={r} value={r} />)}
      </datalist>
      <datalist id="location-options">
        {locationNames.map(l => <option key={l} value={l} />)}
      </datalist>
      <datalist id="manager-options">
        {managerNames.map(m => <option key={m} value={m} />)}
      </datalist>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="text-[18px] font-semibold text-[#111] flex items-center gap-2">
            <Building2 size={18} /> Chi Nhánh
          </div>
          <div className="text-[12px] text-[#999] mt-0.5">{branches.length} chi nhánh đang hoạt động</div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex border border-gray-300 rounded-lg overflow-hidden">
            <button onClick={() => setViewMode('grid')} className={`px-3 py-1.5 text-[12px] font-medium flex items-center gap-1.5 transition ${viewMode === 'grid' ? 'bg-[#F5F4EF] text-[#111]' : 'text-[#999] hover:text-[#555]'}`}>
              <LayoutGrid size={13} /> Cards
            </button>
            <button onClick={() => setViewMode('list')} className={`px-3 py-1.5 text-[12px] font-medium flex items-center gap-1.5 border-l border-gray-300 transition ${viewMode === 'list' ? 'bg-[#F5F4EF] text-[#111]' : 'text-[#999] hover:text-[#555]'}`}>
              <List size={13} /> Danh sách
            </button>
          </div>
          {missingRegions.length > 0 && (
            <button onClick={handleSyncFromRegions} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium border border-gray-300 text-[#666] hover:bg-[#F5F4EF] transition">
              <RefreshCw size={13} /> Đồng bộ từ Khu vực ({missingRegions.length})
            </button>
          )}
          <button onClick={() => setAdding(v => !v)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-[#0F6E56] text-white hover:opacity-90 transition">
            <Plus size={13} /> Thêm CN
          </button>
        </div>
      </div>

      {adding && (
        <div className="bg-white border border-[#E8E7E2] rounded-xl p-3.5 grid grid-cols-4 gap-2.5 items-end">
          <Field label="Tên chi nhánh">
            <input
              value={newBranch.name}
              onChange={e => {
                const name = e.target.value;
                setNewBranch(v => ({ ...v, name, region: regionTouched ? v.region : name }));
              }}
              className="field-input"
              placeholder="BH - Ms Thương"
            />
          </Field>
          <Field label="Tên rút gọn">
            <input value={newBranch.short_name} onChange={e => setNewBranch(v => ({ ...v, short_name: e.target.value }))} className="field-input" placeholder="BH" />
          </Field>
          <Field label="Khu vực phụ trách (liên kết KH)">
            <input
              value={newBranch.region}
              onChange={e => { setRegionTouched(true); setNewBranch(v => ({ ...v, region: e.target.value })); }}
              className="field-input"
              placeholder="Tự điền theo Tên chi nhánh — chỉ sửa nếu cần liên kết khác"
            />
          </Field>
          <Field label="Quản lý phụ trách">
            <input value={newBranch.manager_name} onChange={e => setNewBranch(v => ({ ...v, manager_name: e.target.value }))} className="field-input" list="manager-options" placeholder="Tên quản lý — gõ tên mới nếu chưa có" />
          </Field>
          <Field label="Địa danh">
            <input value={newBranch.location} onChange={e => setNewBranch(v => ({ ...v, location: e.target.value }))} className="field-input" list="location-options" placeholder="VD: Biên Hòa, Nhơn Trạch, Củ Chi, Quận 9" />
          </Field>
          <Field label="Link Google Maps">
            <input value={newBranch.map_link} onChange={e => setNewBranch(v => ({ ...v, map_link: e.target.value }))} className="field-input" placeholder="https://maps.app.goo.gl/..." />
          </Field>
          <div className="col-span-4 flex gap-2">
            <button onClick={handleAddBranch} className="px-3 py-1.5 rounded-lg text-[12px] font-medium bg-[#0F6E56] text-white hover:opacity-90 transition">Lưu</button>
            <button onClick={() => setAdding(false)} className="px-3 py-1.5 rounded-lg text-[12px] font-medium border border-gray-300 text-[#666] hover:bg-[#F5F4EF] transition">Hủy</button>
          </div>
        </div>
      )}

      {/* KPI strip */}
      <div className="grid grid-cols-4 gap-2.5">
        <Kpi label="Tổng lao động" value={totalWorkers.toLocaleString()} accent="#0F6E56" icon={<Users size={14} />} />
        <Kpi label="Tổng KH active" value={String(totalActiveClients)} sub={`Trên ${branches.length} chi nhánh`} accent="#185FA5" icon={<Building2 size={14} />} />
        <Kpi label="LN ròng tháng này" value={`${totalLnRong >= 0 ? '+' : ''}${fmtTrieu(totalLnRong)} tr`} sub="Tổng các chi nhánh" accent={totalLnRong >= 0 ? '#0F6E56' : '#A32D2D'} valueColor={totalLnRong >= 0 ? 'text-emerald-600' : 'text-red-600'} icon={<Wallet size={14} />} />
        <Kpi label="Cần xử lý" value={String(needsAttention)} sub="CN có vấn đề" accent="#BA7517" valueColor="text-amber-600" icon={<AlertTriangle size={14} />} />
      </div>

      {branches.length === 0 ? (
        <div className="bg-white border border-[#E8E7E2] rounded-xl px-3.5 py-10 text-center text-[12px] text-[#999]">
          Chưa có chi nhánh nào. Bấm "Thêm CN" để tạo mới.
        </div>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(290px,1fr))] gap-3">
          {branches.map(b => {
            const stats = branchStats[b.id];
            return (
              <div key={b.id} onClick={() => setSelectedId(b.id)} className="bg-white border border-[#E8E7E2] rounded-xl overflow-hidden cursor-pointer hover:border-gray-300 hover:-translate-y-0.5 transition">
                <div className="px-3.5 py-3 border-b border-[#E8E7E2] flex items-start gap-3">
                  <div className="w-10 h-10 rounded-full bg-[#E1F5EE] text-[#085041] flex items-center justify-center text-[13px] font-semibold shrink-0">{initials(b)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13.5px] font-semibold text-[#111] truncate">{b.name}</div>
                    <div className="text-[11.5px] text-[#666] flex items-center gap-1 truncate">
                      <MapPin size={11} />
                      {b.map_link ? (
                        <a href={b.map_link} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="hover:text-[#0F6E56] hover:underline">
                          {b.location || 'Chưa có địa danh'}
                        </a>
                      ) : (b.location || 'Chưa có địa danh')}
                    </div>
                    <div className="mt-1">
                      {stats?.alerts.length ? (
                        <span className="inline-flex text-[10px] px-2 py-0.5 rounded-full font-semibold bg-[#FAEEDA] text-[#633806]">Cần xử lý</span>
                      ) : (
                        <span className="inline-flex text-[10px] px-2 py-0.5 rounded-full font-semibold bg-[#E1F5EE] text-[#085041]">Hoạt động tốt</span>
                      )}
                    </div>
                  </div>
                  <ChevronRight size={16} className="text-[#ccc] shrink-0 mt-1" />
                </div>
                <div className="grid grid-cols-3 border-b border-[#E8E7E2]">
                  <div className="text-center py-2.5 border-r border-[#E8E7E2]">
                    <div className="text-[15px] font-semibold">{stats?.branchClients.length || 0}</div>
                    <div className="text-[9.5px] uppercase text-[#999] mt-0.5">KH</div>
                  </div>
                  <div className="text-center py-2.5 border-r border-[#E8E7E2]">
                    <div className="text-[15px] font-semibold">{(stats?.workers || 0).toLocaleString()}</div>
                    <div className="text-[9.5px] uppercase text-[#999] mt-0.5">Lao động</div>
                  </div>
                  <div className="text-center py-2.5">
                    <div className={`text-[15px] font-semibold ${(stats?.lnRong || 0) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                      {(stats?.lnRong || 0) >= 0 ? '+' : ''}{fmtTrieu(stats?.lnRong || 0)}
                    </div>
                    <div className="text-[9.5px] uppercase text-[#999] mt-0.5">LN ròng (tr)</div>
                  </div>
                </div>
                <div className="px-3.5 py-2 flex items-center justify-between gap-2">
                  <div className="flex gap-1.5 flex-wrap">
                    {stats?.alerts.length ? stats.alerts.map((a, i) => (
                      <span key={i} className="text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-[#FAEEDA] text-[#633806]">{a}</span>
                    )) : <span className="text-[11px] text-[#999]">Không có cảnh báo</span>}
                  </div>
                  <span className="text-[11px] text-[#666] flex items-center gap-1 shrink-0"><User size={11} /> {b.manager_name || '—'}</span>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="bg-white border border-[#E8E7E2] rounded-xl overflow-hidden">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-[10px] text-[#999] uppercase bg-[#F5F4EF]">
                <th className="text-left font-medium px-3.5 py-2">Chi nhánh</th>
                <th className="text-left font-medium px-3 py-2">Địa danh</th>
                <th className="text-left font-medium px-3 py-2">Khu vực</th>
                <th className="text-left font-medium px-3 py-2">Quản lý</th>
                <th className="text-right font-medium px-3 py-2">KH</th>
                <th className="text-right font-medium px-3 py-2">Lao động</th>
                <th className="text-right font-medium px-3.5 py-2">LN ròng</th>
              </tr>
            </thead>
            <tbody>
              {branches.map(b => {
                const stats = branchStats[b.id];
                return (
                  <tr key={b.id} onClick={() => setSelectedId(b.id)} className="border-t border-[#F0EEE9] cursor-pointer hover:bg-[#FAFAF8]">
                    <td className="px-3.5 py-2 font-medium text-[#111]">{b.name}</td>
                    <td className="px-3 py-2 text-[#666]">
                      {b.map_link ? (
                        <a href={b.map_link} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="hover:text-[#0F6E56] hover:underline flex items-center gap-1">
                          <MapPin size={11} /> {b.location || '—'}
                        </a>
                      ) : (b.location || '—')}
                    </td>
                    <td className="px-3 py-2 text-[#666]">{b.region || '—'}</td>
                    <td className="px-3 py-2 text-[#666]">{b.manager_name || '—'}</td>
                    <td className="px-3 py-2 text-right">{stats?.branchClients.length || 0}</td>
                    <td className="px-3 py-2 text-right">{(stats?.workers || 0).toLocaleString()}</td>
                    <td className={`px-3.5 py-2 text-right font-semibold ${(stats?.lnRong || 0) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                      {(stats?.lnRong || 0) >= 0 ? '+' : ''}{fmtTrieu(stats?.lnRong || 0)} tr
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <DeleteBranchModal
        deleteTarget={deleteTarget}
        deletePassword={deletePassword}
        setDeletePassword={setDeletePassword}
        isDeleting={isDeleting}
        onCancel={() => { setDeleteTarget(null); setDeletePassword(''); }}
        onConfirm={confirmDeleteBranch}
      />
    </div>
  );
}

function DeleteBranchModal({ deleteTarget, deletePassword, setDeletePassword, isDeleting, onCancel, onConfirm }: {
  deleteTarget: Branch | null;
  deletePassword: string;
  setDeletePassword: (v: string) => void;
  isDeleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!deleteTarget) return null;
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-sm w-full">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Xóa chi nhánh</h2>
            <p className="text-xs text-gray-500 mt-0.5">{deleteTarget.name}</p>
          </div>
          <button onClick={onCancel} className="p-1 hover:bg-gray-100 rounded-md">
            <span className="text-gray-500 text-lg leading-none">×</span>
          </button>
        </div>
        <div className="p-5 space-y-3">
          <p className="text-[12.5px] text-gray-600">
            Hành động này sẽ xóa vĩnh viễn chi nhánh và không thể khôi phục. Vui lòng nhập mật khẩu của bạn để xác nhận.
          </p>
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Mật khẩu</label>
            <input type="password" value={deletePassword}
              onChange={e => setDeletePassword(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') onConfirm(); }}
              autoFocus
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500" />
          </div>
        </div>
        <div className="px-5 pb-5 flex gap-2">
          <button onClick={onCancel} className="flex-1 px-3 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition">Hủy</button>
          <button onClick={onConfirm} disabled={isDeleting}
            className="flex-1 px-3 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 rounded-lg transition flex items-center justify-center gap-1.5">
            <Trash2 className="w-3.5 h-3.5" />
            {isDeleting ? 'Đang xóa...' : 'Xác nhận xóa'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div className={`flex flex-col gap-1 ${full ? 'col-span-2' : ''}`}>
      <label className="text-[10.5px] font-medium text-[#999] uppercase tracking-wide">{label}</label>
      {children}
    </div>
  );
}

function Kpi({ label, value, sub, accent, valueColor, icon }: { label: string; value: string; sub?: string; accent: string; valueColor?: string; icon: React.ReactNode }) {
  return (
    <div className="bg-white border border-[#E8E7E2] rounded-xl p-3.5 relative overflow-hidden">
      <div className="absolute top-0 left-0 right-0 h-[2.5px]" style={{ background: accent }} />
      <div className="flex items-center justify-between text-[10.5px] uppercase tracking-wide text-[#999] font-medium mb-1.5">
        {label} <span className="text-[#ccc]">{icon}</span>
      </div>
      <div className={`text-[20px] font-semibold ${valueColor || 'text-[#111]'}`}>{value}</div>
      {sub && <div className="text-[10.5px] text-[#999] mt-1">{sub}</div>}
    </div>
  );
}
