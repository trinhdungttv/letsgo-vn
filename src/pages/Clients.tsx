import { useState, useRef, useMemo } from 'react';
import { Plus, TrendingUp, TrendingDown, Settings, RefreshCw, AlertTriangle, FileDown, FileUp, Trash2, Pencil, Check, ClipboardList } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import AdminSettings, { loadColumnSettings, type ColumnKey } from '../components/AdminSettings';
import FilterDropdown, { ALL_OPTION } from '../components/FilterDropdown';
import { useRegions } from '../hooks/useRegions';
import { useManagers } from '../hooks/useManagers';
import { useBranchData } from '../hooks/useBranchData';
import type { Client, LaborHistoryEntry, MarketZone, Manager } from '../lib/types';
import { getMonthLast, recentMonths, statusPill, formatDate, daysUntil, getCurrentWeekLabel, recentWeekLabels, nextWeekLabels } from '../lib/format';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { logActivity } from '../lib/audit';
import { downloadClientTemplate, parseClientExcel } from '../lib/clientImport';
import { usePersistedState } from '../hooks/usePersistedState';
import { HealthScoreRing } from '../components/clients/HealthScoreRing';
import { ChurnBadge } from '../components/clients/ChurnBadge';
import { CycleTrack } from '../components/clients/CycleTrack';
import { calcHealthScore, detectChurnRisk } from '../utils/healthScore';

interface ClientsProps {
  clients: Client[];
  laborHistory: Record<string, LaborHistoryEntry[]>;
  activeRegion: string[];
  onRegionChange: (r: string[]) => void;
  onSelectClient: (id: string) => void;
  onAddClient: (regionName?: string, managerName?: string) => void;
  onClientUpdate: (c: Client) => void;
  onLaborUpdate: (entry: LaborHistoryEntry) => void;
  onReload: () => void;
  isAdmin: boolean;
  marketZones: MarketZone[];
  onMarketZoneAdd: (zone: MarketZone) => void;
  toast: (m: string) => void;
}

function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message);
  return String(e);
}

interface RenewForm {
  client: Client;
  startDate: string;
  endDate: string;
  notes: string;
}

export default function Clients({
  clients, laborHistory, activeRegion, onRegionChange,
  onSelectClient, onAddClient, onClientUpdate, onLaborUpdate, onReload, isAdmin, marketZones, onMarketZoneAdd, toast,
}: ClientsProps) {
  const [search, setSearch] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [columns, setColumns] = useState(loadColumnSettings);
  const { user } = useAuth();
  const [renewForm, setRenewForm] = useState<RenewForm | null>(null);
  const [isRenewing, setIsRenewing] = useState(false);
  const [activeZones, setActiveZones] = usePersistedState<string[]>('lgvn_clients_activeZones', [ALL_OPTION]);
  const [addZoneFor, setAddZoneFor] = useState<Client | null>(null);
  const [newZoneName, setNewZoneName] = useState('');
  const [savingZone, setSavingZone] = useState(false);
  const [activeManagers, setActiveManagers] = usePersistedState<string[]>('lgvn_clients_activeManagers', [ALL_OPTION]);
  const [selectedManager, setSelectedManager] = useState<Manager | null>(null);
  const [editingManager, setEditingManager] = useState<Manager | null>(null);
  const [savingManager, setSavingManager] = useState(false);
  const [addManagerFor, setAddManagerFor] = useState<Client | null>(null);
  const [newManagerForm, setNewManagerForm] = useState({ name: '', phone: '', email: '', region: '' });
  const [savingNewManager, setSavingNewManager] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [deleteTarget, setDeleteTarget] = useState<Client | null>(null);
  const [deletePassword, setDeletePassword] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [editingCell, setEditingCell] = useState<{ id: string; field: 'region' | 'manager' | 'zone' | 'contract_start' | 'contract_end' | 'cutoff_day' | 'status' | 'labor' } | null>(null);
  const [editValue, setEditValue] = useState('');
  const [savingCell, setSavingCell] = useState(false);
  const [showBulkLabor, setShowBulkLabor] = useState(false);
  const [bulkWeek, setBulkWeek] = useState('');
  const [bulkExtraWeeks, setBulkExtraWeeks] = useState(0);
  const [bulkValues, setBulkValues] = useState<Record<string, string>>({});
  const [bulkSearch, setBulkSearch] = useState('');
  const [bulkRegions, setBulkRegions] = useState<string[]>([ALL_OPTION]);
  const [bulkSaving, setBulkSaving] = useState(false);

  const { regions, add: addRegion, update: updateRegion, remove: removeRegion } = useRegions();
  const { managers, add: addManager, update: updateManager, remove: removeManager } = useManagers();
  const { branches, deleteBranch } = useBranchData();

  const regionNames = [ALL_OPTION, ...regions.map(r => r.name)];
  const managerNames = [ALL_OPTION, ...managers.map(m => m.name)];
  const zoneNames = [ALL_OPTION, ...marketZones.map(z => z.name)];

  const filtered = clients.filter(c => {
    if (c.archived_at) return false;
    const matchRegion = activeRegion.includes(ALL_OPTION) || activeRegion.includes(c.region || '');
    const matchManager = activeManagers.includes(ALL_OPTION) || activeManagers.includes(c.manager || '');
    const matchZones = activeZones.includes(ALL_OPTION) || (c.industrial_zones || []).some(z => activeZones.includes(z));
    const matchSearch = !search || c.name.toLowerCase().includes(search.toLowerCase());
    return matchRegion && matchManager && matchZones && matchSearch;
  });

  const bulkClients = useMemo(() => {
    return clients
      .filter(c => !c.archived_at)
      .filter(c => bulkRegions.includes(ALL_OPTION) || bulkRegions.includes(c.region || ''))
      .filter(c => !bulkSearch || c.name.toLowerCase().includes(bulkSearch.toLowerCase()))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [clients, bulkSearch, bulkRegions]);

  const bulkWeekGroups = useMemo(() => {
    return [...nextWeekLabels(bulkExtraWeeks), ...recentWeekLabels(6)];
  }, [bulkExtraWeeks]);

  const openBulkLabor = () => {
    setBulkWeek(getCurrentWeekLabel());
    setBulkExtraWeeks(0);
    setBulkValues({});
    setBulkSearch('');
    setBulkRegions([ALL_OPTION]);
    setShowBulkLabor(true);
  };

  const saveBulkLabor = async () => {
    const entries = Object.entries(bulkValues).filter(([, v]) => v.trim() !== '');
    if (entries.length === 0) { toast('Chưa nhập số liệu nào'); return; }
    setBulkSaving(true);
    let success = 0;
    try {
      for (const [clientId, valStr] of entries) {
        const newCount = Math.max(0, parseInt(valStr) || 0);
        const c = clients.find(cl => cl.id === clientId);
        if (!c) continue;
        const hist = laborHistory[clientId] || [];
        const existing = hist.find(h => h.week_label === bulkWeek);
        if (existing) {
          if (existing.count === newCount) continue;
          const { error } = await supabase.from('client_labor_history').update({ count: newCount }).eq('id', existing.id);
          if (error) throw error;
          onLaborUpdate({ ...existing, count: newCount });
          await logActivity({
            user, action: 'update', table: 'client_labor_history', recordId: existing.id,
            description: `Cập nhật LĐ tuần ${bulkWeek} cho "${c.name}": ${existing.count.toLocaleString()} → ${newCount.toLocaleString()}`,
            oldData: existing, newData: { ...existing, count: newCount },
          });
        } else {
          const { data, error } = await supabase.from('client_labor_history').insert({ client_id: clientId, week_label: bulkWeek, count: newCount, updated_by: user?.full_name || null }).select().single();
          if (error) throw error;
          onLaborUpdate(data);
          await logActivity({
            user, action: 'insert', table: 'client_labor_history', recordId: data.id,
            description: `Thêm số liệu LĐ tuần ${bulkWeek} cho "${c.name}": ${newCount.toLocaleString()}`,
            newData: data,
          });
        }
        success++;
      }
      toast(`Đã lưu LĐ tuần ${bulkWeek} cho ${success} công ty`);
      setShowBulkLabor(false);
    } catch (err: any) {
      toast('Lỗi: ' + err.message);
    } finally {
      setBulkSaving(false);
    }
  };

  const getDelta = (clientId: string) => {
    const hist = laborHistory[clientId] || [];
    const months = recentMonths(2);
    const prev = getMonthLast(hist, months[0].month);
    const curr = getMonthLast(hist, months[1].month);
    if (prev !== null && curr !== null) return curr - prev;
    return null;
  };

  const openRenew = (e: React.MouseEvent, c: Client) => {
    e.stopPropagation();
    const oldEnd = c.contract_end || new Date().toISOString().slice(0, 10);
    const startDate = new Date(new Date(oldEnd).getTime() + 86400000).toISOString().slice(0, 10);
    const endDate = new Date(new Date(startDate).setFullYear(new Date(startDate).getFullYear() + 1)).toISOString().slice(0, 10);
    setRenewForm({ client: c, startDate, endDate, notes: '' });
  };

  const assignZoneToClient = async (c: Client, zoneName: string) => {
    const updates = { industrial_zones: zoneName ? [zoneName] : [], updated_at: new Date().toISOString() };
    const { error } = await supabase.from('clients').update(updates).eq('id', c.id);
    if (error) throw error;
    onClientUpdate({ ...c, ...updates });
    await logActivity({
      user, action: 'update', table: 'clients', recordId: c.id,
      description: `Cập nhật Khu công nghiệp của "${c.name}": ${(c.industrial_zones || [])[0] ?? '—'} → ${zoneName || '—'}`,
      oldData: c, newData: { ...c, ...updates },
    });
  };

  const handleAddZone = async () => {
    if (!addZoneFor) return;
    const name = newZoneName.trim();
    if (!name) return;
    const existing = marketZones.find(z => z.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      toast(`Khu công nghiệp "${existing.name}" đã có — đã gán cho công ty này`);
      try {
        await assignZoneToClient(addZoneFor, existing.name);
      } catch (e: unknown) {
        toast('Lỗi: ' + errMsg(e));
        return;
      }
      setAddZoneFor(null);
      setNewZoneName('');
      return;
    }
    setSavingZone(true);
    try {
      const { data, error } = await supabase.from('market_zones')
        .insert({ name, labor_availability: 'Trung bình' })
        .select().single();
      if (error) throw error;
      onMarketZoneAdd(data as MarketZone);
      await logActivity({
        user, action: 'insert', table: 'market_zones', recordId: data.id,
        description: `Thêm khu công nghiệp "${name}" (từ trang Khách hàng)`,
        newData: data,
      });
      await assignZoneToClient(addZoneFor, name);
      setAddZoneFor(null);
      setNewZoneName('');
      toast(`Đã tạo Khu công nghiệp "${name}" và đồng bộ vào Thị trường > Khu vực`);
    } catch (e: unknown) {
      toast('Lỗi: ' + errMsg(e));
    } finally {
      setSavingZone(false);
    }
  };

  const handleRenew = async () => {
    if (!renewForm) return;
    setIsRenewing(true);
    try {
      const updates = {
        contract_start: renewForm.startDate,
        contract_end: renewForm.endDate,
        status: 'ok',
        notes: renewForm.notes ? (renewForm.client.notes ? renewForm.client.notes + '\n' + renewForm.notes : renewForm.notes) : renewForm.client.notes,
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase.from('clients').update(updates).eq('id', renewForm.client.id);
      if (error) throw error;
      onClientUpdate({ ...renewForm.client, contract_start: renewForm.startDate, contract_end: renewForm.endDate, status: 'ok' });
      toast(`Đã gia hạn HĐ đến ${formatDate(renewForm.endDate)}`);
      await logActivity({
        user, action: 'update', table: 'clients', recordId: renewForm.client.id,
        description: `Gia hạn hợp đồng khách hàng "${renewForm.client.name}" đến ${formatDate(renewForm.endDate)}`,
        oldData: renewForm.client, newData: { ...renewForm.client, ...updates },
      });
      setRenewForm(null);
    } catch (err: any) { toast('Lỗi: ' + err.message); }
    finally { setIsRenewing(false); }
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsImporting(true);
    try {
      const rows = await parseClientExcel(file);
      if (rows.length === 0) {
        toast('Không tìm thấy dòng dữ liệu hợp lệ trong file');
        return;
      }
      const existingNames = new Set(clients.map(c => c.name.trim().toLowerCase()));
      const toInsert = rows.filter(r => !existingNames.has(r.name.trim().toLowerCase()));
      const skipped = rows.length - toInsert.length;

      let inserted = 0;
      for (const row of toInsert) {
        const payload = {
          name: row.name,
          region: row.region,
          manager: row.manager,
          phone: row.phone,
          email: row.email,
          contract_start: row.contract_start,
          contract_end: row.contract_end,
          min_workers: row.min_workers,
          industrial_zones: row.industrial_zones,
          notes: row.notes,
          client_type: 'active' as const,
          status: 'ok' as const,
          prospect_status: 'customer' as const,
          pipeline_stage: 'won',
          source: 'excel_import',
          cutoff_day: 25,
          payment_start: 5,
          payment_end: 8,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        const { data, error } = await supabase.from('clients').insert(payload).select().single();
        if (error) { toast(`Lỗi khi nhập "${row.name}": ${error.message}`); continue; }

        if (row.current_workers != null && row.current_workers > 0) {
          await supabase.from('client_labor_history').insert({
            client_id: data.id,
            week_label: getCurrentWeekLabel(),
            count: row.current_workers,
            updated_by: user?.full_name || null,
          });
        }

        await supabase.from('crm_deals').insert({
          title: `Hợp đồng - ${row.name}`,
          client_id: data.id,
          value: 0,
          stage: 'won',
          owner: row.manager || null,
          probability: 100,
        });

        await logActivity({
          user, action: 'insert', table: 'clients', recordId: data.id,
          description: `Nhập khách hàng "${row.name}" từ file Excel (công ty cũ - đang hợp tác)`,
          newData: data,
        });
        inserted += 1;
      }

      onReload();
      toast(`Đã nhập ${inserted} khách hàng${skipped > 0 ? `, bỏ qua ${skipped} dòng trùng tên` : ''}`);
    } catch (err: any) {
      toast('Lỗi: ' + err.message);
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleConfirmDelete = async () => {
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

      const archivedAt = new Date().toISOString();
      const { error } = await supabase.from('clients').update({ archived_at: archivedAt, updated_at: archivedAt }).eq('id', deleteTarget.id);
      if (error) throw error;
      onClientUpdate({ ...deleteTarget, archived_at: archivedAt });
      await logActivity({
        user, action: 'update', table: 'clients', recordId: deleteTarget.id,
        description: `Xóa (lưu trữ) công ty "${deleteTarget.name}" — có thể khôi phục tại Lịch sử > Lưu trữ`,
        oldData: deleteTarget, newData: { ...deleteTarget, archived_at: archivedAt },
      });
      toast(`Đã xóa "${deleteTarget.name}" — xem mục Lưu trữ trong Lịch sử để khôi phục`);
      setDeleteTarget(null);
      setDeletePassword('');
    } catch (err: any) {
      toast('Lỗi: ' + err.message);
    } finally {
      setIsDeleting(false);
    }
  };

  const QUICK_EDIT_LABELS: Record<string, string> = {
    region: 'Chi nhánh', manager: 'Quản lý', contract_start: 'Ngày bắt đầu HĐ', contract_end: 'Ngày hết hạn HĐ', cutoff_day: 'Ngày chốt công', status: 'Trạng thái',
  };

  const startEdit = (e: React.MouseEvent, c: Client, field: NonNullable<typeof editingCell>['field']) => {
    e.stopPropagation();
    if (!isAdmin && field !== 'labor') return;
    const current = field === 'cutoff_day' ? String(c.cutoff_day ?? '') : field === 'labor' ? String(c.current_workers ?? 0) : field === 'zone' ? ((c.industrial_zones || [])[0] || '') : (c as any)[field] || '';
    setEditingCell({ id: c.id, field });
    setEditValue(current);
  };

  const cancelEdit = () => { setEditingCell(null); setEditValue(''); };

  // Prevent the row's onClick (navigate to detail) from firing on the first click of a double-click in editable cells.
  const stopForEdit = (e: React.MouseEvent) => { if (isAdmin) e.stopPropagation(); };

  // LĐ column is editable for everyone, regardless of isAdmin.
  const stopForLaborEdit = (e: React.MouseEvent) => { e.stopPropagation(); };

  const saveEdit = async (c: Client) => {
    if (!editingCell) return;
    const field = editingCell.field;
    if (field === 'labor') {
      const newCount = Math.max(0, parseInt(editValue) || 0);
      if (newCount === (c.current_workers || 0)) { cancelEdit(); return; }
      const wk = getCurrentWeekLabel();
      setSavingCell(true);
      try {
        const hist = laborHistory[c.id] || [];
        const existing = hist.find(h => h.week_label === wk);
        if (existing) {
          const { error } = await supabase.from('client_labor_history').update({ count: newCount }).eq('id', existing.id);
          if (error) throw error;
          onLaborUpdate({ ...existing, count: newCount });
          await logActivity({
            user, action: 'update', table: 'client_labor_history', recordId: existing.id,
            description: `Cập nhật LĐ tuần ${wk} cho "${c.name}": ${existing.count.toLocaleString()} → ${newCount.toLocaleString()}`,
            oldData: existing, newData: { ...existing, count: newCount },
          });
        } else {
          const { data, error } = await supabase.from('client_labor_history').insert({ client_id: c.id, week_label: wk, count: newCount, updated_by: user?.full_name || null }).select().single();
          if (error) throw error;
          onLaborUpdate(data);
          await logActivity({
            user, action: 'insert', table: 'client_labor_history', recordId: data.id,
            description: `Thêm số liệu LĐ tuần ${wk} cho "${c.name}": ${newCount.toLocaleString()}`,
            newData: data,
          });
        }
        toast('Đã cập nhật');
      } catch (err: any) {
        toast('Lỗi: ' + err.message);
      } finally {
        setSavingCell(false);
        cancelEdit();
      }
      return;
    }
    const oldVal = field === 'cutoff_day' ? c.cutoff_day : (c as any)[field];
    let newVal: any = editValue;
    if (field === 'cutoff_day') newVal = Math.max(1, Math.min(31, parseInt(editValue) || 1));
    if ((field === 'region' || field === 'manager' || field === 'contract_start' || field === 'contract_end') && !editValue) newVal = null;
    if (String(oldVal ?? '') === String(newVal ?? '')) { cancelEdit(); return; }
    setSavingCell(true);
    try {
      const updates: any = { [field]: newVal, updated_at: new Date().toISOString() };
      const { error } = await supabase.from('clients').update(updates).eq('id', c.id);
      if (error) throw error;
      onClientUpdate({ ...c, ...updates });
      await logActivity({
        user, action: 'update', table: 'clients', recordId: c.id,
        description: `Cập nhật ${QUICK_EDIT_LABELS[field]} của "${c.name}": ${oldVal ?? '—'} → ${newVal ?? '—'}`,
        oldData: c, newData: { ...c, ...updates },
      });
      toast('Đã cập nhật');
    } catch (err: any) {
      toast('Lỗi: ' + err.message);
    } finally {
      setSavingCell(false);
      cancelEdit();
    }
  };

  const commitZoneEdit = async (c: Client) => {
    const typed = editValue.trim();
    const current = (c.industrial_zones || [])[0] || '';
    if (typed === current) { cancelEdit(); return; }
    if (!typed) {
      setSavingCell(true);
      try {
        await assignZoneToClient(c, '');
        toast('Đã cập nhật');
      } catch (err: unknown) {
        toast('Lỗi: ' + errMsg(err));
      } finally {
        setSavingCell(false);
        cancelEdit();
      }
      return;
    }
    const existing = marketZones.find(z => z.name.toLowerCase() === typed.toLowerCase());
    if (existing) {
      setSavingCell(true);
      try {
        await assignZoneToClient(c, existing.name);
        toast('Đã cập nhật');
      } catch (err: unknown) {
        toast('Lỗi: ' + errMsg(err));
      } finally {
        setSavingCell(false);
        cancelEdit();
      }
      return;
    }
    cancelEdit();
    setNewZoneName(typed);
    setAddZoneFor(c);
  };

  const assignManagerToClient = async (c: Client, managerName: string) => {
    const updates = { manager: managerName, updated_at: new Date().toISOString() };
    const { error } = await supabase.from('clients').update(updates).eq('id', c.id);
    if (error) throw error;
    onClientUpdate({ ...c, ...updates });
    await logActivity({
      user, action: 'update', table: 'clients', recordId: c.id,
      description: `Cập nhật Quản lý của "${c.name}": ${c.manager ?? '—'} → ${managerName}`,
      oldData: c, newData: { ...c, ...updates },
    });
  };

  const confirmAddManager = async () => {
    if (!addManagerFor) return;
    if (!newManagerForm.name.trim()) { toast('Vui lòng nhập tên quản lý'); return; }
    setSavingNewManager(true);
    try {
      const added = await addManager({
        name: newManagerForm.name.trim(),
        phone: newManagerForm.phone || null,
        email: newManagerForm.email || null,
        region: newManagerForm.region || null,
      });
      await logActivity({
        user, action: 'insert', table: 'managers', recordId: added.id,
        description: `Thêm quản lý "${added.name}"`, newData: added,
      });
      await assignManagerToClient(addManagerFor, added.name);
      toast('Đã thêm quản lý mới và gán cho khách hàng');
      setAddManagerFor(null);
    } catch (e) {
      toast('Lỗi: ' + errMsg(e));
    } finally {
      setSavingNewManager(false);
    }
  };

  const confirmManagerEdit = async () => {
    if (!editingManager || !selectedManager) return;
    if (!editingManager.name.trim()) { toast('Vui lòng nhập tên quản lý'); return; }
    setSavingManager(true);
    try {
      const isNew = !selectedManager.created_at;
      const fields = {
        name: editingManager.name.trim(),
        phone: editingManager.phone || null,
        email: editingManager.email || null,
        region: editingManager.region || null,
      };
      let saved: Manager;
      if (isNew) {
        saved = await addManager(fields);
        await logActivity({
          user, action: 'insert', table: 'managers', recordId: saved.id,
          description: `Thêm quản lý "${saved.name}"`, newData: saved,
        });
      } else {
        await updateManager(selectedManager.id, fields);
        saved = { ...selectedManager, ...fields };
        await logActivity({
          user, action: 'update', table: 'managers', recordId: saved.id,
          description: `Cập nhật thông tin quản lý "${saved.name}"`,
          oldData: selectedManager, newData: saved,
        });
      }

      const oldName = selectedManager.name;
      if (oldName && oldName !== saved.name) {
        const affected = clients.filter(c => c.manager === oldName);
        if (affected.length > 0) {
          const { error } = await supabase.from('clients').update({ manager: saved.name, updated_at: new Date().toISOString() }).eq('manager', oldName);
          if (error) throw error;
          affected.forEach(c => onClientUpdate({ ...c, manager: saved.name }));
          await logActivity({
            user, action: 'update', table: 'clients', recordId: saved.id,
            description: `Đổi tên quản lý "${oldName}" → "${saved.name}" (${affected.length} khách hàng)`,
          });
        }
      }

      setSelectedManager(saved);
      setEditingManager(null);
      toast('Đã lưu thông tin quản lý');
    } catch (e) {
      toast('Lỗi: ' + errMsg(e));
    } finally {
      setSavingManager(false);
    }
  };

  const col = (key: ColumnKey) => columns[key] !== false;

  return (
    <>
      <PageHeader
        title="Khách hàng"
        subtitle={`${clients.length} khách hàng · Click vào hàng để xem chi tiết${isAdmin ? ' · Double-click vào Chi nhánh/Quản lý/Chốt/Bắt đầu HĐ/Hết HĐ/TT để sửa nhanh' : ''}`}
        actions={
          <div className="flex items-center gap-2">
            {isAdmin && (
              <button onClick={() => setShowSettings(true)} className="p-1.5 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 transition" title="Cài đặt">
                <Settings className="w-4 h-4" />
              </button>
            )}
            <button onClick={() => downloadClientTemplate({
              regionNames: regions.map(r => r.name),
              managerNames: managers.map(m => m.name),
              zoneNames: marketZones.map(z => z.name),
            })} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[12px] font-medium border border-gray-300 text-gray-600 hover:bg-gray-50 transition" title="Tải file mẫu Excel">
              <FileDown size={13} /> File mẫu
            </button>
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleImportFile} />
            <button onClick={() => fileInputRef.current?.click()} disabled={isImporting} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[12px] font-medium border border-gray-300 text-gray-600 hover:bg-gray-50 transition disabled:opacity-50" title="Import danh sách khách hàng từ Excel">
              <FileUp size={13} /> {isImporting ? 'Đang nhập...' : 'Import Excel'}
            </button>
            <button onClick={openBulkLabor} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[12px] font-medium border border-gray-300 text-gray-600 hover:bg-gray-50 transition" title="Nhập nhanh số lao động cho nhiều công ty">
              <ClipboardList size={13} /> Nhập nhanh LĐ
            </button>
            <button onClick={() => onAddClient()} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-[#1D4ED8] text-white hover:bg-[#1E40AF] transition">
              <Plus size={13} /> Thêm KH
            </button>
          </div>
        }
      />
      <div className="flex-1 overflow-y-auto p-5">
        {/* Filters: Khu công nghiệp - Chi nhánh - Quản lý */}
        <div className="flex flex-wrap gap-2 mb-3 items-center">
          <FilterDropdown label="Khu công nghiệp" options={zoneNames} selected={activeZones} onChange={setActiveZones} />
          <FilterDropdown label="Chi nhánh" options={regionNames} selected={activeRegion} onChange={onRegionChange} />
          <FilterDropdown label="Quản lý" options={managerNames} selected={activeManagers} onChange={setActiveManagers} />
        </div>

        <div className="bg-white border border-[#E8E7E2] rounded-[10px] overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#E8E7E2]">
            <span className="text-[12.5px] font-semibold text-[#111]">Danh sách ({filtered.length})</span>
            <input type="text" placeholder="Tìm kiếm..." value={search} onChange={e => setSearch(e.target.value)}
              className="text-[12px] px-2.5 py-1.5 border border-gray-300 rounded-lg w-[200px] outline-none focus:border-blue-500" />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-[#E8E7E2]">
                  <th className="text-left px-3 py-2 text-[11.5px] text-[#888] font-medium bg-[#F9F9F7] whitespace-nowrap">Công ty</th>
                  {col('region') && <th className="text-left px-3 py-2 text-[11.5px] text-[#888] font-medium bg-[#F9F9F7] whitespace-nowrap">Chi Nhánh</th>}
                  {col('manager') && <th className="text-left px-3 py-2 text-[11.5px] text-[#888] font-medium bg-[#F9F9F7] whitespace-nowrap">Quản lý</th>}
                  {col('zone') && <th className="text-left px-3 py-2 text-[11.5px] text-[#888] font-medium bg-[#F9F9F7] whitespace-nowrap">KCN</th>}
                  {col('workers') && <th className="text-left px-3 py-2 text-[11.5px] text-[#888] font-medium bg-[#F9F9F7] whitespace-nowrap">LĐ</th>}
                  <th className="text-left px-3 py-2 text-[11.5px] text-[#888] font-medium bg-[#F9F9F7] whitespace-nowrap">Δ</th>
                  {col('cutoff') && <th className="text-left px-3 py-2 text-[11.5px] text-[#888] font-medium bg-[#F9F9F7] whitespace-nowrap">Chốt</th>}
                  {col('payment') && <th className="text-left px-3 py-2 text-[11.5px] text-[#888] font-medium bg-[#F9F9F7] whitespace-nowrap">Kỳ TT</th>}
                  {col('contract_start') && <th className="text-left px-3 py-2 text-[11.5px] text-[#888] font-medium bg-[#F9F9F7] whitespace-nowrap">Bắt đầu HĐ</th>}
                  {col('contract_end') && <th className="text-left px-3 py-2 text-[11.5px] text-[#888] font-medium bg-[#F9F9F7] whitespace-nowrap">Hết HĐ</th>}
                  {col('progress') && <th className="text-left px-3 py-2 text-[11.5px] text-[#888] font-medium bg-[#F9F9F7] whitespace-nowrap">Tiến độ</th>}
                  {col('status') && <th className="text-left px-3 py-2 text-[11.5px] text-[#888] font-medium bg-[#F9F9F7] whitespace-nowrap">TT</th>}
                  <th className="text-left px-3 py-2 text-[11.5px] text-[#888] font-medium bg-[#F9F9F7] whitespace-nowrap">Health</th>
                  {isAdmin && <th className="text-left px-3 py-2 text-[11.5px] text-[#888] font-medium bg-[#F9F9F7] whitespace-nowrap"></th>}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={11} className="text-center py-8 text-[#aaa]">Không có dữ liệu</td></tr>
                ) : filtered.map(c => {
                  const delta = getDelta(c.id);
                  const d = daysUntil(c.contract_end);
                  const pill = statusPill(c.status);
                  const minW = c.min_workers || 0;
                  const curW = c.current_workers || 0;
                  const underMin = minW > 0 && curW < minW;
                  const isWarn = c.status === 'warn' || c.status === 'danger';
                  const wHistory = (laborHistory[c.id] || [])
                    .slice()
                    .sort((a, b) => a.week_label < b.week_label ? -1 : 1)
                    .slice(-6)
                    .map(h => h.count);
                  const hs = calcHealthScore({
                    currentWorkers: c.current_workers || 0,
                    minWorkers: c.min_workers || 0,
                    paidThisMonth: false,
                    progCutoff: c.prog_cutoff || false,
                    contractEnd: c.contract_end || '',
                    lastContactDate: '',
                    workerHistory: wHistory,
                  });
                  const churnLevel = detectChurnRisk(wHistory);

                  return (
                    <tr key={c.id}
                      onClick={() => onSelectClient(c.id)}
                      className={`cursor-pointer border-b border-[#F0EEE9] last:border-0 transition-colors ${underMin ? 'bg-red-50 hover:bg-red-100' : 'hover:bg-[#F9F9F7]'}`}>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1.5">
                          {underMin && <AlertTriangle className="w-3.5 h-3.5 text-red-600 flex-shrink-0" />}
                          <div>
                            <div className="font-semibold text-[13px] flex items-center gap-1.5">
                              {c.name}
                              <ChurnBadge level={churnLevel} />
                            </div>
                            {c.notes && <div className="text-[11px] text-[#aaa] font-normal truncate max-w-[160px]">{c.notes}</div>}
                          </div>
                        </div>
                      </td>
                      {col('region') && (
                        <td className="px-3 py-2 text-[12px] text-[#555]" onClick={stopForEdit} onDoubleClick={e => startEdit(e, c, 'region')}>
                          {editingCell?.id === c.id && editingCell.field === 'region' ? (
                            <select
                              autoFocus value={editValue} disabled={savingCell}
                              onClick={e => e.stopPropagation()}
                              onChange={e => setEditValue(e.target.value)}
                              onBlur={() => saveEdit(c)}
                              onKeyDown={e => { if (e.key === 'Enter') saveEdit(c); if (e.key === 'Escape') cancelEdit(); }}
                              className="text-[12px] px-1.5 py-1 rounded border border-blue-400 outline-none bg-white"
                            >
                              <option value="">—</option>
                              {regions.map(r => <option key={r.id} value={r.name}>{r.name}</option>)}
                            </select>
                          ) : (c.region || '—')}
                        </td>
                      )}
                      {col('manager') && (
                        <td className="px-3 py-2 text-[12px] whitespace-nowrap" onClick={stopForEdit} onDoubleClick={e => startEdit(e, c, 'manager')}>
                          {editingCell?.id === c.id && editingCell.field === 'manager' ? (
                            <select
                              autoFocus value={editValue} disabled={savingCell}
                              onClick={e => e.stopPropagation()}
                              onChange={e => {
                                if (e.target.value === '__new__') {
                                  cancelEdit();
                                  setNewManagerForm({ name: '', phone: '', email: '', region: c.region || '' });
                                  setAddManagerFor(c);
                                  return;
                                }
                                setEditValue(e.target.value);
                              }}
                              onBlur={() => saveEdit(c)}
                              onKeyDown={e => { if (e.key === 'Enter') saveEdit(c); if (e.key === 'Escape') cancelEdit(); }}
                              className="text-[12px] px-1.5 py-1 rounded border border-blue-400 outline-none bg-white"
                            >
                              <option value="">—</option>
                              {managers.map(m => <option key={m.id} value={m.name}>{m.name}</option>)}
                              <option value="__new__">+ Thêm quản lý mới…</option>
                            </select>
                          ) : c.manager ? (
                            <button
                              onClick={e => {
                                e.stopPropagation();
                                const m = managers.find(mg => mg.name === c.manager);
                                setSelectedManager(m || { id: c.manager as string, name: c.manager as string, phone: null, email: null, region: null, created_at: '' });
                              }}
                              className="text-blue-600 hover:underline"
                            >
                              {c.manager}
                            </button>
                          ) : '—'}
                        </td>
                      )}
                      {col('zone') && (
                        <td className="px-3 py-2 text-[12px] text-[#555] whitespace-nowrap" onClick={stopForEdit} onDoubleClick={e => startEdit(e, c, 'zone')}>
                          {editingCell?.id === c.id && editingCell.field === 'zone' ? (
                            <>
                              <input
                                type="text" autoFocus value={editValue} disabled={savingCell}
                                list={`zone-options-${c.id}`}
                                onClick={e => e.stopPropagation()}
                                onChange={e => setEditValue(e.target.value)}
                                onBlur={() => commitZoneEdit(c)}
                                onKeyDown={e => { if (e.key === 'Enter') commitZoneEdit(c); if (e.key === 'Escape') cancelEdit(); }}
                                placeholder="Gõ để tìm hoặc thêm KCN..."
                                className="text-[12px] px-1.5 py-1 rounded border border-blue-400 outline-none bg-white w-[170px]"
                              />
                              <datalist id={`zone-options-${c.id}`}>
                                {marketZones.map(z => <option key={z.id} value={z.name} />)}
                              </datalist>
                            </>
                          ) : ((c.industrial_zones || [])[0] || '—')}
                        </td>
                      )}
                      {col('workers') && (
                        <td className="px-3 py-2" onClick={stopForLaborEdit} onDoubleClick={e => startEdit(e, c, 'labor')}>
                          {editingCell?.id === c.id && editingCell.field === 'labor' ? (
                            <input
                              type="number" min={0} autoFocus value={editValue} disabled={savingCell}
                              onClick={e => e.stopPropagation()}
                              onChange={e => setEditValue(e.target.value)}
                              onBlur={() => saveEdit(c)}
                              onKeyDown={e => { if (e.key === 'Enter') saveEdit(c); if (e.key === 'Escape') cancelEdit(); }}
                              className="text-[12px] w-16 px-1.5 py-1 rounded border border-blue-400 outline-none"
                            />
                          ) : (
                            <>
                              <div className={`font-semibold ${underMin ? 'text-red-700' : ''}`}>
                                {curW.toLocaleString()}
                                {minW > 0 && <span className="text-[11px] font-normal ml-1 text-gray-400">/{minW.toLocaleString()}</span>}
                              </div>
                              {underMin && (
                                <div className="text-[10px] text-red-600 font-medium">-{(minW - curW).toLocaleString()}</div>
                              )}
                            </>
                          )}
                        </td>
                      )}
                      <td className="px-3 py-2">
                        {delta !== null ? (
                          <span className="inline-flex items-center gap-0.5" style={{ color: delta > 0 ? '#059669' : delta < 0 ? '#DC2626' : '#888' }}>
                            {delta > 0 ? <TrendingUp size={12} /> : delta < 0 ? <TrendingDown size={12} /> : null}
                            {delta > 0 ? '+' : ''}{delta}
                          </span>
                        ) : '—'}
                      </td>
                      {col('cutoff') && (
                        <td className="px-3 py-2 text-[12px]" onClick={stopForEdit} onDoubleClick={e => startEdit(e, c, 'cutoff_day')}>
                          {editingCell?.id === c.id && editingCell.field === 'cutoff_day' ? (
                            <input
                              type="number" min={1} max={31} autoFocus value={editValue} disabled={savingCell}
                              onClick={e => e.stopPropagation()}
                              onChange={e => setEditValue(e.target.value)}
                              onBlur={() => saveEdit(c)}
                              onKeyDown={e => { if (e.key === 'Enter') saveEdit(c); if (e.key === 'Escape') cancelEdit(); }}
                              className="text-[12px] w-14 px-1.5 py-1 rounded border border-blue-400 outline-none"
                            />
                          ) : `Ngày ${c.cutoff_day}`}
                        </td>
                      )}
                      {col('payment') && <td className="px-3 py-2 text-[12px] whitespace-nowrap">{c.next_month_pay ? 'T sau' : `${c.payment_start}–${c.payment_end}`}</td>}
                      {col('contract_start') && (
                        <td className="px-3 py-2" onClick={stopForEdit} onDoubleClick={e => startEdit(e, c, 'contract_start')}>
                          {editingCell?.id === c.id && editingCell.field === 'contract_start' ? (
                            <input
                              type="date" autoFocus value={editValue} disabled={savingCell}
                              onClick={e => e.stopPropagation()}
                              onChange={e => setEditValue(e.target.value)}
                              onBlur={() => saveEdit(c)}
                              onKeyDown={e => { if (e.key === 'Enter') saveEdit(c); if (e.key === 'Escape') cancelEdit(); }}
                              className="text-[12px] px-1.5 py-1 rounded border border-blue-400 outline-none"
                            />
                          ) : (
                            <span className="text-[12px] whitespace-nowrap">{formatDate(c.contract_start)}</span>
                          )}
                        </td>
                      )}
                      {col('contract_end') && (
                        <td className="px-3 py-2" onClick={e => { stopForEdit(e); if (editingCell) return; isWarn && openRenew(e, c); }} onDoubleClick={e => startEdit(e, c, 'contract_end')}>
                          {editingCell?.id === c.id && editingCell.field === 'contract_end' ? (
                            <input
                              type="date" autoFocus value={editValue} disabled={savingCell}
                              onClick={e => e.stopPropagation()}
                              onChange={e => setEditValue(e.target.value)}
                              onBlur={() => saveEdit(c)}
                              onKeyDown={e => { if (e.key === 'Enter') saveEdit(c); if (e.key === 'Escape') cancelEdit(); }}
                              className="text-[12px] px-1.5 py-1 rounded border border-blue-400 outline-none"
                            />
                          ) : (
                            <div className="flex flex-col gap-1">
                              <span className="text-[12px] whitespace-nowrap" style={{ color: d !== null && d <= 7 ? '#DC2626' : d !== null && d <= 30 ? '#D97706' : undefined }}>
                                {formatDate(c.contract_end)}
                              </span>
                              {isWarn && (
                                <button
                                  onClick={e => openRenew(e, c)}
                                  className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 hover:bg-amber-200 transition w-fit"
                                >
                                  <RefreshCw className="w-2.5 h-2.5" /> Gia hạn
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                      )}
                      {col('progress') && (
                        <td className="px-3 py-2">
                          <div className="flex gap-0.5">
                            <CycleTrack
                              progCutoff={c.prog_cutoff || false}
                              progCalc={c.prog_calc || false}
                              progPaid={c.prog_paid || false}
                              paidThisMonth={false}
                            />
                          </div>
                        </td>
                      )}
                      {col('status') && (
                        <td className="px-3 py-2" onClick={stopForEdit} onDoubleClick={e => startEdit(e, c, 'status')}>
                          {editingCell?.id === c.id && editingCell.field === 'status' ? (
                            <select
                              autoFocus value={editValue} disabled={savingCell}
                              onClick={e => e.stopPropagation()}
                              onChange={e => setEditValue(e.target.value)}
                              onBlur={() => saveEdit(c)}
                              onKeyDown={e => { if (e.key === 'Enter') saveEdit(c); if (e.key === 'Escape') cancelEdit(); }}
                              className="text-[12px] px-1.5 py-1 rounded border border-blue-400 outline-none bg-white"
                            >
                              <option value="ok">Bình thường</option>
                              <option value="warn">Sắp hết HĐ</option>
                              <option value="danger">Khẩn cấp</option>
                            </select>
                          ) : (
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${pill.cls}`}>{pill.label}</span>
                          )}
                        </td>
                      )}
                      <td className="px-3 py-2">
                        <HealthScoreRing score={hs.total} />
                      </td>
                      {isAdmin && (
                        <td className="px-3 py-2">
                          <button
                            onClick={e => { e.stopPropagation(); setDeleteTarget(c); setDeletePassword(''); }}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition"
                            title="Xóa công ty"
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Admin Settings Modal */}
      {showSettings && isAdmin && (
        <AdminSettings
          regions={regions}
          managers={managers}
          columns={columns}
          clients={clients}
          branches={branches}
          onDeleteBranch={deleteBranch}
          onAddRegion={addRegion}
          onUpdateRegion={updateRegion}
          onDeleteRegion={removeRegion}
          onAddManager={addManager}
          onUpdateManager={updateManager}
          onDeleteManager={removeManager}
          onColumnsChange={setColumns}
          onClose={() => setShowSettings(false)}
          toast={toast}
        />
      )}

      {/* Renew Contract Modal */}
      {renewForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
              <div>
                <h2 className="text-base font-semibold text-gray-900">Gia hạn hợp đồng</h2>
                <p className="text-xs text-gray-500 mt-0.5">{renewForm.client.name}</p>
              </div>
              <button onClick={() => setRenewForm(null)} className="p-1 hover:bg-gray-100 rounded-md">
                <span className="text-gray-500 text-lg leading-none">×</span>
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Ngày bắt đầu (mới)</label>
                <input type="date" value={renewForm.startDate}
                  onChange={e => setRenewForm(f => f ? { ...f, startDate: e.target.value } : f)}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Ngày kết thúc</label>
                <input type="date" value={renewForm.endDate}
                  onChange={e => setRenewForm(f => f ? { ...f, endDate: e.target.value } : f)}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Ghi chú gia hạn</label>
                <input type="text" value={renewForm.notes}
                  onChange={e => setRenewForm(f => f ? { ...f, notes: e.target.value } : f)}
                  placeholder="VD: Gia hạn lần 2, điều kiện như cũ"
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>
            <div className="px-5 pb-5 flex gap-2">
              <button onClick={() => setRenewForm(null)} className="flex-1 px-3 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition">Hủy</button>
              <button onClick={handleRenew} disabled={isRenewing}
                className="flex-1 px-3 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg transition flex items-center justify-center gap-1.5">
                <RefreshCw className="w-3.5 h-3.5" />
                {isRenewing ? 'Đang lưu...' : 'Xác nhận gia hạn'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Client Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
              <div>
                <h2 className="text-base font-semibold text-gray-900">Xóa công ty</h2>
                <p className="text-xs text-gray-500 mt-0.5">{deleteTarget.name}</p>
              </div>
              <button onClick={() => { setDeleteTarget(null); setDeletePassword(''); }} className="p-1 hover:bg-gray-100 rounded-md">
                <span className="text-gray-500 text-lg leading-none">×</span>
              </button>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-[12.5px] text-gray-600">
                Công ty này sẽ được chuyển vào mục <strong>Lưu trữ</strong> (trong Lịch sử) và có thể khôi phục lại nếu cần. Vui lòng nhập mật khẩu của bạn để xác nhận.
              </p>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Mật khẩu</label>
                <input type="password" value={deletePassword}
                  onChange={e => setDeletePassword(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleConfirmDelete(); }}
                  autoFocus
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500" />
              </div>
            </div>
            <div className="px-5 pb-5 flex gap-2">
              <button onClick={() => { setDeleteTarget(null); setDeletePassword(''); }} className="flex-1 px-3 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition">Hủy</button>
              <button onClick={handleConfirmDelete} disabled={isDeleting}
                className="flex-1 px-3 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 rounded-lg transition flex items-center justify-center gap-1.5">
                <Trash2 className="w-3.5 h-3.5" />
                {isDeleting ? 'Đang xóa...' : 'Xác nhận xóa'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk labor entry modal */}
      {showBulkLabor && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
              <h2 className="text-base font-semibold text-gray-900">Nhập nhanh số lao động</h2>
              <button onClick={() => setShowBulkLabor(false)} className="p-1 hover:bg-gray-100 rounded-md">
                <span className="text-gray-500 text-lg leading-none">×</span>
              </button>
            </div>
            <div className="px-5 py-3 border-b border-gray-200 space-y-2">
              <div className="flex items-center gap-2">
                <label className="text-xs font-semibold text-gray-700">Tuần:</label>
                <select value={bulkWeek} onChange={e => setBulkWeek(e.target.value)} className="text-[12px] px-2 py-1.5 border border-gray-300 rounded-lg outline-none focus:border-blue-500">
                  {bulkWeekGroups.map(g => (
                    <optgroup key={g.month} label={g.month}>
                      {g.labels.map(l => <option key={l} value={l}>{l}</option>)}
                    </optgroup>
                  ))}
                </select>
                <button onClick={() => {
                  const next = nextWeekLabels(bulkExtraWeeks + 1)[0].labels[0];
                  setBulkExtraWeeks(n => n + 1);
                  setBulkWeek(next);
                }} className="text-[12px] text-blue-600 hover:underline">+ Tuần tiếp theo</button>
              </div>
              <div className="flex items-center gap-2">
                <FilterDropdown label="Chi nhánh" options={regionNames} selected={bulkRegions} onChange={setBulkRegions} />
                <input type="text" placeholder="Tìm công ty..." value={bulkSearch} onChange={e => setBulkSearch(e.target.value)}
                  className="flex-1 text-[12px] px-2.5 py-1.5 border border-gray-300 rounded-lg outline-none focus:border-blue-500" />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-2 divide-y divide-gray-100">
              {bulkClients.map(c => (
                <div key={c.id} className="flex items-center justify-between py-1.5 gap-3">
                  <span className="text-[12.5px] text-gray-800 truncate">{c.name}</span>
                  <input
                    type="number" min={0}
                    placeholder={String(c.current_workers ?? 0)}
                    value={bulkValues[c.id] ?? ''}
                    onChange={e => setBulkValues(prev => ({ ...prev, [c.id]: e.target.value }))}
                    className="w-20 text-[12px] px-2 py-1 border border-gray-300 rounded-lg outline-none focus:border-blue-500 text-right"
                  />
                </div>
              ))}
              {bulkClients.length === 0 && <div className="text-center py-6 text-[12px] text-gray-400">Không tìm thấy công ty</div>}
            </div>
            <div className="px-5 py-4 border-t border-gray-200 flex gap-2">
              <button onClick={() => setShowBulkLabor(false)} className="flex-1 px-3 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition">Hủy</button>
              <button onClick={saveBulkLabor} disabled={bulkSaving}
                className="flex-1 px-3 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg transition">
                {bulkSaving ? 'Đang lưu...' : 'Lưu tất cả'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Manager Detail Modal */}
      {selectedManager && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-[12px] w-full max-w-md shadow-xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#E8E7E2]">
              {editingManager ? (
                <input
                  autoFocus value={editingManager.name}
                  onChange={e => setEditingManager({ ...editingManager, name: e.target.value })}
                  placeholder="Tên quản lý *"
                  className="text-[14px] font-semibold text-[#111] px-2 py-1 rounded border border-blue-400 outline-none flex-1 mr-2"
                />
              ) : (
                <h3 className="text-[14px] font-semibold text-[#111]">{selectedManager.name}</h3>
              )}
              <div className="flex items-center gap-1.5">
                {isAdmin && !editingManager && (
                  <button onClick={() => setEditingManager({ ...selectedManager })} className="p-1 rounded text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition" title="Sửa thông tin quản lý">
                    <Pencil className="w-4 h-4" />
                  </button>
                )}
                <button onClick={() => { setSelectedManager(null); setEditingManager(null); }} className="text-[#aaa] hover:text-[#555] transition text-lg leading-none">×</button>
              </div>
            </div>
            <div className="p-5 space-y-3">
              {editingManager ? (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[12px] text-[#666] font-medium">Số điện thoại</label>
                    <input value={editingManager.phone || ''} onChange={e => setEditingManager({ ...editingManager, phone: e.target.value })}
                      className="w-full text-[13px] px-2 py-1.5 rounded border border-gray-300 outline-none focus:border-blue-400" />
                  </div>
                  <div>
                    <label className="text-[12px] text-[#666] font-medium">Email</label>
                    <input value={editingManager.email || ''} onChange={e => setEditingManager({ ...editingManager, email: e.target.value })}
                      className="w-full text-[13px] px-2 py-1.5 rounded border border-gray-300 outline-none focus:border-blue-400" />
                  </div>
                  <div className="col-span-2">
                    <label className="text-[12px] text-[#666] font-medium">Chi nhánh</label>
                    <select value={editingManager.region || ''} onChange={e => setEditingManager({ ...editingManager, region: e.target.value })}
                      className="w-full text-[13px] px-2 py-1.5 rounded border border-gray-300 outline-none focus:border-blue-400 bg-white">
                      <option value="">—</option>
                      {regions.map(r => <option key={r.id} value={r.name}>{r.name}</option>)}
                    </select>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {[
                    ['Số điện thoại', selectedManager.phone],
                    ['Email', selectedManager.email],
                    ['Chi nhánh', selectedManager.region],
                  ].map(([label, val]) => (
                    <div key={label}>
                      <label className="text-[12px] text-[#666] font-medium">{label}</label>
                      <div className="text-[13px] text-[#111] py-1 border-b border-dashed border-[#E8E7E2] min-h-[28px]">{val || '—'}</div>
                    </div>
                  ))}
                </div>
              )}
              <div>
                <label className="text-[12px] text-[#666] font-medium">
                  Khách hàng phụ trách ({clients.filter(c => c.manager === selectedManager.name).length})
                </label>
                <div className="mt-1.5 max-h-[220px] overflow-y-auto border border-[#E8E7E2] rounded-lg divide-y divide-[#F0EEE9]">
                  {clients.filter(c => c.manager === selectedManager.name).length === 0 ? (
                    <div className="px-3 py-3 text-[12.5px] text-[#aaa] text-center">Chưa phụ trách khách hàng nào</div>
                  ) : clients.filter(c => c.manager === selectedManager.name).map(c => {
                    const p = statusPill(c.status);
                    return (
                      <div key={c.id} className="px-3 py-2 flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-[12.5px] font-medium text-[#111] truncate">{c.name}</div>
                          <div className="text-[11px] text-[#888]">{c.region || '—'}</div>
                        </div>
                        <span className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${p.cls}`}>{p.label}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
            <div className="px-5 pb-5 flex gap-2">
              {editingManager ? (
                <>
                  <button onClick={() => setEditingManager(null)} disabled={savingManager} className="flex-1 py-2 rounded-lg text-[13px] font-medium border border-gray-300 text-gray-600 hover:bg-gray-50 transition disabled:opacity-50">Hủy</button>
                  <button onClick={confirmManagerEdit} disabled={savingManager} className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 rounded-lg text-[13px] font-medium bg-blue-600 text-white hover:bg-blue-700 transition disabled:opacity-50">
                    <Check className="w-3.5 h-3.5" /> {savingManager ? 'Đang lưu...' : 'Lưu'}
                  </button>
                </>
              ) : (
                <button onClick={() => setSelectedManager(null)} className="w-full py-2 rounded-lg text-[13px] font-medium border border-gray-300 text-gray-600 hover:bg-gray-50 transition">Đóng</button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Add New Manager Modal (from quick-edit Quản lý) */}
      {addManagerFor && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-[12px] w-full max-w-md shadow-xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#E8E7E2]">
              <h3 className="text-[14px] font-semibold text-[#111]">Thêm quản lý mới</h3>
              <button onClick={() => setAddManagerFor(null)} className="text-[#aaa] hover:text-[#555] transition text-lg leading-none">×</button>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-[12.5px] text-[#888]">Gán cho khách hàng "{addManagerFor.name}" sau khi tạo.</p>
              <div>
                <label className="text-[12px] text-[#666] font-medium">Tên quản lý *</label>
                <input autoFocus value={newManagerForm.name} onChange={e => setNewManagerForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full text-[13px] px-2 py-1.5 rounded border border-gray-300 outline-none focus:border-blue-400" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[12px] text-[#666] font-medium">Số điện thoại</label>
                  <input value={newManagerForm.phone} onChange={e => setNewManagerForm(f => ({ ...f, phone: e.target.value }))}
                    className="w-full text-[13px] px-2 py-1.5 rounded border border-gray-300 outline-none focus:border-blue-400" />
                </div>
                <div>
                  <label className="text-[12px] text-[#666] font-medium">Email</label>
                  <input value={newManagerForm.email} onChange={e => setNewManagerForm(f => ({ ...f, email: e.target.value }))}
                    className="w-full text-[13px] px-2 py-1.5 rounded border border-gray-300 outline-none focus:border-blue-400" />
                </div>
              </div>
              <div>
                <label className="text-[12px] text-[#666] font-medium">Chi nhánh</label>
                <select value={newManagerForm.region} onChange={e => setNewManagerForm(f => ({ ...f, region: e.target.value }))}
                  className="w-full text-[13px] px-2 py-1.5 rounded border border-gray-300 outline-none focus:border-blue-400 bg-white">
                  <option value="">—</option>
                  {regions.map(r => <option key={r.id} value={r.name}>{r.name}</option>)}
                </select>
              </div>
            </div>
            <div className="px-5 pb-5 flex gap-2">
              <button onClick={() => setAddManagerFor(null)} disabled={savingNewManager} className="flex-1 py-2 rounded-lg text-[13px] font-medium border border-gray-300 text-gray-600 hover:bg-gray-50 transition disabled:opacity-50">Hủy</button>
              <button onClick={confirmAddManager} disabled={savingNewManager || !newManagerForm.name.trim()} className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 rounded-lg text-[13px] font-medium bg-blue-600 text-white hover:bg-blue-700 transition disabled:opacity-50">
                <Plus className="w-3.5 h-3.5" /> {savingNewManager ? 'Đang lưu...' : 'Thêm & gán'}
              </button>
            </div>
          </div>
        </div>
      )}

      {addZoneFor && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-[12px] w-full max-w-md shadow-xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#E8E7E2]">
              <h3 className="text-[14px] font-semibold text-[#111]">Thêm Khu công nghiệp mới</h3>
              <button onClick={() => setAddZoneFor(null)} className="text-[#aaa] hover:text-[#555] transition text-lg leading-none">×</button>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-[12.5px] text-[#888]">Sẽ tạo mới trong Thị trường &gt; Khu vực và gán cho khách hàng "{addZoneFor.name}". Nếu tên đã tồn tại, sẽ chỉ gán mà không tạo trùng.</p>
              <div>
                <label className="text-[12px] text-[#666] font-medium">Tên Khu công nghiệp *</label>
                <input autoFocus value={newZoneName} onChange={e => setNewZoneName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleAddZone(); }}
                  className="w-full text-[13px] px-2 py-1.5 rounded border border-gray-300 outline-none focus:border-blue-400" />
              </div>
            </div>
            <div className="px-5 pb-5 flex gap-2">
              <button onClick={() => setAddZoneFor(null)} disabled={savingZone} className="flex-1 py-2 rounded-lg text-[13px] font-medium border border-gray-300 text-gray-600 hover:bg-gray-50 transition disabled:opacity-50">Hủy</button>
              <button onClick={handleAddZone} disabled={savingZone || !newZoneName.trim()} className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 rounded-lg text-[13px] font-medium bg-blue-600 text-white hover:bg-blue-700 transition disabled:opacity-50">
                <Plus className="w-3.5 h-3.5" /> {savingZone ? 'Đang lưu...' : 'Thêm & gán'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
