// Gọi các RPC "an toàn dữ liệu" của migration 218: cảnh báo bất thường, khôi phục theo đợt, tổng hợp nhập liệu.
// Mọi hàm cần token admin (riêng activitySummary: admin hoặc Ban Điều Hành). Chưa chạy migration → notInstalled.
import { supabase } from './supabase';
import type { DataHistoryEntry } from './types';

export type AlertKind = 'mass_delete' | 'mass_update';
export type AlertStatus = 'open' | 'dismissed' | 'restored';

export interface DataAlert {
  id: number;
  kind: AlertKind;
  severity: 'warn' | 'high';
  actor_id: string;
  actor_name: string | null;
  actor_role: string | null;
  started_at: string;
  ended_at: string;
  tx_id: number | null;
  total: number;
  tables: Record<string, number>;
  status: AlertStatus;
  restored_until: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  note: string | null;
  created_at: string;
}

export interface GuardSettings {
  delete_threshold: number;
  update_threshold: number;
  window_minutes: number;
  core_tables: string[];
}

export type RevertPlan = 'restore' | 'reinsert' | 'remove' | 'noop' | 'conflict' | 'skip';
export interface RevertRow {
  table_name: string;
  record_id: string;
  plan: RevertPlan;
  status: 'preview' | 'done' | 'error';
  detail: string | null;
}

export interface ActivityRow {
  actor_id: string;
  actor_name: string | null;
  actor_role: string | null;
  day: string;
  table_name: string;
  action: 'INSERT' | 'UPDATE' | 'DELETE';
  n: number;
}

export class NotInstalledError extends Error {
  constructor() { super('Chưa chạy migration 218 (an toàn dữ liệu theo người dùng)'); }
}

/** Lỗi "chưa có hàm / bảng / cột" → chưa chạy migration 218. */
export function isNotInstalled(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  return ['PGRST202', 'PGRST204', 'PGRST205', '42883', '42P01', '42703'].includes(err.code ?? '')
    || /Could not find the (function|table)|does not exist/i.test(err.message ?? '');
}

function fail(error: { code?: string; message: string }): never {
  if (isNotInstalled(error)) throw new NotInstalledError();
  throw new Error(error.message);
}

export async function scanAlerts(token: string): Promise<DataAlert[]> {
  const { data, error } = await supabase.rpc('dh_scan_alerts', { p_token: token });
  if (error) fail(error);
  return ((data ?? []) as DataAlert[]).map(a => ({ ...a, tables: a.tables ?? {} }));
}

export async function setAlertStatus(token: string, id: number, status: AlertStatus, note?: string): Promise<void> {
  const { error } = await supabase.rpc('dh_set_alert_status', { p_token: token, p_id: id, p_status: status, p_note: note ?? null });
  if (error) fail(error);
}

export async function getGuardSettings(token: string): Promise<GuardSettings> {
  const { data, error } = await supabase.rpc('dh_guard_settings', { p_token: token });
  if (error) fail(error);
  const row = (Array.isArray(data) ? data[0] : data) as GuardSettings;
  return { ...row, core_tables: row.core_tables ?? [] };
}

export async function saveGuardSettings(token: string, s: GuardSettings): Promise<void> {
  const { error } = await supabase.rpc('dh_save_guard_settings', {
    p_token: token, p_delete: s.delete_threshold, p_update: s.update_threshold, p_window: s.window_minutes, p_core: s.core_tables,
  });
  if (error) fail(error);
}

export async function revertEvents(token: string, ids: number[], apply: boolean, force = false): Promise<RevertRow[]> {
  const { data, error } = await supabase.rpc('dh_revert_events', { p_token: token, p_ids: ids, p_apply: apply, p_force: force });
  if (error) fail(error);
  return (data ?? []) as RevertRow[];
}

export async function activitySummary(token: string, from: Date, to: Date): Promise<ActivityRow[]> {
  const { data, error } = await supabase.rpc('dh_activity_summary', { p_token: token, p_from: from.toISOString(), p_to: to.toISOString() });
  if (error) fail(error);
  return ((data ?? []) as ActivityRow[]).map(r => ({ ...r, n: Number(r.n) }));
}

const HISTORY_COLS = 'id,happened_at,table_name,record_id,action,old_data,new_data,changed_fields,actor_id,actor_name,actor_role,tx_id';
const PAGE = 1000;

/** Các thay đổi của 1 người trong khoảng thời gian (mới → cũ). `actions` lọc loại thao tác, `txId` lọc 1 lần lưu. */
export async function fetchActorEvents(opts: {
  actorId: string; from: string; to: string; actions?: string[]; txId?: number | null; table?: string; limit?: number;
}): Promise<DataHistoryEntry[]> {
  const limit = opts.limit ?? 5000;
  const out: DataHistoryEntry[] = [];
  for (let offset = 0; offset < limit; offset += PAGE) {
    let q = supabase.from('data_history').select(HISTORY_COLS)
      .eq('actor_id', opts.actorId).gte('happened_at', opts.from).lte('happened_at', opts.to)
      .order('id', { ascending: false }).range(offset, Math.min(offset + PAGE, limit) - 1);
    if (opts.actions?.length) q = q.in('action', opts.actions);
    if (opts.txId != null) q = q.eq('tx_id', opts.txId);
    if (opts.table) q = q.eq('table_name', opts.table);
    const { data, error } = await q;
    if (error) fail(error);
    const rows = (data ?? []) as DataHistoryEntry[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

/** Các thay đổi mà 1 cảnh báo nói tới (phần chưa khôi phục). */
export function fetchAlertEvents(alert: DataAlert): Promise<DataHistoryEntry[]> {
  // +1 giây bù sai số làm tròn thời gian giữa Postgres và JS
  const to = new Date(new Date(alert.ended_at).getTime() + 1000).toISOString();
  const restored = alert.restored_until ? Date.parse(alert.restored_until) : NaN;
  const from = restored >= Date.parse(alert.started_at)
    ? new Date(restored + 1).toISOString()
    : alert.started_at;
  return fetchActorEvents({
    actorId: alert.actor_id, from, to,
    actions: alert.kind === 'mass_delete' ? ['DELETE'] : ['UPDATE'],
    txId: alert.kind === 'mass_update' ? alert.tx_id : null,
  });
}

export const PLAN_LABEL: Record<RevertPlan, string> = {
  restore: 'Trả về bản cũ',
  reinsert: 'Chèn lại (đã bị xoá)',
  remove: 'Xoá (do đợt này thêm)',
  noop: 'Không cần làm gì',
  conflict: 'Bỏ qua — đã có người sửa tiếp',
  skip: 'Bỏ qua',
};

/** Tóm tắt kế hoạch khôi phục: số dòng theo từng loại. */
export function summarizePlan(rows: RevertRow[]): Record<RevertPlan, number> {
  const out: Record<RevertPlan, number> = { restore: 0, reinsert: 0, remove: 0, noop: 0, conflict: 0, skip: 0 };
  for (const r of rows) out[r.plan] = (out[r.plan] ?? 0) + 1;
  return out;
}

export const ALERT_KIND_LABEL: Record<AlertKind, string> = {
  mass_delete: 'Xoá nhiều dữ liệu',
  mass_update: 'Sửa hàng loạt',
};
