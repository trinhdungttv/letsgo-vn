// Tải dữ liệu cho báo cáo tổng quan lao động — CHỈ ĐỌC (SELECT), không ghi gì vào DB.
// Tự tải đủ toàn bộ khách hàng (kể cả KH đã ngưng hợp tác) thay vì dùng `clients` của App,
// vì số đã nhập của KH ngưng vẫn là lịch sử thật của các tuần/tháng trước.
import { supabase } from '../supabase';
import type { Branch } from '../types';
import type { LrBranchHistory, LrClient, LrInput, LrLaborEntry, LrZone } from './model';

const PAGE = 1000;

async function selectAll<T>(table: string, columns: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from(table).select(columns).range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

export async function fetchLaborReportInput(): Promise<LrInput> {
  const [clientsRaw, labor, branches, zones, branchHistory] = await Promise.all([
    selectAll<LrClient & { client_type: string | null; archived_at: string | null }>(
      'clients',
      'id, name, branch_id, region, industrial_zones, min_workers, service_type, cooperation_status, suspended_from, suspended_at, client_type, archived_at',
    ),
    selectAll<LrLaborEntry>('client_labor_history', 'client_id, week_label, count, created_at'),
    selectAll<Branch>('branches', '*'),
    selectAll<LrZone>('market_zones', 'name, location'),
    // Bảng lịch sử chuyển chi nhánh có thể chưa có ở DB cũ → coi như chưa ai chuyển.
    selectAll<LrBranchHistory>('client_branch_history', 'client_id, branch_id, branch_name, effective_from').catch(() => [] as LrBranchHistory[]),
  ]);
  // Cùng phạm vi với trang Khách hàng / Báo cáo: khách đang làm (client_type active), bỏ KH đã xoá (archived).
  const clients = clientsRaw.filter(c => (c.client_type ?? 'active') === 'active' && !c.archived_at);
  return { clients, labor, branches, zones, branchHistory, now: new Date() };
}
