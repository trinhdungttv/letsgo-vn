// Nguồn quét chính cho "Tải thông tin KCN": Overture Maps — bộ địa điểm mở (giấy phép CDLA-Permissive / ODbL) do Meta,
// Microsoft, Amazon… đóng góp; ở Việt Nam có rất nhiều doanh nghiệp lấy từ trang Facebook / Bing, kèm SĐT, Facebook,
// website, địa chỉ. Miễn phí, KHÔNG cần khoá.
//
// Đọc bản cắt sẵn thành ô bản đồ (PMTiles, tiles.overturemaps.org): chỉ tải các ô mức zoom 14 phủ vùng KCN (mỗi ô
// ~2,4 km, vài chục KB) bằng HTTP Range — 1 KCN ~ 0,5–1,5 MB, vài giây. Bản phát hành mới ra hằng tháng, bản cũ bị gỡ
// sau ~2 tháng → dò bản mới nhất từ danh sách công khai, nhớ trong máy 7 ngày.
import type { Bounds } from './track';
import { inCompanyArea, looksLikeHiringPage, looksLikeSupplier, type ScanArea, type ScanPlace } from './marketScan';
import { isZoneLikeName } from './companies';
import { foldVn } from '../companyMatch';

const TILES = 'https://tiles.overturemaps.org';
const RELEASES = 'https://overturemaps-us-west-2.s3.us-west-2.amazonaws.com/?list-type=2&prefix=release/&delimiter=/';
/** Bản đã biết chắc có (03/11/2026) — dùng khi không đọc được danh sách */
const FALLBACK_RELEASE = '2026-10-21.0';
const RELEASE_KEY = 'lgvn_overture_release_v1';
const ZOOM = 14;
const MAX_TILES = 80;

// ── Ô bản đồ ─────────────────────────────────────────────────────────────────
const lon2x = (lon: number, z: number) => Math.floor(((lon + 180) / 360) * 2 ** z);
const lat2y = (lat: number, z: number) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
};

/** Các ô (x, y) mức zoom z phủ khung. */
export function tilesFor(b: Bounds, z = ZOOM): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let x = lon2x(b.minLng, z); x <= lon2x(b.maxLng, z); x++) {
    for (let y = lat2y(b.maxLat, z); y <= lat2y(b.minLat, z); y++) out.push({ x, y });
  }
  return out;
}

/** Điểm trong ô (toạ độ 0..extent) → kinh / vĩ độ. */
export function tilePointToLatLng(tx: number, ty: number, z: number, px: number, py: number, extent: number): { lat: number; lng: number } {
  const n = 2 ** z;
  const lng = ((tx + px / extent) / n) * 360 - 180;
  const yy = (ty + py / extent) / n;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - 2 * yy))) * 180) / Math.PI;
  return { lat, lng };
}

// ── Phân loại ────────────────────────────────────────────────────────────────
// Danh mục của Overture khá lộn xộn ở VN (nhà máy hay bị ghi "dịch vụ", "truyền thông"…) → TÊN là tín hiệu chính:
// có "TNHH / Cổ phần / Co., Ltd / Vina / JSC…" thì là công ty, trừ khi danh mục rõ là quán xá / cửa hàng.
/** Loại hình Overture của nhà máy / công ty sản xuất / doanh nghiệp B2B. */
const INDUSTRIAL_CAT = /manufactur|industrial|factory|fabricat|chemical_plant|textile|garment|apparel_manufacturer|plastic|metal_|machine_shop|b2b|wholesale|logistic|freight|packag|engineering_service|energy|mining|pharmaceutical_company|automotive_part/;
/** Loại hình bán lẻ / ăn uống / dịch vụ tiêu dùng — tên có chữ "công ty" vẫn không tính là nhà máy. */
const CONSUMER_CAT = /restaurant|cafe|coffee|eatery|food_and_beverage|_bar\b|pub\b|store|shop|retail|beauty|salon|spa\b|barber|hotel|motel|hostel|karaoke|gym|school|education|hospital|clinic|dental|pharmacy|bank|atm|real_estate|church|temple|pagoda|park\b|gas_station|car_wash|wedding|flowers|bubble_tea|bakery|massage|tattoo|travel_agency/;
const EMPLOYMENT_CAT = /employment_agency|staffing|recruit|human_resource|temp_agency|career_counsel|job_/;
const COMPANY_NAME = /\b(cong ty|cty|co\.?,? ?ltd|limited|corporation|corp|jsc|inc|vina|vietnam|viet nam|nha may|factory|tnhh|co phan|industr\w*|manufactur\w*|textile|garment|steel|plastic)\b/;
/** Không phải doanh nghiệp: công đoàn, nhà thờ, chùa, trường, cơ quan nhà nước, cửa hàng… */
const NOT_COMPANY_NAME = /^(cong doan|nha tho|chua|truong|hoc vien|uy ban|ubnd|benh vien|phong kham|tram y te|cua hang|shop|sieu thi|dai ly|quan |nha hang|ky tuc xa|ktx|dormitory)/;

const json = <T>(v: unknown): T | null => {
  if (typeof v !== 'string' || !v) return null;
  try { return JSON.parse(v) as T; } catch { return null; }
};

export interface OvertureProps { [k: string]: unknown }

/**
 * 1 địa điểm Overture → mục quét (null = bỏ: không tên, chính là KCN, quán xá / cửa hàng, ngoài vùng, đã đóng cửa).
 *  - nhà cung ứng: loại hình việc làm / nhân sự, hoặc tên "cung ứng, nhân lực, việc làm…" (trong bán kính quanh KCN)
 *  - "… Tuyển dụng" của nhà máy → tính là công ty, đánh dấu đang tuyển
 *  - công ty: loại hình sản xuất / doanh nghiệp, hoặc tên dạng công ty mà không phải quán / cửa hàng (trong KCN)
 */
export function overtureToScan(props: OvertureProps, lat: number, lng: number, area: ScanArea): ScanPlace | null {
  const names = json<{ primary?: string }>(props.names);
  const name = String(props['@name'] ?? names?.primary ?? '').trim();
  if (!name || isZoneLikeName(name)) return null;
  if (props.operating_status === 'permanently_closed' || props.operating_status === 'closed') return null;
  const tax = json<{ primary?: string; hierarchy?: string[] }>(props.taxonomy);
  const cat = String(tax?.primary ?? props.basic_category ?? '');
  const catAll = [cat, String(props.basic_category ?? ''), ...(tax?.hierarchy ?? [])].join(' ');
  const folded = foldVn(name);
  const conf = typeof props.confidence === 'number' ? props.confidence : null;

  if (NOT_COMPANY_NAME.test(folded) || /labor_union|religious|place_of_worship/.test(catAll)) return null;
  const hiring = looksLikeHiringPage(name);
  const supplier = !hiring && (EMPLOYMENT_CAT.test(catAll) || looksLikeSupplier(name));
  let kind: 'company' | 'supplier' | null = null;
  if (supplier) {
    const b = area.supplier;
    if (lat >= b.minLat && lat <= b.maxLat && lng >= b.minLng && lng <= b.maxLng) kind = 'supplier';
  } else if (inCompanyArea(area, { lat, lng })) {
    const industrial = INDUSTRIAL_CAT.test(catAll) && !/store|shop|retail|real_estate/.test(catAll);
    const companyish = COMPANY_NAME.test(folded) && !CONSUMER_CAT.test(catAll);
    if (industrial || companyish || hiring) kind = 'company';
  }
  if (!kind) return null;
  // Độ tin cậy rất thấp và không có thông tin liên hệ → nhiều khả năng là trang rác
  const phones = json<string[]>(props.phones) ?? [];
  const websites = json<string[]>(props.websites) ?? [];
  const socials = json<string[]>(props.socials) ?? [];
  if (conf != null && conf < 0.15 && !phones.length && !websites.length) return null;
  const addrs = json<{ freeform?: string | null; locality?: string | null }[]>(props.addresses) ?? [];
  const a0 = addrs[0];
  const id = String(props.id ?? `${lat.toFixed(6)},${lng.toFixed(6)}`);
  return {
    key: `v:${id}`, sources: ['overture'], kind, name, lat, lng,
    address: [a0?.freeform, a0?.locality].filter(Boolean).join(', '),
    category: categoryLabel(cat, kind, hiring),
    mapsUrl: mapsSearchUrl(name, lat, lng),
    phone: phones[0] ?? '', website: websites.find(w => !/facebook\.com/.test(w)) ?? '',
    facebook: socials.find(s => /facebook\.com/.test(s)) ?? websites.find(w => /facebook\.com/.test(w)),
    hiring: hiring || undefined, confidence: conf ?? undefined, keywords: ['Overture Maps'],
  };
}

const CAT_VI: Record<string, string> = {
  manufacturer: 'Nhà sản xuất', industrial_company: 'Công ty công nghiệp', commercial_industrial: 'Công nghiệp – thương mại',
  textile_manufacturer: 'Dệt may', clothing_company: 'May mặc', apparel_manufacturer: 'May mặc', metal_fabricator: 'Gia công kim loại',
  metal_supplier: 'Kim loại', machine_shop: 'Cơ khí', chemical_plant: 'Hoá chất', plastic_manufacturer: 'Nhựa',
  industrial_equipment_manufacturer: 'Thiết bị công nghiệp', electronic_equipment_supplier: 'Thiết bị điện tử', auto_manufacturer: 'Ô tô – xe máy',
  motorcycle_manufacturer: 'Ô tô – xe máy', pharmaceutical_company: 'Dược phẩm', engineering_service: 'Kỹ thuật', employment_agency: 'Dịch vụ việc làm',
  storage_facility: 'Kho bãi', warehouse: 'Kho bãi', freight_and_cargo_service: 'Vận tải hàng hoá', logistics_service: 'Logistics',
  building_or_construction_service: 'Xây dựng', food_manufacturer: 'Thực phẩm', furniture_manufacturer: 'Nội thất – gỗ',
};
function categoryLabel(cat: string, kind: 'company' | 'supplier', hiring: boolean): string {
  if (hiring) return 'Trang tuyển dụng của công ty';
  if (CAT_VI[cat]) return CAT_VI[cat];
  if (kind === 'supplier') return 'Cung ứng / việc làm';
  // Danh mục khác của Overture hay sai với nhà máy ở VN ("tổ chức sự kiện", "truyền thông"…) → không hiện
  return INDUSTRIAL_CAT.test(cat) ? cat.replace(/_/g, ' ') : 'Doanh nghiệp';
}

/** Link Google Maps tìm theo tên + toạ độ (mở đúng chỗ, xem SĐT / ảnh trên Google). */
export const mapsSearchUrl = (name: string, lat: number, lng: number) =>
  `https://www.google.com/maps/search/${encodeURIComponent(name)}/@${lat.toFixed(6)},${lng.toFixed(6)},17z`;

// ── Bản phát hành mới nhất ───────────────────────────────────────────────────
/** Tên bản phát hành từ danh sách S3 ("release/2026-10-21.0/") — mới trước. */
export function parseReleases(xml: string): string[] {
  return [...xml.matchAll(/<Prefix>release\/(\d{4}-\d{2}-\d{2}\.\d+)\/<\/Prefix>/g)].map(m => m[1]).sort().reverse();
}

async function latestRelease(): Promise<string[]> {
  try {
    const c = JSON.parse(localStorage.getItem(RELEASE_KEY) ?? 'null') as { at: number; list: string[] } | null;
    if (c && Date.now() - c.at < 7 * 86_400_000 && c.list?.length) return c.list;
  } catch { /* bỏ qua */ }
  try {
    const res = await fetch(RELEASES);
    const list = parseReleases(await res.text());
    if (list.length) {
      try { localStorage.setItem(RELEASE_KEY, JSON.stringify({ at: Date.now(), list })); } catch { /* đầy bộ nhớ */ }
      return list;
    }
  } catch { /* không đọc được danh sách → bản đã biết */ }
  return [FALLBACK_RELEASE];
}

// ── Tải + đọc ────────────────────────────────────────────────────────────────
export interface OvertureResult { places: ScanPlace[]; release: string; tiles: number; features: number }

/**
 * Quét Overture trong khung nhà cung ứng (rộng nhất — đã gồm vùng KCN): tải từng ô zoom 14, đọc địa điểm, phân loại.
 * `onProgress(done, total)` sau mỗi ô.
 */
export async function scanOverture(area: ScanArea, signal?: AbortSignal, onProgress?: (done: number, total: number) => void): Promise<OvertureResult> {
  // Thư viện đọc ô bản đồ chỉ tải khi quét (không làm nặng app lúc mở)
  const [{ PMTiles }, { VectorTile }, { default: Pbf }] = await Promise.all([import('pmtiles'), import('@mapbox/vector-tile'), import('pbf')]);
  const releases = await latestRelease();
  let pm: InstanceType<typeof PMTiles> | null = null;
  let release = '';
  for (const r of [...releases.slice(0, 3), FALLBACK_RELEASE]) {
    const cand = new PMTiles(`${TILES}/${r}/places.pmtiles`);
    try { await cand.getHeader(); pm = cand; release = r; break; } catch { /* bản này chưa có ô / đã gỡ → thử bản trước */ }
  }
  if (!pm) throw new Error('Không mở được dữ liệu Overture Maps — kiểm tra mạng rồi thử lại');
  const tiles = tilesFor(area.supplier).slice(0, MAX_TILES);
  const out: ScanPlace[] = [];
  let features = 0, done = 0;
  // Tải song song 6 ô một lúc
  const queue = [...tiles];
  const worker = async () => {
    while (queue.length) {
      if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
      const t = queue.shift()!;
      const res = await pm!.getZxy(ZOOM, t.x, t.y, signal);
      if (res?.data) {
        const vt = new VectorTile(new Pbf(new Uint8Array(res.data)));
        for (const layerName of Object.keys(vt.layers)) {
          const layer = vt.layers[layerName];
          for (let i = 0; i < layer.length; i++) {
            const f = layer.feature(i);
            features += 1;
            const g = f.loadGeometry()[0]?.[0];
            if (!g) continue;
            const { lat, lng } = tilePointToLatLng(t.x, t.y, ZOOM, g.x, g.y, layer.extent);
            const p = overtureToScan(f.properties as OvertureProps, lat, lng, area);
            if (p) out.push(p);
          }
        }
      }
      done += 1;
      onProgress?.(done, tiles.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, tiles.length) }, worker));
  return { places: out, release, tiles: tiles.length, features };
}
