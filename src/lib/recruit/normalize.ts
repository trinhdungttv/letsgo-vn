// Chuẩn hoá dữ liệu ứng viên trước khi gửi lên (server kiểm tra lại cùng quy tắc — migration 180).
// File thuần, test ở normalize.test.ts.

/** SĐT về dạng 0xxxxxxxxx: bỏ ký tự không phải số, +84 / 84 → 0, thiếu số 0 đầu thì thêm. */
export function normalizePhone(raw: string | null | undefined): string {
  const d = String(raw ?? '').replace(/\D/g, '');
  if (/^84\d{9}$/.test(d)) return '0' + d.slice(2);
  if (/^[1-9]\d{8}$/.test(d)) return '0' + d;
  return d;
}

export const isValidPhone = (p: string): boolean => /^0\d{9}$/.test(p);

/** CCCD 12 số / CMND cũ 9 số — chỉ giữ chữ số. */
export const normalizeIdNumber = (raw: string | null | undefined): string => String(raw ?? '').replace(/\D/g, '');
export const isValidIdNumber = (s: string): boolean => /^(\d{9}|\d{12})$/.test(s);

/** Hiển thị SĐT dễ đọc: 0912 345 678. */
export function formatPhone(p: string): string {
  return /^0\d{9}$/.test(p) ? `${p.slice(0, 4)} ${p.slice(4, 7)} ${p.slice(7)}` : p;
}

/**
 * Năm sinh từ ô Excel / gõ tay: "1999", 1999, "12/05/1999", "1999-05-12", số ngày Excel (36000…).
 * Không hiểu → null.
 */
export function parseBirthYear(raw: unknown, nowYear = new Date().getFullYear()): number | null {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number') {
    if (raw >= 1940 && raw <= nowYear) return Math.round(raw);
    // số ngày kiểu Excel (1900-based): 1940 ≈ 14611, nay ≈ 46000
    if (raw > 14000 && raw < 60000) {
      const year = new Date(Date.UTC(1899, 11, 30) + raw * 86400000).getUTCFullYear();
      return year >= 1940 && year <= nowYear ? year : null;
    }
    return null;
  }
  const s = String(raw).trim();
  const m = s.match(/(19[4-9]\d|20[0-2]\d)/);
  if (!m) return null;
  const y = Number(m[1]);
  return y <= nowYear ? y : null;
}

/** Tuổi theo năm sinh (đủ dùng để lọc / hiển thị). */
export const ageOf = (birthYear: number | null, nowYear = new Date().getFullYear()): number | null =>
  birthYear ? nowYear - birthYear : null;

/**
 * Họ tên: gộp khoảng trắng; nếu cả tên viết thường hết hoặc HOA hết (hay gặp khi dán từ Excel / Zalo)
 * thì đổi về Viết Hoa Chữ Đầu. Tên đã gõ đúng kiểu thì giữ nguyên.
 */
export function cleanName(raw: string | null | undefined): string {
  const s = String(raw ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  const lower = s.toLocaleLowerCase('vi');
  const upper = s.toLocaleUpperCase('vi');
  if (s !== lower && s !== upper) return s;
  return lower.split(' ').map(w => w.charAt(0).toLocaleUpperCase('vi') + w.slice(1)).join(' ');
}

/** Bỏ dấu + chữ thường (cùng quy tắc recruit__fold ở DB) — so khớp tên không dấu. */
export function foldVn(s: string | null | undefined): string {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

export const telHref = (phone: string): string => `tel:${phone}`;
export const zaloHref = (phone: string): string => `https://zalo.me/${phone}`;
