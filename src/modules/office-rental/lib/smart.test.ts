import { describe, expect, it } from 'vitest';
import trackerRaw from './__fixtures__/orient_pl_2026-08.json?raw';
import { DEFAULT_CALC_SETTINGS, parseTrackerJson, snapshotToCalcData } from './import/tracker';
import { buildEvents, groupByMonth, visibleEvents, type EventInput } from './events';
import { buildProjection, firstProjectedLoss } from './forecast';
import { buildInsights } from './insights';
import type { CalcData } from './calc/types';
import type { BdsHeadLease, BdsInvoice, BdsRoom, BdsTenant } from './types';

/** Dữ liệu thật (4 head lease) + XHOME thuê 2.01, tiền thuê T1–T9/2026. */
function realData(): CalcData {
  const { snapshot } = parseTrackerJson(JSON.parse(trackerRaw));
  const d = snapshotToCalcData(snapshot!, DEFAULT_CALC_SETTINGS);
  d.tenants = [{ id: 'x', name: 'XHOME', currency: 'VND', vatMode: 'none', headLeaseId: 'u_201' }];
  d.rent = {};
  for (let m = 1; m <= 9; m++) d.rent[`2026-${String(m).padStart(2, '0')}`] = { x: 600_000_000 };
  d.opex = { '2026-09': { o_ql: 5_000_000, o_lg: 15_000_000 } };
  return d;
}

const tenant = (p: Partial<BdsTenant>): BdsTenant => ({
  id: 'x', name: 'XHOME', currency: 'VND', vat_mode: 'none', head_lease_id: 'u_201', area_m2: null, active: true,
  sort_order: 0, note: null, ...p,
});
const leases: BdsHeadLease[] = [
  { id: 'u_105', landlord: 'mbt', name: 'Mặt bằng 1.05', currency: 'VND', base_price: 57_971_000, base_month: '2025-03-01', end_month: null, vat_mode: 'incl', vat_category: 'rent', is_parking: false, sort_order: 1, note: null },
  { id: 'u_201', landlord: 'mbt', name: 'Mặt bằng 2.01', currency: 'VND', base_price: 305_556_000, base_month: '2025-03-01', end_month: null, vat_mode: 'incl', vat_category: 'rent', is_parking: false, sort_order: 2, note: null },
];

function input(p: Partial<EventInput> = {}): EventInput {
  return {
    data: realData(), leases, tenants: [tenant({ contract_end: '2027-01-15', deposit_amount: 200_000_000, deposit_currency: 'VND' })],
    rooms: [], invoices: [], readings: [], opexRows: [], tickets: [], assets: [], forecasts: [],
    today: '2026-10-18', horizonDays: 90, opsReady: true, ...p,
  };
}

describe('Sự kiện & thông báo', () => {
  it('HĐ khách: nhắc 3 tháng / 2 tháng / 1 tháng / đã hết', () => {
    const at = (end: string) => buildEvents(input({ tenants: [tenant({ contract_end: end })] })).find(e => e.kind === 'contract_end');
    expect(at('2027-01-15')).toMatchObject({ severity: 'info', daysLeft: 89 });
    expect(at('2026-12-10')).toMatchObject({ severity: 'warning', daysLeft: 53 });
    expect(at('2026-11-10')).toMatchObject({ severity: 'critical', daysLeft: 23 });
    expect(at('2026-10-01')).toMatchObject({ severity: 'critical', daysLeft: -17 });
    expect(at('2027-02-01')).toBeUndefined();
    const e = at('2027-01-15')!;
    expect(e.title).toBe('HĐ XHOME hết hạn sau 89 ngày (15/01/2027)');
    expect(e.amount).toBe(-600_000_000);
    expect(e.key).toBe('contract_end:x:2027-01-15');
  });

  it('Mặt bằng sắp tăng giá: nêu số tiền tăng / tháng', () => {
    const evs = buildEvents(input()).filter(e => e.kind === 'lease_increase');
    expect(evs.map(e => e.key)).toEqual(['lease_increase:u_201:2027-01']);
    expect(evs[0].daysLeft).toBe(75);
    expect(Math.round(evs[0].amount!)).toBe(15_277_800);
    expect(evs[0].title).toBe('Mặt bằng 2.01 tăng 5% từ 01/01/2027 (còn 75 ngày)');
    // T3/2027 (1.05) nằm ngoài 90 ngày → chưa nhắc; khi tới gần thì cảnh báo vàng
    const near = buildEvents(input({ today: '2027-02-20' })).find(e => e.key === 'lease_increase:u_105:2027-03')!;
    expect(near.severity).toBe('warning');
    expect(Math.round(near.amount!)).toBe(5_797_100);
  });

  it('Hoá đơn quá hạn + tháng trước chưa lập thông báo + chưa nhập doanh thu', () => {
    const inv: BdsInvoice = { id: 'i1', tenant_id: 'x', month: '2026-08-01', invoice_no: null, status: 'unpaid', due_date: '2026-08-10', paid_at: null, paid_amount: null, note: null };
    const evs = buildEvents(input({ invoices: [inv] }));
    expect(evs[0]).toMatchObject({ kind: 'invoice_overdue', severity: 'critical', amount: -600_000_000 });
    expect(evs.find(e => e.kind === 'missing_invoice')?.title).toBe('Chưa lập thông báo thanh toán T9/2026 cho 1 khách');
    // Chưa từng lập thông báo nào → không nhắc "chưa lập thông báo"
    expect(buildEvents(input()).some(e => e.kind === 'missing_invoice')).toBe(false);
    const noSept = input();
    delete noSept.data.rent['2026-09'];
    expect(buildEvents(noSept).find(e => e.kind === 'missing_revenue')?.title).toBe('T9/2026 chưa nhập tiền thuê của 1 khách');
  });

  it('Phòng trống có giá chào → thất thu; khách chưa gán mặt bằng', () => {
    const room: BdsRoom = { id: 'r', code: 'VP4', name: null, area_m2: 106, head_lease_id: 'u_105', location: null, status: 'vacant', list_price: 38_000_000, list_currency: 'VND', sort_order: 0, note: null };
    const evs = buildEvents(input({ rooms: [room], tenants: [tenant({ head_lease_id: null })] }));
    expect(evs.find(e => e.kind === 'room_vacant')).toMatchObject({ amount: -38_000_000, severity: 'warning' });
    expect(evs.find(e => e.kind === 'unassigned_tenant')?.detail).toBe('XHOME');
  });

  it('Ẩn / nhắc lại sau; nhóm theo tháng', () => {
    const evs = buildEvents(input());
    const k = evs.find(e => e.kind === 'contract_end')!.key;
    expect(visibleEvents(evs, [{ event_key: k, status: 'dismissed', snooze_until: null }], '2026-10-18').some(e => e.key === k)).toBe(false);
    expect(visibleEvents(evs, [{ event_key: k, status: 'snoozed', snooze_until: '2026-10-25' }], '2026-10-18').some(e => e.key === k)).toBe(false);
    expect(visibleEvents(evs, [{ event_key: k, status: 'snoozed', snooze_until: '2026-10-25' }], '2026-10-25').some(e => e.key === k)).toBe(true);
    expect(groupByMonth(evs).map(g => g.month)).toEqual(['2027-01']);
  });

  it('Chưa chạy migration vận hành → chỉ còn cảnh báo dựa trên số tài chính', () => {
    const evs = buildEvents(input({ opsReady: false }));
    expect(evs.some(e => e.kind === 'contract_end')).toBe(false);
    expect(evs.some(e => e.kind === 'lease_increase')).toBe(true);
  });
});

describe('Dự báo', () => {
  it('giữ tiền thuê gần nhất, dừng sau hết HĐ, chi phí có mốc tăng', () => {
    const d = realData();
    const p = buildProjection({
      data: d, currentMonth: '2026-10', from: '2026-07', count: 12,
      tenants: [{ id: 'x', name: 'XHOME', active: true, contract_end: '2027-01-31' }],
    });
    expect(p.lastActual).toBe('2026-09');
    const by = Object.fromEntries(p.months.map(m => [m.month, m]));
    expect(by['2026-09'].projected).toBe(false);
    expect(by['2026-10'].projected).toBe(true);
    expect(by['2026-10'].revenue).toBe(600_000_000);
    expect(by['2027-01'].revenue).toBe(600_000_000);
    expect(by['2027-02'].revenue).toBe(0);
    expect(by['2027-01'].notes).toEqual(['Mặt bằng 2.01 +5%', 'HĐ XHOME hết hạn']);
    expect(Math.round(by['2027-01'].mbt - by['2026-12'].mbt)).toBe(15_277_800);
    // opex dự báo = trung bình tháng gần nhất đã nhập (T9: 20tr)
    expect(by['2026-11'].opex).toBe(20_000_000);
    expect(firstProjectedLoss(p)?.month).toBe('2027-02');
  });
});

describe('Nhận định tự động', () => {
  it('nêu lời/lỗ tháng gần nhất, rủi ro tập trung, mặt bằng trống, mốc tăng, dự báo lỗ', () => {
    const d = realData();
    const p = buildProjection({ data: d, currentMonth: '2026-10', from: '2026-01', count: 24, tenants: [{ id: 'x', name: 'XHOME', active: true, contract_end: '2027-01-31' }] });
    const months = Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, '0')}`);
    const ins = buildInsights({ data: d, months, currentMonth: '2026-10', projection: p, unpaid: { total: 0, overdue: 0 }, occupancy: { total: 0, occupied: 0, rate: null } });
    const keys = ins.map(i => i.key);
    expect(keys).toEqual(expect.arrayContaining(['last', 'concentration', 'empty-u_105', 'parking', 'increases', 'proj-loss', 'breakeven']));
    expect(ins[0].tone).toBe('bad');
    expect(ins.find(i => i.key === 'concentration')!.text).toMatch(/^XHOME chiếm 100.0% tiền thuê/);
    expect(ins.find(i => i.key === 'proj-loss')!.text).toMatch(/^Dự báo bắt đầu lỗ từ T2\/2027/);
  });
});
