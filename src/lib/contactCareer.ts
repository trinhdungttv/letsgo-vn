// ============================================================================
// Quá trình công tác của người liên hệ — dựng từ lịch sử gắn / gỡ / chuyển công ty
// (bảng contact_client_history, migration 142 + 197). Hàm thuần, có test.
// ----------------------------------------------------------------------------
// Bối cảnh (04/11/2026): khách nghỉ công ty 1 sang làm công ty 2. Luồng "Chuyển công ty"
// (contactOps.moveContactCompany) gỡ công ty cũ, gắn công ty mới và ghi MỘT dòng lịch sử
// from → to kèm chức vụ cũ / mới, ngày bắt đầu ở công ty cũ, ngày chuyển (cột migration 197).
// Người liên hệ vẫn là 1 bản ghi: hạng CSKH, nhật ký, quà, ngày quan trọng giữ nguyên.
// DB chưa chạy 197 → các cột mới không có; mốc lấy theo changed_at, chức vụ cũ nằm trong note.
// ============================================================================
import type { ContactClientHistory } from './types';
import { todayVN } from './cskh/dates';

/** Dòng lịch sử, kèm cột của migration 197 (chưa chạy thì không có). */
export interface CareerHistoryRow extends ContactClientHistory {
  from_role?: string | null;
  to_role?: string | null;
  /** Ngày bắt đầu làm ở công ty cũ (chốt lúc chuyển). */
  from_started_on?: string | null;
  /** Ngày chuyển = ngày rời công ty cũ / bắt đầu công ty mới. */
  effective_on?: string | null;
}

/** Một quãng làm việc ở 1 công ty. */
export interface CareerPeriod {
  clientId: string | null;
  clientName: string;
  /** Chức vụ trong quãng này ('' = không rõ). */
  role: string;
  /** "YYYY-MM-DD" | null = không rõ. */
  from: string | null;
  /** null khi đang làm (current) hoặc không rõ ngày rời. */
  to: string | null;
  /** Đang làm ở đây (còn dòng nối contact_clients). */
  current: boolean;
  /** Rời đi bằng "Chuyển công ty" → tên công ty mới. */
  movedToName: string | null;
}

/** Ngày (giờ VN) của 1 dòng lịch sử: ngày chuyển nếu có, không thì ngày ghi. */
export function historyDate(row: Pick<CareerHistoryRow, 'effective_on' | 'changed_at'>): string {
  if (row.effective_on && /^\d{4}-\d{2}-\d{2}/.test(row.effective_on)) return row.effective_on.slice(0, 10);
  const t = new Date(row.changed_at);
  return Number.isNaN(t.getTime()) ? row.changed_at.slice(0, 10) : todayVN(t);
}

/** Chức vụ cũ / ngày bắt đầu ghi trong note khi DB chưa có cột migration 197 (xem moveFallbackNote). */
const NOTE_ROLE_RE = /Chức vụ cũ:\s*([^;·\n]+)/;
const NOTE_FROM_RE = /làm từ (\d{2})\/(\d{2})\/(\d{4})/;

/** Chức vụ cũ + ngày bắt đầu ở công ty cũ của 1 mốc: cột 197, không có thì đọc ghi chú. */
function fromDetails(r: CareerHistoryRow): { role: string; startedOn: string | null } {
  const note = r.note ?? '';
  const m = NOTE_FROM_RE.exec(note);
  return {
    role: (r.from_role ?? '').trim() || (NOTE_ROLE_RE.exec(note)?.[1]?.trim() ?? ''),
    startedOn: r.from_started_on ?? (m ? `${m[3]}-${m[2]}-${m[1]}` : null),
  };
}

export interface CareerInput {
  /** Chức vụ hiện tại (contacts.role). */
  role: string | null;
  /** "Phụ trách từ ngày" (contacts.start_date). */
  startDate: string | null;
  /** Công ty đang gắn (contact_clients). */
  links: readonly { clientId: string; clientName: string; createdAt?: string | null }[];
  history: readonly CareerHistoryRow[];
}

/**
 * Dựng quá trình công tác: đi lần lượt các mốc lịch sử (cũ → mới), mở / đóng quãng làm việc
 * theo từng công ty; công ty đang gắn mà chưa có mốc nào thì mở từ "Phụ trách từ ngày" (người
 * 1 công ty) hoặc ngày gắn trong hệ thống. Kết quả: đang làm trước, rồi mới rời trước.
 */
export function buildCareer(input: CareerInput): CareerPeriod[] {
  const rows = [...input.history].sort((a, b) =>
    historyDate(a).localeCompare(historyDate(b)) || a.changed_at.localeCompare(b.changed_at));
  const open = new Map<string, CareerPeriod>();   // key = clientId (hoặc tên khi công ty đã xoá)
  const done: CareerPeriod[] = [];
  const keyOf = (id: string | null, name: string | null) => id ?? `name:${(name ?? '').trim().toLowerCase()}`;

  for (const r of rows) {
    const date = historyDate(r);
    const isMove = !!(r.from_client_id || r.from_client_name) && !!(r.to_client_id || r.to_client_name);
    if (r.from_client_id || r.from_client_name) {
      const k = keyOf(r.from_client_id, r.from_client_name);
      const was = open.get(k);
      open.delete(k);
      const d = fromDetails(r);
      done.push({
        clientId: r.from_client_id,
        clientName: r.from_client_name || was?.clientName || 'Công ty đã xoá',
        role: d.role || was?.role || '',
        from: was?.from ?? d.startedOn,
        to: date,
        current: false,
        movedToName: isMove ? r.to_client_name || 'công ty khác' : null,
      });
    }
    if (r.to_client_id || r.to_client_name) {
      const k = keyOf(r.to_client_id, r.to_client_name);
      if (!open.has(k)) {
        open.set(k, {
          clientId: r.to_client_id, clientName: r.to_client_name || 'Công ty', role: (r.to_role ?? '').trim(),
          from: date, to: null, current: false, movedToName: null,
        });
      }
    }
  }

  const linkIds = new Set(input.links.map(l => l.clientId));
  const single = input.links.length === 1;
  const current: CareerPeriod[] = input.links.map(l => {
    const was = open.get(l.clientId);
    return {
      clientId: l.clientId,
      clientName: l.clientName || was?.clientName || 'Công ty',
      role: (input.role ?? '').trim() || was?.role || '',
      from: was?.from ?? (single && input.startDate ? input.startDate : l.createdAt ? todayVN(new Date(l.createdAt)) : input.startDate),
      to: null,
      current: true,
      movedToName: null,
    };
  });
  // Mốc "gắn vào" còn mở mà không còn dòng nối (gỡ từ trước khi có lịch sử / công ty đã xoá) → đã rời, không rõ ngày
  for (const p of open.values()) if (!(p.clientId && linkIds.has(p.clientId))) done.push({ ...p });

  done.sort((a, b) => (b.to ?? '').localeCompare(a.to ?? '') || (b.from ?? '').localeCompare(a.from ?? ''));
  return [...current, ...done];
}

/** "03/2024 → 31/10/2026" · "từ 01/11/2026" · "không rõ thời gian". */
export function periodLabel(p: Pick<CareerPeriod, 'from' | 'to' | 'current'>): string {
  const f = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
  if (p.current) return p.from ? `từ ${f(p.from)} · đang làm` : 'đang làm';
  if (p.from && p.to) return `${f(p.from)} → ${f(p.to)}`;
  if (p.to) return `đến ${f(p.to)}`;
  return p.from ? `từ ${f(p.from)}` : 'không rõ thời gian';
}

// ── Phía công ty: người liên hệ đã chuyển đi ────────────────────────────────
export interface MovedAway {
  contactId: string;
  role: string;
  /** Làm ở công ty này từ ngày (nếu biết). */
  from: string | null;
  /** Ngày chuyển đi. */
  movedOn: string;
  toClientId: string | null;
  toClientName: string;
}

/**
 * Người từng làm ở `clientId` rồi chuyển sang công ty khác (mốc from = clientId, to ≠ null) —
 * lấy mốc chuyển đi MỚI NHẤT của mỗi người, bỏ người hiện vẫn đang gắn với công ty này.
 */
export function movedAwayFrom(
  rows: readonly (CareerHistoryRow & { contact_id: string })[],
  clientId: string,
  stillLinkedIds: ReadonlySet<string>,
): MovedAway[] {
  const latest = new Map<string, MovedAway>();
  for (const r of rows) {
    if (r.from_client_id !== clientId || !(r.to_client_id || r.to_client_name) || stillLinkedIds.has(r.contact_id)) continue;
    const movedOn = historyDate(r);
    const prev = latest.get(r.contact_id);
    if (prev && prev.movedOn >= movedOn) continue;
    const d = fromDetails(r);
    latest.set(r.contact_id, {
      contactId: r.contact_id,
      role: d.role,
      from: d.startedOn,
      movedOn,
      toClientId: r.to_client_id,
      toClientName: r.to_client_name || 'công ty khác',
    });
  }
  return [...latest.values()].sort((a, b) => b.movedOn.localeCompare(a.movedOn));
}

// ── Kiểm tra form "Chuyển công ty" ──────────────────────────────────────────
export interface MoveCompanyCheck {
  fromClientId: string | null;
  /** Công ty có sẵn; null khi tạo mới. */
  toClientId: string | null;
  /** Tên công ty mới khi tạo mới. */
  newCompanyName: string;
  effectiveOn: string;
}

/** Lỗi của form chuyển công ty (null = hợp lệ). `today` "YYYY-MM-DD" giờ VN. */
export function moveCompanyError(m: MoveCompanyCheck, today: string): string | null {
  if (!m.toClientId && !m.newCompanyName.trim()) return 'Chọn công ty mới, hoặc gõ tên để tạo công ty mới';
  if (m.toClientId && m.toClientId === m.fromClientId) return 'Công ty mới trùng công ty đang rời';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(m.effectiveOn)) return 'Chọn ngày chuyển';
  if (m.effectiveOn > today) return 'Ngày chuyển không được ở tương lai';
  return null;
}

/** Ghi chú lịch sử khi DB chưa có cột migration 197 — giữ được chức vụ cũ / ngày bắt đầu. */
export function moveFallbackNote(o: { fromRole: string; fromStartedOn: string | null; note: string }): string {
  const f = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
  return [
    'Chuyển công ty',
    o.fromRole.trim() ? `Chức vụ cũ: ${o.fromRole.trim()}` : '',
    o.fromStartedOn ? `làm từ ${f(o.fromStartedOn)}` : '',
    o.note.trim(),
  ].filter(Boolean).join('; ');
}

/** So tên công ty không dấu, không phân biệt hoa thường — để lọc ô chọn công ty. */
export function foldVN(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Chữ chung của tên công ty — bỏ khi lọc ("Cty Foxconn" vẫn ra "Công ty TNHH Foxconn"). */
const COMPANY_FILLER = new Set(['cong', 'ty', 'cty', 'tnhh', 'mtv', 'ctcp']);

/** Tên công ty có khớp chữ đang gõ không: mọi từ (trừ chữ chung) đều có trong tên, không dấu. */
export function companyNameMatches(name: string, query: string): boolean {
  const q = foldVN(query);
  const words = q.split(' ').filter(w => w && !COMPANY_FILLER.has(w));
  const target = foldVN(name);
  return words.length === 0 ? target.includes(q) : words.every(w => target.includes(w));
}
