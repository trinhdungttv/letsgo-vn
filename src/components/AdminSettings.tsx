import React, { useState } from 'react';
import { X, Plus, Pencil, Trash2, Check } from 'lucide-react';
import type { Region, Manager } from '../lib/types';

type Tab = 'regions' | 'managers' | 'columns';

const ALL_COLUMNS = [
  { key: 'region', label: 'Chi Nhánh' },
  { key: 'manager', label: 'Quản lý' },
  { key: 'workers', label: 'LĐ' },
  { key: 'cutoff', label: 'Chốt' },
  { key: 'payment', label: 'Kỳ TT' },
  { key: 'contract_end', label: 'Hết HĐ' },
  { key: 'progress', label: 'Tiến độ' },
  { key: 'status', label: 'TT' },
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
  onAddRegion: (name: string) => Promise<void>;
  onUpdateRegion: (id: string, name: string) => Promise<void>;
  onDeleteRegion: (id: string) => Promise<void>;
  onAddManager: (fields: Omit<Manager, 'id' | 'created_at'>) => Promise<void>;
  onUpdateManager: (id: string, fields: Partial<Omit<Manager, 'id' | 'created_at'>>) => Promise<void>;
  onDeleteManager: (id: string) => Promise<void>;
  onColumnsChange: (cols: Record<ColumnKey, boolean>) => void;
  onClose: () => void;
  toast: (m: string) => void;
}

export default function AdminSettings({
  regions, managers, columns,
  onAddRegion, onUpdateRegion, onDeleteRegion,
  onAddManager, onUpdateManager, onDeleteManager,
  onColumnsChange, onClose, toast,
}: AdminSettingsProps) {
  const [tab, setTab] = useState<Tab>('regions');
  const [saving, setSaving] = useState(false);

  // Regions state
  const [newRegion, setNewRegion] = useState('');
  const [editingRegion, setEditingRegion] = useState<{ id: string; name: string } | null>(null);

  // Managers state
  const [newMgr, setNewMgr] = useState<Omit<Manager, 'id' | 'created_at'>>({ name: '', phone: '', email: '', region: '' });
  const [editingMgr, setEditingMgr] = useState<Manager | null>(null);
  const [showAddMgr, setShowAddMgr] = useState(false);

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

  const handleDeleteRegion = (id: string, name: string) => {
    if (!confirm(`Xóa chi nhánh "${name}"?`)) return;
    wrap(() => onDeleteRegion(id), 'Đã xóa chi nhánh');
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
    { key: 'regions', label: 'Chi Nhánh' },
    { key: 'managers', label: 'Quản lý' },
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
          {/* TAB 1 - REGIONS */}
          {tab === 'regions' && (
            <div className="space-y-3">
              <div className="flex gap-2">
                <input
                  value={newRegion}
                  onChange={e => setNewRegion(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAddRegion()}
                  placeholder="Tên chi nhánh mới..."
                  className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button onClick={handleAddRegion} disabled={saving || !newRegion.trim()}
                  className="px-3 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5">
                  <Plus className="w-4 h-4" /> Thêm
                </button>
              </div>
              <div className="space-y-2">
                {regions.map(r => (
                  <div key={r.id} className="flex items-center gap-2 p-2.5 bg-gray-50 rounded-lg border border-gray-200">
                    {editingRegion?.id === r.id ? (
                      <>
                        <input
                          value={editingRegion.name}
                          onChange={e => setEditingRegion({ ...editingRegion, name: e.target.value })}
                          onKeyDown={e => e.key === 'Enter' && handleSaveRegion()}
                          className="flex-1 px-2.5 py-1.5 text-sm border border-blue-400 rounded-md focus:outline-none"
                          autoFocus
                        />
                        <button onClick={handleSaveRegion} disabled={saving} className="p-1.5 bg-emerald-600 text-white rounded-md hover:bg-emerald-700">
                          <Check className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => setEditingRegion(null)} className="p-1.5 bg-gray-200 text-gray-600 rounded-md hover:bg-gray-300">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </>
                    ) : (
                      <>
                        <span className="flex-1 text-sm text-gray-800 font-medium">{r.name}</span>
                        <button onClick={() => setEditingRegion({ id: r.id, name: r.name })} className="p-1.5 text-gray-500 hover:bg-gray-200 rounded-md">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => handleDeleteRegion(r.id, r.name)} disabled={saving} className="p-1.5 text-red-500 hover:bg-red-50 rounded-md">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                ))}
                {regions.length === 0 && <p className="text-sm text-gray-400 text-center py-4">Chưa có chi nhánh nào</p>}
              </div>
            </div>
          )}

          {/* TAB 2 - MANAGERS */}
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
                    {regions.map(r => <option key={r.id} value={r.name}>{r.name}</option>)}
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
                          {regions.map(r => <option key={r.id} value={r.name}>{r.name}</option>)}
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

          {/* TAB 3 - COLUMNS */}
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
    </div>
  );
}
