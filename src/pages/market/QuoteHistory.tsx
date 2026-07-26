import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Loader2, Trash2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { logActivity } from '../../lib/audit';
import type { Quote } from '../../lib/types';

interface Props {
  toast: (msg: string) => void;
}

const STATUS_OPTIONS: { key: string; label: string }[] = [
  { key: 'draft', label: 'Nháp' },
  { key: 'sent', label: 'Đã gửi' },
  { key: 'won', label: 'Thắng' },
  { key: 'lost', label: 'Thua' },
];
const statusLabel = (s: string) => STATUS_OPTIONS.find(o => o.key === s)?.label ?? s;
const statusCls = (s: string) =>
  s === 'won' ? 'bg-emerald-50 text-emerald-700' : s === 'lost' ? 'bg-red-50 text-red-700' : s === 'sent' ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-600';

const fmtVND = (n: number | null | undefined) => n == null ? '—' : n.toLocaleString('vi-VN') + ' ₫';

export default function QuoteHistory({ toast }: Props) {
  const { user } = useAuth();
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [zoneFilter, setZoneFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [converting, setConverting] = useState<string | null>(null);
  const [confirmDelId, setConfirmDelId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.from('quotes').select('*').order('created_at', { ascending: false });
    if (!error && data) setQuotes(data as Quote[]);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const zonesUsed = useMemo(() => [...new Set(quotes.map(q => q.zone).filter((z): z is string => !!z))], [quotes]);

  const filtered = useMemo(() => quotes.filter(q => {
    if (statusFilter !== 'all' && q.status !== statusFilter) return false;
    if (zoneFilter !== 'all' && q.zone !== zoneFilter) return false;
    if (search.trim() && !q.client_name.toLowerCase().includes(search.trim().toLowerCase())) return false;
    return true;
  }), [quotes, statusFilter, zoneFilter, search]);

  const updateStatus = async (q: Quote, status: string) => {
    setQuotes(prev => prev.map(x => x.id === q.id ? { ...x, status } : x));
    const { error } = await supabase.from('quotes').update({ status }).eq('id', q.id);
    if (error) { toast('Lỗi: ' + error.message); await load(); return; }
    await logActivity({
      user, action: 'update', table: 'quotes', recordId: q.id,
      description: `Đổi trạng thái báo giá "${q.client_name}" → ${statusLabel(status)}`,
      oldData: { status: q.status }, newData: { status },
    });
  };

  const convertToLead = async (q: Quote) => {
    setConverting(q.id);
    try {
      const workersMatch = q.labor_demand?.match(/\d+/);
      const { data, error } = await supabase.from('market_leads').insert({
        company_name: q.client_name,
        region: q.zone,
        industry: q.industry ?? null,
        workers_needed: workersMatch ? Number(workersMatch[0]) : 0,
        source: 'Báo giá',
        status: 'Đã LH',
        suppliers: [{ name: "Let's Go VN", qty: 0, is_us: true }],
        allowance_notes: `Chuyển từ báo giá ngày ${new Date(q.created_at).toLocaleDateString('vi-VN')}. Phí đề xuất — Phổ thông: ${fmtVND(q.price_unskilled)}, Tay nghề: ${fmtVND(q.price_skilled)}, Kỹ thuật viên: ${fmtVND(q.price_tech)}.`,
      }).select().single();
      if (error) throw error;
      const { error: linkErr } = await supabase.from('quotes').update({ converted_lead_id: data.id }).eq('id', q.id);
      if (linkErr) throw linkErr;
      setQuotes(prev => prev.map(x => x.id === q.id ? { ...x, converted_lead_id: data.id } : x));
      toast('Đã tạo Dự án — mở tab Công ty/Dự án để hoàn thiện thêm chi tiết');
      await logActivity({
        user, action: 'insert', table: 'market_leads', recordId: data.id,
        description: `Chuyển báo giá "${q.client_name}" thành Dự án`, newData: data,
      });
    } catch (e: any) {
      toast('Lỗi: ' + e.message);
    } finally {
      setConverting(null);
    }
  };

  const handleDelete = async (q: Quote) => {
    if (confirmDelId !== q.id) { setConfirmDelId(q.id); return; }
    const { error } = await supabase.from('quotes').delete().eq('id', q.id);
    if (error) { toast('Lỗi: ' + error.message); return; }
    setQuotes(prev => prev.filter(x => x.id !== q.id));
    setConfirmDelId(null);
    toast('Đã xoá báo giá');
    await logActivity({ user, action: 'delete', table: 'quotes', recordId: q.id, description: `Xoá báo giá "${q.client_name}"`, oldData: q });
  };

  if (loading) {
    return <div className="flex items-center gap-2 text-[13px] text-[#888] py-8 justify-center"><Loader2 size={14} className="animate-spin" /> Đang tải lịch sử báo giá...</div>;
  }

  return (
    <div className="bg-white border border-[#E8E7E2] rounded-[10px] overflow-hidden">
      <div className="px-4 py-2.5 border-b border-[#E8E7E2] flex items-center justify-between flex-wrap gap-2">
        <span className="text-[12.5px] font-semibold text-[#111]">Lịch sử báo giá ({filtered.length}/{quotes.length})</span>
        <div className="flex items-center gap-2 flex-wrap">
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Tìm theo tên công ty..."
            className="text-[12px] px-2.5 py-1 rounded-md border border-gray-300 outline-none focus:border-blue-500 w-44" />
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="text-[12px] px-2 py-1 rounded-md border border-gray-300 outline-none">
            <option value="all">Mọi trạng thái</option>
            {STATUS_OPTIONS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          <select value={zoneFilter} onChange={e => setZoneFilter(e.target.value)} className="text-[12px] px-2 py-1 rounded-md border border-gray-300 outline-none">
            <option value="all">Mọi KCN</option>
            {zonesUsed.map(z => <option key={z} value={z}>{z}</option>)}
          </select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="py-10 text-center text-[12.5px] text-[#999]">
          {quotes.length === 0 ? 'Chưa có báo giá nào được lưu.' : 'Không có báo giá khớp bộ lọc.'}
        </div>
      ) : (
        <table className="w-full text-[12.5px]">
          <thead><tr className="border-b border-[#E8E7E2]">
            {['Ngày', 'Khách hàng', 'KCN', 'PT / TN / KTV', 'Trạng thái', ''].map(h => (
              <th key={h} className="text-left px-3 py-1.5 text-[11.5px] text-[#888] font-medium bg-[#F9F9F7]">{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {filtered.map(q => (
              <tr key={q.id} className="border-b border-[#F0EEE9] last:border-0 align-top">
                <td className="px-3 py-2 whitespace-nowrap text-[#888]">{new Date(q.created_at).toLocaleDateString('vi-VN')}</td>
                <td className="px-3 py-2 font-medium">
                  {q.client_name}
                  {q.industry && <div className="text-[11px] text-[#999] font-normal">{q.industry}</div>}
                </td>
                <td className="px-3 py-2 text-[#666]">{q.zone || '—'}</td>
                <td className="px-3 py-2 text-[#666] whitespace-nowrap">{fmtVND(q.price_unskilled)} / {fmtVND(q.price_skilled)} / {fmtVND(q.price_tech)}</td>
                <td className="px-3 py-2">
                  <select value={q.status} onChange={e => updateStatus(q, e.target.value)}
                    className={`text-[11px] font-medium px-1.5 py-0.5 rounded-full border-0 outline-none cursor-pointer ${statusCls(q.status)}`}>
                    {STATUS_OPTIONS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                  </select>
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2 justify-end">
                    {q.status === 'won' && !q.converted_lead_id && (
                      <button onClick={() => convertToLead(q)} disabled={converting === q.id}
                        className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 hover:underline disabled:opacity-50">
                        {converting === q.id ? <Loader2 size={11} className="animate-spin" /> : <ArrowRight size={11} />} Chuyển thành Dự án
                      </button>
                    )}
                    {q.converted_lead_id && <span className="text-[11px] text-emerald-600">✓ Đã tạo Dự án</span>}
                    <button onClick={() => handleDelete(q)}
                      className={`inline-flex items-center gap-1 text-[11px] ${confirmDelId === q.id ? 'text-red-600 font-semibold' : 'text-gray-400 hover:text-red-600'}`}>
                      <Trash2 size={11} /> {confirmDelId === q.id ? 'Bấm lại để xoá' : ''}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
