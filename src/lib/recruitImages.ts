// Ảnh tuyển dụng của công ty (CRM Pipeline → Thị trường): mỗi ảnh gắn được 1 hay nhiều thẻ ĐỐI THỦ
// (Thị trường → Đối thủ) để biết ảnh đó là của nhà cung ứng nào.
//
// Dữ liệu cũ KHÔNG đổi: các link vẫn nằm ở cột `recruit_image_urls` (text[]). Thẻ nằm ở cột MỚI
// `recruit_image_tags` (jsonb, migration 216) — danh sách xếp SONG SONG với danh sách link:
//     [{ "u": "<link ảnh>", "c": [{ "id": "<mã đối thủ>", "n": "<tên lúc gắn>" }] }, …]
//
// Vì sao không dùng bảng link → thẻ: lúc lưu, app tự đổi link ảnh ngoài thành link R2 (lib/mirrorImages.ts) nên link
// đổi nhưng THỨ TỰ giữ nguyên → ghép theo vị trí mới bền. `u` chỉ để kiểm tra / tự chữa khi có nơi khác sắp xếp lại.
// Mỗi thẻ giữ cả mã lẫn tên: đổi tên đối thủ thì theo mã; mã bị xoá (VD xoá dòng đối thủ ở 1 KCN) thì theo tên.
import { foldVn } from './companyMatch';

export interface RecruitTag { id: string; n: string }
export interface RecruitImageEntry { u: string; c: RecruitTag[] }

/** Đối thủ như app đọc từ bảng competitors (1 công ty có thể có nhiều dòng — mỗi KCN 1 dòng). */
export interface CompetitorRow { id: string; company_name: string | null }
export interface CompetitorOption { id: string; name: string }

/** Thẻ đã đối chiếu với danh sách đối thủ hiện có. */
export interface ResolvedTag {
  /** Khoá gộp (tên bỏ dấu) — 2 dòng cùng công ty ở 2 KCN là 1 thẻ. */
  key: string;
  id: string;
  name: string;
  /** Không còn đối thủ này trong Thị trường → Đối thủ (vẫn giữ thẻ để không mất thông tin). */
  missing: boolean;
}

export const UNTAGGED_KEY = '__untagged__';

const nameKey = (s: string | null | undefined) => foldVn(s).replace(/\s+/g, ' ').trim();

/** Mỗi công ty đối thủ 1 mục (gộp các dòng cùng tên ở nhiều KCN), xếp theo tên. */
export function competitorOptions(rows: readonly CompetitorRow[]): CompetitorOption[] {
  const out = new Map<string, CompetitorOption>();
  for (const r of rows) {
    const name = (r.company_name ?? '').trim();
    if (!name) continue;
    const k = nameKey(name);
    if (!out.has(k)) out.set(k, { id: r.id, name });
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name, 'vi'));
}

/** Đọc cột jsonb một cách dễ dãi: sai dạng / null / chuỗi JSON → bỏ phần hỏng, không bao giờ ném lỗi. */
export function parseStore(raw: unknown): RecruitImageEntry[] {
  let v = raw;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { return []; } }
  if (!Array.isArray(v)) return [];
  return v.map((e): RecruitImageEntry => {
    const o = (e && typeof e === 'object' ? e : {}) as { u?: unknown; c?: unknown };
    const c = Array.isArray(o.c) ? o.c : [];
    const tags: RecruitTag[] = [];
    for (const t of c) {
      const x = (t && typeof t === 'object' ? t : {}) as { id?: unknown; n?: unknown };
      const id = typeof x.id === 'string' ? x.id : '';
      const n = typeof x.n === 'string' ? x.n : '';
      if (!id && !n) continue;
      if (tags.some(y => (id && y.id === id) || (!id && !y.id && nameKey(y.n) === nameKey(n)))) continue;
      tags.push({ id, n });
    }
    return { u: typeof o.u === 'string' ? o.u : '', c: tags };
  });
}

/** Thẻ gắn cho từng ảnh (cùng vị trí với `urls`). Ảnh chưa gắn / dữ liệu cũ → []. */
export function tagsForImages(urls: readonly string[], store: readonly RecruitImageEntry[]): RecruitTag[][] {
  const sameLength = store.length === urls.length;
  return urls.map((url, i) => {
    const at = store[i];
    if (at && at.u === url) return at.c;
    const byUrl = store.find(e => e.u === url);
    if (byUrl) return byUrl.c;
    // Link đã bị đổi (tự chép về R2) nhưng số ảnh còn nguyên → vẫn theo vị trí cũ
    if (sameLength && at) return at.c;
    return [];
  });
}

/** Danh sách lưu xuống DB: ĐỦ mọi ảnh, đúng thứ tự — gọi mỗi khi thêm / bớt / sửa thẻ. */
export function buildStore(urls: readonly string[], tags: readonly (readonly RecruitTag[])[]): RecruitImageEntry[] {
  return urls.map((u, i) => ({ u, c: [...(tags[i] ?? [])] }));
}

/** Thêm ảnh mới vào cuối (chưa có thẻ). */
export function appendImages(urls: readonly string[], tags: readonly (readonly RecruitTag[])[], added: readonly string[]) {
  return {
    urls: [...urls, ...added],
    tags: [...tags.map(t => [...t]), ...added.map((): RecruitTag[] => [])],
  };
}

/** Bỏ ảnh ở vị trí `index` — thẻ của ảnh đó đi theo, ảnh khác giữ nguyên thẻ. */
export function removeImageAt(urls: readonly string[], tags: readonly (readonly RecruitTag[])[], index: number) {
  return {
    urls: urls.filter((_, i) => i !== index),
    tags: tags.filter((_, i) => i !== index).map(t => [...t]),
  };
}

/** Đặt lại thẻ của 1 ảnh (bỏ trùng theo công ty). */
export function setTagsAt(tags: readonly (readonly RecruitTag[])[], index: number, next: readonly RecruitTag[]): RecruitTag[][] {
  const seen = new Set<string>();
  const clean = next.filter(t => { const k = t.id || nameKey(t.n); if (seen.has(k)) return false; seen.add(k); return true; });
  return tags.map((t, i) => (i === index ? clean : [...t]));
}

/** Đối chiếu thẻ đã lưu với danh sách đối thủ hiện có → tên mới nhất, đánh dấu thẻ mồ côi. Bỏ trùng công ty. */
export function resolveTags(tags: readonly RecruitTag[], rows: readonly CompetitorRow[]): ResolvedTag[] {
  const byId = new Map<string, string>();
  const byKey = new Map<string, string>();
  for (const r of rows) {
    const name = (r.company_name ?? '').trim();
    if (!name) continue;
    byId.set(r.id, name);
    if (!byKey.has(nameKey(name))) byKey.set(nameKey(name), r.id);
  }
  const out: ResolvedTag[] = [];
  const seen = new Set<string>();
  for (const t of tags) {
    let id = t.id;
    let name = t.id ? byId.get(t.id) : undefined;
    if (!name && t.n) {
      const alt = byKey.get(nameKey(t.n));
      if (alt) { id = alt; name = byId.get(alt); }
    }
    const missing = !name;
    const shown = name ?? t.n ?? '';
    if (!shown) continue;
    const key = nameKey(shown);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, id, name: shown, missing });
  }
  return out;
}

export interface TagFilterChip { key: string; name: string; count: number }

/** Chip lọc theo đối thủ: mỗi đối thủ có ảnh + (nếu có) "Chưa gắn đối thủ". Ít hơn 2 loại thì không cần lọc → []. */
export function filterChips(resolved: readonly (readonly ResolvedTag[])[]): TagFilterChip[] {
  const counts = new Map<string, TagFilterChip>();
  let untagged = 0;
  for (const tags of resolved) {
    if (!tags.length) { untagged += 1; continue; }
    for (const t of tags) {
      const cur = counts.get(t.key);
      if (cur) cur.count += 1; else counts.set(t.key, { key: t.key, name: t.name, count: 1 });
    }
  }
  const chips = [...counts.values()].sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  if (untagged) chips.push({ key: UNTAGGED_KEY, name: 'Chưa gắn đối thủ', count: untagged });
  return chips.length >= 2 ? chips : [];
}

/** Vị trí các ảnh khớp bộ lọc (null = tất cả). */
export function visibleIndexes(resolved: readonly (readonly ResolvedTag[])[], filter: string | null): number[] {
  const all = resolved.map((_, i) => i);
  if (!filter) return all;
  return all.filter(i => (filter === UNTAGGED_KEY ? resolved[i].length === 0 : resolved[i].some(t => t.key === filter)));
}

/** Đối thủ còn chọn được cho 1 ảnh (bỏ các công ty đã gắn). */
export const availableOptions = (options: readonly CompetitorOption[], resolved: readonly ResolvedTag[]): CompetitorOption[] => {
  const used = new Set(resolved.map(r => r.key));
  return options.filter(o => !used.has(nameKey(o.name)));
};

/** Gắn thêm 1 đối thủ (chọn từ danh sách) vào danh sách thẻ của 1 ảnh. */
export const addTag = (tags: readonly RecruitTag[], opt: CompetitorOption): RecruitTag[] =>
  tags.some(t => t.id === opt.id || nameKey(t.n) === nameKey(opt.name)) ? [...tags] : [...tags, { id: opt.id, n: opt.name }];

/** Gỡ thẻ theo khoá công ty (tên bỏ dấu). */
export const removeTag = (tags: readonly RecruitTag[], rows: readonly CompetitorRow[], key: string): RecruitTag[] =>
  tags.filter(t => !resolveTags([t], rows).some(r => r.key === key));
