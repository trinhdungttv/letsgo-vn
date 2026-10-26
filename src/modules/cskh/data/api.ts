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
import { cleanRememberNotes } from '../../../lib/cskh/remember';
import { planCareReminders } from '../../../lib/cskh/automation';
import { isValidDayMonth } from '../../../lib/cskh/dates';
import { sameEducation } from '../../../lib/cskh/education';
import {
  buildGroupLogRows, canEditBatch, planBatchEdit, type BatchEdit, type GroupLogPlan, type InteractionBatch,
} from '../../../lib/cskh/groupLog';
import { planGeo } from '../../../lib/cskh/mapPoints';
import { geocodeAddressDetailed, type LatLng } from '../../../lib/cskh/nearby';
import { isEmptyPlan, type OccasionFields, type OccasionWritePlan } from '../../../lib/cskh/occasions';
import type { AppUser, Branch, Client, Contact } from '../../../lib/types';
import {
  birthdayOccasion, mapContactRow, mapGiftRow, mapGroupRow, mapLogRow, mapSettingsRow, mapSpecialDateRow,
  type ClientGiftRow, type ContactRow, type CskhGroupRow, type CskhLogRow, type CskhSettingsRow, type SpecialDateRow,
} from '../../../lib/cskh/mappers';
import type {
  CskhClassifiedTier, CskhContact, CskhExtraTask, CskhContext, CskhGift, CskhGroup, CskhInteraction, CskhOccasion, CskhSettings,
  CskhTier, Education, Gender, GeoSource, GroupColor, InitiatedBy, InteractionChannel, InteractionType, RememberNotes,
} from '../../../lib/cskh/types';

export const MIGRATION_HINT =
  'Cần chạy migration CSKH 168–173 trên Supabase (SQL Editor) trước khi lưu dữ liệu chăm sóc.';

export const MIGRATION_174_HINT =
  'Chưa lưu được giới tính / học vấn / quê quán / số ngày nhắc sinh nhật / vị trí chấm tay — cần chạy migration 174 trên Supabase (SQL Editor).';

type DbError = { message?: string; code?: string } | null;

const isMissingSchema = (err: DbError) =>
  !!err && (err.code === '42P01' || err.code === '42703' || err.code === 'PGRST204' ||
    /could not find the .* (table|column)|does not exist|schema cache/i.test(err.message || ''));

/** Lỗi ghi → câu tiếng Việt đọc được (thiếu bảng/cột = chưa chạy migration). */
function writeError(err: DbError): Error {
  return new Error(isMissingSchema(err) ? MIGRATION_HINT : (err?.message || 'Lỗi không rõ'));
}

/** Cột chỉ có sau migration 174 (hồ sơ nâng cấp 24/10). */
const OPTIONAL_174 = ['gender', 'education', 'origin_province', 'birthday_remind_days'];
/** Nguồn toạ độ chỉ được CHECK cho phép sau migration 174. */
const GEO_SOURCES_174: readonly string[] = ['manual', 'address_url'];

/**
 * Ghi contacts kèm cột của migration 174. DB chưa chạy 174 (thiếu cột / CHECK geo_source còn
 * hẹp) → ghi lại KHÔNG kèm các cột đó (toạ độ chấm tay ghi nguồn 'address') để phần còn lại
 * vẫn lưu được. Trả về false khi phải bỏ bớt — nơi gọi báo "chạy migration 174".
 */
async function updateContactWith174(ids: readonly string[], patch: Record<string, unknown>): Promise<boolean> {
  const { error } = await supabase.from('contacts').update(patch).in('id', [...ids]);
  if (!error) return true;
  const geoNew = GEO_SOURCES_174.includes(String(patch.geo_source ?? ''));
  const has174 = Object.keys(patch).some(k => OPTIONAL_174.includes(k)) || geoNew;
  if (!has174 || !(isMissingSchema(error) || (error.code === '23514' && geoNew))) throw writeError(error);
  const fallback = Object.fromEntries(Object.entries(patch).filter(([k]) => !OPTIONAL_174.includes(k)));
  if (geoNew) fallback.geo_source = 'address';
  if (Object.keys(fallback).length) {
    const { error: e2 } = await supabase.from('contacts').update(fallback).in('id', [...ids]);
    if (e2) throw writeError(e2);
  }
  return false;
}

/** Ghi theo lô (Supabase / URL có giới hạn độ dài) — dấu đợt đặt 1 lần cho mọi lô. */
const CHUNK = 200;
function chunks<T>(list: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += CHUNK) out.push(list.slice(i, i + CHUNK));
  return out;
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
  const extraIds = [...new Set(interactions.flatMap(i => (i.isArchived ? [] : i.extraTaskIds)))];
  const watchIds = [...new Set([...openTaskIds, ...extraIds])];
  if (watchIds.length) {
    const { data: tasks } = await supabase.from('work_tasks').select('id, title, due_date, status, deleted_at').in('id', watchIds);
    const rows = (tasks ?? []) as { id: string; title: string; due_date: string | null; status: string; deleted_at: string | null }[];
    const done = new Set(rows.filter(t => t.status === 'done').map(t => t.id));
    const byId = new Map(rows.filter(t => !t.deleted_at).map(t => [t.id, t]));
    interactions = interactions.map(i => ({
      ...i,
      followUpDone: i.followUpDone || (!!i.followUpTaskId && done.has(i.followUpTaskId)),
      extraTasks: i.extraTaskIds.flatMap((id): CskhExtraTask[] => {
        const t = byId.get(id);
        return t ? [{ id, action: taskActionOf(t.title), due: t.due_date, done: t.status === 'done' }] : [];
      }),
    }));
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
  /** Việc tiếp theo THÊM (ngoài việc đầu): chỉ tạo việc trong Workspace, không gắn vào dòng nhật ký. */
  extraFollowUps?: { action: string; due: string }[];
}

/**
 * Tên việc trong Workspace: "[Công ty] CSKH: <việc> — <người>" — tên công ty đứng đầu để biết
 * ngay việc của khách nào (người liên hệ có thể kiêm nhiều công ty).
 */
export function cskhTaskTitle(companyName: string | null | undefined, action: string, who: string): string {
  const company = (companyName ?? '').trim();
  return `${company ? `[${company}] ` : ''}CSKH: ${action} — ${who}`;
}

/** Phần "việc" trong tên việc Workspace: bỏ "[Công ty] CSKH: " ở đầu và " — người" ở cuối. */
export function taskActionOf(title: string): string {
  return title.replace(/^\s*(\[[^\]]*\]\s*)?CSKH:\s*/, '').replace(/\s+—\s+[^—]*$/, '').trim();
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

/** Tạo các việc THÊM trong Workspace; trả về id theo đúng thứ tự. */
async function insertExtraTasks(
  extras: readonly { action: string; due: string }[],
  o: { contact: CskhContact | null; client: Client | null; content: string; ctx: WriteCtx; fallbackCompany?: string | null; who: string },
): Promise<string[]> {
  if (!extras.length) return [];
  if (extras.some(e => !e.due)) throw new Error('Mỗi việc cần có hạn');
  const assignee = o.contact?.ownerId ?? o.ctx.user?.id;
  if (!assignee) throw new Error('Chưa đăng nhập');
  const { data, error } = await supabase.from('work_tasks').insert(extras.map(e => ({
    user_id: assignee,
    client_id: o.client?.id ?? null,
    branch_id: branchOf(o.client, o.ctx.branches)?.id ?? null,
    title: cskhTaskTitle(o.client?.name ?? o.contact?.organization ?? o.fallbackCompany, e.action, o.who),
    task_type: 'CSKH',
    due_date: e.due,
    priority: 'high',
    status: 'pending',
    notes: o.content.trim() || null,
  }))).select('id');
  if (error) throw writeError(error);
  return ((data ?? []) as { id: string }[]).map(r => r.id);
}

/** Ghi extra_task_ids (migration 175); DB chưa chạy 175 thì bỏ qua — việc vẫn nằm ở Workspace. */
async function saveExtraTaskIds(logId: string, ids: readonly string[]): Promise<void> {
  const { error } = await supabase.from('cskh_logs').update({ extra_task_ids: [...ids] }).eq('id', logId);
  if (error && !isMissingSchema(error)) throw writeError(error);
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
  if ((input.extraFollowUps ?? []).some(e => e.action.trim() && !e.due)) throw new Error('Mỗi việc cần có hạn');
  const client = input.clientId ? ctx.clients.find(c => c.id === input.clientId) ?? null : null;

  let taskId: string | null = null;
  if (action && input.followUpDue) {
    const assignee = contact.ownerId ?? ctx.user?.id;
    if (!assignee) throw new Error('Chưa đăng nhập');
    const { data: task, error } = await supabase.from('work_tasks').insert({
      user_id: assignee,
      client_id: client?.id ?? null,
      branch_id: branchOf(client, ctx.branches)?.id ?? null,
      title: cskhTaskTitle(client?.name ?? contact.organization, action, contact.fullName),
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

  // Việc thêm: mỗi việc 1 dòng trong Workspace, liên kết với dòng nhật ký để sửa lại sau
  const extras = (input.extraFollowUps ?? []).map(e => ({ action: e.action.trim(), due: e.due })).filter(e => e.action);
  if (extras.length) {
    try {
      const ids = await insertExtraTasks(extras, { contact, client, content: input.content, ctx, who: contact.fullName });
      await saveExtraTaskIds((data as { id: string }).id, ids);
    } catch (e) {
      throw new Error(`Đã ghi nhật ký nhưng chưa tạo được việc thêm: ${(e as Error).message}`);
    }
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
/**
 * Mỗi việc THÊM chưa xong của 1 dòng nhật ký → 1 "dòng việc" riêng (id `<logId>#<taskId>`) để Dashboard /
 * tóm tắt / hồ sơ liệt kê chung với việc đầu. Chỉ dùng để HIỂN THỊ việc đang mở — không đưa vào thống kê.
 */
export function expandOpenExtras(list: readonly CskhInteraction[], includeDone = false): CskhInteraction[] {
  return list.flatMap(i => (i.isArchived ? [] : i.extraTasks.filter(t => includeDone || !t.done).map(t => ({
    ...i, id: `${i.id}#${t.id}`, followUpAction: t.action, followUpDue: t.due, followUpDone: t.done,
    followUpTaskId: t.id, extraTaskIds: [], extraTasks: [],
  }))));
}

export async function setFollowUpDone(it: CskhInteraction, done: boolean, user: AppUser | null): Promise<void> {
  // Việc thêm (id có "#"): chỉ đóng / mở việc trong Workspace, dòng nhật ký không đổi
  const { error } = it.id.includes('#') ? { error: null } : await supabase.from('cskh_logs').update({ followup_done: done }).eq('id', it.id);
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
  /**
   * Các việc THÊM sau khi sửa (có taskId = việc đang có, không có = việc mới). Thiếu so với danh
   * sách cũ = bỏ việc (xoá mềm nếu chưa xong; việc đã xong luôn giữ). undefined = không đụng.
   */
  extraFollowUps?: { taskId?: string; action: string; due: string }[];
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
  if ((edit.extraFollowUps ?? []).some(e => e.action.trim() && !e.due)) throw new Error('Mỗi việc cần có hạn');
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
      title: cskhTaskTitle(taskClient?.name ?? contact?.organization ?? it.clientName, action, who),
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

  // Việc THÊM: bỏ / sửa / thêm theo danh sách mới
  if (edit.extraFollowUps) {
    const now = new Date().toISOString();
    const wanted = edit.extraFollowUps.map(e => ({ ...e, action: e.action.trim() })).filter(e => e.action);
    const keepIds = new Set(wanted.filter(e => e.taskId).map(e => e.taskId as string));
    const old = new Map(it.extraTasks.map(t => [t.id, t]));
    const taskClient = client ?? (it.clientId ? ctx.clients.find(c => c.id === it.clientId) ?? null : null);
    const company = taskClient?.name ?? contact?.organization ?? it.clientName;
    const removed = it.extraTasks.filter(t => !keepIds.has(t.id) && !t.done).map(t => t.id);
    if (removed.length) {
      await supabase.from('work_tasks').update({ deleted_at: now, updated_at: now }).in('id', removed).neq('status', 'done');
    }
    for (const e of wanted) {
      const prev = e.taskId ? old.get(e.taskId) : undefined;
      if (!prev || prev.done || (prev.action === e.action && prev.due === e.due)) continue;
      await supabase.from('work_tasks').update({ title: cskhTaskTitle(company, e.action, who), due_date: e.due, updated_at: now }).eq('id', prev.id);
    }
    const created = await insertExtraTasks(wanted.filter(e => !e.taskId), { contact, client: taskClient, content: edit.content, ctx, fallbackCompany: it.clientName, who });
    const doneKept = it.extraTasks.filter(t => t.done && !keepIds.has(t.id)).map(t => t.id);
    await saveExtraTaskIds(it.id, [...keepIds, ...doneKept, ...created]);
  }

  // Việc đi kèm đã có trong Workspace: sửa theo lời hứa mới, hoặc xoá mềm khi bỏ hứa
  if (it.followUpTaskId) {
    const now = new Date().toISOString();
    const req = action
      ? (action !== it.followUpAction.trim() || edit.followUpDue !== it.followUpDue)
        ? supabase.from('work_tasks').update({ title: cskhTaskTitle(client?.name ?? contact?.organization ?? it.clientName, action, who), due_date: edit.followUpDue, updated_at: now }).eq('id', it.followUpTaskId)
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
/** Các trường riêng của CSKH (migration 169 + 174) — phần chung đi qua contactOps.saveContact. */
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
  /** Migration 174 — chỉ ghi khi đổi (lưu được cả khi chưa chạy migration). */
  gender: Gender;
  education: Education[];
  originProvince: string;
}

/** Toạ độ nhà hiện tại khi lưu: chấm tay > link Maps > tra chữ (xem lib/cskh/mapPoints.planGeo). */
export interface ProfileGeoInput {
  /** Vừa chấm / kéo ghim trong lần sửa này. */
  manualPin: LatLng | null;
  /** Toạ độ đọc được từ link Maps (link rút gọn đã mở qua api/resolve-map). */
  linkCoords: LatLng | null;
  /** Kết quả tra chữ đã có sẵn ở bản đồ nhỏ trong hồ sơ — dùng lại, khỏi tra lần nữa. */
  preview: { address: string; lat: number; lng: number } | null;
}

/**
 * Lưu hồ sơ: (1) trường dùng chung với hồ sơ Khách hàng qua contactOps (giữ đủ quy tắc gắn
 * công ty, liên hệ chính, lịch sử chuyển công ty); (2) trường CSKH + cột migration 174;
 * (3) ngày sinh & ngày quan trọng (contacts.birthday + contact_special_dates).
 * Trả về `partial174 = true` khi DB chưa chạy 174 nên chưa lưu được các cột mới.
 */
export async function saveProfile(opts: {
  raw: Contact;
  current: CskhContact;
  shared: Partial<ContactFormValues>;
  cskh: CskhProfilePatch;
  geo: ProfileGeoInput;
  /** Kế hoạch lưu ngày quan trọng (lib/cskh/occasions.planOccasionSave); null = không đụng. */
  occasions: OccasionWritePlan | null;
  user: AppUser | null;
  clientName: (id: string | null) => string | null;
}): Promise<{ partial174: boolean }> {
  const { current, occasions } = opts;
  const form: ContactFormValues = { ...contactToForm(opts.raw), ...opts.shared };
  if (occasions?.birthday !== undefined) form.birthday = occasions.birthday ?? '';
  await saveContact(form, opts.raw, { user: opts.user, clientName: opts.clientName });

  const plan = planGeo(
    { address: current.address, mapUrl: current.mapUrl, lat: current.lat, lng: current.lng, geoSource: current.geoSource },
    { address: form.address, mapUrl: form.map_link },
    opts.geo.manualPin,
    opts.geo.linkCoords,
  );
  let geo: { lat: number | null; lng: number | null; geo_source: GeoSource } | null = null;
  if (plan.kind === 'set') geo = { lat: plan.lat, lng: plan.lng, geo_source: plan.source };
  else if (plan.kind === 'clear') geo = { lat: null, lng: null, geo_source: '' };
  else if (plan.kind === 'geocode') {
    const p = opts.geo.preview;
    const found = p && p.address.trim() === plan.address ? p : await geocodeAddressDetailed(plan.address);
    geo = found ? { lat: found.lat, lng: found.lng, geo_source: 'address' } : { lat: null, lng: null, geo_source: '' };
  }

  const c = opts.cskh;
  const patch: Record<string, unknown> = {
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
    ...(geo ?? {}),
    // Cột migration 174: chỉ gửi khi thật sự đổi — DB chưa chạy 174 vẫn lưu được hồ sơ
    ...(c.gender !== current.gender ? { gender: c.gender } : {}),
    ...(!sameEducation(c.education, current.education) ? { education: c.education } : {}),
    ...(c.originProvince.trim() !== current.originProvince ? { origin_province: c.originProvince.trim() } : {}),
    ...(occasions?.birthdayRemindDays !== undefined ? { birthday_remind_days: occasions.birthdayRemindDays } : {}),
  };
  const full = await updateContactWith174([opts.raw.id], patch);
  if (occasions && !isEmptyPlan(occasions)) await applyOccasionPlan(opts.raw.id, occasions, opts.user);
  await logActivity({
    user: opts.user, action: 'update', table: 'contacts', recordId: opts.raw.id,
    description: `Cập nhật hồ sơ chăm sóc "${form.name.trim()}"`,
    newData: { ...c, geo, occasions },
  });
  return { partial174: !full };
}

/** Đặt giới tính cho nhiều người (Ma trận / Ghi cho nhóm → "Lưu Nữ cho N người gợi ý"). */
export async function setGender(ids: readonly string[], gender: Gender, user: AppUser | null): Promise<void> {
  if (!ids.length) return;
  for (const part of chunks(ids)) {
    const { error } = await supabase.from('contacts').update({ gender }).in('id', part);
    if (error) throw new Error(isMissingSchema(error) ? MIGRATION_174_HINT : error.message);
  }
  await logActivity({
    user, action: 'update', table: 'contacts', recordId: ids[0],
    description: `Đặt giới tính ${gender === 'female' ? 'Nữ' : gender === 'male' ? 'Nam' : 'chưa rõ'} cho ${ids.length} người liên hệ`,
    newData: { ids, gender },
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
 * Cột contact_special_dates của 1 sự kiện. Dương lịch: ghi cả cột `date` (năm thật nếu biết,
 * không thì 2000 — năm nhuận, giữ được 29/02) để form người liên hệ cũ vẫn thấy; âm lịch: NULL.
 */
function occasionDbFields(f: OccasionFields) {
  return {
    label: f.title,
    occasion_type: f.occasionType,
    day: f.day,
    month: f.month,
    year: f.year,
    is_lunar: f.isLunar,
    remind_days_before: f.remindDaysBefore,
    date: f.isLunar ? null : `${f.year ?? 2000}-${pad2(f.month)}-${pad2(f.day)}`,
  };
}

/** Ghi kế hoạch ngày quan trọng của hồ sơ: thêm / sửa / xoá mềm từng dòng (không xoá cứng). */
async function applyOccasionPlan(contactId: string, plan: OccasionWritePlan, user: AppUser | null): Promise<void> {
  if (plan.inserts.length) {
    const { error } = await supabase.from('contact_special_dates')
      .insert(plan.inserts.map(f => ({ contact_id: contactId, ...occasionDbFields(f) })));
    if (error) throw writeError(error);
  }
  for (const u of plan.updates) {
    const { error } = await supabase.from('contact_special_dates')
      .update({ ...occasionDbFields(u.fields), ...(u.resetReminded ? { last_reminded_year: null } : {}) }).eq('id', u.id);
    if (error) throw writeError(error);
  }
  if (plan.deletes.length) {
    const { error } = await supabase.from('contact_special_dates').update({ is_archived: true }).in('id', plan.deletes);
    if (error) throw writeError(error);
  }
  const n = plan.inserts.length + plan.updates.length + plan.deletes.length;
  if (n) {
    await logActivity({
      user, action: 'update', table: 'contact_special_dates', recordId: contactId,
      description: `Cập nhật ngày quan trọng trong hồ sơ: thêm ${plan.inserts.length}, sửa ${plan.updates.length}, xoá ${plan.deletes.length}`,
      newData: plan,
    });
  }
}

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
    ...occasionDbFields({ ...input, title }),
    related_person: input.relatedPerson.trim(),
    note: input.note.trim(),
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
    // Tính cả việc đã xoá: người dùng xoá việc nhắc thì đừng tạo lại hôm sau (sinh nhật trong hồ sơ
    // không có cột last_reminded_year để đánh dấu)
    const { data: dup } = await supabase.from('work_tasks').select('id').eq('title', r.title).eq('due_date', r.nextIso).limit(1);
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
/** Lưu toạ độ nhà hiện tại đã định vị (từ link Google Maps hoặc tra địa chỉ). */
export async function setContactGeo(contactId: string, geo: { lat: number; lng: number; source: 'map_url' | 'address' }): Promise<void> {
  const { error } = await supabase.from('contacts')
    .update({ lat: geo.lat, lng: geo.lng, geo_source: geo.source }).eq('id', contactId);
  if (error) throw writeError(error);
}

// ── Ghi cho nhóm + đợt ghi nhóm ─────────────────────────────────────────────
export interface GroupLogResult {
  logs: number;
  gifts: number;
  /** Người chưa gắn công ty → không ghi được quà (client_gifts.client_id bắt buộc). */
  noGiftNames: string[];
}

const groupCtxOf = (contacts: readonly CskhContact[], ctx: WriteCtx) => ({
  userId: ctx.user?.id ?? null,
  userName: ctx.user?.full_name ?? null,
  contactById: new Map(contacts.map(c => [c.id, c])),
  clientName: (id: string) => ctx.clients.find(c => c.id === id)?.name ?? null,
});

/**
 * Mỗi người 1 dòng nhật ký (tính là đã liên hệ → hết nhắc trong hàng đợi) + 1 dòng quà nếu
 * bật. Mọi dòng chung 1 dấu đợt created_at → Nhật ký gom lại để sửa / xoá cả đợt.
 */
export async function saveGroupLog(plan: GroupLogPlan, contacts: readonly CskhContact[], ctx: WriteCtx): Promise<GroupLogResult> {
  if (!ctx.user) throw new Error('Chưa đăng nhập');
  const rows = buildGroupLogRows(plan, groupCtxOf(contacts, ctx), new Date().toISOString());
  if (!rows.logs.length) throw new Error('Chưa chọn ai');
  let done = 0;
  for (const part of chunks(rows.logs)) {
    const { error } = await supabase.from('cskh_logs').insert(part);
    if (error) throw new Error(done === 0 ? writeError(error).message : `Mới ghi được ${done} người: ${writeError(error).message}`);
    done += part.length;
  }
  for (const part of chunks(rows.gifts)) {
    const { error } = await supabase.from('client_gifts').insert(part);
    if (error) throw new Error(`Đã ghi nhật ký cho ${done} người nhưng chưa ghi được lịch sử quà: ${writeError(error).message}`);
  }
  await logActivity({
    user: ctx.user, action: 'insert', table: 'cskh_logs', recordId: 'group-log',
    description: `Ghi cho nhóm "${plan.content.trim()}" — ${done} người${rows.gifts.length ? `, ${rows.gifts.length} dòng quà` : ''}`,
    newData: { ...plan, contactIds: [...plan.contactIds] },
  });
  return { logs: done, gifts: rows.gifts.length, noGiftNames: rows.noGiftNames };
}

/**
 * Sửa cả đợt: đổi hình thức / nội dung / ngày cho mọi người còn lại (quà của đợt đổi ngày +
 * ghi chú theo), bỏ người (xoá mềm nhật ký + quà của họ trong đợt), thêm người (cùng dấu đợt).
 * Đổi ngày → trigger migration 170 tự tính lại ngày tương tác cuối của từng người.
 */
export async function applyBatchEdit(
  batch: InteractionBatch,
  gifts: readonly CskhGift[],
  edit: BatchEdit,
  contacts: readonly CskhContact[],
  ctx: WriteCtx,
): Promise<{ noGiftNames: string[] }> {
  if (!canEditBatch(batch, ctx.user)) throw new Error('Chỉ người tạo đợt hoặc admin được sửa đợt này');
  const plan = planBatchEdit(batch, gifts, edit, groupCtxOf(contacts, ctx));
  for (const ids of chunks(plan.updateLogIds)) {
    const { error } = await supabase.from('cskh_logs').update(plan.logPatch).in('id', ids);
    if (error) throw writeError(error);
  }
  for (const ids of chunks(plan.archiveLogIds)) {
    const { error } = await supabase.from('cskh_logs').update({ is_archived: true }).in('id', ids);
    if (error) throw new Error(`Đã sửa nhưng chưa bỏ được người khỏi đợt: ${writeError(error).message}`);
  }
  for (const part of chunks(plan.insertLogs)) {
    const { error } = await supabase.from('cskh_logs').insert(part);
    if (error) throw new Error(`Đã sửa nhưng chưa thêm được người: ${writeError(error).message}`);
  }
  for (const ids of chunks(plan.updateGiftIds)) {
    const { error } = await supabase.from('client_gifts').update(plan.giftPatch).in('id', ids);
    if (error) throw new Error(`Đã sửa nhật ký nhưng chưa sửa được lịch sử quà: ${writeError(error).message}`);
  }
  for (const ids of chunks(plan.archiveGiftIds)) {
    const { error } = await supabase.from('client_gifts').update({ is_archived: true }).in('id', ids);
    if (error) throw new Error(`Đã sửa nhật ký nhưng chưa xoá được lịch sử quà: ${writeError(error).message}`);
  }
  for (const part of chunks(plan.insertGifts)) {
    const { error } = await supabase.from('client_gifts').insert(part);
    if (error) throw new Error(`Đã thêm người nhưng chưa ghi được lịch sử quà: ${writeError(error).message}`);
  }
  await logActivity({
    user: ctx.user, action: 'update', table: 'cskh_logs', recordId: batch.items[0]?.id ?? 'batch',
    description: `Sửa đợt ghi nhóm "${batch.content || 'không nội dung'}" (${batch.occurredAt}): bỏ ${plan.archiveLogIds.length}, thêm ${plan.insertLogs.length} người`,
    oldData: { type: batch.type, content: batch.content, occurredAt: batch.occurredAt, ids: batch.items.map(i => i.id) },
    newData: edit,
  });
  return { noGiftNames: plan.noGiftNames };
}

/** Xoá cả đợt = xoá mềm mọi dòng nhật ký + quà của đợt (khôi phục được ở trang Lịch sử). */
export async function archiveBatch(batch: InteractionBatch, gifts: readonly CskhGift[], user: AppUser | null): Promise<void> {
  if (!canEditBatch(batch, user)) throw new Error('Chỉ người tạo đợt hoặc admin được xoá đợt này');
  for (const ids of chunks(batch.items.map(i => i.id))) {
    const { error } = await supabase.from('cskh_logs').update({ is_archived: true }).in('id', ids);
    if (error) throw writeError(error);
  }
  for (const ids of chunks(gifts.map(g => g.id))) {
    const { error } = await supabase.from('client_gifts').update({ is_archived: true }).in('id', ids);
    if (error) throw new Error(`Đã xoá nhật ký nhưng chưa xoá được lịch sử quà: ${writeError(error).message}`);
  }
  await logActivity({
    user, action: 'update', table: 'cskh_logs', recordId: batch.items[0]?.id ?? 'batch',
    description: `Xoá đợt ghi nhóm "${batch.content || 'không nội dung'}" (${batch.occurredAt}) — ${batch.items.length} người, ${gifts.length} dòng quà`,
    oldData: { ids: batch.items.map(i => i.id), giftIds: gifts.map(g => g.id) },
  });
}
