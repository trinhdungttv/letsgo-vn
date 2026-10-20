import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppUser } from '../../lib/types';

// Không đụng Supabase: thay phần I/O bằng hàm giả đếm số lần chạy
const runCareAutomation = vi.fn();
const loadCskhData = vi.fn();
vi.mock('./data/api', () => ({ runCareAutomation, loadCskhData }));
vi.mock('../../lib/cskh/events', () => ({ emitCskhDataChanged: vi.fn() }));

const user = { id: 'u1', username: 'demo', full_name: 'Demo', role: 'admin' } as AppUser;
const ctx = { user, clients: [], branches: [] };
const data = { migrationReady: true } as never;
const TODAY = '2026-10-21';

function memoryStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } };
}

/** Mỗi test nạp lại module để xoá trạng thái "đã chạy trong phiên". */
async function fresh() {
  vi.resetModules();
  return import('./automationRunner');
}

beforeEach(() => {
  runCareAutomation.mockReset().mockResolvedValue({ gift: 1, reconnect: 0 });
  loadCskhData.mockReset().mockResolvedValue(data);
  vi.stubGlobal('localStorage', memoryStorage());
});

describe('runCareAutomationOnce', () => {
  it('2 nơi gọi cùng lúc (mở app rồi vào ngay CSKH) → chỉ chạy 1 lượt, nơi sau không báo lại', async () => {
    const m = await fresh();
    const [a, b] = await Promise.all([
      m.runCareAutomationOnce({ ctx, today: TODAY, daily: true }),
      m.runCareAutomationOnce({ ctx, today: TODAY, data }),
    ]);
    expect(runCareAutomation).toHaveBeenCalledTimes(1);
    expect(a).toEqual({ gift: 1, reconnect: 0 });
    expect(b).toBeNull();
  });

  it('đã chạy trong phiên → không chạy lại', async () => {
    const m = await fresh();
    await m.runCareAutomationOnce({ ctx, today: TODAY, data });
    await m.runCareAutomationOnce({ ctx, today: TODAY, data });
    expect(runCareAutomation).toHaveBeenCalledTimes(1);
  });

  it('mở app (daily) mà trình duyệt đã chạy hôm nay → bỏ qua, không tải dữ liệu', async () => {
    let m = await fresh();
    await m.runCareAutomationOnce({ ctx, today: TODAY, daily: true });
    m = await fresh(); // F5 = phiên mới, cùng ngày
    await m.runCareAutomationOnce({ ctx, today: TODAY, daily: true });
    expect(runCareAutomation).toHaveBeenCalledTimes(1);
    expect(loadCskhData).toHaveBeenCalledTimes(1);
  });

  it('sang ngày mới → mở app lại chạy', async () => {
    let m = await fresh();
    await m.runCareAutomationOnce({ ctx, today: TODAY, daily: true });
    m = await fresh();
    await m.runCareAutomationOnce({ ctx, today: '2026-10-22', daily: true });
    expect(runCareAutomation).toHaveBeenCalledTimes(2);
  });

  it('trang CSKH (không daily) vẫn chạy mỗi phiên như trước', async () => {
    let m = await fresh();
    await m.runCareAutomationOnce({ ctx, today: TODAY, daily: true });
    m = await fresh();
    await m.runCareAutomationOnce({ ctx, today: TODAY, data });
    expect(runCareAutomation).toHaveBeenCalledTimes(2);
  });

  it('DB chưa chạy migration → không chạy, phiên sau thử lại được', async () => {
    loadCskhData.mockResolvedValue({ migrationReady: false });
    const m = await fresh();
    expect(await m.runCareAutomationOnce({ ctx, today: TODAY, daily: true })).toBeNull();
    expect(runCareAutomation).not.toHaveBeenCalled();
  });

  it('chưa đăng nhập → không làm gì', async () => {
    const m = await fresh();
    expect(await m.runCareAutomationOnce({ ctx: { ...ctx, user: null }, today: TODAY, daily: true })).toBeNull();
    expect(loadCskhData).not.toHaveBeenCalled();
  });

  it('câu thông báo: có việc thì báo, không có thì im', async () => {
    const m = await fresh();
    expect(m.automationMessage({ gift: 2, reconnect: 1 })).toBe('Đã tạo 3 việc nhắc trong Workspace (2 chuẩn bị quà, 1 kết nối lại)');
    expect(m.automationMessage({ gift: 0, reconnect: 0 })).toBeNull();
    expect(m.automationMessage(null)).toBeNull();
  });
});
