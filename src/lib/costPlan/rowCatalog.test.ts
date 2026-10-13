import { describe, it, expect, vi } from 'vitest';
vi.mock('../supabase', () => ({ supabase: {} }));
import { BUILTIN_CATALOG, catalogFromRow, mergedCatalog, parseCatalog, removeFromCatalog, rowFromCatalog, searchCatalog, sheetHasItem, upsertCatalog } from './rowCatalog';
import { computePriceList, defaultQuoteSheet, normalizeQuoteSheet } from './quoteSheet';
import { computePlan, DEFAULT_SETTINGS, newLine } from './engine';
import { sheetFromTemplate, sheetToTemplate } from './sheetTemplate';
import { defaultDoc, emptyProfile, resolveDoc } from './quoteDoc';
import type { PlanData, QuoteSheet } from './types';

// Lương 250.000/công, phí DV 50.000, không thuế → giá ngày 300.000 (gộp) ; giờ chuẩn = 250.000 ÷ 8 = 31.250
const base = (q: QuoteSheet, skilled?: boolean): PlanData => ({
  settings: { ...DEFAULT_SETTINGS, taxOption: 'none' }, notes: '',
  lines: [
    newLine({ name: 'Lương cơ bản', unit: 'day', value: 250_000, paidToWorker: true, isBaseWage: true, group: 'worker' }),
    newLine({ name: 'Phí dịch vụ', unit: 'day', value: 50_000, isServiceFee: true, group: 'service' }),
  ],
  quote: skilled ? { ...q, skilled: { on: true, label: 'Thợ', wage: 256_000, wageUnit: 'day', serviceFee: null } } : q,
});
const withItems = (ids: string[]): QuoteSheet => {
  const q = defaultQuoteSheet();
  return { ...q, rows: [...q.rows, ...ids.map(id => rowFromCatalog(BUILTIN_CATALOG.find(b => b.id === id)!))] };
};
const price = (d: PlanData, name: string) => computePriceList(d, computePlan(d)).rows.find(r => r.name === name)!;

describe('Kho đầu mục', () => {
  it('ca ngày/đêm 12 tiếng, Chủ nhật, Lễ Tết 8 tiếng tính đúng theo hệ số luật', () => {
    const d = base(withItems(['b-day12', 'b-night12', 'b-sun8', 'b-sun8n', 'b-hol8', 'b-hol8n', 'b-nightallow']));
    expect(price(d, 'Lương ca ngày 12 tiếng').price).toBe(300_000 + 4 * 31_250 * 1.5);              // 487.500
    expect(price(d, 'Lương ca đêm 12 tiếng').price).toBe(375_000 + 4 * 31_250 * 2);                  // 625.000
    expect(price(d, 'Lương Chủ nhật ca ngày 8 tiếng').price).toBe(8 * 31_250 * 2);                   // 500.000
    expect(price(d, 'Lương Chủ nhật ca đêm 8 tiếng').price).toBe(Math.round(8 * 31_250 * 2.7));      // 675.000
    expect(price(d, 'Lương ngày Lễ, Tết ca ngày 8 tiếng').price).toBe(8 * 31_250 * 3);               // 750.000
    expect(price(d, 'Lương ngày Lễ, Tết ca đêm 8 tiếng').price).toBe(Math.round(8 * 31_250 * 3.9));  // 975.000
    expect(price(d, 'Phụ cấp ca đêm').price).toBe(75_000);
  });
  it('dòng tự tính ghi tay đè được và khôi phục về tự tính; dòng nhập tay lấy giá mặc định', () => {
    const q = withItems(['b-day12', 'b-meal']);
    const row = q.rows.find(r => r.name === 'Lương ca ngày 12 tiếng')!;
    const d = base({ ...q, rows: q.rows.map(r => (r.id === row.id ? { ...r, override: 480_000 } : r)) });
    expect(price(d, 'Lương ca ngày 12 tiếng')).toMatchObject({ price: 480_000, overridden: true, auto: 487_500 });
    expect(price(base(q), 'Phụ cấp cơm').price).toBe(0);
  });
  it('báo tách khoản / theo giờ: ca 12 tiếng cộng từ giá ngày đúng nghĩa (lương, không gồm phí DV)', () => {
    const d = base({ ...withItems(['b-day12']), itemized: true });
    expect(price(d, 'Lương ca ngày 12 tiếng').price).toBe(250_000 + 187_500 / 1);   // 250.000 + 4×31.250×1,5
  });
  it('cột thợ tính lại dòng tự tính theo lương thợ', () => {
    const l = computePriceList(base(withItems(['b-hol8']), true), computePlan(base(withItems(['b-hol8']), true)));
    expect(l.rows.find(r => r.name === 'Lương ngày Lễ, Tết ca ngày 8 tiếng')!.skilled!.price).toBe(8 * 32_000 * 3);   // 256.000 ÷ 8 = 32.000
  });
  it('mẫu chung giữ công thức; phương án mới không bị dính giá tay', () => {
    const t = sheetToTemplate(withItems(['b-day12']));
    expect(t.rows.find(r => r.name === 'Lương ca ngày 12 tiếng')).toMatchObject({ override: null, calc: { base: 'day', hours: 4, coef: 1.5 } });
    expect(normalizeQuoteSheet(sheetFromTemplate(t)).rows.find(r => r.name === 'Lương ca ngày 12 tiếng')!.calc).toBeTruthy();
  });
  it('PDF song ngữ dùng bản dịch có sẵn của mục kho', () => {
    const d = base(withItems(['b-hol8']));
    const v = resolveDoc({ ...defaultDoc(new Date('2026-10-13')), lang: 'zh' }, d, computePlan(d), emptyProfile());
    expect(v.rows.find(r => r.name.a.includes('Lễ, Tết ca ngày 8'))!.name.b).toBe('节假日8小时白班工资');
  });
  it('kho của công ty: lưu / đọc / gộp / tìm không dấu / không thêm trùng / xoá', () => {
    const r = { ...rowFromCatalog(BUILTIN_CATALOG[0]), name: 'Lương ca đêm 10 tiếng', calc: { base: 'night' as const, hours: 2, coef: 2 } };
    const mine = upsertCatalog([], catalogFromRow(r));
    expect(parseCatalog(JSON.stringify(mine))[0]).toMatchObject({ name: 'Lương ca đêm 10 tiếng', calc: { base: 'night', hours: 2, coef: 2 }, custom: true });
    expect(parseCatalog('hỏng')).toEqual([]);
    expect(mergedCatalog(mine)[0].name).toBe('Lương ca đêm 10 tiếng');
    expect(searchCatalog(mergedCatalog(mine), 'le tet').map(i => i.id)).toEqual(['b-hol8', 'b-hol8n']);
    expect(upsertCatalog(mine, catalogFromRow({ ...r, unit: 'VNĐ/ca' })).length).toBe(1);
    expect(sheetHasItem(withItems(['b-meal']), BUILTIN_CATALOG.find(b => b.id === 'b-meal')!)).toBe(true);
    expect(removeFromCatalog(mine, mine[0].id)).toEqual([]);
  });
});
