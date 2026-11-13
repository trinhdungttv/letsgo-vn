// Ô "Ngành nghề" dạng xổ xuống (trình xem ảnh chỉ tiêu, nền tối): bấm → bảng chọn nhiều ngành có ô tìm,
// gõ ngành mới để thêm vào danh mục, và nút mở màn Sửa danh mục ngành nghề.
// Giá trị vẫn là chuỗi cách nhau dấu phẩy (cột positions).
import { useMemo, useState } from 'react';
import { Check, ChevronDown, Pencil, Plus, Search, X } from 'lucide-react';
import { useAuth } from '../../../lib/auth';
import { hasPosition, joinPositions, samePosition, splitPositions, togglePosition } from '../../../lib/kcnSurvey/positions';
import { addCatalogPosition, findCatalogItem } from '../../../lib/kcnSurvey/positionsApi';
import { fold } from './surveyData';
import { reloadPositionCatalog, usePositionCatalog } from './usePositionCatalog';

export default function PositionSelect({ value, onChange, open, onOpenChange, onEditCatalog, say }: {
  value: string;
  onChange: (v: string) => void;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onEditCatalog: () => void;
  say: (m: string) => void;
}) {
  const picked = splitPositions(value);
  return (
    <>
      <button type="button" onClick={() => onOpenChange(true)}
        className="w-full min-h-10 px-3 py-2 rounded-xl bg-white/10 text-left inline-flex items-center gap-2 active:bg-white/15">
        <span className={`flex-1 min-w-0 text-[14px] leading-snug ${picked.length ? 'text-white' : 'text-white/40'}`}>
          {picked.length ? picked.join(', ') : 'Ngành nghề — bấm để chọn'}
        </span>
        <ChevronDown size={16} className="shrink-0 text-white/60" />
      </button>
      {open && <PositionSheet value={value} onChange={onChange} onClose={() => onOpenChange(false)} onEditCatalog={onEditCatalog} say={say} />}
    </>
  );
}

function PositionSheet({ value, onChange, onClose, onEditCatalog, say }: {
  value: string; onChange: (v: string) => void; onClose: () => void; onEditCatalog: () => void; say: (m: string) => void;
}) {
  const { items, missing } = usePositionCatalog();
  const { user } = useAuth();
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const picked = splitPositions(value);
  const customs = picked.filter(p => !items.some(i => samePosition(i.name, p)));
  const fq = fold(q.trim());
  const shown = useMemo(() => (fq ? items.filter(i => fold(i.name).includes(fq)) : items), [items, fq]);
  const exact = q.trim() ? findCatalogItem(items, q) : null;

  const addNew = async () => {
    const name = q.trim();
    if (!name) return;
    if (exact) { if (!hasPosition(value, exact.name)) onChange(joinPositions([...picked, exact.name])); setQ(''); return; }
    // Chưa chạy migration 225 → chỉ gắn cho ảnh này (gõ tay), không lưu vào danh mục
    if (missing) { onChange(joinPositions([...picked, name])); setQ(''); return; }
    setAdding(true);
    try {
      const maxSort = items.reduce((m, i) => Math.max(m, i.sort), 0);
      await addCatalogPosition(name, maxSort + 10, user?.full_name || user?.username || '');
      await reloadPositionCatalog();
      onChange(joinPositions([...picked, name]));
      setQ('');
      say(`Đã thêm ngành “${name}” vào danh mục`);
    } catch (e) { say((e as Error).message); } finally { setAdding(false); }
  };

  const row = (name: string, key: string) => {
    const on = hasPosition(value, name);
    return (
      <button type="button" key={key} onClick={() => onChange(togglePosition(value, name))}
        className="w-full flex items-center gap-3 px-4 py-2.5 text-left active:bg-white/10">
        <span className={`w-5 h-5 rounded-full shrink-0 flex items-center justify-center ${on ? 'bg-[#0A84FF]' : 'border border-white/35'}`}>
          {on && <Check size={13} strokeWidth={3} />}
        </span>
        <span className={`flex-1 min-w-0 text-[15px] ${on ? 'font-semibold' : ''}`}>{name}</span>
      </button>
    );
  };

  return (
    <div className="fixed inset-0 z-[1360] flex flex-col justify-end md:flex-row md:justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/45" />
      <div onClick={e => e.stopPropagation()}
        className="relative w-full md:w-[400px] max-h-[74vh] md:max-h-none md:h-full bg-[#2C2C2E] text-white rounded-t-2xl md:rounded-none flex flex-col shadow-2xl pb-[env(safe-area-inset-bottom)]">
        <div className="flex items-center gap-2 px-4 pt-3 pb-2 shrink-0">
          <div className="flex-1 min-w-0">
            <div className="text-[16px] font-semibold">Ngành nghề</div>
            <div className="text-[11.5px] text-white/55">{picked.length ? `Đã chọn ${picked.length}` : 'Chọn 1 hoặc nhiều ngành'}</div>
          </div>
          <button type="button" onClick={onClose} className="h-9 px-4 rounded-full bg-[#0A84FF] text-[14px] font-semibold">Xong</button>
        </div>
        <div className="px-4 pb-2 shrink-0">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/45" />
            <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void addNew(); } }}
              placeholder="Tìm, hoặc gõ ngành mới rồi Enter"
              className="w-full h-10 pl-9 pr-9 rounded-xl bg-white/10 text-[14px] outline-none placeholder:text-white/40" />
            {q && <button type="button" onClick={() => setQ('')} className="absolute right-1 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center text-white/50" aria-label="Xoá chữ tìm"><X size={15} /></button>}
          </div>
        </div>
        {customs.length > 0 && (
          <div className="px-4 pb-2 flex flex-wrap gap-1.5 shrink-0">
            {customs.map(c => (
              <button type="button" key={c} onClick={() => onChange(togglePosition(value, c))}
                className="h-7 pl-2.5 pr-1.5 rounded-full bg-[#0A84FF] text-[12px] font-medium inline-flex items-center gap-1" title="Ngành gõ tay, chưa có trong danh mục">
                {c} <X size={12} />
              </button>
            ))}
          </div>
        )}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain border-t border-white/10">
          {q.trim() && !exact && (
            <button type="button" onClick={() => void addNew()} disabled={adding}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-left text-[#64A8FF] active:bg-white/10 disabled:opacity-50">
              <Plus size={18} className="shrink-0" />
              <span className="text-[15px]">{adding ? 'Đang thêm…' : missing ? `Gắn “${q.trim()}” cho ảnh này` : `Thêm “${q.trim()}” vào danh mục`}</span>
            </button>
          )}
          {shown.map(i => row(i.name, i.id ?? i.name))}
          {!shown.length && !q.trim() && <div className="px-4 py-6 text-center text-[13px] text-white/50">Danh mục trống</div>}
        </div>
        <div className="shrink-0 border-t border-white/10 px-4 py-2">
          <button type="button" onClick={onEditCatalog} className="h-9 px-3 -ml-3 rounded-full text-[13.5px] text-[#64A8FF] inline-flex items-center gap-1.5 active:bg-white/10">
            <Pencil size={14} /> Sửa danh mục ngành nghề — đổi tên, gộp ngành
          </button>
        </div>
      </div>
    </div>
  );
}
