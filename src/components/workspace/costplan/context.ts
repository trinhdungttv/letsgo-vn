// Phương án giá — phần "ngữ cảnh" của phương án (khách nào, ngành gì, KCN nào, chi nhánh nào)
// và cách lấy các thông tin đó từ hồ sơ CRM / khách hàng đã có, để khỏi nhập lại.
import { supabase } from '../../../lib/supabase';
import { normalizeQuoteInfo, type QuoteInfoLine } from '../../../lib/quoteInfo';
import { branchOf } from '../../../lib/branchRef';
import type { Branch, Client, CRMPipelineEntry } from '../../../lib/types';

export interface PlanMeta {
  title: string;
  industry: string;
  zone_name: string;
  zone_id: string | null;
  branch_id: string | null;
  pipeline_id: string | null;
  client_id: string | null;
  company_name: string;
  status: 'draft' | 'final' | 'archived';
}

export const emptyMeta = (): PlanMeta => ({
  title: '', industry: '', zone_name: '', zone_id: null, branch_id: null,
  pipeline_id: null, client_id: null, company_name: '', status: 'draft',
});

/** Giá trị chọn khách trong dropdown: "crm:<id>" (CRM Pipeline) hoặc "client:<id>" (khách hàng). */
export const companyValue = (m: Pick<PlanMeta, 'pipeline_id' | 'client_id'>) =>
  m.pipeline_id ? `crm:${m.pipeline_id}` : m.client_id ? `client:${m.client_id}` : '';

export interface ResolvedCompany {
  meta: Partial<PlanMeta>;
  workers: number | null;
  /** Các dòng đơn giá đã điền ở "Thông tin báo giá" của CRM (nếu có) */
  quoteLines: QuoteInfoLine[];
  /** Nói rõ lấy được gì từ đâu — để hiện cho người dùng biết */
  found: string[];
}

const firstText = (...xs: (string | null | undefined)[]) => xs.map(x => (x ?? '').trim()).find(Boolean) ?? '';

/**
 * Lấy ngành / KCN / chi nhánh / số LĐ của 1 khách ở CRM Pipeline. Ngành & KCN không nằm trên chính
 * dòng pipeline mà rải ở 3 nơi, ưu tiên theo độ "chủ động" của người nhập:
 *   1. Thông tin báo giá (crm_pipeline.quote_info)  — người dùng điền riêng cho việc báo giá
 *   2. Hồ sơ thị trường (market_leads, nối qua crm_id) — dự án đang theo dõi
 *   3. Khách hàng (clients, nối qua client_id)        — khi đã chốt thành khách
 */
export async function resolvePipelineEntry(entry: CRMPipelineEntry, branches: Branch[]): Promise<ResolvedCompany> {
  const found: string[] = [];
  const qi = normalizeQuoteInfo(entry.quote_info);

  const [leadRes, clientRes] = await Promise.all([
    supabase.from('market_leads').select('industry, region').eq('crm_id', entry.id).limit(1).maybeSingle(),
    entry.client_id ? supabase.from('clients').select('industry, industrial_zones').eq('id', entry.client_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const lead = leadRes.data as { industry: string | null; region: string | null } | null;
  const client = clientRes.data as { industry: string | null; industrial_zones: string[] | null } | null;

  const industry = firstText(qi.industry, lead?.industry, client?.industry);
  const zone = firstText(qi.zone, lead?.region, client?.industrial_zones?.[0]);
  if (industry) found.push(`ngành "${industry}"`);
  if (zone) found.push(`KCN "${zone}"`);

  const branch = branchOf(entry, branches);
  if (branch) found.push(`chi nhánh ${branch.name}`);
  const workers = entry.worker_estimate ?? null;
  if (workers) found.push(`${workers} LĐ dự kiến`);

  const quoteLines = qi.lines.filter(l => (l.wage ?? 0) > 0 || (l.fee ?? 0) > 0);
  if (quoteLines.length) found.push(`${quoteLines.length} dòng đơn giá trong "Thông tin báo giá"`);

  return {
    meta: {
      company_name: entry.company_name, pipeline_id: entry.id, client_id: entry.client_id ?? null,
      industry, zone_name: zone, branch_id: branch?.id ?? null,
    },
    workers, quoteLines, found,
  };
}

export function resolveClient(c: Client, branches: Branch[]): ResolvedCompany {
  const found: string[] = [];
  const industry = firstText(c.industry);
  const zone = firstText(c.industrial_zones?.[0]);
  if (industry) found.push(`ngành "${industry}"`);
  if (zone) found.push(`KCN "${zone}"`);
  const branch = branchOf(c, branches);
  if (branch) found.push(`chi nhánh ${branch.name}`);
  const workers = c.current_workers ?? null;
  if (workers) found.push(`${workers} LĐ hiện có`);
  return {
    meta: { company_name: c.name, client_id: c.id, pipeline_id: null, industry, zone_name: zone, branch_id: branch?.id ?? null },
    workers, quoteLines: [], found,
  };
}
