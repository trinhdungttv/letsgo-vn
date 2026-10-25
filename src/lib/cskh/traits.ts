// ============================================================================
// CSKH — Đặc điểm dạng THẺ dùng chung: sở thích, thói quen, tính cách, món ăn, kiêng kỵ
// (port PRM traits.ts)
// ----------------------------------------------------------------------------
// Mỗi giá trị là 1 thẻ. Thẻ đã gõ ở hồ sơ này thành gợi ý cho hồ sơ khác (bấm chọn, không
// gõ lại, cùng chữ viết), và dùng để lọc "những ai cùng thích golf" ở Ma trận.
// Lưu trữ KHÔNG đổi cột: sở thích vẫn là mảng (cột hobbies, TEXT chứa JSON); habits /
// personality / remember_notes.likes / .avoid vẫn là chữ, các thẻ nối bằng ", " — dữ liệu
// cũ "Chạy bộ 5h, không uống bia" tự tách thành 2 thẻ.
// ============================================================================
import { normalizeSearch } from './search';
import type { CskhContact } from './types';

export type TraitField = 'interests' | 'habits' | 'personality' | 'likes' | 'avoid';

export const TRAIT_FIELDS: readonly TraitField[] = ['interests', 'habits', 'personality', 'likes', 'avoid'];

export const TRAIT_LABEL: Readonly<Record<TraitField, string>> = {
  interests: 'Sở thích',
  habits: 'Thói quen',
  personality: 'Tính cách',
  likes: 'Món ăn, đồ uống',
  avoid: 'Kiêng kỵ',
};

/** Thẻ mẫu cho khách doanh nghiệp (người đại diện công ty khách hàng). */
export const TRAIT_PRESETS: Readonly<Record<TraitField, readonly string[]>> = {
  interests: [
    'Golf', 'Du lịch', 'Bóng đá', 'Tennis', 'Cầu lông', 'Chạy bộ', 'Gym / thể hình', 'Câu cá', 'Đọc sách',
    'Âm nhạc', 'Karaoke', 'Nhiếp ảnh', 'Xe hơi', 'Đầu tư - chứng khoán', 'Cờ tướng', 'Yoga - thiền', 'Cây cảnh',
  ],
  habits: [
    'Dậy sớm', 'Chạy bộ buổi sáng', 'Hay đi công tác', 'Ngủ trưa', 'Uống trà buổi sáng',
    'Hay làm việc khuya', 'Tập gym đều đặn', 'Đi lễ chùa', 'Hút thuốc lá',
  ],
  personality: [
    'Quyết đoán', 'Cẩn thận', 'Hài hước', 'Ít nói', 'Nhiệt tình', 'Thẳng thắn', 'Kín đáo', 'Chu đáo',
    'Nóng tính', 'Điềm đạm', 'Cầu toàn', 'Phóng khoáng', 'Trọng chữ tín', 'Kỹ tính về số liệu',
  ],
  likes: [
    'Cà phê', 'Trà', 'Bia', 'Rượu vang', 'Hải sản', 'Lẩu', 'Đồ nướng', 'Đồ ăn cay', 'Món chay', 'Đồ Hàn', 'Đồ Nhật', 'Trái cây',
  ],
  avoid: [
    'Không uống rượu bia', 'Ăn chay', 'Không ăn cay', 'Không hút thuốc', 'Dị ứng hải sản', 'Không ăn thịt bò', 'Không ăn thịt chó',
  ],
};

/** Độ dài tối đa 1 thẻ / số thẻ tối đa 1 mục (remember_notes bị kiểm ≤ 8KB ở DB). */
export const TAG_MAX_CHARS = 60;
export const TAG_MAX = 30;

export const tagKey = (s: string): string => normalizeSearch(s);

/** Tách chữ thành thẻ (phẩy, chấm phẩy, xuống dòng), bỏ trùng không phân biệt dấu/hoa. */
export function splitTags(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(/[,;\n]/)) {
    const t = raw.replace(/\s+/g, ' ').trim().slice(0, TAG_MAX_CHARS).trim();
    const k = tagKey(t);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

export const joinTags = (tags: readonly string[]): string => tags.join(', ');

export type TraitSource = Pick<CskhContact, 'interests' | 'habits' | 'personality' | 'rememberNotes'>;

export function traitTags(c: TraitSource, field: TraitField): string[] {
  switch (field) {
    case 'interests': return splitTags(c.interests.join(','));
    case 'habits': return splitTags(c.habits);
    case 'personality': return splitTags(c.personality);
    case 'likes': return splitTags(c.rememberNotes.likes ?? '');
    case 'avoid': return splitTags(c.rememberNotes.avoid ?? '');
  }
}

export interface TagStat {
  key: string;
  /** Cách viết phổ biến nhất. */
  label: string;
  /** Số người có thẻ này. */
  count: number;
}

/** Thống kê thẻ của 1 mục trên cả danh bạ: nhiều người nhất trước. */
export function buildTagStats(contacts: readonly TraitSource[], field: TraitField): TagStat[] {
  const byKey = new Map<string, { count: number; spellings: Map<string, number> }>();
  for (const c of contacts) {
    for (const t of traitTags(c, field)) {
      const k = tagKey(t);
      const s = byKey.get(k) ?? { count: 0, spellings: new Map<string, number>() };
      s.count += 1;
      s.spellings.set(t, (s.spellings.get(t) ?? 0) + 1);
      byKey.set(k, s);
    }
  }
  return [...byKey.entries()]
    .map(([key, s]) => ({
      key,
      count: s.count,
      label: [...s.spellings.entries()].sort((a, b) => b[1] - a[1])[0][0],
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'vi'));
}

/**
 * Gợi ý: thẻ của người khác (đếm số người) + thẻ mẫu, bỏ thẻ đã chọn. Có chữ đang gõ thì chỉ
 * giữ thẻ chứa chữ đó (không dấu), thẻ BẮT ĐẦU bằng chữ đó lên trước.
 */
export function suggestTags(
  stats: readonly TagStat[],
  presets: readonly string[],
  selected: readonly string[],
  query: string,
  limit: number,
): TagStat[] {
  const chosen = new Set(selected.map(tagKey));
  const pool = new Map<string, TagStat>();
  for (const s of stats) pool.set(s.key, s);
  for (const p of presets) {
    const k = tagKey(p);
    if (!pool.has(k)) pool.set(k, { key: k, label: p, count: 0 });
  }
  const q = tagKey(query);
  return [...pool.values()]
    .filter(s => !chosen.has(s.key) && (!q || s.key.includes(q)))
    .sort((a, b) => (q ? Number(b.key.startsWith(q)) - Number(a.key.startsWith(q)) : 0) || b.count - a.count)
    .slice(0, limit);
}

/** Thêm thẻ: trùng cách viết đã có (khác dấu/hoa) thì dùng cách viết chung; không thêm trùng. */
export function addTag(
  tags: readonly string[],
  raw: string,
  stats: readonly TagStat[],
  presets: readonly string[],
): string[] {
  const added = splitTags(raw);
  const next = [...tags];
  const seen = new Set(next.map(tagKey));
  for (const t of added) {
    const k = tagKey(t);
    if (seen.has(k) || next.length >= TAG_MAX) continue;
    const known = stats.find(s => s.key === k)?.label ?? presets.find(p => tagKey(p) === k);
    seen.add(k);
    next.push(known ?? t);
  }
  return next;
}

/** Giá trị bộ lọc ở Ma trận: "<mục>:<khoá thẻ>". */
export function traitFilterValue(field: TraitField, key: string): string {
  return `${field}:${key}`;
}

export function parseTraitFilter(value: string): { field: TraitField; key: string } | null {
  const i = value.indexOf(':');
  const field = value.slice(0, i) as TraitField;
  return i > 0 && TRAIT_FIELDS.includes(field) ? { field, key: value.slice(i + 1) } : null;
}

export function hasTrait(c: TraitSource, field: TraitField, key: string): boolean {
  return traitTags(c, field).some(t => tagKey(t) === key);
}
