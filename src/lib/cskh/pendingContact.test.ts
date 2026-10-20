// Port từ PRM Tony Study (src/lib/prm/pendingContact.test.mjs).
import { describe, it, expect } from 'vitest';
import {
  PENDING_KEY, PENDING_MAX_AGE_MS, PENDING_MIN_AGE_MS,
  savePending, loadPending, clearPending, isPendingReady, createSafeStorage, type KeyValueStorage,
} from './pendingContact';

const memoryStorage = () => {
  const m = new Map<string, string>();
  const s: KeyValueStorage & { _m: Map<string, string> } = {
    getItem: k => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: k => void m.delete(k),
    _m: m,
  };
  return s;
};
const NOW = Date.parse('2026-10-10T09:00:00+07:00');

describe('liên hệ đang chờ xác nhận', () => {
  it('lưu rồi đọc lại đúng người đang chờ', () => {
    const s = memoryStorage();
    savePending(s, { contactId: 'c1', channel: 'zalo', startedAt: NOW });
    expect(loadPending(s, NOW + 60_000)).toEqual({ contactId: 'c1', channel: 'zalo', startedAt: NOW });
  });

  it('quá 12 giờ thì tự huỷ và xoá khỏi storage; đúng 12 giờ vẫn còn', () => {
    const s = memoryStorage();
    savePending(s, { contactId: 'c1', channel: 'call', startedAt: NOW });
    expect(loadPending(s, NOW + PENDING_MAX_AGE_MS)).not.toBeNull();
    expect(loadPending(s, NOW + PENDING_MAX_AGE_MS + 1)).toBeNull();
    expect(s._m.has(PENDING_KEY)).toBe(false);
  });

  it('dữ liệu hỏng / sai định dạng / kênh lạ bị bỏ và xoá', () => {
    for (const bad of ['{not json', '123', 'null', '{"contactId":"","channel":"zalo","startedAt":1}',
      '{"contactId":"c","channel":"fax","startedAt":1}', '{"contactId":"c","channel":"zalo"}']) {
      const s = memoryStorage();
      s.setItem(PENDING_KEY, bad);
      expect(loadPending(s, NOW), bad).toBeNull();
      expect(s._m.has(PENDING_KEY), bad).toBe(false);
    }
  });

  it('thời điểm ở tương lai xa (đồng hồ lệch) bị bỏ', () => {
    const s = memoryStorage();
    savePending(s, { contactId: 'c1', channel: 'call', startedAt: NOW + 3_600_000 });
    expect(loadPending(s, NOW)).toBeNull();
  });

  it('chưa đủ 3 giây thì chưa hỏi xác nhận', () => {
    const p = { contactId: 'c1', channel: 'zalo' as const, startedAt: NOW };
    expect(isPendingReady(p, NOW + PENDING_MIN_AGE_MS - 1)).toBe(false);
    expect(isPendingReady(p, NOW + PENDING_MIN_AGE_MS)).toBe(true);
  });

  it('clearPending xoá; storage ném lỗi cũng không làm sập', () => {
    const s = memoryStorage();
    savePending(s, { contactId: 'c1', channel: 'call', startedAt: NOW });
    clearPending(s);
    expect(loadPending(s, NOW)).toBeNull();

    const broken: KeyValueStorage = {
      getItem() { throw new Error('blocked'); },
      setItem() { throw new Error('quota'); },
      removeItem() { throw new Error('blocked'); },
    };
    expect(() => savePending(broken, { contactId: 'c', channel: 'call', startedAt: NOW })).not.toThrow();
    expect(() => clearPending(broken)).not.toThrow();
    expect(loadPending(broken, NOW)).toBeNull();
  });

  it('createSafeStorage dùng bộ nhớ khi không có localStorage (môi trường node)', () => {
    const s = createSafeStorage();
    savePending(s, { contactId: 'c9', channel: 'sms', startedAt: NOW });
    expect(loadPending(s, NOW + 10_000)?.contactId).toBe('c9');
    clearPending(s);
    expect(loadPending(s, NOW)).toBeNull();
  });
});
