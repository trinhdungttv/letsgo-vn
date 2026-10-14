// GẮN DANH MỤC (chuyển đổi phương án / bảng giá cũ): mỗi dòng chọn 1 mục trong kho đầu mục → mã quy chiếu chung (catalogId)
// để so sánh cùng hạng mục giữa các dự án. Dùng cho cả bảng giá (bước 2) và bảng chi phí (bước 1). Hệ thống gợi ý sẵn theo tên;
// tên, số tiền đã báo giữ nguyên (chỉ đổi tên khi người dùng tích chọn).
import { useMemo, useState } from 'react';
import { Check, Lock, X } from 'lucide-react';
import {
  CATALOG_GROUPS, CATALOG_GROUP_LABEL, catalogRef, findCatalogItem, initialCatalogChoice, suggestCatalog, SUGGEST_MIN,
  type CatalogItem,
} from '../../../lib/costPlan/rowCatalog';
import type { RowCalc } from '../../../lib/costPlan/types';
import { FONT, Select, btnGhost, btnPrimary } from './ui';

/** Ô chọn mục danh mục theo 5 nhóm. Mã đã gắn mà danh sách không có → vẫn hiện để không mất. */
export function CatalogSelect({ items, value, onChange, fieldClassName }: {
  items: CatalogItem[]; value: string | null; onChange: (ref: string | null) => void; fieldClassName?: string;
}) {
  const missing = value && !items.some(i => catalogRef(i) === value);
  const known = missing ? findCatalogItem(items, value) : undefined;
  return (
    <Select value={value ?? ''} onChange={v => onChange(v || null)} fieldClassName={fieldClassName}>
      <option value="">— Không thuộc mục nào trong danh mục —</option>
      {missing && <option value={value}>{known ? `${known.name} — ${known.unit}` : `Mã ${value} (mục đã xoá khỏi kho)`}</option>}
      {CATALOG_GROUPS.map(g => {
        const list = items.filter(i => i.group === g);
        return list.length ? (
          <optgroup key={g} label={CATALOG_GROUP_LABEL[g]}>
            {list.map(i => <option key={catalogRef(i)} value={catalogRef(i)}>{i.name} — {i.unit}{i.hidden ? ' (ẩn ở bảng giá)' : ''}</option>)}
          </optgroup>
        ) : null;
      })}
    </Select>
  );
}

export interface MapEntry {
  id: string;
  name: string;
  /** Dòng phụ: đơn vị, số tiền */
  sub: string;
  /** Mã đã ghi trên dòng (null = chưa ghi) */
  stored: string | null;
  /** Mã tự gắn khi chưa ghi (theo loại dòng / tên trùng mục có sẵn) */
  auto?: string | null;
  /** Dòng có vai trò cố định → không chọn được, ghi lý do */
  locked?: string;
  calc?: RowCalc;
}

type Init = { ref: string | null; suggested: boolean; exact?: boolean; auto?: boolean };

export default function CatalogMapDialog({ title = 'Gắn danh mục cho các dòng', entries, items, suggestFrom, onApply, onClose }: {
  title?: string;
  entries: MapEntry[];
  /** Mục cho ô chọn */
  items: CatalogItem[];
  /** Mục dùng để gợi ý (mặc định = items) */
  suggestFrom?: CatalogItem[];
  /** map: mã dòng → mã danh mục (null = bỏ gắn); renameIds: dòng đổi tên theo danh mục */
  onApply: (map: Record<string, string | null>, renameIds: string[]) => void;
  onClose: () => void;
}) {
  const open = useMemo(() => entries.filter(e => !e.locked), [entries]);
  const locked = entries.filter(e => e.locked);
  const pool = suggestFrom ?? items;
  const init = useMemo(() => Object.fromEntries(open.map((e): [string, Init] => {
    if (e.stored) return [e.id, { ref: e.stored, suggested: false }];
    if (e.auto) return [e.id, { ref: e.auto, suggested: false, auto: true }];
    return [e.id, initialCatalogChoice({ name: e.name, calc: e.calc }, pool)];
  })), [open, pool]);
  const [choice, setChoice] = useState<Record<string, string | null>>(() => Object.fromEntries(Object.entries(init).map(([k, v]) => [k, v.ref])));
  const [rename, setRename] = useState<Set<string>>(new Set());

  const changed = open.filter(e => (choice[e.id] ?? null) !== e.stored || rename.has(e.id));
  const mappedN = open.filter(e => choice[e.id]).length;
  const apply = () => {
    onApply(Object.fromEntries(changed.map(e => [e.id, choice[e.id] ?? null])), [...rename].filter(id => choice[id]));
    onClose();
  };
  const setOne = (id: string, ref: string | null) => {
    setChoice(c => ({ ...c, [id]: ref }));
    if (!ref) setRename(s => { const n = new Set(s); n.delete(id); return n; });
  };
  const toggleRename = (id: string, on: boolean) => setRename(s => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; });

  return (
    <div className="fixed inset-0 z-[80] bg-black/30 backdrop-blur-[2px] flex items-center justify-center p-2 sm:p-4" style={{ fontFamily: FONT }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-[#f5f5f7] rounded-2xl shadow-[0_24px_80px_rgba(0,0,0,0.28)] w-full max-w-[820px] max-h-[92vh] flex flex-col overflow-hidden text-[#1d1d1f]">
        <div className="flex items-start gap-3 px-5 py-3 bg-white border-b border-black/[0.06] shrink-0">
          <div className="min-w-0 flex-1">
            <div className="text-[17px] font-semibold tracking-tight">{title}</div>
            <div className="text-[12px] text-[#86868b] leading-snug">Mỗi dòng gắn 1 mục trong kho đầu mục — mã chung để sau này so sánh cùng hạng mục giữa các dự án. Tên và số tiền giữ nguyên.</div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center text-[#6e6e73] hover:bg-[#f5f5f7] shrink-0"><X size={17} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {open.length === 0 && <div className="rounded-xl bg-white px-4 py-6 text-center text-[13px] text-[#86868b]">Chỉ có các dòng tự gắn danh mục — không cần làm gì thêm.</div>}
          {open.length > 0 && (
            <section className="space-y-2">
              <div className="px-1 text-[12px] font-semibold uppercase tracking-wide text-[#6e6e73]">{mappedN}/{open.length} dòng đã chọn danh mục</div>
              {open.map(e => {
                const ref = choice[e.id] ?? null;
                const it = findCatalogItem(items, ref);
                const i0 = init[e.id];
                const sug = suggestCatalog({ name: e.name, calc: e.calc }, pool, 3).filter(s => s.score >= 0.35 && catalogRef(s.item) !== ref);
                const status = !ref ? { t: 'chưa gắn', c: 'bg-[#f0f0f2] text-[#6e6e73]' }
                  : ref === e.stored ? { t: 'đã gắn', c: 'bg-[#e8f8ed] text-[#1d8a3b]' }
                  : (i0?.auto || i0?.exact) && ref === i0.ref ? { t: 'khớp tên danh mục', c: 'bg-[#eef5ff] text-[#0b5cc4]' }
                  : i0?.suggested && ref === i0.ref ? { t: 'gợi ý — kiểm tra lại', c: 'bg-[#fff4e5] text-[#b25e00]' }
                  : { t: 'đã chọn', c: 'bg-[#eef5ff] text-[#0b5cc4]' };
                return (
                  <div key={e.id} className="bg-white rounded-xl px-4 py-3 shadow-[0_0_0_1px_rgba(0,0,0,0.05)] space-y-2">
                    <div className="flex items-baseline gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-[13.5px] font-medium truncate">{e.name || <span className="italic text-[#a1a1a6]">Dòng chưa đặt tên</span>}</div>
                        <div className="text-[11.5px] text-[#86868b]">{e.sub}</div>
                      </div>
                      <span className={`shrink-0 text-[10.5px] font-semibold px-1.5 py-0.5 rounded ${status.c}`}>{status.t}</span>
                    </div>
                    <CatalogSelect items={items} value={ref} onChange={v => setOne(e.id, v)} />
                    {sug.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[11.5px] text-[#86868b]">{ref ? 'Hoặc:' : 'Gợi ý:'}</span>
                        {sug.map(s => (
                          <button key={catalogRef(s.item)} type="button" onClick={() => setOne(e.id, catalogRef(s.item))}
                            className={`h-6 px-2 rounded-full text-[11.5px] shadow-[0_0_0_1px_rgba(0,0,0,0.06)] hover:bg-[#e8e8ed] ${s.score >= SUGGEST_MIN ? 'bg-[#f5f5f7] text-[#1d1d1f]' : 'bg-white text-[#6e6e73]'}`}>{s.item.name}</button>
                        ))}
                      </div>
                    )}
                    {it && it.name !== e.name && (
                      <label className="flex items-center gap-2 text-[12px] text-[#6e6e73] cursor-pointer">
                        <input type="checkbox" className="accent-[#0071e3] w-3.5 h-3.5" checked={rename.has(e.id)} onChange={ev => toggleRename(e.id, ev.target.checked)} />
                        Đổi tên thành “{it.name}”
                      </label>
                    )}
                  </div>
                );
              })}
            </section>
          )}
          {locked.length > 0 && (
            <section className="space-y-1.5">
              <div className="px-1 text-[12px] font-semibold uppercase tracking-wide text-[#6e6e73]">Tự gắn theo vai trò dòng</div>
              <div className="bg-white rounded-xl shadow-[0_0_0_1px_rgba(0,0,0,0.05)] divide-y divide-[#f2f2f4]">
                {locked.map(e => (
                  <div key={e.id} className="flex items-center gap-2 px-4 py-2 text-[12.5px]" title={e.locked}>
                    <Lock size={12} className="shrink-0 text-[#a1a1a6]" />
                    <span className="min-w-0 flex-1 truncate">{e.name}</span>
                    <span className="min-w-0 max-w-[50%] truncate text-[#86868b]">→ {findCatalogItem(items, e.auto)?.name ?? e.auto}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="shrink-0 bg-white border-t border-black/[0.06] px-5 py-3 flex flex-wrap items-center gap-3">
          <span className="text-[12.5px] min-w-0 flex-1 text-[#86868b]">{changed.length ? `${changed.length} dòng sẽ được gắn / đổi · bấm Lưu phương án sau khi áp dụng để ghi lại` : 'Chưa có thay đổi'}</span>
          <button type="button" onClick={onClose} className={`${btnGhost} !h-9`}>Đóng</button>
          <button type="button" onClick={apply} disabled={!changed.length} className={`${btnPrimary} !h-9 !px-5`}><Check size={14} />Áp dụng</button>
        </div>
      </div>
    </div>
  );
}
