// QUẢN LÝ KHO ĐẦU MỤC của Bảng giá: xem toàn bộ mục, sửa tên / đơn vị / nhóm / bản dịch / CÁCH TÍNH (nhập tay hoặc
// [nền] + số giờ × giờ chuẩn × hệ số, có xem trước giá), thêm, xoá (mục có sẵn thì ẩn), sắp thứ tự, dán nhiều dòng một lúc.
// Mọi thay đổi nằm ở bản nháp, bấm "Lưu kho" mới ghi (app_settings, dùng chung cả công ty).
import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronRight, Eye, EyeOff, Plus, RotateCcw, Search, Trash2, X } from 'lucide-react';
import {
  BUILTIN_CATALOG, CATALOG_GROUP_LABEL, builtinOf, describeCalc, parseBulkItems, searchCatalog, toStored,
  type CatalogGroup, type CatalogItem,
} from '../../../lib/costPlan/rowCatalog';
import { calcValue, type CalcCtx } from '../../../lib/costPlan/quoteSheet';
import type { RowCalc } from '../../../lib/costPlan/types';
import { newLineId } from '../../../lib/costPlan/engine';
import { MoneyInput, NumInput, fmt } from './fields';
import { FONT, Select, Seg, btnGhost, btnLink, btnPrimary, field, labelCls } from './ui';

const UNIT_SUGGEST = ['VNĐ/ngày', 'VNĐ/ngày (ca đêm)', 'VNĐ/ngày công', 'VNĐ/giờ', 'VNĐ/giờ (ca đêm)', 'VNĐ/tháng', 'VNĐ/người/tháng', 'VNĐ/suất', 'VNĐ/người'];
const GROUPS = Object.keys(CATALOG_GROUP_LABEL) as CatalogGroup[];
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export default function RowCatalogManager({ items, ctx, onSave, onClose }: {
  /** Kho hiện tại (có sẵn + của công ty, kể cả mục đang ẩn) */
  items: CatalogItem[];
  /** Bối cảnh của bảng giá đang mở — để xem trước giá của mục tự tính */
  ctx?: CalcCtx;
  onSave: (list: CatalogItem[]) => Promise<void>;
  onClose: () => void;
}) {
  const [list, setList] = useState<CatalogItem[]>(() => items.map(i => ({ ...i })));
  const [openId, setOpenId] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [bulk, setBulk] = useState('');
  const [bulkOpen, setBulkOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const dirty = !same(list.map(toStored), items.map(toStored));
  const shown = useMemo(() => searchCatalog(list, q), [list, q]);
  const patch = (id: string, p: Partial<CatalogItem>) => setList(l => l.map(i => (i.id === id ? { ...i, ...p } : i)));
  const setCalc = (id: string, c: Partial<RowCalc>) => setList(l => l.map(i => (i.id === id && i.calc ? { ...i, calc: { ...i.calc, ...c } } : i)));
  const move = (id: string, d: -1 | 1) => setList(l => {
    const i = l.findIndex(x => x.id === id), j = i + d;
    if (i < 0 || j < 0 || j >= l.length) return l;
    const n = [...l]; [n[i], n[j]] = [n[j], n[i]]; return n;
  });
  const addItem = () => {
    const it: CatalogItem = { id: `c-${newLineId()}`, group: 'allowance', name: '', unit: 'VNĐ/ngày', price: 0, custom: true };
    setList(l => [it, ...l]); setOpenId(it.id); setQ('');
  };
  const remove = (it: CatalogItem) => {
    if (builtinOf(it)) { patch(it.id, { hidden: true }); return; }          // mục có sẵn: ẩn (khôi phục được), không xoá hẳn
    if (!it.name.trim() || window.confirm(`Xoá “${it.name}” khỏi kho? Các bảng giá đã dùng dòng này không bị ảnh hưởng.`)) setList(l => l.filter(x => x.id !== it.id));
  };
  const resetBuiltin = (it: CatalogItem) => { const b = builtinOf(it); if (b) setList(l => l.map(x => (x.id === it.id ? { ...b, builtinId: b.id, custom: false } : x))); };
  const addBulk = () => {
    const add = parseBulkItems(bulk, list);
    if (!add.length) { setErr('Không có mục mới (dòng trống hoặc tên đã có trong kho).'); return; }
    setErr(null); setList(l => [...add, ...l]); setBulk(''); setBulkOpen(false);
  };
  const save = async () => {
    const bad = list.find(i => !i.name.trim());
    if (bad) { setErr('Có mục chưa đặt tên — đặt tên hoặc xoá mục đó trước khi lưu.'); setOpenId(bad.id); return; }
    setSaving(true); setErr(null);
    try { await onSave(list.map(toStored)); onClose(); }
    catch (e) { setErr(`Không lưu được: ${e instanceof Error ? e.message : String(e)}`); setSaving(false); }
  };
  const close = () => { if (!dirty || window.confirm('Còn thay đổi chưa lưu vào kho. Đóng sẽ mất các thay đổi đó — vẫn đóng?')) onClose(); };

  return (
    <div className="fixed inset-0 z-[80] bg-black/30 backdrop-blur-[2px] flex items-center justify-center p-2 sm:p-4" style={{ fontFamily: FONT }}
      onMouseDown={e => { if (e.target === e.currentTarget) close(); }}>
      <div className="bg-[#f5f5f7] rounded-2xl shadow-[0_24px_80px_rgba(0,0,0,0.28)] w-full max-w-[860px] h-[92vh] flex flex-col overflow-hidden text-[#1d1d1f]">
        <div className="flex items-center gap-3 px-5 py-3 bg-white border-b border-black/[0.06] shrink-0">
          <div className="min-w-0 flex-1">
            <div className="text-[17px] font-semibold tracking-tight">Quản lý kho đầu mục</div>
            <div className="text-[12px] text-[#86868b] truncate">{list.filter(i => !i.hidden).length} mục đang dùng · cách tính, tên, bản dịch, thứ tự — dùng chung cho mọi bảng giá</div>
          </div>
          <button onClick={close} className="w-8 h-8 rounded-full flex items-center justify-center text-[#6e6e73] hover:bg-[#f5f5f7]"><X size={17} /></button>
        </div>

        <div className="flex flex-wrap items-center gap-2 px-5 py-2.5 shrink-0">
          <div className="relative flex-1 min-w-[180px]">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#86868b]" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Tìm trong kho…" className={`${field} !bg-white !h-9 w-full pl-8 shadow-[0_0_0_1px_rgba(0,0,0,0.06)]`} />
          </div>
          <button type="button" onClick={addItem} className={`${btnPrimary} !h-9`}><Plus size={14} />Thêm mục</button>
          <button type="button" onClick={() => setBulkOpen(o => !o)} className={`${btnGhost} !h-9`}>Dán nhiều mục</button>
        </div>

        {bulkOpen && (
          <div className="mx-5 mb-2 rounded-xl bg-white p-3.5 space-y-2 shadow-[0_0_0_1px_rgba(0,0,0,0.05)] shrink-0">
            <div className="text-[12px] text-[#6e6e73] leading-snug">Mỗi dòng 1 mục: <b className="text-[#1d1d1f]">Tên | Đơn vị | Giá</b> (đơn vị và giá không bắt buộc). Dán từ Excel cũng được (cột ngăn bằng Tab). Mục vào kho dạng nhập tay — sau đó mở từng mục để cài cách tính nếu cần.</div>
            <textarea rows={5} value={bulk} onChange={e => setBulk(e.target.value)} placeholder={'Phụ cấp nhà ở | VNĐ/tháng | 500000\nTiền thưởng chuyên cần | VNĐ/tháng\nPhụ cấp thâm niên'} className={`${field} !h-auto w-full py-2 leading-relaxed resize-y`} />
            <div className="flex gap-2"><button type="button" onClick={addBulk} className={btnPrimary}>Thêm vào kho ({parseBulkItems(bulk, list).length} mục)</button><button type="button" onClick={() => { setBulkOpen(false); setBulk(''); }} className={btnGhost}>Huỷ</button></div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-5 pb-4 space-y-2">
          {shown.length === 0 && <div className="py-10 text-center text-[13px] text-[#86868b]">Không có mục nào khớp “{q}”.</div>}
          {shown.map(it => {
            const open = openId === it.id;
            const b = builtinOf(it);
            const preview = it.calc && ctx ? calcValue(it.calc, ctx) : null;
            const idx = list.findIndex(x => x.id === it.id);
            return (
              <div key={it.id} className={`bg-white rounded-xl shadow-[0_0_0_1px_rgba(0,0,0,0.05)] ${it.hidden ? 'opacity-60' : ''}`}>
                <div className="flex items-center gap-2 px-3 py-2">
                  <button type="button" onClick={() => setOpenId(open ? null : it.id)} className="flex-1 min-w-0 flex items-center gap-2 text-left">
                    <ChevronRight size={14} className={`shrink-0 text-[#86868b] transition-transform ${open ? 'rotate-90' : ''}`} />
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5">
                        <span className={`text-[13.5px] font-medium truncate ${it.name ? '' : 'text-[#a1a1a6] italic'}`}>{it.name || 'Mục chưa đặt tên'}</span>
                        {!b && <span className="shrink-0 text-[9.5px] font-semibold px-1 rounded bg-[#e9f7f4] text-[#0a7d6e]">của công ty</span>}
                        {it.hidden && <span className="shrink-0 text-[10.5px] text-[#86868b]">đang ẩn</span>}
                      </span>
                      <span className="block text-[11px] text-[#86868b] truncate">{it.unit} · {CATALOG_GROUP_LABEL[it.group]} · {it.calc ? describeCalc(it.calc) : `nhập tay${it.price ? ` (mặc định ${fmt(it.price)})` : ''}`}</span>
                    </span>
                  </button>
                  {preview != null && <span className="shrink-0 text-[12px] tabular-nums text-[#0071e3] font-semibold" title="Giá theo bảng giá đang mở">{fmt(preview)}</span>}
                  <div className="shrink-0 flex items-center">
                    <button type="button" disabled={idx <= 0 || !!q} onClick={() => move(it.id, -1)} title="Lên" className="w-7 h-7 rounded-full flex items-center justify-center text-[#6e6e73] hover:bg-[#f0f0f2] disabled:opacity-25"><ArrowUp size={14} /></button>
                    <button type="button" disabled={idx >= list.length - 1 || !!q} onClick={() => move(it.id, 1)} title="Xuống" className="w-7 h-7 rounded-full flex items-center justify-center text-[#6e6e73] hover:bg-[#f0f0f2] disabled:opacity-25"><ArrowDown size={14} /></button>
                    {it.hidden
                      ? <button type="button" onClick={() => patch(it.id, { hidden: false })} title="Hiện lại trong bộ chọn" className="w-7 h-7 rounded-full flex items-center justify-center text-[#0071e3] hover:bg-[#eef5ff]"><Eye size={14} /></button>
                      : b ? <button type="button" onClick={() => remove(it)} title="Ẩn khỏi bộ chọn (mục có sẵn không xoá hẳn)" className="w-7 h-7 rounded-full flex items-center justify-center text-[#6e6e73] hover:bg-[#f0f0f2]"><EyeOff size={14} /></button>
                        : <button type="button" onClick={() => remove(it)} title="Xoá khỏi kho" className="w-7 h-7 rounded-full flex items-center justify-center text-[#a1a1a6] hover:bg-[#fff1f0] hover:text-[#d70015]"><Trash2 size={14} /></button>}
                  </div>
                </div>

                {open && (
                  <div className="px-4 pb-4 pt-1 border-t border-[#f2f2f4] space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <label className="block sm:col-span-2"><span className={labelCls}>Tên đầu mục (in trên báo giá)</span>
                        <input value={it.name} onChange={e => patch(it.id, { name: e.target.value })} className={`${field} w-full`} /></label>
                      <div><span className={labelCls}>Nhóm</span>
                        <Select value={it.group} onChange={v => patch(it.id, { group: v as CatalogGroup })}>{GROUPS.map(g => <option key={g} value={g}>{CATALOG_GROUP_LABEL[g]}</option>)}</Select></div>
                      <label className="block sm:col-span-2"><span className={labelCls}>Đơn vị tính</span>
                        <input list="catalog-units" value={it.unit} onChange={e => patch(it.id, { unit: e.target.value })} className={`${field} w-full`} />
                        <datalist id="catalog-units">{UNIT_SUGGEST.map(u => <option key={u} value={u} />)}</datalist></label>
                      <label className="block"><span className={labelCls}>Tên tiếng Trung</span>
                        <input value={it.i18n?.zh ?? ''} onChange={e => patch(it.id, { i18n: { ...it.i18n, zh: e.target.value || undefined } })} className={`${field} w-full`} /></label>
                      <label className="block sm:col-span-3"><span className={labelCls}>Tên tiếng Anh</span>
                        <input value={it.i18n?.en ?? ''} onChange={e => patch(it.id, { i18n: { ...it.i18n, en: e.target.value || undefined } })} className={`${field} w-full`} /></label>
                    </div>

                    <div className="rounded-xl bg-[#f5f5f7] p-3 space-y-2.5">
                      <div className="text-[12px] font-semibold text-[#6e6e73]">Cách tính giá</div>
                      <div className="max-w-sm">
                        <Seg value={it.calc ? 'calc' : 'manual'}
                          onChange={v => patch(it.id, v === 'calc' ? { calc: it.calc ?? { base: 'none', hours: 8, coef: 1.5 }, price: undefined } : { calc: undefined, price: it.price ?? 0 })}
                          options={[{ value: 'manual', label: 'Nhập tay' }, { value: 'calc', label: 'Tự tính theo lương' }]} />
                      </div>
                      {it.calc ? (
                        <>
                          <div className="flex flex-wrap items-end gap-3">
                            <div className="w-44"><span className={labelCls}>Cộng thêm vào</span>
                              <Select value={it.calc.base} onChange={v => setCalc(it.id, { base: v as RowCalc['base'] })}>
                                <option value="none">Không (chỉ tính giờ)</option><option value="day">Giá ca ngày 8h</option><option value="night">Giá ca đêm 8h</option>
                              </Select></div>
                            <div><span className={labelCls}>Số giờ</span>
                              <NumInput value={it.calc.hours} min={0} max={24} step={0.5} onChange={n => setCalc(it.id, { hours: n })} className={`${field} !bg-white w-20 text-center font-semibold`} /></div>
                            <div><span className={labelCls}>× Hệ số (%)</span>
                              <NumInput value={Math.round(it.calc.coef * 1000) / 10} min={0} max={1000} step={5} onChange={n => setCalc(it.id, { coef: n / 100 })} className={`${field} !bg-white w-24 text-center font-semibold`} /></div>
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            <span className="text-[11.5px] text-[#86868b] self-center">Hệ số luật:</span>
                            {[['Ngày thường 150%', 1.5], ['Đêm thường 200%', 2], ['Chủ nhật 200%', 2], ['CN đêm 270%', 2.7], ['Lễ/Tết 300%', 3], ['Lễ/Tết đêm 390%', 3.9], ['Làm đêm +30%', 0.3]].map(([t, c]) => (
                              <button key={t as string} type="button" onClick={() => setCalc(it.id, { coef: c as number })} className="h-6 px-2 rounded-full bg-white text-[11.5px] text-[#1d1d1f] hover:bg-[#e8e8ed] shadow-[0_0_0_1px_rgba(0,0,0,0.06)]">{t}</button>
                            ))}
                          </div>
                          <div className="text-[12.5px] text-[#6e6e73]">
                            {describeCalc(it.calc)} {ctx
                              ? <>→ với bảng giá đang mở (giờ chuẩn <b className="tabular-nums text-[#1d1d1f]">{fmt(ctx.shr)}</b> đ, giá ngày <b className="tabular-nums text-[#1d1d1f]">{fmt(ctx.dayPrice)}</b> đ): <b className="tabular-nums text-[#0071e3]">{fmt(calcValue(it.calc, ctx))} đ</b></>
                              : '(mở từ bảng giá để xem trước số tiền)'}
                          </div>
                        </>
                      ) : (
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[12.5px] text-[#6e6e73]">Giá mặc định khi thêm vào bảng</span>
                          <MoneyInput value={it.price ?? 0} onChange={n => patch(it.id, { price: n })} className={`${field} !bg-white w-36 text-right font-semibold`} />
                          <span className="text-[12px] text-[#86868b]">đ — sửa lại được ở từng bảng giá</span>
                        </div>
                      )}
                    </div>

                    {b && !same({ ...b, id: '', custom: undefined }, { ...it, id: '', custom: undefined, builtinId: undefined, hidden: undefined }) && (
                      <button type="button" onClick={() => resetBuiltin(it)} className={`${btnLink} inline-flex items-center gap-1 !text-[12.5px]`}><RotateCcw size={12} />Khôi phục mặc định của mục này</button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="shrink-0 bg-white border-t border-black/[0.06] px-5 py-3 flex flex-wrap items-center gap-3">
          <span className={`text-[12.5px] min-w-0 flex-1 truncate ${err ? 'text-[#b3140a]' : 'text-[#86868b]'}`} title={err ?? undefined}>
            {err ?? (dirty ? 'Còn thay đổi chưa lưu' : `${BUILTIN_CATALOG.length} mục có sẵn + mục của công ty`)}
          </span>
          <button type="button" onClick={close} className={`${btnGhost} !h-9`}>Đóng</button>
          <button type="button" onClick={save} disabled={saving || !dirty} className={`${btnPrimary} !h-9 !px-5`}>{saving ? 'Đang lưu…' : 'Lưu kho'}</button>
        </div>
      </div>
    </div>
  );
}
