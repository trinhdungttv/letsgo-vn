import { Fragment, useState } from 'react';
import { Plus, Trash2, ExternalLink, Coins, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { availPillCls, LABOR_AVAIL_OPTIONS, type MarketTabProps } from './shared';

const emptyForm = {
  zone_name: '', industry: '', pt_min: '', pt_max: '', tv_min: '', tv_max: '', ct_min: '', ct_max: '',
  labor_availability: 'Trung bình', occupancy: '', survey_date: new Date().toISOString().split('T')[0],
};

export default function WageTab({ marketZones, marketSurveys, zoneFilter, setZoneFilter, goTab, onRefresh, toast }: MarketTabProps) {
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const zoneNames = [...new Set([...marketZones.map(z => z.name), ...marketSurveys.map(s => s.zone_name)])];
  const zonesToShow = zoneFilter === 'all' ? zoneNames : zoneNames.filter(z => z === zoneFilter);

  const openAdd = (zone?: string) => {
    setForm({ ...emptyForm, zone_name: zone || zoneNames[0] || '' });
    setShowAdd(true);
  };

  const handleAdd = async () => {
    if (!form.zone_name.trim() || !form.industry.trim()) { toast('Chọn khu vực và nhập ngành nghề'); return; }
    setSaving(true);
    try {
      const toNum = (v: string) => v ? parseFloat(v) * 1_000_000 : null;
      const { error } = await supabase.from('market_surveys').insert({
        zone_name: form.zone_name.trim(),
        industry: form.industry.trim(),
        survey_date: form.survey_date,
        wage_unskilled_min: toNum(form.pt_min), wage_unskilled_max: toNum(form.pt_max),
        wage_seasonal_min: toNum(form.tv_min), wage_seasonal_max: toNum(form.tv_max),
        wage_skilled_min: toNum(form.ct_min), wage_skilled_max: toNum(form.ct_max),
        labor_availability: form.labor_availability,
        occupancy: form.occupancy || null,
      });
      if (error) throw error;
      await onRefresh();
      setShowAdd(false);
      setForm(emptyForm);
      toast('Đã lưu khảo sát!');
    } catch (e: any) { toast('Lỗi: ' + e.message); }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    try {
      const { error } = await supabase.from('market_surveys').delete().eq('id', id);
      if (error) throw error;
      await onRefresh();
      toast('Đã xóa khảo sát');
    } catch (e: any) { toast('Lỗi: ' + e.message); }
  };

  const fmtTr = (v: number | null | undefined) => v != null ? (v / 1_000_000).toFixed(1) : '—';

  return (
    <div className="space-y-3">
      <div className="bg-white border border-[#E8E7E2] rounded-[10px] overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#E8E7E2] flex-wrap gap-2">
          <div className="text-[12.5px] font-semibold text-[#111]">Lương thị trường theo khu vực & ngành nghề</div>
          <button onClick={() => openAdd()} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-[#1D4ED8] text-white hover:bg-[#1E40AF] transition">
            <Plus size={13} /> Thêm khảo sát
          </button>
        </div>
        <div className="px-4 py-2 border-b border-[#E8E7E2] flex items-center gap-1.5 flex-wrap">
          <span className="text-[12px] text-[#888]">Khu vực:</span>
          <button onClick={() => setZoneFilter('all')} className={`px-2.5 py-1 rounded-full text-[11px] font-medium ${zoneFilter === 'all' ? 'bg-blue-600 text-white' : 'bg-[#F0EEE9] text-[#666]'}`}>Tất cả</button>
          {zoneNames.map(z => (
            <button key={z} onClick={() => setZoneFilter(z)} className={`px-2.5 py-1 rounded-full text-[11px] font-medium ${zoneFilter === z ? 'bg-blue-600 text-white' : 'bg-[#F0EEE9] text-[#666]'}`}>{z}</button>
          ))}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead><tr className="border-b border-[#E8E7E2]">
              {['Khu vực / Ngành nghề', 'Phổ thông (tr)', 'Thời vụ (tr)', 'Chính thức (tr)', 'Nguồn LĐ', 'Lấp đầy', 'Ngày', ''].map(h => (
                <th key={h} className="text-left px-3 py-2 text-[11.5px] text-[#888] font-medium bg-[#F9F9F7] whitespace-nowrap">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {zonesToShow.map(zone => {
                const rows = marketSurveys.filter(s => s.zone_name === zone);
                return (
                  <Fragment key={zone}>
                    <tr className="bg-[#F9F9F7]">
                      <td colSpan={8} className="px-3 py-1.5 font-medium text-[11.5px]">
                        <span className="inline-flex items-center gap-2">
                          {zone}
                          <button onClick={() => openAdd(zone)} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] border border-[#E8E7E2] text-[#666] hover:bg-white"><Plus size={9} /> Thêm ngành</button>
                          <button onClick={() => goTab('zones', zone)} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] border border-[#E8E7E2] text-[#666] hover:bg-white"><ExternalLink size={9} /> Hồ sơ KV</button>
                        </span>
                      </td>
                    </tr>
                    {rows.length ? rows.map(d => (
                      <tr key={d.id} className="border-b border-[#F0EEE9] last:border-0">
                        <td className="px-3 py-2 pl-6 text-[#888]">└ {d.industry || '—'}</td>
                        <td className="px-3 py-2">{fmtTr(d.wage_unskilled_min)}–{fmtTr(d.wage_unskilled_max)}tr</td>
                        <td className="px-3 py-2 text-blue-700 font-medium">{fmtTr(d.wage_seasonal_min)}–{fmtTr(d.wage_seasonal_max)}tr</td>
                        <td className="px-3 py-2 text-emerald-700 font-medium">{fmtTr(d.wage_skilled_min)}–{fmtTr(d.wage_skilled_max)}tr</td>
                        <td className="px-3 py-2"><span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${availPillCls(d.labor_availability)}`}>{d.labor_availability}</span></td>
                        <td className="px-3 py-2">{d.occupancy || '—'}</td>
                        <td className="px-3 py-2 text-[11px] text-[#aaa]">{new Date(d.survey_date).toLocaleDateString('vi-VN')}</td>
                        <td className="px-3 py-2"><button onClick={() => handleDelete(d.id)} className="text-[#aaa] hover:text-red-500"><Trash2 size={12} /></button></td>
                      </tr>
                    )) : (
                      <tr><td colSpan={8} className="px-3 py-2 pl-6 text-[#aaa] text-[11.5px]">Chưa có dữ liệu lương cho khu vực này</td></tr>
                    )}
                  </Fragment>
                );
              })}
              {zonesToShow.length === 0 && (
                <tr><td colSpan={8} className="text-center py-6 text-[#aaa]">Chưa có khảo sát lương nào</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showAdd && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-[12px] w-full max-w-md p-6 shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[15px] font-semibold text-[#111] flex items-center gap-1.5"><Coins size={15} /> Thêm khảo sát lương</h2>
              <button onClick={() => setShowAdd(false)} className="p-1 hover:bg-gray-100 rounded"><X size={15} /></button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">Khu vực *</label>
                <input list="wage-zones" value={form.zone_name} onChange={e => setForm(f => ({ ...f, zone_name: e.target.value }))} placeholder="KCN Biên Hòa 2" className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" />
                <datalist id="wage-zones">{zoneNames.map(z => <option key={z} value={z} />)}</datalist>
              </div>
              <div className="flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">Ngành nghề *</label>
                <input value={form.industry} onChange={e => setForm(f => ({ ...f, industry: e.target.value }))} placeholder="Giày da" className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" /></div>
              <div className="flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">PT từ (tr)</label>
                <input type="number" step="0.1" value={form.pt_min} onChange={e => setForm(f => ({ ...f, pt_min: e.target.value }))} className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" /></div>
              <div className="flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">PT đến (tr)</label>
                <input type="number" step="0.1" value={form.pt_max} onChange={e => setForm(f => ({ ...f, pt_max: e.target.value }))} className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" /></div>
              <div className="flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">Thời vụ từ (tr)</label>
                <input type="number" step="0.1" value={form.tv_min} onChange={e => setForm(f => ({ ...f, tv_min: e.target.value }))} className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" /></div>
              <div className="flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">Thời vụ đến (tr)</label>
                <input type="number" step="0.1" value={form.tv_max} onChange={e => setForm(f => ({ ...f, tv_max: e.target.value }))} className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" /></div>
              <div className="flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">Chính thức từ (tr)</label>
                <input type="number" step="0.1" value={form.ct_min} onChange={e => setForm(f => ({ ...f, ct_min: e.target.value }))} className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" /></div>
              <div className="flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">Chính thức đến (tr)</label>
                <input type="number" step="0.1" value={form.ct_max} onChange={e => setForm(f => ({ ...f, ct_max: e.target.value }))} className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" /></div>
              <div className="flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">Nguồn LĐ</label>
                <select value={form.labor_availability} onChange={e => setForm(f => ({ ...f, labor_availability: e.target.value }))} className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500">
                  {LABOR_AVAIL_OPTIONS.map(o => <option key={o}>{o}</option>)}
                </select></div>
              <div className="flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">Lấp đầy (%)</label>
                <input value={form.occupancy} onChange={e => setForm(f => ({ ...f, occupancy: e.target.value }))} placeholder="90%" className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" /></div>
              <div className="flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">Ngày khảo sát</label>
                <input type="date" value={form.survey_date} onChange={e => setForm(f => ({ ...f, survey_date: e.target.value }))} className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" /></div>
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
