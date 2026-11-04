// Khu vực vẽ lên ảnh mặt bằng nhà xưởng (B3, B5 Gia vị, Kho TN…) — phần thuần, có test.
// Toạ độ chuẩn hoá theo khung ảnh: x, y, w, h = 0..1 (ảnh gốc giữ nguyên, khu vực sửa / xoá lúc nào cũng được).
//   Nhãn   : chỉ có x, y = TÂM nhãn.
//   Vùng   : có w, h → x, y = góc trên trái của khung chữ nhật, nhãn nằm giữa khung.

export interface SiteZone {
  id: string;
  /** tên ngắn hiện trên ảnh: "B5", "Kho TN" */
  label: string;
  /** ghi chú ở bảng chú thích: "Gia vị", "H. Nhân", "Kho" */
  note: string;
  color: string;
  x: number;
  y: number;
  w?: number;
  h?: number;
  /** cỡ chữ: 0.75 nhỏ · 1 vừa · 1.4 lớn */
  size?: number;
}

/** Bảng màu nhãn — giống ảnh mặt bằng mẫu (xanh dương, tím, xanh lá, cam, đỏ, xám). */
export const ZONE_COLORS = ['#1D7BF2', '#8B5CF6', '#22A35A', '#F08A12', '#E5484D', '#5B6B83'] as const;
export const ZONE_SIZES = [
  { k: 0.75, label: 'Nhỏ' },
  { k: 1, label: 'Vừa' },
  { k: 1.4, label: 'Lớn' },
] as const;
/** Cỡ chữ nhãn = tỉ lệ này × bề ngang ảnh đang hiện (ảnh to / nhỏ đều đúng tỉ lệ). */
export const LABEL_FONT_RATIO = 0.034;
/** Khung kéo nhỏ hơn mức này (theo cả 2 chiều) thì coi như bấm → tạo nhãn. */
export const MIN_RECT = 0.015;

const MAX_ZONES = 300;
export const isZoneColor = (c: unknown): c is string => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);
const num01 = (n: unknown): number | null => (typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : null);
const r4 = (n: number) => Math.round(n * 10_000) / 10_000;
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');

export function zoneId(): string {
  const a = new Uint8Array(6);
  crypto.getRandomValues(a);
  return Array.from(a, b => b.toString(36).padStart(2, '0')).join('').slice(0, 10);
}

/** Đọc khu vực từ DB (bỏ dòng hỏng, kẹp toạ độ trong ảnh) — dữ liệu sửa được từ nhiều máy nên luôn lọc lại. */
export function sanitizeZones(raw: unknown): SiteZone[] {
  if (!Array.isArray(raw)) return [];
  const out: SiteZone[] = [];
  const seen = new Set<string>();
  for (const z of raw.slice(0, MAX_ZONES)) {
    if (!z || typeof z !== 'object') continue;
    const o = z as Record<string, unknown>;
    const x = num01(o.x), y = num01(o.y);
    if (x == null || y == null) continue;
    let id = str(o.id, 40);
    if (!id || seen.has(id)) id = zoneId();
    seen.add(id);
    const zone: SiteZone = {
      id,
      label: str(o.label, 40),
      note: str(o.note, 300),
      color: isZoneColor(o.color) ? o.color : ZONE_COLORS[0],
      x: r4(x),
      y: r4(y),
    };
    const w = num01(o.w), h = num01(o.h);
    if (w != null && h != null && w >= MIN_RECT && h >= MIN_RECT) {
      zone.w = r4(Math.min(w, 1 - zone.x));
      zone.h = r4(Math.min(h, 1 - zone.y));
    }
    if (typeof o.size === 'number' && Number.isFinite(o.size) && o.size !== 1) zone.size = Math.max(0.5, Math.min(2, o.size));
    out.push(zone);
  }
  return out;
}

const collator = typeof Intl !== 'undefined' ? new Intl.Collator('vi', { numeric: true, sensitivity: 'base' }) : null;

/** Bảng chú thích: A3 < A4 < A6 < B3 < B4 < … < B10 < B14 (so số theo giá trị, không theo chữ). Nhãn trống xuống cuối. */
export function sortZones<T extends { id: string; label: string }>(zones: readonly T[]): T[] {
  return [...zones].sort((a, b) => {
    const la = a.label.trim(), lb = b.label.trim();
    if (!la !== !lb) return la ? -1 : 1;
    const c = collator ? collator.compare(la, lb) : la.localeCompare(lb);
    return c || a.id.localeCompare(b.id);
  });
}

/** Gợi ý tên cho khu vực mới: tiếp số của tên cuối cùng ("B5" → "B6"), chưa có thì "Khu 1". */
export function nextZoneLabel(zones: readonly { label: string }[]): string {
  const taken = new Set(zones.map(z => z.label.trim().toLocaleLowerCase('vi')));
  const last = [...zones].reverse().find(z => /\d+\s*$/.test(z.label.trim()));
  const m = last?.label.trim().match(/^(.*?)(\d+)\s*$/);
  const prefix = m ? m[1] : 'Khu ';
  let n = m ? Number(m[2]) + 1 : 1;
  while (taken.has(`${prefix}${n}`.toLocaleLowerCase('vi'))) n += 1;
  return `${prefix}${n}`;
}

/** Tâm nhãn của một khu vực (nhãn rời = chính điểm đó, vùng = giữa khung). */
export function zoneCenter(z: SiteZone): { x: number; y: number } {
  return z.w != null && z.h != null ? { x: z.x + z.w / 2, y: z.y + z.h / 2 } : { x: z.x, y: z.y };
}

/** Dời khu vực đi (dx, dy), không cho ra khỏi ảnh. */
export function moveZone(z: SiteZone, dx: number, dy: number): SiteZone {
  const w = z.w ?? 0, h = z.h ?? 0;
  return { ...z, x: r4(Math.max(0, Math.min(1 - w, z.x + dx))), y: r4(Math.max(0, Math.min(1 - h, z.y + dy))) };
}

/** Khung chữ nhật từ 2 điểm kéo (kéo theo hướng nào cũng được). */
export function rectFrom(a: { x: number; y: number }, b: { x: number; y: number }): { x: number; y: number; w: number; h: number } {
  const x = Math.max(0, Math.min(a.x, b.x)), y = Math.max(0, Math.min(a.y, b.y));
  return { x: r4(x), y: r4(y), w: r4(Math.min(1, Math.max(a.x, b.x)) - x), h: r4(Math.min(1, Math.max(a.y, b.y)) - y) };
}

/** Đổi cỡ vùng bằng góc dưới phải. */
export function resizeZone(z: SiteZone, corner: { x: number; y: number }): SiteZone {
  if (z.w == null || z.h == null) return z;
  return { ...z, w: r4(Math.max(MIN_RECT, Math.min(1 - z.x, corner.x - z.x))), h: r4(Math.max(MIN_RECT, Math.min(1 - z.y, corner.y - z.y))) };
}
