import { describe, expect, it, vi } from 'vitest';

vi.mock('./supabase', () => ({ supabase: {} }));
vi.mock('./audit', () => ({ logActivity: vi.fn() }));

import { pipelineOnlyCompanies, pipelineStageLabel, type PipelineCompanyLite } from './pipelineCompanyLink';

const card = (id: string, company_name: string, stage = 'dam-phan', client_id: string | null = null): PipelineCompanyLite =>
  ({ id, company_name, stage, client_id, contact_id: null, branch_id: null });

describe('pipelineOnlyCompanies — công ty chỉ có ở BD Pipeline để gắn người liên hệ', () => {
  it('giữ thẻ đang tìm hiểu / chờ / đàm phán chưa có hồ sơ Khách hàng', () => {
    const out = pipelineOnlyCompanies([card('1', 'Coherent Vietnam'), card('2', 'Glory Oceanic', 'dang-lh')], ['CICOR']);
    expect(out.map(e => e.id)).toEqual(['1', '2']);
  });
  it('bỏ thẻ đã gắn hồ sơ (client_id) và thẻ Ngưng HĐ', () => {
    const out = pipelineOnlyCompanies([card('1', 'A', 'hop-tac', 'cl1'), card('2', 'B', 'ngung'), card('3', 'C', 'khong-nhu-cau')], []);
    expect(out.map(e => e.id)).toEqual(['3']);
  });
  it('bỏ thẻ trùng tên hồ sơ đã có (không dấu, không phân biệt hoa thường) và trùng tên nhau', () => {
    const out = pipelineOnlyCompanies(
      [card('1', 'CÔNG TY  ĐẠI PHÁT'), card('2', 'Coherent Vietnam'), card('3', 'coherent vietnam')],
      ['Cong ty Dai Phat'],
    );
    expect(out.map(e => e.id)).toEqual(['2']);
  });
  it('bỏ thẻ chưa có tên', () => {
    expect(pipelineOnlyCompanies([card('1', '  ')], [])).toEqual([]);
  });
});

describe('pipelineStageLabel', () => {
  it('nhãn giai đoạn tiếng Việt', () => {
    expect(pipelineStageLabel('dam-phan')).toBe('Đàm phán HĐ');
    expect(pipelineStageLabel('quan-tam')).toBe('Quan tâm/Chờ');
    expect(pipelineStageLabel('khong-nhu-cau')).toBe('Không hợp tác');
  });
});
