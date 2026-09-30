import { supabase } from './supabase';

export type CostKind = 'tet' | 'commission';
export interface CostRule { id: string; client_id: string; kind: CostKind; rate: number; effective_from: string; created_at: string }

export const COST_KIND_LABEL: Record<CostKind, string> = { tet: 'Quỹ tết / lì xì', commission: 'Hoa hồng khách hàng' };
export const DEFAULT_TET_RATE = 500;
export const rateColumn = (k: CostKind) => (k === 'tet' ? 'tet_rate' : 'commission_rate') as 'tet_rate' | 'commission_rate';

/** Đọc mốc đơn giá của 1 khách (không có bảng/migration → trả []). */
export async function fetchCostRules(clientId: string): Promise<CostRule[]> {
  const { data, error } = await supabase.from('client_branch_cost_rules').select('*').eq('client_id', clientId).order('effective_from', { ascending: false });
  return error ? [] : ((data ?? []) as CostRule[]);
}

/** Đơn giá áp dụng cho `month` = mốc mới nhất có effective_from <= month; chưa có mốc nào → null. */
export function resolveRuleRate(rules: CostRule[], kind: CostKind, month: string): number | null {
  const hit = rules.filter(r => r.kind === kind && r.effective_from <= month).sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0];
  return hit ? Number(hit.rate) : null;
}

type PnlRateRow = { id: string; month: string; tet_rate: number | null; commission_rate: number | null };

/** Các tháng P&L (từ `fromMonth` trở đi) sẽ đổi đơn giá theo bộ mốc `rules`. */
export async function planRuleApply(clientId: string, kind: CostKind, fromMonth: string, rules: CostRule[]) {
  const col = rateColumn(kind);
  const { data } = await supabase.from('projects_pnl').select(`id, month, ${col}`).eq('client_id', clientId).gte('month', fromMonth);
  const rows = (data ?? []) as unknown as PnlRateRow[];
  const changes = rows
    .map(r => ({ id: r.id, month: r.month, from: r[col], to: resolveRuleRate(rules, kind, r.month) }))
    .filter(c => c.to !== null && c.from !== c.to);
  return changes;
}

export async function applyRuleChanges(kind: CostKind, changes: { id: string; to: number | null }[]) {
  const col = rateColumn(kind);
  let failed = 0;
  for (const c of changes) {
    const { error } = await supabase.from('projects_pnl').update({ [col]: c.to, updated_at: new Date().toISOString() }).eq('id', c.id);
    if (error) failed++;
  }
  return failed;
}
