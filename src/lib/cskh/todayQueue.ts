// ============================================================================
// CSKH — Hàng đợi "Hôm nay cần liên hệ" (giữ NGUYÊN quy tắc PRM, todayQueue.ts)
// ----------------------------------------------------------------------------
// Hàm thuần: không gọi Supabase, không đọc đồng hồ (today = todayVN() truyền vào).
// Dùng chung cho Dashboard (giao diện) và digest Telegram (server, giai đoạn sau).
//
// Mỗi người 1 dòng, lấy lý do ưu tiên cao nhất; lý do còn lại ghi ở alsoLabels.
// Ưu tiên (số càng to càng lên đầu):
//   4000 + số ngày quá hạn (trần 365)   việc đã hứa quá hạn
//   3000                                việc đã hứa đến hạn hôm nay
//   2000 + (7 − số ngày còn lại) × 10   sự kiện trong 0–7 ngày tới (chỉ người đang chăm sóc)
//   1000 + min(quá hạn, 300) × 2 + (100 − điểm)   quá nhịp liên hệ
// Bằng điểm thì xếp theo tên gọi (vần tiếng Việt, như danh bạ LetsGo).
// Người đã nghỉ (isArchived) không bao giờ vào hàng đợi. Người "Chưa chăm sóc"
// chỉ vào khi có việc đã hứa (vì do chính mình tạo).
// ============================================================================
import { compareVnName } from '../vnName';
import { resolveCadence } from './cadence';
import { diffDays, nextOccurrenceIso } from './lunar';
import { scoreContact } from './score';
import type { CadenceConfig, CskhContact, CskhGift, CskhInteraction, CskhOccasion } from './types';

export type TodayReason =
  | 'followup_overdue'
  | 'followup_today'
  | 'occasion_soon'
  | 'cadence_overdue';

export interface TodayQueueItem {
  contactId: string;
  reason: TodayReason;
  priority: number;
  daysOverdue?: number;
  daysUntil?: number;
  /** Câu ngắn: "Hứa: gửi báo giá — quá hạn 1 ngày", "Sinh nhật sau 2 ngày (âm lịch)"… */
  label: string;
  /** Khi lý do là việc đã hứa: id dòng nhật ký chứa việc đó (để bấm "Xong"). */
  interactionId?: string;
  /** Nhãn các lý do còn lại của CÙNG người ("Còn: …"). */
  alsoLabels: string[];
}

export interface TodayQueueInput {
  contacts: readonly CskhContact[];
  interactions: readonly CskhInteraction[];
  occasions: readonly CskhOccasion[];
  /** Chỉ dùng để chấm điểm khi xếp thứ tự; bỏ trống = coi như chưa tặng quà. */
  gifts?: readonly CskhGift[];
  cadence: CadenceConfig;
  /** "YYYY-MM-DD" giờ Việt Nam. */
  today: string;
}

export interface TodayQueueResult {
  /** Tối đa `limit` người, đã sắp theo ưu tiên. */
  items: TodayQueueItem[];
  /** Số người còn lại không hiện ("+N người khác đang chờ"). */
  hiddenCount: number;
}

/** Tối đa bao nhiêu người/ngày trên Dashboard (tránh quá tải). */
export const TODAY_QUEUE_LIMIT = 7;
/** Sự kiện trong bao nhiêu ngày tới thì vào hàng đợi. */
export const OCCASION_WINDOW_DAYS = 7;

interface Candidate {
  reason: TodayReason;
  priority: number;
  label: string;
  daysOverdue?: number;
  daysUntil?: number;
  interactionId?: string;
}

function shorten(text: string, max: number): string {
  const t = text.trim().replace(/\s+/g, ' ');
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** "Sinh nhật của con gái sau 2 ngày (âm lịch)" — thêm "của …" khi tiêu đề chưa nói rõ. */
export function occasionLabel(o: Pick<CskhOccasion, 'title' | 'relatedPerson' | 'isLunar'>, daysUntil: number): string {
  const who = o.relatedPerson.trim();
  const base = who !== '' && !o.title.toLowerCase().includes(who.toLowerCase())
    ? `${o.title} của ${who}`
    : o.title;
  const when = daysUntil === 0 ? 'hôm nay' : daysUntil === 1 ? 'ngày mai' : `sau ${daysUntil} ngày`;
  return `${base} ${when}${o.isLunar ? ' (âm lịch)' : ''}`;
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

export function buildTodayQueue(input: TodayQueueInput, limit: number = TODAY_QUEUE_LIMIT): TodayQueueResult {
  const { contacts, cadence, today } = input;
  const interactions = input.interactions.filter(i => !i.isArchived);
  const occasions = input.occasions.filter(o => !o.isArchived);
  const gifts = (input.gifts ?? []).filter(g => !g.isArchived);

  const active = new Map<string, CskhContact>();
  for (const c of contacts) {
    if (!c.isArchived) active.set(c.id, c);
  }

  const candidates = new Map<string, Candidate[]>();
  const add = (contactId: string, c: Candidate) => {
    const list = candidates.get(contactId);
    if (list) list.push(c);
    else candidates.set(contactId, [c]);
  };

  // 1) Việc đã hứa: có hạn, chưa xong
  for (const it of interactions) {
    if (it.contactId === null || !active.has(it.contactId)) continue;
    const action = it.followUpAction.trim();
    if (action === '' || it.followUpDone || it.followUpDue === null) continue;
    const overdue = diffDays(it.followUpDue, today); // > 0: đã quá hạn
    if (overdue > 0) {
      add(it.contactId, {
        reason: 'followup_overdue',
        priority: 4000 + Math.min(overdue, 365),
        label: `Hứa: ${shorten(action, 60)} — quá hạn ${overdue} ngày`,
        daysOverdue: overdue,
        interactionId: it.id,
      });
    } else if (overdue === 0) {
      add(it.contactId, {
        reason: 'followup_today',
        priority: 3000,
        label: `Hứa: ${shorten(action, 60)} — đến hạn hôm nay`,
        daysOverdue: 0,
        interactionId: it.id,
      });
    }
  }

  // 2) Sự kiện trong 0..7 ngày tới (âm hoặc dương lịch) — CHỈ người đang chăm sóc
  for (const o of occasions) {
    const owner = active.get(o.contactId);
    if (!owner || owner.tier === 'unclassified') continue;
    const nextIso = nextOccurrenceIso(o.day, o.month, o.isLunar, today);
    const daysUntil = diffDays(today, nextIso);
    if (daysUntil < 0 || daysUntil > OCCASION_WINDOW_DAYS) continue;
    add(o.contactId, {
      reason: 'occasion_soon',
      priority: 2000 + (OCCASION_WINDOW_DAYS - daysUntil) * 10,
      label: occasionLabel(o, daysUntil),
      daysUntil,
    });
  }

  // 3) Quá nhịp liên hệ (cùng công thức buildContactStats: daysUntilDue < 0)
  const byContact = groupBy(interactions, i => i.contactId);
  const giftsByContact = groupBy(gifts, g => g.contactId);
  const occasionCount = new Map<string, number>();
  for (const o of occasions) {
    occasionCount.set(o.contactId, (occasionCount.get(o.contactId) ?? 0) + 1);
  }
  for (const c of active.values()) {
    const cadenceDays = resolveCadence(c, cadence);
    if (cadenceDays === null) continue;
    const daysSince = c.lastInteractionAt === null ? null : diffDays(c.lastInteractionAt, today);
    const daysUntilDue = daysSince === null ? -cadenceDays : cadenceDays - daysSince;
    if (daysUntilDue >= 0) continue;
    const daysOverdue = -daysUntilDue;
    const score = scoreContact(
      c,
      byContact.get(c.id) ?? [],
      giftsByContact.get(c.id) ?? [],
      occasionCount.get(c.id) ?? 0,
      cadenceDays,
      today,
    );
    add(c.id, {
      reason: 'cadence_overdue',
      // quá hạn càng lâu + điểm càng thấp → càng cao (trần 1700 < 2000)
      priority: 1000 + Math.min(daysOverdue, 300) * 2 + (score ? 100 - score.total : 50),
      label: daysSince === null ? 'Chưa có tương tác nào' : `${daysSince} ngày chưa liên hệ`,
      daysOverdue,
    });
  }

  const all: Array<{ item: TodayQueueItem; name: string }> = [];
  for (const [contactId, list] of candidates) {
    const [primary, ...rest] = [...list].sort((a, b) => b.priority - a.priority);
    all.push({
      name: active.get(contactId)?.fullName ?? '',
      item: {
        contactId,
        reason: primary.reason,
        priority: primary.priority,
        daysOverdue: primary.daysOverdue,
        daysUntil: primary.daysUntil,
        label: primary.label,
        interactionId: primary.interactionId,
        alsoLabels: rest.map(r => r.label),
      },
    });
  }
  all.sort((a, b) =>
    b.item.priority - a.item.priority ||
    compareVnName(a.name, b.name) ||
    a.item.contactId.localeCompare(b.item.contactId),
  );

  const max = Math.max(0, Math.floor(limit));
  return {
    items: all.slice(0, max).map(x => x.item),
    hiddenCount: Math.max(0, all.length - max),
  };
}
