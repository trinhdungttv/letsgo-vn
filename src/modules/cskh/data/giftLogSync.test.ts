// "Ghi quà" riêng ở Sự kiện & Quà tặng ↔ dòng nhật ký "Quà tặng" cùng dấu created_at (Supabase giả).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeContact, makeGift, makeInteraction } from '../../../lib/cskh/testFixtures';
import type { AppUser, Client } from '../../../lib/types';

interface Call { table: string; op: string; payload?: unknown; filters: string[] }
const calls: Call[] = [];
const failOn = new Set<string>(); // "bảng:thao tác" trả lỗi

function builder(table: string) {
  const call: Call = { table, op: 'select', filters: [] };
  const result = () => (failOn.has(`${table}:${call.op}`)
    ? { data: null, error: { message: 'lỗi giả' } }
    : { data: { id: `${table}-new` }, error: null });
  const b: Record<string, unknown> = {
    insert: (p: unknown) => { call.op = 'insert'; call.payload = p; calls.push(call); return b; },
    update: (p: unknown) => { call.op = 'update'; call.payload = p; calls.push(call); return b; },
    delete: () => { call.op = 'delete'; calls.push(call); return b; },
    select: () => b,
    eq: (k: string, v: unknown) => { call.filters.push(`${k}=${v}`); return b; },
    in: (k: string, v: unknown[]) => { call.filters.push(`${k} in ${v.join(',')}`); return b; },
    neq: (k: string, v: unknown) => { call.filters.push(`${k}!=${v}`); return b; },
    single: () => Promise.resolve(result()),
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(result()).then(res, rej),
  };
  return b;
}
vi.mock('../../../lib/supabase', () => ({ supabase: { from: (t: string) => builder(t) } }));
vi.mock('../../../lib/audit', () => ({ logActivity: vi.fn() }));

const { archiveGift, saveGift } = await import('./api');
const { todayVN } = await import('../../../lib/cskh/dates');

const user = { id: 'u1', username: 'demo', full_name: 'Tony', role: 'admin' } as AppUser;
const clients = [{ id: 'k1', name: 'AMPACS' }, { id: 'k2', name: 'MIDEA' }] as Client[];
const ctx = { user, clients, branches: [] };
const contact = makeContact({ id: 'c1', fullName: 'Mr Nhiên', clientIds: ['k1', 'k2'], organization: 'AMPACS' });
const T = '2026-10-20T03:12:45.123Z';
const of = (table: string, op: string) => calls.filter(c => c.table === table && c.op === op);

const input = {
  contact, clientId: 'k1', direction: 'given' as const, item: 'Giỏ trái cây', estimatedValue: 500000,
  givenAt: '2026-10-20', occasionId: null, note: 'Chúc mừng trung thu',
};
const gift = makeGift('c1', { id: 'g1', clientId: 'k1', createdAt: T, item: 'Bánh cũ', givenAt: '2026-10-18' });
const linked = makeInteraction('c1', { id: 'l1', type: 'gift', createdAt: T, occurredAt: '2026-10-18' });

beforeEach(() => { calls.length = 0; failOn.clear(); });

describe('ghi quà riêng → kèm dòng Nhật ký', () => {
  it('ghi quà trước, rồi dòng nhật ký "Quà tặng" cùng dấu created_at, ghi chú dùng chung', async () => {
    await saveGift(input, null, ctx);
    const [g] = of('client_gifts', 'insert');
    const [l] = of('cskh_logs', 'insert');
    expect(g.payload).toMatchObject({ client_id: 'k1', recipient_contact_id: 'c1', item_name: 'Giỏ trái cây', value: 500000, notes: 'Chúc mừng trung thu', created_by: 'Tony' });
    expect(l.payload).toMatchObject({
      contact_id: 'c1', contact_person: 'Mr Nhiên', client_id: 'k1', client_name: 'AMPACS', contact_type: 'gift', channel: '',
      initiated_by: 'me', content: 'Chúc mừng trung thu', log_date: '2026-10-20', followup: null, created_by: 'u1', created_by_name: 'Tony',
    });
    const stamp = (g.payload as { created_at: string }).created_at;
    expect(stamp).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect((l.payload as { created_at: string }).created_at).toBe(stamp);
    expect(calls.findIndex(c => c.table === 'client_gifts')).toBeLessThan(calls.findIndex(c => c.table === 'cskh_logs'));
  });

  it('họ tặng mình → họ chủ động; công ty ghi theo công ty đã chọn; không ghi chú → nội dung null', async () => {
    await saveGift({ ...input, direction: 'received', clientId: 'k2', note: ' ' }, null, ctx);
    expect(of('cskh_logs', 'insert')[0].payload).toMatchObject({ initiated_by: 'them', client_id: 'k2', client_name: 'MIDEA', content: null });
  });

  it('ngày tặng ở tương lai → báo lỗi, không ghi gì (dòng nhật ký làm ngày liên hệ lần cuối nhảy sang tương lai)', async () => {
    const future = new Date(Date.now() + 5 * 86400000);
    await expect(saveGift({ ...input, givenAt: todayVN(future) }, null, ctx)).rejects.toThrow('không được ở tương lai');
    expect(calls).toHaveLength(0);
  });

  it('ghi nhật ký lỗi → gỡ món quà vừa ghi, không để quà mồ côi', async () => {
    failOn.add('cskh_logs:insert');
    await expect(saveGift(input, null, ctx)).rejects.toThrow('lỗi giả');
    const undo = of('client_gifts', 'update')[0];
    expect(undo.payload).toEqual({ is_archived: true });
    expect(undo.filters).toContain('id=client_gifts-new');
  });

  it('ghi quà lỗi → không ghi nhật ký', async () => {
    failOn.add('client_gifts:insert');
    await expect(saveGift(input, null, ctx)).rejects.toThrow('lỗi giả');
    expect(of('cskh_logs', 'insert')).toHaveLength(0);
  });
});

describe('sửa quà → dòng nhật ký đi theo', () => {
  it('có dòng nhật ký đi kèm → đổi ngày / ghi chú / công ty của dòng đó; không tạo dòng mới', async () => {
    await saveGift({ ...input, clientId: 'k2' }, gift, ctx, [linked]);
    expect(of('client_gifts', 'update')[0].payload).toMatchObject({ item_name: 'Giỏ trái cây', client_id: 'k2' });
    const upd = of('cskh_logs', 'update')[0];
    expect(upd.payload).toEqual({
      contact_id: 'c1', contact_person: 'Mr Nhiên', client_id: 'k2', client_name: 'MIDEA', log_date: '2026-10-20', content: 'Chúc mừng trung thu',
    });
    expect(upd.filters).toEqual(['id=l1']);
    expect(of('cskh_logs', 'insert')).toHaveLength(0);
  });

  it('đổi người nhận → dòng nhật ký đổi sang người đó (vẫn cùng dấu nên vẫn nối được)', async () => {
    const other = makeContact({ id: 'c9', fullName: 'Ms Hoa', clientIds: ['k1'] });
    await saveGift({ ...input, contact: other }, gift, ctx, [linked]);
    expect(of('client_gifts', 'update')[0].payload).toMatchObject({ recipient_contact_id: 'c9' });
    expect(of('cskh_logs', 'update')[0].payload).toMatchObject({ contact_id: 'c9', contact_person: 'Ms Hoa' });
  });

  it('quà ghi từ trước (chưa có dòng nhật ký) → chỉ sửa quà, không tự bổ sung nhật ký', async () => {
    await saveGift(input, gift, ctx, []);
    expect(of('client_gifts', 'update')).toHaveLength(1);
    expect(calls.filter(c => c.table === 'cskh_logs')).toHaveLength(0);
  });

  it('dòng cùng dấu nhưng hình thức khác "Quà tặng" (đợt đã đổi sang Chúc mừng) → không đụng', async () => {
    await saveGift(input, gift, ctx, [{ ...linked, type: 'message' }]);
    expect(calls.filter(c => c.table === 'cskh_logs')).toHaveLength(0);
  });

  it('quà cũ có ngày tương lai vẫn sửa được món / ghi chú khi không đổi ngày; đổi sang ngày tương lai khác thì chặn', async () => {
    const future = todayVN(new Date(Date.now() + 9 * 86400000));
    const old = makeGift('c1', { id: 'g2', createdAt: T, givenAt: future });
    await saveGift({ ...input, givenAt: future }, old, ctx, []);
    expect(of('client_gifts', 'update')).toHaveLength(1);
    await expect(saveGift({ ...input, givenAt: todayVN(new Date(Date.now() + 12 * 86400000)) }, old, ctx, [])).rejects.toThrow('không được ở tương lai');
  });

  it('sửa dòng nhật ký lỗi → báo rõ quà đã sửa nhưng nhật ký chưa', async () => {
    failOn.add('cskh_logs:update');
    await expect(saveGift(input, gift, ctx, [linked])).rejects.toThrow('Đã sửa món quà nhưng chưa sửa được dòng nhật ký');
  });
});

describe('xoá quà → dòng nhật ký đi theo', () => {
  it('xoá mềm quà + dòng "Quà tặng" ghi kèm; dòng khác không đụng', async () => {
    const other = makeInteraction('c1', { id: 'l2', type: 'call', createdAt: '2026-10-19T00:00:00.000Z' });
    await archiveGift(gift, user, [linked, other]);
    expect(of('client_gifts', 'update')[0]).toMatchObject({ payload: { is_archived: true }, filters: ['id=g1'] });
    const logs = of('cskh_logs', 'update');
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ payload: { is_archived: true }, filters: ['id=l1'] });
  });

  it('dòng đi kèm còn việc đã hứa chưa xong → việc trong Workspace cũng xoá mềm', async () => {
    await archiveGift(gift, user, [{ ...linked, followUpAction: 'Gọi hỏi thăm', followUpTaskId: 't1' }]);
    const t = of('work_tasks', 'update')[0];
    expect(t.payload).toHaveProperty('deleted_at');
    expect(t.filters).toContain('id=t1');
  });

  it('quà ghi từ trước (chưa có dòng nhật ký) → chỉ xoá quà', async () => {
    await archiveGift(gift, user, []);
    expect(calls.filter(c => c.table === 'cskh_logs')).toHaveLength(0);
  });

  it('xoá dòng nhật ký lỗi → báo rõ quà đã xoá nhưng nhật ký chưa', async () => {
    failOn.add('cskh_logs:update');
    await expect(archiveGift(gift, user, [linked])).rejects.toThrow('Đã xoá món quà nhưng chưa xoá được dòng nhật ký đi kèm');
  });
});
