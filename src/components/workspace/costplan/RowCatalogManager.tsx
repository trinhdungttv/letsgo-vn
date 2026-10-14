// QUẢN LÝ KHO ĐẦU MỤC (dùng chung bảng giá & bảng chi phí): xem toàn bộ mục theo 5 nhóm, ẨN / HIỆN mục ít dùng ở bảng giá
// (cả từng nhóm), sửa tên / đơn vị / nhóm / bản dịch / CÁCH TÍNH GIÁ (nhập tay · [nền] + số giờ × giờ chuẩn × hệ số · % lương đóng
// BHXH, có xem trước), cài CÁCH DÙNG Ở BẢNG CHI PHÍ (bước 1), thêm, xoá mục của công ty, sắp thứ tự, dán nhiều dòng một lúc.
// Mọi thay đổi nằm ở bản nháp, bấm "Lưu kho" mới ghi (app_settings, dùng chung cả công ty).
import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronRight, Eye, EyeOff, Plus, RotateCcw, Search, Trash2, X } from 'lucide-react';
import {
  BUILTIN_CATALOG, CATALOG_GROUPS, CATALOG_GROUP_LABEL, COST_SECTION_LABEL, builtinOf, describeCalc, describeCost, isEditedBuiltin, parseBulkItems,
  searchCatalog, toStored, type CatalogCost, type CatalogGroup, type CatalogItem, type CostSection,
} from '../../../lib/costPlan/rowCatalog';
import { calcValue, sampleCalcCtx, type CalcCtx } from '../../../lib/costPlan/quoteSheet';
import type { RowCalc } from '../../../lib/costPlan/types';
import { newLineId } from '../../../lib/costPlan/engine';
import { MoneyInput, NumInput, fmt } from './fields';
import { FONT, Select, Seg, btnGhost, btnLink, btnPrimary, field, labelCls } from './ui';

const UNIT_SUGGEST = [
  'VNĐ/giờ', 'VNĐ/8h/ngày', 'VNĐ/8h/đêm', 'VNĐ/12h/ngày', 'VNĐ/12h/đêm', 'VNĐ/ca', 'VNĐ/ngày', 'VNĐ/ngày công', 'VNĐ/công', 'VNĐ/đêm',
  'VNĐ/tháng', 'VNĐ/người/tháng', 'VNĐ/người/ngày', 'VNĐ/26 công', 'VNĐ/suất', 'VNĐ/lần', 'VNĐ/bộ', 'VNĐ/sản phẩm', 'VNĐ/tấn', 'VNĐ/container',
];
const BASE_OPTS: [RowCalc['base'], string][] = [
  ['none', 'Không (chỉ tính giờ)'], ['day', 'Giá ca ngày 8h'], ['night', 'Giá ca đêm 8h'],
  ['dayHour', 'Giá 1 giờ ca ngày (÷ 8)'], ['nightHour', 'Giá 1 giờ ca đêm (÷ 8)'], ['insSalary', '% lương đóng BHXH / tháng'],
];
const LAW_CHIPS: [string, number][] = [['Ngày thường 150%', 1.5], ['Đêm thường 200%', 2], ['Chủ nhật 200%', 2], ['CN đêm 270%', 2.7], ['Lễ/Tết 300%', 3], ['Lễ/Tết đêm 390%', 3.9], ['Làm đêm +30%', 0.3]];
const INS_CHIPS: [string, number][] = [['NLĐ đóng 10,5%', 0.105], ['BHXH DN 17,5%', 0.175], ['DN cả 3 loại 21,5%', 0.215], ['BHYT 3%', 0.03], ['BHTN 1%', 0.01], ['TNLĐ-BNN 0,5%', 0.005]];
type View = 'all' | 'on' | 'off' | 'cost';
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const iconBtn = 'w-7 h-7 rounded-full flex items-center justify-center disabled:opacity-25';

export default function RowCatalogManager({ items, ctx: planCtx, onSave, onClose }: {
  /** Kho hiện tại (có sẵn + của công ty, kể cả mục đang ẩn) */
  items: CatalogItem[];
  /** Bối cảnh của bảng giá đang mở — để xem trước giá của mục tự tính. Không có (mở từ danh sách) → xem trước theo lương mẫu */
  ctx?: CalcCtx;
  onSave: (list: CatalogItem[]) => Promise<void>;
  onClose: () => void;
}) {
  const [list, setList] = useState<CatalogItem[]>(() => items.map(i => ({ ...i })));
  const [openId, setOpenId] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [view, setView] = useState<View>('all');
  const [bulk, setBulk] = useState('');
  const [bulkOpen, setBulkOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sampleWage, setSampleWage] = useState(250_000);
  const ctx: CalcCtx = planCtx ?? sampleCalcCtx(sampleWage);
  const ctxLabel = planCtx ? 'với bảng giá đang mở' : 'với lương mẫu';

  const dirty = !same(list.map(toStored), items.map(toStored));
  const onCount = list.filter(i => !i.hidden).length;
  const costN = list.filter(i => i.cost).length;
  const shown = useMemo(() => searchCatalog(list, q).filter(i => view === 'all' || (view === 'on' ? !i.hidden : view === 'off' ? !!i.hidden : !!i.cost)), [list, q, view]);
  const patch = (id: string, p: Partial<CatalogItem>) => setList(l => l.map(i => (i.id === id ? { ...i, ...p } : i)));
  const setCalc = (id: string, c: Partial<RowCalc>) => setList(l => l.map(i => (i.id === id && i.calc ? { ...i, calc: { ...i.calc, ...c } } : i)));
  const setCost = (id: string, c: Partial<CatalogCost> | null) => setList(l => l.map(i => {
    if (i.id !== id) return i;
    if (!c) { const n = { ...i }; delete n.cost; return n; }
    return { ...i, cost: { ...(i.cost ?? { section: 'worker', mode: 'fixed', unit: 'month', value: 0 }), ...c } as CatalogCost };
  }));
  const setGroupHidden = (g: CatalogGroup, hidden: boolean) => setList(l => l.map(i => (i.group === g ? { ...i, hidden } : i)));
  // Đổi chỗ với mục liền trước / sau CÙNG NHÓM (danh sách hiển thị theo nhóm)
  const move = (id: string, d: -1 | 1) => setList(l => {
    const i = l.findIndex(x => x.id === id);
    if (i < 0) return l;
    let j = i + d;
    while (j >= 0 && j < l.length && l[j].group !== l[i].group) j += d;
    if (j < 0 || j >= l.length) return l;
    const n = [...l]; [n[i], n[j]] = [n[j], n[i]]; return n;
  });
  const addItem = () => {
    const it: CatalogItem = { id: `c-${newLineId()}`, group: 'allowance', name: '', unit: 'VNĐ/ngày', price: 0, custom: true };
    setList(l => [it, ...l]); setOpenId(it.id); setQ(''); setView('all');
  };
  const remove = (it: CatalogItem) => {
    if (!it.name.trim() || window.confirm(`Xoá “${it.name}” khỏi kho? Các bảng giá đã dùng dòng này không bị ảnh hưởng (giữ nguyên tên, giá và mã danh mục).`)) setList(l => l.filter(x => x.id !== it.id));
  };
  const resetBuiltin = (it: CatalogItem) => { const b = builtinOf(it); if (b) setList(l => l.map(x => (x.id === it.id ? { ...b, builtinId: b.id, custom: false, hidden: it.hidden } : x))); };
  const addBulk = () => {
    const add = parseBulkItems(bulk, list);
    if (!add.length) { setErr('Không có mục mới (dòng trống hoặc tên đã có trong kho).'); return; }
    setErr(null); setList(l => [...add, ...l]); setBulk(''); setBulkOpen(false); setView('all');
  };
  const save = async () => {
    const bad = list.find(i => !i.name.trim());
    if (bad) { setErr('Có mục chưa đặt tên — đặt tên hoặc xoá mục đó trước khi lưu.'); setOpenId(bad.id); setView('all'); setQ(''); return; }
    setSaving(true); setErr(null);
    try { await onSave(list); onClose(); }
    catch (e) { setErr(`Không lưu được: ${e instanceof Error ? e.message : String(e)}`); setSaving(false); }
  };
  const close = () => { if (!dirty || window.confirm('Còn thay đổi chưa lưu vào kho. Đóng sẽ mất các thay đổi đó — vẫn đóng?')) onClose(); };

  const itemRow = (it: CatalogItem) => {
    const open = openId === it.id;
    const b = builtinOf(it);
    const preview = it.calc ? calcValue(it.calc, ctx) : null;
    const sameGroup = list.filter(x => x.group === it.group);
    const gi = sameGroup.findIndex(x => x.id === it.id);
    const ins = it.calc?.base === 'insSalary';
    return (
      <div key={it.id} className={`bg-white rounded-xl shadow-[0_0_0_1px_rgba(0,0,0,0.05)] ${it.hidden ? 'opacity-55' : ''}`}>
        <div className="flex items-center gap-2 px-3 py-2">
          <button type="button" onClick={() => setOpenId(open ? null : it.id)} className="flex-1 min-w-0 flex items-center gap-2 text-left">
            <ChevronRight size={14} className={`shrink-0 text-[#86868b] transition-transform ${open ? 'rotate-90' : ''}`} />
            <span className="min-w-0">
              <span className="flex items-center gap-1.5">
                <span className={`text-[13.5px] font-medium truncate ${it.name ? '' : 'text-[#a1a1a6] italic'}`}>{it.name || 'Mục chưa đặt tên'}</span>
                {!b && <span className="shrink-0 text-[9.5px] font-semibold px-1 rounded bg-[#e9f7f4] text-[#0a7d6e]">của công ty</span>}
                {b && isEditedBuiltin(it) && <span className="shrink-0 text-[9.5px] font-semibold px-1 rounded bg-[#fff4e5] text-[#b25e00]">đã sửa</span>}
                {it.cost && <span className="shrink-0 text-[9.5px] font-semibold px-1 rounded bg-[#eef5ff] text-[#0b5cc4]" title={`Bảng chi phí: ${COST_SECTION_LABEL[it.cost.section]} · ${describeCost(it.cost)}`}>bước 1</span>}
                {it.hidden && <span className="shrink-0 text-[10.5px] text-[#86868b]">ẩn ở bảng giá</span>}
              </span>
              <span className="block text-[11px] text-[#86868b] truncate">{it.unit} · {it.calc ? describeCalc(it.calc) : `nhập tay${it.price ? ` (mặc định ${fmt(it.price)})` : ''}`}</span>
            </span>
          </button>
          {preview != null && <span className="shrink-0 text-[12px] tabular-nums text-[#0071e3] font-semibold hidden sm:inline" title="Giá theo bảng giá đang mở">{fmt(preview)}</span>}
          <div className="shrink-0 flex items-center">
            <button type="button" disabled={gi <= 0 || !!q || view !== 'all'} onClick={() => move(it.id, -1)} title="Lên" className={`${iconBtn} text-[#6e6e73] hover:bg-[#f0f0f2]`}><ArrowUp size={14} /></button>
            <button type="button" disabled={gi >= sameGroup.length - 1 || !!q || view !== 'all'} onClick={() => move(it.id, 1)} title="Xuống" className={`${iconBtn} text-[#6e6e73] hover:bg-[#f0f0f2]`}><ArrowDown size={14} /></button>
            {it.hidden
              ? <button type="button" onClick={() => patch(it.id, { hidden: false })} title="Hiện lại ở “Thêm dòng” của bảng giá" className={`${iconBtn} text-[#0071e3] hover:bg-[#eef5ff]`}><Eye size={14} /></button>
              : <button type="button" onClick={() => patch(it.id, { hidden: true })} title="Ẩn khỏi “Thêm dòng” của bảng giá (ít dùng) — gõ tìm vẫn thấy; bảng chi phí không bị ảnh hưởng" className={`${iconBtn} text-[#6e6e73] hover:bg-[#f0f0f2]`}><EyeOff size={14} /></button>}
            {!b && <button type="button" onClick={() => remove(it)} title="Xoá khỏi kho" className={`${iconBtn} text-[#a1a1a6] hover:bg-[#fff1f0] hover:text-[#d70015]`}><Trash2 size={14} /></button>}
          </div>
        </div>

        {open && (
          <div className="px-4 pb-4 pt-1 border-t border-[#f2f2f4] space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label className="block sm:col-span-2"><span className={labelCls}>Tên đầu mục (in trên báo giá)</span>
                <input value={it.name} onChange={e => patch(it.id, { name: e.target.value })} className={`${field} w-full`} /></label>
              <div><span className={labelCls}>Nhóm</span>
                <Select value={it.group} onChange={v => patch(it.id, { group: v as CatalogGroup })}>{CATALOG_GROUPS.map(g => <option key={g} value={g}>{CATALOG_GROUP_LABEL[g]}</option>)}</Select></div>
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
                  options={[{ value: 'manual', label: 'Nhập tay' }, { value: 'calc', label: 'Tự tính' }]} />
              </div>
              {it.calc ? (
                <>
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="w-56"><span className={labelCls}>Tính từ</span>
                      <Select value={it.calc.base} fieldClassName="!bg-white" onChange={v => setCalc(it.id, v === 'insSalary' ? { base: 'insSalary', hours: 0, coef: it.calc!.base === 'insSalary' ? it.calc!.coef : 0.175 } : { base: v as RowCalc['base'], ...(it.calc!.base === 'insSalary' ? { hours: 0, coef: 0 } : {}) })}>
                        {BASE_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </Select></div>
                    {ins ? (
                      <div><span className={labelCls}>Tỷ lệ (%)</span>
                        <NumInput value={Math.round(it.calc.coef * 10000) / 100} min={0} max={100} step={0.5} onChange={n => setCalc(it.id, { coef: n / 100 })} className={`${field} !bg-white w-24 text-center font-semibold`} /></div>
                    ) : (
                      <>
                        <div><span className={labelCls}>{it.calc.base === 'none' ? 'Số giờ' : '+ Số giờ'}</span>
                          <NumInput value={it.calc.hours} min={0} max={24} step={0.5} onChange={n => setCalc(it.id, { hours: n })} className={`${field} !bg-white w-20 text-center font-semibold`} /></div>
                        <div><span className={labelCls}>× Hệ số (%)</span>
                          <NumInput value={Math.round(it.calc.coef * 1000) / 10} min={0} max={1000} step={5} onChange={n => setCalc(it.id, { coef: n / 100 })} className={`${field} !bg-white w-24 text-center font-semibold`} /></div>
                      </>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <span className="text-[11.5px] text-[#86868b] self-center">{ins ? 'Tỷ lệ luật:' : 'Hệ số luật:'}</span>
                    {(ins ? INS_CHIPS : LAW_CHIPS).map(([t, c]) => (
                      <button key={t} type="button" onClick={() => setCalc(it.id, { coef: c })} className="h-6 px-2 rounded-full bg-white text-[11.5px] text-[#1d1d1f] hover:bg-[#e8e8ed] shadow-[0_0_0_1px_rgba(0,0,0,0.06)]">{t}</button>
                    ))}
                  </div>
                  <div className="text-[12.5px] text-[#6e6e73]">
                    {describeCalc(it.calc)} → {ctxLabel} ({ins ? <>lương đóng BHXH <b className="tabular-nums text-[#1d1d1f]">{fmt(ctx.insSalary ?? 0)}</b> đ</> : <>giờ chuẩn <b className="tabular-nums text-[#1d1d1f]">{fmt(ctx.shr)}</b> đ, giá ngày <b className="tabular-nums text-[#1d1d1f]">{fmt(ctx.dayPrice)}</b> đ</>}): <b className="tabular-nums text-[#0071e3]">{fmt(calcValue(it.calc, ctx))} đ</b>
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

            <div className="rounded-xl bg-[#f5f5f7] p-3 space-y-2.5">
              <div className="text-[12px] font-semibold text-[#6e6e73]">Dùng ở bảng chi phí (bước 1 — giá vốn 1 công)</div>
              <div className="flex flex-wrap items-end gap-3">
                <div className="w-56"><span className={labelCls}>Nhóm ở bảng chi phí</span>
                  <Select value={it.cost?.section ?? ''} fieldClassName="!bg-white" onChange={v => setCost(it.id, v ? { section: v as CostSection } : null)}>
                    <option value="">Không dùng ở bảng chi phí</option>
                    {(Object.keys(COST_SECTION_LABEL) as CostSection[]).map(k => <option key={k} value={k}>{COST_SECTION_LABEL[k]}</option>)}
                  </Select></div>
                {it.cost && (
                  <div className="w-full sm:w-[300px]"><span className={labelCls}>Cách tính</span>
                    <Seg value={it.cost.mode} onChange={m => setCost(it.id, m === 'percent' ? { mode: m, base: 'insurable', value: it.cost!.mode === 'percent' ? it.cost!.value : 0 } : m === 'leave' ? { mode: m, value: 12 } : { mode: m, unit: it.cost!.unit ?? 'month', value: 0 })}
                      options={[{ value: 'fixed', label: 'Nhập số' }, { value: 'percent', label: 'Theo %' }, { value: 'leave', label: 'Phép năm' }]} /></div>
                )}
              </div>
              {it.cost?.mode === 'fixed' && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[12.5px] text-[#6e6e73]">Số mặc định</span>
                  <MoneyInput value={it.cost.value ?? 0} onChange={n => setCost(it.id, { value: n })} className={`${field} !bg-white w-32 text-right font-semibold`} />
                  <div className="w-[130px]"><Seg value={it.cost.unit ?? 'month'} onChange={u => setCost(it.id, { unit: u })} options={[{ value: 'day', label: '/công' }, { value: 'month', label: '/tháng' }]} /></div>
                  {it.cost.section === 'worker' && (
                    <label className="flex items-center gap-1.5 text-[12.5px] text-[#6e6e73] cursor-pointer">
                      <input type="checkbox" className="accent-[#0071e3] w-3.5 h-3.5" checked={!!it.cost.insurable} onChange={e => setCost(it.id, { insurable: e.target.checked })} />
                      Tính vào lương đóng BHXH
                    </label>
                  )}
                </div>
              )}
              {it.cost?.mode === 'percent' && (
                <div className="flex flex-wrap items-center gap-2">
                  <NumInput value={it.cost.value ?? 0} step={0.1} max={1000} onChange={n => setCost(it.id, { value: n })} className={`${field} !bg-white w-20 text-right font-semibold`} />
                  <span className="text-[12.5px] text-[#6e6e73]">% của</span>
                  <div className="w-48"><Select value={it.cost.base ?? 'insurable'} fieldClassName="!bg-white" onChange={v => setCost(it.id, { base: v as 'insurable' | 'base_wage' })}>
                    <option value="insurable">Lương đóng BHXH</option><option value="base_wage">Lương cơ bản</option>
                  </Select></div>
                </div>
              )}
              {it.cost?.mode === 'leave' && (
                <div className="flex items-center gap-2">
                  <NumInput value={it.cost.value ?? 12} max={30} onChange={n => setCost(it.id, { value: n })} className={`${field} !bg-white w-20 text-right font-semibold`} />
                  <span className="text-[12.5px] text-[#6e6e73]">ngày phép có lương mỗi năm</span>
                </div>
              )}
              <div className="text-[11.5px] text-[#86868b] leading-snug">
                {it.cost ? 'Hiện ở “Thêm khoản” của nhóm này ở bước 1; khoản thêm vào mang cùng mã danh mục với bảng giá.'
                  : 'Lương ca, tăng ca, Chủ nhật, Lễ Tết không dùng ở bước 1 (giá suy từ lương cơ bản — đưa vào là tính 2 lần); BHXH phần NLĐ đóng là tiền trừ lương, không phải chi phí.'}
              </div>
            </div>

            {b && isEditedBuiltin(it) && (
              <button type="button" onClick={() => resetBuiltin(it)} className={`${btnLink} inline-flex items-center gap-1 !text-[12.5px]`}><RotateCcw size={12} />Khôi phục mặc định của mục này</button>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-[80] bg-black/30 backdrop-blur-[2px] flex items-center justify-center p-2 sm:p-4" style={{ fontFamily: FONT }}
      onMouseDown={e => { if (e.target === e.currentTarget) close(); }}>
      <div className="bg-[#f5f5f7] rounded-2xl shadow-[0_24px_80px_rgba(0,0,0,0.28)] w-full max-w-[880px] h-[92vh] flex flex-col overflow-hidden text-[#1d1d1f]">
        <div className="flex items-center gap-3 px-5 py-3 bg-white border-b border-black/[0.06] shrink-0">
          <div className="min-w-0 flex-1">
            <div className="text-[17px] font-semibold tracking-tight">Quản lý kho đầu mục</div>
            <div className="text-[12px] text-[#86868b] truncate">{onCount} mục hiện ở bảng giá · {list.length - onCount} mục ẩn · {costN} mục dùng ở bảng chi phí (bước 1) — dùng chung mọi phương án</div>
          </div>
          <button onClick={close} className="w-8 h-8 rounded-full flex items-center justify-center text-[#6e6e73] hover:bg-[#f5f5f7]"><X size={17} /></button>
        </div>

        <div className="flex flex-wrap items-center gap-2 px-5 py-2.5 shrink-0">
          <div className="relative flex-1 min-w-[180px]">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#86868b]" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Tìm trong kho…" className={`${field} !bg-white !h-9 w-full pl-8 shadow-[0_0_0_1px_rgba(0,0,0,0.06)]`} />
          </div>
          <div className="w-full sm:w-[340px] order-last sm:order-none">
            <Seg value={view} onChange={setView} options={[
              { value: 'all', label: `Tất cả ${list.length}` }, { value: 'on', label: `Hiện ${onCount}` }, { value: 'off', label: `Ẩn ${list.length - onCount}` }, { value: 'cost', label: `Bước 1 ${costN}` },
            ]} />
          </div>
          <button type="button" onClick={addItem} className={`${btnPrimary} !h-9`}><Plus size={14} />Thêm mục</button>
          <button type="button" onClick={() => setBulkOpen(o => !o)} className={`${btnGhost} !h-9`}>Dán nhiều mục</button>
        </div>

        {!planCtx && (
          <div className="mx-5 mb-2 flex flex-wrap items-center gap-2 text-[12.5px] text-[#6e6e73] shrink-0">
            <span>Xem trước giá tự tính với lương mẫu</span>
            <MoneyInput value={sampleWage} onChange={n => setSampleWage(Math.max(0, n))} className={`${field} !bg-white !h-8 w-28 text-right font-semibold shadow-[0_0_0_1px_rgba(0,0,0,0.06)]`} />
            <span>đ/công</span>
            <span className="text-[11.5px] text-[#86868b]">(giá ngày = lương, chưa gồm phí DV · lương đóng BHXH ≈ × 26 công — mở từ bảng giá của phương án thì xem đúng số của phương án)</span>
          </div>
        )}

        {bulkOpen && (
          <div className="mx-5 mb-2 rounded-xl bg-white p-3.5 space-y-2 shadow-[0_0_0_1px_rgba(0,0,0,0.05)] shrink-0">
            <div className="text-[12px] text-[#6e6e73] leading-snug">Mỗi dòng 1 mục: <b className="text-[#1d1d1f]">Tên | Đơn vị | Giá</b> (đơn vị và giá không bắt buộc). Dán từ Excel cũng được (cột ngăn bằng Tab). Nhóm tự đoán theo tên, mục vào kho dạng nhập tay — sau đó mở từng mục để đổi nhóm / cài cách tính nếu cần.</div>
            <textarea rows={5} value={bulk} onChange={e => setBulk(e.target.value)} placeholder={'Phụ cấp thâm niên | VNĐ/tháng | 500000\nTiền thưởng Tết | VNĐ/người\nPhụ cấp thâm niên'} className={`${field} !h-auto w-full py-2 leading-relaxed resize-y`} />
            <div className="flex gap-2"><button type="button" onClick={addBulk} className={btnPrimary}>Thêm vào kho ({parseBulkItems(bulk, list).length} mục)</button><button type="button" onClick={() => { setBulkOpen(false); setBulk(''); }} className={btnGhost}>Huỷ</button></div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-5 pb-4 space-y-4">
          {shown.length === 0 && <div className="py-10 text-center text-[13px] text-[#86868b]">{q ? `Không có mục nào khớp “${q}”.` : view === 'off' ? 'Không có mục nào đang ẩn.' : view === 'cost' ? 'Chưa có mục nào dùng ở bảng chi phí.' : 'Không có mục nào.'}</div>}
          {CATALOG_GROUPS.map(g => {
            const inGroup = shown.filter(i => i.group === g);
            if (!inGroup.length) return null;
            const all = list.filter(i => i.group === g);
            const hiddenN = all.filter(i => i.hidden).length;
            return (
              <section key={g} className="space-y-1.5">
                <div className="flex items-center gap-2 px-1">
                  <div className="min-w-0 flex-1 text-[12px] font-semibold uppercase tracking-wide text-[#6e6e73] truncate">{CATALOG_GROUP_LABEL[g]}
                    <span className="ml-1.5 normal-case font-normal tracking-normal text-[#86868b]">{all.length - hiddenN}/{all.length} đang dùng</span></div>
                  {hiddenN < all.length && <button type="button" onClick={() => setGroupHidden(g, true)} className="shrink-0 text-[12px] font-medium text-[#6e6e73] hover:underline">Ẩn cả nhóm</button>}
                  {hiddenN > 0 && <button type="button" onClick={() => setGroupHidden(g, false)} className="shrink-0 text-[12px] font-medium text-[#0071e3] hover:underline">Hiện cả nhóm</button>}
                </div>
                {inGroup.map(itemRow)}
              </section>
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
