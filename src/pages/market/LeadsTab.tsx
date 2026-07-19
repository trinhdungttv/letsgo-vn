import { useState } from 'react';
import { Plus, X, ArrowRight } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type { MarketTabProps } from './shared';
import { logActivity } from '../../lib/audit';
import { useAuth } from '../../lib/auth';
import { parseLatLngFromLink, isValidVnLatLng } from '../../lib/geo';

const STATUS_OPTIONS = ['Chưa LH', 'Đang TH', 'Đã LH'];
const statusCls = (s: string) => s === 'Đã LH' ? 'bg-emerald-50 text-emerald-700' : s === 'Đang TH' ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700';

const emptyLeadForm = { company_name: '', region: '', industry: '', workers_needed: '', source: '', lgv_qty: '0', map_link: '' };
const emptySupForm = { name: '', qty: '0' };

export default function LeadsTab({ marketLeads, zoneFilter, onRefresh, toast }: MarketTabProps) {
  const { user } = useAuth();
  const [showAddLead, setShowAddLead] = useState(false);
  const [leadForm, setLeadForm] = useState(emptyLeadForm);
  const [showAddSup, setShowAddSup] = useState<string | null>(null);
  const [supForm, setSupForm] = useState(emptySupForm);
  const [saving, setSaving] = useState(false);

  const list = zoneFilter === 'all' ? marketLeads : marketLeads.filter(l => l.region === zoneFilter || l.region?.includes(zoneFilter));

  const handleAddLead = async () => {
    if (!leadForm.company_name.trim()) { toast('Nhập tên công ty'); return; }
    setSaving(true);
    try {
      // Dán link Google Maps → tự sinh toạ độ cho tab Bản đồ
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
        ...(isValidVnLatLng(mapPos) ? { lat: mapPos.lat, lng: mapPos.lng, geocoded_at: new Date().toISOString() } : {}),
      }).select().single();
      if (error) throw error;
      await logActivity({
        user, action: 'insert', table: 'market_leads', recordId: data.id,
        description: `Thêm công ty/dự án "${leadForm.company_name.trim()}"`,
        newData: data,
      });
      await onRefresh();
      setShowAddLead(false);
      setLeadForm(emptyLeadForm);
      toast('Đã thêm công ty/dự án');
    } catch (e: any) { toast('Lỗi: ' + e.message); }
    setSaving(false);
  };

  const handleAddSupplier = async (leadId: string) => {
    if (!supForm.name.trim()) { toast('Nhập tên NCC'); return; }
    const lead = marketLeads.find(l => l.id === leadId);
    if (!lead) return;
    setSaving(true);
    try {
      const newSuppliers = [...lead.suppliers, { name: supForm.name.trim(), qty: parseInt(supForm.qty) || 0, is_us: false }];
      const { error } = await supabase.from('market_leads').update({ suppliers: newSuppliers }).eq('id', leadId);
      if (error) throw error;
      await logActivity({
        user, action: 'update', table: 'market_leads', recordId: leadId,
        description: `Thêm NCC "${supForm.name.trim()}" cho công ty/dự án "${lead.company_name}"`,
        oldData: lead, newData: { ...lead, suppliers: newSuppliers },
      });
      await onRefresh();
      setShowAddSup(null);
      setSupForm(emptySupForm);
      toast('Đã thêm NCC');
    } catch (e: any) { toast('Lỗi: ' + e.message); }
    setSaving(false);
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

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-[12px] text-[#888]">Phát hiện khi khảo sát · Xem thị phần nhà cung ứng</div>
        <button onClick={() => setShowAddLead(true)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-[#1D4ED8] text-white hover:bg-[#1E40AF] transition">
          <Plus size={13} /> Thêm công ty
        </button>
      </div>

      <div className="space-y-3">
        {list.map(l => {
          const total = l.suppliers.reduce((s, x) => s + x.qty, 0);
          const remaining = Math.max(l.workers_needed - total, 0);
          const pct = l.workers_needed > 0 ? Math.round((total / l.workers_needed) * 100) : 0;
          return (
            <div key={l.id} className="bg-white border border-[#E8E7E2] rounded-[10px] overflow-hidden">
              <div className="flex items-start justify-between gap-2 px-4 py-2.5 bg-[#F9F9F7] border-b border-[#E8E7E2] flex-wrap">
                <div className="min-w-0">
                  <div className="text-[12.5px] font-medium flex items-center gap-1.5 flex-wrap">
                    {l.company_name}
                    <select value={l.status} onChange={e => handleStatusChange(l.id, e.target.value)} className={`text-[11px] px-1.5 py-0.5 rounded-full font-medium border-0 outline-none ${statusCls(l.status)}`}>
                      {STATUS_OPTIONS.map(s => <option key={s}>{s}</option>)}
                    </select>
                  </div>
                  <div className="text-[11px] text-[#888] mt-0.5">{l.region || '—'} · {l.industry || '—'} · {l.source || '—'} · {new Date(l.lead_date).toLocaleDateString('vi-VN')}</div>
                </div>
                <button onClick={() => handlePushCRM(l.company_name, l.region, l.workers_needed)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-[#1D4ED8] text-white hover:bg-[#1E40AF] transition shrink-0">
                  Đẩy CRM <ArrowRight size={12} />
                </button>
              </div>
              <div className="p-4">
                <div className="flex gap-2 flex-wrap items-center mb-3">
                  <div className="bg-[#F9F9F7] rounded-lg px-3 py-1.5 text-center"><div className="text-[10px] text-[#aaa]">Nhu cầu</div><div className="text-[14px] font-medium">{l.workers_needed}</div></div>
                  <div className="bg-[#F9F9F7] rounded-lg px-3 py-1.5 text-center"><div className="text-[10px] text-[#aaa]">Đã fill</div><div className="text-[14px] font-medium text-emerald-600">{total}</div></div>
                  <div className={`rounded-lg px-3 py-1.5 text-center ${remaining > 0 ? 'bg-amber-50' : 'bg-emerald-50'}`}><div className={`text-[10px] ${remaining > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>Còn thiếu</div><div className={`text-[14px] font-medium ${remaining > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>{remaining}</div></div>
                  <div className="flex-1 min-w-[120px]">
                    <div className="text-[10px] text-[#aaa] mb-1">{pct}% fill</div>
                    <div className="h-1.5 bg-[#F0EEE9] rounded-full overflow-hidden"><div className="h-1.5 bg-emerald-500 rounded-full" style={{ width: `${Math.min(pct, 100)}%` }} /></div>
                  </div>
                </div>
                <div className="space-y-1.5">
                  {l.suppliers.map((s, i) => {
                    const p = l.workers_needed > 0 ? Math.round((s.qty / l.workers_needed) * 100) : 0;
                    return (
                      <div key={i} className="flex items-center gap-2">
                        <span className={`text-[12px] min-w-[110px] shrink-0 ${s.is_us ? 'text-blue-700 font-medium' : ''}`}>{s.is_us ? '● ' : ''}{s.name}</span>
                        <div className="flex-1 h-[11px] bg-[#F0EEE9] rounded overflow-hidden"><div className={`h-[11px] rounded ${s.is_us ? 'bg-blue-600' : 'bg-[#B8D4F0]'}`} style={{ width: `${Math.min(p, 100)}%` }} /></div>
                        <span className={`text-[12px] font-medium min-w-[52px] text-right ${s.is_us ? 'text-blue-700' : ''}`}>{s.qty} LĐ</span>
                        <span className="text-[11px] text-[#aaa] min-w-[28px] text-right">{p}%</span>
                      </div>
                    );
                  })}
                </div>
                {showAddSup === l.id ? (
                  <div className="flex gap-2 mt-2 items-center">
                    <input value={supForm.name} onChange={e => setSupForm(f => ({ ...f, name: e.target.value }))} placeholder="Tên NCC" className="text-[12px] px-2 py-1 rounded border border-gray-300 outline-none flex-1" />
                    <input type="number" value={supForm.qty} onChange={e => setSupForm(f => ({ ...f, qty: e.target.value }))} placeholder="Số LĐ" className="text-[12px] px-2 py-1 rounded border border-gray-300 outline-none w-20" />
                    <button onClick={() => handleAddSupplier(l.id)} disabled={saving} className="px-2.5 py-1 rounded bg-[#1D4ED8] text-white text-[12px]">Lưu</button>
                    <button onClick={() => setShowAddSup(null)} className="px-2 py-1 rounded border border-gray-300 text-[12px]"><X size={12} /></button>
                  </div>
                ) : (
                  <button onClick={() => { setShowAddSup(l.id); setSupForm(emptySupForm); }} className="mt-2 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11.5px] border border-dashed border-gray-300 text-[#aaa] hover:border-blue-300 hover:text-blue-500"><Plus size={11} /> Thêm NCC</button>
                )}
              </div>
            </div>
          );
        })}
        {list.length === 0 && (
          <div className="text-center py-8 text-[12px] text-[#aaa]">Chưa có công ty/dự án nào được phát hiện</div>
        )}
      </div>

      {showAddLead && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-[12px] w-full max-w-md p-6 shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[15px] font-semibold text-[#111]">Thêm công ty / dự án</h2>
              <button onClick={() => setShowAddLead(false)} className="p-1 hover:bg-gray-100 rounded"><X size={15} /></button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">Tên công ty *</label>
                <input value={leadForm.company_name} onChange={e => setLeadForm(f => ({ ...f, company_name: e.target.value }))} className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" /></div>
              <div className="flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">Khu vực</label>
                <input value={leadForm.region} onChange={e => setLeadForm(f => ({ ...f, region: e.target.value }))} placeholder="KCN Biên Hòa 2" className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" /></div>
              <div className="flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">Ngành nghề</label>
                <input value={leadForm.industry} onChange={e => setLeadForm(f => ({ ...f, industry: e.target.value }))} className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" /></div>
              <div className="flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">Nhu cầu LĐ</label>
                <input type="number" value={leadForm.workers_needed} onChange={e => setLeadForm(f => ({ ...f, workers_needed: e.target.value }))} className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" /></div>
              <div className="flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">Nguồn thông tin</label>
                <input value={leadForm.source} onChange={e => setLeadForm(f => ({ ...f, source: e.target.value }))} className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" /></div>
              <div className="flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">Let's Go VN đang cung cấp</label>
                <input type="number" value={leadForm.lgv_qty} onChange={e => setLeadForm(f => ({ ...f, lgv_qty: e.target.value }))} className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" /></div>
              <div className="col-span-2 flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">Link Google Maps</label>
                <input value={leadForm.map_link} onChange={e => setLeadForm(f => ({ ...f, map_link: e.target.value }))} placeholder="https://maps.google.com/…/@lat,lng… (tuỳ chọn)" className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" /></div>
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={() => setShowAddLead(false)} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-[12px] font-medium text-gray-600">Hủy</button>
              <button onClick={handleAddLead} disabled={saving} className="flex-1 px-4 py-2 bg-[#1D4ED8] text-white rounded-lg text-[12px] font-medium hover:bg-[#1E40AF] disabled:opacity-60">{saving ? 'Đang lưu...' : 'Thêm'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
