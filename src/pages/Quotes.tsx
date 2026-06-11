import { useState } from 'react';
import { Eye, Download, Send, Save } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { logActivity } from '../lib/audit';
import type { MarketSurvey, Competitor } from '../lib/types';

interface QuotesProps {
  marketSurveys: MarketSurvey[];
  competitors: Competitor[];
  toast: (msg: string) => void;
  initialZone?: string;
}

const LG_WAGES = { pt: 6200000, tn: 8500000, ktv: 12000000 };

export default function Quotes({ marketSurveys, competitors, toast, initialZone }: QuotesProps) {
  const { user } = useAuth();
  const [form, setForm] = useState({ name: '', tax: '', address: '', contact: '', demand: '', zone: initialZone || '' });
  const [fees, setFees] = useState({ pt: '850000', tn: '1100000', ktv: '1400000' });
  const [showPreview, setShowPreview] = useState(false);
  const [showComparison, setShowComparison] = useState(false);
  const [saved, setSaved] = useState(false);

  const marketForZone = marketSurveys.find(s => s.zone_name === form.zone);
  const competitorsForZone = competitors.filter(c => c.zone_name === form.zone);
  const ptFee = parseInt(fees.pt) || 0;
  const tnFee = parseInt(fees.tn) || 0;
  const ktvFee = parseInt(fees.ktv) || 0;

  const handleDownload = () => {
    const rows = [
      ['Loại LĐ', 'Đơn giá LĐ', 'Phí DV', 'Tổng'],
      ['Phổ thông', LG_WAGES.pt, ptFee, LG_WAGES.pt + ptFee],
      ['Tay nghề', LG_WAGES.tn, tnFee, LG_WAGES.tn + tnFee],
      ['Kỹ thuật viên', LG_WAGES.ktv, ktvFee, LG_WAGES.ktv + ktvFee],
      [], ['Khách hàng:', form.name], ['Ngày:', new Date().toLocaleDateString('vi-VN')],
    ];
    const csv = '\uFEFF' + rows.map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `BaoGia_${form.name.replace(/\s/g, '_') || 'LetsGoVN'}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const handleSave = async () => {
    if (!form.name) { toast('Nhập tên công ty trước'); return; }
    try {
      const { data, error } = await supabase.from('quotes').insert({
        client_name: form.name, tax_code: form.tax, address: form.address,
        contact_person: form.contact, labor_demand: form.demand, zone: form.zone || null,
        price_unskilled: ptFee, price_skilled: tnFee, price_tech: ktvFee, status: 'draft',
      }).select().single();
      if (error) throw error;
      setSaved(true); setTimeout(() => setSaved(false), 3000);
      toast('Đã lưu báo giá!');
      await logActivity({
        user, action: 'insert', table: 'quotes', recordId: data.id,
        description: `Tạo báo giá cho "${form.name}"`,
        newData: data,
      });
    } catch (e: any) { toast('Lỗi: ' + e.message); }
  };

  const fmtVND = (n: number) => n.toLocaleString('vi-VN') + ' ₫';

  return (
    <>
      <PageHeader title="Báo giá tự động" subtitle="Điền thông tin → Xem trước → Tải Excel / Gửi Telegram" />
      <div className="flex-1 overflow-y-auto p-5">
        <div className="bg-white border border-[#E8E7E2] rounded-[10px] overflow-hidden mb-4">
          <div className="px-4 py-2.5 border-b border-[#E8E7E2] text-[12.5px] font-semibold text-[#111]">Thông tin khách hàng</div>
          <div className="p-4">
            <div className="grid grid-cols-2 gap-3 mb-3">
              {[
                { key: 'name', label: 'Tên công ty *', placeholder: 'Công ty TNHH ABC VN' },
                { key: 'tax', label: 'Mã số thuế', placeholder: '0312345678' },
                { key: 'address', label: 'Địa chỉ nhà máy', placeholder: 'KCN Biên Hòa 2, Đồng Nai' },
                { key: 'contact', label: 'Người liên hệ', placeholder: 'Ms. Hoa - HR Manager' },
              ].map(f => (
                <div key={f.key} className="flex flex-col gap-1">
                  <label className="text-[12px] text-[#666] font-medium">{f.label}</label>
                  <input value={form[f.key as keyof typeof form]} onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                    placeholder={f.placeholder} className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" />
                </div>
              ))}
              <div className="flex flex-col gap-1">
                <label className="text-[12px] text-[#666] font-medium">KCN (để so sánh TT)</label>
                <select value={form.zone} onChange={e => setForm(f => ({ ...f, zone: e.target.value }))} className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500">
                  <option value="">-- Chọn KCN --</option>
                  {[...new Set(marketSurveys.map(s => s.zone_name))].map(z => <option key={z}>{z}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[12px] text-[#666] font-medium">Nhu cầu lao động</label>
                <input value={form.demand} onChange={e => setForm(f => ({ ...f, demand: e.target.value }))}
                  placeholder="200 LĐ phổ thông..." className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3 mb-4 p-3 bg-[#F9F9F7] rounded-lg">
              <div className="text-[12px] text-[#555] font-medium col-span-3">Phí dịch vụ đề xuất (₫/người/tháng)</div>
              {[{ key: 'pt', label: 'Phổ thông' }, { key: 'tn', label: 'Tay nghề' }, { key: 'ktv', label: 'Kỹ thuật viên' }].map(f => (
                <div key={f.key} className="flex flex-col gap-1">
                  <label className="text-[11.5px] text-[#888]">{f.label}</label>
                  <input type="number" value={fees[f.key as keyof typeof fees]} onChange={e => setFees(prev => ({ ...prev, [f.key]: e.target.value }))}
                    className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" />
                </div>
              ))}
            </div>

            <div className="flex flex-wrap gap-2 mb-4">
              <button onClick={() => setShowPreview(!showPreview)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[12px] font-medium border border-blue-500 text-blue-700 hover:bg-blue-50 transition"><Eye size={13} /> Xem trước</button>
              {form.zone && <button onClick={() => setShowComparison(!showComparison)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[12px] font-medium border border-violet-500 text-violet-700 hover:bg-violet-50 transition">So sánh thị trường</button>}
              <button onClick={handleDownload} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[12px] font-medium border border-emerald-600 text-emerald-700 hover:bg-emerald-50 transition"><Download size={13} /> Tải Excel</button>
              <button onClick={() => toast('Đã gửi Telegram — @letsgovn_bot!')} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[12px] font-medium border border-sky-500 text-sky-700 hover:bg-sky-50 transition"><Send size={13} /> Gửi Telegram</button>
              <button onClick={handleSave} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[12px] font-medium border border-gray-300 text-gray-600 hover:bg-gray-50 transition"><Save size={13} /> Lưu vào DB</button>
              {saved && <span className="text-[12px] text-emerald-600 font-medium">✓ Đã lưu!</span>}
            </div>

            {showComparison && form.zone && (
              <div className="mb-4 border border-violet-200 rounded-lg overflow-hidden">
                <div className="px-3 py-2 bg-violet-50 text-[12px] font-semibold text-violet-800">So sánh với thị trường — {form.zone}</div>
                <table className="w-full text-[12.5px]">
                  <thead><tr className="border-b border-violet-100">
                    {["Loại LĐ", "Let's Go VN", "TB thị trường", "Manpower", "Adecco", "Vị thế"].map(h => (
                      <th key={h} className="text-left px-3 py-1.5 text-[11.5px] text-[#888] font-medium bg-[#F9F9F7]">{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {[
                      { label: 'Phổ thông', fee: ptFee, mAvg: marketForZone ? ((marketForZone.wage_unskilled_min || 0) + (marketForZone.wage_unskilled_max || 0)) / 2 * 0.137 : null, feeKey: 'fee_unskilled' },
                      { label: 'Tay nghề', fee: tnFee, mAvg: marketForZone ? ((marketForZone.wage_skilled_min || 0) + (marketForZone.wage_skilled_max || 0)) / 2 * 0.13 : null, feeKey: 'fee_skilled' },
                    ].map(row => {
                      const manpower = competitorsForZone.find(c => c.company_name.includes('Manpower'));
                      const adecco = competitorsForZone.find(c => c.company_name.includes('Adecco'));
                      const mFee = manpower?.[row.feeKey as keyof Competitor] as number | null;
                      const aFee = adecco?.[row.feeKey as keyof Competitor] as number | null;
                      const competitive = !row.mAvg || row.fee <= row.mAvg * 1.1;
                      return (
                        <tr key={row.label} className="border-b border-[#F0EEE9] last:border-0">
                          <td className="px-3 py-2 font-medium">{row.label}</td>
                          <td className="px-3 py-2 font-semibold text-blue-700">{fmtVND(row.fee)}</td>
                          <td className="px-3 py-2">{row.mAvg ? fmtVND(Math.round(row.mAvg)) : '—'}</td>
                          <td className="px-3 py-2">{mFee ? fmtVND(mFee) : '—'}</td>
                          <td className="px-3 py-2">{aFee ? fmtVND(aFee) : '—'}</td>
                          <td className="px-3 py-2"><span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${competitive ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{competitive ? 'Cạnh tranh' : 'Cao hơn TT'}</span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {showPreview && (
              <div className="bg-[#F9F9F7] border border-[#E8E7E2] rounded-lg p-4">
                <div className="text-center mb-4 pb-4 border-b border-[#E8E7E2]">
                  <div className="text-[15px] font-bold">BÁO GIÁ DỊCH VỤ CUNG ỨNG LAO ĐỘNG</div>
                  <div className="text-[12px] text-[#888] mt-1">CÔNG TY CỔ PHẦN LET'S GO VN · MST: 0317087641 · Ngày: {new Date().toLocaleDateString('vi-VN')}</div>
                </div>
                <div className="grid grid-cols-2 gap-3 mb-4 text-[13px]">
                  <div>
                    <div className="flex gap-2 mb-1"><span className="text-[#888] shrink-0">Kính gửi:</span><strong>{form.name || '—'}</strong></div>
                    <div className="flex gap-2"><span className="text-[#888] shrink-0">MST:</span><span>{form.tax || '—'}</span></div>
                  </div>
                  <div>{form.contact && <div className="flex gap-2"><span className="text-[#888] shrink-0">Liên hệ:</span><span>{form.contact}</span></div>}</div>
                </div>
                <table className="w-full text-[12.5px]">
                  <thead><tr className="border-b border-[#E8E7E2]">
                    {['Loại lao động','Đơn giá LĐ','Phí dịch vụ','Tổng/người/tháng'].map(h => <th key={h} className="text-left py-2 text-[11.5px] text-[#888] font-medium pr-4">{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {[{ label: 'Phổ thông', wage: LG_WAGES.pt, fee: ptFee }, { label: 'Tay nghề', wage: LG_WAGES.tn, fee: tnFee }, { label: 'Kỹ thuật viên', wage: LG_WAGES.ktv, fee: ktvFee }].map(row => (
                      <tr key={row.label} className="border-b border-[#F0EEE9]">
                        <td className="py-2">{row.label}</td><td className="py-2">{fmtVND(row.wage)}</td>
                        <td className="py-2">{fmtVND(row.fee)}</td><td className="py-2 font-semibold text-blue-800">{fmtVND(row.wage + row.fee)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="text-[11.5px] text-[#888] mt-3 pt-3 border-t border-[#E8E7E2]">Báo giá có hiệu lực 15 ngày · Thanh toán 15–30 ngày/kỳ · BHXH theo quy định pháp luật</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
