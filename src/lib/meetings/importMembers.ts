// Nhập danh sách thành viên từ file Excel cùng dạng "Danh sách đăng ký ra vào cổng" (hoặc bảng bất kỳ có dòng tiêu đề
// "Họ và Tên / Giới tính / Năm sinh / Số CMND/CCCD / Ngày cấp / Nơi cấp / Địa chỉ thường trú / Chức vụ").
// Thuần (có test): nhận bảng chữ đã đọc từ file → danh sách thành viên.
import { foldVn } from '../companyMatch';
import type { MemberDraft, MemberGender } from './types';

type Field = keyof Pick<MemberDraft, 'full_name' | 'gender' | 'birth' | 'id_number' | 'id_issued_on' | 'id_issued_by' | 'address' | 'title' | 'phone' | 'vehicle_plate'>;

/** Nhận diện cột theo tiêu đề (đã bỏ dấu, chữ thường). Thứ tự quan trọng: "ngày cấp" trước "ngày sinh"… */
const HEADER_RULES: { field: Field; test: (h: string) => boolean }[] = [
  { field: 'full_name', test: h => /ho (va )?ten|^ten$|ho ten/.test(h) },
  { field: 'gender', test: h => /gioi tinh|^gt$|phai/.test(h) },
  { field: 'id_issued_on', test: h => /ngay cap/.test(h) },
  { field: 'id_issued_by', test: h => /noi cap/.test(h) },
  { field: 'birth', test: h => /nam sinh|ngay sinh|ngay thang nam sinh/.test(h) },
  { field: 'id_number', test: h => /cmnd|cccd|can cuoc|so dinh danh/.test(h) },
  { field: 'address', test: h => /dia chi|thuong tru|ho khau/.test(h) },
  { field: 'title', test: h => /chuc vu|chuc danh|vi tri/.test(h) },
  { field: 'phone', test: h => /dien thoai|sdt|so dt|di dong/.test(h) },
  { field: 'vehicle_plate', test: h => /bien so|bks|so xe/.test(h) },
];

export type ImportedMember = Pick<MemberDraft, Field>;

export interface MemberImportResult {
  rows: ImportedMember[];
  /** Cột đã nhận ra (để báo người dùng). */
  columns: Field[];
  /** Không thấy dòng tiêu đề có "Họ và Tên". */
  noHeader: boolean;
}

const norm = (s: string) => foldVn(s).replace(/\s+/g, ' ').trim();

/** "25/05/2023", "25-05-2023", "2023-05-25" → "2023-05-25"; không hiểu → null. */
export function parseVnDate(s: string): string | null {
  const t = s.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t);
  if (m) return valid(+m[3], +m[2], +m[1]);
  return null;
}
function valid(y: number, mo: number, d: number): string | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1900 || y > 2100) return null;
  const dt = new Date(y, mo - 1, d);
  if (dt.getMonth() !== mo - 1) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function parseGender(s: string): MemberGender {
  const f = norm(s);
  if (/^(nam|male|m)$/.test(f)) return 'Nam';
  if (/^(nu|female|f)$/.test(f)) return 'Nữ';
  return '';
}

/**
 * Số CCCD/CMND: giữ chữ số. Excel hay làm mất số 0 đầu khi ô là số (030183011915 → 30183011915) →
 * 11 chữ số thì thêm lại số 0 (CCCD 12 số luôn bắt đầu bằng mã tỉnh 0xx), 8 chữ số → CMND 9 số.
 */
export function normalizeIdNumber(s: string): string {
  const d = s.replace(/\D/g, '');
  if (d.length === 11 || d.length === 8) return `0${d}`;
  return d || s.trim();
}

/** Bảng chữ (dòng × cột, ô trống = '') → danh sách thành viên. */
export function parseMemberTable(table: readonly (readonly string[])[]): MemberImportResult {
  const headerIdx = table.findIndex(row => row.some(c => /ho (va )?ten/.test(norm(c))));
  if (headerIdx < 0) return { rows: [], columns: [], noHeader: true };
  const header = table[headerIdx].map(norm);
  const colOf = new Map<Field, number>();
  header.forEach((h, i) => {
    if (!h) return;
    const rule = HEADER_RULES.find(r => r.test(h) && !colOf.has(r.field));
    if (rule) colOf.set(rule.field, i);
  });
  const get = (row: readonly string[], f: Field) => { const i = colOf.get(f); return i === undefined ? '' : (row[i] ?? '').trim(); };

  const rows: ImportedMember[] = [];
  for (const row of table.slice(headerIdx + 1)) {
    const name = get(row, 'full_name').replace(/\s+/g, ' ');
    if (!name) {
      // Hết bảng khi gặp dòng ngày ký / chữ ký bên dưới (dòng có chữ nhưng không có tên) sau khi đã có người
      if (rows.length && row.some(c => c.trim())) break;
      continue;
    }
    if (/^\d+$/.test(name)) continue;                       // dòng đánh số cột (1, 2, 3…)
    const birthRaw = get(row, 'birth');
    const birthDate = /^\d{4}$/.test(birthRaw) ? null : parseVnDate(birthRaw);
    rows.push({
      full_name: name,
      gender: parseGender(get(row, 'gender')),
      birth: birthDate ? birthDate.split('-').reverse().join('/') : birthRaw,
      id_number: normalizeIdNumber(get(row, 'id_number')),
      id_issued_on: parseVnDate(get(row, 'id_issued_on')),
      id_issued_by: get(row, 'id_issued_by'),
      address: get(row, 'address'),
      title: get(row, 'title'),
      phone: get(row, 'phone'),
      vehicle_plate: get(row, 'vehicle_plate').toUpperCase(),
    });
  }
  return { rows, columns: [...colOf.keys()], noHeader: false };
}

/** Đọc sheet đầu tiên (đang hiện) của file .xlsx thành bảng chữ. Ngày trong ô kiểu ngày → dd/mm/yyyy. */
export async function readXlsxTable(buf: ArrayBuffer): Promise<string[][]> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.worksheets.find(w => w.state !== 'hidden' && w.state !== 'veryHidden') ?? wb.worksheets[0];
  if (!ws) return [];
  const out: string[][] = [];
  ws.eachRow({ includeEmpty: true }, (row, r) => {
    const cells: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell, c) => {
      const v = cell.value;
      let s = '';
      if (v instanceof Date) {
        // ExcelJS trả ngày theo UTC
        s = `${String(v.getUTCDate()).padStart(2, '0')}/${String(v.getUTCMonth() + 1).padStart(2, '0')}/${v.getUTCFullYear()}`;
      } else if (v && typeof v === 'object' && 'richText' in v) {
        s = (v.richText as { text: string }[]).map(t => t.text).join('');
      } else if (v && typeof v === 'object' && 'result' in v) {
        s = String((v as { result?: unknown }).result ?? '');
      } else if (v != null) {
        s = String(v);
      }
      cells[c - 1] = s;
    });
    out[r - 1] = Array.from(cells, x => x ?? '');
  });
  return Array.from(out, x => x ?? []);
}
