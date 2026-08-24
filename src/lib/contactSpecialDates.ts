// ============================================================================
// Ngày đặc biệt của người liên hệ (contact_special_dates, migration 144) +
// tính toán "sắp tới ngày nào" để nhắc quà tặng. Sinh nhật (contacts.birthday)
// và mọi ngày đặc biệt đều được coi là LẶP LẠI HÀNG NĂM theo tháng/ngày —
// không quan tâm năm đã lưu.
// ============================================================================
import { supabase } from './supabase';
import type { Contact } from './types';

export interface SpecialDate {
  id: string;
  contact_id: string;
  label: string;
  date: string; // yyyy-mm-dd
}

/** Bảng chưa tồn tại (chưa chạy migration 144). */
const isMissingTableError = (err: { message?: string; code?: string } | null) =>
  !!err && (err.code === '42P01' || /could not find the table|does not exist|schema cache/i.test(err.message || ''));

export async function fetchSpecialDates(contactId: string): Promise<SpecialDate[]> {
  const { data, error } = await supabase
    .from('contact_special_dates')
    .select('id, contact_id, label, date')
    .eq('contact_id', contactId)
    .order('date');
  if (error || !data) return [];
  return data as SpecialDate[];
}

/**
 * Ghi lại toàn bộ danh sách ngày đặc biệt của 1 người: xoá hết rồi chèn lại.
 * Số lượng mỗi người rất nhỏ (vài dòng) nên không cần diff phức tạp.
 * Trả về null nếu thành công, hoặc thông báo lỗi thân thiện nếu bảng chưa có.
 */
const MIGRATION_144_MSG = 'Chưa lưu được ngày đặc biệt: cần chạy migration 144 trên Supabase trước.';

export async function saveSpecialDates(
  contactId: string,
  items: { label: string; date: string }[]
): Promise<string | null> {
  const clean = items.filter(i => i.label.trim() && i.date);
  const { error: delErr } = await supabase.from('contact_special_dates').delete().eq('contact_id', contactId);
  if (delErr) {
    if (!isMissingTableError(delErr)) return delErr.message;
    // Bảng chưa tồn tại: nếu người dùng KHÔNG có gì cần lưu (chỉ đang xem) thì
    // im lặng bỏ qua là hợp lý. Nhưng nếu họ vừa nhập ngày đặc biệt, phải báo rõ
    // — trước đây bước xoá thất bại âm thầm khiến bước chèn không bao giờ chạy,
    // người dùng tưởng đã lưu mà thực ra chưa có gì được ghi.
    return clean.length > 0 ? MIGRATION_144_MSG : null;
  }
  if (clean.length === 0) return null;
  const { error: insErr } = await supabase
    .from('contact_special_dates')
    .insert(clean.map(i => ({ contact_id: contactId, label: i.label.trim(), date: i.date })));
  if (insErr) return isMissingTableError(insErr) ? MIGRATION_144_MSG : insErr.message;
  return null;
}

// ── Tính "còn bao nhiêu ngày nữa" ───────────────────────────────────────────
export interface UpcomingEvent {
  contactId: string;
  contactName: string;
  avatarUrl: string | null;
  role: string | null;
  clientName: string | null;
  label: string;
  /** Ngày gốc (yyyy-mm-dd) — dùng để hiện "26/08" bất kể năm nào. */
  monthDay: string;
  daysUntil: number;
  isToday: boolean;
}

/** Số ngày từ hôm nay tới lần lặp lại gần nhất (0 = hôm nay, tính theo giờ VN). */
function daysUntilNextOccurrence(dateStr: string, today: Date): number {
  const [, m, d] = dateStr.split('-').map(Number);
  if (!m || !d) return Infinity;
  const y = today.getFullYear();
  // Ngày 29/2 ở năm không nhuận: coi như rơi vào 1/3 để không bị trôi mất.
  const mk = (year: number) => {
    const dt = new Date(year, m - 1, d);
    return dt.getMonth() === m - 1 ? dt : new Date(year, 2, 1);
  };
  let next = mk(y);
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (next < t0) next = mk(y + 1);
  return Math.round((next.getTime() - t0.getTime()) / 86400000);
}

/**
 * Lấy các ngày đặc biệt (sinh nhật + ngày khác) rơi trong `withinDays` ngày tới,
 * tính cả hôm nay. Chỉ xét người liên hệ đang hoạt động.
 */
export async function fetchUpcomingContactEvents(withinDays = 7, today = new Date()): Promise<UpcomingEvent[]> {
  const [{ data: contacts }, { data: specials }] = await Promise.all([
    supabase.from('contacts')
      .select('id, name, avatar_url, role, birthday, is_active, clients!contacts_client_id_fkey(name)')
      .eq('is_active', true)
      .not('birthday', 'is', null),
    supabase.from('contact_special_dates')
      .select('id, contact_id, label, date, contacts(name, avatar_url, role, is_active, clients!contacts_client_id_fkey(name))'),
  ]);

  const events: UpcomingEvent[] = [];

  for (const c of (contacts || []) as unknown as (Contact & { clients?: { name: string } | null })[]) {
    if (!c.birthday) continue;
    const daysUntil = daysUntilNextOccurrence(c.birthday, today);
    if (daysUntil <= withinDays) {
      events.push({
        contactId: c.id, contactName: c.name, avatarUrl: c.avatar_url || null, role: c.role || null,
        clientName: c.clients?.name || null, label: 'Sinh nhật', monthDay: c.birthday,
        daysUntil, isToday: daysUntil === 0,
      });
    }
  }

  for (const s of (specials || []) as any[]) {
    const contact = s.contacts;
    if (!contact || contact.is_active === false || !s.date) continue;
    const daysUntil = daysUntilNextOccurrence(s.date, today);
    if (daysUntil <= withinDays) {
      events.push({
        contactId: s.contact_id, contactName: contact.name, avatarUrl: contact.avatar_url || null,
        role: contact.role || null, clientName: contact.clients?.name || null,
        label: s.label, monthDay: s.date, daysUntil, isToday: daysUntil === 0,
      });
    }
  }

  return events.sort((a, b) => a.daysUntil - b.daysUntil || a.contactName.localeCompare(b.contactName, 'vi'));
}
