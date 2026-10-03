// Phương án giá — lớp gọi DB. Bảng cost_plans* bị khoá với anon (migration 157), mọi thứ đi qua RPC:
//   • trong app : kèm session token đăng nhập
//   • qua link  : kèm mã link + PIN 4 số (không cần đăng nhập)
import { supabase } from '../supabase';
import type { CostPlanRow, PlanData, PlanRevision, PlanSummary } from './types';

const MIGRATION_HINT = 'Chưa chạy migration 157 (Phương án giá) trên Supabase — chạy file supabase/migrations/20261003100000_157_cost_plans.sql rồi tải lại trang.';

function fail(err: { message?: string; code?: string } | null): never {
  const msg = err?.message ?? 'Lỗi không xác định';
  if (err?.code === 'PGRST202' || err?.code === '42883' || /could not find the function|schema cache/i.test(msg)) throw new Error(MIGRATION_HINT);
  throw new Error(msg);
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) fail(error);
  return data as T;
}

// ── Trong app ─────────────────────────────────────────────────────────────────────────────
export async function listPlans(token: string): Promise<CostPlanRow[]> {
  return (await rpc<CostPlanRow[] | null>('cost_plan_list', { p_token: token })) ?? [];
}

export interface PlanFields {
  title?: string;
  industry?: string | null;
  zone_name?: string | null;
  zone_id?: string | null;
  branch_id?: string | null;
  pipeline_id?: string | null;
  client_id?: string | null;
  company_name?: string | null;
  status?: string;
  data?: PlanData;
  summary?: PlanSummary | null;
}

export type SaveResult =
  | { ok: true; plan: CostPlanRow }
  | { ok: false; reason: 'conflict'; plan: CostPlanRow };

export async function savePlan(
  token: string, id: string | null, fields: PlanFields,
  opts: { expectedVersion?: number | null; force?: boolean; note?: string } = {},
): Promise<SaveResult> {
  return rpc<SaveResult>('cost_plan_save', {
    p_token: token, p_id: id, p_fields: fields,
    p_expected_version: opts.expectedVersion ?? null, p_force: !!opts.force, p_note: opts.note ?? null,
  });
}

export async function deletePlan(token: string, id: string): Promise<void> {
  await rpc<void>('cost_plan_delete', { p_token: token, p_id: id });
}

export async function planHistory(token: string, id: string): Promise<PlanRevision[]> {
  return (await rpc<PlanRevision[] | null>('cost_plan_history', { p_token: token, p_id: id })) ?? [];
}

export async function setShare(
  token: string, planId: string, pin: string,
  opts: { canEdit: boolean; expiresDays: number | null; newCode?: boolean },
): Promise<{ code: string; can_edit: boolean; expires_at: string | null }> {
  return rpc('cost_plan_share_set', {
    p_token: token, p_plan_id: planId, p_pin: pin, p_can_edit: opts.canEdit,
    p_expires_days: opts.expiresDays, p_new_code: !!opts.newCode,
  });
}

export async function revokeShare(token: string, planId: string): Promise<void> {
  await rpc<void>('cost_plan_share_revoke', { p_token: token, p_plan_id: planId });
}

// ── Link chia sẻ ──────────────────────────────────────────────────────────────────────────
export const SHARE_PREFIX = '#/p/';

/** https://<tên miền>/#/p/K7M4QX — link ngắn, dán vào Zalo là mở được. */
export const shareUrl = (code: string) => `${window.location.origin}/${SHARE_PREFIX}${code}`;

/** Lấy mã link từ hash hiện tại ("#/p/K7M4QX" → "K7M4QX"); không phải link chia sẻ → null. */
export function parseShareHash(hash: string): string | null {
  const m = /^#\/p\/([A-Za-z0-9]{4,12})\/?$/.exec(hash);
  return m ? m[1].toUpperCase() : null;
}

export type ShareFailReason = 'not_found' | 'expired' | 'locked' | 'wrong_pin' | 'read_only' | 'too_large' | 'conflict';

export interface SharedPlan {
  id: string; title: string; industry: string | null; zone_name: string | null; company_name: string | null;
  status: string; data: PlanData; summary: PlanSummary | null; version: number;
  updated_at: string; updated_by_name: string | null;
}

export type ShareOpenResult =
  | { ok: true; can_edit: boolean; plan: SharedPlan }
  | { ok: false; reason: ShareFailReason; seconds?: number; remaining?: number };

/** `count` = false khi chỉ tải lại bản mới (không tính là 1 lượt mở link). */
export const shareOpen = (code: string, pin: string, count = true) =>
  rpc<ShareOpenResult>('cost_plan_share_open', { p_code: code, p_pin: pin, p_count: count });

export type SharePeekResult =
  | { ok: true; version: number; updated_at: string; updated_by_name: string | null }
  | { ok: false; reason: ShareFailReason; seconds?: number };

export const sharePeek = (code: string, pin: string) =>
  rpc<SharePeekResult>('cost_plan_share_peek', { p_code: code, p_pin: pin });

export type ShareSaveResult =
  | { ok: true; version: number; updated_at: string }
  | { ok: false; reason: 'conflict'; plan: SharedPlan }
  | { ok: false; reason: Exclude<ShareFailReason, 'conflict'>; seconds?: number; remaining?: number };

export const shareSave = (
  code: string, pin: string, editor: string, expectedVersion: number,
  data: PlanData, summary: PlanSummary | null, note: string | null, force = false,
) =>
  rpc<ShareSaveResult>('cost_plan_share_save', {
    p_code: code, p_pin: pin, p_editor: editor, p_expected_version: expectedVersion,
    p_data: data, p_summary: summary, p_note: note, p_force: force,
  });

export function lockMessage(seconds?: number): string {
  const s = seconds ?? 0;
  const m = Math.ceil(s / 60);
  return `Nhập sai quá nhiều lần — link tạm khoá${m > 0 ? ` ${m >= 60 ? `${Math.ceil(m / 60)} giờ` : `${m} phút`}` : ''}. Liên hệ người gửi link nếu cần mở ngay.`;
}

// ── Mẫu khoản mục theo ngành (migration 158) ─────────────────────────────────────────────
import type { IndustryTemplate } from './template';
import type { CostLine } from './types';

/** Chưa chạy migration 158 → trả về [] (không báo lỗi: chỉ là chưa có mẫu nào, dùng bộ gợi ý chung). */
export async function listTemplates(token: string): Promise<IndustryTemplate[]> {
  const { data, error } = await supabase.rpc('cost_template_list', { p_token: token });
  if (error) return [];
  return (data as IndustryTemplate[] | null) ?? [];
}

export async function saveTemplate(token: string, industry: string, lines: CostLine[]): Promise<IndustryTemplate> {
  const { data, error } = await supabase.rpc('cost_template_save', { p_token: token, p_industry: industry, p_lines: lines });
  if (error) {
    if (error.code === 'PGRST202' || error.code === '42883' || /could not find the function|schema cache/i.test(error.message)) {
      throw new Error('Chưa chạy migration 158 (mẫu theo ngành) trên Supabase — chạy file supabase/migrations/20261003110000_158_industry_cost_templates.sql rồi tải lại trang.');
    }
    throw new Error(error.message);
  }
  return data as IndustryTemplate;
}

export async function deleteTemplate(token: string, industry: string): Promise<void> {
  const { error } = await supabase.rpc('cost_template_delete', { p_token: token, p_industry: industry });
  if (error) throw new Error(error.message);
}

// ── Thư viện file Excel mẫu báo giá (migration 159) ──────────────────────────────────────
import type { TemplateVersion } from './excelFill';

export interface QuoteTemplateRow {
  id: string;
  name: string;
  file_name: string;
  size_bytes: number;
  versions: TemplateVersion[];
  created_by_name: string | null;
  updated_by_name: string | null;
  created_at: string;
  updated_at: string;
}

/** Tối đa ~2,5 MB (giới hạn ở DB là 3,5 triệu ký tự base64). */
export const QUOTE_TEMPLATE_MAX_BYTES = 2_500_000;

const QT_HINT = 'Chưa chạy migration 159 (thư viện file mẫu) trên Supabase — chạy file supabase/migrations/20261003120000_159_quote_templates.sql rồi tải lại trang.';
function qtFail(err: { message?: string; code?: string }): never {
  const msg = err.message ?? 'Lỗi không xác định';
  if (err.code === 'PGRST202' || err.code === '42883' || /could not find the function|schema cache/i.test(msg)) throw new Error(QT_HINT);
  throw new Error(msg);
}

export function bufToB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
export function b64ToBuf(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

export async function listQuoteTemplates(token: string): Promise<QuoteTemplateRow[]> {
  const { data, error } = await supabase.rpc('quote_template_list', { p_token: token });
  if (error) qtFail(error);
  return (data as QuoteTemplateRow[] | null) ?? [];
}

export async function getQuoteTemplateFile(token: string, id: string): Promise<ArrayBuffer> {
  const { data, error } = await supabase.rpc('quote_template_get', { p_token: token, p_id: id });
  if (error) qtFail(error);
  return b64ToBuf((data as { file_b64: string }).file_b64);
}

export async function saveQuoteTemplate(
  token: string,
  a: { id?: string | null; name: string; versions: TemplateVersion[]; fileName?: string; file?: ArrayBuffer },
): Promise<QuoteTemplateRow> {
  if (a.file && a.file.byteLength > QUOTE_TEMPLATE_MAX_BYTES) throw new Error('File quá lớn để lưu (tối đa khoảng 2,5 MB) — bạn vẫn dùng được bằng cách chọn "Chỉ dùng lần này".');
  const { data, error } = await supabase.rpc('quote_template_save', {
    p_token: token, p_id: a.id ?? null, p_name: a.name, p_file_name: a.fileName ?? null,
    p_file_b64: a.file ? bufToB64(a.file) : null, p_size: a.file?.byteLength ?? null, p_versions: a.versions,
  });
  if (error) qtFail(error);
  return data as QuoteTemplateRow;
}

export async function deleteQuoteTemplate(token: string, id: string): Promise<void> {
  const { error } = await supabase.rpc('quote_template_delete', { p_token: token, p_id: id });
  if (error) qtFail(error);
}

// ── Hồ sơ công ty gửi báo giá + ảnh chữ ký / con dấu (migration 160) ────────────────────
import { normalizeProfile, type CompanyProfileData } from './quoteDoc';

export interface QuoteProfile {
  data: CompanyProfileData;
  logo: string | null;
  /** Chỉ admin mới nhận ảnh chữ ký / con dấu; người khác chỉ biết đã có hay chưa */
  signature: string | null;
  seal: string | null;
  has_signature: boolean;
  has_seal: boolean;
  can_sign: boolean;
  updated_by_name: string | null;
  updated_at: string | null;
}

const QP_HINT = 'Chưa chạy migration 160 (hồ sơ công ty, chữ ký, con dấu) trên Supabase — chạy file supabase/migrations/20261003130000_160_quote_company_profile.sql rồi tải lại trang.';
function qpFail(err: { message?: string; code?: string }): never {
  const msg = err.message ?? 'Lỗi không xác định';
  if (err.code === 'PGRST202' || err.code === '42883' || /could not find the function|schema cache/i.test(msg)) throw new Error(QP_HINT);
  throw new Error(msg);
}

export async function getQuoteProfile(token: string): Promise<QuoteProfile> {
  const { data, error } = await supabase.rpc('quote_profile_get', { p_token: token });
  if (error) qpFail(error);
  const r = data as Omit<QuoteProfile, 'data'> & { data: unknown };
  return { ...r, data: normalizeProfile(r.data) };
}

/** Với mỗi ảnh: undefined = giữ nguyên, null = xoá, chuỗi = ảnh mới (data URL). */
export async function saveQuoteProfile(
  token: string, a: { data: CompanyProfileData; logo?: string | null; signature?: string | null; seal?: string | null },
): Promise<void> {
  const enc = (v: string | null | undefined) => (v === undefined ? null : v === null ? '' : v);
  const { error } = await supabase.rpc('quote_profile_save', { p_token: token, p_data: a.data, p_logo: enc(a.logo), p_signature: enc(a.signature), p_seal: enc(a.seal) });
  if (error) qpFail(error);
}


// ── Pháp nhân gửi báo giá (migration 161) ────────────────────────────────────────────────
import { normalizeLayout, type QuoteEntity, type StampLayout } from './entity';

const QE_HINT = 'Chưa chạy migration 161 (nhiều pháp nhân) trên Supabase — chạy file supabase/migrations/20261003140000_161_quote_entities.sql rồi tải lại trang.';
function qeFail(err: { message?: string; code?: string }): never {
  const msg = err.message ?? 'Lỗi không xác định';
  if (err.code === 'PGRST202' || err.code === '42883' || /could not find the function|schema cache/i.test(msg)) throw new Error(QE_HINT);
  throw new Error(msg);
}

export async function listEntities(token: string): Promise<{ canSign: boolean; entities: QuoteEntity[] }> {
  const { data, error } = await supabase.rpc('quote_entity_list', { p_token: token });
  if (error) qeFail(error);
  const r = data as { can_sign: boolean; entities: (Omit<QuoteEntity, 'data' | 'layout'> & { data: unknown; layout: unknown })[] };
  return { canSign: !!r.can_sign, entities: (r.entities ?? []).map(e => ({ ...e, data: normalizeProfile(e.data), layout: normalizeLayout(e.layout) })) };
}

/** Với mỗi ảnh: undefined = giữ nguyên, null = xoá, chuỗi = ảnh mới (data URL). Trả về id pháp nhân. */
export async function saveEntity(
  token: string,
  a: { id?: string | null; label: string; data: CompanyProfileData; layout: StampLayout; logo?: string | null; signature?: string | null; seal?: string | null },
): Promise<string> {
  const enc = (v: string | null | undefined) => (v === undefined ? null : v === null ? '' : v);
  const { data, error } = await supabase.rpc('quote_entity_save', {
    p_token: token, p_id: a.id ?? null, p_label: a.label, p_data: a.data, p_layout: a.layout,
    p_logo: enc(a.logo), p_signature: enc(a.signature), p_seal: enc(a.seal),
  });
  if (error) qeFail(error);
  return (data as { id: string }).id;
}

export async function deleteEntity(token: string, id: string): Promise<void> {
  const { error } = await supabase.rpc('quote_entity_delete', { p_token: token, p_id: id });
  if (error) qeFail(error);
}
