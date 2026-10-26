// Khung «Cập nhật chi nhánh»: loại hình hiện tại, gợi ý Dự án công ty, lọc ẩn/hiện.
import { describe, expect, it } from 'vitest';
import {
  companyProjectBranchIds, currentBranchType, currentMonthKey, groupTypeHistory,
  setHiddenIds, toggleHiddenId, visibleVisitBranches,
} from './branchVisitRail';
import type { BranchType, BranchTypeHistory } from './types';

const hist = (branch_id: string, branch_type: BranchType, effective_from: string): BranchTypeHistory => ({
  id: `${branch_id}-${effective_from}`, branch_id, branch_type, effective_from,
  manager_name: null, lg_pct: 60, cn_pct: 40, notes: null, created_by: null, created_at: '2026-01-01T00:00:00Z',
});

describe('currentMonthKey', () => {
  it('YYYY-MM, tháng một chữ số có số 0', () => {
    expect(currentMonthKey(new Date(2026, 9, 26))).toBe('2026-10');
    expect(currentMonthKey(new Date(2026, 0, 3))).toBe('2026-01');
  });
});

describe('currentBranchType', () => {
  it('chưa có lịch sử → dùng cột branches.branch_type', () => {
    expect(currentBranchType({ branch_type: 'company' }, undefined, '2026-10')).toBe('company');
    expect(currentBranchType({ branch_type: 'contracted' }, [], '2026-10')).toBe('contracted');
  });

  it('lấy mốc mới nhất đã có hiệu lực, bỏ mốc tương lai', () => {
    const h = [hist('a', 'contracted', '2026-01'), hist('a', 'company', '2026-06'), hist('a', 'contracted', '2027-01')];
    expect(currentBranchType({ branch_type: 'contracted' }, h, '2026-10')).toBe('company');
    expect(currentBranchType({ branch_type: 'contracted' }, h, '2026-03')).toBe('contracted');
    expect(currentBranchType({ branch_type: 'company' }, h, '2027-02')).toBe('contracted');
  });

  it('lịch sử chỉ có mốc tương lai → rơi về cột branch_type', () => {
    expect(currentBranchType({ branch_type: 'company' }, [hist('a', 'contracted', '2030-01')], '2026-10')).toBe('company');
  });

  it('thứ tự mảng không ảnh hưởng', () => {
    const h = [hist('a', 'company', '2026-06'), hist('a', 'contracted', '2026-01')];
    expect(currentBranchType({ branch_type: 'contracted' }, h, '2026-10')).toBe('company');
    expect(currentBranchType({ branch_type: 'contracted' }, [...h].reverse(), '2026-10')).toBe('company');
  });

  it('effective_from dạng ngày đầy đủ vẫn so theo tháng', () => {
    expect(currentBranchType({ branch_type: 'contracted' }, [hist('a', 'company', '2026-10-15')], '2026-10')).toBe('company');
  });
});

describe('companyProjectBranchIds', () => {
  it('gom đúng chi nhánh Dự án công ty theo lịch sử rồi đến cột branch_type', () => {
    const branches = [
      { id: 'a', branch_type: 'contracted' as const },
      { id: 'b', branch_type: 'company' as const },
      { id: 'c', branch_type: 'contracted' as const },
    ];
    const map = groupTypeHistory([hist('a', 'company', '2026-05'), hist('b', 'contracted', '2026-02')]);
    expect(companyProjectBranchIds(branches, map, '2026-10')).toEqual(['a']);
  });
});

describe('lọc ẩn / hiện', () => {
  const items = [{ branch: { id: 'a' } }, { branch: { id: 'b' } }, { branch: { id: 'c' } }];

  it('không ẩn gì → giữ nguyên', () => {
    expect(visibleVisitBranches(items, [])).toBe(items);
  });

  it('bỏ các chi nhánh đã ẩn, kể cả id không còn tồn tại', () => {
    expect(visibleVisitBranches(items, ['b', 'đã-xoá']).map(x => x.branch.id)).toEqual(['a', 'c']);
    expect(visibleVisitBranches(items, ['a', 'b', 'c'])).toEqual([]);
  });

  it('toggleHiddenId đảo từng chi nhánh', () => {
    expect(toggleHiddenId([], 'a')).toEqual(['a']);
    expect(toggleHiddenId(['a', 'b'], 'a')).toEqual(['b']);
  });

  it('setHiddenIds ẩn / hiện cả nhóm, không trùng và không đụng chi nhánh khác', () => {
    expect(setHiddenIds(['a'], ['a', 'b'], true)).toEqual(['a', 'b']);
    expect(setHiddenIds(['a', 'b', 'c'], ['b', 'x'], false)).toEqual(['a', 'c']);
  });
});
