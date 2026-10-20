// ============================================================================
// CSKH — Điểm sức khỏe quan hệ 0–100 (giữ NGUYÊN công thức PRM, relationshipScore.ts)
// ----------------------------------------------------------------------------
// Trọng số đã chốt:
//   50  Nhịp liên hệ   = 50 × (0,6 × độ tươi + 0,4 × tỉ lệ đúng hạn)
//   20  Thấu hiểu      = 3/sở thích (tối đa 9) + thói quen 5 + tính cách hoặc MBTI 6
//   20  Sự kiện & quà  = có ≥ 1 sự kiện 10 + 5/món quà ĐÃ TẶNG trong 365 ngày (tối đa 10)
//   10  Ghi chú        = ghi chú lần gần nhất ≥ 80 ký tự 10, ngắn hơn 5, không có 0
// Hàm thuần: không gọi mạng, không đọc đồng hồ (today truyền vào).
// ============================================================================
import type {
  CskhContact, CskhGift, CskhInteraction,
  RelationshipScore, RelationshipScoreBreakdown, RelationshipScoreInput,
} from './types';

const MS_PER_DAY = 86_400_000;

/** Số ngày nhìn lùi để đánh giá lịch sử đúng hạn (2 quý). */
const LOOKBACK_DAYS = 180;

/** Ghi chú từ bao nhiêu ký tự trở lên được tính là "có chiều sâu". */
const NOTE_RICH_LENGTH = 80;

function daysBetween(fromIso: string, toIso: string): number {
  const from = new Date(`${fromIso}T00:00:00Z`).getTime();
  const to = new Date(`${toIso}T00:00:00Z`).getTime();
  return Math.round((to - from) / MS_PER_DAY);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Điểm nhịp (tối đa 50), hai lớp:
 *  1. Độ tươi lần tương tác cuối (60%): r = số ngày trôi / nhịp. r ≤ 1 (còn trong
 *     chu kỳ) ăn trọn; r từ 1 đến 2 giảm tuyến tính về 0 — trễ thêm 1 chu kỳ nữa là mất sạch.
 *  2. Tỉ lệ đúng hạn (40%): các khoảng cách giữa 2 lần liên hệ liên tiếp trong
 *     LOOKBACK_DAYS ngày; khoảng ≤ nhịp là đúng hạn. Chỉ có 1 lần liên hệ → 0,5.
 * Chưa từng tương tác: 0 điểm.
 */
function calcCadenceScore(
  cadenceDays: number,
  today: string,
  interactionDates: string[],
): { score: number; daysSince: number | null } {
  if (interactionDates.length === 0 || cadenceDays <= 0) {
    return { score: 0, daysSince: null };
  }

  const sorted = [...interactionDates].sort(); // ISO sắp chữ = sắp thời gian
  const latest = sorted[sorted.length - 1];
  const daysSince = daysBetween(latest, today);

  const overdueRatio = daysSince / cadenceDays;
  const freshness = clamp(2 - overdueRatio, 0, 1);

  const recent = daysBetween(latest, today) > LOOKBACK_DAYS
    ? sorted // cả lịch sử đã "nguội" — vẫn xét toàn bộ để không chia cho 0
    : sorted.filter(d => daysBetween(d, today) <= LOOKBACK_DAYS);
  let onTime = 0;
  let gaps = 0;
  for (let i = 1; i < recent.length; i += 1) {
    gaps += 1;
    if (daysBetween(recent[i - 1], recent[i]) <= cadenceDays) onTime += 1;
  }
  const onTimeRate = gaps === 0 ? 0.5 : onTime / gaps;

  return { score: 50 * (0.6 * freshness + 0.4 * onTimeRate), daysSince };
}

function calcUnderstandingScore(input: RelationshipScoreInput): number {
  const interestPoints = clamp(input.interests.length * 3, 0, 9);
  const habitPoints = input.habits.trim().length > 0 ? 5 : 0;
  const personalityPoints = input.personality.trim().length > 0 || input.mbti !== '' ? 6 : 0;
  return interestPoints + habitPoints + personalityPoints;
}

function calcCareScore(input: RelationshipScoreInput): number {
  const occasionPoints = input.occasionCount > 0 ? 10 : 0;
  const giftPoints = clamp(input.giftsGivenLastYear * 5, 0, 10);
  return occasionPoints + giftPoints;
}

function calcRecentNoteScore(lastInteractionContent: string): number {
  const length = lastInteractionContent.trim().length;
  if (length === 0) return 0;
  return length >= NOTE_RICH_LENGTH ? 10 : 5;
}

/** Chấm điểm từ dữ liệu đã tổng hợp. Caller truyền nhịp hiệu lực (resolveCadence). */
export function calcRelationshipScore(input: RelationshipScoreInput): RelationshipScore {
  const cadence = calcCadenceScore(input.cadenceDays, input.today, input.interactionDates);

  const breakdown: RelationshipScoreBreakdown = {
    cadence: Math.round(cadence.score),
    understanding: calcUnderstandingScore(input),
    care: calcCareScore(input),
    recentNote: calcRecentNoteScore(input.lastInteractionContent),
  };

  const total = clamp(
    breakdown.cadence + breakdown.understanding + breakdown.care + breakdown.recentNote,
    0,
    100,
  );

  return {
    total,
    breakdown,
    daysSinceLastInteraction: cadence.daysSince,
    daysUntilDue: cadence.daysSince === null ? null : input.cadenceDays - cadence.daysSince,
  };
}

/**
 * Chấm điểm thẳng từ đối tượng miền. interactions / gifts là của RIÊNG người này
 * (đã lọc theo contactId, bỏ dòng đã lưu trữ). cadenceDays = null (Chưa chăm sóc)
 * → null: giao diện hiện "–" chứ không hiện 0.
 */
export function scoreContact(
  contact: Pick<CskhContact, 'interests' | 'habits' | 'personality' | 'mbti'>,
  interactions: readonly Pick<CskhInteraction, 'occurredAt' | 'content'>[],
  gifts: readonly Pick<CskhGift, 'direction' | 'givenAt'>[],
  occasionCount: number,
  cadenceDays: number | null,
  today: string,
): RelationshipScore | null {
  if (cadenceDays === null) return null;
  let latest: Pick<CskhInteraction, 'occurredAt' | 'content'> | null = null;
  for (const it of interactions) {
    if (latest === null || it.occurredAt > latest.occurredAt) latest = it;
  }
  const yearAgo = new Date(`${today}T00:00:00Z`).getTime() - 365 * MS_PER_DAY;
  const giftsGivenLastYear = gifts.filter(
    g => g.direction === 'given' && new Date(`${g.givenAt}T00:00:00Z`).getTime() >= yearAgo,
  ).length;
  return calcRelationshipScore({
    cadenceDays,
    today,
    interactionDates: interactions.map(i => i.occurredAt),
    lastInteractionContent: latest?.content ?? '',
    interests: contact.interests,
    habits: contact.habits,
    personality: contact.personality,
    mbti: contact.mbti,
    occasionCount,
    giftsGivenLastYear,
  });
}

// ── Diễn giải điểm cho giao diện ────────────────────────────────────────────
export type ScoreGrade = 'good' | 'attention' | 'weak';

/** ≥ 70 Tốt · ≥ 40 Cần chú ý · < 40 Yếu. */
export function scoreGrade(total: number): ScoreGrade {
  if (total >= 70) return 'good';
  if (total >= 40) return 'attention';
  return 'weak';
}

export const SCORE_GRADE_LABEL: Readonly<Record<ScoreGrade, string>> = {
  good: 'Tốt',
  attention: 'Cần chú ý',
  weak: 'Yếu',
};

/** 4 thành phần điểm (trọng số 50/20/20/10) + gợi ý khi yếu. */
export const SCORE_PARTS: ReadonlyArray<{
  key: keyof RelationshipScoreBreakdown;
  label: string;
  max: number;
  hint: string;
}> = [
  { key: 'cadence', label: 'Nhịp liên hệ', max: 50, hint: 'liên hệ đều theo nhịp' },
  { key: 'understanding', label: 'Thấu hiểu', max: 20, hint: 'bổ sung sở thích, thói quen, tính cách' },
  { key: 'care', label: 'Sự kiện & quà', max: 20, hint: 'thêm ngày đặc biệt, ghi nhận quà' },
  { key: 'recentNote', label: 'Ghi chú', max: 10, hint: 'ghi chú kỹ hơn sau mỗi lần gặp' },
];

/** Thành phần yếu nhất (tỉ lệ đạt thấp nhất) — "Yếu nhất: Thấu hiểu 3/20 — bổ sung …". */
export function weakestPart(score: RelationshipScore): (typeof SCORE_PARTS)[number] {
  let worst = SCORE_PARTS[0];
  let worstRatio = Infinity;
  for (const p of SCORE_PARTS) {
    const ratio = score.breakdown[p.key] / p.max;
    if (ratio < worstRatio) {
      worst = p;
      worstRatio = ratio;
    }
  }
  return worst;
}
