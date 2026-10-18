import { describe, expect, it } from 'vitest';
import {
  buildAlerts, contractState, daysBetween, defaultDueDate, effectiveRoomStatus, invoiceBreakdown, invoiceState, occupancy,
} from './ops';
import type { CalcData } from './calc/types';
import { DEFAULT_CALC_SETTINGS } from './import/tracker';
import { computeMonth } from './calc/pl';
import type { BdsRoom, BdsTenant } from './types';

const tenant = (p: Partial<BdsTenant>): BdsTenant => ({
  id: 't', name: 'T', currency: 'VND', vat_mode: 'none', head_lease_id: 'L', area_m2: null, active: true, sort_order: 0, note: null, ...p,
});
const room = (p: Partial<BdsRoom>): BdsRoom => ({
  id: 'r', code: 'VP1', name: null, area_m2: 100, head_lease_id: null, location: null, status: 'vacant', list_price: null,
  list_currency: 'VND', sort_order: 0, note: null, ...p,
});

describe('Ngày & hợp đồng', () => {
  it('daysBetween / hạn thanh toán', () => {
    expect(daysBetween('2026-10-18', '2026-11-17')).toBe(30);
    expect(daysBetween('2026-10-18', '2026-10-01')).toBe(-17);
    expect(defaultDueDate('2026-06', 30)).toBe('2026-06-28');
    expect(defaultDueDate('2026-06', 10)).toBe('2026-06-10');
  });
  it('trạng thái hợp đồng 30/60 ngày', () => {
    const today = '2026-10-18';
    expect(contractState(tenant({ contract_end: '2026-11-10' }), today, 60)).toEqual({ state: 'urgent', days: 23 });
    expect(contractState(tenant({ contract_end: '2026-12-10' }), today, 60)).toEqual({ state: 'soon', days: 53 });
    expect(contractState(tenant({ contract_end: '2027-03-01' }), today, 60).state).toBe('active');
    expect(contractState(tenant({ contract_end: '2026-10-01' }), today, 60)).toEqual({ state: 'expired', days: -17 });
    expect(contractState(tenant({ active: false, contract_end: '2026-10-01' }), today, 60).state).toBe('ended');
    expect(contractState(tenant({}), today, 60).state).toBe('none');
  });
});

describe('Phòng', () => {
  it('trạng thái hiệu lực + lấp đầy', () => {
    const tenants = [tenant({ id: 'a', room_id: 'r1' }), tenant({ id: 'b', room_id: 'r2', active: false })];
    const rooms = [room({ id: 'r1', area_m2: 230 }), room({ id: 'r2', area_m2: 106, status: 'reserved' }), room({ id: 'r3', area_m2: 50 })];
    expect(rooms.map(r => effectiveRoomStatus(r, tenants))).toEqual(['occupied', 'reserved', 'vacant']);
    const o = occupancy(rooms, tenants);
    expect(o.total).toBe(386);
    expect(o.occupied).toBe(230);
  });
});

describe('Hoá đơn', () => {
  const data: CalcData = {
    settings: { ...DEFAULT_CALC_SETTINGS, exchangeRate: 25_870, parkingPriceMoto: 150_000, parkingPriceCar: 1_500_000 },
    headLeases: [], opexCategories: [], forecasts: [], opex: {},
    tenants: [
      { id: 'abc', name: 'ABC Korea', currency: 'USD', vatMode: 'none', headLeaseId: null },
      { id: 'x', name: 'X', currency: 'VND', vatMode: 'excl', headLeaseId: null },
    ],
    rent: { '2026-06': { abc: 3680, x: 10_000_000 } },
    fees: { '2026-06': { abc: { electricity: 2_525_000, moto: 6, car: 2 }, x: { electricity: 1_000_000, moto: 1, car: 0 } } },
  };
  it('ABC Korea (USD, không VAT) — như demo: $3,680 + điện + xe', () => {
    const b = invoiceBreakdown(data, '2026-06', data.tenants[0]);
    expect(b.rent.gross).toBe(95_201_600);
    expect(b.parking.gross).toBe(6 * 150_000 + 2 * 1_500_000);
    expect(b.total).toBe(95_201_600 + 2_525_000 + 3_900_000);
    expect(b.vatTotal).toBe(0);
  });
  it('chưa gồm VAT: tách thuế từng dòng; tổng hoá đơn = doanh thu P&L', () => {
    const b = invoiceBreakdown(data, '2026-06', data.tenants[1]);
    expect(b.rent).toEqual({ net: 10_000_000, vat: 1_000_000, gross: 11_000_000 });
    expect(Math.round(b.electricity.vat)).toBe(80_000);
    expect(Math.round(b.parking.gross)).toBe(162_000);
    const all = data.tenants.reduce((a, t) => a + invoiceBreakdown(data, '2026-06', t).total, 0);
    expect(all).toBeCloseTo(computeMonth(data, '2026-06').revenue, 6);
  });
  it('trạng thái thu tiền', () => {
    expect(invoiceState(undefined, '2026-07-01').state).toBe('none');
    expect(invoiceState({ status: 'unpaid', due_date: '2026-06-30' }, '2026-07-05')).toEqual({ state: 'overdue', overdueDays: 5 });
    expect(invoiceState({ status: 'unpaid', due_date: '2026-07-10' }, '2026-07-05').state).toBe('unpaid');
    expect(invoiceState({ status: 'paid', due_date: '2026-06-30' }, '2026-07-05').state).toBe('paid');
  });
});

describe('Cảnh báo', () => {
  it('HĐ sắp hết, HĐ quá hạn, hoá đơn quá hạn, phòng trống, khách chưa gán', () => {
    const alerts = buildAlerts({
      tenants: [
        tenant({ id: 'a', name: 'Thịnh Phát', contract_end: '2026-11-09' }),
        tenant({ id: 'b', name: 'Hùng', contract_end: '2026-12-01', head_lease_id: null }),
      ],
      rooms: [room({ id: 'r4', code: 'VP4', list_price: 38_000_000 })],
      invoices: [{ id: 'i', tenant_id: 'a', month: '2026-09-01', invoice_no: null, status: 'unpaid', due_date: '2026-10-13', paid_at: null, paid_amount: null, note: null }],
      openTickets: 3, today: '2026-10-18', alertDays: 60, exchangeRate: 26_000, opsReady: true,
    });
    expect(alerts.map(a => a.tone)).toEqual(['red', 'red', 'amber', 'amber', 'amber', 'blue']);
    expect(alerts.map(a => a.text)).toEqual(expect.arrayContaining([
      'Thịnh Phát: hết hợp đồng sau 22 ngày',
      'Thịnh Phát: hoá đơn T9/2026 quá hạn 5 ngày',
      'VP4 đang trống — bỏ phí ~38 tr/tháng',
      '1 khách chưa gán mặt bằng: Hùng',
    ]));
  });
  it('chưa chạy migration vận hành → chỉ còn cảnh báo khách chưa gán', () => {
    const alerts = buildAlerts({
      tenants: [tenant({ head_lease_id: null, name: 'XHOME', contract_end: '2026-10-20' })], rooms: [], invoices: [],
      openTickets: 0, today: '2026-10-18', alertDays: 60, exchangeRate: 26_000, opsReady: false,
    });
    expect(alerts).toEqual([expect.objectContaining({ key: 'unassigned' })]);
  });
});
