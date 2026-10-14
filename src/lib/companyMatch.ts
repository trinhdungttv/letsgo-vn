// DÒ TRÙNG TÊN CÔNG TY — phát hiện công ty đã có trong hệ thống dù gõ khác đi: thiếu / thừa / đảo chữ, bỏ dấu, dính chữ,
// thêm "Công ty TNHH", "Cty", "Co., Ltd", "(Vietnam)"… Ví dụ "Ampacs", "Công ty TNHH ampacs", "côngty ampasc" là 1 công ty.
//
// Cách làm (thuần, không React / DB, có test):
//   1. Chuẩn hoá: bỏ dấu tiếng Việt, đ→d, chữ thường, bỏ ký tự thừa (gạch đầu dòng, dấu câu).
//   2. Bỏ cụm "loại hình" (công ty, tnhh, cổ phần, mtv, co ltd, jsc, vietnam…) → TÊN LÕI ("ampacs").
//   3. So tên lõi, nối liền (không phụ thuộc khoảng trắng):
//        • giống hệt                          → 'same'   (cùng công ty, chỉ khác cách viết)
//        • lệch 1–2 ký tự (thiếu / thừa / sai / đảo 2 chữ liền kề, tính theo độ dài) hoặc giống hệt khi bỏ cả các từ ngành chung
//          (sản xuất, thương mại…)            → 'likely' (rất giống)
//        • tên này nằm trọn trong tên kia (vd "Ampacs" ⊂ "Ampacs Packaging")  → 'maybe' (có thể trùng). Không báo các tên chỉ "hơi giống" để khỏi báo nhầm.
//   Số khác nhau ("Công ty ABC 1" / "ABC 2") thường là 2 công ty khác nhau → chỉ 'maybe', không tính là lệch ký tự.

/** Mức giống nhau, từ chắc chắn tới nghi ngờ */
export type MatchLevel = 'same' | 'likely' | 'maybe';
export const MATCH_LABEL: Record<MatchLevel, string> = { same: 'Trùng tên', likely: 'Rất giống', maybe: 'Có thể trùng' };

/** Bỏ dấu tiếng Việt, đ → d, chữ thường. */
export const foldVn = (s: string | null | undefined): string =>
  (s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase();

// Cụm "loại hình doanh nghiệp" — không phải tên riêng. Xếp cụm dài trước. Đã ở dạng bỏ dấu.
const LEGAL_PHRASES = [
  'cong ty trach nhiem huu han mot thanh vien', 'cong ty trach nhiem huu han', 'cong ty co phan', 'cong ty hop danh', 'cong ty',
  'tong cong ty', 'tap doan', 'doanh nghiep tu nhan', 'doanh nghiep', 'chi nhanh cong ty',
  'joint stock company', 'limited liability company', 'limited company', 'company limited', 'co ltd', 'corporation',
  // "CP" đứng riêng có thể là tên riêng ("Bao CP") nên chỉ bỏ khi đi liền "công ty" / viết liền "CTCP"
  'cong ty cp', 'cty cp', 'ctcp', 'cty tnhh', 'cty',
  'tnhh mtv', 'tnhh', 'mot thanh vien', 'co phan', 'mtv', 'jsc', 'ltd', 'llc', 'inc', 'corp',
];
// Từ ngành chung — chỉ dùng cho khoá "thương hiệu" (bỏ thêm để "TNHH SX TM ABC" ≈ "ABC")
const GENERIC_WORDS = new Set([
  'san', 'xuat', 'sx', 'thuong', 'mai', 'tm', 'dich', 'vu', 'dv', 'dau', 'tu', 'xay', 'dung', 'cong', 'nghiep', 'ky', 'thuat',
  'tong', 'hop', 'va', 'cung', 'ung', 'lao', 'dong', 'nhan', 'luc', 'giao', 'nhan', 'van', 'tai', 'xnk', 'xuat', 'nhap', 'khau',
  'industrial', 'industry', 'trading', 'production', 'manufacturing', 'service', 'services', 'technology', 'group', 'holdings', 'international', 'intl',
]);

// Cụm dài thử trước ("cong ty cp" trước "cong ty"), khoảng trắng trong cụm = số khoảng trắng bất kỳ
const legalRe = new RegExp(`(^|[^a-z0-9])(?:${[...LEGAL_PHRASES].sort((x, y) => y.length - x.length).map(p => p.replace(/ /g, '\\s*')).join('|')})(?=$|[^a-z0-9])`, 'g');

export interface CompanyKey {
  /** Chuỗi gốc đã bỏ dấu, ký tự thừa */
  folded: string;
  /** Các từ của tên lõi (đã bỏ cụm loại hình, hậu tố nước) */
  tokens: string[];
  /** Tên lõi nối liền: "ampacs" */
  core: string;
  /** Tên lõi bỏ thêm từ ngành chung ("" nếu bỏ hết thì dùng lại core) */
  brand: string;
  /** Các cụm chữ số trong tên lõi — "ABC 1" khác "ABC 2" */
  digits: string[];
}

/** Dựng khoá so sánh của 1 tên công ty. */
export function companyKey(name: string | null | undefined): CompanyKey {
  let f = foldVn(name).replace(/&/g, ' va ').replace(/[^a-z0-9]+/g, ' ').trim();
  // Chữ dính liền kiểu "côngty" → "cong ty" để nhận ra cụm loại hình
  f = f.replace(/\bcongty/g, 'cong ty').replace(/\bcongnghiep/g, 'cong nghiep');
  const folded = f;
  const stripped = ` ${f} `.replace(legalRe, ' ').replace(legalRe, ' ');
  let tokens = stripped.split(' ').filter(Boolean);
  // Hậu tố nước ở CUỐI tên ("... Việt Nam", "(Vietnam)", "VN") bỏ để "ABC" = "ABC Vietnam"; "Việt" giữa tên (Trường Việt, Việt Tiến) là tên riêng nên giữ
  if (tokens.length > 1) {
    const t = tokens, n = t.length;
    if (t[n - 1] === 'vietnam' || t[n - 1] === 'vn') tokens = t.slice(0, -1);
    else if (n > 2 && t[n - 2] === 'viet' && t[n - 1] === 'nam') tokens = t.slice(0, -2);
  }
  if (!tokens.length) tokens = f.split(' ').filter(Boolean);          // tên chỉ gồm cụm loại hình (hiếm) → giữ nguyên
  const core = tokens.join('');
  const brandTokens = tokens.filter(t => !GENERIC_WORDS.has(t));
  return { folded, tokens, core, brand: brandTokens.length ? brandTokens.join('') : core, digits: core.match(/\d+/g) ?? [] };
}

/** Khoảng cách chỉnh sửa Damerau (thêm / xoá / sai / ĐẢO 2 chữ liền kề = 1 bước), dừng sớm khi vượt `max`. */
export function editDistance(a: string, b: string, max = 3): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const m = a.length, n = b.length;
  let prev2: number[] = [], prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev2 = prev; prev = cur;
  }
  return prev[n];
}

export interface CompanyMatch {
  level: MatchLevel;
  /** 0–1, để xếp thứ tự (cao = giống hơn) */
  score: number;
  /** Vì sao coi là giống — hiện cho người dùng */
  reason: string;
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every(x => b.includes(x));

/** So 2 khoá. null = không giống. */
export function compareKeys(a: CompanyKey, b: CompanyKey): CompanyMatch | null {
  if (!a.core || !b.core) return null;
  const digitsSame = sameSet(a.digits, b.digits);
  if (a.core === b.core) return { level: 'same', score: 1, reason: a.folded === b.folded ? 'Trùng tên' : 'Cùng tên, khác cách viết (loại hình, dấu, khoảng trắng)' };

  // Khác số ("ABC 1" / "ABC 2") → nhiều khả năng là 2 công ty / 2 cơ sở khác nhau: chỉ nghi ngờ khi phần chữ giống hệt
  if (!digitsSame) {
    const strip = (k: CompanyKey) => k.core.replace(/\d+/g, '');
    return strip(a) && strip(a) === strip(b) ? { level: 'maybe', score: 0.45, reason: 'Cùng tên nhưng khác số — có thể là cơ sở khác' } : null;
  }

  if (a.brand === b.brand && a.brand.length >= 3) return { level: 'likely', score: 0.92, reason: 'Cùng tên thương hiệu (khác các từ ngành như sản xuất, thương mại)' };

  const len = Math.min(a.core.length, b.core.length);
  // Ngưỡng theo độ dài: tên ngắn chỉ cho lệch 1 ký tự (và từ 5 ký tự), tên dài cho lệch nhiều hơn
  const maxEdit = len < 5 ? 0 : len < 10 ? 1 : len < 16 ? 2 : 3;
  if (maxEdit > 0) {
    for (const [x, y] of [[a.core, b.core], [a.brand, b.brand]] as const) {
      if (Math.min(x.length, y.length) < 5) continue;
      const d = editDistance(x, y, maxEdit + 1);
      if (d <= 1) return { level: 'likely', score: 0.9 - d * 0.02 - (d / Math.max(x.length, y.length)) * 0.2, reason: 'Lệch 1 ký tự (thiếu / thừa / sai / đảo chữ)' };
      if (d <= maxEdit) return { level: 'likely', score: 0.78 - (d / Math.max(x.length, y.length)) * 0.3, reason: `Lệch ${d} ký tự so với tên đã có` };
    }
  }

  // Tên này nằm trọn trong tên kia (theo từ): "ampacs" ⊂ "ampacs packaging"
  const [s, l] = a.tokens.length <= b.tokens.length ? [a, b] : [b, a];
  if (s.core.length >= 4 && s.tokens.length < l.tokens.length && s.tokens.every(t => l.tokens.includes(t))) {
    return { level: 'maybe', score: 0.55 + Math.min(0.15, s.core.length / 100), reason: `Tên “${s.tokens.join(' ')}” nằm trong tên còn lại` };
  }
  if (s.core.length >= 5 && l.core.startsWith(s.core) && l.core.length - s.core.length <= 12) return { level: 'maybe', score: 0.5, reason: 'Một tên là phần đầu của tên kia' };
  return null;
}

/** Nguồn dữ liệu có công ty */
export type CompanySource = 'client' | 'pipeline' | 'lead';
export const SOURCE_LABEL: Record<CompanySource, string> = { client: 'Khách hàng', pipeline: 'CRM Pipeline', lead: 'Thị trường' };

export interface CompanyRef {
  /** id trong bảng của nguồn */
  id: string;
  name: string;
  source: CompanySource;
  /** Ghi chú ngắn: giai đoạn pipeline, KCN, chi nhánh… */
  note?: string;
}

/** 1 công ty trong chỉ mục: có thể xuất hiện ở nhiều nguồn (khách hàng + hồ sơ CRM + dự án thị trường liên kết nhau). */
export interface CompanyEntry {
  key: CompanyKey;
  /** Tên hiển thị (ưu tiên tên ở Khách hàng, rồi Pipeline, rồi Thị trường) */
  name: string;
  refs: CompanyRef[];
}

const SRC_RANK: Record<CompanySource, number> = { client: 0, pipeline: 1, lead: 2 };

/**
 * Dựng chỉ mục công ty từ 3 nguồn. Bản ghi LIÊN KẾT nhau (pipeline.client_id → khách hàng, lead.crm_id → pipeline) gộp thành
 * 1 công ty để không báo "trùng" chính nó; các bản ghi không liên kết mà cùng tên lõi vẫn là 2 mục riêng (chính là trùng thật).
 */
export function buildCompanyIndex(input: {
  clients: { id: string; name: string; note?: string }[];
  pipeline: { id: string; company_name: string; client_id?: string | null; note?: string }[];
  leads: { id: string; company_name: string; crm_id?: string | null; note?: string }[];
}): CompanyEntry[] {
  const groups = new Map<string, CompanyRef[]>();
  const add = (g: string, r: CompanyRef) => { const l = groups.get(g); if (l) l.push(r); else groups.set(g, [r]); };
  for (const c of input.clients) if (c.name?.trim()) add(`c:${c.id}`, { id: c.id, name: c.name.trim(), source: 'client', note: c.note });
  const pipelineGroup = new Map<string, string>();
  for (const p of input.pipeline) {
    if (!p.company_name?.trim()) continue;
    const g = p.client_id ? `c:${p.client_id}` : `p:${p.id}`;
    pipelineGroup.set(p.id, g);
    add(g, { id: p.id, name: p.company_name.trim(), source: 'pipeline', note: p.note });
  }
  for (const l of input.leads) {
    if (!l.company_name?.trim()) continue;
    add((l.crm_id && pipelineGroup.get(l.crm_id)) || `l:${l.id}`, { id: l.id, name: l.company_name.trim(), source: 'lead', note: l.note });
  }
  return [...groups.values()].map(refs => {
    const sorted = [...refs].sort((a, b) => SRC_RANK[a.source] - SRC_RANK[b.source]);
    return { key: companyKey(sorted[0].name), name: sorted[0].name, refs: sorted };
  });
}

export interface CompanyHit extends CompanyMatch {
  entry: CompanyEntry;
}

/**
 * Tìm công ty đã có giống tên đang gõ. Trả tối đa `limit`, giống nhất trước. Tên rỗng / quá ngắn (< 3 ký tự lõi) → không tìm.
 * Với mỗi công ty, so cả tên ở các nguồn khác nhau (tên ở Khách hàng và ở Pipeline có thể gõ khác nhau) lấy kết quả tốt nhất.
 */
export function findSimilarCompanies(name: string, index: CompanyEntry[], opts: { limit?: number; ignoreIds?: string[] } = {}): CompanyHit[] {
  const k = companyKey(name);
  if (k.core.length < 3) return [];
  const ignore = new Set(opts.ignoreIds ?? []);
  const hits: CompanyHit[] = [];
  for (const e of index) {
    if (e.refs.some(r => ignore.has(r.id))) continue;
    let best: CompanyMatch | null = null;
    const keys = [e.key, ...e.refs.slice(1).map(r => companyKey(r.name))];
    for (const ek of keys) {
      const m = compareKeys(k, ek);
      if (m && (!best || m.score > best.score)) best = m;
    }
    if (best) hits.push({ ...best, entry: e });
  }
  return hits.sort((x, y) => y.score - x.score).slice(0, opts.limit ?? 5);
}

/** Mức cao nhất trong danh sách kết quả (null = không có). */
export const worstLevel = (hits: CompanyHit[]): MatchLevel | null =>
  hits.some(h => h.level === 'same') ? 'same' : hits.some(h => h.level === 'likely') ? 'likely' : hits.length ? 'maybe' : null;

/** Tìm các nhóm trùng LẪN NHAU trong 1 danh sách tên (kiểm tra file nhập / quét dữ liệu): trả cặp (chỉ số i < j) kèm mức giống. */
export function findDuplicatePairs(names: string[], limit = 200): { i: number; j: number; match: CompanyMatch }[] {
  const keys = names.map(companyKey);
  const out: { i: number; j: number; match: CompanyMatch }[] = [];
  // Gom theo 3 ký tự đầu của tên lõi để khỏi so mọi cặp (lỗi gõ hiếm khi nằm ở 3 ký tự đầu; trường hợp đảo / sai đầu vẫn bắt được bằng khoá nối)
  const buckets = new Map<string, number[]>();
  keys.forEach((k, i) => { if (k.core.length >= 3) for (const b of new Set([k.core.slice(0, 3), k.brand.slice(0, 3)])) { const l = buckets.get(b); if (l) l.push(i); else buckets.set(b, [i]); } });
  const seen = new Set<string>();
  for (const idx of buckets.values()) {
    for (let x = 0; x < idx.length; x++) for (let y = x + 1; y < idx.length; y++) {
      const i = Math.min(idx[x], idx[y]), j = Math.max(idx[x], idx[y]);
      const id = `${i}:${j}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const match = compareKeys(keys[i], keys[j]);
      if (match) { out.push({ i, j, match }); if (out.length >= limit) return out; }
    }
  }
  return out.sort((p, q) => q.match.score - p.match.score);
}
