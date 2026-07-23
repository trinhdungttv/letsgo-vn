import { useState } from 'react';
import { ChevronDown, ChevronRight, Plus, X } from 'lucide-react';

/** Bảng chi tiết lương theo từng trường DÙNG CHUNG toàn hệ thống (Lương cơ bản, Phụ cấp…).
 * `fields` là danh sách trường global (bảng wage_detail_fields) — thêm/xoá 1 trường ở đây
 * ảnh hưởng đến MỌI nơi dùng bảng này (Let's Go VN lẫn từng NCC, ở mọi công ty/dự án).
 * `value`/`onChange` chỉ là giá trị RIÊNG của đối tượng đang sửa (đơn vị: triệu). */
export default function WageDetailTable({ fields, value, onChange, onAddField, onDeleteField, defaultOpen = false }: {
  fields: string[];
  value: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
  onAddField: (name: string) => Promise<void> | void;
  onDeleteField: (name: string) => Promise<void> | void;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [newField, setNewField] = useState('');
  const [busy, setBusy] = useState(false);

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
        Chi tiết lương{filled > 0 ? ` (${filled} mục)` : ''}
      </button>
      {open && (
        <div className="p-2 space-y-1">
          {fields.map(f => (
            <div key={f} className="flex items-center gap-1.5">
              <span className="text-[11.5px] text-[#555] flex-1 truncate">{f}</span>
              <input
                type="number" step="0.1"
                value={value[f] ?? ''}
                onChange={e => setField(f, e.target.value)}
                placeholder="tr"
                className="w-20 text-[12px] px-2 py-1 rounded border border-gray-300 outline-none"
              />
              <button type="button" onClick={() => removeField(f)} disabled={busy} title="Xoá trường này khỏi hệ thống"
                className="text-[#ccc] hover:text-red-500"><X size={12} /></button>
            </div>
          ))}
          {fields.length === 0 && <div className="text-[11px] text-[#999] px-0.5 py-1">Chưa có trường lương chi tiết nào</div>}
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
