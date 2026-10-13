import { describe, it, expect } from 'vitest';
import { sourceNameOptions, matchesSourceFilter, sourceKey, cleanSource, sourceShortLabel, sourceFullLabel, sourceFilterGroups, DEFAULT_DEPARTMENTS } from './pipelineSource';

const rows = [
  { source_type: 'partner', source_name: 'Mr Dương - China' },
  { source_type: 'partner', source_name: 'mr dương  - china ' },
  { source_type: 'partner', source_name: 'Mr Dương - China' },
  { source_type: 'partner', source_name: 'Chị Hoa' },
  { source_type: 'sale', source_name: 'Lan' },
  { source_type: 'partner', source_name: '  ' },
];

describe('danh sách người giới thiệu cho ô chọn', () => {
  it('công ty: phòng ban mặc định + phòng ban tự thêm, lọc theo từng phòng ban', () => {
    const r = [{ source_type: 'company', source_name: 'Phòng marketing' }, { source_type: 'company', source_name: 'Phòng Pháp chế' }, { source_type: 'company', source_name: null }];
    expect(sourceNameOptions(r, 'company', DEFAULT_DEPARTMENTS).map(o => `${o.name}:${o.count}:${o.preset}`))
      .toEqual(['Phòng marketing:1:true', 'Phòng Pháp chế:1:false', 'Ban điều hành:0:true', 'Phòng Nhân sự:0:true']);
    expect(sourceKey({ source_type: 'company', source_name: 'Phòng Marketing' })).toBe('company:phòng marketing');
    expect(sourceKey({ source_type: 'company', source_name: null })).toBe('company:');
    expect(matchesSourceFilter({ source_type: 'company', source_name: null }, 'type:company')).toBe(true);
    expect(cleanSource({ source_type: 'company', source_name: '  Ban  điều hành ', source_branch_id: 'x' })).toEqual({ source_type: 'company', source_name: 'Ban điều hành', source_branch_id: null });
    expect(sourceShortLabel({ source_type: 'company', source_name: null }, [])).toBe('Công ty');
    expect(sourceFullLabel({ source_type: 'company', source_name: 'Phòng Nhân sự' }, [])).toBe("Công ty (Let's Go) — Phòng Nhân sự");
    const g = sourceFilterGroups(r as never, []).find(x => x.label === 'Công ty / Chi nhánh')!;
    expect(g.options.map(o => `${o.label}:${o.count}`)).toEqual(['Tất cả công ty:3', 'Chưa ghi phòng ban:1', 'Phòng marketing:1', 'Phòng Pháp chế:1']);
  });
  it('gộp tên trùng (hoa/thường, khoảng trắng), đếm số dự án, lấy cách viết dùng nhiều nhất, nhiều dự án trước', () => {
    expect(sourceNameOptions(rows, 'partner')).toEqual([
      { name: 'Mr Dương - China', count: 3, preset: false },
      { name: 'Chị Hoa', count: 1, preset: false },
    ]);
  });
  it('sale: thêm nhân viên chưa có dự án, đánh dấu nhân viên', () => {
    expect(sourceNameOptions(rows, 'sale', ['lan', 'Minh', null])).toEqual([
      { name: 'Lan', count: 1, preset: true },
      { name: 'Minh', count: 0, preset: true },
    ]);
  });
  it('lọc theo người giới thiệu khớp mọi cách viết đã gộp', () => {
    const key = sourceKey({ source_type: 'partner', source_name: 'Mr Dương - China' });
    expect(rows.filter(r => matchesSourceFilter(r as never, key))).toHaveLength(3);
  });
});
