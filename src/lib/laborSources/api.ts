// ============================================================================
// Nguồn Lao Động — đọc / ghi Supabase (bảng labor_source*, migration 213).
// Xoá = xoá MỀM (deleted_at) → khôi phục được. Đường xe lưu bảng labor_source_routes (bộ nhớ dùng chung).
// ============================================================================
import { supabase } from '../supabase';
import { logActivity } from '../audit';
import type { AppUser } from '../types';
import {
  MIGRATION_213_HINT,
  type InternWindow, type LaborSource, type RouteRow, type SourceBatch, type SourceContact, type SourceProgram,
} from './types';
import { planReminders } from './windows';

type DbError = { message?: string; code?: string } | null;

export const isMissingSchema = (err: DbError) =>
  !!err && (err.code === '42P01' || err.code === '42703' || err.code === 'PGRST204' || err.code === 'PGRST205' ||
    /could not find the .* (table|column)|does not exist|schema cache/i.test(err.message || ''));

function writeError(err: DbError): Error {
  return new Error(isMissingSchema(err) ? MIGRATION_213_HINT : (err?.message || 'Lỗi không rõ'));
}

/** Sự kiện toàn app: dữ liệu Nguồn LĐ vừa đổi (bản đồ, Khảo sát KCN, hồ sơ KH nạp lại). */
export const LABOR_CHANGED_EVENT = 'lgvn:labor-sources-changed';
export const emitLaborChanged = () => { if (typeof window !== 'undefined') window.dispatchEvent(new Event(LABOR_CHANGED_EVENT)); };

export interface LaborData {
  /** false = chưa chạy migration 213. */
  ready: boolean;
  sources: LaborSource[];
  programs: SourceProgram[];
  windows: InternWindow[];
  batches: SourceBatch[];
  routes: RouteRow[];
  contacts: SourceContact[];
  /** Đơn vị đã xoá (để khôi phục). */
  trash: LaborSource[];
}

export const EMPTY_LABOR_DATA: LaborData = { ready: false, sources: [], programs: [], windows: [], batches: [], routes: [], contacts: [], trash: [] };

const num = (v: unknown): number | null => (v == null || v === '' ? null : Number(v));

/** Đường xe đọc từ DB: numeric về số. */
function mapRoute(r: Record<string, unknown>): RouteRow {
  return {
    ...(r as unknown as RouteRow),
    distance_km: num(r.distance_km),
    duration_min: num(r.duration_min),
  };
}

/** Nạp toàn bộ dữ liệu Nguồn LĐ (vài trăm dòng — đọc 1 lượt). */
export async function loadLaborData(): Promise<LaborData> {
  const [src, prog, win, bat, rou, con] = await Promise.all([
    supabase.from('labor_sources').select('*').order('name'),
    supabase.from('labor_source_programs').select('*').is('deleted_at', null).order('sort_order').order('created_at'),
    supabase.from('labor_source_windows').select('*').is('deleted_at', null).order('start_date'),
    supabase.from('labor_source_batches').select('*').is('deleted_at', null).order('start_date', { ascending: false, nullsFirst: false }),
    supabase.from('labor_source_routes').select('*').limit(20000),
    supabase.from('contacts').select('id, name, role, phone, avatar_url, group_id, labor_source_id, is_active').not('labor_source_id', 'is', null),
  ]);
  if (src.error) {
    if (isMissingSchema(src.error)) return { ...EMPTY_LABOR_DATA };
    throw src.error;
  }
  for (const r of [prog, win, bat]) if (r.error && !isMissingSchema(r.error)) throw r.error;
  const all = (src.data ?? []) as LaborSource[];
  return {
    ready: true,
    sources: all.filter(s => !s.deleted_at),
    trash: all.filter(s => !!s.deleted_at).sort((a, b) => (b.deleted_at ?? '').localeCompare(a.deleted_at ?? '')),
    programs: (prog.data ?? []) as SourceProgram[],
    windows: (win.data ?? []) as InternWindow[],
    batches: (bat.data ?? []) as SourceBatch[],
    routes: rou.error ? [] : ((rou.data ?? []) as Record<string, unknown>[]).map(mapRoute),
    // Cột labor_source_id chưa có (chưa chạy 213) → coi như chưa ai gắn
    contacts: con.error ? [] : ((con.data ?? []) as SourceContact[]).map(c => ({ ...c, role: c.role ?? '', phone: c.phone ?? '', avatar_url: c.avatar_url ?? '' })),
  };
}

const who = (user: AppUser | null) => user?.full_name || user?.username || '';

// ── Đơn vị nguồn ────────────────────────────────────────────────────────────
export type SourceInput = Omit<LaborSource, 'id' | 'created_by' | 'updated_by' | 'deleted_at' | 'created_at' | 'updated_at'>;

export async function saveSource(input: SourceInput, user: AppUser | null, prev?: LaborSource): Promise<LaborSource> {
  const id = prev?.id;
  const payload = { ...input, name: input.name.trim(), short_name: input.short_name.trim(), updated_by: who(user) };
  const q = id
    ? supabase.from('labor_sources').update(payload).eq('id', id).select().single()
    : supabase.from('labor_sources').insert({ ...payload, created_by: who(user) }).select().single();
  const { data, error } = await q;
  if (error) throw writeError(error);
  const row = data as LaborSource;
  // Đổi tên → "Nơi làm" của người liên hệ đang ghi đúng tên cũ cũng đổi theo (hiện cạnh tên ở CSKH)
  if (prev && prev.name !== row.name) {
    await supabase.from('contacts').update({ sale_company: row.name }).eq('labor_source_id', prev.id).eq('sale_company', prev.name);
  }
  await logActivity({ user, action: id ? 'update' : 'insert', table: 'labor_sources', recordId: row.id, description: `${id ? 'Cập nhật' : 'Thêm'} đơn vị nguồn "${row.name}"`, newData: row });
  emitLaborChanged();
  return row;
}

/** Xoá mềm — ngành / lịch / đợt giữ nguyên, khôi phục là hiện lại đủ. */
export async function deleteSource(s: LaborSource, user: AppUser | null): Promise<void> {
  const { error } = await supabase.from('labor_sources').update({ deleted_at: new Date().toISOString(), updated_by: who(user) }).eq('id', s.id);
  if (error) throw writeError(error);
  await logActivity({ user, action: 'delete', table: 'labor_sources', recordId: s.id, description: `Xoá đơn vị nguồn "${s.name}" (khôi phục được)`, oldData: s });
  emitLaborChanged();
}

export async function restoreSource(s: LaborSource, user: AppUser | null): Promise<void> {
  const { error } = await supabase.from('labor_sources').update({ deleted_at: null, updated_by: who(user) }).eq('id', s.id);
  if (error) throw writeError(error);
  await logActivity({ user, action: 'update', table: 'labor_sources', recordId: s.id, description: `Khôi phục đơn vị nguồn "${s.name}"` });
  emitLaborChanged();
}

// ── Ngành đào tạo / lịch thực tập / đợt ─────────────────────────────────────
async function saveChild<T extends { id: string }>(table: string, payload: Record<string, unknown>, user: AppUser | null, id: string | undefined, label: string): Promise<T> {
  const body = { ...payload, updated_by: who(user) };
  const q = id
    ? supabase.from(table).update(body).eq('id', id).select().single()
    : supabase.from(table).insert({ ...body, created_by: who(user) }).select().single();
  const { data, error } = await q;
  if (error) throw writeError(error);
  const row = data as T;
  await logActivity({ user, action: id ? 'update' : 'insert', table, recordId: row.id, description: `${id ? 'Cập nhật' : 'Thêm'} ${label}`, newData: row });
  emitLaborChanged();
  return row;
}

async function softDelete(table: string, id: string, user: AppUser | null, label: string, oldData: unknown): Promise<void> {
  const { error } = await supabase.from(table).update({ deleted_at: new Date().toISOString(), updated_by: who(user) }).eq('id', id);
  if (error) throw writeError(error);
  await logActivity({ user, action: 'delete', table, recordId: id, description: `Xoá ${label}`, oldData });
  emitLaborChanged();
}

export type ProgramInput = Pick<SourceProgram, 'source_id' | 'name' | 'level' | 'industry_ids' | 'students_per_year' | 'note' | 'sort_order'>;
export const saveProgram = (p: ProgramInput, user: AppUser | null, id?: string) =>
  saveChild<SourceProgram>('labor_source_programs', { ...p, name: p.name.trim() }, user, id, `ngành đào tạo "${p.name.trim()}"`);
export const deleteProgram = (p: SourceProgram, user: AppUser | null) =>
  softDelete('labor_source_programs', p.id, user, `ngành đào tạo "${p.name}"`, p);

export type WindowInput = Pick<InternWindow, 'source_id' | 'program_ids' | 'cohort' | 'start_date' | 'end_date' | 'expected_count' | 'repeat_yearly' | 'remind_days' | 'note'>;
export const saveWindow = (w: WindowInput, user: AppUser | null, id?: string) =>
  saveChild<InternWindow>('labor_source_windows', { ...w, cohort: w.cohort.trim() }, user, id, 'lịch thực tập');
export const deleteWindow = (w: InternWindow, user: AppUser | null) =>
  softDelete('labor_source_windows', w.id, user, 'lịch thực tập', w);

export type BatchInput = Pick<SourceBatch, 'source_id' | 'window_id' | 'program_ids' | 'client_id' | 'lead_id' | 'company_name' | 'zone_id' | 'start_date' | 'end_date' | 'sent_count' | 'passed_count' | 'status' | 'note'>;
export const saveBatch = (b: BatchInput, user: AppUser | null, id?: string) =>
  saveChild<SourceBatch>('labor_source_batches', { ...b, company_name: b.company_name.trim() }, user, id, `đợt gửi SV${b.company_name ? ` vào ${b.company_name.trim()}` : ''}`);
export const deleteBatch = (b: SourceBatch, user: AppUser | null) =>
  softDelete('labor_source_batches', b.id, user, `đợt gửi SV${b.company_name ? ` vào ${b.company_name}` : ''}`, b);

// ── Đường xe ────────────────────────────────────────────────────────────────
export async function upsertRoutes(rows: readonly RouteRow[]): Promise<void> {
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await supabase.from('labor_source_routes').upsert(rows.slice(i, i + 200) as RouteRow[], { onConflict: 'source_id,target_type,target_id' });
    if (error) throw writeError(error);
  }
}

// ── Người liên hệ (CSKH tệp Sale / CTV) ─────────────────────────────────────
/**
 * Gắn / gỡ người liên hệ vào đơn vị nguồn. Gắn thì "Nơi làm" (sale_company) điền tên đơn vị nếu đang trống
 * hoặc đang là tên đơn vị cũ — để CSKH hiện "Trường …" cạnh tên người.
 */
export async function linkContact(contactId: string, source: Pick<LaborSource, 'id' | 'name'> | null, prevName: string, user: AppUser | null): Promise<void> {
  const { data: cur } = await supabase.from('contacts').select('sale_company').eq('id', contactId).maybeSingle();
  const company = ((cur as { sale_company?: string | null } | null)?.sale_company ?? '').trim();
  const patch: Record<string, unknown> = { labor_source_id: source?.id ?? null };
  if (source && (!company || company === prevName)) patch.sale_company = source.name;
  const { error } = await supabase.from('contacts').update(patch).eq('id', contactId);
  if (error) throw writeError(error);
  await logActivity({ user, action: 'update', table: 'contacts', recordId: contactId, description: source ? `Gắn người liên hệ vào đơn vị nguồn "${source.name}"` : 'Gỡ người liên hệ khỏi đơn vị nguồn' });
  emitLaborChanged();
}

/**
 * Thêm nhanh 1 người liên hệ của đơn vị nguồn vào CSKH tệp Sale / CTV (Ban giám hiệu, phòng QHDN, GV…).
 * Chọn nhóm thì hạng chăm sóc lấy theo nhóm (như CSKH). Hồ sơ đầy đủ (sinh nhật, quà…) sửa tiếp ở CSKH.
 */
export async function quickAddContact(input: { name: string; role: string; phone: string; groupId: string | null; groupTier: string | null },
  source: Pick<LaborSource, 'id' | 'name'>, user: AppUser | null): Promise<string> {
  const name = input.name.trim();
  if (!name) throw new Error('Nhập họ tên');
  const now = new Date().toISOString();
  const { data, error } = await supabase.from('contacts').insert({
    name,
    role: input.role.trim() || null,
    phone: input.phone.trim() || null,
    is_active: true,
    kind: 'sale',
    sale_company: source.name,
    labor_source_id: source.id,
    ...(input.groupId && input.groupTier ? { group_id: input.groupId, tier: input.groupTier } : {}),
    created_at: now,
    updated_at: now,
  }).select('id').single();
  if (error) {
    if (isMissingSchema(error) && /kind|sale_/.test(error.message || '')) throw new Error('Cần chạy migration 178 (Mạng lưới Sale) trước khi thêm người liên hệ.');
    throw writeError(error);
  }
  const id = (data as { id: string }).id;
  await logActivity({ user, action: 'insert', table: 'contacts', recordId: id, description: `Thêm liên hệ "${name}" — đại diện ${source.name} (tệp Sale / CTV)` });
  emitLaborChanged();
  return id;
}

/** Mở hồ sơ người liên hệ trong CSKH tệp Sale / CTV (CSKH đọc khoá này khi nạp xong). */
export const CSKH_OPEN_KEY = 'lgvn_cskh_open_contact';
export function openInCskh(contactId: string) {
  try { sessionStorage.setItem(CSKH_OPEN_KEY, JSON.stringify({ space: 'sale', contactId })); } catch { /* bỏ qua */ }
  window.location.hash = '#/crm-leads/sale/matrix';
}

// ── Nhắc việc trước mùa thực tập ────────────────────────────────────────────
/**
 * Tạo việc Workspace cho các mùa thực tập sắp tới (planReminders). Việc giao cho người phụ trách đơn vị
 * (không có thì người đang dùng), gắn chi nhánh phụ trách. Chống trùng: reminder_for trên lịch + tên việc.
 * Trả số việc đã tạo.
 */
export async function runLaborReminders(user: AppUser, today: string): Promise<number> {
  const [src, win] = await Promise.all([
    supabase.from('labor_sources').select('*').is('deleted_at', null),
    supabase.from('labor_source_windows').select('*').is('deleted_at', null).gt('remind_days', 0),
  ]);
  if (src.error || win.error) return 0; // chưa chạy 213 → bỏ qua
  const plans = planReminders((win.data ?? []) as InternWindow[], (src.data ?? []) as LaborSource[], today);
  let made = 0;
  for (const p of plans) {
    const { data: dup } = await supabase.from('work_tasks').select('id').eq('title', p.title).is('deleted_at', null).limit(1);
    let taskId = (dup as { id: string }[] | null)?.[0]?.id ?? null;
    if (!taskId) {
      const expected = p.window.expected_count ? ` · dự kiến ${p.window.expected_count} SV` : '';
      const { data, error } = await supabase.from('work_tasks').insert({
        user_id: p.source.owner_id ?? user.id,
        client_id: null,
        branch_id: p.source.branch_id,
        title: p.title,
        task_type: 'Nguồn LĐ',
        due_date: p.due,
        priority: 'high',
        status: 'pending',
        notes: `Mùa thực tập ${p.occurrence.start} → ${p.occurrence.end}${expected}. Liên hệ trường để chốt số SV và công ty nhận (Thị trường → Nguồn LĐ).`,
      }).select('id').single();
      if (error) continue;
      taskId = (data as { id: string }).id;
      made += 1;
    }
    await supabase.from('labor_source_windows').update({ reminder_task_id: taskId, reminder_for: p.occurrence.start }).eq('id', p.window.id);
  }
  if (made) {
    await logActivity({ user, action: 'insert', table: 'work_tasks', recordId: 'labor-reminders', description: `Tự tạo ${made} việc nhắc mùa thực tập (Nguồn LĐ)` });
  }
  return made;
}
