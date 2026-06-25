import { useState, useEffect, useMemo, useRef } from 'react';
import {
  Building2, MapPin, ChevronRight, ChevronDown, ChevronUp, ArrowLeft, ClipboardList, Wallet, Users,
  Plus, Save, Trash2, AlertTriangle, BadgeCheck, LayoutGrid, List, User, RefreshCw, History, Pencil, X,
  Filter, Check, Settings2,
} from 'lucide-react';
import { useBranchData } from '../hooks/useBranchData';
import { useBranchStaffs } from '../hooks/useBranchStaffs';
import { BranchHistoryFields, recordBranchUpdateSession, todayStr } from '../components/workspace/BranchHistoryFields';
import { useManagers } from '../hooks/useManagers';
import { useRegions } from '../hooks/useRegions';
import { useOverheadCategories } from '../hooks/useOverheadCategories';
import BranchZones from '../components/branches/BranchZones';
import BranchFinance from '../components/branches/BranchFinance';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { logActivity } from '../lib/audit';
import type { Client, Branch, BranchStatus, BranchTypeHistory, ProjectPnl, BranchOverhead, ClientManagerHistory, LaborHistoryEntry } from '../lib/types';
import { fmtTrieu, daysUntil, monthLabel, shiftMonth } from '../lib/format';

type KhoanTierDef = { min_workers: number; lg_pct: number; cn_pct: number };

function resolveActiveTier(tiers: KhoanTierDef[], peakWorkers: number): KhoanTierDef | null {
  if (!tiers.length) return null;
  const sorted = [...tiers].sort((a, b) => b.min_workers - a.min_workers);
  return sorted.find(t => peakWorkers >= t.min_workers) || sorted[sorted.length - 1];
}

interface BranchesProps {
  clients: Client[];
  toast: (msg: string) => void;
  focusRegion?: string | null;
  onFocusConsumed?: () => void;
}

type Tab = 'profile' | 'operations' | 'finance' | 'staff' | 'performance';
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

const PROVINCES = [
  'Bình Dương', 'Bình Phước', 'Đồng Nai', 'Hồ Chí Minh', 'Long An',
  'Bà Rịa - Vũng Tàu', 'Tây Ninh', 'Bình Thuận', 'Lâm Đồng',
  'Đà Nẵng', 'Hà Nội', 'Hải Phòng', 'Bắc Ninh', 'Hưng Yên',
];

const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
  { key: 'profile', label: 'Hồ sơ chi nhánh', icon: <BadgeCheck size={15} /> },
  { key: 'operations', label: 'Vận hành', icon: <ClipboardList size={15} /> },
  { key: 'finance', label: 'Tài chính', icon: <Wallet size={15} /> },
  { key: 'staff', label: 'Nhân sự VP', icon: <Users size={15} /> },
  { key: 'performance', label: 'Hiệu suất QL', icon: <User size={15} /> },
];

export default function Branches({ clients, toast, focusRegion, onFocusConsumed }: BranchesProps) {
  const { user } = useAuth();
  const { branches, addBranch, updateBranch, deleteBranch } = useBranchData();
  const { managers, add: addManager } = useManagers();
  const { categories: overheadCats, add: addOverheadCat, rename: renameOverheadCat, remove: removeOverheadCat } = useOverheadCategories();
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

  const selected = branches.find(b => b.id === selectedId) || null;
  const { staffs: branchStaffs, loading: staffLoading, add: addStaff, update: updateStaff, remove: removeStaff } = useBranchStaffs(selected?.id ?? null);
  const [staffForm, setStaffForm] = useState<{ name: string; role: string; phone: string; email: string }>({ name: '', role: '', phone: '', email: '' });
  const [editingStaffId, setEditingStaffId] = useState<string | null>(null);
  const [staffFormOpen, setStaffFormOpen] = useState(false);

  const [adding, setAdding] = useState(false);
  const [newBranch, setNewBranch] = useState({ name: '', short_name: '', region: '', manager_name: '', location: '', map_link: '', branch_type: 'contracted' as 'contracted' | 'company' });
  const [regionTouched, setRegionTouched] = useState(false);
  const [filterType, setFilterType] = useState<'all' | 'contracted' | 'company'>('all');

  const [editPctMode, setEditPctMode] = useState(false);
  const [editingPctId, setEditingPctId] = useState<string | null>(null);
  const [editPctForm, setEditPctForm] = useState({ lg: 60, cn: 40, khoanType: 'pct' as 'pct' | 'fixed' | 'tiered', fixedFee: 0, tiers: [] as KhoanTierDef[] });
  const [branchKhoanEditing, setBranchKhoanEditing] = useState(false);
  const [branchKhoanForm, setBranchKhoanForm] = useState({ khoanType: 'pct' as 'pct' | 'fixed' | 'tiered', lg: 60, cn: 40, fixedFee: 0, tiers: [] as KhoanTierDef[] });

  const [deleteTarget, setDeleteTarget] = useState<Branch | null>(null);
  const [deletePassword, setDeletePassword] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  const [month] = useState(currentMonthStr());
  const prevMonth = useMemo(() => shiftMonth(month, -1), [month]);
  const [projectsPnl, setProjectsPnl] = useState<ProjectPnl[]>([]);
  const [overhead, setOverhead] = useState<BranchOverhead[]>([]);
  const [prevProjectsPnl, setPrevProjectsPnl] = useState<ProjectPnl[]>([]);
  const [prevOverhead, setPrevOverhead] = useState<BranchOverhead[]>([]);

  // ── Manager performance report ──────────────────────────────────
  const [perfHistory, setPerfHistory] = useState<(ClientManagerHistory & { clients?: { name: string } | null })[]>([]);
  const [perfPnl, setPerfPnl] = useState<ProjectPnl[]>([]);
  const [perfLoading, setPerfLoading] = useState(false);

  const [laborByClient, setLaborByClient] = useState<Record<string, LaborHistoryEntry[]>>({});

  useEffect(() => {
    (async () => {
      const [{ data: pj }, { data: oh }, { data: ppj }, { data: poh }] = await Promise.all([
        supabase.from('projects_pnl').select('*').eq('month', month),
        supabase.from('branch_overhead').select('*').eq('month', month),
        supabase.from('projects_pnl').select('*').eq('month', prevMonth),
        supabase.from('branch_overhead').select('*').eq('month', prevMonth),
      ]);
      setProjectsPnl((pj || []) as ProjectPnl[]);
      setOverhead((oh || []) as BranchOverhead[]);
      setPrevProjectsPnl((ppj || []) as ProjectPnl[]);
      setPrevOverhead((poh || []) as BranchOverhead[]);

      const tieredBranchRegions = branches.filter(b => b.khoan_type === 'tiered').map(b => b.region).filter(Boolean) as string[];
      const tieredClientIds = tieredBranchRegions.length ? clients.filter(c => c.region && tieredBranchRegions.includes(c.region)).map(c => c.id) : [];
      if (tieredClientIds.length) {
        const curMonthNum = parseInt(month.split('-')[1], 10);
        const prefix = `T${curMonthNum}W`;
        const { data: lh } = await supabase.from('client_labor_history').select('*').in('client_id', tieredClientIds).like('week_label', `${prefix}%`);
        const map: Record<string, LaborHistoryEntry[]> = {};
        for (const e of (lh || []) as LaborHistoryEntry[]) {
          if (!map[e.client_id]) map[e.client_id] = [];
          map[e.client_id].push(e);
        }
        setLaborByClient(map);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, prevMonth, clients, branches]);

  // Fetch manager-transfer history + P&L for the performance report tab.
  useEffect(() => {
    if (activeTab !== 'performance' || !selected?.manager_name) {
      setPerfHistory([]);
      setPerfPnl([]);
      return;
    }
    let active = true;
    setPerfLoading(true);
    (async () => {
      const { data: hist } = await supabase.from('client_manager_history').select('*, clients(name)').eq('manager_name', selected.manager_name).order('effective_from');
      const histList = (hist || []) as (ClientManagerHistory & { clients?: { name: string } | null })[];
      const clientIds = Array.from(new Set(histList.map(h => h.client_id)));
      let pnlList: ProjectPnl[] = [];
      if (clientIds.length) {
        const { data: pnl } = await supabase.from('projects_pnl').select('*').in('client_id', clientIds);
        pnlList = (pnl || []) as ProjectPnl[];
      }
      if (!active) return;
      setPerfHistory(histList);
      setPerfPnl(pnlList);
      setPerfLoading(false);
    })();
    return () => { active = false; };
  }, [activeTab, selected?.manager_name]);

  // Compute the period each history entry covers, and the revenue/profit within it.
  const perfRows = useMemo(() => {
    if (!perfHistory.length) return [];
    const byClient: Record<string, (ClientManagerHistory & { clients?: { name: string } | null })[]> = {};
    for (const h of perfHistory) {
      if (!byClient[h.client_id]) byClient[h.client_id] = [];
      byClient[h.client_id].push(h);
    }
    const nowMonth = currentMonthStr();
    const rows: { id: string; clientName: string; from: string; to: string; revenue: number; profit: number }[] = [];
    for (const clientId of Object.keys(byClient)) {
      const entries = [...byClient[clientId]].sort((a, b) => a.effective_from.localeCompare(b.effective_from));
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        if (e.manager_name !== selected?.manager_name) continue;
        const from = e.effective_from;
        const to = i + 1 < entries.length ? shiftMonth(entries[i + 1].effective_from, -1) : nowMonth;
        const pnlInRange = perfPnl.filter(p => p.client_id === clientId && p.month >= from && p.month <= to);
        const revenue = pnlInRange.reduce((s, p) => s + (p.revenue || 0), 0);
        const profit = pnlInRange.reduce((s, p) => {
          if (p.project_type === 'shared') return s + (p.revenue || 0) * (p.cn_pct || 0) / 100;
          return s;
        }, 0);
        rows.push({ id: e.id, clientName: e.clients?.name || '—', from, to, revenue, profit });
      }
    }
    return rows.sort((a, b) => b.from.localeCompare(a.from));
  }, [perfHistory, perfPnl, selected?.manager_name]);

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

  const [showHistory, setShowHistory] = useState(false);
  const [branchTypeHistory, setBranchTypeHistory] = useState<BranchTypeHistory[]>([]);
  const [showTypeHistory, setShowTypeHistory] = useState(false);
  const [newTypeEntry, setNewTypeEntry] = useState({ branch_type: 'company' as 'contracted' | 'company', effective_from: '', manager_name: '', lg_pct: 60, cn_pct: 40, notes: '' });
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);
  const [recordDate, setRecordDate] = useState(todayStr());
  useEffect(() => { setShowHistory(false); setShowTypeHistory(false); setRecordDate(todayStr()); }, [selectedId]);
  useEffect(() => {
    if (!selectedId) { setBranchTypeHistory([]); return; }
    supabase.from('branch_type_history').select('*').eq('branch_id', selectedId).order('effective_from', { ascending: false })
      .then(({ data }) => setBranchTypeHistory((data ?? []) as BranchTypeHistory[]));
  }, [selectedId]);

  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  const handleAvatarUpload = async (file: File) => {
    if (!selected) return;
    setUploadingAvatar(true);
    try {
      const ext = file.name.split('.').pop() || 'jpg';
      const path = `branch-managers/${selected.id}-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from('avatars').upload(path, file, { upsert: true });
      if (upErr) throw upErr;
      const { data } = supabase.storage.from('avatars').getPublicUrl(path);
      await updateBranch(selected.id, { manager_avatar_url: data.publicUrl });
      setF({ manager_avatar_url: data.publicUrl });
      toast('Đã cập nhật ảnh đại diện');
    } catch (e) {
      toast('Lỗi: ' + errMsg(e));
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleRemoveAvatar = async () => {
    if (!selected) return;
    try {
      await updateBranch(selected.id, { manager_avatar_url: null });
      setF({ manager_avatar_url: null });
      toast('Đã xóa ảnh đại diện');
    } catch (e) {
      toast('Lỗi: ' + errMsg(e));
    }
  };

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
        status_note: form.status_note ?? null,
        difficulties: form.difficulties ?? null,
        opportunities: form.opportunities ?? null,
      });
      if (form.region) await ensureRegion(form.region);
      if (user && form.region) {
        await recordBranchUpdateSession(user.id, form.region, {
          status_note: form.status_note ?? null,
          difficulties: form.difficulties ?? null,
          opportunities: form.opportunities ?? null,
        }, recordDate);
        setHistoryRefreshKey(k => k + 1);
        setRecordDate(todayStr());
      }
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
        manager_avatar_url: null,
        address: null,
        phone: null,
        email: null,
        established_date: null,
        status: 'active',
        branch_type: newBranch.branch_type,
        notes: null,
        status_note: null,
        difficulties: null,
        opportunities: null,
      });
      if (region) await ensureRegion(region);
      toast('Da them chi nhanh');
      setAdding(false);
      setNewBranch({ name: '', short_name: '', region: '', manager_name: '', location: '', map_link: '', branch_type: 'contracted' });
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
          manager_avatar_url: null,
          region: name,
          location: null,
          map_link: null,
          address: null,
          phone: null,
          email: null,
          established_date: null,
          status: 'active',
          branch_type: 'contracted',
          notes: null,
          status_note: null,
          difficulties: null,
          opportunities: null,
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
      if (!user?.id) { toast('Phiên đăng nhập không hợp lệ'); return; }
      const { data: pwOk, error: authErr } = await supabase.rpc('verify_password', {
        p_user_id: user.id,
        p_password: deletePassword,
      });
      if (authErr) throw authErr;
      if (!pwOk) { toast('Sai mật khẩu, vui lòng thử lại'); return; }

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

  const peakWorkersMap = useMemo(() => {
    const map: Record<string, number> = {};
    for (const [clientId, entries] of Object.entries(laborByClient)) {
      map[clientId] = entries.reduce((mx, e) => Math.max(mx, e.count), 0);
    }
    return map;
  }, [laborByClient]);

  const branchPeakWorkers = useMemo(() => {
    const map: Record<string, number> = {};
    for (const b of branches) {
      if (b.khoan_type !== 'tiered' || !b.region) continue;
      const branchClientIds = clients.filter(c => c.region === b.region).map(c => c.id);
      const weekTotals: Record<string, number> = {};
      for (const cid of branchClientIds) {
        for (const e of (laborByClient[cid] || [])) {
          weekTotals[e.week_label] = (weekTotals[e.week_label] || 0) + e.count;
        }
      }
      map[b.id] = Object.values(weekTotals).reduce((mx, v) => Math.max(mx, v), 0);
    }
    return map;
  }, [branches, clients, laborByClient]);

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
      const workers = branchClients.filter(c => c.cooperation_status !== 'suspended').reduce((s, c) => s + (c.current_workers || 0), 0);
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

  // ── Previous month stats ─────────────────────────────────────
  const prevBranchLnRong = useMemo(() => {
    const map: Record<string, number> = {};
    for (const b of branches) {
      const projects = b.region ? prevProjectsPnl.filter(p => p.branch_manager === b.region) : [];
      const lnCn = projects.reduce((s, p) => {
        if (p.project_type === 'shared') return s + (p.revenue || 0) * (p.cn_pct || 0) / 100;
        return s;
      }, 0);
      const oh = b.region ? prevOverhead.filter(o => o.branch_manager === b.region).reduce((s, o) => s + (o.value || 0), 0) : 0;
      map[b.id] = lnCn - oh;
    }
    return map;
  }, [branches, prevProjectsPnl, prevOverhead]);

  // ── LN branch filter (multi-select) ────────────────────────
  const [lnBranchFilter, setLnBranchFilter] = useState<Set<string>>(new Set());
  const [showLnFilter, setShowLnFilter] = useState(false);
  const [showAlertPopup, setShowAlertPopup] = useState(false);

  function toggleLnBranch(id: string) {
    setLnBranchFilter(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // ── KPI strip ─────────────────────────────────────────────────
  const totalWorkers = clients.filter(c => c.cooperation_status !== 'suspended').reduce((s, c) => s + (c.current_workers || 0), 0);
  const totalActiveClients = clients.filter(c => c.client_type === 'active' && c.cooperation_status !== 'suspended').length;
  const lnFilterIds = lnBranchFilter.size > 0 ? lnBranchFilter : new Set(branches.map(b => b.id));
  const filteredLnRong = Object.entries(branchStats).filter(([id]) => lnFilterIds.has(id)).reduce((s, [, v]) => s + v.lnRong, 0);
  const filteredPrevLnRong = Object.entries(prevBranchLnRong).filter(([id]) => lnFilterIds.has(id)).reduce((s, [, v]) => s + v, 0);
  const thisMonthNum = Number(month.split('-')[1]);
  const prevMonthNum = Number(prevMonth.split('-')[1]);
  const needsAttention = branches.filter(b => (branchStats[b.id]?.alerts.length || 0) > 0).length;
  const alertBranches = branches.filter(b => (branchStats[b.id]?.alerts.length || 0) > 0);
  const displayBranches = useMemo(() => filterType === 'all' ? branches : branches.filter(b => (b.branch_type || 'contracted') === filterType), [branches, filterType]);

  // Avatar of the branch's "Trưởng Chi Nhánh" — falls back to the branch initials circle.
  const renderAvatar = (b: { manager_avatar_url?: string | null; name?: string; short_name?: string | null }, size: number) => {
    if (b.manager_avatar_url) {
      return <img src={b.manager_avatar_url} alt="" className="rounded-full object-cover shrink-0" style={{ width: size, height: size }} />;
    }
    const label = (b.short_name || b.name || '??').slice(0, 2).toUpperCase();
    return (
      <div className="rounded-full bg-[#E1F5EE] text-[#085041] flex items-center justify-center font-semibold shrink-0" style={{ width: size, height: size, fontSize: Math.round(size * 0.35) }}>
        {label}
      </div>
    );
  };

  // ════════════════════════════════════════════════════════════════
  // DETAIL VIEW
  // ════════════════════════════════════════════════════════════════
  if (selected) {
    const stats = branchStats[selected.id];
    void overhead;

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
              <div className="flex justify-center mb-2">
                <input
                  type="file" accept="image/*" id="manager-avatar-input" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleAvatarUpload(f); e.target.value = ''; }}
                />
                <label
                  htmlFor="manager-avatar-input"
                  className={`group relative inline-flex rounded-full cursor-pointer ${uploadingAvatar ? 'opacity-50 pointer-events-none' : ''}`}
                  style={{ width: 48, height: 48 }}
                >
                  {renderAvatar(form, 48)}
                  <div className="absolute inset-0 rounded-full bg-black/0 group-hover:bg-black/40 flex items-center justify-center transition-colors">
                    <Pencil size={14} className="text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                  {form.manager_avatar_url && (
                    <button
                      type="button"
                      onClick={e => { e.preventDefault(); e.stopPropagation(); handleRemoveAvatar(); }}
                      className="absolute -top-1 -right-1 w-[18px] h-[18px] rounded-full bg-red-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
                      title="Xóa ảnh"
                    >
                      <X size={10} />
                    </button>
                  )}
                </label>
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
              <div className="space-y-4">
                {/* Action bar */}
                <div className="flex items-center justify-between">
                  <div className="text-[13px] font-semibold text-[#111]">Ho so chi nhanh</div>
                  <div className="flex items-center gap-2">
                    <button onClick={saveProfile} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-[12px] font-medium bg-[#0F6E56] text-white hover:opacity-90 transition shadow-sm">
                      <Save size={13} /> Luu thay doi
                    </button>
                    <button onClick={() => handleDeleteBranch(selected)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-medium text-red-600 border border-red-200 hover:bg-red-50 transition">
                      <Trash2 size={13} /> Xoa
                    </button>
                  </div>
                </div>

                {/* Section 1: Thong tin co ban */}
                <div className="bg-white border border-[#E8E7E2] rounded-xl overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-[#E8E7E2] bg-[#FAFAF8]">
                    <div className="flex items-center gap-2 text-[12px] font-semibold text-[#444] uppercase tracking-wide">
                      <Building2 size={14} className="text-[#0F6E56]" />
                      Thong tin co ban
                    </div>
                  </div>
                  <div className="p-4 grid grid-cols-2 gap-x-6 gap-y-4">
                    <Field label="Ten chi nhanh">
                      <input value={form.name || ''} onChange={e => setF({ name: e.target.value })} className="field-input" />
                    </Field>
                    <Field label="Ten rut gon">
                      <input value={form.short_name || ''} onChange={e => setF({ short_name: e.target.value })} className="field-input" />
                    </Field>
                    <Field label="Quan ly phu trach">
                      <input value={form.manager_name || ''} onChange={e => setF({ manager_name: e.target.value })} className="field-input" list="manager-options" placeholder="Ten quan ly" />
                    </Field>
                    <Field label="Khu vuc phu trach (lien ket KH)">
                      <input value={form.region || ''} onChange={e => setF({ region: e.target.value })} className="field-input" list="region-options" placeholder="Ten khu vuc" />
                    </Field>
                    <Field label="Trang thai">
                      <select value={form.status || 'active'} onChange={e => setF({ status: e.target.value as BranchStatus })} className="field-input">
                        <option value="active">Hoat dong</option>
                        <option value="paused">Tam dung</option>
                      </select>
                    </Field>
                    <Field label="Ngay thanh lap">
                      <input type="date" value={form.established_date || ''} onChange={e => setF({ established_date: e.target.value })} className="field-input" />
                    </Field>
                  </div>
                </div>

                {/* Section 2: Dia chi & lien he (an cho LGV Cong ty vi da co trong Van hanh) */}
                {selected.short_name !== 'LGV' && (
                <div className="bg-white border border-[#E8E7E2] rounded-xl overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-[#E8E7E2] bg-[#FAFAF8]">
                    <div className="flex items-center gap-2 text-[12px] font-semibold text-[#444] uppercase tracking-wide">
                      <MapPin size={14} className="text-[#2563EB]" />
                      Dia chi & lien he
                    </div>
                  </div>
                  <div className="p-4 grid grid-cols-2 gap-x-6 gap-y-4">
                    <Field label="Dia danh">
                      <select value={form.location || ''} onChange={e => setF({ location: e.target.value })} className="field-input">
                        <option value="">-- Chon dia danh --</option>
                        {PROVINCES.map(p => <option key={p} value={p}>{p}</option>)}
                        {form.location && !PROVINCES.includes(form.location) && <option value={form.location}>{form.location}</option>}
                      </select>
                    </Field>
                    <Field label="Dia chi van phong">
                      <input value={form.address || ''} onChange={e => setF({ address: e.target.value })} className="field-input" />
                    </Field>
                    <Field label="So dien thoai">
                      <input value={form.phone || ''} onChange={e => setF({ phone: e.target.value })} className="field-input" />
                    </Field>
                    <Field label="Email">
                      <input value={form.email || ''} onChange={e => setF({ email: e.target.value })} className="field-input" />
                    </Field>
                    <Field label="Link Google Maps" full>
                      <div className="flex gap-2">
                        <input value={form.map_link || ''} onChange={e => setF({ map_link: e.target.value })} className="field-input flex-1" placeholder="https://maps.app.goo.gl/..." />
                        {form.map_link && (
                          <a href={form.map_link} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[12px] font-medium border border-gray-300 text-[#666] hover:bg-[#F5F4EF] transition shrink-0">
                            <MapPin size={13} /> Xem ban do
                          </a>
                        )}
                      </div>
                    </Field>
                  </div>
                </div>
                )}

                {/* Section 3: Ghi chu */}
                <div className="bg-white border border-[#E8E7E2] rounded-xl overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-[#E8E7E2] bg-[#FAFAF8]">
                    <div className="flex items-center gap-2 text-[12px] font-semibold text-[#444] uppercase tracking-wide">
                      <Pencil size={14} className="text-[#D97706]" />
                      Ghi chu
                    </div>
                  </div>
                  <div className="p-4">
                    <textarea value={form.notes || ''} onChange={e => setF({ notes: e.target.value })} className="field-input min-h-[80px] resize-y w-full" placeholder="Ghi chu noi bo ve chi nhanh..." />
                  </div>
                </div>

                {/* Section: Lich su hinh thuc khoan */}
                <div className="bg-white border border-[#E8E7E2] rounded-xl overflow-hidden">
                  <button onClick={() => setShowTypeHistory(v => !v)}
                    className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-[#FAFAF8] transition-colors">
                    <span className="flex items-center gap-2 text-[12px] font-semibold text-[#444] uppercase tracking-wide">
                      <ClipboardList size={14} className="text-[#1D4ED8]" />
                      Hinh thuc khoan & phan chia loi nhuan
                    </span>
                    <div className="flex items-center gap-2">
                      {branchTypeHistory.length > 0 && (
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${branchTypeHistory[0].branch_type === 'company' ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                          {branchTypeHistory[0].branch_type === 'company' ? 'Du An CT' : `Da Khoan ${branchTypeHistory[0].lg_pct}/${branchTypeHistory[0].cn_pct}`}
                        </span>
                      )}
                      {showTypeHistory ? <ChevronUp size={14} className="text-[#999]" /> : <ChevronDown size={14} className="text-[#999]" />}
                    </div>
                  </button>
                  {showTypeHistory && (
                    <div className="px-4 pb-4 border-t border-[#E8E7E2] pt-3 space-y-3">
                      <div className="bg-gray-50 rounded-lg p-3 space-y-2">
                        <div className="text-[10.5px] text-[#999] uppercase font-medium">Them moc thoi gian</div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-[10px] text-[#999] block mb-0.5">Ap dung tu thang</label>
                            <input type="month" value={newTypeEntry.effective_from} onChange={e => setNewTypeEntry(v => ({ ...v, effective_from: e.target.value }))}
                              className="w-full text-[12px] px-2 py-1.5 border border-gray-300 rounded-lg outline-none focus:border-blue-500" />
                          </div>
                          <div>
                            <label className="text-[10px] text-[#999] block mb-0.5">Hinh thuc</label>
                            <select value={newTypeEntry.branch_type} onChange={e => {
                              const t = e.target.value as 'contracted' | 'company';
                              setNewTypeEntry(v => ({ ...v, branch_type: t, lg_pct: t === 'company' ? 100 : 60, cn_pct: t === 'company' ? 0 : 40 }));
                            }} className="w-full text-[12px] px-2 py-1.5 border border-gray-300 rounded-lg outline-none focus:border-blue-500">
                              <option value="company">Du An Cong Ty (LGV 100%)</option>
                              <option value="contracted">Da Khoan (chia %)</option>
                            </select>
                          </div>
                          {newTypeEntry.branch_type === 'contracted' && (
                            <>
                              <div>
                                <label className="text-[10px] text-[#999] block mb-0.5">Nguoi nhan khoan</label>
                                <select value={newTypeEntry.manager_name} onChange={e => setNewTypeEntry(v => ({ ...v, manager_name: e.target.value }))}
                                  className="w-full text-[12px] px-2 py-1.5 border border-gray-300 rounded-lg outline-none focus:border-blue-500">
                                  <option value="">-- Chon --</option>
                                  {managers.map(m => <option key={m.id} value={m.name}>{m.name}</option>)}
                                </select>
                              </div>
                              <div className="flex items-end gap-2">
                                <div className="flex-1">
                                  <label className="text-[10px] text-[#999] block mb-0.5">LGV %</label>
                                  <input type="number" min={0} max={100} value={newTypeEntry.lg_pct}
                                    onChange={e => { const v = Math.max(0, Math.min(100, +e.target.value)); setNewTypeEntry(prev => ({ ...prev, lg_pct: v, cn_pct: 100 - v })); }}
                                    className="w-full text-[12px] px-2 py-1.5 border border-gray-300 rounded-lg outline-none focus:border-blue-500 text-center" />
                                </div>
                                <div className="flex-1">
                                  <label className="text-[10px] text-[#999] block mb-0.5">CN %</label>
                                  <div className="text-[12px] px-2 py-1.5 bg-gray-100 rounded-lg text-center">{newTypeEntry.cn_pct}</div>
                                </div>
                              </div>
                            </>
                          )}
                          <div className="col-span-2">
                            <label className="text-[10px] text-[#999] block mb-0.5">Ghi chu</label>
                            <input value={newTypeEntry.notes} onChange={e => setNewTypeEntry(v => ({ ...v, notes: e.target.value }))}
                              placeholder="VD: Mr Hung nhan khoan tu T6/2026"
                              className="w-full text-[12px] px-2 py-1.5 border border-gray-300 rounded-lg outline-none focus:border-blue-500" />
                          </div>
                        </div>
                        <button onClick={async () => {
                          if (!selected || !newTypeEntry.effective_from) { toast('Chon thang ap dung'); return; }
                          const { data, error } = await supabase.from('branch_type_history').insert({
                            branch_id: selected.id,
                            branch_type: newTypeEntry.branch_type,
                            effective_from: newTypeEntry.effective_from,
                            manager_name: newTypeEntry.branch_type === 'contracted' ? newTypeEntry.manager_name || null : null,
                            lg_pct: newTypeEntry.lg_pct,
                            cn_pct: newTypeEntry.cn_pct,
                            notes: newTypeEntry.notes || null,
                            created_by: user?.full_name || null,
                          }).select().single();
                          if (error) { toast('Loi: ' + error.message); return; }
                          setBranchTypeHistory(prev => [data as BranchTypeHistory, ...prev].sort((a, b) => b.effective_from.localeCompare(a.effective_from)));
                          const newType = newTypeEntry.branch_type;
                          if (selected.branch_type !== newType) await updateBranch(selected.id, { branch_type: newType });
                          setNewTypeEntry({ branch_type: 'company', effective_from: '', manager_name: '', lg_pct: 60, cn_pct: 40, notes: '' });
                          toast('Da them moc thoi gian');
                        }} disabled={!newTypeEntry.effective_from}
                          className="w-full py-1.5 rounded-lg text-[11px] font-medium bg-[#1D4ED8] text-white hover:bg-[#1E40AF] disabled:opacity-40 transition">
                          Luu
                        </button>
                      </div>

                      {branchTypeHistory.length === 0 ? (
                        <div className="text-[12px] text-[#999] text-center py-3">Chua co lich su. Them moc dau tien phia tren.</div>
                      ) : (
                        <div className="space-y-1.5">
                          {branchTypeHistory.map(h => (
                            <div key={h.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-gray-50 group">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="text-[12px] font-medium text-[#111]">
                                    T{Number(h.effective_from.split('-')[1])}/{h.effective_from.split('-')[0]}
                                  </span>
                                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${h.branch_type === 'company' ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700'}`}>
                                    {h.branch_type === 'company' ? 'Du An CT' : `Khoan ${h.lg_pct}/${h.cn_pct}`}
                                  </span>
                                  {h.manager_name && <span className="text-[11px] text-[#666]">{h.manager_name}</span>}
                                </div>
                                {h.notes && <div className="text-[10.5px] text-[#888] mt-0.5">{h.notes}</div>}
                              </div>
                              <button onClick={async () => {
                                await supabase.from('branch_type_history').delete().eq('id', h.id);
                                setBranchTypeHistory(prev => prev.filter(x => x.id !== h.id));
                                toast('Da xoa');
                              }} className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-600 transition">
                                <Trash2 size={12} />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Section 4: Lich su trao doi */}
                <div className="bg-white border border-[#E8E7E2] rounded-xl overflow-hidden">
                  <button
                    onClick={() => setShowHistory(v => !v)}
                    className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-[#FAFAF8] transition-colors"
                  >
                    <span className="flex items-center gap-2 text-[12px] font-semibold text-[#444] uppercase tracking-wide">
                      <History size={14} className="text-[#7C3AED]" />
                      Lich su trao doi & tinh trang / kho khan / co hoi
                    </span>
                    {showHistory ? <ChevronUp size={14} className="text-[#999]" /> : <ChevronDown size={14} className="text-[#999]" />}
                  </button>
                  {showHistory && (
                    <div className="px-4 pb-4 border-t border-[#E8E7E2]">
                      <div className="pt-4">
                        <BranchHistoryFields branch={form as Branch} onChange={setF} refreshKey={historyRefreshKey} recordDate={recordDate} onRecordDateChange={setRecordDate} />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'operations' && (
              <>
              <div className="bg-white border border-[#E8E7E2] rounded-xl overflow-hidden">
                <div className="px-3.5 py-2.5 border-b border-[#E8E7E2] flex items-center gap-2">
                  <Building2 size={15} className="text-[#999]" />
                  <div className="text-[12.5px] font-semibold text-[#111] flex-1">Khách hàng đang phụ trách</div>
                  <span className="text-[11px] text-[#999]">{stats?.branchClients.length || 0} KH · {stats?.workers.toLocaleString() || 0} LĐ tổng</span>
                  <button onClick={() => { setEditPctMode(v => !v); setEditingPctId(null); }}
                    className={`p-1 rounded-md transition ${editPctMode ? 'bg-blue-50 text-blue-600' : 'text-[#ccc] hover:text-[#888] hover:bg-[#F5F4EF]'}`}
                    title="Chỉnh tỷ lệ khoán">
                    <Settings2 size={14} />
                  </button>
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
                        <th className="text-center font-medium px-3 py-2">Loai du an</th>
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
                              <div className="font-medium text-[#111] flex items-center gap-1.5">
                                {c.name}
                                {c.cooperation_status === 'suspended' && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-600 border border-red-200 font-medium">Ngưng</span>
                                )}
                              </div>
                              <div className="text-[10.5px] text-[#999]">{c.industrial_zones?.[0] || '—'}</div>
                            </td>
                            <td className="px-3 py-2 text-center">
                              {editPctMode && editingPctId === c.id ? (
                                <div className="flex flex-col gap-1.5 items-center min-w-[200px]">
                                  <div className="flex items-center gap-1">
                                    <select value={c.project_type || 'contracted'}
                                      onChange={async e => {
                                        const pt = e.target.value as 'managed' | 'contracted';
                                        const lg = pt === 'managed' ? 100 : editPctForm.lg;
                                        const cn = pt === 'managed' ? 0 : editPctForm.cn;
                                        await supabase.from('clients').update({ project_type: pt, default_lg_pct: lg, default_cn_pct: cn }).eq('id', c.id);
                                        Object.assign(c, { project_type: pt, default_lg_pct: lg, default_cn_pct: cn });
                                        toast(`${c.name}: ${pt === 'managed' ? 'Dự án CT' : 'Đã khoán'}`);
                                      }}
                                      className="text-[10px] px-1 py-0.5 rounded border border-[#ddd] outline-none bg-white">
                                      <option value="contracted">Khoán</option>
                                      <option value="managed">Dự án CT</option>
                                    </select>
                                    <button onClick={async () => {
                                      const updates: Partial<Client> = {};
                                      if ((c.project_type || 'contracted') === 'contracted') {
                                        updates.khoan_type = editPctForm.khoanType;
                                        if (editPctForm.khoanType === 'pct') {
                                          updates.default_lg_pct = editPctForm.lg;
                                          updates.default_cn_pct = editPctForm.cn;
                                          updates.khoan_fixed_fee = 0;
                                          updates.khoan_tiers = undefined;
                                        } else if (editPctForm.khoanType === 'fixed') {
                                          updates.khoan_fixed_fee = editPctForm.fixedFee;
                                          updates.khoan_tiers = undefined;
                                        } else {
                                          updates.khoan_tiers = editPctForm.tiers;
                                          updates.khoan_fixed_fee = 0;
                                        }
                                      }
                                      if (Object.keys(updates).length > 0) {
                                        await supabase.from('clients').update(updates).eq('id', c.id);
                                        Object.assign(c, updates);
                                      }
                                      setEditingPctId(null);
                                      toast(`${c.name}: Đã cập nhật khoán`);
                                    }} className="p-0.5 rounded bg-blue-600 text-white hover:bg-blue-700"><Check size={10} /></button>
                                    <button onClick={() => setEditingPctId(null)} className="p-0.5 rounded bg-gray-200 text-gray-600 hover:bg-gray-300"><X size={10} /></button>
                                  </div>
                                  {(c.project_type || 'contracted') === 'contracted' && (
                                    <>
                                      <select value={editPctForm.khoanType}
                                        onChange={e => {
                                          const kt = e.target.value as 'pct' | 'fixed' | 'tiered';
                                          setEditPctForm(prev => ({
                                            ...prev, khoanType: kt,
                                            tiers: kt === 'tiered' && prev.tiers.length === 0
                                              ? [{ min_workers: 0, lg_pct: prev.lg, cn_pct: prev.cn }, { min_workers: 300, lg_pct: 50, cn_pct: 50 }]
                                              : prev.tiers,
                                          }));
                                        }}
                                        className="text-[10px] px-1 py-0.5 rounded border border-[#ddd] outline-none bg-white w-full">
                                        <option value="pct">Theo tỷ lệ %</option>
                                        <option value="fixed">Phí cố định/công</option>
                                        <option value="tiered">Theo bậc LĐ</option>
                                      </select>
                                      {editPctForm.khoanType === 'pct' && (
                                        <div className="flex items-center gap-1">
                                          <span className="text-[9px] text-[#999]">LG</span>
                                          <input type="number" min={0} max={100} value={editPctForm.lg}
                                            onChange={e => { const v = Math.max(0, Math.min(100, +e.target.value)); setEditPctForm(prev => ({ ...prev, lg: v, cn: 100 - v })); }}
                                            className="w-9 text-[10px] px-1 py-0.5 rounded border border-[#ddd] text-center outline-none" />
                                          <span className="text-[9px] text-[#999]">CN</span>
                                          <span className="text-[10px] font-medium text-[#666] w-5">{editPctForm.cn}</span>
                                        </div>
                                      )}
                                      {editPctForm.khoanType === 'fixed' && (
                                        <div className="flex items-center gap-1">
                                          <input type="number" min={0} value={editPctForm.fixedFee}
                                            onChange={e => setEditPctForm(prev => ({ ...prev, fixedFee: Math.max(0, +e.target.value) }))}
                                            className="w-20 text-[10px] px-1 py-0.5 rounded border border-[#ddd] text-center outline-none" />
                                          <span className="text-[9px] text-[#999]">đ/người/công</span>
                                        </div>
                                      )}
                                      {editPctForm.khoanType === 'tiered' && (
                                        <div className="flex flex-col gap-1 w-full">
                                          {editPctForm.tiers.map((tier, ti) => (
                                            <div key={ti} className="flex items-center gap-1 bg-[#F9F9F6] rounded px-1.5 py-1">
                                              <span className="text-[9px] text-[#999] shrink-0">≥</span>
                                              <input type="number" min={0} value={tier.min_workers}
                                                onChange={e => { const tiers = [...editPctForm.tiers]; tiers[ti] = { ...tier, min_workers: Math.max(0, +e.target.value) }; setEditPctForm(prev => ({ ...prev, tiers })); }}
                                                className="w-12 text-[10px] px-1 py-0.5 rounded border border-[#ddd] text-center outline-none" />
                                              <span className="text-[9px] text-[#999]">LĐ →</span>
                                              <span className="text-[9px] text-[#999]">LG</span>
                                              <input type="number" min={0} max={100} value={tier.lg_pct}
                                                onChange={e => { const v = Math.max(0, Math.min(100, +e.target.value)); const tiers = [...editPctForm.tiers]; tiers[ti] = { ...tier, lg_pct: v, cn_pct: 100 - v }; setEditPctForm(prev => ({ ...prev, tiers })); }}
                                                className="w-8 text-[10px] px-0.5 py-0.5 rounded border border-[#ddd] text-center outline-none" />
                                              <span className="text-[9px] text-[#999]">CN</span>
                                              <span className="text-[10px] font-medium text-[#666] w-4">{tier.cn_pct}</span>
                                              {editPctForm.tiers.length > 1 && (
                                                <button onClick={() => { const tiers = editPctForm.tiers.filter((_, i) => i !== ti); setEditPctForm(prev => ({ ...prev, tiers })); }}
                                                  className="p-0.5 text-red-400 hover:text-red-600"><Trash2 size={9} /></button>
                                              )}
                                            </div>
                                          ))}
                                          <button onClick={() => {
                                            const last = editPctForm.tiers[editPctForm.tiers.length - 1];
                                            setEditPctForm(prev => ({ ...prev, tiers: [...prev.tiers, { min_workers: (last?.min_workers || 0) + 100, lg_pct: 50, cn_pct: 50 }] }));
                                          }} className="text-[9px] text-blue-600 hover:text-blue-800 self-start flex items-center gap-0.5">
                                            <Plus size={9} /> Thêm bậc
                                          </button>
                                        </div>
                                      )}
                                    </>
                                  )}
                                </div>
                              ) : (
                                <span onClick={() => {
                                  if (!editPctMode) return;
                                  setEditingPctId(c.id);
                                  setEditPctForm({
                                    lg: c.default_lg_pct ?? 60, cn: c.default_cn_pct ?? 40,
                                    khoanType: (c.khoan_type || 'pct') as 'pct' | 'fixed' | 'tiered',
                                    fixedFee: c.khoan_fixed_fee || 0,
                                    tiers: (c.khoan_tiers || []) as KhoanTierDef[],
                                  });
                                }}
                                  className={`text-[10px] px-1.5 py-0.5 rounded font-medium inline-block ${
                                    c.project_type === 'managed' ? 'bg-blue-50 text-blue-700'
                                    : 'bg-[#EAF3DE] text-[#27500A]'
                                  } ${editPctMode ? 'cursor-pointer ring-1 ring-blue-300 hover:ring-blue-500' : ''}`}>
                                  {(() => {
                                    if (c.project_type === 'managed') return 'Dự án CT';
                                    const bkt = selected.khoan_type || 'pct';
                                    if (bkt === 'tiered') {
                                      const tiers = (selected.khoan_tiers || []) as KhoanTierDef[];
                                      const peak = branchPeakWorkers[selected.id] || (stats?.workers || 0);
                                      const active = resolveActiveTier(tiers, peak);
                                      if (active) return `LG ${active.lg_pct} / CN ${active.cn_pct}`;
                                    }
                                    if (bkt === 'fixed') return `${(selected.khoan_fixed_fee || 0).toLocaleString('vi-VN')}đ/công`;
                                    return `Khoán LG ${c.default_lg_pct ?? 60} / CN ${c.default_cn_pct ?? 40}`;
                                  })()}
                                </span>
                              )}
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
              {/* Cài đặt khoán chi nhánh */}
              {selected && (
                <div className="mt-4 bg-white border border-[#E8E7E2] rounded-xl overflow-hidden">
                  <div className="px-3.5 py-2.5 border-b border-[#E8E7E2] flex items-center gap-2">
                    <Wallet size={15} className="text-[#999]" />
                    <div className="text-[12.5px] font-semibold text-[#111] flex-1">Cài đặt khoán chi nhánh</div>
                    {!branchKhoanEditing ? (
                      <button onClick={() => {
                        setBranchKhoanEditing(true);
                        setBranchKhoanForm({
                          khoanType: (selected.khoan_type || 'pct') as 'pct' | 'fixed' | 'tiered',
                          lg: selected.branch_type === 'company' ? 100 : 60,
                          cn: selected.branch_type === 'company' ? 0 : 40,
                          fixedFee: selected.khoan_fixed_fee || 0,
                          tiers: (selected.khoan_tiers || []) as KhoanTierDef[],
                        });
                      }} className="text-[10px] text-blue-600 hover:text-blue-800 flex items-center gap-1">
                        <Pencil size={11} /> Chỉnh sửa
                      </button>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <button onClick={async () => {
                          await updateBranch(selected.id, {
                            khoan_type: branchKhoanForm.khoanType,
                            khoan_fixed_fee: branchKhoanForm.khoanType === 'fixed' ? branchKhoanForm.fixedFee : 0,
                            khoan_tiers: branchKhoanForm.khoanType === 'tiered' ? branchKhoanForm.tiers : null,
                          } as any);
                          setBranchKhoanEditing(false);
                          toast('Đã cập nhật cài đặt khoán');
                        }} className="text-[10px] px-2 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 flex items-center gap-1">
                          <Check size={10} /> Lưu
                        </button>
                        <button onClick={() => setBranchKhoanEditing(false)} className="text-[10px] px-2 py-1 rounded bg-gray-200 text-gray-600 hover:bg-gray-300">Huỷ</button>
                      </div>
                    )}
                  </div>
                  <div className="px-3.5 py-3">
                    {!branchKhoanEditing ? (
                      <div className="text-[12px] text-[#555]">
                        {(() => {
                          const kt = selected.khoan_type || 'pct';
                          if (kt === 'fixed') return (
                            <span className="inline-flex items-center gap-1.5">
                              <span className="px-2 py-0.5 rounded bg-purple-50 text-purple-700 font-medium">Phí cố định</span>
                              <span>{(selected.khoan_fixed_fee || 0).toLocaleString('vi-VN')}đ / người / công</span>
                            </span>
                          );
                          if (kt === 'tiered') {
                            const tiers = (selected.khoan_tiers || []) as KhoanTierDef[];
                            const totalW = stats?.workers || 0;
                            const peak = branchPeakWorkers[selected.id] || totalW;
                            const active = resolveActiveTier(tiers, peak);
                            return (
                              <div className="flex flex-col gap-1.5">
                                <div className="flex items-center gap-1.5">
                                  <span className="px-2 py-0.5 rounded bg-amber-50 text-amber-700 font-medium text-[11px]">Khoán theo bậc</span>
                                  <span className="text-[10px] text-[#999]">LĐ cao nhất tháng này: <span className="font-semibold text-[#333]">{peak.toLocaleString()}</span></span>
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                  {tiers.map((t, i) => {
                                    const isActive = active && t.min_workers === active.min_workers;
                                    return (
                                      <span key={i} className={`text-[11px] px-2 py-1 rounded-lg border ${isActive ? 'bg-emerald-50 border-emerald-300 text-emerald-800 font-semibold' : 'bg-[#F9F9F6] border-[#E8E7E2] text-[#888]'}`}>
                                        {isActive && '▸ '}≥ {t.min_workers} LĐ → LG {t.lg_pct} / CN {t.cn_pct}
                                      </span>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          }
                          return <span className="text-[#999]">Khoán theo tỷ lệ % (mặc định — cấu hình trên từng KH)</span>;
                        })()}
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2.5">
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] text-[#999] w-20 shrink-0">Loại khoán:</span>
                          <select value={branchKhoanForm.khoanType}
                            onChange={e => {
                              const kt = e.target.value as 'pct' | 'fixed' | 'tiered';
                              setBranchKhoanForm(prev => ({
                                ...prev, khoanType: kt,
                                tiers: kt === 'tiered' && prev.tiers.length === 0
                                  ? [{ min_workers: 0, lg_pct: 40, cn_pct: 60 }, { min_workers: 300, lg_pct: 50, cn_pct: 50 }]
                                  : prev.tiers,
                              }));
                            }}
                            className="text-[11px] px-2 py-1 rounded border border-[#ddd] outline-none bg-white">
                            <option value="pct">Theo tỷ lệ % (mặc định)</option>
                            <option value="fixed">Phí cố định / công</option>
                            <option value="tiered">Theo bậc lao động</option>
                          </select>
                        </div>
                        {branchKhoanForm.khoanType === 'fixed' && (
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] text-[#999] w-20 shrink-0">Phí/công:</span>
                            <input type="number" min={0} value={branchKhoanForm.fixedFee}
                              onChange={e => setBranchKhoanForm(prev => ({ ...prev, fixedFee: Math.max(0, +e.target.value) }))}
                              className="w-28 text-[11px] px-2 py-1 rounded border border-[#ddd] text-right outline-none" />
                            <span className="text-[10px] text-[#999]">đ/người/công</span>
                          </div>
                        )}
                        {branchKhoanForm.khoanType === 'tiered' && (
                          <div className="flex flex-col gap-1.5">
                            <span className="text-[11px] text-[#999]">Bậc thang — nếu LĐ cao nhất trong tháng đạt mốc sẽ tự áp dụng bậc tương ứng:</span>
                            {branchKhoanForm.tiers.map((tier, ti) => (
                              <div key={ti} className="flex items-center gap-1.5 bg-[#F9F9F6] rounded-lg px-2.5 py-1.5">
                                <span className="text-[10px] text-[#999]">≥</span>
                                <input type="number" min={0} value={tier.min_workers}
                                  onChange={e => { const tiers = [...branchKhoanForm.tiers]; tiers[ti] = { ...tier, min_workers: Math.max(0, +e.target.value) }; setBranchKhoanForm(prev => ({ ...prev, tiers })); }}
                                  className="w-16 text-[11px] px-1.5 py-0.5 rounded border border-[#ddd] text-center outline-none" />
                                <span className="text-[10px] text-[#999]">lao động →</span>
                                <span className="text-[10px] font-medium text-[#666]">LG</span>
                                <input type="number" min={0} max={100} value={tier.lg_pct}
                                  onChange={e => { const v = Math.max(0, Math.min(100, +e.target.value)); const tiers = [...branchKhoanForm.tiers]; tiers[ti] = { ...tier, lg_pct: v, cn_pct: 100 - v }; setBranchKhoanForm(prev => ({ ...prev, tiers })); }}
                                  className="w-10 text-[11px] px-1 py-0.5 rounded border border-[#ddd] text-center outline-none" />
                                <span className="text-[10px] font-medium text-[#666]">CN</span>
                                <span className="text-[11px] font-semibold text-[#333] w-6">{tier.cn_pct}</span>
                                {branchKhoanForm.tiers.length > 1 && (
                                  <button onClick={() => setBranchKhoanForm(prev => ({ ...prev, tiers: prev.tiers.filter((_, i) => i !== ti) }))}
                                    className="p-0.5 text-red-400 hover:text-red-600"><Trash2 size={11} /></button>
                                )}
                              </div>
                            ))}
                            <button onClick={() => {
                              const last = branchKhoanForm.tiers[branchKhoanForm.tiers.length - 1];
                              setBranchKhoanForm(prev => ({ ...prev, tiers: [...prev.tiers, { min_workers: (last?.min_workers || 0) + 100, lg_pct: 50, cn_pct: 50 }] }));
                            }} className="text-[10px] text-blue-600 hover:text-blue-800 self-start flex items-center gap-0.5 mt-0.5">
                              <Plus size={10} /> Thêm bậc
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
              {selected && (
                <div className="mt-4">
                  <BranchZones branchId={selected.id} branchClients={stats?.branchClients || []} allClients={clients} managers={managers}
                    staffs={branchStaffs} onAddStaff={addStaff} onUpdateStaff={updateStaff} onDeleteStaff={removeStaff}
                    overheadCategories={overheadCats} onAddCategory={addOverheadCat} onRenameCategory={renameOverheadCat} onDeleteCategory={removeOverheadCat} toast={toast} />
                </div>
              )}
              </>
            )}

            {activeTab === 'finance' && selected && (
              <BranchFinance branch={selected} toast={toast} />
            )}

            {activeTab === 'staff' && (
              <div className="space-y-4">
                <div className="bg-white border border-[#E8E7E2] rounded-xl overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-[#E8E7E2] bg-[#FAFAF8] flex items-center gap-2">
                    <Users size={15} className="text-[#2563EB]" />
                    <div className="text-[12px] font-semibold text-[#444] uppercase tracking-wide flex-1">Nhan su van phong chi nhanh</div>
                    <span className="text-[11px] text-[#999] mr-2">{branchStaffs.length} nguoi</span>
                    <button
                      onClick={() => { setStaffForm({ name: '', role: '', phone: '', email: '' }); setEditingStaffId(null); setStaffFormOpen(true); }}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[12px] font-medium bg-[#0F6E56] text-white hover:opacity-90 transition"
                    >
                      <Plus size={12} /> Them
                    </button>
                  </div>

                  {staffFormOpen && (
                    <div className="px-4 py-3 border-b border-[#E8E7E2] bg-blue-50/30">
                      <div className="grid grid-cols-2 gap-3 mb-3">
                        <div className="flex flex-col gap-1">
                          <label className="text-[10.5px] font-medium text-[#999] uppercase tracking-wide">Ho ten *</label>
                          <input value={staffForm.name} onChange={e => setStaffForm(f => ({ ...f, name: e.target.value }))} className="field-input" placeholder="Nhap ho ten" />
                        </div>
                        <div className="flex flex-col gap-1">
                          <label className="text-[10.5px] font-medium text-[#999] uppercase tracking-wide">Chuc vu</label>
                          <input value={staffForm.role} onChange={e => setStaffForm(f => ({ ...f, role: e.target.value }))} className="field-input" placeholder="VD: Nhan vien kinh doanh" />
                        </div>
                        <div className="flex flex-col gap-1">
                          <label className="text-[10.5px] font-medium text-[#999] uppercase tracking-wide">So dien thoai</label>
                          <input value={staffForm.phone} onChange={e => setStaffForm(f => ({ ...f, phone: e.target.value }))} className="field-input" placeholder="SDT" />
                        </div>
                        <div className="flex flex-col gap-1">
                          <label className="text-[10.5px] font-medium text-[#999] uppercase tracking-wide">Email</label>
                          <input value={staffForm.email} onChange={e => setStaffForm(f => ({ ...f, email: e.target.value }))} className="field-input" placeholder="Email" />
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          disabled={!staffForm.name.trim()}
                          onClick={async () => {
                            try {
                              if (editingStaffId) {
                                await updateStaff(editingStaffId, { name: staffForm.name, role: staffForm.role || null, phone: staffForm.phone || null, email: staffForm.email || null });
                                await logActivity({ user, action: 'update', table: 'branch_staffs', recordId: editingStaffId, description: `Cap nhat nhan su "${staffForm.name}" tai chi nhanh "${selected?.name}"` });
                                toast('Da cap nhat');
                              } else {
                                const added = await addStaff({ name: staffForm.name, role: staffForm.role || null, phone: staffForm.phone || null, email: staffForm.email || null });
                                await logActivity({ user, action: 'insert', table: 'branch_staffs', recordId: added.id, description: `Them nhan su "${staffForm.name}" vao chi nhanh "${selected?.name}"` });
                                toast('Da them nhan su');
                              }
                              setStaffFormOpen(false);
                              setEditingStaffId(null);
                            } catch (err: unknown) { toast('Loi: ' + errMsg(err)); }
                          }}
                          className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-[#0F6E56] text-white hover:opacity-90 transition disabled:opacity-50"
                        >
                          <Save size={12} /> {editingStaffId ? 'Cap nhat' : 'Luu'}
                        </button>
                        <button onClick={() => { setStaffFormOpen(false); setEditingStaffId(null); }} className="px-3 py-1.5 rounded-lg text-[12px] font-medium border border-gray-300 text-[#666] hover:bg-gray-50 transition">
                          Huy
                        </button>
                      </div>
                    </div>
                  )}

                  {staffLoading ? (
                    <div className="px-4 py-8 text-center text-[12px] text-[#999]">Dang tai...</div>
                  ) : branchStaffs.length === 0 ? (
                    <div className="px-4 py-8 text-center text-[12px] text-[#999]">Chua co nhan su. Bam "Them" de bat dau.</div>
                  ) : (
                    <table className="w-full text-[12px]">
                      <thead>
                        <tr className="text-[10px] text-[#999] uppercase bg-[#F5F4EF]">
                          <th className="text-left font-medium px-4 py-2">Ho ten</th>
                          <th className="text-left font-medium px-3 py-2">Chuc vu</th>
                          <th className="text-left font-medium px-3 py-2">SDT</th>
                          <th className="text-left font-medium px-3 py-2">Email</th>
                          <th className="text-center font-medium px-3 py-2 w-20"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {branchStaffs.map(s => (
                          <tr key={s.id} className="border-t border-[#F0EEE9] hover:bg-[#FAFAF8]">
                            <td className="px-4 py-2.5 font-medium text-[#111]">{s.name}</td>
                            <td className="px-3 py-2.5 text-[#555]">{s.role || '—'}</td>
                            <td className="px-3 py-2.5 text-[#555]">{s.phone || '—'}</td>
                            <td className="px-3 py-2.5 text-[#555]">{s.email || '—'}</td>
                            <td className="px-3 py-2.5 text-center">
                              <div className="flex items-center justify-center gap-1">
                                <button
                                  onClick={() => {
                                    setStaffForm({ name: s.name, role: s.role || '', phone: s.phone || '', email: s.email || '' });
                                    setEditingStaffId(s.id);
                                    setStaffFormOpen(true);
                                  }}
                                  className="p-1 rounded hover:bg-blue-50 text-[#999] hover:text-blue-600 transition"
                                  title="Sua"
                                >
                                  <Pencil size={13} />
                                </button>
                                <button
                                  onClick={async () => {
                                    if (!confirm(`Xoa nhan su "${s.name}"?`)) return;
                                    try {
                                      await removeStaff(s.id);
                                      await logActivity({ user, action: 'delete', table: 'branch_staffs', recordId: s.id, description: `Xoa nhan su "${s.name}" khoi chi nhanh "${selected?.name}"` });
                                      toast('Da xoa');
                                    } catch (err: unknown) { toast('Loi: ' + errMsg(err)); }
                                  }}
                                  className="p-1 rounded hover:bg-red-50 text-[#999] hover:text-red-600 transition"
                                  title="Xoa"
                                >
                                  <Trash2 size={13} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'performance' && (
              <div className="bg-white border border-[#E8E7E2] rounded-xl overflow-hidden">
                <div className="px-3.5 py-2.5 border-b border-[#E8E7E2] flex items-center gap-2">
                  <User size={15} className="text-[#999]" />
                  <div className="text-[12.5px] font-semibold text-[#111] flex-1">Hiệu suất theo Quản lý {selected.manager_name ? `— ${selected.manager_name}` : ''}</div>
                </div>
                {!selected.manager_name ? (
                  <div className="px-3.5 py-8 text-center text-[12px] text-[#999]">Chưa gán Người quản lý cho chi nhánh này</div>
                ) : perfLoading ? (
                  <div className="px-3.5 py-8 text-center text-[12px] text-[#999]">Đang tải...</div>
                ) : perfRows.length === 0 ? (
                  <div className="px-3.5 py-8 text-center text-[12px] text-[#999]">Chưa có lịch sử bàn giao quản lý cho "{selected.manager_name}"</div>
                ) : (
                  <table className="w-full text-[12px]">
                    <thead>
                      <tr className="text-[10px] text-[#999] uppercase bg-[#F5F4EF]">
                        <th className="text-left font-medium px-3.5 py-2">Công ty</th>
                        <th className="text-left font-medium px-3 py-2">Giai đoạn</th>
                        <th className="text-right font-medium px-3 py-2">Doanh thu</th>
                        <th className="text-right font-medium px-3.5 py-2">Lợi nhuận (phần CN)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {perfRows.map(r => (
                        <tr key={r.id} className="border-t border-[#F0EEE9]">
                          <td className="px-3.5 py-2 font-medium text-[#111]">{r.clientName}</td>
                          <td className="px-3 py-2 text-[#666]">{monthLabel(r.from)} → {monthLabel(r.to)}</td>
                          <td className="px-3 py-2 text-right font-semibold">{fmtTrieu(r.revenue)} tr</td>
                          <td className={`px-3.5 py-2 text-right font-semibold ${r.profit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{fmtTrieu(r.profit)} tr</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
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
          <div className="flex bg-[#F5F4EF] rounded-lg p-0.5 gap-0.5">
            <button onClick={() => setViewMode('grid')} className={`px-2.5 py-1.5 text-[11px] font-medium rounded-md flex items-center gap-1 transition ${viewMode === 'grid' ? 'bg-white text-[#111] shadow-sm' : 'text-[#888] hover:text-[#555]'}`}>
              <LayoutGrid size={12} /> Cards
            </button>
            <button onClick={() => setViewMode('list')} className={`px-2.5 py-1.5 text-[11px] font-medium rounded-md flex items-center gap-1 transition ${viewMode === 'list' ? 'bg-white text-[#111] shadow-sm' : 'text-[#888] hover:text-[#555]'}`}>
              <List size={12} /> Danh sách
            </button>
          </div>
          <div className="flex bg-[#F5F4EF] rounded-lg p-0.5 gap-0.5">
            {([['all', 'Tất cả'], ['contracted', 'Đã khoán'], ['company', 'Dự án CT']] as const).map(([val, label]) => (
              <button key={val} onClick={() => setFilterType(val)}
                className={`px-2.5 py-1.5 text-[11px] font-medium rounded-md transition ${filterType === val ? 'bg-white text-[#111] shadow-sm' : 'text-[#888] hover:text-[#555]'}`}>
                {label}
              </button>
            ))}
          </div>
          {missingRegions.length > 0 && (
            <button onClick={handleSyncFromRegions} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium border border-gray-300 text-[#666] hover:bg-[#F5F4EF] transition">
              <RefreshCw size={12} /> Đồng bộ ({missingRegions.length})
            </button>
          )}
          <button onClick={() => setAdding(v => !v)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-[#0F6E56] text-white hover:opacity-90 transition shadow-sm">
            <Plus size={12} /> Thêm CN
          </button>
        </div>
      </div>

      {adding && (
        <div className="bg-white border border-[#E8E7E2] rounded-xl p-3.5 grid grid-cols-4 gap-2.5 items-end">
          <Field label="Loai chi nhanh" full>
            <div className="flex border border-gray-300 rounded-lg overflow-hidden">
              <button type="button" onClick={() => setNewBranch(v => ({ ...v, branch_type: 'contracted' }))}
                className={`flex-1 px-3 py-1.5 text-[12px] font-medium transition ${newBranch.branch_type === 'contracted' ? 'bg-[#F5F4EF] text-[#111]' : 'text-[#999]'}`}>
                Da Khoan
              </button>
              <button type="button" onClick={() => setNewBranch(v => ({ ...v, branch_type: 'company' }))}
                className={`flex-1 px-3 py-1.5 text-[12px] font-medium border-l border-gray-300 transition ${newBranch.branch_type === 'company' ? 'bg-blue-50 text-blue-700' : 'text-[#999]'}`}>
                Du An Cong Ty
              </button>
            </div>
          </Field>
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
            <select value={newBranch.location} onChange={e => setNewBranch(v => ({ ...v, location: e.target.value }))} className="field-input">
              <option value="">-- Chon dia danh --</option>
              {PROVINCES.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
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

        {/* LN Ròng — split prev/this month with branch filter */}
        <div className="bg-white border border-[#E8E7E2] rounded-xl relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-[2.5px]" style={{ background: filteredLnRong >= 0 ? '#0F6E56' : '#A32D2D' }} />
          <div className="flex items-center justify-between px-3.5 pt-3 pb-1">
            <span className="text-[10.5px] uppercase tracking-wide text-[#999] font-medium">LN ròng chi nhánh</span>
            <button onClick={() => setShowLnFilter(v => !v)} className={`p-1 rounded-md transition ${showLnFilter ? 'bg-blue-50 text-blue-600' : 'text-[#ccc] hover:text-blue-500 hover:bg-blue-50'}`} title="Lọc chi nhánh">
              <Filter size={13} />
            </button>
          </div>
          {showLnFilter && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setShowLnFilter(false)} />
              <div className="absolute right-2 top-10 z-40 bg-white border border-[#E8E7E2] rounded-lg shadow-xl w-56 max-h-64 overflow-y-auto p-1.5">
                <div className="flex items-center justify-between px-2 py-1 mb-1">
                  <span className="text-[10px] font-semibold text-[#999] uppercase tracking-wide">Chọn chi nhánh</span>
                  {lnBranchFilter.size > 0 && (
                    <button onClick={() => setLnBranchFilter(new Set())} className="text-[10px] text-blue-600 hover:underline">Bỏ lọc</button>
                  )}
                </div>
                {branches.map(b => {
                  const isChecked = lnBranchFilter.size === 0 || lnBranchFilter.has(b.id);
                  return (
                    <button key={b.id} onClick={() => toggleLnBranch(b.id)}
                      className={`flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-left transition ${isChecked && lnBranchFilter.size > 0 ? 'bg-blue-50' : 'hover:bg-[#F5F4EF]'}`}>
                      <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${isChecked && lnBranchFilter.size > 0 ? 'bg-blue-600 border-blue-600' : 'border-[#ccc]'}`}>
                        {isChecked && lnBranchFilter.size > 0 && <Check size={10} className="text-white" />}
                      </span>
                      <span className="text-[11px] text-[#333] truncate">{b.name}</span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
          <div className="grid grid-cols-2 divide-x divide-[#F0EFEB] px-3.5 pb-2.5">
            <div className="pr-3">
              <div className="text-[9px] uppercase text-[#bbb] mb-0.5">Tháng {prevMonthNum}</div>
              <div className={`text-[18px] font-semibold ${filteredPrevLnRong >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                {filteredPrevLnRong >= 0 ? '+' : ''}{fmtTrieu(filteredPrevLnRong)} <span className="text-[12px] font-normal text-[#999]">tr</span>
              </div>
            </div>
            <div className="pl-3">
              <div className="text-[9px] uppercase text-[#bbb] mb-0.5">Tháng {thisMonthNum}</div>
              <div className={`text-[18px] font-semibold ${filteredLnRong >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                {filteredLnRong >= 0 ? '+' : ''}{fmtTrieu(filteredLnRong)} <span className="text-[12px] font-normal text-[#999]">tr</span>
              </div>
            </div>
          </div>
          {lnBranchFilter.size > 0 && (
            <div className="px-3.5 pb-2 -mt-0.5">
              <span className="text-[10px] text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">Đang lọc {lnBranchFilter.size} CN</span>
            </div>
          )}
        </div>

        {/* Cần xử lý — clickable with issue list popup */}
        <div className="relative">
          <div onClick={() => needsAttention > 0 && setShowAlertPopup(v => !v)} className={needsAttention > 0 ? 'cursor-pointer' : ''}>
            <Kpi label="Cần xử lý" value={String(needsAttention)} sub="CN có vấn đề" accent="#BA7517" valueColor="text-amber-600" icon={<AlertTriangle size={14} />} />
          </div>
          {showAlertPopup && alertBranches.length > 0 && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setShowAlertPopup(false)} />
              <div className="absolute left-0 right-0 top-full mt-1 z-40 bg-white border border-[#E8E7E2] rounded-xl shadow-xl max-h-80 overflow-y-auto">
                <div className="px-3.5 py-2 border-b border-[#F0EFEB] text-[10px] font-semibold text-[#999] uppercase tracking-wide">
                  Chi nhánh cần xử lý
                </div>
                {alertBranches.map(b => {
                  const st = branchStats[b.id];
                  const expiring = st.branchClients.filter(c => { const d = daysUntil(c.contract_end); return d !== null && d <= 30 && d >= 0; });
                  const danger = st.branchClients.filter(c => c.status === 'danger');
                  return (
                    <div key={b.id} className="px-3.5 py-2.5 border-b border-[#F0EFEB] last:border-b-0 hover:bg-[#FAFAF8] cursor-pointer" onClick={() => { setSelectedId(b.id); setShowAlertPopup(false); }}>
                      <div className="flex items-center gap-2 mb-1.5">
                        {renderAvatar(b, 22)}
                        <span className="text-[12px] font-semibold text-[#111]">{b.name}</span>
                      </div>
                      {expiring.length > 0 && (
                        <div className="mb-1">
                          <div className="text-[10px] font-medium text-amber-700 mb-0.5">{expiring.length} HĐ sắp hết hạn:</div>
                          <div className="flex flex-wrap gap-1">
                            {expiring.map(c => (
                              <span key={c.id} className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200">
                                {c.name} — {daysUntil(c.contract_end)} ngày
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      {danger.length > 0 && (
                        <div>
                          <div className="text-[10px] font-medium text-red-700 mb-0.5">{danger.length} KH cần xử lý:</div>
                          <div className="flex flex-wrap gap-1">
                            {danger.map(c => (
                              <span key={c.id} className="text-[10px] px-1.5 py-0.5 rounded bg-red-50 text-red-800 border border-red-200">{c.name}</span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>

      {displayBranches.length === 0 ? (
        <div className="bg-white border border-[#E8E7E2] rounded-xl px-3.5 py-10 text-center text-[12px] text-[#999]">
          Chưa có chi nhánh nào. Bấm "Thêm CN" để tạo mới.
        </div>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(290px,1fr))] gap-3">
          {displayBranches.map(b => {
            const stats = branchStats[b.id];
            return (
              <div key={b.id} onClick={() => setSelectedId(b.id)} className="bg-white border border-[#E8E7E2] rounded-xl overflow-hidden cursor-pointer hover:border-gray-300 hover:-translate-y-0.5 transition">
                <div className="px-3.5 py-3 border-b border-[#E8E7E2] flex items-start gap-3">
                  {renderAvatar(b, 40)}
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
                    <div className="mt-1 flex items-center gap-1.5">
                      {stats?.alerts.length ? (
                        <span className="inline-flex text-[10px] px-2 py-0.5 rounded-full font-semibold bg-[#FAEEDA] text-[#633806]">Cần xử lý</span>
                      ) : (
                        <span className="inline-flex text-[10px] px-2 py-0.5 rounded-full font-semibold bg-[#E1F5EE] text-[#085041]">Hoạt động tốt</span>
                      )}
                      <span className={`inline-flex text-[9px] px-1.5 py-0.5 rounded-full font-medium ${(b.branch_type || 'contracted') === 'company' ? 'bg-blue-50 text-blue-700 border border-blue-200' : 'bg-gray-50 text-gray-500 border border-gray-200'}`}>
                        {(b.branch_type || 'contracted') === 'company' ? 'Du An CT' : 'Da Khoan'}
                      </span>
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
              {displayBranches.map(b => {
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
                    <td className="px-3 py-2 text-[#666]">
                      <div className="flex items-center gap-1.5">
                        {renderAvatar(b, 18)}
                        <span>{b.manager_name || '—'}</span>
                      </div>
                    </td>
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
