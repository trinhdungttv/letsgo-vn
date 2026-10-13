// Bộ chọn từ KHO ĐẦU MỤC khi bấm "+ Thêm dòng": tìm nhanh, chia nhóm, bấm là thêm (kèm công thức & bản dịch).
import { useMemo, useState } from 'react';
import { Plus, Search, Trash2 } from 'lucide-react';
import { CATALOG_GROUP_LABEL, mergedCatalog, searchCatalog, sheetHasItem, type CatalogGroup, type CatalogItem } from '../../../lib/costPlan/rowCatalog';
import type { QuoteRowCfg, QuoteSheet } from '../../../lib/costPlan/types';
import { field } from './ui';

export default function RowPicker({ sheet, mine, hiddenRows, templateRows, onAdd, onShow, onTemplateRow, onBlank, onRemoveMine, close }: {
  sheet: QuoteSheet;
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
  onRemoveMine: (it: CatalogItem) => void;
  close: () => void;
}) {
  const [q, setQ] = useState('');
  const items = useMemo(() => searchCatalog(mergedCatalog(mine), q), [mine, q]);
  const groups = (['shift', 'allowance', 'other'] as CatalogGroup[]).map(g => ({ g, list: items.filter(i => i.group === g) })).filter(x => x.list.length);
  const hidden = q ? hiddenRows.filter(h => h.name.toLowerCase().includes(q.toLowerCase())) : hiddenRows;

  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div><div className="px-3.5 pt-2.5 pb-1 text-[10.5px] font-semibold uppercase tracking-wide text-[#86868b]">{title}</div>{children}</div>
  );
  return (
    <div className="flex flex-col max-h-[min(70vh,520px)]">
      <div className="p-2.5 border-b border-[#f0f0f2] relative shrink-0">
        <Search size={13} className="absolute left-5 top-1/2 -translate-y-1/2 text-[#86868b]" />
        <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Tìm đầu mục: lễ tết, ca đêm 12 tiếng, cơm…" className={`${field} !h-8 w-full pl-8`} />
      </div>
      <div className="overflow-y-auto">
        {hidden.length > 0 && (
          <Section title="Đang ẩn — hiện lại">
            {hidden.map(h => (
              <button key={h.id} type="button" onClick={() => { onShow(h.id, h.name); close(); }}
                className="w-full text-left px-3.5 py-2 text-[13px] hover:bg-[#f5f5f7] text-[#1d1d1f]">{h.name}</button>
            ))}
          </Section>
        )}
        {groups.map(({ g, list }) => (
          <Section key={g} title={CATALOG_GROUP_LABEL[g]}>
            {list.map(it => {
              const have = sheetHasItem(sheet, it);
              return (
                <div key={it.id} className={`group flex items-center ${have ? 'opacity-50' : 'hover:bg-[#f5f5f7]'}`}>
                  <button type="button" disabled={have} onClick={() => { onAdd(it); close(); }} className="flex-1 min-w-0 text-left px-3.5 py-2 disabled:cursor-default">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[13px] text-[#1d1d1f] truncate">{it.name}</span>
                      {it.custom && <span className="shrink-0 text-[9.5px] font-semibold px-1 rounded bg-[#e9f7f4] text-[#0a7d6e]">của công ty</span>}
                      {have && <span className="shrink-0 text-[10.5px] text-[#86868b]">đã có</span>}
                    </div>
                    <div className="text-[11px] text-[#86868b] truncate">{it.unit}{it.hint ? ` · ${it.hint}` : ''}</div>
                  </button>
                  {it.custom && (
                    <button type="button" title="Xoá khỏi kho" onClick={() => onRemoveMine(it)}
                      className="shrink-0 mr-2 w-7 h-7 rounded-full flex items-center justify-center text-[#a1a1a6] hover:bg-[#fff1f0] hover:text-[#d70015] md:opacity-0 md:group-hover:opacity-100"><Trash2 size={13} /></button>
                  )}
                </div>
              );
            })}
          </Section>
        ))}
        {templateRows.length > 0 && !q && (
          <Section title="Từ mẫu bảng giá chung">
            {templateRows.map(r => (
              <button key={r.id} type="button" onClick={() => { onTemplateRow(r); close(); }} className="w-full text-left px-3.5 py-2 hover:bg-[#f5f5f7]">
                <div className="text-[13px] text-[#1d1d1f]">{r.name}</div><div className="text-[11px] text-[#86868b]">{r.unit}</div>
              </button>
            ))}
          </Section>
        )}
        {groups.length === 0 && hidden.length === 0 && <div className="px-3.5 py-4 text-[12.5px] text-[#86868b]">Không có đầu mục nào khớp “{q}”.</div>}
      </div>
      <button type="button" onClick={() => { onBlank(); close(); }}
        className="shrink-0 flex items-center gap-1.5 px-3.5 py-2.5 border-t border-[#f0f0f2] text-[13px] font-medium text-[#0071e3] hover:bg-[#f5f5f7]">
        <Plus size={14} />Dòng trống — tự đặt tên{q ? ` “${q}”` : ''}
      </button>
    </div>
  );
}
