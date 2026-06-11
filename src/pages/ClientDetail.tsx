import { useState, useMemo } from 'react';
import { ArrowLeft, Edit2, Check, X, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';
import { Line, Bar } from 'react-chartjs-2';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, BarElement, Tooltip, Filler } from 'chart.js';
import type { Client, LaborHistoryEntry } from '../lib/types';
import { formatDate, getMonthLast, getCurrentWeekLabel, statusPill } from '../lib/format';
import { MANAGERS } from '../lib/constants';
import { supabase } from '../lib/supabase';
import ContactsTab from '../components/ContactsTab';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Tooltip, Filler);

interface ClientDetailProps {
  client: Client;
  laborHistory: LaborHistoryEntry[];
  onBack: () => void;
  onClientUpdate: (client: Client) => void;
  onLaborUpdate: (entry: LaborHistoryEntry) => void;
  toast: (msg: string) => void;
}

export default function ClientDetail({ client, laborHistory, onBack, onClientUpdate, onLaborUpdate, toast }: ClientDetailProps) {
  const [activeTab, setActiveTab] = useState<'overview' | 'contacts'>('overview');
  const [editing, setEditing] = useState(false);
  const [chartView, setChartView] = useState<'week' | 'month'>('week');
  const [laborInput, setLaborInput] = useState(String(client.current_workers || 0));
  const [laborMsg, setLaborMsg] = useState(false);
  const [openInfo, setOpenInfo] = useState(false);
  const [openLabor, setOpenLabor] = useState(true);
  const [form, setForm] = useState({
    region: client.region || '',
    manager: client.manager || '',
    contract_start: client.contract_start || '',
    contract_end: client.contract_end || '',
    notes: client.notes || '',
  });

  const hist = useMemo(() => [...laborHistory].sort((a, b) => a.created_at.localeCompare(b.created_at)), [laborHistory]);
  const currentWorkers = hist.length ? hist[hist.length - 1].count : 0;

  const chartData = useMemo(() => {
    if (chartView === 'week') {
      return {
        labels: hist.map(h => h.week_label),
        datasets: [{ label: 'LĐ', data: hist.map(h => h.count), borderColor: '#3B82F6', backgroundColor: 'rgba(59,130,246,.1)', fill: true, tension: 0.4, borderWidth: 2, pointRadius: 4 }],
      };
    }
    const t4 = getMonthLast(hist, 'T4');
    const t5 = getMonthLast(hist, 'T5');
    const t6 = getMonthLast(hist, 'T6');
    return {
      labels: ['T4/2026', 'T5/2026', 'T6/2026'],
      datasets: [{ label: 'LĐ', data: [t4, t5, t6], backgroundColor: ['rgba(59,130,246,.3)', 'rgba(59,130,246,.3)', '#3B82F6'], borderRadius: 6, barPercentage: 0.6 }],
    };
  }, [hist, chartView]);

  const monthRows = useMemo(() => {
    const t4 = getMonthLast(hist, 'T4');
    const t5 = getMonthLast(hist, 'T5');
    const t6 = getMonthLast(hist, 'T6');
    return [
      { m: 'T4/2026', cnt: t4, prev: null },
      { m: 'T5/2026', cnt: t5, prev: t4 },
      { m: 'T6/2026', cnt: t6, prev: t5 },
    ];
  }, [hist]);

  const handleSave = async () => {
    try {
      const updates = { ...form, updated_at: new Date().toISOString() };
      const { error } = await supabase.from('clients').update(updates).eq('id', client.id);
      if (error) throw error;
      onClientUpdate({ ...client, ...updates });
      setEditing(false);
      toast('Đã lưu thông tin khách hàng!');
    } catch (e: any) {
      toast('Lỗi: ' + e.message);
    }
  };

  const handleLaborUpdate = async () => {
    const val = parseInt(laborInput);
    if (isNaN(val) || val < 0) { toast('Số lao động không hợp lệ'); return; }
    const wk = getCurrentWeekLabel();
    try {
      const existing = hist.find(h => h.week_label === wk);
      if (existing) {
        const { error } = await supabase.from('client_labor_history').update({ count: val }).eq('id', existing.id);
        if (error) throw error;
        onLaborUpdate({ ...existing, count: val });
      } else {
        const { data, error } = await supabase.from('client_labor_history').insert({ client_id: client.id, week_label: wk, count: val, updated_by: 'Tony Nguyễn' }).select().single();
        if (error) throw error;
        onLaborUpdate(data);
      }
      setLaborMsg(true);
      setTimeout(() => setLaborMsg(false), 3000);
      toast(`Đã cập nhật ${val.toLocaleString()} LĐ tuần ${wk}`);
    } catch (e: any) {
      toast('Lỗi lưu: ' + e.message);
    }
  };

  const pill = statusPill(client.status);

  return (
    <>
      <div className="flex items-center justify-between px-6 py-3 bg-white border-b border-[#E8E7E2] shrink-0">
        <div className="flex items-center gap-2.5">
          <button onClick={onBack} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[12px] font-medium border border-gray-300 text-gray-600 hover:bg-gray-50 transition">
            <ArrowLeft size={13} /> Quay lại
          </button>
          <div>
            <div className="text-[14px] font-semibold text-[#111]">{client.name}</div>
            <div className="text-[11.5px] text-[#888]">{client.region || ''} · <span className={pill.cls.includes('emerald') ? 'text-emerald-600' : pill.cls.includes('amber') ? 'text-amber-600' : 'text-red-600'}>{pill.label}</span></div>
          </div>
        </div>
        <button onClick={() => setEditing(!editing)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[12px] font-medium border border-blue-500 text-blue-700 hover:bg-blue-50 transition">
          {editing ? <><X size={13} /> Hủy</> : <><Edit2 size={13} /> Sửa thông tin</>}
        </button>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-[#E8E7E2] bg-white shrink-0 px-6">
        {(['overview', 'contacts'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2.5 text-[12.5px] font-medium border-b-2 transition -mb-px ${
              activeTab === tab
                ? 'border-[#1D4ED8] text-[#1D4ED8]'
                : 'border-transparent text-[#888] hover:text-[#555]'
            }`}
          >
            {tab === 'overview' ? '📊 Tổng quan' : '👤 Người liên hệ'}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {activeTab === 'contacts' ? (
          <ContactsTab clientId={client.id} toast={toast} />
        ) : (
          <>
        {/* Info & Contract */}
        <div className="bg-white border border-[#E8E7E2] rounded-[10px] overflow-hidden">
          <button onClick={() => setOpenInfo(!openInfo)} className="flex items-center justify-between w-full px-4 py-2.5 border-b border-[#E8E7E2] hover:bg-[#FAFAF8] transition">
            <span className="text-[12.5px] font-semibold text-[#111] flex items-center gap-2">📋 Thông tin & Hợp đồng</span>
            {openInfo ? <ChevronUp size={13} className="text-[#aaa]" /> : <ChevronDown size={13} className="text-[#aaa]" />}
          </button>
          {openInfo && (
            <div className="p-4">
              {editing ? (
                <>
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <div className="flex flex-col gap-1">
                      <label className="text-[12px] text-[#666] font-medium">Khu vực</label>
                      <select value={form.region} onChange={e => setForm({ ...form, region: e.target.value })} className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500">
                        {['Biên Hòa', 'VSIP', 'Bình Dương', 'Đồng Nai', 'Bàu Bàng', 'Củ Chi', 'Nhơn Trạch'].map(r => <option key={r}>{r}</option>)}
                      </select>
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[12px] text-[#666] font-medium">Người quản lý</label>
                      <select value={form.manager} onChange={e => setForm({ ...form, manager: e.target.value })} className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500">
                        {MANAGERS.map(m => <option key={m}>{m}</option>)}
                      </select>
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[12px] text-[#666] font-medium">Ngày bắt đầu HĐ</label>
                      <input type="date" value={form.contract_start} onChange={e => setForm({ ...form, contract_start: e.target.value })} className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[12px] text-[#666] font-medium">Ngày hết hạn HĐ</label>
                      <input type="date" value={form.contract_end} onChange={e => setForm({ ...form, contract_end: e.target.value })} className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" />
                    </div>
                  </div>
                  <div className="flex flex-col gap-1 mb-3">
                    <label className="text-[12px] text-[#666] font-medium">Ghi chú</label>
                    <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500 min-h-[60px] resize-y" />
                  </div>
                  <div className="flex gap-2">
                    <button onClick={handleSave} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-[#1D4ED8] text-white hover:bg-[#1E40AF] transition"><Check size={13} /> Lưu thay đổi</button>
                    <button onClick={() => setEditing(false)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[12px] font-medium border border-gray-300 text-gray-600 hover:bg-gray-50">Hủy</button>
                  </div>
                </>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {[
                    ['Khu vực', client.region],
                    ['Người quản lý', client.manager],
                    ['Ngày bắt đầu HĐ', formatDate(client.contract_start)],
                    ['Ngày hết hạn HĐ', formatDate(client.contract_end)],
                  ].map(([label, val]) => (
                    <div key={label}>
                      <label className="text-[12px] text-[#666] font-medium">{label}</label>
                      <div className="text-[13px] text-[#111] py-1 border-b border-dashed border-[#E8E7E2] min-h-[28px]">{val || '—'}</div>
                    </div>
                  ))}
                  {client.notes && (
                    <div className="col-span-2">
                      <label className="text-[12px] text-[#666] font-medium">Ghi chú</label>
                      <div className="text-[13px] text-[#111] py-1 border-b border-dashed border-[#E8E7E2]">{client.notes}</div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Labor Tracking */}
        <div className="bg-white border border-[#E8E7E2] rounded-[10px] overflow-hidden">
          <button onClick={() => setOpenLabor(!openLabor)} className="flex items-center justify-between w-full px-4 py-2.5 border-b border-[#E8E7E2] hover:bg-[#FAFAF8] transition">
            <span className="text-[12.5px] font-semibold text-[#111] flex items-center gap-2">👥 Theo dõi Lao động — <span className="text-blue-700">{currentWorkers.toLocaleString()} LĐ hiện tại</span></span>
            {openLabor ? <ChevronUp size={13} className="text-[#aaa]" /> : <ChevronDown size={13} className="text-[#aaa]" />}
          </button>
          {openLabor && (
            <div className="p-4">
              <div className="flex items-center gap-2.5 bg-[#F9F9F7] border border-[#E8E7E2] rounded-lg px-4 py-3 mb-3">
                <RefreshCw size={16} className="text-[#888]" />
                <span className="text-[13px] text-[#555] font-medium">Cập nhật LĐ tuần này:</span>
                <input type="number" value={laborInput} onChange={e => setLaborInput(e.target.value)} className="w-[110px] text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" />
                <button onClick={handleLaborUpdate} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-[#1D4ED8] text-white hover:bg-[#1E40AF] transition"><Check size={13} /> Cập nhật</button>
                {laborMsg && <span className="text-[12px] text-emerald-600 inline-flex items-center gap-1">✓ Đã lưu!</span>}
              </div>

              <div className="flex gap-1.5 mb-3">
                <button onClick={() => setChartView('week')} className={`px-3 py-1 rounded-lg text-[12px] font-medium border transition ${chartView === 'week' ? 'bg-blue-100 border-blue-500 text-blue-700' : 'bg-white border-gray-300 text-gray-500'}`}>📊 Theo tuần</button>
                <button onClick={() => setChartView('month')} className={`px-3 py-1 rounded-lg text-[12px] font-medium border transition ${chartView === 'month' ? 'bg-blue-100 border-blue-500 text-blue-700' : 'bg-white border-gray-300 text-gray-500'}`}>📅 Theo tháng</button>
              </div>

              <div className="mb-4" style={{ height: 190 }}>
                {chartView === 'week' ? (
                  <Line data={chartData} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false } }, y: { beginAtZero: false } } }} />
                ) : (
                  <Bar data={chartData} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false } }, y: { beginAtZero: false } } }} />
                )}
              </div>

              <div className="text-[13px] font-semibold text-[#111] mb-2">Báo cáo tăng giảm theo tháng</div>
              <table className="w-full text-[12.5px]">
                <thead><tr><th className="text-left px-3 py-2 text-[11.5px] text-[#888] font-medium bg-[#F9F9F7]">Tháng</th><th className="text-left px-3 py-2 text-[11.5px] text-[#888] font-medium bg-[#F9F9F7]">Số LĐ cuối tháng</th><th className="text-left px-3 py-2 text-[11.5px] text-[#888] font-medium bg-[#F9F9F7]">So với tháng trước</th></tr></thead>
                <tbody>
                  {monthRows.map(r => {
                    const d = r.cnt !== null && r.prev !== null ? r.cnt - r.prev : null;
                    return (
                      <tr key={r.m} className="border-b border-[#F0EEE9]">
                        <td className="px-3 py-2">{r.m}</td>
                        <td className="px-3 py-2 font-semibold">{r.cnt !== null ? r.cnt.toLocaleString() : '—'}{d !== null && <span className="ml-1" style={{ color: d > 0 ? '#059669' : d < 0 ? '#DC2626' : '#888' }}>({d > 0 ? '+' : ''}{d})</span>}</td>
                        <td className="px-3 py-2 text-[12px] text-[#888]">{d !== null ? (d > 0 ? 'Tăng' : 'Giảm') + ' so tháng trước' : 'Chưa có so sánh'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
          </>
        )}
      </div>
    </>
  );
}
