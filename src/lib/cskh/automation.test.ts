import { describe, it, expect } from 'vitest';
import { planCareReminders } from './automation';
import { isValidDayMonth } from './dates';
import { convertSolar2Lunar } from './lunar';
import { addDays, makeContact, makeOccasion } from './testFixtures';
import { DEFAULT_CADENCE } from './types';

const TODAY = '2026-10-20';
const dm = (iso: string) => ({ day: Number(iso.slice(8)), month: Number(iso.slice(5, 7)) });
const plan = (input: Partial<Parameters<typeof planCareReminders>[0]>) =>
  planCareReminders({ contacts: [], occasions: [], cadence: DEFAULT_CADENCE, today: TODAY, ...input });

describe('việc "Chuẩn bị quà"', () => {
  it('sự kiện trong khoảng nhắc trước → tạo, hạn = ngày sự kiện; xa hơn thì chưa', () => {
    const c = makeContact({ fullName: 'Nguyễn Văn A' });
    const near = makeOccasion(c.id, { ...dm(addDays(TODAY, 5)), title: 'Sinh nhật', remindDaysBefore: 7 });
    const far = makeOccasion(c.id, { ...dm(addDays(TODAY, 9)), title: 'Kỷ niệm', remindDaysBefore: 7 });
    const { gifts } = plan({ contacts: [c], occasions: [near, far] });
    expect(gifts).toHaveLength(1);
    expect(gifts[0]).toMatchObject({ nextIso: '2026-10-25', eventYear: 2026, title: 'CSKH: Chuẩn bị quà Sinh nhật — Nguyễn Văn A (25/10)' });
  });

  it('đã nhắc năm nay thì thôi; người chưa chăm sóc / đã nghỉ / sự kiện đã xoá không nhắc', () => {
    const c = makeContact();
    const t = dm(addDays(TODAY, 2));
    const out = plan({
      contacts: [c, makeContact({ id: 'u', tier: 'unclassified' }), makeContact({ id: 'left', isArchived: true, isActive: false })],
      occasions: [
        makeOccasion(c.id, { ...t, lastRemindedYear: 2026 }),
        makeOccasion(c.id, { ...t, isArchived: true }),
        makeOccasion('u', t),
        makeOccasion('left', t),
      ],
    });
    expect(out.gifts).toEqual([]);
  });

  it('sự kiện âm lịch của người thân: tên ghi rõ "của …", hạn là ngày dương đã quy đổi', () => {
    const c = makeContact({ fullName: 'Trần B' });
    const target = addDays(TODAY, 3);
    const l = convertSolar2Lunar(Number(target.slice(8)), Number(target.slice(5, 7)), Number(target.slice(0, 4)));
    const o = makeOccasion(c.id, { day: l.day, month: l.month, isLunar: true, title: 'Giỗ', relatedPerson: 'bố', occasionType: 'memorial' });
    const { gifts } = plan({ contacts: [c], occasions: [o] });
    expect(gifts[0].nextIso).toBe(target);
    expect(gifts[0].title).toBe(`CSKH: Chuẩn bị quà Giỗ của bố — Trần B (${target.slice(8)}/${target.slice(5, 7)})`);
  });
});

describe('việc "Kết nối lại"', () => {
  it('chỉ người đã từng liên hệ mà quá nhịp; chưa từng liên hệ thì không (đã ở hàng đợi)', () => {
    const late = makeContact({ fullName: 'Lê C', tier: 'vip', lastInteractionAt: addDays(TODAY, -40) });
    const fine = makeContact({ tier: 'vip', lastInteractionAt: addDays(TODAY, -10) });
    const never = makeContact({ tier: 'vip', lastInteractionAt: null });
    const { reconnect } = plan({ contacts: [late, fine, never] });
    expect(reconnect.map(r => r.contact.id)).toEqual([late.id]);
    expect(reconnect[0]).toMatchObject({ overdue: 10, title: 'CSKH: Kết nối lại với Lê C — quá hạn 10 ngày' });
  });

  it('đã nhắc sau lần liên hệ cuối thì thôi; liên hệ lại rồi quá hạn tiếp thì nhắc lại', () => {
    const alerted = makeContact({ tier: 'vip', lastInteractionAt: addDays(TODAY, -40), lastColdAlertAt: addDays(TODAY, -5) });
    const again = makeContact({ tier: 'vip', lastInteractionAt: addDays(TODAY, -40), lastColdAlertAt: addDays(TODAY, -60) });
    expect(plan({ contacts: [alerted, again] }).reconnect.map(r => r.contact.id)).toEqual([again.id]);
  });

  it('quá hạn nhiều nhất trước, tối đa N việc mỗi lần', () => {
    const contacts = Array.from({ length: 15 }, (_, k) => makeContact({ tier: 'vip', lastInteractionAt: addDays(TODAY, -(31 + k)) }));
    const { reconnect } = plan({ contacts });
    expect(reconnect).toHaveLength(10);
    expect(reconnect[0].contact.id).toBe(contacts[14].id);
    expect(plan({ contacts, maxReconnect: 3 }).reconnect).toHaveLength(3);
  });
});

describe('kiểm ngày dương lịch', () => {
  it('29/02 hợp lệ khi không rõ năm hoặc năm nhuận; 31/04 không hợp lệ', () => {
    expect(isValidDayMonth(29, 2, null)).toBe(true);
    expect(isValidDayMonth(29, 2, 2028)).toBe(true);
    expect(isValidDayMonth(29, 2, 2027)).toBe(false);
    expect(isValidDayMonth(31, 4, null)).toBe(false);
    expect(isValidDayMonth(0, 1, null)).toBe(false);
    expect(isValidDayMonth(15, 13, null)).toBe(false);
  });
});
