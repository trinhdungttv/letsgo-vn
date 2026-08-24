// ─── Xuất hồ sơ khách hàng ra file Markdown ──────────────────────────────────
// Gom toàn bộ dữ liệu của 1 khách hàng (hồ sơ, lao động, PnL, thanh toán, CRM)
// thành file .md có cấu trúc chuẩn để đưa vào AI (Claude) tạo slide / báo cáo.
//
// Nguyên tắc quan trọng:
//  - CHỈ ĐỌC dữ liệu (SELECT) — module này không ghi/xóa bất cứ thứ gì.
//  - Số liệu PnL tính bằng đúng calcPnl() dùng chung với trang Tài chính,
//    tỷ lệ khoán lấy từ chính bản ghi PnL từng tháng (tôn trọng mốc lịch sử khoán).
//  - Ô không có dữ liệu ghi rõ "⚠ chưa nhập" thay vì 0, kèm Data Completeness
//    Report ở đầu file để AI biết chỗ nào tin được, chỗ nào phải bỏ qua.

import { supabase } from '../lib/supabase';
import { formatDayRange, resolveDay } from './timelineDays';
import { isSuspended, suspensionMonth, formatSuspensionDate, suspendedDuration } from './suspension';
import { calcPnl, monthLabel, getManagerForMonth } from '../lib/format';
import { calcExpectedDue } from '../lib/paymentDate';
import { isPrimaryAt } from '../lib/contactOps';
import type {
  Client, LaborHistoryEntry, ClientManagerHistory, ClientBranchHistory,
  ProjectPnl, ProjectPnlCost, PnlRevenueLine, PnlSplitSettings, CostCategory,
  FinanceRecord, Contact, CRMDeal, CRMActivity, ClientGift, ClientDocument,
} from '../lib/types';

// ─── Kiểu dữ liệu ────────────────────────────────────────────────────────────

export interface ExportSections {
  profile: boolean;   // Hồ sơ + liên hệ
  labor: boolean;     // Biến động lao động theo tháng
  finance: boolean;   // PnL doanh thu / chi phí / lợi nhuận
  payment: boolean;   // Lịch sử thanh toán & công nợ
  crm: boolean;       // Deals, quà tặng, lịch sử quản lý/chi nhánh
}

export interface ExportOptions {
  fromMonth: string;  // "YYYY-MM" (bao gồm)
  toMonth: string;    // "YYYY-MM" (bao gồm)
  sections: ExportSections;
  manualNotes?: string; // Ghi chú tay của người xuất, chèn nguyên văn vào file
}

export interface CompletenessItem {
  label: string;
  have: number;
  total: number;
  missing: string[]; // danh sách tháng thiếu (đã format "Tháng m/yyyy")
  note?: string;
}

export interface ExportResult {
  markdown: string;
  filename: string;
  completenessPct: number;
  completeness: CompletenessItem[];
}

interface RawData {
  labor: LaborHistoryEntry[];
  pnls: ProjectPnl[];
  pnlCosts: ProjectPnlCost[];
  pnlRevenues: PnlRevenueLine[];
  splitSettings: PnlSplitSettings | null;
  costCategories: CostCategory[];
  financeRecords: FinanceRecord[];
  managerHistory: ClientManagerHistory[];
  branchHistory: ClientBranchHistory[];
  contacts: Contact[];
  deals: CRMDeal[];
  activities: CRMActivity[];
  gifts: ClientGift[];
  documents: ClientDocument[];
}

// ─── Tiện ích chung ──────────────────────────────────────────────────────────

const MISSING = '⚠ chưa nhập';

function vnd(v: number | null | undefined): string {
  if (v == null) return MISSING;
  return Math.round(v).toLocaleString('vi-VN') + ' ₫';
}

function pct(v: number): string {
  return (Math.round(v * 10) / 10).toLocaleString('vi-VN') + '%';
}

// Danh sách tháng "YYYY-MM" từ fromMonth → toMonth (bao gồm 2 đầu).
export function monthRange(fromMonth: string, toMonth: string): string[] {
  const [fy, fm] = fromMonth.split('-').map(Number);
  const [ty, tm] = toMonth.split('-').map(Number);
  const out: string[] = [];
  let y = fy, m = fm;
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return out;
}

// week_label dạng "TmWw" KHÔNG chứa năm → suy ra năm từ created_at.
// Nếu tháng của nhãn lệch quá 6 tháng so với tháng nhập liệu thì coi như
// thuộc năm liền trước / liền sau (vd nhập tháng 1/2027 cho nhãn T12 → 2026).
function inferLaborMonth(entry: LaborHistoryEntry): string | null {
  const m = entry.week_label.match(/^T(\d+)W(\d+)$/);
  if (!m) return null;
  const labelMonth = Number(m[1]);
  const created = new Date(entry.created_at);
  let year = created.getFullYear();
  const createdMonth = created.getMonth() + 1;
  if (labelMonth - createdMonth > 6) year -= 1;
  else if (createdMonth - labelMonth > 6) year += 1;
  return `${year}-${String(labelMonth).padStart(2, '0')}`;
}

// Số LĐ chốt tháng = bản ghi tuần lớn nhất của tháng (trùng tuần lấy bản nhập sau cùng).
function laborByMonth(labor: LaborHistoryEntry[]): Map<string, number> {
  const best = new Map<string, { week: number; created: string; count: number }>();
  for (const e of labor) {
    const month = inferLaborMonth(e);
    const m = e.week_label.match(/^T\d+W(\d+)$/);
    if (!month || !m) continue;
    const week = Number(m[1]);
    const cur = best.get(month);
    if (!cur || week > cur.week || (week === cur.week && e.created_at > cur.created)) {
      best.set(month, { week, created: e.created_at, count: e.count });
    }
  }
  return new Map([...best.entries()].map(([k, v]) => [k, v.count]));
}

// ─── Tải dữ liệu (chỉ SELECT) ────────────────────────────────────────────────

async function fetchRawData(client: Client, fromMonth: string, toMonth: string): Promise<RawData> {
  const [
    laborRes, pnlRes, splitRes, catRes, finRes,
    mgrRes, brRes, contactRes, dealRes, giftRes, docRes,
  ] = await Promise.all([
    supabase.from('client_labor_history').select('*').eq('client_id', client.id),
    supabase.from('projects_pnl').select('*').eq('client_id', client.id)
      .gte('month', fromMonth).lte('month', toMonth).order('month'),
    supabase.from('pnl_split_settings').select('*').eq('client_id', client.id).maybeSingle(),
    supabase.from('cost_categories').select('*'),
    supabase.from('finance_records').select('*').eq('client_id', client.id)
      .gte('month', fromMonth).lte('month', toMonth).order('month'),
    supabase.from('client_manager_history').select('*').eq('client_id', client.id).order('effective_from'),
    supabase.from('client_branch_history').select('*').eq('client_id', client.id).order('effective_from'),
    // Người liên hệ đi qua bảng nối contact_clients (migration 145): một người
    // phụ trách được nhiều công ty, lọc thẳng contacts.client_id sẽ sót người.
    supabase.from('contacts')
      .select('*, contact_clients!inner(client_id, is_primary)')
      .eq('contact_clients.client_id', client.id)
      .order('created_at'),
    supabase.from('crm_deals').select('*, crm_products(name), contacts(name, phone)')
      .or(`lead_id.eq.${client.id},client_id.eq.${client.id}`).order('created_at'),
    supabase.from('client_gifts').select('*').eq('client_id', client.id).order('gift_date'),
    supabase.from('client_documents').select('*').eq('client_id', client.id).order('created_at'),
  ]);

  const pnls = (pnlRes.data || []) as ProjectPnl[];
  const pnlIds = pnls.map(p => p.id);
  const dealIds = ((dealRes.data || []) as CRMDeal[]).map(d => d.id);

  const [costRes, revRes, actRes] = await Promise.all([
    pnlIds.length
      ? supabase.from('projects_pnl_costs').select('*').in('pnl_id', pnlIds).order('sort_order')
      : Promise.resolve({ data: [] }),
    pnlIds.length
      ? supabase.from('pnl_revenue_lines').select('*').in('pnl_id', pnlIds).order('sort_order')
      : Promise.resolve({ data: [] }),
    dealIds.length
      ? supabase.from('crm_activities').select('*').in('deal_id', dealIds).order('created_at')
      : Promise.resolve({ data: [] }),
  ]);

  return {
    labor: (laborRes.data || []) as LaborHistoryEntry[],
    pnls,
    pnlCosts: (costRes.data || []) as ProjectPnlCost[],
    pnlRevenues: (revRes.data || []) as PnlRevenueLine[],
    splitSettings: (splitRes.data as PnlSplitSettings | null) ?? null,
    costCategories: (catRes.data || []) as CostCategory[],
    financeRecords: (finRes.data || []) as FinanceRecord[],
    managerHistory: (mgrRes.data || []) as ClientManagerHistory[],
    branchHistory: (brRes.data || []) as ClientBranchHistory[],
    contacts: (contactRes.data || []) as Contact[],
    deals: (dealRes.data || []) as CRMDeal[],
    activities: (actRes.data || []) as CRMActivity[],
    gifts: (giftRes.data || []) as ClientGift[],
    documents: (docRes.data || []) as ClientDocument[],
  };
}

// ─── Dựng nội dung Markdown ──────────────────────────────────────────────────

export async function buildClientMdExport(client: Client, opts: ExportOptions): Promise<ExportResult> {
  const raw = await fetchRawData(client, opts.fromMonth, opts.toMonth);
  // Tên chi nhánh lấy từ bảng branches theo branch_id — không đọc client.region (tên cũ).
  const branchName = await (async () => {
    if (!client.branch_id) return null;
    const { data } = await supabase.from('branches').select('name').eq('id', client.branch_id).maybeSingle();
    return (data as { name: string } | null)?.name ?? null;
  })();
  const months = monthRange(opts.fromMonth, opts.toMonth);
  const laborMap = laborByMonth(raw.labor);
  const pnlByMonth = new Map(raw.pnls.map(p => [p.month, p]));
  const finByMonth = new Map(raw.financeRecords.map(f => [f.month, f]));
  const costsByPnl = new Map<string, ProjectPnlCost[]>();
  for (const c of raw.pnlCosts) {
    const arr = costsByPnl.get(c.pnl_id) || [];
    arr.push(c);
    costsByPnl.set(c.pnl_id, arr);
  }
  const revsByPnl = new Map<string, PnlRevenueLine[]>();
  for (const r of raw.pnlRevenues) {
    const arr = revsByPnl.get(r.pnl_id) || [];
    arr.push(r);
    revsByPnl.set(r.pnl_id, arr);
  }

  // PnL từng tháng — tính bằng calcPnl dùng chung với trang Tài chính.
  const taxOpts = {
    categories: raw.costCategories.map(c => ({ label: c.label, group_type: c.group_type })),
    taxPct: raw.splitSettings?.tax_pct ?? 0,
    taxExempt: raw.splitSettings?.tax_exempt ?? false,
  };
  const pnlCalc = new Map<string, ReturnType<typeof calcPnl> & { pnl: ProjectPnl }>();
  for (const p of raw.pnls) {
    const costs = (costsByPnl.get(p.id) || []).map(c => ({ value: c.value, payer: c.payer, label: c.label }));
    pnlCalc.set(p.month, { ...calcPnl(p, costs, taxOpts), pnl: p });
  }

  // ── Data Completeness Report ──
  const completeness: CompletenessItem[] = [];
  const missingOf = (has: (m: string) => boolean): string[] => months.filter(m => !has(m)).map(monthLabel);

  if (opts.sections.labor) {
    const missing = missingOf(m => laborMap.has(m));
    completeness.push({ label: 'Số lao động theo tháng', have: months.length - missing.length, total: months.length, missing });
  }
  if (opts.sections.finance) {
    const missingPnl = missingOf(m => pnlByMonth.has(m));
    completeness.push({ label: 'PnL dự án (doanh thu/lợi nhuận)', have: months.length - missingPnl.length, total: months.length, missing: missingPnl });
    const noCost = raw.pnls.filter(p => !(costsByPnl.get(p.id) || []).length).map(p => monthLabel(p.month));
    if (raw.pnls.length) {
      completeness.push({
        label: 'Chi phí trong PnL', have: raw.pnls.length - noCost.length, total: raw.pnls.length, missing: noCost,
        note: noCost.length ? 'Tháng có PnL nhưng chưa nhập dòng chi phí nào → lợi nhuận tháng đó bị thổi phồng, KHÔNG dùng để phân tích.' : undefined,
      });
    }
  }
  if (opts.sections.payment) {
    const missingFin = missingOf(m => finByMonth.has(m));
    completeness.push({ label: 'Bản ghi thanh toán (finance_records)', have: months.length - missingFin.length, total: months.length, missing: missingFin });
  }
  if (opts.sections.profile) {
    const fields: [string, boolean][] = [
      ['Quản lý phụ trách', !!client.manager],
      ['Chi nhánh', !!branchName],
      ['Ngày bắt đầu hợp đồng', !!client.contract_start],
      ['Ngày kết thúc hợp đồng', !!client.contract_end],
      ['Người liên hệ', raw.contacts.length > 0],
    ];
    const missing = fields.filter(([, ok]) => !ok).map(([label]) => label);
    completeness.push({ label: 'Hồ sơ khách hàng (trường bắt buộc)', have: fields.length - missing.length, total: fields.length, missing });
  }
  const totHave = completeness.reduce((s, c) => s + c.have, 0);
  const totAll = completeness.reduce((s, c) => s + c.total, 0);
  const completenessPct = totAll ? Math.round((totHave / totAll) * 100) : 100;

  // ── Ghép Markdown ──
  const L: string[] = [];
  const today = new Date();
  const exportDate = `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}/${today.getFullYear()}`;

  L.push(`# Báo cáo khách hàng: ${client.name}`);
  L.push('');
  L.push(`| | |`);
  L.push(`|---|---|`);
  L.push(`| Ngày xuất | ${exportDate} |`);
  L.push(`| Kỳ dữ liệu | ${monthLabel(opts.fromMonth)} → ${monthLabel(opts.toMonth)} (${months.length} tháng) |`);
  L.push(`| Loại hình dịch vụ | ${client.service_type === 'recruitment' ? 'Giới thiệu lao động' : client.service_type === 'hoh' ? 'HOH' : 'Cho thuê lao động'} |`);
  L.push(`| Loại dự án | ${client.project_type === 'managed' ? 'Công ty tự vận hành (managed)' : `Khoán chi nhánh (LG ${client.default_lg_pct}% / CN ${client.default_cn_pct}%)`} |`);
  if (isSuspended(client)) {
    const sm = suspensionMonth(client);
    L.push(`| Trạng thái hợp tác | TẠM NGƯNG${formatSuspensionDate(client) ? ` từ ${formatSuspensionDate(client)}` : ''}${suspendedDuration(client) ? ` (đã ngưng ${suspendedDuration(client)})` : ''}${client.suspension_reason ? ` — lý do: ${client.suspension_reason}` : ''} |`);
    if (sm) L.push(`| Tháng dữ liệu cuối cùng | ${monthLabel(sm)} — từ tháng sau không còn phát sinh doanh thu/lao động |`);
  } else {
    L.push('| Trạng thái hợp tác | Đang hợp tác |');
  }
  L.push('');

  // ── 1. Completeness report ──
  L.push('## 1. Báo cáo độ đầy đủ dữ liệu (Data Completeness)');
  L.push('');
  L.push(`**Điểm hoàn thiện dữ liệu: ${completenessPct}%** — ${completenessPct >= 90 ? 'dữ liệu đáng tin cậy để phân tích.' : completenessPct >= 70 ? 'dữ liệu dùng được nhưng cần lưu ý các tháng thiếu bên dưới.' : 'dữ liệu CÒN THIẾU NHIỀU — kết luận phân tích chỉ mang tính tham khảo.'}`);
  L.push('');
  L.push('| Nhóm dữ liệu | Có / Tổng | Thiếu |');
  L.push('|---|---|---|');
  for (const c of completeness) {
    L.push(`| ${c.label} | ${c.have}/${c.total} | ${c.missing.length ? c.missing.join(', ') : '—'} |`);
  }
  L.push('');
  for (const c of completeness) if (c.note) L.push(`> ⚠ **${c.label}:** ${c.note}`);
  L.push('');
  L.push('> **Hướng dẫn cho AI khi phân tích file này:**');
  L.push('> - Ô ghi "⚠ chưa nhập" nghĩa là dữ liệu CHƯA được nhập vào hệ thống, KHÔNG phải giá trị 0. Bỏ qua các tháng này khi tính trung bình, tăng trưởng, xu hướng.');
  L.push('> - Tháng có PnL nhưng chưa nhập chi phí: không dùng số lợi nhuận tháng đó.');
  L.push('> - Khi trình bày, luôn chú thích rõ những tháng bị loại khỏi phân tích do thiếu dữ liệu.');
  L.push('');

  if (opts.manualNotes?.trim()) {
    L.push('## Ghi chú của người xuất báo cáo');
    L.push('');
    L.push(opts.manualNotes.trim());
    L.push('');
  }

  // ── 2. Hồ sơ ──
  if (opts.sections.profile) {
    L.push('## 2. Hồ sơ khách hàng');
    L.push('');
    L.push('| Trường | Giá trị |');
    L.push('|---|---|');
    L.push(`| Chi nhánh | ${branchName || MISSING} |`);
    L.push(`| Quản lý phụ trách hiện tại | ${client.manager || MISSING} |`);
    L.push(`| Khu công nghiệp | ${client.industrial_zones?.length ? client.industrial_zones.join(', ') : MISSING} |`);
    L.push(`| Hợp đồng | ${client.contract_start || MISSING} → ${client.contract_end || MISSING} |`);
    L.push(`| Số LĐ tối thiểu cam kết | ${client.min_workers || MISSING} |`);
    if (client.service_type !== 'recruitment') {
      const dayRange = (start: number | null, end: number | null) =>
        start == null ? MISSING : `ngày ${formatDayRange(start, end)}`;
      L.push(`| Chu kỳ chốt công | ${dayRange(client.cutoff_day, client.cutoff_day_end)} |`);
      L.push(`| Chu kỳ đối chiếu | ${dayRange(client.calc_day, client.calc_day_end)} |`);
      L.push(`| Chu kỳ thanh toán | ${dayRange(client.payment_start, client.payment_end)}${client.next_month_pay ? ' (tháng sau)' : ''} |`);
    } else {
      L.push(`| Công nợ | ${client.payment_term_days || MISSING} ngày |`);
    }
    if (client.notes) L.push(`| Ghi chú | ${client.notes.replace(/\n/g, ' ')} |`);
    L.push('');
    if (raw.contacts.length) {
      L.push('### Người liên hệ');
      L.push('');
      L.push('| Tên | Vai trò | Điện thoại | Email | Chính |');
      L.push('|---|---|---|---|---|');
      for (const c of raw.contacts) {
        L.push(`| ${c.name} | ${c.role || '—'} | ${c.phone || '—'} | ${c.email || '—'} | ${isPrimaryAt(c, client.id) ? '✔' : ''} |`);
      }
      L.push('');
    }
    if (raw.documents.length) {
      L.push('### Tài liệu đã lưu trên hệ thống');
      L.push('');
      for (const d of raw.documents) L.push(`- ${d.name} (${d.doc_type === 'contract' ? 'Hợp đồng' : d.doc_type === 'appendix' ? 'Phụ lục' : 'Khác'}, tải lên ${d.created_at.slice(0, 10)})`);
      L.push('');
    }
  }

  // ── 3. Lao động ──
  if (opts.sections.labor) {
    L.push('## 3. Biến động số lao động theo tháng');
    L.push('');
    L.push('_Số liệu = số LĐ chốt ở tuần cuối cùng có dữ liệu của tháng (nguồn: lịch sử nhập theo tuần)._');
    L.push('');
    L.push('| Tháng | Số LĐ | Tăng/giảm so tháng trước | Quản lý phụ trách |');
    L.push('|---|---|---|---|');
    let prev: number | null = null;
    for (const m of months) {
      const v = laborMap.get(m);
      let delta = '—';
      if (v != null && prev != null) {
        const d = v - prev;
        delta = d === 0 ? '0' : `${d > 0 ? '+' : ''}${d} (${prev ? pct((d / prev) * 100) : '—'})`;
      }
      const mgr = getManagerForMonth(raw.managerHistory, m) || client.manager || '—';
      L.push(`| ${monthLabel(m)} | ${v != null ? v : MISSING} | ${v != null ? delta : '—'} | ${mgr} |`);
      if (v != null) prev = v;
    }
    L.push('');
    const known = months.map(m => laborMap.get(m)).filter((v): v is number => v != null);
    if (known.length >= 2) {
      const first = known[0], last = known[known.length - 1];
      const d = last - first;
      L.push(`**Xu hướng cả kỳ (chỉ tính các tháng có dữ liệu):** ${first} → ${last} LĐ (${d > 0 ? '+' : ''}${d}${first ? `, ${pct((d / first) * 100)}` : ''}).`);
      L.push('');
    }
  }

  // ── 4. Tài chính ──
  if (opts.sections.finance) {
    L.push('## 4. Tài chính dự án theo tháng (PnL)');
    L.push('');
    L.push('_Cách tính đồng nhất với màn hình Tài chính của hệ thống: lợi nhuận = doanh thu − tổng chi phí; thuế tính trên lợi nhuận dương; tỷ lệ chia khoán lấy theo đúng thiết lập tại từng tháng (tôn trọng mốc lịch sử khoán)._');
    L.push('');
    L.push('| Tháng | Doanh thu | Tổng chi phí | LN trước thuế | Thuế | LN sau thuế | Biên LN | Chia khoán (LG/CN) | LN LetsGo | LN Chi nhánh |');
    L.push('|---|---|---|---|---|---|---|---|---|---|');
    for (const m of months) {
      const c = pnlCalc.get(m);
      if (!c) {
        L.push(`| ${monthLabel(m)} | ${MISSING} | ${MISSING} | ${MISSING} | — | ${MISSING} | — | — | — | — |`);
        continue;
      }
      const hasCosts = (costsByPnl.get(c.pnl.id) || []).length > 0;
      const costCell = hasCosts ? vnd(c.tc) : `${MISSING} chi phí`;
      const margin = c.pnl.revenue ? pct((c.profitAfterTax / c.pnl.revenue) * 100) : '—';
      const split = c.pnl.project_type === 'managed' ? 'Công ty vận hành'
        : c.pnl.project_type === 'per_manday' ? `Khoán ${(c.pnl.manday_rate || 0).toLocaleString('vi-VN')}đ/công`
        : `${c.pnl.lg_pct}% / ${c.pnl.cn_pct}%`;
      L.push(`| ${monthLabel(m)} | ${vnd(c.pnl.revenue)} | ${costCell} | ${hasCosts ? vnd(c.profit) : '—'} | ${hasCosts ? vnd(c.tax) : '—'} | ${hasCosts ? vnd(c.profitAfterTax) : '—'} | ${hasCosts ? margin : '—'} | ${split} | ${hasCosts ? vnd(c.lgP) : '—'} | ${hasCosts ? vnd(c.cnP) : '—'} |`);
    }
    L.push('');

    // Chi tiết doanh thu & chi phí từng tháng (chỉ tháng có PnL)
    const monthsWithPnl = months.filter(m => pnlCalc.has(m));
    if (monthsWithPnl.length) {
      L.push('### Chi tiết doanh thu & chi phí từng tháng');
      L.push('');
      for (const m of monthsWithPnl) {
        const c = pnlCalc.get(m)!;
        L.push(`#### ${monthLabel(m)}`);
        L.push('');
        const revs = revsByPnl.get(c.pnl.id) || [];
        if (revs.length) {
          L.push('| Dòng doanh thu | Số tiền | Ngày hóa đơn | Ngày công |');
          L.push('|---|---|---|---|');
          for (const r of revs) L.push(`| ${r.label}${r.period_label ? ` (${r.period_label})` : ''} | ${vnd(r.amount)} | ${r.invoice_date || '—'} | ${r.man_days || '—'} |`);
        } else {
          L.push(`- Doanh thu (tổng): ${vnd(c.pnl.revenue)} — chưa tách dòng chi tiết.`);
        }
        L.push('');
        const costs = costsByPnl.get(c.pnl.id) || [];
        if (costs.length) {
          L.push('| Khoản chi phí | Số tiền | Bên chịu |');
          L.push('|---|---|---|');
          for (const co of costs) L.push(`| ${co.label}${co.period_label ? ` (${co.period_label})` : ''} | ${vnd(co.value)} | ${co.payer === 'lg' ? 'LetsGo' : co.payer === 'cn' ? 'Chi nhánh' : 'Chia chung'} |`);
        } else {
          L.push(`- ${MISSING}: tháng này chưa nhập khoản chi phí nào.`);
        }
        L.push('');
      }
    }
  }

  // ── 5. Thanh toán ──
  if (opts.sections.payment) {
    L.push('## 5. Lịch sử thanh toán & công nợ');
    L.push('');
    L.push('| Tháng | Doanh thu ghi nhận | Hạn thanh toán dự kiến | Ngày thanh toán thực tế | Chênh lệch (ngày) | Trạng thái |');
    L.push('|---|---|---|---|---|---|');
    const diffs: number[] = [];
    for (const m of months) {
      const f = finByMonth.get(m);
      if (!f) {
        L.push(`| ${monthLabel(m)} | ${MISSING} | — | — | — | — |`);
        continue;
      }
      const [y, mo] = m.split('-').map(Number);
      const invDay = resolveDay(client.invoice_day, new Date(y, mo, 0).getDate());
      const invDate = invDay ? new Date(y, mo - 1, invDay) : null;
      const due = invDate ? calcExpectedDue(client, invDate)?.date ?? null : null;
      let diff: number | null = null;
      if (due && f.paid_date) {
        const paid = new Date(f.paid_date); paid.setHours(0, 0, 0, 0);
        const d2 = new Date(due); d2.setHours(0, 0, 0, 0);
        diff = Math.round((paid.getTime() - d2.getTime()) / 86400000);
        diffs.push(diff);
      }
      const dueStr = due ? `${String(due.getDate()).padStart(2, '0')}/${String(due.getMonth() + 1).padStart(2, '0')}/${due.getFullYear()}` : '—';
      L.push(`| ${monthLabel(m)} | ${vnd(f.revenue)} | ${dueStr} | ${f.paid_date ? f.paid_date.slice(0, 10) : (f.paid_status ? 'đã TT (chưa ghi ngày)' : '—')} | ${diff != null ? (diff > 0 ? `+${diff} (trễ)` : `${diff} (sớm/đúng hạn)`) : '—'} | ${f.paid_status ? 'Đã thanh toán' : 'CHƯA thanh toán'} |`);
    }
    L.push('');
    if (diffs.length) {
      const avg = Math.round(diffs.reduce((s, d) => s + d, 0) / diffs.length);
      const late = diffs.filter(d => d > 0).length;
      L.push(`**Hành vi thanh toán:** trung bình ${avg > 0 ? `trễ ${avg} ngày` : avg < 0 ? `sớm ${-avg} ngày` : 'đúng hạn'}; đúng hạn ${diffs.length - late}/${diffs.length} kỳ, trễ ${late}/${diffs.length} kỳ, trễ nhiều nhất ${Math.max(...diffs, 0)} ngày.`);
      L.push('');
    }
  }

  // ── 6. CRM & lịch sử khác ──
  if (opts.sections.crm) {
    L.push('## 6. CRM & lịch sử quan hệ');
    L.push('');
    if (!raw.managerHistory.length && !raw.branchHistory.length && !raw.deals.length && !raw.gifts.length) {
      L.push(`${MISSING}: hệ thống chưa ghi nhận thương vụ, quà tặng hay lịch sử bàn giao nào cho khách hàng này.`);
      L.push('');
    }
    if (raw.managerHistory.length) {
      L.push('### Lịch sử bàn giao quản lý');
      L.push('');
      for (const h of raw.managerHistory) L.push(`- Từ ${monthLabel(h.effective_from)}: ${h.manager_name}`);
      L.push('');
    }
    if (raw.branchHistory.length) {
      L.push('### Lịch sử chuyển chi nhánh');
      L.push('');
      for (const h of raw.branchHistory) L.push(`- Từ ${monthLabel(h.effective_from)}: ${h.branch_name}${h.notes ? ` — ${h.notes}` : ''}`);
      L.push('');
    }
    if (raw.deals.length) {
      L.push('### Thương vụ (CRM Deals)');
      L.push('');
      L.push('| Thương vụ | Giai đoạn | Giá trị | Phụ trách | Ngày tạo |');
      L.push('|---|---|---|---|---|');
      const stageLabels: Record<string, string> = { new: 'Mới', contacted: 'Đã liên hệ', in_progress: 'Đang xử lý', proposal: 'Báo giá', won: 'Thắng', lost: 'Thua' };
      for (const d of raw.deals) L.push(`| ${d.title} | ${stageLabels[d.stage] || d.stage} | ${d.value ? vnd(d.value) : '—'} | ${d.owner || '—'} | ${d.created_at.slice(0, 10)} |`);
      L.push('');
      const acts = raw.activities.slice(-30);
      if (acts.length) {
        L.push(`### Hoạt động chăm sóc gần nhất (${acts.length} mục cuối)`);
        L.push('');
        const typeLabels: Record<string, string> = { note: 'Ghi chú', call: 'Cuộc gọi', email: 'Email', meeting: 'Họp' };
        for (const a of acts) L.push(`- ${a.created_at.slice(0, 10)} · ${typeLabels[a.type] || a.type}${a.created_by ? ` (${a.created_by})` : ''}: ${(a.content || '').replace(/\n/g, ' ')}`);
        L.push('');
      }
    }
    if (raw.gifts.length) {
      L.push('### Quà tặng đã gửi');
      L.push('');
      for (const g of raw.gifts) L.push(`- ${g.gift_date}: ${g.item_name}${g.value ? ` (${vnd(g.value)})` : ''}${g.recipient_name ? ` → ${g.recipient_name}` : ''}${g.notes ? ` — ${g.notes}` : ''}`);
      L.push('');
    }
  }

  // ── 7. Gợi ý sử dụng ──
  L.push('---');
  L.push('');
  L.push('## Gợi ý prompt khi đưa file này vào AI');
  L.push('');
  L.push('> "Dựa trên báo cáo khách hàng đính kèm, hãy tạo dàn ý slide báo cáo tình hình hợp tác gồm: tổng quan khách hàng, biến động lao động, kết quả tài chính theo tháng, hành vi thanh toán, rủi ro & đề xuất. Tuân thủ phần *Hướng dẫn cho AI* ở mục 1: loại các tháng đánh dấu ⚠ chưa nhập khỏi mọi phép tính."');
  L.push('');
  L.push(`_File được xuất tự động từ hệ thống LetsGo vào ${exportDate}. Số liệu phản ánh đúng những gì đã nhập trên hệ thống tại thời điểm xuất._`);
  L.push('');

  const slug = client.name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '');
  const filename = `BaoCao_${slug}_${opts.fromMonth}_${opts.toMonth}.md`;

  return { markdown: L.join('\n'), filename, completenessPct, completeness };
}

// Tải file .md về máy (client-side, không đụng gì tới dữ liệu).
export function downloadMarkdown(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
