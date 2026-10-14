import { describe, it, expect, vi } from 'vitest';
vi.mock('../supabase', () => ({ supabase: {} }));
import {
  BUILTIN_CATALOG, CATALOG_GROUPS, addCatalogItem, applyCatalogMap, builtinOf, catalogFromRow, catalogItemNamed, describeCalc, guessGroup,
  initialCatalogChoice, isUsed, mergedCatalog, parseBulkItems, parseCatalog, pickerCatalog, pricesByCatalog, removeFromCatalog,
  rowFromCatalog, searchCatalog, sheetHasItem, suggestCatalog, toStored, upsertCatalog, usedRows,
} from './rowCatalog';
import { cleanCalc, computePriceList, defaultQuoteSheet, normalizeQuoteSheet, setPerHour } from './quoteSheet';
import { computePlan, DEFAULT_SETTINGS, newLine } from './engine';
import { sheetFromTemplate, sheetToTemplate } from './sheetTemplate';
import { defaultDoc, emptyProfile, resolveDoc } from './quoteDoc';
import type { PlanData, QuoteSheet } from './types';

// Lương 250.000/công, phí DV 50.000, không thuế → giá ngày 300.000 (gộp) ; giờ chuẩn = 250.000 ÷ 8 = 31.250 ; ca đêm 375.000
const base = (q: QuoteSheet, skilled?: boolean): PlanData => ({
  settings: { ...DEFAULT_SETTINGS, taxOption: 'none' }, notes: '',
  lines: [
    newLine({ name: 'Lương cơ bản', unit: 'day', value: 250_000, paidToWorker: true, isBaseWage: true, group: 'worker' }),
    newLine({ name: 'Phí dịch vụ', unit: 'day', value: 50_000, isServiceFee: true, group: 'service' }),
  ],
  quote: skilled ? { ...q, skilled: { on: true, label: 'Thợ', wage: 256_000, wageUnit: 'day', serviceFee: null } } : q,
});
const B = (id: string) => BUILTIN_CATALOG.find(b => b.id === id)!;
const withItems = (ids: string[]): QuoteSheet => {
  const q = defaultQuoteSheet();
  return { ...q, rows: [...q.rows, ...ids.map(id => rowFromCatalog(B(id)))] };
};
const list = (d: PlanData) => computePriceList(d, computePlan(d));
/** Giá dòng theo mã danh mục quy chiếu */
const at = (d: PlanData, ref: string) => list(d).rows.find(r => r.ref === ref)!;

describe('Bộ danh mục chuẩn 5 nhóm', () => {
  it('đủ 5 nhóm, mã không trùng, tên không trùng, mục nào cũng có bản dịch Trung / Anh', () => {
    expect(new Set(BUILTIN_CATALOG.map(b => b.id)).size).toBe(BUILTIN_CATALOG.length);
    expect(new Set(BUILTIN_CATALOG.map(b => b.name.toLowerCase())).size).toBe(BUILTIN_CATALOG.length);
    for (const g of CATALOG_GROUPS) expect(BUILTIN_CATALOG.filter(b => b.group === g).length).toBeGreaterThan(4);
    expect(BUILTIN_CATALOG.every(b => b.i18n?.zh && b.i18n?.en)).toBe(true);
    expect(BUILTIN_CATALOG.length).toBeGreaterThanOrEqual(50);
  });
  it('I. lương ca: 1 giờ, 8h, ca 9 / 10 / 11 / 12 tiếng tính đúng', () => {
    const d = base(withItems(['b-hour-day', 'b-hour-night', 'b-day9', 'b-day10', 'b-day11', 'b-night11', 'b-day12', 'b-night12']));
    expect(at(d, 'b-hour-day').price).toBe(37_500);                    // 300.000 ÷ 8
    expect(at(d, 'b-hour-night').price).toBe(46_875);                  // 375.000 ÷ 8
    expect(at(d, 'b-day9').price).toBe(300_000 + 46_875);              // + 1 giờ × 150%
    expect(at(d, 'b-day10').price).toBe(300_000 + 2 * 46_875);
    expect(at(d, 'b-day11').price).toBe(300_000 + 3 * 46_875);
    expect(at(d, 'b-night11').price).toBe(375_000 + 3 * 62_500);       // + 3 giờ tăng ca đêm 200%
    expect(at(d, 'b-day12').price).toBe(487_500);
    expect(at(d, 'b-night12').price).toBe(625_000);
  });
  it('II. Chủ nhật / Lễ Tết 8h và 12h theo hệ số luật', () => {
    const d = base(withItems(['b-sun8', 'b-sun8n', 'b-sun12', 'b-sun12n', 'b-hol8', 'b-hol8n', 'b-hol12', 'b-hol12n']));
    expect(at(d, 'b-sun8').price).toBe(500_000);
    expect(at(d, 'b-sun8n').price).toBe(675_000);
    expect(at(d, 'b-sun12').price).toBe(750_000);
    expect(at(d, 'b-sun12n').price).toBe(1_012_500);
    expect(at(d, 'b-hol8').price).toBe(750_000);
    expect(at(d, 'b-hol8n').price).toBe(975_000);
    expect(at(d, 'b-hol12').price).toBe(1_125_000);
    expect(at(d, 'b-hol12n').price).toBe(1_462_500);
  });
  it('III. bảo hiểm tính theo % lương đóng BHXH của phương án', () => {
    const d = base(withItems(['b-ins-worker', 'b-ins-company', 'b-ins-health', 'b-ins-unemp', 'b-ins-accident']));
    const ins = computePlan(d).insuranceSalaryMonthly;
    expect(ins).toBeGreaterThan(0);
    expect(at(d, 'b-ins-worker').price).toBe(Math.round(ins * 0.105));
    expect(at(d, 'b-ins-company').price).toBe(Math.round(ins * 0.175));
    expect(at(d, 'b-ins-health').price).toBe(Math.round(ins * 0.03));
    expect(at(d, 'b-ins-unemp').price).toBe(Math.round(ins * 0.01));
    expect(at(d, 'b-ins-accident').price).toBe(Math.round(ins * 0.005));
    expect(at(d, 'b-ins-health').formula).toContain('lương đóng BHXH');
  });
  it('IV–V. phụ cấp / thưởng / phí nhập tay lấy giá mặc định; phụ cấp ca đêm tự tính 30%', () => {
    const d = base(withItems(['b-meal', 'b-nightallow', 'b-bonus-perf']));
    expect(at(d, 'b-meal').price).toBe(0);
    expect(at(d, 'b-nightallow').price).toBe(75_000);
    expect(at(d, 'b-bonus-perf').formula).toBe('Nhập tay');
  });
  it('mục tự tính ghi tay đè được; báo tách khoản cộng từ phần lương; cột thợ tính lại theo lương thợ', () => {
    const q = withItems(['b-day12', 'b-hol8']);
    const row = q.rows.find(r => r.catalogId === 'b-day12')!;
    expect(at(base({ ...q, rows: q.rows.map(r => (r.id === row.id ? { ...r, override: 480_000 } : r)) }), 'b-day12'))
      .toMatchObject({ price: 480_000, overridden: true, auto: 487_500 });
    expect(at(base({ ...q, itemized: true }), 'b-day12').price).toBe(250_000 + 187_500);
    expect(at(base(q, true), 'b-hol8').skilled!.price).toBe(8 * 32_000 * 3);   // 256.000 ÷ 8 = 32.000
  });
  it('mô tả cách tính; công thức mới qua được làm sạch', () => {
    expect(describeCalc(undefined)).toBe('nhập tay');
    expect(describeCalc({ base: 'night', hours: 4, coef: 2 })).toBe('giá ca đêm + 4 giờ × 200%');
    expect(describeCalc({ base: 'none', hours: 8, coef: 3.9 })).toBe('8 giờ × 390%');
    expect(describeCalc({ base: 'dayHour', hours: 0, coef: 0 })).toBe('bằng giá 1 giờ ca ngày');
    expect(describeCalc({ base: 'insSalary', hours: 0, coef: 0.105 })).toBe('10.5% lương đóng BHXH');
    expect(cleanCalc({ base: 'insSalary', hours: 5, coef: 0.03 })).toEqual({ base: 'insSalary', hours: 0, coef: 0.03 });
    expect(cleanCalc({ base: 'none', hours: 0, coef: 1 })).toBeNull();
  });
  it('PDF song ngữ dùng bản dịch có sẵn của mục kho', () => {
    const d = base(withItems(['b-hol8']));
    const v = resolveDoc({ ...defaultDoc(new Date('2026-10-13')), lang: 'zh' }, d, computePlan(d), emptyProfile());
    expect(v.rows.find(r => r.name.a === 'Lương 8h ca ngày Lễ, Tết')!.name.b).toBe('节假日8小时白班工资');
  });
});

describe('Mã danh mục quy chiếu', () => {
  it('dòng chuẩn tự có mã theo loại; báo theo giờ thì ca ngày / đêm là mục "1 giờ"; dòng thêm từ kho mang mã mục', () => {
    const d = base(withItems(['b-day12']));
    const l = list(d);
    expect(l.rows.find(r => r.kind === 'day8')!.ref).toBe('b-day8');
    expect(l.rows.find(r => r.kind === 'ot_sun_night')!.ref).toBe('b-ot-sun-night');
    expect(l.rows.find(r => r.kind === 'custom')!.ref).toBe('b-day12');
    const h = list(base(setPerHour(withItems([]), true)));
    expect(h.rows.find(r => r.kind === 'day8')!.ref).toBe('b-hour-day');
    expect(list(base({ ...defaultQuoteSheet(), rows: [...defaultQuoteSheet().rows, { id: 'x', kind: 'custom', name: 'Tiền cơm', unit: 'VNĐ/suất', override: 0 }] })).rows.find(r => r.id === 'x')!.ref).toBeNull();
    // Bảng giá cũ: dòng trùng đúng tên (tên cũ) của mục có sẵn tự có mã, chưa cần gắn tay
    expect(list(base({ ...defaultQuoteSheet(), rows: [...defaultQuoteSheet().rows, { id: 'y', kind: 'custom', name: 'Lương ca ngày 12 tiếng', unit: 'VNĐ/ngày', override: 0 }] })).rows.find(r => r.id === 'y')!.ref).toBe('b-day12');
  });
  it('mã được giữ khi lưu / đọc lại, khi lưu & áp mẫu bảng giá chung', () => {
    const q = withItems(['b-meal']);
    expect(normalizeQuoteSheet(JSON.parse(JSON.stringify(q))).rows.find(r => r.kind === 'custom')!.catalogId).toBe('b-meal');
    const t = sheetToTemplate(q);
    expect(t.rows.find(r => r.kind === 'custom')!.catalogId).toBe('b-meal');
    // Phương án đang có dòng "Tiền cơm" đã gắn b-meal → áp mẫu khớp theo mã, giữ giá đã ghi
    const cur: QuoteSheet = { ...defaultQuoteSheet(), rows: [...defaultQuoteSheet().rows, { id: 'm', kind: 'custom', name: 'Tiền cơm', unit: 'VNĐ/suất', override: 30_000, catalogId: 'b-meal' }] };
    const out = sheetFromTemplate(t, cur).rows.filter(r => r.kind === 'custom');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 'm', override: 30_000, catalogId: 'b-meal' });
  });
  it('thêm mục ứng với dòng chuẩn đang ẩn → hiện lại dòng chuẩn, không thêm dòng trùng', () => {
    const q = defaultQuoteSheet();
    expect(q.rows.find(r => r.kind === 'ot_hol')!.hidden).toBe(true);
    const n = addCatalogItem(q, B('b-ot-hol'));
    expect(n.rows.length).toBe(q.rows.length);
    expect(n.rows.find(r => r.kind === 'ot_hol')!.hidden).toBe(false);
    const m = addCatalogItem(q, B('b-sun12'));
    expect(m.rows.length).toBe(q.rows.length + 1);
    expect(m.rows[m.rows.length - 1]).toMatchObject({ kind: 'custom', catalogId: 'b-sun12', override: null });
  });
  it('bộ chọn: mục đã có trên bảng (theo mã hoặc tên) mờ đi; phí DV chỉ "đã có" khi báo tách khoản', () => {
    const d = base(withItems(['b-meal']));
    const u = usedRows(list(d).rows);
    expect(isUsed(u, B('b-meal'))).toBe(true);
    expect(isUsed(u, B('b-ot-day'))).toBe(true);
    expect(isUsed(u, B('b-ot-hol'))).toBe(false);                 // dòng chuẩn đang ẩn
    expect(isUsed(u, B('b-svc-fee'))).toBe(false);
    expect(isUsed(usedRows(list(base({ ...withItems([]), itemized: true })).rows), B('b-svc-fee'))).toBe(true);
    expect(sheetHasItem(withItems(['b-meal']), B('b-meal'))).toBe(true);
  });
  it('giá theo mã danh mục — nền so sánh giữa các dự án', () => {
    const p = pricesByCatalog(list(base(withItems(['b-day12']))).rows);
    expect(p['b-day8']).toEqual({ price: 300_000, unit: 'VNĐ/ngày' });
    expect(p['b-day12'].price).toBe(487_500);
    expect(p['b-ot-hol']).toBeUndefined();                          // dòng ẩn không tính
  });
});

describe('Chuyển đổi bảng giá cũ sang danh mục', () => {
  const pick = (name: string, calc?: QuoteSheet['rows'][number]['calc']) => suggestCatalog({ name, calc }, mergedCatalog([]), 3);
  it('gợi ý đúng mục cho các tên hay gặp ở bảng giá cũ', () => {
    expect(pick('Lương ca ngày 12 tiếng')[0]).toMatchObject({ item: { id: 'b-day12' }, score: 2 });        // tên cũ
    expect(pick('Phụ cấp cơm')[0].item.id).toBe('b-meal');
    expect(pick('Tiền ăn ca')[0].item.id).toBe('b-meal');
    expect(pick('Tăng ca chủ nhật ca đêm')[0].item.id).toBe('b-ot-sun-night');
    expect(pick('Lương ngày lễ 12 tiếng')[0].item.id).toBe('b-hol12');
    expect(pick('Lương 8h ca đêm')[0].item.id).toBe('b-night8');
    expect(pick('Xăng xe')[0].item.id).toBe('b-travel');
    expect(pick('BHYT')[0].item.id).toBe('b-ins-health');
    expect(pick('Lương ca đêm 10 tiếng', { base: 'night', hours: 2, coef: 2 })[0].item.id).not.toBe('b-night12');
  });
  it('tên quá chung thì không tự chọn — để người dùng chọn', () => {
    expect(initialCatalogChoice({ name: 'Phụ cấp' }, mergedCatalog([]))).toEqual({ ref: null, suggested: false });
    expect(initialCatalogChoice({ name: 'Tiền ăn ca' }, mergedCatalog([]))).toEqual({ ref: 'b-meal', suggested: true });
    expect(initialCatalogChoice({ name: 'X', catalogId: 'b-bonus-perf' }, mergedCatalog([]))).toEqual({ ref: 'b-bonus-perf', suggested: false });
    expect(initialCatalogChoice({ name: 'Lương ca ngày 12 tiếng' }, mergedCatalog([]))).toEqual({ ref: 'b-day12', suggested: true, exact: true });
  });
  it('áp dụng: gắn mã, giữ tên & giá đã báo; tích đổi tên thì lấy tên + bản dịch của danh mục; bỏ gắn được', () => {
    const q: QuoteSheet = { ...defaultQuoteSheet(), rows: [...defaultQuoteSheet().rows,
      { id: 'm', kind: 'custom', name: 'Tiền cơm', unit: 'VNĐ/suất', override: 25_000 },
      { id: 'x', kind: 'custom', name: 'Thưởng', unit: 'VNĐ/tháng', override: 100_000, catalogId: 'b-bonus-hire' }] };
    const items = mergedCatalog([]);
    const a = applyCatalogMap(q, { m: 'b-meal', x: null }, items);
    expect(a.rows.find(r => r.id === 'm')).toMatchObject({ name: 'Tiền cơm', override: 25_000, unit: 'VNĐ/suất', catalogId: 'b-meal' });
    expect(a.rows.find(r => r.id === 'x')!.catalogId).toBeUndefined();
    const b = applyCatalogMap(q, { m: 'b-meal' }, items, ['m']);
    expect(b.rows.find(r => r.id === 'm')).toMatchObject({ name: 'Phụ cấp cơm / Hỗ trợ tiền ăn ca', override: 25_000, i18n: { zh: '餐费补贴' } });
    expect(b.rows.find(r => r.id === 'x')!.catalogId).toBe('b-bonus-hire');                                   // không có trong map → giữ
    expect(list(base(b)).rows.find(r => r.id === 'm')!.ref).toBe('b-meal');
  });
});

describe('Kho của công ty', () => {
  it('lưu / đọc / gộp / tìm không dấu / không thêm trùng / xoá', () => {
    const r = { ...rowFromCatalog(BUILTIN_CATALOG[0]), name: 'Lương ca đêm 10 tiếng', calc: { base: 'night' as const, hours: 2, coef: 2 } };
    const mine = upsertCatalog([], catalogFromRow(r));
    expect(parseCatalog(JSON.stringify(mine.map(toStored)))[0]).toMatchObject({ name: 'Lương ca đêm 10 tiếng', group: 'wage', calc: { base: 'night', hours: 2, coef: 2 }, custom: true });
    expect(parseCatalog('hỏng')).toEqual([]);
    expect(mergedCatalog(mine)[0].name).toBe('Lương ca đêm 10 tiếng');
    expect(searchCatalog(mergedCatalog(mine), 'le tet 12h').map(i => i.id)).toEqual(['b-hol12', 'b-hol12n']);
    expect(searchCatalog(mergedCatalog(mine), 'bhyt').map(i => i.id)).toContain('b-ins-health');
    const again = upsertCatalog(mine, { ...catalogFromRow({ ...r, unit: 'VNĐ/ca' }), id: 'c-khac' });
    expect(again.length).toBe(1);
    expect(again[0].id).toBe(mine[0].id);                                   // giữ mã cũ → dòng đã gắn không lạc
    expect(catalogItemNamed(mergedCatalog([]), 'phụ cấp  cơm')!.id).toBe('b-meal');   // tên cũ (alias)
    expect(removeFromCatalog(mine, mine[0].id)).toEqual([]);
  });
  it('kho đời đầu (3 nhóm cũ): bản sao chưa sửa nhận tên / nhóm mới, giữ cờ ẩn; mục đã sửa giữ nguyên; mục tự thêm đoán nhóm', () => {
    const v1 = JSON.stringify([
      { id: 'b-day12', group: 'shift', name: 'Lương ca ngày 12 tiếng', unit: 'VNĐ/ngày', calc: { base: 'day', hours: 4, coef: 1.5 }, builtinId: 'b-day12', custom: false },
      { id: 'b-meal', group: 'allowance', name: 'Phụ cấp cơm', unit: 'VNĐ/suất', price: 0, builtinId: 'b-meal', custom: false, hidden: true },
      { id: 'b-hol8', group: 'shift', name: 'Lễ Tết 8h', unit: 'VNĐ/ngày', calc: { base: 'none', hours: 8, coef: 3 }, builtinId: 'b-hol8', custom: false },
      { id: 'c-1', group: 'shift', name: 'Lương ca đêm 10 tiếng', unit: 'VNĐ/ca', calc: { base: 'night', hours: 2, coef: 2 }, custom: true },
      { id: 'c-2', group: 'allowance', name: 'Thưởng Tết', unit: 'VNĐ/người', price: 0, custom: true },
      { id: 'c-3', group: 'other', name: 'Khám sức khoẻ đầu vào', unit: 'VNĐ/người', price: 0, custom: true },
    ]);
    const p = parseCatalog(v1);
    expect(p.map(i => [i.id, i.group])).toEqual([['b-day12', 'wage'], ['b-meal', 'allowance'], ['b-hol8', 'overtime'], ['c-1', 'wage'], ['c-2', 'fee'], ['c-3', 'insurance']]);
    expect(p[0]).toMatchObject({ name: 'Lương 12h ngày thường (ca ngày)', unit: 'VNĐ/12h/ngày', hidden: false });
    expect(p[1]).toMatchObject({ name: 'Phụ cấp cơm / Hỗ trợ tiền ăn ca', hidden: true });
    expect(p[2]).toMatchObject({ name: 'Lễ Tết 8h', builtinId: 'b-hol8' });
    expect(mergedCatalog(p).length).toBe(BUILTIN_CATALOG.length + 3);
    // Lưu lại rồi đọc → y hệt; mục có sẵn chưa sửa chỉ lưu mã (lần sau nâng cấp danh mục tự nhận tên mới)
    expect(parseCatalog(JSON.stringify(p.map(toStored)))).toEqual(p);
    expect(toStored(p[0]).name).toBe('');
  });
  it('lưu cả kho: giữ thứ tự, mục có sẵn đã sửa không bị nạp trùng, ẩn được cả mục có sẵn lẫn mục của công ty', () => {
    const all = mergedCatalog([{ id: 'c-9', group: 'fee', name: 'Phí tuyển gấp', unit: 'VNĐ/người', price: 0, custom: true }]);
    const edited = all.map(i => (i.id === 'b-hol8' ? { ...i, name: 'Lễ Tết 8h ca ngày', hidden: false } : i.id === 'b-uniform' || i.id === 'c-9' ? { ...i, hidden: true } : i));
    const stored = parseCatalog(JSON.stringify([...edited].reverse().map(toStored)));
    const m = mergedCatalog(stored);
    expect(m.length).toBe(all.length);
    expect(m[0].id).toBe(all[all.length - 1].id);
    expect(m.find(i => i.builtinId === 'b-hol8')!.name).toBe('Lễ Tết 8h ca ngày');
    expect(pickerCatalog(stored).some(i => i.id === 'b-uniform' || i.id === 'c-9')).toBe(false);
    expect(m.filter(i => i.hidden).map(i => i.id)).toEqual(expect.arrayContaining(['b-uniform', 'c-9', 'b-deduct']));
    // Mục ít dùng ẩn sẵn: bật lại thì nhớ là đang hiện
    const shownAgain = parseCatalog(JSON.stringify(mergedCatalog([]).map(i => (i.id === 'b-deduct' ? { ...i, hidden: false } : i)).map(toStored)));
    expect(pickerCatalog(shownAgain).some(i => i.id === 'b-deduct')).toBe(true);
  });
  it('mục có sẵn nhận ra gốc để khôi phục; mục tự thêm không có gốc', () => {
    const e = { ...B('b-day12'), name: 'Tên khác' };
    expect(builtinOf(e)?.name).toBe('Lương 12h ngày thường (ca ngày)');
    expect(builtinOf({ id: 'c-1', group: 'fee', name: 'X', unit: 'VNĐ' })).toBeUndefined();
  });
  it('dán nhiều mục: Tên | Đơn vị | Giá, cả dán từ Excel (Tab), bỏ trống và trùng tên (kể cả tên cũ), tự đoán nhóm', () => {
    const got = parseBulkItems('Phụ cấp thâm niên | VNĐ/tháng | 500.000\nTiền thưởng chuyên cần\t VNĐ/tháng\n\nphụ cấp  thâm  niên\nPhụ cấp cơm\nXe đưa đón;VNĐ/ngày;10000', mergedCatalog([]));
    expect(got.map(g => [g.name, g.unit, g.price, g.group])).toEqual([
      ['Phụ cấp thâm niên', 'VNĐ/tháng', 500_000, 'allowance'], ['Tiền thưởng chuyên cần', 'VNĐ/tháng', 0, 'fee'], ['Xe đưa đón', 'VNĐ/ngày', 10_000, 'allowance'],
    ]);
    expect(guessGroup('Lương tăng ca Chủ nhật')).toBe('overtime');
    expect(guessGroup('BHXH bắt buộc')).toBe('insurance');
  });
});

import { applyCostCatalogMap, catalogFromCostLine, costByCatalog, costCatalog, costLineRef, describeCost, doubleBilled, lineFromCatalog, usedCostLines } from './rowCatalog';
import { baseLines, COMMON_OPTIONAL } from './presets';
import type { CostLine } from './types';

describe('Bảng chi phí (bước 1) dùng chung danh mục', () => {
  it('chỉ mục là chi phí thật của 1 công mới dùng được ở bước 1', () => {
    const ids = costCatalog(BUILTIN_CATALOG).map(i => i.id);
    expect(BUILTIN_CATALOG.filter(b => b.group === 'overtime').some(b => b.cost)).toBe(false);          // tăng ca / CN / Lễ: suy từ lương CB
    expect(['b-day12', 'b-hour-day', 'b-day8', 'b-piece', 'b-ins-worker', 'b-svc-fee', 'b-deduct', 'b-profit-share', 'b-meal-ot'].some(i => ids.includes(i))).toBe(false);
    expect(ids).toEqual(expect.arrayContaining(['b-ins-all', 'b-union-fee', 'b-annual-leave', 'b-meal', 'b-attend', 'b-bonus-perf', 'b-uniform']));
    expect(B('b-uniform').cost!.section).toBe('compliance');            // đồng phục: công ty chịu (mặc định)
    expect(B('b-bonus-perf').cost).toMatchObject({ section: 'worker', mode: 'fixed' });
  });
  it('thêm khoản từ danh mục: đúng nhóm, cách tính mặc định, mang mã; engine tính đúng', () => {
    const ins = lineFromCatalog(B('b-ins-health'));
    expect(ins).toMatchObject({ group: 'compliance', mode: 'percent', base: 'insurable', value: 3, paidToWorker: false, catalogId: 'b-ins-health' });
    expect(ins.cap).toBeGreaterThan(0);
    expect(lineFromCatalog(B('b-meal'))).toMatchObject({ group: 'worker', paidToWorker: true, mode: 'fixed', unit: 'day', catalogId: 'b-meal' });
    expect(lineFromCatalog(B('b-annual-leave'))).toMatchObject({ mode: 'leave', value: 12 });
    expect(lineFromCatalog(B('b-skill')).insurable).toBe(true);
    const d = base(defaultQuoteSheet());
    const withMeal: PlanData = { ...d, lines: [...d.lines, { ...lineFromCatalog(B('b-meal')), value: 25_000 }] };
    expect(computePlan(withMeal).costDaily - computePlan(d).costDaily).toBe(25_000);
  });
  it('mã của khoản: lương CB / phí DV / phép năm tự gắn; khoản theo ngành / mặc định trùng tên tự có mã; mã ghi tay thắng', () => {
    const lines = baseLines({ baseWageMonthly: 6_500_000 });
    expect(lines.map(costLineRef)).toEqual(['b-base-wage', 'b-ins-all', 'b-annual-leave', 'b-union-fee', 'b-svc-fee']);
    const opt = Object.fromEntries(COMMON_OPTIONAL().map(l => [l.name, costLineRef(l)]));
    expect(opt).toMatchObject({ 'Phụ cấp chuyên cần': 'b-attend', 'Phụ cấp cơm ca': 'b-meal', 'Phụ cấp đi lại': 'b-travel', 'Phụ cấp nhà ở / nhà trọ': 'b-housing',
      'Khám sức khoẻ định kỳ': 'b-health-check', 'Đồng phục / bảo hộ lao động': 'b-uniform', 'Bảo hiểm tai nạn 24/24': 'b-ins-24h', 'Thưởng Tết / tháng 13 (dự phòng)': 'b-bonus-13' });
    expect(costLineRef({ name: 'Xe đưa đón công nhân', mode: 'fixed' })).toBeNull();
    expect(costLineRef({ name: 'Phụ cấp cơm ca', mode: 'fixed', catalogId: 'c-rieng' })).toBe('c-rieng');
    expect(usedCostLines(lines).refs.has('b-union-fee')).toBe(true);
  });
  it('gắn danh mục cho khoản của phương án cũ: số tiền giữ nguyên, dòng vai trò cố định không đổi', () => {
    const lines: CostLine[] = [...baseLines({ baseWageMonthly: 6_500_000 }), { ...COMMON_OPTIONAL()[0], id: 'x', name: 'Tiền chuyên cần', value: 300_000 }];
    const out = applyCostCatalogMap(lines, { x: 'b-attend', [lines[0].id]: 'b-meal' }, mergedCatalog([]), ['x']);
    expect(out.find(l => l.id === 'x')).toMatchObject({ catalogId: 'b-attend', name: 'Phụ cấp chuyên cần', value: 300_000 });
    expect(out[0]).toEqual(lines[0]);
  });
  it('cảnh báo khách trả 2 lần: khoản trong giá ca 8h + dòng riêng có giá trên bảng giá', () => {
    const meal = { ...lineFromCatalog(B('b-meal')), value: 25_000 };
    const q = withItems(['b-meal']);
    const row = q.rows.find(r => r.catalogId === 'b-meal')!;
    const d0 = base(q);
    const d: PlanData = { ...d0, lines: [...d0.lines, meal], quote: { ...q, rows: q.rows.map(r => (r.id === row.id ? { ...r, override: 25_000 } : r)) } };
    expect(doubleBilled(d.lines, list(d).rows)).toEqual([{ rowId: row.id, lineId: meal.id }]);
    expect(doubleBilled(d.lines, list(base(q)).rows)).toEqual([]);                                          // dòng giá 0 = ghi chú
    expect(doubleBilled(d.lines.map(l => (l.id === meal.id ? { ...l, billSeparately: true } : l)), list(d).rows)).toEqual([]);
    // Phương án cũ chưa gắn mã: trùng tên vẫn bắt được
    const old: PlanData = { ...d0, lines: [...d0.lines, { ...meal, name: 'Tiền xe', catalogId: undefined }], quote: { ...defaultQuoteSheet(), rows: [...defaultQuoteSheet().rows, { id: 't', kind: 'custom', name: 'Tiền xe', unit: 'VNĐ/ngày', override: 20_000 }] } };
    expect(doubleBilled(old.lines, list(old).rows).map(x => x.rowId)).toEqual(['t']);
  });
  it('chi phí theo mã danh mục — nền so sánh giữa dự án; lưu khoản tự đặt thành mục kho', () => {
    const d: PlanData = { settings: { ...DEFAULT_SETTINGS, taxOption: 'none' }, notes: '', lines: baseLines({ baseWageMonthly: 6_500_000 }), quote: null };
    const c = costByCatalog(d.lines, computePlan(d).lines);
    expect(c['b-base-wage'].monthly).toBe(6_500_000);
    expect(Object.keys(c)).toEqual(expect.arrayContaining(['b-ins-all', 'b-union-fee', 'b-annual-leave', 'b-svc-fee']));
    const it = catalogFromCostLine({ ...COMMON_OPTIONAL()[0], name: 'Xe đưa đón công nhân', paidToWorker: false, group: 'other', unit: 'day', value: 15_000 });
    expect(it).toMatchObject({ custom: true, name: 'Xe đưa đón công nhân', cost: { section: 'other', mode: 'fixed', unit: 'day', value: 15_000 } });
    expect(describeCost(it.cost)).toBe('nhập số · đ/công · mặc định 15.000');
    expect(describeCost(B('b-ins-all').cost)).toBe('21,5% lương đóng BHXH');
    expect(describeCost(undefined)).toBe('không dùng ở bảng chi phí');
  });
  it('lưu kho: tắt "dùng ở bước 1" của mục có sẵn được ghi nhớ; kho đời 1 nhận cách dùng mặc định', () => {
    const off = mergedCatalog([]).map(i => (i.id === 'b-uniform' ? { ...i, cost: undefined } : i));
    const p = parseCatalog(JSON.stringify(off.map(toStored)));
    expect(p.find(i => i.id === 'b-uniform')!.cost).toBeUndefined();
    expect(p.find(i => i.id === 'b-meal')!.cost).toEqual(B('b-meal').cost);
    const v1 = parseCatalog(JSON.stringify([{ id: 'b-meal', group: 'allowance', name: 'Cơm ca', unit: 'VNĐ/suất', price: 0, builtinId: 'b-meal' }]));
    expect(v1[0]).toMatchObject({ name: 'Cơm ca', cost: B('b-meal').cost });
    const custom = parseCatalog(JSON.stringify([catalogFromCostLine({ ...COMMON_OPTIONAL()[0], name: 'Thưởng thâm niên', value: 200_000 })].map(toStored)));
    expect(custom[0].cost).toMatchObject({ section: 'worker', mode: 'fixed', unit: 'month', value: 200_000 });
  });
});
