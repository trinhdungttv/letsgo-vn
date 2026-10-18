import type { CalcFee, MonthKey } from './types';
import { isMonthKey } from './months';

export const BOM = '﻿';
export const FEE_CSV_HEADER = ['Thang', 'Khach_hang', 'Dien', 'Xe_may', 'O_to'] as const;

export interface CsvRecord {
  /** Số dòng (1-based) trong file nơi bản ghi bắt đầu */
  line: number;
  cells: string[];
}

/** Đọc CSV: hỗ trợ BOM, dấu ngoặc kép ("" = "), dấu phẩy/xuống dòng trong ô, CRLF. */
export function parseCsv(text: string): CsvRecord[] {
  const src = text.startsWith(BOM) ? text.slice(1) : text;
  const out: CsvRecord[] = [];
  let cells: string[] = [];
  let cell = '';
  let inQuotes = false;
  let line = 1;
  let recordLine = 1;
  let i = 0;
  const pushRecord = () => {
    cells.push(cell);
    if (!(cells.length === 1 && cells[0].trim() === '')) out.push({ line: recordLine, cells });
    cells = [];
    cell = '';
  };
  while (i < src.length) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      if (ch === '\n') line++;
      cell += ch; i++; continue;
    }
    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === ',') { cells.push(cell); cell = ''; i++; continue; }
    if (ch === '\r') { i++; continue; }
    if (ch === '\n') { pushRecord(); line++; recordLine = line; i++; continue; }
    cell += ch; i++;
  }
  if (cell !== '' || cells.length) pushRecord();
  return out;
}

export function csvEscape(v: string | number | null | undefined): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return BOM + rows.map(r => r.map(csvEscape).join(',')).join('\r\n') + '\r\n';
}

// ── CSV phụ phí điện / xe ─────────────────────────────────────────────────

export interface FeeCsvRow {
  line: number;
  month: MonthKey;
  tenantId: string;
  tenantName: string;
  fee: CalcFee;
}

export interface FeeCsvResult {
  rows: FeeCsvRow[];
  errors: { line: number; message: string }[];
  warnings: { line: number; message: string }[];
}

function parseAmount(raw: string): number | 'bad' | 'neg' {
  const s = raw.trim().replace(/\s/g, '');
  if (!s) return 0;
  // Cho phép "2,000,000" hoặc "2000000" (dấu phẩy ngăn cách hàng nghìn), cấm số lẻ
  if (!/^-?\d{1,3}(,\d{3})*$|^-?\d+$/.test(s)) return 'bad';
  const n = Number(s.replace(/,/g, ''));
  if (!Number.isFinite(n)) return 'bad';
  return n < 0 ? 'neg' : n;
}

function parseCount(raw: string): number | 'bad' | 'neg' {
  const s = raw.trim();
  if (!s) return 0;
  if (/^-\d+$/.test(s)) return 'neg';
  if (!/^\d+$/.test(s)) return 'bad';
  return Number(s);
}

/** Khớp tên khách không phân biệt hoa thường / khoảng trắng thừa. */
export function normName(s: string): string {
  return s.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('vi');
}

export function parseFeeCsv(text: string, tenants: { id: string; name: string }[]): FeeCsvResult {
  const errors: FeeCsvResult['errors'] = [];
  const warnings: FeeCsvResult['warnings'] = [];
  const records = parseCsv(text);
  if (!records.length) return { rows: [], errors: [{ line: 1, message: 'File trống' }], warnings };

  const header = records[0].cells.map(c => c.trim());
  const headerOk = header.length >= FEE_CSV_HEADER.length
    && FEE_CSV_HEADER.every((h, i) => header[i].toLowerCase() === h.toLowerCase());
  if (!headerOk) {
    return {
      rows: [],
      errors: [{ line: records[0].line, message: `Sai tiêu đề cột — cần đúng: ${FEE_CSV_HEADER.join(',')}` }],
      warnings,
    };
  }

  const byName = new Map(tenants.map(t => [normName(t.name), t]));
  const byKey = new Map<string, FeeCsvRow>();
  for (const rec of records.slice(1)) {
    const [mRaw = '', nameRaw = '', dRaw = '', motoRaw = '', carRaw = ''] = rec.cells;
    const month = mRaw.trim();
    const problems: string[] = [];
    if (!isMonthKey(month)) problems.push(`sai định dạng tháng "${mRaw}" (cần YYYY-MM, vd 2026-08)`);
    const tenant = byName.get(normName(nameRaw));
    if (!nameRaw.trim()) problems.push('thiếu tên khách hàng');
    else if (!tenant) problems.push(`không tìm thấy khách "${nameRaw.trim()}"`);
    const dien = parseAmount(dRaw);
    if (dien === 'bad') problems.push(`tiền điện "${dRaw}" không phải số nguyên`);
    if (dien === 'neg') problems.push('tiền điện âm');
    const moto = parseCount(motoRaw);
    if (moto === 'bad') problems.push(`số xe máy "${motoRaw}" không phải số nguyên`);
    if (moto === 'neg') problems.push('số xe máy âm');
    const car = parseCount(carRaw);
    if (car === 'bad') problems.push(`số ô tô "${carRaw}" không phải số nguyên`);
    if (car === 'neg') problems.push('số ô tô âm');
    if (problems.length || !tenant || typeof dien !== 'number' || typeof moto !== 'number' || typeof car !== 'number') {
      errors.push({ line: rec.line, message: problems.join('; ') });
      continue;
    }
    const key = `${tenant.id}|${month}`;
    const prev = byKey.get(key);
    if (prev) warnings.push({ line: rec.line, message: `trùng khách + tháng với dòng ${prev.line} — lấy dòng sau` });
    byKey.delete(key);
    byKey.set(key, { line: rec.line, month, tenantId: tenant.id, tenantName: tenant.name, fee: { electricity: dien, moto, car } });
  }
  return { rows: [...byKey.values()], errors, warnings };
}

/** File mẫu: điền sẵn danh sách khách (và số đã có) của tháng được chọn. */
export function buildFeeCsvTemplate(month: MonthKey, tenants: { id: string; name: string }[], existing?: Record<string, CalcFee>): string {
  const rows: (string | number)[][] = [[...FEE_CSV_HEADER]];
  for (const t of tenants) {
    const f = existing?.[t.id];
    rows.push([month, t.name, f?.electricity || 0, f?.moto || 0, f?.car || 0]);
  }
  return toCsv(rows);
}
