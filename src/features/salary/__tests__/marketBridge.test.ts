// Cầu nối Thị trường + nháp v2. Đây là hai chỗ dễ hỏng âm thầm nhất của bản rebuild:
// quy đổi đơn vị ca 12h sai thì số vẫn "trông hợp lý" nhưng lệch 12 lần, và migrate hỏng thì
// người dùng mất trắng nháp đang gõ dở.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  wageDetailFromTable, clientWageDetailFromRevenue, pickEntryFromWageDetail, allowanceLinesFromWageDetail,
} from '../marketBridge';
import { buildWageTable, computeRevenue, amountForShr } from '../salaryEngine';
import { basis, vol, WD, SHR, VOL_DAY_ONLY, pbManual } from './fixtures';
import type { WageFieldMapping } from '../../../lib/payroll/rateCard';
import type { WageCode } from '../types';

const money = (a: number, e: number) => expect(Math.abs(a - e)).toBeLessThanOrEqual(1);

const FIELDS: WageFieldMapping[] = [
  { name: 'Lương cơ bản', payrollInputType: 'base_salary' },
  { name: 'Ca ngày 8h (Ca 1+2)', payrollInputType: 'day_wage_8h' },
  { name: 'Ca đêm 8h (130%)', payrollInputType: 'night_wage_8h' },
  { name: 'Ca ngày 12h', payrollInputType: 'shift12_day' },
  { name: 'Ca đêm 12h', payrollInputType: 'shift12_night' },
  { name: 'Ăn ca', payrollInputType: null },
  { name: 'Xăng xe', payrollInputType: null },
];

describe('Ghi sang Thị trường — đơn vị CŨ', () => {
  const table = buildWageTable(basis());
  const detail = wageDetailFromTable(table, FIELDS, WD, {});

  it('dòng 8h/tháng giữ nguyên số (2 quy ước trùng nhau)', () => {
    money(detail['Lương cơ bản'], 8_632_000);
    money(detail['Ca ngày 8h (Ca 1+2)'], 332_000);
    money(detail['Ca đêm 8h (130%)'], 431_600);
  });

  it('ca 12h quy về đ/GIỜ BÌNH QUÂN — KHÔNG ghi nguyên 581.000', () => {
    // Engine mới giữ 581.000đ cả ca; bên Thị trường ô đó là đơn giá bình quân/giờ.
    money(detail['Ca ngày 12h'], 581_000 / 12);
    money(detail['Ca đêm 12h'], 763_600 / 12);
    expect(detail['Ca ngày 12h']).not.toBe(581_000);
  });

  it('phụ cấp ghi thẳng, không quy đổi', () => {
    const d = wageDetailFromTable(table, FIELDS, WD, { 'Ăn ca': 730_000 });
    expect(d['Ăn ca']).toBe(730_000);
  });

  it('khoản không liên quan ở bản ghi cũ được GIỮ NGUYÊN, không bị xoá', () => {
    const d = wageDetailFromTable(table, FIELDS, WD, {}, { 'Thưởng chuyên cần': 500_000 });
    expect(d['Thưởng chuyên cần']).toBe(500_000);
  });
});

describe('Đọc từ Thị trường — round-trip không trôi SHR', () => {
  const table = buildWageTable(basis());

  it('ghi rồi đọc lại ra đúng SHR 41.500 (ưu tiên lương cơ bản)', () => {
    const detail = wageDetailFromTable(table, FIELDS, WD, {});
    const picked = pickEntryFromWageDetail(detail, FIELDS, WD)!;
    expect(picked.code).toBe('base_salary');
    money(picked.shrPay, SHR);
  });

  it('bảng CHỈ có ca 12h — chỗ dễ lệch 12 lần nhất — vẫn ra đúng SHR', () => {
    const only12h: WageFieldMapping[] = FIELDS.filter(f => f.payrollInputType === 'shift12_day' || !f.payrollInputType);
    const detail = wageDetailFromTable(table, only12h, WD, {});
    const picked = pickEntryFromWageDetail(detail, only12h, WD)!;
    expect(picked.code).toBe('shift12_day');
    money(picked.shrPay, SHR);
    // Số tiền đọc về theo đơn vị MỚI (cả ca), không phải số đã lưu.
    //
    // ⚠ Dung sai 12đ chứ không phải 1đ, và đây là GIỚI HẠN THẬT của kho dữ liệu cũ chứ không
    // phải sai số tính toán: ô ca 12h bên Thị trường lưu ĐƠN GIÁ BÌNH QUÂN/GIỜ và làm tròn tới
    // đồng (581.000/12 = 48.416,67 → lưu 48.417), nên nhân 12 trở lại ra 581.004. Mỗi đồng làm
    // tròn ở mức giờ nở thành 12đ ở mức ca. SHR vẫn đúng trong 1đ nên bảng lương không lệch —
    // chỉ riêng con số ca 12h đọc ngược về có thể nhích tối đa ~12đ/ca.
    expect(Math.abs(picked.amount - 581_000)).toBeLessThanOrEqual(12);
  });

  it('mọi mã đều round-trip được', () => {
    for (const code of ['base_salary', 'day_wage_8h', 'night_wage_8h', 'shift12_day', 'shift12_night'] as WageCode[]) {
      const fields: WageFieldMapping[] = [{ name: 'X', payrollInputType: code }];
      const detail = wageDetailFromTable(table, fields, WD, {});
      money(pickEntryFromWageDetail(detail, fields, WD)!.shrPay, SHR);
    }
  });

  it('ngày công khác 26 vẫn round-trip (lương tháng phụ thuộc ngày công)', () => {
    for (const wd of [22, 24, 26, 27]) {
      const t = buildWageTable(basis({ workdaysPerMonth: wd }));
      const detail = wageDetailFromTable(t, FIELDS, wd, {});
      money(pickEntryFromWageDetail(detail, FIELDS, wd)!.shrPay, SHR);
    }
  });

  it('bảng rỗng / thiếu → null, không throw', () => {
    expect(pickEntryFromWageDetail(null, FIELDS, WD)).toBeNull();
    expect(pickEntryFromWageDetail({}, FIELDS, WD)).toBeNull();
    expect(pickEntryFromWageDetail({ 'Ăn ca': 730_000 }, FIELDS, WD)).toBeNull();
  });

  it('khoản không phải đơn giá giờ → phụ cấp 2 mặt, mặc định trả toàn phần', () => {
    const lines = allowanceLinesFromWageDetail({ 'Ca ngày 8h (Ca 1+2)': 332_000, 'Ăn ca': 730_000, 'Xăng xe': 300_000 }, FIELDS);
    expect(lines.map(l => l.name).sort()).toEqual(['Xăng xe', 'Ăn ca']);
    expect(lines.every(l => l.customerPays === l.weOweWorker)).toBe(true);
  });
});

describe('Giá khách ghi sang Thị trường', () => {
  const table = buildWageTable(basis());

  it('dòng chưa khai giá thì BỎ QUA, không ghi 0', () => {
    const rev = computeRevenue(table, VOL_DAY_ONLY, pbManual({ day_wage_8h: 380_000 }), []);
    const out = clientWageDetailFromRevenue(rev, FIELDS, WD, {});
    expect(out['Ca ngày 8h (Ca 1+2)']).toBe(380_000);
    expect('Ca đêm 8h (130%)' in out).toBe(false);
  });

  it('giá khách của ca 12h cũng quy về đơn vị cũ', () => {
    const rev = computeRevenue(table, vol({ shift12_day: 13 }), pbManual({ shift12_day: 700_000 }), []);
    const out = clientWageDetailFromRevenue(rev, FIELDS, WD, {});
    money(out['Ca ngày 12h'], 700_000 / 12);
  });
});

describe('Nháp v2 (SPEC §8)', () => {
  // vitest chạy môi trường node — không có localStorage sẵn, dựng bản giả tối thiểu.
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
    };
  });

  const loadFresh = async () => {
    const m = await import('../draftV2');
    return m;
  };

  it('chưa có nháp nào → scenario rỗng hợp lệ, không throw', async () => {
    const { loadDraftV2 } = await loadFresh();
    const d = loadDraftV2();
    expect(d.scenario.version).toBe(2);
    expect(d.scenario.us.basis.workdaysPerMonth).toBe(26);
  });

  it('có nháp v1 → tự nâng lên v2 và BÁO đã nâng cấp', async () => {
    store.set('payroll_calc_draft_v1', JSON.stringify({
      companyName: 'ABC', inputType: 'day_wage_8h', inputValue: '332000',
      workingDaysPerMonth: 26, region: 'I',
    }));
    const { loadDraftV2 } = await loadFresh();
    const d = loadDraftV2();
    expect(d.migratedFromV1).toBe(true);
    expect(d.scenario.customerName).toBe('ABC');
    money(d.scenario.us.basis.shrPay, SHR);
  });

  it('KHÔNG xoá nháp v1 khi nâng cấp — còn đường lui', async () => {
    store.set('payroll_calc_draft_v1', JSON.stringify({ companyName: 'ABC', inputValue: '332000' }));
    const { loadDraftV2 } = await loadFresh();
    loadDraftV2();
    expect(store.has('payroll_calc_draft_v1')).toBe(true);
  });

  it('lưu rồi đọc lại giữ nguyên scenario và ui', async () => {
    const { loadDraftV2, saveDraftV2, DEFAULT_UI } = await loadFresh();
    const d0 = loadDraftV2();
    const scenario = { ...d0.scenario, customerName: 'XYZ' };
    saveDraftV2(scenario, { ...DEFAULT_UI, entryCode: 'shift12_night', deltaPercent: 5 });
    const d1 = loadDraftV2();
    expect(d1.scenario.customerName).toBe('XYZ');
    expect(d1.ui.entryCode).toBe('shift12_night');
    expect(d1.ui.deltaPercent).toBe(5);
    expect(d1.migratedFromV1).toBeFalsy();
  });

  it('nháp v2 hỏng → rơi về v1, không ném lỗi', async () => {
    store.set('payroll_calc_draft_v2', '{{{ hỏng');
    store.set('payroll_calc_draft_v1', JSON.stringify({ companyName: 'Cứu được', inputValue: '332000' }));
    const { loadDraftV2 } = await loadFresh();
    expect(() => loadDraftV2()).not.toThrow();
    expect(loadDraftV2().scenario.customerName).toBe('Cứu được');
  });

  it('xoá nháp v2 không đụng tới v1', async () => {
    const { saveDraftV2, clearDraftV2, loadDraftV2, DEFAULT_UI } = await loadFresh();
    store.set('payroll_calc_draft_v1', JSON.stringify({ companyName: 'v1' }));
    saveDraftV2(loadDraftV2().scenario, DEFAULT_UI);
    clearDraftV2();
    expect(store.has('payroll_calc_draft_v2')).toBe(false);
    expect(store.has('payroll_calc_draft_v1')).toBe(true);
  });
});

describe('Ô "số tiền tương ứng" ↔ khoá tay từng dòng', () => {
  it('đổi loại đơn giá không làm SHR trôi — số tiền hiển thị đổi theo đúng đơn vị mới', () => {
    const b = basis();
    for (const code of ['base_salary', 'day_wage_8h', 'shift12_day', 'ot_night_holiday'] as WageCode[]) {
      const amount = amountForShr(code, b.shrPay, WD, { priorDayOt: b.priorDayOt, includeHolidayBasePay: b.includeHolidayBasePay });
      expect(amount).toBeGreaterThan(0);
    }
    money(amountForShr('shift12_day', SHR, WD), 581_000);
    money(amountForShr('base_salary', SHR, WD), 8_632_000);
  });
});
