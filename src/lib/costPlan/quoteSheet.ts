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
import { normalizePlanData, newLineId } from './engine';
import { lineKey } from './presets';
import type { PlanData, PlanResult, QuoteRowCfg, QuoteRowKind, QuoteSheet } from './types';

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
];

export const DEFAULT_GENERAL_NOTES = [
  'Báo giá chưa bao gồm thuế VAT.',
  'Báo giá chưa bao gồm tiền cơm và các khoản chi phí khác.',
  'Báo giá không bao gồm các yêu cầu phát sinh khác từ khách hàng.',
].join('\n');

export function defaultQuoteSheet(): QuoteSheet {
  return {
    rows: STD.map(r => ({ id: newLineId(), kind: r.kind, name: r.name, unit: r.unit, override: null, hidden: !!r.hidden })),
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
  }));
  // Dòng chuẩn thiếu (dữ liệu cũ) thêm vào ở trạng thái ẩn — riêng dòng bảo hiểm thì hiện, vì nó tự ẩn khi không có khoản thu riêng
  for (const d of def.rows) if (!rows.some(r => r.kind === d.kind)) rows.push({ ...d, hidden: d.kind !== 'insurance' });
  const order = new Map(STD.map((s, i) => [s.kind, i]));
  rows.sort((a, b) => (order.get(a.kind) ?? 99) - (order.get(b.kind) ?? 99));   // dòng tuỳ chỉnh luôn nằm cuối, giữ thứ tự thêm
  return {
    rows,
    includedNote: typeof raw.includedNote === 'string' ? raw.includedNote : null,
    generalNotes: typeof raw.generalNotes === 'string' ? raw.generalNotes : DEFAULT_GENERAL_NOTES,
    otBase: raw.otBase === 'worker' ? 'worker' : 'base',
    otMarkupPct: Number.isFinite(Number(raw.otMarkupPct)) ? Math.max(0, Number(raw.otMarkupPct)) : 0,
    nightOtAfterDay: !!raw.nightOtAfterDay,
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
}

export interface PriceList {
  rows: PriceRow[];
  /** Cơ sở tính (lương/công) dùng cho giờ tăng ca & phụ cấp đêm */
  otBaseDaily: number;
  /** Đơn giá giờ chuẩn = cơ sở ÷ 8 */
  shr: number;
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
  const dayRow = q.rows.find(r => r.kind === 'day8' && !r.hidden && r.override != null);
  const dayPrice = dayRow ? Math.max(0, dayRow.override!) : result.quoteDaily;
  const mkTxt = q.otMarkupPct > 0 ? ` + ${q.otMarkupPct}%` : '';

  const auto = (kind: QuoteRowKind): { v: number | null; formula: string } => {
    const ot = (c: number, label: string) => ({ v: shr * c * mk, formula: `${f(shr)} đ/giờ × ${pct(c)}${mkTxt} — ${label}` });
    switch (kind) {
      case 'day8': return { v: result.quoteDaily, formula: 'Giá 1 công từ bước 1: chi phí + phí dịch vụ + thuế dự phòng' };
      case 'night8': return { v: dayPrice + otBaseDaily * (NORM_NIGHT - 1), formula: `Giá ngày${dayRow ? ` đang báo (${f(dayPrice)})` : ''} + 30% × ${f(otBaseDaily)} đ — làm đêm tối thiểu +30% (Điều 98 BLLĐ)` };
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

  const rows: PriceRow[] = q.rows.filter(r => r.kind !== 'insurance' || result.separatedMonthly > 0).map(r => {
    const a = auto(r.kind);
    const overridden = r.kind !== 'custom' && r.override != null;
    const price = r.kind === 'custom' ? Math.round(r.override ?? 0) : Math.round(overridden ? r.override! : a.v ?? 0);
    return {
      id: r.id, kind: r.kind, name: r.name, unit: r.unit, price,
      auto: a.v == null ? null : Math.round(a.v), overridden, hidden: !!r.hidden, formula: overridden ? `Đã sửa tay (tự tính: ${f(a.v ?? 0)} đ)` : a.formula,
      ...(r.kind === 'insurance' ? { note: `Chỉ áp dụng cho NLĐ làm từ ${result.separateMinDays} công/tháng trở lên` } : {}),
    };
  });
  return { rows, otBaseDaily, shr };
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
  if (!row) return { ...r, dayOverridden: false, autoQuoteDaily: r.quoteDaily };
  const s = data.settings;
  const price = Math.max(0, Math.round(row.override!));
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
  const names: string[] = [];
  const seen = new Set<string>();
  for (const l of data.lines) {
    if (l.isBaseWage || l.billSeparately) continue;   // khoản thu riêng theo tháng không nằm trong giá ngày
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
  const lines = ['STT\tNội dung đơn giá\tĐơn vị tính\tĐơn giá (VNĐ)\tGhi chú'];
  vis.forEach((r, i) => lines.push(`${i + 1}\t${r.name}\t${r.unit}\t${r.price}\t${i === 0 ? included : r.note ?? ''}`));
  if (notes.trim()) lines.push('', 'Ghi chú:', ...notes.split('\n').filter(Boolean).map(n => `- ${n}`));
  return lines.join('\n');
}
