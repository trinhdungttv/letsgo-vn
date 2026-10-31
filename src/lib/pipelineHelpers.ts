import { supabase } from './supabase';
import type { Client, CRMPipelineEntry } from './types';

/**
 * Cột nạp kèm mỗi dòng crm_pipeline (người liên hệ + sản phẩm). Từ migration 178, crm_pipeline có 2
 * khoá ngoại sang contacts (contact_id + source_contact_id "Sale giới thiệu") → PHẢI chỉ đích danh
 * đường contact_id; viết `contacts(...)` trống trơn thì PostgREST báo "more than one relationship"
 * (PGRST201) và cả trang BD Pipeline trống. Dùng hằng này thay vì tự viết chuỗi select.
 */
export const PIPELINE_SELECT = '*, contacts!crm_pipeline_contact_id_fkey(name, phone), crm_products(name, category, price)';

// Lấy entry crm_pipeline gắn với 1 Khách hàng (client_id); nếu chưa có thì
// tự tạo 1 entry "ẩn" để dùng làm gốc dữ liệu chung (lịch sử trao đổi, quà
// tặng, task, sở thích...) cho cả CSKH Radar, CRM Pipeline BD và trang
// Khách hàng.
export async function getOrCreatePipelineEntryForClient(client: Client): Promise<CRMPipelineEntry | null> {
  // Lấy dòng cũ nhất thay vì maybeSingle(): lỡ có 2 dòng cùng client_id thì vẫn ra đúng 1 hồ sơ,
  // không rơi xuống nhánh tạo thêm dòng thứ 3.
  const { data: existing } = await supabase
    .from('crm_pipeline')
    .select('*')
    .eq('client_id', client.id)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (existing) return existing as CRMPipelineEntry;

  const { data: created, error } = await supabase
    .from('crm_pipeline')
    .insert({
      client_id: client.id,
      company_name: client.name,
      branch_id: client.branch_id ?? null,
      stage: 'hop-tac',
      rating: 'normal',
    })
    .select()
    .single();
  if (error) return null;
  return created as CRMPipelineEntry;
}

/* ═══ Chuyển công ty ở CRM Pipeline sang Khách hàng ═══
   Gốc dữ liệu chung là dòng crm_pipeline có client_id: trang Khách hàng (getOrCreatePipelineEntryForClient)
   đọc lịch sử chăm sóc, ghi chú, quà tặng, việc, phụ lục, sở thích theo đúng dòng đó. Vì vậy khi bắt đầu
   hợp tác phải GẮN client_id vào chính thẻ CRM này (trước đây chỉ đổi giai đoạn → trang Khách hàng tự
   tạo thẻ rỗng thứ 2, dữ liệu CRM không sang). Thông tin Thị trường (KCN, nhà cung ứng, ảnh, lương, bản
   đồ, ảnh bìa…) nằm ở market_leads (crm_id) được chép sang các cột tương ứng của clients. */

const blank = (v: unknown) =>
  v == null || v === '' || (Array.isArray(v) && v.length === 0) ||
  (typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).length === 0);

/** Nhà cung ứng chỉ có mỗi Let's Go VN (mặc định) = coi như chưa nhập. */
const blankSuppliers = (v: unknown) => blank(v) || (Array.isArray(v) && v.every(s => s?.is_us));

/** Cột market_leads → cột clients (cùng ý nghĩa). */
const LEAD_TO_CLIENT: [string, string][] = [
  ['industry', 'industry'],
  ['workers_needed', 'market_workers_needed'],
  ['suppliers', 'market_suppliers'],
  ['recruit_image_urls', 'recruit_image_urls'],
  ['wage_min', 'wage_min'],
  ['wage_max', 'wage_max'],
  ['allowance_notes', 'allowance_notes'],
  ['wage_detail', 'wage_detail'],
  ['wage_detail_client', 'wage_detail_client'],
  ['wage_detail_updated_at', 'wage_detail_updated_at'],
  ['wage_detail_client_updated_at', 'wage_detail_client_updated_at'],
  ['website_url', 'website_url'],
  ['facebook_url', 'facebook_url'],
  ['youtube_url', 'youtube_url'],
  ['tiktok_url', 'tiktok_url'],
  ['map_link', 'map_link'],
  ['lat', 'lat'],
  ['lng', 'lng'],
  ['geocoded_at', 'geocoded_at'],
  ['cover_image_url', 'cover_image_url'],
  ['cover_image_fit', 'cover_image_fit'],
  ['cover_image_pos_x', 'cover_image_pos_x'],
  ['cover_image_pos_y', 'cover_image_pos_y'],
];

/** Tách các cột Thị trường của công ty để ghi sang clients. `client` có thì chỉ điền ô đang trống. */
function leadFieldsForClient(lead: Record<string, unknown>, client?: Record<string, unknown> | null) {
  const out: Record<string, unknown> = {};
  for (const [from, to] of LEAD_TO_CLIENT) {
    const v = lead[from];
    const empty = from === 'suppliers' ? blankSuppliers(v) : blank(v) || (v === 0 && !from.startsWith('cover_image_pos'));
    if (empty) continue;
    if (client && !(to === 'market_suppliers' ? blankSuppliers(client[to]) : blank(client[to]))) continue;
    out[to] = v;
  }
  // KCN của công ty (market_leads.region) → clients.industrial_zones
  const zone = typeof lead.region === 'string' ? lead.region.trim() : '';
  if (zone && (!client || blank(client.industrial_zones))) out.industrial_zones = [zone];
  // Ảnh bìa: chỉ chép cách hiển thị khi có chép ảnh
  if (!out.cover_image_url) { delete out.cover_image_fit; delete out.cover_image_pos_x; delete out.cover_image_pos_y; }
  // Link bản đồ + toạ độ đi cùng nhau: khách đã có link hoặc toạ độ thì giữ nguyên của khách
  if (client && (!blank(client.map_link) || client.lat != null)) {
    delete out.map_link; delete out.lat; delete out.lng; delete out.geocoded_at;
  }
  return out;
}

export interface ClientMatch { id: string; name: string; client_type: string | null; archived_at: string | null }

const normName = (s: string) => s.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();

/** Khách hàng trùng tên (không phân biệt hoa thường / khoảng trắng thừa) — tránh tạo hồ sơ trùng. */
export async function findClientsByName(name: string): Promise<ClientMatch[]> {
  const n = normName(name);
  if (!n) return [];
  const pattern = name.trim().replace(/[\\%_]/g, c => '\\' + c).replace(/\s+/g, '%');
  const { data } = await supabase.from('clients').select('id, name, client_type, archived_at').ilike('name', pattern);
  return ((data ?? []) as ClientMatch[]).filter(c => normName(c.name) === n);
}

/** Thẻ CRM khác đang gắn sẵn với khách hàng này (thường do mở trang Khách hàng tự tạo). */
export async function otherPipelineEntryOf(clientId: string, excludeId: string): Promise<CRMPipelineEntry | null> {
  const { data } = await supabase.from('crm_pipeline').select('*')
    .eq('client_id', clientId).neq('id', excludeId)
    .order('created_at', { ascending: true }).limit(1).maybeSingle();
  return (data as CRMPipelineEntry) ?? null;
}

/** Đếm dữ liệu nằm ở 1 thẻ CRM — để hỏi trước khi gộp. */
export async function pipelineDataCounts(crmId: string) {
  const count = async (table: string) => {
    const { count: n } = await supabase.from(table).select('id', { count: 'exact', head: true }).eq('crm_id', crmId);
    return n ?? 0;
  };
  const [interactions, gifts, tasks, appendices] = await Promise.all([
    count('crm_interactions'), count('crm_gifts'), count('crm_pipeline_tasks'), count('pipeline_appendices'),
  ]);
  return { interactions, gifts, tasks, appendices };
}

/** Chuyển toàn bộ dữ liệu con của thẻ `from` sang thẻ `keep`, điền các ô trống của `keep`, rồi đưa
 *  thẻ `from` về "Ngưng HĐ" (ghi rõ đã gộp) — KHÔNG xoá dòng nào, vẫn mở lại xem được. */
async function mergePipelineInto(keep: CRMPipelineEntry, from: CRMPipelineEntry) {
  for (const table of ['crm_interactions', 'crm_gifts', 'crm_pipeline_tasks', 'pipeline_appendices', 'market_leads']) {
    const { error } = await supabase.from(table).update({ crm_id: keep.id }).eq('crm_id', from.id);
    if (error && table !== 'pipeline_appendices') throw new Error(`Chưa gộp được ${table}: ${error.message}`);
  }
  // Phương án giá (migration 157) — chưa có bảng thì bỏ qua
  await supabase.from('cost_plans').update({ pipeline_id: keep.id }).eq('pipeline_id', from.id);

  const fill: Record<string, unknown> = {};
  for (const k of ['preferences', 'quote_info', 'contact_id', 'product_id', 'custom_price', 'notes', 'workers_seasonal', 'workers_permanent'] as const) {
    const mine = keep[k as keyof CRMPipelineEntry];
    const theirs = from[k as keyof CRMPipelineEntry];
    if ((blank(mine) || mine === 0) && !blank(theirs) && theirs !== 0) fill[k] = theirs;
  }
  if (from.last_contact && (!keep.last_contact || from.last_contact > keep.last_contact)) fill.last_contact = from.last_contact;
  if (Object.keys(fill).length) {
    const { error } = await supabase.from('crm_pipeline').update(fill).eq('id', keep.id);
    if (error) throw new Error('Chưa chép được thông tin từ thẻ cũ: ' + error.message);
  }
  const { error } = await supabase.from('crm_pipeline')
    .update({ client_id: null, stage: 'ngung', sub_status: `Đã gộp vào thẻ "${keep.company_name}"` })
    .eq('id', from.id);
  if (error) throw new Error('Chưa tách được thẻ cũ: ' + error.message);
  return fill;
}

export interface LinkResult {
  /** Các ô của thẻ CRM được điền thêm từ thẻ cũ đã gộp */
  filled: Record<string, unknown>;
  /** Lỗi không chặn (VD: thiếu cột Thị trường ở clients) */
  warning: string | null;
}

/**
 * Gắn thẻ CRM vào hồ sơ Khách hàng `clientId` (khách vừa tạo hoặc đã có):
 *  1. Gộp thẻ CRM khác đang gắn với khách này (nếu có) vào thẻ này.
 *  2. Chép thông tin Thị trường / bản đồ / ảnh bìa của công ty sang clients
 *     (khách đã có: chỉ điền ô trống, không ghi đè).
 *  3. Ghi client_id + giai đoạn Đang HT cho thẻ CRM.
 */
export async function linkPipelineToClient(
  entry: CRMPipelineEntry,
  clientId: string,
  opts: { existingClient: boolean; mergeWith?: CRMPipelineEntry | null },
): Promise<LinkResult> {
  let filled: Record<string, unknown> = {};
  if (opts.mergeWith) filled = await mergePipelineInto(entry, opts.mergeWith);

  let warning: string | null = null;
  const { data: lead } = await supabase.from('market_leads').select('*')
    .eq('crm_id', entry.id).order('created_at', { ascending: true }).limit(1).maybeSingle();
  if (lead) {
    let client: Record<string, unknown> | null = null;
    if (opts.existingClient) {
      const { data } = await supabase.from('clients').select('*').eq('id', clientId).maybeSingle();
      client = data ?? {};
    }
    const fields = leadFieldsForClient(lead, client);
    if (Object.keys(fields).length) {
      const { error } = await supabase.from('clients').update(fields).eq('id', clientId);
      if (error) warning = 'Chưa chép được thông tin Thị trường sang Khách hàng: ' + error.message;
    }
  }

  const { error } = await supabase.from('crm_pipeline')
    .update({ client_id: clientId, stage: 'hop-tac', sub_status: null }).eq('id', entry.id);
  if (error) throw new Error('Chưa gắn được thẻ CRM với Khách hàng: ' + error.message);
  return { filled, warning };
}
