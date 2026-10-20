// ============================================================================
// CSKH — đọc / ghi Supabase. Mọi quy tắc tính toán nằm ở src/lib/cskh (hàm thuần);
// file này chỉ lo I/O + ghi lịch sử (audit_logs).
// ----------------------------------------------------------------------------
// Chạy được khi DB CHƯA chạy migration 168–173: phần đọc dùng select('*') và
// mapper tự lấy mặc định; phần ghi báo rõ "cần chạy migration" thay vì nuốt lỗi.
// ============================================================================
import { supabase } from '../../../lib/supabase';
import { logActivity } from '../../../lib/audit';
import { branchOf } from '../../../lib/branchRef';
import { contactToForm, saveContact, selectContacts, type ContactFormValues } from '../../../lib/contactOps';
import { nominatimGeocode, parseLatLngFromLink } from '../../../lib/geo';
import { cleanRememberNotes } from '../../../lib/cskh/remember';
import { planCareReminders } from '../../../lib/cskh/automation';
import { isValidDayMonth } from '../../../lib/cskh/dates';
import type { AppUser, Branch, Client, Contact } from '../../../lib/types';
import {
  birthdayOccasion, mapContactRow, mapGiftRow, mapGroupRow, mapLogRow, mapSettingsRow, mapSpecialDateRow,
  type ClientGiftRow, type ContactRow, type CskhGroupRow, type CskhLogRow, type CskhSettingsRow, type SpecialDateRow,
} from '../../../lib/cskh/mappers';
import type {
  CskhClassifiedTier, CskhContact, CskhContext, CskhGift, CskhGroup, CskhInteraction, CskhOccasion, CskhSettings,
  CskhTier, GroupColor, InitiatedBy, InteractionChannel, InteractionType, RememberNotes,
} from '../../../lib/cskh/types';

export const MIGRATION_HINT =
  'Cần chạy migration CSKH 168–173 trên Supabase (SQL Editor) trước khi lưu dữ liệu chăm sóc.';

type DbError = { message?: string; code?: string } | null;

const isMissingSchema = (err: DbError) =>
  !!err && (err.code === '42P01' || err.code === '42703' || err.code === 'PGRST204' ||
    /could not find the .* (table|column)|does not exist|schema cache/i.test(err.message || ''));

/** Lỗi ghi → câu tiếng Việt đọc được (thiếu bảng/cột = chưa chạy migration). */
function writeError(err: DbError): Error {
  return new Error(isMissingSchema(err) ? MIGRATION_HINT : (err?.message || 'Lỗi không rõ'));
}

/** Supabase trả tối đa 1000 dòng/lần — nhật ký nhiều năm phải tải theo trang. */
async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: unknown; error: DbError }>): Promise<T[]> {
  const PAGE = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

export interface AppUserLite {
  id: string;
  full_name: string;
}

export interface CskhData {
  contacts: CskhContact[];
  /** Dòng `contacts` gốc theo id — các thao tác chung với hồ sơ Khách hàng đi qua lib/contactOps. */
  rawContacts: Map<string, Contact>;
  /** Mọi dòng nhật ký (kể cả dòng cũ chưa gắn người, dòng đã lưu trữ) — mới nhất trước. */
  interactions: CskhInteraction[];
  /** Sự kiện từ contact_special_dates + sinh nhật trong hồ sơ (contacts.birthday). */
  occasions: CskhOccasion[];
  gifts: CskhGift[];
  settings: CskhSettings;
  groups: CskhGroup[];
  users: AppUserLite[];
  /** false = DB chưa chạy migration 168–173 (chỉ xem được, chưa lưu được). */
  migrationReady: boolean;
}

export async function loadCskhData(): Promise<CskhData> {
  const [contactRows, logRows, dateRes, giftRes, settingsRes, groupRes, userRes] = await Promise.all([
    selectContacts(q => q.order('name')) as Promise<ContactRow[]>,
    fetchAll<CskhLogRow>((from, to) => supabase.from('cskh_logs').select('*')
      .order('log_date', { ascending: false }).order('created_at', { ascending: false }).order('id').range(from, to)),
    supabase.from('contact_special_dates').select('*'),
    supabase.from('client_gifts').select('*').order('gift_date', { ascending: false }),
    supabase.from('cskh_settings').select('*').eq('id', 1).maybeSingle(),
    supabase.from('cskh_groups').select('*').order('name'),
    supabase.from('app_users').select('id, full_name').order('full_name'),
  ]);

  // Bảng có sẵn trước CSKH mà lỗi → báo; bảng mới chưa có (chưa chạy migration) → bỏ qua
  if (dateRes.error && !isMissingSchema(dateRes.error)) throw dateRes.error;
  if (giftRes.error) throw giftRes.error;
  if (settingsRes.error && !isMissingSchema(settingsRes.error)) throw settingsRes.error;
  if (groupRes.error && !isMissingSchema(groupRes.error)) throw groupRes.error;

  const migrationReady = !settingsRes.error && (contactRows.length === 0 || 'tier' in contactRows[0]);
  const contacts = contactRows.map(mapContactRow);

  // Việc đã hứa đã được đánh dấu xong bên Workspace → coi như xong ở CSKH luôn
  let interactions = logRows.map(mapLogRow);
  const openTaskIds = interactions.filter(i => !i.followUpDone && i.followUpTaskId).map(i => i.followUpTaskId as string);
  if (openTaskIds.length) {
    const { data: tasks } = await supabase.from('work_tasks').select('id, status').in('id', openTaskIds);
    const done = new Set(((tasks ?? []) as { id: string; status: string }[]).filter(t => t.status === 'done').map(t => t.id));
    if (done.size) {
      interactions = interactions.map(i => (i.followUpTaskId && done.has(i.followUpTaskId) ? { ...i, followUpDone: true } : i));
    }
  }

  const occasions: CskhOccasion[] = [
    ...((dateRes.data ?? []) as SpecialDateRow[]).map(mapSpecialDateRow).filter((o): o is CskhOccasion => o !== null),
    ...contacts.map(birthdayOccasion).filter((o): o is CskhOccasion => o !== null),
  ];

  return {
    contacts,
    rawContacts: new Map(contactRows.map(r => [r.id, r as Contact])),
    interactions,
    occasions,
    gifts: ((giftRes.data ?? []) as ClientGiftRow[]).map(mapGiftRow),
    settings: mapSettingsRow(settingsRes.data as CskhSettingsRow | null),
    groups: ((groupRes.data ?? []) as CskhGroupRow[]).map(mapGroupRow).filter(g => !g.isArchived),
    users: (userRes.data ?? []) as AppUserLite[],
    migrationReady,
  };
}

/** Một người liên hệ (dùng cho bottom sheet ghi nhận nhanh — không cần tải cả module). */
export async function loadContact(id: string): Promise<CskhContact | null> {
  const rows = await selectContacts(q => q.eq('id', id)) as ContactRow[];
  return rows[0] ? mapContactRow(rows[0]) : null;
}

// ── Ghi nhật ký + việc đã hứa ───────────────────────────────────────────────
export interface InteractionInput {
  contact: CskhContact;
  /** Công ty ghi kèm dòng nhật ký (người kiêm nhiều công ty thì chọn); null = chưa gắn công ty. */
  clientId: string | null;
  type: InteractionType;
  channel: InteractionChannel;
  initiatedBy: InitiatedBy;
  /** "YYYY-MM-DD" giờ Việt Nam */
  occurredAt: string;
  content: string;
  followUpAction: string;
  followUpDue: string | null;
}

export interface WriteCtx {
  user: AppUser | null;
  clients: readonly Client[];
  branches: Branch[];
}

/** Công ty mặc định khi ghi nhật ký: nơi người này là liên hệ chính, không thì công ty đầu tiên. */
export function defaultClientIdOf(contact: Pick<CskhContact, 'clientIds' | 'primaryClientIds'>): string | null {
  return contact.primaryClientIds[0] ?? contact.clientIds[0] ?? null;
}

/**
 * Ghi 1 dòng nhật ký. Có "việc tiếp theo" + hạn → tạo luôn 1 việc trong
 * Workspace (work_tasks, giao cho NGƯỜI PHỤ TRÁCH của người liên hệ, không có
 * thì cho người đang ghi) và lưu id vào followup_task_id — lời hứa không bị quên.
 */
export async function addInteraction(input: InteractionInput, ctx: WriteCtx): Promise<CskhInteraction> {
  const { contact } = input;
  const action = input.followUpAction.trim();
  if (action && !input.followUpDue) throw new Error('Việc tiếp theo cần có hạn');
  const client = input.clientId ? ctx.clients.find(c => c.id === input.clientId) ?? null : null;

  let taskId: string | null = null;
  if (action && input.followUpDue) {
    const assignee = contact.ownerId ?? ctx.user?.id;
    if (!assignee) throw new Error('Chưa đăng nhập');
    const { data: task, error } = await supabase.from('work_tasks').insert({
      user_id: assignee,
      client_id: client?.id ?? null,
      branch_id: branchOf(client, ctx.branches)?.id ?? null,
      title: `CSKH: ${action} — ${contact.fullName}`,
      task_type: 'CSKH',
      due_date: input.followUpDue,
      priority: 'high',
      status: 'pending',
      notes: input.content.trim() || null,
    }).select('id').single();
    if (error) throw writeError(error);
    taskId = (task as { id: string }).id;
  }

  const { data, error } = await supabase.from('cskh_logs').insert({
    contact_id: contact.id,
    client_id: client?.id ?? null,
    client_name: client?.name ?? (contact.organization || null),
    contact_person: contact.fullName,
    contact_type: input.type,
    channel: input.channel,
    initiated_by: input.initiatedBy,
    content: input.content.trim() || null,
    log_date: input.occurredAt,
    followup: action || null,
    followup_due: action ? input.followUpDue : null,
    followup_done: false,
    followup_task_id: taskId,
    created_by: ctx.user?.id ?? null,
    created_by_name: ctx.user?.full_name ?? null,
  }).select().single();

  if (error) {
    // Đừng để lại việc mồ côi trong Workspace khi dòng nhật ký không lưu được
    if (taskId) await supabase.from('work_tasks').delete().eq('id', taskId);
    throw writeError(error);
  }

  await logActivity({
    user: ctx.user, action: 'insert', table: 'cskh_logs', recordId: (data as { id: string }).id,
    description: `Ghi nhận chăm sóc "${contact.fullName}"${action ? ` — hứa: ${action}` : ''}`,
    newData: data,
  });
  return mapLogRow(data as CskhLogRow);
}

/**
 * Đánh dấu việc đã hứa xong / mở lại — và đóng / mở luôn việc đi kèm trong
 * Workspace để không còn việc "CSKH: …" mồ côi. Lỗi ở bước đóng việc không chặn
 * (việc có thể đã bị xoá bên Workspace).
 */
export async function setFollowUpDone(it: CskhInteraction, done: boolean, user: AppUser | null): Promise<void> {
  const { error } = await supabase.from('cskh_logs').update({ followup_done: done }).eq('id', it.id);
  if (error) throw writeError(error);
  if (it.followUpTaskId) {
    const now = new Date().toISOString();
    const { error: taskError } = await supabase.from('work_tasks')
      .update(done
        ? { status: 'done', completed_at: now, updated_at: now }
        : { status: 'pending', completed_at: null, updated_at: now })
      .eq('id', it.followUpTaskId);
    if (taskError) console.error('[cskh] Không cập nhật được việc đi kèm trong Workspace', taskError);
  }
  await logActivity({
    user, action: 'update', table: 'cskh_logs', recordId: it.id,
    description: `${done ? 'Xong' : 'Mở lại'} việc đã hứa "${it.followUpAction}" với ${it.contactPerson || 'người liên hệ'}`,
    oldData: { followup_done: it.followUpDone }, newData: { followup_done: done },
  });
}

// ── Sửa dòng nhật ký ────────────────────────────────────────────────────────
export interface InteractionEdit {
  /** Công ty ghi kèm (chỉ đổi được với dòng đã gắn người liên hệ). */
  clientId: string | null;
  type: InteractionType;
  /** null = dòng cũ không rõ ai chủ động — giữ nguyên nếu không đánh dấu "Họ chủ động". */
  initiatedBy: InitiatedBy | null;
  /** "YYYY-MM-DD" giờ Việt Nam */
  occurredAt: string;
  content: string;
  followUpAction: string;
  followUpDue: string | null;
}

/**
 * Sửa 1 dòng nhật ký (gõ sai nội dung, nhầm ngày / hình thức…). Người liên hệ giữ
 * nguyên — ghi nhầm người thì xoá dòng rồi ghi lại. Việc đã hứa đồng bộ với Workspace:
 *   • trước chưa hứa, nay thêm → tạo việc mới (như lúc ghi);
 *   • đổi chữ / hạn → sửa tên + hạn việc đi kèm;
 *   • xoá trắng → xoá mềm việc đi kèm nếu chưa xong (việc đã xong thì giữ).
 * Đổi ngày → trigger DB tự tính lại "ngày tương tác cuối" của người liên hệ.
 */
export async function updateInteraction(
  it: CskhInteraction,
  edit: InteractionEdit,
  contact: CskhContact | null,
  ctx: WriteCtx,
): Promise<void> {
  const action = edit.followUpAction.trim();
  if (action && !edit.followUpDue) throw new Error('Việc tiếp theo cần có hạn');
  const who = contact?.fullName || it.contactPerson || 'người liên hệ';
  const hadAction = it.followUpAction.trim() !== '';
  // Dòng cũ chưa gắn người: giữ nguyên công ty đã lưu dạng chữ
  const client = contact && edit.clientId ? ctx.clients.find(c => c.id === edit.clientId) ?? null : null;

  let createdTaskId: string | null = null;
  if (action && edit.followUpDue && !hadAction) {
    const assignee = contact?.ownerId ?? ctx.user?.id;
    if (!assignee) throw new Error('Chưa đăng nhập');
    const taskClient = client ?? (it.clientId ? ctx.clients.find(c => c.id === it.clientId) ?? null : null);
    const { data: task, error } = await supabase.from('work_tasks').insert({
      user_id: assignee,
      client_id: taskClient?.id ?? null,
      branch_id: branchOf(taskClient, ctx.branches)?.id ?? null,
      title: `CSKH: ${action} — ${who}`,
      task_type: 'CSKH',
      due_date: edit.followUpDue,
      priority: 'high',
      status: 'pending',
      notes: edit.content.trim() || null,
    }).select('id').single();
    if (error) throw writeError(error);
    createdTaskId = (task as { id: string }).id;
  }

  const patch = {
    contact_type: edit.type,
    // Đổi hình thức thì kênh theo hình thức mới; giữ nguyên thì giữ kênh cũ (VD Zalo từ ghi nhận nhanh)
    channel: edit.type === it.type ? it.channel : edit.type === 'call' ? 'call' : '',
    initiated_by: edit.initiatedBy,
    content: edit.content.trim() || null,
    log_date: edit.occurredAt,
    ...(contact ? { client_id: client?.id ?? null, client_name: client?.name ?? (contact.organization || null) } : {}),
    followup: action || null,
    followup_due: action ? edit.followUpDue : null,
    followup_done: action && hadAction ? it.followUpDone : false,
    followup_task_id: action ? createdTaskId ?? it.followUpTaskId : null,
  };
  const { data, error } = await supabase.from('cskh_logs').update(patch).eq('id', it.id).select().single();
  if (error) {
    if (createdTaskId) await supabase.from('work_tasks').delete().eq('id', createdTaskId);
    throw writeError(error);
  }

  // Việc đi kèm đã có trong Workspace: sửa theo lời hứa mới, hoặc xoá mềm khi bỏ hứa
  if (it.followUpTaskId) {
    const now = new Date().toISOString();
    const req = action
      ? (action !== it.followUpAction.trim() || edit.followUpDue !== it.followUpDue)
        ? supabase.from('work_tasks').update({ title: `CSKH: ${action} — ${who}`, due_date: edit.followUpDue, updated_at: now }).eq('id', it.followUpTaskId)
        : null
      : supabase.from('work_tasks').update({ deleted_at: now, updated_at: now }).eq('id', it.followUpTaskId).neq('status', 'done');
    if (req) {
      const { error: taskError } = await req;
      if (taskError) console.error('[cskh] Không cập nhật được việc đi kèm trong Workspace', taskError);
    }
  }

  await logActivity({
    user: ctx.user, action: 'update', table: 'cskh_logs', recordId: it.id,
    description: `Sửa nhật ký CSKH ngày ${edit.occurredAt} — ${who}`,
    oldData: it, newData: data,
  });
}

// ── Xếp nhóm / hạng chăm sóc ────────────────────────────────────────────────
export interface GroupAssignment {
  contactId: string;
  /** 'unclassified' = bỏ khỏi danh sách chăm sóc. */
  tier: CskhTier;
  /** Nhóm tự tạo (tier = hạng gốc của nhóm) hoặc null = nhóm mặc định. */
  groupId: string | null;
}

/**
 * Xếp người vào nhóm (nhóm mặc định = hạng, hoặc nhóm tự tạo = group_id + tier
 * hạng gốc của nhóm) — ghi gộp theo từng đích. Người vừa vào danh sách chăm sóc mà
 * chưa có người phụ trách thì giao cho người đang thao tác (chốt 19/10/2026).
 */
export async function assignGroups(rows: readonly GroupAssignment[], user: AppUser | null): Promise<void> {
  if (!rows.length) return;
  const byTarget = new Map<string, { tier: CskhTier; groupId: string | null; ids: string[] }>();
  for (const r of rows) {
    const groupId = r.tier === 'unclassified' ? null : r.groupId;
    const key = `${r.tier}|${groupId ?? ''}`;
    const cur = byTarget.get(key) ?? { tier: r.tier, groupId, ids: [] };
    cur.ids.push(r.contactId);
    byTarget.set(key, cur);
  }
  for (const t of byTarget.values()) {
    const { error } = await supabase.from('contacts').update({ tier: t.tier, group_id: t.groupId }).in('id', t.ids);
    if (error) throw writeError(error);
  }
  const cared = rows.filter(r => r.tier !== 'unclassified').map(r => r.contactId);
  if (user && cared.length) {
    const { error } = await supabase.from('contacts').update({ owner_id: user.id }).in('id', cared).is('owner_id', null);
    if (error) throw writeError(error);
  }
  const removed = rows.length - cared.length;
  await logActivity({
    user, action: 'update', table: 'contacts', recordId: rows[0].contactId,
    description: cared.length
      ? `Xếp ${cared.length} người vào nhóm chăm sóc CSKH${removed ? `, bỏ chăm sóc ${removed} người` : ''}`
      : `Bỏ ${removed} người khỏi danh sách chăm sóc CSKH`,
    newData: rows,
  });
}

/** Đổi người phụ trách (null = chưa giao) cho 1 hoặc nhiều người liên hệ. */
export async function setOwner(ids: readonly string[], ownerId: string | null, user: AppUser | null): Promise<void> {
  if (!ids.length) return;
  const { error } = await supabase.from('contacts').update({ owner_id: ownerId }).in('id', [...ids]);
  if (error) throw writeError(error);
  await logActivity({
    user, action: 'update', table: 'contacts', recordId: ids[0],
    description: `Đổi người phụ trách CSKH của ${ids.length} người liên hệ`,
    newData: { ids, owner_id: ownerId },
  });
}

// ── Hồ sơ người liên hệ ─────────────────────────────────────────────────────
/** Các trường riêng của CSKH (migration 169) — phần chung đi qua contactOps.saveContact. */
export interface CskhProfilePatch {
  tier: CskhTier;
  groupId: string | null;
  cadenceDays: number | null;
  ownerId: string | null;
  nickname: string;
  zaloPhone: string;
  habits: string;
  personality: string;
  mbti: string;
  rememberNotes: RememberNotes;
  introducedBy: string | null;
  context: CskhContext;
  province: string;
}

/**
 * Lưu hồ sơ: (1) trường dùng chung với hồ sơ Khách hàng qua contactOps (giữ đủ
 * quy tắc gắn công ty, liên hệ chính, lịch sử chuyển công ty); (2) trường CSKH.
 * Toạ độ nhà riêng: ưu tiên link Google Maps (@lat,lng); không có thì tra địa chỉ
 * (chỉ tra lại khi địa chỉ đổi).
 */
export async function saveProfile(opts: {
  raw: Contact;
  current: CskhContact;
  shared: Partial<ContactFormValues>;
  cskh: CskhProfilePatch;
  user: AppUser | null;
  clientName: (id: string | null) => string | null;
}): Promise<void> {
  const form: ContactFormValues = { ...contactToForm(opts.raw), ...opts.shared };
  await saveContact(form, opts.raw, { user: opts.user, clientName: opts.clientName });

  const mapLink = form.map_link.trim();
  const address = form.address.trim();
  let geo: { lat: number | null; lng: number | null; geo_source: string } = {
    lat: opts.current.lat, lng: opts.current.lng, geo_source: opts.current.geoSource,
  };
  const fromLink = parseLatLngFromLink(mapLink);
  if (fromLink) {
    geo = { lat: fromLink.lat, lng: fromLink.lng, geo_source: 'map_url' };
  } else if (address && (address !== opts.current.address.trim() || opts.current.lat === null || opts.current.geoSource === 'map_url')) {
    const found = await nominatimGeocode(address);
    geo = found ? { lat: found.lat, lng: found.lng, geo_source: 'address' } : { lat: null, lng: null, geo_source: '' };
  } else if (!address && !mapLink) {
    geo = { lat: null, lng: null, geo_source: '' };
  }

  const c = opts.cskh;
  const { error } = await supabase.from('contacts').update({
    tier: c.tier,
    group_id: c.tier === 'unclassified' ? null : c.groupId,
    cadence_days: c.cadenceDays,
    owner_id: c.ownerId,
    nickname: c.nickname.trim(),
    zalo_phone: c.zaloPhone.trim(),
    habits: c.habits.trim(),
    personality: c.personality.trim(),
    mbti: c.mbti,
    remember_notes: cleanRememberNotes(c.rememberNotes),
    introduced_by: c.introducedBy,
    context: c.context,
    province: c.province.trim(),
    ...geo,
  }).eq('id', opts.raw.id);
  if (error) throw writeError(error);
  await logActivity({
    user: opts.user, action: 'update', table: 'contacts', recordId: opts.raw.id,
    description: `Cập nhật hồ sơ chăm sóc "${form.name.trim()}"`,
    newData: c,
  });
}

// ── Nhóm tự tạo ─────────────────────────────────────────────────────────────
export async function addGroup(name: string, color: GroupColor, baseTier: CskhClassifiedTier, user: AppUser | null): Promise<CskhGroup> {
  const clean = name.trim();
  if (!clean) throw new Error('Nhập tên nhóm');
  const { data, error } = await supabase.from('cskh_groups')
    .insert({ name: clean, color, base_tier: baseTier, created_by: user?.id ?? null }).select().single();
  if (error) throw new Error(error.code === '23505' ? `Đã có nhóm tên "${clean}"` : writeError(error).message);
  await logActivity({ user, action: 'insert', table: 'cskh_groups', recordId: (data as { id: string }).id, description: `Tạo nhóm CSKH "${clean}"`, newData: data });
  return mapGroupRow(data as CskhGroupRow);
}

/** Sửa nhóm; đổi "nhắc liên hệ như" thì cập nhật hạng của mọi thành viên cho khớp. */
export async function updateGroup(group: CskhGroup, patch: { name: string; color: GroupColor; baseTier: CskhClassifiedTier }, user: AppUser | null): Promise<void> {
  const clean = patch.name.trim();
  if (!clean) throw new Error('Nhập tên nhóm');
  const { error } = await supabase.from('cskh_groups')
    .update({ name: clean, color: patch.color, base_tier: patch.baseTier }).eq('id', group.id);
  if (error) throw new Error(error.code === '23505' ? `Đã có nhóm tên "${clean}"` : writeError(error).message);
  if ((group.baseTier ?? 'other') !== patch.baseTier) {
    const { error: e2 } = await supabase.from('contacts').update({ tier: patch.baseTier }).eq('group_id', group.id);
    if (e2) throw writeError(e2);
  }
  await logActivity({ user, action: 'update', table: 'cskh_groups', recordId: group.id, description: `Sửa nhóm CSKH "${clean}"`, oldData: group, newData: patch });
}

/**
 * Xoá nhóm = lưu trữ (xoá mềm, để đồng bộ được về sau). Thành viên rời nhóm và về
 * nhóm mặc định đúng hạng đang có — vẫn được chăm sóc như cũ.
 */
export async function archiveGroup(group: CskhGroup, user: AppUser | null): Promise<void> {
  const { error: e1 } = await supabase.from('contacts').update({ group_id: null }).eq('group_id', group.id);
  if (e1) throw writeError(e1);
  const { error } = await supabase.from('cskh_groups').update({ is_archived: true }).eq('id', group.id);
  if (error) throw writeError(error);
  await logActivity({ user, action: 'update', table: 'cskh_groups', recordId: group.id, description: `Xoá nhóm CSKH "${group.name}" (thành viên về nhóm mặc định)`, oldData: group });
}

// ── Nhật ký: xoá mềm ────────────────────────────────────────────────────────
/**
 * Xoá một dòng nhật ký = lưu trữ (is_archived) — trigger DB tự tính lại ngày tương
 * tác cuối. Việc đã hứa đi kèm còn mở trong Workspace thì xoá mềm luôn (không để
 * việc mồ côi); việc đã xong thì giữ nguyên.
 */
export async function archiveInteraction(it: CskhInteraction, user: AppUser | null): Promise<void> {
  const { error } = await supabase.from('cskh_logs').update({ is_archived: true }).eq('id', it.id);
  if (error) throw writeError(error);
  if (it.followUpTaskId && !it.followUpDone) {
    const now = new Date().toISOString();
    const { error: taskError } = await supabase.from('work_tasks')
      .update({ deleted_at: now, updated_at: now }).eq('id', it.followUpTaskId).neq('status', 'done');
    if (taskError) console.error('[cskh] Không xoá được việc đi kèm trong Workspace', taskError);
  }
  await logActivity({
    user, action: 'update', table: 'cskh_logs', recordId: it.id,
    description: `Xoá dòng nhật ký CSKH ngày ${it.occurredAt} — ${it.contactPerson || it.clientName || 'không rõ người'}`,
    oldData: it,
  });
}

// ── Sự kiện ─────────────────────────────────────────────────────────────────
export interface OccasionInput {
  contactId: string;
  title: string;
  occasionType: CskhOccasion['occasionType'];
  day: number;
  month: number;
  year: number | null;
  isLunar: boolean;
  relatedPerson: string;
  remindDaysBefore: number;
  note: string;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * Thêm / sửa sự kiện. Dương lịch: ghi cả cột `date` (năm thật nếu biết, không thì 2000
 * — năm nhuận, giữ được 29/02) để form người liên hệ cũ vẫn thấy; âm lịch: `date` = NULL.
 * Đổi ngày → xoá dấu "đã nhắc năm nay" để nhắc lại đúng ngày mới.
 */
export async function saveOccasion(input: OccasionInput, existing: CskhOccasion | null, user: AppUser | null): Promise<void> {
  const title = input.title.trim();
  if (!title) throw new Error('Nhập tên sự kiện');
  if (input.isLunar ? !(input.day >= 1 && input.day <= 30 && input.month >= 1 && input.month <= 12) : !isValidDayMonth(input.day, input.month, input.year)) {
    throw new Error('Ngày / tháng không hợp lệ');
  }
  const row = {
    contact_id: input.contactId,
    label: title,
    occasion_type: input.occasionType,
    day: input.day,
    month: input.month,
    year: input.year,
    is_lunar: input.isLunar,
    related_person: input.relatedPerson.trim(),
    remind_days_before: input.remindDaysBefore,
    note: input.note.trim(),
    date: input.isLunar ? null : `${input.year ?? 2000}-${pad2(input.month)}-${pad2(input.day)}`,
  };
  if (existing) {
    const moved = existing.day !== input.day || existing.month !== input.month || existing.isLunar !== input.isLunar;
    const { error } = await supabase.from('contact_special_dates')
      .update({ ...row, ...(moved ? { last_reminded_year: null } : {}) }).eq('id', existing.id);
    if (error) throw writeError(error);
    await logActivity({ user, action: 'update', table: 'contact_special_dates', recordId: existing.id, description: `Sửa sự kiện "${title}"`, oldData: existing, newData: row });
    return;
  }
  const { data, error } = await supabase.from('contact_special_dates').insert(row).select('id').single();
  if (error) throw writeError(error);
  await logActivity({ user, action: 'insert', table: 'contact_special_dates', recordId: (data as { id: string }).id, description: `Thêm sự kiện "${title}"`, newData: row });
}

/** Xoá sự kiện = lưu trữ (xoá mềm). */
export async function archiveOccasion(o: CskhOccasion, user: AppUser | null): Promise<void> {
  const { error } = await supabase.from('contact_special_dates').update({ is_archived: true }).eq('id', o.id);
  if (error) throw writeError(error);
  await logActivity({ user, action: 'update', table: 'contact_special_dates', recordId: o.id, description: `Xoá sự kiện "${o.title}"`, oldData: o });
}

// ── Quà ─────────────────────────────────────────────────────────────────────
export interface GiftInput {
  contact: CskhContact;
  /** Công ty ghi kèm (bắt buộc — client_gifts.client_id NOT NULL). */
  clientId: string | null;
  direction: CskhGift['direction'];
  item: string;
  estimatedValue: number | null;
  givenAt: string;
  occasionId: string | null;
  note: string;
}

export async function saveGift(input: GiftInput, existing: CskhGift | null, user: AppUser | null): Promise<void> {
  const item = input.item.trim();
  if (!item) throw new Error('Nhập món quà');
  if (!input.clientId) throw new Error(`"${input.contact.fullName}" chưa gắn công ty — gắn công ty trong hồ sơ trước khi ghi quà`);
  if (input.estimatedValue !== null && (!Number.isFinite(input.estimatedValue) || input.estimatedValue < 0)) throw new Error('Giá trị không hợp lệ');
  // occasion_id chỉ trỏ được tới dòng contact_special_dates (sinh nhật trong hồ sơ là sự kiện ảo)
  const occasionId = input.occasionId && !input.occasionId.startsWith('birthday:') ? input.occasionId : null;
  const row = {
    client_id: input.clientId,
    recipient_contact_id: input.contact.id,
    recipient_name: input.contact.fullName,
    direction: input.direction,
    item_name: item,
    value: input.estimatedValue,
    gift_date: input.givenAt,
    occasion_id: occasionId,
    notes: input.note.trim() || null,
  };
  if (existing) {
    const { error } = await supabase.from('client_gifts').update(row).eq('id', existing.id);
    if (error) throw writeError(error);
    await logActivity({ user, action: 'update', table: 'client_gifts', recordId: existing.id, description: `Sửa quà "${item}" — ${input.contact.fullName}`, oldData: existing, newData: row });
    return;
  }
  const { data, error } = await supabase.from('client_gifts')
    .insert({ ...row, created_by: user?.full_name ?? null }).select('id').single();
  if (error) throw writeError(error);
  await logActivity({ user, action: 'insert', table: 'client_gifts', recordId: (data as { id: string }).id, description: `${input.direction === 'given' ? 'Tặng' : 'Nhận'} quà "${item}" — ${input.contact.fullName}`, newData: row });
}

export async function archiveGift(g: CskhGift, user: AppUser | null): Promise<void> {
  const { error } = await supabase.from('client_gifts').update({ is_archived: true }).eq('id', g.id);
  if (error) throw writeError(error);
  await logActivity({ user, action: 'update', table: 'client_gifts', recordId: g.id, description: `Xoá quà "${g.item}"`, oldData: g });
}

// ── Tự động tạo việc nhắc ───────────────────────────────────────────────────
export interface AutomationResult {
  gift: number;
  reconnect: number;
}

/**
 * Gọi qua automationRunner (mỗi ngày khi mở app + mỗi phiên khi mở CSKH; port PRM usePrmAutomation). Việc cần tạo do
 * lib/cskh/automation.planCareReminders chọn; ở đây chỉ ghi: tạo work_tasks (giao
 * cho người phụ trách của người liên hệ, chưa có thì người đang mở), đánh dấu
 * last_reminded_year / last_cold_alert_at để không tạo trùng. Việc "Chuẩn bị quà"
 * còn kiểm thêm việc cùng tên + cùng hạn đã có (sinh nhật trong hồ sơ không có cột đánh dấu).
 */
export async function runCareAutomation(data: CskhData, ctx: WriteCtx, today: string): Promise<AutomationResult> {
  const result: AutomationResult = { gift: 0, reconnect: 0 };
  if (!ctx.user || !data.migrationReady) return result;
  const taskBase = (c: CskhContact) => {
    const clientId = defaultClientIdOf(c);
    const client = clientId ? ctx.clients.find(x => x.id === clientId) ?? null : null;
    return {
      user_id: c.ownerId ?? ctx.user!.id,
      client_id: client?.id ?? null,
      branch_id: branchOf(client, ctx.branches)?.id ?? null,
      task_type: 'CSKH',
      status: 'pending',
    };
  };

  const plan = planCareReminders({ contacts: data.contacts, occasions: data.occasions, cadence: data.settings.cadence, today });

  for (const r of plan.gifts) {
    const { data: dup } = await supabase.from('work_tasks').select('id').eq('title', r.title).eq('due_date', r.nextIso).is('deleted_at', null).limit(1);
    if (!dup?.length) {
      const o = r.occasion;
      const { error } = await supabase.from('work_tasks').insert({
        ...taskBase(r.contact), title: r.title, due_date: r.nextIso, priority: 'high',
        notes: `${o.isLunar ? `Âm lịch ${o.day}/${o.month}. ` : ''}${o.note}`.trim() || null,
      });
      if (error) continue;
      result.gift += 1;
    }
    if (r.occasion.source === 'special_date') {
      await supabase.from('contact_special_dates').update({ last_reminded_year: r.eventYear }).eq('id', r.occasion.id);
    }
  }

  for (const r of plan.reconnect) {
    const { error } = await supabase.from('work_tasks').insert({
      ...taskBase(r.contact), title: r.title, due_date: today,
      priority: r.contact.tier === 'vvip' ? 'high' : 'medium',
    });
    if (error) continue;
    await supabase.from('contacts').update({ last_cold_alert_at: today }).eq('id', r.contact.id);
    result.reconnect += 1;
  }

  if (result.gift || result.reconnect) {
    await logActivity({
      user: ctx.user, action: 'insert', table: 'work_tasks', recordId: 'cskh-automation',
      description: `CSKH tự tạo ${result.gift + result.reconnect} việc nhắc (${result.gift} chuẩn bị quà, ${result.reconnect} kết nối lại)`,
    });
  }
  return result;
}

// ── Bản đồ: toạ độ nhà riêng ────────────────────────────────────────────────
/** Lưu toạ độ nhà riêng đã định vị (từ link Google Maps hoặc tra địa chỉ). */
export async function setContactGeo(contactId: string, geo: { lat: number; lng: number; source: 'map_url' | 'address' }): Promise<void> {
  const { error } = await supabase.from('contacts')
    .update({ lat: geo.lat, lng: geo.lng, geo_source: geo.source }).eq('id', contactId);
  if (error) throw writeError(error);
}
