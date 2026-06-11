import { useState } from 'react';
import { Plus, TrendingUp, TrendingDown, Minus, Search, X } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import type { MarketSurvey, Competitor } from '../lib/types';
import { supabase } from '../lib/supabase';

interface MarketProps {
  marketSurveys: MarketSurvey[];
  competitors: Competitor[];
  onRefresh: () => Promise<void>;
  toast: (msg: string) => void;
}

const AVAILABILITY_OPTIONS = ['Dồi dào', 'Trung bình', 'Khan hiếm'];
type SortKey = 'zone' | 'pt_high' | 'pt_low' | 'tn_high' | 'tn_low' | 'avail';

const trendIcon = (trend: string) => {
  if (trend === 'up') return <span className="text-emerald-600 flex items-center gap-0.5 text-[11.5px]"><TrendingUp size={11} /> Tăng</span>;
  if (trend === 'down') return <span className="text-red-500 flex items-center gap-0.5 text-[11.5px]"><TrendingDown size={11} /> Giảm</span>;
  return <span className="text-[#888] flex items-center gap-0.5 text-[11.5px]"><Minus size={11} /> Ổn định</span>;
};

const availColor = (v: string) => v === 'Dồi dào' ? 'text-emerald-600' : v === 'Khan hiếm' ? 'text-red-600' : 'text-amber-600';

export default function Market({ marketSurveys, competitors, onRefresh, toast }: MarketProps) {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('zone');
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ zone_name: '', survey_date: new Date().toISOString().split('T')[0], wage_unskilled_min: '', wage_unskilled_max: '', wage_skilled_min: '', wage_skilled_max: '', wage_tech: '', labor_availability: 'Trung bình', surveyed_by: '', notes: '' });
  const [saving, setSaving] = useState(false);

  const filtered = marketSurveys
    .filter(s => !search || s.zone_name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      if (sort === 'pt_high') return (b.wage_unskilled_max || 0) - (a.wage_unskilled_max || 0);
      if (sort === 'pt_low') return (a.wage_unskilled_min || 0) - (b.wage_unskilled_min || 0);
      if (sort === 'tn_high') return (b.wage_skilled_max || 0) - (a.wage_skilled_max || 0);
      if (sort === 'tn_low') return (a.wage_skilled_min || 0) - (b.wage_skilled_min || 0);
      return a.zone_name.localeCompare(b.zone_name);
    });

  const handleSave = async () => {
    if (!form.zone_name) { toast('Nhập tên khu vực'); return; }
    setSaving(true);
    try {
      const { error } = await supabase.from('market_surveys').insert({
        zone_name: form.zone_name, survey_date: form.survey_date,
        wage_unskilled_min: parseFloat(form.wage_unskilled_min) || null,
        wage_unskilled_max: parseFloat(form.wage_unskilled_max) || null,
        wage_skilled_min: parseFloat(form.wage_skilled_min) || null,
        wage_skilled_max: parseFloat(form.wage_skilled_max) || null,
        wage_tech: parseFloat(form.wage_tech) || null,
        labor_availability: form.labor_availability,
        surveyed_by: form.surveyed_by || null,
        notes: form.notes || null,
      });
      if (error) throw error;
      await onRefresh();
      setShowModal(false);
      setForm({ zone_name: '', survey_date: new Date().toISOString().split('T')[0], wage_unskilled_min: '', wage_unskilled_max: '', wage_skilled_min: '', wage_skilled_max: '', wage_tech: '', labor_availability: 'Trung bình', surveyed_by: '', notes: '' });
      toast('Đã lưu khảo sát!');
    } catch (e: any) { toast('Lỗi: ' + e.message); }
    setSaving(false);
  };

  const fmt = (v: number | null | undefined) => v ? (v / 1_000_000).toFixed(1) + 'tr' : '—';

  return (
    <>
      <PageHeader title="Khảo sát thị trường" subtitle="Lương vùng · Đối thủ · KCN" actions={
        <button onClick={() => setShowModal(true)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-[#1D4ED8] text-white hover:bg-[#1E40AF] transition">
          <Plus size={13} /> Thêm khảo sát
        </button>
      } />

      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {/* Filter bar */}
        <div className="flex items-center gap-2.5">
          <div className="relative flex-1 max-w-[240px]">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#aaa]" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Tìm kiếm KCN..." className="w-full text-[12.5px] pl-8 pr-3 py-1.5 border border-gray-300 rounded-lg outline-none focus:border-blue-500" />
          </div>
          <select value={sort} onChange={e => setSort(e.target.value as SortKey)} className="text-[12.5px] px-2.5 py-1.5 border border-gray-300 rounded-lg outline-none">
            <option value="zone">Sắp theo KCN</option>
            <option value="pt_high">PT cao → thấp</option>
            <option value="pt_low">PT thấp → cao</option>
            <option value="tn_high">TN cao → thấp</option>
            <option value="tn_low">TN thấp → cao</option>
          </select>
        </div>

        {/* Survey table */}
        <div className="bg-white border border-[#E8E7E2] rounded-[10px] overflow-hidden">
          <div className="px-4 py-2.5 border-b border-[#E8E7E2] text-[12.5px] font-semibold text-[#111]">Bảng lương thị trường</div>
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead><tr className="border-b border-[#E8E7E2]">
                {['KCN','Phổ thông (triệu)','Tay nghề (triệu)','KTV (triệu)','Lao động','Ngày KS','Người KS'].map(h => (
                  <th key={h} className="text-left px-3 py-2 text-[11.5px] text-[#888] font-medium bg-[#F9F9F7] whitespace-nowrap">{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {filtered.map(s => (
                  <tr key={s.id} className="border-b border-[#F0EEE9] last:border-0">
                    <td className="px-3 py-2 font-semibold">{s.zone_name}</td>
                    <td className="px-3 py-2">{fmt(s.wage_unskilled_min)} – {fmt(s.wage_unskilled_max)}</td>
                    <td className="px-3 py-2">{fmt(s.wage_skilled_min)} – {fmt(s.wage_skilled_max)}</td>
                    <td className="px-3 py-2 font-medium">{fmt(s.wage_tech)}</td>
                    <td className="px-3 py-2"><span className={`font-medium ${availColor(s.labor_availability)}`}>{s.labor_availability}</span></td>
                    <td className="px-3 py-2 text-[#888]">{s.survey_date}</td>
                    <td className="px-3 py-2 text-[#888]">{s.surveyed_by || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Competitors */}
        <div className="bg-white border border-[#E8E7E2] rounded-[10px] overflow-hidden">
          <div className="px-4 py-2.5 border-b border-[#E8E7E2] text-[12.5px] font-semibold text-[#111]">Đối thủ cạnh tranh</div>
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead><tr className="border-b border-[#E8E7E2]">
                {['KCN','Đối thủ','PT (₫/tháng)','Tay nghề','KTV','Xu hướng','Ghi chú'].map(h => (
                  <th key={h} className="text-left px-3 py-2 text-[11.5px] text-[#888] font-medium bg-[#F9F9F7] whitespace-nowrap">{h}</th>
                ))}
              </tr></thead>
              <tbody>
                <tr className="bg-blue-50 border-b border-[#F0EEE9]">
                  <td className="px-3 py-2 text-[#888] text-[11.5px]">Tất cả</td>
                  <td className="px-3 py-2 font-semibold text-blue-800">Let's Go VN</td>
                  <td className="px-3 py-2">850,000</td><td className="px-3 py-2">1,100,000</td><td className="px-3 py-2">1,400,000</td>
                  <td className="px-3 py-2"><span className="text-emerald-600 flex items-center gap-0.5 text-[11.5px]"><TrendingUp size={11} /> +2%</span></td>
                  <td className="px-3 py-2 text-[12px] text-[#888]">Theo thị trường</td>
                </tr>
                {competitors.map(c => (
                  <tr key={c.id} className="border-b border-[#F0EEE9] last:border-0">
                    <td className="px-3 py-2 text-[#888] text-[11.5px]">{c.zone_name}</td>
                    <td className="px-3 py-2 font-medium">{c.company_name}</td>
                    <td className="px-3 py-2">{c.fee_unskilled?.toLocaleString('vi-VN') || '—'}</td>
                    <td className="px-3 py-2">{c.fee_skilled?.toLocaleString('vi-VN') || '—'}</td>
                    <td className="px-3 py-2">{c.fee_tech?.toLocaleString('vi-VN') || '—'}</td>
                    <td className="px-3 py-2">{trendIcon(c.trend)}</td>
                    <td className="px-3 py-2 text-[12px] text-[#888]">{c.notes || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Add survey modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-[12px] w-full max-w-md p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[15px] font-semibold text-[#111]">Thêm khảo sát thị trường</h2>
              <button onClick={() => setShowModal(false)} className="p-1 hover:bg-gray-100 rounded"><X size={15} /></button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">Tên KCN *</label>
                <input value={form.zone_name} onChange={e => setForm(f => ({ ...f, zone_name: e.target.value }))} className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" placeholder="KCN Biên Hòa 2" /></div>
              <div className="flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">Ngày khảo sát</label>
                <input type="date" value={form.survey_date} onChange={e => setForm(f => ({ ...f, survey_date: e.target.value }))} className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" /></div>
              <div className="flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">Người khảo sát</label>
                <input value={form.surveyed_by} onChange={e => setForm(f => ({ ...f, surveyed_by: e.target.value }))} className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" /></div>
              <div className="flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">Lương PT min (VND)</label>
                <input type="number" value={form.wage_unskilled_min} onChange={e => setForm(f => ({ ...f, wage_unskilled_min: e.target.value }))} className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" placeholder="5800000" /></div>
              <div className="flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">Lương PT max (VND)</label>
                <input type="number" value={form.wage_unskilled_max} onChange={e => setForm(f => ({ ...f, wage_unskilled_max: e.target.value }))} className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" placeholder="6500000" /></div>
              <div className="flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">Lương TN min (VND)</label>
                <input type="number" value={form.wage_skilled_min} onChange={e => setForm(f => ({ ...f, wage_skilled_min: e.target.value }))} className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" placeholder="7500000" /></div>
              <div className="flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">Lương TN max (VND)</label>
                <input type="number" value={form.wage_skilled_max} onChange={e => setForm(f => ({ ...f, wage_skilled_max: e.target.value }))} className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" placeholder="8500000" /></div>
              <div className="flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">Lương KTV (VND)</label>
                <input type="number" value={form.wage_tech} onChange={e => setForm(f => ({ ...f, wage_tech: e.target.value }))} className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" placeholder="11000000" /></div>
              <div className="flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">Nguồn lao động</label>
                <select value={form.labor_availability} onChange={e => setForm(f => ({ ...f, labor_availability: e.target.value }))} className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500">
                  {AVAILABILITY_OPTIONS.map(o => <option key={o}>{o}</option>)}
                </select></div>
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={() => setShowModal(false)} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-[12px] font-medium text-gray-600">Hủy</button>
              <button onClick={handleSave} disabled={saving} className="flex-1 px-4 py-2 bg-[#1D4ED8] text-white rounded-lg text-[12px] font-medium hover:bg-[#1E40AF] disabled:opacity-60">{saving ? 'Đang lưu...' : 'Lưu'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
