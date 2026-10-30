// ============================================================================
// CSKH — Quà tặng ghi từ "Ghi tương tác" (hình thức "Quà tặng")
// ----------------------------------------------------------------------------
// Chọn hình thức "Quà tặng" khi ghi tương tác = ghi 2 thứ cùng lúc: dòng nhật ký (cskh_logs) và
// món quà trong Lịch sử quà (client_gifts, hiện ở Sự kiện & Quà tặng + hồ sơ người liên hệ).
// Liên kết dòng nhật ký ↔ món quà: cùng người + CÙNG dấu created_at — đúng cách nhận diện đợt
// ghi nhóm (groupLog.ts), không cần cột mới. Sửa / xoá dòng nhật ký thì món quà đi theo.
// Chiều ngược: "Ghi quà" riêng ở Sự kiện & Quà tặng cũng ghi 1 dòng nhật ký "Quà tặng" cùng dấu
// created_at; sửa / xoá món quà thì dòng nhật ký đi theo (logOfGift).
// ============================================================================
import { groupBatches } from './groupLog';
import type { CskhGift, CskhInteraction, GiftDirection } from './types';

export interface LogGiftInput {
  direction: GiftDirection;
  item: string;
  /** VND, null = không ghi giá trị. */
  estimatedValue: number | null;
  /** contact_special_dates.id; sinh nhật trong hồ sơ là sự kiện ảo ('birthday:…') nên không gắn được. */
  occasionId: string | null;
}

/** Chưa có món quà nào (để chuẩn hoá / kiểm tra "thiếu món"). */
export const NO_LOG_GIFT: LogGiftInput = { direction: 'given', item: '', estimatedValue: null, occasionId: null };

const MAX_ITEM = 200;
const stamp = (iso: string) => Date.parse(iso);

/** Món quà ghi kèm dòng nhật ký (cùng người + cùng dấu created_at); null = chưa có. */
export function giftOfLog(
  gifts: readonly CskhGift[],
  log: Pick<CskhInteraction, 'contactId' | 'createdAt'>,
  includeArchived = false,
): CskhGift | null {
  const t = stamp(log.createdAt);
  if (!log.contactId || !Number.isFinite(t)) return null;
  return gifts.find(g => g.contactId === log.contactId && stamp(g.createdAt) === t && (includeArchived || !g.isArchived)) ?? null;
}

/**
 * Dòng nhật ký "Quà tặng" ghi kèm món quà (chiều ngược của giftOfLog): cùng người + cùng dấu created_at.
 * Chỉ hình thức "Quà tặng" — dòng khác (VD đợt đã đổi sang "Chúc mừng" mà quà vẫn giữ) là lần liên hệ
 * riêng, sửa / xoá món quà không được đụng tới.
 */
export function logOfGift(
  interactions: readonly CskhInteraction[],
  gift: Pick<CskhGift, 'contactId' | 'createdAt'>,
): CskhInteraction | null {
  const t = stamp(gift.createdAt);
  if (!gift.contactId || !Number.isFinite(t)) return null;
  return interactions.find(i => !i.isArchived && i.type === 'gift' && i.contactId === gift.contactId && stamp(i.createdAt) === t) ?? null;
}

/**
 * Dòng nhật ký "Quà tặng" LẺ chưa có món quà nào trong Lịch sử quà (ghi trước khi có tính năng
 * này, hoặc lỗi giữa chừng). Dòng thuộc đợt ghi nhóm bỏ qua (tắt "ghi lịch sử quà" là chủ ý); món quà
 * đã bị xoá thì cũng không nhắc lại.
 */
export function logsMissingGift(interactions: readonly CskhInteraction[], gifts: readonly CskhGift[]): CskhInteraction[] {
  const candidates = interactions.filter(i => !i.isArchived && i.type === 'gift' && i.contactId);
  return groupBatches(candidates)
    .flatMap(e => (e.kind === 'single' ? [e.item] : []))
    .filter(i => !giftOfLog(gifts, i, true));
}

/** Số tiền gõ trên form ("1.500.000", "500000") → VND; trống → null. */
export function parseGiftAmount(text: string): number | null {
  const digits = text.replace(/\D/g, '');
  return digits ? Number(digits) : null;
}

/** Chuẩn hoá: cắt khoảng trắng, giá trị làm tròn đồng (âm / lạ → bỏ), bỏ sự kiện ảo. */
export function sanitizeLogGift(g: LogGiftInput): LogGiftInput {
  const v = g.estimatedValue;
  return {
    direction: g.direction === 'received' ? 'received' : 'given',
    item: g.item.trim().slice(0, MAX_ITEM),
    estimatedValue: v !== null && Number.isFinite(v) && v >= 0 ? Math.round(v) : null,
    occasionId: g.occasionId && !g.occasionId.startsWith('birthday:') ? g.occasionId : null,
  };
}

// ── Form ────────────────────────────────────────────────────────────────────
/** Ô nhập trên form (chuỗi) — giữ riêng với LogGiftInput để gõ dở không mất. */
export interface LogGiftDraft {
  direction: GiftDirection;
  item: string;
  value: string;
  occasionId: string;
}

export const EMPTY_GIFT_DRAFT: LogGiftDraft = { direction: 'given', item: '', value: '', occasionId: '' };

export function giftDraftOf(g: CskhGift | null): LogGiftDraft {
  return g
    ? { direction: g.direction, item: g.item, value: g.estimatedValue != null ? String(g.estimatedValue) : '', occasionId: g.occasionId ?? '' }
    : EMPTY_GIFT_DRAFT;
}

export function giftInputOf(d: LogGiftDraft): LogGiftInput {
  return sanitizeLogGift({ direction: d.direction, item: d.item, estimatedValue: parseGiftAmount(d.value), occasionId: d.occasionId || null });
}

// ── Kế hoạch ghi ────────────────────────────────────────────────────────────
export type LogGiftPlan =
  | { kind: 'none' }
  | { kind: 'create'; gift: LogGiftInput }
  | { kind: 'update'; giftId: string; gift: LogGiftInput }
  | { kind: 'archive'; giftId: string };

/**
 * Sửa dòng nhật ký thì món quà làm gì:
 *   undefined = không đụng; null = dòng không còn là "Quà tặng" → bỏ món quà đang có;
 *   có món → sửa món đang có / tạo mới (dòng cũ chưa từng có quà); để trống món mà dòng đã có quà
 *   → báo lỗi (tránh mất quà vì lỡ tay); dòng cũ chưa có quà mà để trống → giữ nguyên.
 */
export function planLogGift(wanted: LogGiftInput | null | undefined, existing: CskhGift | null): LogGiftPlan {
  if (wanted === undefined) return { kind: 'none' };
  if (wanted === null) return existing ? { kind: 'archive', giftId: existing.id } : { kind: 'none' };
  const gift = sanitizeLogGift(wanted);
  if (!gift.item) {
    if (existing) throw new Error('Nhập món quà — hoặc đổi sang hình thức khác để bỏ món quà này khỏi Lịch sử quà');
    return { kind: 'none' };
  }
  return existing ? { kind: 'update', giftId: existing.id, gift } : { kind: 'create', gift };
}

// ── Dòng ghi DB ─────────────────────────────────────────────────────────────
export interface LogGiftRowCtx {
  contact: { id: string; fullName: string };
  /** null = quà tặng Sale (không gắn công ty khách, migration 178). */
  clientId: string | null;
  gift: LogGiftInput;
  /** Ngày tương tác = ngày tặng. */
  occurredAt: string;
  /** Nội dung dòng nhật ký — ghi chú của món quà. */
  content: string;
}

/** Các cột sửa được của client_gifts (không đụng created_at / created_by — created_at là dấu liên kết). */
export function logGiftFields(o: LogGiftRowCtx): Record<string, unknown> {
  const g = sanitizeLogGift(o.gift);
  return {
    client_id: o.clientId,
    recipient_contact_id: o.contact.id,
    recipient_name: o.contact.fullName,
    direction: g.direction,
    item_name: g.item,
    value: g.estimatedValue,
    gift_date: o.occurredAt,
    occasion_id: g.occasionId,
    notes: o.content.trim() || null,
  };
}

/** Dòng quà mới: cột sửa được + người ghi + dấu created_at chung với dòng nhật ký. */
export function logGiftInsertRow(o: LogGiftRowCtx, createdAt: string, createdByName: string | null): Record<string, unknown> {
  return { ...logGiftFields(o), created_by: createdByName, created_at: createdAt };
}
