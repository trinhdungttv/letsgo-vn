// Tất cả KCN của 1 công ty (form "KH đang phục vụ" ở hồ sơ Đối thủ).
import { describe, expect, it } from 'vitest';
import { companyZoneNames, type CompanyZoneSources } from './companyZones';

const zones = [
  { id: 'nt', name: 'KCN Nhơn Trạch' },
  { id: 'v3', name: 'KCN VSIP 3' },
  { id: 'bb', name: 'KCN Bàu Bàng' },
];
const src = (over: Partial<CompanyZoneSources> = {}): CompanyZoneSources => ({
  clients: [{ name: 'AMPACS', industrial_zones: ['KCN Bàu Bàng'] }, { name: 'OLAM VN', industrial_zones: ['KCN Long Bình', 'KCN Nhơn Trạch'] }],
  leads: [
    { company_name: 'Coherent Vietnam', region: 'KCN Nhơn Trạch', crm_id: 'crm-1' },
    { company_name: 'Cty Cũ', region: 'KCN Bàu Bàng', crm_id: null },
  ],
  pipelineZoneIds: new Map([['crm-1', ['nt', 'v3']]]),
  zones,
  ...over,
});

describe('companyZoneNames', () => {
  it('công ty tìm hiểu có 2 KCN ở thẻ Pipeline → trả cả 2, không lặp KCN chính', () => {
    expect(companyZoneNames('Coherent Vietnam', src())).toEqual(['KCN Nhơn Trạch', 'KCN VSIP 3']);
  });
  it('khách hàng: lấy đủ industrial_zones', () => {
    expect(companyZoneNames('OLAM VN', src())).toEqual(['KCN Long Bình', 'KCN Nhơn Trạch']);
    expect(companyZoneNames('AMPACS', src())).toEqual(['KCN Bàu Bàng']);
  });
  it('chưa có thẻ Pipeline / chưa chạy 186 → chỉ còn KCN chính cũ', () => {
    expect(companyZoneNames('Cty Cũ', src())).toEqual(['KCN Bàu Bàng']);
    expect(companyZoneNames('Coherent Vietnam', src({ pipelineZoneIds: new Map() }))).toEqual(['KCN Nhơn Trạch']);
  });
  it('khớp tên lệch dấu / hoa thường; KCN viết khác kiểu không bị đếm 2 lần', () => {
    expect(companyZoneNames('coherent  VIETNAM', src())).toEqual(['KCN Nhơn Trạch', 'KCN VSIP 3']);
    const s = src({ leads: [{ company_name: 'X', region: 'Nhơn Trạch', crm_id: 'crm-1' }] });
    expect(companyZoneNames('X', s)).toEqual(['KCN Nhơn Trạch', 'KCN VSIP 3']);
  });
  it('mã KCN đã xoá khỏi danh mục bị bỏ qua; tên lạ / rỗng → []', () => {
    expect(companyZoneNames('Coherent Vietnam', src({ pipelineZoneIds: new Map([['crm-1', ['xoa', 'v3']]]) })))
      .toEqual(['KCN VSIP 3', 'KCN Nhơn Trạch']);
    expect(companyZoneNames('Không có', src())).toEqual([]);
    expect(companyZoneNames('  ', src())).toEqual([]);
  });
});
