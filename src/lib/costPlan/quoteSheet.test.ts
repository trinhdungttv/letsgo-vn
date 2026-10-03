import { describe, it, expect } from 'vitest';
import { computePlan, newLine, DEFAULT_SETTINGS, normalizePlanData } from './engine';
import { computePriceList, defaultQuoteSheet, includedNoteAuto, normalizeQuoteSheet, priceListToTsv } from './quoteSheet';
import { legalChecklist } from './legal';
import { baseLines, starterLines } from './presets';
import type { PlanData, QuoteSheet } from './types';

// Bảng giá thật của công ty (ảnh báo giá): lương cơ bản 250.000/công, giá ngày 424.000.
const real = (quote?: Partial<QuoteSheet>): PlanData => ({
  settings: { ...DEFAULT_SETTINGS, taxOption: 'none' },
  lines: [
    newLine({ name: 'Lương cơ bản', unit: 'day', value: 250_000, paidToWorker: true, isBaseWage: true, insurable: true, group: 'worker' }),
    newLine({ name: 'Phụ cấp độc hại', unit: 'day', value: 40_000, paidToWorker: true, group: 'worker' }),
    newLine({ name: 'BHXH (DN đóng 21,5%)', unit: 'day', value: 60_000, group: 'compliance' }),
    newLine({ name: 'Phí dịch vụ', unit: 'day', value: 74_000, isServiceFee: true, group: 'service' }),
  ],
  notes: '', quote: quote ? { ...defaultQuoteSheet(), ...quote } : null,
});
const price = (d: PlanData) => {
  const r = computePlan(d);
  const pl = computePriceList(d, r);
  return { r, pl, by: Object.fromEntries(pl.rows.map(x => [x.kind, x.price])) as Record<string, number> };
};

describe('Bảng giá dịch vụ — khớp bảng báo giá thật', () => {
  const { r, pl, by } = price(real());
  it('giá 1 công 424.000 → dòng ngày 8 tiếng', () => { expect(r.quoteDaily).toBe(424_000); expect(by.day8).toBe(424_000); });
  it('đơn giá giờ chuẩn = 250.000 ÷ 8 = 31.250', () => expect(pl.shr).toBe(31_250));
  it('ca đêm 8 tiếng = 424.000 + 30% × 250.000 = 499.000', () => expect(by.night8).toBe(499_000));
  it('tăng ca ngày 150% = 46.875', () => expect(by.ot_day).toBe(46_875));
  it('tăng ca đêm 200% = 62.500', () => expect(by.ot_night).toBe(62_500));
  it('tăng ca Chủ nhật 200% = 62.500', () => expect(by.ot_sun).toBe(62_500));
  it('tăng ca Chủ nhật ban đêm 270% = 84.375', () => expect(by.ot_sun_night).toBe(84_375));
  it('lễ/Tết 300% & 390% có sẵn nhưng ẩn mặc định', () => {
    expect(by.ot_hol).toBe(93_750);
    expect(by.ot_hol_night).toBe(121_875);
    expect(pl.rows.filter(x => x.hidden).map(x => x.kind)).toEqual(['ot_hol', 'ot_hol_night']);
  });
  it('6 dòng hiển thị theo đúng thứ tự bảng thật', () => {
    expect(pl.rows.filter(x => !x.hidden).map(x => x.kind)).toEqual(['day8', 'night8', 'ot_day', 'ot_night', 'ot_sun', 'ot_sun_night']);
  });
});

describe('tuỳ chọn tăng ca', () => {
  it('tăng ca đêm liền sau ca ngày → 210%', () => expect(price(real({ nightOtAfterDay: true })).by.ot_night).toBe(65_625));
  it('cơ sở = toàn bộ thu nhập trả NLĐ (290.000) thay vì chỉ lương cơ bản', () => {
    const { pl, by } = price(real({ otBase: 'worker' }));
    expect(pl.shr).toBe(36_250);
    expect(by.ot_day).toBe(54_375);
  });
  it('cộng 10% lên giá tăng ca (không đụng giá ngày/ca đêm)', () => {
    const { by } = price(real({ otMarkupPct: 10 }));
    expect(by.ot_day).toBe(51_563);
    expect(by.day8).toBe(424_000);
    expect(by.night8).toBe(499_000);
  });
  it('sửa tay 1 dòng thì dùng số đó, vẫn giữ giá tự tính để so', () => {
    const q = defaultQuoteSheet();
    q.rows.find(x => x.kind === 'ot_day')!.override = 50_000;
    const { pl } = price(real(q));
    const row = pl.rows.find(x => x.kind === 'ot_day')!;
    expect(row.price).toBe(50_000);
    expect(row.auto).toBe(46_875);
    expect(row.overridden).toBe(true);
  });
  it('dòng tuỳ chỉnh dùng số gõ tay', () => {
    const q = defaultQuoteSheet();
    q.rows.push({ id: 'c1', kind: 'custom', name: 'Phụ cấp cơm trưa', unit: 'VNĐ/ngày', override: 30_000 });
    const row = price(real(q)).pl.rows.find(x => x.kind === 'custom')!;
    expect(row.price).toBe(30_000);
    expect(row.auto).toBeNull();
  });
  it('giá ngày đổi theo thuế/làm tròn của bước 1 → dòng ngày & ca đêm đổi theo, giờ tăng ca KHÔNG đổi', () => {
    const d = real(); d.settings.taxOption = 'profit20';
    const { by } = price(d);
    expect(by.day8).toBe(424_000 + 18_500);
    expect(by.night8).toBe(by.day8 + 75_000);
    expect(by.ot_day).toBe(46_875);
  });
});

describe('chuẩn hoá bảng giá đọc từ DB', () => {
  it('thiếu cấu hình → đủ dòng chuẩn', () => expect(normalizeQuoteSheet(null).rows).toHaveLength(8));
  it('cấu hình cũ thiếu dòng lễ/Tết → tự thêm ở trạng thái ẩn, giữ thứ tự chuẩn, custom nằm cuối', () => {
    const q = normalizeQuoteSheet({ ...defaultQuoteSheet(), rows: [
      { id: 'x', kind: 'custom', name: 'Cơm', unit: 'VNĐ/ngày', override: 1 },
      ...defaultQuoteSheet().rows.filter(r => r.kind === 'day8' || r.kind === 'ot_day'),
    ] });
    expect(q.rows.map(r => r.kind)).toEqual(['day8', 'night8', 'ot_day', 'ot_night', 'ot_sun', 'ot_sun_night', 'ot_hol', 'ot_hol_night', 'custom']);
    expect(q.rows.find(r => r.kind === 'night8')!.hidden).toBe(true);
  });
  it('dữ liệu rác không ném lỗi', () => {
    expect(() => computePriceList(normalizePlanData(null), computePlan(normalizePlanData(null)))).not.toThrow();
  });
});

describe('ghi chú & xuất bảng', () => {
  it('"Bao gồm" tự lấy tên khoản, bỏ lương cơ bản/ngoặc, gộp BHXH', () => {
    expect(includedNoteAuto(real())).toBe('Bao gồm: phụ cấp độc hại, BHXH, phí dịch vụ.');
  });
  it('TSV: tiêu đề + chỉ các dòng đang hiện + ghi chú', () => {
    const d = real(); const { pl } = price(d);
    const tsv = priceListToTsv(pl, 'Bao gồm: x', 'Chưa gồm VAT\nChưa gồm cơm');
    const lines = tsv.split('\n');
    expect(lines[0]).toBe('STT\tNội dung đơn giá\tĐơn vị tính\tĐơn giá (VNĐ)\tGhi chú');
    expect(lines[1]).toBe('1\tLương ngày làm việc 8 tiếng\tVNĐ/ngày\t424000\tBao gồm: x');
    expect(lines.filter(l => /^\d\t/.test(l))).toHaveLength(6);
    expect(tsv).toContain('- Chưa gồm VAT');
  });
});

describe('Phí dịch vụ chưa đánh dấu (bảng nhập tay)', () => {
  it('đúng 1 dòng tên "Phí dịch vụ" → tự coi là Phí DV, lợi nhuận không còn 0', () => {
    const d: PlanData = { settings: { ...DEFAULT_SETTINGS }, notes: '', lines: [
      newLine({ name: 'Lương cơ bản', unit: 'day', value: 240_000, paidToWorker: true, isBaseWage: true }),
      newLine({ name: 'Phí dịch vụ', unit: 'day', value: 50_000, paidToWorker: true }),
    ] };
    const r = computePlan(d);
    expect(r.serviceFeeDaily).toBe(50_000);
    expect(r.profitDaily).toBeGreaterThan(50_000 - 1);
    expect(r.workerDaily).toBe(240_000);
  });
});

describe('Kiểm tra theo luật (bước 1)', () => {
  type Ctx = Parameters<typeof legalChecklist>[2];
  const ctx: Ctx = { industry: 'Hóa chất', minWageMonthly: 4_730_000, minWageLabel: 'Vùng II' };
  const items = (d: PlanData, c: Ctx = ctx) => legalChecklist(d, computePlan(d), c);
  const status = (d: PlanData, id: string, c: Ctx = ctx) => items(d, c).find(i => i.id === id)?.status;

  it('bảng khởi tạo theo ngành Hóa chất: đủ các khoản bắt buộc', () => {
    const d: PlanData = { settings: { ...DEFAULT_SETTINGS }, notes: '', lines: starterLines('Hóa chất', { baseWageMonthly: 4_730_000 }) };
    const missing = items(d).filter(i => i.status !== 'ok').map(i => i.id);
    expect(missing).toEqual([]);
  });
  it('bảng chỉ có lương CB → thiếu BHXH, phép năm, công đoàn, khám SK', () => {
    const d: PlanData = { settings: { ...DEFAULT_SETTINGS }, notes: '', lines: [baseLines({ baseWageMonthly: 4_730_000 })[0]] };
    expect(items(d, { industry: 'Dệt may', minWageMonthly: 4_730_000 }).filter(i => i.status === 'missing').map(i => i.id).sort()).toEqual(['bhxh', 'health', 'leave', 'union']);
  });
  it('lương thấp hơn tối thiểu vùng → missing; chưa chọn KCN → unknown', () => {
    const d: PlanData = { settings: { ...DEFAULT_SETTINGS }, notes: '', lines: baseLines({ baseWageMonthly: 4_000_000 }) };
    expect(status(d, 'minwage')).toBe('missing');
    expect(status(d, 'minwage', { industry: null, minWageMonthly: null })).toBe('unknown');
  });
  it('khoản có tên đúng nhưng số tiền 0 thì chưa tính là đã có', () => {
    const d: PlanData = { settings: { ...DEFAULT_SETTINGS }, notes: '', lines: [...baseLines({ baseWageMonthly: 4_730_000 }), newLine({ name: 'Khám sức khỏe định kỳ', value: 0 })] };
    expect(status(d, 'health')).toBe('missing');
  });
  it('ngành độc hại có thêm mục độc hại + bệnh nghề nghiệp, ngành thường thì không', () => {
    const d: PlanData = { settings: { ...DEFAULT_SETTINGS }, notes: '', lines: baseLines({ baseWageMonthly: 4_730_000 }) };
    expect(items(d, { industry: 'Cơ khí', minWageMonthly: null }).map(i => i.id)).toContain('toxic');
    expect(items(d, { industry: 'Dệt may', minWageMonthly: null }).map(i => i.id)).not.toContain('toxic');
  });
  it('mục thiếu đều có khoản mẫu để thêm nhanh', () => {
    const d: PlanData = { settings: { ...DEFAULT_SETTINGS }, notes: '', lines: [baseLines({ baseWageMonthly: 4_730_000 })[0]] };
    for (const i of items(d, { industry: 'Cơ khí', minWageMonthly: null })) if (i.status === 'missing' && i.id !== 'base') expect(i.fix, i.id).toBeTruthy();
  });
});

describe('Kiểm tra luật — không dò ghi chú của dòng khác', () => {
  it('xoá dòng BHXH: dù Công đoàn có ghi chú "đóng BHXH", BHXH vẫn báo thiếu', () => {
    const lines = baseLines({ baseWageMonthly: 4_730_000 }).filter(l => !/^BHXH/.test(l.name));
    expect(lines.find(l => /Công đoàn/.test(l.name))!.note).toMatch(/BHXH/);   // điều kiện gây lỗi cũ
    const d: PlanData = { settings: { ...DEFAULT_SETTINGS }, notes: '', lines };
    const it = legalChecklist(d, computePlan(d), { industry: 'Dệt may', minWageMonthly: null }).find(i => i.id === 'bhxh')!;
    expect(it.status).toBe('missing');
    expect(it.fix?.name).toMatch(/BHXH/);
  });
});
