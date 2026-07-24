import { useState } from 'react';
import { Plus, X, Pencil, Trash2, Scale } from 'lucide-react';
import type { MarketLeadSupplier, Competitor } from '../../lib/types';
import SearchSelect from './SearchSelect';
import WageDetailTable from './WageDetailTable';
import { wageDetailToStrings, wageDetailToNumbers } from './wageFields';

interface SupForm { name: string; qty: string; wage_min: string; wage_max: string; wage_detail: Record<string, string> }
const emptySupForm: SupForm = { name: '', qty: '0', wage_min: '', wage_max: '', wage_detail: {} };

const wageFmt = (min: number | null | undefined, max: number | null | undefined) =>
  min != null && max != null ? `${(min / 1_000_000).toFixed(1)}–${(max / 1_000_000).toFixed(1)}tr` : null;

const tr = (v: number | null | undefined) => v != null ? (v / 1_000_000).toFixed(2).replace(/\.?0+$/, '') : '—';
const detailTotal = (s: MarketLeadSupplier) => Object.values(s.wage_detail ?? {}).reduce((a, b) => a + (b || 0), 0);

/** Bảng so sánh lương giữa các NCC (kể cả Let's Go VN) tại cùng 1 công ty/dự án — chọn NCC
 * muốn so, LGVN luôn ghim cột đầu để dễ đối chiếu, có dòng "So với LGVN" tính chênh lệch. */
function WageCompareTable({ suppliers, selected }: { suppliers: MarketLeadSupplier[]; selected: MarketLeadSupplier[] }) {
  const lgvn = suppliers.find(s => s.is_us);
  const cols = [...selected].sort((a, b) => (b.is_us ? 1 : 0) - (a.is_us ? 1 : 0));
  const fieldNames = [...new Set(cols.flatMap(s => Object.keys(s.wage_detail ?? {})))];
  const lgvnTotal = lgvn ? detailTotal(lgvn) : 0;

  if (cols.length === 0) return <div className="text-[11px] text-[#aaa] px-1 py-2">Chọn ít nhất 1 NCC để so sánh.</div>;

  return (
    <div className="overflow-x-auto">
      <table className="text-[11.5px] border-collapse">
        <thead>
          <tr>
            <th className="text-left px-2 py-1 text-[#888] font-medium sticky left-0 bg-white">Khoản</th>
            {cols.map((s, i) => (
              <th key={i} className={`text-right px-2 py-1 font-medium whitespace-nowrap ${s.is_us ? 'text-blue-700' : 'text-[#333]'}`}>
                {s.is_us ? '● ' : ''}{s.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr className="border-t border-[#F0EEE9]">
            <td className="px-2 py-1 text-[#666] sticky left-0 bg-white">Lương (khoảng)</td>
            {cols.map((s, i) => <td key={i} className="text-right px-2 py-1 text-[#333]">{wageFmt(s.wage_min, s.wage_max) ?? '—'}</td>)}
          </tr>
          {fieldNames.map(f => (
            <tr key={f} className="border-t border-[#F0EEE9]">
              <td className="px-2 py-1 text-[#666] sticky left-0 bg-white truncate max-w-[140px]">{f}</td>
              {cols.map((s, i) => <td key={i} className="text-right px-2 py-1 text-[#333]">{tr(s.wage_detail?.[f])}</td>)}
            </tr>
          ))}
          <tr className="border-t border-[#E8E7E2] font-medium">
            <td className="px-2 py-1 text-[#333] sticky left-0 bg-white">Tổng chi tiết lương</td>
            {cols.map((s, i) => <td key={i} className="text-right px-2 py-1 text-[#111]">{tr(detailTotal(s))}tr</td>)}
          </tr>
          {lgvn && (
            <tr className="border-t border-[#F0EEE9]">
              <td className="px-2 py-1 text-[#888] sticky left-0 bg-white">So với LGVN</td>
              {cols.map((s, i) => {
                if (s.is_us) return <td key={i} className="text-right px-2 py-1 text-[#ccc]">—</td>;
                const diff = detailTotal(s) - lgvnTotal;
                const cls = diff > 0 ? 'text-emerald-600' : diff < 0 ? 'text-red-600' : 'text-[#999]';
                return <td key={i} className={`text-right px-2 py-1 font-medium ${cls}`}>{diff > 0 ? '+' : ''}{tr(diff)}tr</td>;
              })}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/** Form nhập tên/SL/lương NCC (kèm bảng chi tiết lương dùng chung) — dùng chung cho cả thêm mới và sửa. */
function SupplierInlineForm({ form, setForm, competitorNames, onSubmit, onCancel, saving, allowNameEdit = true, wageFields, onAddWageField, onDeleteWageField }: {
  form: SupForm;
  setForm: (f: SupForm) => void;
  competitorNames: string[];
  onSubmit: () => void;
  onCancel: () => void;
  saving?: boolean;
  allowNameEdit?: boolean;
  wageFields: string[];
  onAddWageField: (name: string) => Promise<void> | void;
  onDeleteWageField: (name: string) => Promise<void> | void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2 items-center">
        {!allowNameEdit ? (
          <span className="text-[12px] font-medium min-w-[160px] flex-1 px-2 py-1">{form.name}</span>
        ) : competitorNames.length > 0 ? (
          <SearchSelect
            value={form.name}
            onChange={v => setForm({ ...form, name: v })}
            options={competitorNames.map(n => ({ value: n, label: n }))}
            placeholder="Chọn NCC (Đối thủ)…"
            allowAdd
            className="flex-1 min-w-[160px]"
          />
        ) : (
          <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Tên NCC" className="text-[12px] px-2 py-1 rounded border border-gray-300 outline-none flex-1 min-w-[160px]" />
        )}
        <input type="number" value={form.qty} onChange={e => setForm({ ...form, qty: e.target.value })} placeholder="Số LĐ" className="text-[12px] px-2 py-1 rounded border border-gray-300 outline-none w-16" />
        <input type="number" step="0.1" value={form.wage_min} onChange={e => setForm({ ...form, wage_min: e.target.value })} placeholder="Lương từ (tr)" className="text-[12px] px-2 py-1 rounded border border-gray-300 outline-none w-24" />
        <input type="number" step="0.1" value={form.wage_max} onChange={e => setForm({ ...form, wage_max: e.target.value })} placeholder="đến (tr)" className="text-[12px] px-2 py-1 rounded border border-gray-300 outline-none w-20" />
        <button onClick={onSubmit} disabled={saving} className="px-2.5 py-1 rounded bg-[#1D4ED8] text-white text-[12px]">Lưu</button>
        <button onClick={onCancel} className="px-2 py-1 rounded border border-gray-300 text-[12px]"><X size={12} /></button>
      </div>
      <WageDetailTable
        fields={wageFields}
        value={form.wage_detail}
        onChange={v => setForm({ ...form, wage_detail: v })}
        onAddField={onAddWageField}
        onDeleteField={onDeleteWageField}
      />
    </div>
  );
}

/** Thẻ "Nhu cầu / Đã fill / Còn thiếu" + bảng NCC (thêm/sửa/xoá, kèm mức lương + chi tiết
 * lương riêng từng NCC tại dự án này) — bảng chung cho cả Let's Go VN lẫn đối thủ, dùng
 * chung cho Khách hàng đang hợp tác và Công ty/Dự án đang tìm hiểu. */
export default function SupplierFillCard({
  workersNeeded, suppliers, onAddSupplier, onEditSupplier, onDeleteSupplier, saving, competitors,
  wageFields, onAddWageField, onDeleteWageField,
}: {
  workersNeeded: number;
  suppliers: MarketLeadSupplier[];
  onAddSupplier: (name: string, qty: number, wageMin: number | null, wageMax: number | null, wageDetail: Record<string, number>) => Promise<void> | void;
  onEditSupplier?: (index: number, name: string, qty: number, wageMin: number | null, wageMax: number | null, wageDetail: Record<string, number>) => Promise<void> | void;
  onDeleteSupplier?: (index: number) => Promise<void> | void;
  saving?: boolean;
  /** Hồ sơ Đối thủ đã tạo sẵn (menu Đối thủ) — chọn thay vì gõ tay, tự gợi ý mức lương chung của NCC đó. */
  competitors?: Competitor[];
  /** Danh sách trường lương chi tiết dùng chung toàn hệ thống (bảng wage_detail_fields). */
  wageFields: string[];
  onAddWageField: (name: string) => Promise<void> | void;
  onDeleteWageField: (name: string) => Promise<void> | void;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState<SupForm>(emptySupForm);
  const [editIndex, setEditIndex] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<SupForm>(emptySupForm);
  const [showCompare, setShowCompare] = useState(false);
  const [excludedFromCompare, setExcludedFromCompare] = useState<Set<number>>(new Set());
  const toggleCompare = (i: number) => setExcludedFromCompare(prev => {
    const next = new Set(prev);
    if (next.has(i)) next.delete(i); else next.add(i);
    return next;
  });

  const total = suppliers.reduce((s, x) => s + x.qty, 0);
  const remaining = Math.max(workersNeeded - total, 0);
  const pct = workersNeeded > 0 ? Math.round((total / workersNeeded) * 100) : 0;
  const competitorNames = [...new Set((competitors ?? []).map(c => c.company_name).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'vi'));

  // Khi chọn NCC trong form THÊM MỚI, gợi ý sẵn lương chung từ hồ sơ Đối thủ (nếu chưa gõ lương).
  const setAddFormWithSuggest = (f: SupForm) => {
    if (f.name === addForm.name || addForm.wage_min || addForm.wage_max) { setAddForm(f); return; }
    const match = competitors?.find(c => c.company_name === f.name && c.wage_paid != null);
    const suggested = match ? (match.wage_paid! / 1_000_000).toFixed(1) : '';
    setAddForm(suggested ? { ...f, wage_min: suggested, wage_max: suggested } : f);
  };

  const toNum = (v: string) => v.trim() ? parseFloat(v) * 1_000_000 : null;

  const submitAdd = async () => {
    if (!addForm.name.trim()) return;
    await onAddSupplier(addForm.name.trim(), parseInt(addForm.qty) || 0, toNum(addForm.wage_min), toNum(addForm.wage_max), wageDetailToNumbers(addForm.wage_detail));
    setShowAdd(false);
    setAddForm(emptySupForm);
  };

  const startEdit = (i: number, s: MarketLeadSupplier) => {
    setShowAdd(false);
    setEditIndex(i);
    setEditForm({
      name: s.name, qty: String(s.qty),
      wage_min: s.wage_min != null ? String(s.wage_min / 1_000_000) : '',
      wage_max: s.wage_max != null ? String(s.wage_max / 1_000_000) : '',
      wage_detail: wageDetailToStrings(s.wage_detail),
    });
  };

  const submitEdit = async () => {
    if (editIndex == null || !editForm.name.trim()) return;
    await onEditSupplier?.(editIndex, editForm.name.trim(), parseInt(editForm.qty) || 0, toNum(editForm.wage_min), toNum(editForm.wage_max), wageDetailToNumbers(editForm.wage_detail));
    setEditIndex(null);
  };

  const handleDelete = async (i: number, name: string) => {
    if (!confirm(`Xoá NCC "${name}" khỏi danh sách?`)) return;
    await onDeleteSupplier?.(i);
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
        {suppliers.length > 1 && (
          <button
            onClick={() => setShowCompare(v => !v)}
            className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium border transition shrink-0 ${showCompare ? 'bg-blue-50 border-blue-200 text-blue-700' : 'border-gray-300 text-[#666] hover:bg-[#F9F9F7]'}`}
          >
            <Scale size={12} /> So sánh lương
          </button>
        )}
      </div>
      {showCompare && suppliers.length > 1 && (
        <div className="mb-3 border border-[#E8E7E2] rounded-lg overflow-hidden">
          <div className="px-2.5 py-1.5 bg-[#F9F9F7] border-b border-[#E8E7E2] flex items-center gap-2 flex-wrap">
            <span className="text-[10.5px] text-[#888] shrink-0">So sánh NCC (đối thủ) với nhau hoặc với LGVN:</span>
            {suppliers.map((s, i) => (
              <label key={i} className="flex items-center gap-1 text-[11px] text-[#555] cursor-pointer">
                <input type="checkbox" checked={!excludedFromCompare.has(i)} onChange={() => toggleCompare(i)} />
                {s.is_us ? '● LGVN' : s.name}
              </label>
            ))}
          </div>
          <WageCompareTable suppliers={suppliers} selected={suppliers.filter((_, i) => !excludedFromCompare.has(i))} />
        </div>
      )}
      <div className="space-y-1.5">
        {suppliers.map((s, i) => {
          if (editIndex === i) {
            return (
              <div key={i} className="py-1 px-1.5 -mx-1.5 bg-blue-50/40 rounded">
                <SupplierInlineForm
                  form={editForm} setForm={setEditForm} competitorNames={competitorNames}
                  onSubmit={submitEdit} onCancel={() => setEditIndex(null)} saving={saving}
                  allowNameEdit={!s.is_us}
                  wageFields={wageFields} onAddWageField={onAddWageField} onDeleteWageField={onDeleteWageField}
                />
              </div>
            );
          }
          const p = workersNeeded > 0 ? Math.round((s.qty / workersNeeded) * 100) : 0;
          const wage = wageFmt(s.wage_min, s.wage_max);
          const detailCount = Object.keys(s.wage_detail ?? {}).length;
          return (
            <div key={i} className="flex items-center gap-2 group">
              <span className={`text-[12px] min-w-[110px] shrink-0 ${s.is_us ? 'text-blue-700 font-medium' : ''}`}>{s.is_us ? '● ' : ''}{s.name}</span>
              <div className="flex-1 h-[11px] bg-[#F0EEE9] rounded overflow-hidden"><div className={`h-[11px] rounded ${s.is_us ? 'bg-blue-600' : 'bg-[#B8D4F0]'}`} style={{ width: `${Math.min(p, 100)}%` }} /></div>
              <span className={`text-[12px] font-medium min-w-[52px] text-right ${s.is_us ? 'text-blue-700' : ''}`}>{s.qty} LĐ</span>
              <span className="text-[11px] text-[#aaa] min-w-[28px] text-right">{p}%</span>
              {wage && <span className="text-[10.5px] font-medium px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 shrink-0">{wage}</span>}
              {detailCount > 0 && <span className="text-[10.5px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 shrink-0">{detailCount} chi tiết</span>}
              {(onEditSupplier || onDeleteSupplier) && (
                <span className="flex items-center gap-1 shrink-0 opacity-40 group-hover:opacity-100 transition">
                  {onEditSupplier && (
                    <button onClick={() => startEdit(i, s)} className="text-[#999] hover:text-blue-600" title="Sửa"><Pencil size={11} /></button>
                  )}
                  {onDeleteSupplier && (
                    <button onClick={() => handleDelete(i, s.name)} className="text-[#999] hover:text-red-600" title="Xoá"><Trash2 size={11} /></button>
                  )}
                </span>
              )}
            </div>
          );
        })}
      </div>
      {showAdd ? (
        <div className="mt-2">
          <SupplierInlineForm
            form={addForm} setForm={setAddFormWithSuggest} competitorNames={competitorNames}
            onSubmit={submitAdd} onCancel={() => setShowAdd(false)} saving={saving}
            wageFields={wageFields} onAddWageField={onAddWageField} onDeleteWageField={onDeleteWageField}
          />
        </div>
      ) : (
        <button onClick={() => { setEditIndex(null); setShowAdd(true); setAddForm(emptySupForm); }} className="mt-2 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11.5px] border border-dashed border-gray-300 text-[#aaa] hover:border-blue-300 hover:text-blue-500"><Plus size={11} /> Thêm NCC</button>
      )}
    </div>
  );
}
