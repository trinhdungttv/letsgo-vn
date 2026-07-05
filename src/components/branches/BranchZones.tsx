import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, MapPin, User, Building2, Settings, X as XIcon, Check, Pencil, LayoutGrid, List, ChevronDown, ChevronUp } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type { BranchZone, BranchZoneCost, BranchStaff, Client, Manager, OverheadCategory } from '../../lib/types';

interface Props {
  branchId: string;
  branchClients: Client[];
  allClients: Client[];
  managers: Manager[];
  staffs: BranchStaff[];
  onAddStaff: (fields: { name: string; role?: string | null; phone?: string | null; email?: string | null; zone_id?: string | null; salary?: number }) => Promise<BranchStaff>;
  onUpdateStaff: (id: string, fields: Partial<Pick<BranchStaff, 'name' | 'role' | 'phone' | 'email' | 'salary' | 'zone_id'>>) => Promise<void>;
  onDeleteStaff: (id: string) => Promise<void>;
  overheadCategories: OverheadCategory[];
  onAddCategory: (label: string) => Promise<OverheadCategory>;
  onRenameCategory: (id: string, label: string) => Promise<void>;
  onDeleteCategory: (id: string) => Promise<void>;
  toast: (msg: string) => void;
}

export default function BranchZones({ branchId, branchClients, allClients, managers, staffs, onAddStaff, onUpdateStaff, onDeleteStaff, overheadCategories, onAddCategory, onRenameCategory, onDeleteCategory, toast }: Props) {
  const [zones, setZones] = useState<BranchZone[]>([]);
  const [costs, setCosts] = useState<Record<string, BranchZoneCost[]>>({});
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'card' | 'list'>('card');
  const [expandedZone, setExpandedZone] = useState<string | null>(null);
  const [editingZone, setEditingZone] = useState<string | null>(null);
  const [catSettingsOpen, setCatSettingsOpen] = useState(false);
  const [newCatLabel, setNewCatLabel] = useState('');
  const [editCatId, setEditCatId] = useState<string | null>(null);
  const [editCatLabel, setEditCatLabel] = useState('');

  const load = useCallback(async () => {
    const { data: zData } = await supabase.from('branch_zones').select('*').eq('branch_id', branchId).order('created_at');
    const zoneList = (zData ?? []) as BranchZone[];
    setZones(zoneList);
    if (zoneList.length) {
      const { data: cData } = await supabase.from('branch_zone_costs').select('*')
        .in('zone_id', zoneList.map(z => z.id)).order('sort_order');
      const grouped: Record<string, BranchZoneCost[]> = {};
      for (const c of (cData ?? []) as BranchZoneCost[]) (grouped[c.zone_id] ??= []).push(c);
      setCosts(grouped);
    }
    setLoading(false);
  }, [branchId]);

  useEffect(() => { load(); }, [load]);

  const addZone = async () => {
    const { data, error } = await supabase.from('branch_zones')
      .insert({ branch_id: branchId, name: 'Van phong moi', location: '', manager_name: '', manager_salary: 0, image_url: null, image_fit: 'cover', image_position: '50% 50%', client_ids: [] })
      .select().single();
    if (error) { toast('Loi: ' + error.message); return; }
    const z = data as BranchZone;
    setZones(prev => [...prev, z]);
    setExpandedZone(z.id);
    setEditingZone(z.id);
  };

  const updateZone = async (id: string, fields: Partial<BranchZone>) => {
    const { error } = await supabase.from('branch_zones').update(fields).eq('id', id);
    if (error) { toast('Loi: ' + error.message); return; }
    setZones(prev => prev.map(z => z.id === id ? { ...z, ...fields } : z));
  };

  const deleteZone = async (id: string) => {
    const { error } = await supabase.from('branch_zones').delete().eq('id', id);
    if (error) { toast('Loi: ' + error.message); return; }
    setZones(prev => prev.filter(z => z.id !== id));
    setCosts(prev => { const n = { ...prev }; delete n[id]; return n; });
    if (expandedZone === id) setExpandedZone(null);
  };

  const addCostFromCategory = async (zoneId: string, label: string) => {
    const existing = costs[zoneId] || [];
    if (existing.some(c => c.label === label)) { toast('Da co hang muc nay'); return; }
    const { data, error } = await supabase.from('branch_zone_costs')
      .insert({ zone_id: zoneId, label, amount: 0, sort_order: existing.length })
      .select().single();
    if (error) { toast('Loi: ' + error.message); return; }
    setCosts(prev => ({ ...prev, [zoneId]: [...(prev[zoneId] || []), data as BranchZoneCost] }));
  };

  const updateCost = async (costId: string, zoneId: string, fields: Partial<BranchZoneCost>) => {
    const { error } = await supabase.from('branch_zone_costs').update(fields).eq('id', costId);
    if (error) { toast('Loi: ' + error.message); return; }
    setCosts(prev => ({ ...prev, [zoneId]: (prev[zoneId] || []).map(c => c.id === costId ? { ...c, ...fields } : c) }));
  };

  const deleteCost = async (costId: string, zoneId: string) => {
    const { error } = await supabase.from('branch_zone_costs').delete().eq('id', costId);
    if (error) { toast('Loi: ' + error.message); return; }
    setCosts(prev => ({ ...prev, [zoneId]: (prev[zoneId] || []).filter(c => c.id !== costId) }));
  };

  const getZoneClients = (zone: BranchZone) => {
    const ids = zone.client_ids || [];
    if (!ids.length) return [];
    return allClients.filter(c => ids.includes(c.id));
  };
  void branchClients;

  const fmtVnd = (v: number) => v.toLocaleString('vi-VN');
  const zoneStaffs = (zoneId: string) => staffs.filter(s => s.zone_id === zoneId);
  const zoneSalaryCost = (zoneId: string) => zoneStaffs(zoneId).reduce((s, st) => s + (st.salary || 0), 0);
  const zoneTotalCost = (zone: BranchZone) => zoneSalaryCost(zone.id) + (costs[zone.id] || []).reduce((s, c) => s + (c.amount || 0), 0);

  if (loading) return <div className="text-[12px] text-[#999] text-center py-6">Dang tai...</div>;

  const renderEditForm = (zone: BranchZone) => {
    const zoneCosts = costs[zone.id] || [];
    const availableCats = overheadCategories.filter(cat => !zoneCosts.some(c => c.label === cat.label));
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] text-[#999] uppercase font-medium block mb-1">Ten van phong</label>
            <input defaultValue={zone.name} onBlur={e => updateZone(zone.id, { name: e.target.value })}
              className="w-full text-[12px] px-2.5 py-1.5 border border-gray-300 rounded-lg outline-none focus:border-blue-500" />
          </div>
          <div>
            <label className="text-[10px] text-[#999] uppercase font-medium block mb-1">Dia danh / KCN</label>
            <input defaultValue={zone.location || ''} onBlur={e => updateZone(zone.id, { location: e.target.value })}
              placeholder="VD: Bien Hoa, Nhon Trach..."
              className="w-full text-[12px] px-2.5 py-1.5 border border-gray-300 rounded-lg outline-none focus:border-blue-500" />
          </div>
          <div>
            <label className="text-[10px] text-[#999] uppercase font-medium block mb-1">Quan ly phu trach</label>
            <select value={zone.manager_name || ''} onChange={e => updateZone(zone.id, { manager_name: e.target.value })}
              className="w-full text-[12px] px-2.5 py-1.5 border border-gray-300 rounded-lg outline-none focus:border-blue-500">
              <option value="">-- Chon quan ly --</option>
              {managers.map(m => <option key={m.id} value={m.name}>{m.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] text-[#999] uppercase font-medium block mb-1">Luong quan ly (d/thang)</label>
            <input type="text" defaultValue={zone.manager_salary ? fmtVnd(zone.manager_salary) : '0'}
              onFocus={e => { e.target.value = String(zone.manager_salary || 0); }}
              onBlur={e => { const v = +e.target.value.replace(/\D/g, '') || 0; updateZone(zone.id, { manager_salary: v }); e.target.value = fmtVnd(v); }}
              className="w-full text-[12px] px-2.5 py-1.5 border border-gray-300 rounded-lg outline-none focus:border-blue-500 text-right" />
          </div>
          <div className="col-span-2">
            <label className="text-[10px] text-[#999] uppercase font-medium block mb-1">Hinh anh van phong (URL)</label>
            <input defaultValue={zone.image_url || ''} onBlur={e => updateZone(zone.id, { image_url: e.target.value || null })}
              placeholder="https://..."
              className="w-full text-[12px] px-2.5 py-1.5 border border-gray-300 rounded-lg outline-none focus:border-blue-500" />
          </div>
          {zone.image_url && (
            <div className="col-span-2">
              <div className="flex items-center gap-3">
                <div className="w-[120px] h-[70px] rounded-lg overflow-hidden border border-gray-200 shrink-0">
                  <img src={zone.image_url} alt="" className="w-full h-full"
                    style={{ objectFit: (zone.image_fit || 'cover') as 'cover' | 'contain' | 'fill', objectPosition: zone.image_position || '50% 50%' }} />
                </div>
                <div className="flex-1 space-y-2">
                  <div>
                    <label className="text-[10px] text-[#999] block mb-0.5">Che do hien thi</label>
                    <select value={zone.image_fit || 'cover'} onChange={e => updateZone(zone.id, { image_fit: e.target.value })}
                      className="text-[11px] px-2 py-1 border border-gray-300 rounded-lg outline-none">
                      <option value="cover">Lap day (cat anh)</option>
                      <option value="contain">Vua khung (giu nguyen)</option>
                      <option value="fill">Keo gian vua khung</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-[#999] block mb-0.5">Vi tri anh</label>
                    <div className="grid grid-cols-3 gap-1 w-[90px]">
                      {['0% 0%','50% 0%','100% 0%','0% 50%','50% 50%','100% 50%','0% 100%','50% 100%','100% 100%'].map(pos => (
                        <button key={pos} onClick={() => updateZone(zone.id, { image_position: pos })}
                          className={`w-7 h-5 rounded border text-[8px] ${(zone.image_position || '50% 50%') === pos ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-[#999] hover:bg-gray-50'}`}>
                          {pos === '50% 50%' ? 'C' : pos === '0% 0%' ? 'TL' : pos === '100% 0%' ? 'TR' : pos === '0% 100%' ? 'BL' : pos === '100% 100%' ? 'BR' : pos === '50% 0%' ? 'T' : pos === '50% 100%' ? 'B' : pos === '0% 50%' ? 'L' : 'R'}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10.5px] text-[#999] uppercase font-medium">Chi phi co dinh hang thang</div>
            <button onClick={() => setCatSettingsOpen(true)} className="p-1 rounded border border-gray-200 text-[#999] hover:text-[#555] hover:border-gray-400 transition" title="Quan ly danh muc chi phi">
              <Settings size={11} />
            </button>
          </div>
          <div className="space-y-1.5">
            {zoneCosts.map(c => (
              <div key={c.id} className="flex items-center gap-2">
                <span className="flex-1 text-[12px] text-[#333]">{c.label}</span>
                <div className="relative w-[140px]">
                  <input type="text" defaultValue={c.amount ? fmtVnd(c.amount) : '0'}
                    onFocus={e => { e.target.value = String(c.amount || 0); }}
                    onBlur={e => { const v = +e.target.value.replace(/\D/g, '') || 0; updateCost(c.id, zone.id, { amount: v }); e.target.value = fmtVnd(v); }}
                    className="w-full text-[12px] px-2 py-1.5 pr-6 border border-gray-300 rounded-lg outline-none focus:border-blue-500 text-right" />
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-[#999]">d</span>
                </div>
                <button onClick={() => deleteCost(c.id, zone.id)} className="text-[#bbb] hover:text-red-600 transition"><Trash2 size={13} /></button>
              </div>
            ))}
            {availableCats.length > 0 ? (
              <select value="" onChange={e => { if (e.target.value) addCostFromCategory(zone.id, e.target.value); e.target.value = ''; }}
                className="w-full text-[11px] px-2 py-1.5 border border-gray-300 rounded-lg outline-none text-[#666] mt-1">
                <option value="">+ Them hang muc chi phi...</option>
                {availableCats.map(cat => <option key={cat.id} value={cat.label}>{cat.label}</option>)}
              </select>
            ) : (
              <span className="text-[10px] text-[#bbb] mt-1 block">Da them tat ca hang muc</span>
            )}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10.5px] text-[#999] uppercase font-medium">Du an / Khach hang ({(zone.client_ids || []).length})</div>
          </div>
          <div className="space-y-1">
            {getZoneClients(zone).map(c => (
              <div key={c.id} className="flex items-center justify-between text-[12px] px-2.5 py-1.5 bg-gray-50 rounded-lg">
                <span className="font-medium text-[#333]">{c.name}</span>
                <button onClick={() => {
                  const ids = (zone.client_ids || []).filter(id => id !== c.id);
                  updateZone(zone.id, { client_ids: ids });
                }} className="text-[#bbb] hover:text-red-600"><XIcon size={12} /></button>
              </div>
            ))}
            <select value="" onChange={e => {
              if (!e.target.value) return;
              const ids = [...(zone.client_ids || []), e.target.value];
              updateZone(zone.id, { client_ids: ids });
              e.target.value = '';
            }} className="w-full text-[11px] px-2 py-1.5 border border-gray-300 rounded-lg outline-none text-[#666]">
              <option value="">+ Them khach hang vao zone...</option>
              {allClients.filter(c => !(zone.client_ids || []).includes(c.id) && c.cooperation_status !== 'suspended').map(c => (
                <option key={c.id} value={c.id}>{c.name} {c.current_workers ? `(${c.current_workers} LD)` : ''}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10.5px] text-[#999] uppercase font-medium">Nhan su van phong</div>
            <span className="text-[10px] text-[#888]">Tong luong: {fmtVnd(zoneSalaryCost(zone.id))} d</span>
          </div>
          <div className="space-y-1.5">
            {zoneStaffs(zone.id).map(st => (
              <div key={st.id} className="flex items-center gap-2 bg-gray-50 rounded-lg px-2.5 py-1.5">
                <div className="flex-1 min-w-0">
                  <input defaultValue={st.name} onBlur={e => onUpdateStaff(st.id, { name: e.target.value })}
                    className="text-[12px] font-medium bg-transparent outline-none w-full" />
                </div>
                <select value={st.role || ''} onChange={e => onUpdateStaff(st.id, { role: e.target.value || null })}
                  className="text-[10.5px] px-1.5 py-1 border border-gray-200 rounded outline-none w-[90px]">
                  <option value="">Vai tro</option>
                  <option value="Quan ly">Quan ly</option>
                  <option value="Nhan su">Nhan su</option>
                  <option value="Ke toan">Ke toan</option>
                  <option value="Hanh chinh">Hanh chinh</option>
                </select>
                <div className="relative w-[120px]">
                  <input type="text" defaultValue={st.salary ? fmtVnd(st.salary) : '0'}
                    onFocus={e => { e.target.value = String(st.salary || 0); }}
                    onBlur={e => { const v = +e.target.value.replace(/\D/g, '') || 0; onUpdateStaff(st.id, { salary: v }); e.target.value = fmtVnd(v); }}
                    className="w-full text-[11px] px-2 py-1 pr-5 border border-gray-200 rounded-lg outline-none focus:border-blue-500 text-right" />
                  <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[9px] text-[#999]">d</span>
                </div>
                <button onClick={() => onDeleteStaff(st.id)} className="text-[#bbb] hover:text-red-600 transition shrink-0"><Trash2 size={12} /></button>
              </div>
            ))}
            <button onClick={async () => {
              try { await onAddStaff({ name: 'Nhan su moi', role: 'Nhan su', zone_id: zone.id, salary: 0 }); }
              catch (e) { toast('Loi: ' + (e instanceof Error ? e.message : String(e))); }
            }} className="text-[11px] text-[#999] hover:text-[#555] flex items-center gap-1 mt-1">
              <Plus size={11} /> Them nhan su
            </button>
          </div>
        </div>

        <div className="pt-3 border-t border-gray-100 flex items-center justify-between">
          <button onClick={() => setEditingZone(null)} className="text-[11px] text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1">
            <Check size={12} /> Xong
          </button>
          <button onClick={() => deleteZone(zone.id)} className="text-[11px] text-red-500 hover:text-red-700 flex items-center gap-1">
            <Trash2 size={11} /> Xoa van phong
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-[12.5px] font-semibold text-[#111] flex items-center gap-2">
          <Building2 size={14} className="text-[#999]" /> Van phong dai dien
          <span className="text-[10.5px] text-[#999] font-normal ml-1">{zones.length} van phong</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex border border-gray-300 rounded-lg overflow-hidden">
            <button onClick={() => setViewMode('card')} className={`p-1.5 ${viewMode === 'card' ? 'bg-gray-100 text-[#111]' : 'text-[#999] hover:bg-gray-50'}`}><LayoutGrid size={13} /></button>
            <button onClick={() => setViewMode('list')} className={`p-1.5 ${viewMode === 'list' ? 'bg-gray-100 text-[#111]' : 'text-[#999] hover:bg-gray-50'}`}><List size={13} /></button>
          </div>
          <button onClick={() => setCatSettingsOpen(true)} className="p-1.5 rounded-lg border border-gray-200 text-[#999] hover:text-[#555] hover:border-gray-400 transition" title="Quan ly danh muc chi phi">
            <Settings size={13} />
          </button>
          <button onClick={addZone} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-[#1D4ED8] text-white hover:bg-[#1E40AF] transition">
            <Plus size={12} /> Them
          </button>
        </div>
      </div>

      {zones.length === 0 && (
        <div className="text-[12px] text-[#999] text-center py-8 bg-gray-50 rounded-xl border border-dashed border-gray-300">
          Chua co van phong nao. Bam "Them" de bat dau.
        </div>
      )}

      {/* LIST VIEW */}
      {viewMode === 'list' && zones.length > 0 && (
        <div className="bg-white border border-[#E8E7E2] rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-[10px] text-[#999] uppercase bg-[#F5F4EF]">
                <th className="text-left font-medium px-3.5 py-2">Van phong</th>
                <th className="text-left font-medium px-3 py-2">Dia danh</th>
                <th className="text-left font-medium px-3 py-2">Quan ly</th>
                <th className="text-right font-medium px-3 py-2">Du an</th>
                <th className="text-right font-medium px-3 py-2">Lao dong</th>
                <th className="text-right font-medium px-3 py-2">Chi phi CD</th>
                <th className="w-[60px]"></th>
              </tr>
            </thead>
            <tbody>
              {zones.map(zone => {
                const zc = getZoneClients(zone);
                return (
                  <tr key={zone.id} className="border-t border-[#F0EEE9] hover:bg-[#FAFAF8] cursor-pointer" onClick={() => { setExpandedZone(zone.id); setViewMode('card'); }}>
                    <td className="px-3.5 py-2.5 font-medium text-[#111]">{zone.name}</td>
                    <td className="px-3 py-2.5 text-[#666]">{zone.location || '—'}</td>
                    <td className="px-3 py-2.5 text-[#666]">{zone.manager_name || '—'}</td>
                    <td className="px-3 py-2.5 text-right">{zc.length}</td>
                    <td className="px-3 py-2.5 text-right font-semibold">{zc.reduce((s, c) => s + (c.current_workers || 0), 0)}</td>
                    <td className="px-3 py-2.5 text-right text-red-600 font-medium">{fmtVnd(zoneTotalCost(zone))} d</td>
                    <td className="px-3 py-2.5 text-center">
                      <button onClick={e => { e.stopPropagation(); deleteZone(zone.id); }} className="text-[#bbb] hover:text-red-600"><Trash2 size={13} /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {/* CARD VIEW */}
      {viewMode === 'card' && zones.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3">
          {zones.map(zone => {
            const isOpen = expandedZone === zone.id;
            const isEditing = editingZone === zone.id;
            const zoneClients = getZoneClients(zone);
            const totalCost = zoneTotalCost(zone);
            const totalWorkers = zoneClients.reduce((s, c) => s + (c.current_workers || 0), 0);
            const zoneCosts = costs[zone.id] || [];

            return (
              <div key={zone.id} className={`bg-white border border-[#E8E7E2] rounded-xl overflow-hidden transition ${isOpen ? 'col-span-full' : ''}`}>
                {!isOpen ? (
                  <button onClick={() => setExpandedZone(zone.id)} className="w-full text-left hover:bg-[#FAFAF8] transition">
                    {zone.image_url && (
                      <div className="h-28 w-full overflow-hidden bg-gray-100">
                        <img src={zone.image_url} alt={zone.name} className="w-full h-full"
                          style={{ objectFit: (zone.image_fit || 'cover') as 'cover' | 'contain' | 'fill', objectPosition: zone.image_position || '50% 50%' }} />
                      </div>
                    )}
                    {!zone.image_url && (
                      <div className="h-16 w-full bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center">
                        <Building2 size={20} className="text-[#ccc]" />
                      </div>
                    )}
                    <div className="p-3.5">
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="text-[12.5px] font-semibold text-[#111]">{zone.name}</div>
                          <div className="text-[10.5px] text-[#888] flex items-center gap-1.5 mt-0.5">
                            <MapPin size={10} /> {zone.location || 'Chua co dia danh'}
                          </div>
                        </div>
                        <ChevronDown size={14} className="text-[#ccc] shrink-0 mt-0.5" />
                      </div>
                      <div className="grid grid-cols-3 gap-2 mt-3 pt-2.5 border-t border-gray-100">
                        <div className="text-center">
                          <div className="text-[14px] font-bold text-[#111]">{zoneClients.length}</div>
                          <div className="text-[9px] text-[#999] uppercase">Du an</div>
                        </div>
                        <div className="text-center">
                          <div className="text-[14px] font-bold text-[#111]">{totalWorkers}</div>
                          <div className="text-[9px] text-[#999] uppercase">Lao dong</div>
                        </div>
                        <div className="text-center">
                          <div className="text-[14px] font-bold text-red-600">{fmtVnd(totalCost)}</div>
                          <div className="text-[9px] text-[#999] uppercase">Chi phi/thang</div>
                        </div>
                      </div>
                      <div className="flex items-center justify-between mt-2.5 pt-2 border-t border-gray-100 text-[10.5px]">
                        {zone.manager_name ? (
                          <span className="flex items-center gap-1 text-[#666]"><User size={10} /> {zone.manager_name}</span>
                        ) : <span className="text-[#bbb]">Chua co quan ly</span>}
                        {zoneCosts.length > 0 && <span className="text-[#999]">{zoneCosts.length} khoan CP</span>}
                      </div>
                    </div>
                  </button>
                ) : (
                  <>
                    <div className="flex items-center justify-between px-4 py-3 border-b border-[#E8E7E2]">
                      <div className="flex items-center gap-2">
                        {zone.image_url && <img src={zone.image_url} alt="" className="w-8 h-8 rounded-lg object-cover" />}
                        <div>
                          <div className="text-[12.5px] font-semibold text-[#111]">{zone.name}</div>
                          <div className="text-[10.5px] text-[#888]">{zone.location || ''} · {zone.manager_name || ''}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button onClick={() => setEditingZone(isEditing ? null : zone.id)}
                          className={`p-1.5 rounded-lg border transition ${isEditing ? 'border-blue-400 text-blue-600 bg-blue-50' : 'border-gray-200 text-[#999] hover:text-[#555]'}`}>
                          <Pencil size={12} />
                        </button>
                        <button onClick={() => setExpandedZone(null)} className="p-1.5 rounded-lg border border-gray-200 text-[#999] hover:text-[#555]">
                          <ChevronUp size={12} />
                        </button>
                      </div>
                    </div>
                    <div className="p-4">
                      {isEditing ? renderEditForm(zone) : (
                        <div className="space-y-4">
                          <div className="grid grid-cols-4 gap-3 text-[12px]">
                            <div><span className="text-[10px] text-[#999] uppercase">Dia danh</span><div className="text-[#333] mt-0.5">{zone.location || '—'}</div></div>
                            <div><span className="text-[10px] text-[#999] uppercase">Quan ly</span><div className="text-[#333] mt-0.5">{zone.manager_name || '—'}</div></div>
                            <div><span className="text-[10px] text-[#999] uppercase">Luong QL</span><div className="text-[#333] mt-0.5">{zone.manager_salary ? fmtVnd(zone.manager_salary) + ' d' : '—'}</div></div>
                            <div><span className="text-[10px] text-[#999] uppercase">Tong CP CD</span><div className="text-red-600 font-medium mt-0.5">{fmtVnd(totalCost)} d</div></div>
                          </div>
                          {zoneCosts.length > 0 && (
                            <div>
                              <div className="text-[10px] text-[#999] uppercase mb-1.5">Chi phi co dinh</div>
                              {zoneCosts.map(c => (
                                <div key={c.id} className="flex justify-between text-[11.5px] py-1 border-b border-gray-50">
                                  <span className="text-[#555]">{c.label}</span>
                                  <span className="text-[#333] font-medium">{fmtVnd(c.amount)} d</span>
                                </div>
                              ))}
                            </div>
                          )}
                          {zoneStaffs(zone.id).length > 0 && (
                            <div>
                              <div className="text-[10px] text-[#999] uppercase mb-1.5">Nhan su ({zoneStaffs(zone.id).length}) — {fmtVnd(zoneSalaryCost(zone.id))} d/thang</div>
                              {zoneStaffs(zone.id).map(st => (
                                <div key={st.id} className="flex items-center justify-between text-[11.5px] py-1 border-b border-gray-50">
                                  <span className="text-[#333]">{st.name} <span className="text-[10px] text-[#999]">{st.role || ''}</span></span>
                                  <span className="text-[#555] font-medium">{st.salary ? fmtVnd(st.salary) + ' d' : '—'}</span>
                                </div>
                              ))}
                            </div>
                          )}

                          {zoneClients.length > 0 && (
                            <div>
                              <div className="text-[10px] text-[#999] uppercase mb-1.5">Du an ({zoneClients.length})</div>
                              {zoneClients.map(c => (
                                <div key={c.id} className="flex items-center justify-between text-[11.5px] px-2.5 py-1.5 bg-gray-50 rounded-lg mb-1">
                                  <span className="font-medium text-[#333]">{c.name}</span>
                                  <span className="text-[#888]">{(c.current_workers || 0).toLocaleString()} LD</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {zones.length > 0 && (
        <div className="bg-[#F5F4EF] rounded-xl p-3.5 text-[12px]">
          <div className="font-semibold text-[#111] mb-1.5">Tong hop</div>
          <div className="grid grid-cols-3 gap-2 text-[11px]">
            <div><div className="text-[#888]">Van phong</div><div className="font-semibold text-[#111]">{zones.length}</div></div>
            <div><div className="text-[#888]">Lao dong</div><div className="font-semibold text-[#111]">{zones.reduce((s, z) => s + getZoneClients(z).reduce((ss, c) => ss + (c.current_workers || 0), 0), 0).toLocaleString()}</div></div>
            <div><div className="text-[#888]">Chi phi CD</div><div className="font-semibold text-red-600">{fmtVnd(zones.reduce((s, z) => s + zoneTotalCost(z), 0))} d/thang</div></div>
          </div>
        </div>
      )}

      {/* Settings modal for overhead categories */}
      {catSettingsOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={e => { if (e.target === e.currentTarget) setCatSettingsOpen(false); }}>
          <div className="bg-white rounded-xl shadow-2xl p-5 w-[360px]">
            <div className="flex items-center justify-between mb-4">
              <div className="text-[13px] font-semibold text-[#111]">Danh muc chi phi co dinh</div>
              <button onClick={() => setCatSettingsOpen(false)} className="text-[#aaa] hover:text-[#666]"><XIcon size={15} /></button>
            </div>
            <div className="text-[10.5px] text-[#888] mb-3">Danh muc dung chung cho tat ca van phong / chi nhanh</div>
            <div className="space-y-1.5 mb-4 max-h-[300px] overflow-y-auto">
              {overheadCategories.map(cat => (
                <div key={cat.id} className="flex items-center gap-2 group">
                  {editCatId === cat.id ? (
                    <>
                      <input autoFocus value={editCatLabel} onChange={e => setEditCatLabel(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') { onRenameCategory(cat.id, editCatLabel.trim()); setEditCatId(null); } if (e.key === 'Escape') setEditCatId(null); }}
                        className="flex-1 text-[12px] px-2 py-1.5 border border-blue-400 rounded-lg outline-none" />
                      <button onClick={() => { onRenameCategory(cat.id, editCatLabel.trim()); setEditCatId(null); }} className="text-emerald-600 hover:text-emerald-800"><Check size={14} /></button>
                      <button onClick={() => setEditCatId(null)} className="text-gray-400 hover:text-gray-600"><XIcon size={14} /></button>
                    </>
                  ) : (
                    <>
                      <span className="flex-1 text-[12px] text-[#333] px-2 py-1.5">{cat.label}</span>
                      <button onClick={() => { setEditCatId(cat.id); setEditCatLabel(cat.label); }}
                        className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-blue-600 transition"><Pencil size={12} /></button>
                      <button onClick={() => onDeleteCategory(cat.id)}
                        className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-600 transition"><Trash2 size={12} /></button>
                    </>
                  )}
                </div>
              ))}
              {overheadCategories.length === 0 && <div className="text-[11px] text-[#999] text-center py-3">Chua co hang muc nao</div>}
            </div>
            <div className="flex gap-2">
              <input value={newCatLabel} onChange={e => setNewCatLabel(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && newCatLabel.trim()) { onAddCategory(newCatLabel.trim()).then(() => setNewCatLabel('')).catch(err => toast('Loi: ' + err.message)); } }}
                placeholder="Ten hang muc moi..."
                className="flex-1 text-[12px] px-2.5 py-1.5 border border-gray-300 rounded-lg outline-none focus:border-blue-500" />
              <button onClick={() => { if (newCatLabel.trim()) onAddCategory(newCatLabel.trim()).then(() => setNewCatLabel('')).catch(err => toast('Loi: ' + err.message)); }}
                disabled={!newCatLabel.trim()}
                className="px-3 py-1.5 rounded-lg text-[11px] font-medium bg-[#1D4ED8] text-white hover:bg-[#1E40AF] disabled:opacity-40 transition">
                <Plus size={12} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
