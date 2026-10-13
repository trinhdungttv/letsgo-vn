// Phương án giá — dịch vụ GIỚI THIỆU LAO ĐỘNG (khác cung ứng/cho thuê lao động).
//
// Người lao động ký hợp đồng và nhận lương TRỰC TIẾP từ khách → bên mình không có giá vốn lương/BHXH,
// chỉ thu PHÍ GIỚI THIỆU theo 1 trong 2 cách:
//   • time  — theo thời gian làm việc thực tế: X đ/giờ (tối đa H giờ/ngày, tăng ca không tính) hoặc X đ/ngày,
//             thu trong M tháng kể từ ngày NLĐ chính thức nhận việc.
//   • lump  — trọn gói: Y đ/người khi NLĐ làm đủ N ngày (nghỉ trước N ngày thì không tính phí).
// Chi phí của mình chỉ là chi phí tuyển dụng (đ/người tuyển được) hoặc hoa hồng (% phí thu được).
//
// File THUẦN (không React, không DB): tính toán + sinh câu chữ điều khoản 3 ngôn ngữ để test được.
import type { CostPlanRow, PlanData, PlanSettings, PlanSummary, PlanWarning } from './types';

export type ServiceKind = 'supply' | 'referral';
export type ReferralMode = 'time' | 'lump';

export interface ReferralCost {
  id: string;
  name: string;
  /** per_worker = đ / người tuyển được (kể cả người nghỉ sớm) · pct_fee = % trên phí giới thiệu thu được */
  kind: 'per_worker' | 'pct_fee';
  value: number;
}

export interface ReferralConfig {
  mode: ReferralMode;
  // ── time ──
  rateUnit: 'hour' | 'day';
  /** đ/giờ hoặc đ/ngày theo rateUnit */
  rate: number;
  /** Số giờ tối đa được tính phí trong 1 ngày (chỉ khi tính theo giờ) */
  maxHoursPerDay: number;
  /** Thời gian thu phí, tính từ ngày NLĐ chính thức nhận việc */
  durationMonths: number;
  // ── lump ──
  /** Phí trọn gói / người */
  lumpFee: number;
  /** NLĐ làm đủ bao nhiêu ngày thì tính phí */
  minDays: number;
  /** Bảo hành: nghỉ trong N ngày sau khi đã tính phí → giới thiệu người thay miễn phí (0 = không ghi) */
  guaranteeDays: number;
  // ── chung ──
  /** yyyy-mm-dd: áp dụng cho NLĐ vào làm từ ngày này ('' = không ghi) */
  effectiveFrom: string;
  /** Ước tính nội bộ: % NLĐ đi làm đều suốt thời gian thu phí / làm đủ N ngày */
  retentionPct: number;
  costs: ReferralCost[];
  /** Ghi chú thêm trên báo giá, mỗi dòng 1 ý. null = câu mặc định theo ngôn ngữ */
  notes: string | null;
}

const num = (v: unknown, d = 0): number => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
export const newCostId = () => Math.random().toString(36).slice(2, 10);

export function defaultReferral(): ReferralConfig {
  return {
    mode: 'time', rateUnit: 'hour', rate: 10_000, maxHoursPerDay: 8, durationMonths: 6,
    lumpFee: 3_000_000, minDays: 7, guaranteeDays: 0,
    effectiveFrom: '', retentionPct: 100,
    costs: [
      { id: newCostId(), name: 'Chi phí tuyển dụng (đăng tin, quảng cáo)', kind: 'per_worker', value: 0 },
      { id: newCostId(), name: 'Hoa hồng người giới thiệu / CTV', kind: 'pct_fee', value: 0 },
    ],
    notes: null,
  };
}

/** Đọc từ DB (có thể thiếu/cũ) về dạng đầy đủ, không bao giờ ném lỗi. */
export function normalizeReferral(raw: unknown): ReferralConfig {
  const d = defaultReferral();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Partial<ReferralConfig>;
  return {
    mode: r.mode === 'lump' ? 'lump' : 'time',
    rateUnit: r.rateUnit === 'day' ? 'day' : 'hour',
    rate: Math.max(0, num(r.rate, d.rate)),
    maxHoursPerDay: clamp(num(r.maxHoursPerDay, d.maxHoursPerDay), 1, 24),
    durationMonths: clamp(Math.round(num(r.durationMonths, d.durationMonths)), 1, 120),
    lumpFee: Math.max(0, num(r.lumpFee, d.lumpFee)),
    minDays: clamp(Math.round(num(r.minDays, d.minDays)), 0, 365),
    guaranteeDays: clamp(Math.round(num(r.guaranteeDays, 0)), 0, 365),
    effectiveFrom: typeof r.effectiveFrom === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.effectiveFrom) ? r.effectiveFrom : '',
    retentionPct: clamp(num(r.retentionPct, 100), 0, 100),
    costs: Array.isArray(r.costs)
      ? r.costs.slice(0, 30).map(c => ({
          id: c?.id || newCostId(), name: String(c?.name ?? ''),
          kind: c?.kind === 'pct_fee' ? 'pct_fee' as const : 'per_worker' as const,
          value: Math.max(0, num(c?.value)),
        }))
      : d.costs,
    notes: typeof r.notes === 'string' ? r.notes : null,
  };
}

export const isReferral = (data: Pick<PlanData, 'service'> | null | undefined) => data?.service === 'referral';
export const isReferralPlan = (p: Pick<CostPlanRow, 'data' | 'summary'>) => isReferral(p.data) || p.summary?.service === 'referral';

// ── Tính toán ──────────────────────────────────────────────────────────────────────────────

export interface ReferralResult {
  mode: ReferralMode;
  workers: number;
  /** Số NLĐ ước tính được tính phí = workers × retention */
  billedWorkers: number;
  /** time: phí 1 NLĐ / ngày làm đủ giờ */
  feePerDay: number;
  /** time: phí 1 NLĐ / tháng (× công/tháng) */
  feePerWorkerMonth: number;
  /** Phí thu được từ 1 NLĐ suốt thời gian thu phí (lump = phí trọn gói) */
  feePerWorker: number;
  /** Số tháng thu phí (lump = 0: thu 1 lần) */
  months: number;
  /** time: doanh thu / tháng · lump: = revenueTotal */
  revenueMonthly: number;
  revenueTotal: number;
  costs: { id: string; amount: number }[];
  costTotal: number;
  profitBeforeTax: number;
  tax: number;
  /** Lợi nhuận sau thuế dự phòng — phần chia Công ty / Chi nhánh */
  profit: number;
  /** time: profit / months · lump: = profit */
  profitMonthly: number;
  profitPerWorker: number;
  companyProfit: number;
  branchProfit: number;
  marginPct: number;
  warnings: PlanWarning[];
}

export function computeReferral(cfgIn: ReferralConfig | null | undefined, settings: PlanSettings): ReferralResult {
  const c = normalizeReferral(cfgIn);
  const warnings: PlanWarning[] = [];
  const workers = Math.max(1, Math.round(num(settings.workers, 1)));
  const days = clamp(Math.round(num(settings.simDays, 26)), 1, 31);
  const billedWorkers = (workers * c.retentionPct) / 100;

  const feePerDay = c.mode === 'time' ? (c.rateUnit === 'hour' ? c.rate * c.maxHoursPerDay : c.rate) : 0;
  const feePerWorkerMonth = feePerDay * days;
  const months = c.mode === 'time' ? c.durationMonths : 0;
  const feePerWorker = c.mode === 'time' ? feePerWorkerMonth * months : c.lumpFee;
  const revenueTotal = feePerWorker * billedWorkers;
  const revenueMonthly = c.mode === 'time' ? feePerWorkerMonth * billedWorkers : revenueTotal;

  const costs = c.costs.map(x => ({ id: x.id, amount: x.kind === 'pct_fee' ? (x.value / 100) * revenueTotal : x.value * workers }));
  const costTotal = costs.reduce((s, x) => s + x.amount, 0);
  const profitBeforeTax = revenueTotal - costTotal;
  // Phí giới thiệu là giá cố định thoả thuận với khách → thuế TNDN dự phòng trừ vào lợi nhuận (không cộng vào giá như cung ứng)
  const tax = settings.taxOption === 'none' ? 0 : Math.max(0, profitBeforeTax) * 0.2;
  const profit = profitBeforeTax - tax;
  const pct = clamp(num(settings.companyPct, 30), 0, 100);
  const companyProfit = Math.round((profit * pct) / 100);
  const branchProfit = Math.round(profit) - companyProfit;

  if (c.mode === 'time' && c.rate <= 0) warnings.push({ level: 'warn', text: 'Chưa nhập đơn giá phí giới thiệu.' });
  if (c.mode === 'lump' && c.lumpFee <= 0) warnings.push({ level: 'warn', text: 'Chưa nhập phí trọn gói / người.' });
  if (c.mode === 'time' && c.rateUnit === 'hour' && c.maxHoursPerDay > 8) {
    warnings.push({ level: 'info', text: `Đang tính tối đa ${c.maxHoursPerDay} giờ/ngày — giờ làm việc bình thường không quá 8 giờ/ngày (Điều 105 BLLĐ 2019), phần vượt là tăng ca.` });
  }
  if (revenueTotal > 0 && profitBeforeTax < 0) warnings.push({ level: 'error', text: 'Chi phí tuyển dụng cao hơn phí thu được — phương án này lỗ.' });
  if (c.retentionPct < 100) {
    warnings.push({ level: 'info', text: `Ước tính ${Math.round(billedWorkers * 10) / 10}/${workers} người được tính phí (${c.retentionPct}% đi làm đều${c.mode === 'lump' ? ` đủ ${c.minDays} ngày` : ''}).` });
  }

  return {
    mode: c.mode, workers, billedWorkers, feePerDay, feePerWorkerMonth, feePerWorker, months,
    revenueMonthly, revenueTotal, costs, costTotal, profitBeforeTax, tax, profit,
    profitMonthly: months > 0 ? profit / months : profit,
    profitPerWorker: profit / workers,
    companyProfit, branchProfit,
    marginPct: revenueTotal > 0 ? (profit / revenueTotal) * 100 : 0,
    warnings,
  };
}

const vnd = (n: number) => Math.round(n).toLocaleString('vi-VN');

/** "10.000 đ/giờ" · "80.000 đ/ngày" · "3.000.000 đ/người" */
export function feeText(cfgIn: ReferralConfig | null | undefined): string {
  const c = normalizeReferral(cfgIn);
  if (c.mode === 'lump') return `${vnd(c.lumpFee)} đ/người`;
  return `${vnd(c.rate)} đ/${c.rateUnit === 'hour' ? 'giờ' : 'ngày'}`;
}
/** "tối đa 8 giờ/ngày · thu 6 tháng" · "thu 6 tháng" · "làm đủ 7 ngày" */
export function termShort(cfgIn: ReferralConfig | null | undefined): string {
  const c = normalizeReferral(cfgIn);
  if (c.mode === 'lump') return c.minDays > 0 ? `làm đủ ${c.minDays} ngày` : 'trọn gói';
  return `${c.rateUnit === 'hour' ? `tối đa ${c.maxHoursPerDay} giờ/ngày · ` : ''}thu ${c.durationMonths} tháng`;
}

export function summarizeReferral(data: PlanData): PlanSummary {
  const cfg = normalizeReferral(data.referral);
  const r = computeReferral(cfg, data.settings);
  return {
    service: 'referral',
    quoteDaily: Math.round(r.feePerDay),
    workerDaily: 0,
    serviceFeeDaily: Math.round(r.feePerDay),
    profitDaily: 0,
    profitMonthly: Math.round(r.profitMonthly),
    marginPct: Math.round(r.marginPct * 10) / 10,
    workers: r.workers,
    baseWageMonthly: 0,
    companyPct: data.settings.companyPct,
    lineCount: cfg.costs.length,
    feeText: feeText(cfg),
    termText: termShort(cfg),
    revenueTotal: Math.round(r.revenueTotal),
    profitTotal: Math.round(r.profit),
  };
}

// ── Câu chữ điều khoản (3 ngôn ngữ) ────────────────────────────────────────────────────────

export type TermsLang = 'vi' | 'zh' | 'en';
/** quote = văn phong báo giá ("Quý Công ty / chúng tôi") · contract = phụ lục hợp đồng ("Bên A / Bên B") */
export type TermsStyle = 'quote' | 'contract';
/** a = dòng chính, b = dòng dịch (bản song ngữ) — cùng dạng với Bi của quoteDoc */
export interface TermLine { a: string; b?: string }
type Tri = { vi: string; zh: string; en: string };

const pair = (t: Tri, lang: TermsLang): TermLine =>
  lang === 'zh' ? { a: t.vi, b: t.zh } : lang === 'en' ? { a: t.en, b: t.vi } : { a: t.vi };

const VI_DIGITS = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];
/** Số bằng chữ tiếng Việt cho 0–99 (đủ cho số tháng / số ngày trên điều khoản). */
export function viNumberWords(n: number): string {
  const x = Math.round(n);
  if (x < 0 || x > 99) return String(x);
  if (x < 10) return VI_DIGITS[x];
  const t = Math.floor(x / 10), u = x % 10;
  const head = t === 1 ? 'mười' : `${VI_DIGITS[t]} mươi`;
  if (u === 0) return head;
  const tail = u === 5 ? 'lăm' : t > 1 && u === 1 ? 'mốt' : t > 1 && u === 4 ? 'tư' : VI_DIGITS[u];
  return `${head} ${tail}`;
}
const p2 = (n: number) => String(Math.round(n)).padStart(2, '0');
const intl = (n: number) => Math.round(n).toLocaleString('en-US');
const dates = (iso: string) => {
  const [y, m, d] = iso.split('-');
  const en = `${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][Number(m) - 1]} ${Number(d)}, ${y}`;
  return { vi: `${d}/${m}/${y}`, zh: `${y}/${m}/${d}`, en };
};

const parties = (style: TermsStyle) => style === 'contract'
  ? { cusVi: 'Bên A', cusZh: '甲方', cusEn: 'Party A', usVi: 'Bên B', usZh: '乙方', usEn: 'Party B' }
  : { cusVi: 'Quý Công ty', cusZh: '贵公司', cusEn: 'your Company', usVi: 'chúng tôi', usZh: '我方', usEn: 'we' };

/** Điều kiện tính phí — giữ đúng cách viết của phụ lục mẫu công ty đang dùng. */
export function referralTerms(cfgIn: ReferralConfig | null | undefined, lang: TermsLang, style: TermsStyle = 'quote'): TermLine[] {
  const c = normalizeReferral(cfgIn);
  const P = parties(style);
  const out: TermLine[] = [];
  if (c.effectiveFrom) {
    const d = dates(c.effectiveFrom);
    out.push(pair({
      vi: `Áp dụng mức cho người lao động vào làm từ ${d.vi} về sau.`,
      zh: `适用于自${d.zh}起报到的人员。`,
      en: `Applicable to workers who start work on or after ${d.en}.`,
    }, lang));
  }
  if (c.mode === 'time') {
    const vi = vnd(c.rate), en = intl(c.rate);
    out.push(pair(c.rateUnit === 'hour'
      ? {
          vi: `Đơn giá thỏa thuận: ${vi} VNĐ/giờ, được tính trên thời gian làm việc thực tế của người lao động được giới thiệu thành công, tối đa ${p2(c.maxHoursPerDay)} giờ/ngày. Thời gian làm thêm (tăng ca) không được tính vào đơn giá này.`,
          zh: `约定单价：${en} 越南盾/小时，以成功介绍并实际工作的劳动者的实际工作时间为计算依据，每日最多不超过 ${c.maxHoursPerDay} 小时，加班时间不计入该单价。`,
          en: `Agreed rate: VND ${en}/hour, calculated on the actual working hours of successfully referred workers, up to ${c.maxHoursPerDay} hours/day. Overtime is not included in this rate.`,
        }
      : {
          vi: `Đơn giá thỏa thuận: ${vi} VNĐ/ngày công, được tính trên số ngày làm việc thực tế của người lao động được giới thiệu thành công. Thời gian làm thêm (tăng ca) không được tính vào đơn giá này.`,
          zh: `约定单价：${en} 越南盾/工作日，以成功介绍的劳动者的实际工作天数为计算依据，加班时间不计入该单价。`,
          en: `Agreed rate: VND ${en}/working day, calculated on the actual working days of successfully referred workers. Overtime is not included in this rate.`,
        }, lang));
    out.push(pair({
      vi: `Thời gian chi trả phí: Trong vòng ${p2(c.durationMonths)} (${viNumberWords(c.durationMonths)}) tháng kể từ ngày người lao động chính thức nhận việc tại ${style === 'contract' ? 'Công ty' : P.cusVi}.`,
      zh: `费用支付期限：自劳动者正式到岗之日起 ${c.durationMonths} 个月内支付。`,
      en: `Fee payment period: within ${c.durationMonths} months from the date the worker officially starts work at ${style === 'contract' ? 'the Company' : P.cusEn}.`,
    }, lang));
  } else {
    const vi = vnd(c.lumpFee), en = intl(c.lumpFee);
    out.push(pair({
      vi: `Phí giới thiệu: ${vi} VNĐ/người, áp dụng cho mỗi người lao động được giới thiệu thành công và ký hợp đồng lao động trực tiếp với ${P.cusVi}.`,
      zh: `介绍费：${en} 越南盾/人，适用于每位成功介绍并与${P.cusZh}直接签订劳动合同的劳动者。`,
      en: `Referral fee: VND ${en} per worker, applicable to each successfully referred worker who signs a labor contract directly with ${P.cusEn}.`,
    }, lang));
    if (c.minDays > 0) {
      out.push(pair({
        vi: `Điều kiện tính phí: người lao động làm việc đủ ${p2(c.minDays)} (${viNumberWords(c.minDays)}) ngày kể từ ngày chính thức nhận việc. Người lao động nghỉ việc trước thời hạn này thì không tính phí.`,
        zh: `收费条件：劳动者自正式到岗之日起工作满 ${c.minDays} 天。劳动者在此期限前离职的，不收取费用。`,
        en: `Fee condition: the worker has worked ${c.minDays} full days from the official start date. No fee is charged for workers who leave before this period.`,
      }, lang));
    }
    if (c.guaranteeDays > 0) {
      out.push(pair({
        vi: `Bảo hành: người lao động nghỉ việc trong vòng ${p2(c.guaranteeDays)} ngày sau khi đã tính phí, ${P.usVi} giới thiệu người thay thế miễn phí.`,
        zh: `保证期：已收费的劳动者在 ${c.guaranteeDays} 天内离职的，${P.usZh}免费介绍替补人员。`,
        en: `Guarantee: if a worker leaves within ${c.guaranteeDays} days after the fee is charged, ${P.usEn} will refer a replacement free of charge.`,
      }, lang));
    }
  }
  if (style === 'contract') {
    out.push(pair({
      vi: 'Đơn giá thỏa thuận là đơn giá được ghi nhận trong Phụ lục hợp đồng tại thời điểm Bên B giới thiệu người cho Bên A.',
      zh: '约定的单价是指在乙方向甲方提供人力时，合同附件中所指定的单价。',
      en: 'The agreed rate is the rate specified in the contract appendix at the time Party B refers workers to Party A.',
    }, lang));
  }
  return out;
}

const NOTES_VI = (c: ReferralConfig) => [
  'Người lao động ký hợp đồng lao động và nhận lương trực tiếp từ Quý Công ty.',
  ...(c.mode === 'time' ? ['Phí được đối soát hằng tháng theo bảng chấm công thực tế do Quý Công ty cung cấp.'] : []),
  'Đơn giá chưa bao gồm thuế VAT.',
];
const NOTES_ZH = (c: ReferralConfig) => [
  '劳动者与贵公司直接签订劳动合同并由贵公司直接支付工资。',
  ...(c.mode === 'time' ? ['费用每月根据贵公司提供的实际考勤表核对。'] : []),
  '单价不含增值税（VAT）。',
];
const NOTES_EN = (c: ReferralConfig) => [
  'Workers sign labor contracts with and are paid directly by your Company.',
  ...(c.mode === 'time' ? ['Fees are reconciled monthly based on the actual timesheets provided by your Company.'] : []),
  'Prices exclude VAT.',
];

/** Câu ghi chú mặc định (tiếng Việt) — hiện trong ô sửa để người dùng biết đang dùng câu gì. */
export const defaultReferralNotesVi = (cfgIn: ReferralConfig | null | undefined) => NOTES_VI(normalizeReferral(cfgIn)).join('\n');

/** Ghi chú trên báo giá: người dùng đã sửa thì giữ nguyên chữ của họ (không dịch), chưa sửa thì dùng bản dịch mặc định. */
export function referralNotes(cfgIn: ReferralConfig | null | undefined, lang: TermsLang): TermLine[] {
  const c = normalizeReferral(cfgIn);
  if (c.notes != null && c.notes.trim() !== defaultReferralNotesVi(c).trim()) {
    return c.notes.split('\n').map(s => s.trim()).filter(Boolean).map(a => ({ a }));
  }
  const vi = NOTES_VI(c), zh = NOTES_ZH(c), en = NOTES_EN(c);
  return vi.map((v, i) => (lang === 'zh' ? { a: v, b: zh[i] } : lang === 'en' ? { a: en[i], b: v } : { a: v }));
}

/** Dòng duy nhất của bảng giá: tên + đơn vị + đơn giá theo ngôn ngữ. */
export function referralPriceRow(cfgIn: ReferralConfig | null | undefined, lang: TermsLang): { name: TermLine; unit: TermLine; price: number } {
  const c = normalizeReferral(cfgIn);
  if (c.mode === 'lump') {
    const cond = c.minDays > 0;
    return {
      name: pair({
        vi: `Phí giới thiệu lao động chính thức${cond ? ` (NLĐ làm đủ ${c.minDays} ngày)` : ''}`,
        zh: `正式劳动者介绍费${cond ? `（工作满${c.minDays}天）` : ''}`,
        en: `Referral fee per permanent worker${cond ? ` (after ${c.minDays} full working days)` : ''}`,
      }, lang),
      unit: pair({ vi: 'VNĐ/người', zh: '越南盾/人', en: 'VND/worker' }, lang),
      price: c.lumpFee,
    };
  }
  const hour = c.rateUnit === 'hour';
  return {
    name: pair(hour
      ? { vi: `Phí giới thiệu lao động (theo giờ làm việc thực tế, tối đa ${c.maxHoursPerDay} giờ/ngày)`, zh: `劳动力介绍费（按实际工作小时计算，每日最多${c.maxHoursPerDay}小时）`, en: `Labor referral fee (per actual working hour, max ${c.maxHoursPerDay} hours/day)` }
      : { vi: 'Phí giới thiệu lao động (theo ngày làm việc thực tế)', zh: '劳动力介绍费（按实际工作天数计算）', en: 'Labor referral fee (per actual working day)' }, lang),
    unit: pair(hour ? { vi: 'VNĐ/giờ', zh: '越南盾/小时', en: 'VND/hour' } : { vi: 'VNĐ/ngày', zh: '越南盾/天', en: 'VND/day' }, lang),
    price: c.rate,
  };
}

/** Văn bản thuần để dán vào phụ lục hợp đồng (Word/Excel) — mỗi ý 1 dòng "- …", bản song ngữ thì dòng dịch ngay dưới. */
export function termsToText(lines: TermLine[]): string {
  return lines.flatMap(l => (l.b ? [`- ${l.a}`, `- ${l.b}`] : [`- ${l.a}`])).join('\n');
}
