// Acceptance Tests SPEC §9 — phần L5 (AT-7, AT-16, AT-17).
import { describe, it, expect } from 'vitest';
import { maxAffordableShr, computeCompetitive, indirectCostOf } from '../competitiveEngine';
import { computePnL, computeRevenue, buildWageTable, equivalentHours } from '../salaryEngine';
import {
  SHR, WD, AT_DATE, basis, overhead, VOL_DAY_ONLY, VOL_DAY_PLUS_OT,
  FEE_UNLIMITED, pbSingleDay, rival,
} from './fixtures';

const money = (actual: number, expected: number) => expect(Math.abs(actual - expected)).toBeLessThanOrEqual(1);
const rate = (actual: number, expected: number) => expect(Math.abs(actual - expected)).toBeLessThanOrEqual(0.01);

// singleDayRate 448.200 × 26 ca = 11.653.200 — đúng Revenue_month mà AT-7 yêu cầu.
// Chọn chế độ này (không dùng markupPercent) vì giá khách phải ĐỘC LẬP với shrPay, nếu không phép
// nhân ngược sẽ vòng tròn: tăng lương → tăng giá khách → tăng ngân sách lương → không hội tụ.
const PB_AT7 = pbSingleDay(448_200);
const OH_AT7 = overhead({ unionFeePercent: 2, targetNetMarginPercent: 0 });

describe('AT-7 — Nhân ngược ra SHR tối đa (test quan trọng nhất)', () => {
  it('Revenue_month = 11.653.200 và độc lập với shrPay', () => {
    const at41500 = computeRevenue(buildWageTable(basis()), VOL_DAY_ONLY, PB_AT7, []).revenueMonth;
    const at60000 = computeRevenue(buildWageTable(basis({ shrPay: 60_000 })), VOL_DAY_ONLY, PB_AT7, []).revenueMonth;
    money(at41500, 11_653_200);
    money(at60000, 11_653_200);
  });

  it('biên mục tiêu 0% → shrPay_max = 11.653.200 / 256,88', () => {
    const { shrPayMax } = maxAffordableShr(basis(), VOL_DAY_ONLY, PB_AT7, [], OH_AT7);
    money(shrPayMax, 11_653_200 / (208 + 0.235 * 8 * WD));
    // SPEC ghi ≈45.365,6; số học chính xác là 45.364,4 (chênh ~1,2đ do SPEC làm tròn trung gian).
    expect(Math.abs(shrPayMax - 45_365.6)).toBeLessThanOrEqual(2);
  });

  it('ROUND-TRIP: trả đúng shrPay_max → NetProfit ≈ 0 (≤ 0,01% doanh thu)', () => {
    const { shrPayMax } = maxAffordableShr(basis(), VOL_DAY_ONLY, PB_AT7, [], OH_AT7);
    const pnl = computePnL(basis({ shrPay: shrPayMax }), VOL_DAY_ONLY, PB_AT7, [], OH_AT7, FEE_UNLIMITED);
    expect(Math.abs(pnl.netProfitMonth)).toBeLessThanOrEqual(0.0001 * pnl.revenueMonth);
  });

  it('biên mục tiêu 8% → shrPay_max GIẢM, round-trip cho đúng biên 8%', () => {
    const oh8 = overhead({ unionFeePercent: 2, targetNetMarginPercent: 8 });
    const max0 = maxAffordableShr(basis(), VOL_DAY_ONLY, PB_AT7, [], OH_AT7).shrPayMax;
    const max8 = maxAffordableShr(basis(), VOL_DAY_ONLY, PB_AT7, [], oh8).shrPayMax;
    expect(max8).toBeLessThan(max0);
    const pnl = computePnL(basis({ shrPay: max8 }), VOL_DAY_ONLY, PB_AT7, [], oh8, FEE_UNLIMITED);
    rate(pnl.netMarginMonthPercent, 8);
  });

  it('nền BHXH cố định 23.800 → shrPay_max ≈ 50.432, cao hơn chế độ linked', () => {
    const b = basis({ shrBhxhMode: 'custom', shrBhxhCustom: 23_800 });
    const custom = maxAffordableShr(b, VOL_DAY_ONLY, PB_AT7, [], OH_AT7).shrPayMax;
    const linked = maxAffordableShr(basis(), VOL_DAY_ONLY, PB_AT7, [], OH_AT7).shrPayMax;
    money(custom, (11_653_200 - 1_064_336 - 99_008) / 208);
    expect(Math.abs(custom - 50_433)).toBeLessThanOrEqual(2);   // SPEC ≈50.433
    expect(custom).toBeGreaterThan(linked);
  });

  it('round-trip đúng cả ở chế độ nền BHXH cố định', () => {
    const b = basis({ shrBhxhMode: 'custom', shrBhxhCustom: 23_800 });
    const { shrPayMax } = maxAffordableShr(b, VOL_DAY_ONLY, PB_AT7, [], OH_AT7);
    const pnl = computePnL({ ...b, shrPay: shrPayMax }, VOL_DAY_ONLY, PB_AT7, [], OH_AT7, FEE_UNLIMITED);
    expect(Math.abs(pnl.netProfitMonth)).toBeLessThanOrEqual(0.0001 * pnl.revenueMonth);
  });

  it('round-trip vẫn đúng khi có chi phí gián tiếp và phụ cấp 2 mặt', () => {
    const oh = overhead({
      unionFeePercent: 2, targetNetMarginPercent: 12,
      opsCostPerHeadMonth: 400_000, recruitCostPerHire: 2_000_000, monthlyTurnoverPercent: 10,
    });
    const allow = [{ id: '1', name: 'Ăn ca', customerPays: 600_000, weOweWorker: 500_000, taxable: false }];
    money(indirectCostOf(oh), 600_000);
    const { shrPayMax } = maxAffordableShr(basis(), VOL_DAY_ONLY, PB_AT7, allow, oh);
    const pnl = computePnL(basis({ shrPay: shrPayMax }), VOL_DAY_ONLY, PB_AT7, allow, oh, FEE_UNLIMITED);
    rate(pnl.netMarginMonthPercent, 12);
  });
});

describe('AT-16 — So sánh đối thủ trên CÙNG volume profile', () => {
  const rivals = [rival('a', 41_500), rival('b', 43_000), rival('c', 45_000)];
  const r = computeCompetitive(basis(), VOL_DAY_PLUS_OT, pbSingleDay(448_200), [],
    overhead({ unionFeePercent: 2 }), rivals, 2, AT_DATE);

  it('EH của volume dùng chung = 302', () => {
    money(equivalentHours(buildWageTable(basis()), VOL_DAY_PLUS_OT), 302);
  });

  it('gói NLĐ nhận = 12.533.000 / 12.986.000 / 13.590.000', () => {
    const byId = Object.fromEntries(r.competitors.map(c => [c.id, c.packageForWorker]));
    money(byId.a, 12_533_000);
    money(byId.b, 12_986_000);
    money(byId.c, 13_590_000);
  });

  it('đối thủ mạnh nhất 45.000 → đề xuất 45.900 (vượt 2%)', () => {
    expect(r.strongest!.id).toBe('c');
    money(r.shrCompetitorMax, 45_000);
    money(r.shrProposed, 45_900);
  });

  it('đổi volume profile → CẢ BA gói đổi theo cùng tỷ lệ (chứng minh dùng chung profile)', () => {
    const r2 = computeCompetitive(basis(), VOL_DAY_ONLY, pbSingleDay(448_200), [],
      overhead({ unionFeePercent: 2 }), rivals, 2, AT_DATE);
    const ratios = r.competitors.map((c, i) => c.packageForWorker / r2.competitors[i].packageForWorker);
    for (const x of ratios) rate(x, 302 / 208);
  });

  it('bảng "Biên ngầm của đối thủ" sắp xếp giảm dần, ai trả thấp thì còn nhiều room hơn', () => {
    const m = r.impliedMarginTable.map(c => c.impliedMargin);
    expect(m).toEqual([...m].sort((x, y) => y - x));
    expect(r.impliedMarginTable[0].id).toBe('a');   // trả thấp nhất → biên ngầm cao nhất
  });

  it('mỗi đối thủ giữ được bảng 14 dòng riêng (BUG-10)', () => {
    for (const c of r.competitors) expect(c.table).toHaveLength(14);
    money(r.competitors.find(c => c.id === 'c')!.table.find(x => x.code === 'day_wage_8h')!.fullPrice, 45_000 * 8);
  });
});

describe('AT-17 — Banner cảnh báo', () => {
  const rivals = [rival('a', 41_500), rival('b', 43_000), rival('c', 45_000)];
  // Giá khách thấp → không đủ tiền chào 45.900đ/giờ.
  const tight = computeCompetitive(basis(), VOL_DAY_PLUS_OT, pbSingleDay(400_000), [],
    overhead({ unionFeePercent: 2, targetNetMarginPercent: 8 }), rivals, 2, AT_DATE);

  it('FLAG_CANNOT_WIN bật, và gap tính đúng theo EH của volume đang dùng', () => {
    expect(tight.flagCannotWin).toBe(true);
    money(tight.gapPerHour, tight.shrProposed - tight.us.shrPayMax);
    money(tight.gapPerMonth, tight.gapPerHour * 302);
    expect(tight.gapPerHour).toBeGreaterThan(0);
  });

  it('in đủ 4 số X/Y/Z/W, không để placeholder', () => {
    const rem = tight.remedy!;
    expect(rem).not.toBeNull();
    for (const v of [rem.gapPerHour, rem.gapPerMonth, rem.targetMarginNeededPercent, rem.customerPricePerWorkdayNeeded]) {
      expect(Number.isFinite(v)).toBe(true);
    }
    // W phải CAO HƠN giá hiện tại, nếu không thì lời khuyên "đàm phán tăng giá" là vô nghĩa.
    expect(rem.customerPricePerWorkdayNeeded).toBeGreaterThan(400_000);
    // Z phải THẤP HƠN biên mục tiêu đang đặt.
    expect(rem.targetMarginNeededPercent).toBeLessThan(8);
  });

  it('W đúng: đàm phán tới giá đó thì FLAG_CANNOT_WIN tắt', () => {
    const w = tight.remedy!.customerPricePerWorkdayNeeded;
    const fixed = computeCompetitive(basis(), VOL_DAY_PLUS_OT, pbSingleDay(w), [],
      overhead({ unionFeePercent: 2, targetNetMarginPercent: 8 }), rivals, 2, AT_DATE);
    expect(fixed.flagCannotWin).toBe(false);
  });

  it('Z đúng: hạ biên mục tiêu xuống Z thì FLAG_CANNOT_WIN tắt', () => {
    const z = tight.remedy!.targetMarginNeededPercent;
    const fixed = computeCompetitive(basis(), VOL_DAY_PLUS_OT, pbSingleDay(400_000), [],
      overhead({ unionFeePercent: 2, targetNetMarginPercent: z }), rivals, 2, AT_DATE);
    expect(fixed.flagCannotWin).toBe(false);
  });

  it('Y₂ đúng: cắt đúng indirectCutNeeded thì FLAG_CANNOT_WIN tắt', () => {
    // Bắt đầu từ một scenario có chi phí gián tiếp để có chỗ mà cắt.
    const oh = overhead({ unionFeePercent: 2, targetNetMarginPercent: 8, opsCostPerHeadMonth: 3_000_000 });
    const before = computeCompetitive(basis(), VOL_DAY_PLUS_OT, pbSingleDay(448_200), [], oh, rivals, 2, AT_DATE);
    expect(before.flagCannotWin).toBe(true);
    const after = computeCompetitive(basis(), VOL_DAY_PLUS_OT, pbSingleDay(448_200), [],
      { ...oh, opsCostPerHeadMonth: 3_000_000 - before.remedy!.indirectCutNeeded }, rivals, 2, AT_DATE);
    expect(after.flagCannotWin).toBe(false);
  });

  it('Y₂ > Y₁ ở chế độ BHXH bám lương — cắt bằng Y₁ là KHÔNG đủ', () => {
    const oh = overhead({ unionFeePercent: 2, targetNetMarginPercent: 8, opsCostPerHeadMonth: 3_000_000 });
    const before = computeCompetitive(basis(), VOL_DAY_PLUS_OT, pbSingleDay(448_200), [], oh, rivals, 2, AT_DATE);
    const rem = before.remedy!;
    expect(rem.indirectCutNeeded).toBeGreaterThan(rem.gapPerMonth);
    const notEnough = computeCompetitive(basis(), VOL_DAY_PLUS_OT, pbSingleDay(448_200), [],
      { ...oh, opsCostPerHeadMonth: 3_000_000 - rem.gapPerMonth }, rivals, 2, AT_DATE);
    expect(notEnough.flagCannotWin).toBe(true);
  });

  it('W chính xác (không overshoot) — đặt đúng W thì gap về 0', () => {
    const w = tight.remedy!.customerPricePerWorkdayNeeded;
    const fixed = computeCompetitive(basis(), VOL_DAY_PLUS_OT, pbSingleDay(w), [],
      overhead({ unionFeePercent: 2, targetNetMarginPercent: 8 }), rivals, 2, AT_DATE);
    expect(Math.abs(fixed.gapPerHour)).toBeLessThanOrEqual(1);
  });

  it('biên mục tiêu 0 + giá khách cao → FLAG_CANNOT_WIN tắt', () => {
    const ok = computeCompetitive(basis(), VOL_DAY_PLUS_OT, pbSingleDay(600_000), [],
      overhead({ unionFeePercent: 2, targetNetMarginPercent: 0 }), rivals, 2, AT_DATE);
    expect(ok.flagCannotWin).toBe(false);
    expect(ok.remedy).toBeNull();
  });

  it('FLAG_BELOW_LEGAL khi giá khách không đủ trả nổi lương tối thiểu vùng', () => {
    const broke = computeCompetitive(basis({ region: 'I' }), VOL_DAY_PLUS_OT, pbSingleDay(60_000), [],
      overhead({ unionFeePercent: 2 }), rivals, 2, AT_DATE);
    expect(broke.flagBelowLegal).toBe(true);
    expect(broke.legalRule!.decree).toContain('74/2024');
  });

  it('banner xanh "room lớn" khi trả được cao hơn đối thủ >15%', () => {
    const rich = computeCompetitive(basis(), VOL_DAY_PLUS_OT, pbSingleDay(900_000), [],
      overhead({ unionFeePercent: 2, targetNetMarginPercent: 0 }), [rival('a', 30_000)], 2, AT_DATE);
    expect(rich.flagBigRoom).toBe(true);
    expect(rich.roomAbovePercent).toBeGreaterThan(15);
  });

  it('không có đối thủ nào → đề xuất tụt về sàn pháp lý, không NaN', () => {
    const solo = computeCompetitive(basis(), VOL_DAY_ONLY, PB_AT7, [], overhead(), [], 2, AT_DATE);
    expect(solo.strongest).toBeNull();
    money(solo.shrProposed, 23_800);   // sàn giờ Vùng I theo NĐ 74/2024
    expect(solo.flagBigRoom).toBe(false);
  });
});

describe('Bất biến L5', () => {
  it('shrPay hiện tại của ta không ảnh hưởng shrPay_max (nhân ngược từ GIÁ KHÁCH)', () => {
    const a = maxAffordableShr(basis({ shrPay: SHR }), VOL_DAY_ONLY, PB_AT7, [], OH_AT7).shrPayMax;
    const b = maxAffordableShr(basis({ shrPay: 20_000 }), VOL_DAY_ONLY, PB_AT7, [], OH_AT7).shrPayMax;
    money(a, b);
  });

  it('bảng lương tối đa dựng từ shrPay_max, bỏ override', () => {
    const r = maxAffordableShr(basis({ overrides: { day_wage_8h: 999_999 } }), VOL_DAY_ONLY, PB_AT7, [], OH_AT7);
    expect(r.table.every(x => !x.overridden)).toBe(true);
    money(r.table.find(x => x.code === 'day_wage_8h')!.fullPrice, r.shrPayMax * 8);
  });
});
