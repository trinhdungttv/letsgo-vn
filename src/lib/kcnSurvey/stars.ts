// Sao "công ty cần chú trọng" khi khảo sát KCN (migration 195) + Lưu trữ 30 ngày — hàm thuần, test được.
//
// Sao gắn ở mức CÔNG TY (không phải từng ảnh): 1 công ty có thể là khách hàng / pipeline / công ty Thị trường, hoặc
// chỉ là tên gõ tay trên ảnh. Khoá: c:<client> > p:<pipeline> > l:<lead> > n:<tên bỏ dấu>@<KCN>.

export interface StarRef {
  clientId?: string | null;
  crmId?: string | null;
  leadId?: string | null;
  name: string;
  zoneId?: string | null;
}

export interface SurveyStar {
  id: string;
  company_key: string;
  company_name: string;
  client_id: string | null;
  crm_id: string | null;
  lead_id: string | null;
  zone_id: string | null;
  zone_name: string;
  note: string;
  user_id: string | null;
  user_name: string;
  created_at: string;
}

/** Bỏ dấu, chữ thường, gộp khoảng trắng — so tên công ty. */
export const foldName = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/\s+/g, ' ').trim();

export function starKey(c: StarRef): string {
  if (c.clientId) return `c:${c.clientId}`;
  if (c.crmId) return `p:${c.crmId}`;
  if (c.leadId) return `l:${c.leadId}`;
  return `n:${foldName(c.name)}@${c.zoneId ?? ''}`;
}

/** Sao của 1 công ty: khớp theo mã khách hàng / pipeline / Thị trường, hoặc cùng tên (bỏ dấu). */
export function findStar(stars: readonly SurveyStar[], c: StarRef): SurveyStar | null {
  const name = foldName(c.name);
  return stars.find(s =>
    (!!c.clientId && s.client_id === c.clientId)
    || (!!c.crmId && s.crm_id === c.crmId)
    || (!!c.leadId && s.lead_id === c.leadId)
    || (!!name && foldName(s.company_name) === name)) ?? null;
}

/** Ảnh chỉ tiêu → công ty để tra sao. */
export const photoStarRef = (p: { client_id: string | null; crm_id: string | null; lead_id: string | null; company_name: string; zone_id: string | null }): StarRef =>
  ({ clientId: p.client_id, crmId: p.crm_id, leadId: p.lead_id, name: p.company_name, zoneId: p.zone_id });

// ── Lưu trữ ──────────────────────────────────────────────────────────────────
/** Mục đã xoá giữ trong Lưu trữ bấy nhiêu ngày rồi tự xoá hẳn (khớp hàm kcn_survey_purge_archive). */
export const ARCHIVE_DAYS = 30;

/** Còn bao nhiêu ngày trước khi tự xoá hẳn (làm tròn lên; 0 = sẽ xoá ở lần mở tab tới). */
export function daysLeft(deletedAt: string, now = Date.now(), keepDays = ARCHIVE_DAYS): number {
  const t = new Date(deletedAt).getTime();
  if (!Number.isFinite(t)) return keepDays;
  return Math.max(0, Math.ceil((t + keepDays * 86_400_000 - now) / 86_400_000));
}

// ── Nhóm chuyến theo ngày (tab Chuyến đi) ────────────────────────────────────
const WEEKDAY = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];

/** "Thứ Ba, 04/11/2026" (giờ máy). */
export function dayLabel(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0'), mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${WEEKDAY[d.getDay()]}, ${dd}/${mm}/${d.getFullYear()}`;
}

const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Gom các mục theo ngày (giờ máy), giữ thứ tự đầu vào trong mỗi ngày; ngày mới nhất trước. */
export function groupByDay<T>(items: readonly T[], at: (x: T) => string): { key: string; label: string; items: T[] }[] {
  const m = new Map<string, { key: string; label: string; items: T[] }>();
  for (const it of items) {
    const d = new Date(at(it));
    const k = dayKey(d);
    let g = m.get(k);
    if (!g) { g = { key: k, label: dayLabel(d), items: [] }; m.set(k, g); }
    g.items.push(it);
  }
  return [...m.values()].sort((a, b) => b.key.localeCompare(a.key));
}
