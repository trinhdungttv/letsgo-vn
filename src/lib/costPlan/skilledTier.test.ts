import { describe, it, expect } from 'vitest';
import { computePlan, DEFAULT_SETTINGS, newLine } from './engine';
import { computePriceList, defaultQuoteSheet, priceListToTsv } from './quoteSheet';
import type { PlanData, QuoteRowKind, SkilledTier } from './types';

// Bảng giá mẫu của công ty: phổ thông lương 240.000/công, thợ tay nghề 256.000/công
const plan = (skilled: Partial<SkilledTier> | null, overrides: Partial<Record<QuoteRowKind, { p?: number; s?: number }>> = {}): PlanData => {
  const q = defaultQuoteSheet();
  return {
    settings: { ...DEFAULT_SETTINGS }, notes: '',
    lines: [
      newLine({ name: 'Lương cơ bản', unit: 'day', value: 240_000, paidToWorker: true, isBaseWage: true, insurable: true, group: 'worker' }),
      newLine({ name: 'BHXH', group: 'compliance', mode: 'percent', base: 'insurable', value: 21.5 }),
      newLine({ name: 'Phí dịch vụ', unit: 'day', value: 50_000, isServiceFee: true, group: 'service' }),
    ],
    quote: {
      ...q, nightOtAfterDay: true,
      rows: [...q.rows.map(r => ({ ...r, hidden: false, override: overrides[r.kind]?.p ?? null, overrideSkilled: overrides[r.kind]?.s ?? null })),
        { id: 'com', kind: 'custom', name: 'Phụ cấp cơm', unit: 'VNĐ/suất', override: 25_000, overrideSkilled: overrides.custom?.s ?? null, hidden: false }],
      skilled: skilled ? { on: true, label: 'Thợ tay nghề', wage: 256_000, wageUnit: 'day', serviceFee: null, ...skilled } : null,
    },
  };
};
const list = (d: PlanData) => computePriceList(d, computePlan(d));
const sk = (d: PlanData, kind: QuoteRowKind) => list(d).rows.find(r => r.kind === kind)!.skilled!.price;

describe('Cột giá thợ tay nghề', () => {
  it('chưa bật → không có cột thợ', () => {
    const l = list(plan(null));
    expect(l.skilled).toBeNull();
    expect(l.rows.every(r => r.skilled === undefined)).toBe(true);
  });
  it('tăng ca tính theo lương thợ — khớp bảng giá mẫu', () => {
    const d = plan({});
    expect(list(d).rows.find(r => r.kind === 'ot_day')!.price).toBe(45_000);   // phổ thông giữ nguyên
    expect(sk(d, 'ot_day')).toBe(48_000);
    expect(sk(d, 'ot_night')).toBe(67_200);
    expect(sk(d, 'ot_sun')).toBe(64_000);
    expect(sk(d, 'ot_sun_night')).toBe(86_400);
    expect(sk(d, 'ot_hol')).toBe(96_000);
    expect(sk(d, 'ot_hol_night')).toBe(124_800);
  });
  it('giá ngày thợ tính lại cả BHXH theo lương thợ; ca đêm theo giá ngày thợ đang báo', () => {
    const d = plan({});
    const auto = sk(d, 'day8');
    // chênh 16.000 lương + 21,5% BHXH = 19.440 (phí DV, thuế giữ nguyên)
    expect(auto - list(d).rows.find(r => r.kind === 'day8')!.price).toBe(19_440);
    expect(sk(plan({}, { day8: { s: 392_000 } }), 'night8')).toBe(392_000 + 76_800);
  });
  it('phí DV riêng cho thợ; dòng tuỳ chỉnh mặc định như phổ thông, sửa riêng được', () => {
    const base = sk(plan({}), 'day8');
    expect(sk(plan({ serviceFee: 70_000 }), 'day8')).toBe(base + 25_000);   // +20.000 phí, +5.000 thuế dự phòng (25% phí)
    expect(sk(plan({}), 'custom')).toBe(25_000);
    expect(sk(plan({}, { custom: { s: 30_000 } }), 'custom')).toBe(30_000);
  });
  it('sao chép bảng có thêm cột thợ', () => {
    const d = plan({});
    expect(priceListToTsv(list(d), '', '').split('\n')[0]).toBe('STT\tNội dung đơn giá\tĐơn vị tính\tLĐ phổ thông (VNĐ)\tThợ tay nghề (VNĐ)\tGhi chú');
  });
});

describe('Điền file Excel mẫu: khối thợ tay nghề', () => {
  it('nhận ra dòng của thợ (Việt / Trung / Anh), không nhầm dòng phổ thông', async () => {
    const { isSkilledLabel, classifyLabel } = await import('./excelFill');
    expect(isSkilledLabel('Lương cơ bản ca ngày 8h lao động tay nghề\n技工人8小白班基本薪')).toBe(true);
    expect(isSkilledLabel('Lương làm thêm giờ ca ngày ngày thường tay nghề')).toBe(true);
    expect(isSkilledLabel('Skilled worker - daily wage')).toBe(true);
    expect(isSkilledLabel('Lương cơ bản ca ngày 8h\n8小白班基本工')).toBe(false);
    expect(isSkilledLabel('Lương tăng ca ngày chủ nhật')).toBe(false);
    expect(classifyLabel('Lương làm thêm giờ ca ngày ngày thường tay nghề')).toBe('ot_day');
  });
  it('giá thợ lấy theo cột thợ; chưa bật cột thợ thì không có giá thợ', async () => {
    const { buildFillValues } = await import('./excelFill');
    const on = plan({});
    const fv = buildFillValues(on, computePlan(on), {});
    expect(fv.pricesSkilled!.ot_day).toBe(48_000);
    expect(fv.pricesSkilled!.base).toBe(256_000);
    expect(fv.prices.ot_day).toBe(45_000);
    const off = plan(null);
    expect(buildFillValues(off, computePlan(off), {}).pricesSkilled).toBeNull();
  });
});

describe('Mẫu Let\'s Go có sẵn + cột thợ', () => {
  it('bật cột thợ → mẫu có khối "Lao động tay nghề", điền đúng giá thợ vào dòng thợ, giá phổ thông vào dòng phổ thông', async () => {
    const ExcelJS = (await import('exceljs')).default;
    const { buildLetsgoTemplate } = await import('./letsgoTemplate');
    const { buildFillValues, fillExcelTemplate } = await import('./excelFill');
    const d = plan({});
    const { output, report } = await fillExcelTemplate(await buildLetsgoTemplate({ skilled: true }), buildFillValues(d, computePlan(d), { company: 'X' }), { sheet: 'Tiếng Việt' });
    // nhãn trong báo cáo = tên dòng + đơn vị tính
    const val = (start: string) => report.rows.find(x => x.label.startsWith(`${start} VNĐ`))?.value;
    expect(val('Lương làm thêm giờ vào ngày thường')).toBe(45_000);
    expect(val('Lương làm thêm giờ vào ngày thường (tay nghề)')).toBe(48_000);
    expect(val('Đơn giá lương cơ bản 8h/ngày (tay nghề)')).toBe(256_000);
    expect(report.rows.find(x => x.label.startsWith('Lương làm thêm giờ ban đêm vào ngày nghỉ lễ, tết (tay nghề)'))?.value).toBe(124_800);
    expect(report.rows.length).toBe(20);
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(output);
    const texts: string[] = [];
    wb.worksheets[0].eachRow(r => r.eachCell(c => { const v = c.value as { richText?: { text: string }[] } | string; texts.push(typeof v === 'string' ? v : v?.richText?.map(t => t.text).join('') ?? ''); }));
    expect(texts).toContain('Lao động phổ thông');
    expect(texts).toContain('Lao động tay nghề');
  });
  it('không bật cột thợ → mẫu y như cũ (1 khối)', async () => {
    const { buildLetsgoTemplate } = await import('./letsgoTemplate');
    const { inspectTemplate } = await import('./excelFill');
    const one = await inspectTemplate(await buildLetsgoTemplate());
    const two = await inspectTemplate(await buildLetsgoTemplate({ skilled: true }));
    expect(two[0].rows).toBe(one[0].rows * 2);
  });
});
