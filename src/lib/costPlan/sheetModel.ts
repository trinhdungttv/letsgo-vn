// Đọc 1 sheet Excel (đã điền số, đã chèn chữ ký/con dấu) thành MÔ HÌNH phẳng để vẽ xem trước và xuất PDF.
// Mỗi ô là 1 khung có toạ độ px tuyệt đối (không dùng <table>/rowSpan vì html2canvas cắt mất nội dung ô gộp).
// Đây là bản "xấp xỉ gần đúng" của Excel (cùng độ rộng cột, chiều cao dòng, ô gộp, màu, viền, ảnh) — không phải bộ dựng của Excel.
import { colPx, rowPx } from './excelFill';

export type Edge = { w: number; style: 'solid' | 'dashed' | 'dotted' | 'double'; color: string } | null;
/** Đoạn chữ có định dạng riêng trong 1 ô (rich text của Excel) */
export interface SheetRun { text: string; bold: boolean; italic: boolean; color: string }
export interface SheetCell {
  x: number; y: number; w: number; h: number;
  text: string;
  /** Có khi ô dùng chữ nhiều kiểu (vd: nhãn đậm + nội dung thường) */
  runs: SheetRun[] | null;
  /** Thụt lề (mức Excel) — mỗi mức ≈ 9px */
  indent: number;
  /** Địa chỉ ô (vd B12) */
  addr: string;
  /** Nội dung gốc từng đoạn chữ (giữ xuống dòng) — dùng khi sửa chữ trực tiếp */
  raw: string[];
  /** Sửa được (không phải ô công thức) */
  editable: boolean;
  bold: boolean; italic: boolean; underline: boolean; size: number; color: string; font: string;
  bg: string | null;
  h_align: 'left' | 'center' | 'right'; v_align: 'top' | 'center' | 'bottom'; wrap: boolean;
  t: Edge; b: Edge; l: Edge; r: Edge;
  rowSpan: number;
}
export interface SheetImage { src: string; x: number; y: number; w: number; h: number }
export interface SheetModel {
  name: string; width: number; height: number;
  cells: SheetCell[]; images: SheetImage[];
  /** Mỗi dòng 1 dải [top,bottom] px — để chia trang không cắt giữa dòng */
  bands: { top: number; bottom: number }[];
  landscape: boolean;
  /** File đặt "vừa 1 trang" (fit to 1 page wide × 1 tall) → xem trước / PDF thu nhỏ cho vừa 1 trang */
  fitOnePage: boolean;
}

const PALETTE = ['FFFFFF', '000000', 'E7E6E6', '44546A', '4472C4', 'ED7D31', 'A5A5A5', 'FFC000', '5B9BD5', '70AD47'];
function tint(hex: string, t: number): string {
  const ch = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16));
  const o = ch.map(v => Math.round(t >= 0 ? v + (255 - v) * t : v * (1 + t)));
  return '#' + o.map(v => Math.min(255, Math.max(0, v)).toString(16).padStart(2, '0')).join('');
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function colorOf(c: any): string | null {
  if (!c) return null;
  if (typeof c.argb === 'string' && c.argb.length >= 6) return ('#' + c.argb.slice(-6)).toLowerCase();
  if (typeof c.theme === 'number') return tint(PALETTE[c.theme] ?? '000000', c.tint ?? 0);
  return null;
}

/** Định dạng số theo mã định dạng Excel đơn giản (#,##0 / 0.00 / 0% / dd/mm/yyyy), dấu chấm ngăn nghìn kiểu Việt Nam. */
export function formatValue(v: unknown, numFmt?: string): string {
  if (v == null) return '';
  if (v instanceof Date) {
    const p = (n: number) => String(n).padStart(2, '0');
    const f = (numFmt ?? '').toLowerCase();
    const y = v.getUTCFullYear(), m = p(v.getUTCMonth() + 1), d = p(v.getUTCDate());
    return /^d{1,2}[/-]m{1,2}/.test(f) || f === '' || f === 'general' ? `${d}/${m}/${y}` : `${d}/${m}/${y}`;
  }
  if (typeof v === 'number') {
    const f = (numFmt ?? 'General').split(';')[0];
    if (!f || /general/i.test(f)) return String(Math.round(v * 1e9) / 1e9).replace('.', ',');
    const pct = f.includes('%');
    const x = pct ? v * 100 : v;
    const dec = /\.([0#]+)/.exec(f)?.[1].length ?? 0;
    const [i, d = ''] = Math.abs(x).toFixed(dec).split('.');
    const grouped = f.includes(',') ? i.replace(/\B(?=(\d{3})+(?!\d))/g, '.') : i;
    return `${x < 0 ? '-' : ''}${grouped}${d ? ',' + d : ''}${pct ? '%' : ''}`;
  }
  return String(v);
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function plain(v: any, numFmt?: string): string {
  if (v == null) return '';
  if (typeof v === 'object' && !(v instanceof Date)) {
    if (Array.isArray(v.richText)) return v.richText.map((x: any) => x.text ?? '').join('');
    if ('result' in v && v.result != null) return plain(v.result, numFmt);
    if ('formula' in v || 'sharedFormula' in v) return '';
    if ('text' in v && v.text != null) return plain(v.text, numFmt);
    if ('error' in v) return String(v.error);
    return '';
  }
  return formatValue(v, numFmt);
}

const edgeOf = (b: any): Edge => {
  if (!b || !b.style) return null;
  const color = colorOf(b.color) ?? '#000000';
  switch (b.style) {
    case 'medium': case 'mediumDashed': case 'mediumDashDot': return { w: 2, style: b.style === 'medium' ? 'solid' : 'dashed', color };
    case 'thick': return { w: 3, style: 'solid', color };
    case 'double': return { w: 3, style: 'double', color };
    case 'dotted': case 'hair': return { w: 1, style: 'dotted', color };
    case 'dashed': case 'dashDot': case 'dashDotDot': return { w: 1, style: 'dashed', color };
    default: return { w: 1, style: 'solid', color };
  }
};

const FALLBACK_FONT = `'PingFang SC','Microsoft YaHei','Noto Sans CJK SC','Hiragino Sans GB',-apple-system,'Segoe UI',Arial,sans-serif`;

/** Chiều cao dòng thực: dòng có đặt cao thì theo đó; không đặt mà có ô tự xuống dòng thì ước lượng như Excel tự giãn khi mở file. */
function effectiveRowHeights(ws: any, lastRow: number, lastCol: number, merges: Map<string, any>): number[] {
  const hs: number[] = [0];
  for (let r = 1; r <= lastRow; r++) {
    const row = ws.getRow(r);
    let h = rowPx(ws, r);
    if (!row.hidden && row.height == null) {
      for (let c = 1; c <= lastCol; c++) {
        const cell = ws.getCell(r, c);
        if (cell.isMerged && cell.master !== cell) continue;
        const m = merges.get(`${r}:${c}`);
        if (m && (m.r2 > r)) continue;                                   // ô gộp nhiều dòng không ép 1 dòng giãn
        const text = plain(cell.value, cell.numFmt);
        if (!text || !cell.alignment?.wrapText) continue;
        const size = ((cell.font?.size ?? 11) * 96) / 72;
        let w = 0; for (let k = c; k <= (m?.c2 ?? c); k++) w += colPx(ws, k);
        const per = Math.max(1, Math.floor((w - 6) / (size * 0.56)));
        const lines = text.split('\n').reduce((a: number, p: string) => a + Math.max(1, Math.ceil([...p].reduce((s, ch) => s + (/[\u3000-\u9fff]/.test(ch) ? 1.8 : 1), 0) / per)), 0);
        h = Math.max(h, lines * size * 1.3 + 4);
      }
    }
    hs.push(h);
  }
  return hs;
}

const b64 = (u8: Uint8Array) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };

function printArea(ws: any): { r1: number; c1: number; r2: number; c2: number } | null {
  const raw: string | undefined = ws.pageSetup?.printArea;
  if (!raw) return null;
  const m = /\$?([A-Z]+)\$?(\d+):\$?([A-Z]+)\$?(\d+)/.exec(raw.split(',')[0].replace(/^.*!/, ''));
  if (!m) return null;
  const n = (L: string) => L.split('').reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0);
  return { c1: n(m[1]), r1: Number(m[2]), c2: n(m[3]), r2: Number(m[4]) };
}

export async function buildSheetModel(buf: ArrayBuffer, sheetName?: string): Promise<SheetModel> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws: any = (sheetName ? wb.getWorksheet(sheetName) : wb.worksheets.find(w => w.state === 'visible')) ?? wb.worksheets[0];
  if (!ws) throw new Error('File không có sheet nào để xem.');

  const merges = new Map<string, { r1: number; c1: number; r2: number; c2: number }>();
  const n = (L: string) => L.split('').reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0);
  for (const m of ((ws.model as any).merges ?? []) as string[]) {
    const [a, b] = m.split(':'); const pa = /^([A-Z]+)(\d+)$/.exec(a), pb = /^([A-Z]+)(\d+)$/.exec(b ?? a);
    if (pa && pb) merges.set(`${pa[2]}:${n(pa[1])}`, { c1: n(pa[1]), r1: Number(pa[2]), c2: n(pb[1]), r2: Number(pb[2]) });
  }

  // Phạm vi dùng: vùng in nếu có; không thì tới dòng/cột cuối có nội dung, nền, viền, ô gộp hoặc ảnh
  let lastRow = 1, lastCol = 1;
  const pa = printArea(ws);
  const seen = (r: number, c: number) => { if (r > lastRow) lastRow = r; if (c > lastCol) lastCol = c; };
  if (pa) { lastRow = pa.r2; lastCol = pa.c2; }
  else {
    ws.eachRow({ includeEmpty: false }, (row: any, r: number) => row.eachCell({ includeEmpty: false }, (cell: any, c: number) => {
      const has = plain(cell.value, cell.numFmt) !== '' || cell.fill?.fgColor || cell.border?.top || cell.border?.bottom || cell.border?.left || cell.border?.right;
      if (has) seen(r, c);
    }));
    for (const m of merges.values()) seen(m.r2, m.c2);
  }
  const images0 = (ws.getImages() as any[]);
  if (!pa) for (const im of images0) { const t = im.range?.br ?? im.range?.tl; if (t) seen(Math.floor(t.row ?? 0) + 1, Math.floor(t.col ?? 0) + 1); }
  lastRow = Math.min(lastRow, 400); lastCol = Math.min(lastCol, 40);
  const r0 = pa?.r1 ?? 1, c0 = pa?.c1 ?? 1;

  const rh = effectiveRowHeights(ws, lastRow, lastCol, merges);
  const rowTop: number[] = new Array(lastRow + 2).fill(0);
  for (let r = r0; r <= lastRow; r++) rowTop[r + 1] = rowTop[r] + rh[r];
  const colLeft: number[] = new Array(lastCol + 2).fill(0);
  for (let c = c0; c <= lastCol; c++) colLeft[c + 1] = colLeft[c] + colPx(ws, c);
  const X = (c: number) => colLeft[Math.min(c, lastCol + 1)];
  const Y = (r: number) => rowTop[Math.min(r, lastRow + 1)];

  const cells: SheetCell[] = [];
  for (let r = r0; r <= lastRow; r++) {
    if (!rh[r]) continue;
    for (let c = c0; c <= lastCol; c++) {
      const cell = ws.getCell(r, c);
      if (cell.isMerged && cell.master !== cell) continue;
      const m = merges.get(`${r}:${c}`) ?? { r1: r, c1: c, r2: r, c2: c };
      const r2 = Math.min(m.r2, lastRow), c2 = Math.min(m.c2, lastCol);
      const tl = cell, br = ws.getCell(r2, c2);
      const text = plain(cell.value, cell.numFmt);
      const fillColor = cell.fill?.type === 'pattern' && cell.fill.pattern === 'solid' ? colorOf(cell.fill.fgColor) : null;
      const bg = fillColor && fillColor.toLowerCase() !== '#ffffff' ? fillColor : null;
      const t = edgeOf(tl.border?.top), b = edgeOf(br.border?.bottom ?? tl.border?.bottom), l = edgeOf(tl.border?.left), rr = edgeOf(br.border?.right ?? tl.border?.right);
      if (!text && !bg && !t && !b && !l && !rr) continue;
      const rt: any[] | null = cell.value && typeof cell.value === 'object' && Array.isArray((cell.value as any).richText) ? (cell.value as any).richText : null;
      const f = { ...(rt?.[0]?.font ?? {}), ...(cell.font ?? {}) };
      const al = cell.alignment ?? {};
      const hAl = al.horizontal === 'center' || al.horizontal === 'centerContinuous' ? 'center' : al.horizontal === 'right' ? 'right' : al.horizontal === 'left' ? 'left' : typeof cell.value === 'number' ? 'right' : 'left';
      const vAl = al.vertical === 'top' ? 'top' : al.vertical === 'middle' || al.vertical === 'center' ? 'center' : 'bottom';
      const wrap = !!al.wrapText;
      cells.push({
        x: X(c), y: Y(r), w: X(c2 + 1) - X(c), h: Y(r2 + 1) - Y(r), text: wrap ? text : text.replace(/\s*\n\s*/g, ' '),
        runs: rt && rt.length > 1 ? rt.map(x => ({ text: wrap ? String(x.text ?? '') : String(x.text ?? '').replace(/\s*\n\s*/g, ' '), bold: !!(x.font?.bold ?? f.bold), italic: !!(x.font?.italic ?? f.italic), color: colorOf(x.font?.color) ?? colorOf(f.color) ?? '#000000' })) : null,
        indent: Number(al.indent ?? 0) || 0,
        addr: cell.address, raw: rt && rt.length ? rt.map(x => String(x.text ?? '')) : [text],
        editable: !(cell.value && typeof cell.value === 'object' && ('formula' in (cell.value as object) || 'sharedFormula' in (cell.value as object))),
        bold: !!f.bold, italic: !!f.italic, underline: !!f.underline, size: ((f.size ?? 11) * 96) / 72, color: colorOf(f.color) ?? '#000000',
        font: `${f.name ? `'${f.name}',` : ''}${FALLBACK_FONT}`,
        bg, h_align: hAl, v_align: vAl, wrap, t, b, l, r: rr, rowSpan: r2 - r + 1,
      });
    }
  }

  // Ảnh: neo theo ô + độ lệch; kích thước theo ext (1 ô neo) hoặc ô góc dưới-phải (2 ô neo)
  const at = (p: any) => {
    const col = (p.nativeCol ?? Math.floor(p.col ?? 0)), row = (p.nativeRow ?? Math.floor(p.row ?? 0));
    const dx = p.nativeColOff != null ? p.nativeColOff / 9525 : ((p.col ?? 0) - Math.floor(p.col ?? 0)) * colPx(ws, col + 1);
    const dy = p.nativeRowOff != null ? p.nativeRowOff / 9525 : ((p.row ?? 0) - Math.floor(p.row ?? 0)) * (rh[row + 1] ?? 20);
    return { x: X(col + 1) + dx, y: Y(row + 1) + dy };
  };
  const images: SheetImage[] = [];
  for (const im of images0) {
    const media = wb.getImage(Number(im.imageId));
    const range = im.range; if (!media?.buffer || !range?.tl) continue;
    const p = at(range.tl);
    let w: number, h: number;
    if (range.br && !range.ext) { const q = at(range.br); w = q.x - p.x; h = q.y - p.y; }
    else if (range.ext) { w = range.ext.width; h = range.ext.height; }
    else continue;
    const ext = String(media.extension) === 'jpg' ? 'jpeg' : media.extension;
    images.push({ src: `data:image/${ext};base64,${b64(new Uint8Array(media.buffer as ArrayBuffer))}`, x: p.x, y: p.y, w, h });
  }

  const width = Math.max(X(lastCol + 1), ...images.map(i => i.x + i.w));
  const height = Math.max(Y(lastRow + 1), ...images.map(i => i.y + i.h));
  const bands: SheetModel['bands'] = [];
  for (let r = r0; r <= lastRow; r++) if (rh[r]) bands.push({ top: Y(r), bottom: Y(r + 1) });
  return { name: ws.name, width, height, cells, images, bands, landscape: ws.pageSetup?.orientation === 'landscape', fitOnePage: !!ws.pageSetup?.fitToPage && Number(ws.pageSetup?.fitToWidth ?? 1) === 1 && Number(ws.pageSetup?.fitToHeight ?? 1) === 1 };
}
