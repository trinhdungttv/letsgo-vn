import { describe, expect, it } from 'vitest';
import {
  EMPTY_GIFT_DRAFT, giftDraftOf, giftInputOf, giftOfLog, logGiftFields, logGiftInsertRow, logsMissingGift,
  logOfGift, parseGiftAmount, planLogGift, sanitizeLogGift,
} from './logGift';
import { makeGift, makeInteraction } from './testFixtures';

const T = '2026-10-26T03:12:45.123Z';
const log = (over = {}) => makeInteraction('c1', { type: 'gift', createdAt: T, ...over });

describe('món quà của dòng nhật ký', () => {
  it('nhận ra theo cùng người + cùng dấu created_at (bỏ qua phần micro-giây)', () => {
    const g = makeGift('c1', { createdAt: '2026-10-26T03:12:45.123456+00:00' });
    expect(giftOfLog([g], log())).toBe(g);
    expect(giftOfLog([makeGift('c2', { createdAt: T })], log())).toBeNull(); // người khác
    expect(giftOfLog([makeGift('c1', { createdAt: '2026-10-26T03:12:45.124Z' })], log())).toBeNull(); // lệch dấu
    expect(giftOfLog([g], makeInteraction(null, { createdAt: T }))).toBeNull(); // dòng cũ chưa gắn người
  });

  it('quà đã xoá không tính, trừ khi hỏi cả quà đã xoá', () => {
    const g = makeGift('c1', { createdAt: T, isArchived: true });
    expect(giftOfLog([g], log())).toBeNull();
    expect(giftOfLog([g], log(), true)).toBe(g);
  });
});

describe('dòng nhật ký của món quà (chiều ngược)', () => {
  it('nhận ra dòng "Quà tặng" cùng người + cùng dấu created_at', () => {
    const l = log({ id: 'a' });
    const g = makeGift('c1', { createdAt: '2026-10-26T03:12:45.123456+00:00' });
    expect(logOfGift([l], g)).toBe(l);
    expect(logOfGift([log({ contactId: 'c2' })], g)).toBeNull(); // người khác
    expect(logOfGift([log({ createdAt: '2026-10-26T03:12:45.999Z' })], g)).toBeNull(); // lệch dấu
    expect(logOfGift([l], makeGift('c1', { contactId: null, createdAt: T }))).toBeNull(); // quà cũ không gắn người
  });

  it('chỉ hình thức "Quà tặng", chưa xoá — dòng khác là lần liên hệ riêng, không đụng tới', () => {
    const g = makeGift('c1', { createdAt: T });
    expect(logOfGift([makeInteraction('c1', { type: 'message', createdAt: T })], g)).toBeNull();
    expect(logOfGift([log({ isArchived: true })], g)).toBeNull();
  });
});

describe('dòng "Quà tặng" chưa có món quà', () => {
  it('chỉ dòng lẻ, hình thức Quà tặng, chưa có quà (kể cả quà đã xoá thì thôi không nhắc)', () => {
    const missing = log({ id: 'a' });
    const hasGift = log({ id: 'b', createdAt: '2026-10-25T01:00:00.000Z' });
    const removed = log({ id: 'c', createdAt: '2026-10-24T01:00:00.000Z' });
    const call = makeInteraction('c1', { id: 'd', type: 'call', createdAt: '2026-10-23T01:00:00.000Z' });
    const archived = log({ id: 'e', createdAt: '2026-10-22T01:00:00.000Z', isArchived: true });
    const gifts = [
      makeGift('c1', { createdAt: hasGift.createdAt }),
      makeGift('c1', { createdAt: removed.createdAt, isArchived: true }),
    ];
    expect(logsMissingGift([missing, hasGift, removed, call, archived], gifts).map(i => i.id)).toEqual(['a']);
  });

  it('dòng thuộc đợt ghi nhóm (≥ 2 người cùng dấu) không bị nhắc — tắt ghi quà là chủ ý', () => {
    const a = makeInteraction('c1', { id: 'a', type: 'gift', createdAt: T, content: 'Tặng hoa 20/10' });
    const b = makeInteraction('c2', { id: 'b', type: 'gift', createdAt: T, content: 'Tặng hoa 20/10' });
    expect(logsMissingGift([a, b], [])).toEqual([]);
  });
});

describe('chuẩn hoá món quà', () => {
  it('đọc số tiền, cắt chữ, làm tròn đồng, bỏ giá trị âm / sinh nhật ảo', () => {
    expect(parseGiftAmount('1.500.000')).toBe(1500000);
    expect(parseGiftAmount('')).toBeNull();
    expect(parseGiftAmount('abc')).toBeNull();
    expect(sanitizeLogGift({ direction: 'given', item: '  Bánh trung thu  ', estimatedValue: 499999.6, occasionId: 'birthday:c1' }))
      .toEqual({ direction: 'given', item: 'Bánh trung thu', estimatedValue: 500000, occasionId: null });
    expect(sanitizeLogGift({ direction: 'received', item: 'x', estimatedValue: -5, occasionId: 'o1' }))
      .toEqual({ direction: 'received', item: 'x', estimatedValue: null, occasionId: 'o1' });
    expect(sanitizeLogGift({ direction: 'given', item: 'a'.repeat(300), estimatedValue: null, occasionId: null }).item).toHaveLength(200);
  });

  it('form ↔ món quà: điền sẵn từ quà đang có, ô trống → bản nháp rỗng', () => {
    expect(giftDraftOf(null)).toBe(EMPTY_GIFT_DRAFT);
    const g = makeGift('c1', { item: 'Rượu vang', estimatedValue: 800000, direction: 'received', occasionId: 'o9' });
    expect(giftDraftOf(g)).toEqual({ direction: 'received', item: 'Rượu vang', value: '800000', occasionId: 'o9' });
    expect(giftInputOf(giftDraftOf(g))).toEqual({ direction: 'received', item: 'Rượu vang', estimatedValue: 800000, occasionId: 'o9' });
  });
});

describe('kế hoạch ghi quà khi sửa dòng nhật ký', () => {
  const existing = makeGift('c1', { id: 'g1', createdAt: T });
  const wanted = { direction: 'given' as const, item: 'Giỏ trái cây', estimatedValue: 500000, occasionId: null };

  it('không truyền gì → không đụng', () => {
    expect(planLogGift(undefined, existing)).toEqual({ kind: 'none' });
  });
  it('dòng không còn là quà → bỏ món quà đang có; chưa có thì thôi', () => {
    expect(planLogGift(null, existing)).toEqual({ kind: 'archive', giftId: 'g1' });
    expect(planLogGift(null, null)).toEqual({ kind: 'none' });
  });
  it('có món: sửa món đang có hoặc tạo mới cho dòng cũ', () => {
    expect(planLogGift(wanted, existing)).toEqual({ kind: 'update', giftId: 'g1', gift: wanted });
    expect(planLogGift(wanted, null)).toEqual({ kind: 'create', gift: wanted });
  });
  it('để trống món: dòng đã có quà → báo lỗi (không lỡ tay mất quà); dòng cũ chưa có quà → giữ nguyên', () => {
    expect(() => planLogGift({ ...wanted, item: '  ' }, existing)).toThrow('Nhập món quà');
    expect(planLogGift({ ...wanted, item: '' }, null)).toEqual({ kind: 'none' });
  });
});

describe('dòng ghi client_gifts', () => {
  const ctx = {
    contact: { id: 'c1', fullName: 'Chị Lan' }, clientId: 'cl1', occurredAt: '2026-10-20', content: '  Tặng bánh trung thu  ',
    gift: { direction: 'given' as const, item: 'Hộp bánh', estimatedValue: 450000, occasionId: 'o1' },
  };
  it('cột sửa được: ngày tặng = ngày tương tác, ghi chú = nội dung nhật ký, không có dấu liên kết', () => {
    const f = logGiftFields(ctx);
    expect(f).toMatchObject({
      client_id: 'cl1', recipient_contact_id: 'c1', recipient_name: 'Chị Lan', direction: 'given', item_name: 'Hộp bánh',
      value: 450000, gift_date: '2026-10-20', occasion_id: 'o1', notes: 'Tặng bánh trung thu',
    });
    expect(f).not.toHaveProperty('created_at');
    expect(f).not.toHaveProperty('created_by');
  });
  it('dòng mới mang dấu created_at chung + tên người ghi; nội dung trống → ghi chú null', () => {
    const row = logGiftInsertRow({ ...ctx, content: '' }, T, 'Tony');
    expect(row).toMatchObject({ created_at: T, created_by: 'Tony', notes: null });
  });
});
