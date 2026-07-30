// Acceptance Test SPEC §9 — AT-18 (migration nháp v1 → v2).
import { describe, it, expect } from 'vitest';
import { migrate, migrateV1toV2, normalizeWageCode, LEGACY_FIELD_MAP, type LegacyDraft } from '../migrate';
import { computePnL, buildWageTable, rowOf } from '../salaryEngine';
import { WD } from './fixtures';

const money = (actual: number, expected: number) => expect(Math.abs(actual - expected)).toBeLessThanOrEqual(1);

/** Nháp v1 đúng bộ số của AT-14: day_wage_8h = 332.000, 26 ngày, Vùng I,
 *  phí giới thiệu 10.000đ/giờ thu hàng tháng 6 tháng, VAT 8%. */
const DRAFT_AT14: LegacyDraft = {
  companyName: 'Công ty ABC',
  supplierName: "Let's Go VN",
  kcnName: 'KCN Test',
  inputType: 'day_wage_8h',
  inputValue: '332000',
  priorDayOt: false,
  workingDaysPerMonth: WD,
  region: 'I',
  vatPercent: '8',
  serviceFeeType: 'referral_hourly',
  serviceFeeValue: '10000',
  referralDurationMode: 'recurring_months',
  referralMonths: 6,
  customerPriceMode: false,
  allowances: [],
  rawOverrides: {},
  clientRates: {},
};

describe('AT-18 — Migration v1 → v2', () => {
  it('không throw và ra version 2', () => {
    const s = migrate(DRAFT_AT14);
    expect(s.version).toBe(2);
  });

  it('suy đúng SHR 41.500 và giữ ngày công / vùng', () => {
    const s = migrate(DRAFT_AT14);
    money(s.us.basis.shrPay, 41_500);
    expect(s.us.basis.workdaysPerMonth).toBe(WD);
    expect(s.us.basis.region).toBe('I');
  });

  it('computePnL trên kết quả migrate cho ĐÚNG bộ số AT-14', () => {
    const s = migrate(DRAFT_AT14);
    const pnl = computePnL(s.us.basis, s.volume, s.priceBook, s.us.allowances, s.overhead, s.serviceFee);
    money(pnl.directCostMonth, 10_487_880);
    money(pnl.revenueMonth, 12_567_880);
    money(pnl.revenueMonth - pnl.directCostMonth, 2_080_000);
    money(pnl.revenueMonth * 1.08, 13_573_310.4);
  });

  it('idempotent: migrate(migrate(x)) === migrate(x)', () => {
    const once = migrate(DRAFT_AT14);
    const twice = migrate(once);
    expect(twice).toEqual(once);
  });

  it('⚠ cố ý tái tạo cấu hình cũ để số không nhảy', () => {
    const s = migrate(DRAFT_AT14);
    expect(s.overhead.unionFeePercent).toBe(0);
    expect(s.us.basis.shrBhxhMode).toBe('linked');
    expect(s.us.basis.includeHolidayBasePay).toBe(false);
  });

  it('v1 không có khối sản lượng → preset "Hành chính, không OT"', () => {
    const s = migrate(DRAFT_AT14);
    expect(s.volume.quantities).toEqual({ day_wage_8h: WD });
  });
});

describe('AT-18 — map 5 option legacy field:*', () => {
  const cases: [string, string][] = [
    ['Lương cơ bản', 'base_salary'],
    ['Ca ngày 8h (Ca 1+2)', 'day_wage_8h'],
    ['Ca đêm 8h (130%)', 'night_wage_8h'],
    ['Ca ngày 12h', 'shift12_day'],
    ['Ca đêm 12h', 'shift12_night'],
  ];

  it('phủ đủ 5 mã legacy', () => expect(Object.keys(LEGACY_FIELD_MAP)).toHaveLength(5));

  for (const [field, code] of cases) {
    it(`field:${field} → ${code}`, () => {
      expect(normalizeWageCode(`field:${field}`)).toBe(code);
      expect(normalizeWageCode(field)).toBe(code);
      // Cũng nhận qua inputSourceField, đúng cách v1 lưu.
      expect(normalizeWageCode('unknown', field)).toBe(code);
    });
  }

  it('mã canonical đi qua nguyên vẹn', () => {
    expect(normalizeWageCode('ot_night_holiday')).toBe('ot_night_holiday');
  });

  it('rác không nhận ra → mặc định day_wage_8h, KHÔNG throw', () => {
    expect(normalizeWageCode('xyz')).toBe('day_wage_8h');
    expect(normalizeWageCode(undefined)).toBe('day_wage_8h');
    expect(normalizeWageCode(42)).toBe('day_wage_8h');
  });

  it('suy SHR đúng qua mã legacy ca 12h (đơn vị đã đổi sang đ/cả ca)', () => {
    const s = migrate({
      ...DRAFT_AT14, inputType: 'field:Ca ngày 12h', inputValue: '581000',
    });
    money(s.us.basis.shrPay, 41_500);
  });
});

describe('AT-18 — hai đường doanh thu cũ quy về một Price Book', () => {
  it('bật "nhập thẳng giá khách trả" → singleDayRate', () => {
    const s = migrate({ ...DRAFT_AT14, customerPriceMode: true, clientRates: { day_wage_8h: '380000' } });
    expect(s.priceBook.mode).toBe('singleDayRate');
    expect(s.priceBook.singleDayRate).toBe(380_000);
  });

  it('có gõ cột "Khách trả ta" → manual, giữ đủ từng dòng', () => {
    const s = migrate({
      ...DRAFT_AT14,
      clientRates: { day_wage_8h: '380000', ot_day_weekday: '70000' },
    });
    expect(s.priceBook.mode).toBe('manual');
    expect(s.priceBook.manual.day_wage_8h).toBe(380_000);
    expect(s.priceBook.manual.ot_day_weekday).toBe(70_000);
  });

  it('không khai gì → sinh từ phí dịch vụ, doanh thu KHÔNG tụt về 0', () => {
    const s = migrate(DRAFT_AT14);
    const pnl = computePnL(s.us.basis, s.volume, s.priceBook, s.us.allowances, s.overhead, s.serviceFee);
    expect(pnl.revenueMonth).toBeGreaterThan(0);
  });

  it('doanh thu là GIÁ KHÁCH thì KHÔNG bị vách phí giới thiệu cắt oan', () => {
    // Cùng một nháp v1, chỉ khác chỗ bật "nhập thẳng giá khách trả".
    const s = migrate({
      ...DRAFT_AT14, customerPriceMode: true, clientRates: { day_wage_8h: '450000' },
      serviceFeeType: 'referral_hourly', referralDurationMode: 'recurring_months', referralMonths: 6,
    });
    expect(s.serviceFee.type).toBe('per_day_worked');
    const pnl = computePnL(s.us.basis, s.volume, s.priceBook, s.us.allowances, s.overhead, s.serviceFee);
    // Tháng 7 vẫn phải có doanh thu — hợp đồng cung ứng thường xuyên không hết hạn.
    expect(pnl.timeline[6].revenue).toBeGreaterThan(0);
    expect(pnl.timeline.every(m => m.revenue > 0)).toBe(true);
  });

  it('có gõ cột "Khách trả ta" cũng vậy — doanh thu không hết hạn', () => {
    const s = migrate({
      ...DRAFT_AT14, clientRates: { day_wage_8h: '450000' },
      serviceFeeType: 'referral_daily_limited', referralMonths: 3,
    });
    expect(s.serviceFee.type).toBe('per_day_worked');
    const pnl = computePnL(s.us.basis, s.volume, s.priceBook, s.us.allowances, s.overhead, s.serviceFee);
    expect(pnl.timeline.every(m => m.revenue > 0)).toBe(true);
  });

  it('giữ nguyên serviceFee để còn biết mốc hết hạn (BUG-4)', () => {
    const s = migrate(DRAFT_AT14);
    expect(s.serviceFee.type).toBe('referral_hourly');
    expect(s.serviceFee.months).toBe(6);
    expect(s.serviceFee.durationMode).toBe('recurring_months');
    const pnl = computePnL(s.us.basis, s.volume, s.priceBook, s.us.allowances, s.overhead, s.serviceFee);
    expect(pnl.timeline[6].revenue).toBe(0);
  });
});

describe('AT-18 — không mất dữ liệu, không ném lỗi', () => {
  it('nháp rỗng / null / undefined đều không throw', () => {
    for (const raw of [null, undefined, {}, 'rác', 42, []]) {
      expect(() => migrate(raw)).not.toThrow();
      expect(migrate(raw).version).toBe(2);
    }
  });

  it('giữ tên công ty, KCN, NCC, ghi chú liên hệ', () => {
    const s = migrate({
      ...DRAFT_AT14, companyName: 'X', kcnName: 'Y', supplierName: 'Đối thủ Z', contactNote: 'Chị Hoa',
    });
    expect(s.customerName).toBe('X');
    expect(s.industrialZone).toBe('Y');
    expect(s.us.supplierName).toBe('Đối thủ Z');
    expect(s.us.isUs).toBe(false);
    expect(s.us.contactNote).toBe('Chị Hoa');
  });

  it('giữ phụ cấp 2 mặt, không gộp mất một mặt', () => {
    const s = migrate({
      ...DRAFT_AT14,
      allowances: [{ id: 'a1', label: 'Ăn ca', amountClient: '600000', amountWorker: '500000' }],
    });
    expect(s.us.allowances).toHaveLength(1);
    expect(s.us.allowances[0]).toMatchObject({ name: 'Ăn ca', customerPays: 600_000, weOweWorker: 500_000 });
  });

  it('giữ đơn giá sửa tay (override) và ưu tiên nó khi suy SHR', () => {
    const s = migrate({ ...DRAFT_AT14, rawOverrides: { day_wage_8h: '350000' } });
    expect(s.us.basis.overrides.day_wage_8h).toBe(350_000);
    money(s.us.basis.shrPay, 350_000 / 8);
    expect(rowOf(buildWageTable(s.us.basis), 'day_wage_8h').fullPrice).toBe(350_000);
  });

  it('lương cơ bản sửa tay thắng lương ngày sửa tay (đúng thứ tự ưu tiên cũ)', () => {
    const s = migrate({
      ...DRAFT_AT14, rawOverrides: { base_salary: '10400000', day_wage_8h: '350000' },
    });
    money(s.us.basis.shrPay, 10_400_000 / 208);
  });

  it('vùng lương rác → về mặc định II, không throw', () => {
    expect(migrate({ ...DRAFT_AT14, region: 'ZZ' }).us.basis.region).toBe('II');
  });

  it('ngày công 0 hoặc âm → tối thiểu 1, không chia cho 0', () => {
    for (const wd of [0, -5]) {
      const s = migrateV1toV2({ ...DRAFT_AT14, workingDaysPerMonth: wd });
      expect(s.us.basis.workdaysPerMonth).toBeGreaterThanOrEqual(1);
      expect(Number.isFinite(s.us.basis.shrPay)).toBe(true);
    }
  });

  it('giữ priorDayOt (mốc OT đêm ngày thường 210%)', () => {
    const s = migrate({ ...DRAFT_AT14, inputType: 'ot_night_weekday', inputValue: '87150', priorDayOt: true });
    expect(s.us.basis.priorDayOt).toBe(true);
    money(s.us.basis.shrPay, 87_150 / 2.1);
  });
});
