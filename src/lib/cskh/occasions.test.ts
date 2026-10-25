// Port từ PRM Tony Study (src/lib/prm/occasions.test.mjs) + phần sinh nhật trong hồ sơ của LetsGo.
import { describe, expect, it } from 'vitest';
import {
  blankDraft, buildOccasionAlerts, draftError, draftTitle, fitsProfileBirthday, isEmptyPlan, maxDay,
  nextOccurrenceInfo, planOccasionSave, profileBirthdayId, pruneSeenKeys, type OccasionDraft,
} from './occasions';
import type { CskhOccasion } from './types';

const occ = (over: Partial<CskhOccasion> = {}): CskhOccasion => ({
  id: 'o1', contactId: 'c1', title: 'Sinh nhật', occasionType: 'birthday', day: 27, month: 10, year: 1990,
  isLunar: false, relatedPerson: '', remindDaysBefore: 3, lastRemindedYear: null, note: '', isArchived: false,
  source: 'special_date', ...over,
});
const person = (id: string, fullName: string, tier: 'vip' | 'unclassified' | 'family', isArchived = false) =>
  ({ id, fullName, avatarUrl: '', tier, isArchived, jobTitle: 'TP Nhân sự', organization: 'Midea' });
const people = [person('c1', 'Anh Minh', 'vip'), person('c2', 'Chị Lan', 'unclassified'), person('c3', 'Bác An', 'family', true)];
const draft = (over: Partial<OccasionDraft>): OccasionDraft => ({ ...blankDraft(), ...over });

describe('kiểm tra 1 dòng ngày quan trọng', () => {
  it('đủ ngày+tháng, ngày có thật, năm hợp lệ; dòng trống bỏ qua', () => {
    expect(draftError(blankDraft(), 2026)).toBeNull();
    expect(draftError(draft({ day: 5 }), 2026)).toMatch(/chọn đủ ngày và tháng/);
    expect(draftError(draft({ day: 31, month: 4 }), 2026)).toMatch(/không có ngày 31\/4/);
    expect(draftError(draft({ day: 29, month: 2 }), 2026)).toBeNull(); // 29/2 hợp lệ khi không rõ năm
    expect(draftError(draft({ day: 29, month: 2, year: 1990 }), 2026)).toMatch(/năm 1990 không có ngày 29\/2/);
    expect(draftError(draft({ day: 29, month: 2, year: 1992 }), 2026)).toBeNull();
    expect(draftError(draft({ day: 31, month: 1, isLunar: true }), 2026)).toMatch(/âm lịch/);
    expect(draftError(draft({ day: 1, month: 1, year: 1800 }), 2026)).toMatch(/năm không hợp lệ/);
    expect(maxDay(2, false)).toBe(29);
    expect(maxDay(2, true)).toBe(30);
  });

  it('tên bỏ trống thì lấy tên loại', () => {
    expect(draftTitle({ title: '  ', occasionType: 'birthday' })).toBe('Sinh nhật');
    expect(draftTitle({ title: ' Kỷ niệm  ngày cưới ', occasionType: 'anniversary' })).toBe('Kỷ niệm ngày cưới');
  });

  it('sinh nhật lưu vào hồ sơ: tên mặc định, dương lịch, có năm', () => {
    expect(fitsProfileBirthday(draft({ day: 5, month: 3, year: 1990 }))).toBe(true);
    expect(fitsProfileBirthday(draft({ day: 5, month: 3, year: null }))).toBe(false);
    expect(fitsProfileBirthday(draft({ day: 5, month: 3, year: 1990, isLunar: true }))).toBe(false);
    expect(fitsProfileBirthday(draft({ day: 5, month: 3, year: 2019, title: 'Sinh nhật con gái' }))).toBe(false);
  });
});

describe('kế hoạch lưu', () => {
  it('thêm dòng mới, sửa dòng đổi, xoá dòng bị bỏ, không đụng dòng giữ nguyên', () => {
    const existing = [
      occ(),
      occ({ id: 'o2', title: 'Giỗ ông', occasionType: 'memorial', day: 10, month: 3, isLunar: true, year: null }),
      occ({ id: 'o3', title: 'Kỷ niệm', occasionType: 'anniversary', day: 1, month: 6, year: null }),
    ];
    const plan = planOccasionSave(existing, [
      { id: 'o1', occasionType: 'birthday', title: 'Sinh nhật vợ', day: 28, month: 10, year: 1990, isLunar: false, remindDaysBefore: 3 },
      { id: 'o2', occasionType: 'memorial', title: 'Giỗ ông', day: 10, month: 3, year: null, isLunar: true, remindDaysBefore: 1 },
      draft({ day: 2, month: 9, occasionType: 'other' }),
      blankDraft(),
    ]);
    expect(plan.deletes).toEqual(['o3']);
    expect(plan.inserts.map(i => i.title)).toEqual(['Khác']);
    expect(plan.updates.map(u => [u.id, u.resetReminded])).toEqual([['o1', true], ['o2', false]]);
    expect(plan.birthday).toBeUndefined(); // không đụng contacts.birthday
  });

  it('kế hoạch rỗng khi không đổi gì', () => {
    // Sự kiện riêng tên "Sinh nhật" có năm vẫn là sự kiện riêng — không tự chuyển sang contacts.birthday
    expect(isEmptyPlan(planOccasionSave([occ()], [{ id: 'o1', occasionType: 'birthday', title: 'Sinh nhật', day: 27, month: 10, year: 1990, isLunar: false, remindDaysBefore: 3 }]))).toBe(true);
    const same = occ({ title: 'Sinh nhật con', relatedPerson: 'con' });
    expect(isEmptyPlan(planOccasionSave([same], [{ id: 'o1', occasionType: 'birthday', title: 'Sinh nhật con', day: 27, month: 10, year: 1990, isLunar: false, remindDaysBefore: 3 }]))).toBe(true);
    expect(isEmptyPlan(planOccasionSave([], [blankDraft()]))).toBe(true);
  });

  it('sinh nhật trong hồ sơ: sửa ngày, đổi nhắc, bỏ đi', () => {
    const bd = occ({ id: profileBirthdayId('c1'), source: 'birthday', remindDaysBefore: 3 });
    const keep = planOccasionSave([bd], [{ ...blankDraft(), id: bd.id, day: 27, month: 10, year: 1990 }]);
    expect(isEmptyPlan(keep)).toBe(true);
    const moved = planOccasionSave([bd], [{ ...blankDraft(), id: bd.id, day: 28, month: 10, year: 1990, remindDaysBefore: 7 }]);
    expect(moved.birthday).toBe('1990-10-28');
    expect(moved.birthdayRemindDays).toBe(7);
    expect(moved.inserts).toEqual([]);
    expect(planOccasionSave([bd], []).birthday).toBeNull();
  });

  it('sinh nhật hồ sơ đổi sang âm lịch → thành sự kiện riêng, xoá contacts.birthday', () => {
    const bd = occ({ id: profileBirthdayId('c1'), source: 'birthday' });
    const plan = planOccasionSave([bd], [{ ...blankDraft(), id: bd.id, day: 15, month: 8, year: 1990, isLunar: true }]);
    expect(plan.birthday).toBeNull();
    expect(plan.inserts).toEqual([{ occasionType: 'birthday', title: 'Sinh nhật', day: 15, month: 8, year: 1990, isLunar: true, remindDaysBefore: 3 }]);
  });

  it('chưa có ngày sinh: dòng "Sinh nhật" mới có năm lấp vào hồ sơ; dòng sinh nhật con là sự kiện riêng', () => {
    const plan = planOccasionSave([], [
      draft({ title: 'Sinh nhật con gái', day: 1, month: 6, year: 2019 }),
      draft({ day: 5, month: 3, year: 1988, remindDaysBefore: 1 }),
    ]);
    expect(plan.birthday).toBe('1988-03-05');
    expect(plan.birthdayRemindDays).toBe(1);
    expect(plan.inserts.map(i => i.title)).toEqual(['Sinh nhật con gái']);
  });
});

describe('lần tới + cảnh báo khi mở app', () => {
  it('lần tới + tuổi tròn (chỉ sinh nhật dương lịch có năm)', () => {
    expect(nextOccurrenceInfo({ occasionType: 'birthday', day: 27, month: 10, year: 1990, isLunar: false }, '2026-10-24'))
      .toEqual({ nextIso: '2026-10-27', daysUntil: 3, age: 36 });
    expect(nextOccurrenceInfo({ occasionType: 'birthday', day: 1, month: 1, year: null, isLunar: false }, '2026-10-24')?.nextIso).toBe('2027-01-01');
    expect(nextOccurrenceInfo({ occasionType: 'birthday', day: null, month: 1, year: null, isLunar: false }, '2026-10-24')).toBeNull();
    expect(nextOccurrenceInfo({ occasionType: 'anniversary', day: 27, month: 10, year: 2015, isLunar: false }, '2026-10-24')?.age).toBeNull();
  });

  it('trước N ngày rồi đúng ngày; chỉ người đang chăm sóc, bỏ người đã nghỉ', () => {
    const list = [occ(), occ({ id: 'o2', contactId: 'c2' }), occ({ id: 'o3', contactId: 'c3' })];
    expect(buildOccasionAlerts(people, list, '2026-10-23')).toHaveLength(0);
    const d3 = buildOccasionAlerts(people, list, '2026-10-24');
    expect(d3.map(a => [a.contactName, a.stage, a.daysUntil, a.age])).toEqual([['Anh Minh', 'before', 3, 36]]);
    expect(d3[0].key).toBe('o1:2026-10-27:before');
    expect(d3[0].sub).toBe('TP Nhân sự · Midea');
    // Lỡ hôm D-3, mở app hôm D-1 vẫn còn mốc "trước" cùng khoá → đã xem thì không hiện lại
    expect(buildOccasionAlerts(people, list, '2026-10-26')[0].key).toBe('o1:2026-10-27:before');
    expect(buildOccasionAlerts(people, list, '2026-10-27').map(a => [a.stage, a.key])).toEqual([['day', 'o1:2026-10-27:day']]);
    expect(buildOccasionAlerts(people, list, '2026-10-28')).toHaveLength(0);
  });

  it('nhắc 0 ngày chỉ báo đúng ngày; âm lịch quy đổi; nhãn có người thân; bỏ sự kiện đã xoá', () => {
    const list = [
      occ({ remindDaysBefore: 0 }),
      occ({ id: 'o2', title: 'Sinh nhật', relatedPerson: 'con gái', day: 17, month: 9, isLunar: true, year: 2019, remindDaysBefore: 1 }),
      occ({ id: 'o9', isArchived: true }),
    ];
    expect(buildOccasionAlerts(people, list, '2026-10-24')).toHaveLength(0);
    // 17/9 âm lịch 2026 = 26/10/2026 dương lịch
    const a = buildOccasionAlerts(people, list, '2026-10-25');
    expect(a.map(x => [x.label, x.nextIso, x.isLunar, x.lunarDayMonth, x.age])).toEqual([['Sinh nhật của con gái', '2026-10-26', true, '17/9', null]]);
    expect(buildOccasionAlerts(people, list, '2026-10-26').map(x => [x.occasionId, x.stage])).toEqual([['o2', 'day']]);
    expect(buildOccasionAlerts(people, list, '2026-10-27').map(x => [x.occasionId, x.stage])).toEqual([['o1', 'day']]);
  });

  it('dọn danh sách đã xem: bỏ mốc đã qua (kể cả id sinh nhật hồ sơ có dấu ":")', () => {
    expect(pruneSeenKeys([
      'o1:2026-10-20:day', 'o1:2026-10-27:before', 'rác', 'birthday:abc-1:2026-10-30:day', 'birthday:abc-1:2026-10-01:before',
    ], '2026-10-24')).toEqual(['o1:2026-10-27:before', 'birthday:abc-1:2026-10-30:day']);
  });
});
