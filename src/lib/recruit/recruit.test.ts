import { describe, it, expect } from 'vitest';
import { cleanName, foldVn, formatPhone, normalizeIdNumber, normalizePhone, parseBirthYear } from './normalize';
import { buildPlanMatrix, cellTone, monthLabel, monthRange, parseHeaderMonths, parsePlanGrid, parseQty } from './plan';
import { guessField, mapHeaders, parseDateCell, parseEducation, parseGender, prepareImport } from './importRows';
import { jobPostText, moneyShort, salaryText } from './jobPost';
import { closeOptions, nextStage, stageOrder, tabCount } from './stages';
import type { HireCount, RecruitPosition, RecruitSite, RecruitTarget } from './types';

const site = (id: string, name: string): RecruitSite => ({
  id, project_id: 'p', name, zone_name: '', branch_id: null, client_id: null, address: '', lat: null, lng: null, sort_order: 0,
});
const position = (over: Partial<RecruitPosition> = {}): RecruitPosition => ({
  id: 'pos', project_id: 'p', title: 'Công nhân', group_code: 'B', employment_type: 'direct', confirmed: true, is_open: true,
  site_ids: [], salary_min: null, salary_max: null, salary_note: '', hours_per_week: null, shift_note: '', description: '',
  requirements: '', benefits: '', education_min: '', age_min: null, age_max: null, gender_pref: 'any', cleanroom: false,
  fee_override: null, sort_order: 0, ...over,
});

describe('Chuẩn hoá ứng viên', () => {
  it('SĐT: +84, 84, thiếu số 0, có dấu cách/chấm', () => {
    expect(normalizePhone('+84 912 345 678')).toBe('0912345678');
    expect(normalizePhone('84912345678')).toBe('0912345678');
    expect(normalizePhone('912345678')).toBe('0912345678');
    expect(normalizePhone('0912.345.678')).toBe('0912345678');
    expect(normalizePhone('')).toBe('');
    expect(formatPhone('0912345678')).toBe('0912 345 678');
  });
  it('CCCD chỉ giữ chữ số', () => {
    expect(normalizeIdNumber('079 199 001 234')).toBe('079199001234');
  });
  it('năm sinh từ nhiều kiểu ô', () => {
    expect(parseBirthYear('1999', 2026)).toBe(1999);
    expect(parseBirthYear(1999, 2026)).toBe(1999);
    expect(parseBirthYear('12/05/2001', 2026)).toBe(2001);
    expect(parseBirthYear('2001-05-12', 2026)).toBe(2001);
    expect(parseBirthYear(36293, 2026)).toBe(1999); // số ngày Excel của 1999-05-12
    expect(parseBirthYear('abc', 2026)).toBeNull();
    expect(parseBirthYear('', 2026)).toBeNull();
  });
  it('họ tên: chỉ sửa khi viết thường/HOA hết', () => {
    expect(cleanName('  nguyễn   văn ánh ')).toBe('Nguyễn Văn Ánh');
    expect(cleanName('TRẦN THỊ BÌNH')).toBe('Trần Thị Bình');
    expect(cleanName('Lê văn Cường')).toBe('Lê văn Cường');
  });
  it('bỏ dấu tiếng Việt', () => {
    expect(foldVn('Nguyễn Đức Thắng')).toBe('nguyen duc thang');
    expect(foldVn('Nhơn Trạch'.normalize('NFD'))).toBe('nhon trach');
  });
});

describe('Bảng chỉ tiêu', () => {
  it('khoảng tháng qua năm mới, nhãn T11/26', () => {
    expect(monthRange('2026-11', '2027-04')).toEqual(['2026-11', '2026-12', '2027-01', '2027-02', '2027-03', '2027-04']);
    expect(monthRange('2026-11', null)).toEqual(['2026-11']);
    expect(monthRange('2027-04', '2026-11')).toEqual(['2027-04']);
    expect(monthRange('sai', '2027-01')).toEqual([]);
    expect(monthLabel('2027-01')).toBe('T1/27');
  });
  it('số kiểu VN và gạch ngang', () => {
    expect(parseQty('1.024')).toBe(1024);
    expect(parseQty('1,200')).toBe(1200);
    expect(parseQty('—')).toBe(0);
    expect(parseQty('-')).toBe(0);
    expect(parseQty('12a')).toBeNull();
  });
  it('tiêu đề tháng như file KH gửi', () => {
    expect(parseHeaderMonths('Nhà máy T11 /26 T12/26 T1/27 T2/27 T3/27 T4/27 Tổng'))
      .toEqual(['2026-11', '2026-12', '2027-01', '2027-02', '2027-03', '2027-04']);
    expect(parseHeaderMonths('Tháng 12/2026\t2027-01')).toEqual(['2026-12', '2027-01']);
  });

  const sites = [site('s1', 'VSIP 1'), site('s3', 'VSIP 3'), site('n2', 'NT2')];
  const pdfText = `2. Bảng chỉ tiêu theo nhà máy và tháng
Nhà máy T11 /26 T12/26 T1/27 T2/27 T3/27 T4/27 Tổng
VSIP 1 250 46 279 — — — 575
VSIP 3 249 445 99 611 675 1.024 3.103
NT2 — — 633 — — 1.200 1.833
Tổng 499 491 1.011 611 675 2.224 5.511`;

  it('đọc đúng bảng dán từ PDF Co-Herent (5.511)', () => {
    const r = parsePlanGrid(pdfText, sites, []);
    expect(r.unknownSites).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.months).toHaveLength(6);
    expect(r.cells).toHaveLength(18);
    expect(r.cells.reduce((s, c) => s + c.qty, 0)).toBe(5511);
    expect(r.cells.find(c => c.siteId === 's3' && c.month === '2027-04')?.qty).toBe(1024);
    expect(r.cells.find(c => c.siteId === 'n2' && c.month === '2026-11')?.qty).toBe(0);
  });
  it('dán từ Excel (tab) không tiêu đề → dùng tháng của dự án; báo nhà máy lạ & cột tổng lệch', () => {
    const r = parsePlanGrid('VSIP 1\t250\t46\t279\t0\t0\t0\t600\nNhà máy X\t1\t2\t3\t4\t5\t6', sites,
      monthRange('2026-11', '2027-04'));
    expect(r.cells.filter(c => c.siteId === 's1').map(c => c.qty)).toEqual([250, 46, 279, 0, 0, 0]);
    expect(r.unknownSites).toEqual(['Nhà máy X']);
    expect(r.warnings[0]).toContain('cột Tổng ghi 600');
  });
  it('tên nhà máy so khớp không dấu', () => {
    const r = parsePlanGrid('nhon trach 2 10 20', [site('x', 'Nhơn Trạch 2')], ['2026-11', '2026-12']);
    expect(r.cells.map(c => c.qty)).toEqual([10, 20]);
  });

  it('ma trận kế hoạch vs thực tế, bỏ vị trí khảo sát và ô huỷ', () => {
    const months = monthRange('2026-11', '2026-12');
    const targets: RecruitTarget[] = [
      { id: '1', project_id: 'p', site_id: 's1', position_id: null, month: '2026-11', qty: 250, status: 'planned', note: '' },
      { id: '2', project_id: 'p', site_id: 's1', position_id: 'qc', month: '2026-11', qty: 10, status: 'planned', note: '' },
      { id: '3', project_id: 'p', site_id: 's3', position_id: null, month: '2026-12', qty: 445, status: 'confirmed', note: '' },
      { id: '4', project_id: 'p', site_id: 's3', position_id: null, month: '2026-11', qty: 99, status: 'cancelled', note: '' },
    ];
    const hires: HireCount[] = [
      { project_id: 'p', site_id: 's1', position_id: 'pos', month: '2026-11', started: 120, fee_ok: 0, left_count: 3 },
      { project_id: 'p', site_id: 's1', position_id: null, month: '2027-02', started: 5, fee_ok: 0, left_count: 0 },
    ];
    const m = buildPlanMatrix({ months, sites, positions: [position({ id: 'qc', confirmed: false }), position()], targets, hires });
    expect(m.rows[0].cells['2026-11']).toMatchObject({ target: 250, started: 120 });
    expect(m.rows[0].total).toMatchObject({ target: 250, started: 125 });
    expect(m.surveyQty).toBe(10);
    expect(m.rows[1].cells['2026-11'].target).toBe(0);
    expect(m.totals['2026-12']).toMatchObject({ target: 445, confirmed: true });
    expect(m.grand.target).toBe(695);
    const only = buildPlanMatrix({ months, sites, positions: [], targets, hires, positionId: null });
    expect(only.rows[0].cells['2026-11'].started).toBe(0);
  });
  it('màu ô theo tiến độ', () => {
    const c = { target: 100, confirmed: false, started: 40, scheduled: 0 };
    expect(cellTone(c, '2026-10', '2026-11')).toBe('behind');
    expect(cellTone(c, '2026-11', '2026-11')).toBe('progress');
    expect(cellTone(c, '2026-12', '2026-11')).toBe('future');
    expect(cellTone({ ...c, started: 100 }, '2026-12', '2026-11')).toBe('done');
  });
});

describe('Nhập Excel', () => {
  it('nhận diện tiêu đề cột', () => {
    expect(mapHeaders(['STT', 'Họ và tên', 'Số điện thoại', 'Năm sinh', 'Giới tính', 'CCCD', 'Xã/Phường', 'Tỉnh/TP', 'Trình độ', 'Nguồn', 'Ghi chú']))
      .toEqual([null, 'full_name', 'phone', 'birth_year', 'gender', 'id_number', 'commune', 'province', 'education', 'source_channel', 'note']);
    expect(guessField('SĐT Zalo')).toBe('phone');
    expect(guessField('Ngày nhận việc dự kiến')).toBe('planned_start');
    expect(guessField('Ngày đi làm')).toBe('start_date');
    expect(guessField('Người giới thiệu')).toBe('referrer_name');
    expect(guessField('Tình trạng')).toBeNull();
    expect(mapHeaders(['Tên', 'Họ tên'])).toEqual(['full_name', null]);
  });
  it('giới tính, trình độ, ngày', () => {
    expect(parseGender('Nữ')).toBe('female');
    expect(parseGender('nam')).toBe('male');
    expect(parseGender('?')).toBeNull();
    expect(parseEducation('12/12')).toBe('thpt');
    expect(parseEducation('Cao Đẳng điện')).toBe('cao_dang');
    expect(parseEducation('Trung cấp')).toBe('trung_cap');
    expect(parseEducation('9')).toBe('thcs');
    expect(parseDateCell('05/11/2026')).toBe('2026-11-05');
    expect(parseDateCell(46331)).toBe('2026-11-05');
    expect(parseDateCell('x')).toBe('');
  });
  it('lọc dòng lỗi + trùng trong file, giữ số dòng Excel', () => {
    const mapping = mapHeaders(['Họ tên', 'SĐT', 'Năm sinh']);
    const r = prepareImport([
      ['nguyễn văn a', '0912 345 678', 1999],
      ['', '', ''],
      ['B', '0912345678', 2000],
      ['C', '', ''],
      ['D', '12345', ''],
      ['E', '84987654321', '2001'],
    ], mapping);
    expect(r.rows.map(x => [x.full_name, x.phone, x.birth_year])).toEqual([['Nguyễn Văn A', '0912345678', 1999], ['E', '0987654321', 2001]]);
    expect(r.rejected.map(x => x.row)).toEqual([4, 5, 6]);
  });
});

describe('Tin tuyển dụng', () => {
  it('lương dạng ngắn', () => {
    expect(moneyShort(12_000_000)).toBe('12 triệu');
    expect(moneyShort(12_500_000)).toBe('12,5 triệu');
    expect(moneyShort(650_000)).toBe('650.000đ');
    expect(salaryText({ salary_min: 12_000_000, salary_max: 20_000_000, salary_note: '' })).toBe('12 – 20 triệu/tháng');
    expect(salaryText({ salary_min: null, salary_max: null, salary_note: '' })).toBe('Thoả thuận');
  });
  it('dựng tin như mẫu Co-Herent (Trưởng ca)', () => {
    const p = position({
      title: 'Trưởng ca sản xuất', salary_min: 12_000_000, salary_max: 20_000_000, hours_per_week: 48, shift_note: '3 ca luân phiên',
      education_min: 'trung_cap', site_ids: ['s1'], description: 'Sắp xếp công nhân chạy theo kế hoạch\n- Đào tạo người mới',
      benefits: 'Phụ cấp chuyên cần 650.000đ/tháng\nThưởng tháng 13', requirements: 'Tối thiểu 2 năm kinh nghiệm giám sát chuyền', cleanroom: true,
    });
    const t = jobPostText({ project: { name: 'Co-Herent', no_worker_fee: true }, position: p, sites: [site('s1', 'VSIP 1'), site('s3', 'VSIP 3')],
      applyUrl: 'https://x/#/apply/ABC123', contactPhone: '0909 000 111' });
    expect(t).toContain('CO-HERENT TUYỂN DỤNG: TRƯỞNG CA SẢN XUẤT');
    expect(t).toContain('Mức lương: 12 – 20 triệu/tháng');
    expect(t).toContain('Địa điểm làm việc: VSIP 1');
    expect(t).not.toContain('VSIP 3');
    expect(t).toContain('48 giờ/tuần · 3 ca luân phiên');
    expect(t).toContain('- Đào tạo người mới');
    expect(t).toContain('- Tốt nghiệp Trung cấp trở lên');
    expect(t).toContain('phòng sạch');
    expect(t).toContain('Không thu bất kỳ khoản phí nào');
    expect(t).toContain('#/apply/ABC123');
    expect(jobPostText({ project: { name: 'X', no_worker_fee: false }, position: p, sites: [], emoji: false })).not.toMatch(/📢|💰/);
  });
});

describe('Các bước', () => {
  it('bước kế tiếp; thời vụ dừng ở Đã nhận việc', () => {
    expect(nextStage('new')).toBe('contacted');
    expect(nextStage('started')).toBe('fee_ok');
    expect(nextStage('started', 'leasing')).toBeNull();
    expect(nextStage('done')).toBeNull();
    expect(nextStage('left')).toBeNull();
  });
  it('thứ tự, cách đóng, đếm theo tab', () => {
    expect(stageOrder('ready')).toBeLessThan(stageOrder('started'));
    expect(stageOrder('done')).toBeLessThan(stageOrder('rejected'));
    expect(closeOptions('ready')).toEqual(['no_show', 'dropped']);
    expect(closeOptions('started')).toEqual(['left']);
    expect(closeOptions('left')).toEqual([]);
    expect(tabCount('working', { started: 3, fee_ok: 2, new: 9 })).toBe(5);
  });
});
