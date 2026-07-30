// Acceptance Tests SPEC §9 — phần L1–L4. Sai số cho phép: tiền ±1đ, tỷ lệ ±0,01%.
import { describe, it, expect } from 'vitest';
import {
  buildWageTable, rowOf, deriveShr, amountForShr, convertAmountBetweenCodes,
  equivalentHours, actualHours, directWage, computeInsurance, computeRevenue,
  computePnL, priceBookFromServiceFee, checkSalaryCompliance, feeDurationMonths,
} from '../salaryEngine';
import { WAGE_ROWS, hoursPerUnit } from '../wageRows';
import { resolveMinWage, isMinWageStale } from '../minWage';
import { VOLUME_PRESETS, applyPreset } from '../volumePresets';
import type { WageCode } from '../types';
import {
  SHR, WD, AT_DATE, basis, vol, overhead,
  VOL_DAY_ONLY, VOL_DAY_PLUS_OT, VOL_SHIFT12,
  FEE_UNLIMITED, FEE_REFERRAL_6M, pbSingleDay, pbManual, pbMarkupPercent,
} from './fixtures';

/** ±1đ theo §9. */
const money = (actual: number, expected: number) => expect(Math.abs(actual - expected)).toBeLessThanOrEqual(1);
/** ±0,01% theo §9. */
const rate = (actual: number, expected: number) => expect(Math.abs(actual - expected)).toBeLessThanOrEqual(0.01);

// ── AT-1 ──────────────────────────────────────────────────────────────────────────────────
describe('AT-1 — Round-trip 14 dòng', () => {
  // Bảng chốt cứng từ §9. KHÔNG tính lại bằng công thức trong test — nếu test tự suy ra số thì nó
  // chỉ đang kiểm tra chính nó, chứ không kiểm tra engine có khớp SPEC.
  const EXPECTED: [WageCode, number, number][] = [
    ['base_salary', 41_500, 8_632_000],
    ['day_wage_8h', 41_500, 332_000],
    ['night_wage_8h', 53_950, 431_600],
    ['sunday_day_wage_8h', 83_000, 664_000],
    ['sunday_night_wage_8h', 112_050, 896_400],
    ['holiday_wage_8h', 124_500, 996_000],
    ['ot_day_weekday', 62_250, 62_250],
    ['ot_night_weekday', 83_000, 83_000],
    ['ot_day_sunday', 83_000, 83_000],
    ['ot_night_sunday', 112_050, 112_050],
    ['ot_day_holiday', 124_500, 124_500],
    ['ot_night_holiday', 161_850, 161_850],
    ['shift12_day', 48_417, 581_000],
    ['shift12_night', 63_633, 763_600],
  ];

  const table = buildWageTable(basis());

  it('phủ đúng 14 dòng, không thiếu không thừa', () => {
    expect(table).toHaveLength(14);
    expect(table.map(r => r.code).sort()).toEqual(EXPECTED.map(([c]) => c).sort());
  });

  for (const [code, unitPrice, fullPrice] of EXPECTED) {
    it(`${code}: ${unitPrice}đ/giờ · ${fullPrice}đ/đơn vị`, () => {
      const row = rowOf(table, code);
      // unitPrice trong SPEC làm tròn tới đồng (48.417 / 63.633) nên so ở mức ±1đ.
      money(row.nominalHourly, unitPrice);
      money(row.fullPrice, fullPrice);
    });

    it(`${code}: feed fullPrice ngược lại ra đúng SHR 41.500`, () => {
      money(deriveShr(code, fullPrice, WD), SHR);
    });
  }
});

// ── AT-2 ──────────────────────────────────────────────────────────────────────────────────
describe('AT-2 — Bảo hiểm', () => {
  it('linked: nền 8.632.000, NLĐ 906.360, NSDLĐ 1.855.880, KPCĐ 172.640', () => {
    const ins = computeInsurance(basis(), [], overhead());
    money(ins.bhxhBase, 8_632_000);
    money(ins.workerInsurance, 906_360);
    money(ins.employerInsurance, 1_855_880);
    money(ins.unionFee, 172_640);
  });

  it('netToWorker (volume ca ngày) = 7.725.640', () => {
    const pnl = computePnL(basis(), VOL_DAY_ONLY, pbSingleDay(380_000), [], overhead(), FEE_UNLIMITED);
    money(pnl.netToWorker, 7_725_640);
  });

  it('custom 23.800: nền 4.950.400, NSDLĐ 1.064.336 — bảng lương trả thực KHÔNG đổi', () => {
    const b = basis({ shrBhxhMode: 'custom', shrBhxhCustom: 23_800 });
    const ins = computeInsurance(b, [], overhead());
    money(ins.bhxhBase, 4_950_400);
    money(ins.employerInsurance, 1_064_336);
    expect(buildWageTable(b).map(r => r.fullPrice)).toEqual(buildWageTable(basis()).map(r => r.fullPrice));
  });
});

// ── AT-3 / AT-4 ───────────────────────────────────────────────────────────────────────────
describe('AT-3 — EH preset "Ca 8h + 2h OT"', () => {
  const table = buildWageTable(basis());

  it('EH = 302', () => money(equivalentHours(table, VOL_DAY_PLUS_OT), 302));

  it('DirectWage = 12.533.000, khớp cả 2 cách tính', () => {
    money(directWage(table, VOL_DAY_PLUS_OT), 12_533_000);
    money(26 * 332_000 + 52 * 62_250 + 8 * 83_000, 12_533_000);
  });

  it('preset trong volumePresets.ts sinh ra đúng sản lượng này', () => {
    expect(applyPreset('day_plus_2h_ot', WD).quantities)
      .toEqual({ day_wage_8h: 26, ot_day_weekday: 52, ot_day_sunday: 8 });
  });
});

describe('AT-4 — EH preset "Ca 12h luân phiên 4/4"', () => {
  const table = buildWageTable(basis());

  it('EH = 421,2', () => money(equivalentHours(table, VOL_SHIFT12), 421.2));

  it('DirectWage = 17.479.800, khớp cả 2 cách tính', () => {
    money(directWage(table, VOL_SHIFT12), 17_479_800);
    money(13 * 581_000 + 13 * 763_600, 17_479_800);
  });

  it('giờ THỰC (312h) khác giờ quy đổi (421,2h)', () => {
    money(actualHours(table, VOL_SHIFT12), 312);
  });

  it('4 preset §5.1 đều có mặt', () => {
    expect(VOLUME_PRESETS.map(p => p.id))
      .toEqual(['office_no_ot', 'day_plus_2h_ot', 'night_plus_2h_ot', 'shift12_rotating']);
  });
});

// ── AT-5 ──────────────────────────────────────────────────────────────────────────────────
describe('AT-5 — Tái tạo con số lỗ của bản cũ', () => {
  const pb = pbSingleDay(380_000);

  it('KPCĐ 0%: Revenue 9.880.000, DirectCost 10.487.880, NetProfit −607.880, biên −6,2%', () => {
    const pnl = computePnL(basis(), VOL_DAY_ONLY, pb, [], overhead({ unionFeePercent: 0 }), FEE_UNLIMITED);
    money(pnl.revenueMonth, 9_880_000);
    money(pnl.directCostMonth, 10_487_880);
    money(pnl.netProfitMonth, -607_880);
    money(pnl.netProfitMonth / WD, -23_380);
    rate(pnl.netMarginMonthPercent, -6.15);
  });

  it('KPCĐ 2%: NetProfit −780.520', () => {
    const pnl = computePnL(basis(), VOL_DAY_ONLY, pb, [], overhead({ unionFeePercent: 2 }), FEE_UNLIMITED);
    money(pnl.netProfitMonth, -780_520);
  });
});

// ── AT-6 ──────────────────────────────────────────────────────────────────────────────────
describe('AT-6 — Markup 35%', () => {
  it('giá khách 448.200, Revenue 11.653.200, NetProfit 992.680, biên 8,52%', () => {
    const pb = pbMarkupPercent(35);
    const table = buildWageTable(basis());
    const rev = computeRevenue(table, VOL_DAY_ONLY, pb, []);
    money(rev.rows.find(r => r.code === 'day_wage_8h')!.customerUnitPrice!, 448_200);
    money(rev.revenueMonth, 11_653_200);

    const pnl = computePnL(basis(), VOL_DAY_ONLY, pb, [], overhead({ unionFeePercent: 2 }), FEE_UNLIMITED);
    money(pnl.directCostMonth, 10_660_520);
    money(pnl.netProfitMonth, 992_680);
    rate(pnl.netMarginMonthPercent, 8.52);
  });
});

// ── AT-9 ──────────────────────────────────────────────────────────────────────────────────
describe('AT-9 — Toggle lương ngày lễ (BUG-8)', () => {
  it('bật → fullPrice(holiday) = 1.328.000', () => {
    const row = rowOf(buildWageTable(basis({ includeHolidayBasePay: true })), 'holiday_wage_8h');
    money(row.fullPrice, 1_328_000);
    rate(row.effectiveCoefficient, 4);
  });

  it('feed 1.328.000 ngược lại với cùng toggle → SHR vẫn 41.500', () => {
    money(deriveShr('holiday_wage_8h', 1_328_000, WD, { includeHolidayBasePay: true }), SHR);
  });

  it('toggle OFF/ON không làm SHR trôi', () => {
    for (const on of [false, true]) {
      const amount = amountForShr('holiday_wage_8h', SHR, WD, { includeHolidayBasePay: on });
      money(deriveShr('holiday_wage_8h', amount, WD, { includeHolidayBasePay: on }), SHR);
    }
  });

  it('không áp phụ trội cho giờ OT lễ', () => {
    const t = buildWageTable(basis({ includeHolidayBasePay: true }));
    money(rowOf(t, 'ot_day_holiday').fullPrice, 124_500);
    money(rowOf(t, 'ot_night_holiday').fullPrice, 161_850);
  });
});

// ── AT-10 ─────────────────────────────────────────────────────────────────────────────────
describe('AT-10 — Cliff phí giới thiệu (BUG-4)', () => {
  const pnl = computePnL(basis(), VOL_DAY_ONLY, pbSingleDay(380_000), [],
    overhead({ horizonMonths: 12 }), FEE_REFERRAL_6M);

  it('mốc tắt doanh thu = 6 tháng', () => expect(feeDurationMonths(FEE_REFERRAL_6M)).toBe(6));

  it('12 dòng timeline; tháng 1–6 có doanh thu, tháng 7–12 bằng 0', () => {
    expect(pnl.timeline).toHaveLength(12);
    for (const m of pnl.timeline.slice(0, 6)) expect(m.revenue).toBeGreaterThan(0);
    for (const m of pnl.timeline.slice(6)) expect(m.revenue).toBe(0);
  });

  it('tháng 7+ lỗ đúng bằng toàn bộ chi phí tháng, chi phí KHÔNG giảm', () => {
    money(pnl.timeline[6].profit, -pnl.totalCostMonth);
    money(pnl.timeline[6].cost, pnl.timeline[5].cost);
  });

  it('Revenue_total = Revenue_month × 6 và tổng kỳ bị lỗ', () => {
    money(pnl.revenueTotal, pnl.revenueMonth * 6);
    expect(pnl.netProfit).toBeLessThan(0);
  });

  it('phí lâu dài thì KHÔNG có vách', () => {
    const p = computePnL(basis(), VOL_DAY_ONLY, pbSingleDay(380_000), [], overhead(), FEE_UNLIMITED);
    expect(p.timeline.every(m => m.revenue > 0)).toBe(true);
  });
});

// ── AT-11 ─────────────────────────────────────────────────────────────────────────────────
describe('AT-11 — Chống hồi quy BUG-1 (test quan trọng nhất)', () => {
  const run = (dayRate: number) =>
    computePnL(basis(), VOL_DAY_ONLY, pbManual({ day_wage_8h: dayRate }), [], overhead(), FEE_UNLIMITED);

  it('sửa giá khách 1 dòng → doanh thu ĐỔI, và đổi đúng lượng', () => {
    const a = run(380_000).revenueMonth;
    const b = run(500_000).revenueMonth;
    expect(b).toBeGreaterThan(a);
    money(b - a, 120_000 * WD);
  });

  it('giá khách ở dòng OT cũng vào doanh thu (lỗi cũ: bị bỏ qua hoàn toàn)', () => {
    const table = buildWageTable(basis());
    const base = computeRevenue(table, VOL_DAY_PLUS_OT, pbManual({ day_wage_8h: 380_000 }), []);
    const withOt = computeRevenue(table, VOL_DAY_PLUS_OT,
      pbManual({ day_wage_8h: 380_000, ot_day_weekday: 70_000 }), []);
    money(withOt.revenueMonth - base.revenueMonth, 52 * 70_000);
  });

  it('dòng có sản lượng mà chưa khai giá thì bị nêu tên, không âm thầm tính 0', () => {
    const table = buildWageTable(basis());
    const r = computeRevenue(table, VOL_DAY_PLUS_OT, pbManual({ day_wage_8h: 380_000 }), []);
    expect(r.unpricedCodes).toEqual(['ot_day_weekday', 'ot_day_sunday']);
  });

  it('PnL và Invoice đọc CÙNG một revenueMonth (không có 2 đường doanh thu)', () => {
    const pnl = run(380_000);
    const table = buildWageTable(basis());
    const rev = computeRevenue(table, VOL_DAY_ONLY, pbManual({ day_wage_8h: 380_000 }), []);
    expect(pnl.revenueMonth).toBe(rev.revenueMonth);
    money(pnl.timeline[0].revenue, rev.revenueMonth);
  });

  it('serviceFee KHÔNG còn ảnh hưởng doanh thu — chỉ sinh price book', () => {
    const pb = pbManual({ day_wage_8h: 380_000 });
    const cheap = computePnL(basis(), VOL_DAY_ONLY, pb, [], overhead(),
      { ...FEE_UNLIMITED, value: 0 });
    const pricey = computePnL(basis(), VOL_DAY_ONLY, pb, [], overhead(),
      { ...FEE_UNLIMITED, value: 999_000 });
    expect(cheap.revenueMonth).toBe(pricey.revenueMonth);
  });
});

// ── AT-12 ─────────────────────────────────────────────────────────────────────────────────
describe('AT-12 — Dropdown sạch (BUG-6)', () => {
  it('đúng 14 dòng', () => expect(WAGE_ROWS).toHaveLength(14));

  it('không mã nào bắt đầu bằng "field:"', () => {
    expect(WAGE_ROWS.filter(r => r.code.startsWith('field:'))).toHaveLength(0);
  });

  it('không hai dòng nào trùng cả hệ số + đơn vị + nhãn', () => {
    const keys = WAGE_ROWS.map(r => `${r.coefficient}|${r.unit}|${r.label}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('mã là duy nhất', () => {
    expect(new Set(WAGE_ROWS.map(r => r.code)).size).toBe(14);
  });
});

// ── AT-13 ─────────────────────────────────────────────────────────────────────────────────
describe('AT-13 — Đổi loại đơn giá không mất số (BUG-7)', () => {
  it('332.000 (ca ngày) → ca đêm = 431.600, SHR giữ 41.500', () => {
    const v = convertAmountBetweenCodes(332_000, 'day_wage_8h', 'night_wage_8h', WD);
    money(v, 431_600);
    money(deriveShr('night_wage_8h', v, WD), SHR);
  });

  it('tiếp tục → OT đêm lễ = 161.850, SHR vẫn 41.500', () => {
    const v = convertAmountBetweenCodes(431_600, 'night_wage_8h', 'ot_night_holiday', WD);
    money(v, 161_850);
    money(deriveShr('ot_night_holiday', v, WD), SHR);
  });

  it('đổi qua cả 14 dòng rồi quay về không làm SHR trôi', () => {
    let amount = 332_000;
    let from: WageCode = 'day_wage_8h';
    for (const r of WAGE_ROWS) {
      amount = convertAmountBetweenCodes(amount, from, r.code, WD);
      from = r.code;
    }
    amount = convertAmountBetweenCodes(amount, from, 'day_wage_8h', WD);
    money(amount, 332_000);
  });
});

// ── AT-14 ─────────────────────────────────────────────────────────────────────────────────
describe('AT-14 — Bất biến sau refactor (snapshot bản cũ)', () => {
  // Phí giới thiệu 10.000đ/giờ, VAT 8%, 6 tháng, Vùng I, 26 ngày, day_wage_8h = 332.000.
  // Bản cũ lập invoice kiểu COST-PLUS: khách trả = chi phí lao động + phí dịch vụ.
  const b = basis();
  const oh = overhead({ unionFeePercent: 0 });
  const generated = priceBookFromServiceFee(b, VOL_DAY_ONLY, [], oh, FEE_REFERRAL_6M);
  const pb = { mode: 'manual' as const, manual: generated, vatPercent: 8 };
  const pnl = computePnL(b, VOL_DAY_ONLY, pb, [], oh, FEE_REFERRAL_6M);

  it('SHR = 41.500đ/giờ', () => money(b.shrPay, SHR));
  it('Tổng chi phí lao động = 10.487.880', () => money(pnl.directCostMonth, 10_487_880));
  it('Phí dịch vụ = 2.080.000 (10.000 × 208 EH)', () => {
    money(pnl.revenueMonth - pnl.directCostMonth, 2_080_000);
    money(10_000 * 208, 2_080_000);
  });
  it('≈ 80.000 đ/ngày công phí dịch vụ', () => money((pnl.revenueMonth - pnl.directCostMonth) / WD, 80_000));
  it('Tổng trước VAT = 12.567.880', () => money(pnl.revenueMonth, 12_567_880));
  it('VAT 8% = 1.005.430', () => money(pnl.revenueMonth * 0.08, 1_005_430.4));
  it('Tổng Invoice = 13.573.310', () => money(pnl.revenueMonth * 1.08, 13_573_310.4));
});

// ── AT-15 ─────────────────────────────────────────────────────────────────────────────────
describe('AT-15 — Tách nền BHXH không ảnh hưởng lương (BUG-5)', () => {
  const oh = overhead({ unionFeePercent: 2 });
  const pb = pbSingleDay(380_000);
  const linked = basis({ shrBhxhMode: 'custom', shrBhxhCustom: 41_500 });
  const lowered = basis({ shrBhxhMode: 'custom', shrBhxhCustom: 23_800 });

  it('14 dòng fullPrice KHÔNG đổi', () => {
    expect(buildWageTable(lowered).map(r => r.fullPrice))
      .toEqual(buildWageTable(linked).map(r => r.fullPrice));
  });

  it('employerInsurance giảm', () => {
    expect(computeInsurance(lowered, [], oh).employerInsurance)
      .toBeLessThan(computeInsurance(linked, [], oh).employerInsurance);
  });

  it('NetProfit tăng đúng bằng phần BHXH + KPCĐ tiết kiệm được', () => {
    const a = computePnL(linked, VOL_DAY_ONLY, pb, [], oh, FEE_UNLIMITED);
    const b = computePnL(lowered, VOL_DAY_ONLY, pb, [], oh, FEE_UNLIMITED);
    const ia = computeInsurance(linked, [], oh);
    const ib = computeInsurance(lowered, [], oh);
    const saved = (ia.employerInsurance + ia.unionFee) - (ib.employerInsurance + ib.unionFee);
    money(b.netProfitMonth - a.netProfitMonth, saved);
  });
});

// ── AT-8 ──────────────────────────────────────────────────────────────────────────────────
describe('AT-8 — Sàn lương tối thiểu vùng (BUG-9)', () => {
  const pb = pbSingleDay(380_000);
  const below = (shrPay: number) => {
    const b = basis({ region: 'IV', shrPay });
    const pnl = computePnL(b, VOL_DAY_ONLY, pb, [], overhead(), FEE_UNLIMITED);
    return checkSalaryCompliance(b, pnl, AT_DATE).some(x => x.level === 'red' && x.blocksSave);
  };

  it('Vùng IV, SHR 16.000 → dưới sàn, CHẶN lưu', () => expect(below(16_000)).toBe(true));
  it('Vùng IV, SHR 17.000 → không dưới sàn giờ', () => {
    // Sàn giờ Vùng IV theo batch đã xác thực (NĐ 74/2024) là 16.600đ.
    expect(resolveMinWage('IV', AT_DATE)!.hourly).toBe(16_600);
    expect(below(17_000)).toBe(false);
  });

  it('mốc hiệu lực: 30/6/2024 KHÔNG được lấy rule hiệu lực 01/7/2024', () => {
    expect(resolveMinWage('I', '2024-06-30')).toBeNull();
    expect(resolveMinWage('I', '2024-07-01')!.effectiveFrom).toBe('2024-07-01');
  });

  it('không tra được mốc → cảnh báo amber, KHÔNG chặn lưu và KHÔNG bịa mức', () => {
    const b = basis({ shrPay: 1_000 });
    const pnl = computePnL(b, VOL_DAY_ONLY, pb, [], overhead(), FEE_UNLIMITED);
    const banners = checkSalaryCompliance(b, pnl, '2020-01-01');
    expect(banners.some(x => x.level === 'amber' && !x.blocksSave)).toBe(true);
    expect(banners.some(x => x.blocksSave)).toBe(false);
  });

  it('dữ liệu lương tối thiểu quá 12 tháng → có cảnh báo lỗi thời', () => {
    expect(isMinWageStale('2025-06-30')).toBe(false);   // 11 tháng
    expect(isMinWageStale('2026-07-30')).toBe(true);    // > 12 tháng
    const b = basis();
    const pnl = computePnL(b, VOL_DAY_ONLY, pb, [], overhead(), FEE_UNLIMITED);
    expect(checkSalaryCompliance(b, pnl, '2026-07-30')
      .some(x => x.message.includes('có thể đã lỗi thời'))).toBe(true);
  });

  it('DB thắng hardcode khi cùng mốc hiệu lực', () => {
    const dbBatches = [{
      effectiveFrom: '2024-07-01', decree: 'DB',
      wages: { I: { monthly: 9_000_000, hourly: null }, II: null, III: null, IV: null },
    }];
    const r = resolveMinWage('I', AT_DATE, dbBatches)!;
    expect(r.monthly).toBe(9_000_000);
    expect(r.hourly).toBe(23_800);   // kế thừa mức giờ của seed cùng ngày
  });
});

// ── Bất biến chung ────────────────────────────────────────────────────────────────────────
describe('Bất biến engine', () => {
  it('DirectWage = shrPay × EH khi không override', () => {
    const table = buildWageTable(basis());
    for (const v of [VOL_DAY_ONLY, VOL_DAY_PLUS_OT, VOL_SHIFT12]) {
      money(directWage(table, v), SHR * equivalentHours(table, v));
    }
  });

  it('base_salary không lọt vào sản lượng (tránh tính 2 lần)', () => {
    expect(equivalentHours(buildWageTable(basis()), vol({ base_salary: 5 }))).toBe(0);
  });

  it('override dùng thẳng, không kéo theo dòng khác', () => {
    const t = buildWageTable(basis({ overrides: { day_wage_8h: 350_000 } }));
    expect(rowOf(t, 'day_wage_8h').fullPrice).toBe(350_000);
    money(rowOf(t, 'night_wage_8h').fullPrice, 431_600);
  });

  it('giá sàn tính trên 1 đầu người, không nhân headcount', () => {
    const pb = pbSingleDay(380_000);
    const one = computePnL(basis(), VOL_DAY_ONLY, pb, [], overhead(), FEE_UNLIMITED);
    const ten = computePnL(basis(), VOL_DAY_ONLY, pb, [], overhead({ headcount: 10 }), FEE_UNLIMITED);
    money(ten.totalCostMonth, one.totalCostMonth * 10);
    money(ten.breakEvenPerWorkday, one.breakEvenPerWorkday);
    rate(ten.netMarginPercent, one.netMarginPercent);
  });

  it('hoursPerUnit khớp đơn vị của SPEC', () => {
    expect(hoursPerUnit('base_salary', WD)).toBe(208);
    expect(hoursPerUnit('day_wage_8h', WD)).toBe(8);
    expect(hoursPerUnit('shift12_day', WD)).toBe(12);
    expect(hoursPerUnit('ot_day_weekday', WD)).toBe(1);
  });
});
