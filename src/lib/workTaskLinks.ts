// ============================================================================
// Việc (work_tasks) gắn CÔNG TY + NGƯỜI LIÊN HỆ — 04/11/2026.
// ----------------------------------------------------------------------------
// 1. Công ty: ô "Khách hàng" của form việc chọn được cả công ty đang ở BD Pipeline (chưa ký HĐ).
//    Việc vẫn chỉ có MỘT khoá công ty là work_tasks.client_id: chọn thẻ Pipeline thì lúc Lưu dùng lại /
//    tạo hồ sơ KH tiềm năng CÙNG TÊN (ensureClientForPipelineCompany — đúng cách CSKH đang gắn người liên
//    hệ vào công ty Pipeline). Nhờ vậy:
//      • hồ sơ công ty Pipeline đọc việc theo hồ sơ tiềm năng đó (pipelineTaskClientId);
//      • "Bắt đầu hợp tác" nâng CHÍNH hồ sơ tiềm năng lên đang hợp tác → việc đã gắn tự đi theo, không mất;
//      • người liên hệ đã gắn công ty Pipeline (qua cùng hồ sơ) lọc được theo công ty ngay trong form.
//    KHÔNG ghi client_id vào thẻ Pipeline (thẻ có client_id = đã hợp tác).
// 2. Người liên hệ: work_tasks.contact_ids uuid[] (migration 200) — nhiều người / việc, không bảng nối,
//    không khoá ngoại (bài học PGRST201). Hồ sơ người liên hệ CSKH đọc .contains('contact_ids', [id]).
//    DB chưa chạy 200: việc vẫn lưu được (bỏ phần người liên hệ) và báo cần chạy migration.
// ============================================================================
import { supabase } from './supabase';
import { foldVN } from './contactCareer';
import { findClientsByName } from './pipelineHelpers';
import { pipelineOnlyCompanies, pipelineStageLabel, type PipelineCompanyLite } from './pipelineCompanyLink';

/** Khoá tạm của công ty chọn từ BD Pipeline trong ô "Khách hàng" (đổi sang clients.id lúc Lưu). */
export const TASK_PIPE_KEY = 'pipe:';

export const MIGRATION_200_HINT =
  'Gắn người liên hệ vào công việc cần migration 200. Mở Supabase → SQL Editor, chạy file ' +
  '20261104140000_200_work_task_contacts.sql rồi thử lại (việc vẫn được lưu, chỉ thiếu người liên hệ).';

/** Lỗi do DB chưa có cột work_tasks.contact_ids (chưa chạy migration 200). */
export function isMissingContactIdsColumn(err: { message?: string; code?: string } | null | undefined): boolean {
  if (!err) return false;
  return /contact_ids/i.test(err.message || '') && /(column|schema cache|does not exist|42703|PGRST204)/i.test(`${err.message} ${err.code}`);
}

export type CompanyKey = { kind: 'client'; id: string } | { kind: 'pipeline'; id: string };

/** '' → null; 'pipe:<id>' → thẻ Pipeline; còn lại → clients.id. */
export function parseCompanyKey(key: string | null | undefined): CompanyKey | null {
  const k = (key ?? '').trim();
  if (!k) return null;
  if (k.startsWith(TASK_PIPE_KEY)) {
    const id = k.slice(TASK_PIPE_KEY.length);
    return id ? { kind: 'pipeline', id } : null;
  }
  return { kind: 'client', id: k };
}

/** Thẻ Pipeline → dạng gọn dùng cho ensureClientForPipelineCompany. */
export function toPipelineLite(e: {
  id: string; company_name: string; stage: string;
  client_id?: string | null; contact_id?: string | null; branch_id?: string | null;
}): PipelineCompanyLite {
  return {
    id: e.id, company_name: e.company_name, stage: e.stage,
    client_id: e.client_id ?? null, contact_id: e.contact_id ?? null, branch_id: e.branch_id ?? null,
  };
}

/**
 * Công ty ở BD Pipeline chọn được cho 1 việc: chưa ký HĐ (chưa gắn hồ sơ Khách hàng), bỏ thẻ
 * "Không hợp tác" và "Ngưng HĐ", bỏ thẻ trùng tên khách đang hợp tác (khách đó đã có trong danh sách
 * trên) và trùng tên nhau. Xếp theo tên.
 */
export function taskPipelineChoices(
  entries: readonly PipelineCompanyLite[],
  activeClientNames: Iterable<string>,
): PipelineCompanyLite[] {
  return pipelineOnlyCompanies(entries.filter(e => e.stage !== 'khong-nhu-cau'), activeClientNames)
    .sort((a, b) => a.company_name.localeCompare(b.company_name, 'vi'));
}

/** Nhãn 1 dòng chọn công ty Pipeline: "Coherent Vietnam — Đàm phán HĐ". */
export const pipelineChoiceLabel = (e: Pick<PipelineCompanyLite, 'company_name' | 'stage'>): string =>
  `${e.company_name} — ${pipelineStageLabel(e.stage)}`;

/**
 * Hồ sơ clients đang giữ việc / người liên hệ của 1 công ty Pipeline: client_id của thẻ nếu đã hợp tác,
 * không thì hồ sơ (chưa lưu trữ) TRÙNG TÊN — thường là KH tiềm năng tạo lúc gắn việc / người liên hệ.
 * Chưa có thì null (chưa gắn gì). Chỉ đọc, không tạo.
 */
export async function pipelineTaskClientId(entry: { company_name: string; client_id?: string | null }): Promise<string | null> {
  if (entry.client_id) return entry.client_id;
  const name = entry.company_name.replace(/\s+/g, ' ').trim();
  if (!name) return null;
  return (await findClientsByName(name)).find(c => !c.archived_at)?.id ?? null;
}

/** Bỏ trùng / rỗng, giữ thứ tự chọn. */
export function cleanContactIds(ids: readonly (string | null | undefined)[]): string[] {
  const out: string[] = [];
  for (const id of ids) {
    const v = (id ?? '').trim();
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

// ── Chọn người liên hệ ───────────────────────────────────────────────────────

export interface TaskContactLite {
  id: string;
  name: string;
  role: string | null;
  /** Tên các công ty người này phụ trách. */
  companies: string[];
  /** Thuộc công ty đang chọn ở ô "Khách hàng" của việc. */
  inCompany: boolean;
}

/**
 * Gợi ý người liên hệ cho ô chọn của việc:
 *  • chưa gõ gì → chỉ người của công ty đang chọn (chưa chọn công ty thì trống — gõ tên để tìm);
 *  • đã gõ → tìm theo tên / chức vụ / tên công ty (không dấu), người của công ty đang chọn lên đầu,
 *    rồi tên bắt đầu bằng chữ gõ, rồi theo ABC.
 * Bỏ người đã chọn.
 */
export function rankTaskContacts(
  all: readonly TaskContactLite[],
  opts: { query: string; selected: readonly string[]; limit?: number },
): TaskContactLite[] {
  const q = foldVN(opts.query || '');
  const chosen = new Set(opts.selected);
  const pool = all.filter(c => !chosen.has(c.id));
  const hits = q
    ? pool.filter(c => foldVN(c.name).includes(q) || foldVN(c.role ?? '').includes(q) || c.companies.some(n => foldVN(n).includes(q)))
    : pool.filter(c => c.inCompany);
  const starts = (c: TaskContactLite) => (q && foldVN(c.name).startsWith(q) ? 1 : 0);
  return hits
    .sort((a, b) => Number(b.inCompany) - Number(a.inCompany) || starts(b) - starts(a) || a.name.localeCompare(b.name, 'vi'))
    .slice(0, opts.limit ?? 8);
}

// ── Ghi việc ─────────────────────────────────────────────────────────────────

/**
 * Thêm 1 việc kèm người liên hệ. DB chưa có cột contact_ids → thêm lại KHÔNG kèm người liên hệ để việc
 * không bị mất, trả `warning` để báo cần chạy migration 200.
 */
export async function insertWorkTaskWithContacts<T>(
  row: Record<string, unknown>,
  contactIds: readonly string[],
): Promise<{ data: T | null; error: { message: string } | null; warning: string | null }> {
  const ids = cleanContactIds(contactIds);
  // Không gắn ai thì không gửi cột (DB tự để '{}') — chưa chạy 200 vẫn lưu được ngay lần đầu.
  const first = await supabase.from('work_tasks').insert(ids.length ? { ...row, contact_ids: ids } : row).select().single();
  if (!first.error) return { data: first.data as T, error: null, warning: null };
  if (!ids.length || !isMissingContactIdsColumn(first.error)) return { data: null, error: first.error, warning: null };
  const retry = await supabase.from('work_tasks').insert(row).select().single();
  if (retry.error) return { data: null, error: retry.error, warning: null };
  return { data: retry.data as T, error: null, warning: MIGRATION_200_HINT };
}

/** Đổi người liên hệ của 1 việc đã có. Chưa chạy 200 → ném lỗi kèm hướng dẫn. */
export async function updateWorkTaskContacts(taskId: string, contactIds: readonly string[]): Promise<string[]> {
  const ids = cleanContactIds(contactIds);
  // KHÔNG đụng updated_at: Tái ký HĐ dùng nó để đếm "Chờ khách · N ngày" và 1 ngày ân hạn sau Hoàn tất.
  const { error } = await supabase.from('work_tasks').update({ contact_ids: ids }).eq('id', taskId);
  if (error) throw new Error(isMissingContactIdsColumn(error) ? MIGRATION_200_HINT : error.message);
  return ids;
}
