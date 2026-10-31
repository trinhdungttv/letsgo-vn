// ============================================================================
// CSKH — Bản nháp form "Ghi tương tác"
// ----------------------------------------------------------------------------
// Form bị unmount hẳn khi đóng (bấm nền / Esc / X / "Quay lại" trên điện thoại), nên nội dung gõ dở
// sẽ mất sạch nếu lỡ tay. Mỗi lần sửa form → chụp nguyên form vào localStorage, mở lại là còn.
// Mỗi người liên hệ 1 bản nháp (khoá = contactId, '' = chưa chọn người): đang gõ cho A mà mở form
// ghi cho B thì nháp của A vẫn giữ. Chỉ lưu khi có chữ (nội dung / việc tiếp theo / món quà) — mở
// form lên rồi đóng thì không để lại gì. Lưu nhật ký thành công hoặc "Huỷ" (có hỏi) thì xoá nháp.
// Chỉ dùng cho GHI MỚI — sửa dòng cũ không lưu nháp (việc trong Workspace có thể đã đổi trong lúc đó).
// Lưu trên máy chứ không phải DB: đây là việc đang làm dở của từng người trên từng máy.
// ============================================================================
import { EMPTY_GIFT_DRAFT, type LogGiftDraft } from './logGift';
import { createSafeStorage, type KeyValueStorage } from './pendingContact';
import { INTERACTION_TYPES, type InteractionType } from './types';

export interface LogDraftFollowUp {
  action: string;
  due: string;
}

export interface LogDraft {
  /** '' = chưa chọn người liên hệ. */
  contactId: string;
  clientId: string | null;
  type: InteractionType;
  occurredAt: string;
  content: string;
  theyInitiated: boolean;
  followUp: LogDraftFollowUp;
  extras: LogDraftFollowUp[];
  gift: LogGiftDraft;
  /** epoch ms lần lưu gần nhất. */
  savedAt: number;
}

export const LOG_DRAFT_KEY = 'lgvn_cskh_log_drafts_v1';
/** Nháp để quá 7 ngày thì bỏ (chắc đã ghi bằng cách khác hoặc không cần nữa). */
export const LOG_DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** Giữ tối đa 20 người gần nhất. */
const MAX_DRAFTS = 20;

type DraftMap = Record<string, LogDraft>;

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const followUpOf = (v: unknown): LogDraftFollowUp => {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  return { action: str(o.action), due: str(o.due) };
};

/** Đọc 1 bản nháp từ JSON — sai định dạng thì null. */
function parseDraft(v: unknown): LogDraft | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (typeof o.savedAt !== 'number' || !Number.isFinite(o.savedAt)) return null;
  const g = (o.gift && typeof o.gift === 'object' ? o.gift : {}) as Record<string, unknown>;
  return {
    contactId: str(o.contactId),
    clientId: typeof o.clientId === 'string' && o.clientId ? o.clientId : null,
    type: INTERACTION_TYPES.includes(o.type as InteractionType) ? o.type as InteractionType : 'call',
    occurredAt: str(o.occurredAt),
    content: str(o.content),
    theyInitiated: o.theyInitiated === true,
    followUp: followUpOf(o.followUp),
    extras: Array.isArray(o.extras) ? o.extras.map(followUpOf) : [],
    gift: {
      direction: g.direction === 'received' ? 'received' : EMPTY_GIFT_DRAFT.direction,
      item: str(g.item),
      value: str(g.value),
      occasionId: str(g.occasionId),
    },
    savedAt: o.savedAt,
  };
}

/** Có chữ đáng giữ không — chỉ đổi hình thức / ngày / tick ô thì không tính. */
export function logDraftHasContent(d: Omit<LogDraft, 'savedAt'>): boolean {
  return !!(
    d.content.trim() || d.followUp.action.trim() || d.extras.some(e => e.action.trim())
    || d.gift.item.trim() || d.gift.value.trim()
  );
}

/** Đọc cả kho nháp, bỏ bản hỏng / hết hạn. */
function readAll(storage: KeyValueStorage, now: number): DraftMap {
  let raw: string | null = null;
  try { raw = storage.getItem(LOG_DRAFT_KEY); } catch { return {}; }
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const out: DraftMap = {};
    for (const [key, v] of Object.entries(parsed as Record<string, unknown>)) {
      const d = parseDraft(v);
      if (d && d.contactId === key && now - d.savedAt <= LOG_DRAFT_MAX_AGE_MS) out[key] = d;
    }
    return out;
  } catch {
    return {}; // nháp hỏng thì mở form trắng, không chặn người dùng làm việc
  }
}

function writeAll(storage: KeyValueStorage, map: DraftMap): void {
  try {
    const kept = Object.values(map).sort((a, b) => b.savedAt - a.savedAt).slice(0, MAX_DRAFTS);
    if (kept.length === 0) storage.removeItem(LOG_DRAFT_KEY);
    else storage.setItem(LOG_DRAFT_KEY, JSON.stringify(Object.fromEntries(kept.map(d => [d.contactId, d]))));
  } catch {
    // hết quota / bị chặn — bỏ qua, nháp chỉ là tiện ích
  }
}

/**
 * Nháp để mở lại form: có `contactId` (mở form cho 1 người) = nháp của đúng người đó;
 * không có (nút "Ghi tương tác" chung) = nháp gõ gần nhất.
 */
export function loadLogDraft(storage: KeyValueStorage, contactId: string | undefined, now: number): LogDraft | null {
  const map = readAll(storage, now);
  if (contactId) return map[contactId] ?? null;
  return Object.values(map).sort((a, b) => b.savedAt - a.savedAt)[0] ?? null;
}

/**
 * Lưu nháp theo người đang chọn. `prevContactId` = khoá lần lưu trước: đổi người giữa chừng thì
 * nháp chuyển theo (xoá khoá cũ). Form không còn chữ → xoá nháp.
 */
export function saveLogDraft(storage: KeyValueStorage, draft: LogDraft, prevContactId: string | null): void {
  const map = readAll(storage, draft.savedAt);
  if (prevContactId !== null && prevContactId !== draft.contactId) delete map[prevContactId];
  if (logDraftHasContent(draft)) map[draft.contactId] = draft;
  else delete map[draft.contactId];
  writeAll(storage, map);
}

export function clearLogDraft(storage: KeyValueStorage, contactId: string, now: number): void {
  const map = readAll(storage, now);
  delete map[contactId];
  writeAll(storage, map);
}

const pad = (n: number) => String(n).padStart(2, '0');

/** "lúc 14:32" (cùng ngày) / "lúc 14:32 ngày 30/10". */
export function logDraftSavedLabel(savedAt: number, now: number): string {
  const d = new Date(savedAt);
  const time = `lúc ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return d.toDateString() === new Date(now).toDateString() ? time : `${time} ngày ${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
}

let sharedStorage: KeyValueStorage | null = null;

export function getLogDraftStorage(): KeyValueStorage {
  if (!sharedStorage) sharedStorage = createSafeStorage();
  return sharedStorage;
}
