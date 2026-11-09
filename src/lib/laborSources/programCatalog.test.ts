import { describe, expect, it } from 'vitest';
import {
  PROGRAM_GROUPS, STANDARD_PROGRAMS, buildProgramOptions, groupOptions, planNormalize, programCore, programKeyOf, programMatch,
  programOptionOf, programState, resolveProgram, searchPrograms, slugKey, sourceIdsWithProgram, suggestIndustryIds,
  suggestPrograms, tidyProgramName,
} from './programCatalog';

const std = buildProgramOptions([], []);
const prog = (o: { id?: string; source_id?: string; name: string; program_key?: string }) =>
  ({ id: o.id ?? o.name, source_id: o.source_id ?? 's1', name: o.name, program_key: o.program_key ?? '' });

describe('bộ ngành chuẩn', () => {
  it('khoá không trùng, nhóm hợp lệ', () => {
    const keys = STANDARD_PROGRAMS.map(o => o.key);
    expect(new Set(keys).size).toBe(keys.length);
    const groups = new Set(PROGRAM_GROUPS.map(g => g.key));
    for (const o of STANDARD_PROGRAMS) expect(groups.has(o.group), `${o.key} nhóm ${o.group}`).toBe(true);
  });

  it('khoá chỉ gồm chữ thường, số, gạch ngang (ổn định để lưu DB / lọc)', () => {
    for (const o of STANDARD_PROGRAMS) expect(o.key).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it('không có 2 ngành khác nhau cùng 1 tên (hoặc tên gọi khác) sau chuẩn hoá — nếu có thì nhận ra nhầm', () => {
    const owner = new Map<string, string>();
    const clashes: string[] = [];
    for (const o of STANDARD_PROGRAMS) {
      for (const form of [o.name, ...o.aliases]) {
        const k = programCore(form);
        expect(k, `"${form}" ra khoá trống`).not.toBe('');
        const prev = owner.get(k);
        if (prev && prev !== o.key) clashes.push(`"${form}" (${o.key}) trùng với ${prev} [${k}]`);
        owner.set(k, o.key);
      }
    }
    expect(clashes).toEqual([]);
  });

  it('mỗi tên chuẩn nhận ra đúng chính nó', () => {
    for (const o of STANDARD_PROGRAMS) expect(resolveProgram(o.name, std)?.key).toBe(o.key);
  });

  it('phủ các nhóm ngành công ty trong CRM cần', () => {
    const names = STANDARD_PROGRAMS.map(o => o.name).join(' | ');
    for (const need of ['Điện công nghiệp', 'Điện tử công nghiệp', 'Cơ điện tử', 'Cắt gọt kim loại', 'Hàn', 'Tự động hoá', 'Công nghệ thông tin', 'May thời trang', 'Da giày', 'hoá học', 'Logistics', 'Kế toán', 'Ngôn ngữ Nhật']) {
      expect(names.toLowerCase().replace(/[ôồ]/g, 'o').includes(need.toLowerCase().replace(/[ôồ]/g, 'o')) || STANDARD_PROGRAMS.some(o => resolveProgram(need, std)?.key === o.key), need).toBe(true);
    }
    expect(STANDARD_PROGRAMS.length).toBeGreaterThanOrEqual(70);
  });
});

describe('nhận ra tên nhập tay cũ', () => {
  const k = (s: string) => resolveProgram(s, std)?.key;
  it('khác dấu / hoa thường / dấu gạch / tiền tố', () => {
    expect(k('dien tu cong nghiep')).toBe('dien-tu-cong-nghiep');
    expect(k('  ĐIỆN  TỬ  CÔNG NGHIỆP ')).toBe('dien-tu-cong-nghiep');
    expect(k('Điện tử CN')).toBe('dien-tu-cong-nghiep');
    expect(k('Ngành điện tử công nghiệp')).toBe('dien-tu-cong-nghiep');
    expect(k('Khoa Cơ khí')).toBe('ky-thuat-co-khi');
    expect(k('CN kỹ thuật điện, điện tử')).toBe('dien-dien-tu');
    expect(k('Điện - Điện tử')).toBe('dien-dien-tu');
    expect(k('Công nghệ kỹ thuật cơ điện tử')).toBe('co-dien-tu');
    expect(k('Cơ điện tử (Cao đẳng)')).toBe('co-dien-tu');
    expect(k('Tự động hóa')).toBe('tu-dong-hoa');
    expect(k('Kỹ thuật điều khiển và tự động hóa')).toBe('tu-dong-hoa');
  });

  it('tên gọi khác thường gặp', () => {
    expect(k('CNTT')).toBe('cntt');
    expect(k('Lập trình')).toBe('phan-mem');
    expect(k('May mặc')).toBe('may-thoi-trang');
    expect(k('Da giầy')).toBe('da-giay');
    expect(k('Điện lạnh')).toBe('dien-lanh');
    expect(k('Hóa học')).toBe('hoa-hoc');
    expect(k('QA/QC')).toBe('quan-ly-chat-luong');
    expect(k('Xuất nhập khẩu')).toBe('xuat-nhap-khau');
    expect(k('Tiếng Nhật')).toBe('ngon-ngu-nhat');
    expect(k('Kế toán doanh nghiệp')).toBe('ke-toan');
  });

  it('"Hàn" (kim loại) khác "Tiếng Hàn" (ngôn ngữ); "may" khác "máy"', () => {
    expect(k('Hàn')).toBe('han');
    expect(k('Tiếng Hàn')).toBe('ngon-ngu-han');
    expect(k('Chế tạo máy')).toBe('che-tao-may');
    expect(k('May')).toBe('may-thoi-trang');
  });

  it('không đoán bừa: tên lạ không khớp', () => {
    expect(k('Chăm sóc thú cưng')).toBeUndefined();
    expect(k('')).toBeUndefined();
    expect(k('   ')).toBeUndefined();
  });

  it('"CN" đầu = công nghệ, cuối = công nghiệp', () => {
    expect(programCore('CN thực phẩm')).toBe(programCore('Công nghệ thực phẩm'));
    expect(programCore('Điện CN')).toBe(programCore('Điện công nghiệp'));
  });
});

describe('danh sách chọn gộp bộ chuẩn + danh mục chung + tên cũ', () => {
  it('tên cũ khớp ngành chuẩn thì KHÔNG thành mục riêng; tên lạ thì gộp 1 mục / cách viết', () => {
    const opts = buildProgramOptions([], ['Điện tử CN', 'Điện tử công nghiệp', 'Kỹ thuật pha chế', 'ky thuat pha che', 'Kỹ thuật pha chế', 'Pha chế (TC)']);
    const legacy = opts.filter(o => o.origin === 'legacy');
    expect(legacy).toHaveLength(1);
    expect(legacy[0].name).toBe('Kỹ thuật pha chế'); // cách viết nhiều nhất
    expect(legacy[0].key).toBe('x-pha-che');
    expect(legacy[0].group).toBe('cu');
    expect(opts.filter(o => o.origin === 'standard')).toHaveLength(STANDARD_PROGRAMS.length);
  });

  it('ngành thêm vào danh mục chung hiện ra, đúng nhóm; trùng ngành chuẩn thì bỏ', () => {
    const opts = buildProgramOptions([
      { key: 'x-pha-che', name: 'Kỹ thuật pha chế', group_key: 'thuc-pham' },
      { key: 'x-dien-cong-nghiep', name: 'Điện công nghiệp', group_key: 'dien-dien-tu' },
      { key: 'x-la', name: 'Ngành lạ', group_key: 'nhom-khong-co' },
    ], []);
    const c = opts.filter(o => o.origin === 'custom');
    expect(c.map(o => o.name)).toEqual(['Kỹ thuật pha chế', 'Ngành lạ']);
    expect(c[0].group).toBe('thuc-pham');
    expect(c[1].group).toBe('khac');
  });

  it('nhóm hiển thị theo thứ tự nhóm, nhóm "nhập tay từ trước" ở cuối', () => {
    const opts = buildProgramOptions([], ['Ngành lạ xyz']);
    const g = groupOptions(opts);
    expect(g[0].group.key).toBe('dien-dien-tu');
    expect(g[g.length - 1].group.key).toBe('cu');
    expect(g.reduce((n, x) => n + x.items.length, 0)).toBe(opts.length);
  });
});

describe('tìm trong ô chọn', () => {
  const names = (q: string) => searchPrograms(q, std).map(h => h.option.name);
  it('gõ không dấu vẫn ra; xếp tên bắt đầu bằng chữ gõ lên trước', () => {
    const r = names('dien tu');
    expect(r[0]).toBe('Điện tử công nghiệp');
    expect(r).toContain('Điện tử – Viễn thông');
    expect(r).toContain('Điện tử dân dụng');
  });

  it('tìm theo tên gọi khác và cho biết khớp qua tên nào', () => {
    const hit = searchPrograms('qtkd', std);
    expect(hit[0].option.key).toBe('quan-tri-kinh-doanh');
    expect(hit[0].via).toBe('QTKD');
    expect(names('may lanh')).toContain('Kỹ thuật máy lạnh và điều hoà không khí');
  });

  it('tìm theo tên nhóm; trống = cả danh sách; không có = rỗng', () => {
    expect(names('det may').length).toBeGreaterThan(0);
    expect(names('')).toHaveLength(std.length);
    expect(names('zzzzqq')).toEqual([]);
  });
});

describe('gợi ý ngành chuẩn cho tên lạ', () => {
  it('gần giống thì gợi ý, không liên quan thì không', () => {
    const keys = suggestPrograms('Điện tử viễn thông CĐ K47', std).map(o => o.key);
    expect(keys[0]).toBe('dien-tu-vien-thong');
    expect(suggestPrograms('Chăm sóc thú cưng', std)).toEqual([]);
  });
});

describe('dòng đã lưu ↔ danh mục (dữ liệu cũ không vỡ)', () => {
  it('ok / rename / unknown', () => {
    expect(programState(prog({ name: 'Điện tử công nghiệp' }), std)).toBe('ok');
    expect(programState(prog({ name: 'Điện tử CN' }), std)).toBe('rename');
    expect(programState(prog({ name: 'Nghề lạ' }), std)).toBe('unknown');
  });

  it('chưa chạy migration 215 (không có khoá lưu) mà tên đã chuẩn vẫn là ok và có khoá', () => {
    const p = prog({ name: 'Cơ điện tử' });
    expect(programState(p, std)).toBe('ok');
    expect(programKeyOf(p, std)).toBe('co-dien-tu');
  });

  it('khoá đã lưu thắng tên (đổi tên hiển thị về sau không làm mất ngành)', () => {
    const p = prog({ name: 'Tên cũ nào đó', program_key: 'cntt' });
    expect(programMatch(p, std)?.key).toBe('cntt');
    expect(programState(p, std)).toBe('rename');
    expect(programKeyOf(p, std)).toBe('cntt');
  });

  it('tên lạ: khoá suy từ tên, mở form sửa vẫn có mục để chọn (nhập tay cũ)', () => {
    const p = prog({ name: '  Kỹ thuật pha chế ' });
    expect(programKeyOf(p, std)).toBe('x-pha-che');
    const o = programOptionOf(p, std);
    expect(o.origin).toBe('legacy');
    expect(o.name).toBe('Kỹ thuật pha chế');
    // sau khi tên lạ vào danh sách (từ dữ liệu) thì mục dựng từ danh sách
    const withData = buildProgramOptions([], ['Kỹ thuật pha chế']);
    expect(programOptionOf(p, withData).key).toBe('x-pha-che');
    expect(withData.filter(x => x.key === 'x-pha-che')).toHaveLength(1);
  });

  it('chuẩn hoá: chỉ đổi dòng nhận ra được, bỏ qua dòng sẽ thành trùng trong cùng trường', () => {
    const rows = [
      prog({ id: '1', source_id: 'a', name: 'Điện tử CN' }),
      prog({ id: '2', source_id: 'a', name: 'Điện tử công nghiệp' }), // đã chuẩn → dòng 1 sẽ trùng
      prog({ id: '3', source_id: 'b', name: 'May mặc' }),
      prog({ id: '4', source_id: 'b', name: 'Nghề lạ' }), // không nhận ra → không đụng
      prog({ id: '5', source_id: 'c', name: 'Cơ khí', program_key: 'ky-thuat-co-khi' }),
    ];
    const plan = planNormalize(rows, std);
    expect(plan.map(x => [x.program.id, x.option.name, x.duplicate])).toEqual([
      ['1', 'Điện tử công nghiệp', true],
      ['3', 'May thời trang', false],
      ['5', 'Công nghệ kỹ thuật cơ khí', false],
    ]);
  });

  it('bộ lọc trường theo ngành / theo nhóm (đọc cả tên cũ lẫn khoá đã lưu)', () => {
    const rows = [
      prog({ id: '1', source_id: 'a', name: 'Điện tử CN' }),
      prog({ id: '2', source_id: 'b', name: 'Tên gì đó', program_key: 'dien-tu-cong-nghiep' }),
      prog({ id: '3', source_id: 'c', name: 'Cơ điện tử' }),
      prog({ id: '4', source_id: 'd', name: 'Hàn' }),
    ];
    expect([...sourceIdsWithProgram(rows, std, { key: 'dien-tu-cong-nghiep' })].sort()).toEqual(['a', 'b']);
    expect([...sourceIdsWithProgram(rows, std, { group: 'co-khi' })]).toEqual(['d']);
    expect([...sourceIdsWithProgram(rows, std, { group: 'tu-dong-hoa' })]).toEqual(['c']);
  });
});

describe('khoá & tên', () => {
  it('khoá ngoài bộ chuẩn không phụ thuộc cách viết', () => {
    expect(slugKey('Kỹ thuật pha chế')).toBe(slugKey('ky thuat   PHA CHẾ'));
    expect(slugKey('Công nghệ kỹ thuật pha chế (TC)')).toBe('x-pha-che');
  });
  it('tidy: gọn khoảng trắng, hoa chữ đầu', () => {
    expect(tidyProgramName('  kỹ thuật   pha chế ')).toBe('Kỹ thuật pha chế');
    expect(tidyProgramName('   ')).toBe('');
  });
});

describe('gợi ý ngành công ty theo ngành đào tạo', () => {
  const inds = [
    { id: 'i1', name: 'Dệt may' }, { id: 'i2', name: 'Điện tử' }, { id: 'i3', name: 'Cơ khí chế tạo' },
    { id: 'i4', name: 'Giấy & Bao bì' }, { id: 'i5', name: 'Da giày' }, { id: 'i6', name: 'Thực phẩm' },
  ];
  const opt = (k: string) => std.find(o => o.key === k)!;
  it('khớp theo cụm từ nguyên', () => {
    expect(suggestIndustryIds(opt('may-thoi-trang'), inds)).toEqual(['i1', 'i5']);
    expect(suggestIndustryIds(opt('dien-tu-cong-nghiep'), inds)).toEqual(['i2']);
    expect(suggestIndustryIds(opt('cat-got-kim-loai'), inds)).toEqual(['i3']);
    expect(suggestIndustryIds(opt('thuc-pham'), inds)).toEqual(['i6']);
  });
  it('"giay" (giấy) không nhầm với "da giay" (giày)', () => {
    expect(suggestIndustryIds(opt('da-giay'), inds)).toEqual(['i1', 'i5']);
    expect(suggestIndustryIds(opt('in-bao-bi'), inds)).toEqual(['i4']);
  });
  it('nhóm không gắn ngành công ty (kế toán, ngoại ngữ…) → rỗng', () => {
    expect(suggestIndustryIds(opt('ke-toan'), inds)).toEqual([]);
    expect(suggestIndustryIds(opt('ngon-ngu-nhat'), inds)).toEqual([]);
  });
});
