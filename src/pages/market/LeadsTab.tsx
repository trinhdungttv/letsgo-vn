import { useEffect, useState } from 'react';
import { Plus, X, ArrowRight, Pencil, Users } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type { MarketTabProps } from './shared';
import { logActivity } from '../../lib/audit';
import { useAuth } from '../../lib/auth';
import { parseLatLngFromLink, isValidVnLatLng } from '../../lib/geo';
import SearchSelect from './SearchSelect';
import SupplierFillCard from './SupplierFillCard';
import { fetchIndustries, addIndustry } from './industries';
import type { Client } from '../../lib/types';

const STATUS_OPTIONS = ['Chưa LH', 'Đang TH', 'Đã LH'];
const statusCls = (s: string) => s === 'Đã LH' ? 'bg-emerald-50 text-emerald-700' : s === 'Đang TH' ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700';

const emptyLeadForm = {
  company_name: '', region: '', industry: '', workers_needed: '', source: '', lgv_qty: '0', map_link: '',
  wage_min: '', wage_max: '', allowance_notes: '',
};
const emptyClientSetupForm = {
  client_id: '', industry: '', workers_needed: '', lgv_qty: '0',
  wage_min: '', wage_max: '', allowance_notes: '',
};

export default function LeadsTab({ marketLeads, clients, competitors, marketZones, zoneFilter, setZoneFilter, onRefresh, toast }: MarketTabProps) {
  const { user } = useAuth();
  const [addTab, setAddTab] = useState<'client' | 'lead' | null>(null);
  const [leadForm, setLeadForm] = useState(emptyLeadForm);
  const [clientForm, setClientForm] = useState(emptyClientSetupForm);
  const [saving, setSaving] = useState(false);
  const [industries, setIndustries] = useState<string[]>([]);
  const [editClientId, setEditClientId] = useState<string | null>(null);
  const [editLeadId, setEditLeadId] = useState<string | null>(null);
  const [provinceFilter, setProvinceFilter] = useState('all');
  const [industryFilter, setIndustryFilter] = useState('all');

  const competitorNames = [...new Set(competitors.map(c => c.company_name).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'vi'));

  useEffect(() => {
    fetchIndustries([...marketLeads.map(l => l.industry), ...clients.map(c => c.industry)]).then(setIndustries);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAddIndustry = async (name: string) => {
    const err = await addIndustry(name);
    if (err) toast('Lỗi thêm ngành: ' + err);
    setIndustries(prev => [...new Set([...prev, name])].sort((a, b) => a.localeCompare(b, 'vi')));
  };

  // Tỉnh/TP suy ra từ tên KCN (marketZones.location), giống cách làm ở tab Lương TT.
  const zoneToProvince: Record<string, string> = {};
  marketZones.forEach(z => { if (z.location) zoneToProvince[z.name] = z.location; });
  const provinces = [...new Set(marketZones.map(z => z.location).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, 'vi'));
  const zoneNames = [...new Set([
    ...marketZones.map(z => z.name),
    ...marketLeads.map(l => l.region).filter(Boolean) as string[],
    ...clients.flatMap(c => c.industrial_zones ?? []),
  ])].sort((a, b) => a.localeCompare(b, 'vi'));
  const zonesInProvince = provinceFilter === 'all' ? zoneNames : zoneNames.filter(z => zoneToProvince[z] === provinceFilter);

  const matchesProvince = (region: string | null | undefined, zones: string[] | undefined) => {
    if (provinceFilter === 'all') return true;
    if (region && zoneToProvince[region] === provinceFilter) return true;
    if (region === provinceFilter) return true;
    if (zones?.some(z => zoneToProvince[z] === provinceFilter)) return true;
    return false;
  };
  const matchesZone = (region: string | null | undefined, zones: string[] | undefined) => {
    if (zoneFilter === 'all') return true;
    if (region === zoneFilter || region?.includes(zoneFilter)) return true;
    if (zones?.includes(zoneFilter)) return true;
    return false;
  };
  const matchesIndustry = (industry: string | null | undefined) => industryFilter === 'all' || industry === industryFilter;

  const list = marketLeads.filter(l => matchesProvince(l.region, undefined) && matchesZone(l.region, undefined) && matchesIndustry(l.industry));
  const trackedClients = clients.filter(c =>
    c.market_workers_needed != null &&
    matchesProvince(c.region, c.industrial_zones ?? undefined) &&
    matchesZone(c.region, c.industrial_zones ?? undefined) &&
    matchesIndustry(c.industry),
  );
  const untrackedClients = clients.filter(c => c.market_workers_needed == null);

  const toNum = (v: string) => v.trim() ? parseFloat(v) * 1_000_000 : null;

  // ── Dự án/Công ty đang tìm hiểu (market_leads) ──

  const handleAddLead = async () => {
    if (!leadForm.company_name.trim()) { toast('Nhập tên công ty'); return; }
    setSaving(true);
    try {
      const mapPos = parseLatLngFromLink(leadForm.map_link);
      const { data, error } = await supabase.from('market_leads').insert({
        company_name: leadForm.company_name.trim(),
        region: leadForm.region || (zoneFilter !== 'all' ? zoneFilter : null),
        industry: leadForm.industry || null,
        workers_needed: parseInt(leadForm.workers_needed) || 0,
        source: leadForm.source || null,
        status: 'Chưa LH',
        suppliers: [{ name: "Let's Go VN", qty: parseInt(leadForm.lgv_qty) || 0, is_us: true }],
        map_link: leadForm.map_link.trim() || null,
        wage_min: toNum(leadForm.wage_min),
        wage_max: toNum(leadForm.wage_max),
        allowance_notes: leadForm.allowance_notes.trim() || null,
        ...(isValidVnLatLng(mapPos) ? { lat: mapPos.lat, lng: mapPos.lng, geocoded_at: new Date().toISOString() } : {}),
      }).select().single();
      if (error) throw error;
      await logActivity({
        user, action: 'insert', table: 'market_leads', recordId: data.id,
        description: `Thêm công ty/dự án "${leadForm.company_name.trim()}"`,
        newData: data,
      });
      await onRefresh();
      setAddTab(null);
      setLeadForm(emptyLeadForm);
      toast('Đã thêm công ty/dự án');
    } catch (e: any) { toast('Lỗi: ' + e.message); }
    setSaving(false);
  };

  const handleEditLead = async (leadId: string, patch: { industry: string; wage_min: string; wage_max: string; allowance_notes: string; workers_needed: string }) => {
    setSaving(true);
    try {
      const { error } = await supabase.from('market_leads').update({
        industry: patch.industry || null,
        workers_needed: parseInt(patch.workers_needed) || 0,
        wage_min: toNum(patch.wage_min),
        wage_max: toNum(patch.wage_max),
        allowance_notes: patch.allowance_notes.trim() || null,
      }).eq('id', leadId);
      if (error) throw error;
      await onRefresh();
      setEditLeadId(null);
      toast('Đã cập nhật');
    } catch (e: any) { toast('Lỗi: ' + e.message); }
    setSaving(false);
  };

  const handleAddSupplierToLead = async (leadId: string, name: string, qty: number) => {
    const lead = marketLeads.find(l => l.id === leadId);
    if (!lead) return;
    try {
      const newSuppliers = [...lead.suppliers, { name, qty, is_us: false }];
      const { error } = await supabase.from('market_leads').update({ suppliers: newSuppliers }).eq('id', leadId);
      if (error) throw error;
      await logActivity({
        user, action: 'update', table: 'market_leads', recordId: leadId,
        description: `Thêm NCC "${name}" cho công ty/dự án "${lead.company_name}"`,
        oldData: lead, newData: { ...lead, suppliers: newSuppliers },
      });
      await onRefresh();
      toast('Đã thêm NCC');
    } catch (e: any) { toast('Lỗi: ' + e.message); }
  };

  const handleStatusChange = async (leadId: string, status: string) => {
    try {
      const lead = marketLeads.find(l => l.id === leadId);
      const { error } = await supabase.from('market_leads').update({ status }).eq('id', leadId);
      if (error) throw error;
      if (lead) {
        await logActivity({
          user, action: 'update', table: 'market_leads', recordId: leadId,
          description: `Cập nhật trạng thái "${lead.company_name}": ${lead.status} → ${status}`,
          oldData: lead, newData: { ...lead, status },
        });
      }
      await onRefresh();
    } catch (e: any) { toast('Lỗi: ' + e.message); }
  };

  const handlePushCRM = async (companyName: string, region: string | null, workersNeeded: number) => {
    try {
      const { error } = await supabase.from('crm_pipeline').insert({
        company_name: companyName, region, worker_estimate: workersNeeded || null,
        stage: 'tiem-nang', notes: 'Phát hiện từ Module Thị trường',
      });
      if (error) throw error;
      toast('Đã đẩy "' + companyName + '" sang CRM!');
    } catch (e: any) { toast('Lỗi: ' + e.message); }
  };

  // ── Khách hàng đang hợp tác (clients.market_*) ──

  const handleSetupClient = async () => {
    if (!clientForm.client_id) { toast('Chọn khách hàng'); return; }
    setSaving(true);
    try {
      const patch = {
        industry: clientForm.industry || null,
        market_workers_needed: parseInt(clientForm.workers_needed) || 0,
        market_suppliers: [{ name: "Let's Go VN", qty: parseInt(clientForm.lgv_qty) || 0, is_us: true }],
        wage_min: toNum(clientForm.wage_min),
        wage_max: toNum(clientForm.wage_max),
        allowance_notes: clientForm.allowance_notes.trim() || null,
      };
      const { error } = await supabase.from('clients').update(patch).eq('id', clientForm.client_id);
      if (error) throw error;
      const client = clients.find(c => c.id === clientForm.client_id);
      await logActivity({
        user, action: 'update', table: 'clients', recordId: clientForm.client_id,
        description: `Thiết lập theo dõi thị trường cho khách hàng "${client?.name}"`,
        oldData: client, newData: { ...client, ...patch },
      });
      await onRefresh();
      setAddTab(null);
      setClientForm(emptyClientSetupForm);
      toast('Đã thiết lập theo dõi thị trường');
    } catch (e: any) { toast('Lỗi: ' + e.message); }
    setSaving(false);
  };

  const handleEditClient = async (clientId: string, patch: { industry: string; wage_min: string; wage_max: string; allowance_notes: string; workers_needed: string }) => {
    setSaving(true);
    try {
      const { error } = await supabase.from('clients').update({
        industry: patch.industry || null,
        market_workers_needed: parseInt(patch.workers_needed) || 0,
        wage_min: toNum(patch.wage_min),
        wage_max: toNum(patch.wage_max),
        allowance_notes: patch.allowance_notes.trim() || null,
      }).eq('id', clientId);
      if (error) throw error;
      await onRefresh();
      setEditClientId(null);
      toast('Đã cập nhật');
    } catch (e: any) { toast('Lỗi: ' + e.message); }
    setSaving(false);
  };

  const handleAddSupplierToClient = async (client: Client, name: string, qty: number) => {
    try {
      const newSuppliers = [...(client.market_suppliers ?? []), { name, qty, is_us: false }];
      const { error } = await supabase.from('clients').update({ market_suppliers: newSuppliers }).eq('id', client.id);
      if (error) throw error;
      await logActivity({
        user, action: 'update', table: 'clients', recordId: client.id,
        description: `Thêm NCC "${name}" cho khách hàng "${client.name}"`,
        oldData: client, newData: { ...client, market_suppliers: newSuppliers },
      });
      await onRefresh();
      toast('Đã thêm NCC');
    } catch (e: any) { toast('Lỗi: ' + e.message); }
  };

  const wageFmt = (min: number | null | undefined, max: number | null | undefined) =>
    min != null && max != null ? `${(min / 1_000_000).toFixed(1)}–${(max / 1_000_000).toFixed(1)}tr` : null;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-[12px] text-[#888]">Phát hiện khi khảo sát · Xem thị phần nhà cung ứng</div>
        <button onClick={() => { setAddTab('lead'); setLeadForm(emptyLeadForm); setClientForm(emptyClientSetupForm); }} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-[#1D4ED8] text-white hover:bg-[#1E40AF] transition">
          <Plus size={13} /> Thêm công ty
        </button>
      </div>

      <div className="bg-white border border-[#E8E7E2] rounded-[10px] px-3 py-2 flex items-center gap-2 flex-wrap">
        <span className="text-[12px] text-[#888] shrink-0">Tỉnh/TP:</span>
        <SearchSelect
          value={provinceFilter}
          onChange={v => { setProvinceFilter(v); setZoneFilter('all'); }}
          options={[{ value: 'all', label: `Tất cả (${provinces.length})` }, ...provinces.map(p => ({ value: p, label: p }))]}
          className="w-48"
        />
        <span className="text-[12px] text-[#888] shrink-0">KCN:</span>
        <SearchSelect
          value={zoneFilter}
          onChange={setZoneFilter}
          options={[{ value: 'all', label: `Tất cả (${zonesInProvince.length})` }, ...zonesInProvince.map(z => ({ value: z, label: z }))]}
          className="w-56"
        />
        <span className="text-[12px] text-[#888] shrink-0">Ngành nghề:</span>
        <SearchSelect
          value={industryFilter}
          onChange={setIndustryFilter}
          options={[{ value: 'all', label: `Tất cả (${industries.length})` }, ...industries.map(i => ({ value: i, label: i }))]}
          className="w-48"
        />
        {(provinceFilter !== 'all' || zoneFilter !== 'all' || industryFilter !== 'all') && (
          <button onClick={() => { setProvinceFilter('all'); setZoneFilter('all'); setIndustryFilter('all'); }} className="text-[11.5px] text-blue-600 hover:underline">Xoá lọc</button>
        )}
      </div>

      {/* ── Khách hàng đang hợp tác ── */}
      <div className="space-y-2">
        <div className="text-[12.5px] font-semibold text-[#111] flex items-center gap-1.5"><Users size={13} /> Khách hàng đang hợp tác</div>
        <div className="space-y-3">
          {trackedClients.map(c => (
            <div key={c.id} className="bg-white border border-[#E8E7E2] rounded-[10px] overflow-hidden">
              <div className="flex items-start justify-between gap-2 px-4 py-2.5 bg-emerald-50/40 border-b border-[#E8E7E2] flex-wrap">
                <div className="min-w-0">
                  <div className="text-[12.5px] font-medium">{c.name}</div>
                  <div className="text-[11px] text-[#888] mt-0.5">
                    {c.region || '—'} · {c.industry || '—'}{wageFmt(c.wage_min, c.wage_max) ? ` · Lương ${wageFmt(c.wage_min, c.wage_max)}` : ''}
                    {c.allowance_notes ? ` · ${c.allowance_notes}` : ''}
                  </div>
                </div>
                <button onClick={() => setEditClientId(editClientId === c.id ? null : c.id)} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] border border-[#E8E7E2] text-[#666] hover:bg-white shrink-0"><Pencil size={11} /> Sửa</button>
              </div>
              {editClientId === c.id && (
                <ClientEditForm client={c} saving={saving} industries={industries} onAddIndustry={handleAddIndustry}
                  onCancel={() => setEditClientId(null)} onSave={patch => handleEditClient(c.id, patch)} />
              )}
              <div className="p-4">
                <SupplierFillCard
                  workersNeeded={c.market_workers_needed ?? 0}
                  suppliers={c.market_suppliers ?? []}
                  saving={saving}
                  competitorNames={competitorNames}
                  onAddSupplier={(name, qty) => handleAddSupplierToClient(c, name, qty)}
                />
              </div>
            </div>
          ))}
          {trackedClients.length === 0 && (
            <div className="text-center py-6 text-[12px] text-[#aaa] bg-white border border-dashed border-[#E8E7E2] rounded-[10px]">
              Chưa có khách hàng nào được thiết lập theo dõi thị trường — bấm "Thêm công ty" → chọn "Khách hàng đang hợp tác"
            </div>
          )}
          {untrackedClients.length > 0 && (
            <div className="text-[11px] text-[#999]">
              {untrackedClients.length} khách hàng đang hợp tác khác chưa thiết lập ngành nghề/lấp đầy tại đây.
            </div>
          )}
        </div>
      </div>

      {/* ── Dự án / Công ty đang tìm hiểu ── */}
      <div className="space-y-2">
        <div className="text-[12.5px] font-semibold text-[#111]">Dự án / Công ty đang tìm hiểu</div>
        <div className="space-y-3">
          {list.map(l => (
            <div key={l.id} className="bg-white border border-[#E8E7E2] rounded-[10px] overflow-hidden">
              <div className="flex items-start justify-between gap-2 px-4 py-2.5 bg-[#F9F9F7] border-b border-[#E8E7E2] flex-wrap">
                <div className="min-w-0">
                  <div className="text-[12.5px] font-medium flex items-center gap-1.5 flex-wrap">
                    {l.company_name}
                    <select value={l.status} onChange={e => handleStatusChange(l.id, e.target.value)} className={`text-[11px] px-1.5 py-0.5 rounded-full font-medium border-0 outline-none ${statusCls(l.status)}`}>
                      {STATUS_OPTIONS.map(s => <option key={s}>{s}</option>)}
                    </select>
                  </div>
                  <div className="text-[11px] text-[#888] mt-0.5">
                    {l.region || '—'} · {l.industry || '—'} · {l.source || '—'} · {new Date(l.lead_date).toLocaleDateString('vi-VN')}
                    {wageFmt(l.wage_min, l.wage_max) ? ` · Lương ${wageFmt(l.wage_min, l.wage_max)}` : ''}
                    {l.allowance_notes ? ` · ${l.allowance_notes}` : ''}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button onClick={() => setEditLeadId(editLeadId === l.id ? null : l.id)} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] border border-[#E8E7E2] text-[#666] hover:bg-white"><Pencil size={11} /> Sửa</button>
                  <button onClick={() => handlePushCRM(l.company_name, l.region, l.workers_needed)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-[#1D4ED8] text-white hover:bg-[#1E40AF] transition">
                    Đẩy CRM <ArrowRight size={12} />
                  </button>
                </div>
              </div>
              {editLeadId === l.id && (
                <LeadEditForm lead={l} saving={saving} industries={industries} onAddIndustry={handleAddIndustry}
                  onCancel={() => setEditLeadId(null)} onSave={patch => handleEditLead(l.id, patch)} />
              )}
              <div className="p-4">
                <SupplierFillCard
                  workersNeeded={l.workers_needed}
                  suppliers={l.suppliers}
                  saving={saving}
                  competitorNames={competitorNames}
                  onAddSupplier={(name, qty) => handleAddSupplierToLead(l.id, name, qty)}
                />
              </div>
            </div>
          ))}
          {list.length === 0 && (
            <div className="text-center py-8 text-[12px] text-[#aaa]">Chưa có công ty/dự án nào được phát hiện</div>
          )}
        </div>
      </div>

      {addTab && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-[12px] w-full max-w-md p-6 shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-[15px] font-semibold text-[#111]">Thêm công ty</h2>
              <button onClick={() => setAddTab(null)} className="p-1 hover:bg-gray-100 rounded"><X size={15} /></button>
            </div>
            <div className="flex items-center gap-1 mb-4 bg-[#F3F2EE] rounded-lg p-1">
              <button onClick={() => setAddTab('client')} className={`flex-1 px-3 py-1.5 rounded-md text-[12px] font-medium transition ${addTab === 'client' ? 'bg-white shadow-sm text-[#111]' : 'text-[#888]'}`}>Khách hàng đang hợp tác</button>
              <button onClick={() => setAddTab('lead')} className={`flex-1 px-3 py-1.5 rounded-md text-[12px] font-medium transition ${addTab === 'lead' ? 'bg-white shadow-sm text-[#111]' : 'text-[#888]'}`}>Công ty mới đang tìm hiểu</button>
            </div>

            {addTab === 'client' ? (
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2 flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">Khách hàng *</label>
                  <SearchSelect
                    value={clientForm.client_id}
                    onChange={v => setClientForm(f => ({ ...f, client_id: v }))}
                    options={untrackedClients.map(c => ({ value: c.id, label: c.name }))}
                    placeholder={untrackedClients.length ? 'Chọn khách hàng…' : 'Tất cả khách hàng đã thiết lập'}
                  />
                </div>
                <div className="col-span-2 flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">Ngành nghề</label>
                  <SearchSelect value={clientForm.industry} onChange={v => setClientForm(f => ({ ...f, industry: v }))}
                    options={industries.map(i => ({ value: i, label: i }))} placeholder="Chọn ngành…" allowAdd onAdd={handleAddIndustry} /></div>
                <div className="flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">Nhu cầu LĐ</label>
                  <input type="number" value={clientForm.workers_needed} onChange={e => setClientForm(f => ({ ...f, workers_needed: e.target.value }))} className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" /></div>
                <div className="flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">Let's Go VN đang cung cấp</label>
                  <input type="number" value={clientForm.lgv_qty} onChange={e => setClientForm(f => ({ ...f, lgv_qty: e.target.value }))} className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" /></div>
                <div className="flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">Lương từ (tr)</label>
                  <input type="number" step="0.1" value={clientForm.wage_min} onChange={e => setClientForm(f => ({ ...f, wage_min: e.target.value }))} className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" /></div>
                <div className="flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">Lương đến (tr)</label>
                  <input type="number" step="0.1" value={clientForm.wage_max} onChange={e => setClientForm(f => ({ ...f, wage_max: e.target.value }))} className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" /></div>
                <div className="col-span-2 flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">Phụ cấp / ghi chú</label>
                  <input value={clientForm.allowance_notes} onChange={e => setClientForm(f => ({ ...f, allowance_notes: e.target.value }))} placeholder="Phụ cấp chuyên cần 300k, xăng xe 200k…" className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" /></div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2 flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">Tên công ty *</label>
                  <input value={leadForm.company_name} onChange={e => setLeadForm(f => ({ ...f, company_name: e.target.value }))} className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" /></div>
                <div className="flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">Khu vực</label>
                  <input value={leadForm.region} onChange={e => setLeadForm(f => ({ ...f, region: e.target.value }))} placeholder="KCN Biên Hòa 2" className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" /></div>
                <div className="flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">Ngành nghề</label>
                  <SearchSelect value={leadForm.industry} onChange={v => setLeadForm(f => ({ ...f, industry: v }))}
                    options={industries.map(i => ({ value: i, label: i }))} placeholder="Chọn ngành…" allowAdd onAdd={handleAddIndustry} /></div>
                <div className="flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">Nhu cầu LĐ</label>
                  <input type="number" value={leadForm.workers_needed} onChange={e => setLeadForm(f => ({ ...f, workers_needed: e.target.value }))} className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" /></div>
                <div className="flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">Nguồn thông tin</label>
                  <input value={leadForm.source} onChange={e => setLeadForm(f => ({ ...f, source: e.target.value }))} className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" /></div>
                <div className="flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">Let's Go VN đang cung cấp</label>
                  <input type="number" value={leadForm.lgv_qty} onChange={e => setLeadForm(f => ({ ...f, lgv_qty: e.target.value }))} className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" /></div>
                <div className="flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">Lương từ (tr)</label>
                  <input type="number" step="0.1" value={leadForm.wage_min} onChange={e => setLeadForm(f => ({ ...f, wage_min: e.target.value }))} className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" /></div>
                <div className="flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">Lương đến (tr)</label>
                  <input type="number" step="0.1" value={leadForm.wage_max} onChange={e => setLeadForm(f => ({ ...f, wage_max: e.target.value }))} className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" /></div>
                <div className="col-span-2 flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">Phụ cấp / ghi chú</label>
                  <input value={leadForm.allowance_notes} onChange={e => setLeadForm(f => ({ ...f, allowance_notes: e.target.value }))} placeholder="Phụ cấp chuyên cần, xăng xe…" className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" /></div>
                <div className="col-span-2 flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">Link Google Maps</label>
                  <input value={leadForm.map_link} onChange={e => setLeadForm(f => ({ ...f, map_link: e.target.value }))} placeholder="https://maps.google.com/…/@lat,lng… (tuỳ chọn)" className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" /></div>
              </div>
            )}

            <div className="flex gap-2 mt-4">
              <button onClick={() => setAddTab(null)} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-[12px] font-medium text-gray-600">Hủy</button>
              <button onClick={addTab === 'client' ? handleSetupClient : handleAddLead} disabled={saving} className="flex-1 px-4 py-2 bg-[#1D4ED8] text-white rounded-lg text-[12px] font-medium hover:bg-[#1E40AF] disabled:opacity-60">{saving ? 'Đang lưu...' : 'Thêm'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface EditPatch { industry: string; wage_min: string; wage_max: string; allowance_notes: string; workers_needed: string }

function EditFormFields({ initial, industries, onAddIndustry, onCancel, onSave, saving }: {
  initial: EditPatch;
  industries: string[];
  onAddIndustry: (name: string) => void;
  onCancel: () => void;
  onSave: (patch: EditPatch) => void;
  saving: boolean;
}) {
  const [patch, setPatch] = useState<EditPatch>(initial);
  return (
    <div className="px-4 py-3 bg-blue-50/30 border-b border-[#E8E7E2] grid grid-cols-2 gap-2.5">
      <div className="col-span-2 flex flex-col gap-1"><label className="text-[11px] text-[#666] font-medium">Ngành nghề</label>
        <SearchSelect value={patch.industry} onChange={v => setPatch(p => ({ ...p, industry: v }))}
          options={industries.map(i => ({ value: i, label: i }))} placeholder="Chọn ngành…" allowAdd onAdd={onAddIndustry} /></div>
      <div className="flex flex-col gap-1"><label className="text-[11px] text-[#666] font-medium">Nhu cầu LĐ</label>
        <input type="number" value={patch.workers_needed} onChange={e => setPatch(p => ({ ...p, workers_needed: e.target.value }))} className="text-[12.5px] px-2 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" /></div>
      <div />
      <div className="flex flex-col gap-1"><label className="text-[11px] text-[#666] font-medium">Lương từ (tr)</label>
        <input type="number" step="0.1" value={patch.wage_min} onChange={e => setPatch(p => ({ ...p, wage_min: e.target.value }))} className="text-[12.5px] px-2 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" /></div>
      <div className="flex flex-col gap-1"><label className="text-[11px] text-[#666] font-medium">Lương đến (tr)</label>
        <input type="number" step="0.1" value={patch.wage_max} onChange={e => setPatch(p => ({ ...p, wage_max: e.target.value }))} className="text-[12.5px] px-2 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" /></div>
      <div className="col-span-2 flex flex-col gap-1"><label className="text-[11px] text-[#666] font-medium">Phụ cấp / ghi chú</label>
        <input value={patch.allowance_notes} onChange={e => setPatch(p => ({ ...p, allowance_notes: e.target.value }))} className="text-[12.5px] px-2 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" /></div>
      <div className="col-span-2 flex gap-2 mt-1">
        <button onClick={onCancel} className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg text-[11.5px] font-medium text-gray-600">Hủy</button>
        <button onClick={() => onSave(patch)} disabled={saving} className="flex-1 px-3 py-1.5 bg-[#1D4ED8] text-white rounded-lg text-[11.5px] font-medium hover:bg-[#1E40AF] disabled:opacity-60">{saving ? 'Đang lưu...' : 'Lưu'}</button>
      </div>
    </div>
  );
}

function ClientEditForm({ client, ...rest }: { client: Client; industries: string[]; onAddIndustry: (n: string) => void; onCancel: () => void; onSave: (p: EditPatch) => void; saving: boolean }) {
  return <EditFormFields initial={{
    industry: client.industry ?? '',
    workers_needed: String(client.market_workers_needed ?? ''),
    wage_min: client.wage_min != null ? String(client.wage_min / 1_000_000) : '',
    wage_max: client.wage_max != null ? String(client.wage_max / 1_000_000) : '',
    allowance_notes: client.allowance_notes ?? '',
  }} {...rest} />;
}

function LeadEditForm({ lead, ...rest }: { lead: import('../../lib/types').MarketLead; industries: string[]; onAddIndustry: (n: string) => void; onCancel: () => void; onSave: (p: EditPatch) => void; saving: boolean }) {
  return <EditFormFields initial={{
    industry: lead.industry ?? '',
    workers_needed: String(lead.workers_needed ?? ''),
    wage_min: lead.wage_min != null ? String(lead.wage_min / 1_000_000) : '',
    wage_max: lead.wage_max != null ? String(lead.wage_max / 1_000_000) : '',
    allowance_notes: lead.allowance_notes ?? '',
  }} {...rest} />;
}
