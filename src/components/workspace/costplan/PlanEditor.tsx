import { useMemo, useState, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { newLineId } from '../../../lib/costPlan/engine';
import { legalChecklist } from '../../../lib/costPlan/legal';
import { normalizeText, optionalFor } from '../../../lib/costPlan/presets';
import type { CostLine, PlanData, PlanResult, PlanSettings, QuoteSheet } from '../../../lib/costPlan/types';
import CostSections, { secOf, withSection, type LineSuggestion } from './CostSections';
import ProfitSplit from './ProfitSplit';
import { PriceBuild, PriceTable, QuoteNotes } from './QuoteStep';
import { CostTotalCard, LegalCard, NegotiateCard, ProfitCard, SettingsCard, Warnings } from './SummaryPanel';
import { fmt } from './fields';
import { card, field, labelCls, btnGhost } from './ui';

type Step = 'cost' | 'quote';

/** Hai bước làm việc: ① tính chi phí lao động (giá vốn) → ② lập báo giá cho khách. */
function StepTabs({ step, onStep, cost, price, canQuote }: { step: Step; onStep: (s: Step) => void; cost: number; price: number; canQuote: boolean }) {
  const Tab = ({ id, n, title, value, unit, disabled }: { id: Step; n: number; title: string; value: number; unit: string; disabled?: boolean }) => {
    const on = step === id;
    return (
      <button type="button" disabled={disabled} onClick={() => onStep(id)}
        className={`flex-1 min-w-0 flex items-center gap-3 px-4 py-3 rounded-xl text-left transition disabled:cursor-not-allowed ${on ? 'bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.06),0_1px_4px_rgba(0,0,0,0.08)]' : 'hover:bg-white/60'} ${disabled ? 'opacity-50' : ''}`}>
        <span className={`w-6 h-6 rounded-full text-[12px] font-semibold flex items-center justify-center shrink-0 ${on ? 'bg-[#0071e3] text-white' : 'bg-[#d1d1d6] text-white'}`}>{n}</span>
        <span className="min-w-0">
          <span className={`block text-[13.5px] font-semibold truncate ${on ? 'text-[#1d1d1f]' : 'text-[#6e6e73]'}`}>{title}</span>
          <span className={`block text-[11.5px] truncate tabular-nums ${on && value > 0 ? 'font-semibold text-[#0071e3]' : 'text-[#86868b]'}`}>{value > 0 ? `${fmt(value)} ${unit}` : disabled ? 'Cần có lương cơ bản' : '—'}</span>
        </span>
      </button>
    );
  };
  return (
    <div className="flex items-center gap-1 p-1 rounded-2xl bg-[#e8e8ed]">
      <Tab id="cost" n={1} title="Chi phí lao động" value={cost} unit="đ/công · giá vốn" />
      <ChevronRight size={14} className="text-[#a1a1a6] shrink-0 hidden sm:block" />
      <Tab id="quote" n={2} title="Báo giá khách" value={price} unit="đ/ngày công" disabled={!canQuote} />
    </div>
  );
}

/**
 * Phần lõi của màn Phương án giá — DÙNG CHUNG cho chủ phương án (trong app) và người được mời (qua link).
 *   Bước 1 · Chi phí lao động: chọn ngành, thêm đúng các khoản theo luật → tổng chi phí 1 lao động (giá vốn).
 *   Bước 2 · Báo giá khách: giá vốn + phí dịch vụ + thuế → giá 1 công → bảng giá dịch vụ (ngày, đêm, tăng ca…) + chia lợi nhuận.
 */
export default function PlanEditor({
  data, result, readOnly, industry, onChange, aboveList, historySuggestions, branchLabel, branchKhoan,
  minWage, templateLines, fileName = 'phuong-an-gia', fillMeta, planId, docDefaults, onPushCrm, initialStep,
}: {
  data: PlanData;
  result: PlanResult;
  readOnly?: boolean;
  industry?: string | null;
  onChange: (next: PlanData) => void;
  /** Khối thông tin khách + tham khảo lịch sử — chỉ chủ phương án có, hiện ở đầu bước 1 */
  aboveList?: ReactNode;
  historySuggestions?: LineSuggestion[];
  branchLabel?: string | null;
  branchKhoan?: { lgPct: number; cnPct: number; label: string } | null;
  minWage?: { monthly: number; label: string } | null;
  /** Mẫu khoản mục đã lưu của ngành — để kiểm tra luật theo khoản đặc thù của ngành */
  templateLines?: CostLine[] | null;
  fileName?: string;
  /** Tên khách / ngành / KCN cho các ô {{...}} khi điền file Excel mẫu */
  fillMeta?: { company?: string | null; industry?: string | null; zone?: string | null };
  planId?: string | null;
  /** Thông tin khách lấy sẵn từ hồ sơ CRM để điền vào báo giá PDF */
  docDefaults?: import('../../../lib/costPlan/quoteDoc').DocDefaults;
  onPushCrm?: () => void;
  initialStep?: Step;
}) {
  const baseWageDaily = result.baseWageDaily;
  const canQuote = baseWageDaily > 0;
  const [step, setStep] = useState<Step>(initialStep ?? 'cost');
  const cur: Step = step === 'quote' && !canQuote ? 'cost' : step;

  const setSettings = (p: Partial<PlanSettings>) => onChange({ ...data, settings: { ...data.settings, ...p } });
  const setLines = (lines: CostLine[]) => onChange({ ...data, lines });
  const setQuote = (q: QuoteSheet) => onChange({ ...data, quote: q });

  const addFix = (fix: CostLine) => {
    const l = withSection({ ...fix, id: newLineId() }, secOf(fix));
    const i = data.lines.findIndex(x => x.isServiceFee);
    setLines(i < 0 || l.isServiceFee ? [...data.lines, l] : [...data.lines.slice(0, i), l, ...data.lines.slice(i)]);
  };

  // Gợi ý để thêm: khoản các phương án cũ hay dùng (kèm số tiền) trước, rồi khoản chung của ngành
  const suggestions = useMemo<LineSuggestion[]>(() => {
    if (readOnly) return [];
    const hist = historySuggestions ?? [];
    const seen = new Set(hist.map(h => h.line.name.toLowerCase()));
    const preset = optionalFor(industry, data.lines).filter(l => !seen.has(l.name.toLowerCase())).map(line => ({ line }));
    return [...hist, ...preset];
  }, [readOnly, historySuggestions, industry, data.lines]);

  const legal = useMemo(
    () => legalChecklist(data, result, { industry, minWageMonthly: minWage?.monthly, minWageLabel: minWage?.label, templateLines }),
    [data, result, industry, minWage, templateLines],
  );

  // Khoản nghĩa vụ của doanh nghiệp (BHXH, công đoàn, phép năm, khám SK) lỡ nằm ở nhóm "Trả NLĐ" → gợi ý chuyển nhóm
  // (không tự đổi: người dùng quyết định). Nằm sai nhóm làm "thu nhập trả NLĐ" bị phình lên.
  const misplaced = data.lines.filter(l => secOf(l) === 'worker' && !l.isBaseWage && /bhxh|bao hiem|cong doan|phep nam|kham/.test(normalizeText(l.name)));
  const moveMisplaced = () => setLines(data.lines.map(l => (misplaced.some(m => m.id === l.id) ? withSection(l, 'compliance') : l)));

  const notesCard = (
    <div className={`${card} p-5`}>
      <label className={labelCls}>Ghi chú nội bộ của phương án</label>
      <textarea value={data.notes} disabled={readOnly} onChange={e => onChange({ ...data, notes: e.target.value })} rows={3}
        placeholder="Giả định, điều kiện khách phải đồng ý, lý do chọn mức phí này…"
        className={`${field} !h-auto w-full py-2.5 resize-y leading-relaxed`} />
    </div>
  );

  return (
    <div className="space-y-4">
      <StepTabs step={cur} onStep={setStep} cost={result.costDaily} price={result.quoteDaily} canQuote={canQuote} />

      {cur === 'cost' ? (
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-5 items-start">
          <div className="space-y-4 min-w-0">
            {aboveList}
            <CostSections lines={data.lines} result={result} baseDays={data.settings.baseDays} readOnly={readOnly} onChange={setLines}
              suggestions={suggestions} show={['worker', 'compliance', 'other']} />
            {notesCard}
          </div>
          <div className="space-y-4 min-w-0 order-first xl:order-none xl:sticky xl:top-0">
            <Warnings result={result} />
            <CostTotalCard data={data} result={result} ready={canQuote} onNext={() => setStep('quote')} />
            {!readOnly && misplaced.length > 0 && (
              <div className="rounded-2xl bg-[#eef5ff] px-4 py-3 text-[12.5px] text-[#0b5cc4] leading-snug">
                <b>{misplaced.map(m => m.name.replace(/\([^)]*\)/g, '').trim()).join(', ')}</b> đang nằm ở nhóm “Trả người lao động”, nhưng đây là nghĩa vụ của doanh nghiệp.
                <button type="button" onClick={moveMisplaced} className="block mt-1.5 font-semibold text-[#0071e3] hover:underline">Chuyển sang “Bảo hiểm & chế độ”</button>
              </div>
            )}
            <LegalCard items={legal} readOnly={readOnly} onAdd={addFix} />
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-5 items-start">
          <div className="space-y-4 min-w-0">
            <CostSections lines={data.lines} result={result} baseDays={data.settings.baseDays} readOnly={readOnly} onChange={setLines} suggestions={[]} show={['service']} />
            <PriceBuild data={data} result={result} onGoCost={() => setStep('cost')} />
            <PriceTable data={data} result={result} readOnly={readOnly} fileName={fileName} meta={fillMeta} planId={planId} docDefaults={docDefaults} onQuote={setQuote} onPlan={onChange} onPushCrm={readOnly ? undefined : onPushCrm} />
            <QuoteNotes data={data} readOnly={readOnly} onQuote={setQuote} />
            {!readOnly && <div className="px-1"><button type="button" onClick={() => setStep('cost')} className={btnGhost}>← Quay lại chi phí lao động</button></div>}
          </div>
          <div className="space-y-4 min-w-0 order-first xl:order-none xl:sticky xl:top-0">
            <Warnings result={result} />
            <ProfitCard data={data} result={result} readOnly={readOnly} onChange={setSettings} />
            <ProfitSplit settings={data.settings} result={result} readOnly={readOnly} onChange={setSettings} branchLabel={branchLabel} branchKhoan={branchKhoan} />
            {!readOnly && <NegotiateCard data={data} result={result} onApplyLine={fee => setLines(data.lines.map(l => (l.id === fee.id ? fee : l)))} />}
            <SettingsCard settings={data.settings} readOnly={readOnly} onChange={setSettings} />
          </div>
        </div>
      )}
    </div>
  );
}
