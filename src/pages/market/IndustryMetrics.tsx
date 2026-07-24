import { useEffect, useMemo, useRef, useState } from 'react';
import { Line } from 'react-chartjs-2';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend } from 'chart.js';
import { LineChart, Plus, Trash2, Loader2, Check, TrendingUp, TrendingDown } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type { IndustryMetric } from '../../lib/types';
import { useBeforeUnloadWarning } from '../../hooks/useBeforeUnloadWarning';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend);

interface Props { industryId: string; toast: (m: string) => void; }
type Row = Partial<IndustryMetric> & { _key: string; _wageUnskilledText?: string; _wageSkilledText?: string };

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
  const [confirmDel, setConfirmDel] = useState<Row | null>(null);
  // Chốt lại nội dung ngay sau khi tải/lưu — dùng để so sánh phát hiện thay đổi cần tự lưu.
  const [savedRows, setSavedRows] = useState<Row[]>([]);
  const canonical = (rs: Row[]) => JSON.stringify(rs.map(r => ({
    key: r._key, period: r.period ?? '',
    avg_wage_unskilled: r._wageUnskilledText ?? '', avg_wage_skilled: r._wageSkilledText ?? '',
    service_fee_min: r.service_fee_min ?? null, service_fee_max: r.service_fee_max ?? null,
    turnover_rate: r.turnover_rate ?? null, ot_hours: r.ot_hours ?? null,
    demand_headcount: r.demand_headcount ?? null, note: r.note ?? '',
  })));

  // Tự động lưu — gõ/click xong 700ms không thao tác gì thêm là tự ghi DB, không cần bấm
  // nút "Lưu" nữa (trước đây nút Lưu riêng của bảng này rất dễ bị quên, gây mất dữ liệu khi F5).
  const [saveStatus, setSaveStatus] = useState<'idle' | 'pending' | 'saving' | 'saved'>('idle');
  useBeforeUnloadWarning(saveStatus === 'pending' || saveStatus === 'saving');
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const skipAutosaveRef = useRef(true);

  // Lương vẫn lưu VNĐ trong DB — chỉ đổi đơn vị hiển thị/nhập sang triệu (tr) cho dễ đọc,
  // giống mọi ô nhập lương khác trong hệ thống (vd 6500000 ↔ hiển thị "6.5").
  const trVal = (v: number | null | undefined) => v != null ? String(v / 1_000_000) : '';
  const numTr = (v: string) => v.trim() === '' ? null : Math.round(Number(v) * 1_000_000);
  // Giữ nguyên chuỗi đang gõ (kể cả dấu "." ở cuối) — nếu quy đổi qua số rồi hiển thị lại
  // ngay lập tức thì gõ "6." sẽ bị ép về "6" và không bao giờ gõ tiếp được "6.5".
  const sanitizeDecimal = (v: string) => {
    let s = v.replace(/[^\d.]/g, '');
    const dot = s.indexOf('.');
    if (dot !== -1) s = s.slice(0, dot + 1) + s.slice(dot + 1).replace(/\./g, '');
    return s;
  };
  const num = (v: string) => v.trim() === '' ? null : Number(v.replace(/[^\d.]/g, ''));

  const reload = async () => {
    skipAutosaveRef.current = true;
    const { data } = await supabase.from('industry_metrics').select('*').eq('industry_id', industryId).order('period');
    const loaded = ((data ?? []) as IndustryMetric[]).map(m => (
      { ...m, _key: m.id, _wageUnskilledText: trVal(m.avg_wage_unskilled), _wageSkilledText: trVal(m.avg_wage_skilled) }
    ));
    setRows(loaded);
    setSavedRows(loaded);
    setSaveStatus('idle');
    setTimeout(() => { skipAutosaveRef.current = false; }, 0);
  };
  useEffect(() => { reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [industryId]);

  const set = (key: string, patch: Partial<Row>) => setRows(prev => prev.map(r => r._key === key ? { ...r, ...patch } : r));

  const addRow = () => {
    const last = rows[rows.length - 1]?.period;
    setRows(prev => [...prev, { _key: 'new-' + Date.now(), period: last ? nextQuarter(last) : currentQuarter(), _wageUnskilledText: '', _wageSkilledText: '' }]);
  };

  const persistRows = async () => {
    const base = rowsRef.current.map(r => ({ ...r }));
    const valid = base.filter(r => (r.period ?? '').trim());
    if (valid.length === 0) { setSaveStatus('idle'); return; }
    setSaveStatus('saving');
    for (const r of valid) {
      const payload = {
        industry_id: industryId, period: (r.period ?? '').trim(),
        avg_wage_unskilled: numTr(r._wageUnskilledText ?? ''), avg_wage_skilled: numTr(r._wageSkilledText ?? ''),
        service_fee_min: r.service_fee_min ?? null, service_fee_max: r.service_fee_max ?? null,
        turnover_rate: r.turnover_rate ?? null, ot_hours: r.ot_hours ?? null,
        demand_headcount: r.demand_headcount ?? null, note: (r.note ?? '').trim() || null,
      };
      r.avg_wage_unskilled = payload.avg_wage_unskilled;
      r.avg_wage_skilled = payload.avg_wage_skilled;
      if (r.id) {
        const { error } = await supabase.from('industry_metrics').update(payload).eq('id', r.id);
        if (error) { setSaveStatus('idle'); toast('Lỗi: ' + error.message); return; }
      } else {
        const { data, error } = await supabase.from('industry_metrics').insert(payload).select().single();
        if (error) { setSaveStatus('idle'); toast('Lỗi: ' + error.message); return; }
        r.id = data.id;
        setRows(prev => prev.map(row => row._key === r._key ? { ...row, id: data.id, avg_wage_unskilled: r.avg_wage_unskilled, avg_wage_skilled: r.avg_wage_skilled } : row));
      }
    }
    setSavedRows(base);
    setSaveStatus('saved');
  };

  // Gõ/click xong 700ms không đổi gì thêm là tự lưu.
  useEffect(() => {
    if (skipAutosaveRef.current) return;
    if (canonical(rows) === canonical(savedRows)) return;
    setSaveStatus('pending');
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => { saveTimerRef.current = null; persistRows(); }, 700);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, savedRows]);

  const handleDelete = async () => {
    if (!confirmDel) return;
    if (confirmDel.id) {
      const { error } = await supabase.from('industry_metrics').delete().eq('id', confirmDel.id);
      if (error) { toast('Lỗi: ' + error.message); return; }
    }
    setRows(prev => prev.filter(r => r._key !== confirmDel._key));
    setSavedRows(prev => prev.filter(r => r._key !== confirmDel._key));
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
        <div className="ml-auto flex items-center gap-2">
          <div className="flex items-center gap-1 text-[11px] text-[#999]">
            {(saveStatus === 'pending' || saveStatus === 'saving') && <><Loader2 size={12} className="animate-spin" /> Đang lưu…</>}
            {saveStatus === 'saved' && <><Check size={12} className="text-emerald-600" /> Đã lưu</>}
          </div>
          <button onClick={addRow} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11.5px] font-medium border border-[#E8E7E2] hover:bg-[#F9F9F7]"><Plus size={12} /> Thêm kỳ</button>
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
            <th className="text-left font-medium px-1 py-1.5 w-[12%]">Lương PT (tr)</th>
            <th className="text-left font-medium px-1 py-1.5 w-[12%]">Lương tay nghề (tr)</th>
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
              <td className="px-1 py-1"><input value={r._wageUnskilledText ?? ''} onChange={e => set(r._key, { _wageUnskilledText: sanitizeDecimal(e.target.value) })} placeholder="6.5" className={cell} /></td>
              <td className="px-1 py-1"><input value={r._wageSkilledText ?? ''} onChange={e => set(r._key, { _wageSkilledText: sanitizeDecimal(e.target.value) })} placeholder="8.5" className={cell} /></td>
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
