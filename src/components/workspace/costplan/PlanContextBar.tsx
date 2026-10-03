import { useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { branchOptions } from '../../../lib/branchRef';
import type { Branch, Client, CRMPipelineEntry } from '../../../lib/types';
import type { QuoteInfoLine } from '../../../lib/quoteInfo';
import { companyValue, type PlanMeta } from './context';
import { fmt, fmtD } from './fields';
import { Combo, Select, btnLink, card, labelCls } from './ui';

export interface MinWageInfo { monthly: number; label: string }

/**
 * Thông tin phương án: khách → ngành → KCN → chi nhánh. Thu gọn thành 1 dòng khi đã đủ thông tin,
 * mở ra để sửa. Chọn khách ở CRM Pipeline thì ngành / KCN / chi nhánh / số LĐ tự điền sẵn.
 */
export default function PlanContextBar({
  meta, onMeta, pipeline, clients, branches, industries, zoneNames, minWage, baseWageMonthly,
  onPickCompany, onSetBaseToMinWage, crmLines, onApplyCrmLine, picking,
}: {
  meta: PlanMeta;
  onMeta: (p: Partial<PlanMeta>) => void;
  pipeline: CRMPipelineEntry[];
  clients: Client[];
  branches: Branch[];
  industries: string[];
  zoneNames: string[];
  minWage: MinWageInfo | null;
  baseWageMonthly: number;
  onPickCompany: (value: string) => void;
  onSetBaseToMinWage: () => void;
  crmLines: QuoteInfoLine[];
  onApplyCrmLine: (l: QuoteInfoLine) => void;
  picking: boolean;
}) {
  const complete = !!(meta.company_name || meta.industry) && !!meta.industry && !!meta.zone_name;
  const [open, setOpen] = useState(!complete);

  const companyOptions = useMemo(() => {
    const linked = new Set(pipeline.map(p => p.client_id).filter(Boolean));
    return [
      ...pipeline.map(p => ({ value: `crm:${p.id}`, label: p.company_name })),
      ...clients.filter(c => !linked.has(c.id) && !c.archived_at).map(c => ({ value: `client:${c.id}`, label: `${c.name} · khách hàng` })),
    ];
  }, [pipeline, clients]);
  const industryOptions = useMemo(() => (meta.industry && !industries.includes(meta.industry) ? [meta.industry, ...industries] : industries).map(n => ({ value: n, label: n })), [industries, meta.industry]);
  const zoneOptions = useMemo(() => (meta.zone_name && !zoneNames.includes(meta.zone_name) ? [meta.zone_name, ...zoneNames] : zoneNames).map(n => ({ value: n, label: n })), [zoneNames, meta.zone_name]);
  const branchName = branchOptions(branches).find(b => b.id === meta.branch_id)?.label;
  const summary = [meta.industry, meta.zone_name, branchName].filter(Boolean).join('  ·  ');

  return (
    <div className={card}>
      <button type="button" onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-3 px-5 py-3.5 text-left">
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold text-[#1d1d1f] truncate">{meta.company_name || 'Thông tin phương án'}</div>
          <div className="text-[12px] text-[#86868b] truncate">{summary || 'Chọn khách, ngành và KCN để có gợi ý'}</div>
        </div>
        <span className="text-[13px] font-medium text-[#0071e3]">{open ? 'Xong' : 'Chỉnh sửa'}</span>
        <ChevronRight size={15} className={`text-[#86868b] transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>

      {open && (
        <div className="px-5 pb-5 pt-1 border-t border-[#f2f2f4]">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3 pt-3.5">
            <div>
              <span className={labelCls}>Khách hàng / Dự án (CRM)</span>
              <Combo value={companyValue(meta)} onChange={onPickCompany} options={companyOptions} placeholder={meta.company_name || 'Chọn để tự điền ngành, KCN…'} />
              {picking && <div className="text-[11px] text-[#0071e3] mt-1">Đang lấy thông tin từ hồ sơ…</div>}
            </div>
            <div>
              <span className={labelCls}>Ngành nghề</span>
              <Combo value={meta.industry} onChange={v => onMeta({ industry: v })} options={industryOptions} placeholder="Chọn ngành" />
            </div>
            <div>
              <span className={labelCls}>KCN / Vùng</span>
              <Combo value={meta.zone_name} onChange={v => onMeta({ zone_name: v })} options={zoneOptions} placeholder="Chọn KCN" allowAdd />
            </div>
            <div>
              <span className={labelCls}>Chi nhánh phụ trách</span>
              <Select value={meta.branch_id ?? ''} onChange={v => onMeta({ branch_id: v || null })}>
                <option value="">Chưa gán</option>
                {branchOptions(branches).map(b => <option key={b.id} value={b.id}>{b.label}</option>)}
              </Select>
            </div>
          </div>

          {(minWage || crmLines.length > 0) && (
            <div className="mt-3.5 space-y-1.5 text-[12px] text-[#6e6e73]">
              {minWage && (
                <div>
                  Lương tối thiểu {minWage.label}: <b className="text-[#1d1d1f]">{fmtD(minWage.monthly)}</b>
                  {baseWageMonthly !== minWage.monthly && <> · <button type="button" onClick={onSetBaseToMinWage} className={btnLink}>Đặt lương cơ bản bằng mức này</button></>}
                </div>
              )}
              {crmLines.length > 0 && (
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  Hồ sơ CRM đã có đơn giá:
                  {crmLines.map(l => (
                    <button key={l.id} type="button" onClick={() => onApplyCrmLine(l)} title="Nạp lương → Lương cơ bản, phí → Phí DV"
                      className="h-6 px-2.5 rounded-full bg-[#eef5ff] text-[#0071e3] text-[11.5px] font-medium hover:bg-[#dcebff]">{l.label || 'Dòng'} · {fmt(l.wage ?? 0)} + {fmt(l.fee ?? 0)}/{l.unit}</button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
