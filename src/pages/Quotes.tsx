import { useEffect, useMemo, useState } from 'react';
import { Eye, Download, Save, History, FileText } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { logActivity } from '../lib/audit';
import type { MarketZone, Competitor, Client, MarketLead, IndustryMetric } from '../lib/types';
import { fetchRegionWages, regionZoneLabel, regionZoneColorCls, type RegionZone } from './market/regionWage';
import { fetchIndustries } from './market/industries';
import QuoteHistory from './market/QuoteHistory';

const sumWageDetail = (d: Record<string, number> | null | undefined) =>
  Object.values(d ?? {}).reduce((a, b) => a + (b || 0), 0);

interface QuotesProps {
  marketZones: MarketZone[];
  competitors: Competitor[];
  clients: Client[];
  marketLeads: MarketLead[];
  toast: (msg: string) => void;
  initialZone?: string;
}

// So khớp tên KCN không phân biệt hoa/thường & chấp nhận lệch tiền tố ("BIÊN HOÀ 2" vs
// "KCN Biên Hoà 2") — client.industrial_zones/market_leads.region/competitor.zone_name
// thường gõ tay khác tên chính thức trong market_zones.name (giống WageTab/LeadsTab).
const zoneMatches = (a: string | null | undefined, b: string | null | undefined) => {
  if (!a || !b) return false;
  const na = a.trim().toLowerCase();
  const nb = b.trim().toLowerCase();
  return na === nb || na.includes(nb) || nb.includes(na);
};

const FEE_TIERS = [
  { key: 'pt', label: 'Phổ thông', feeKey: 'fee_unskilled' as const },
  { key: 'tn', label: 'Tay nghề', feeKey: 'fee_skilled' as const },
  { key: 'ktv', label: 'Kỹ thuật viên', feeKey: 'fee_tech' as const },
];

export default function Quotes({ marketZones, competitors, clients, marketLeads, toast, initialZone }: QuotesProps) {
  const { user } = useAuth();
  const [form, setForm] = useState({ name: '', tax: '', address: '', contact: '', demand: '', zone: initialZone || '', industry: '' });
  const [wages, setWages] = useState({ pt: '6200000', tn: '8500000', ktv: '12000000' });
  const [fees, setFees] = useState({ pt: '850000', tn: '1100000', ktv: '1400000' });
  const [showPreview, setShowPreview] = useState(false);
  const [showComparison, setShowComparison] = useState(false);
  const [saved, setSaved] = useState(false);
  const [view, setView] = useState<'form' | 'history'>('form');
  const [regionWages, setRegionWages] = useState<Record<RegionZone, number> | null>(null);
  const [industries, setIndustries] = useState<string[]>([]);
  const [industryIds, setIndustryIds] = useState<Record<string, string>>({});
  const [industryMetric, setIndustryMetric] = useState<IndustryMetric | null>(null);

  useEffect(() => {
    fetchRegionWages().then(setRegionWages);
    fetchIndustries().then(setIndustries);
    supabase.from('industries').select('id, name').then(({ data }) => {
      if (data) setIndustryIds(Object.fromEntries(data.map((d: { id: string; name: string }) => [d.name, d.id])));
    });
  }, []);

  // Benchmark phí dịch vụ + lương TB theo NGÀNH (mọi KCN), lấy kỳ gần nhất đã nhập ở tab
  // Ngành Nghề — nguồn gợi ý giá độc lập với KCN đang chọn.
  useEffect(() => {
    const industryId = industryIds[form.industry];
    if (!industryId) { setIndustryMetric(null); return; }
    let cancelled = false;
    supabase.from('industry_metrics').select('*').eq('industry_id', industryId).order('period', { ascending: false }).limit(1)
      .then(({ data }) => { if (!cancelled) setIndustryMetric((data?.[0] as IndustryMetric) ?? null); });
    return () => { cancelled = true; };
  }, [form.industry, industryIds]);

  const ptWage = parseInt(wages.pt) || 0;
  const tnWage = parseInt(wages.tn) || 0;
  const ktvWage = parseInt(wages.ktv) || 0;
  const ptFee = parseInt(fees.pt) || 0;
  const tnFee = parseInt(fees.tn) || 0;
  const ktvFee = parseInt(fees.ktv) || 0;

  const selectedZone = marketZones.find(z => z.name === form.zone);
  const zoneRegionWage = selectedZone?.region_zone && regionWages ? regionWages[selectedZone.region_zone as RegionZone] : null;
  const belowMinWage = zoneRegionWage != null && [ptWage, tnWage, ktvWage].some(w => w > 0 && w < zoneRegionWage);

  const competitorsForZone = useMemo(() => competitors.filter(c =>
    zoneMatches(c.zone_name, form.zone) || (c.active_zones ?? []).some(z => zoneMatches(z, form.zone))
  ), [competitors, form.zone]);

  // Phí dịch vụ THẬT LGVN đã đàm phán được tại đúng KCN (+ ngành nếu lọc) — chênh lệch
  // giữa "Công ty trả LGVN" và "LGVN trả NLĐ" theo từng dự án/khách hàng đã có wage_detail
  // 2 phía (migration 101 + 115). Đây là số liệu mạnh nhất vì là giá đã CHỐT thật, không
  // phải khảo sát hay ước lượng.
  const realMargin = useMemo(() => {
    if (!form.zone) return null;
    const margins: number[] = [];
    clients.forEach(c => {
      if (form.industry && c.industry !== form.industry) return;
      if (!(c.industrial_zones ?? []).some(z => zoneMatches(z, form.zone))) return;
      if (!c.wage_detail || !c.wage_detail_client) return;
      const lgvn = sumWageDetail(c.wage_detail);
      const company = sumWageDetail(c.wage_detail_client);
      if (lgvn > 0 && company > 0) margins.push(company - lgvn);
    });
    marketLeads.forEach(l => {
      if (form.industry && l.industry !== form.industry) return;
      if (!zoneMatches(l.region, form.zone)) return;
      if (!l.wage_detail || !l.wage_detail_client) return;
      const lgvn = sumWageDetail(l.wage_detail);
      const company = sumWageDetail(l.wage_detail_client);
      if (lgvn > 0 && company > 0) margins.push(company - lgvn);
    });
    if (!margins.length) return null;
    return { avg: margins.reduce((a, b) => a + b, 0) / margins.length, n: margins.length };
  }, [clients, marketLeads, form.zone, form.industry]);

  const applyIndustryFee = () => {
    if (!industryMetric) return;
    const lo = industryMetric.service_fee_min, hi = industryMetric.service_fee_max;
    const mid = lo != null && hi != null ? Math.round((lo + hi) / 2) : lo ?? hi;
    if (mid == null) return;
    setFees(f => ({ ...f, pt: String(mid) }));
    toast('Đã áp dụng gợi ý phí theo ngành vào Phổ thông');
  };
  const applyRealMarginFee = () => {
    if (!realMargin) return;
    setFees(f => ({ ...f, pt: String(Math.round(realMargin.avg)) }));
    toast('Đã áp dụng phí thực tế trung bình vào Phổ thông');
  };

  // Các dự án/khách hàng Let's Go VN đã từng thoả thuận lương thật tại đúng KCN này (và đúng
  // ngành nếu có lọc) — dữ liệu thật từ tab Công ty/Dự án + Khách hàng, không phải khảo sát tay.
  const projectsAtZone = useMemo(() => {
    if (!form.zone) return [];
    const out: { name: string; industry: string; wageMin: number; wageMax: number; source: string }[] = [];
    clients.forEach(c => {
      if (!c.industry || c.wage_min == null || c.wage_max == null) return;
      if (form.industry && c.industry !== form.industry) return;
      if ((c.industrial_zones ?? []).some(z => zoneMatches(z, form.zone))) {
        out.push({ name: c.name, industry: c.industry, wageMin: c.wage_min, wageMax: c.wage_max, source: 'Khách hàng đang HT' });
      }
    });
    marketLeads.forEach(l => {
      if (!l.industry || l.wage_min == null || l.wage_max == null) return;
      if (form.industry && l.industry !== form.industry) return;
      if (zoneMatches(l.region, form.zone)) {
        out.push({ name: l.company_name, industry: l.industry, wageMin: l.wage_min, wageMax: l.wage_max, source: 'Dự án đang tìm hiểu' });
      }
    });
    return out;
  }, [clients, marketLeads, form.zone, form.industry]);

  const feeCompareRows = useMemo(() => FEE_TIERS.map(row => {
    const compFees = competitorsForZone.map(c => c[row.feeKey]).filter((v): v is number => v != null);
    const avg = compFees.length ? compFees.reduce((a, b) => a + b, 0) / compFees.length : null;
    const min = compFees.length ? Math.min(...compFees) : null;
    const max = compFees.length ? Math.max(...compFees) : null;
    const ourFee = parseInt(fees[row.key as keyof typeof fees]) || 0;
    const competitive = !avg || ourFee <= avg * 1.1;
    return { ...row, ourFee, avg, min, max, n: compFees.length, competitive };
  }), [competitorsForZone, fees]);

  const handleDownload = () => {
    const rows = [
      ['Loại LĐ', 'Đơn giá LĐ', 'Phí DV', 'Tổng'],
      ['Phổ thông', ptWage, ptFee, ptWage + ptFee],
      ['Tay nghề', tnWage, tnFee, tnWage + tnFee],
      ['Kỹ thuật viên', ktvWage, ktvFee, ktvWage + ktvFee],
      [], ['Khách hàng:', form.name], ['KCN:', form.zone], ['Ngành:', form.industry], ['Ngày:', new Date().toLocaleDateString('vi-VN')],
    ];
    const csv = '﻿' + rows.map(r => r.join(',')).join('\n');
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
        industry: form.industry || null,
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
      <PageHeader title="Báo giá tự động" subtitle="Điền thông tin → Xem trước → Tải Excel" />
      <div className="flex-1 overflow-y-auto p-5">
        <div className="flex gap-1.5 mb-4">
          <button onClick={() => setView('form')} className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium border transition ${view === 'form' ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-[#E8E7E2] text-[#666] hover:bg-[#F9F9F7]'}`}>
            <FileText size={13} /> Tạo báo giá
          </button>
          <button onClick={() => setView('history')} className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium border transition ${view === 'history' ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-[#E8E7E2] text-[#666] hover:bg-[#F9F9F7]'}`}>
            <History size={13} /> Lịch sử báo giá
          </button>
        </div>

        {view === 'history' ? (
          <QuoteHistory toast={toast} />
        ) : (
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
                  {[...marketZones].sort((a, b) => a.name.localeCompare(b.name, 'vi')).map(z => (
                    <option key={z.id} value={z.name}>{z.name}{regionZoneLabel(z.region_zone) ? ` · Vùng ${regionZoneLabel(z.region_zone)}` : ''}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[12px] text-[#666] font-medium">Ngành nghề</label>
                <select value={form.industry} onChange={e => setForm(f => ({ ...f, industry: e.target.value }))} className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500">
                  <option value="">-- Chọn ngành (tuỳ chọn) --</option>
                  {industries.map(i => <option key={i}>{i}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1 col-span-2">
                <label className="text-[12px] text-[#666] font-medium">Nhu cầu lao động</label>
                <input value={form.demand} onChange={e => setForm(f => ({ ...f, demand: e.target.value }))}
                  placeholder="200 LĐ phổ thông..." className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" />
              </div>
            </div>

            {selectedZone && (
              <div className="mb-4 p-3 bg-blue-50/50 border border-blue-100 rounded-lg flex flex-wrap gap-x-6 gap-y-1.5 text-[12px]">
                {selectedZone.region_zone && (
                  <span className="flex items-center gap-1.5">
                    <span className="text-[#888]">Lương tối thiểu vùng:</span>
                    <span className={`px-1.5 py-0.5 rounded-full text-[11px] font-semibold ${regionZoneColorCls(selectedZone.region_zone)}`}>Vùng {regionZoneLabel(selectedZone.region_zone)}</span>
                    {zoneRegionWage != null && <strong>{fmtVND(zoneRegionWage)}</strong>}
                  </span>
                )}
                <span><span className="text-[#888]">LGVN đã có tại đây:</span> <strong>{selectedZone.lgv_clients ?? 0} khách</strong> · <strong>{selectedZone.lgv_workers ?? 0} LĐ</strong></span>
                {selectedZone.occupancy_pct != null && <span><span className="text-[#888]">Lấp đầy KCN:</span> <strong>{selectedZone.occupancy_pct}%</strong></span>}
                {selectedZone.industries && selectedZone.industries.length > 0 && (
                  <span><span className="text-[#888]">Ngành chủ lực:</span> {selectedZone.industries.slice(0, 4).join(', ')}</span>
                )}
              </div>
            )}

            {(industryMetric?.service_fee_min != null || realMargin) && (
              <div className="mb-4 p-3 bg-amber-50/60 border border-amber-200 rounded-lg text-[12px] space-y-1.5">
                <div className="font-semibold text-amber-800">Gợi ý phí dịch vụ dựa trên dữ liệu thị trường</div>
                {industryMetric?.service_fee_min != null && (
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span>Phí dịch vụ TB ngành "{form.industry}" (kỳ {industryMetric.period}): <strong>{fmtVND(industryMetric.service_fee_min)}{industryMetric.service_fee_max != null ? ` – ${fmtVND(industryMetric.service_fee_max)}` : ''}</strong></span>
                    <button onClick={applyIndustryFee} className="text-blue-600 hover:underline text-[11.5px] font-medium shrink-0">Áp dụng vào Phổ thông</button>
                  </div>
                )}
                {realMargin && (
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span>Phí thực tế TB các dự án LGVN đã có tại {form.zone}{form.industry ? `, ngành ${form.industry}` : ''} (n={realMargin.n}): <strong>{fmtVND(Math.round(realMargin.avg))}</strong>/người/tháng</span>
                    <button onClick={applyRealMarginFee} className="text-blue-600 hover:underline text-[11.5px] font-medium shrink-0">Áp dụng vào Phổ thông</button>
                  </div>
                )}
              </div>
            )}

            {belowMinWage && selectedZone && (
              <div className="mb-4 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-[12px] text-red-700 font-medium">
                ⚠ Đơn giá lao động đang thấp hơn lương tối thiểu Vùng {regionZoneLabel(selectedZone.region_zone)} tại {form.zone} ({zoneRegionWage != null && fmtVND(zoneRegionWage)}) — kiểm tra lại trước khi gửi báo giá.
              </div>
            )}

            <div className="grid grid-cols-3 gap-3 mb-3 p-3 bg-[#F9F9F7] rounded-lg">
              <div className="text-[12px] text-[#555] font-medium col-span-3">Đơn giá lao động đề xuất (₫/người/tháng)</div>
              {[{ key: 'pt', label: 'Phổ thông' }, { key: 'tn', label: 'Tay nghề' }, { key: 'ktv', label: 'Kỹ thuật viên' }].map(f => (
                <div key={f.key} className="flex flex-col gap-1">
                  <label className="text-[11.5px] text-[#888]">{f.label}</label>
                  <input type="number" value={wages[f.key as keyof typeof wages]} onChange={e => setWages(prev => ({ ...prev, [f.key]: e.target.value }))}
                    className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" />
                </div>
              ))}
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
              <button onClick={handleSave} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[12px] font-medium border border-gray-300 text-gray-600 hover:bg-gray-50 transition"><Save size={13} /> Lưu vào DB</button>
              {saved && <span className="text-[12px] text-emerald-600 font-medium">✓ Đã lưu!</span>}
            </div>

            {form.zone && projectsAtZone.length > 0 && (
              <div className="mb-4 border border-emerald-200 rounded-lg overflow-hidden">
                <div className="px-3 py-2 bg-emerald-50 text-[12px] font-semibold text-emerald-800">
                  Dự án Let's Go VN đã có tại {form.zone} ({projectsAtZone.length})
                </div>
                <table className="w-full text-[12.5px]">
                  <thead><tr className="border-b border-emerald-100">
                    {['Tên', 'Ngành', 'Lương thoả thuận', 'Nguồn'].map(h => (
                      <th key={h} className="text-left px-3 py-1.5 text-[11.5px] text-[#888] font-medium bg-[#F9F9F7]">{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {projectsAtZone.map((p, i) => (
                      <tr key={i} className="border-b border-[#F0EEE9] last:border-0">
                        <td className="px-3 py-2 font-medium">{p.name}</td>
                        <td className="px-3 py-2">{p.industry}</td>
                        <td className="px-3 py-2">{fmtVND(p.wageMin)} – {fmtVND(p.wageMax)}</td>
                        <td className="px-3 py-2 text-[#888]">{p.source}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {showComparison && form.zone && (
              <div className="mb-4 border border-violet-200 rounded-lg overflow-hidden">
                <div className="px-3 py-2 bg-violet-50 text-[12px] font-semibold text-violet-800">
                  So sánh phí dịch vụ với đối thủ — {form.zone} ({competitorsForZone.length} đối thủ có dữ liệu)
                </div>
                <table className="w-full text-[12.5px]">
                  <thead><tr className="border-b border-violet-100">
                    {["Loại LĐ", "Let's Go VN", 'TB đối thủ', 'Khoảng đối thủ', 'Vị thế'].map(h => (
                      <th key={h} className="text-left px-3 py-1.5 text-[11.5px] text-[#888] font-medium bg-[#F9F9F7]">{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {feeCompareRows.map(row => (
                      <tr key={row.key} className="border-b border-[#F0EEE9] last:border-0">
                        <td className="px-3 py-2 font-medium">{row.label}</td>
                        <td className="px-3 py-2 font-semibold text-blue-700">{fmtVND(row.ourFee)}</td>
                        <td className="px-3 py-2">{row.avg ? fmtVND(Math.round(row.avg)) : '—'}</td>
                        <td className="px-3 py-2 text-[#888]">{row.min != null ? `${fmtVND(row.min)} – ${fmtVND(row.max as number)}` : '—'}</td>
                        <td className="px-3 py-2"><span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${row.competitive ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{row.competitive ? 'Cạnh tranh' : 'Cao hơn TT'}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {competitorsForZone.length === 0 && <div className="px-3 py-2 text-[11.5px] text-[#999] bg-[#F9F9F7]">Chưa có dữ liệu đối thủ tại KCN này — vào tab Đối thủ để bổ sung.</div>}
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
                    {form.address && <div className="flex gap-2"><span className="text-[#888] shrink-0">Địa chỉ:</span><span>{form.address}</span></div>}
                  </div>
                  <div>
                    {form.contact && <div className="flex gap-2"><span className="text-[#888] shrink-0">Liên hệ:</span><span>{form.contact}</span></div>}
                    {form.zone && <div className="flex gap-2"><span className="text-[#888] shrink-0">KCN:</span><span>{form.zone}</span></div>}
                    {form.industry && <div className="flex gap-2"><span className="text-[#888] shrink-0">Ngành:</span><span>{form.industry}</span></div>}
                  </div>
                </div>
                <table className="w-full text-[12.5px]">
                  <thead><tr className="border-b border-[#E8E7E2]">
                    {['Loại lao động', 'Đơn giá LĐ', 'Phí dịch vụ', 'Tổng/người/tháng'].map(h => <th key={h} className="text-left py-2 text-[11.5px] text-[#888] font-medium pr-4">{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {[{ label: 'Phổ thông', wage: ptWage, fee: ptFee }, { label: 'Tay nghề', wage: tnWage, fee: tnFee }, { label: 'Kỹ thuật viên', wage: ktvWage, fee: ktvFee }].map(row => (
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
        )}
      </div>
    </>
  );
}
