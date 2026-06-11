import { useState } from 'react';
import { Plus, TrendingUp, TrendingDown, Settings, RefreshCw, AlertTriangle } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import AdminSettings, { loadColumnSettings, type ColumnKey } from '../components/AdminSettings';
import FilterDropdown, { ALL_OPTION } from '../components/FilterDropdown';
import { useRegions } from '../hooks/useRegions';
import { useManagers } from '../hooks/useManagers';
import type { Client, LaborHistoryEntry, MarketZone, Manager } from '../lib/types';
import { getMonthLast, statusPill, formatDate, daysUntil } from '../lib/format';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { logActivity } from '../lib/audit';

interface ClientsProps {
  clients: Client[];
  laborHistory: Record<string, LaborHistoryEntry[]>;
  activeRegion: string[];
  onRegionChange: (r: string[]) => void;
  onSelectClient: (id: string) => void;
  onAddClient: (regionName?: string, managerName?: string) => void;
  onClientUpdate: (c: Client) => void;
  isAdmin: boolean;
  marketZones: MarketZone[];
  toast: (m: string) => void;
}

interface RenewForm {
  client: Client;
  startDate: string;
  endDate: string;
  notes: string;
}

export default function Clients({
  clients, laborHistory, activeRegion, onRegionChange,
  onSelectClient, onAddClient, onClientUpdate, isAdmin, marketZones, toast,
}: ClientsProps) {
  const [search, setSearch] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [columns, setColumns] = useState(loadColumnSettings);
  const { user } = useAuth();
  const [renewForm, setRenewForm] = useState<RenewForm | null>(null);
  const [isRenewing, setIsRenewing] = useState(false);
  const [activeZones, setActiveZones] = useState<string[]>([ALL_OPTION]);
  const [activeManagers, setActiveManagers] = useState<string[]>([ALL_OPTION]);
  const [selectedManager, setSelectedManager] = useState<Manager | null>(null);

  const { regions, add: addRegion, update: updateRegion, remove: removeRegion } = useRegions();
  const { managers, add: addManager, update: updateManager, remove: removeManager } = useManagers();

  const regionNames = [ALL_OPTION, ...regions.map(r => r.name)];
  const managerNames = [ALL_OPTION, ...managers.map(m => m.name)];
  const zoneNames = [ALL_OPTION, ...marketZones.map(z => z.name)];

  const filtered = clients.filter(c => {
    const matchRegion = activeRegion.includes(ALL_OPTION) || activeRegion.includes(c.region || '');
    const matchManager = activeManagers.includes(ALL_OPTION) || activeManagers.includes(c.manager || '');
    const matchZones = activeZones.includes(ALL_OPTION) || (c.industrial_zones || []).some(z => activeZones.includes(z));
    const matchSearch = !search || c.name.toLowerCase().includes(search.toLowerCase());
    return matchRegion && matchManager && matchZones && matchSearch;
  });

  const getDelta = (clientId: string) => {
    const hist = laborHistory[clientId] || [];
    const t5 = getMonthLast(hist, 'T5');
    const t6 = getMonthLast(hist, 'T6');
    if (t5 !== null && t6 !== null) return t6 - t5;
    return null;
  };

  const openRenew = (e: React.MouseEvent, c: Client) => {
    e.stopPropagation();
    const oldEnd = c.contract_end || new Date().toISOString().slice(0, 10);
    const startDate = new Date(new Date(oldEnd).getTime() + 86400000).toISOString().slice(0, 10);
    const endDate = new Date(new Date(startDate).setFullYear(new Date(startDate).getFullYear() + 1)).toISOString().slice(0, 10);
    setRenewForm({ client: c, startDate, endDate, notes: '' });
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

  const col = (key: ColumnKey) => columns[key] !== false;

  return (
    <>
      <PageHeader
        title="Khách hàng"
        subtitle={`${clients.length} khách hàng · Click vào hàng để xem chi tiết`}
        actions={
          <div className="flex items-center gap-2">
            {isAdmin && (
              <button onClick={() => setShowSettings(true)} className="p-1.5 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 transition" title="Cài đặt">
                <Settings className="w-4 h-4" />
              </button>
            )}
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
                  {col('workers') && <th className="text-left px-3 py-2 text-[11.5px] text-[#888] font-medium bg-[#F9F9F7] whitespace-nowrap">LĐ</th>}
                  <th className="text-left px-3 py-2 text-[11.5px] text-[#888] font-medium bg-[#F9F9F7] whitespace-nowrap">Δ</th>
                  {col('cutoff') && <th className="text-left px-3 py-2 text-[11.5px] text-[#888] font-medium bg-[#F9F9F7] whitespace-nowrap">Chốt</th>}
                  {col('payment') && <th className="text-left px-3 py-2 text-[11.5px] text-[#888] font-medium bg-[#F9F9F7] whitespace-nowrap">Kỳ TT</th>}
                  {col('contract_end') && <th className="text-left px-3 py-2 text-[11.5px] text-[#888] font-medium bg-[#F9F9F7] whitespace-nowrap">Hết HĐ</th>}
                  {col('progress') && <th className="text-left px-3 py-2 text-[11.5px] text-[#888] font-medium bg-[#F9F9F7] whitespace-nowrap">Tiến độ</th>}
                  {col('status') && <th className="text-left px-3 py-2 text-[11.5px] text-[#888] font-medium bg-[#F9F9F7] whitespace-nowrap">TT</th>}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={10} className="text-center py-8 text-[#aaa]">Không có dữ liệu</td></tr>
                ) : filtered.map(c => {
                  const delta = getDelta(c.id);
                  const d = daysUntil(c.contract_end);
                  const pill = statusPill(c.status);
                  const minW = c.min_workers || 0;
                  const curW = c.current_workers || 0;
                  const underMin = minW > 0 && curW < minW;
                  const isWarn = c.status === 'warn' || c.status === 'danger';

                  return (
                    <tr key={c.id}
                      onClick={() => onSelectClient(c.id)}
                      className={`cursor-pointer border-b border-[#F0EEE9] last:border-0 transition-colors ${underMin ? 'bg-red-50 hover:bg-red-100' : 'hover:bg-[#F9F9F7]'}`}>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1.5">
                          {underMin && <AlertTriangle className="w-3.5 h-3.5 text-red-600 flex-shrink-0" />}
                          <div>
                            <div className="font-semibold text-[13px]">{c.name}</div>
                            {c.notes && <div className="text-[11px] text-[#aaa] font-normal truncate max-w-[160px]">{c.notes}</div>}
                          </div>
                        </div>
                      </td>
                      {col('region') && <td className="px-3 py-2 text-[12px] text-[#555]">{c.region || '—'}</td>}
                      {col('manager') && (
                        <td className="px-3 py-2 text-[12px] whitespace-nowrap">
                          {c.manager ? (
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
                      {col('workers') && (
                        <td className="px-3 py-2">
                          <div className={`font-semibold ${underMin ? 'text-red-700' : ''}`}>
                            {curW.toLocaleString()}
                            {minW > 0 && <span className="text-[11px] font-normal ml-1 text-gray-400">/{minW.toLocaleString()}</span>}
                          </div>
                          {underMin && (
                            <div className="text-[10px] text-red-600 font-medium">-{(minW - curW).toLocaleString()}</div>
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
                      {col('cutoff') && <td className="px-3 py-2 text-[12px]">Ngày {c.cutoff_day}</td>}
                      {col('payment') && <td className="px-3 py-2 text-[12px] whitespace-nowrap">{c.next_month_pay ? 'T sau' : `${c.payment_start}–${c.payment_end}`}</td>}
                      {col('contract_end') && (
                        <td className="px-3 py-2" onClick={e => isWarn && openRenew(e, c)}>
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
                        </td>
                      )}
                      {col('progress') && (
                        <td className="px-3 py-2">
                          <div className="flex gap-0.5">
                            {[{ l: 'C', v: c.prog_cutoff }, { l: 'T', v: c.prog_calc }, { l: '₫', v: c.prog_paid }].map(p => (
                              <div key={p.l} className={`w-[20px] h-[20px] rounded-full text-[10px] flex items-center justify-center font-medium ${p.v ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-400'}`}>{p.l}</div>
                            ))}
                          </div>
                        </td>
                      )}
                      {col('status') && (
                        <td className="px-3 py-2">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${pill.cls}`}>{pill.label}</span>
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

      {/* Manager Detail Modal */}
      {selectedManager && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-[12px] w-full max-w-md shadow-xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#E8E7E2]">
              <h3 className="text-[14px] font-semibold text-[#111]">{selectedManager.name}</h3>
              <button onClick={() => setSelectedManager(null)} className="text-[#aaa] hover:text-[#555] transition text-lg leading-none">×</button>
            </div>
            <div className="p-5 space-y-3">
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
            <div className="px-5 pb-5">
              <button onClick={() => setSelectedManager(null)} className="w-full py-2 rounded-lg text-[13px] font-medium border border-gray-300 text-gray-600 hover:bg-gray-50 transition">Đóng</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
