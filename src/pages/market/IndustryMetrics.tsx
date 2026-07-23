import { useEffect, useMemo, useState } from 'react';
import { Line } from 'react-chartjs-2';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend } from 'chart.js';
import { LineChart, Plus, Trash2, Save, TrendingUp, TrendingDown } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type { IndustryMetric } from '../../lib/types';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend);

interface Props { industryId: string; toast: (m: string) => void; }
type Row = Partial<IndustryMetric> & { _key: string };

const currentQuarter = () => {
  const d = new Date();
  return `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`;
};
const nextQuarter = (p: string) => {
  const m = /^(\d{4})-Q([1-4])$/.exec(p);
  if (!m) return currentQuarter();
  const y = Number(m[1]), q = Number(m[2]);
  return q === 4 ? `${y + 1}-Q1` : `${y}-Q${q + 1}`;
};

export default function IndustryMetrics({ industryId, toast }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [saving, setSaving] = useState(false);
  const [confirmDel, setConfirmDel] = useState<Row | null>(null);

  const reload = async () => {
    const { data } = await supabase.from('industry_metrics').select('*').eq('industry_id', industryId).order('period');
    setRows(((data ?? []) as IndustryMetric[]).map(m => ({ ...m, _key: m.id })));
  };
  useEffect(() => { reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [industryId]);

  const set = (key: string, patch: Partial<Row>) => setRows(prev => prev.map(r => r._key === key ? { ...r, ...patch } : r));
  const num = (v: string) => v.trim() === '' ? null : Number(v.replace(/[^\d.]/g, ''));

  const addRow = () => {
    const last = rows[rows.length - 1]?.period;
    setRows(prev => [...prev, { _key: 'new-' + Date.now(), period: last ? nextQuarter(last) : currentQuarter() }]);
  };

  const handleSave = async () => {
    setSaving(true);
    for (const r of rows.filter(x => (x.period ?? '').trim())) {
      const payload = {
        industry_id: industryId, period: (r.period ?? '').trim(),
        avg_wage_unskilled: r.avg_wage_unskilled ?? null, avg_wage_skilled: r.avg_wage_skilled ?? null,
        service_fee_min: r.service_fee_min ?? null, service_fee_max: r.service_fee_max ?? null,
        turnover_rate: r.turnover_rate ?? null, ot_hours: r.ot_hours ?? null,
        demand_headcount: r.demand_headcount ?? null, note: (r.note ?? '').trim() || null,
      };
      const { error } = r.id
        ? await supabase.from('industry_metrics').update(payload).eq('id', r.id)
        : await supabase.from('industry_metrics').insert(payload);
      if (error) { setSaving(false); toast('Lỗi: ' + error.message); return; }
    }
    setSaving(false);
    toast('Đã lưu chỉ số ngành');
    reload();
  };

  const handleDelete = async () => {
    if (!confirmDel) return;
    if (confirmDel.id) {
      const { error } = await supabase.from('industry_metrics').delete().eq('id', confirmDel.id);
      if (error) { toast('Lỗi: ' + error.message); return; }
    }
    setRows(prev => prev.filter(r => r._key !== confirmDel._key));
    setConfirmDel(null);
    toast('Đã xoá kỳ');
  };

  // Biến động giữa kỳ đầu và kỳ cuối — câu chốt khi đàm phán giá.
  const delta = useMemo(() => {
    const w = rows.filter(r => r.avg_wage_unskilled != null);
    if (w.length < 2) return null;
    const a = w[0].avg_wage_unskilled!, b = w[w.length - 1].avg_wage_unskilled!;
    if (!a) return null;
    return { pct: ((b - a) / a) * 100, from: w[0].period, to: w[w.length - 1].period };
  }, [rows]);

  const saved = rows.filter(r => r.id);
  const cell = 'w-full text-[12px] px-1.5 py-1 rounded border border-transparent hover:border-[#E8E7E2] focus:border-blue-500 outline-none bg-transparent';

  return (
    <div className="bg-white border border-[#E8E7E2] rounded-[10px] overflow-hidden">
      <div className="px-4 py-2.5 border-b border-[#E8E7E2] flex items-center gap-2 flex-wrap">
        <LineChart size={13} className="text-teal-600" />
        <div className="text-[12.5px] font-semibold text-[#111]">Chỉ số ngành theo quý</div>
        {delta && (
          <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${delta.pct >= 0 ? 'text-red-600' : 'text-emerald-700'}`}>
            {delta.pct >= 0 ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
            Lương {delta.from}→{delta.to}: {delta.pct >= 0 ? '+' : ''}{delta.pct.toFixed(1)}%
          </span>
        )}
        <div className="ml-auto flex gap-1.5">
          <button onClick={addRow} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11.5px] font-medium border border-[#E8E7E2] hover:bg-[#F9F9F7]"><Plus size={12} /> Thêm kỳ</button>
          <button onClick={handleSave} disabled={saving} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11.5px] font-medium bg-[#1D4ED8] text-white hover:bg-[#1E40AF] disabled:opacity-60"><Save size={12} /> {saving ? 'Đang lưu…' : 'Lưu'}</button>
        </div>
      </div>

      {saved.length >= 2 && (
        <div className="px-4 pt-3">
          <div style={{ height: 160 }}>
            <Line
              data={{
                labels: saved.map(r => r.period ?? ''),
                datasets: [
                  { label: 'Lương phổ thông (tr)', data: saved.map(r => r.avg_wage_unskilled != null ? r.avg_wage_unskilled / 1e6 : null), borderColor: '#1D4ED8', backgroundColor: '#1D4ED8', tension: 0.3, yAxisID: 'y' },
                  { label: 'Lương tay nghề (tr)', data: saved.map(r => r.avg_wage_skilled != null ? r.avg_wage_skilled / 1e6 : null), borderColor: '#059669', backgroundColor: '#059669', tension: 0.3, yAxisID: 'y' },
                  { label: 'Phí dịch vụ (k)', data: saved.map(r => r.service_fee_max != null ? r.service_fee_max / 1000 : null), borderColor: '#D97706', backgroundColor: '#D97706', borderDash: [4, 3], tension: 0.3, yAxisID: 'y1' },
                ],
              }}
              options={{
                responsive: true, maintainAspectRatio: false, spanGaps: true,
                plugins: { legend: { position: 'top', labels: { font: { size: 10 }, boxWidth: 10, boxHeight: 10 } } },
                scales: {
                  x: { ticks: { font: { size: 10 } }, grid: { display: false } },
                  y: { position: 'left', ticks: { font: { size: 9.5 } }, grid: { color: '#F0EEE9' } },
                  y1: { position: 'right', ticks: { font: { size: 9.5 } }, grid: { display: false } },
                },
              }}
            />
          </div>
        </div>
      )}

      <table className="w-full text-[12px] mt-2">
        <thead>
          <tr className="text-[10.5px] text-[#888] bg-[#FBFBF9]">
            <th className="text-left font-medium px-3 py-1.5 w-[11%]">Kỳ</th>
            <th className="text-left font-medium px-1 py-1.5 w-[12%]">Lương PT</th>
            <th className="text-left font-medium px-1 py-1.5 w-[12%]">Lương tay nghề</th>
            <th className="text-left font-medium px-1 py-1.5 w-[10%]">Phí từ</th>
            <th className="text-left font-medium px-1 py-1.5 w-[10%]">Phí đến</th>
            <th className="text-left font-medium px-1 py-1.5 w-[8%]">Nghỉ %</th>
            <th className="text-left font-medium px-1 py-1.5 w-[8%]">OT h</th>
            <th className="text-left font-medium px-1 py-1.5 w-[9%]">Cầu LĐ</th>
            <th className="text-left font-medium px-1 py-1.5">Ghi chú</th>
            <th className="w-8" />
          </tr>
        </thead>
        <tbody className="divide-y divide-[#F0EEE9]">
          {rows.map(r => (
            <tr key={r._key} className="hover:bg-[#FBFBF9]">
              <td className="px-3 py-1"><input value={r.period ?? ''} onChange={e => set(r._key, { period: e.target.value })} placeholder="2026-Q3" className={cell + ' font-medium'} /></td>
              <td className="px-1 py-1"><input value={r.avg_wage_unskilled ?? ''} onChange={e => set(r._key, { avg_wage_unskilled: num(e.target.value) })} placeholder="6500000" className={cell} /></td>
              <td className="px-1 py-1"><input value={r.avg_wage_skilled ?? ''} onChange={e => set(r._key, { avg_wage_skilled: num(e.target.value) })} placeholder="8500000" className={cell} /></td>
              <td className="px-1 py-1"><input value={r.service_fee_min ?? ''} onChange={e => set(r._key, { service_fee_min: num(e.target.value) })} placeholder="350000" className={cell} /></td>
              <td className="px-1 py-1"><input value={r.service_fee_max ?? ''} onChange={e => set(r._key, { service_fee_max: num(e.target.value) })} placeholder="500000" className={cell} /></td>
              <td className="px-1 py-1"><input value={r.turnover_rate ?? ''} onChange={e => set(r._key, { turnover_rate: num(e.target.value) })} placeholder="12" className={cell} /></td>
              <td className="px-1 py-1"><input value={r.ot_hours ?? ''} onChange={e => set(r._key, { ot_hours: num(e.target.value) })} placeholder="40" className={cell} /></td>
              <td className="px-1 py-1"><input value={r.demand_headcount ?? ''} onChange={e => set(r._key, { demand_headcount: num(e.target.value) })} placeholder="3500" className={cell} /></td>
              <td className="px-1 py-1"><input value={r.note ?? ''} onChange={e => set(r._key, { note: e.target.value })} placeholder="Vì sao biến động…" className={cell} /></td>
              <td className="px-1"><button onClick={() => setConfirmDel(r)} className="p-1 rounded hover:bg-red-50 text-[#ccc] hover:text-red-600"><Trash2 size={12} /></button></td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={10} className="text-center py-6 text-[12px] text-[#aaa]">Chưa có kỳ nào. Bấm "Thêm kỳ" — nhập mỗi quý một dòng để thấy xu hướng lương và phí.</td></tr>
          )}
        </tbody>
      </table>

      {confirmDel && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-[12px] w-full max-w-sm p-5 shadow-xl">
            <div className="text-[14px] font-semibold text-[#111] mb-1.5">Xoá kỳ này?</div>
            <div className="text-[12px] text-[#666] leading-relaxed">Số liệu kỳ <b>{confirmDel.period}</b> sẽ bị xoá vĩnh viễn — mất luôn điểm dữ liệu trên biểu đồ xu hướng.</div>
            <div className="flex gap-2 mt-4">
              <button onClick={() => setConfirmDel(null)} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-[12px] font-medium text-gray-600">Hủy</button>
              <button onClick={handleDelete} className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg text-[12px] font-medium hover:bg-red-700">Xoá</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
