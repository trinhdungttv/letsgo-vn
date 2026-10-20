import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeContact, makeInteraction } from '../../../lib/cskh/testFixtures';
import type { AppUser } from '../../../lib/types';

// Supabase giả: ghi lại mọi lệnh (bảng, thao tác, dữ liệu, điều kiện) để kiểm tra
interface Call { table: string; op: string; payload?: unknown; filters: string[] }
const calls: Call[] = [];
const failOn = new Set<string>(); // "bảng:thao tác" sẽ trả lỗi

function builder(table: string) {
  const call: Call = { table, op: 'select', filters: [] };
  const result = () => (failOn.has(`${table}:${call.op}`)
    ? { data: null, error: { message: 'lỗi giả' } }
    : { data: call.op === 'insert' ? { id: 'task-new' } : { id: 'row' }, error: null });
  const b: Record<string, unknown> = {
    insert: (p: unknown) => { call.op = 'insert'; call.payload = p; calls.push(call); return b; },
    update: (p: unknown) => { call.op = 'update'; call.payload = p; calls.push(call); return b; },
    delete: () => { call.op = 'delete'; calls.push(call); return b; },
    select: () => b,
    eq: (k: string, v: unknown) => { call.filters.push(`${k}=${v}`); return b; },
    neq: (k: string, v: unknown) => { call.filters.push(`${k}!=${v}`); return b; },
    single: () => Promise.resolve(result()),
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(result()).then(res, rej),
  };
  return b;
}
vi.mock('../../../lib/supabase', () => ({ supabase: { from: (t: string) => builder(t) } }));
vi.mock('../../../lib/audit', () => ({ logActivity: vi.fn() }));

const { updateInteraction } = await import('./api');

const user = { id: 'u1', username: 'demo', full_name: 'Demo', role: 'admin' } as AppUser;
const ctx = { user, clients: [], branches: [] };
const contact = makeContact({ id: 'c1', fullName: 'Chị Lan', ownerId: 'u2' });
const baseEdit = {
  clientId: null, type: 'call' as const, initiatedBy: 'me' as const, occurredAt: '2026-10-10', content: 'Gọi hỏi thăm',
  followUpAction: '', followUpDue: null,
};
const of = (table: string, op: string) => calls.filter(c => c.table === table && c.op === op);

beforeEach(() => { calls.length = 0; failOn.clear(); });

describe('updateInteraction', () => {
  it('trước chưa hứa, nay thêm việc → tạo việc trong Workspace (giao người phụ trách) và gắn vào dòng', async () => {
    const it0 = makeInteraction('c1', { followUpAction: '' });
    await updateInteraction(it0, { ...baseEdit, followUpAction: 'Gửi báo giá', followUpDue: '2026-10-25' }, contact, ctx);
    const [task] = of('work_tasks', 'insert');
    expect(task.payload).toMatchObject({ user_id: 'u2', title: 'CSKH: Gửi báo giá — Chị Lan', due_date: '2026-10-25', task_type: 'CSKH' });
    expect(of('cskh_logs', 'update')[0].payload).toMatchObject({ followup: 'Gửi báo giá', followup_task_id: 'task-new', followup_done: false });
  });

  it('đổi chữ / hạn việc đã hứa → sửa tên + hạn việc đi kèm', async () => {
    const it0 = makeInteraction('c1', { followUpAction: 'Gửi báo giá', followUpDue: '2026-10-20', followUpTaskId: 't1' });
    await updateInteraction(it0, { ...baseEdit, followUpAction: 'Gửi báo giá ca 3', followUpDue: '2026-10-22' }, contact, ctx);
    expect(of('work_tasks', 'insert')).toHaveLength(0);
    const [upd] = of('work_tasks', 'update');
    expect(upd.payload).toMatchObject({ title: 'CSKH: Gửi báo giá ca 3 — Chị Lan', due_date: '2026-10-22' });
    expect(upd.filters).toContain('id=t1');
  });

  it('chỉ sửa nội dung → không đụng việc trong Workspace', async () => {
    const it0 = makeInteraction('c1', { followUpAction: 'Gửi báo giá', followUpDue: '2026-10-20', followUpTaskId: 't1' });
    await updateInteraction(it0, { ...baseEdit, content: 'Nội dung mới', followUpAction: 'Gửi báo giá', followUpDue: '2026-10-20' }, contact, ctx);
    expect(calls.filter(c => c.table === 'work_tasks')).toHaveLength(0);
  });

  it('xoá trắng việc đã hứa → xoá mềm việc chưa xong, bỏ liên kết', async () => {
    const it0 = makeInteraction('c1', { followUpAction: 'Gửi báo giá', followUpDue: '2026-10-20', followUpTaskId: 't1' });
    await updateInteraction(it0, baseEdit, contact, ctx);
    const [del] = of('work_tasks', 'update');
    expect(del.payload).toHaveProperty('deleted_at');
    expect(del.filters).toEqual(expect.arrayContaining(['id=t1', 'status!=done']));
    expect(of('cskh_logs', 'update')[0].payload).toMatchObject({ followup: null, followup_due: null, followup_task_id: null });
  });

  it('giữ hình thức → giữ kênh cũ (Zalo); đổi sang Gọi điện → kênh = call', async () => {
    const it0 = makeInteraction('c1', { type: 'message', channel: 'zalo' });
    await updateInteraction(it0, { ...baseEdit, type: 'message' }, contact, ctx);
    expect(of('cskh_logs', 'update')[0].payload).toMatchObject({ channel: 'zalo' });
    calls.length = 0;
    await updateInteraction(it0, { ...baseEdit, type: 'call' }, contact, ctx);
    expect(of('cskh_logs', 'update')[0].payload).toMatchObject({ channel: 'call' });
  });

  it('dòng cũ chưa gắn người → giữ nguyên công ty dạng chữ', async () => {
    const it0 = makeInteraction(null, { clientName: 'Công ty cũ', contactPerson: 'Anh Tư' });
    await updateInteraction(it0, baseEdit, null, ctx);
    const payload = of('cskh_logs', 'update')[0].payload as Record<string, unknown>;
    expect(payload).not.toHaveProperty('client_id');
    expect(payload).not.toHaveProperty('client_name');
  });

  it('lưu dòng nhật ký lỗi → xoá việc vừa tạo, báo lỗi', async () => {
    failOn.add('cskh_logs:update');
    const it0 = makeInteraction('c1');
    await expect(updateInteraction(it0, { ...baseEdit, followUpAction: 'Hẹn gặp', followUpDue: '2026-10-25' }, contact, ctx)).rejects.toThrow('lỗi giả');
    expect(of('work_tasks', 'delete')[0].filters).toContain('id=task-new');
  });

  it('có việc mà thiếu hạn → báo lỗi, không ghi gì', async () => {
    await expect(updateInteraction(makeInteraction('c1'), { ...baseEdit, followUpAction: 'Hẹn gặp' }, contact, ctx)).rejects.toThrow('cần có hạn');
    expect(calls).toHaveLength(0);
  });
});
