// Màn soạn phương án GIỚI THIỆU LAO ĐỘNG — 1 màn (không chia 2 bước như cung ứng vì không có giá vốn lương):
// phí giới thiệu (theo giờ/ngày thực tế hoặc trọn gói/người) → chi phí tuyển dụng nội bộ → điều khoản in lên báo giá,
// bên phải là lợi nhuận ước tính + chia Công ty / Chi nhánh. Mọi con số ở src/lib/costPlan/referral.ts (có test).
import { useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, Check, Copy, FileText, Info, Plus, Trash2 } from 'lucide-react';
import {
  computeReferral, newCostId, normalizeReferral, referralTerms, termsToText,
  type ReferralConfig, type TermsLang, type TermsStyle,
} from '../../../lib/costPlan/referral';
import { DOC_LANGS, type DocDefaults } from '../../../lib/costPlan/quoteDoc';
import type { PlanData, PlanResult, PlanSettings } from '../../../lib/costPlan/types';
import ProfitSplit from './ProfitSplit';
import QuoteMetaCard from './QuoteMetaCard';
import QuoteDocDialog from './QuoteDocDialog';
import { copyText } from '../../../lib/clipboard';
import { MoneyInput, NumInput, fmt, fmtD, fmtShort } from './fields';
import { Seg, Select, btnGhost, btnPrimary, card, field, labelCls } from './ui';

const TONE = { error: 'bg-[#fff1f0] text-[#b3140a]', warn: 'bg-[#fff8e6] text-[#8a5a00]', info: 'bg-[#eef5ff] text-[#0b5cc4]' } as const;

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className={labelCls}>{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-[#86868b] mt-1 leading-snug">{hint}</span>}
    </label>
  );
}

export default function ReferralEditor({
  data, result, readOnly, onChange, aboveList, branchLabel, branchKhoan, planId, docDefaults, meta,
}: {
  data: PlanData;
  /** Kết quả engine cung ứng — chỉ để truyền cho hộp xuất PDF (dùng chung với cung ứng) */
  result: PlanResult;
  readOnly?: boolean;
  onChange: (next: PlanData) => void;
  aboveList?: ReactNode;
  branchLabel?: string | null;
  branchKhoan?: { lgPct: number; cnPct: number; label: string } | null;
  planId?: string | null;
  docDefaults?: DocDefaults;
  meta?: { company?: string | null; industry?: string | null; zone?: string | null };
}) {
  const cfg = useMemo(() => normalizeReferral(data.referral), [data.referral]);
  const r = useMemo(() => computeReferral(cfg, data.settings), [cfg, data.settings]);
  const s = data.settings;
  const set = (p: Partial<ReferralConfig>) => onChange({ ...data, referral: { ...cfg, ...p } });
  const setSettings = (p: Partial<PlanSettings>) => onChange({ ...data, settings: { ...s, ...p } });
  const dis = !!readOnly;
  const time = cfg.mode === 'time';

  const [lang, setLang] = useState<TermsLang>('vi');
  const [style, setStyle] = useState<TermsStyle>('quote');
  const terms = useMemo(() => referralTerms(cfg, lang, style), [cfg, lang, style]);
  const [copied, setCopied] = useState<'ok' | 'fail' | null>(null);
  const [docOpen, setDocOpen] = useState(false);
  const copy = async () => {
    setCopied((await copyText(termsToText(terms))) ? 'ok' : 'fail');
    setTimeout(() => setCopied(null), 1800);
  };

  const period = time ? `cả ${r.months} tháng` : 'cả đợt';

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-5 items-start">
      <div className="space-y-4 min-w-0">
        {aboveList}

        {/* ── Phí giới thiệu ── */}
        <div className={`${card} p-5 space-y-4`}>
          <div>
            <div className="text-[14px] font-semibold text-[#1d1d1f]">Phí giới thiệu</div>
            <div className="text-[12px] text-[#86868b]">Người lao động ký hợp đồng và nhận lương trực tiếp từ khách — mình chỉ thu phí giới thiệu</div>
          </div>
          <div className="max-w-md">
            <Seg value={cfg.mode} disabled={dis} onChange={v => set({ mode: v })}
              options={[{ value: 'time', label: 'Theo giờ / ngày làm thực tế' }, { value: 'lump', label: 'Trọn gói theo người' }]} />
          </div>

          {time ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
              <Field label="Đơn giá">
                <div className="flex items-center gap-2">
                  <MoneyInput value={cfg.rate} disabled={dis} onChange={n => set({ rate: n })} className={`${field} flex-1 min-w-0 text-right !text-[15px] font-semibold text-[#5e5ce6]`} />
                  <div className="w-36 shrink-0"><Seg value={cfg.rateUnit} disabled={dis} onChange={v => set({ rateUnit: v })} options={[{ value: 'hour', label: 'đ/giờ' }, { value: 'day', label: 'đ/ngày' }]} /></div>
                </div>
              </Field>
              {cfg.rateUnit === 'hour' ? (
                <Field label="Tối đa giờ tính phí / ngày" hint="Thời gian tăng ca không tính vào đơn giá">
                  <div className="flex items-center gap-2"><NumInput value={cfg.maxHoursPerDay} min={1} max={24} step={0.5} disabled={dis} onChange={n => set({ maxHoursPerDay: Math.max(1, n) })} className={`${field} w-20 text-center font-semibold`} /><span className="text-[13px] text-[#6e6e73]">giờ/ngày</span></div>
                </Field>
              ) : <div className="hidden sm:block" />}
              <Field label="Thời gian thu phí" hint="Kể từ ngày người lao động chính thức nhận việc">
                <div className="flex items-center gap-2"><NumInput value={cfg.durationMonths} min={1} max={120} disabled={dis} onChange={n => set({ durationMonths: Math.max(1, n) })} className={`${field} w-20 text-center font-semibold`} /><span className="text-[13px] text-[#6e6e73]">tháng</span></div>
              </Field>
              <Field label="Áp dụng cho NLĐ vào làm từ ngày (tuỳ chọn)">
                <input type="date" disabled={dis} value={cfg.effectiveFrom} onChange={e => set({ effectiveFrom: e.target.value })} className={`${field} w-full`} />
              </Field>
              <div className="sm:col-span-2 rounded-xl bg-[#f5f5f7] px-3.5 py-2.5 text-[12.5px] text-[#6e6e73] leading-relaxed">
                1 người làm đủ giờ: <b className="text-[#1d1d1f] tabular-nums">{fmtD(r.feePerDay)}</b>/ngày ·
                <b className="text-[#1d1d1f] tabular-nums"> {fmtD(r.feePerWorkerMonth)}</b>/tháng ({s.simDays} công) ·
                <b className="text-[#5e5ce6] tabular-nums"> {fmtD(r.feePerWorker)}</b> cả {cfg.durationMonths} tháng
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
              <Field label="Phí trọn gói / người">
                <div className="flex items-center gap-2"><MoneyInput value={cfg.lumpFee} disabled={dis} onChange={n => set({ lumpFee: n })} className={`${field} flex-1 min-w-0 text-right !text-[15px] font-semibold text-[#5e5ce6]`} /><span className="text-[13px] text-[#6e6e73] shrink-0">đ/người</span></div>
              </Field>
              <Field label="Người lao động làm đủ" hint="Nghỉ trước số ngày này thì không tính phí">
                <div className="flex items-center gap-2"><NumInput value={cfg.minDays} min={0} max={365} disabled={dis} onChange={n => set({ minDays: n })} className={`${field} w-20 text-center font-semibold`} /><span className="text-[13px] text-[#6e6e73]">ngày thì tính phí</span></div>
              </Field>
              <Field label="Bảo hành thay người (tuỳ chọn)" hint="Nghỉ trong số ngày này sau khi đã tính phí → giới thiệu người thay miễn phí. 0 = không ghi">
                <div className="flex items-center gap-2"><NumInput value={cfg.guaranteeDays} min={0} max={365} disabled={dis} onChange={n => set({ guaranteeDays: n })} className={`${field} w-20 text-center font-semibold`} /><span className="text-[13px] text-[#6e6e73]">ngày</span></div>
              </Field>
              <Field label="Áp dụng cho NLĐ vào làm từ ngày (tuỳ chọn)">
                <input type="date" disabled={dis} value={cfg.effectiveFrom} onChange={e => set({ effectiveFrom: e.target.value })} className={`${field} w-full`} />
              </Field>
            </div>
          )}
        </div>

        {/* ── Chi phí tuyển dụng (nội bộ) ── */}
        <div className={card}>
          <div className="px-5 pt-4 pb-2">
            <div className="text-[14px] font-semibold text-[#1d1d1f]">Chi phí tuyển dụng của mình</div>
            <div className="text-[12px] text-[#86868b]">Nội bộ — không in lên báo giá. Tính theo mỗi người tuyển được, hoặc % trên phí thu được (hoa hồng)</div>
          </div>
          <div className="divide-y divide-[#f2f2f4] border-t border-[#f2f2f4]">
            {cfg.costs.map(c => {
              const amount = r.costs.find(x => x.id === c.id)?.amount ?? 0;
              const patch = (p: Partial<typeof c>) => set({ costs: cfg.costs.map(x => (x.id === c.id ? { ...x, ...p } : x)) });
              return (
                <div key={c.id} className="flex flex-wrap sm:flex-nowrap items-center gap-2 px-5 py-2.5">
                  <input value={c.name} disabled={dis} onChange={e => patch({ name: e.target.value })} placeholder="Tên khoản chi"
                    className="flex-1 min-w-[160px] bg-transparent text-[13.5px] font-medium text-[#1d1d1f] outline-none placeholder:text-[#a1a1a6]" />
                  <div className="flex items-center gap-2 ml-auto">
                    {c.kind === 'pct_fee'
                      ? <span className="flex items-center gap-1"><NumInput value={c.value} max={100} step={0.5} disabled={dis} onChange={n => patch({ value: n })} className={`${field} !h-8 w-16 text-right font-semibold`} /><span className="text-[12px] text-[#86868b]">%</span></span>
                      : <MoneyInput value={c.value} disabled={dis} onChange={n => patch({ value: n })} className={`${field} !h-8 w-[104px] text-right font-semibold`} />}
                    <Select value={c.kind} disabled={dis} onChange={v => patch({ kind: v as typeof c.kind, value: 0 })} className="w-[132px]" fieldClassName="!h-8 !text-[12px]">
                      <option value="per_worker">đ / người tuyển</option>
                      <option value="pct_fee">% phí thu được</option>
                    </Select>
                    <span className="w-[72px] text-right text-[12px] tabular-nums text-[#6e6e73]" title={`${fmtD(amount)} ${period}`}>{fmtShort(amount)}</span>
                    {!dis && <button type="button" onClick={() => set({ costs: cfg.costs.filter(x => x.id !== c.id) })} title="Xoá khoản" className="w-7 h-7 rounded-full flex items-center justify-center text-[#a1a1a6] hover:bg-[#fff1f0] hover:text-[#d70015]"><Trash2 size={13} /></button>}
                  </div>
                </div>
              );
            })}
            {cfg.costs.length === 0 && <div className="px-5 py-3 text-[12.5px] text-[#86868b]">Chưa có khoản chi nào.</div>}
          </div>
          <div className="px-5 py-2.5 border-t border-[#f2f2f4] flex items-center justify-between gap-3">
            {!dis ? <button type="button" onClick={() => set({ costs: [...cfg.costs, { id: newCostId(), name: '', kind: 'per_worker', value: 0 }] })} className="inline-flex items-center gap-1 text-[13px] font-medium text-[#0071e3] hover:text-[#0077ed]"><Plus size={14} />Thêm khoản</button> : <span />}
            <span className="text-[12.5px] text-[#6e6e73]">Tổng {period}: <b className="text-[#1d1d1f] tabular-nums">{fmtD(r.costTotal)}</b></span>
          </div>
        </div>

        <QuoteMetaCard data={data} onChange={onChange} readOnly={readOnly} defaults={docDefaults} companyName={meta?.company} />

        {/* ── Điều khoản trên báo giá ── */}
        <div className={`${card} p-5 space-y-3`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-[14px] font-semibold text-[#1d1d1f]">Điều kiện tính phí</div>
              <div className="text-[12px] text-[#86868b]">Tự sinh từ mục trên — in vào báo giá, hoặc sao chép dán vào phụ lục hợp đồng</div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => setDocOpen(true)} className={btnPrimary}><FileText size={14} />Xem & xuất PDF</button>
              <button type="button" onClick={copy} className={btnGhost}>{copied === 'ok' ? <Check size={14} className="text-[#1d8a3b]" /> : <Copy size={14} />}{copied === 'ok' ? 'Đã copy' : copied === 'fail' ? 'Không copy được' : 'Sao chép điều khoản'}</button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <div className="w-full sm:w-[300px]"><Seg value={lang} onChange={setLang} options={DOC_LANGS} /></div>
            <div className="w-full sm:w-[280px]"><Seg value={style} onChange={setStyle} options={[{ value: 'quote', label: 'Văn phong báo giá' }, { value: 'contract', label: 'Phụ lục HĐ (Bên A/B)' }]} /></div>
          </div>
          <div className="rounded-xl bg-[#f5f5f7] px-4 py-3 space-y-2">
            {terms.map((t, i) => (
              <div key={i} className="flex gap-2 text-[13px] leading-relaxed">
                <span className="text-[#86868b]">–</span>
                <div className="min-w-0"><div className="text-[#1d1d1f]">{t.a}</div>{t.b && <div className="text-[#6e6e73] text-[12.5px]">{t.b}</div>}</div>
              </div>
            ))}
          </div>
          {style === 'contract' && <div className="text-[11.5px] text-[#86868b]">Bên A = khách hàng, Bên B = công ty mình — đúng cách viết phụ lục hợp đồng mẫu. Bản PDF báo giá luôn dùng văn phong báo giá.</div>}
        </div>

        <div className={`${card} p-5`}>
          <label className={labelCls}>Ghi chú nội bộ của phương án</label>
          <textarea value={data.notes} disabled={dis} onChange={e => onChange({ ...data, notes: e.target.value })} rows={3}
            placeholder="Giả định tỉ lệ đi làm, điều kiện khách đồng ý, lý do chọn mức phí này…"
            className={`${field} !h-auto w-full py-2.5 resize-y leading-relaxed`} />
        </div>
      </div>

      {/* ── Cột phải: lợi nhuận ── */}
      <div className="space-y-4 min-w-0 order-first xl:order-none xl:sticky xl:top-0">
        {r.warnings.length > 0 && (
          <div className="space-y-2">
            {r.warnings.slice(0, 4).map((w, i) => {
              const Icon = w.level === 'info' ? Info : AlertTriangle;
              return <div key={i} className={`flex gap-2 rounded-xl px-3.5 py-2.5 text-[12px] leading-snug ${TONE[w.level]}`}><Icon size={14} className="shrink-0 mt-px" /><span>{w.text}</span></div>;
            })}
          </div>
        )}

        <div className={`${card} p-5`}>
          <div className="flex items-center justify-between">
            <div className="text-[12px] font-medium text-[#6e6e73]">{time ? 'Lợi nhuận ước tính / tháng' : 'Lợi nhuận ước tính cả đợt'}</div>
            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${r.profit < 0 ? 'bg-[#fff1f0] text-[#b3140a]' : 'bg-[#e8f8ed] text-[#1d8a3b]'}`}>biên {r.marginPct.toFixed(1).replace('.', ',')}%</span>
          </div>
          <div className={`mt-1 text-[36px] leading-tight font-semibold tracking-tight tabular-nums ${r.profit < 0 ? 'text-[#d70015]' : 'text-[#1d8a3b]'}`} title={fmtD(r.profitMonthly)}>{fmtShort(r.profitMonthly)}</div>
          {time && <div className="text-[12px] text-[#86868b]">Cả {r.months} tháng thu phí: <b className="text-[#1d1d1f]">{fmtShort(r.profit)}</b></div>}

          <div className="mt-4 rounded-xl bg-[#f5f5f7] px-3.5 py-3 space-y-2 text-[12px] text-[#6e6e73]">
            <div className="flex items-center gap-1.5 flex-wrap">
              <NumInput value={s.workers} min={1} max={5000} disabled={dis} onChange={n => setSettings({ workers: Math.max(1, n) })} className={`${field} !h-8 w-16 !bg-white text-center !text-[14px] font-semibold`} />
              <span>người tuyển được ×</span>
              <NumInput value={cfg.retentionPct} min={0} max={100} disabled={dis} onChange={n => set({ retentionPct: n })} className={`${field} !h-8 w-14 !bg-white text-center !text-[14px] font-semibold`} />
              <span>% {time ? 'đi làm đều' : `làm đủ ${cfg.minDays} ngày`}</span>
            </div>
            {time && (
              <div className="flex items-center gap-1.5">
                <NumInput value={s.simDays} min={1} max={31} disabled={dis} onChange={n => setSettings({ simDays: Math.max(1, n) })} className={`${field} !h-8 w-14 !bg-white text-center !text-[14px] font-semibold`} />
                <span>công / tháng mỗi người</span>
              </div>
            )}
            <div className="flex items-baseline justify-between pt-1">
              <span className="font-medium">= Số người được tính phí</span>
              <span className="text-[20px] leading-none font-semibold tabular-nums text-[#5e5ce6]">{fmt(Math.round(r.billedWorkers * 10) / 10)}<span className="ml-1 text-[12px] font-medium text-[#5e5ce6]/70">người</span></span>
            </div>
          </div>

          <dl className="mt-3.5 space-y-1.5 text-[13px]">
            {time && <div className="flex justify-between gap-3"><dt className="text-[#6e6e73]">Doanh thu phí / tháng</dt><dd className="font-medium tabular-nums">{fmtShort(r.revenueMonthly)}</dd></div>}
            <div className="flex justify-between gap-3"><dt className="text-[#6e6e73]">Doanh thu phí {period}</dt><dd className="font-semibold tabular-nums text-[#0071e3]">{fmtShort(r.revenueTotal)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-[#6e6e73]">Chi phí tuyển dụng</dt><dd className="font-medium tabular-nums">−{fmtShort(r.costTotal)}</dd></div>
            {r.tax > 0.5 && <div className="flex justify-between gap-3"><dt className="text-[#6e6e73]">Thuế TNDN dự phòng 20%</dt><dd className="font-medium tabular-nums text-[#c4620a]">−{fmtShort(r.tax)}</dd></div>}
            <div className="flex justify-between gap-3 pt-1.5 border-t border-[#f0f0f2]"><dt className="text-[#1d1d1f] font-medium">Lợi nhuận {period}</dt><dd className="font-semibold tabular-nums text-[#1d8a3b]">{fmtShort(r.profit)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-[#6e6e73]">Mỗi người tuyển được</dt><dd className="font-medium tabular-nums">{fmtD(r.profitPerWorker)}</dd></div>
          </dl>
          <div className="mt-3 pt-3 border-t border-[#f0f0f2] flex items-center justify-between gap-3">
            <span className="text-[12px] text-[#6e6e73]">Thuế TNDN dự phòng</span>
            <Select value={s.taxOption === 'none' ? 'none' : 'profit20'} disabled={dis} onChange={v => setSettings({ taxOption: v === 'none' ? 'none' : 'profit20' })} className="w-40" fieldClassName="!h-8 !text-[12px]">
              <option value="profit20">20% lợi nhuận</option>
              <option value="none">Không tính</option>
            </Select>
          </div>
        </div>

        <ProfitSplit settings={s} result={result} readOnly={dis} onChange={setSettings} branchLabel={branchLabel} branchKhoan={branchKhoan}
          figures={time
            ? { company: r.companyProfit / r.months, branch: r.branchProfit / r.months, companyNote: `/ tháng · cả ${r.months} tháng: ${fmtShort(r.companyProfit)}`, branchNote: `/ tháng · cả ${r.months} tháng: ${fmtShort(r.branchProfit)}` }
            : { company: r.companyProfit, branch: r.branchProfit, companyNote: '/ cả đợt', branchNote: '/ cả đợt' }} />

        {!dis && <div className="text-[11.5px] text-[#86868b] px-1 leading-snug">Các con số bên phải là ước tính nội bộ để chọn mức phí — báo giá gửi khách chỉ có đơn giá và điều kiện tính phí.</div>}
      </div>

      {docOpen && <QuoteDocDialog data={data} result={result} meta={meta} planId={planId} defaults={docDefaults} readOnly={readOnly} onChange={onChange} onClose={() => setDocOpen(false)} />}
    </div>
  );
}
