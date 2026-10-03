// Phương án giá — kiểm tra "đã đủ khoản theo luật chưa" trước khi lập bảng báo giá.
// Chỉ KIỂM TRA & gợi ý thêm — không tự thêm số tiền vào phương án của người dùng.
import { normalizeText, baseLines, findPreset, lineKey } from './presets';
import { normalizePlanData } from './engine';
import type { CostLine, PlanData, PlanResult } from './types';

export type LegalStatus = 'ok' | 'missing' | 'unknown';

export interface LegalItem {
  id: string;
  label: string;
  /** Căn cứ pháp lý / giải thích ngắn */
  basis: string;
  status: LegalStatus;
  /** true = bắt buộc theo luật; false = nên có theo đặc thù ngành */
  required: boolean;
  /** Khoản mẫu để thêm nhanh khi còn thiếu */
  fix?: CostLine;
}

const HEAVY = new Set(['hoa_chat', 'co_khi', 'go_noi_that', 'nhua_cao_su']);

export function legalChecklist(
  input: PlanData, result: PlanResult,
  ctx: {
    industry?: string | null; minWageMonthly?: number | null; minWageLabel?: string;
    /** Mẫu khoản mục đã lưu cho ngành này (nếu có) — thay cho bộ gợi ý gắn cứng theo ngành */
    templateLines?: CostLine[] | null;
  },
): LegalItem[] {
  const data = normalizePlanData(input);
  // Chỉ dò theo TÊN khoản (không dò ghi chú): ghi chú của dòng khác có thể nhắc "BHXH" (vd Công đoàn "2% quỹ lương đóng BHXH")
  // và làm báo nhầm là đã có BHXH dù dòng đó đã xoá.
  const has = (re: RegExp, pred?: (l: CostLine) => boolean) =>
    data.lines.some(l => re.test(normalizeText(l.name)) && (result.lines[l.id]?.daily ?? 0) > 0 && (!pred || pred(l)));
  const std = baseLines({ baseWageMonthly: 0 });
  const stdLine = (re: RegExp) => std.find(l => re.test(normalizeText(l.name)));

  const items: LegalItem[] = [];

  const baseMonthly = data.lines.filter(l => l.isBaseWage).reduce((s, l) => s + (result.lines[l.id]?.monthly ?? 0), 0);
  if (baseMonthly <= 0) {
    items.push({ id: 'base', label: 'Lương cơ bản', basis: 'Gốc để tính BHXH, phép năm, tăng ca', status: 'missing', required: true });
  } else if (ctx.minWageMonthly) {
    items.push({
      id: 'minwage', label: `Lương cơ bản ≥ lương tối thiểu ${ctx.minWageLabel ?? 'vùng'}`, basis: 'Điều 90 BLLĐ 2019',
      status: baseMonthly + 0.5 >= ctx.minWageMonthly ? 'ok' : 'missing', required: true,
    });
  } else {
    items.push({ id: 'minwage', label: 'Lương cơ bản ≥ lương tối thiểu vùng', basis: 'Chọn KCN để kiểm tra mức vùng', status: 'unknown', required: true });
  }

  items.push({ id: 'bhxh', label: 'BHXH, BHYT, BHTN do doanh nghiệp đóng', basis: 'Luật BHXH 2024 — DN đóng 21,5%', required: true,
    status: has(/bhxh|bao hiem xa hoi|bhyt/) ? 'ok' : 'missing', fix: stdLine(/bhxh/) });
  items.push({ id: 'leave', label: 'Phép năm có lương', basis: 'Điều 113 BLLĐ 2019 — 12 ngày/năm (nghề độc hại 14)', required: true,
    status: data.lines.some(l => l.mode === 'leave' && (result.lines[l.id]?.daily ?? 0) > 0) || has(/phep nam/) ? 'ok' : 'missing', fix: stdLine(/phep nam/) });
  items.push({ id: 'union', label: 'Kinh phí công đoàn 2%', basis: 'Luật Công đoàn 2012, NĐ 191/2013', required: true,
    status: has(/cong doan/) ? 'ok' : 'missing', fix: stdLine(/cong doan/) });
  items.push({ id: 'health', label: 'Khám sức khỏe định kỳ', basis: 'Luật An toàn, vệ sinh lao động 2015', required: true,
    status: has(/kham/) ? 'ok' : 'missing',
    fix: { ...std[0], id: '', name: 'Khám sức khỏe định kỳ', group: 'compliance', paidToWorker: false, isBaseWage: false, insurable: false, mode: 'fixed', unit: 'day', value: 0, note: 'Khám định kỳ 6 tháng / 1 lần' } });

  const tpl = ctx.templateLines;
  if (tpl && tpl.length) {
    // Ngành đã có mẫu riêng: đối chiếu các khoản ĐẶC THÙ của mẫu (bỏ lương CB và các khoản luật định chung đã kiểm ở trên)
    const present = new Set(data.lines.filter(l => (result.lines[l.id]?.daily ?? 0) > 0).map(l => lineKey(l.name)));
    for (const t of tpl) {
      if (t.isBaseWage || t.isServiceFee || /bhxh|bao hiem|cong doan|phep nam|kham/.test(normalizeText(t.name))) continue;
      items.push({
        id: `tpl:${lineKey(t.name)}`, label: t.name.replace(/\([^)]*\)/g, '').trim(), required: false,
        basis: `Khoản đặc thù trong mẫu ngành ${ctx.industry ?? ''}`.trim(),
        status: present.has(lineKey(t.name)) ? 'ok' : 'missing', fix: { ...t, id: '' },
      });
    }
    return items;
  }

  const preset = findPreset(ctx.industry);
  if (preset && HEAVY.has(preset.key)) {
    items.push({ id: 'toxic', label: 'Phụ cấp độc hại / nặng nhọc', basis: `Đặc thù ngành ${preset.label} · chưa có mẫu riêng`, required: false,
      status: has(/doc hai|nang nhoc/) ? 'ok' : 'missing',
      fix: { ...std[0], id: '', name: 'Phụ cấp độc hại', group: 'worker', paidToWorker: true, isBaseWage: false, insurable: false, mode: 'fixed', unit: 'day', value: 0, note: '' } });
    items.push({ id: 'occ', label: 'Khám bệnh nghề nghiệp', basis: `Đặc thù ngành ${preset.label} · chưa có mẫu riêng`, required: false,
      status: has(/benh nghe nghiep/) || has(/kham/, l => /nghe nghiep/.test(normalizeText(l.note))) ? 'ok' : 'missing',
      fix: { ...std[0], id: '', name: 'Khám bệnh nghề nghiệp', group: 'compliance', paidToWorker: false, isBaseWage: false, insurable: false, mode: 'fixed', unit: 'day', value: 0, note: '' } });
  }
  return items;
}
