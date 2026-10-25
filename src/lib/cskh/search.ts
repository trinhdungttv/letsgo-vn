// ============================================================================
// CSKH — Tìm người liên hệ không phân biệt dấu / hoa-thường (port PRM search.ts)
// Gõ "nguyen van a" vẫn ra "Nguyễn Văn A"; gõ 0901… vẫn ra số lưu dạng +84901…
// ============================================================================
import { normalizePhone } from './contactActions';
import type { CskhContact } from './types';

/** Bỏ dấu tiếng Việt, "đ" → "d", về chữ thường, gom khoảng trắng. */
export function normalizeSearch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Chuỗi để so khớp: tên, tên thân mật, công ty, chức vụ, email, SĐT (chỉ giữ chữ số), tên
 * trường, sở thích / thói quen / tính cách, quê quán (gõ "golf" ra những người chơi golf,
 * gõ "kinh te" ra người học ĐH Kinh tế).
 */
export function contactSearchHaystack(
  c: Pick<CskhContact, 'fullName' | 'nickname' | 'organization' | 'jobTitle' | 'phones' | 'emails'>
    & Partial<Pick<CskhContact, 'education' | 'interests' | 'habits' | 'personality' | 'originProvince'>>,
  extra: readonly string[] = [],
): string {
  // Mỗi SĐT giữ cả dạng gốc (chỉ số) lẫn dạng nội địa 0xxx
  const phones = c.phones
    .map(p => `${p.replace(/\D/g, '')} ${normalizePhone(p).replace(/\D/g, '')}`)
    .join(' ');
  const schools = (c.education ?? []).map(e => e.school).join(' ');
  const traits = [(c.interests ?? []).join(' '), c.habits ?? '', c.personality ?? '', c.originProvince ?? ''].join(' ');
  return normalizeSearch([c.fullName, c.nickname, c.organization, c.jobTitle, c.emails.join(' '), schools, traits, ...extra].join(' ')) + ' ' + phones;
}

/** Mọi từ trong truy vấn đều phải xuất hiện (thứ tự không quan trọng). Truy vấn rỗng = khớp hết. */
export function matchesQuery(haystack: string, query: string): boolean {
  const q = normalizeSearch(query);
  if (q === '') return true;
  // Từ thuần số (SĐT): bỏ ký tự không phải số để gõ "0901 234" vẫn khớp
  return q.split(' ').every(token =>
    haystack.includes(token) || (/^[\d+().-]+$/.test(token) && haystack.includes(token.replace(/\D/g, ''))));
}
