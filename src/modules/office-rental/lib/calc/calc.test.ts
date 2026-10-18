import { describe, expect, it } from 'vitest';
import trackerRaw from '../__fixtures__/orient_pl_2026-08.json?raw';
import {
  computeBreakeven, computeMonth, feesRaw, fmtTr, fmtUSD, fmtVND, formatMoneyInput, gross, monthLabel, monthRange,
  monthStatus, net, priceAt, unitPL, utilGross, vatAmount, addMonths,
} from './index';
import type { CalcData, CalcSettings } from './types';
import { DEFAULT_CALC_SETTINGS, parseTrackerJson, snapshotToCalcData } from '../import/tracker';

const round = (n: number) => Math.round(n);

/** Dữ liệu thật: 4 head lease từ orient_pl_2026-08.json, tỷ giá 26,000. */
function realData(settings: Partial<CalcSettings> = {}): CalcData {
  const { snapshot, error } = parseTrackerJson(JSON.parse(trackerRaw));
  if (!snapshot) throw new Error(error);
  return snapshotToCalcData(snapshot, { ...DEFAULT_CALC_SETTINGS, ...settings });
}

/**
 * Fixture dựng lại các con số tổng ở mục 7 của đặc tả (file JSON hiện có chưa có doanh thu):
 * head lease thật + 3 khách (XHOME 383,756,504 + 2 khách khác = 651,469,711) + opex 22,388,995 ở T1/2026.
 */
function acceptanceData(settings: Partial<CalcSettings> = {}): CalcData {
  const d = realData(settings);
  d.tenants = [
    { id: 'xhome', name: 'XHOME', currency: 'VND', vatMode: 'none', headLeaseId: null },
    { id: 'b', name: 'Khách B', currency: 'VND', vatMode: 'incl', headLeaseId: null },
    { id: 'c', name: 'Khách C', currency: 'VND', vatMode: 'none', headLeaseId: null },
  ];
  d.rent = { '2026-01': { xhome: 383_756_504, b: 200_000_000, c: 67_713_207 } };
  d.fees = {};
  d.opexCategories = [
    { id: 'ql', name: 'Phí quản lý', vatMode: 'none', vatCategory: 'rent' },
    { id: 'lg', name: 'Lương NV', vatMode: 'none', vatCategory: 'rent' },
    { id: 'bt', name: 'Bảo trì', vatMode: 'incl', vatCategory: 'rent' },
  ];
  d.opex = { '2026-01': { ql: 5_000_000, lg: 15_000_000, bt: 2_388_995 } };
  d.forecasts = [{ month: '2026-01', amount: 10_000_000 }];
  return d;
}

describe('Tháng', () => {
  it('cộng tháng, dải tháng, nhãn', () => {
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(monthRange('2026-01', 3)).toEqual(['2026-01', '2026-02', '2026-03']);
    expect(monthRange('2026-01', 24)[23]).toBe('2027-12');
    expect(monthLabel('2026-01')).toBe('T1/2026');
  });
});

describe('VAT (5.1)', () => {
  it('gross / net / vatAmount', () => {
    expect(round(gross(57_971_000, 'excl', 10))).toBe(63_768_100);
    expect(round(gross(27_000_000, 'excl', 8))).toBe(29_160_000);
    expect(round(gross(5_997_000, 'excl', 8))).toBe(6_476_760);
    expect(net(5_997_000, 'incl', 8)).toBeCloseTo(5_552_777.78, 2);
    expect(gross(5_997_000, 'none', 8)).toBe(5_997_000);
    expect(gross(5_997_000, 'incl', 8)).toBe(5_997_000);
    expect(vatAmount(5_997_000, 'none', 8)).toBe(0);
    expect(round(vatAmount(5_997_000, 'excl', 8))).toBe(479_760);
    expect(vatAmount(5_997_000, 'incl', 8)).toBeCloseTo(5_997_000 - 5_552_777.78, 1);
  });
});

describe('Giá head lease theo mốc tăng (5.2)', () => {
  const d = realData();
  const l105 = d.headLeases.find(h => h.name === 'Mặt bằng 1.05')!;
  const l201 = d.headLeases.find(h => h.name === 'Mặt bằng 2.01')!;
  it('đọc đúng 4 head lease, bãi xe nhận diện là util + is_parking', () => {
    expect(d.headLeases.map(h => h.name)).toEqual(['Mặt bằng 1.05', 'Mặt bằng 2.01', 'Mặt tiền phía trước', 'Bãi giữ xe']);
    const xe = d.headLeases.find(h => h.name === 'Bãi giữ xe')!;
    expect(xe.isParking).toBe(true);
    expect(xe.vatCategory).toBe('util');
    expect(d.headLeases.filter(h => h.isParking)).toHaveLength(1);
  });
  it('mốc tăng cộng dồn đúng tháng', () => {
    expect(round(priceAt(l105, '2027-03'))).toBe(63_768_100);
    expect(round(priceAt(l105, '2027-02'))).toBe(57_971_000);
    expect(round(priceAt(l201, '2027-01'))).toBe(320_833_800);
    expect(round(priceAt(l201, '2026-12'))).toBe(305_556_000);
    expect(priceAt(l201, '2025-02')).toBe(0);
    expect(priceAt(l201, '2025-03')).toBe(305_556_000);
  });
  it('nhiều mốc nhân liên tiếp, không phụ thuộc thứ tự nhập', () => {
    const l = { basePrice: 100, baseMonth: '2026-01', increases: [{ month: '2028-01', percent: 10 }, { month: '2027-01', percent: 10 }] };
    expect(priceAt(l, '2027-06')).toBeCloseTo(110, 6);
    expect(priceAt(l, '2028-01')).toBeCloseTo(121, 6);
  });
  it('trả mặt bằng từ end_month → 0', () => {
    expect(priceAt({ ...l105, endMonth: '2027-01' }, '2026-12')).toBe(57_971_000);
    expect(priceAt({ ...l105, endMonth: '2027-01' }, '2027-01')).toBe(0);
  });
});

describe('Lời/lỗ tháng (5.3) — T1/2026', () => {
  it('khớp từng đồng', () => {
    const r = computeMonth(acceptanceData(), '2026-01');
    expect(round(r.mbt)).toBe(363_527_000);
    expect(round(r.ts4)).toBe(128_306_795);
    expect(round(r.opex)).toBe(22_388_995);
    expect(round(r.revenue)).toBe(651_469_711);
    expect(round(r.cost)).toBe(514_222_790);
    expect(round(r.profit)).toBe(137_246_921);
    expect(r.margin).toBeCloseTo(137_246_921 / 651_469_711, 10);
    expect(r.forecast).toBe(10_000_000);
  });
  it('bật cộng dự kiến → trừ thêm forecast', () => {
    const r = computeMonth(acceptanceData({ includeForecastInCost: true }), '2026-01');
    expect(round(r.cost)).toBe(524_222_790);
    expect(round(r.profit)).toBe(127_246_921);
  });
  it('mbt/ts4 thật từ file JSON (tỷ giá file không ảnh hưởng vì toàn VND)', () => {
    const r = computeMonth(realData({ exchangeRate: 25_870 }), '2026-01');
    expect(round(r.mbt)).toBe(363_527_000);
    expect(round(r.ts4)).toBe(128_306_795);
    expect(round(r.opex)).toBe(25_000_000);
    expect(r.revenue).toBe(0);
  });
  it('khách USD quy đổi theo tỷ giá', () => {
    const d = realData();
    d.tenants = [{ id: 'x', name: 'XHOME', currency: 'USD', vatMode: 'excl', headLeaseId: null }];
    d.rent = { '2026-02': { x: 1000 } };
    expect(round(computeMonth(d, '2026-02').revenue)).toBe(28_600_000);
  });
  it('trạng thái tháng', () => {
    const d = acceptanceData();
    expect(monthStatus(d, '2026-01', '2026-10')).toBe('actual');
    expect(monthStatus(d, '2026-02', '2026-10')).toBe('missing');
    expect(monthStatus(d, '2026-11', '2026-10')).toBe('future');
  });
});

describe('Phụ phí điện & bãi xe', () => {
  it('điện 2tr + 5 xe máy + 1 ô tô', () => {
    const s = { parkingPriceMoto: 150_000, parkingPriceCar: 1_500_000 };
    expect(feesRaw({ electricity: 2_000_000, moto: 5, car: 1 }, s)).toBe(4_250_000);
    const settings: CalcSettings = { ...DEFAULT_CALC_SETTINGS, ...s };
    const t = { id: 't', name: 'T', currency: 'VND' as const, vatMode: 'excl' as const, headLeaseId: null };
    expect(round(utilGross(t, 4_250_000, settings))).toBe(4_590_000);
  });
  it('phụ phí cộng vào doanh thu, khách USD vẫn tính phụ phí bằng VNĐ', () => {
    const d = realData();
    d.tenants = [{ id: 'x', name: 'XHOME', currency: 'USD', vatMode: 'none', headLeaseId: null }];
    d.fees = { '2026-03': { x: { electricity: 2_000_000, moto: 5, car: 1 } } };
    const r = computeMonth(d, '2026-03');
    expect(r.feeRevenue).toBe(4_250_000);
    expect(r.revenue).toBe(4_250_000);
  });
});

describe('Theo mặt bằng (5.4) + đối chiếu (5.5)', () => {
  function withXhomeOn201(include: boolean) {
    const d = acceptanceData({ includeForecastInCost: include });
    const l201 = d.headLeases.find(h => h.name === 'Mặt bằng 2.01')!;
    d.tenants[0].headLeaseId = l201.id;
    return { d, l201 };
  }
  it('XHOME gán vào 2.01', () => {
    const { d, l201 } = withXhomeOn201(false);
    const r = unitPL(d, '2026-01');
    const b = r.buckets.find(x => x.key === l201.id)!;
    expect(round(b.revenue)).toBe(383_756_504);
    expect(round(b.cost)).toBe(305_556_000);
    expect(round(b.profit)).toBe(78_200_504);
  });
  it.each([false, true])('Σ bucket − opex − forecast(nếu bật) = lợi nhuận Dashboard (cộng dự kiến: %s)', include => {
    const { d } = withXhomeOn201(include);
    d.fees = { '2026-01': { xhome: { electricity: 2_000_000, moto: 5, car: 1 }, b: { electricity: 1_000_000, moto: 3, car: 0 } } };
    const r = unitPL(d, '2026-01');
    expect(r.ok).toBe(true);
    expect(Math.abs(r.diff)).toBeLessThan(1);
    expect(round(r.reconciledProfit)).toBe(round(computeMonth(d, '2026-01').profit));
    // Cách tính của tracker cũ (quên trừ forecast) chỉ khớp khi tắt công tắc
    const trackerWay = r.bucketProfit - r.opex;
    expect(Math.abs(trackerWay - r.dashboardProfit) < 1).toBe(!include);
  });
  it('bãi xe: chi phí = head lease bãi xe, doanh thu = phí xe của mọi khách', () => {
    const { d } = withXhomeOn201(false);
    d.fees = { '2026-01': { xhome: { electricity: 2_000_000, moto: 5, car: 1 }, c: { electricity: 0, moto: 2, car: 0 } } };
    const r = unitPL(d, '2026-01');
    const p = r.buckets.find(x => x.kind === 'parking')!;
    expect(p.cost).toBe(27_000_000);
    expect(p.revenue).toBe(5 * 150_000 + 1_500_000 + 2 * 150_000);
    expect(round(p.profit)).toBe(-24_450_000);
    const b201 = r.buckets.find(x => x.name === 'Mặt bằng 2.01')!;
    expect(round(b201.revenue)).toBe(383_756_504 + 2_000_000);
  });
  it('khách chưa gán → bucket riêng, chi phí 0', () => {
    const { d } = withXhomeOn201(false);
    const r = unitPL(d, '2026-01');
    const u = r.buckets.find(x => x.kind === 'unassigned')!;
    expect(u.cost).toBe(0);
    expect(round(u.revenue)).toBe(267_713_207);
    expect(r.unassignedTenants.map(t => t.name)).toEqual(['Khách B', 'Khách C']);
  });
});

describe('Hòa vốn tách phòng (5.6)', () => {
  const settings = { exchangeRate: 26_000, vatRateRent: 10 };
  const rooms = [
    { name: 'P1', area: 200, currency: 'VND' as const, price: 50_000_000, vatMode: 'none' as const },
    { name: 'P2', area: 286, currency: 'VND' as const, price: 75_000_000, vatMode: 'none' as const },
    { name: 'P3', area: 229, currency: 'VND' as const, price: 55_000_000, vatMode: 'none' as const },
  ];
  it('giá sàn từng phòng, tổng = mục tiêu, dư/thiếu', () => {
    const r = computeBreakeven({ targetCost: 305_556_000, extraCost: 0, parentArea: 778, rooms, settings });
    expect(r.target).toBe(305_556_000);
    expect(r.totalArea).toBe(715);
    expect(r.rooms.map(x => round(x.floorVND!))).toEqual([85_470_210, 122_222_400, 97_863_390]);
    const sum = r.rooms.reduce((a, x) => a + x.floorVND!, 0);
    expect(Math.abs(sum - 305_556_000)).toBeLessThanOrEqual(1);
    expect(round(r.diff)).toBe(-125_556_000);
    expect(r.areaMismatch).toEqual({ parent: 778, rooms: 715 });
  });
  it('chi phí chung phân bổ thêm cộng vào mục tiêu', () => {
    const r = computeBreakeven({ targetCost: 305_556_000, extraCost: 4_444_000, rooms, settings });
    expect(r.target).toBe(310_000_000);
    expect(r.areaMismatch).toBeNull();
  });
  it('tổng m² = 0 → không có giá sàn, không chia 0', () => {
    const r = computeBreakeven({ targetCost: 1_000_000, extraCost: 0, rooms: rooms.map(x => ({ ...x, area: 0 })), settings });
    expect(r.rooms.every(x => x.floorVND === null && x.pricePerM2 === null)).toBe(true);
    expect(Number.isFinite(r.diff)).toBe(true);
  });
  it('phòng USD + chưa gồm VAT: giá sàn quy về USD trước VAT', () => {
    const r = computeBreakeven({
      targetCost: 28_600_000, extraCost: 0,
      rooms: [{ name: 'U', area: 100, currency: 'USD', price: 1000, vatMode: 'excl' }], settings,
    });
    expect(round(r.rooms[0].revenueVND)).toBe(28_600_000);
    expect(r.rooms[0].floorQuote).toBeCloseTo(1000, 6);
    expect(Math.abs(r.diff)).toBeLessThan(1e-6);
  });
});

describe('Định dạng & MoneyInput (5.8)', () => {
  it('fmtVND / fmtUSD / fmtTr', () => {
    expect(fmtVND(5_997_000)).toBe('5,997,000đ');
    expect(fmtVND(-1234.6)).toBe('-1,235đ');
    expect(fmtUSD(3680.5)).toBe('$3,680.5');
    expect(fmtUSD(3680.456)).toBe('$3,680.46');
    expect(fmtTr(363_527_000)).toBe('363.5');
    expect(fmtTr(-24_450_000)).toBe('-24.5');
  });
  it('gõ số tiền', () => {
    expect(formatMoneyInput('5997000', 'VND')).toEqual({ text: '5,997,000', raw: 5_997_000 });
    expect(formatMoneyInput('5,997,000', 'VND')).toEqual({ text: '5,997,000', raw: 5_997_000 });
    expect(formatMoneyInput('5,997,0001', 'VND')).toEqual({ text: '59,970,001', raw: 59_970_001 });
    expect(formatMoneyInput('', 'VND')).toEqual({ text: '', raw: 0 });
    expect(formatMoneyInput('12.5', 'VND')).toEqual({ text: '125', raw: 125 });
    expect(formatMoneyInput('3680.5', 'USD')).toEqual({ text: '3,680.5', raw: 3680.5 });
    expect(formatMoneyInput('3,680.5', 'USD')).toEqual({ text: '3,680.5', raw: 3680.5 });
    expect(formatMoneyInput('3680.567', 'USD')).toEqual({ text: '3,680.56', raw: 3680.56 });
    expect(formatMoneyInput('3680.', 'USD')).toEqual({ text: '3,680.', raw: 3680 });
    expect(formatMoneyInput('1.2.3', 'USD')).toEqual({ text: '1.23', raw: 1.23 });
  });
});
