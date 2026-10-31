import { describe, it, expect } from 'vitest';
import type { KeyValueStorage } from './pendingContact';
import { EMPTY_GIFT_DRAFT } from './logGift';
import {
  LOG_DRAFT_KEY, LOG_DRAFT_MAX_AGE_MS,
  clearLogDraft, loadLogDraft, logDraftHasContent, logDraftSavedLabel, saveLogDraft, type LogDraft,
} from './logDraft';

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
const NOW = Date.parse('2026-10-31T09:00:00+07:00');

const draftOf = (over: Partial<LogDraft> = {}): LogDraft => ({
  contactId: 'c1',
  clientId: 'k1',
  type: 'call',
  occurredAt: '2026-10-31',
  content: 'Chủ động hẹn đi ăn',
  theyInitiated: false,
  followUp: { action: '', due: '' },
  extras: [],
  gift: EMPTY_GIFT_DRAFT,
  savedAt: NOW,
  ...over,
});

describe('nháp form Ghi tương tác', () => {
  it('lưu rồi mở lại đúng nháp của người đó', () => {
    const s = memoryStorage();
    saveLogDraft(s, draftOf(), null);
    expect(loadLogDraft(s, 'c1', NOW + 60_000)).toEqual(draftOf());
    expect(loadLogDraft(s, 'c2', NOW + 60_000)).toBeNull();
  });

  it('mở form chung (không chọn sẵn người) = nháp gõ gần nhất', () => {
    const s = memoryStorage();
    saveLogDraft(s, draftOf({ contactId: 'c1', savedAt: NOW }), null);
    saveLogDraft(s, draftOf({ contactId: 'c2', savedAt: NOW + 1000 }), null);
    expect(loadLogDraft(s, undefined, NOW + 2000)?.contactId).toBe('c2');
  });

  it('đổi người giữa chừng thì nháp chuyển theo, không để lại bản ở người cũ', () => {
    const s = memoryStorage();
    saveLogDraft(s, draftOf({ contactId: '' }), null);
    saveLogDraft(s, draftOf({ contactId: 'c2' }), '');
    expect(loadLogDraft(s, 'c2', NOW)).not.toBeNull();
    expect(loadLogDraft(s, undefined, NOW)?.contactId).toBe('c2');
    expect(Object.keys(JSON.parse(s._m.get(LOG_DRAFT_KEY)!))).toEqual(['c2']);
  });

  it('không còn chữ thì xoá nháp; chỉ đổi hình thức / ngày không tính là có nội dung', () => {
    const s = memoryStorage();
    saveLogDraft(s, draftOf(), null);
    saveLogDraft(s, draftOf({ content: '  ', type: 'meet', theyInitiated: true }), 'c1');
    expect(loadLogDraft(s, 'c1', NOW)).toBeNull();
    expect(s._m.has(LOG_DRAFT_KEY)).toBe(false);
  });

  it('việc tiếp theo / món quà cũng là nội dung đáng giữ', () => {
    const base = draftOf({ content: '' });
    expect(logDraftHasContent(base)).toBe(false);
    expect(logDraftHasContent({ ...base, followUp: { action: 'Gọi lại', due: '' } })).toBe(true);
    expect(logDraftHasContent({ ...base, extras: [{ action: 'Gửi báo giá', due: '2026-11-02' }] })).toBe(true);
    expect(logDraftHasContent({ ...base, gift: { ...EMPTY_GIFT_DRAFT, item: 'Hộp trà' } })).toBe(true);
  });

  it('quá 7 ngày thì bỏ; xoá nháp 1 người không đụng người khác', () => {
    const s = memoryStorage();
    saveLogDraft(s, draftOf({ contactId: 'c1' }), null);
    saveLogDraft(s, draftOf({ contactId: 'c2' }), null);
    expect(loadLogDraft(s, 'c1', NOW + LOG_DRAFT_MAX_AGE_MS)).not.toBeNull();
    expect(loadLogDraft(s, 'c1', NOW + LOG_DRAFT_MAX_AGE_MS + 1)).toBeNull();
    clearLogDraft(s, 'c1', NOW);
    expect(loadLogDraft(s, 'c1', NOW)).toBeNull();
    expect(loadLogDraft(s, 'c2', NOW)).not.toBeNull();
  });

  it('dữ liệu hỏng / sai định dạng thì mở form trắng', () => {
    const s = memoryStorage();
    s.setItem(LOG_DRAFT_KEY, '{không phải json');
    expect(loadLogDraft(s, undefined, NOW)).toBeNull();
    s.setItem(LOG_DRAFT_KEY, JSON.stringify({ c1: { contactId: 'c1', type: 'bay', content: 'x', savedAt: NOW } }));
    expect(loadLogDraft(s, 'c1', NOW)).toMatchObject({ type: 'call', content: 'x', extras: [], gift: EMPTY_GIFT_DRAFT });
    s.setItem(LOG_DRAFT_KEY, JSON.stringify({ c1: { contactId: 'c1', content: 'x' } }));
    expect(loadLogDraft(s, 'c1', NOW)).toBeNull();
  });

  it('nhãn thời điểm lưu: cùng ngày chỉ ghi giờ', () => {
    const at = new Date(2026, 9, 30, 14, 5).getTime();
    expect(logDraftSavedLabel(at, new Date(2026, 9, 30, 18, 0).getTime())).toBe('lúc 14:05');
    expect(logDraftSavedLabel(at, new Date(2026, 9, 31, 8, 0).getTime())).toBe('lúc 14:05 ngày 30/10');
  });
});
