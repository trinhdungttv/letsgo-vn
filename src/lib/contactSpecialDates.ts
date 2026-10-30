// ============================================================================
// Ngày đặc biệt của người liên hệ (contact_special_dates, migration 144) +
// tính toán "sắp tới ngày nào" để nhắc quà tặng. Sinh nhật (contacts.birthday)
// và mọi ngày đặc biệt đều LẶP LẠI HÀNG NĂM theo tháng/ngày — năm trong `date`
// không mang nghĩa. Từ migration CSKH 171 có thêm sự kiện ÂM LỊCH (date = NULL,
// dùng day/month) — form người liên hệ chỉ quản lý phần dương lịch, phần còn lại
// ở CSKH → Sự kiện & Quà tặng.
// ============================================================================
import { supabase } from './supabase';
import type { Contact } from './types';
import { selectContacts } from './contactOps';
import { todayVN } from './cskh/dates';
import { contactKindOf } from './cskh/space';
import { diffDays, nextOccurrenceIso } from './cskh/lunar';
import { birthdayOccasion, mapContactRow, mapSpecialDateRow, type ContactRow, type SpecialDateRow } from './cskh/mappers';
import { buildOccasionAlerts, type OccasionAlert } from './cskh/occasions';
import type { CskhOccasion } from './cskh/types';

export interface SpecialDate {
  id: string;
  contact_id: string;
  label: string;
  date: string; // yyyy-mm-dd
}

/** Bảng chưa tồn tại (chưa chạy migration 144). */
const isMissingTableError = (err: { message?: string; code?: string } | null) =>
  !!err && (err.code === '42P01' || /could not find the table|does not exist|schema cache/i.test(err.message || ''));

/** Cột chưa có (chưa chạy migration CSKH 171 — chưa có is_archived / day / month…). */
const isMissingColumnError = (err: { message?: string; code?: string } | null) =>
  !!err && (err.code === '42703' || err.code === 'PGRST204'
    || /column .* does not exist|could not find the .* column/i.test(err.message || ''));

/**
 * Chạy truy vấn bỏ qua sự kiện đã xoá mềm (is_archived, migration 171); DB chưa có
 * cột đó thì chạy lại không lọc — trước migration chưa có gì bị xoá mềm.
 */
async function withoutArchived<T>(
  build: (q: any) => any, // eslint-disable-line @typescript-eslint/no-explicit-any -- builder Supabase
): Promise<{ data: T[] | null; error: { message?: string; code?: string } | null }> {
  const first = await build(supabase.from('contact_special_dates')).eq('is_archived', false);
  if (!isMissingColumnError(first.error)) return first;
  return build(supabase.from('contact_special_dates'));
}

/**
 * Ngày đặc biệt DƯƠNG LỊCH của 1 người (có cột `date`) — đúng phần form người
 * liên hệ quản lý. Sự kiện âm lịch (migration 171, `date` = NULL) do trang
 * Sự kiện & Quà tặng của CSKH quản lý nên không trả về ở đây.
 */
export async function fetchSpecialDates(contactId: string): Promise<SpecialDate[]> {
  const { data, error } = await withoutArchived<SpecialDate>(q => q
    .select('id, contact_id, label, date')
    .eq('contact_id', contactId)
    .not('date', 'is', null)
    .order('date'));
  if (error || !data) return [];
  return data;
}

const MIGRATION_144_MSG = 'Chưa lưu được ngày đặc biệt: cần chạy migration 144 trên Supabase trước.';

/**
 * Lưu danh sách ngày đặc biệt dương lịch của 1 người theo TỪNG DÒNG: dòng bị bỏ
 * khỏi danh sách thì xoá, dòng đổi tên/ngày thì sửa, dòng mới thì thêm.
 *
 * Trước đây hàm này xoá hết rồi chèn lại — từ khi CSKH thêm cột cho sự kiện
 * (loại, người thân, nhắc trước N ngày, âm lịch… — migration 171), cách đó sẽ
 * làm mất các thông tin ấy mỗi lần bấm Lưu ở form người liên hệ. Giờ chỉ đụng
 * tới dòng dương lịch form này đang hiển thị; sự kiện âm lịch giữ nguyên.
 * Trả về null nếu thành công, hoặc thông báo lỗi thân thiện.
 */
export async function saveSpecialDates(
  contactId: string,
  items: { id?: string; label: string; date: string }[]
): Promise<string | null> {
  const clean = items.filter(i => i.label.trim() && i.date);
  // Sự kiện đã xoá mềm không hiện ở form → cũng không được đụng tới ở đây
  const { data: existing, error: readErr } = await withoutArchived<{ id: string; label: string; date: string }>(q => q
    .select('id, label, date')
    .eq('contact_id', contactId)
    .not('date', 'is', null));
  if (readErr) {
    if (!isMissingTableError(readErr)) return readErr.message || 'Lỗi không rõ';
    // Bảng chưa tồn tại: nếu người dùng KHÔNG có gì cần lưu (chỉ đang xem) thì
    // im lặng bỏ qua là hợp lý. Nhưng nếu họ vừa nhập ngày đặc biệt, phải báo rõ
    // — người dùng tưởng đã lưu mà thực ra chưa có gì được ghi.
    return clean.length > 0 ? MIGRATION_144_MSG : null;
  }

  const rows = existing || [];
  const wanted = new Map(clean.filter(i => i.id).map(i => [i.id as string, i]));

  // Dòng bị bỏ khỏi form → xoá MỀM như mọi nơi khác của CSKH (giữ loại, người thân, quà đã gắn…;
  // khôi phục được). DB chưa có cột is_archived (chưa chạy migration 171) thì xoá như trước.
  const removed = rows.filter(r => !wanted.has(r.id)).map(r => r.id);
  if (removed.length) {
    const soft = await supabase.from('contact_special_dates').update({ is_archived: true }).in('id', removed);
    if (soft.error) {
      if (!isMissingColumnError(soft.error)) return soft.error.message;
      const { error } = await supabase.from('contact_special_dates').delete().in('id', removed);
      if (error) return error.message;
    }
  }

  for (const r of rows) {
    const it = wanted.get(r.id);
    if (!it || (it.label.trim() === r.label && it.date === r.date)) continue;
    const { error } = await supabase
      .from('contact_special_dates')
      .update({ label: it.label.trim(), date: it.date })
      .eq('id', r.id);
    if (error) return error.message;
  }

  // Dòng chưa có id, hoặc id không còn trong DB (đã bị xoá ở nơi khác) → thêm mới
  const known = new Set(rows.map(r => r.id));
  const added = clean.filter(i => !i.id || !known.has(i.id));
  if (added.length) {
    const { error } = await supabase
      .from('contact_special_dates')
      .insert(added.map(i => ({ contact_id: contactId, label: i.label.trim(), date: i.date })));
    if (error) return isMissingTableError(error) ? MIGRATION_144_MSG : error.message;
  }
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
  /** Sự kiện âm lịch (monthDay khi đó là ngày dương của lần tới). */
  isLunar?: boolean;
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

type ContactLite = Pick<Contact, 'name' | 'avatar_url' | 'role' | 'is_active' | 'kind'> & { clients?: { name: string } | null };
type SpecialDateWithContact = SpecialDateRow & { contacts: ContactLite | null };

/**
 * Các ngày đặc biệt (sinh nhật + ngày khác) rơi trong `withinDays` ngày tới, tính cả
 * hôm nay (giờ Việt Nam) — dùng cho popup nhắc khi mở app.
 *
 * Từ migration CSKH 169/171 (chốt 19/10/2026): chỉ người ĐANG CHĂM SÓC (đang phụ
 * trách + đã chọn hạng), tính cả sự kiện ÂM LỊCH và sự kiện của người thân, bỏ sự
 * kiện đã xoá. DB chưa chạy migration thì giữ cách cũ (mọi người đang phụ trách,
 * chỉ dương lịch).
 */
export async function fetchUpcomingContactEvents(withinDays = 7, today = todayVN()): Promise<UpcomingEvent[]> {
  const [cRes, sRes] = await Promise.all([
    // `*` để có cột kind (migration 178) khi đã chạy mà chưa chạy vẫn đọc được — popup này chỉ của khách hàng
    supabase.from('contacts')
      .select('*, clients!contacts_client_id_fkey(name)')
      .eq('is_active', true)
      .neq('tier', 'unclassified')
      .not('birthday', 'is', null),
    supabase.from('contact_special_dates')
      .select('*, contacts(*, clients!contacts_client_id_fkey(name))')
      .eq('is_archived', false),
  ]);
  if (isMissingColumnError(cRes.error) || isMissingColumnError(sRes.error)) return legacyUpcoming(withinDays);

  const events: UpcomingEvent[] = [];
  const push = (contactId: string, c: ContactLite, label: string, nextIso: string, isLunar: boolean) => {
    const daysUntil = diffDays(today, nextIso);
    if (daysUntil < 0 || daysUntil > withinDays) return;
    events.push({
      contactId, contactName: c.name, avatarUrl: c.avatar_url || null, role: c.role || null,
      clientName: c.clients?.name || null, label, monthDay: nextIso, daysUntil, isToday: daysUntil === 0, isLunar,
    });
  };

  for (const c of (cRes.data || []) as unknown as (ContactLite & { id: string; birthday: string | null })[]) {
    if (!c.birthday || contactKindOf(c) !== 'client') continue;
    push(c.id, c, 'Sinh nhật', nextOccurrenceIso(Number(c.birthday.slice(8, 10)), Number(c.birthday.slice(5, 7)), false, today), false);
  }

  for (const row of (sRes.data || []) as unknown as SpecialDateWithContact[]) {
    const contact = row.contacts as (ContactLite & { tier?: string }) | null;
    if (!contact || contact.is_active === false || contact.tier === 'unclassified' || contactKindOf(contact) !== 'client') continue;
    const o = mapSpecialDateRow(row);
    if (!o) continue;
    const who = o.relatedPerson && !o.title.toLowerCase().includes(o.relatedPerson.toLowerCase()) ? ` của ${o.relatedPerson}` : '';
    push(o.contactId, contact, `${o.title}${who}${o.isLunar ? ' (âm lịch)' : ''}`, nextOccurrenceIso(o.day, o.month, o.isLunar, today), o.isLunar);
  }

  return events.sort((a, b) => a.daysUntil - b.daysUntil || a.contactName.localeCompare(b.contactName, 'vi'));
}

/**
 * Mốc nhắc ngày quan trọng khi mở app (nâng cấp 24/10/2026, port PRM OccasionAlertHost):
 * mỗi sự kiện nhắc TRƯỚC N ngày (số ngày riêng từng sự kiện) rồi nhắc LẠI ĐÚNG NGÀY — người
 * gọi tự lọc các mốc đã xem. Chỉ người đang chăm sóc (cùng luật với hàng đợi Hôm nay).
 * Trả về null khi DB chưa chạy migration CSKH 169/171 → người gọi dùng cách cũ.
 */
export async function fetchOccasionAlerts(today = todayVN()): Promise<OccasionAlert[] | null> {
  const [rows, sRes] = await Promise.all([
    selectContacts(q => q.eq('is_active', true)) as Promise<ContactRow[]>,
    supabase.from('contact_special_dates').select('*').eq('is_archived', false),
  ]);
  if (rows.length > 0 && !('tier' in rows[0])) return null;
  if (isMissingColumnError(sRes.error)) return null;
  const contacts = rows.map(mapContactRow).filter(c => c.tier !== 'unclassified' && !c.isArchived);
  const ids = new Set(contacts.map(c => c.id));
  const occasions: CskhOccasion[] = [
    ...((sRes.data ?? []) as SpecialDateRow[]).filter(r => ids.has(r.contact_id)).map(mapSpecialDateRow)
      .filter((o): o is CskhOccasion => o !== null),
    ...contacts.map(birthdayOccasion).filter((o): o is CskhOccasion => o !== null),
  ];
  return buildOccasionAlerts(contacts, occasions, today);
}

/** Cách tính trước migration CSKH: mọi người đang phụ trách, chỉ dương lịch. */
async function legacyUpcoming(withinDays: number): Promise<UpcomingEvent[]> {
  const now = new Date();
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
    const daysUntil = daysUntilNextOccurrence(c.birthday, now);
    if (daysUntil <= withinDays) {
      events.push({
        contactId: c.id, contactName: c.name, avatarUrl: c.avatar_url || null, role: c.role || null,
        clientName: c.clients?.name || null, label: 'Sinh nhật', monthDay: c.birthday,
        daysUntil, isToday: daysUntil === 0,
      });
    }
  }

  for (const s of (specials || []) as unknown as SpecialDateWithContact[]) {
    const contact = s.contacts;
    if (!contact || contact.is_active === false || !s.date) continue;
    const daysUntil = daysUntilNextOccurrence(s.date, now);
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
