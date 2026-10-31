import { describe, expect, it } from 'vitest';
import {
  agendaCompanies, agendaTitle, buildCompanyAgenda, buildCompanyAlerts, countryKey, draftFromCompany,
  isEmptyCompanyPlan, mergeCountryNames, parseDateInput, planCompanySave,
  type CompanyLite, type CompanyOccasion, type NationalHoliday,
} from './companyDates';
import { pruneSeenKeys } from './occasions';

const co = (over: Partial<CompanyOccasion> = {}): CompanyOccasion => ({
  id: 'o1', clientId: 'a', kind: 'founding', title: 'Thành lập', day: 3, month: 11, year: 2016,
  isLunar: false, note: '', isArchived: false, ...over,
});
const nh = (over: Partial<NationalHoliday> = {}): NationalHoliday => ({
  id: 'h1', country: 'Hàn Quốc', title: 'Tết Chuseok (Trung thu)', localName: '추석', day: 15, month: 8,
  isLunar: true, tip: '', isArchived: false, ...over,
});
const clients: CompanyLite[] = [
  { id: 'a', name: 'AQUA', leaderCountry: 'Nhật Bản' },
  { id: 'b', name: 'CHERVON', leaderCountry: ' hàn  quốc ' },
  { id: 'c', name: 'AMPACS', leaderCountry: 'Hàn Quốc' },
  { id: 'd', name: 'DONGSUNG', leaderCountry: null },
];

describe('nhập ngày nhanh', () => {
  it('đọc nhiều kiểu gõ', () => {
    expect(parseDateInput('15/8')).toEqual({ day: 15, month: 8, year: null });
    expect(parseDateInput(' 15/08/2010 ')).toEqual({ day: 15, month: 8, year: 2010 });
    expect(parseDateInput('15-8-2010')).toEqual({ day: 15, month: 8, year: 2010 });
    expect(parseDateInput('15.8')).toEqual({ day: 15, month: 8, year: null });
    expect(parseDateInput('2010-08-15')).toEqual({ day: 15, month: 8, year: 2010 });
    expect(parseDateInput('')).toBeNull();
  });

  it('báo sai: ngày không có thật, năm 2 chữ số, chữ', () => {
    expect(parseDateInput('31/4')).toBe('invalid');
    expect(parseDateInput('29/2/2023')).toBe('invalid');
    expect(parseDateInput('29/2')).toEqual({ day: 29, month: 2, year: null });
    expect(parseDateInput('15/8/10')).toBe('invalid');
    expect(parseDateInput('mùng 1 tết')).toBe('invalid');
    // Âm lịch: tối đa 30, tháng nào cũng được
    expect(parseDateInput('30/2', true)).toEqual({ day: 30, month: 2, year: null });
    expect(parseDateInput('31/1', true)).toBe('invalid');
  });
});

describe('quốc gia', () => {
  it('so khớp không phân biệt hoa/thường, khoảng trắng', () => {
    expect(countryKey(' Hàn  Quốc ')).toBe(countryKey('hàn quốc'));
    expect(countryKey(null)).toBe('');
    expect(mergeCountryNames(['Nhật Bản', 'Hàn Quốc'], ['hàn quốc', null, 'Đức'])).toEqual(['Đức', 'Hàn Quốc', 'Nhật Bản']);
  });
});

describe('lịch sắp tới', () => {
  it('ngày công ty + lễ quốc gia gom nhiều công ty, gần nhất trước', () => {
    // 15/8 âm lịch 2027 = 15/9/2027; hôm nay 31/10/2026 → 3/11 còn 3 ngày
    const items = buildCompanyAgenda({
      clients, occasions: [co()], holidays: [nh(), nh({ id: 'h2', country: 'Nhật Bản', title: 'Tết Shōgatsu', day: 1, month: 1, isLunar: false })],
      today: '2026-10-31', withinDays: 400,
    });
    expect(items.map(i => [i.key, i.nextIso, i.daysUntil])).toEqual([
      ['co:o1', '2026-11-03', 3],
      ['nh:h2', '2027-01-01', 62],
      ['nh:h1', '2027-09-15', 319],
    ]);
    expect(agendaTitle(items[0])).toBe('Kỷ niệm 10 năm thành lập');
    expect(agendaCompanies(items[2])).toBe('AMPACS, CHERVON');
  });

  it('bỏ: ngày đã xoá, công ty ngoài danh sách, nước không có công ty, quá hạn xem', () => {
    const items = buildCompanyAgenda({
      clients,
      occasions: [co({ isArchived: true }), co({ id: 'o2', clientId: 'zzz' }), co({ id: 'o3', day: 1, month: 1 })],
      holidays: [nh({ country: 'Đức' }), nh({ id: 'h3', isArchived: true })],
      today: '2026-10-31',
    });
    expect(items).toEqual([]);
  });

  it('tên dòng: kỷ niệm có năm, âm lịch không tính tròn năm, ngày lễ công ty giữ tên', () => {
    // 2/11 âm lịch rơi vào tháng 12 dương → xếp sau cùng
    const [a, c, b] = buildCompanyAgenda({
      clients,
      occasions: [
        co({ id: 'x', kind: 'anniversary', title: 'Khánh thành nhà máy 2', day: 1, month: 11, year: 2020 }),
        co({ id: 'y', kind: 'founding', day: 2, month: 11, year: 2001, isLunar: true }),
        co({ id: 'z', kind: 'holiday', title: 'Ngày hội gia đình', day: 4, month: 11, year: null }),
      ],
      holidays: [], today: '2026-10-31', withinDays: 60,
    });
    expect(agendaTitle(a)).toBe('Khánh thành nhà máy 2 · tròn 6 năm');
    expect(agendaTitle(c)).toBe('Ngày hội gia đình');
    expect(b.type === 'company' && b.years).toBeNull();
  });

  it('hôm nay vẫn nằm trong danh sách', () => {
    expect(buildCompanyAgenda({ clients, occasions: [co({ day: 31, month: 10 })], holidays: [], today: '2026-10-31' })[0].daysUntil).toBe(0);
  });
});

describe('popup khi mở app: trước 2 ngày + đúng ngày', () => {
  const input = { clients, occasions: [co()], holidays: [nh({ day: 3, month: 11, isLunar: false })] };
  it('D-3 chưa báo, D-2 và D-1 cùng khoá "trước", D-0 khoá "đúng ngày"', () => {
    expect(buildCompanyAlerts({ ...input, today: '2026-10-31' })).toEqual([]);
    const d2 = buildCompanyAlerts({ ...input, today: '2026-11-01' });
    expect(d2.map(a => a.key)).toEqual(['co:o1:2026-11-03:before', 'nh:h1:2026-11-03:before']);
    expect(buildCompanyAlerts({ ...input, today: '2026-11-02' }).map(a => a.key)).toEqual(d2.map(a => a.key));
    expect(buildCompanyAlerts({ ...input, today: '2026-11-03' }).map(a => [a.key, a.stage])).toEqual([
      ['co:o1:2026-11-03:day', 'day'], ['nh:h1:2026-11-03:day', 'day'],
    ]);
    expect(buildCompanyAlerts({ ...input, today: '2026-11-04' })).toEqual([]);
  });

  it('khoá dọn được bằng pruneSeenKeys chung với popup người liên hệ', () => {
    expect(pruneSeenKeys(['co:o1:2026-11-03:before', 'nh:h1:2026-10-01:day'], '2026-11-01')).toEqual(['co:o1:2026-11-03:before']);
  });
});

describe('lưu form nhập nhanh', () => {
  const existing = [
    co(),
    co({ id: 'e1', kind: 'holiday', title: 'Ngày hội', day: 20, month: 12, year: null }),
  ];

  it('form chưa sửa → không ghi gì', () => {
    const draft = draftFromCompany('a', 'Nhật Bản', existing);
    expect(draft.founding).toBe('03/11/2016');
    const plan = planCompanySave(draft, 'Nhật Bản', existing);
    expect('error' in plan ? plan : isEmptyCompanyPlan(plan)).toBe(true);
  });

  it('đổi quốc gia, sửa ngày thành lập, bỏ 1 ngày, thêm 1 ngày', () => {
    const draft = draftFromCompany('a', 'Nhật Bản', existing);
    const plan = planCompanySave({
      ...draft,
      country: 'Hàn Quốc',
      founding: '05/11/2016',
      extras: [{ kind: 'anniversary', title: '  Hợp tác  Let’s Go ', day: 1, month: 7, year: 2024, isLunar: false, note: '' }],
    }, 'Nhật Bản', existing);
    if ('error' in plan) throw new Error(plan.error);
    expect(plan.country).toBe('Hàn Quốc');
    expect(plan.updates).toEqual([{ id: 'o1', fields: { kind: 'founding', title: 'Thành lập', day: 5, month: 11, year: 2016, isLunar: false, note: '' } }]);
    expect(plan.archives).toEqual(['e1']);
    expect(plan.inserts.map(i => i.title)).toEqual(['Hợp tác Let’s Go']);
  });

  it('xoá trắng ô thành lập → xoá mềm; ngày sai → báo lỗi; bỏ quốc gia → null', () => {
    const draft = draftFromCompany('a', 'Nhật Bản', existing);
    const cleared = planCompanySave({ ...draft, founding: '', country: '' }, 'Nhật Bản', existing);
    if ('error' in cleared) throw new Error(cleared.error);
    expect(cleared.archives).toEqual(['o1']);
    expect(cleared.country).toBeNull();
    expect(planCompanySave({ ...draft, founding: '31/02/2016' }, 'Nhật Bản', existing)).toHaveProperty('error');
  });

  it('công ty chưa có gì: gõ ngày thành lập → thêm mới; đổi hoa/thường quốc gia không tính là sửa', () => {
    const plan = planCompanySave({ clientId: 'b', country: 'HÀN QUỐC', founding: '1/3', extras: [] }, 'Hàn Quốc', existing);
    if ('error' in plan) throw new Error(plan.error);
    expect(plan.country).toBeUndefined();
    expect(plan.inserts).toEqual([{ kind: 'founding', title: 'Thành lập', day: 1, month: 3, year: null, isLunar: false, note: '' }]);
  });
});
