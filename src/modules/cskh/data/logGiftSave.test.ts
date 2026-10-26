// Ghi / sửa / xoá dòng nhật ký "Quà tặng" kéo theo món quà trong Lịch sử quà (Supabase giả).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeContact, makeGift, makeInteraction } from '../../../lib/cskh/testFixtures';
import type { AppUser, Client } from '../../../lib/types';

interface Call { table: string; op: string; payload?: unknown; filters: string[] }
const calls: Call[] = [];
const failOn = new Set<string>(); // "bảng:thao tác" trả lỗi

function builder(table: string) {
  const call: Call = { table, op: 'select', filters: [] };
  const result = () => {
    if (failOn.has(`${table}:${call.op}`)) return { data: null, error: { message: 'lỗi giả' } };
    if (call.op === 'insert' && table === 'cskh_logs') return { data: { id: 'log-new', ...(call.payload as object) }, error: null };
    if (call.op === 'insert') return { data: { id: `${table}-new` }, error: null };
    return { data: { id: 'row' }, error: null };
  };
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

const { addInteraction, archiveInteraction, logToast, updateInteraction } = await import('./api');

const user = { id: 'u1', username: 'demo', full_name: 'Tony', role: 'admin' } as AppUser;
const clients = [{ id: 'k1', name: 'AMPACS' }] as Client[];
const ctx = { user, clients, branches: [] };
const contact = makeContact({ id: 'c1', fullName: 'Mr Nhiên', clientIds: ['k1'], organization: 'AMPACS', ownerId: 'u1' });
const gift = { direction: 'given' as const, item: 'Hộp bánh trung thu', estimatedValue: 450000, occasionId: null };
const of = (table: string, op: string) => calls.filter(c => c.table === table && c.op === op);
const T = '2026-10-26T03:12:45.123Z';

const baseInput = {
  contact, clientId: 'k1', type: 'gift' as const, channel: '' as const, initiatedBy: 'me' as const,
  occurredAt: '2026-10-20', content: 'Chúc mừng trung thu, tặng bánh', followUpAction: '', followUpDue: null, gift,
};
const baseEdit = {
  clientId: 'k1', type: 'gift' as const, initiatedBy: 'me' as const, occurredAt: '2026-10-21', content: 'Nội dung mới',
  followUpAction: '', followUpDue: null,
};
const logIt = makeInteraction('c1', { id: 'l1', type: 'gift', clientId: 'k1', createdAt: T, content: 'Cũ' });

beforeEach(() => { calls.length = 0; failOn.clear(); });

describe('ghi tương tác "Quà tặng"', () => {
  it('ghi cả món quà vào Lịch sử quà — cùng dấu created_at với dòng nhật ký', async () => {
    await addInteraction(baseInput, ctx);
    const [g] = of('client_gifts', 'insert');
    const [l] = of('cskh_logs', 'insert');
    expect(g.payload).toMatchObject({
      client_id: 'k1', recipient_contact_id: 'c1', recipient_name: 'Mr Nhiên', direction: 'given', item_name: 'Hộp bánh trung thu',
      value: 450000, gift_date: '2026-10-20', notes: 'Chúc mừng trung thu, tặng bánh', created_by: 'Tony',
    });
    const stamp = (g.payload as { created_at: string }).created_at;
    expect(stamp).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect((l.payload as { created_at: string }).created_at).toBe(stamp);
    expect(calls.findIndex(c => c.table === 'client_gifts')).toBeLessThan(calls.findIndex(c => c.table === 'cskh_logs'));
  });

  it('thiếu món quà / chưa gắn công ty → báo lỗi trước khi ghi bất cứ gì', async () => {
    await expect(addInteraction({ ...baseInput, gift: { ...gift, item: '  ' } }, ctx)).rejects.toThrow('Nhập món quà');
    await expect(addInteraction({ ...baseInput, gift: undefined }, ctx)).rejects.toThrow('Nhập món quà');
    await expect(addInteraction({ ...baseInput, clientId: null }, ctx)).rejects.toThrow('chưa gắn công ty');
    expect(calls).toHaveLength(0);
  });

  it('hình thức khác "Quà tặng" thì bỏ qua món quà đính kèm', async () => {
    await addInteraction({ ...baseInput, type: 'call' }, ctx);
    expect(calls.filter(c => c.table === 'client_gifts')).toHaveLength(0);
    expect(of('cskh_logs', 'insert')[0].payload).not.toHaveProperty('created_at');
  });

  it('ghi quà lỗi → không ghi nhật ký', async () => {
    failOn.add('client_gifts:insert');
    await expect(addInteraction(baseInput, ctx)).rejects.toThrow('lỗi giả');
    expect(of('cskh_logs', 'insert')).toHaveLength(0);
  });

  it('ghi nhật ký lỗi → món quà vừa ghi và việc đi kèm bị gỡ, không để mồ côi', async () => {
    failOn.add('cskh_logs:insert');
    await expect(addInteraction({ ...baseInput, followUpAction: 'Gọi hỏi thăm', followUpDue: '2026-10-30' }, ctx)).rejects.toThrow('lỗi giả');
    const undo = of('client_gifts', 'update')[0];
    expect(undo.payload).toEqual({ is_archived: true });
    expect(undo.filters).toContain('id=client_gifts-new');
    expect(of('work_tasks', 'delete')[0].filters).toContain('id=work_tasks-new');
  });

  it('câu báo nói rõ đã ghi món quà / việc', () => {
    expect(logToast({ type: 'gift', gift, followUpAction: '' })).toBe('Đã ghi nhật ký + món quà vào Lịch sử quà');
    expect(logToast({ type: 'gift', gift, followUpAction: 'Gọi lại' })).toBe('Đã ghi nhật ký + món quà vào Lịch sử quà + việc trong Workspace');
    expect(logToast({ type: 'call', followUpAction: '' })).toBe('Đã ghi nhật ký tương tác');
  });
});

describe('sửa dòng "Quà tặng"', () => {
  const existing = makeGift('c1', { id: 'g1', clientId: 'k1', createdAt: T, item: 'Bánh cũ' });

  it('đã có món quà → sửa món quà theo ngày / nội dung / món mới, không tạo thêm', async () => {
    await updateInteraction(logIt, { ...baseEdit, gift }, contact, ctx, [existing]);
    const [upd] = of('client_gifts', 'update');
    expect(upd.payload).toMatchObject({ item_name: 'Hộp bánh trung thu', value: 450000, gift_date: '2026-10-21', notes: 'Nội dung mới', client_id: 'k1' });
    expect(upd.payload).not.toHaveProperty('created_at');
    expect(upd.filters).toContain('id=g1');
    expect(of('client_gifts', 'insert')).toHaveLength(0);
  });

  it('dòng cũ chưa có món quà → điền món thì tạo, mang đúng dấu created_at của dòng nhật ký', async () => {
    await updateInteraction(logIt, { ...baseEdit, gift }, contact, ctx, []);
    const [ins] = of('client_gifts', 'insert');
    expect(ins.payload).toMatchObject({ recipient_contact_id: 'c1', item_name: 'Hộp bánh trung thu', created_at: T, gift_date: '2026-10-21' });
  });

  it('dòng cũ chưa có món quà + để trống món → không ghi quà, vẫn lưu nhật ký', async () => {
    await updateInteraction(logIt, { ...baseEdit, gift: { ...gift, item: '' } }, contact, ctx, []);
    expect(calls.filter(c => c.table === 'client_gifts')).toHaveLength(0);
    expect(of('cskh_logs', 'update')).toHaveLength(1);
  });

  it('đổi sang hình thức khác (gift = null) → xoá mềm món quà khỏi Lịch sử quà', async () => {
    await updateInteraction(logIt, { ...baseEdit, type: 'call', gift: null }, contact, ctx, [existing]);
    const [upd] = of('client_gifts', 'update');
    expect(upd.payload).toEqual({ is_archived: true });
    expect(upd.filters).toContain('id=g1');
  });

  it('không truyền gift → không đụng Lịch sử quà (VD dòng thuộc đợt đã đổi hình thức)', async () => {
    await updateInteraction(logIt, { ...baseEdit, type: 'message' }, contact, ctx, [existing]);
    expect(calls.filter(c => c.table === 'client_gifts')).toHaveLength(0);
  });

  it('xoá trắng món quà của dòng đã có quà → báo lỗi, không ghi gì', async () => {
    await expect(updateInteraction(logIt, { ...baseEdit, gift: { ...gift, item: '' } }, contact, ctx, [existing])).rejects.toThrow('Nhập món quà');
    expect(calls).toHaveLength(0);
  });

  it('người chưa gắn công ty → không tạo được quà', async () => {
    const lonely = makeInteraction('c1', { type: 'gift', clientId: null, createdAt: T });
    await expect(updateInteraction(lonely, { ...baseEdit, clientId: null, gift }, makeContact({ id: 'c1', fullName: 'Mr Nhiên' }), ctx, [])).rejects.toThrow('chưa gắn công ty');
    expect(calls).toHaveLength(0);
  });

  it('lưu nhật ký lỗi sau khi vừa tạo món quà → gỡ món quà đó', async () => {
    failOn.add('cskh_logs:update');
    await expect(updateInteraction(logIt, { ...baseEdit, gift }, contact, ctx, [])).rejects.toThrow('lỗi giả');
    const undo = of('client_gifts', 'update')[0];
    expect(undo.payload).toEqual({ is_archived: true });
    expect(undo.filters).toContain('id=client_gifts-new');
  });
});

describe('xoá dòng "Quà tặng"', () => {
  it('xoá nhật ký thì món quà ghi kèm cũng bị xoá mềm; quà của dòng khác không đụng', async () => {
    const mine = makeGift('c1', { id: 'g1', createdAt: T });
    const other = makeGift('c1', { id: 'g2', createdAt: '2026-09-01T00:00:00.000Z' });
    await archiveInteraction(logIt, user, [mine, other]);
    const upd = of('client_gifts', 'update');
    expect(upd).toHaveLength(1);
    expect(upd[0].payload).toEqual({ is_archived: true });
    expect(upd[0].filters).toEqual(['id=g1']);
    expect(of('cskh_logs', 'update')[0].payload).toEqual({ is_archived: true });
  });

  it('dòng không có món quà → không đụng Lịch sử quà', async () => {
    await archiveInteraction(logIt, user, []);
    expect(calls.filter(c => c.table === 'client_gifts')).toHaveLength(0);
  });

  it('xoá quà lỗi → báo rõ nhật ký đã xoá nhưng quà chưa', async () => {
    failOn.add('client_gifts:update');
    await expect(archiveInteraction(logIt, user, [makeGift('c1', { createdAt: T, item: 'Bánh' })])).rejects.toThrow('Đã xoá nhật ký nhưng chưa xoá được món quà');
  });
});
