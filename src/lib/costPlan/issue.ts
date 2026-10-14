// "ĐÃ BAN HÀNH" (đã gửi khách) của Phương án giá — tách bạch bản đã gửi khách với các bản nháp.
//
// Không cần migration: mỗi lần gửi khách ghi 1 bản ghi vào `PlanData.issues` (ngày gửi, người nhận, kênh, số báo giá, người
// đánh dấu) kèm DẤU VÂN TAY nội dung báo giá lúc gửi (các dòng giá, giá 1 công, bảo hiểm thu riêng, số / ngày / hiệu lực báo
// giá). Sau đó ai sửa làm nội dung khác đi → hiện "Đã sửa sau khi gửi khách" (khách chưa nhận bản này); gửi lại thì "Ban hành lại".
// Trạng thái hiển thị (`planStage`): Lưu trữ > Đã ban hành > Đã chốt > Nháp.
import { computePlan, normalizePlanData, summarizePlan } from './engine';
import { computePriceList, effectiveResult, includedNoteAuto, normalizeQuoteSheet } from './quoteSheet';
import type { PlanData, PlanStatus } from './types';

export type IssueChannel = 'email' | 'zalo' | 'direct' | 'other';
export const ISSUE_CHANNEL_LABEL: Record<IssueChannel, string> = { email: 'Email', zalo: 'Zalo', direct: 'Gửi trực tiếp', other: 'Khác' };

export interface PlanIssue {
  /** Ngày gửi khách, yyyy-mm-dd */
  date: string;
  /** Số báo giá đã gửi (theo tài liệu báo giá lúc đó) */
  number?: string;
  /** Người nhận bên khách */
  to?: string;
  channel?: IssueChannel;
  note?: string;
  /** Người đánh dấu + thời điểm đánh dấu (ISO) */
  by?: string | null;
  at: string;
  /** Dấu vân tay nội dung báo giá lúc gửi — so với hiện tại để biết đã sửa sau khi gửi chưa */
  fingerprint: string;
}

export type PlanStage = 'draft' | 'final' | 'issued' | 'archived';
export const STAGE_LABEL: Record<PlanStage, string> = { draft: 'Nháp', final: 'Đã chốt', issued: 'Đã ban hành', archived: 'Lưu trữ' };

const CHANNELS: IssueChannel[] = ['email', 'zalo', 'direct', 'other'];
const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Làm sạch danh sách lần ban hành đọc từ DB (có thể thiếu / hỏng). */
export function cleanIssues(raw: unknown): PlanIssue[] {
  if (!Array.isArray(raw)) return [];
  const out: PlanIssue[] = [];
  for (const x of raw.slice(-50)) {
    if (!x || typeof x !== 'object') continue;
    const o = x as Record<string, unknown>;
    const date = str(o.date, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    out.push({
      date, at: str(o.at, 40) || `${date}T00:00:00.000Z`, fingerprint: str(o.fingerprint, 40),
      ...(str(o.number) ? { number: str(o.number) } : {}),
      ...(str(o.to) ? { to: str(o.to) } : {}),
      ...(CHANNELS.includes(o.channel as IssueChannel) ? { channel: o.channel as IssueChannel } : {}),
      ...(str(o.note, 500) ? { note: str(o.note, 500) } : {}),
      ...(str(o.by) ? { by: str(o.by) } : {}),
    });
  }
  return out;
}

/** Lần ban hành gần nhất (null = chưa gửi khách lần nào). */
export const latestIssue = (data: Pick<PlanData, 'issues'> | null | undefined): PlanIssue | null => {
  const l = cleanIssues(data?.issues);
  return l.length ? l[l.length - 1] : null;
};

/** Trạng thái hiển thị của phương án. */
export function planStage(p: { status: PlanStatus; data?: Pick<PlanData, 'issues'> | null }): PlanStage {
  if (p.status === 'archived') return 'archived';
  if (latestIssue(p.data)) return 'issued';
  return p.status === 'final' ? 'final' : 'draft';
}

/** Băm ngắn (djb2) — đủ để so 2 nội dung có khác nhau không. */
function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/**
 * Dấu vân tay NỘI DUNG KHÁCH NHẬN: các dòng giá đang hiện (tên, đơn vị, giá, giá thợ), giá 1 công đang báo, bảo hiểm thu riêng,
 * ghi chú trên báo giá, số / ngày / hiệu lực báo giá. Sửa ghi chú nội bộ, chia lợi nhuận, quy mô… không làm đổi.
 */
export function quoteFingerprint(input: PlanData): string {
  const data = normalizePlanData(input);
  const r = computePlan(data);
  const d = data.doc;
  const docPart = d ? [d.number, d.date, d.validUntil, d.customer?.name ?? ''] : null;
  if (data.service === 'referral') {
    const s = summarizePlan(data, r);
    return hash(JSON.stringify({ s: [s.feeText ?? '', s.termText ?? ''], ref: data.referral ?? null, doc: docPart }));
  }
  const eff = effectiveResult(data, r);
  const q = normalizeQuoteSheet(data.quote);
  const rows = computePriceList(data, r).rows.filter(x => !x.hidden).map(x => [x.name, x.unit, x.price, x.skilled?.price ?? null]);
  return hash(JSON.stringify({
    rows, day: Math.round(eff.quoteDaily), ins: Math.round(r.separatedMonthly), minDays: r.separateMinDays,
    inc: q.includedNote ?? includedNoteAuto(data), notes: q.generalNotes, doc: docPart,
  }));
}

/** Đã sửa nội dung báo giá sau lần gửi khách gần nhất? (null = chưa ban hành) */
export function changedSinceIssue(data: PlanData): boolean | null {
  const last = latestIssue(data);
  if (!last) return null;
  return !last.fingerprint || last.fingerprint !== quoteFingerprint(data);
}

/** Thêm 1 lần ban hành (ghi dấu vân tay của chính nội dung đang gửi). */
export function addIssue(data: PlanData, info: Omit<PlanIssue, 'fingerprint' | 'at'> & { at?: string }): PlanData {
  const rec: PlanIssue = { ...info, at: info.at ?? new Date().toISOString(), fingerprint: quoteFingerprint(data) };
  return { ...data, issues: [...cleanIssues(data.issues), ...cleanIssues([rec])] };
}

/** Bỏ lần ban hành gần nhất (đánh dấu nhầm). */
export function removeLastIssue(data: PlanData): PlanData {
  const l = cleanIssues(data.issues).slice(0, -1);
  const out: PlanData = { ...data, issues: l };
  if (!l.length) delete out.issues;
  return out;
}
