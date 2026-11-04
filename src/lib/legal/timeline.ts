// Pháp lý — tính toán thuần cho Dòng thời gian pháp nhân, cảnh báo giấy phép, tiền tệ. Có test (timeline.test.ts).
import { aspectLabel, CHANGE_ASPECTS, MILESTONE_KINDS, type LegalEntity, type LegalLicense, type LegalMilestone, type MilestoneChange, type MilestoneKind } from './types';

const DAY = 86_400_000;

/** yyyy-mm-dd → số ngày (UTC) để so sánh, không lệch múi giờ. */
function dayNum(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return Date.UTC(y, (m || 1) - 1, d || 1) / DAY;
}
export const todayIso = (now = new Date()) => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

/** Mới nhất trước (cùng ngày: tạo sau đứng trước). */
export function sortMilestones<T extends Pick<LegalMilestone, 'event_date' | 'created_at'>>(list: T[], dir: 'desc' | 'asc' = 'desc'): T[] {
  const k = dir === 'desc' ? -1 : 1;
  return [...list].sort((a, b) => (a.event_date === b.event_date ? a.created_at.localeCompare(b.created_at) : a.event_date.localeCompare(b.event_date)) * k);
}

/**
 * Số "lần thay đổi" gợi ý cho 1 lần đăng ký thay đổi ĐKKD đặt ở ngày `date`:
 * số lần thay đổi đã có số TRƯỚC ngày đó (lấy số lớn nhất, hoặc đếm nếu chưa đánh số) + 1.
 */
export function suggestChangeNo(list: LegalMilestone[], entityId: string, date: string, excludeId?: string | null): number {
  const prev = list.filter(m => m.entity_id === entityId && m.kind === 'thay_doi' && m.id !== excludeId && !m.deleted_at && m.event_date <= date);
  const maxNo = prev.reduce((mx, m) => Math.max(mx, m.change_no ?? 0), 0);
  return Math.max(maxNo, prev.length) + 1;
}

export function defaultMilestoneTitle(kind: MilestoneKind, changeNo: number | null): string {
  if (kind === 'thay_doi') return changeNo ? `Đăng ký thay đổi lần thứ ${changeNo}` : 'Đăng ký thay đổi';
  if (kind === 'thanh_lap') return 'Thành lập doanh nghiệp';
  return MILESTONE_KINDS[kind].label;
}

/** Tóm tắt 1 dòng các nội dung thay đổi: "Địa chỉ trụ sở, Vốn điều lệ". */
export function changesSummary(changes: MilestoneChange[]): string {
  return [...new Set(changes.map(c => aspectLabel(c.aspect)))].join(', ');
}

export function groupByYear<T extends Pick<LegalMilestone, 'event_date'>>(sorted: T[]): { year: string; items: T[] }[] {
  const out: { year: string; items: T[] }[] = [];
  for (const m of sorted) {
    const y = m.event_date.slice(0, 4);
    const last = out[out.length - 1];
    if (last && last.year === y) last.items.push(m);
    else out.push({ year: y, items: [m] });
  }
  return out;
}

/** "5 năm 3 tháng" kể từ ngày thành lập. */
export function companyAge(founded: string | null, today = todayIso()): string {
  if (!founded) return '';
  const [y1, m1, d1] = founded.split('-').map(Number);
  const [y2, m2, d2] = today.split('-').map(Number);
  let months = (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0);
  if (months < 0) return '';
  const years = Math.floor(months / 12);
  months %= 12;
  if (!years && !months) return 'dưới 1 tháng';
  return [years ? `${years} năm` : '', months ? `${months} tháng` : ''].filter(Boolean).join(' ');
}

export interface LicenseAlert { entity: LegalEntity; license: LegalLicense; daysLeft: number }

/** Giấy phép con đã hết hạn hoặc hết hạn trong `withinDays` ngày tới — gần hết hạn nhất trước. */
export function licenseAlerts(entities: LegalEntity[], today = todayIso(), withinDays = 90): LicenseAlert[] {
  const t = dayNum(today);
  const out: LicenseAlert[] = [];
  for (const e of entities) {
    if (e.deleted_at || e.status === 'dissolved') continue;
    for (const l of e.info.licenses) {
      if (!/^\d{4}-\d{2}-\d{2}/.test(l.expires)) continue;
      const left = Math.round(dayNum(l.expires) - t);
      if (left <= withinDays) out.push({ entity: e, license: l, daysLeft: left });
    }
  }
  return out.sort((a, b) => a.daysLeft - b.daysLeft);
}

export function licenseState(expires: string, today = todayIso()): { label: string; tint: 'red' | 'orange' | 'green' | 'gray' } {
  if (!/^\d{4}-\d{2}-\d{2}/.test(expires)) return { label: 'Không thời hạn', tint: 'gray' };
  const left = Math.round(dayNum(expires) - dayNum(today));
  if (left < 0) return { label: `Hết hạn ${-left} ngày`, tint: 'red' };
  if (left <= 90) return { label: `Còn ${left} ngày`, tint: 'orange' };
  return { label: `Hạn ${fmtDate(expires)}`, tint: 'green' };
}

/** dd/mm/yyyy */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

/** 5000000000 → "5.000.000.000 đ" · kèm cách đọc ngắn "5 tỷ". */
export function fmtMoney(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '';
  return `${Math.round(v).toLocaleString('vi-VN')} đ`;
}
export function fmtMoneyShort(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '';
  const abs = Math.abs(v);
  const trim = (n: number) => n.toLocaleString('vi-VN', { maximumFractionDigits: 2 });
  if (abs >= 1e9) return `${trim(v / 1e9)} tỷ`;
  if (abs >= 1e6) return `${trim(v / 1e6)} triệu`;
  return `${Math.round(v).toLocaleString('vi-VN')} đ`;
}

/**
 * Đọc số tiền người dùng gõ: "5.000.000.000", "5,000,000,000", "5 tỷ", "1,5 tỷ", "800 triệu", "800tr".
 * null = ô trống / không đọc được.
 */
export function parseMoney(raw: string): number | null {
  const s = raw.trim().toLowerCase().replace(/\s+/g, ' ').replace(/đồng|vnđ|vnd|đ$/g, '').trim();
  if (!s) return null;
  // \b không hiểu chữ có dấu ("tỷ") → dùng lookaround theo chữ Unicode
  const word = (w: string) => new RegExp(`(?<!\\p{L})(${w})(?!\\p{L})`, 'u');
  const unit = word('tỷ|ty|tỉ|ti').test(s) ? 1e9 : word('triệu|trieu|tr').test(s) ? 1e6 : word('nghìn|ngàn|k').test(s) ? 1e3 : 1;
  let num = s.replace(/[^\d.,]/g, '');
  if (!num) return null;
  if (unit > 1) {
    // có đơn vị: dấu , hoặc . là phần thập phân ("1,5 tỷ")
    num = num.replace(',', '.');
    const n = Number(num.replace(/\.(?=.*\.)/g, ''));
    return Number.isFinite(n) ? Math.round(n * unit) : null;
  }
  // không đơn vị: . và , là phân cách nghìn
  const n = Number(num.replace(/[.,]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** Phần trăm vốn của từng thành viên (nhập % thì dùng, không thì tính từ số vốn / tổng). */
export function ownerShares(owners: LegalEntity['info']['owners'], charter: number | null): { id: string; name: string; pct: number }[] {
  const total = charter && charter > 0 ? charter : owners.reduce((s, o) => s + (o.capital ?? 0), 0);
  return owners.map(o => ({
    id: o.id,
    name: o.name,
    pct: o.percent != null ? o.percent : total > 0 && o.capital != null ? Math.round((o.capital / total) * 10000) / 100 : 0,
  }));
}

/**
 * Áp nội dung thay đổi vào hồ sơ hiện tại của pháp nhân: chỉ các mục có cột tương ứng (tên, địa chỉ, vốn, người đại diện,
 * loại hình, tên tiếng Anh) và giá trị mới không trống. Trả về phần cần sửa (rỗng = không có gì để ghi).
 */
export function entityPatchFromChanges(changes: MilestoneChange[]): Partial<Pick<LegalEntity, 'name' | 'english_name' | 'address' | 'charter_capital' | 'legal_rep' | 'business_type'>> {
  const patch: Record<string, string | number | null> = {};
  for (const c of changes) {
    const field = CHANGE_ASPECTS.find(a => a.key === c.aspect)?.field;
    const to = c.to.trim();
    if (!field || !to) continue;
    if (field === 'charter_capital') {
      const n = parseMoney(to);
      if (n != null) patch.charter_capital = n;
    } else {
      patch[field] = to;
    }
  }
  return patch;
}

/** Giá trị hiện tại của pháp nhân cho 1 nội dung thay đổi (điền sẵn ô "Trước"). */
export function currentValueFor(entity: LegalEntity, aspect: string): string {
  switch (aspect) {
    case 'name': return entity.name;
    case 'english_name': return entity.english_name;
    case 'address': return entity.address;
    case 'capital': return entity.charter_capital != null ? fmtMoney(entity.charter_capital) : '';
    case 'legal_rep': return [entity.legal_rep, entity.legal_rep_title].filter(Boolean).join(' – ');
    case 'type': return entity.business_type;
    case 'owners': return entity.info.owners.map(o => o.name).filter(Boolean).join(', ');
    case 'industries': return entity.info.industries.filter(i => i.main).map(i => [i.code, i.name].filter(Boolean).join(' ')).join(', ');
    default: return '';
  }
}

/** Chữ viết tắt cho ô logo: "Let's Go Việt Nam" → "LG". */
export function initials(name: string): string {
  const words = name.replace(/^(công ty|cty)\s+(tnhh|cổ phần|cp)?\s*(một thành viên|mtv|hai thành viên trở lên)?\s*/i, '')
    .split(/[\s\-–]+/).filter(w => /[\p{L}\d]/u.test(w));
  const s = words.slice(0, 2).map(w => w.replace(/[^\p{L}\d]/gu, '').charAt(0)).join('');
  return (s || name.charAt(0) || '?').toUpperCase();
}
