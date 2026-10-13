// BƯỚC 2 — Báo giá khách: từ chi phí ở bước 1 → giá 1 công → "Bảng giá dịch vụ" theo đúng luật (ngày, ca đêm, tăng ca…).
import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Check, ChevronRight, Copy, Download, FileSpreadsheet, FileText, GripVertical, MoreHorizontal, Plus, Undo2, Upload } from 'lucide-react';
import { newLineId } from '../../../lib/costPlan/engine';
import {
  DEFAULT_SKILLED_LABEL, computePriceList, moveQuoteRow, includedNoteAuto, normalizeQuoteSheet, priceListToTsv, type EffectiveResult, type PriceRow,
} from '../../../lib/costPlan/quoteSheet';
import type { PlanData, PlanResult, QuoteRowCfg, QuoteSheet } from '../../../lib/costPlan/types';
import { normalizeText } from '../../../lib/costPlan/presets';
import { MoneyInput, NumInput, fmt } from './fields';
import QuoteTemplateDialog from './QuoteTemplateDialog';
import QuoteDocDialog from './QuoteDocDialog';
import type { DocDefaults } from '../../../lib/costPlan/quoteDoc';
import { copyText } from '../../../lib/clipboard';
import InsuranceBase from './InsuranceBase';
import { MenuItem, Popover, Row, Select, Seg, Switch, btnGhost, btnLink, btnPrimary, card, field, labelCls } from './ui';

/**
 * Hình thành giá 1 công: giá vốn + phí dịch vụ + thuế dự phòng (+ làm tròn).
 * Người dùng đã ghi giá ca 8h khác ở Bảng giá → phần tự tính chỉ còn để tham khảo, giá to là giá đang báo.
 */
export function PriceBuild({ data, result, eff, onGoCost, onResetDay }: {
  data: PlanData; result: PlanResult;
  /** Kết quả theo giá đang báo khách (có thể là giá ghi tay) */
  eff?: EffectiveResult;
  onGoCost: () => void;
  /** Bỏ giá ghi tay, dùng lại giá tự tính */
  onResetDay?: () => void;
}) {
  const s = data.settings;
  const manual = !!eff?.dayOverridden;
  const shown = manual ? eff! : result;
  return (
    <div className={`${card} p-5`}>
      <div className="flex items-baseline justify-between">
        <div className="text-[14px] font-semibold text-[#1d1d1f]">Giá 1 ngày công 8 giờ</div>
        <button type="button" onClick={onGoCost} className={btnLink + ' !text-[12px]'}>Sửa chi phí ở bước 1</button>
      </div>
      {manual && <div className="mt-1 text-[11.5px] text-[#86868b]">Bảng chi phí ở bước 1 chỉ để tham khảo — giá đang báo là số bạn ghi ở Bảng giá dịch vụ.</div>}
      <dl className={`mt-3 space-y-2 text-[13px] ${manual ? 'opacity-70' : ''}`}>
        <div className="flex justify-between"><dt className="text-[#6e6e73]">Chi phí lao động (giá vốn)</dt><dd className="font-medium tabular-nums">{fmt(result.costDaily)}</dd></div>
        <div className="flex justify-between"><dt className="text-[#6e6e73]">Phí dịch vụ</dt><dd className="font-semibold tabular-nums text-[#5e5ce6]">+{fmt(result.serviceFeeDaily)}</dd></div>
        {result.taxDaily > 0.5 && <div className="flex justify-between"><dt className="text-[#6e6e73]">Thuế TNDN dự phòng</dt><dd className="font-semibold tabular-nums text-[#c4620a]">+{fmt(result.taxDaily)}</dd></div>}
        {result.roundingGainDaily > 0.5 && <div className="flex justify-between"><dt className="text-[#6e6e73]">Làm tròn lên</dt><dd className="font-semibold tabular-nums text-[#c4620a]">+{fmt(result.roundingGainDaily)}</dd></div>}
        {result.separatedDaily > 0.5 && <div className="flex justify-between"><dt className="text-[#6e6e73]">Bảo hiểm thu riêng theo tháng</dt><dd className="font-semibold tabular-nums text-[#0a7d6e]">−{fmt(result.separatedDaily)}</dd></div>}
      </dl>
      {manual && (
        <div className="mt-2 flex justify-between text-[13px]"><span className="text-[#6e6e73]">= Giá tự tính (tham khảo)</span><span className="font-medium tabular-nums text-[#6e6e73]">{fmt(eff!.autoQuoteDaily)}</span></div>
      )}
      <div className="mt-3 pt-3 border-t border-[#f0f0f2] flex items-baseline justify-between gap-3">
        <div className="text-[12px] text-[#6e6e73]">
          {manual ? <b className="text-[#b25e00]">Giá đang báo khách (ghi tay)</b> : 'Giá báo khách'}
          {s.vatRate > 0 ? ` · đã VAT ${s.vatRate * 100}%: ${fmt(shown.quoteWithVatDaily)} đ` : ' · chưa VAT'}
        </div>
        <div className="flex items-baseline gap-1.5 shrink-0">
          <span className={`text-[34px] leading-none font-semibold tracking-tight tabular-nums ${manual ? 'text-[#b25e00]' : 'text-[#0071e3]'}`}>{fmt(shown.quoteDaily)}</span>
          <span className={`text-[16px] font-medium ${manual ? 'text-[#b25e00]/60' : 'text-[#0071e3]/60'}`}>đ / ngày</span>
        </div>
      </div>
      {manual && (
        <div className="mt-2 flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-[12.5px]">
          <span className={eff!.profitDaily < 0 ? 'text-[#d70015] font-semibold' : 'text-[#1d8a3b]'}>
            {eff!.profitDaily < 0 ? 'Lỗ' : 'Lợi nhuận'} {fmt(Math.abs(eff!.profitDaily))} đ/công theo giá này
            <span className="text-[#86868b] font-normal"> ({eff!.quoteDaily >= eff!.autoQuoteDaily ? '+' : '−'}{fmt(Math.abs(eff!.quoteDaily - eff!.autoQuoteDaily))} so với giá tự tính)</span>
          </span>
          {onResetDay && <button type="button" onClick={onResetDay} className={btnLink + ' !text-[12px]'}>Dùng lại giá tự tính</button>}
        </div>
      )}
      {result.separatedMonthly > 0 && (
        <div className="mt-2 text-right text-[12.5px] text-[#0a7d6e]">
          + Bảo hiểm thu riêng <b className="tabular-nums">{fmt(result.separatedMonthly)} đ/người/tháng</b> · NLĐ làm từ {result.separateMinDays} công/tháng
        </div>
      )}
    </div>
  );
}

const isInsuranceName = (name: string) => /bhxh|bhyt|bhtn|bao hiem/.test(normalizeText(name));

/**
 * Tách bảo hiểm khỏi giá ca 8h: khoản đánh dấu "thu riêng" vẫn là giá vốn nhưng không cộng vào giá ngày,
 * mà thành 1 dòng "/người/tháng" trên bảng giá — khách chỉ trả cho NLĐ làm đủ số công trong tháng (mặc định 14).
 */
export function InsuranceSplit({ data, result, readOnly, onPlan, minWage, onSettings }: {
  data: PlanData; result: PlanResult; readOnly?: boolean; onPlan: (d: PlanData) => void;
  /** Lương tối thiểu vùng của KCN — mặc định làm mức đóng BHXH */
  minWage?: { monthly: number; label: string } | null;
  onSettings?: (p: Partial<PlanData['settings']>) => void;
}) {
  const cands = data.lines.filter(l => !l.isBaseWage && !l.isServiceFee && !l.paidToWorker);
  const insLines = cands.filter(l => isInsuranceName(l.name));
  const on = data.lines.some(l => l.billSeparately);
  const minDays = data.settings.insuranceMinDays ?? 14;
  const insDaily = insLines.reduce((a, l) => a + (result.lines[l.id]?.daily ?? 0), 0);
  const mark = (ids: Set<string>, v: boolean) => onPlan({ ...data, lines: data.lines.map(l => (ids.has(l.id) ? { ...l, billSeparately: v || undefined } : l)) });
  const setOn = (v: boolean) => (v
    ? mark(new Set(insLines.map(l => l.id)), true)
    : mark(new Set(data.lines.filter(l => l.billSeparately).map(l => l.id)), false));

  return (
    <div className={`${card} p-5`}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold text-[#1d1d1f]">Bảo hiểm thu riêng theo tháng</div>
          <div className="text-[12px] text-[#86868b] leading-snug mt-0.5">
            {on ? `Không cộng vào giá ca 8h — khách trả riêng cho NLĐ làm từ ${minDays} công/tháng trở lên`
              : insLines.length ? <>Đang cộng <b className="text-[#1d1d1f]">{fmt(insDaily)} đ/công</b> bảo hiểm vào giá ca 8h. Bật để tách ra, khách trả riêng theo tháng cho NLĐ làm đủ công.</>
              : 'Bước 1 chưa có khoản bảo hiểm (BHXH, BHYT, BHTN) để tách.'}
          </div>
        </div>
        <Switch on={on} disabled={readOnly || (!on && !insLines.length)} onChange={setOn} />
      </div>
      {on && (
        <div className="mt-3 space-y-3">
          <div className="rounded-xl ring-1 ring-black/5 divide-y divide-[#f2f2f4]">
            {cands.map(l => (
              <label key={l.id} className={`flex items-center gap-2.5 px-3.5 py-2 text-[13px] ${readOnly ? '' : 'cursor-pointer'}`}>
                <input type="checkbox" className="accent-[#0a7d6e] w-4 h-4" disabled={readOnly} checked={!!l.billSeparately} onChange={e => mark(new Set([l.id]), e.target.checked)} />
                <span className="flex-1 min-w-0 truncate">{l.name || 'Khoản chưa đặt tên'}</span>
                <span className="text-[12px] tabular-nums text-[#6e6e73]">{fmt(result.lines[l.id]?.monthly ?? 0)}/tháng</span>
              </label>
            ))}
          </div>
          <div className="flex items-center gap-2 text-[13px] text-[#1d1d1f]">
            <span>Áp dụng cho NLĐ làm từ</span>
            <NumInput value={minDays} min={1} max={31} disabled={readOnly} onChange={n => onPlan({ ...data, settings: { ...data.settings, insuranceMinDays: Math.max(1, Math.min(31, n)) } })} className={`${field} !h-8 w-14 text-center font-semibold`} />
            <span>công/tháng trở lên</span>
          </div>
          <div className="rounded-xl bg-[#e9f7f4] px-3.5 py-2.5 text-[12.5px] text-[#0a5c51] leading-relaxed">
            Khách trả riêng <b className="tabular-nums">{fmt(result.separatedMonthly)} đ/người/tháng</b> · giá ca 8h còn <b className="tabular-nums">{fmt(result.quoteDaily)} đ</b> (đã bỏ {fmt(result.separatedDaily)} đ/công).
            Lợi nhuận không đổi — bảo hiểm thu bao nhiêu đóng bấy nhiêu.
          </div>
        </div>
      )}
      {onSettings && <InsuranceBase compact data={data} result={result} minWage={minWage} readOnly={readOnly} onSettings={onSettings} />}
    </div>
  );
}

const UNITS = ['VNĐ/ngày', 'VNĐ/giờ', 'VNĐ/tháng', 'VNĐ/suất'];

export function PriceTable({ data, result, readOnly, fileName, meta, planId, docDefaults, onQuote, onPlan, onPushCrm }: {
  data: PlanData; result: PlanResult; readOnly?: boolean; fileName: string;
  /** Tên khách / ngành / KCN để điền vào các ô {{ten_khach}}, {{nganh}}, {{kcn}} của file mẫu */
  meta?: { company?: string | null; industry?: string | null; zone?: string | null };
  planId?: string | null;
  /** Thông tin khách lấy sẵn từ hồ sơ CRM để điền vào báo giá PDF */
  docDefaults?: DocDefaults;
  onQuote: (q: QuoteSheet) => void;
  /** Cập nhật cả phương án (dùng khi sửa các trường của tài liệu báo giá) */
  onPlan: (d: PlanData) => void;
  onPushCrm?: () => void;
}) {
  const q = normalizeQuoteSheet(data.quote);
  const list = computePriceList(data, result);
  const included = q.includedNote ?? includedNoteAuto(data);
  const visible = list.rows.filter(r => !r.hidden);
  const hiddenRows = list.rows.filter(r => r.hidden);
  const [openId, setOpenId] = useState<string | null>(null);
  const [opts, setOpts] = useState(false);
  const [copied, setCopied] = useState<'ok' | 'fail' | null>(null);
  const [tplOpen, setTplOpen] = useState(false);
  const [docOpen, setDocOpen] = useState(false);

  const setRow = (id: string, p: Partial<QuoteRowCfg>) => onQuote({ ...q, rows: q.rows.map(r => (r.id === id ? { ...r, ...p } : r)) });
  const patch = (p: Partial<QuoteSheet>) => onQuote({ ...q, ...p });

  // ── Hoàn tác: các thao tác dễ bấm nhầm (xoá / ẩn / thêm / đổi thứ tự / bỏ cột thợ / khôi phục giá) lưu lại bảng trước đó ──
  const [history, setHistory] = useState<{ q: QuoteSheet; label: string }[]>([]);
  const commit = (next: QuoteSheet, label: string) => { setHistory(h => [...h.slice(-29), { q, label }]); onQuote(next); };
  const undo = () => {
    const last = history[history.length - 1];
    if (!last) return;
    setHistory(h => h.slice(0, -1));
    onQuote(last.q);
  };
  const undoRef = useRef(undo);
  undoRef.current = undo;
  useEffect(() => {
    if (readOnly) return;
    // Ctrl/⌘ + Z ngoài ô nhập = hoàn tác (trong ô nhập để trình duyệt tự hoàn tác chữ đang gõ)
    const h = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.key.toLowerCase() !== 'z') return;
      if ((e.target as HTMLElement | null)?.closest('input, textarea, select, [contenteditable="true"]')) return;
      e.preventDefault();
      undoRef.current();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [readOnly]);

  // ── Kéo thả để đổi thứ tự dòng ──
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const moveTo = (fromId: string, toId: string) => commit(moveQuoteRow(q, fromId, toId), 'Đổi thứ tự dòng');

  // ── Cột giá thợ tay nghề (ít dùng — bật mới hiện) ──
  const sk = q.skilled;
  const skOn = !!sk?.on && !!list.skilled;
  const baseLine = data.lines.find(l => l.isBaseWage);
  const feeLine = data.lines.find(l => l.isServiceFee);
  const setSkilled = (p: Partial<NonNullable<QuoteSheet['skilled']>>) => patch({ skilled: { on: true, label: DEFAULT_SKILLED_LABEL, wage: 0, wageUnit: 'month', serviceFee: null, ...sk, ...p } });
  const turnOnSkilled = () => setSkilled({
    on: true,
    // Lần đầu: lấy lương cơ bản phổ thông làm điểm bắt đầu để sửa
    ...(sk?.wage ? {} : { wage: baseLine?.value ?? 0, wageUnit: baseLine?.unit === 'day' ? 'day' : 'month' }),
  });

  const copy = async () => {
    setCopied((await copyText(priceListToTsv(list, included, q.generalNotes))) ? 'ok' : 'fail');
    setTimeout(() => setCopied(null), 1800);
  };
  const excel = async () => {
    const XLSX = await import('xlsx');
    const skLabel = list.skilled?.label;
    const aoa: (string | number)[][] = [skLabel
      ? ['STT', 'Nội dung đơn giá', 'Đơn vị tính', 'LĐ phổ thông (VNĐ)', `${skLabel} (VNĐ)`, 'Ghi chú']
      : ['STT', 'Nội dung đơn giá', 'Đơn vị tính', 'Đơn giá (VNĐ)', 'Ghi chú']];
    visible.forEach((r, i) => aoa.push(skLabel
      ? [i + 1, r.name, r.unit, r.price, r.skilled?.price ?? '', i === 0 ? included : r.note ?? '']
      : [i + 1, r.name, r.unit, r.price, i === 0 ? included : r.note ?? '']));
    const notes = q.generalNotes.split('\n').filter(Boolean);
    if (notes.length) aoa.push([], ['Ghi chú:'], ...notes.map(n => [`- ${n}`]));
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = skLabel ? [{ wch: 6 }, { wch: 52 }, { wch: 22 }, { wch: 18 }, { wch: 18 }, { wch: 60 }] : [{ wch: 6 }, { wch: 52 }, { wch: 22 }, { wch: 16 }, { wch: 60 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Bảng giá dịch vụ');
    XLSX.writeFile(wb, `Bang-gia-${fileName.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'dich-vu'}.xlsx`);
  };

  // Hàm trả JSX, KHÔNG phải component con: component khai báo trong render bị dựng lại sau mỗi phím gõ → ô giá mất con trỏ,
  // mỗi lần chỉ gõ được 1 chữ.
  const priceRow = (r: PriceRow, i: number) => {
    const custom = r.kind === 'custom';
    const exp = openId === r.id && !readOnly;
    return (
      <div key={r.id} data-qrow
        className={`group transition ${exp ? 'bg-[#fafafc]' : 'bg-white'} ${dragId === r.id ? 'opacity-40' : ''} ${overId === r.id && dragId && dragId !== r.id ? 'shadow-[inset_0_2px_0_#0071e3]' : ''}`}
        onDragOver={e => { if (!dragId) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (overId !== r.id) setOverId(r.id); }}
        onDrop={e => { e.preventDefault(); if (dragId && dragId !== r.id) moveTo(dragId, r.id); setDragId(null); setOverId(null); }}>
        <div className="flex flex-wrap sm:flex-nowrap items-center gap-x-3 gap-y-1.5 px-5 py-3">
          {readOnly ? (
            <span className="w-5 text-[12px] font-medium text-[#a1a1a6] tabular-nums">{i + 1}</span>
          ) : (
            <span draggable title="Kéo để đổi thứ tự"
              onDragStart={e => {
                setDragId(r.id); setOpenId(null);
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', r.id);
                const row = (e.currentTarget as HTMLElement).closest('[data-qrow]');
                if (row) e.dataTransfer.setDragImage(row, 24, 20);
              }}
              onDragEnd={() => { setDragId(null); setOverId(null); }}
              className="w-5 h-7 -ml-1 flex items-center justify-center rounded cursor-grab active:cursor-grabbing text-[12px] font-medium text-[#a1a1a6] tabular-nums hover:bg-[#f0f0f2]">
              <span className="group-hover:hidden">{i + 1}</span>
              <GripVertical size={14} className="hidden group-hover:block text-[#86868b]" />
            </span>
          )}
          <div className="min-w-0 flex-1 basis-[calc(100%-2rem)] sm:basis-0">
            <input value={r.name} disabled={readOnly} onChange={e => setRow(r.id, { name: e.target.value })} placeholder="Nội dung đơn giá"
              className="w-full bg-transparent text-[14px] font-medium text-[#1d1d1f] outline-none placeholder:text-[#a1a1a6] truncate" />
            <div className="text-[11.5px] text-[#86868b] truncate"><span className="font-medium text-[#6e6e73]">{r.unit}</span> · {r.formula}</div>
          </div>
          <div className="ml-auto flex items-center gap-2 sm:contents">
          {readOnly ? (
            <span className="w-[110px] text-right text-[15px] font-semibold tabular-nums text-[#0071e3]">{fmt(r.price)}</span>
          ) : (
            <MoneyInput value={r.price} onChange={n => setRow(r.id, { override: n })} title={skOn ? 'Lao động phổ thông' : undefined}
              className={`${skOn ? 'w-[100px]' : 'w-[110px]'} h-8 px-2 rounded-lg bg-transparent hover:bg-[#f5f5f7] focus:bg-white focus:ring-2 focus:ring-[#0071e3]/40 text-right text-[15px] font-semibold tabular-nums outline-none transition ${r.overridden ? 'text-[#b25e00]' : 'text-[#0071e3]'}`} />
          )}
          {skOn && r.skilled && (readOnly ? (
            <span className="w-[100px] text-right text-[15px] font-semibold tabular-nums text-[#7a4cc2]">{fmt(r.skilled.price)}</span>
          ) : (
            <MoneyInput value={r.skilled.price} onChange={n => setRow(r.id, { overrideSkilled: n })} title={`${list.skilled!.label} — ${r.skilled.formula}`}
              className={`w-[100px] h-8 px-2 rounded-lg bg-[#f6f1fd] hover:bg-[#efe6fb] focus:bg-white focus:ring-2 focus:ring-[#7a4cc2]/40 text-right text-[15px] font-semibold tabular-nums outline-none transition ${r.skilled.overridden ? 'text-[#b25e00]' : 'text-[#7a4cc2]'}`} />
          ))}
          {!readOnly && (
            <button type="button" onClick={() => setOpenId(exp ? null : r.id)} aria-label="Tuỳ chọn dòng"
              className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 transition ${exp ? 'bg-[#e8e8ed] text-[#1d1d1f]' : 'text-[#86868b] hover:bg-[#f0f0f2]'}`}><MoreHorizontal size={15} /></button>
          )}
          </div>
        </div>
        {exp && (
          <div className="px-5 pb-3.5 pl-[52px] flex flex-wrap items-end gap-x-4 gap-y-2">
            {custom && (
              <div className="w-36"><span className={labelCls}>Đơn vị tính</span>
                <Select value={r.unit} onChange={v => setRow(r.id, { unit: v })}>{[...new Set([r.unit, ...UNITS])].map(u => <option key={u}>{u}</option>)}</Select></div>
            )}
            <div className="flex items-center gap-1" title="Đổi thứ tự (trên máy tính có thể kéo số thứ tự)">
              <button type="button" disabled={i === 0} onClick={() => moveTo(r.id, visible[i - 1].id)} className="w-8 h-8 rounded-full flex items-center justify-center text-[#6e6e73] hover:bg-[#e8e8ed] disabled:opacity-30" aria-label="Lên"><ArrowUp size={15} /></button>
              <button type="button" disabled={i === visible.length - 1} onClick={() => moveTo(r.id, visible[i + 1].id)} className="w-8 h-8 rounded-full flex items-center justify-center text-[#6e6e73] hover:bg-[#e8e8ed] disabled:opacity-30" aria-label="Xuống"><ArrowDown size={15} /></button>
            </div>
            {r.overridden && <button type="button" onClick={() => commit({ ...q, rows: q.rows.map(x => (x.id === r.id ? { ...x, override: null } : x)) }, `Khôi phục giá “${r.name}”`)} className={btnLink}>Khôi phục giá tự tính ({fmt(r.auto ?? 0)})</button>}
            {skOn && r.skilled?.overridden && (
              <button type="button" onClick={() => commit({ ...q, rows: q.rows.map(x => (x.id === r.id ? { ...x, overrideSkilled: null } : x)) }, `Khôi phục giá thợ “${r.name}”`)} className={btnLink}>
                Khôi phục giá thợ {custom ? '(như phổ thông)' : `tự tính (${fmt(r.skilled.auto ?? 0)})`}
              </button>
            )}
            <button type="button" onClick={() => {
              setOpenId(null);
              commit(custom ? { ...q, rows: q.rows.filter(x => x.id !== r.id) } : { ...q, rows: q.rows.map(x => (x.id === r.id ? { ...x, hidden: true } : x)) },
                `${custom ? 'Xoá' : 'Ẩn'} dòng “${r.name || 'chưa đặt tên'}”`);
            }}
              className="text-[13px] font-medium text-[#d70015] hover:underline">{custom ? 'Xoá dòng' : 'Ẩn khỏi bảng giá'}</button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className={card}>
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4 pb-3">
        <div>
          <h3 className="text-[14px] font-semibold text-[#1d1d1f]">Bảng giá dịch vụ</h3>
          <div className="text-[12px] text-[#86868b]">Tự tính theo luật từ chi phí ở bước 1 · sửa tay được từng dòng</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setTplOpen(true)} className={btnPrimary}><FileText size={14} />Xem & xuất PDF</button>
          <button type="button" onClick={copy} className={btnGhost}>{copied === 'ok' ? <Check size={14} className="text-[#1d8a3b]" /> : <Copy size={14} />}{copied === 'ok' ? 'Đã copy' : copied === 'fail' ? 'Không copy được' : 'Sao chép'}</button>
          <button type="button" onClick={excel} className={btnGhost}><Download size={14} />Excel</button>
          <button type="button" onClick={() => setDocOpen(true)} className={btnGhost} title="Báo giá do app tự dàn trang (không theo file mẫu của công ty)"><FileSpreadsheet size={14} />Mẫu tự dựng</button>
          {onPushCrm && <button type="button" onClick={onPushCrm} className={btnGhost}><Upload size={14} />Đưa vào hồ sơ CRM</button>}
        </div>
      </div>

      {skOn ? (
        <div className="flex px-5 pb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-[#86868b]">
          <span className="pl-8 flex-1 hidden sm:block">Nội dung đơn giá · đơn vị tính</span>
          <span className="ml-auto flex gap-2 pr-9 sm:pr-[38px]"><span className="w-[100px] text-right">Phổ thông</span><span className="w-[100px] text-right text-[#7a4cc2] truncate">{list.skilled!.label}</span></span>
        </div>
      ) : (
        <div className="hidden sm:grid grid-cols-[1fr_auto] px-5 pb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-[#86868b]"><span className="pl-8">Nội dung đơn giá · đơn vị tính</span><span className="pr-10">Đơn giá (VNĐ)</span></div>
      )}
      <div className="divide-y divide-[#f2f2f4] border-t border-[#f2f2f4]">
        {visible.map((r, i) => priceRow(r, i))}
        {visible.length === 0 && <div className="px-5 py-6 text-[13px] text-[#86868b]">Chưa có dòng nào hiển thị.</div>}
      </div>

      {!readOnly && (
        <div className="px-5 py-2.5 border-t border-[#f2f2f4] flex items-center gap-4">
          <Popover align="left" width="w-80" button={({ toggle }) => (
            <button type="button" onClick={toggle} className="inline-flex items-center gap-1 text-[13px] font-medium text-[#0071e3] hover:text-[#0077ed]"><Plus size={14} />Thêm dòng</button>
          )}>
            {close => (
              <div className="py-1">
                {hiddenRows.map(r => <MenuItem key={r.id} onClick={() => { commit({ ...q, rows: q.rows.map(x => (x.id === r.id ? { ...x, hidden: false } : x)) }, `Hiện lại “${r.name}”`); close(); }}>Hiện lại: {r.name}</MenuItem>)}
                <MenuItem onClick={() => { const id = newLineId(); commit({ ...q, rows: [...q.rows, { id, kind: 'custom', name: 'Phụ cấp cơm trưa', unit: 'VNĐ/ngày', override: 0, hidden: false }] }, 'Thêm dòng'); setOpenId(id); close(); }}>Dòng tuỳ chỉnh (vd: phụ cấp cơm)</MenuItem>
              </div>
            )}
          </Popover>
          {history.length > 0 && (
            <button type="button" onClick={undo} title="Hoàn tác (Ctrl/⌘ + Z)"
              className="inline-flex items-center gap-1 min-w-0 text-[13px] font-medium text-[#b25e00] hover:underline">
              <Undo2 size={14} className="shrink-0" /><span className="truncate max-w-[260px]">Hoàn tác: {history[history.length - 1].label}</span>
            </button>
          )}
          {!skOn && (
            <button type="button" onClick={turnOnSkilled} className="ml-auto inline-flex items-center gap-1 text-[13px] font-medium text-[#7a4cc2] hover:underline">
              <Plus size={14} />Thêm cột giá thợ tay nghề
            </button>
          )}
        </div>
      )}

      {/* Cột thợ tay nghề: lương thợ (và phí DV riêng) → tự tính lại cả cột; ô nào cần thì ghi tay */}
      {skOn && sk && (
        <div className="border-t border-[#f2f2f4] bg-[#fbf8ff] px-5 py-3.5 space-y-3">
          <div className="flex items-center gap-2">
            <div className="text-[13px] font-semibold text-[#5b2d9e] flex-1">Cột giá {list.skilled!.label}</div>
            {!readOnly && <button type="button" onClick={() => commit({ ...q, skilled: { ...sk, on: false } }, 'Bỏ cột thợ')} className="text-[12.5px] font-medium text-[#d70015] hover:underline">Bỏ cột thợ</button>}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="block"><span className={labelCls}>Tên cột trên báo giá</span>
              <input disabled={readOnly} value={sk.label} onChange={e => setSkilled({ label: e.target.value })} className={`${field} !bg-white w-full`} /></label>
            <div><span className={labelCls}>Lương cơ bản của thợ</span>
              <div className="flex items-center gap-1.5">
                <MoneyInput value={sk.wage} disabled={readOnly} onChange={n => setSkilled({ wage: n })} className={`${field} !bg-white flex-1 min-w-0 text-right font-semibold`} />
                <div className="w-[104px] shrink-0"><Seg value={sk.wageUnit} disabled={readOnly} onChange={v => setSkilled({ wageUnit: v })} options={[{ value: 'month', label: '/tháng' }, { value: 'day', label: '/công' }]} /></div>
              </div>
              {baseLine && <div className="text-[11px] text-[#86868b] mt-1">Phổ thông: {fmt(baseLine.value)}{baseLine.unit === 'day' ? '/công' : '/tháng'}</div>}
            </div>
            <div><span className={labelCls}>Phí dịch vụ của thợ (đ/công)</span>
              <MoneyInput value={sk.serviceFee ?? 0} disabled={readOnly} onChange={n => setSkilled({ serviceFee: n > 0 ? n : null })}
                placeholder={`Như phổ thông (${fmt(feeLine && feeLine.mode === 'fixed' ? (feeLine.unit === 'day' ? feeLine.value : feeLine.value / data.settings.baseDays) : result.serviceFeeDaily)})`}
                className={`${field} !bg-white w-full text-right font-semibold`} />
              <div className="text-[11px] text-[#86868b] mt-1">Để trống = như lao động phổ thông</div>
            </div>
          </div>
          <div className={`text-[12.5px] ${list.skilled!.result.profitDaily < 0 ? 'text-[#d70015]' : 'text-[#5b2d9e]'}`}>
            Giá ca 8h thợ <b className="tabular-nums">{fmt(list.skilled!.result.quoteDaily)} đ</b> · {list.skilled!.result.profitDaily < 0 ? 'lỗ' : 'lợi nhuận'} <b className="tabular-nums">{fmt(Math.abs(list.skilled!.result.profitDaily))} đ/công</b>
            <span className="text-[#86868b]"> · BHXH, công đoàn, phép năm, tăng ca, ca đêm đều tính lại theo lương thợ</span>
          </div>
        </div>
      )}

      {/* Tuỳ chọn tăng ca */}
      <div className="border-t border-[#f2f2f4]">
        <button type="button" onClick={() => setOpts(o => !o)} className="w-full flex items-center gap-2 px-5 py-3 text-left">
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium text-[#1d1d1f]">Cách tính giờ tăng ca</div>
            {!opts && <div className="text-[11.5px] text-[#86868b]">Đơn giá giờ {fmt(list.shr)} đ ({q.otBase === 'base' ? 'lương cơ bản' : 'toàn bộ thu nhập NLĐ'} ÷ 8){q.otMarkupPct > 0 ? ` · +${q.otMarkupPct}%` : ''}</div>}
          </div>
          <ChevronRight size={15} className={`text-[#86868b] transition-transform ${opts ? 'rotate-90' : ''}`} />
        </button>
        {opts && (
          <div className="px-5 pb-3 divide-y divide-[#f2f2f4]">
            <div className="py-2.5">
              <div className="text-[13px] text-[#1d1d1f] mb-1.5">Tính trên <span className="text-[#86868b]">· đơn giá giờ chuẩn = {fmt(list.otBaseDaily)} ÷ 8 = {fmt(list.shr)} đ</span></div>
              <Seg value={q.otBase} disabled={readOnly} onChange={v => patch({ otBase: v })} options={[{ value: 'base', label: 'Lương cơ bản' }, { value: 'worker', label: 'Toàn bộ thu nhập NLĐ' }]} />
            </div>
            <Row label="Cộng thêm vào giá tăng ca" hint="0% = bán đúng bằng chi phí lương tăng ca">
              <span className="flex items-center gap-1"><NumInput value={q.otMarkupPct} step={0.5} max={200} disabled={readOnly} onChange={n => patch({ otMarkupPct: n })} className={`${field} w-16 text-right font-semibold`} /><span className="text-[12px] text-[#86868b]">%</span></span>
            </Row>
            <Row label="Tăng ca đêm liền sau ca ngày" hint="Hệ số 210% thay vì 200% (Điều 57 NĐ 145/2020)"><Switch on={q.nightOtAfterDay} disabled={readOnly} onChange={v => patch({ nightOtAfterDay: v })} /></Row>
          </div>
        )}
      </div>
      {docOpen && <QuoteDocDialog data={data} result={result} meta={meta} planId={planId} defaults={docDefaults} readOnly={readOnly} onChange={onPlan} onClose={() => setDocOpen(false)} />}
      {tplOpen && <QuoteTemplateDialog data={data} result={result} meta={meta} planTitle={fileName} planId={planId} defaults={docDefaults} readOnly={readOnly} onChange={onPlan} onClose={() => setTplOpen(false)} />}
    </div>
  );
}

/** "Bao gồm" + "Lưu ý chung" in trên bảng báo giá. */
export function QuoteNotes({ data, readOnly, onQuote }: { data: PlanData; readOnly?: boolean; onQuote: (q: QuoteSheet) => void }) {
  const q = normalizeQuoteSheet(data.quote);
  const auto = includedNoteAuto(data);
  const custom = q.includedNote != null && q.includedNote !== auto;
  return (
    <div className={`${card} p-5 space-y-4`}>
      <div>
        <div className="flex items-baseline justify-between"><label className={labelCls}>Ghi chú cạnh dòng giá ngày (đơn giá đã bao gồm)</label>
          {custom && !readOnly && <button type="button" onClick={() => onQuote({ ...q, includedNote: null })} className={btnLink + ' !text-[12px]'}>Dùng lại bản tự động</button>}</div>
        <textarea rows={2} value={q.includedNote ?? auto} disabled={readOnly} onChange={e => onQuote({ ...q, includedNote: e.target.value })} className={`${field} !h-auto w-full py-2.5 leading-relaxed resize-y`} />
      </div>
      <div>
        <label className={labelCls}>Lưu ý chung trên báo giá (mỗi dòng 1 ý)</label>
        <textarea rows={4} value={q.generalNotes} disabled={readOnly} onChange={e => onQuote({ ...q, generalNotes: e.target.value })} className={`${field} !h-auto w-full py-2.5 leading-relaxed resize-y`} />
      </div>
    </div>
  );
}

