import { useState, useEffect } from 'react';
import { Plus, TrendingUp, TrendingDown, Minus, X, Eye, List, LayoutGrid, Image as ImageIcon, MapPin } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { fmtTr, type MarketTabProps } from './shared';
import { logActivity } from '../../lib/audit';
import { useAuth } from '../../lib/auth';
import type { Competitor } from '../../lib/types';
import CompetitorDetail from './CompetitorDetail';

const emptyForm = {
  company_name: '', zone_name: '', wage_paid: '', fee_unskilled: '', fee_skilled: '', fee_tech: '',
  fee_per_shift: '', trend: 'stable', supplying_for: '', notes: '',
};

const trendIcon = (trend: string) => {
  if (trend === 'up') return <span className="text-emerald-600 inline-flex items-center gap-0.5 text-[11.5px] font-medium"><TrendingUp size={11} /> Tăng</span>;
  if (trend === 'down') return <span className="text-red-500 inline-flex items-center gap-0.5 text-[11.5px] font-medium"><TrendingDown size={11} /> Giảm</span>;
  return <span className="text-[#888] inline-flex items-center gap-0.5 text-[11.5px]"><Minus size={11} /> Ổn định</span>;
};

export default function CompetitorsTab({ marketZones, marketSurveys, competitors, clients, marketLeads, zoneFilter, onRefresh, toast }: MarketTabProps) {
  const { user } = useAuth();
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [selectedCompetitor, setSelectedCompetitor] = useState<Competitor | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'card'>(() => (localStorage.getItem('market_competitors_view_mode') as 'list' | 'card') || 'list');
  useEffect(() => { localStorage.setItem('market_competitors_view_mode', viewMode); }, [viewMode]);

  const list = zoneFilter === 'all' ? competitors : competitors.filter(c => c.zone_name === zoneFilter || c.zone_name?.includes(zoneFilter));

  const overallAvg = (() => {
    const vals = marketSurveys.filter(s => s.wage_unskilled_min != null && s.wage_unskilled_max != null)
      .map(s => ((s.wage_unskilled_min as number) + (s.wage_unskilled_max as number)) / 2);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  })();

  const avgForZone = (zone: string) => {
    const rows = marketSurveys.filter(s => zone.includes(s.zone_name) || s.zone_name.includes(zone));
    if (!rows.length) return overallAvg;
    const vals = rows.filter(s => s.wage_unskilled_min != null && s.wage_unskilled_max != null)
      .map(s => ((s.wage_unskilled_min as number) + (s.wage_unskilled_max as number)) / 2);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : overallAvg;
  };

  const handleAdd = async () => {
    if (!form.company_name.trim()) { toast('Nhập tên đối thủ'); return; }
    setSaving(true);
    try {
      const { data, error } = await supabase.from('competitors').insert({
        company_name: form.company_name.trim(),
        zone_name: form.zone_name || 'Toàn quốc',
        wage_paid: form.wage_paid ? parseFloat(form.wage_paid) * 1_000_000 : null,
        fee_unskilled: parseFloat(form.fee_unskilled) || null,
        fee_skilled: parseFloat(form.fee_skilled) || null,
        fee_tech: parseFloat(form.fee_tech) || null,
        fee_per_shift: parseFloat(form.fee_per_shift) || null,
        trend: form.trend,
        supplying_for: form.supplying_for.split(',').map(s => s.trim()).filter(Boolean),
        notes: form.notes || null,
      }).select().single();
      if (error) throw error;
      await logActivity({
        user, action: 'insert', table: 'competitors', recordId: data.id,
        description: `Thêm đối thủ "${form.company_name.trim()}" tại khu vực "${form.zone_name || 'Toàn quốc'}"`,
        newData: data,
      });
      await onRefresh();
      setShowAdd(false);
      setForm(emptyForm);
      toast('Đã thêm đối thủ: ' + form.company_name);
    } catch (e: any) { toast('Lỗi: ' + e.message); }
    setSaving(false);
  };

  if (selectedCompetitor) {
    return <CompetitorDetail competitor={selectedCompetitor} marketZones={marketZones} clients={clients} marketLeads={marketLeads} onBack={() => setSelectedCompetitor(null)} onRefresh={onRefresh} toast={toast} />;
  }

  return (
    <div className="space-y-3">
      <div className="text-[11.5px] text-[#888] px-3 py-2 bg-[#F9F9F7] rounded-lg flex items-center gap-1.5">
        <Eye size={12} /> Lương trả LĐ: so với mặt bằng thị trường khu vực · Phí/công = chi phí bên họ trả mỗi ca lao động
      </div>

      <div className="bg-white border border-[#E8E7E2] rounded-[10px] overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#E8E7E2] flex-wrap gap-2">
          <div className="text-[12.5px] font-semibold text-[#111]">Nhà cung ứng đối thủ</div>
          <div className="flex items-center gap-2">
            <div className="flex border border-gray-300 rounded-lg overflow-hidden">
              <button onClick={() => setViewMode('list')} title="Dạng danh sách" className={`p-1.5 ${viewMode === 'list' ? 'bg-gray-100 text-[#111]' : 'text-[#999] hover:bg-gray-50'}`}><List size={14} /></button>
              <button onClick={() => setViewMode('card')} title="Dạng card (có ảnh cover)" className={`p-1.5 ${viewMode === 'card' ? 'bg-gray-100 text-[#111]' : 'text-[#999] hover:bg-gray-50'}`}><LayoutGrid size={14} /></button>
            </div>
            <button onClick={() => setShowAdd(true)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-[#1D4ED8] text-white hover:bg-[#1E40AF] transition">
              <Plus size={13} /> Thêm đối thủ
            </button>
          </div>
        </div>
        {viewMode === 'list' && (
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead><tr className="border-b border-[#E8E7E2]">
              {['Nhà cung ứng', 'Khu vực', 'Tổng LĐ', 'Lương trả LĐ PT', 'Phí DV PT (₫)', 'Phí DV TN (₫)', 'Phí DV KTV (₫)', 'Phí/công (₫)', 'Xu hướng', 'Đang cung cấp cho'].map(h => (
                <th key={h} className="text-left px-3 py-2 text-[11.5px] text-[#888] font-medium bg-[#F9F9F7] whitespace-nowrap">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {list.map(c => {
                const avg = avgForZone(c.zone_name || '');
                const diff = avg && c.wage_paid ? Math.round(((c.wage_paid - avg) / avg) * 100) : null;
                const wn = diff == null ? null : diff < -3 ? { cls: 'bg-red-50 text-red-700', txt: `▼ Thấp hơn TT ${Math.abs(diff)}%` }
                  : diff > 3 ? { cls: 'bg-emerald-50 text-emerald-700', txt: `▲ Cao hơn TT ${diff}%` }
                    : { cls: 'bg-amber-50 text-amber-700', txt: '≈ Bằng TT' };
                return (
                  <tr key={c.id} className="border-b border-[#F0EEE9] last:border-0">
                    <td className="px-3 py-2">
                      <button onClick={() => setSelectedCompetitor(c)} className="font-semibold text-[#1D4ED8] hover:underline text-left">{c.company_name}</button>
                      {c.notes && <div className={`text-[10.5px] ${c.notes.includes('⚠') ? 'text-red-500' : 'text-[#aaa]'}`}>{c.notes}</div>}
                    </td>
                    <td className="px-3 py-2 text-[11.5px]">{c.zone_name}</td>
                    <td className="px-3 py-2">{(c.total_workers ?? 0).toLocaleString('vi-VN')}</td>
                    <td className="px-3 py-2">
                      <div className="font-medium">{fmtTr(c.wage_paid)}</div>
                      {wn && <div className={`text-[10.5px] px-1.5 py-0.5 rounded inline-block mt-0.5 font-medium ${wn.cls}`}>{wn.txt}</div>}
                    </td>
                    <td className="px-3 py-2">{c.fee_unskilled?.toLocaleString('vi-VN') || '—'}</td>
                    <td className="px-3 py-2 text-blue-700 font-medium">{c.fee_skilled?.toLocaleString('vi-VN') || '—'}</td>
                    <td className="px-3 py-2 text-emerald-700 font-medium">{c.fee_tech?.toLocaleString('vi-VN') || '—'}</td>
                    <td className="px-3 py-2"><span className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 text-[11px]">{c.fee_per_shift ? c.fee_per_shift.toLocaleString('vi-VN') + '₫' : '—'}</span></td>
                    <td className="px-3 py-2">{trendIcon(c.trend)}</td>
                    <td className="px-3 py-2 max-w-[180px]">
                      {c.supplying_for?.length ? c.supplying_for.map((s, i) => (
                        <span key={i} className="inline-block bg-[#F9F9F7] border border-[#E8E7E2] px-1.5 py-0.5 rounded text-[10.5px] mr-1 mb-1">{s}</span>
                      )) : <span className="text-[11px] text-[#aaa]">Chưa rõ</span>}
                    </td>
                  </tr>
                );
              })}
              {list.length === 0 && (
                <tr><td colSpan={10} className="text-center py-6 text-[#aaa]">Chưa có dữ liệu đối thủ</td></tr>
              )}
            </tbody>
          </table>
        </div>
        )}

        {viewMode === 'card' && (
        <div className="p-3 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {list.map(c => {
            const avg = avgForZone(c.zone_name || '');
            const diff = avg && c.wage_paid ? Math.round(((c.wage_paid - avg) / avg) * 100) : null;
            const wn = diff == null ? null : diff < -3 ? { cls: 'bg-red-50 text-red-700', txt: `▼ Thấp hơn TT ${Math.abs(diff)}%` }
              : diff > 3 ? { cls: 'bg-emerald-50 text-emerald-700', txt: `▲ Cao hơn TT ${diff}%` }
                : { cls: 'bg-amber-50 text-amber-700', txt: '≈ Bằng TT' };
            return (
              <div key={c.id} onClick={() => setSelectedCompetitor(c)} className="bg-white border border-[#E8E7E2] rounded-[12px] overflow-hidden cursor-pointer hover:border-blue-300 hover:shadow-sm transition">
                {c.image_url ? (
                  <div className="h-32 w-full overflow-hidden bg-gray-100">
                    <img src={c.image_url} alt={c.company_name} className="w-full h-full object-cover" />
                  </div>
                ) : (
                  <div className="h-32 w-full bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center">
                    <ImageIcon size={20} className="text-[#ccc]" />
                  </div>
                )}
                <div className="p-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-[12.5px] font-semibold text-[#1D4ED8] truncate">{c.company_name}</div>
                      <div className="text-[10.5px] text-[#888] flex items-center gap-1 mt-0.5"><MapPin size={10} /> {c.zone_name}</div>
                    </div>
                    {trendIcon(c.trend)}
                  </div>
                  <div className="grid grid-cols-3 gap-2 mt-2.5 pt-2.5 border-t border-gray-100 text-center">
                    <div><div className="text-[13px] font-bold text-[#111]">{(c.total_workers ?? 0).toLocaleString('vi-VN')}</div><div className="text-[9px] text-[#999] uppercase">LĐ</div></div>
                    <div><div className="text-[13px] font-bold text-[#111]">{fmtTr(c.wage_paid)}</div><div className="text-[9px] text-[#999] uppercase">Lương PT</div></div>
                    <div><div className="text-[13px] font-bold text-blue-700">{c.fee_per_shift ? c.fee_per_shift.toLocaleString('vi-VN') : '—'}</div><div className="text-[9px] text-[#999] uppercase">Phí/công</div></div>
                  </div>
                  {wn && <div className={`text-[10.5px] px-1.5 py-0.5 rounded inline-block mt-2 font-medium ${wn.cls}`}>{wn.txt}</div>}
                  {c.supplying_for?.length ? (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {c.supplying_for.slice(0, 3).map((s, i) => (
                        <span key={i} className="inline-block bg-[#F9F9F7] border border-[#E8E7E2] px-1.5 py-0.5 rounded text-[10.5px]">{s}</span>
                      ))}
                      {c.supplying_for.length > 3 && <span className="text-[10.5px] text-[#999]">+{c.supplying_for.length - 3}</span>}
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
          {list.length === 0 && (
            <div className="col-span-full text-center py-6 text-[#aaa] text-[12px]">Chưa có dữ liệu đối thủ</div>
          )}
        </div>
        )}
      </div>

      {showAdd && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-[12px] w-full max-w-md p-6 shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[15px] font-semibold text-[#111]">Thêm đối thủ</h2>
              <button onClick={() => setShowAdd(false)} className="p-1 hover:bg-gray-100 rounded"><X size={15} /></button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">Tên *</label>
                <input value={form.company_name} onChange={e => setForm(f => ({ ...f, company_name: e.target.value }))} className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" /></div>
              <div className="flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">Khu vực HĐ</label>
                <input value={form.zone_name} onChange={e => setForm(f => ({ ...f, zone_name: e.target.value }))} placeholder="Biên Hòa, VSIP" className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" /></div>
              <div className="flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">Lương trả LĐ PT (tr)</label>
                <input type="number" step="0.1" value={form.wage_paid} onChange={e => setForm(f => ({ ...f, wage_paid: e.target.value }))} className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" /></div>
              <div className="flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">Phí/công (₫)</label>
                <input type="number" value={form.fee_per_shift} onChange={e => setForm(f => ({ ...f, fee_per_shift: e.target.value }))} className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" /></div>
              <div className="flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">Phí DV PT (₫)</label>
                <input type="number" value={form.fee_unskilled} onChange={e => setForm(f => ({ ...f, fee_unskilled: e.target.value }))} className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" /></div>
              <div className="flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">Phí DV TN (₫)</label>
                <input type="number" value={form.fee_skilled} onChange={e => setForm(f => ({ ...f, fee_skilled: e.target.value }))} className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" /></div>
              <div className="flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">Phí DV KTV (₫)</label>
                <input type="number" value={form.fee_tech} onChange={e => setForm(f => ({ ...f, fee_tech: e.target.value }))} className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" /></div>
              <div className="flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">Xu hướng</label>
                <select value={form.trend} onChange={e => setForm(f => ({ ...f, trend: e.target.value }))} className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500">
                  <option value="stable">Ổn định</option><option value="up">Tăng</option><option value="down">Giảm</option>
                </select></div>
              <div className="col-span-2 flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">Đang cung cấp cho (ngăn cách dấu phẩy)</label>
                <input value={form.supplying_for} onChange={e => setForm(f => ({ ...f, supplying_for: e.target.value }))} placeholder="Cty A, Cty B" className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" /></div>
              <div className="col-span-2 flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">Ghi chú</label>
                <input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" /></div>
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={() => setShowAdd(false)} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-[12px] font-medium text-gray-600">Hủy</button>
              <button onClick={handleAdd} disabled={saving} className="flex-1 px-4 py-2 bg-[#1D4ED8] text-white rounded-lg text-[12px] font-medium hover:bg-[#1E40AF] disabled:opacity-60">{saving ? 'Đang lưu...' : 'Lưu'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
