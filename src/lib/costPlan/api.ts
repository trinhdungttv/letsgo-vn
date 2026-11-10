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
// Thông tin pháp nhân lấy từ Pháp lý (legal_entities) — quote_entities chỉ còn là bộ chữ ký / con dấu (migration 219).
import { normalizeLayout, type LegalEntityLite, type QuoteEntity, type StampLayout, type StampRow } from './entity';
import { mergeEntities } from './legalLink';

const QE_HINT = 'Chưa chạy migration 161 (nhiều pháp nhân) trên Supabase — chạy file supabase/migrations/20261003140000_161_quote_entities.sql rồi tải lại trang.';
export const STAMP_HINT = 'Chưa chạy migration 219 (pháp nhân lấy từ Pháp lý + nhân viên dùng chữ ký / con dấu) trên Supabase — chạy file supabase/migrations/20261110140000_219_entity_legal_stamp_alerts.sql rồi tải lại trang.';
const isMissingFn = (err: { message?: string; code?: string }) =>
  err.code === 'PGRST202' || err.code === '42883' || /could not find the function|schema cache/i.test(err.message ?? '');
function qeFail(err: { message?: string; code?: string }): never {
  if (isMissingFn(err)) throw new Error(QE_HINT);
  throw new Error(err.message ?? 'Lỗi không xác định');
}

const LEGAL_COLS = 'id, name, short_name, tax_code, address, phone, email, website, legal_rep, legal_rep_title, status, logo_url, quote_entity_id, color';

/** Pháp nhân bên Pháp lý (bảng mở, đọc thẳng). Lỗi / chưa có bảng → [] (giấy tờ vẫn dùng dữ liệu cũ). */
async function listLegalLite(): Promise<LegalEntityLite[]> {
  const { data, error } = await supabase.from('legal_entities').select(LEGAL_COLS).is('deleted_at', null).order('sort_order').order('created_at');
  if (error || !data) return [];
  const s = (v: unknown) => (typeof v === 'string' ? v : '');
  return (data as unknown as Record<string, unknown>[]).map(r => ({
    id: s(r.id), name: s(r.name), short_name: s(r.short_name), tax_code: s(r.tax_code), address: s(r.address), phone: s(r.phone),
    email: s(r.email), website: s(r.website), legal_rep: s(r.legal_rep), legal_rep_title: s(r.legal_rep_title), status: s(r.status) || 'active',
    logo_url: s(r.logo_url) || null, quote_entity_id: s(r.quote_entity_id) || null, color: s(r.color) || '#0071E3',
  }));
}

// Logo Pháp lý là link ảnh (R2 / Supabase Storage) → tải về thành data URL để chèn PDF / Excel. Nhớ theo link.
const logoCache = new Map<string, Promise<string | null>>();
function logoDataUrl(url: string): Promise<string | null> {
  if (url.startsWith('data:image/')) return Promise.resolve(url);
  let p = logoCache.get(url);
  if (!p) {
    p = fetch(url, { mode: 'cors' })
      .then(r => (r.ok ? r.blob() : null))
      .then(b => (b && b.type.startsWith('image/') ? new Promise<string | null>(res => {
        const fr = new FileReader();
        fr.onload = () => res(typeof fr.result === 'string' ? fr.result : null);
        fr.onerror = () => res(null);
        fr.readAsDataURL(b);
      }) : null))
      .catch(() => null);
    void p.then(v => { if (!v) logoCache.delete(url); });           // lỗi mạng → lần sau thử lại
    logoCache.set(url, p);
  }
  return p;
}

export interface EntityList {
  /** Admin: sửa pháp nhân, nhận ảnh chữ ký / con dấu ngay trong danh sách */
  canSign: boolean;
  /** Được lấy chữ ký / con dấu để làm giấy tờ (có báo admin) — false khi chưa chạy migration 219 */
  canStamp: boolean;
  entities: QuoteEntity[];
}

export async function listEntities(token: string): Promise<EntityList> {
  const [rpc, legals] = await Promise.all([supabase.rpc('quote_entity_list', { p_token: token }), listLegalLite()]);
  if (rpc.error) qeFail(rpc.error);
  const r = rpc.data as { can_sign: boolean; can_stamp?: boolean; entities: (Omit<StampRow, 'data' | 'layout'> & { data: unknown; layout: unknown })[] };
  const stamps: StampRow[] = (r.entities ?? []).map(e => ({ ...e, data: normalizeProfile(e.data), layout: normalizeLayout(e.layout), legal_entity_id: e.legal_entity_id ?? null }));
  const urls = [...new Set(legals.map(l => l.logo_url).filter((u): u is string => !!u))];
  const logos = new Map<string, string>();
  await Promise.all(urls.map(async u => { const d = await logoDataUrl(u); if (d) logos.set(u, d); }));
  return { canSign: !!r.can_sign, canStamp: !!r.can_sign || !!r.can_stamp, entities: mergeEntities(stamps, legals, logos) };
}

/**
 * Lưu bộ ký/dấu. Với mỗi ảnh: undefined = giữ nguyên, null = xoá, chuỗi = ảnh mới (data URL). Trả về id bộ ký/dấu.
 * legalEntityId: gắn vào pháp nhân Pháp lý (pháp nhân đó đã có bộ → sửa bộ đó).
 */
export async function saveEntity(
  token: string,
  a: { id?: string | null; label: string; data: CompanyProfileData; layout: StampLayout; logo?: string | null; signature?: string | null; seal?: string | null; legalEntityId?: string | null },
): Promise<string> {
  const enc = (v: string | null | undefined) => (v === undefined ? null : v === null ? '' : v);
  const args: Record<string, unknown> = {
    p_token: token, p_id: a.id ?? null, p_label: a.label, p_data: a.data, p_layout: a.layout,
    p_logo: enc(a.logo), p_signature: enc(a.signature), p_seal: enc(a.seal),
  };
  if (a.legalEntityId) args.p_legal_entity_id = a.legalEntityId;
  const { data, error } = await supabase.rpc('quote_entity_save', args);
  if (error) {
    if (a.legalEntityId && isMissingFn(error)) throw new Error(STAMP_HINT);
    qeFail(error);
  }
  return (data as { id: string }).id;
}

/** Lưu bộ ký/dấu của 1 pháp nhân đã gộp — chỉ đổi cách căn / đầu trang, giữ nguyên giá trị đang lưu (không ghi dữ liệu Pháp lý vào). */
export function saveEntityLayout(token: string, e: QuoteEntity, layout: StampLayout): Promise<string> {
  return saveEntity(token, { id: e.stamp_id, label: e.own.label || e.label, data: e.own.data, layout, legalEntityId: e.legal_id });
}

export type StampPurpose = 'gate_list' | 'quote_pdf' | 'quote_excel';
export type StampAction = 'pdf' | 'xlsx' | 'print';

/**
 * Lấy ảnh chữ ký / con dấu để làm giấy tờ (mọi tài khoản đăng nhập) — server ghi nhật ký và ADMIN được báo ngay.
 * `context`: giấy tờ gì, cho ai (vd "Danh sách vào cổng TTI · 11/11/2026") — hiện trong popup của admin.
 */
export async function fetchStamp(
  token: string, stampId: string, parts: ('signature' | 'seal')[], purpose: StampPurpose, context: string,
): Promise<{ alertId: number; signature: string | null; seal: string | null }> {
  const { data, error } = await supabase.rpc('quote_entity_stamp', { p_token: token, p_id: stampId, p_parts: parts, p_purpose: purpose, p_context: context });
  if (error) throw new Error(isMissingFn(error) ? STAMP_HINT : error.message);
  const r = data as { alert_id: number; signature: string | null; seal: string | null };
  return { alertId: r.alert_id, signature: r.signature ?? null, seal: r.seal ?? null };
}

/** Ghi "đã xuất PDF / Excel / In" vào dòng nhật ký (lỗi thì bỏ qua — không chặn việc xuất). */
export async function markStamp(token: string, alertId: number, action: StampAction): Promise<void> {
  try { await supabase.rpc('quote_stamp_mark', { p_token: token, p_alert_id: alertId, p_action: action }); } catch { /* bỏ qua */ }
}

export async function deleteEntity(token: string, id: string): Promise<void> {
  const { error } = await supabase.rpc('quote_entity_delete', { p_token: token, p_id: id });
  if (error) qeFail(error);
}
