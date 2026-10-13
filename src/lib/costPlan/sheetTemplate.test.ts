import { describe, it, expect, vi } from 'vitest';
vi.mock('../supabase', () => ({ supabase: {} }));
import { sheetFromTemplate, sheetToTemplate, templateCustomRowsMissing, parseSheetTemplate } from './sheetTemplate';
import { computePriceList, defaultQuoteSheet, normalizeQuoteSheet } from './quoteSheet';
import { computePlan, DEFAULT_SETTINGS, newLine } from './engine';
import { defaultDoc, emptyProfile, resolveDoc } from './quoteDoc';
import type { PlanData, QuoteSheet } from './types';

// Bảng giá đã chỉnh tên như mẫu TRI-WALL: đổi tên dòng CN, hiện dòng Lễ, thêm phụ cấp cơm, dịch tiếng Trung
const edited = (): QuoteSheet => {
  const q = defaultQuoteSheet();
  return {
    ...q, nightOtAfterDay: true,
    rows: [
      ...q.rows.map(r => r.kind === 'day8' ? { ...r, name: 'Lương ca ngày 8h', override: 250_000, i18n: { zh: '8小时白班基本工资' } }
        : r.kind === 'ot_sun' ? { ...r, name: 'Lương Chủ Nhật ca ngày', override: 55_000 }
        : r.kind === 'ot_hol' ? { ...r, name: 'Lương ca ngày Lễ, Tết', hidden: false, override: 80_000 } : r),
      { id: 'com', kind: 'custom', name: 'Phụ cấp cơm', unit: 'VNĐ/suất', override: 25_000, hidden: false },
    ],
  };
};

describe('Mẫu bảng giá chung', () => {
  it('lưu mẫu: giữ tên/đơn vị/ẩn hiện/bản dịch, BỎ giá các dòng tự tính, giữ giá dòng nhập tay', () => {
    const t = sheetToTemplate(edited());
    const day = t.rows.find(r => r.kind === 'day8')!;
    expect(day).toMatchObject({ name: 'Lương ca ngày 8h', override: null, i18n: { zh: '8小时白班基本工资' } });
    expect(t.rows.find(r => r.kind === 'ot_hol')).toMatchObject({ name: 'Lương ca ngày Lễ, Tết', hidden: false, override: null });
    expect(t.rows.find(r => r.kind === 'custom')).toMatchObject({ name: 'Phụ cấp cơm', override: 25_000 });
    expect(t.nightOtAfterDay).toBe(true);
    expect(parseSheetTemplate(JSON.stringify({ sheet: t, savedAt: 'x', savedBy: 'A' }))!.sheet.rows.length).toBe(t.rows.length);
    expect(parseSheetTemplate('hỏng')).toBeNull();
  });
  it('phương án mới theo mẫu: đúng tên, giá dòng tự tính để hệ thống tự tính', () => {
    const q = sheetFromTemplate(sheetToTemplate(edited()));
    expect(q.rows.find(r => r.kind === 'ot_sun')).toMatchObject({ name: 'Lương Chủ Nhật ca ngày', override: null });
    expect(q.rows.find(r => r.kind === 'custom')).toMatchObject({ name: 'Phụ cấp cơm', override: 25_000 });
  });
  it('áp mẫu vào phương án đang soạn: đổi tên theo mẫu nhưng GIỮ giá đã ghi tay, giữ dòng riêng của phương án', () => {
    const cur: QuoteSheet = { ...defaultQuoteSheet(), rows: [...defaultQuoteSheet().rows.map(r => (r.kind === 'ot_sun' ? { ...r, override: 60_000 } : r)),
      { id: 'cc', kind: 'custom', name: 'phụ cấp  cơm', unit: 'VNĐ/suất', override: 30_000 }, { id: 'xe', kind: 'custom', name: 'Xe đưa đón', unit: 'VNĐ/ngày', override: 10_000 }] };
    const q = sheetFromTemplate(sheetToTemplate(edited()), cur);
    expect(q.rows.find(r => r.kind === 'ot_sun')).toMatchObject({ name: 'Lương Chủ Nhật ca ngày', override: 60_000 });
    expect(q.rows.find(r => r.name === 'Phụ cấp cơm')).toMatchObject({ id: 'cc', override: 30_000 });
    expect(q.rows[q.rows.length - 1]).toMatchObject({ name: 'Xe đưa đón', override: 10_000 });
  });
  it('mẫu báo theo giờ, phương án báo theo ngày → giá ghi tay quy đổi sang giờ', () => {
    const tpl = sheetToTemplate({ ...edited(), perHour: true });
    const cur: QuoteSheet = { ...defaultQuoteSheet(), rows: defaultQuoteSheet().rows.map(r => (r.kind === 'day8' ? { ...r, override: 320_000 } : r)) };
    expect(sheetFromTemplate(tpl, cur).rows.find(r => r.kind === 'day8')!.override).toBe(40_000);
  });
  it('menu Thêm dòng gợi ý dòng của mẫu mà bảng chưa có', () => {
    expect(templateCustomRowsMissing(sheetToTemplate(edited()), normalizeQuoteSheet(null)).map(r => r.name)).toEqual(['Phụ cấp cơm']);
  });
  it('báo giá song ngữ dùng bản dịch đã điền cho tên tự đặt; đơn vị hay gặp tự dịch', () => {
    const d: PlanData = { settings: { ...DEFAULT_SETTINGS }, notes: '', quote: sheetFromTemplate(sheetToTemplate(edited())),
      lines: [newLine({ name: 'Lương cơ bản', unit: 'day', value: 250_000, paidToWorker: true, isBaseWage: true, group: 'worker' })] };
    const r = computePlan(d);
    expect(computePriceList(d, r).rows[0].i18n).toEqual({ zh: '8小时白班基本工资' });
    const v = resolveDoc({ ...defaultDoc(new Date('2026-10-13')), lang: 'zh' }, d, r, emptyProfile());
    expect(v.rows[0].name).toEqual({ a: 'Lương ca ngày 8h', b: '8小时白班基本工资' });
    expect(v.rows.find(x => x.name.a === 'Phụ cấp cơm')!.unit).toEqual({ a: 'VNĐ/suất', b: '越南盾/份' });
  });
});
