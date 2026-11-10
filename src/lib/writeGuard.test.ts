import { describe, it, expect, vi, afterEach } from 'vitest';
import { isBlockedWrite, isRestRequest, isReadOnlyRole, setWriteGuardRole, withWriteGuard, TOKEN_HEADER } from './writeGuard';

const REST = 'https://abc.supabase.co/rest/v1';

describe('isBlockedWrite', () => {
  it('chặn ghi bảng và tải tệp', () => {
    expect(isBlockedWrite(`${REST}/clients`, 'POST')).toBe(true);
    expect(isBlockedWrite(`${REST}/clients?id=eq.1`, 'PATCH')).toBe(true);
    expect(isBlockedWrite(`${REST}/clients?id=eq.1`, 'delete')).toBe(true);
    expect(isBlockedWrite('https://abc.supabase.co/storage/v1/object/crm-voice/a.webm', 'POST')).toBe(true);
  });
  it('không chặn đọc và RPC', () => {
    expect(isBlockedWrite(`${REST}/clients?select=*`, 'GET')).toBe(false);
    expect(isBlockedWrite(`${REST}/clients`, 'HEAD')).toBe(false);
    expect(isBlockedWrite(`${REST}/rpc/verify_login`, 'POST')).toBe(false);
    expect(isBlockedWrite(`${REST}/rpc/quick_notes_rpc`, 'POST')).toBe(false);
  });
});

describe('isRestRequest', () => {
  it('chỉ request REST mang token', () => {
    expect(isRestRequest(`${REST}/clients`)).toBe(true);
    expect(isRestRequest(`${REST}/rpc/x`)).toBe(true);
    expect(isRestRequest('https://abc.supabase.co/storage/v1/object/a')).toBe(false);
    expect(isRestRequest('/api/gemini')).toBe(false);
  });
});

describe('withWriteGuard', () => {
  afterEach(() => setWriteGuardRole(null));

  it('gắn token vào request REST, giữ header cũ', async () => {
    const base = vi.fn<typeof fetch>(async () => new Response('[]'));
    const f = withWriteGuard(base, () => 'tok-1');
    await f(`${REST}/clients`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: '{}' });
    const init = base.mock.calls[0][1] as RequestInit;
    const h = new Headers(init.headers);
    expect(h.get(TOKEN_HEADER)).toBe('tok-1');
    expect(h.get('Prefer')).toBe('return=representation');
    expect(init.method).toBe('PATCH');
    expect(init.body).toBe('{}');
  });

  it('không ghi đè token module tự đặt, không gắn cho Storage', async () => {
    const base = vi.fn<typeof fetch>(async () => new Response('[]'));
    const f = withWriteGuard(base, () => 'tok-1');
    await f(`${REST}/bds_rooms`, { headers: { [TOKEN_HEADER]: 'tok-office' } });
    expect(new Headers((base.mock.calls[0][1] as RequestInit).headers).get(TOKEN_HEADER)).toBe('tok-office');
    await f('https://abc.supabase.co/storage/v1/object/a', { method: 'GET' });
    expect(base.mock.calls[1][1]).toEqual({ method: 'GET' });
  });

  it('Ban Điều Hành: chặn ghi, trả lỗi 403 tiếng Việt, vẫn cho đọc', async () => {
    setWriteGuardRole('bdh');
    const base = vi.fn<typeof fetch>(async () => new Response('[]'));
    const f = withWriteGuard(base, () => 'tok-1');
    const res = await f(`${REST}/clients?id=eq.1`, { method: 'DELETE' });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('LGVN_READONLY');
    expect(body.message).toMatch(/chỉ được xem/);
    expect(base).not.toHaveBeenCalled();
    await f(`${REST}/clients?select=*`, { method: 'GET' });
    expect(base).toHaveBeenCalledTimes(1);
  });

  it('vai trò khác ghi bình thường', async () => {
    setWriteGuardRole('kinhdoanh');
    const base = vi.fn<typeof fetch>(async () => new Response('[]'));
    const f = withWriteGuard(base, () => 'tok-1');
    await f(`${REST}/clients`, { method: 'POST', body: '{}' });
    expect(base).toHaveBeenCalledTimes(1);
  });
});

describe('isReadOnlyRole', () => {
  it('chỉ bdh', () => {
    expect(isReadOnlyRole('bdh')).toBe(true);
    expect(isReadOnlyRole('kinhdoanh')).toBe(false);
    expect(isReadOnlyRole('admin')).toBe(false);
    expect(isReadOnlyRole(null)).toBe(false);
  });
});
