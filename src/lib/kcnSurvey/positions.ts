// Ngành nghề / vị trí tuyển trên ảnh chỉ tiêu — phần THUẦN (không gọi mạng).
// Ảnh lưu ngành dạng CHỮ trong cột positions ("Nhựa / bao bì, Thợ hàn") → báo cáo / PDF / dữ liệu cũ dùng tiếp.
// Danh mục để chọn nằm ở bảng kcn_survey_positions (migration 225; phần mạng ở positionsApi.ts).
import { foldName } from './stars';

/** Danh mục có sẵn trước migration 225 — dùng khi bảng chưa có (migration 225 nạp đúng danh sách này vào bảng). */
export const POSITION_PRESETS = [
  'Công nhân may', 'Điện tử', 'Gỗ / nội thất', 'Giày da', 'Nhựa / bao bì', 'Thực phẩm', 'Cơ khí', 'Thợ may', 'Thợ hàn', 'Thợ cơ khí / tiện / phay', 'Thợ điện', 'Công nhân sản xuất', 'Công nhân đóng gói',
  'Kỹ thuật / bảo trì', 'QC / kiểm hàng', 'Kho / xuất nhập', 'Lái xe nâng', 'Bảo vệ', 'Tạp vụ / nấu ăn', 'Phiên dịch', 'Văn phòng / kế toán', 'Tuyển nhiều vị trí',
];

/** Khoá so sánh 1 ngành: bỏ dấu, chữ thường, gộp khoảng trắng ("Thợ  Hàn" = "tho han") */
export const positionKey = (s: string) => foldName(s);
export const samePosition = (a: string, b: string) => positionKey(a) === positionKey(b);

export const splitPositions = (s: string) => s.split(/[,;\n]/).map(x => x.trim()).filter(Boolean);

/** Ghép lại thành chuỗi lưu DB — bỏ trùng (giữ cách viết lần đầu). */
export function joinPositions(list: readonly string[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const n = raw.trim();
    const k = positionKey(n);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(n);
  }
  return out.join(', ');
}

export const normalizePositions = (s: string) => joinPositions(splitPositions(s));

export const hasPosition = (s: string, name: string) => splitPositions(s).some(p => samePosition(p, name));

/** Bật / tắt 1 ngành trong chuỗi */
export function togglePosition(s: string, name: string): string {
  const list = splitPositions(s);
  return hasPosition(s, name) ? joinPositions(list.filter(p => !samePosition(p, name))) : joinPositions([...list, name]);
}

/**
 * Thay ngành `from` trong chuỗi vị trí của 1 ảnh bằng `to` (giữ đúng thứ tự); `to` = null → bỏ hẳn ngành đó.
 * Sau khi thay mà trùng ngành sẵn có (gộp 2 ngành làm 1) thì chỉ giữ 1.
 */
export function replacePosition(s: string, from: string, to: string | null): string {
  const list = splitPositions(s);
  if (!list.some(p => samePosition(p, from))) return normalizePositions(s);
  const next = to == null || !to.trim() ? list.filter(p => !samePosition(p, from)) : list.map(p => (samePosition(p, from) ? to.trim() : p));
  return joinPositions(next);
}

// ── Ngành nào đang dùng ở công ty nào (để đổi tên / chọn lại cho đúng ngành) ──
export interface UsagePhoto {
  id: string;
  company_name: string;
  zone_name: string;
  positions: string;
  thumb_url: string | null;
  url: string;
}

export interface UsageCompany {
  /** Khoá gom ảnh theo công ty: tên bỏ dấu; ảnh chưa ghi tên công ty gom chung 1 nhóm */
  key: string;
  name: string;
  zones: string[];
  photos: UsagePhoto[];
}

export interface PositionUsage {
  key: string;
  /** Cách viết gặp nhiều nhất trên ảnh */
  name: string;
  companies: UsageCompany[];
  photoCount: number;
}

export const NO_COMPANY_KEY = '__no_company__';
export const companyKeyOf = (name: string) => positionKey(name) || NO_COMPANY_KEY;

/** Gom: ngành → các công ty đang chọn ngành đó → các ảnh. Công ty xếp theo số ảnh giảm dần. */
export function positionUsage(photos: readonly UsagePhoto[]): Map<string, PositionUsage> {
  const acc = new Map<string, { spell: Map<string, number>; cos: Map<string, UsageCompany>; n: number }>();
  for (const p of photos) {
    const seen = new Set<string>();
    for (const raw of splitPositions(p.positions)) {
      const k = positionKey(raw);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      let a = acc.get(k);
      if (!a) { a = { spell: new Map(), cos: new Map(), n: 0 }; acc.set(k, a); }
      a.spell.set(raw, (a.spell.get(raw) ?? 0) + 1);
      a.n++;
      const ck = companyKeyOf(p.company_name);
      let co = a.cos.get(ck);
      if (!co) { co = { key: ck, name: p.company_name.trim(), zones: [], photos: [] }; a.cos.set(ck, co); }
      co.photos.push(p);
      if (p.zone_name && !co.zones.includes(p.zone_name)) co.zones.push(p.zone_name);
    }
  }
  const out = new Map<string, PositionUsage>();
  for (const [k, a] of acc) {
    const name = [...a.spell.entries()].sort((x, y) => y[1] - x[1])[0][0];
    const companies = [...a.cos.values()].sort((x, y) => y.photos.length - x.photos.length || x.name.localeCompare(y.name, 'vi'));
    out.set(k, { key: k, name, companies, photoCount: a.n });
  }
  return out;
}

/**
 * Kế hoạch sửa chữ ngành trên ảnh: mỗi công ty chọn ngành mới (string) hoặc bỏ (null); công ty không có trong
 * `targets` dùng `fallback`. Chỉ trả các ảnh thực sự đổi.
 */
export function planPositionChange(usage: PositionUsage, targets: ReadonlyMap<string, string | null>, fallback: string | null): { id: string; positions: string }[] {
  const out: { id: string; positions: string }[] = [];
  for (const co of usage.companies) {
    const to = targets.has(co.key) ? targets.get(co.key)! : fallback;
    for (const p of co.photos) {
      const next = replacePosition(p.positions, usage.name, to);
      if (next !== p.positions) out.push({ id: p.id, positions: next });
    }
  }
  return out;
}
