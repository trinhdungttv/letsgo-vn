// ============================================================================
// Bảng nháp đầu mối Sale / CTV — đọc dữ liệu NHẬP VÀO (file thuần, test ở saleLeads.test.ts):
//   • chuẩn hoá SĐT thành khoá chống trùng (0xxxxxxxxx) — Google Sheets hay bỏ số 0 đầu, có chấm / cách;
//   • đọc bảng dán từ Google Sheets / Excel: ưu tiên HTML (giữ được LINK của ô "Link"), lùi về chữ phân tab;
//   • nhận cột theo tiêu đề (STT, TÊN, SĐT, TÌNH TRẠNG, KHU VỰC, LINK KÊNH, LINK BÀI ĐĂNG, GHI CHÚ…),
//     không có tiêu đề thì đoán theo nội dung (cột toàn số điện thoại, cột link, cột có "KCN"…).
// ============================================================================
import type { SaleLeadStatus } from './types';

/** Bỏ dấu tiếng Việt, đ → d, chữ thường, gộp khoảng trắng — chỉ dùng để SO KHỚP. */
export function fold(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// ── SĐT ─────────────────────────────────────────────────────────────────────
/** Đầu số 11 số cũ (trước 15/09/2018) → đầu số mới 10 số: cùng 1 người nhập 2 kiểu vẫn bắt trùng. */
const OLD_PREFIX: Readonly<Record<string, string>> = {
  '0162': '032', '0163': '033', '0164': '034', '0165': '035', '0166': '036', '0167': '037', '0168': '038', '0169': '039',
  '0120': '070', '0121': '079', '0122': '077', '0126': '076', '0128': '078',
  '0123': '083', '0124': '084', '0125': '085', '0127': '081', '0129': '082',
  '0186': '056', '0188': '058', '0199': '059',
};

/**
 * 1 số → khoá so trùng dạng 0xxxxxxxxx (di động 10 số, bàn 11 số). Không phải số VN hợp lệ → ''.
 * "+84 912…", "84912…", "0084912…" → "0912…"; "912345678" (Sheets bỏ số 0 đầu) → "0912345678";
 * "0168 xxx xxxx" (đầu số cũ) → "038xxxxxxx".
 */
export function phoneKey(raw: string): string {
  let d = (raw ?? '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('0084')) d = d.slice(4);
  else if (d.startsWith('84') && (d.length === 11 || d.length === 12)) d = d.slice(2);
  if (!d.startsWith('0')) d = `0${d}`;
  if (d.length === 11 && OLD_PREFIX[d.slice(0, 4)]) d = OLD_PREFIX[d.slice(0, 4)] + d.slice(4);
  return /^0\d{9,10}$/.test(d) ? d : '';
}

/** Ô SĐT có thể ghi nhiều số: "0909 123 456 / 0912.345.678", "0909…, 0912…", "0909… hoặc 0912…". */
export function phoneKeysOf(raw: string | null | undefined): string[] {
  const out: string[] = [];
  for (const part of (raw ?? '').split(/[,;/\n|]+|\s+(?:hoặc|hoac|or|-)\s+/i)) {
    const p = part.trim();
    if (!p) continue;
    const whole = phoneKey(p);
    if (whole) { out.push(whole); continue; }
    // 2 số dính nhau trong 1 ô chỉ cách bằng dấu cách: "0909 123 456 0912 345 678"
    let buf = '';
    for (const tok of p.split(/\s+/)) {
      buf += tok.replace(/\D/g, '');
      const k = buf.length >= 10 ? phoneKey(buf) : '';
      if (k) { out.push(k); buf = ''; }
    }
  }
  return [...new Set(out)];
}

/** Hiển thị khoá SĐT dễ đọc: 0912 345 678 · 0274 3123 456. */
export function formatPhoneKey(k: string): string {
  if (/^0\d{9}$/.test(k)) return `${k.slice(0, 4)} ${k.slice(4, 7)} ${k.slice(7)}`;
  if (/^0\d{10}$/.test(k)) return `${k.slice(0, 4)} ${k.slice(4, 8)} ${k.slice(8)}`;
  return k;
}

/** Ô trông như ô SĐT (có số hợp lệ, gần như không có chữ). */
export function looksLikePhoneCell(text: string): boolean {
  return phoneKeysOf(text).length > 0 && (fold(text).match(/[a-z]/g)?.length ?? 0) <= 5;
}

// ── Lưới ô (bảng dán / file) ────────────────────────────────────────────────
export interface Cell {
  text: string;
  /** Link gắn trong ô (ô "Link" của Google Sheets) — '' nếu không có. */
  href: string;
}
export type Grid = Cell[][];

const URL_RE = /^(https?:\/\/|www\.)\S+$/i;
const cleanText = (s: string) => s.replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim();
const urlOf = (s: string) => (URL_RE.test(s.trim()) ? s.trim() : '');

/** Chữ phân tab (Google Sheets / Excel dán dạng chữ thường). Ô có xuống dòng được Sheets bọc trong "…". */
export function gridFromText(text: string): Grid {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const s = (text ?? '').replace(/\r\n?/g, '\n');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && cell === '') { quoted = true; continue; }
    if (ch === '\t') { row.push(cell); cell = ''; continue; }
    if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; continue; }
    cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows
    .map(r => r.map(t => { const c = cleanText(t); return { text: c, href: urlOf(c) }; }))
    .filter(r => r.some(c => c.text));
}

/**
 * Bảng HTML trong clipboard (Google Sheets, Excel, Docs…) — giữ được href của ô "Link".
 * Ô gộp dọc (rowspan, VD 1 ô "Khu vực" cho nhiều người) lặp lại giá trị cho các dòng dưới.
 * Chỉ chạy trên trình duyệt (cần DOMParser); không có bảng → null.
 */
export function gridFromHtml(html: string): Grid | null {
  if (typeof DOMParser === 'undefined' || !/<table/i.test(html ?? '')) return null;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const table = doc.querySelector('table');
  if (!table) return null;
  const grid: Grid = [];
  const carry = new Map<number, { cell: Cell; left: number }>();
  for (const tr of Array.from(table.querySelectorAll('tr'))) {
    const out: Cell[] = [];
    let col = 0;
    const fillCarry = () => {
      for (let c = carry.get(col); c; c = carry.get(col)) {
        out[col] = c.cell;
        if (--c.left <= 0) carry.delete(col);
        col++;
      }
    };
    for (const td of Array.from(tr.querySelectorAll('th,td'))) {
      fillCarry();
      td.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
      td.querySelectorAll('style, script, sup').forEach(n => n.remove());
      const text = cleanText(td.textContent ?? '');
      const a = Array.from(td.querySelectorAll('a[href]')).map(x => x.getAttribute('href') ?? '').find(h => /^https?:\/\//i.test(h));
      const cell: Cell = { text, href: a ?? urlOf(text) };
      const span = Math.max(1, Number(td.getAttribute('colspan')) || 1);
      const rows = Math.max(1, Number(td.getAttribute('rowspan')) || 1);
      for (let k = 0; k < span; k++) {
        const v = k === 0 ? cell : { text: '', href: '' };
        out[col] = v;
        if (rows > 1) carry.set(col, { cell: v, left: rows - 1 });
        col++;
      }
    }
    fillCarry();
    const row = Array.from({ length: out.length }, (_, i) => out[i] ?? { text: '', href: '' });
    if (row.some(c => c.text || c.href)) grid.push(row);
  }
  return grid.length ? grid : null;
}

// ── Cột → trường ────────────────────────────────────────────────────────────
export type LeadField = 'skip' | 'stt' | 'name' | 'phone' | 'company' | 'area' | 'channel' | 'post' | 'note' | 'status';
export const LEAD_FIELDS: readonly LeadField[] = ['skip', 'stt', 'name', 'phone', 'company', 'area', 'channel', 'post', 'note', 'status'];
export const LEAD_FIELD_LABEL: Readonly<Record<LeadField, string>> = {
  skip: '— Bỏ qua —',
  stt: 'STT',
  name: 'Tên',
  phone: 'SĐT',
  company: 'Đơn vị / nơi làm',
  area: 'Khu vực / KCN',
  channel: 'Link kênh',
  post: 'Link bài đăng',
  note: 'Ghi chú',
  status: 'Tình trạng liên hệ',
};

const HEADER_ALIASES: ReadonlyArray<[Exclude<LeadField, 'skip'>, readonly string[]]> = [
  ['stt', ['stt', 'tt', 'so tt', 'so thu tu', '#', 'no']],
  ['phone', ['sdt', 'so dien thoai', 'dien thoai', 'dt', 'so dt', 'phone', 'sdt zalo', 'zalo']],
  ['name', ['ten', 'ho ten', 'ho va ten', 'ten sale', 'ten ctv', 'ten dau moi', 'nguoi lien he', 'dau moi', 'name']],
  ['company', ['don vi', 'cong ty', 'noi lam', 'nha cung ung', 'ncu', 'don vi cung ung', 'cong ty dang lam', 'company']],
  ['area', ['khu vuc', 'kcn', 'khu cong nghiep', 'dia ban', 'vung', 'khu vuc hoat dong', 'area']],
  ['post', ['link bai dang', 'bai dang', 'link bai', 'link tuyen dung', 'link post', 'post']],
  ['channel', ['link kenh', 'kenh', 'link facebook', 'facebook', 'fb', 'trang ca nhan', 'link trang', 'link profile', 'profile']],
  ['note', ['ghi chu', 'note', 'chu thich', 'mo ta']],
  // "Tình trạng" ở mẫu của Tony thực ra ghi ĐƠN VỊ (Manpower, Green Speed…) — xem guessMapping
  ['status', ['trang thai', 'tinh trang', 'ket qua']],
];

/** Tiêu đề cột → trường ('skip' nếu không nhận ra). */
export function headerField(text: string): LeadField {
  const h = fold(text).replace(/[^a-z0-9# ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!h) return 'skip';
  for (const [f, list] of HEADER_ALIASES) if (list.includes(h)) return f;
  // Tiêu đề dài hơn: "LINK KÊNH FACEBOOK", "SĐT / ZALO" → chứa nguyên cụm
  for (const [f, list] of HEADER_ALIASES) {
    if (list.some(a => a.length >= 3 && ` ${h} `.includes(` ${a} `))) return f;
  }
  return 'skip';
}

/** Dòng tiêu đề trong 10 dòng đầu (≥ 2 ô nhận ra được, có Tên hoặc SĐT) — không có → -1. */
export function findHeaderRow(grid: Grid): number {
  for (let i = 0; i < Math.min(grid.length, 10); i++) {
    const fields = grid[i].map(c => headerField(c.text)).filter(f => f !== 'skip');
    if (fields.length >= 2 && (fields.includes('name') || fields.includes('phone'))) return i;
  }
  return -1;
}

const STATUS_WORDS: ReadonlyArray<[Exclude<SaleLeadStatus, 'promoted'>, RegExp]> = [
  ['meeting', /\b(hen gap|hen cafe|hen ca phe|lich gap|da gap|se gap)\b/],
  ['declined', /\b(tu choi|khong (hop tac|quan tam|muon|lam|co nhu cau)|ko (hop tac|quan tam|muon)|k quan tam|khong phu hop)\b/],
  ['no_answer', /\b((khong|ko|k|chua) (nghe|bat|tra loi|rep|phan hoi|lien lac duoc)|thue bao|sai so|tat may|may ban)\b/],
  ['talking', /\b(dang trao doi|da (goi|nhan|lien he|noi chuyen|trao doi|ket ban)|quan tam|dang tu van|cho phan hoi)\b/],
  ['new', /\b(chua (goi|lien he|nhan)|moi)\b/],
];

/** Chữ ở cột tình trạng → trạng thái ("Không nghe máy" → Chưa bắt máy…); không hiểu → null. */
export function parseStatusText(text: string): SaleLeadStatus | null {
  const t = fold(text);
  if (!t) return null;
  for (const [s, re] of STATUS_WORDS) if (re.test(t)) return s;
  return null;
}

const KCN_RE = /\b(kcn|ccn|kcx|khu cong nghiep|cum cong nghiep|vsip)\b/;
const isLinkCell = (c: Cell) => !!c.href || /https?:\/\/|www\.|facebook\.com|zalo\.me|tiktok\.com/i.test(c.text);

/**
 * Cột nào là trường nào. Có dòng tiêu đề → theo tên cột (cột "Tình trạng" ghi tên công ty như mẫu
 * Đầu mối tuyển dụng thì hiểu là Đơn vị). Không có tiêu đề → đoán theo nội dung: cột SĐT, cột STT
 * (số nhỏ), cột link (trái → phải: kênh rồi bài đăng), cột có "KCN", tên = cột chữ ngay trước SĐT,
 * đơn vị = cột ngay sau SĐT, ghi chú = cột chữ cuối cùng.
 */
export function guessMapping(grid: Grid, headerIdx: number): LeadField[] {
  const width = Math.max(0, ...grid.map(r => r.length));
  const body = grid.slice(headerIdx + 1, headerIdx + 1 + 300);
  const colCells = (c: number) => body.map(r => r[c] ?? { text: '', href: '' }).filter(x => x.text || x.href);
  const ratio = (c: number, test: (x: Cell) => boolean) => {
    const cells = colCells(c);
    return cells.length ? cells.filter(test).length / cells.length : 0;
  };
  const map: LeadField[] = Array.from({ length: width }, () => 'skip');

  if (headerIdx >= 0) {
    const head = grid[headerIdx];
    for (let c = 0; c < width; c++) {
      let f = headerField(head[c]?.text ?? '');
      if (f === 'status') {
        // Cột tình trạng mà đa số ô không phải chữ trạng thái → là tên đơn vị (mẫu Đầu mối tuyển dụng)
        const statusLike = ratio(c, x => parseStatusText(x.text) !== null);
        if (statusLike < 0.5 && !map.includes('company')) f = 'company';
      }
      // Mỗi trường 1 cột (trừ ghi chú) — cột thứ 2 cùng loại thì bỏ qua
      if (f !== 'skip' && f !== 'note' && map.includes(f)) f = 'skip';
      map[c] = f;
    }
    if (map.includes('phone')) return map;
  }

  const free = (c: number) => map[c] === 'skip';
  const filled = (c: number) => colCells(c).length > 0;
  // SĐT: cột có tỉ lệ ô số điện thoại cao nhất
  let phone = -1;
  let best = 0.5;
  for (let c = 0; c < width; c++) {
    const r = free(c) ? ratio(c, x => looksLikePhoneCell(x.text)) : 0;
    if (r >= best) { best = r; phone = c; }
  }
  if (phone >= 0) map[phone] = 'phone';
  if (headerIdx >= 0) return map;   // có tiêu đề: chỉ bù cột SĐT, còn lại giữ theo tiêu đề

  for (let c = 0; c < width; c++) {
    if (free(c) && filled(c) && ratio(c, x => /^\d{1,4}\.?$/.test(x.text)) >= 0.8) { map[c] = 'stt'; break; }
  }
  const links = Array.from({ length: width }, (_, c) => c).filter(c => free(c) && filled(c) && ratio(c, isLinkCell) >= 0.5);
  if (links[0] !== undefined) map[links[0]] = 'channel';
  if (links[1] !== undefined) map[links[1]] = 'post';
  let area = -1;
  let areaBest = 0.3;
  for (let c = 0; c < width; c++) {
    const r = free(c) && filled(c) ? ratio(c, x => KCN_RE.test(fold(x.text))) : 0;
    if (r >= areaBest) { areaBest = r; area = c; }
  }
  if (area >= 0) map[area] = 'area';
  const textCols = Array.from({ length: width }, (_, c) => c).filter(c => free(c) && filled(c));
  const name = phone >= 0 ? [...textCols].reverse().find(c => c < phone) ?? textCols[0] : textCols[0];
  if (name !== undefined) map[name] = 'name';
  if (phone >= 0) {
    const company = textCols.find(c => c > phone && free(c));
    const lastText = [...textCols].reverse().find(c => free(c));
    // Đơn vị = cột ngay sau SĐT, trừ khi đó cũng là cột chữ cuối (khi ấy là ghi chú)
    if (company !== undefined && company !== lastText) map[company] = 'company';
  }
  const note = [...textCols].reverse().find(c => free(c));
  if (note !== undefined) map[note] = 'note';
  return map;
}

/** 1 dòng đọc được từ bảng — chưa lưu. */
export interface LeadDraft {
  /** Số dòng hiển thị (STT nếu có, không thì thứ tự dòng trong bảng dán). */
  line: string;
  fullName: string;
  phone: string;
  phoneKeys: string[];
  company: string;
  areaText: string;
  channelUrl: string;
  postUrl: string;
  note: string;
  /** Từ cột tình trạng (nếu có và đọc được). */
  status: SaleLeadStatus | null;
}

/** Kết quả đọc bảng: các dòng + số ô "Link" mất đường dẫn (dán dạng chữ thường). */
export interface DraftParse {
  drafts: LeadDraft[];
  lostLinks: number;
}

/** Dựng các dòng đầu mối từ lưới theo cách gán cột. Bỏ dòng trống, dòng tiêu đề lặp, dòng tựa bảng. */
export function draftsFromGrid(grid: Grid, headerIdx: number, mapping: readonly LeadField[]): DraftParse {
  const drafts: LeadDraft[] = [];
  let lostLinks = 0;
  grid.forEach((row, i) => {
    if (i <= headerIdx) return;
    const pick = (f: LeadField): Cell[] => mapping.flatMap((m, c) => (m === f && row[c] ? [row[c]] : []));
    const text = (f: LeadField) => pick(f).map(c => c.text).filter(Boolean).join('\n');
    const link = (f: LeadField) => {
      const c = pick(f)[0];
      if (!c) return '';
      if (c.href) return c.href;
      if (c.text) lostLinks++;
      return '';
    };
    const fullName = text('name').replace(/\s+/g, ' ').trim();
    const phone = text('phone').replace(/\n+/g, ', ').trim();
    const nonEmpty = row.filter(c => c.text || c.href).length;
    if (!fullName && !phone) return;
    // Dòng tựa bảng ("DANH SÁCH ĐẦU MỐI…" — 1 ô, không SĐT) hoặc dòng tiêu đề lặp lại ở trang sau
    if (!phone && nonEmpty <= 1) return;
    if (headerIdx >= 0 && row.map(c => fold(c.text)).join('|') === grid[headerIdx].map(c => fold(c.text)).join('|')) return;
    const statusRaw = text('status');
    const status = parseStatusText(statusRaw);
    let note = text('note');
    // Tình trạng không đọc được thành trạng thái → giữ chữ gốc ở ghi chú, không mất thông tin
    if (statusRaw && !status) note = [note, `Tình trạng: ${statusRaw}`].filter(Boolean).join('\n');
    const stt = text('stt');
    drafts.push({
      line: /^\d{1,5}\.?$/.test(stt) ? stt.replace('.', '') : String(i + 1),
      fullName,
      phone,
      phoneKeys: phoneKeysOf(phone),
      company: text('company').replace(/\s+/g, ' ').trim(),
      areaText: text('area').replace(/\s*\n\s*/g, ', ').replace(/,\s*,/g, ',').trim(),
      channelUrl: link('channel'),
      postUrl: link('post'),
      note,
      status,
    });
  });
  return { drafts, lostLinks };
}
