import { describe, it, expect } from 'vitest';
import type { Branch } from '../types';
import { buildLaborReport, entryWeekKey, normalizeArea, weekKeyOf, weekMonth, type LrClient, type LrLaborEntry, type LrInput } from './model';

const br = (id: string, name: string, location: string | null): Branch => ({ id, name, location } as unknown as Branch);
const branches = [br('b1', 'LGV - VSIP', 'Bình Dương'), br('b2', 'Biên Hoà - Ms Thương', 'TP. Đồng Nai')];
const zones = [{ name: 'KCN Vsip 1', location: 'Bình Dương' }, { name: 'KCN Amata', location: 'Đồng Nai' }];

const client = (id: string, extra: Partial<LrClient> = {}): LrClient => ({
  id, name: id.toUpperCase(), branch_id: 'b1', region: null, industrial_zones: ['KCN Vsip 1'], min_workers: 0,
  cooperation_status: 'active', ...extra,
});
const e = (client_id: string, week_label: string, count: number, created_at = '2026-10-20T03:00:00Z'): LrLaborEntry =>
  ({ client_id, week_label, count, created_at });

// Chủ nhật 01/11/2026 → tuần hiện tại là T10W5 (26/10–31/10).
const NOW = new Date(2026, 10, 1, 9);
const input = (over: Partial<LrInput>): LrInput => ({ clients: [], labor: [], branches, zones, branchHistory: [], now: NOW, ...over });

describe('nhãn tuần → tuần lịch thật', () => {
  it('suy năm từ ngày nhập, kể cả nhập sang năm sau cho tháng 12', () => {
    expect(entryWeekKey({ week_label: 'T10W5', created_at: '2026-10-26T01:00:00Z' })).toBe('2026-10-26');
    expect(entryWeekKey({ week_label: 'T12W1', created_at: '2027-01-05T01:00:00Z' })).toBe('2026-11-30');
    expect(entryWeekKey({ week_label: 'T1W1', created_at: '2026-12-28T01:00:00Z' })).toBe('2027-01-04');
    expect(entryWeekKey({ week_label: 'xx', created_at: '2026-10-26T01:00:00Z' })).toBeNull();
  });
  it('tuần thuộc tháng chứa ngày Thứ 5', () => {
    expect(weekKeyOf(NOW)).toBe('2026-10-26');
    expect(weekMonth('2026-10-26')).toBe('2026-10');
    expect(weekMonth('2026-11-30')).toBe('2026-12');
  });
});

describe('chuẩn hoá khu vực', () => {
  it('"TP. Đồng Nai" và "Đồng Nai" là 1 khu vực; HCM luôn ghi "TP. Hồ Chí Minh"', () => {
    expect(normalizeArea('TP. Đồng Nai')?.key).toBe(normalizeArea('Đồng Nai')?.key);
    expect(normalizeArea('Hồ Chí Minh')?.name).toBe('TP. Hồ Chí Minh');
    expect(normalizeArea('  ')).toBeNull();
  });
});

describe('tổng theo tuần', () => {
  it('tuần chưa nhập → lấy số gần nhất (ước tính), đếm độ phủ', () => {
    const r = buildLaborReport(input({
      clients: [client('a'), client('b')],
      labor: [e('a', 'T10W3', 100), e('a', 'T10W4', 110), e('b', 'T10W3', 50), e('b', 'T10W5', 60)],
    }), { weeks: 4 });
    expect(r.weeks.map(w => w.label)).toEqual(['T10W2', 'T10W3', 'T10W4', 'T10W5']);
    expect(r.weeks.map(w => w.total)).toEqual([null, 150, 160, 170]);
    expect(r.anchor.actualClients).toBe(1);
    expect(r.anchor.contributingClients).toBe(2);
    expect(r.kpis.dWeek).toBe(10);
  });
  it('trùng tuần → lấy bản nhập sau cùng', () => {
    const r = buildLaborReport(input({
      clients: [client('a')],
      labor: [e('a', 'T10W5', 100, '2026-10-27T00:00:00Z'), e('a', 'T10W5', 120, '2026-10-28T00:00:00Z')],
    }), { weeks: 4 });
    expect(r.kpis.total).toBe(120);
  });
  it('KH ngưng: không tự kéo số sang sau tháng ngưng, nhưng số đã nhập vẫn giữ', () => {
    const r = buildLaborReport(input({
      clients: [client('a', { cooperation_status: 'suspended', suspended_from: '2026-09-20' }), client('b')],
      labor: [e('a', 'T9W2', 40, '2026-09-10T00:00:00Z'), e('b', 'T9W2', 10, '2026-09-10T00:00:00Z')],
    }), { weeks: 8, months: 3 });
    const sep = r.weeks.find(w => w.label === 'T9W4');
    const oct = r.weeks.find(w => w.label === 'T10W1');
    expect(sep?.total).toBe(50);   // tháng ngưng vẫn tính
    expect(oct?.total).toBe(10);   // sang tháng sau thì thôi
    expect(r.months.map(m => [m.label, m.total])).toEqual([['T9/2026', 50], ['T10/2026', 10]]);
  });
});

describe('tổng theo tháng', () => {
  it('số chốt tháng = tuần muộn nhất có nhập trong tháng; tháng trống → số gần nhất', () => {
    const r = buildLaborReport(input({
      clients: [client('a')],
      labor: [e('a', 'T8W1', 80, '2026-08-05T00:00:00Z'), e('a', 'T8W3', 90, '2026-08-20T00:00:00Z'), e('a', 'T10W2', 70)],
    }), { weeks: 4, months: 4 });
    expect(r.months.map(m => [m.label, m.total])).toEqual([['T8/2026', 90], ['T9/2026', 90], ['T10/2026', 70]]);
    expect(r.months[1].coverage).toBe(0);
    expect(r.kpis.dMonth).toBe(-20);
  });
});

describe('chi nhánh, khu vực, cầu biến động', () => {
  it('chuyển chi nhánh: tháng trước thuộc chi nhánh cũ, từ tháng chuyển thuộc chi nhánh mới', () => {
    const r = buildLaborReport(input({
      clients: [client('a', { branch_id: 'b2', industrial_zones: ['KCN Amata'] })],
      labor: [e('a', 'T9W2', 30, '2026-09-10T00:00:00Z'), e('a', 'T10W2', 35)],
      branchHistory: [
        { client_id: 'a', branch_id: 'b1', branch_name: 'LGV - VSIP', effective_from: '2026-01' },
        { client_id: 'a', branch_id: 'b2', branch_name: 'Biên Hoà - Ms Thương', effective_from: '2026-10' },
      ],
    }), { weeks: 8, months: 2 });
    const vsip = r.branches.find(b => b.key === 'b1')!;
    const bh = r.branches.find(b => b.key === 'b2')!;
    expect([vsip.prevMonth, vsip.curMonth]).toEqual([30, 0]);
    expect([bh.prevMonth, bh.curMonth]).toEqual([0, 35]);
    expect(r.areas.map(a => a.name)).toEqual(['Đồng Nai']);
  });
  it('phạm vi 1 chi nhánh chỉ cộng KH của chi nhánh đó', () => {
    const r = buildLaborReport(input({
      clients: [client('a'), client('b', { branch_id: 'b2' })],
      labor: [e('a', 'T10W5', 10), e('b', 'T10W5', 20)],
    }), { scope: { kind: 'branch', id: 'b2' }, weeks: 4 });
    expect(r.kpis.total).toBe(20);
    expect(r.scopeLabel).toBe('Chi nhánh Biên Hoà - Ms Thương');
  });
  it('cầu biến động tháng khớp tổng: đầu + mới + tăng − giảm − mất = cuối', () => {
    const r = buildLaborReport(input({
      clients: [client('a'), client('b'), client('c'), client('d', { cooperation_status: 'suspended', suspended_from: '2026-09-30' })],
      labor: [
        e('a', 'T9W4', 100, '2026-09-25T00:00:00Z'), e('a', 'T10W4', 120),
        e('b', 'T9W4', 50, '2026-09-25T00:00:00Z'), e('b', 'T10W4', 45),
        e('c', 'T10W4', 30),
        e('d', 'T9W4', 25, '2026-09-25T00:00:00Z'),
      ],
    }), { weeks: 6, months: 2 });
    const b = r.monthBridge!;
    expect(b).toMatchObject({ start: 175, newClients: 30, increase: 20, decrease: 5, lost: 25, end: 195 });
    expect(b.start + b.newClients + b.increase - b.decrease - b.lost).toBe(b.end);
    expect(b.lostList.map(x => x.name)).toEqual(['D']);
  });
  it('cam kết tối thiểu: liệt kê KH thiếu, bỏ qua dịch vụ tuyển dụng', () => {
    const r = buildLaborReport(input({
      clients: [client('a', { min_workers: 100 }), client('b', { min_workers: 50, service_type: 'recruitment' }), client('c', { min_workers: 10 })],
      labor: [e('a', 'T10W5', 80), e('b', 'T10W5', 5), e('c', 'T10W5', 12)],
    }), { weeks: 4 });
    expect(r.commitShortfall).toEqual([{ name: 'A', branch: 'LGV - VSIP', cur: 80, min: 100, gap: 20 }]);
    expect([r.kpis.commitMet, r.kpis.commitTotal]).toEqual([1, 2]);
  });
});
