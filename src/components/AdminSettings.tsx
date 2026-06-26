import { useState } from 'react';
import { X, Plus, Pencil, Trash2, Check, AlertTriangle } from 'lucide-react';
import type { Region, Manager, Client, Branch, PayrollStaff } from '../lib/types';
import { usePayrollStaffs } from '../hooks/usePayrollStaffs';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { logActivity } from '../lib/audit';

function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message);
  return String(e);
}

type Tab = 'regions' | 'managers' | 'payroll' | 'columns';

const ALL_COLUMNS = [
  { key: 'region', label: 'Chi Nhánh' },
  { key: 'manager', label: 'Quản lý' },
  { key: 'zone', label: 'KCN' },
  { key: 'workers', label: 'LĐ' },
  { key: 'cutoff', label: 'Chốt' },
  { key: 'payment', label: 'Kỳ TT' },
  { key: 'contract_start', label: 'Bắt đầu HĐ' },
  { key: 'contract_end', label: 'Hết HĐ' },
  { key: 'progress', label: 'Tiến độ' },
  { key: 'status', label: 'TT' },
  { key: 'payroll_staff', label: 'NS Tính lương' },
] as const;

export type ColumnKey = typeof ALL_COLUMNS[number]['key'];
const COLS_KEY = 'letsgo_client_cols';

export function loadColumnSettings(): Record<ColumnKey, boolean> {
  try {
    const s = localStorage.getItem(COLS_KEY);
    if (s) return JSON.parse(s);
  } catch {}
  const defaults: Record<string, boolean> = {};
  ALL_COLUMNS.forEach(c => { defaults[c.key] = c.key !== 'progress'; });
  return defaults as Record<ColumnKey, boolean>;
}

interface AdminSettingsProps {
  regions: Region[];
  managers: Manager[];
  columns: Record<ColumnKey, boolean>;
  clients: Client[];
  branches: Branch[];
  onDeleteBranch: (id: string) => Promise<void>;
  onAddRegion: (name: string) => Promise<unknown>;
  onUpdateRegion: (id: string, name: string) => Promise<void>;
  onDeleteRegion: (id: string) => Promise<void>;
  onAddManager: (fields: Omit<Manager, 'id' | 'created_at'>) => Promise<unknown>;
  onUpdateManager: (id: string, fields: Partial<Omit<Manager, 'id' | 'created_at'>>) => Promise<void>;
  onDeleteManager: (id: string) => Promise<void>;
  onColumnsChange: (cols: Record<ColumnKey, boolean>) => void;
  onClose: () => void;
  toast: (m: string) => void;
}

export default function AdminSettings({
  regions, managers, columns, clients, branches, onDeleteBranch,
  onAddRegion, onUpdateRegion, onDeleteRegion,
  onAddManager, onUpdateManager, onDeleteManager,
  onColumnsChange, onClose, toast,
}: AdminSettingsProps) {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>('managers');
  const [saving, setSaving] = useState(false);

  // Regions state
  const [newRegion, setNewRegion] = useState('');
  const [editingRegion, setEditingRegion] = useState<{ id: string; name: string } | null>(null);
  const [deletingRegion, setDeletingRegion] = useState<Region | null>(null);
  const [deletePassword, setDeletePassword] = useState('');
  const [isDeletingRegion, setIsDeletingRegion] = useState(false);

  // Managers state
  const [newMgr, setNewMgr] = useState<Omit<Manager, 'id' | 'created_at'>>({ name: '', phone: '', email: '', region: '' });
  const [editingMgr, setEditingMgr] = useState<Manager | null>(null);
  const [showAddMgr, setShowAddMgr] = useState(false);

  // Payroll staffs state
  const { payrollStaffs, add: addPayrollStaff, update: updatePayrollStaff, remove: removePayrollStaff } = usePayrollStaffs();
  const [newPayrollName, setNewPayrollName] = useState('');
  const [editingPayroll, setEditingPayroll] = useState<PayrollStaff | null>(null);

  // Columns state
  const [draftCols, setDraftCols] = useState<Record<ColumnKey, boolean>>({ ...columns });

  const wrap = async (fn: () => Promise<void>, successMsg: string) => {
    setSaving(true);
    try { await fn(); toast(successMsg); } catch (e: any) { toast('Lỗi: ' + e.message); }
    finally { setSaving(false); }
  };

  const handleAddRegion = () => {
    if (!newRegion.trim()) return;
    wrap(async () => { await onAddRegion(newRegion.trim()); setNewRegion(''); }, 'Đã thêm chi nhánh');
  };

  const handleSaveRegion = () => {
    if (!editingRegion || !editingRegion.name.trim()) return;
    wrap(async () => { await onUpdateRegion(editingRegion.id, editingRegion.name.trim()); setEditingRegion(null); }, 'Đã cập nhật chi nhánh');
  };

  const handleDeleteRegion = (r: Region) => {
    setDeletingRegion(r);
    setDeletePassword('');
  };

  const affectedClients = deletingRegion ? clients.filter(c => c.region === deletingRegion.name) : [];
  const linkedBranch = deletingRegion ? branches.find(b => b.region === deletingRegion.name) : undefined;

  const confirmDeleteRegion = async () => {
    if (!deletingRegion) return;
    if (!deletePassword) { toast('Vui lòng nhập mật khẩu'); return; }
    setIsDeletingRegion(true);
    try {
      if (!user?.id) { toast('Phiên đăng nhập không hợp lệ'); return; }
      const { data: pwOk, error: authErr } = await supabase.rpc('verify_password', {
        p_user_id: user.id,
        p_password: deletePassword,
      });
      if (authErr) throw authErr;
      if (!pwOk) { toast('Sai mật khẩu, vui lòng thử lại'); return; }

      if (linkedBranch) {
        await onDeleteBranch(linkedBranch.id);
        await logActivity({
          user, action: 'delete', table: 'branches', recordId: linkedBranch.id,
          description: `Xóa chi nhánh "${linkedBranch.name}" (theo khu vực "${deletingRegion.name}")`,
          oldData: linkedBranch,
        });
      }
      await onDeleteRegion(deletingRegion.id);
      await logActivity({
        user, action: 'delete', table: 'regions', recordId: deletingRegion.id,
        description: `Xóa khu vực phụ trách "${deletingRegion.name}"`,
        oldData: deletingRegion,
      });
      toast('Đã xóa chi nhánh');
      setDeletingRegion(null);
      setDeletePassword('');
    } catch (e) {
      toast('Lỗi: ' + errMsg(e));
    } finally {
      setIsDeletingRegion(false);
    }
  };

  const handleAddMgr = () => {
    if (!newMgr.name.trim()) return;
    wrap(async () => { await onAddManager({ ...newMgr, name: newMgr.name.trim() }); setNewMgr({ name: '', phone: '', email: '', region: '' }); setShowAddMgr(false); }, 'Đã thêm người quản lý');
  };

  const handleSaveMgr = () => {
    if (!editingMgr || !editingMgr.name.trim()) return;
    wrap(async () => { await onUpdateManager(editingMgr.id, { name: editingMgr.name, phone: editingMgr.phone, email: editingMgr.email, region: editingMgr.region }); setEditingMgr(null); }, 'Đã cập nhật quản lý');
  };

  const handleDeleteMgr = (id: string, name: string) => {
    if (!confirm(`Xóa quản lý "${name}"?`)) return;
    wrap(() => onDeleteManager(id), 'Đã xóa quản lý');
  };

  const handleSaveCols = () => {
    localStorage.setItem(COLS_KEY, JSON.stringify(draftCols));
    onColumnsChange(draftCols);
    toast('Đã lưu cài đặt cột');
    onClose();
  };

  const TABS: { key: Tab; label: string }[] = [
    { key: 'managers', label: 'Quản lý' },
    { key: 'payroll', label: 'NS Tính lương' },
    { key: 'columns', label: 'Bộ lọc cột' },
  ];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <h2 className="text-base font-semibold text-gray-900">Cài đặt Khách hàng</h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-md"><X className="w-5 h-5 text-gray-500" /></button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200 px-5 pt-3 gap-1 shrink-0">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-3 py-2 text-[12.5px] font-medium rounded-t-lg transition ${tab === t.key ? 'text-blue-700 border-b-2 border-blue-600 bg-blue-50' : 'text-gray-500 hover:text-gray-700'}`}>
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {/* TAB 1 - MANAGERS */}
          {tab === 'managers' && (
            <div className="space-y-3">
              <button onClick={() => setShowAddMgr(v => !v)}
                className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
                <Plus className="w-4 h-4" /> Thêm quản lý
              </button>

              {showAddMgr && (
                <div className="p-3 border border-blue-200 bg-blue-50 rounded-lg space-y-2">
                  <input value={newMgr.name} onChange={e => setNewMgr(f => ({ ...f, name: e.target.value }))}
                    placeholder="Tên *" className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-400" />
                  <div className="grid grid-cols-2 gap-2">
                    <input value={newMgr.phone || ''} onChange={e => setNewMgr(f => ({ ...f, phone: e.target.value }))}
                      placeholder="SĐT" className="px-2.5 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-400" />
                    <input value={newMgr.email || ''} onChange={e => setNewMgr(f => ({ ...f, email: e.target.value }))}
                      placeholder="Email" className="px-2.5 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-400" />
                  </div>
                  <select value={newMgr.region || ''} onChange={e => setNewMgr(f => ({ ...f, region: e.target.value }))}
                    className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-400">
                    <option value="">— Chọn chi nhánh —</option>
                    {branches.map(b => <option key={b.id} value={b.region || b.name}>{b.name}</option>)}
                  </select>
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => setShowAddMgr(false)} className="px-3 py-1.5 text-sm text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-md">Hủy</button>
                    <button onClick={handleAddMgr} disabled={saving || !newMgr.name.trim()}
                      className="px-3 py-1.5 text-sm text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-md">Lưu</button>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                {managers.map(m => (
                  <div key={m.id} className="p-2.5 bg-gray-50 rounded-lg border border-gray-200">
                    {editingMgr?.id === m.id ? (
                      <div className="space-y-2">
                        <input value={editingMgr.name} onChange={e => setEditingMgr({ ...editingMgr, name: e.target.value })}
                          placeholder="Tên *" className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-400" />
                        <div className="grid grid-cols-2 gap-2">
                          <input value={editingMgr.phone || ''} onChange={e => setEditingMgr({ ...editingMgr, phone: e.target.value })}
                            placeholder="SĐT" className="px-2.5 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-400" />
                          <input value={editingMgr.email || ''} onChange={e => setEditingMgr({ ...editingMgr, email: e.target.value })}
                            placeholder="Email" className="px-2.5 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-400" />
                        </div>
                        <select value={editingMgr.region || ''} onChange={e => setEditingMgr({ ...editingMgr, region: e.target.value })}
                          className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-400">
                          <option value="">— Chọn chi nhánh —</option>
                          {branches.map(b => <option key={b.id} value={b.region || b.name}>{b.name}</option>)}
                        </select>
                        <div className="flex gap-2 justify-end">
                          <button onClick={() => setEditingMgr(null)} className="px-3 py-1.5 text-sm text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-md">Hủy</button>
                          <button onClick={handleSaveMgr} disabled={saving}
                            className="px-3 py-1.5 text-sm text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 rounded-md flex items-center gap-1"><Check className="w-3.5 h-3.5" /> Lưu</button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold text-gray-800">{m.name}</div>
                          <div className="text-xs text-gray-500">{[m.phone, m.email].filter(Boolean).join(' · ') || 'Chưa có liên hệ'}</div>
                          <div className="text-xs text-gray-400">Chi nhánh: {m.region || '—'}</div>
                        </div>
                        <button onClick={() => setEditingMgr({ ...m })} className="p-1.5 text-gray-500 hover:bg-gray-200 rounded-md flex-shrink-0">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => handleDeleteMgr(m.id, m.name)} disabled={saving} className="p-1.5 text-red-500 hover:bg-red-50 rounded-md flex-shrink-0">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
                {managers.length === 0 && <p className="text-sm text-gray-400 text-center py-4">Chưa có quản lý nào</p>}
              </div>
            </div>
          )}

          {/* TAB 3 - PAYROLL STAFFS */}
          {tab === 'payroll' && (
            <div className="space-y-3">
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Tên nhân sự tính lương..."
                  value={newPayrollName}
                  onChange={e => setNewPayrollName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { if (!newPayrollName.trim()) return; wrap(async () => { await addPayrollStaff(newPayrollName.trim()); setNewPayrollName(''); }, 'Đã thêm'); } }}
                  className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg outline-none focus:border-blue-400"
                />
                <button
                  onClick={() => { if (!newPayrollName.trim()) return; wrap(async () => { await addPayrollStaff(newPayrollName.trim()); setNewPayrollName(''); }, 'Đã thêm'); }}
                  disabled={saving}
                  className="px-3 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
                ><Plus className="w-4 h-4" /></button>
              </div>
              <div className="space-y-2">
                {payrollStaffs.length === 0 && <p className="text-xs text-gray-400 text-center py-4">Chưa có nhân sự tính lương</p>}
                {payrollStaffs.map(ps => (
                  <div key={ps.id} className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg border border-gray-200">
                    {editingPayroll?.id === ps.id ? (
                      <>
                        <input
                          autoFocus
                          type="text"
                          value={editingPayroll.name}
                          onChange={e => setEditingPayroll({ ...editingPayroll, name: e.target.value })}
                          onKeyDown={e => { if (e.key === 'Enter') { if (!editingPayroll.name.trim()) return; wrap(async () => { await updatePayrollStaff(editingPayroll.id, editingPayroll.name.trim()); setEditingPayroll(null); }, 'Đã cập nhật'); } if (e.key === 'Escape') setEditingPayroll(null); }}
                          className="flex-1 px-2 py-1 text-sm border border-blue-400 rounded outline-none bg-white"
                        />
                        <button onClick={() => { if (!editingPayroll.name.trim()) return; wrap(async () => { await updatePayrollStaff(editingPayroll.id, editingPayroll.name.trim()); setEditingPayroll(null); }, 'Đã cập nhật'); }} disabled={saving} className="p-1 text-green-600 hover:bg-green-50 rounded"><Check className="w-4 h-4" /></button>
                        <button onClick={() => setEditingPayroll(null)} className="p-1 text-gray-400 hover:bg-gray-100 rounded"><X className="w-4 h-4" /></button>
                      </>
                    ) : (
                      <>
                        <span className="flex-1 text-sm font-medium text-gray-800">{ps.name}</span>
                        <button onClick={() => setEditingPayroll(ps)} className="p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded"><Pencil className="w-3.5 h-3.5" /></button>
                        <button onClick={() => { if (!confirm(`Xoá "${ps.name}"?`)) return; wrap(async () => { await removePayrollStaff(ps.id); }, 'Đã xoá'); }} className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"><Trash2 className="w-3.5 h-3.5" /></button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 4 - COLUMNS */}
          {tab === 'columns' && (
            <div className="space-y-3">
              <p className="text-xs text-gray-500">Chọn các cột hiển thị trong bảng khách hàng:</p>
              <div className="grid grid-cols-2 gap-2">
                {ALL_COLUMNS.map(col => (
                  <label key={col.key} className="flex items-center gap-2.5 p-2.5 bg-gray-50 rounded-lg border border-gray-200 cursor-pointer hover:bg-blue-50 hover:border-blue-300 transition">
                    <input
                      type="checkbox"
                      checked={draftCols[col.key] !== false}
                      onChange={e => setDraftCols(prev => ({ ...prev, [col.key]: e.target.checked }))}
                      className="w-4 h-4 text-blue-600 rounded"
                    />
                    <span className="text-sm font-medium text-gray-700">{col.label}</span>
                  </label>
                ))}
              </div>
              <div className="pt-2 flex justify-end">
                <button onClick={handleSaveCols} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
                  Lưu cài đặt
                </button>
              </div>
            </div>
          )}
        </div>

        {tab !== 'columns' && (
          <div className="px-5 py-3 border-t border-gray-200 flex justify-end">
            <button onClick={onClose} className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50">Đóng</button>
          </div>
        )}
      </div>

      {/* Delete Region Confirmation */}
      {deletingRegion && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
              <div>
                <h2 className="text-base font-semibold text-gray-900">Xóa chi nhánh</h2>
                <p className="text-xs text-gray-500 mt-0.5">{deletingRegion.name}</p>
              </div>
              <button onClick={() => { setDeletingRegion(null); setDeletePassword(''); }} className="p-1 hover:bg-gray-100 rounded-md">
                <X className="w-4 h-4 text-gray-500" />
              </button>
            </div>
            <div className="p-5 space-y-3">
              {(affectedClients.length > 0 || linkedBranch) && (
                <div className="flex gap-2 p-2.5 bg-amber-50 border border-amber-200 rounded-lg text-amber-800">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <div className="text-[12.5px] space-y-1">
                    {linkedBranch && (
                      <p>Chi nhánh vận hành <strong>"{linkedBranch.name}"</strong> liên kết với khu vực này sẽ bị xóa luôn.</p>
                    )}
                    {affectedClients.length > 0 && (
                      <>
                        <p><strong>{affectedClients.length} công ty</strong> đang thuộc khu vực này sẽ mất liên kết chi nhánh (dữ liệu công ty vẫn giữ nguyên):</p>
                        <ul className="list-disc list-inside max-h-24 overflow-y-auto">
                          {affectedClients.map(c => <li key={c.id}>{c.name}</li>)}
                        </ul>
                      </>
                    )}
                  </div>
                </div>
              )}
              <p className="text-[12.5px] text-gray-600">Vui lòng nhập mật khẩu của bạn để xác nhận xóa.</p>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Mật khẩu</label>
                <input type="password" value={deletePassword}
                  onChange={e => setDeletePassword(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') confirmDeleteRegion(); }}
                  autoFocus
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500" />
              </div>
            </div>
            <div className="px-5 pb-5 flex gap-2">
              <button onClick={() => { setDeletingRegion(null); setDeletePassword(''); }} className="flex-1 px-3 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition">Hủy</button>
              <button onClick={confirmDeleteRegion} disabled={isDeletingRegion}
                className="flex-1 px-3 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 rounded-lg transition flex items-center justify-center gap-1.5">
                <Trash2 className="w-3.5 h-3.5" />
                {isDeletingRegion ? 'Đang xóa...' : 'Xác nhận xóa'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
