// Port từ PRM Tony Study (src/lib/prm/todayQueue.test.mjs) + các trường hợp riêng của LetsGo.
import { describe, it, expect } from 'vitest';
import { buildTodayQueue, TODAY_QUEUE_LIMIT, type TodayQueueInput } from './todayQueue';
import { todayVN } from './dates';
import { convertSolar2Lunar } from './lunar';
import { addDays, makeContact, makeInteraction, makeOccasion } from './testFixtures';
import type { CskhContact } from './types';

const CADENCE = { vvip: 14, vip: 30, partner: 45, friend: 90, family: 30, other: 180 };
const TODAY = '2026-10-10';

const contact = (over: Partial<CskhContact> = {}) => makeContact({ lastInteractionAt: TODAY, ...over });
const dm = (iso: string) => ({ day: Number(iso.slice(8)), month: Number(iso.slice(5, 7)) });
const run = (input: Partial<TodayQueueInput>, limit?: number) =>
  buildTodayQueue({ contacts: [], interactions: [], occasions: [], gifts: [], cadence: CADENCE, today: TODAY, ...input }, limit);

describe('quá nhịp liên hệ', () => {
  it('vip 30 ngày, lần cuối 40 ngày trước → quá hạn 10 ngày', () => {
    const late = contact({ lastInteractionAt: addDays(TODAY, -40) });
    const fine = contact({ lastInteractionAt: addDays(TODAY, -30) }); // đúng hạn, chưa quá
    const { items, hiddenCount } = run({ contacts: [late, fine] });
    expect(items).toHaveLength(1);
    expect(hiddenCount).toBe(0);
    expect(items[0]).toMatchObject({ contactId: late.id, reason: 'cadence_overdue', daysOverdue: 10, label: '40 ngày chưa liên hệ' });
  });

  it('chưa chăm sóc / đã nghỉ không vào hàng đợi; chưa từng tương tác thì vào', () => {
    const unclassified = contact({ tier: 'unclassified', lastInteractionAt: null });
    const left = contact({ lastInteractionAt: addDays(TODAY, -400), isActive: false, isArchived: true });
    const never = contact({ lastInteractionAt: null });
    const { items } = run({ contacts: [unclassified, left, never] });
    expect(items.map(i => i.contactId)).toEqual([never.id]);
    expect(items[0].label).toBe('Chưa có tương tác nào');
  });

  it('nhịp riêng của người liên hệ ghi đè nhịp theo hạng', () => {
    const c = contact({ cadenceDays: 7, lastInteractionAt: addDays(TODAY, -8) });
    expect(run({ contacts: [c] }).items[0].daysOverdue).toBe(1);
  });

  it('quá hạn như nhau thì điểm sức khỏe thấp hơn lên trước', () => {
    const lowScore = contact({ lastInteractionAt: addDays(TODAY, -40) });
    const highScore = contact({
      lastInteractionAt: addDays(TODAY, -40), interests: ['a', 'b', 'c'], habits: 'dậy sớm', personality: 'điềm đạm',
    });
    expect(run({ contacts: [highScore, lowScore] }).items[0].contactId).toBe(lowScore.id);
  });
});

describe('việc đã hứa', () => {
  it('hôm nay và quá hạn; bỏ qua đã xong / chưa tới hạn / không có hạn', () => {
    const [a, b, d, e, f] = [contact(), contact(), contact(), contact(), contact()];
    const interactions = [
      makeInteraction(a.id, { followUpAction: 'Gửi báo giá', followUpDue: addDays(TODAY, -2) }),
      makeInteraction(b.id, { followUpAction: 'Hỏi thăm', followUpDue: TODAY }),
      makeInteraction(d.id, { followUpAction: 'Đã xong rồi', followUpDue: addDays(TODAY, -5), followUpDone: true }),
      makeInteraction(e.id, { followUpAction: 'Tuần sau', followUpDue: addDays(TODAY, 3) }),
      makeInteraction(f.id, { followUpAction: 'Không có hạn', followUpDue: null }),
    ];
    const { items } = run({ contacts: [a, b, d, e, f], interactions });
    expect(items.map(i => [i.contactId, i.reason])).toEqual([[a.id, 'followup_overdue'], [b.id, 'followup_today']]);
    expect(items[0]).toMatchObject({ label: 'Hứa: Gửi báo giá — quá hạn 2 ngày', daysOverdue: 2, interactionId: interactions[0].id });
    expect(items[1].label).toBe('Hứa: Hỏi thăm — đến hạn hôm nay');
  });

  it('nhiều việc cùng một người: lấy việc quá hạn nhất, việc còn lại ghi phụ', () => {
    const c = contact();
    const { items } = run({
      contacts: [c],
      interactions: [
        makeInteraction(c.id, { followUpAction: 'Việc A', followUpDue: addDays(TODAY, -1) }),
        makeInteraction(c.id, { followUpAction: 'Việc B', followUpDue: addDays(TODAY, -9) }),
      ],
    });
    expect(items).toHaveLength(1);
    expect(items[0].daysOverdue).toBe(9);
    expect(items[0].alsoLabels).toHaveLength(1);
  });

  it('người CHƯA CHĂM SÓC: không có sự kiện/nhịp, nhưng việc đã hứa vẫn hiện', () => {
    const stranger = contact({ tier: 'unclassified', lastInteractionAt: null });
    const t = addDays(TODAY, 2);
    expect(run({ contacts: [stranger], occasions: [makeOccasion(stranger.id, dm(t))] }).items).toEqual([]);
    const withPromise = run({
      contacts: [stranger],
      interactions: [makeInteraction(stranger.id, { followUpAction: 'Gửi hồ sơ', followUpDue: TODAY })],
    });
    expect(withPromise.items).toHaveLength(1);
    expect(withPromise.items[0].reason).toBe('followup_today');
  });

  it('LetsGo: dòng nhật ký cũ (chưa gắn người) và dòng đã lưu trữ bị bỏ qua', () => {
    const c = contact();
    const { items } = run({
      contacts: [c],
      interactions: [
        makeInteraction(null, { followUpAction: 'Dòng cũ', followUpDue: addDays(TODAY, -3) }),
        makeInteraction(c.id, { followUpAction: 'Đã lưu trữ', followUpDue: addDays(TODAY, -3), isArchived: true }),
      ],
    });
    expect(items).toEqual([]);
  });

  it('LetsGo: người đã nghỉ không vào hàng đợi kể cả khi còn việc đã hứa', () => {
    const left = contact({ isActive: false, isArchived: true });
    const { items } = run({
      contacts: [left],
      interactions: [makeInteraction(left.id, { followUpAction: 'Gửi HĐ', followUpDue: addDays(TODAY, -1) })],
    });
    expect(items).toEqual([]);
  });
});

describe('sự kiện', () => {
  it('sinh nhật âm lịch rơi vào tuần tới', () => {
    const c = contact();
    const target = addDays(TODAY, 3);
    const lunar = convertSolar2Lunar(Number(target.slice(8)), Number(target.slice(5, 7)), Number(target.slice(0, 4)));
    const { items } = run({ contacts: [c], occasions: [makeOccasion(c.id, { day: lunar.day, month: lunar.month, isLunar: true })] });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ reason: 'occasion_soon', daysUntil: 3, label: 'Sinh nhật sau 3 ngày (âm lịch)' });
  });

  it('dương lịch: hôm nay / ngày mai / 7 ngày vào, 8 ngày thì không', () => {
    const mk = (n: number) => {
      const c = contact();
      return { c, o: makeOccasion(c.id, dm(addDays(TODAY, n))) };
    };
    const xs = [0, 1, 7, 8].map(mk);
    const { items } = run({ contacts: xs.map(x => x.c), occasions: xs.map(x => x.o) });
    expect(items.map(i => i.daysUntil)).toEqual([0, 1, 7]); // gần hơn → cao hơn
    expect(items.map(i => i.label)).toEqual(['Sinh nhật hôm nay', 'Sinh nhật ngày mai', 'Sinh nhật sau 7 ngày']);
  });

  it('sự kiện của người thân hiện "của …" nếu tiêu đề chưa nói rõ', () => {
    const c = contact();
    const o = makeOccasion(c.id, { ...dm(addDays(TODAY, 2)), relatedPerson: 'con gái' });
    expect(run({ contacts: [c], occasions: [o] }).items[0].label).toBe('Sinh nhật của con gái sau 2 ngày');
  });

  it('LetsGo: sự kiện đã lưu trữ không vào hàng đợi', () => {
    const c = contact();
    const o = makeOccasion(c.id, { ...dm(addDays(TODAY, 1)), isArchived: true });
    expect(run({ contacts: [c], occasions: [o] }).items).toEqual([]);
  });
});

describe('thứ tự và giới hạn', () => {
  it('việc hứa quá hạn > việc hứa hôm nay > sự kiện > quá nhịp', () => {
    const cad = contact({ lastInteractionAt: addDays(TODAY, -100) });
    const [occ, fut, fto] = [contact(), contact(), contact()];
    const { items } = run({
      contacts: [cad, occ, fut, fto],
      occasions: [makeOccasion(occ.id, dm(addDays(TODAY, 1)))],
      interactions: [
        makeInteraction(fto.id, { followUpAction: 'Gọi lại', followUpDue: TODAY }),
        makeInteraction(fut.id, { followUpAction: 'Gửi hợp đồng', followUpDue: addDays(TODAY, -1) }),
      ],
    });
    expect(items.map(i => i.reason)).toEqual(['followup_overdue', 'followup_today', 'occasion_soon', 'cadence_overdue']);
  });

  it('nhiều lý do cùng một người → 1 dòng, lý do cao nhất, lý do còn lại ghi phụ', () => {
    const c = contact({ lastInteractionAt: addDays(TODAY, -60) });
    const { items } = run({
      contacts: [c],
      occasions: [makeOccasion(c.id, dm(addDays(TODAY, 2)))],
      interactions: [makeInteraction(c.id, { followUpAction: 'Gửi báo giá', followUpDue: addDays(TODAY, -1) })],
    });
    expect(items).toHaveLength(1);
    expect(items[0].reason).toBe('followup_overdue');
    expect(items[0].alsoLabels).toHaveLength(2);
    expect(items[0].alsoLabels.some(l => l.startsWith('Sinh nhật sau 2 ngày'))).toBe(true);
    expect(items[0].alsoLabels.some(l => l.endsWith('chưa liên hệ'))).toBe(true);
  });

  it('tối đa 7 người, phần còn lại thành "+N"', () => {
    const contacts = Array.from({ length: 10 }, (_, k) => contact({ lastInteractionAt: addDays(TODAY, -(40 + k)) }));
    const res = run({ contacts });
    expect(TODAY_QUEUE_LIMIT).toBe(7);
    expect(res.items).toHaveLength(7);
    expect(res.hiddenCount).toBe(3);
    expect(res.items[0].contactId).toBe(contacts[9].id); // quá hạn nhiều nhất lên đầu
    const capped = run({ contacts }, 5);
    expect(capped.items).toHaveLength(5);
    expect(capped.hiddenCount).toBe(5);
  });

  it('bằng điểm ưu tiên thì xếp theo TÊN GỌI (vần tiếng Việt)', () => {
    const late = addDays(TODAY, -40);
    const a = contact({ fullName: 'Nguyễn Văn Tâm', lastInteractionAt: late });
    const b = contact({ fullName: 'Trần Thị An', lastInteractionAt: late });
    expect(run({ contacts: [a, b] }).items.map(i => i.contactId)).toEqual([b.id, a.id]);
  });

  it('hàng đợi rỗng khi mọi thứ ổn', () => {
    expect(run({ contacts: [contact()] })).toEqual({ items: [], hiddenCount: 0 });
  });
});

describe('ranh giới múi giờ Việt Nam', () => {
  it('23:30 giờ VN vẫn là hôm nay, 00:30 là ngày kế tiếp', () => {
    expect(todayVN(new Date('2026-10-10T16:30:00Z'))).toBe('2026-10-10');
    expect(todayVN(new Date('2026-10-10T17:30:00Z'))).toBe('2026-10-11');
    expect(todayVN(new Date('2026-12-31T20:00:00Z'))).toBe('2027-01-01');

    const c = contact();
    const interactions = [makeInteraction(c.id, { followUpAction: 'Gửi báo giá', followUpDue: '2026-10-10' })];
    const at2330 = run({ contacts: [c], interactions, today: todayVN(new Date('2026-10-10T16:30:00Z')) });
    expect(at2330.items[0].reason).toBe('followup_today');
    const at0030 = run({ contacts: [c], interactions, today: todayVN(new Date('2026-10-10T17:30:00Z')) });
    expect(at0030.items[0]).toMatchObject({ reason: 'followup_overdue', daysOverdue: 1 });
  });
});
