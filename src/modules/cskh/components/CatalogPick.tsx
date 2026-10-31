// Chọn NHIỀU mục từ danh mục có sẵn (KCN, ngành…) — không gõ tay để lọc được và không trùng.
// Mục đã chọn là viên có nút ×; "Thêm…" là ô chọn gốc của máy (trên iPhone ra bánh xe chọn).
// Mã không còn trong danh mục (đã bị xoá ở Thị trường) tự bị bỏ, không hiện.
import { useMemo } from 'react';
import { X } from 'lucide-react';
import type { CatalogItem } from '../data/api';
import { PillSelect } from './apple';

export function CatalogPick({ items, value, onChange, addLabel, emptyText }: {
  items: readonly CatalogItem[];
  /** Mã đã chọn. */
  value: readonly string[];
  onChange: (ids: string[]) => void;
  /** Chữ trên ô thêm, VD "Thêm KCN…". */
  addLabel: string;
  /** Danh mục trống (chưa có / chưa chạy migration). */
  emptyText: string;
}) {
  const byId = useMemo(() => new Map(items.map(i => [i.id, i])), [items]);
  const selected = value.filter(id => byId.has(id));
  const rest = items.filter(i => !selected.includes(i.id));

  if (!items.length) return <p className="text-[13px] text-[#86868B]">{emptyText}</p>;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {selected.map(id => (
        <span key={id} className="inline-flex items-center gap-0.5 rounded-full bg-[#0071E3]/10 text-[#0058B0] pl-3 pr-1 h-9 md:h-8 max-w-full">
          <span className="text-[13px] font-medium truncate">{byId.get(id)?.name}</span>
          <button type="button" onClick={() => onChange(selected.filter(x => x !== id))} aria-label={`Bỏ ${byId.get(id)?.name}`}
            className="w-7 h-7 md:w-6 md:h-6 shrink-0 rounded-full hover:bg-[#0071E3]/15 flex items-center justify-center">
            <X size={12} strokeWidth={2.6} />
          </button>
        </span>
      ))}
      {rest.length > 0 && (
        <PillSelect value="" active={false} label={addLabel} onChange={v => { if (v) onChange([...selected, v]); }}>
          <option value="">{addLabel}</option>
          {rest.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
        </PillSelect>
      )}
    </div>
  );
}
