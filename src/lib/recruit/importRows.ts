// Nhập ứng viên từ Excel: nhận diện cột theo tên tiêu đề tiếng Việt (có/không dấu, nhiều cách gọi),
// chuẩn hoá từng dòng trước khi gửi recruit_rpc('import'). File thuần — test ở importRows.test.ts.
import { cleanName, foldVn, normalizeIdNumber, normalizePhone, parseBirthYear } from './normalize';
import type { Education } from './types';

export type ImportField =
  | 'full_name' | 'phone' | 'id_number' | 'birth_year' | 'gender' | 'province' | 'commune' | 'address'
  | 'hometown' | 'education' | 'major' | 'experience' | 'source_channel' | 'referrer_name' | 'note'
  | 'start_date' | 'planned_start';

export const IMPORT_FIELD_LABEL: Readonly<Record<ImportField, string>> = {
  full_name: 'Họ tên', phone: 'SĐT', id_number: 'CCCD', birth_year: 'Năm sinh', gender: 'Giới tính',
  province: 'Tỉnh/TP', commune: 'Xã/Phường', address: 'Địa chỉ', hometown: 'Quê quán', education: 'Trình độ',
  major: 'Chuyên ngành', experience: 'Kinh nghiệm', source_channel: 'Nguồn', referrer_name: 'Người giới thiệu',
  note: 'Ghi chú', start_date: 'Ngày đi làm', planned_start: 'Ngày nhận việc dự kiến',
};

// Từ khoá (đã bỏ dấu, chữ thường) → trường. Thứ tự quan trọng: khớp cụ thể trước, chung sau.
const HEADER_RULES: readonly [RegExp, ImportField][] = [
  [/^(ho (va )?ten|ten)( (ung vien|nld|lao dong|cong nhan|nhan vien))?$|^(full ?name|name)$/, 'full_name'],
  [/\b(dien thoai|dt|sdt|phone|mobile|zalo)\b/, 'phone'],
  [/\b(cccd|cmnd|can cuoc|cmt|id ?number)\b/, 'id_number'],
  [/\b(nam sinh|ngay sinh|dob|birth)\b/, 'birth_year'],
  [/\b(gioi tinh|gender|phai)\b/, 'gender'],
  [/\b(xa|phuong|commune|ward)\b/, 'commune'],
  [/^(tinh|thanh pho|tinh thanh|tinh ?\/ ?(tp|thanh pho)|province|city)$/, 'province'],
  [/\b(que quan|que|hometown|nguyen quan)\b/, 'hometown'],
  [/\b(dia chi|cho o|noi o|address|tam tru|thuong tru)\b/, 'address'],
  [/\b(trinh do|hoc van|bang cap|education)\b/, 'education'],
  [/\b(chuyen nganh|nganh hoc|nganh|major)\b/, 'major'],
  [/\b(kinh nghiem|experience)\b/, 'experience'],
  [/\b(nguoi gioi thieu|ctv|gioi thieu|referr\w*)\b/, 'referrer_name'],
  [/\b(nguon|kenh|source)\b/, 'source_channel'],
  [/\b(du kien|hen nhan viec|planned)\b/, 'planned_start'],
  [/\b(ngay (di lam|vao lam|nhan viec)|start)\b/, 'start_date'],
  [/\b(ghi chu|note|chu thich)\b/, 'note'],
];

/** Tiêu đề cột → trường (null = bỏ qua cột này). */
export function guessField(header: string): ImportField | null {
  const h = foldVn(header).replace(/[*:._]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!h || /^(stt|tt|no|#)$/.test(h)) return null;
  for (const [re, field] of HEADER_RULES) if (re.test(h)) return field;
  return null;
}

export function mapHeaders(headers: string[]): (ImportField | null)[] {
  const used = new Set<ImportField>();
  return headers.map(h => {
    const f = guessField(h);
    if (!f || used.has(f)) return null; // 2 cột cùng nghĩa → lấy cột đầu
    used.add(f);
    return f;
  });
}

export function parseGender(raw: unknown): 'male' | 'female' | null {
  const s = foldVn(String(raw ?? '')).trim();
  if (/^(nam|male|m|trai|anh)$/.test(s)) return 'male';
  if (/^(nu|female|f|gai|chi)$/.test(s)) return 'female';
  return null;
}

export function parseEducation(raw: unknown): Education {
  const s = foldVn(String(raw ?? '')).trim();
  if (!s) return '';
  if (/dai hoc|cu nhan|ky su|^dh$/.test(s)) return 'dai_hoc';
  if (/cao dang|^cd$/.test(s)) return 'cao_dang';
  if (/trung cap|^tc$/.test(s)) return 'trung_cap';
  if (/12\/12|thpt|cap 3|lop 12|^12$/.test(s)) return 'thpt';
  if (/9\/12|thcs|cap 2|lop 9|^9$/.test(s)) return 'thcs';
  if (/^\d{1,2}(\/12)?$/.test(s)) return Number(s.split('/')[0]) >= 12 ? 'thpt' : Number(s.split('/')[0]) >= 9 ? 'thcs' : 'none';
  return '';
}

/** Ngày từ ô Excel (Date / số ngày Excel / dd/mm/yyyy / yyyy-mm-dd) → 'YYYY-MM-DD' hoặc ''. */
export function parseDateCell(raw: unknown): string {
  if (raw == null || raw === '') return '';
  const iso = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return iso(new Date(Date.UTC(raw.getFullYear(), raw.getMonth(), raw.getDate())));
  }
  if (typeof raw === 'number' && raw > 20000 && raw < 80000) return iso(new Date(Date.UTC(1899, 11, 30) + Math.round(raw) * 86400000));
  const s = String(raw).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return '';
}

export interface ImportRow {
  full_name: string;
  phone: string;
  id_number: string;
  birth_year: number | null;
  gender: 'male' | 'female' | null;
  province: string;
  commune: string;
  address: string;
  hometown: string;
  education: Education;
  major: string;
  experience: string;
  source_channel: string;
  referrer_name: string;
  note: string;
  start_date: string;
  planned_start: string;
}

export interface PreparedImport {
  rows: ImportRow[];
  /** số dòng Excel của từng dòng trong `rows` (cùng thứ tự) — để báo lỗi từ server đúng dòng */
  rowNos: number[];
  /** dòng bị loại ngay ở máy (thiếu tên / thiếu cả SĐT lẫn CCCD / trùng trong chính file) */
  rejected: { row: number; reason: string }[];
}

/**
 * Chuẩn hoá các dòng đọc từ sheet (mảng giá trị theo cột) theo bảng ánh xạ cột → trường.
 * `firstRow` = số dòng Excel của dòng dữ liệu đầu tiên (để báo lỗi đúng số dòng người dùng thấy).
 */
export function prepareImport(data: unknown[][], mapping: (ImportField | null)[], firstRow = 2): PreparedImport {
  const rows: ImportRow[] = [];
  const rowNos: number[] = [];
  const rejected: PreparedImport['rejected'] = [];
  const seen = new Set<string>();
  data.forEach((cells, i) => {
    const rowNo = firstRow + i;
    const get = (f: ImportField): unknown => {
      const idx = mapping.indexOf(f);
      return idx >= 0 ? cells[idx] : undefined;
    };
    const str = (f: ImportField) => String(get(f) ?? '').replace(/\s+/g, ' ').trim();
    if (cells.every(c => c == null || String(c).trim() === '')) return;
    const row: ImportRow = {
      full_name: cleanName(str('full_name')),
      phone: normalizePhone(str('phone')),
      id_number: normalizeIdNumber(str('id_number')),
      birth_year: parseBirthYear(get('birth_year')),
      gender: parseGender(get('gender')),
      province: str('province'),
      commune: str('commune'),
      address: str('address'),
      hometown: str('hometown'),
      education: parseEducation(get('education')),
      major: str('major'),
      experience: str('experience'),
      source_channel: str('source_channel'),
      referrer_name: str('referrer_name'),
      note: str('note'),
      start_date: parseDateCell(get('start_date')),
      planned_start: parseDateCell(get('planned_start')),
    };
    if (!row.full_name) { rejected.push({ row: rowNo, reason: 'Thiếu họ tên' }); return; }
    if (!row.phone && !row.id_number) { rejected.push({ row: rowNo, reason: 'Thiếu cả SĐT lẫn CCCD' }); return; }
    if (row.phone && !/^0\d{9}$/.test(row.phone)) { rejected.push({ row: rowNo, reason: `SĐT "${str('phone')}" không hợp lệ` }); return; }
    if (row.id_number && !/^(\d{9}|\d{12})$/.test(row.id_number)) { rejected.push({ row: rowNo, reason: `CCCD "${str('id_number')}" không hợp lệ` }); return; }
    const key = row.phone || `id:${row.id_number}`;
    if (seen.has(key)) { rejected.push({ row: rowNo, reason: 'Trùng SĐT/CCCD với dòng trên trong file' }); return; }
    seen.add(key);
    rows.push(row);
    rowNos.push(rowNo);
  });
  return { rows, rowNos, rejected };
}
