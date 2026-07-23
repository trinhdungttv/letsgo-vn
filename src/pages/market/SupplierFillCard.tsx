import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import type { MarketLeadSupplier } from '../../lib/types';
import SearchSelect from './SearchSelect';

const emptySupForm = { name: '', qty: '0' };

/** Thẻ "Nhu cầu / Đã fill / Còn thiếu" + danh sách NCC — dùng chung cho Khách hàng
 * đang hợp tác và Công ty/Dự án đang tìm hiểu. */
export default function SupplierFillCard({ workersNeeded, suppliers, onAddSupplier, saving, competitorNames }: {
  workersNeeded: number;
  suppliers: MarketLeadSupplier[];
  onAddSupplier: (name: string, qty: number) => Promise<void> | void;
  saving?: boolean;
  /** Tên các Đối thủ đã tạo sẵn (menu Đối thủ) — để chọn thay vì gõ tay tên NCC trùng lặp. */
  competitorNames?: string[];
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(emptySupForm);

  const total = suppliers.reduce((s, x) => s + x.qty, 0);
  const remaining = Math.max(workersNeeded - total, 0);
  const pct = workersNeeded > 0 ? Math.round((total / workersNeeded) * 100) : 0;

  const submit = async () => {
    if (!form.name.trim()) return;
    await onAddSupplier(form.name.trim(), parseInt(form.qty) || 0);
    setShowAdd(false);
    setForm(emptySupForm);
  };

  return (
    <div>
      <div className="flex gap-2 flex-wrap items-center mb-3">
        <div className="bg-[#F9F9F7] rounded-lg px-3 py-1.5 text-center"><div className="text-[10px] text-[#aaa]">Nhu cầu</div><div className="text-[14px] font-medium">{workersNeeded}</div></div>
        <div className="bg-[#F9F9F7] rounded-lg px-3 py-1.5 text-center"><div className="text-[10px] text-[#aaa]">Đã fill</div><div className="text-[14px] font-medium text-emerald-600">{total}</div></div>
        <div className={`rounded-lg px-3 py-1.5 text-center ${remaining > 0 ? 'bg-amber-50' : 'bg-emerald-50'}`}><div className={`text-[10px] ${remaining > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>Còn thiếu</div><div className={`text-[14px] font-medium ${remaining > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>{remaining}</div></div>
        <div className="flex-1 min-w-[120px]">
          <div className="text-[10px] text-[#aaa] mb-1">{pct}% fill</div>
          <div className="h-1.5 bg-[#F0EEE9] rounded-full overflow-hidden"><div className="h-1.5 bg-emerald-500 rounded-full" style={{ width: `${Math.min(pct, 100)}%` }} /></div>
        </div>
      </div>
      <div className="space-y-1.5">
        {suppliers.map((s, i) => {
          const p = workersNeeded > 0 ? Math.round((s.qty / workersNeeded) * 100) : 0;
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
      {showAdd ? (
        <div className="flex gap-2 mt-2 items-center">
          {competitorNames && competitorNames.length > 0 ? (
            <SearchSelect
              value={form.name}
              onChange={v => setForm(f => ({ ...f, name: v }))}
              options={competitorNames.map(n => ({ value: n, label: n }))}
              placeholder="Chọn NCC (Đối thủ)…"
              allowAdd
              className="flex-1"
            />
          ) : (
            <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Tên NCC" className="text-[12px] px-2 py-1 rounded border border-gray-300 outline-none flex-1" />
          )}
          <input type="number" value={form.qty} onChange={e => setForm(f => ({ ...f, qty: e.target.value }))} placeholder="Số LĐ" className="text-[12px] px-2 py-1 rounded border border-gray-300 outline-none w-20" />
          <button onClick={submit} disabled={saving} className="px-2.5 py-1 rounded bg-[#1D4ED8] text-white text-[12px]">Lưu</button>
          <button onClick={() => setShowAdd(false)} className="px-2 py-1 rounded border border-gray-300 text-[12px]"><X size={12} /></button>
        </div>
      ) : (
        <button onClick={() => { setShowAdd(true); setForm(emptySupForm); }} className="mt-2 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11.5px] border border-dashed border-gray-300 text-[#aaa] hover:border-blue-300 hover:text-blue-500"><Plus size={11} /> Thêm NCC</button>
      )}
    </div>
  );
}
