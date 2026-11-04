import { describe, expect, it } from 'vitest';
import {
  buildCareer, companyNameMatches, foldVN, historyDate, moveCompanyError, moveFallbackNote, movedAwayFrom, periodLabel, type CareerHistoryRow,
} from './contactCareer';

let n = 0;
const row = (over: Partial<CareerHistoryRow>): CareerHistoryRow & { contact_id: string } => ({
  id: `h${++n}`, contact_id: 'p1', from_client_id: null, to_client_id: null, from_client_name: null, to_client_name: null,
  changed_at: '2026-01-01T03:00:00Z', changed_by: 'Tony', note: null, ...over,
});

describe('quá trình công tác', () => {
  it('chuyển A → B: A đóng lại kèm chức vụ cũ, B đang làm với chức vụ hiện tại', () => {
    const career = buildCareer({
      role: 'Trưởng phòng HR', startDate: '2026-11-01',
      links: [{ clientId: 'B', clientName: 'Công ty B', createdAt: '2026-11-01T02:00:00Z' }],
      history: [
        row({ to_client_id: 'A', to_client_name: 'Công ty A', changed_at: '2024-03-10T02:00:00Z', note: 'Tạo mới liên hệ' }),
        row({
          from_client_id: 'A', from_client_name: 'Công ty A', to_client_id: 'B', to_client_name: 'Công ty B',
          from_role: 'HR Manager', to_role: 'Trưởng phòng HR', effective_on: '2026-10-31', changed_at: '2026-11-04T01:00:00Z',
        }),
      ],
    });
    expect(career).toEqual([
      { clientId: 'B', clientName: 'Công ty B', role: 'Trưởng phòng HR', from: '2026-10-31', to: null, current: true, movedToName: null },
      { clientId: 'A', clientName: 'Công ty A', role: 'HR Manager', from: '2024-03-10', to: '2026-10-31', current: false, movedToName: 'Công ty B' },
    ]);
    expect(periodLabel(career[1])).toBe('10/03/2024 → 31/10/2026');
    expect(periodLabel(career[0])).toBe('từ 31/10/2026 · đang làm');
  });

  it('chưa có lịch sử: 1 công ty lấy "Phụ trách từ ngày"; nhiều công ty lấy ngày gắn', () => {
    expect(buildCareer({ role: 'HR', startDate: '2023-05-01', links: [{ clientId: 'A', clientName: 'A', createdAt: '2025-01-01T00:00:00Z' }], history: [] })[0].from)
      .toBe('2023-05-01');
    const two = buildCareer({
      role: 'HR', startDate: '2023-05-01', history: [],
      links: [{ clientId: 'A', clientName: 'A', createdAt: '2025-01-01T00:00:00Z' }, { clientId: 'B', clientName: 'B', createdAt: '2025-06-02T00:00:00Z' }],
    });
    expect(two.map(p => p.from)).toEqual(['2025-01-01', '2025-06-02']);
  });

  it('DB chưa chạy 197: chức vụ cũ đọc từ ghi chú, mốc theo changed_at (giờ VN)', () => {
    const career = buildCareer({
      role: 'GĐ', startDate: null, links: [{ clientId: 'B', clientName: 'B' }],
      history: [row({
        from_client_id: 'A', from_client_name: 'A', to_client_id: 'B', to_client_name: 'B',
        changed_at: '2026-10-31T18:00:00Z', note: moveFallbackNote({ fromRole: 'Kế toán', fromStartedOn: '2022-02-01', note: 'nghe nói lương cao hơn' }),
      })],
    });
    expect(career[1]).toMatchObject({ clientName: 'A', role: 'Kế toán', from: '2022-02-01', to: '2026-11-01', movedToName: 'B' });
    expect(historyDate({ changed_at: '2026-10-31T18:00:00Z', effective_on: null })).toBe('2026-11-01');
  });

  it('gỡ công ty (không chuyển) → quãng đã rời, không ghi "chuyển sang"', () => {
    const career = buildCareer({
      role: 'HR', startDate: null, links: [],
      history: [
        row({ to_client_id: 'A', to_client_name: 'A', changed_at: '2025-01-01T03:00:00Z' }),
        row({ from_client_id: 'A', from_client_name: 'A', changed_at: '2025-08-01T03:00:00Z' }),
      ],
    });
    expect(career).toEqual([{ clientId: 'A', clientName: 'A', role: '', from: '2025-01-01', to: '2025-08-01', current: false, movedToName: null }]);
  });
});

describe('công ty cũ thấy "đã chuyển sang công ty X"', () => {
  it('lấy mốc chuyển đi mới nhất, bỏ người đã quay lại', () => {
    const rows = [
      row({ contact_id: 'p1', from_client_id: 'A', to_client_id: 'B', to_client_name: 'B', effective_on: '2025-01-01', from_role: 'HR' }),
      row({ contact_id: 'p1', from_client_id: 'A', to_client_id: 'C', to_client_name: 'C', effective_on: '2026-02-01', from_role: 'HR Lead' }),
      row({ contact_id: 'p2', from_client_id: 'A', to_client_id: null, effective_on: '2026-03-01' }), // chỉ gỡ — không phải chuyển
      row({ contact_id: 'p3', from_client_id: 'A', to_client_id: 'D', to_client_name: 'D', effective_on: '2026-04-01' }),
      row({ contact_id: 'p4', from_client_id: 'Z', to_client_id: 'A', to_client_name: 'A', effective_on: '2026-04-01' }),
    ];
    const out = movedAwayFrom(rows, 'A', new Set(['p3']));
    expect(out).toEqual([{ contactId: 'p1', role: 'HR Lead', from: null, movedOn: '2026-02-01', toClientId: 'C', toClientName: 'C' }]);
  });
});

describe('form chuyển công ty', () => {
  it('kiểm tra công ty mới + ngày chuyển', () => {
    const ok = { fromClientId: 'A', toClientId: 'B', newCompanyName: '', effectiveOn: '2026-11-04' };
    expect(moveCompanyError(ok, '2026-11-04')).toBeNull();
    expect(moveCompanyError({ ...ok, toClientId: null }, '2026-11-04')).toMatch(/Chọn công ty mới/);
    expect(moveCompanyError({ ...ok, toClientId: null, newCompanyName: 'Cty Mới' }, '2026-11-04')).toBeNull();
    expect(moveCompanyError({ ...ok, toClientId: 'A' }, '2026-11-04')).toMatch(/trùng/);
    expect(moveCompanyError({ ...ok, effectiveOn: '2026-11-05' }, '2026-11-04')).toMatch(/tương lai/);
    expect(moveCompanyError({ ...ok, effectiveOn: '' }, '2026-11-04')).toMatch(/ngày chuyển/);
  });

  it('lọc tên không dấu, bỏ chữ chung "công ty / cty / tnhh"', () => {
    expect(foldVN('  Công ty  Đông Á ')).toBe('cong ty dong a');
    expect(companyNameMatches('Công ty TNHH Foxconn Bắc Giang', 'Cty Foxconn bac giang')).toBe(true);
    expect(companyNameMatches('Công ty TNHH Foxconn Bắc Giang', 'foxconn hà nội')).toBe(false);
    expect(companyNameMatches('Công ty Midea', '')).toBe(true);
    expect(companyNameMatches('Công ty Midea', 'công ty')).toBe(true);
  });
});
