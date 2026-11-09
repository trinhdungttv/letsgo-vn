import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeInteraction } from '../../../lib/cskh/testFixtures';
import type { AppUser } from '../../../lib/types';

// Supabase giả: ghi lại mọi lệnh (bảng, thao tác, dữ liệu, điều kiện) để kiểm tra
interface Call { table: string; op: string; payload?: unknown; filters: string[] }
const calls: Call[] = [];
const failOn = new Set<string>(); // "bảng:thao tác" sẽ trả lỗi

function builder(table: string) {
  const call: Call = { table, op: 'select', filters: [] };
  const result = () => (failOn.has(`${table}:${call.op}`) ? { data: null, error: { message: 'lỗi giả' } } : { data: { id: 'row' }, error: null });
  const b: Record<string, unknown> = {
    update: (p: unknown) => { call.op = 'update'; call.payload = p; calls.push(call); return b; },
    eq: (k: string, v: unknown) => { call.filters.push(`${k}=${v}`); return b; },
    neq: (k: string, v: unknown) => { call.filters.push(`${k}!=${v}`); return b; },
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(result()).then(res, rej),
  };
  return b;
}
vi.mock('../../../lib/supabase', () => ({ supabase: { from: (t: string) => builder(t) } }));
const logActivity = vi.fn();
vi.mock('../../../lib/audit', () => ({ logActivity: (...a: unknown[]) => logActivity(...a) }));

const { rescheduleFollowUp } = await import('./api');

const user = { id: 'u1', username: 'demo', full_name: 'Demo', role: 'admin' } as AppUser;
const of = (table: string, op = 'update') => calls.filter(c => c.table === table && c.op === op);
const promise = (over = {}) => makeInteraction('c1', {
  id: 'log1', contactPerson: 'Mr Hòa', followUpAction: 'Hẹn đi nhậu', followUpDue: '2026-11-07', followUpTaskId: 't1', ...over,
});

beforeEach(() => { calls.length = 0; failOn.clear(); logActivity.mockClear(); });

describe('rescheduleFollowUp — Hẹn lại', () => {
  it('đổi hạn ở dòng nhật ký + việc Workspace, KHÔNG đụng deleted_at khi việc chưa từng để dịp khác', async () => {
    await rescheduleFollowUp(promise(), '2026-11-14', user);
    expect(of('cskh_logs')[0].payload).toEqual({ followup_due: '2026-11-14' });
    expect(of('cskh_logs')[0].filters).toContain('id=log1');
    const [task] = of('work_tasks');
    expect(task.payload).toMatchObject({ due_date: '2026-11-14' });
    expect(task.payload).not.toHaveProperty('deleted_at');
    expect(task.filters).toContain('id=t1');
    expect(logActivity).toHaveBeenCalledWith(expect.objectContaining({ description: expect.stringContaining('07/11/2026 → 14/11/2026') }));
  });

  it('việc đang "để dịp khác" (hạn trống) được hẹn lại → khôi phục việc trong Workspace', async () => {
    await rescheduleFollowUp(promise({ followUpDue: null }), '2026-11-20', user);
    expect(of('cskh_logs')[0].payload).toEqual({ followup_due: '2026-11-20' });
    expect(of('work_tasks')[0].payload).toMatchObject({ due_date: '2026-11-20', deleted_at: null });
  });

  it('dòng không có việc Workspace → chỉ sửa dòng nhật ký', async () => {
    await rescheduleFollowUp(promise({ followUpTaskId: null }), '2026-11-14', user);
    expect(of('cskh_logs')).toHaveLength(1);
    expect(calls.filter(c => c.table === 'work_tasks')).toHaveLength(0);
  });

  it('việc thêm (id có "#") chỉ đổi hạn việc Workspace, không đụng dòng nhật ký', async () => {
    await rescheduleFollowUp(promise({ id: 'log1#t9', followUpTaskId: 't9' }), '2026-11-14', user);
    expect(calls.filter(c => c.table === 'cskh_logs')).toHaveLength(0);
    const [task] = of('work_tasks');
    expect(task.payload).toMatchObject({ due_date: '2026-11-14' });
    expect(task.filters).toContain('id=t9');
    expect(logActivity).toHaveBeenCalledWith(expect.objectContaining({ recordId: 'log1' }));
  });

  it('ngày sai định dạng / việc đã xong → báo lỗi, không ghi gì', async () => {
    await expect(rescheduleFollowUp(promise(), '14/11/2026', user)).rejects.toThrow('không hợp lệ');
    await expect(rescheduleFollowUp(promise({ followUpDone: true }), '2026-11-14', user)).rejects.toThrow('đã xong');
    expect(calls).toHaveLength(0);
  });
});

describe('rescheduleFollowUp — Để dịp khác', () => {
  it('bỏ hạn ở dòng nhật ký (vẫn mở) + xoá mềm việc Workspace chưa xong', async () => {
    await rescheduleFollowUp(promise(), null, user);
    expect(of('cskh_logs')[0].payload).toEqual({ followup_due: null });
    const [task] = of('work_tasks');
    expect(task.payload).toHaveProperty('deleted_at');
    expect(task.payload).not.toHaveProperty('due_date');
    expect(task.filters).toEqual(expect.arrayContaining(['id=t1', 'status!=done']));
    expect(logActivity).toHaveBeenCalledWith(expect.objectContaining({ description: expect.stringContaining('Để dịp khác') }));
  });

  it('việc thêm không để dịp khác được (không có chỗ lưu "chưa có hạn")', async () => {
    await expect(rescheduleFollowUp(promise({ id: 'log1#t9', followUpTaskId: 't9' }), null, user)).rejects.toThrow('chỉ hẹn lại');
    expect(calls).toHaveLength(0);
  });

  it('ghi dòng nhật ký lỗi → báo lỗi và KHÔNG gỡ việc Workspace', async () => {
    failOn.add('cskh_logs:update');
    await expect(rescheduleFollowUp(promise(), null, user)).rejects.toThrow();
    expect(calls.filter(c => c.table === 'work_tasks')).toHaveLength(0);
  });

  it('Workspace lỗi (VD chưa có cột deleted_at) không làm hỏng việc hẹn ở CSKH', async () => {
    failOn.add('work_tasks:update');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(rescheduleFollowUp(promise(), null, user)).resolves.toBeUndefined();
    expect(of('cskh_logs')).toHaveLength(1);
    spy.mockRestore();
  });
});
