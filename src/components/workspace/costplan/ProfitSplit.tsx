import { useRef } from 'react';
import type { PlanResult, PlanSettings } from '../../../lib/costPlan/types';
import { NumInput, fmt, fmtD, fmtShort } from './fields';
import { card, field } from './ui';

const COMPANY = '#0071e3';
const BRANCH = '#34c759';

/**
 * Chia lợi nhuận Công ty ⇄ Chi nhánh bằng thanh KÉO THẢ (chuột hoặc ngón tay; phím ← → khi đã chọn tay cầm).
 * Chỉnh một bên thì bên còn lại tự bù cho đủ 100%.
 */
export default function ProfitSplit({ settings, result, readOnly, onChange, branchLabel, branchKhoan }: {
  settings: PlanSettings;
  result: PlanResult;
  readOnly?: boolean;
  onChange: (p: Partial<PlanSettings>) => void;
  branchLabel?: string | null;
  branchKhoan?: { lgPct: number; cnPct: number; label: string } | null;
}) {
  const bar = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const pct = Math.min(100, Math.max(0, Math.round(settings.companyPct)));

  const setFromX = (clientX: number) => {
    const el = bar.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return;
    onChange({ companyPct: Math.min(100, Math.max(0, Math.round(((clientX - rect.left) / rect.width) * 100))) });
  };

  const presets = [100, 70, 50, 30, 0];
  const khoanOk = !!branchKhoan && branchKhoan.lgPct + branchKhoan.cnPct === 100;

  return (
    <div className={`${card} p-5`}>
      <div className="flex items-baseline justify-between">
        <div className="text-[13px] font-semibold text-[#1d1d1f]">Chia lợi nhuận</div>
        <div className="text-[11.5px] text-[#86868b]">{readOnly ? 'Chỉ xem' : 'Kéo để chia'}</div>
      </div>

      {/* Thanh kéo */}
      <div className="px-2.5 pt-6 pb-1 select-none">
        <div
          ref={bar}
          className={`relative h-2 rounded-full touch-none ${readOnly ? '' : 'cursor-pointer'}`}
          style={{ background: BRANCH }}
          onPointerDown={e => {
            if (readOnly) return;
            dragging.current = true;
            (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
            setFromX(e.clientX);
          }}
          onPointerMove={e => { if (dragging.current) setFromX(e.clientX); }}
          onPointerUp={e => { dragging.current = false; (e.currentTarget as HTMLDivElement).releasePointerCapture?.(e.pointerId); }}
          onPointerCancel={() => { dragging.current = false; }}
        >
          <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${pct}%`, background: COMPANY }} />
          {!readOnly && (
            <div
              role="slider" tabIndex={0} aria-label="Tỷ lệ lợi nhuận về công ty" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}
              onKeyDown={e => {
                const step = e.shiftKey ? 10 : 1;
                if (e.key === 'ArrowLeft') { e.preventDefault(); onChange({ companyPct: Math.max(0, pct - step) }); }
                if (e.key === 'ArrowRight') { e.preventDefault(); onChange({ companyPct: Math.min(100, pct + step) }); }
              }}
              className="absolute top-1/2 w-7 h-7 -ml-3.5 -mt-3.5 rounded-full bg-white outline-none shadow-[0_1px_4px_rgba(0,0,0,0.35),0_0_0_0.5px_rgba(0,0,0,0.08)] focus-visible:ring-4 ring-[#0071e3]/30"
              style={{ left: `${pct}%` }}
            />
          )}
        </div>
      </div>

      {/* Hai phần chia */}
      <div className="mt-4 grid grid-cols-2 gap-4">
        <div>
          <div className="flex items-center gap-1.5 text-[12px] text-[#6e6e73]"><span className="w-2 h-2 rounded-full" style={{ background: COMPANY }} />Công ty</div>
          <div className="mt-1 flex items-baseline gap-1">
            <NumInput value={pct} max={100} disabled={readOnly} onChange={n => onChange({ companyPct: n })} className={`${field} !h-8 w-14 text-right !text-[15px] font-semibold`} />
            <span className="text-[13px] text-[#86868b]">%</span>
          </div>
          <div className="mt-1.5 text-[22px] leading-tight font-semibold tracking-tight tabular-nums" style={{ color: COMPANY }} title={fmtD(result.companyProfit)}>{fmtShort(result.companyProfit)}</div>
          <div className="text-[11px] text-[#86868b]">/ tháng · {fmt(result.companyPerDay)} đ/công</div>
        </div>
        <div>
          <div className="flex items-center gap-1.5 text-[12px] text-[#6e6e73] min-w-0"><span className="w-2 h-2 rounded-full shrink-0" style={{ background: BRANCH }} /><span className="truncate">{branchLabel || 'Chi nhánh'}</span></div>
          <div className="mt-1 flex items-baseline gap-1">
            <NumInput value={100 - pct} max={100} disabled={readOnly} onChange={n => onChange({ companyPct: 100 - n })} className={`${field} !h-8 w-14 text-right !text-[15px] font-semibold`} />
            <span className="text-[13px] text-[#86868b]">%</span>
          </div>
          <div className="mt-1.5 text-[22px] leading-tight font-semibold tracking-tight tabular-nums" style={{ color: '#1d8a3b' }} title={fmtD(result.branchProfit)}>{fmtShort(result.branchProfit)}</div>
          <div className="text-[11px] text-[#86868b]">/ tháng · {fmt(result.branchPerDay)} đ/công</div>
        </div>
      </div>

      {!readOnly && (
        <div className="mt-4 pt-3 border-t border-[#f0f0f2] flex flex-wrap items-center gap-1.5">
          {presets.map(v => (
            <button key={v} type="button" onClick={() => onChange({ companyPct: v })}
              className={`h-7 px-2.5 rounded-full text-[12px] font-medium transition ${pct === v ? 'bg-[#1d1d1f] text-white' : 'bg-[#f5f5f7] text-[#1d1d1f] hover:bg-[#e8e8ed]'}`}>{v}/{100 - v}</button>
          ))}
          {khoanOk && (
            <button type="button" onClick={() => onChange({ companyPct: branchKhoan!.lgPct })} title={branchKhoan!.label}
              className="h-7 px-2.5 rounded-full text-[12px] font-medium bg-[#eef5ff] text-[#0071e3] hover:bg-[#dcebff]">Theo khoán {branchKhoan!.lgPct}/{branchKhoan!.cnPct}</button>
          )}
        </div>
      )}
    </div>
  );
}
