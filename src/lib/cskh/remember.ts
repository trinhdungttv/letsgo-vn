// ============================================================================
// CSKH — "Điều cần nhớ" (contacts.remember_notes, jsonb) — port PRM remember.ts
// Làm sạch trước khi lưu: cắt khoảng trắng, bỏ mục rỗng, cắt ≤ 500 ký tự/mục,
// bỏ khoá lạ. Tổng ≤ 8KB do DB kiểm (migration 169).
// Gia đình có cấu trúc (vợ/chồng + con kèm năm sinh) nằm ở remember_notes.members —
// cùng cột jsonb, không cần migration; `family` (chữ) giữ làm ghi chú gia đình.
// ============================================================================
import type { FamilyMember, RememberKey, RememberNotes } from './types';

export const REMEMBER_KEYS: readonly RememberKey[] = ['family', 'likes', 'avoid', 'work', 'other'];
export const REMEMBER_MAX_CHARS = 500;
/** Tối đa bao nhiêu người trong gia đình / độ dài tên. */
export const FAMILY_MAX = 12;
export const FAMILY_NAME_MAX = 60;
const FAMILY_MIN_YEAR = 1900;

const currentYear = () => new Date().getFullYear();

/** Ví dụ cụ thể cho ô nhập (placeholder). */
export const REMEMBER_PLACEHOLDER: Readonly<Record<RememberKey, string>> = {
  family: 'VD: Vợ là cô giáo, con gái học lớp 5, quê Nam Định',
  likes: 'VD: Cà phê đen, lẩu hải sản',
  avoid: 'VD: Không uống rượu bia',
  work: 'VD: Đang mở xưởng 2 ở VSIP, cần thêm 50 LĐ quý 1',
  other: 'VD: Hay đi công tác Hàn Quốc đầu tháng',
};

/** Năm sinh gõ tay: rỗng = chưa biết; sai thì trả câu tiếng Việt. */
export function familyYearError(text: string, thisYear: number = currentYear()): string | null {
  const t = text.trim();
  if (t === '') return null;
  const y = Number(t);
  if (!/^\d{4}$/.test(t) || y < FAMILY_MIN_YEAR || y > thisYear) {
    return `Năm sinh "${t}" không hợp lệ — nhập 4 chữ số (${FAMILY_MIN_YEAR}–${thisYear}).`;
  }
  return null;
}

/** Làm sạch danh sách gia đình: bỏ dòng trống, cắt tên, năm sai → null. */
export function cleanFamily(list: unknown, thisYear: number = currentYear()): FamilyMember[] {
  if (!Array.isArray(list)) return [];
  const out: FamilyMember[] = [];
  for (const m of list as Array<Partial<FamilyMember> | null>) {
    if (!m || (m.role !== 'spouse' && m.role !== 'child')) continue;
    const name = typeof m.name === 'string' ? m.name.replace(/\s+/g, ' ').trim().slice(0, FAMILY_NAME_MAX) : '';
    const year = typeof m.year === 'number' && Number.isInteger(m.year) && m.year >= FAMILY_MIN_YEAR && m.year <= thisYear
      ? m.year
      : null;
    if (name === '' && year === null) continue;
    out.push({ role: m.role, name, year });
    if (out.length >= FAMILY_MAX) break;
  }
  return out;
}

/** Cắt khoảng trắng, bỏ mục rỗng, cắt độ dài, bỏ khoá lạ — GIỮ khoá `members`. Luôn trả object mới. */
export function cleanRememberNotes(notes: RememberNotes | null | undefined, thisYear: number = currentYear()): RememberNotes {
  const out: RememberNotes = {};
  if (!notes || typeof notes !== 'object') return out;
  for (const key of REMEMBER_KEYS) {
    const raw = (notes as Record<string, unknown>)[key];
    const value = typeof raw === 'string' ? raw.trim().slice(0, REMEMBER_MAX_CHARS) : '';
    if (value !== '') out[key] = value;
  }
  const members = cleanFamily(notes.members, thisYear);
  if (members.length > 0) out.members = members;
  return out;
}

export function hasRememberNotes(notes: RememberNotes | null | undefined): boolean {
  return Object.keys(cleanRememberNotes(notes)).length > 0;
}

/** Tuổi theo năm dương lịch (0 = sinh năm nay). */
export function familyAge(year: number | null, thisYear: number = currentYear()): number | null {
  return year === null ? null : Math.max(0, thisYear - year);
}

function memberText(m: FamilyMember, thisYear: number): string {
  const age = familyAge(m.year, thisYear);
  const when = m.year === null ? '' : ` (${m.year}${age === 0 ? ', mới sinh' : `, ${age} tuổi`})`;
  return `${m.name || '?'}${when}`;
}

/** "Vợ/chồng: Lan (1990, 36 tuổi) · Con: Gạo (2019, 7 tuổi), Bin" — hiện nhanh trước khi liên hệ. */
export function familySummary(members: readonly FamilyMember[] | undefined, thisYear: number = currentYear()): string {
  const list = cleanFamily(members ?? [], thisYear);
  const spouse = list.filter(m => m.role === 'spouse').map(m => memberText(m, thisYear));
  const kids = list.filter(m => m.role === 'child').map(m => memberText(m, thisYear));
  return [
    spouse.length > 0 ? `Vợ/chồng: ${spouse.join(', ')}` : '',
    kids.length > 0 ? `Con: ${kids.join(', ')}` : '',
  ].filter(Boolean).join(' · ');
}

/** Các dòng "Điều cần nhớ" để hiện (mục gia đình gồm thành viên + ghi chú). */
export function rememberDisplayRows(
  notes: RememberNotes | null | undefined,
  thisYear: number = currentYear(),
): Array<{ key: RememberKey; value: string }> {
  const clean = cleanRememberNotes(notes, thisYear);
  return REMEMBER_KEYS
    .map(key => ({
      key,
      value: key === 'family'
        ? [familySummary(clean.members, thisYear), clean.family ?? ''].filter(Boolean).join(' · ')
        : clean[key] ?? '',
    }))
    .filter(r => r.value !== '');
}
