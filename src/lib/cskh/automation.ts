// ============================================================================
// CSKH — chọn việc nhắc cần tạo (port PRM usePrmAutomation, phần tính toán).
// Hàm thuần: nhận dữ liệu + hôm nay, trả về danh sách việc; phần ghi Supabase ở
// modules/cskh/data/api.ts (runCareAutomation).
//
//  1. Chuẩn bị quà: sự kiện của người đang chăm sóc còn ≤ "nhắc trước N ngày".
//     Chống trùng: last_reminded_year = năm dương của lần xảy ra kế tiếp.
//  2. Kết nối lại: người đang chăm sóc ĐÃ TỪNG liên hệ mà quá nhịp, chưa được nhắc
//     sau lần liên hệ cuối. Người chưa từng liên hệ không sinh việc (đã nằm ở hàng
//     đợi Hôm nay) — tránh vừa xếp nhóm xong là Workspace bị dội hàng chục việc.
//     Quá hạn nhiều nhất trước, tối đa `maxReconnect` việc mỗi lần.
// ============================================================================
import { resolveCadence } from './cadence';
import { diffDays, nextOccurrenceIso } from './lunar';
import type { CadenceConfig, CskhContact, CskhOccasion } from './types';

export interface GiftReminder {
  occasion: CskhOccasion;
  contact: CskhContact;
  /** Ngày dương của lần xảy ra kế tiếp = hạn của việc. */
  nextIso: string;
  eventYear: number;
  title: string;
}

export interface ReconnectReminder {
  contact: CskhContact;
  overdue: number;
  title: string;
}

/** Mặc định mỗi lần chạy tạo tối đa bấy nhiêu việc "Kết nối lại". */
export const RECONNECT_MAX_PER_RUN = 10;

export function planCareReminders(input: {
  contacts: readonly CskhContact[];
  occasions: readonly CskhOccasion[];
  cadence: CadenceConfig;
  today: string;
  maxReconnect?: number;
}): { gifts: GiftReminder[]; reconnect: ReconnectReminder[] } {
  const { today } = input;
  const byId = new Map(input.contacts.map(c => [c.id, c]));
  const cared = (c: CskhContact | undefined): c is CskhContact => !!c && !c.isArchived && c.tier !== 'unclassified';

  const gifts: GiftReminder[] = [];
  for (const o of input.occasions) {
    const contact = byId.get(o.contactId);
    if (o.isArchived || !cared(contact)) continue;
    const nextIso = nextOccurrenceIso(o.day, o.month, o.isLunar, today);
    const daysUntil = diffDays(today, nextIso);
    const eventYear = Number(nextIso.slice(0, 4));
    if (daysUntil > o.remindDaysBefore || o.lastRemindedYear === eventYear) continue;
    const what = o.relatedPerson && !o.title.toLowerCase().includes(o.relatedPerson.toLowerCase())
      ? `${o.title} của ${o.relatedPerson}` : o.title;
    gifts.push({
      occasion: o, contact, nextIso, eventYear,
      title: `CSKH: Chuẩn bị quà ${what} — ${contact.fullName} (${nextIso.slice(8, 10)}/${nextIso.slice(5, 7)})`,
    });
  }

  const reconnect = input.contacts
    .filter(cared)
    .filter(c => c.lastInteractionAt !== null && !(c.lastColdAlertAt !== null && c.lastColdAlertAt > (c.lastInteractionAt as string)))
    .map(c => ({ contact: c, overdue: diffDays(c.lastInteractionAt as string, today) - (resolveCadence(c, input.cadence) as number) }))
    .filter(x => x.overdue > 0)
    .sort((a, b) => b.overdue - a.overdue || a.contact.fullName.localeCompare(b.contact.fullName, 'vi'))
    .slice(0, input.maxReconnect ?? RECONNECT_MAX_PER_RUN)
    .map(x => ({ ...x, title: `CSKH: Kết nối lại với ${x.contact.fullName} — quá hạn ${x.overdue} ngày` }));

  return { gifts, reconnect };
}
