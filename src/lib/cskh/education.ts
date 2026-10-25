// ============================================================================
// CSKH — Học vấn (contacts.education jsonb, migration 174) — port PRM education.ts
// Chuẩn hoá tên trường để nhiều người học cùng 1 trường được nhận ra (khác hoa/thường,
// dấu, khoảng trắng, dấu chấm vẫn là 1), danh bạ trường để gợi ý + đếm "cùng trường",
// làm sạch trước khi lưu.
// ============================================================================
import { normalizeSearch } from './search';
import type { CskhContact, Education, EducationLevel } from './types';
import { EDUCATION_LEVELS } from './types';

/** Khớp CHECK ở DB (tối đa 10 dòng) — giao diện cho thêm tối đa 6 cho gọn. */
export const EDUCATION_MAX_ROWS = 6;
export const SCHOOL_MAX_CHARS = 160;

/** Gom khoảng trắng, bỏ khoảng trắng đầu/cuối — giữ nguyên hoa/thường và dấu để hiển thị. */
export function tidySchoolName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().slice(0, SCHOOL_MAX_CHARS).trim();
}

/** Khoá nhận diện 1 trường: "ĐH Kinh tế TP.HCM" và "dh kinh te tp hcm" → cùng khoá. */
export function schoolKey(name: string): string {
  return normalizeSearch(name.replace(/[.,;:\-–—_/\\()'"“”‘’]+/g, ' '));
}

export interface SchoolEntry {
  key: string;
  /** Tên hiển thị chuẩn: cách viết được dùng nhiều nhất (hoà nhau thì lấy cách gặp trước). */
  name: string;
  /** Người học trường này (mỗi người 1 lần dù có nhiều dòng cùng trường). */
  contactIds: string[];
}

/** Danh bạ trường từ toàn bộ người liên hệ — nguồn gợi ý và đếm "cùng trường với N người". */
export function buildSchoolIndex(contacts: readonly Pick<CskhContact, 'id' | 'education'>[]): Map<string, SchoolEntry> {
  const variants = new Map<string, Map<string, number>>();
  const people = new Map<string, Set<string>>();
  for (const c of contacts) {
    for (const row of c.education ?? []) {
      const name = tidySchoolName(row.school ?? '');
      const key = schoolKey(name);
      if (!key) continue;
      const v = variants.get(key) ?? new Map<string, number>();
      v.set(name, (v.get(name) ?? 0) + 1);
      variants.set(key, v);
      const p = people.get(key) ?? new Set<string>();
      p.add(c.id);
      people.set(key, p);
    }
  }
  const index = new Map<string, SchoolEntry>();
  for (const [key, v] of variants) {
    let best = '';
    let bestCount = 0;
    for (const [name, count] of v) {
      if (count > bestCount) {
        best = name;
        bestCount = count;
      }
    }
    index.set(key, { key, name: best, contactIds: [...(people.get(key) ?? [])] });
  }
  return index;
}

/**
 * Gợi ý trường theo chuỗi đang gõ: mọi từ (bỏ dấu) phải có mặt. Ưu tiên tên bắt đầu bằng
 * chuỗi gõ, rồi trường đông người. Chuỗi rỗng = các trường đông người nhất.
 */
export function suggestSchools(index: ReadonlyMap<string, SchoolEntry>, query: string, limit = 8): SchoolEntry[] {
  const q = schoolKey(query);
  const tokens = q === '' ? [] : q.split(' ');
  const scored: { entry: SchoolEntry; starts: boolean }[] = [];
  for (const entry of index.values()) {
    if (!tokens.every(t => entry.key.includes(t))) continue;
    scored.push({ entry, starts: q !== '' && entry.key.startsWith(q) });
  }
  scored.sort((a, b) =>
    Number(b.starts) - Number(a.starts)
    || b.entry.contactIds.length - a.entry.contactIds.length
    || a.entry.name.localeCompare(b.entry.name, 'vi'));
  return scored.slice(0, limit).map(s => s.entry);
}

/** Tên trường sẽ lưu: trùng khoá với trường đã có → dùng đúng tên đã có; không thì giữ tên đã gom khoảng trắng. */
export function canonicalSchoolName(name: string, index?: ReadonlyMap<string, SchoolEntry>): string {
  const tidy = tidySchoolName(name);
  return index?.get(schoolKey(tidy))?.name ?? tidy;
}

const LEVELS = new Set<string>(EDUCATION_LEVELS);

/**
 * Làm sạch trước khi lưu (và khi đọc từ DB): bỏ dòng trống, bậc học lạ → '', chuẩn hoá tên
 * trường theo danh bạ, bỏ dòng trùng (cùng bậc + cùng trường), tối đa 10 dòng.
 */
export function cleanEducation(rows: unknown, index?: ReadonlyMap<string, SchoolEntry>): Education[] {
  if (!Array.isArray(rows)) return [];
  const out: Education[] = [];
  const seen = new Set<string>();
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as { level?: unknown; school?: unknown };
    const level = (typeof r.level === 'string' && LEVELS.has(r.level) ? r.level : '') as EducationLevel;
    const school = canonicalSchoolName(typeof r.school === 'string' ? r.school : '', index);
    if (!school && !level) continue;
    const dedupe = `${level}|${schoolKey(school)}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    out.push({ level, school });
    if (out.length >= 10) break;
  }
  return out;
}

/** Hai danh sách học vấn giống hệt nhau (để chỉ ghi cột education khi có thay đổi). */
export function sameEducation(a: readonly Education[], b: readonly Education[]): boolean {
  return a.length === b.length && a.every((r, i) => r.level === b[i].level && r.school === b[i].school);
}
