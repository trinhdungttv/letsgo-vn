// Chọn "vị trí / tay nghề tuyển" bằng thẻ có sẵn (+ gõ thêm) thay vì gõ tự do, để sau này lọc "công ty nào đang cần thợ may / hàn…".
// Giá trị vẫn là 1 chuỗi cách nhau dấu phẩy (cột positions cũ) → báo cáo / PDF / dữ liệu cũ dùng tiếp.
// Thẻ lấy từ danh mục ngành nghề dùng chung (migration 225, sửa được ở trình xem ảnh); chưa chạy 225 → danh sách viết sẵn.
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { hasPosition, joinPositions, samePosition, splitPositions, togglePosition } from '../../../lib/kcnSurvey/positions';
import { NEED_GROUPS, toggleNeed, type LaborNeed } from '../../../lib/kcnSurvey/needs';
import { usePositionCatalog } from './usePositionCatalog';

export default function PositionPicker({ value, onChange, dark = false }: { value: string; onChange: (v: string) => void; dark?: boolean }) {
  const [extra, setExtra] = useState('');
  const { items } = usePositionCatalog();
  const picked = splitPositions(value);
  const has = (n: string) => hasPosition(value, n);
  const toggle = (n: string) => onChange(togglePosition(value, n));
  const addExtra = () => { const n = extra.trim(); if (n && !has(n)) onChange(joinPositions([...picked, n])); setExtra(''); };
  const customs = picked.filter(p => !items.some(x => samePosition(x.name, p)));
  const chip = (on: boolean) => `h-8 px-2.5 rounded-full text-[12.5px] font-medium border transition ${on
    ? 'bg-[#0A84FF] border-[#0A84FF] text-white'
    : dark ? 'bg-white/10 border-transparent text-white/85' : 'bg-white border-[#E8E7E2] text-[#444] hover:bg-[#F3F3F0]'}`;
  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {items.map(it => <button type="button" key={it.id ?? it.name} onClick={() => toggle(it.name)} className={chip(has(it.name))}>{it.name}</button>)}
        {customs.map(n => <button type="button" key={n} onClick={() => toggle(n)} className={chip(true)}>{n} ✕</button>)}
      </div>
      <div className="flex gap-1.5 mt-2">
        <input value={extra} onChange={e => setExtra(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addExtra(); } }}
          placeholder="Vị trí khác — gõ rồi Enter"
          className={`flex-1 min-w-0 h-9 px-3 rounded-lg text-[13px] outline-none ${dark ? 'bg-white/10 text-white placeholder:text-white/40' : 'border border-[#E8E7E2] bg-white focus:border-[#0A84FF]'}`} />
        <button type="button" onClick={addExtra} disabled={!extra.trim()} className={`h-9 w-9 rounded-lg inline-flex items-center justify-center disabled:opacity-40 ${dark ? 'bg-white/15 text-white' : 'border border-[#E8E7E2] bg-white text-[#444]'}`} aria-label="Thêm vị trí"><Plus size={15} /></button>
      </div>
    </div>
  );
}

/** Khoảng lương lao động nhận được — bấm chọn nhanh (ghi vào wage_text dạng "8–10tr"); gõ tay vẫn được. */
export const WAGE_PRESETS = ['Dưới 6tr', '6–8tr', '8–10tr', '10–12tr', '12–15tr', 'Trên 15tr'];

export function WagePicker({ value, onChange, dark = false }: { value: string; onChange: (v: string) => void; dark?: boolean }) {
  const chip = (on: boolean) => `h-8 px-2.5 rounded-full text-[12.5px] font-medium border transition ${on
    ? 'bg-[#0A84FF] border-[#0A84FF] text-white'
    : dark ? 'bg-white/10 border-transparent text-white/85' : 'bg-white border-[#E8E7E2] text-[#444] hover:bg-[#F3F3F0]'}`;
  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {WAGE_PRESETS.map(w => <button type="button" key={w} onClick={() => onChange(value === w ? '' : w)} className={chip(value === w)}>{w}</button>)}
      </div>
      <input value={value} onChange={e => onChange(e.target.value)} placeholder="Hoặc gõ lương — VD: 9–11tr + ăn ca"
        className={`mt-2 w-full h-9 px-3 rounded-lg text-[13px] outline-none ${dark ? 'bg-white/10 text-white placeholder:text-white/40' : 'border border-[#E8E7E2] bg-white focus:border-[#0A84FF]'}`} />
    </div>
  );
}

/** Công ty cần gì: Cung ứng / Giới thiệu · Thời vụ / Chính thức (chọn cả 2 trong 1 nhóm = cần cả hai). */
export function NeedsPicker({ value, onChange, dark = false }: { value: LaborNeed[]; onChange: (v: LaborNeed[]) => void; dark?: boolean }) {
  const chip = (on: boolean) => `h-8 px-2.5 rounded-full text-[12.5px] font-medium border transition whitespace-nowrap ${on
    ? 'bg-[#0A84FF] border-[#0A84FF] text-white'
    : dark ? 'bg-white/10 border-transparent text-white/85' : 'bg-white border-[#E8E7E2] text-[#444] hover:bg-[#F3F3F0]'}`;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {NEED_GROUPS.map((g, gi) => (
        <div key={g.id} className="flex items-center gap-1.5">
          {gi > 0 && <span className={`w-px h-5 mx-0.5 ${dark ? 'bg-white/20' : 'bg-[#E8E7E2]'}`} aria-hidden />}
          {g.items.map(i => (
            <button type="button" key={i.id} onClick={() => onChange(toggleNeed(value, i.id))} className={chip(value.includes(i.id))} aria-pressed={value.includes(i.id)}>{i.label}</button>
          ))}
        </div>
      ))}
    </div>
  );
}
