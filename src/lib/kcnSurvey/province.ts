// Tỉnh / thành phố của 1 KCN, lấy từ cột market_zones.location để lọc & so sánh các KCN ở tab Khảo sát KCN.
// Dữ liệu thật ghi không thống nhất ("TP. Đồng Nai", "Đồng Nai", "Nhơn Trạch, Đồng Nai") và nhiều KCN chưa có location
// → gộp các cách ghi về 1 khoá, KCN chưa có thì vào nhóm "Chưa rõ tỉnh" (không bị loại âm thầm khi lọc). Hàm thuần, có test.

/** Giá trị bộ lọc cho "KCN chưa ghi tỉnh". */
export const NO_PROVINCE = '__none__';

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Tiền tố hành chính ở đầu tên: "TP.", "TP", "Thành phố", "Tỉnh", "T." (so khớp trên chữ đã bỏ dấu). */
const PREFIX = /^(?:thanh pho|tinh|tp|t) /;

/** Cách viết khác của TP. Hồ Chí Minh. */
const HCM = new Set(['ho chi minh', 'hcm', 'tphcm', 'tp hcm', 'sai gon', 'saigon']);

/** Tách location thành nhãn hiển thị + khoá so sánh. Phần "tỉnh" = đoạn cuối sau dấu phẩy ("Nhơn Trạch, Đồng Nai" → "Đồng Nai"). */
function parse(location: string | null | undefined): { label: string; key: string } {
  const raw = (location ?? '').normalize('NFC').split(',').map(s => s.trim()).filter(Boolean).pop() ?? '';
  const f = fold(raw);
  if (!f) return { label: '', key: '' };
  const bare = f.replace(PREFIX, '');
  if (HCM.has(f) || HCM.has(bare)) return { label: 'TP. Hồ Chí Minh', key: 'ho chi minh' };
  const m = PREFIX.exec(f);
  if (!m) return { label: raw, key: f };
  // fold giữ nguyên số từ → bỏ đúng các từ tiền tố trên chuỗi gốc ("TP. Đồng Nai" → "Đồng Nai")
  const words = raw.replace(/\./g, ' ').trim().split(/\s+/);
  const label = words.slice(m[0].trim().split(' ').length).join(' ') || raw;
  return { label, key: fold(label) };
}

/** Tên tỉnh để hiển thị: bỏ tiền tố TP. / Tỉnh. */
export const provinceLabel = (location: string | null | undefined): string => parse(location).label;

/** Khoá so sánh: bỏ dấu, chữ thường, các cách viết của cùng 1 tỉnh về chung 1 khoá. '' = chưa ghi tỉnh. */
export const provinceKey = (location: string | null | undefined): string => parse(location).key;

export interface ProvinceOption {
  key: string;
  label: string;
  /** số KCN thuộc tỉnh này */
  zones: number;
  /** trong đó đã có dữ liệu khảo sát */
  surveyed: number;
}

/**
 * Danh sách tỉnh cho ô lọc: tỉnh có KCN đã khảo sát lên trước, rồi nhiều KCN, rồi theo tên. Mỗi tỉnh lấy cách viết xuất
 * hiện nhiều nhất làm tên hiển thị. KCN chưa ghi tỉnh đếm riêng ở `unknown` / `unknownSurveyed`.
 */
export function provinceOptions(zones: readonly { id: string; location: string | null }[], used: ReadonlySet<string | null>): { options: ProvinceOption[]; unknown: number; unknownSurveyed: number } {
  const by = new Map<string, { zones: number; surveyed: number; labels: Map<string, number> }>();
  let unknown = 0, unknownSurveyed = 0;
  for (const z of zones) {
    const key = provinceKey(z.location);
    const hit = used.has(z.id);
    if (!key) { unknown += 1; if (hit) unknownSurveyed += 1; continue; }
    const e = by.get(key) ?? { zones: 0, surveyed: 0, labels: new Map() };
    e.zones += 1;
    if (hit) e.surveyed += 1;
    const lb = provinceLabel(z.location);
    e.labels.set(lb, (e.labels.get(lb) ?? 0) + 1);
    by.set(key, e);
  }
  const options = [...by.entries()].map(([key, e]) => ({
    key, zones: e.zones, surveyed: e.surveyed,
    label: [...e.labels.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'vi'))[0][0],
  })).sort((a, b) => b.surveyed - a.surveyed || b.zones - a.zones || a.label.localeCompare(b.label, 'vi'));
  return { options, unknown, unknownSurveyed };
}

/** Bộ lọc đã lưu từ phiên bản cũ (lưu nguyên văn "TP. Đồng Nai") → khoá mới; không nhận ra thì về "Mọi tỉnh". */
export function normalizeSavedProvince(v: unknown): string {
  if (typeof v !== 'string' || v === 'all') return 'all';
  if (v === NO_PROVINCE) return NO_PROVINCE;
  return provinceKey(v) || 'all';
}
