// ============================================================================
// CSKH — Nhịp liên hệ & trạng thái chăm sóc (giữ NGUYÊN quy tắc PRM)
// ----------------------------------------------------------------------------
//   daysSince    = hôm nay − ngày tương tác cuối
//   daysUntilDue = nhịp − daysSince   (chưa từng tương tác thì = −nhịp)
//   < 0 → Quá hạn · ≤ 3 → Sắp đến hạn · còn lại → Ổn định
// Người "Chưa chăm sóc" (unclassified) không có nhịp, không nhắc, không chấm điểm.
// ============================================================================
import { diffDays } from './lunar';
import { scoreContact } from './score';
import type {
  CadenceConfig, CskhContact, CskhGift, CskhInteraction, CskhOccasion, RelationshipScore,
} from './types';
import { DEFAULT_CADENCE } from './types';

/** Còn bao nhiêu ngày tới hạn thì coi là "sắp đến hạn". */
export const DUE_SOON_DAYS = 3;

/** Nhịp hiệu lực: Chưa chăm sóc → null; nhịp riêng ghi đè; còn lại theo hạng. */
export function resolveCadence(
  contact: Pick<CskhContact, 'tier' | 'cadenceDays'>,
  config: CadenceConfig = DEFAULT_CADENCE,
): number | null {
  if (contact.tier === 'unclassified') return null;
  return contact.cadenceDays ?? config[contact.tier];
}

export type CareStatus = 'overdue' | 'due_soon' | 'ok' | 'unclassified';

export const CARE_STATUS_LABEL: Readonly<Record<CareStatus, string>> = {
  overdue: 'Quá hạn',
  due_soon: 'Sắp đến hạn',
  ok: 'Ổn định',
  unclassified: 'Chưa chăm sóc',
};

export interface ContactStats {
  cadence: number | null;
  daysSince: number | null;
  /** Âm = đã quá hạn bấy nhiêu ngày; null = chưa chăm sóc. */
  daysUntilDue: number | null;
  status: CareStatus;
  score: RelationshipScore | null;
}

/** Nhãn hạn chăm sóc: "Quá hạn 5 ngày" / "Đến hạn hôm nay" / "Còn 3 ngày" / "Chưa có tương tác nào". */
export function dueLabel(stats: Pick<ContactStats, 'daysSince' | 'daysUntilDue'>): string {
  if (stats.daysUntilDue === null) return 'Chưa chăm sóc';
  if (stats.daysSince === null) return 'Chưa có tương tác nào';
  if (stats.daysUntilDue < 0) return `Quá hạn ${-stats.daysUntilDue} ngày`;
  if (stats.daysUntilDue === 0) return 'Đến hạn hôm nay';
  return `Còn ${stats.daysUntilDue} ngày`;
}

/** Trạng thái chăm sóc của một người (chưa chấm điểm) — dùng khi chỉ cần màu/hạn. */
export function careStatusOf(
  contact: Pick<CskhContact, 'tier' | 'cadenceDays' | 'lastInteractionAt'>,
  config: CadenceConfig,
  today: string,
): Omit<ContactStats, 'score'> {
  const cadence = resolveCadence(contact, config);
  if (cadence === null) {
    return { cadence: null, daysSince: null, daysUntilDue: null, status: 'unclassified' };
  }
  const daysSince = contact.lastInteractionAt === null ? null : diffDays(contact.lastInteractionAt, today);
  const daysUntilDue = daysSince === null ? -cadence : cadence - daysSince;
  const status: CareStatus = daysUntilDue < 0 ? 'overdue' : daysUntilDue <= DUE_SOON_DAYS ? 'due_soon' : 'ok';
  return { cadence, daysSince, daysUntilDue, status };
}

function groupBy<T>(items: readonly T[], key: (item: T) => string | null): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    if (k === null) continue;
    const list = map.get(k);
    if (list) list.push(item);
    else map.set(k, [item]);
  }
  return map;
}

/**
 * Chỉ số chăm sóc + điểm sức khỏe cho cả danh sách một lần (Dashboard, Ma trận,
 * Nhịp độ dùng chung — không lặp lại logic ở từng trang). Dòng đã lưu trữ
 * (nhật ký / sự kiện / quà) bị bỏ qua. Người đã nghỉ (isArchived) không chấm điểm.
 */
export function buildContactStats(
  contacts: readonly CskhContact[],
  interactions: readonly CskhInteraction[],
  gifts: readonly CskhGift[],
  occasions: readonly CskhOccasion[],
  config: CadenceConfig,
  today: string,
): Map<string, ContactStats> {
  const byContact = groupBy(interactions.filter(i => !i.isArchived), i => i.contactId);
  const giftsByContact = groupBy(gifts.filter(g => !g.isArchived), g => g.contactId);
  const occasionCount = new Map<string, number>();
  for (const o of occasions) {
    if (o.isArchived) continue;
    occasionCount.set(o.contactId, (occasionCount.get(o.contactId) ?? 0) + 1);
  }

  const stats = new Map<string, ContactStats>();
  for (const contact of contacts) {
    const base = contact.isArchived
      ? { cadence: null, daysSince: null, daysUntilDue: null, status: 'unclassified' as const }
      : careStatusOf(contact, config, today);
    stats.set(contact.id, {
      ...base,
      score: base.cadence === null ? null : scoreContact(
        contact,
        byContact.get(contact.id) ?? [],
        giftsByContact.get(contact.id) ?? [],
        occasionCount.get(contact.id) ?? 0,
        base.cadence,
        today,
      ),
    });
  }
  return stats;
}
