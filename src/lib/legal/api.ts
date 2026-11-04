// Pháp lý — đọc / ghi Supabase (migration 201). Xoá = xoá MỀM (deleted_at) → khôi phục ở Thùng rác.
// Danh sách tài liệu tải KHÔNG kèm content (sơ đồ / bài học có thể nặng) — mở tài liệu mới tải content.
import { supabase } from '../supabase';
import {
  emptyInfo, rid, type DocKind, type DocMeta, type EntityStatus, type FileType, type LegalDoc, type LegalEntity, type LegalEntityInfo,
  type LegalMilestone, type LegalTopic, type MilestoneChange, type MilestoneKind, type MilestoneStatus,
} from './types';

export const LEGAL_MIGRATION_HINT = 'Cần chạy migration 201 (Pháp lý) trong Supabase → SQL Editor';

export function isMissingTableError(e: { code?: string; message?: string } | null | undefined): boolean {
  if (!e) return false;
  return e.code === '42P01' || e.code === 'PGRST205' || e.code === '42703' || /does not exist|schema cache|could not find the table/i.test(e.message ?? '');
}

export class LegalMissingError extends Error {
  constructor() { super(LEGAL_MIGRATION_HINT); }
}

function fail(error: { code?: string; message?: string }): never {
  if (isMissingTableError(error)) throw new LegalMissingError();
  throw new Error(error.message ?? 'Lỗi không rõ');
}

// ── Chuẩn hoá dòng từ DB ───────────────────────────────────────────────────
type Row = Record<string, unknown>;
const s = (v: unknown) => (typeof v === 'string' ? v : '');
const sn = (v: unknown) => (typeof v === 'string' && v ? v : null);
const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const arr = (v: unknown): Row[] => (Array.isArray(v) ? v.filter(x => x && typeof x === 'object') as Row[] : []);

export function normInfo(raw: unknown): LegalEntityInfo {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Row;
  const info = emptyInfo();
  info.owners = arr(r.owners).map(o => ({ id: s(o.id) || rid(), name: s(o.name), capital: num(o.capital), percent: num(o.percent), note: s(o.note) }));
  info.industries = arr(r.industries).map(o => ({ id: s(o.id) || rid(), code: s(o.code), name: s(o.name), main: !!o.main }));
  info.banks = arr(r.banks).map(o => ({ id: s(o.id) || rid(), bank: s(o.bank), number: s(o.number), branch: s(o.branch), holder: s(o.holder) }));
  info.licenses = arr(r.licenses).map(o => ({
    id: s(o.id) || rid(), name: s(o.name), number: s(o.number), issuer: s(o.issuer), issued: s(o.issued), expires: s(o.expires), url: s(o.url), note: s(o.note),
  }));
  info.registrationUrl = s(r.registrationUrl);
  return info;
}

const STATUSES: EntityStatus[] = ['active', 'paused', 'dissolved'];
export function normEntity(r: Row): LegalEntity {
  return {
    id: s(r.id), name: s(r.name), short_name: s(r.short_name), english_name: s(r.english_name), tax_code: s(r.tax_code),
    business_type: s(r.business_type), founded_date: sn(r.founded_date), registry_office: s(r.registry_office), address: s(r.address),
    phone: s(r.phone), email: s(r.email), website: s(r.website), charter_capital: num(r.charter_capital), legal_rep: s(r.legal_rep),
    legal_rep_title: s(r.legal_rep_title), status: STATUSES.includes(r.status as EntityStatus) ? r.status as EntityStatus : 'active',
    color: s(r.color) || '#0071E3', logo_url: sn(r.logo_url), drive_url: s(r.drive_url), quote_entity_id: sn(r.quote_entity_id),
    info: normInfo(r.info), note: s(r.note), sort_order: Number(r.sort_order) || 0, updated_by: s(r.updated_by),
    updated_at: s(r.updated_at), created_at: s(r.created_at), deleted_at: sn(r.deleted_at),
  };
}

const KINDS: MilestoneKind[] = ['thanh_lap', 'thay_doi', 'giay_phep', 'thue', 'lao_dong', 'con_dau', 'thanh_tra', 'khac'];
const MS_STATUS: MilestoneStatus[] = ['done', 'doing', 'planned'];
export function normMilestone(r: Row): LegalMilestone {
  return {
    id: s(r.id), entity_id: s(r.entity_id), event_date: s(r.event_date).slice(0, 10),
    kind: KINDS.includes(r.kind as MilestoneKind) ? r.kind as MilestoneKind : 'khac',
    change_no: num(r.change_no), title: s(r.title), description: s(r.description),
    status: MS_STATUS.includes(r.status as MilestoneStatus) ? r.status as MilestoneStatus : 'done',
    changes: arr(r.changes).map(c => ({ id: s(c.id) || rid(), aspect: s(c.aspect) || 'other', from: s(c.from), to: s(c.to) } as MilestoneChange)),
    updated_by: s(r.updated_by), updated_at: s(r.updated_at), created_at: s(r.created_at), deleted_at: sn(r.deleted_at),
  };
}

export function normTopic(r: Row): LegalTopic {
  return {
    id: s(r.id), parent_id: sn(r.parent_id), title: s(r.title), description: s(r.description), color: s(r.color) || '#0071E3',
    icon: s(r.icon) || 'book', sort_order: Number(r.sort_order) || 0, updated_by: s(r.updated_by), updated_at: s(r.updated_at),
    created_at: s(r.created_at), deleted_at: sn(r.deleted_at),
  };
}

const DOC_KINDS: DocKind[] = ['drive', 'link', 'mindmap', 'lesson', 'cards'];
export function normMeta(raw: unknown): DocMeta {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Row;
  const m: DocMeta = {};
  for (const k of ['number', 'issuer', 'issued', 'effective'] as const) if (s(r[k])) m[k] = s(r[k]);
  if (['active', 'upcoming', 'amended', 'expired'].includes(s(r.status))) m.status = r.status as DocMeta['status'];
  if (Array.isArray(r.tags)) m.tags = r.tags.map(s).filter(Boolean);
  return m;
}
export function normDoc(r: Row): LegalDoc {
  return {
    id: s(r.id), kind: DOC_KINDS.includes(r.kind as DocKind) ? r.kind as DocKind : 'link', title: s(r.title),
    entity_id: sn(r.entity_id), milestone_id: sn(r.milestone_id), topic_id: sn(r.topic_id), category: s(r.category),
    url: s(r.url), file_type: s(r.file_type) as FileType | '', summary: s(r.summary), meta: normMeta(r.meta), color: s(r.color),
    pinned: !!r.pinned, sort_order: Number(r.sort_order) || 0, updated_by: s(r.updated_by), updated_at: s(r.updated_at),
    created_at: s(r.created_at), deleted_at: sn(r.deleted_at),
  };
}

const DOC_COLS = 'id, kind, title, entity_id, milestone_id, topic_id, category, url, file_type, summary, meta, color, pinned, sort_order, updated_by, updated_at, created_at, deleted_at';

export interface LegalData {
  entities: LegalEntity[];
  milestones: LegalMilestone[];
  topics: LegalTopic[];
  docs: LegalDoc[];
}

export async function loadLegal(): Promise<LegalData> {
  const [e, m, t, d] = await Promise.all([
    supabase.from('legal_entities').select('*').is('deleted_at', null).order('sort_order').order('created_at'),
    supabase.from('legal_milestones').select('*').is('deleted_at', null).order('event_date', { ascending: false }),
    supabase.from('legal_topics').select('*').is('deleted_at', null).order('sort_order').order('created_at'),
    supabase.from('legal_docs').select(DOC_COLS).is('deleted_at', null).order('sort_order').order('created_at', { ascending: false }),
  ]);
  for (const r of [e, m, t, d]) if (r.error) fail(r.error);
  return {
    entities: (e.data ?? []).map(r => normEntity(r as Row)),
    milestones: (m.data ?? []).map(r => normMilestone(r as Row)),
    topics: (t.data ?? []).map(r => normTopic(r as Row)),
    docs: (d.data ?? []).map(r => normDoc(r as Row)),
  };
}

// ── Ghi ────────────────────────────────────────────────────────────────────
type EntityInput = Omit<LegalEntity, 'id' | 'updated_by' | 'updated_at' | 'created_at' | 'deleted_at'> & { id?: string | null };

export async function saveEntity(input: EntityInput, userName: string): Promise<LegalEntity> {
  const { id, ...rest } = input;
  const body = { ...rest, founded_date: rest.founded_date || null, updated_by: userName };
  const q = id
    ? supabase.from('legal_entities').update(body).eq('id', id).select('*').single()
    : supabase.from('legal_entities').insert({ ...body, created_by: userName }).select('*').single();
  const { data, error } = await q;
  if (error) fail(error);
  return normEntity(data as Row);
}

export async function patchEntity(id: string, patch: Partial<EntityInput>, userName: string): Promise<LegalEntity> {
  const { data, error } = await supabase.from('legal_entities').update({ ...patch, updated_by: userName }).eq('id', id).select('*').single();
  if (error) fail(error);
  return normEntity(data as Row);
}

type MilestoneInput = Omit<LegalMilestone, 'id' | 'updated_by' | 'updated_at' | 'created_at' | 'deleted_at'> & { id?: string | null };
export async function saveMilestone(input: MilestoneInput, userName: string): Promise<LegalMilestone> {
  const { id, ...body } = input;
  const q = id
    ? supabase.from('legal_milestones').update({ ...body, updated_by: userName }).eq('id', id).select('*').single()
    : supabase.from('legal_milestones').insert({ ...body, created_by: userName, updated_by: userName }).select('*').single();
  const { data, error } = await q;
  if (error) fail(error);
  return normMilestone(data as Row);
}

type TopicInput = Pick<LegalTopic, 'parent_id' | 'title' | 'description' | 'color' | 'icon' | 'sort_order'> & { id?: string | null };
export async function saveTopic(input: TopicInput, userName: string): Promise<LegalTopic> {
  const { id, ...body } = input;
  const q = id
    ? supabase.from('legal_topics').update({ ...body, updated_by: userName }).eq('id', id).select('*').single()
    : supabase.from('legal_topics').insert({ ...body, created_by: userName, updated_by: userName }).select('*').single();
  const { data, error } = await q;
  if (error) fail(error);
  return normTopic(data as Row);
}

export type DocInput = Partial<Omit<LegalDoc, 'id' | 'updated_by' | 'updated_at' | 'created_at' | 'deleted_at'>> & { id?: string | null; content?: unknown };
export async function saveDoc(input: DocInput, userName: string): Promise<LegalDoc> {
  const { id, ...body } = input;
  const q = id
    ? supabase.from('legal_docs').update({ ...body, updated_by: userName }).eq('id', id).select(DOC_COLS).single()
    : supabase.from('legal_docs').insert({ ...body, created_by: userName, updated_by: userName }).select(DOC_COLS).single();
  const { data, error } = await q;
  if (error) fail(error);
  return normDoc(data as unknown as Row);
}

export async function loadDocContent(id: string): Promise<unknown> {
  const { data, error } = await supabase.from('legal_docs').select('content').eq('id', id).maybeSingle();
  if (error) fail(error);
  return (data as { content?: unknown } | null)?.content ?? null;
}

/** Lưu nội dung tự soạn (sơ đồ / bài học / thẻ). Trả về updated_at. */
export async function saveDocContent(id: string, content: unknown, userName: string): Promise<string> {
  const { data, error } = await supabase.from('legal_docs').update({ content, updated_by: userName }).eq('id', id).select('updated_at').single();
  if (error) fail(error);
  return (data as { updated_at?: string })?.updated_at ?? new Date().toISOString();
}

// ── Xoá mềm / Thùng rác ────────────────────────────────────────────────────
export type LegalTable = 'legal_entities' | 'legal_milestones' | 'legal_topics' | 'legal_docs';

export async function archive(table: LegalTable, ids: string[], userName: string): Promise<void> {
  if (!ids.length) return;
  const { error } = await supabase.from(table).update({ deleted_at: new Date().toISOString(), updated_by: userName }).in('id', ids);
  if (error) fail(error);
}

export async function restore(table: LegalTable, id: string, userName: string): Promise<void> {
  const { error } = await supabase.from(table).update({ deleted_at: null, updated_by: userName }).eq('id', id);
  if (error) fail(error);
}

export interface TrashItem { table: LegalTable; id: string; title: string; deleted_at: string; updated_by: string; sub: string }

export async function loadTrash(): Promise<TrashItem[]> {
  const [e, m, t, d] = await Promise.all([
    supabase.from('legal_entities').select('id, name, deleted_at, updated_by').not('deleted_at', 'is', null),
    supabase.from('legal_milestones').select('id, title, event_date, deleted_at, updated_by').not('deleted_at', 'is', null),
    supabase.from('legal_topics').select('id, title, deleted_at, updated_by').not('deleted_at', 'is', null),
    supabase.from('legal_docs').select('id, title, kind, deleted_at, updated_by').not('deleted_at', 'is', null),
  ]);
  for (const r of [e, m, t, d]) if (r.error) fail(r.error);
  const out: TrashItem[] = [
    ...(e.data ?? []).map(r => ({ table: 'legal_entities' as const, id: r.id, title: r.name, deleted_at: r.deleted_at, updated_by: r.updated_by ?? '', sub: 'Pháp nhân' })),
    ...(m.data ?? []).map(r => ({ table: 'legal_milestones' as const, id: r.id, title: r.title || 'Mốc thời gian', deleted_at: r.deleted_at, updated_by: r.updated_by ?? '', sub: `Mốc ${String(r.event_date ?? '').slice(0, 10)}` })),
    ...(t.data ?? []).map(r => ({ table: 'legal_topics' as const, id: r.id, title: r.title, deleted_at: r.deleted_at, updated_by: r.updated_by ?? '', sub: 'Chủ đề' })),
    ...(d.data ?? []).map(r => ({ table: 'legal_docs' as const, id: r.id, title: r.title || 'Tài liệu', deleted_at: r.deleted_at, updated_by: r.updated_by ?? '', sub: 'Tài liệu' })),
  ];
  return out.sort((a, b) => b.deleted_at.localeCompare(a.deleted_at));
}
