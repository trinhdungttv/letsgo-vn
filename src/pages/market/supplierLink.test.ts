import { describe, it, expect, vi } from 'vitest';

vi.mock('../../lib/supabase', () => ({ supabase: {} }));

import { deriveSupplyFromCompanies } from './supplierLink';

const comps: any = [{ id: 'c1', company_name: 'Nhân Đức Phát' }];
const clients: any = [{
  id: 'k', name: 'KUKA', industrial_zones: ['VSIP 1'],
  market_suppliers: [{ name: "Let's Go VN", qty: 0, is_us: true }, { name: 'nhan duc  phat', qty: 5, is_us: false }],
}];

describe('deriveSupplyFromCompanies', () => {
  it('suy ra dòng từ NCC ở thẻ công ty, khớp tên không phân biệt dấu/khoảng trắng, bỏ Let\'s Go VN', () => {
    const rows = deriveSupplyFromCompanies(comps, clients, [], []);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ competitor_id: 'c1', client_name: 'KUKA', kcn: 'VSIP 1', worker_count: 5, derived: true });
  });
  it('không suy ra thêm khi đã có dòng thật cho đúng cặp đối thủ–công ty', () => {
    expect(deriveSupplyFromCompanies(comps, clients, [], [{ id: 'x', competitor_id: 'c1', client_name: 'KUKA' }] as any)).toHaveLength(0);
  });
  it('lấy NCC của dự án tiềm năng, KCN = region', () => {
    const leads: any = [{ id: 'l', company_name: 'LONG WELL', region: 'KCN A', suppliers: [{ name: 'Nhân Đức Phát', qty: 0, is_us: false }] }];
    expect(deriveSupplyFromCompanies(comps, [], leads, [])[0]).toMatchObject({ client_name: 'LONG WELL', kcn: 'KCN A' });
  });
  it('suy ra từ "Đang cung cấp cho" (supplying_for), lấy KCN từ hồ sơ công ty cùng tên', () => {
    const c2: any = [{ id: 'c1', company_name: 'Nhân Đức Phát', supplying_for: ['KUKA', 'AMPACS'] }];
    const cl: any = [{ id: 'k', name: 'KUKA', industrial_zones: ['VSIP 1'] }];
    const rows = deriveSupplyFromCompanies(c2, cl, [], []);
    expect(rows.map(r => [r.client_name, r.kcn])).toEqual([['KUKA', 'VSIP 1'], ['AMPACS', '']]);
  });
});
