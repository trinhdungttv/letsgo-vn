// Truy cập bảng bds_* qua client Supabase dùng chung của app.
// Mọi request gắn header `x-letsgo-token` → RLS (bds_is_admin) chỉ mở cho admin.
import { supabase } from '../../../lib/supabase';
import type { BdsTables, CellTable, IdTable, TableName } from '../lib/types';

const TOKEN_HEADER = 'x-letsgo-token';
let token = '';

export function setBdsToken(t: string | null | undefined) {
  token = t || '';
}

interface HasHeader<B> { setHeader(name: string, value: string): B }
function auth<B extends HasHeader<B>>(b: B): B {
  return b.setHeader(TOKEN_HEADER, token);
}

export type AccessState = 'ok' | 'no_token' | 'expired' | 'not_admin' | 'not_installed' | 'error';

export async function accessCheck(): Promise<{ state: AccessState; message?: string }> {
  if (!token) return { state: 'no_token' };
  const { data, error } = await auth(supabase.rpc('bds_access_check'));
  if (error) {
    if (error.code === 'PGRST202' || error.code === '42883') return { state: 'not_installed' };
    return { state: 'error', message: errMsg(error) };
  }
  const s = String(data);
  return { state: (['ok', 'no_token', 'expired', 'not_admin'].includes(s) ? s : 'error') as AccessState };
}

const NUMERIC_KEYS = new Set([
  'exchange_rate', 'vat_rate_rent', 'vat_rate_util', 'parking_price_moto', 'parking_price_car', 'range_months',
  'base_price', 'percent', 'area_m2', 'amount', 'electricity_amount', 'motorbike_count', 'car_count',
  'target_cost', 'extra_cost', 'parent_area_m2', 'price', 'sort_order', 'electricity_unit_price', 'invoice_due_day',
  'alert_days', 'deposit_amount', 'list_price', 'prev_reading', 'curr_reading', 'unit_price', 'paid_amount',
  'ticket_no', 'step_done', 'estimated_cost', 'actual_cost', 'cost', 'step',
]);

/** numeric của Postgres có thể về dạng chuỗi → ép về number để engine tính đúng. */
function normalize<T>(row: Record<string, unknown>): T {
  const out: Record<string, unknown> = { ...row };
  for (const k of Object.keys(out)) {
    const v = out[k];
    if (NUMERIC_KEYS.has(k) && typeof v === 'string' && v.trim() !== '') out[k] = Number(v);
  }
  return out as T;
}

export async function fetchAll<T extends TableName>(table: T): Promise<BdsTables[T][]> {
  const out: BdsTables[T][] = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await auth(supabase.from(table).select('*').range(from, from + page - 1));
    if (error) throw error;
    const rows = (data || []) as Record<string, unknown>[];
    out.push(...rows.map(r => normalize<BdsTables[T]>(r)));
    if (rows.length < page) break;
  }
  return out;
}

export async function insertRow<T extends IdTable>(table: T, row: Partial<BdsTables[T]>): Promise<BdsTables[T]> {
  const { data, error } = await auth(supabase.from(table).insert(row as never).select().single());
  if (error) throw error;
  return normalize<BdsTables[T]>(data as Record<string, unknown>);
}

export async function insertRows<T extends IdTable>(table: T, rows: Partial<BdsTables[T]>[]): Promise<BdsTables[T][]> {
  if (!rows.length) return [];
  const { data, error } = await auth(supabase.from(table).insert(rows as never).select());
  if (error) throw error;
  return ((data || []) as Record<string, unknown>[]).map(r => normalize<BdsTables[T]>(r));
}

export async function updateRow<T extends IdTable>(table: T, id: string | number, patch: Partial<BdsTables[T]>): Promise<void> {
  const { data, error } = await auth(supabase.from(table).update(patch as never).eq('id', id).select('id'));
  if (error) throw error;
  if (!data || !data.length) throw { code: 'PGRST116', message: 'Không có dòng nào được cập nhật' };
}

export async function deleteRow(table: IdTable, id: string): Promise<void> {
  const { error } = await auth(supabase.from(table).delete().eq('id', id));
  if (error) throw error;
}

export async function deleteWhere(table: TableName, column: string, value: string): Promise<void> {
  const { error } = await auth(supabase.from(table).delete().eq(column, value));
  if (error) throw error;
}

const CELL_KEYS: Record<CellTable, [string, string]> = {
  bds_tenant_rent: ['tenant_id', 'month'],
  bds_tenant_fees: ['tenant_id', 'month'],
  bds_opex_monthly: ['category_id', 'month'],
};

export async function upsertCells<T extends CellTable>(table: T, rows: BdsTables[T][]): Promise<void> {
  if (!rows.length) return;
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await auth(
      supabase.from(table).upsert(rows.slice(i, i + 500) as never, { onConflict: CELL_KEYS[table].join(',') }),
    );
    if (error) throw error;
  }
}

export async function deleteCell(table: CellTable, owner: string, month: string): Promise<void> {
  const [ownerCol] = CELL_KEYS[table];
  const { error } = await auth(supabase.from(table).delete().eq(ownerCol, owner).eq('month', month));
  if (error) throw error;
}

export async function deleteAll(table: TableName): Promise<void> {
  // PostgREST bắt buộc có điều kiện cho DELETE → dùng cột luôn có giá trị.
  const col = table === 'bds_tenant_rent' || table === 'bds_tenant_fees' || table === 'bds_opex_monthly' ? 'month' : 'id';
  const { error } = await auth(supabase.from(table).delete().not(col, 'is', null));
  if (error) throw error;
}

export function isMissingTable(e: unknown): boolean {
  const code = (e as { code?: string })?.code;
  return code === 'PGRST205' || code === '42P01' || code === 'PGRST204';
}

export function errMsg(e: unknown): string {
  const err = (e || {}) as { code?: string; message?: string; details?: string };
  switch (err.code) {
    case '23505': return 'Tên/mã đã tồn tại — hãy đặt tên khác.';
    case '23514': return 'Giá trị không hợp lệ (âm hoặc ngoài khoảng cho phép).';
    case '23503': return 'Dữ liệu liên quan không còn tồn tại — hãy tải lại trang.';
    case '42501': return 'Không có quyền ghi — phiên đăng nhập có thể đã hết hạn. Hãy đăng xuất rồi đăng nhập lại.';
    case 'PGRST116': return 'Không lưu được (dòng không còn, hoặc phiên đăng nhập đã hết hạn).';
    case 'PGRST205':
    case '42P01': return 'Chưa có bảng dữ liệu — cần chạy migration trên Supabase.';
  }
  const msg = err.message || '';
  if (/Failed to fetch|NetworkError|Load failed|network/i.test(msg)) return 'Mất kết nối mạng — chưa lưu được, bấm Thử lại.';
  return msg || 'Lỗi không xác định';
}
