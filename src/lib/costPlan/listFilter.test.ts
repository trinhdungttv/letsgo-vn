import { describe, it, expect } from 'vitest';
import { planBelongsTo, planCountsByPipeline } from './listFilter';
import type { CostPlanRow } from './types';

const P = (o: Partial<CostPlanRow>) => ({ pipeline_id: null, client_id: null, company_name: null, status: 'draft', ...o }) as CostPlanRow;

describe('phương án giá theo công ty (mở từ CRM Pipeline)', () => {
  it('khớp theo dòng CRM, khách hàng đã liên kết, hoặc cùng tên công ty', () => {
    const c = { pipelineId: 'p1', clientId: 'c1', companyName: 'CÔNG TY TNHH POU CHEN VIỆT NAM' };
    expect(planBelongsTo(P({ pipeline_id: 'p1' }), c)).toBe(true);
    expect(planBelongsTo(P({ client_id: 'c1' }), c)).toBe(true);
    expect(planBelongsTo(P({ company_name: 'công ty tnhh  pou chen việt nam ' }), c)).toBe(true);
    expect(planBelongsTo(P({ pipeline_id: 'p2', company_name: 'TCL' }), c)).toBe(false);
    expect(planBelongsTo(P({ company_name: '' }), { pipelineId: 'x', companyName: '' })).toBe(false);
  });
  it('đếm số phương án mỗi công ty, bỏ phương án Lưu trữ', () => {
    const plans = [P({ pipeline_id: 'p1' }), P({ company_name: 'TCL' }), P({ pipeline_id: 'p1', status: 'archived' }), P({ pipeline_id: 'p1', status: 'final' })];
    expect(planCountsByPipeline(plans, [{ id: 'p1', company_name: 'A' }, { id: 'p2', company_name: 'TCL' }, { id: 'p3', company_name: 'B' }]))
      .toEqual({ p1: 2, p2: 1 });
  });
});
