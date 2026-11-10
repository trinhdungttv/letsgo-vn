// Nét vẽ trên ảnh 360° (giống "Mặt bằng" của khách hàng): nhãn chữ, đường, vùng khoanh — mỗi cái có tên, ghi chú,
// màu, cỡ chữ. Toạ độ theo hướng TRONG ẢNH (yaw / pitch, xem sphere.ts) nên căn lại hướng Bắc không làm lệch nét vẽ.
// Phần thuần, có test (pano.test.ts).
import { ZONE_COLORS, isZoneColor, zoneId } from '../clientMaps/siteZones';
import { centroid, clamp, pathMidpoint, wrapYaw, type SphPt } from './sphere';

export type PanoShapeKind = 'label' | 'line' | 'area';

export interface PanoShape {
  id: string;
  kind: PanoShapeKind;
  /** tên ngắn hiện trên ảnh: "Cty ABC", "Lô C5" */
  label: string;
  /** ghi chú ở bảng chú thích: "đang xây", "may mặc ~800 LĐ" */
  note: string;
  color: string;
  /** cỡ chữ: 0.75 nhỏ · 1 vừa · 1.4 lớn */
  size?: number;
  /** nhãn: 1 điểm · đường: ≥ 2 · vùng: ≥ 3 */
  pts: SphPt[];
}

export const MIN_PTS: Record<PanoShapeKind, number> = { label: 1, line: 2, area: 3 };
const MAX_SHAPES = 300;
const MAX_PTS = 200;

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
const r3 = (n: number) => Math.round(n * 1000) / 1000;

export function sanitizePt(raw: unknown): SphPt | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.yaw !== 'number' || typeof o.pitch !== 'number' || !Number.isFinite(o.yaw) || !Number.isFinite(o.pitch)) return null;
  return { yaw: r3(wrapYaw(o.yaw)), pitch: r3(clamp(o.pitch, -90, 90)) };
}

/** Làm tròn 1 điểm (0,001° ≈ vài mm ở 100 m — đủ chính xác, JSON gọn). */
export function roundPt(p: SphPt): SphPt {
  return { yaw: r3(wrapYaw(p.yaw)), pitch: r3(clamp(p.pitch, -90, 90)) };
}

/** Đọc nét vẽ từ DB (bỏ dòng hỏng) — dữ liệu sửa được từ nhiều máy nên luôn lọc lại. */
export function sanitizeShapes(raw: unknown): PanoShape[] {
  if (!Array.isArray(raw)) return [];
  const out: PanoShape[] = [];
  const seen = new Set<string>();
  for (const s of raw.slice(0, MAX_SHAPES)) {
    if (!s || typeof s !== 'object') continue;
    const o = s as Record<string, unknown>;
    const kind: PanoShapeKind = o.kind === 'line' || o.kind === 'area' ? o.kind : 'label';
    const pts = (Array.isArray(o.pts) ? o.pts.slice(0, MAX_PTS) : []).map(sanitizePt).filter((p): p is SphPt => !!p);
    if (pts.length < MIN_PTS[kind]) continue;
    let id = str(o.id, 40);
    if (!id || seen.has(id)) id = zoneId();
    seen.add(id);
    const shape: PanoShape = {
      id, kind,
      label: str(o.label, 60),
      note: str(o.note, 300),
      color: isZoneColor(o.color) ? o.color : ZONE_COLORS[0],
      pts: kind === 'label' ? pts.slice(0, 1) : pts,
    };
    if (typeof o.size === 'number' && Number.isFinite(o.size) && o.size !== 1) shape.size = clamp(o.size, 0.5, 2);
    out.push(shape);
  }
  return out;
}

/** Gợi ý tên cho nét mới. Vùng / nhãn: "Cty 1", "Cty 2"…; đường: "Đường 1"… (tiếp số của tên cuối cùng cùng loại). */
export function nextShapeLabel(shapes: readonly PanoShape[], kind: PanoShapeKind): string {
  const same = shapes.filter(s => (s.kind === 'line') === (kind === 'line'));
  const taken = new Set(shapes.map(s => s.label.trim().toLocaleLowerCase('vi')));
  const last = [...same].reverse().find(s => /\d+\s*$/.test(s.label.trim()));
  const m = last?.label.trim().match(/^(.*?)(\d+)\s*$/);
  const prefix = m ? m[1] : kind === 'line' ? 'Đường ' : 'Cty ';
  let n = m ? Number(m[2]) + 1 : 1;
  while (taken.has(`${prefix}${n}`.toLocaleLowerCase('vi'))) n += 1;
  return `${prefix}${n}`;
}

/** Chỗ đặt nhãn của 1 nét: nhãn = chính điểm đó, đường = giữa đường, vùng = tâm vùng. */
export function shapeAnchor(s: PanoShape): SphPt {
  return s.kind === 'label' ? s.pts[0] : s.kind === 'line' ? pathMidpoint(s.pts) : centroid(s.pts);
}

export const KIND_LABEL: Record<PanoShapeKind, string> = { label: 'Nhãn', line: 'Đường', area: 'Vùng' };

export { ZONE_COLORS, zoneId };
