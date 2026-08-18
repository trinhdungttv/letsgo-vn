import { useState } from 'react';
import { ChevronDown, ChevronRight, Plus, X, Pencil, GripVertical, Check, Clock } from 'lucide-react';
import ShiftPicker from './ShiftPicker';
import type { PayrollInputType } from '../../lib/payroll/coefficients';
import { wageDetailAgeLabel } from './wageFields';

/** Hiển thị số có dấu phẩy ngăn cách nghìn khi gõ (5130000 → 5,130,000); giá trị lưu vẫn
 *  là chuỗi số thuần (không dấu phẩy) để wageDetailToNumbers() parseFloat được bình thường. */
const formatVnd = (raw: string) => {
  const digits = raw.replace(/[^\d]/g, '');
  return digits ? Number(digits).toLocaleString('en-US') : '';
};
const stripVnd = (formatted: string) => formatted.replace(/[^\d]/g, '');

/** Bảng chi tiết lương theo từng trường DÙNG CHUNG toàn hệ thống (Lương cơ bản, Phụ cấp…).
 * `fields` là danh sách trường global (bảng wage_detail_fields) — thêm/xoá 1 trường ở đây
 * ảnh hưởng đến MỌI nơi dùng bảng này (Let's Go VN lẫn từng NCC, ở mọi công ty/dự án).
 * `value`/`onChange` chỉ là giá trị RIÊNG của đối tượng đang sửa.
 * ĐƠN VỊ: ĐỒNG (từ migration 126) — khớp với "Tính bảng lương", xem wageFields.ts. */
export default function WageDetailTable({ fields, value, onChange, onAddField, onDeleteField, onRenameField, onReorderFields, defaultOpen = false, label = 'Chi tiết lương', fieldTypes, updatedAt }: {
  fields: string[];
  value: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
  onAddField: (name: string) => Promise<void> | void;
  onDeleteField: (name: string) => Promise<void> | void;
  /** Đổi tên trường — áp dụng toàn hệ thống, kéo theo cả số liệu đã nhập. */
  onRenameField?: (oldName: string, newName: string) => Promise<void> | void;
  /** Sắp xếp lại thứ tự trường — áp dụng toàn hệ thống. */
  onReorderFields?: (names: string[]) => Promise<void> | void;
  defaultOpen?: boolean;
  /** Tiêu đề hiển thị — dùng khi có nhiều bảng chi tiết lương trên cùng 1 form (vd 2 phía LGVN/Công ty). */
  label?: string;
  /** Loại đơn giá theo luật của từng trường (migration 126) — CHỈ truyền cho bảng phía "trả người
   *  lao động" (wage_detail), có gán mới hiện được "Tính theo ca làm việc". Không truyền cho phía
   *  "khách trả" (wage_detail_client) vì đó là giá thương lượng, không suy từ luật được. */
  fieldTypes?: Record<string, PayrollInputType | null>;
  /** Mốc lần cuối wage_detail/wage_detail_client THAY ĐỔI thật sự (migration 140) — hiện ngay
   *  trên tiêu đề để lâu lâu mới vào xem lại vẫn biết ngay số liệu còn mới hay đã cũ. */
  updatedAt?: string | null;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [newField, setNewField] = useState('');
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  const startRename = (name: string) => { setRenaming(name); setRenameDraft(name); };

  const submitRename = async () => {
    const from = renaming;
    const to = renameDraft.trim();
    if (!from) return;
    if (!to || to === from) { setRenaming(null); return; }
    if (!confirm(
      `Đổi tên trường "${from}" thành "${to}"?\n\n`
      + `Áp dụng cho MỌI công ty/dự án/NCC và mọi báo giá đã lưu. Số liệu đã nhập được chuyển `
      + `sang tên mới, không mất.`,
    )) return;
    setBusy(true);
    await onRenameField?.(from, to);
    setBusy(false);
    setRenaming(null);
  };

  // Kéo-thả tự do bằng chuột: cầm handle ở đầu dòng, thả vào vị trí bất kỳ.
  const reorderTo = async (from: number, to: number) => {
    if (from === to) return;
    const next = [...fields];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setBusy(true);
    await onReorderFields?.(next);
    setBusy(false);
  };

  const filled = Object.values(value).filter(v => v.trim()).length;

  const setField = (name: string, v: string) => onChange({ ...value, [name]: v });

  const submitNewField = async () => {
    const name = newField.trim();
    if (!name || fields.includes(name)) return;
    setBusy(true);
    await onAddField(name);
    setNewField('');
    setBusy(false);
  };

  const removeField = async (name: string) => {
    if (!confirm(`Xoá trường "${name}" khỏi hệ thống? Áp dụng cho MỌI công ty/NCC, không chỉ mục này.`)) return;
    setBusy(true);
    await onDeleteField(name);
    const { [name]: _omit, ...rest } = value;
    void _omit;
    onChange(rest);
    setBusy(false);
  };

  return (
    <div className="border border-[#E8E7E2] rounded-lg overflow-hidden">
      <button type="button" onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-[11.5px] font-medium text-[#666] bg-[#F9F9F7] hover:bg-[#F3F2EE]">
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {label}{filled > 0 ? ` (${filled} mục)` : ''}
        {filled > 0 && (
          <span className="ml-auto flex items-center gap-1 text-[10px] font-normal text-[#aaa] shrink-0">
            <Clock size={10} />
            {wageDetailAgeLabel(updatedAt) ?? 'Chưa rõ thời điểm cập nhật'}
          </span>
        )}
      </button>
      {open && (
        <div className="p-2 space-y-1">
          {fields.map((f, i) => (
            <div
              key={f}
              draggable={!!onReorderFields && renaming !== f}
              onDragStart={() => setDragIndex(i)}
              onDragOver={e => { if (dragIndex === null) return; e.preventDefault(); if (overIndex !== i) setOverIndex(i); }}
              onDragLeave={() => setOverIndex(o => (o === i ? null : o))}
              onDrop={e => {
                e.preventDefault();
                if (dragIndex !== null) reorderTo(dragIndex, i);
                setDragIndex(null); setOverIndex(null);
              }}
              onDragEnd={() => { setDragIndex(null); setOverIndex(null); }}
              className={`flex items-center gap-1.5 group rounded transition-colors ${
                overIndex === i && dragIndex !== null && dragIndex !== i ? 'bg-blue-50' : ''
              } ${dragIndex === i ? 'opacity-40' : ''}`}
            >
              {onReorderFields && (
                <span title="Kéo để đổi thứ tự"
                  className="shrink-0 opacity-40 group-hover:opacity-100 transition text-[#999] hover:text-blue-600 cursor-grab active:cursor-grabbing">
                  <GripVertical size={12} />
                </span>
              )}
              {renaming === f ? (
                <input
                  autoFocus
                  value={renameDraft}
                  onChange={e => setRenameDraft(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') { e.preventDefault(); submitRename(); }
                    else if (e.key === 'Escape') setRenaming(null);
                  }}
                  className="text-[11.5px] flex-1 min-w-0 px-1.5 py-0.5 rounded border border-blue-400 outline-none"
                />
              ) : (
                <span className="text-[11.5px] text-[#555] flex-1 truncate">{f}</span>
              )}
              {onRenameField && (renaming === f ? (
                <>
                  <button type="button" onClick={submitRename} disabled={busy} title="Lưu tên mới"
                    className="text-blue-600 hover:text-blue-800 shrink-0"><Check size={12} /></button>
                  <button type="button" onClick={() => setRenaming(null)} title="Huỷ"
                    className="text-[#ccc] hover:text-[#666] shrink-0"><X size={12} /></button>
                </>
              ) : (
                <button type="button" onClick={() => startRename(f)} disabled={busy} title="Đổi tên trường (áp dụng toàn hệ thống)"
                  className="text-[#ccc] hover:text-blue-600 shrink-0 opacity-40 group-hover:opacity-100 transition"><Pencil size={11} /></button>
              ))}
              {renaming !== f && (
                <input
                  type="text" inputMode="numeric"
                  value={formatVnd(value[f] ?? '')}
                  onChange={e => setField(f, stripVnd(e.target.value))}
                  placeholder="đ"
                  title="Nhập bằng ĐỒNG (vd 250000), khớp đơn vị với Tính bảng lương"
                  className="w-28 text-[12px] px-2 py-1 rounded border border-gray-300 outline-none text-right"
                />
              )}
              {renaming !== f && (
                <button type="button" onClick={() => removeField(f)} disabled={busy} title="Xoá trường này khỏi hệ thống"
                  className="text-[#ccc] hover:text-red-500 shrink-0"><X size={12} /></button>
              )}
            </div>
          ))}
          {fields.length === 0 && <div className="text-[11px] text-[#999] px-0.5 py-1">Chưa có trường lương chi tiết nào</div>}
          {fieldTypes && (() => {
            const fieldNameByType = Object.fromEntries(
              fields.filter(f => fieldTypes[f]).map(f => [fieldTypes[f], f]),
            ) as Partial<Record<PayrollInputType, string>>;
            const baseSalaryField = fieldNameByType.base_salary;
            if (!baseSalaryField) return null;
            return (
              <ShiftPicker
                baseSalary={parseFloat(value[baseSalaryField] || '0') || 0}
                fieldNameByType={fieldNameByType}
                onApply={patch => onChange({ ...value, ...patch })}
              />
            );
          })()}
          <div className="flex items-center gap-1.5 pt-1 border-t border-[#F0EEE9] mt-1">
            <input
              value={newField}
              onChange={e => setNewField(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submitNewField(); } }}
              placeholder="Thêm trường lương (VD: Phụ cấp thâm niên)…"
              className="flex-1 text-[11.5px] px-2 py-1 rounded border border-dashed border-gray-300 outline-none focus:border-blue-400"
            />
            <button type="button" onClick={submitNewField} disabled={busy || !newField.trim()}
              className="text-[#666] hover:text-blue-600 disabled:opacity-40"><Plus size={13} /></button>
          </div>
        </div>
      )}
    </div>
  );
}
