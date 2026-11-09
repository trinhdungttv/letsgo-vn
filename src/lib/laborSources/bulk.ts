// ============================================================================
// Nhập nhanh nhiều đơn vị nguồn: dán danh sách (từ Excel / Zalo / gõ tay), mỗi dòng 1 trường.
//   Tên trường | Tỉnh | Người phụ trách | Chức vụ | SĐT
// Cột cách nhau bằng Tab (dán từ Excel), dấu ; hoặc |. Chỉ tên trường là bắt buộc.
// Số điện thoại nhận ra ở bất kỳ cột nào (không phụ thuộc vị trí). Loại đơn vị đoán theo tên.
// ============================================================================
import { foldVn } from '../companyMatch';
import type { SourceKind } from './types';

export interface BulkRow {
  line: number;
  name: string;
  province: string;
  person: string;
  role: string;
  phone: string;
  kind: SourceKind | null;
}

const PHONE_RE = /^[+()\d][\d\s.()+-]{7,}$/;
const isPhone = (s: string) => PHONE_RE.test(s.trim()) && s.replace(/\D/g, '').length >= 9;

/** Đoán loại theo tên: "Đại học" → ĐH, "Cao đẳng" → CĐ… Không đoán được → null (dùng loại chung). */
export function guessKind(name: string): SourceKind | null {
  const k = foldVn(name);
  if (/\bdai hoc\b|\bhoc vien\b|\buniversity\b/.test(k)) return 'dai_hoc';
  if (/\bcao dang\b|\bcollege\b/.test(k)) return 'cao_dang';
  if (/\btrung cap\b/.test(k)) return 'trung_cap';
  if (/\btrung tam\b|\bgdnn\b|\bdvvl\b/.test(k)) return 'trung_tam';
  if (/\bubnd\b|\bxa\b|\bphuong\b|\bdoan thanh nien\b|\bhoi phu nu\b|\bthi tran\b/.test(k)) return 'dia_phuong';
  return null;
}

export function parseBulk(text: string): BulkRow[] {
  const out: BulkRow[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const sep = line.includes('\t') ? '\t' : line.includes(';') ? ';' : line.includes('|') ? '|' : null;
    const cells = (sep ? line.split(sep) : [line]).map(c => c.trim());
    const name = cells[0] ?? '';
    if (!name || /^(ten|tên)\s*(truong|trường)?$/i.test(name)) return; // bỏ dòng tiêu đề
    const rest = cells.slice(1);
    const phoneIdx = rest.findIndex(isPhone);
    const phone = phoneIdx >= 0 ? rest[phoneIdx] : '';
    const others = rest.filter((_, j) => j !== phoneIdx);
    out.push({
      line: i + 1,
      name,
      province: others[0] ?? '',
      person: others[1] ?? '',
      role: others[2] ?? '',
      phone,
      kind: guessKind(name),
    });
  });
  return out;
}

/** Khoá so trùng tên (bỏ dấu, hoa/thường, khoảng trắng thừa). */
export const nameKey = (s: string) => foldVn(s).replace(/\s+/g, ' ').trim();
