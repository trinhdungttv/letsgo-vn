// Bộ chọn từ KHO ĐẦU MỤC khi bấm "+ Thêm dòng": tìm nhanh, lọc theo nhóm (I–V), bấm là thêm (kèm công thức, bản dịch, mã danh mục).
import { useMemo, useState } from 'react';
import { Plus, Search, Trash2 } from 'lucide-react';
import {
  CATALOG_GROUPS, CATALOG_GROUP_LABEL, CATALOG_GROUP_SHORT, describeCalc, isUsed, mergedCatalog, pickerCatalog, searchCatalog,
  type CatalogGroup, type CatalogItem, type UsedRows,
} from '../../../lib/costPlan/rowCatalog';
import type { QuoteRowCfg } from '../../../lib/costPlan/types';
import { field } from './ui';

export default function RowPicker({ used, mine, hiddenRows, templateRows, onAdd, onShow, onTemplateRow, onBlank, onRemoveMine, onManage, close }: {
  /** Dòng đang hiện của bảng giá (mã danh mục + tên) — mục đã có thì mờ đi */
  used: UsedRows;
  /** Kho của công ty */
  mine: CatalogItem[];
  /** Dòng chuẩn đang ẩn (hiện lại) */
  hiddenRows: { id: string; name: string }[];
  /** Dòng của mẫu bảng giá chung mà bảng chưa có */
  templateRows: QuoteRowCfg[];
  onAdd: (it: CatalogItem) => void;
  onShow: (id: string, name: string) => void;
  onTemplateRow: (r: QuoteRowCfg) => void;
  onBlank: () => void;
  /** Mở màn Quản lý kho đầu mục */
  onManage: () => void;
  onRemoveMine: (it: CatalogItem) => void;
  close: () => void;
}) {
  const [q, setQ] = useState('');
  const [g, setG] = useState<CatalogGroup | ''>('');
  // Đang tìm thì tìm cả mục đã ẩn (ẩn để danh sách gọn, không phải để mất hẳn)
  const items = useMemo(() => searchCatalog(q ? mergedCatalog(mine) : pickerCatalog(mine), q).filter(i => !g || i.group === g), [mine, q, g]);
  const groups = CATALOG_GROUPS.map(k => ({ k, list: items.filter(i => i.group === k) })).filter(x => x.list.length);
  const hiddenCount = useMemo(() => mergedCatalog(mine).filter(i => i.hidden).length, [mine]);
  const hidden = g ? [] : q ? hiddenRows.filter(h => h.name.toLowerCase().includes(q.toLowerCase())) : hiddenRows;

  const section = (title: string, children: React.ReactNode, key?: string) => (
    <div key={key}><div className="sticky top-0 z-[1] bg-white/95 backdrop-blur px-3.5 pt-2.5 pb-1 text-[10.5px] font-semibold uppercase tracking-wide text-[#86868b]">{title}</div>{children}</div>
  );
  const chip = (v: CatalogGroup | '', label: string) => (
    <button key={v || 'all'} type="button" onClick={() => setG(v)}
      className={`shrink-0 h-6 px-2.5 rounded-full text-[11.5px] font-medium transition ${g === v ? 'bg-[#1d1d1f] text-white' : 'bg-[#f0f0f2] text-[#1d1d1f] hover:bg-[#e8e8ed]'}`}>{label}</button>
  );
  return (
    <div className="flex flex-col max-h-[min(72vh,560px)]">
      <div className="p-2.5 pb-2 border-b border-[#f0f0f2] shrink-0 space-y-2">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#86868b]" />
          <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Tìm đầu mục: lễ tết, ca đêm 12h, cơm, BHYT…" className={`${field} !h-8 w-full pl-8`} />
        </div>
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
          {chip('', 'Tất cả')}
          {CATALOG_GROUPS.map(k => chip(k, CATALOG_GROUP_SHORT[k]))}
        </div>
      </div>
      <div className="overflow-y-auto">
        {hidden.length > 0 && section('Dòng đang ẩn của bảng này — hiện lại', hidden.map(h => (
          <button key={h.id} type="button" onClick={() => { onShow(h.id, h.name); close(); }}
            className="w-full text-left px-3.5 py-2 text-[13px] hover:bg-[#f5f5f7] text-[#1d1d1f]">{h.name}</button>
        )))}
        {groups.map(({ k, list }) => section(CATALOG_GROUP_LABEL[k], list.map(it => {
          const have = isUsed(used, it);
          return (
            <div key={it.id} className={`group flex items-center ${have ? 'opacity-50' : 'hover:bg-[#f5f5f7]'}`}>
              <button type="button" disabled={have} onClick={() => { onAdd(it); close(); }} className="flex-1 min-w-0 text-left px-3.5 py-2 disabled:cursor-default">
                <div className="flex items-center gap-1.5">
                  <span className="text-[13px] text-[#1d1d1f] truncate">{it.name}</span>
                  {it.custom && <span className="shrink-0 text-[9.5px] font-semibold px-1 rounded bg-[#e9f7f4] text-[#0a7d6e]">của công ty</span>}
                  {it.hidden && <span className="shrink-0 text-[10.5px] text-[#86868b]">đang ẩn</span>}
                  {have && <span className="shrink-0 text-[10.5px] text-[#86868b]">đã có</span>}
                </div>
                <div className="text-[11px] text-[#86868b] truncate">{it.unit} · {it.calc ? `tự tính: ${describeCalc(it.calc)}` : it.hint ?? 'nhập tay'}</div>
              </button>
              {it.custom && (
                <button type="button" title="Xoá khỏi kho" onClick={() => onRemoveMine(it)}
                  className="shrink-0 mr-2 w-7 h-7 rounded-full flex items-center justify-center text-[#a1a1a6] hover:bg-[#fff1f0] hover:text-[#d70015] md:opacity-0 md:group-hover:opacity-100"><Trash2 size={13} /></button>
              )}
            </div>
          );
        }), k))}
        {templateRows.length > 0 && !q && !g && section('Từ mẫu bảng giá chung', templateRows.map(r => (
          <button key={r.id} type="button" onClick={() => { onTemplateRow(r); close(); }} className="w-full text-left px-3.5 py-2 hover:bg-[#f5f5f7]">
            <div className="text-[13px] text-[#1d1d1f]">{r.name}</div><div className="text-[11px] text-[#86868b]">{r.unit}</div>
          </button>
        )))}
        {groups.length === 0 && hidden.length === 0 && <div className="px-3.5 py-4 text-[12.5px] text-[#86868b]">Không có đầu mục nào khớp{q ? ` “${q}”` : ''}.</div>}
        {!q && hiddenCount > 0 && (
          <div className="px-3.5 py-2 text-[11.5px] text-[#86868b]">{hiddenCount} mục ít dùng đang ẩn — gõ tìm vẫn thấy, hoặc bật lại ở “Quản lý kho”.</div>
        )}
      </div>
      <div className="shrink-0 flex items-center border-t border-[#f0f0f2]">
        <button type="button" onClick={() => { onBlank(); close(); }}
          className="flex-1 min-w-0 flex items-center gap-1.5 px-3.5 py-2.5 text-[13px] font-medium text-[#0071e3] hover:bg-[#f5f5f7]">
          <Plus size={14} className="shrink-0" /><span className="truncate">Dòng trống — tự đặt tên{q ? ` “${q}”` : ''}</span>
        </button>
        <button type="button" onClick={() => { onManage(); close(); }}
          className="shrink-0 px-3.5 py-2.5 text-[13px] font-medium text-[#0a7d6e] hover:bg-[#f5f5f7] border-l border-[#f0f0f2]">Quản lý kho…</button>
      </div>
    </div>
  );
}
