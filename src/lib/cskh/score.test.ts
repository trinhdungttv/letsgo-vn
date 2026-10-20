import { describe, it, expect } from 'vitest';
import { calcRelationshipScore, scoreContact, scoreGrade, weakestPart } from './score';
import { buildContactStats, careStatusOf, dueLabel, resolveCadence } from './cadence';
import { DEFAULT_CADENCE, type RelationshipScoreInput } from './types';
import { addDays, makeContact, makeGift, makeInteraction, makeOccasion } from './testFixtures';

const TODAY = '2026-10-19';
const input = (over: Partial<RelationshipScoreInput> = {}): RelationshipScoreInput => ({
  cadenceDays: 30, today: TODAY, interactionDates: [], lastInteractionContent: '',
  interests: [], habits: '', personality: '', mbti: '', occasionCount: 0, giftsGivenLastYear: 0, ...over,
});

describe('điểm nhịp liên hệ (50)', () => {
  it('chưa từng tương tác = 0', () => {
    expect(calcRelationshipScore(input()).breakdown.cadence).toBe(0);
  });

  it('1 lần, còn trong chu kỳ: độ tươi 1, đúng hạn 0,5 → 40', () => {
    expect(calcRelationshipScore(input({ interactionDates: [addDays(TODAY, -10)] })).breakdown.cadence).toBe(40);
  });

  it('trễ nửa chu kỳ → độ tươi 0,5 → 25; trễ trọn 1 chu kỳ → độ tươi 0 → 10', () => {
    expect(calcRelationshipScore(input({ interactionDates: [addDays(TODAY, -45)] })).breakdown.cadence).toBe(25);
    expect(calcRelationshipScore(input({ interactionDates: [addDays(TODAY, -60)] })).breakdown.cadence).toBe(10);
  });

  it('tỉ lệ đúng hạn: khoảng cách ≤ nhịp → trọn 50, > nhịp → 30', () => {
    const onTime = [addDays(TODAY, -25), addDays(TODAY, -5)];
    const late = [addDays(TODAY, -45), addDays(TODAY, -5)];
    expect(calcRelationshipScore(input({ interactionDates: onTime })).breakdown.cadence).toBe(50);
    expect(calcRelationshipScore(input({ interactionDates: late })).breakdown.cadence).toBe(30);
  });
});

describe('thấu hiểu (20), sự kiện & quà (20), ghi chú (10)', () => {
  it('thấu hiểu: 3 điểm/sở thích tối đa 9 + thói quen 5 + tính cách hoặc MBTI 6', () => {
    expect(calcRelationshipScore(input({ interests: ['a', 'b', 'c', 'd'], habits: 'dậy sớm', mbti: 'ENTJ' })).breakdown.understanding).toBe(20);
    expect(calcRelationshipScore(input({ interests: ['golf'], personality: 'quyết đoán' })).breakdown.understanding).toBe(9);
  });

  it('sự kiện & quà: có sự kiện 10 + 5/món quà tối đa 10', () => {
    expect(calcRelationshipScore(input({ occasionCount: 2, giftsGivenLastYear: 3 })).breakdown.care).toBe(20);
    expect(calcRelationshipScore(input({ giftsGivenLastYear: 1 })).breakdown.care).toBe(5);
  });

  it('ghi chú lần gần nhất: ≥ 80 ký tự 10, ngắn 5, trống 0', () => {
    expect(calcRelationshipScore(input({ lastInteractionContent: 'x'.repeat(80) })).breakdown.recentNote).toBe(10);
    expect(calcRelationshipScore(input({ lastInteractionContent: 'Gọi hỏi thăm' })).breakdown.recentNote).toBe(5);
    expect(calcRelationshipScore(input({ lastInteractionContent: '   ' })).breakdown.recentNote).toBe(0);
  });
});

describe('scoreContact', () => {
  it('Chưa chăm sóc (nhịp null) → null, không phải 0', () => {
    expect(scoreContact(makeContact(), [], [], 0, null, TODAY)).toBeNull();
  });

  it('chỉ đếm quà MÌNH TẶNG trong 365 ngày; ghi chú lấy từ lần gần nhất', () => {
    const c = makeContact();
    const gifts = [
      makeGift(c.id, { givenAt: addDays(TODAY, -30) }),
      makeGift(c.id, { givenAt: addDays(TODAY, -30), direction: 'received' }),
      makeGift(c.id, { givenAt: addDays(TODAY, -400) }),
    ];
    const its = [
      makeInteraction(c.id, { occurredAt: addDays(TODAY, -3), content: 'x'.repeat(100) }),
      makeInteraction(c.id, { occurredAt: addDays(TODAY, -20), content: '' }),
    ];
    const s = scoreContact(c, its, gifts, 0, 30, TODAY);
    expect(s?.breakdown.care).toBe(5);
    expect(s?.breakdown.recentNote).toBe(10);
  });

  it('mức điểm và phần yếu nhất', () => {
    expect([scoreGrade(70), scoreGrade(69), scoreGrade(40), scoreGrade(39)]).toEqual(['good', 'attention', 'attention', 'weak']);
    const s = calcRelationshipScore(input({ interactionDates: [addDays(TODAY, -2)], occasionCount: 1, giftsGivenLastYear: 2, lastInteractionContent: 'x'.repeat(90), interests: ['a'] }));
    expect(weakestPart(s).key).toBe('understanding');
    expect(weakestPart(s).hint).toBe('bổ sung sở thích, thói quen, tính cách');
  });
});

describe('nhịp & trạng thái chăm sóc', () => {
  it('resolveCadence: chưa chăm sóc null, nhịp riêng ghi đè, còn lại theo hạng', () => {
    expect(resolveCadence({ tier: 'unclassified', cadenceDays: 10 })).toBeNull();
    expect(resolveCadence({ tier: 'vip', cadenceDays: 10 })).toBe(10);
    expect(resolveCadence({ tier: 'vvip', cadenceDays: null })).toBe(14);
    expect(resolveCadence({ tier: 'partner', cadenceDays: null }, { ...DEFAULT_CADENCE, partner: 60 })).toBe(60);
  });

  it('Quá hạn / Sắp đến hạn (≤ 3 ngày) / Ổn định + nhãn', () => {
    const st = (last: string | null) => careStatusOf({ tier: 'vip', cadenceDays: null, lastInteractionAt: last }, DEFAULT_CADENCE, TODAY);
    expect(st(null)).toMatchObject({ status: 'overdue', daysUntilDue: -30 });
    expect(dueLabel(st(null))).toBe('Chưa có tương tác nào');
    expect(st(addDays(TODAY, -35)).status).toBe('overdue');
    expect(dueLabel(st(addDays(TODAY, -35)))).toBe('Quá hạn 5 ngày');
    expect(dueLabel(st(addDays(TODAY, -30)))).toBe('Đến hạn hôm nay');
    expect(st(addDays(TODAY, -27)).status).toBe('due_soon');
    expect(st(addDays(TODAY, -26))).toMatchObject({ status: 'ok' });
    expect(dueLabel(st(addDays(TODAY, -26)))).toBe('Còn 4 ngày');
    expect(dueLabel(careStatusOf({ tier: 'unclassified', cadenceDays: null, lastInteractionAt: null }, DEFAULT_CADENCE, TODAY))).toBe('Chưa chăm sóc');
  });

  it('buildContactStats: người đã nghỉ không chấm điểm; dòng đã lưu trữ không tính', () => {
    const a = makeContact({ lastInteractionAt: addDays(TODAY, -2) });
    const left = makeContact({ isActive: false, isArchived: true, lastInteractionAt: addDays(TODAY, -2) });
    const stats = buildContactStats(
      [a, left],
      [makeInteraction(a.id, { occurredAt: addDays(TODAY, -2), content: 'x'.repeat(90), isArchived: true })],
      [],
      [makeOccasion(a.id, { isArchived: true })],
      DEFAULT_CADENCE,
      TODAY,
    );
    expect(stats.get(left.id)).toMatchObject({ status: 'unclassified', score: null });
    expect(stats.get(a.id)?.status).toBe('ok');
    expect(stats.get(a.id)?.score?.breakdown).toMatchObject({ cadence: 0, care: 0, recentNote: 0 });
  });
});
