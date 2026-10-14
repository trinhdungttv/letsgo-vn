// Phương án giá — BƯỚC 2: "Bảng giá dịch vụ" gửi khách, tự tính từ chi phí ở bước 1.
//
// Cách tính (đối chiếu với bảng giá thật của công ty: lương cơ bản 250.000/công, giá ngày 424.000):
//   • Ngày 8 tiếng        = giá 1 công của phương án (chi phí + phí DV + thuế dự phòng, đã làm tròn)
//   • Ca đêm 8 tiếng      = giá ngày + 30% × lương/công       (tiền lương làm đêm ≥ +30% — Điều 98.2 BLLĐ 2019)
//   • Tăng ca 1 giờ       = đơn giá giờ chuẩn × hệ số luật     (đơn giá giờ chuẩn = lương/công ÷ 8)
//       ngày thường 150% · ban đêm 200% (210% nếu liền sau ca ngày) · Chủ nhật 200% · CN ban đêm 270%
//       lễ/Tết 300% · lễ/Tết ban đêm 390%                      (Điều 98 BLLĐ 2019, Điều 57 NĐ 145/2020)
//   Ví dụ khớp bảng thật: 250.000 ÷ 8 = 31.250 → 46.875 · 62.500 · 62.500 · 84.375, ca đêm 424.000 + 75.000 = 499.000.

import {
  NORM_NIGHT, OT_DAY_WEEKDAY, OT_DAY_SUNDAY, OT_DAY_HOLIDAY,
  OT_NIGHT_WEEKDAY_NOPRIOR, OT_NIGHT_WEEKDAY_PRIOR, OT_NIGHT_SUNDAY, OT_NIGHT_HOLIDAY,
} from '../payroll/coefficients';
import { computePlan, normalizePlanData, newLineId } from './engine';
import { lineKey } from './presets';
import { builtinRefByName } from './catalogData';
import type { PlanData, PlanResult, QuoteRowCfg, QuoteRowKind, QuoteSheet, RowCalc, RowCalcBase, SkilledTier } from './types';

/** Số giờ của 1 ngày công chuẩn — cơ sở quy đổi lương ngày ra lương giờ. */
export const HOURS_PER_DAY = 8;

const STD: { kind: QuoteRowKind; name: string; unit: string; hidden?: boolean }[] = [
  { kind: 'day8', name: 'Lương ngày làm việc 8 tiếng', unit: 'VNĐ/ngày' },
  { kind: 'night8', name: 'Lương ngày làm việc 8 tiếng ca đêm', unit: 'VNĐ/ngày (ca đêm)' },
  { kind: 'ot_day', name: 'Lương tăng ca ngày 1 tiếng', unit: 'VNĐ/giờ' },
  { kind: 'ot_night', name: 'Lương tăng ca 1 tiếng ca đêm', unit: 'VNĐ/giờ (ca đêm)' },
  { kind: 'ot_sun', name: 'Lương tăng ca ngày chủ nhật 1 tiếng', unit: 'VNĐ/giờ' },
  { kind: 'ot_sun_night', name: 'Lương tăng ca ngày chủ nhật 1 tiếng ca đêm', unit: 'VNĐ/giờ (ca đêm)' },
  { kind: 'ot_hol', name: 'Lương tăng ca ngày lễ, Tết 1 tiếng', unit: 'VNĐ/giờ', hidden: true },
  { kind: 'ot_hol_night', name: 'Lương tăng ca ngày lễ, Tết 1 tiếng ca đêm', unit: 'VNĐ/giờ (ca đêm)', hidden: true },
  // Chỉ xuất hiện khi có khoản "thu riêng theo tháng" (computePriceList tự bỏ khi không có)
  { kind: 'insurance', name: 'Bảo hiểm xã hội, y tế, thất nghiệp', unit: 'VNĐ/người/tháng' },
  // Chỉ xuất hiện khi báo giá TÁCH KHOẢN (computePriceList tự bỏ khi gộp)
  { kind: 'service_fee', name: 'Phí dịch vụ', unit: 'VNĐ/ngày công' },
];

export const DEFAULT_GENERAL_NOTES = [
  'Báo giá chưa bao gồm thuế VAT.',
  'Báo giá chưa bao gồm tiền cơm và các khoản chi phí khác.',
  'Báo giá không bao gồm các yêu cầu phát sinh khác từ khách hàng.',
].join('\n');

/** Dòng chính đổi đơn vị khi báo THEO GIỜ (giá công ÷ 8) */
export const PER_HOUR_KINDS: QuoteRowKind[] = ['day8', 'night8', 'service_fee'];
/** Tên / đơn vị mặc định khi báo theo giờ — chỉ thay khi dòng còn giữ tên/đơn vị mặc định (người dùng đã đặt tên riêng thì giữ) */
const HOURLY_NAME: Partial<Record<QuoteRowKind, string>> = { day8: 'Lương 1 giờ làm việc ca ngày', night8: 'Lương 1 giờ làm việc ca đêm' };
const HOURLY_UNIT: Partial<Record<QuoteRowKind, string>> = { day8: 'VNĐ/giờ', night8: 'VNĐ/giờ (ca đêm)', service_fee: 'VNĐ/giờ' };

/**
 * Đổi đơn vị giá ngày ⇄ giờ: các giá đã ghi tay ở dòng chính quy đổi theo (÷ 8 hoặc × 8) để không bị lệch nghĩa.
 */
export function setPerHour(q: QuoteSheet, perHour: boolean): QuoteSheet {
  if (!!q.perHour === perHour) return q;
  const conv = (v: number | null | undefined) => (v == null ? v : Math.round(perHour ? v / HOURS_PER_DAY : v * HOURS_PER_DAY));
  return {
    ...q, perHour,
    rows: q.rows.map(r => (PER_HOUR_KINDS.includes(r.kind) ? { ...r, override: conv(r.override) ?? null, overrideSkilled: conv(r.overrideSkilled) ?? null } : r)),
  };
}

export function defaultQuoteSheet(): QuoteSheet {
  return {
    // Mã CỐ ĐỊNH theo loại dòng: phương án chưa lưu bảng giá vẫn ra cùng mã mỗi lần vẽ (mã ngẫu nhiên làm nút ⋯ không mở được,
    // kéo thả / hoàn tác không tìm được dòng). Dòng chuẩn mỗi loại chỉ có 1 nên không trùng; dòng tuỳ chỉnh vẫn mã ngẫu nhiên.
    rows: STD.map(r => ({ id: `std-${r.kind}`, kind: r.kind, name: r.name, unit: r.unit, override: null, hidden: !!r.hidden })),
    includedNote: null, generalNotes: DEFAULT_GENERAL_NOTES, otBase: 'base', otMarkupPct: 0, nightOtAfterDay: false,
  };
}

/** Đọc từ DB (có thể thiếu / cũ) về dạng đầy đủ: luôn có đủ các dòng chuẩn (dòng thiếu thêm vào ở trạng thái ẩn). */
export function normalizeQuoteSheet(raw: QuoteSheet | null | undefined): QuoteSheet {
  const def = defaultQuoteSheet();
  if (!raw || typeof raw !== 'object') return def;
  const rows: QuoteRowCfg[] = (Array.isArray(raw.rows) ? raw.rows : []).map(r => ({
    id: r.id || newLineId(), kind: r.kind ?? 'custom', name: String(r.name ?? ''), unit: String(r.unit ?? 'VNĐ/ngày'),
    override: r.override != null && Number.isFinite(Number(r.override)) ? Number(r.override) : null, hidden: !!r.hidden,
    overrideSkilled: r.overrideSkilled != null && Number.isFinite(Number(r.overrideSkilled)) ? Number(r.overrideSkilled) : null,
    ...(r.kind === 'custom' && cleanCalc(r.calc) ? { calc: cleanCalc(r.calc)! } : {}),
    ...(r.kind === 'custom' && typeof r.catalogId === 'string' && r.catalogId.trim() ? { catalogId: r.catalogId.trim().slice(0, 64) } : {}),
    ...(r.i18n && (r.i18n.zh || r.i18n.en) ? { i18n: { ...(r.i18n.zh ? { zh: String(r.i18n.zh) } : {}), ...(r.i18n.en ? { en: String(r.i18n.en) } : {}) } } : {}),
  }));
  // Dòng chuẩn thiếu (dữ liệu cũ) thêm vào ở trạng thái ẩn — riêng dòng bảo hiểm thì hiện, vì nó tự ẩn khi không có khoản thu riêng
  for (const d of def.rows) if (!rows.some(r => r.kind === d.kind)) rows.push({ ...d, hidden: d.kind !== 'insurance' && d.kind !== 'service_fee' });
  // Chưa tự sắp thì xếp theo thứ tự chuẩn (dòng tuỳ chỉnh cuối, giữ thứ tự thêm); đã kéo thả thì giữ đúng thứ tự người dùng
  if (!raw.ordered) {
    const order = new Map(STD.map((s, i) => [s.kind, i]));
    rows.sort((a, b) => (order.get(a.kind) ?? 99) - (order.get(b.kind) ?? 99));
  }
  return {
    rows,
    includedNote: typeof raw.includedNote === 'string' ? raw.includedNote : null,
    generalNotes: typeof raw.generalNotes === 'string' ? raw.generalNotes : DEFAULT_GENERAL_NOTES,
    otBase: raw.otBase === 'worker' ? 'worker' : 'base',
    otMarkupPct: Number.isFinite(Number(raw.otMarkupPct)) ? Math.max(0, Number(raw.otMarkupPct)) : 0,
    nightOtAfterDay: !!raw.nightOtAfterDay,
    skilled: normalizeSkilled(raw.skilled),
    ...(raw.ordered ? { ordered: true } : {}),
    ...(raw.itemized ? { itemized: true } : {}),
    ...(raw.perHour ? { perHour: true } : {}),
  };
}

/**
 * Báo giá TÁCH KHOẢN: tiền 1 công tách thành phần lương (chi phí lao động trong giá ngày, không gồm bảo hiểm thu riêng)
 * và phần phí dịch vụ (phí DV + thuế dự phòng + làm tròn). Cộng lại đúng bằng giá 1 công khi gộp.
 */
export function itemizedParts(r: PlanResult): { wage: number; fee: number } {
  const wage = r.costDaily - r.separatedDaily;
  return { wage, fee: r.quoteDaily - wage };
}

/**
 * Chuyển dòng `fromId` tới vị trí dòng `toId` (kéo xuống → nằm sau, kéo lên → nằm trước), đánh dấu đã tự sắp.
 * Trả về nguyên bảng nếu id không hợp lệ.
 */
export function moveQuoteRow(q: QuoteSheet, fromId: string, toId: string): QuoteSheet {
  const fi = q.rows.findIndex(r => r.id === fromId), ti = q.rows.findIndex(r => r.id === toId);
  if (fi < 0 || ti < 0 || fi === ti) return q;
  const rows = [...q.rows];
  const [m] = rows.splice(fi, 1);
  rows.splice(ti, 0, m);
  return { ...q, rows, ordered: true };
}

export const DEFAULT_SKILLED_LABEL = 'Thợ tay nghề';

const CALC_BASES: RowCalcBase[] = ['none', 'day', 'night', 'dayHour', 'nightHour', 'insSalary'];

/** Làm sạch công thức dòng tự đặt; null nếu không hợp lệ (→ dòng nhập tay). */
export function cleanCalc(raw: unknown): RowCalc | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Partial<RowCalc>;
  const base: RowCalcBase = CALC_BASES.includes(c.base as RowCalcBase) ? c.base as RowCalcBase : 'none';
  const hours = base === 'insSalary' ? 0 : Number(c.hours), coef = Number(c.coef);
  if (!Number.isFinite(hours) || !Number.isFinite(coef) || hours < 0 || coef < 0 || (hours === 0 && base === 'none')) return null;
  return { base, hours: Math.min(24, hours), coef: Math.min(10, coef) };
}

/**
 * MÃ DANH MỤC của các dòng chuẩn (theo loại dòng) — để so sánh giữa các dự án không cần người dùng tự gắn.
 * Báo theo giờ thì dòng ca ngày / ca đêm là mục "1 giờ".
 */
export const STD_CATALOG_ID: Record<Exclude<QuoteRowKind, 'custom'>, string> = {
  day8: 'b-day8', night8: 'b-night8', ot_day: 'b-ot-day', ot_night: 'b-ot-night', ot_sun: 'b-ot-sun', ot_sun_night: 'b-ot-sun-night',
  ot_hol: 'b-ot-hol', ot_hol_night: 'b-ot-hol-night', insurance: 'b-ins-all', service_fee: 'b-svc-fee',
};
const STD_CATALOG_ID_HOURLY: Partial<Record<QuoteRowKind, string>> = { day8: 'b-hour-day', night8: 'b-hour-night' };

/**
 * Mã danh mục quy chiếu của 1 dòng: dòng chuẩn suy theo loại; dòng tự đặt lấy `catalogId` đã gắn, không thì tự gắn khi tên trùng
 * đúng tên (hoặc tên cũ) của mục có sẵn; còn lại null = chưa gắn.
 */
export function rowCatalogRef(r: Pick<QuoteRowCfg, 'kind' | 'catalogId' | 'name'>, perHour?: boolean): string | null {
  if (r.kind === 'custom') return r.catalogId || builtinRefByName(r.name);
  return (perHour && STD_CATALOG_ID_HOURLY[r.kind]) || STD_CATALOG_ID[r.kind];
}

function normalizeSkilled(raw: unknown): SkilledTier | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<SkilledTier>;
  const n = (v: unknown) => (Number.isFinite(Number(v)) ? Math.max(0, Number(v)) : 0);
  return {
    on: !!r.on,
    label: typeof r.label === 'string' && r.label.trim() ? r.label : DEFAULT_SKILLED_LABEL,
    wage: n(r.wage),
    wageUnit: r.wageUnit === 'day' ? 'day' : 'month',
    serviceFee: r.serviceFee == null || !Number.isFinite(Number(r.serviceFee)) ? null : Math.max(0, Number(r.serviceFee)),
  };
}

/**
 * Phương án "phiên bản thợ tay nghề": thay Lương cơ bản (và Phí DV nếu đặt riêng), giá gõ tay lấy ở cột thợ.
 * null khi chưa bật cột thợ. BHXH, công đoàn, phép năm… tự tính lại theo lương thợ.
 */
export function skilledPlanData(input: PlanData): PlanData | null {
  const data = normalizePlanData(input);
  const q = normalizeQuoteSheet(data.quote);
  const sk = q.skilled;
  if (!sk?.on) return null;
  let baseDone = false, feeDone = false;
  const lines = data.lines.map(l => {
    if (l.isBaseWage) {
      if (sk.wage <= 0) return l;
      if (baseDone) return { ...l, mode: 'fixed' as const, value: 0 };
      baseDone = true;
      return { ...l, mode: 'fixed' as const, unit: sk.wageUnit, value: sk.wage };
    }
    if (l.isServiceFee && sk.serviceFee != null) {
      if (feeDone) return { ...l, mode: 'fixed' as const, unit: 'day' as const, value: 0 };
      feeDone = true;
      return { ...l, mode: 'fixed' as const, unit: 'day' as const, value: sk.serviceFee };
    }
    return l;
  });
  return {
    ...data, lines,
    quote: { ...q, skilled: { ...sk, on: false }, rows: q.rows.map(r => ({ ...r, override: r.kind === 'custom' && !r.calc ? (r.overrideSkilled ?? r.override ?? null) : (r.overrideSkilled ?? null) })) },
  };
}

export interface PriceRow {
  id: string;
  kind: QuoteRowKind;
  name: string;
  unit: string;
  /** Giá hiển thị (đã tính hoặc gõ tay), làm tròn đồng */
  price: number;
  /** Giá tự tính (null với dòng tuỳ chỉnh) */
  auto: number | null;
  overridden: boolean;
  hidden: boolean;
  /** Công thức bằng lời để người dùng hiểu số từ đâu ra */
  formula: string;
  /** Ghi chú in cạnh dòng (cột Ghi chú khi xuất Excel / sao chép) */
  note?: string;
  /** Giá cột Thợ tay nghề (chỉ khi bật cột thợ) */
  skilled?: { price: number; auto: number | null; overridden: boolean; formula: string };
  /** Bản dịch tên dòng (người dùng tự điền) */
  i18n?: { zh?: string; en?: string };
  /** Công thức của dòng tuỳ chỉnh tự tính */
  calc?: RowCalc;
  /** Mã danh mục quy chiếu (xem rowCatalogRef) — null = dòng tự đặt chưa gắn danh mục */
  ref: string | null;
}

/** Bối cảnh để tính dòng tự đặt có công thức (và xem trước trong màn Quản lý kho). */
export interface CalcCtx {
  dayPrice: number; nightPrice: number; shr: number; mk: number;
  /** Lương đóng BHXH / tháng của phương án (cho các dòng tính theo % BHXH) */
  insSalary?: number;
}

/** Giá của dòng có công thức = [nền] + số giờ × giờ chuẩn × hệ số; dòng theo % BHXH = lương đóng BHXH × hệ số. */
export function calcValue(c: RowCalc, ctx: CalcCtx): number {
  if (c.base === 'insSalary') return (ctx.insSalary ?? 0) * c.coef;
  const start = c.base === 'day' ? ctx.dayPrice : c.base === 'night' ? ctx.nightPrice
    : c.base === 'dayHour' ? ctx.dayPrice / HOURS_PER_DAY : c.base === 'nightHour' ? ctx.nightPrice / HOURS_PER_DAY : 0;
  return start + c.hours * ctx.shr * c.coef * ctx.mk;
}

/**
 * Bối cảnh MẪU để xem trước giá khi mở kho đầu mục ngoài phương án: lương mẫu / công (giá ngày = lương, chưa gồm phí DV),
 * ca đêm +30%, giờ chuẩn = lương ÷ 8, lương đóng BHXH ≈ lương × 26 công.
 */
export const sampleCalcCtx = (wageDaily: number): CalcCtx => ({
  dayPrice: wageDaily, nightPrice: wageDaily * NORM_NIGHT, shr: wageDaily / HOURS_PER_DAY, mk: 1, insSalary: wageDaily * 26,
});

/** Công thức bằng số để người dùng hiểu giá từ đâu ra: "Giá ngày 300.000 + 4 giờ × 31.250 đ/giờ × 150%". */
export function calcFormula(c: RowCalc, ctx: CalcCtx, otMarkupPct = 0): string {
  if (c.base === 'insSalary') return `${pct(c.coef)} × lương đóng BHXH ${f(ctx.insSalary ?? 0)} đ/tháng`;
  const start = c.base === 'day' ? `Giá ngày ${f(ctx.dayPrice)}` : c.base === 'night' ? `Giá ca đêm ${f(ctx.nightPrice)}`
    : c.base === 'dayHour' ? `Giá ngày ${f(ctx.dayPrice)} ÷ 8 giờ` : c.base === 'nightHour' ? `Giá ca đêm ${f(ctx.nightPrice)} ÷ 8 giờ` : '';
  const hrs = c.hours > 0 && c.coef > 0 ? `${c.hours} giờ × ${f(ctx.shr)} đ/giờ × ${pct(c.coef)}${otMarkupPct > 0 ? ` + ${otMarkupPct}%` : ''}` : '';
  return [start, hrs].filter(Boolean).join(' + ') || '0';
}

export interface PriceList {
  /** Bối cảnh tính công thức của bảng giá hiện tại */
  calcCtx?: CalcCtx;
  rows: PriceRow[];
  /** Cơ sở tính (lương/công) dùng cho giờ tăng ca & phụ cấp đêm */
  otBaseDaily: number;
  /** Đơn giá giờ chuẩn = cơ sở ÷ 8 */
  shr: number;
  /** Cột thợ tay nghề đang bật: tên cột + kết quả tính theo lương thợ (để hiện lợi nhuận/công của thợ) */
  skilled?: { label: string; result: EffectiveResult } | null;
}

const f = (n: number) => Math.round(n).toLocaleString('vi-VN');
const pct = (c: number) => `${Math.round(c * 1000) / 10}%`;

export function computePriceList(input: PlanData, result: PlanResult): PriceList {
  const data = normalizePlanData(input);
  const q = normalizeQuoteSheet(data.quote);
  const otBaseDaily = q.otBase === 'worker' ? result.workerDaily : result.baseWageDaily;
  const shr = otBaseDaily / HOURS_PER_DAY;
  const mk = 1 + q.otMarkupPct / 100;
  // Giá ngày thật = giá người dùng ghi ở dòng ca 8h (nếu có), không thì giá tự tính từ bước 1 — ca đêm tính theo giá này
  const itemized = !!q.itemized;
  const parts = itemizedParts(result);
  // Báo theo giờ: dòng chính = giá công ÷ 8, giá ghi tay ở các dòng đó cũng là giá/giờ
  const perHour = !!q.perHour;
  const div = perHour ? HOURS_PER_DAY : 1;
  const dayRow = q.rows.find(r => r.kind === 'day8' && !r.hidden && r.override != null);
  // Giá ngày (1 công) dùng để tính ca đêm: gộp = giá 1 công; tách khoản = phần lương
  const dayPrice = dayRow ? Math.max(0, dayRow.override!) * div : itemized ? parts.wage : result.quoteDaily;
  const hTxt = perHour ? ' ÷ 8 giờ' : '';
  const mkTxt = q.otMarkupPct > 0 ? ` + ${q.otMarkupPct}%` : '';

  const auto = (kind: QuoteRowKind): { v: number | null; formula: string } => {
    const ot = (c: number, label: string) => ({ v: shr * c * mk, formula: `${f(shr)} đ/giờ × ${pct(c)}${mkTxt} — ${label}` });
    switch (kind) {
      case 'day8': return itemized
        ? { v: parts.wage / div, formula: `Chi phí lao động / công ở bước 1${hTxt}${result.separatedDaily > 0 ? ' (không gồm bảo hiểm thu riêng)' : ''} — phí dịch vụ là dòng riêng` }
        : { v: result.quoteDaily / div, formula: `Giá 1 công từ bước 1: chi phí + phí dịch vụ + thuế dự phòng${perHour ? ` (${f(result.quoteDaily)} đ ÷ 8 giờ)` : ''}` };
      case 'service_fee': return { v: parts.fee / div, formula: `Phí dịch vụ ${f(result.serviceFeeDaily)} đ${result.taxDaily > 0.5 ? ` + thuế dự phòng ${f(result.taxDaily)} đ` : ''}${result.roundingGainDaily > 0.5 ? ' + làm tròn' : ''} / ngày công${hTxt}` };
      case 'night8': return { v: (dayPrice + otBaseDaily * (NORM_NIGHT - 1)) / div, formula: `(Giá ngày${dayRow ? ` đang báo (${f(dayPrice)})` : ''} + 30% × ${f(otBaseDaily)} đ)${hTxt} — làm đêm tối thiểu +30% (Điều 98 BLLĐ)` };
      case 'ot_day': return ot(OT_DAY_WEEKDAY, 'tăng ca ngày thường 150%');
      case 'ot_night': return q.nightOtAfterDay ? ot(OT_NIGHT_WEEKDAY_PRIOR, 'tăng ca đêm liền sau ca ngày 210%') : ot(OT_NIGHT_WEEKDAY_NOPRIOR, 'tăng ca đêm ngày thường 200%');
      case 'ot_sun': return ot(OT_DAY_SUNDAY, 'ngày nghỉ hằng tuần 200%');
      case 'ot_sun_night': return ot(OT_NIGHT_SUNDAY, 'ngày nghỉ hằng tuần, ban đêm 270%');
      case 'ot_hol': return ot(OT_DAY_HOLIDAY, 'ngày lễ, Tết 300%');
      case 'ot_hol_night': return ot(OT_NIGHT_HOLIDAY, 'ngày lễ, Tết, ban đêm 390%');
      case 'insurance': return { v: result.separatedMonthly, formula: `Thu riêng mỗi tháng, chỉ NLĐ làm từ ${result.separateMinDays} công/tháng — không cộng vào giá ngày` };
      default: return { v: null, formula: 'Nhập tay' };
    }
  };

  const calcCtx: CalcCtx = { dayPrice, nightPrice: dayPrice + otBaseDaily * (NORM_NIGHT - 1), shr, mk, insSalary: result.insuranceSalaryMonthly };
  const rows: PriceRow[] = q.rows
    .filter(r => (r.kind !== 'insurance' || result.separatedMonthly > 0) && (r.kind !== 'service_fee' || itemized))
    .map(r => {
    let a = auto(r.kind);
    if (r.kind === 'custom' && r.calc) a = { v: calcValue(r.calc, calcCtx), formula: calcFormula(r.calc, calcCtx, q.otMarkupPct) };
    const overridden = (r.kind !== 'custom' || !!r.calc) && r.override != null;
    const price = r.kind === 'custom' && !r.calc ? Math.round(r.override ?? 0) : Math.round(overridden ? r.override! : a.v ?? 0);
    // Báo theo giờ: dòng chính còn giữ tên/đơn vị mặc định thì đổi sang tên/đơn vị theo giờ
    const std = STD.find(x => x.kind === r.kind);
    const hourly = perHour && PER_HOUR_KINDS.includes(r.kind);
    const name = hourly && std && r.name === std.name && HOURLY_NAME[r.kind] ? HOURLY_NAME[r.kind]! : r.name;
    const unit = hourly && std && r.unit === std.unit && HOURLY_UNIT[r.kind] ? HOURLY_UNIT[r.kind]! : r.unit;
    return {
      id: r.id, kind: r.kind, name, unit, price,
      auto: a.v == null ? null : Math.round(a.v), overridden, hidden: !!r.hidden, formula: overridden ? `Đã sửa tay (tự tính: ${f(a.v ?? 0)} đ)` : a.formula,
      ...(r.calc ? { calc: r.calc } : {}),
      ref: rowCatalogRef(r, perHour),
      ...(r.kind === 'insurance' ? { note: `Chỉ áp dụng cho NLĐ làm từ ${result.separateMinDays} công/tháng trở lên` } : {}),
      ...(r.i18n ? { i18n: r.i18n } : {}),
    };
  });
  // Cột thợ tay nghề: tính lại cả bảng với lương thợ (phiên bản thợ không bật cột thợ nên không gọi đệ quy mãi)
  const sd = skilledPlanData(data);
  if (!sd) return { rows, otBaseDaily, shr, skilled: null, calcCtx };
  const sr = computePlan(sd);
  const sl = computePriceList(sd, sr);
  const byId = new Map(sl.rows.map(r => [r.id, r]));
  const cfg = new Map(q.rows.map(r => [r.id, r]));
  return {
    rows: rows.map(r => {
      const s = byId.get(r.id);
      if (!s) return r;
      const c = cfg.get(r.id);
      const manualCustom = r.kind === 'custom' && !r.calc;
      const overridden = manualCustom ? c?.overrideSkilled != null : s.overridden;
      return { ...r, skilled: { price: s.price, auto: s.auto, overridden, formula: manualCustom && !overridden ? 'Như lao động phổ thông' : s.formula } };
    }),
    otBaseDaily, shr, calcCtx,
    skilled: { label: q.skilled?.label || DEFAULT_SKILLED_LABEL, result: effectiveResult(sd, sr) },
  };
}

export interface EffectiveResult extends PlanResult {
  /** Giá ca 8h đang báo khách là số người dùng tự ghi ở Bảng giá (không phải giá tự tính) */
  dayOverridden: boolean;
  /** Giá 1 công tự tính từ bước 1 — để tham khảo */
  autoQuoteDaily: number;
}

/**
 * Kết quả theo GIÁ ĐANG BÁO KHÁCH. Bảng 1 (chi phí) chỉ là tham khảo: người dùng ghi giá ca 8h khác ở Bảng giá thì lợi nhuận,
 * chia lợi nhuận, doanh thu, số lưu vào danh sách đều tính theo giá đó. Phần chênh so với giá tự tính chia vào thuế dự phòng
 * đúng như cách tính giá (lãi 20%: 80% vào lợi nhuận; 20% tổng: 1/1,2; không thuế: toàn bộ). Ghi đúng bằng giá tự tính → y hệt.
 */
export function effectiveResult(input: PlanData, r: PlanResult): EffectiveResult {
  const data = normalizePlanData(input);
  const q = normalizeQuoteSheet(data.quote);
  const row = q.rows.find(x => x.kind === 'day8' && !x.hidden && x.override != null);
  // Tách khoản: khách trả = dòng lương + dòng phí dịch vụ (mỗi dòng có thể ghi tay). Gộp: chỉ dòng giá ngày.
  // Báo theo giờ: giá ghi tay là giá/giờ → quy ra công (× 8)
  const mul = q.perHour ? HOURS_PER_DAY : 1;
  let price: number;
  if (q.itemized) {
    const parts = itemizedParts(r);
    const feeRow = q.rows.find(x => x.kind === 'service_fee' && !x.hidden && x.override != null);
    if (!row && !feeRow) return { ...r, dayOverridden: false, autoQuoteDaily: r.quoteDaily };
    price = Math.max(0, Math.round((row ? row.override! * mul : parts.wage) + (feeRow ? feeRow.override! * mul : parts.fee)));
  } else {
    if (!row) return { ...r, dayOverridden: false, autoQuoteDaily: r.quoteDaily };
    price = Math.max(0, Math.round(row.override! * mul));
  }
  const s = data.settings;
  const delta = price - r.quoteDaily;
  const k = s.taxOption === 'profit20' ? 0.8 : s.taxOption === 'total20' ? 1 / 1.2 : 1;
  let profitDaily = r.profitDaily + delta * k;
  let taxDaily = r.taxDaily + delta * (1 - k);
  if (taxDaily < 0) { profitDaily += taxDaily; taxDaily = 0; }
  const pct = Math.min(100, Math.max(0, s.companyPct));
  const profitMonthly = profitDaily * r.totalManDays;
  const companyProfit = Math.round((profitMonthly * pct) / 100);
  const warnings = [...r.warnings.filter(w => !/Phí dịch vụ|Biên lợi nhuận/.test(w.text))];
  if (profitDaily < 0) {
    warnings.unshift({ level: 'error', text: `Giá ca 8h đang báo ${f(price)} đ thấp hơn chi phí — lỗ ${f(-profitDaily)} đ/công.` });
  } else if (price > 0 && (profitDaily / (price + r.separatedDaily)) * 100 < 5) {
    warnings.unshift({ level: 'warn', text: 'Theo giá đang báo, biên lợi nhuận dưới 5% — rất mỏng, dễ lỗ khi phát sinh.' });
  }
  return {
    ...r,
    dayOverridden: true, autoQuoteDaily: r.quoteDaily,
    quoteDaily: price, quoteRawDaily: price, roundingGainDaily: 0,
    quoteMonthly: price * s.baseDays, quoteWithVatDaily: price * (1 + s.vatRate),
    taxDaily, profitDaily, profitMonthly,
    revenueMonthly: price * r.totalManDays + r.separatedBilledMonthly,
    companyProfit, branchProfit: Math.round(profitMonthly) - companyProfit,
    companyPerDay: (profitDaily * pct) / 100, branchPerDay: profitDaily - (profitDaily * pct) / 100,
    marginPct: price + r.separatedDaily > 0 ? (profitDaily / (price + r.separatedDaily)) * 100 : 0,
    warnings,
  };
}

/** "Bao gồm: …" tự lấy từ tên các khoản ở bước 1 (bỏ lương cơ bản, bỏ phần trong ngoặc). */
export function includedNoteAuto(input: PlanData): string {
  const data = normalizePlanData(input);
  const itemizedSheet = !!normalizeQuoteSheet(data.quote).itemized;
  const names: string[] = [];
  const seen = new Set<string>();
  for (const l of data.lines) {
    if (l.isBaseWage || l.billSeparately) continue;   // khoản thu riêng theo tháng không nằm trong giá ngày
    if (itemizedSheet && l.isServiceFee) continue;    // báo tách khoản: phí dịch vụ là dòng riêng
    let n = l.name.replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
    if (/bhxh/i.test(n)) n = 'BHXH';
    const k = lineKey(n);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    // Viết thường chữ đầu cho liền mạch câu, trừ từ viết tắt (BHXH, KPCĐ…)
    names.push(/^\p{Lu}{2,}/u.test(n) ? n : n.charAt(0).toLowerCase() + n.slice(1));
  }
  return names.length ? `Bao gồm: ${names.join(', ')}.` : '';
}

/** Văn bản dạng bảng (tab) — dán thẳng vào Excel / Word. */
export function priceListToTsv(list: PriceList, included: string, notes: string): string {
  const vis = list.rows.filter(r => !r.hidden);
  const sk = list.skilled;
  const lines = [sk ? `STT\tNội dung đơn giá\tĐơn vị tính\tLĐ phổ thông (VNĐ)\t${sk.label} (VNĐ)\tGhi chú` : 'STT\tNội dung đơn giá\tĐơn vị tính\tĐơn giá (VNĐ)\tGhi chú'];
  vis.forEach((r, i) => lines.push(`${i + 1}\t${r.name}\t${r.unit}\t${r.price}${sk ? `\t${r.skilled?.price ?? ''}` : ''}\t${i === 0 ? included : r.note ?? ''}`));
  if (notes.trim()) lines.push('', 'Ghi chú:', ...notes.split('\n').filter(Boolean).map(n => `- ${n}`));
  return lines.join('\n');
}
