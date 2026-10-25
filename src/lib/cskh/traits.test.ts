// Port từ PRM Tony Study (traits.test.mjs, education.test.mjs, search.test.mjs — phần thẻ / trường).
import { describe, expect, it } from 'vitest';
import {
  addTag, buildTagStats, hasTrait, joinTags, parseTraitFilter, splitTags, suggestTags, traitFilterValue, traitTags,
  type TraitSource,
} from './traits';
import {
  buildSchoolIndex, canonicalSchoolName, cleanEducation, sameEducation, schoolKey, suggestSchools, tidySchoolName,
} from './education';
import { contactSearchHaystack, matchesQuery } from './search';
import type { Education } from './types';

const c = (over: Partial<TraitSource> = {}): TraitSource => ({ interests: [], habits: '', personality: '', rememberNotes: {}, ...over });

describe('thẻ đặc điểm dùng chung', () => {
  it('chữ cũ tách thành thẻ, bỏ trùng không phân biệt dấu / hoa', () => {
    expect(splitTags('Chạy bộ mỗi sáng 5h, không uống bia;  golf\nGolf , ')).toEqual(['Chạy bộ mỗi sáng 5h', 'không uống bia', 'golf']);
    expect(joinTags(['Golf', 'Cà phê'])).toBe('Golf, Cà phê');
    expect(traitTags(c({ rememberNotes: { avoid: 'Rượu bia, đồ cay' } }), 'avoid')).toEqual(['Rượu bia', 'đồ cay']);
  });

  it('thống kê thẻ trên cả danh bạ: đếm số người, cách viết phổ biến nhất', () => {
    const stats = buildTagStats([c({ interests: ['Golf', 'Cà phê'] }), c({ interests: ['golf'] }), c({ interests: ['Golf'] })], 'interests');
    expect(stats[0]).toEqual({ key: 'golf', label: 'Golf', count: 3 });
    expect(stats[1].label).toBe('Cà phê');
  });

  it('gợi ý: thẻ người khác + thẻ mẫu, bỏ thẻ đã chọn, gõ không dấu vẫn ra', () => {
    const stats = [{ key: 'golf', label: 'Golf', count: 3 }, { key: 'ca phe muoi', label: 'Cà phê muối', count: 1 }];
    const presets = ['Cà phê', 'Golf', 'Du lịch'];
    expect(suggestTags(stats, presets, ['golf'], '', 10).map(s => s.label)).toEqual(['Cà phê muối', 'Cà phê', 'Du lịch']);
    expect(suggestTags(stats, presets, [], 'ca ph', 10).map(s => s.label)).toEqual(['Cà phê muối', 'Cà phê']);
    expect(suggestTags(stats, presets, [], 'lich', 10).map(s => s.label)).toEqual(['Du lịch']);
  });

  it('thêm thẻ: dùng cách viết chung, không trùng, gõ nhiều thẻ bằng dấu phẩy', () => {
    const stats = [{ key: 'golf', label: 'Golf', count: 3 }];
    expect(addTag(['Du lịch'], 'GOLF', stats, [])).toEqual(['Du lịch', 'Golf']);
    expect(addTag(['Golf'], 'golf', stats, [])).toEqual(['Golf']);
    expect(addTag([], 'ca phe, Đọc sách', [], ['Cà phê'])).toEqual(['Cà phê', 'Đọc sách']);
    expect(addTag([], '   ', [], [])).toEqual([]);
  });

  it('bộ lọc theo đặc điểm', () => {
    const v = traitFilterValue('habits', 'day som');
    expect(parseTraitFilter(v)).toEqual({ field: 'habits', key: 'day som' });
    expect(parseTraitFilter('all')).toBeNull();
    expect(parseTraitFilter('xyz:abc')).toBeNull();
    expect(hasTrait(c({ habits: 'Dậy sớm, Ngủ trưa' }), 'habits', 'day som')).toBe(true);
    expect(hasTrait(c({ habits: 'Dậy sớm' }), 'interests', 'day som')).toBe(false);
  });
});

const people: { id: string; education: Education[] }[] = [
  { id: 'a', education: [{ level: 'university', school: 'Đại học Kinh tế TP.HCM' }, { level: 'high_school', school: 'THPT Lê Quý Đôn' }] },
  { id: 'b', education: [{ level: 'master', school: '  đại học   kinh tế tp hcm ' }] },
  { id: 'c', education: [{ level: 'university', school: 'Đại học Kinh tế TP.HCM' }, { level: 'master', school: 'ĐẠI HỌC KINH TẾ TP.HCM' }] },
  { id: 'd', education: [{ level: 'university', school: 'Đại học Bách Khoa' }] },
  { id: 'e', education: [] },
];

describe('học vấn', () => {
  it('khoá trường không phân biệt hoa/thường, dấu, khoảng trắng, dấu chấm', () => {
    expect(schoolKey('Đại học Kinh tế TP.HCM')).toBe(schoolKey('  dai hoc  KINH te tp hcm'));
    expect(schoolKey('ĐH Bách Khoa - TP.HCM')).toBe('dh bach khoa tp hcm');
    expect(schoolKey('Đại học Bách Khoa')).not.toBe(schoolKey('Đại học Kinh tế'));
    expect(tidySchoolName('  THPT   Lê  Quý Đôn ')).toBe('THPT Lê Quý Đôn');
  });

  it('danh bạ trường: gộp cách viết, tên chuẩn = cách viết dùng nhiều nhất, đếm người không đếm dòng', () => {
    const idx = buildSchoolIndex(people);
    const ueh = idx.get(schoolKey('Đại học Kinh tế TP.HCM'));
    expect(ueh?.name).toBe('Đại học Kinh tế TP.HCM');
    expect([...(ueh?.contactIds ?? [])].sort()).toEqual(['a', 'b', 'c']);
    expect(idx.size).toBe(3);
  });

  it('gợi ý: gõ không dấu ra trường có dấu, ưu tiên bắt đầu bằng rồi đông người', () => {
    const idx = buildSchoolIndex(people);
    expect(suggestSchools(idx, 'kinh te').map(s => s.name)).toEqual(['Đại học Kinh tế TP.HCM']);
    expect(suggestSchools(idx, 'dai hoc').map(s => s.name)).toEqual(['Đại học Kinh tế TP.HCM', 'Đại học Bách Khoa']);
    expect(suggestSchools(idx, 'thpt').map(s => s.name)).toEqual(['THPT Lê Quý Đôn']);
    expect(suggestSchools(idx, 'ngoai thuong')).toHaveLength(0);
    expect(suggestSchools(idx, '')[0].name).toBe('Đại học Kinh tế TP.HCM');
    expect(suggestSchools(idx, '', 1)).toHaveLength(1);
  });

  it('lưu: trùng trường đã có thì dùng đúng tên đã có, trường mới giữ nguyên cách viết', () => {
    const idx = buildSchoolIndex(people);
    expect(canonicalSchoolName('dai hoc kinh te tp.hcm', idx)).toBe('Đại học Kinh tế TP.HCM');
    expect(canonicalSchoolName('  Đại học  Ngoại thương ', idx)).toBe('Đại học Ngoại thương');
    expect(canonicalSchoolName('Đại học Ngoại thương')).toBe('Đại học Ngoại thương');
  });

  it('làm sạch: bỏ dòng trống, bậc lạ → rỗng, bỏ trùng, dữ liệu hỏng → mảng rỗng', () => {
    const idx = buildSchoolIndex(people);
    expect(cleanEducation([
      { level: 'university', school: 'đại học bách khoa' },
      { level: '', school: '   ' },
      { level: 'university', school: 'Đại học Bách Khoa' },
      { level: 'phd', school: 'Viện X' },
      { level: 'master', school: '' },
      null, 'rác',
    ], idx)).toEqual([
      { level: 'university', school: 'Đại học Bách Khoa' },
      { level: '', school: 'Viện X' },
      { level: 'master', school: '' },
    ]);
    expect(cleanEducation(null)).toEqual([]);
    expect(cleanEducation({ school: 'X' })).toEqual([]);
    expect(cleanEducation(Array.from({ length: 15 }, (_, i) => ({ level: 'other', school: `T${i}` })))).toHaveLength(10);
  });

  it('so sánh để chỉ ghi khi có thay đổi', () => {
    const a: Education[] = [{ level: 'university', school: 'A' }];
    expect(sameEducation(a, [{ level: 'university', school: 'A' }])).toBe(true);
    expect(sameEducation(a, [{ level: 'master', school: 'A' }])).toBe(false);
    expect(sameEducation([], [])).toBe(true);
    expect(sameEducation(a, [])).toBe(false);
  });
});

describe('tìm kiếm khớp cả trường, sở thích, quê', () => {
  const base = { fullName: 'Ms Lan', nickname: '', organization: 'Midea', jobTitle: 'HR', phones: [], emails: [] };
  it('tên trường không dấu', () => {
    const h = contactSearchHaystack({ ...base, education: [{ level: 'university', school: 'Đại học Kinh tế TP.HCM' }] });
    expect(matchesQuery(h, 'kinh te')).toBe(true);
    expect(matchesQuery(h, 'bach khoa')).toBe(false);
  });
  it('sở thích, thói quen, tính cách, quê quán', () => {
    const h = contactSearchHaystack({ ...base, interests: ['Golf', 'Cà phê'], habits: 'Dậy sớm', personality: 'Trọng chữ tín', originProvince: 'Nam Định' });
    expect(matchesQuery(h, 'golf')).toBe(true);
    expect(matchesQuery(h, 'day som')).toBe(true);
    expect(matchesQuery(h, 'chu tin')).toBe(true);
    expect(matchesQuery(h, 'nam dinh')).toBe(true);
  });
});
