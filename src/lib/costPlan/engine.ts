// Phương án giá — engine tính toán THUẦN (không React, không DB) nên test được.
//
// Mô hình (giữ đúng bản demo "Bảng cơ cấu đơn giá cung ứng lao động", nâng cấp phần công thức):
//   Tổng chi phí trực tiếp / công = Σ mọi dòng (gồm cả Phí DV)
//   Thuế TNDN dự phòng            = tuỳ chọn (xem TaxOption)
//   Giá báo khách / công          = chi phí trực tiếp + thuế   (chưa VAT; làm tròn lên nếu bật)
//   Lợi nhuận / công              = Phí DV + phần làm tròn dôi ra
//   Lợi nhuận tháng               = lợi nhuận/công × số LĐ × số công → chia Công ty / Chi nhánh theo %
//
// Mỗi dòng chi phí thuộc 1 trong 3 TẦNG để công thức luôn tính được theo đúng 1 lượt, không vòng tròn:
//   A. dòng NHẬP TAY (fixed, không phải Phí DV)           — lương CB, phụ cấp, khám SK...
//   B. dòng TÍNH THEO % hoặc phép năm, không phải Phí DV   — BHXH 21,5%, công đoàn 2%, phép năm...
//      → chỉ được lấy cơ sở từ tầng A (lương CB / lương đóng BH / tổng trả NLĐ nhập tay)
//   C. dòng Phí DV (nhập tay hoặc % trên tổng chi phí)     — tính SAU CÙNG nên lấy được tổng A+B

import type {
  CostLine, PercentBase, PlanData, PlanResult, PlanSettings, PlanSummary, PlanWarning, QuoteSheet,
} from './types';

export const DEFAULT_SETTINGS: PlanSettings = {
  baseDays: 26, taxOption: 'profit20', vatRate: 0, roundTo: 0, workers: 20, simDays: 26, companyPct: 30,
};

/** Trần đóng BHXH = 20 × lương cơ sở 2.340.000 (NĐ 73/2024/NĐ-CP) — cùng hằng số của Tính bảng lương. */
export const INSURANCE_CAP_MONTHLY = 20 * 2_340_000;

export const BASE_LABELS: Record<PercentBase, string> = {
  base_wage: 'Lương cơ bản',
  insurable: 'Lương đóng BHXH',
  worker_fixed: 'Tổng trả NLĐ (nhập tay)',
  cost_total: 'Tổng chi phí trực tiếp',
  worker_total: 'Tổng trả NLĐ',
};

const NON_SERVICE_BASES: PercentBase[] = ['base_wage', 'insurable', 'worker_fixed'];
const SERVICE_BASES: PercentBase[] = ['base_wage', 'insurable', 'worker_fixed', 'cost_total', 'worker_total'];

/** Các cơ sở % mà dòng này được phép chọn. */
export const allowedBases = (l: Pick<CostLine, 'isServiceFee'>): PercentBase[] =>
  l.isServiceFee ? SERVICE_BASES : NON_SERVICE_BASES;

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export const newLineId = () => Math.random().toString(36).slice(2, 10);

export function newLine(p: Partial<CostLine> & { name: string }): CostLine {
  return {
    id: newLineId(), group: 'other', mode: 'fixed', unit: 'day', value: 0,
    paidToWorker: false, note: '', ...p,
  };
}

/** Dòng lương cơ bản luôn là dòng nhập tay — công thức khác đều lấy nó làm gốc. */
const isFixedLike = (l: CostLine) => l.mode === 'fixed' || !!l.isBaseWage;

/** Đọc dữ liệu từ DB (có thể thiếu trường / cũ) về dạng đầy đủ, không bao giờ ném lỗi. */
export function normalizePlanData(raw: unknown): PlanData {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<PlanData>;
  const s = { ...DEFAULT_SETTINGS, ...(r.settings ?? {}) } as PlanSettings;
  s.baseDays = Math.min(31, Math.max(1, Math.round(num(s.baseDays)) || DEFAULT_SETTINGS.baseDays));
  s.workers = Math.max(1, Math.round(num(s.workers)) || DEFAULT_SETTINGS.workers);
  s.simDays = Math.min(31, Math.max(1, Math.round(num(s.simDays)) || DEFAULT_SETTINGS.simDays));
  s.companyPct = Math.min(100, Math.max(0, num(s.companyPct)));
  const lines = (Array.isArray(r.lines) ? r.lines : []).map((l): CostLine => ({
    ...l,
    id: l.id || newLineId(),
    name: String(l.name ?? ''),
    group: l.group ?? 'other',
    mode: l.mode ?? 'fixed',
    unit: l.unit ?? 'day',
    value: num(l.value),
    paidToWorker: !!l.paidToWorker,
    note: l.note ?? '',
  }));
  // Bảng cũ / bảng nhập tay chưa đánh dấu dòng Phí DV nào mà có đúng 1 dòng tên "Phí dịch vụ…" → coi đó là Phí DV
  // (nếu không, tiền phí bị tính nhầm vào chi phí và lợi nhuận hiện 0).
  if (!lines.some(l => l.isServiceFee)) {
    const cand = lines.filter(l => /phi dich vu/.test(l.name.toLowerCase().replace(/đ/g, 'd').normalize('NFD').replace(/[\u0300-\u036f]/g, '')));
    if (cand.length === 1) { cand[0].isServiceFee = true; cand[0].paidToWorker = false; cand[0].isBaseWage = false; cand[0].group = 'service'; }
  }
  const mw = r.minWage && num(r.minWage.monthly) > 0 ? { monthly: num(r.minWage.monthly), label: String(r.minWage.label ?? 'vùng') } : null;
  const quote = (r.quote && typeof r.quote === 'object' ? r.quote : null) as QuoteSheet | null;
  const doc = (r.doc && typeof r.doc === 'object' ? r.doc : null) as PlanData['doc'];
  return { settings: s, lines, notes: typeof r.notes === 'string' ? r.notes : '', minWage: mw, quote, doc };
}

export interface ComputeOptions {
  /** Lương tối thiểu vùng của KCN đã chọn (đ/tháng) — có thì cảnh báo khi lương cơ bản thấp hơn. */
  minWageMonthly?: number | null;
  minWageLabel?: string;
}

export function computePlan(input: PlanData, opts: ComputeOptions = {}): PlanResult {
  const { settings, lines } = normalizePlanData(input);
  const baseDays = settings.baseDays;
  const warnings: PlanWarning[] = [];
  const out: PlanResult['lines'] = {};

  const tierA = lines.filter(l => !l.isServiceFee && isFixedLike(l));
  const tierB = lines.filter(l => !l.isServiceFee && !isFixedLike(l));
  const tierC = lines.filter(l => !!l.isServiceFee);

  const fixedDaily = (l: CostLine) => (l.unit === 'month' ? num(l.value) / baseDays : num(l.value));
  const fixedMonthly = (l: CostLine) => (l.unit === 'month' ? num(l.value) : num(l.value) * baseDays);

  // ── Tầng A ───────────────────────────────────────────────────────────────────────────
  for (const l of tierA) out[l.id] = { daily: fixedDaily(l), monthly: fixedMonthly(l), derived: false };
  const baseWageDaily = sum(tierA.filter(l => l.isBaseWage).map(l => out[l.id].daily));
  const insurableDaily = baseWageDaily + sum(tierA.filter(l => l.insurable && !l.isBaseWage).map(l => out[l.id].daily));
  const workerFixedDaily = sum(tierA.filter(l => l.paidToWorker).map(l => out[l.id].daily));

  // ── Công thức tính một dòng theo % / phép năm ────────────────────────────────────────
  const derive = (l: CostLine, baseOf: (b: PercentBase) => number): number => {
    if (l.mode === 'leave') {
      // Quỹ phép năm có lương dàn đều ra mỗi công: lương/công × số ngày phép ÷ (12 tháng × công chuẩn)
      if (baseWageDaily <= 0) warnings.push({ level: 'warn', lineId: l.id, text: `"${l.name}": chưa có dòng Lương cơ bản nên tính ra 0.` });
      return (baseWageDaily * num(l.value)) / (12 * baseDays);
    }
    const base = l.base ?? 'base_wage';
    if (!allowedBases(l).includes(base)) {
      warnings.push({ level: 'error', lineId: l.id, text: `"${l.name}": chỉ dòng Phí DV mới được tính % trên "${BASE_LABELS[base]}" — đổi cơ sở tính.` });
      return 0;
    }
    const monthlyBase = baseOf(base) * baseDays;
    if (monthlyBase <= 0) {
      warnings.push({ level: 'warn', lineId: l.id, text: `"${l.name}": cơ sở "${BASE_LABELS[base]}" đang bằng 0 nên khoản này tính ra 0.` });
    }
    const capped = l.cap && l.cap > 0 ? Math.min(monthlyBase, l.cap) : monthlyBase;
    if (l.cap && l.cap > 0 && monthlyBase > l.cap) {
      warnings.push({ level: 'info', lineId: l.id, text: `"${l.name}": cơ sở vượt trần ${Math.round(l.cap).toLocaleString('vi-VN')} đ/tháng — chỉ tính trên phần trần.` });
    }
    return (num(l.value) / 100) * capped / baseDays;
  };

  // ── Tầng B ───────────────────────────────────────────────────────────────────────────
  const baseOfAB = (b: PercentBase): number => {
    if (b === 'base_wage') return baseWageDaily;
    if (b === 'insurable') return insurableDaily;
    if (b === 'worker_fixed') return workerFixedDaily;
    return 0; // cost_total / worker_total không hợp lệ ở tầng B (đã chặn trong derive)
  };
  for (const l of tierB) {
    const daily = derive(l, baseOfAB);
    out[l.id] = { daily, monthly: daily * baseDays, derived: true };
  }

  const costDaily = sum([...tierA, ...tierB].map(l => out[l.id].daily));
  const workerAB = sum([...tierA, ...tierB].filter(l => l.paidToWorker).map(l => out[l.id].daily));

  // ── Tầng C (Phí DV) ──────────────────────────────────────────────────────────────────
  const baseOfC = (b: PercentBase): number => {
    if (b === 'cost_total') return costDaily;
    if (b === 'worker_total') return workerAB;
    return baseOfAB(b);
  };
  for (const l of tierC) {
    if (l.mode === 'fixed' || l.isBaseWage) {
      out[l.id] = { daily: fixedDaily(l), monthly: fixedMonthly(l), derived: false };
    } else {
      const daily = derive(l, baseOfC);
      out[l.id] = { daily, monthly: daily * baseDays, derived: true };
    }
  }

  // ── Tổng hợp ─────────────────────────────────────────────────────────────────────────
  const serviceFeeDaily = sum(tierC.map(l => out[l.id].daily));
  const directDaily = costDaily + serviceFeeDaily;
  const workerDaily = sum(lines.filter(l => l.paidToWorker).map(l => out[l.id].daily));
  const workerMonthly = sum(lines.filter(l => l.paidToWorker).map(l => out[l.id].monthly));

  let taxDaily = 0;
  if (settings.taxOption === 'profit20') taxDaily = serviceFeeDaily / 0.8 - serviceFeeDaily; // = 25% Phí DV → sau thuế 20% vẫn còn đủ Phí DV
  else if (settings.taxOption === 'total20') taxDaily = directDaily * 0.2;

  const quoteRawDaily = directDaily + taxDaily;
  const step = settings.roundTo;
  const quoteDaily = step > 0 ? Math.ceil(quoteRawDaily / step - 1e-9) * step : quoteRawDaily;
  const roundingGainDaily = quoteDaily - quoteRawDaily;
  const profitDaily = serviceFeeDaily + roundingGainDaily;

  const workers = Math.max(1, Math.round(settings.workers));
  const simDays = Math.max(1, Math.round(settings.simDays));
  const totalManDays = workers * simDays;
  const profitMonthly = profitDaily * totalManDays;
  const pct = Math.min(100, Math.max(0, settings.companyPct));
  const companyProfit = Math.round((profitMonthly * pct) / 100);
  const branchProfit = Math.round(profitMonthly) - companyProfit;

  // ── Cảnh báo cấp phương án ───────────────────────────────────────────────────────────
  if (!lines.some(l => l.isBaseWage)) {
    warnings.push({ level: 'warn', text: 'Chưa đánh dấu dòng "Lương cơ bản" — các khoản tính theo % / phép năm sẽ bằng 0.' });
  }
  const baseWageMonthly = sum(tierA.filter(l => l.isBaseWage).map(l => out[l.id].monthly));
  if (opts.minWageMonthly && baseWageMonthly > 0 && baseWageMonthly < opts.minWageMonthly) {
    warnings.push({
      level: 'error',
      text: `Lương cơ bản ${Math.round(baseWageMonthly).toLocaleString('vi-VN')} đ/tháng THẤP HƠN lương tối thiểu ${opts.minWageLabel ?? 'vùng'} (${Math.round(opts.minWageMonthly).toLocaleString('vi-VN')} đ) — không hợp lệ theo Điều 90 BLLĐ 2019.`,
    });
  }
  if (serviceFeeDaily <= 0) {
    warnings.push({ level: 'warn', text: 'Chưa có Phí dịch vụ — phương án này không tạo ra lợi nhuận.' });
  } else if (quoteDaily > 0 && (profitDaily / quoteDaily) * 100 < 5) {
    warnings.push({ level: 'warn', text: 'Biên lợi nhuận dưới 5% giá báo — rất mỏng, dễ lỗ khi phát sinh.' });
  }
  if (pct === 0 || pct === 100) {
    warnings.push({ level: 'info', text: pct === 100 ? 'Toàn bộ lợi nhuận về công ty, chi nhánh không nhận gì.' : 'Toàn bộ lợi nhuận về chi nhánh, công ty không nhận gì.' });
  }
  const dupNames = new Set<string>();
  for (const l of lines) {
    const k = l.name.trim().toLowerCase();
    if (!k) continue;
    if (dupNames.has(k)) warnings.push({ level: 'info', lineId: l.id, text: `Trùng tên khoản "${l.name}" — kiểm tra không tính 2 lần.` });
    dupNames.add(k);
  }

  return {
    lines: out,
    baseWageDaily, insurableDaily,
    workerDaily, workerMonthly,
    directDaily, costDaily, serviceFeeDaily, taxDaily,
    quoteRawDaily, quoteDaily, roundingGainDaily,
    quoteMonthly: quoteDaily * baseDays,
    quoteWithVatDaily: quoteDaily * (1 + settings.vatRate),
    profitDaily, totalManDays,
    revenueMonthly: quoteDaily * totalManDays,
    profitMonthly, companyProfit, branchProfit,
    companyPerDay: (profitDaily * pct) / 100,
    branchPerDay: profitDaily - (profitDaily * pct) / 100,
    marginPct: quoteDaily > 0 ? (profitDaily / quoteDaily) * 100 : 0,
    warnings,
  };
}

export function summarizePlan(data: PlanData, r: PlanResult): PlanSummary {
  const d = normalizePlanData(data);
  return {
    quoteDaily: Math.round(r.quoteDaily),
    workerDaily: Math.round(r.workerDaily),
    serviceFeeDaily: Math.round(r.serviceFeeDaily),
    profitDaily: Math.round(r.profitDaily),
    profitMonthly: Math.round(r.profitMonthly),
    marginPct: Math.round(r.marginPct * 10) / 10,
    workers: d.settings.workers,
    baseWageMonthly: Math.round(sum(d.lines.filter(l => l.isBaseWage).map(l => r.lines[l.id]?.monthly ?? 0))),
    companyPct: d.settings.companyPct,
    lineCount: d.lines.length,
  };
}

// ── Sửa số tiền 1 dòng từ ô "Đơn giá/ngày" hay "Đơn giá/tháng" ────────────────────────────
// Ô nào người dùng gõ thì thành đơn vị GỐC của dòng (giữ nguyên con số họ gõ, không làm tròn
// qua lại) — ô kia chỉ là số quy đổi. Bản demo làm tròn khi đổi chiều nên 6.100.000 ↔ 234.615
// bị lệch; ở đây không lệch.
export function withAmountEdit(l: CostLine, field: 'daily' | 'monthly', amount: number): CostLine {
  return { ...l, mode: 'fixed', unit: field === 'daily' ? 'day' : 'month', value: Math.max(0, num(amount)) };
}

/**
 * Đặt lại Phí DV để GIÁ BÁO KHÁCH / công = `targetQuoteDaily` (bài toán ngược: "khách chốt
 * 430.000 thì phí DV còn bao nhiêu?"). Trả về dòng Phí DV mới (mode fixed, đ/công) hoặc null
 * nếu không có dòng Phí DV hay không đạt được (phí âm).
 */
export function solveServiceFee(data: PlanData, targetQuoteDaily: number): CostLine | null {
  const d = normalizePlanData(data);
  const fee = d.lines.find(l => l.isServiceFee);
  if (!fee) return null;
  const zeroed: PlanData = { ...d, settings: { ...d.settings, roundTo: 0 }, lines: d.lines.map(l => (l.id === fee.id ? { ...l, mode: 'fixed' as const, unit: 'day' as const, value: 0 } : l)) };
  const r = computePlan(zeroed);
  const cost = r.costDaily;          // chi phí không gồm Phí DV
  const otherFee = r.serviceFeeDaily; // các dòng Phí DV khác (nếu có) — dòng đang giải đã về 0
  let totalFee: number;
  if (d.settings.taxOption === 'profit20') totalFee = (targetQuoteDaily - cost) * 0.8;     // quote = cost + fee/0,8
  else if (d.settings.taxOption === 'total20') totalFee = targetQuoteDaily / 1.2 - cost;    // quote = (cost + fee) × 1,2
  else totalFee = targetQuoteDaily - cost;
  const feeDaily = totalFee - otherFee;
  if (!Number.isFinite(feeDaily) || feeDaily < 0) return null;
  return { ...fee, mode: 'fixed', unit: 'day', value: Math.round(feeDaily) };
}
