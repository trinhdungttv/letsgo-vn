// Xuất Excel của module Tuyển dụng (danh sách nhận việc gửi nhân sự khách, bảng đối soát phí, báo cáo tuần).
// ExcelJS nạp động — chỉ tải khi bấm xuất.
import { downloadBlob } from '../costPlan/pdf';

export type Cell = string | number | null | undefined;
export interface SheetSpec {
  name: string;
  /** dòng tiêu đề lớn phía trên bảng (tuỳ chọn), mỗi phần tử 1 dòng */
  title?: string[];
  headers: string[];
  rows: Cell[][];
  /** dòng tổng cuối bảng (tuỳ chọn) */
  total?: Cell[];
  widths?: number[];
  /** cột định dạng số có dấu chấm nghìn (chỉ số cột, 0-based) */
  moneyCols?: number[];
}

/** Tên file an toàn (bỏ dấu, bỏ ký tự lạ). */
export function safeFileName(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .replace(/[^\w\- .]+/g, '_').replace(/\s+/g, ' ').trim();
}

/** Dựng file Excel (ArrayBuffer) — tách khỏi việc tải xuống để test được. */
export async function buildXlsx(sheets: SheetSpec[]): Promise<ArrayBuffer> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Let's Go VN";
  for (const sp of sheets) {
    const ws = wb.addWorksheet(sp.name.slice(0, 31));
    let r = 1;
    for (const t of sp.title ?? []) {
      ws.getCell(r, 1).value = t;
      ws.getCell(r, 1).font = { bold: r === 1, size: r === 1 ? 14 : 11 };
      r++;
    }
    if (sp.title?.length) r++;
    const head = ws.getRow(r);
    sp.headers.forEach((h, i) => {
      const c = head.getCell(i + 1);
      c.value = h;
      c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0071E3' } };
      c.alignment = { vertical: 'middle', wrapText: true };
    });
    head.height = 22;
    const firstData = r + 1;
    sp.rows.forEach((row, i) => {
      const xr = ws.getRow(firstData + i);
      row.forEach((v, j) => { xr.getCell(j + 1).value = v ?? ''; });
    });
    if (sp.total) {
      const tr = ws.getRow(firstData + sp.rows.length);
      sp.total.forEach((v, j) => { const c = tr.getCell(j + 1); c.value = v ?? ''; c.font = { bold: true }; });
    }
    for (const col of sp.moneyCols ?? []) ws.getColumn(col + 1).numFmt = '#,##0';
    sp.headers.forEach((h, i) => { ws.getColumn(i + 1).width = sp.widths?.[i] ?? Math.max(10, Math.min(36, h.length + 4)); });
    ws.views = [{ state: 'frozen', ySplit: firstData - 1 }];
  }
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

export async function downloadXlsx(fileName: string, sheets: SheetSpec[]): Promise<void> {
  const buf = await buildXlsx(sheets);
  downloadBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${safeFileName(fileName)}.xlsx`);
}
