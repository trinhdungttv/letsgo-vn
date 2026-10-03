import { useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { benchmarkFromPlans, matchPlans, MATCH_LABEL, type MatchLevel } from '../../../lib/costPlan/suggest';
import type { CostPlanRow } from '../../../lib/costPlan/types';
import { fmt, fmtD, fmtShort } from './fields';
import { btnGhost, card } from './ui';

const LEVEL_TONE: Record<MatchLevel, string> = {
  zone_industry: 'bg-[#e8f8ed] text-[#1d8a3b]',
  industry: 'bg-[#eef5ff] text-[#0b5cc4]',
  zone: 'bg-[#fff4e5] text-[#b25e00]',
};

/**
 * "Tham khảo từ lịch sử": thu gọn thành 1 dòng tóm tắt mặt bằng giá đã dùng cho cùng ngành/KCN;
 * mở ra để thấy từng phương án cũ và lấy làm mẫu. Không có gì để gợi ý thì không hiện gì cả.
 */
export default function SuggestionsPanel({ plans, industry, zone, excludeId, onUseTemplate }: {
  plans: CostPlanRow[];
  industry: string;
  zone: string;
  excludeId: string | null;
  onUseTemplate: (p: CostPlanRow) => void;
}) {
  const [open, setOpen] = useState(false);
  const matches = useMemo(() => matchPlans(plans, { industry, zone, excludeId }), [plans, industry, zone, excludeId]);
  const bench = useMemo(() => benchmarkFromPlans(plans, { industry, zone, excludeId }), [plans, industry, zone, excludeId]);

  if (!matches.length && !bench.scope) return null;
  const scope = bench.scope === 'zone_industry' ? 'cùng KCN + ngành' : 'cùng ngành';
  const line = bench.quote && bench.fee
    ? `Giá TB ${fmt(bench.quote.avg)} đ · Phí DV TB ${fmt(bench.fee.avg)} đ`
    : `${matches.length} phương án liên quan`;

  return (
    <div className={card}>
      <button type="button" onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-3 px-5 py-3.5 text-left">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-[#1d1d1f]">Tham khảo từ lịch sử</div>
          <div className="text-[11.5px] text-[#86868b] truncate">{line} · {matches.length} phương án {scope}</div>
        </div>
        <ChevronRight size={15} className={`text-[#86868b] transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && (
        <div className="px-5 pb-4 pt-1 border-t border-[#f2f2f4] space-y-3">
          {bench.scope && (
            <div className="grid grid-cols-3 gap-3 pt-3">
              {[['Giá báo / công', bench.quote, false], ['Phí DV / công', bench.fee, false], ['Lương CB / tháng', bench.baseWage, true]].map(([label, s, short]) => {
                const st = s as typeof bench.quote;
                const f = short ? fmtShort : fmt;
                return (
                  <div key={label as string}>
                    <div className="text-[11px] text-[#86868b]">{label as string}</div>
                    {st ? <><div className="text-[15px] font-semibold tabular-nums text-[#1d1d1f]">{f(st.avg)}</div>
                      <div className="text-[10.5px] text-[#86868b] tabular-nums">{st.n > 1 ? `${f(st.min)} – ${f(st.max)}` : '1 phương án'}</div></> : <div className="text-[13px] text-[#c7c7cc]">—</div>}
                  </div>
                );
              })}
            </div>
          )}
          <div className="divide-y divide-[#f2f2f4]">
            {matches.map(({ plan, level }) => (
              <div key={plan.id} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[13px] font-medium text-[#1d1d1f] truncate">{plan.title}</span>
                    {plan.status === 'final' && <span className="text-[10px] font-semibold text-[#1d8a3b]">Đã chốt</span>}
                  </div>
                  <div className="text-[11.5px] text-[#86868b] truncate">
                    <span className={`inline-block px-1.5 rounded mr-1.5 text-[10px] font-semibold ${LEVEL_TONE[level]}`}>{MATCH_LABEL[level]}</span>
                    {plan.summary ? `${fmtD(plan.summary.quoteDaily)}/công · phí DV ${fmtD(plan.summary.serviceFeeDaily)}` : [plan.company_name, plan.zone_name].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <button type="button" onClick={() => onUseTemplate(plan)} className={btnGhost}>Dùng làm mẫu</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
