// Ghi cho nhóm / sửa đợt / đặt giới tính / lớp lùi khi chưa chạy migration 174 (Supabase giả).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { groupBatches, type InteractionBatch } from '../../../lib/cskh/groupLog';
import { makeContact, makeGift, makeInteraction } from '../../../lib/cskh/testFixtures';
import type { AppUser, Client } from '../../../lib/types';

interface Call { table: string; op: string; payload?: unknown; filters: string[] }
const calls: Call[] = [];
/** "bảng:thao tác" → lỗi trả về (lần đầu). */
const failOnce = new Map<string, { message: string; code?: string }>();

function builder(table: string) {
  const call: Call = { table, op: 'select', filters: [] };
  const result = () => {
    const k = `${table}:${call.op}`;
    const err = failOnce.get(k);
    if (err) { failOnce.delete(k); return { data: null, error: err }; }
    return { data: { id: 'row' }, error: null };
  };
  const b: Record<string, unknown> = {
    insert: (p: unknown) => { call.op = 'insert'; call.payload = p; calls.push(call); return b; },
    update: (p: unknown) => { call.op = 'update'; call.payload = p; calls.push(call); return b; },
    delete: () => { call.op = 'delete'; calls.push(call); return b; },
    select: () => b,
    eq: (k: string, v: unknown) => { call.filters.push(`${k}=${v}`); return b; },
    in: (k: string, v: unknown[]) => { call.filters.push(`${k} in ${v.length}`); return b; },
    single: () => Promise.resolve(result()),
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(result()).then(res, rej),
  };
  return b;
}
vi.mock('../../../lib/supabase', () => ({ supabase: { from: (t: string) => builder(t) } }));
vi.mock('../../../lib/audit', () => ({ logActivity: vi.fn() }));

const { applyBatchEdit, archiveBatch, saveGroupLog, setGender, MIGRATION_174_HINT } = await import('./api');

const admin = { id: 'u1', username: 'a', full_name: 'Admin', role: 'admin' } as AppUser;
const staff = { id: 'u2', username: 's', full_name: 'Sale', role: 'kinhdoanh' } as AppUser;
const clients = [{ id: 'k1', name: 'Midea' }] as Client[];
const people = Array.from({ length: 250 }, (_, i) => makeContact({ id: `c${i}`, fullName: `Ms ${i}`, clientIds: i % 50 === 0 ? [] : ['k1'] }));
const of = (table: string, op: string) => calls.filter(c => c.table === table && c.op === op);

beforeEach(() => { calls.length = 0; failOnce.clear(); });

describe('ghi cho nhóm', () => {
  it('gửi theo lô 200 dòng, mọi lô chung 1 dấu đợt; người chưa gắn công ty không có dòng quà', async () => {
    const r = await saveGroupLog({
      contactIds: people.map(p => p.id), type: 'gift', occurredAt: '2026-10-20', content: 'Tặng hoa 20/10',
      gift: { item: 'Hoa', estimatedValue: 300000 },
    }, people, { user: staff, clients, branches: [] });
    const logs = of('cskh_logs', 'insert');
    expect(logs.map(l => (l.payload as unknown[]).length)).toEqual([200, 50]);
    const stamps = new Set(logs.flatMap(l => (l.payload as { created_at: string }[]).map(x => x.created_at)));
    expect(stamps.size).toBe(1);
    expect(r).toEqual({ logs: 250, gifts: 245, noGiftNames: ['Ms 0', 'Ms 50', 'Ms 100', 'Ms 150', 'Ms 200'] });
    const gifts = of('client_gifts', 'insert').flatMap(g => g.payload as { created_at: string }[]);
    expect(new Set(gifts.map(g => g.created_at))).toEqual(stamps);
  });

  it('chưa đăng nhập / chưa chọn ai → báo lỗi, không ghi', async () => {
    await expect(saveGroupLog({ contactIds: ['c1'], type: 'message', occurredAt: '2026-10-20', content: 'x', gift: null }, people, { user: null, clients, branches: [] }))
      .rejects.toThrow('Chưa đăng nhập');
    await expect(saveGroupLog({ contactIds: [], type: 'message', occurredAt: '2026-10-20', content: 'x', gift: null }, people, { user: staff, clients, branches: [] }))
      .rejects.toThrow('Chưa chọn ai');
    expect(calls).toHaveLength(0);
  });
});

describe('sửa / xoá đợt', () => {
  const STAMP = '2026-10-24T08:00:00.123Z';
  const entry = groupBatches([
    makeInteraction('c1', { id: 'l1', type: 'gift', content: 'Tặng hoa', createdAt: STAMP, createdBy: 'u2', createdByName: 'Sale' }),
    makeInteraction('c2', { id: 'l2', type: 'gift', content: 'Tặng hoa', createdAt: STAMP, createdBy: 'u2', createdByName: 'Sale' }),
  ])[0];
  const batch = (entry.kind === 'batch' ? entry.batch : null) as InteractionBatch;
  const gifts = [makeGift('c1', { id: 'g1', createdAt: STAMP }), makeGift('c2', { id: 'g2', createdAt: STAMP })];
  const other = { ...staff, id: 'u3' };

  it('người khác (không phải người tạo, không admin) → chặn', async () => {
    await expect(applyBatchEdit(batch, gifts, { type: 'gift', content: 'x', occurredAt: '2026-10-20', removeContactIds: [], addContactIds: [] }, people, { user: other, clients, branches: [] }))
      .rejects.toThrow('người tạo đợt hoặc admin');
    await expect(archiveBatch(batch, gifts, other)).rejects.toThrow('người tạo đợt hoặc admin');
    expect(calls).toHaveLength(0);
  });

  it('bỏ người = xoá mềm nhật ký + quà của họ; đổi ngày cho người còn lại', async () => {
    await applyBatchEdit(batch, gifts, { type: 'gift', content: 'Tặng hoa', occurredAt: '2026-10-20', removeContactIds: ['c2'], addContactIds: [] }, people, { user: admin, clients, branches: [] });
    expect(of('cskh_logs', 'update').map(c => c.payload)).toEqual([
      { contact_type: 'gift', content: 'Tặng hoa', log_date: '2026-10-20' },
      { is_archived: true },
    ]);
    expect(of('client_gifts', 'update').map(c => c.payload)).toEqual([{ gift_date: '2026-10-20', notes: 'Tặng hoa' }, { is_archived: true }]);
    expect(of('cskh_logs', 'delete')).toHaveLength(0); // không xoá cứng
  });

  it('xoá cả đợt = xoá mềm (người tạo đợt được phép)', async () => {
    await archiveBatch(batch, gifts, staff);
    expect(of('cskh_logs', 'update')[0].payload).toEqual({ is_archived: true });
    expect(of('client_gifts', 'update')[0].payload).toEqual({ is_archived: true });
  });
});

describe('giới tính hàng loạt', () => {
  it('chưa chạy migration 174 → câu nhắc chạy migration', async () => {
    failOnce.set('contacts:update', { message: "Could not find the 'gender' column of 'contacts' in the schema cache", code: 'PGRST204' });
    await expect(setGender(['c1'], 'female', admin)).rejects.toThrow(MIGRATION_174_HINT);
  });
});
