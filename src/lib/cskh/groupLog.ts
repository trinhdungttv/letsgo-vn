// ============================================================================
// CSKH — Ghi 1 hành động chung cho cả nhóm (tặng quà / chúc mừng tập thể) + đợt ghi nhóm
// (port PRM groupLog.ts, chỉnh cho LetsGo: cskh_logs + client_gifts)
// ----------------------------------------------------------------------------
// VD 20/10 tặng hoa mọi "TP Nhân sự" nữ của khách ở chi nhánh X: lọc → chọn tất cả → ghi
// 1 lần, mỗi người 1 dòng nhật ký (tính là đã liên hệ) + 1 dòng lịch sử quà nếu bật.
// "Đợt": mọi dòng của 1 lần ghi nhóm mang CÙNG created_at (dấu đợt, kể cả khi gửi nhiều lô)
// — không cần cột mới, tương thích Tony Study. Nhật ký gom lại thành 1 đợt để sửa ngày /
// nội dung / hình thức cả loạt, bỏ / thêm người, xoá cả đợt.
// ============================================================================
import type { CskhContact, CskhGift, CskhInteraction, InteractionType } from './types';

export interface GroupAction {
  key: string;
  label: string;
  type: InteractionType;
  /** Tên món quà mặc định ghi vào lịch sử quà ('' = không phải quà). */
  giftItem: string;
}

export const GROUP_ACTIONS: readonly GroupAction[] = [
  { key: 'flowers', label: 'Tặng hoa', type: 'gift', giftItem: 'Hoa' },
  { key: 'wish', label: 'Chúc mừng', type: 'message', giftItem: '' },
  { key: 'gift', label: 'Tặng quà', type: 'gift', giftItem: 'Quà' },
  { key: 'meet', label: 'Gặp mặt / liên hoan', type: 'meet', giftItem: '' },
  { key: 'other', label: 'Khác', type: 'other', giftItem: '' },
];

export const GROUP_OCCASIONS: readonly string[] = [
  '20/10', '8/3', 'Sinh nhật', 'Tết', 'Trung thu', '1/6', 'Tri ân khách hàng', 'Kỷ niệm hợp tác',
];

/** Dịp gợi ý theo ngày (YYYY-MM-DD): quanh 20/10 và 8/3 — '' = không gợi ý. */
export function suggestOccasion(isoDate: string): string {
  const m = Number(isoDate.slice(5, 7));
  const d = Number(isoDate.slice(8, 10));
  if ((m === 10 && d >= 10) || (m === 11 && d <= 5)) return '20/10';
  if ((m === 2 && d >= 25) || (m === 3 && d <= 15)) return '8/3';
  return '';
}

/** Nội dung mặc định: "Tặng hoa 20/10". */
export function groupLogContent(action: GroupAction, occasion: string): string {
  return [action.key === 'other' ? '' : action.label, occasion].filter(Boolean).join(' ');
}

export interface GroupLogPlan {
  contactIds: readonly string[];
  type: InteractionType;
  occurredAt: string;
  content: string;
  /** Ghi thêm lịch sử quà (mỗi người 1 dòng); null = không. estimatedValue null = không ghi giá trị. */
  gift: { item: string; estimatedValue: number | null } | null;
}

/** Thông tin cần để dựng dòng: người ghi + người liên hệ + tên công ty. */
export interface GroupLogCtx {
  userId: string | null;
  userName: string | null;
  contactById: ReadonlyMap<string, Pick<CskhContact, 'id' | 'fullName' | 'clientIds' | 'primaryClientIds' | 'organization'> & Partial<Pick<CskhContact, 'kind'>>>;
  clientName: (clientId: string) => string | null;
}

/** Công ty ghi kèm: nơi người này là liên hệ chính, không thì công ty đầu tiên. */
const clientIdOf = (c: Pick<CskhContact, 'clientIds' | 'primaryClientIds'>): string | null =>
  c.primaryClientIds[0] ?? c.clientIds[0] ?? null;

export interface GroupLogRows {
  logs: Record<string, unknown>[];
  gifts: Record<string, unknown>[];
  /** Người (khách) chưa gắn công ty → không có dòng quà (quà khách tính theo công ty). Sale không cần công ty. */
  noGiftNames: string[];
}

/**
 * Dòng ghi DB (cskh_logs + client_gifts) — bỏ trùng, bỏ id lạ. createdAt = dấu đợt (chung cả loạt).
 * Giá trị quà làm tròn đồng, âm → 0.
 */
export function buildGroupLogRows(plan: GroupLogPlan, ctx: GroupLogCtx, createdAt: string): GroupLogRows {
  const ids = [...new Set(plan.contactIds.filter(id => id && ctx.contactById.has(id)))];
  const content = plan.content.trim();
  const logs: Record<string, unknown>[] = [];
  const gifts: Record<string, unknown>[] = [];
  const noGiftNames: string[] = [];
  const item = plan.gift?.item.trim() ?? '';
  const value = plan.gift && plan.gift.estimatedValue !== null ? Math.max(0, Math.round(plan.gift.estimatedValue) || 0) : null;
  for (const id of ids) {
    const c = ctx.contactById.get(id)!;
    const clientId = clientIdOf(c);
    const clientName = clientId ? ctx.clientName(clientId) : null;
    logs.push({
      contact_id: id,
      client_id: clientId,
      client_name: clientName ?? (c.organization || null),
      contact_person: c.fullName,
      contact_type: plan.type,
      channel: '',
      initiated_by: 'me',
      content: content || null,
      log_date: plan.occurredAt,
      followup: null,
      followup_due: null,
      followup_done: false,
      created_by: ctx.userId,
      created_by_name: ctx.userName,
      created_at: createdAt,
    });
    if (!item) continue;
    if (!clientId && c.kind !== 'sale') {
      noGiftNames.push(c.fullName);
      continue;
    }
    gifts.push({
      client_id: clientId,
      recipient_contact_id: id,
      recipient_name: c.fullName,
      direction: 'given',
      item_name: item,
      value,
      gift_date: plan.occurredAt,
      notes: content || null,
      created_by: ctx.userName,
      created_at: createdAt,
    });
  }
  return { logs, gifts, noGiftNames };
}

// ── Đợt ghi nhóm — gom / sửa ─────────────────────────────────────────────────
export interface InteractionBatch {
  /** Khoá ổn định để vẽ. */
  key: string;
  /** Dấu đợt (created_at chung) — dùng lại khi thêm người vào đợt. */
  createdAt: string;
  type: InteractionType;
  content: string;
  occurredAt: string;
  /** Người ghi đợt (app_users.id) — để kiểm quyền sửa / xoá. */
  createdBy: string | null;
  createdByName: string;
  items: CskhInteraction[];
}

export type LogEntry = { kind: 'batch'; batch: InteractionBatch } | { kind: 'single'; item: CskhInteraction };

const stamp = (iso: string) => Date.parse(iso);

/**
 * Gom nhật ký thành đợt: cùng dấu đợt (so tới mili-giây) + cùng hình thức / nội dung / ngày
 * và ≥ 2 người. Giữ thứ tự xuất hiện (nhật ký đã xếp mới nhất trước); dòng lẻ giữ nguyên.
 * Dòng có việc đã hứa không bao giờ thuộc đợt (ghi nhóm không tạo việc đã hứa).
 */
export function groupBatches(interactions: readonly CskhInteraction[]): LogEntry[] {
  const keyOf = (i: CskhInteraction) => (i.contactId && !i.followUpAction.trim() && Number.isFinite(stamp(i.createdAt))
    ? `${stamp(i.createdAt)}|${i.type}|${i.occurredAt}|${i.content}`
    : `single:${i.id}`);
  const groups = new Map<string, CskhInteraction[]>();
  for (const i of interactions) {
    const k = keyOf(i);
    const list = groups.get(k);
    if (list) list.push(i);
    else groups.set(k, [i]);
  }
  const out: LogEntry[] = [];
  const seen = new Set<string>();
  for (const i of interactions) {
    const k = keyOf(i);
    const list = groups.get(k)!;
    if (list.length < 2) {
      out.push({ kind: 'single', item: i });
      continue;
    }
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({
      kind: 'batch',
      batch: {
        key: k, createdAt: i.createdAt, type: i.type, content: i.content, occurredAt: i.occurredAt,
        createdBy: i.createdBy, createdByName: i.createdByName, items: list,
      },
    });
  }
  return out;
}

/** Dòng lịch sử quà cùng đợt (cùng dấu đợt, ghi cho người trong đợt, chưa xoá). */
export function batchGiftsOf(gifts: readonly CskhGift[], createdAt: string, contactIds: readonly string[]): CskhGift[] {
  const ids = new Set(contactIds);
  const t = stamp(createdAt);
  return gifts.filter(g => !g.isArchived && g.contactId !== null && ids.has(g.contactId) && stamp(g.createdAt) === t);
}

/** Ai được sửa / xoá cả đợt (chốt 24/10/2026): người tạo đợt hoặc admin. */
export function canEditBatch(batch: Pick<InteractionBatch, 'createdBy'>, user: { id: string; role: string } | null): boolean {
  if (!user) return false;
  return user.role === 'admin' || (batch.createdBy !== null && batch.createdBy === user.id);
}

export interface BatchEdit {
  type: InteractionType;
  content: string;
  occurredAt: string;
  removeContactIds: readonly string[];
  addContactIds: readonly string[];
}

/** Kế hoạch sửa đợt: dòng nào cập nhật / xoá mềm / thêm (cả nhật ký lẫn lịch sử quà). */
export function planBatchEdit(batch: InteractionBatch, gifts: readonly CskhGift[], edit: BatchEdit, ctx: GroupLogCtx) {
  const remove = new Set(edit.removeContactIds);
  const present = new Set(batch.items.map(i => i.contactId));
  const content = edit.content.trim();
  const template = gifts[0] ?? null;
  const added = buildGroupLogRows({
    contactIds: edit.addContactIds.filter(id => !present.has(id)),
    type: edit.type,
    occurredAt: edit.occurredAt,
    content,
    gift: template ? { item: template.item, estimatedValue: template.estimatedValue } : null,
  }, { ...ctx, userId: batch.createdBy ?? ctx.userId, userName: batch.createdByName || ctx.userName }, batch.createdAt);
  return {
    updateLogIds: batch.items.filter(i => !remove.has(i.contactId as string)).map(i => i.id),
    archiveLogIds: batch.items.filter(i => remove.has(i.contactId as string)).map(i => i.id),
    logPatch: { contact_type: edit.type, content: content || null, log_date: edit.occurredAt },
    updateGiftIds: gifts.filter(g => !remove.has(g.contactId as string)).map(g => g.id),
    archiveGiftIds: gifts.filter(g => remove.has(g.contactId as string)).map(g => g.id),
    giftPatch: { gift_date: edit.occurredAt, notes: content || null },
    insertLogs: added.logs,
    insertGifts: added.gifts,
    noGiftNames: added.noGiftNames,
  };
}
