// BƯỚC 2 — Báo giá khách: từ chi phí ở bước 1 → giá 1 công → "Bảng giá dịch vụ" theo đúng luật (ngày, ca đêm, tăng ca…).
import { useState } from 'react';
import { Check, ChevronRight, Copy, Download, FileSpreadsheet, FileText, MoreHorizontal, Plus, Upload } from 'lucide-react';
import { newLineId } from '../../../lib/costPlan/engine';
import {
  computePriceList, includedNoteAuto, normalizeQuoteSheet, priceListToTsv, type PriceRow,
} from '../../../lib/costPlan/quoteSheet';
import type { PlanData, PlanResult, QuoteRowCfg, QuoteSheet } from '../../../lib/costPlan/types';
import { MoneyInput, NumInput, fmt } from './fields';
import QuoteTemplateDialog from './QuoteTemplateDialog';
import QuoteDocDialog from './QuoteDocDialog';
import type { DocDefaults } from '../../../lib/costPlan/quoteDoc';
import { MenuItem, Popover, Row, Select, Seg, Switch, btnGhost, btnLink, btnPrimary, card, field, labelCls } from './ui';

/** Hình thành giá 1 công: giá vốn + phí dịch vụ + thuế dự phòng (+ làm tròn). */
export function PriceBuild({ data, result, onGoCost }: { data: PlanData; result: PlanResult; onGoCost: () => void }) {
  const s = data.settings;
  return (
    <div className={`${card} p-5`}>
      <div className="flex items-baseline justify-between">
        <div className="text-[14px] font-semibold text-[#1d1d1f]">Giá 1 ngày công 8 giờ</div>
        <button type="button" onClick={onGoCost} className={btnLink + ' !text-[12px]'}>Sửa chi phí ở bước 1</button>
      </div>
      <dl className="mt-3 space-y-2 text-[13px]">
        <div className="flex justify-between"><dt className="text-[#6e6e73]">Chi phí lao động (giá vốn)</dt><dd className="font-medium tabular-nums">{fmt(result.costDaily)}</dd></div>
        <div className="flex justify-between"><dt className="text-[#6e6e73]">Phí dịch vụ</dt><dd className="font-semibold tabular-nums text-[#5e5ce6]">+{fmt(result.serviceFeeDaily)}</dd></div>
        {result.taxDaily > 0.5 && <div className="flex justify-between"><dt className="text-[#6e6e73]">Thuế TNDN dự phòng</dt><dd className="font-semibold tabular-nums text-[#c4620a]">+{fmt(result.taxDaily)}</dd></div>}
        {result.roundingGainDaily > 0.5 && <div className="flex justify-between"><dt className="text-[#6e6e73]">Làm tròn lên</dt><dd className="font-semibold tabular-nums text-[#c4620a]">+{fmt(result.roundingGainDaily)}</dd></div>}
      </dl>
      <div className="mt-3 pt-3 border-t border-[#f0f0f2] flex items-baseline justify-between gap-3">
        <div className="text-[12px] text-[#6e6e73]">Giá báo khách{s.vatRate > 0 ? ` · đã VAT ${s.vatRate * 100}%: ${fmt(result.quoteWithVatDaily)} đ` : ' · chưa VAT'}</div>
        <div className="flex items-baseline gap-1.5 shrink-0">
          <span className="text-[34px] leading-none font-semibold tracking-tight tabular-nums text-[#0071e3]">{fmt(result.quoteDaily)}</span>
          <span className="text-[16px] font-medium text-[#0071e3]/60">đ / ngày</span>
        </div>
      </div>
    </div>
  );
}

/** Copy vào clipboard; trình duyệt chặn clipboard API thì thử cách cũ (execCommand). */
async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* thử cách cũ */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch { return false; }
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

  const copy = async () => {
    setCopied((await copyText(priceListToTsv(list, included, q.generalNotes))) ? 'ok' : 'fail');
    setTimeout(() => setCopied(null), 1800);
  };
  const excel = async () => {
    const XLSX = await import('xlsx');
    const aoa: (string | number)[][] = [['STT', 'Nội dung đơn giá', 'Đơn vị tính', 'Đơn giá (VNĐ)', 'Ghi chú']];
    visible.forEach((r, i) => aoa.push([i + 1, r.name, r.unit, r.price, i === 0 ? included : '']));
    const notes = q.generalNotes.split('\n').filter(Boolean);
    if (notes.length) aoa.push([], ['Ghi chú:'], ...notes.map(n => [`- ${n}`]));
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 6 }, { wch: 52 }, { wch: 22 }, { wch: 16 }, { wch: 60 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Bảng giá dịch vụ');
    XLSX.writeFile(wb, `Bang-gia-${fileName.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'dich-vu'}.xlsx`);
  };

  const PriceRowView = ({ r, i }: { r: PriceRow; i: number }) => {
    const custom = r.kind === 'custom';
    const exp = openId === r.id && !readOnly;
    return (
      <div className={exp ? 'bg-[#fafafc]' : ''}>
        <div className="flex flex-wrap sm:flex-nowrap items-center gap-x-3 gap-y-1.5 px-5 py-3">
          <span className="w-5 text-[12px] font-medium text-[#a1a1a6] tabular-nums">{i + 1}</span>
          <div className="min-w-0 flex-1 basis-[calc(100%-2rem)] sm:basis-0">
            <input value={r.name} disabled={readOnly} onChange={e => setRow(r.id, { name: e.target.value })} placeholder="Nội dung đơn giá"
              className="w-full bg-transparent text-[14px] font-medium text-[#1d1d1f] outline-none placeholder:text-[#a1a1a6] truncate" />
            <div className="text-[11.5px] text-[#86868b] truncate"><span className="font-medium text-[#6e6e73]">{r.unit}</span> · {r.formula}</div>
          </div>
          <div className="ml-auto flex items-center gap-2 sm:contents">
          {readOnly ? (
            <span className="w-[110px] text-right text-[15px] font-semibold tabular-nums text-[#0071e3]">{fmt(r.price)}</span>
          ) : (
            <MoneyInput value={r.price} onChange={n => setRow(r.id, { override: n })}
              className={`w-[110px] h-8 px-2 rounded-lg bg-transparent hover:bg-[#f5f5f7] focus:bg-white focus:ring-2 focus:ring-[#0071e3]/40 text-right text-[15px] font-semibold tabular-nums outline-none transition ${r.overridden ? 'text-[#b25e00]' : 'text-[#0071e3]'}`} />
          )}
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
            {r.overridden && <button type="button" onClick={() => setRow(r.id, { override: null })} className={btnLink}>Khôi phục giá tự tính ({fmt(r.auto ?? 0)})</button>}
            <button type="button" onClick={() => (custom ? onQuote({ ...q, rows: q.rows.filter(x => x.id !== r.id) }) : setRow(r.id, { hidden: true }))}
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

      <div className="hidden sm:grid grid-cols-[1fr_auto] px-5 pb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-[#86868b]"><span className="pl-8">Nội dung đơn giá · đơn vị tính</span><span className="pr-10">Đơn giá (VNĐ)</span></div>
      <div className="divide-y divide-[#f2f2f4] border-t border-[#f2f2f4]">
        {visible.map((r, i) => <PriceRowView key={r.id} r={r} i={i} />)}
        {visible.length === 0 && <div className="px-5 py-6 text-[13px] text-[#86868b]">Chưa có dòng nào hiển thị.</div>}
      </div>

      {!readOnly && (
        <div className="px-5 py-2.5 border-t border-[#f2f2f4] flex items-center gap-4">
          <Popover align="left" width="w-80" button={({ toggle }) => (
            <button type="button" onClick={toggle} className="inline-flex items-center gap-1 text-[13px] font-medium text-[#0071e3] hover:text-[#0077ed]"><Plus size={14} />Thêm dòng</button>
          )}>
            {close => (
              <div className="py-1">
                {hiddenRows.map(r => <MenuItem key={r.id} onClick={() => { setRow(r.id, { hidden: false }); close(); }}>Hiện lại: {r.name}</MenuItem>)}
                <MenuItem onClick={() => { const id = newLineId(); onQuote({ ...q, rows: [...q.rows, { id, kind: 'custom', name: 'Phụ cấp cơm trưa', unit: 'VNĐ/ngày', override: 0, hidden: false }] }); setOpenId(id); close(); }}>Dòng tuỳ chỉnh (vd: phụ cấp cơm)</MenuItem>
              </div>
            )}
          </Popover>
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

