import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { safeImageUrl, sniffImage } from './imageGuard';
import { isExternalImageUrl, isOwnHosted, mirrorRow, mirroringFetch, withoutMirroring } from './mirrorImages';

const R2 = 'https://pub-abc.r2.dev';
const fetchMock = vi.fn();

beforeEach(() => {
  // Môi trường test (node) không có localStorage → giả 1 bộ nhớ có sẵn token đăng nhập
  vi.stubGlobal('localStorage', { getItem: (k: string) => (k === 'letsgo_token' ? 'tok' : null), setItem: () => {}, removeItem: () => {} });
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

/** /api/r2-upload (trạng thái) + /api/r2-import (đổi link) + mọi request khác trả 200 */
function wire(importResult: (url: string) => { ok: boolean; url?: string }) {
  fetchMock.mockImplementation(async (input: string, init?: RequestInit) => {
    if (input === '/api/r2-upload') return new Response(JSON.stringify({ enabled: true, publicUrl: R2 }), { status: 200, headers: { 'content-type': 'application/json' } });
    if (input === '/api/r2-import') {
      const { url } = JSON.parse(String(init?.body));
      const r = importResult(url);
      return new Response(JSON.stringify(r.ok ? { url: r.url } : { error: 'hết hạn' }), { status: r.ok ? 200 : 502 });
    }
    return new Response('[]', { status: 200 });
  });
}

describe('chống lợi dụng khi tải ảnh từ link', () => {
  it('chỉ nhận https có tên miền; chặn IP, localhost, mạng nội bộ, cổng lạ, tài khoản trong link', () => {
    expect(safeImageUrl('https://scontent.fsgn8-4.fna.fbcdn.net/v/t39/a.jpg?x=1')).not.toBeNull();
    for (const bad of ['http://a.com/x.jpg', 'https://127.0.0.1/x.jpg', 'https://10.0.0.5/a.png', 'https://[::1]/a.png', 'https://localhost/a.png', 'https://nas.local/a.png',
      'https://intranet/a.png', 'https://a.com:8443/a.png', 'https://user:pw@a.com/a.png', 'ftp://a.com/a.png', 'javascript:alert(1)', 'không phải link']) {
      expect(safeImageUrl(bad), bad).toBeNull();
    }
  });
  it('nhận dạng ảnh theo byte đầu, không nhận SVG / HTML', () => {
    expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))?.ext).toBe('jpg');
    expect(sniffImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]))?.ext).toBe('png');
    expect(sniffImage(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))?.ext).toBe('webp');
    expect(sniffImage(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
    expect(sniffImage(new TextEncoder().encode('<!doctype html><html>'))).toBeNull();
  });
});

describe('tự đổi link ảnh ngoài khi lưu', () => {
  it('nhận biết link ngoài vs link trong kho', () => {
    expect(isExternalImageUrl('https://fbcdn.net/a.jpg')).toBe(true);
    expect(isExternalImageUrl('data:image/png;base64,xx')).toBe(false);
    expect(isExternalImageUrl('')).toBe(false);
    expect(isOwnHosted('https://x.supabase.co/storage/v1/object/public/avatars/a.png', R2)).toBe(true);
    expect(isOwnHosted(`${R2}/mirror/2026-11/a.jpg`, R2)).toBe(true);
    expect(isOwnHosted('https://fbcdn.net/a.jpg', R2)).toBe(false);
  });
  it('đổi cột chuỗi + cột mảng; giữ nguyên ảnh đã ở kho và ảnh lỗi', async () => {
    wire(url => (url.includes('hetHan') ? { ok: false } : { ok: true, url: `${R2}/mirror/2026-11/${url.split('/').pop()}` }));
    const { row, changed } = await mirrorRow({
      name: 'ABC', cover_image_url: 'https://fb.com/cover1.jpg',
      recruit_image_urls: ['https://fb.com/a1.jpg', `${R2}/mirror/x.jpg`, 'https://fb.com/hetHan.jpg'],
    });
    expect(changed).toBe(2);
    expect(row.name).toBe('ABC');
    expect(row.cover_image_url).toBe(`${R2}/mirror/2026-11/cover1.jpg`);
    expect(row.recruit_image_urls).toEqual([`${R2}/mirror/2026-11/a1.jpg`, `${R2}/mirror/x.jpg`, 'https://fb.com/hetHan.jpg']);
  });
  it('lệnh ghi lên bảng có cột ảnh: link ngoài được thay trước khi gửi; lỗi thì gửi nguyên bản', async () => {
    wire(url => (url.includes('hetHan') ? { ok: false } : { ok: true, url: `${R2}/mirror/${url.split('/').pop()}` }));
    await mirroringFetch('https://p.supabase.co/rest/v1/market_leads?id=eq.1', { method: 'PATCH', body: JSON.stringify({ cover_image_url: 'https://fb.com/new1.jpg' }) });
    const sent = fetchMock.mock.calls.filter(c => String(c[0]).includes('/rest/v1/')).pop()!;
    expect(JSON.parse(String(sent[1]?.body))).toEqual({ cover_image_url: `${R2}/mirror/new1.jpg` });
    await mirroringFetch('https://p.supabase.co/rest/v1/clients', { method: 'POST', body: JSON.stringify([{ name: 'A', image_url: 'https://fb.com/hetHan2.jpg' }, { name: 'B' }]) });
    const sent2 = fetchMock.mock.calls.filter(c => String(c[0]).includes('/rest/v1/')).pop()!;
    expect(JSON.parse(String(sent2[1]?.body))).toEqual([{ name: 'A', image_url: 'https://fb.com/hetHan2.jpg' }, { name: 'B' }]);
  });
  it('không đụng vào đọc dữ liệu, rpc, bảng không có cột ảnh, và khi tạm dừng (hoàn tác)', async () => {
    wire(() => ({ ok: true, url: `${R2}/mirror/z.jpg` }));
    const body = JSON.stringify({ avatar_url: 'https://fb.com/p.jpg' });
    await mirroringFetch('https://p.supabase.co/rest/v1/contacts', { method: 'GET' });
    await mirroringFetch('https://p.supabase.co/rest/v1/rpc/verify_login', { method: 'POST', body });
    await mirroringFetch('https://p.supabase.co/rest/v1/notes', { method: 'POST', body: JSON.stringify({ title: 'x https://a.com' }) });
    await withoutMirroring(() => mirroringFetch('https://p.supabase.co/rest/v1/contacts?id=eq.1', { method: 'PATCH', body }));
    expect(fetchMock.mock.calls.some(c => c[0] === '/api/r2-import')).toBe(false);
    const last = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
    expect(String(last[1]?.body)).toBe(body);
  });
});
