import { useState } from 'react';
import { AlertTriangle, ArrowRight, Check, ChevronRight, Info } from 'lucide-react';
import { computePlan, solveServiceFee } from '../../../lib/costPlan/engine';
import type { CostLine, PlanData, PlanResult, PlanSettings, RoundTo, TaxOption } from '../../../lib/costPlan/types';
import { MoneyInput, NumInput, fmt, fmtD, fmtShort } from './fields';
import type { LegalItem } from '../../../lib/costPlan/legal';
import { secOf, type Sec } from './CostSections';
import { Row, Select, btnPrimary, card, field } from './ui';

const TAX_LABEL: Record<TaxOption, string> = {
  profit20: '20% trên Phí DV',
  total20: '20% trên toàn bộ giá',
  none: 'Không tính',
};

/** BƯỚC 1 — tổng chi phí 1 lao động (giá vốn), chia theo nhóm bằng một thanh tỷ lệ. */
export function CostTotalCard({ data, result, ready, onNext }: {
  data: PlanData; result: PlanResult; ready: boolean; onNext?: () => void;
}) {
  const part = (sec: Sec) => data.lines.filter(l => secOf(l) === sec).reduce((s, l) => s + (result.lines[l.id]?.daily ?? 0), 0);
  const parts = [
    { label: 'Trả trực tiếp cho người lao động', v: part('worker'), c: '#0071e3' },
    { label: 'Bảo hiểm & chế độ', v: part('compliance'), c: '#34c759' },
    { label: 'Chi phí khác', v: part('other'), c: '#8e8e93' },
  ];
  const total = result.costDaily;
  return (
    <div className={`${card} p-5`}>
      <div className="text-[12px] font-medium text-[#6e6e73]">Tổng chi phí 1 lao động · 1 công</div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className="text-[40px] leading-none font-semibold tracking-tight text-[#0071e3] tabular-nums">{fmt(total)}</span>
        <span className="text-[18px] font-medium text-[#0071e3]/60">đ</span>
      </div>
      <div className="mt-1.5 text-[12px] text-[#86868b]">≈ {fmt(total * data.settings.baseDays)} đ / lao động / tháng ({data.settings.baseDays} công)</div>

      {total > 0 && (
        <div className="mt-4 flex h-1.5 rounded-full overflow-hidden bg-[#f0f0f2]">
          {parts.map(p => p.v > 0 && <div key={p.label} style={{ width: `${(p.v / total) * 100}%`, background: p.c }} />)}
        </div>
      )}
      <dl className="mt-3 space-y-1.5 text-[13px]">
        {parts.map(p => (
          <div key={p.label} className="flex items-center justify-between gap-3">
            <dt className="flex items-center gap-2 text-[#6e6e73] min-w-0"><span className="w-2 h-2 rounded-full shrink-0" style={{ background: p.c }} /><span className="truncate">{p.label}</span></dt>
            <dd className="font-semibold tabular-nums" style={{ color: p.c }}>{fmt(p.v)}</dd>
          </div>
        ))}
      </dl>

      {onNext && (
        <div className="mt-5 pt-4 border-t border-[#f0f0f2]">
          <button type="button" onClick={onNext} disabled={!ready} className={`${btnPrimary} w-full !h-10 !text-[14px]`}>Lập bảng báo giá <ArrowRight size={15} /></button>
          {!ready && <div className="mt-2 text-[11.5px] text-center text-[#86868b]">Cần có dòng Lương cơ bản để tính tiếp.</div>}
        </div>
      )}
    </div>
  );
}

/** BƯỚC 1 — đối chiếu các khoản bắt buộc theo luật; thiếu thì có nút thêm nhanh. */
export function LegalCard({ items, readOnly, onAdd }: {
  items: LegalItem[]; readOnly?: boolean; onAdd: (l: CostLine) => void;
}) {
  const required = items.filter(i => i.required);
  const extra = items.filter(i => !i.required);
  const done = required.filter(i => i.status === 'ok').length;
  const Item = ({ i }: { i: LegalItem }) => (
    <li className="flex items-start gap-2.5 py-2">
      <span className={`mt-0.5 w-[18px] h-[18px] rounded-full flex items-center justify-center shrink-0 ${i.status === 'ok' ? 'bg-[#34c759] text-white' : i.status === 'missing' ? 'bg-[#fff4e5] text-[#b25e00]' : 'bg-[#f0f0f2] text-[#86868b]'}`}>
        {i.status === 'ok' ? <Check size={11} strokeWidth={3} /> : <span className="text-[11px] font-bold leading-none">{i.status === 'missing' ? '!' : '?'}</span>}
      </span>
      <div className="min-w-0 flex-1">
        <div className={`text-[13px] leading-snug ${i.status === 'ok' ? 'text-[#1d1d1f]' : 'text-[#1d1d1f] font-medium'}`}>{i.label}</div>
        <div className="text-[11.5px] text-[#86868b]">{i.basis}</div>
      </div>
      {!readOnly && i.status === 'missing' && i.fix && <button type="button" onClick={() => onAdd(i.fix!)} className="text-[12px] font-medium text-[#0071e3] hover:text-[#0077ed] whitespace-nowrap mt-0.5">Thêm</button>}
    </li>
  );
  return (
    <div className={`${card} p-5`}>
      <div className="flex items-baseline justify-between">
        <div className="text-[13px] font-semibold text-[#1d1d1f]">Kiểm tra theo luật</div>
        <div className={`text-[12px] font-medium ${done === required.length ? 'text-[#1d8a3b]' : 'text-[#b25e00]'}`}>{done}/{required.length} bắt buộc</div>
      </div>
      <ul className="mt-1 divide-y divide-[#f2f2f4]">{required.map(i => <Item key={i.id} i={i} />)}</ul>
      {extra.length > 0 && (
        <>
          <div className="mt-3 text-[10.5px] font-semibold uppercase tracking-wide text-[#86868b]">Theo đặc thù ngành</div>
          <ul className="divide-y divide-[#f2f2f4]">{extra.map(i => <Item key={i.id} i={i} />)}</ul>
        </>
      )}
    </div>
  );
}

/** BƯỚC 2 — lợi nhuận tháng theo quy mô: số lao động × số công = tổng công, từ đó ra doanh thu, chi phí, thuế, lợi nhuận. */
export function ProfitCard({ data, result, readOnly, onChange }: {
  data: PlanData; result: PlanResult; readOnly?: boolean; onChange: (p: Partial<PlanSettings>) => void;
}) {
  const s = data.settings;
  const md = result.totalManDays;
  const rows: { label: string; v: string; c?: string; bold?: boolean }[] = [
    { label: 'Doanh thu', v: fmtShort(result.revenueMonthly), c: '#0071e3', bold: true },
    { label: 'Chi phí lao động (giá vốn)', v: fmtShort(result.costDaily * md) },
    ...(result.taxDaily > 0.5 ? [{ label: 'Thuế TNDN dự phòng', v: fmtShort(result.taxDaily * md), c: '#c4620a' }] : []),
    { label: 'Lợi nhuận mỗi công', v: `${fmt(result.profitDaily)} đ`, c: '#1d8a3b' },
  ];
  return (
    <div className={`${card} p-5`}>
      <div className="flex items-center justify-between">
        <div className="text-[12px] font-medium text-[#6e6e73]">Lợi nhuận / tháng</div>
        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${result.marginPct < 5 ? 'bg-[#fff4e5] text-[#b25e00]' : 'bg-[#e8f8ed] text-[#1d8a3b]'}`}>biên {result.marginPct.toFixed(1).replace('.', ',')}%</span>
      </div>
      <div className="mt-1 text-[36px] leading-tight font-semibold tracking-tight text-[#1d8a3b] tabular-nums" title={fmtD(result.profitMonthly)}>{fmtShort(result.profitMonthly)}</div>

      {/* Quy mô: lao động × công = tổng công */}
      <div className="mt-4 rounded-xl bg-[#f5f5f7] px-3.5 py-3">
        <div className="flex items-center text-[12px] text-[#6e6e73]">
          <span className="flex items-center gap-1.5 whitespace-nowrap">
            <NumInput value={s.workers} min={1} max={5000} disabled={readOnly} onChange={n => onChange({ workers: Math.max(1, n) })} className={`${field} !h-8 w-16 !bg-white text-center !text-[14px] font-semibold`} />
            <span>người ×</span>
            <NumInput value={s.simDays} min={1} max={31} disabled={readOnly} onChange={n => onChange({ simDays: Math.max(1, n) })} className={`${field} !h-8 w-14 !bg-white text-center !text-[14px] font-semibold`} />
            <span>công</span>
          </span>
        </div>
        <div className="mt-2 flex items-baseline justify-between">
          <span className="text-[12px] font-medium text-[#6e6e73]">= Tổng ngày công / tháng</span>
          <span className="text-[24px] leading-none font-semibold tracking-tight tabular-nums text-[#5e5ce6]">{fmt(md)}<span className="ml-1 text-[13px] font-medium text-[#5e5ce6]/70">công</span></span>
        </div>
      </div>

      <dl className="mt-3.5 space-y-1.5 text-[13px]">
        {rows.map(r => (
          <div key={r.label} className="flex items-center justify-between gap-3">
            <dt className="text-[#6e6e73]">{r.label}</dt>
            <dd className={`tabular-nums ${r.bold ? 'font-semibold' : 'font-medium'}`} style={{ color: r.c ?? '#1d1d1f' }}>{r.v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Cài đặt tính giá — thu gọn mặc định, chỉ hiện 1 dòng tóm tắt. */
export function SettingsCard({ settings, readOnly, onChange }: {
  settings: PlanSettings; readOnly?: boolean; onChange: (p: Partial<PlanSettings>) => void;
}) {
  const [open, setOpen] = useState(false);
  const summary = `${settings.baseDays} công · Thuế ${TAX_LABEL[settings.taxOption].toLowerCase()}${settings.vatRate ? ` · VAT ${settings.vatRate * 100}%` : ''}${settings.roundTo ? ` · tròn ${settings.roundTo.toLocaleString('vi-VN')}` : ''}`;
  return (
    <div className={card}>
      <button type="button" onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-2 px-5 py-3.5 text-left">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-[#1d1d1f]">Cài đặt tính giá</div>
          {!open && <div className="text-[11.5px] text-[#86868b] truncate">{summary}</div>}
        </div>
        <ChevronRight size={15} className={`text-[#86868b] transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && (
        <div className="px-5 pb-3 divide-y divide-[#f2f2f4] border-t border-[#f2f2f4]">
          <Row label="Công chuẩn / tháng" hint="Quy đổi giữa công và tháng">
            <NumInput value={settings.baseDays} min={1} max={31} disabled={readOnly} onChange={n => onChange({ baseDays: Math.max(1, n) })} className={`${field} w-16 text-center font-semibold`} />
          </Row>
          <Row label="Thuế TNDN dự phòng">
            <Select value={settings.taxOption} disabled={readOnly} onChange={v => onChange({ taxOption: v as TaxOption })} className="w-44">
              {(Object.keys(TAX_LABEL) as TaxOption[]).map(k => <option key={k} value={k}>{TAX_LABEL[k]}</option>)}
            </Select>
          </Row>
          <Row label="VAT" hint="Chỉ để hiển thị giá đã VAT">
            <Select value={settings.vatRate} disabled={readOnly} onChange={v => onChange({ vatRate: Number(v) as PlanSettings['vatRate'] })} className="w-44">
              <option value={0}>Chưa VAT</option><option value={0.08}>8%</option><option value={0.1}>10%</option>
            </Select>
          </Row>
          <Row label="Làm tròn giá báo" hint="Làm tròn lên, phần dôi ra vào lợi nhuận">
            <Select value={settings.roundTo} disabled={readOnly} onChange={v => onChange({ roundTo: Number(v) as RoundTo })} className="w-44">
              <option value={0}>Không</option><option value={100}>100 đ</option><option value={500}>500 đ</option><option value={1000}>1.000 đ</option>
            </Select>
          </Row>
        </div>
      )}
    </div>
  );
}

/** "Khách chốt giá…" — bài toán ngược: giá khách muốn trả → Phí DV và lợi nhuận còn lại. */
export function NegotiateCard({ data, result, onApplyLine }: {
  data: PlanData; result: PlanResult; onApplyLine: (l: CostLine) => void;
}) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState(0);
  const solved = target > 0 ? solveServiceFee(data, target) : null;
  const solvedResult = solved ? computePlan({ ...data, lines: data.lines.map(l => (l.id === solved.id ? solved : l)) }) : null;
  const noFee = !data.lines.some(l => l.isServiceFee);

  return (
    <div className={card}>
      <button type="button" onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-2 px-5 py-3.5 text-left">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-[#1d1d1f]">Khách chốt giá…</div>
          {!open && <div className="text-[11.5px] text-[#86868b]">Nhập giá khách muốn để xem phí DV còn lại</div>}
        </div>
        <ChevronRight size={15} className={`text-[#86868b] transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && (
        <div className="px-5 pb-4 border-t border-[#f2f2f4] pt-3 space-y-2.5">
          <div className="flex items-center gap-2">
            <MoneyInput value={target} onChange={setTarget} placeholder={fmt(result.quoteDaily)} className={`${field} flex-1 text-right font-semibold`} />
            <span className="text-[12px] text-[#86868b] whitespace-nowrap">đ / công</span>
          </div>
          {target > 0 && (noFee ? <div className="text-[12px] text-[#6e6e73]">Cần có 1 dòng Phí DV để tính ngược.</div>
            : solved && solvedResult ? (
              <div className="space-y-2">
                <div className="text-[13px] text-[#1d1d1f]">Phí DV còn <b>{fmtD(solved.value)}</b>/công <span className="text-[#86868b]">({solved.value - result.serviceFeeDaily >= 0 ? '+' : '−'}{fmt(Math.abs(solved.value - result.serviceFeeDaily))} so với hiện tại)</span></div>
                <div className="text-[13px] text-[#1d1d1f]">Lợi nhuận <b>{fmtShort(solvedResult.profitMonthly)}</b>/tháng · biên <b>{solvedResult.marginPct.toFixed(1).replace('.', ',')}%</b></div>
                <button type="button" onClick={() => { onApplyLine(solved); setTarget(0); }} className={btnPrimary}>Áp dụng phí DV này</button>
              </div>
            ) : <div className="text-[12px] text-[#d70015]">Thấp hơn cả chi phí trực tiếp — không còn chỗ cho Phí DV.</div>)}
        </div>
      )}
    </div>
  );
}

const ICON = { error: AlertTriangle, warn: AlertTriangle, info: Info } as const;
const TONE = {
  error: 'bg-[#fff1f0] text-[#b3140a]',
  warn: 'bg-[#fff8e6] text-[#8a5a00]',
  info: 'bg-[#eef5ff] text-[#0b5cc4]',
} as const;

export function Warnings({ result }: { result: PlanResult }) {
  const list = result.warnings.filter(w => !w.lineId || w.level !== 'info').slice(0, 4);
  if (!list.length) return null;
  return (
    <div className="space-y-2">
      {list.map((w, i) => {
        const Icon = ICON[w.level];
        return <div key={i} className={`flex gap-2 rounded-xl px-3.5 py-2.5 text-[12px] leading-snug ${TONE[w.level]}`}><Icon size={14} className="shrink-0 mt-px" /><span>{w.text}</span></div>;
      })}
    </div>
  );
}
