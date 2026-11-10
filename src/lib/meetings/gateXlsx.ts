// Xuất "Danh sách đăng ký ra vào cổng" ra file .xlsx — dựng lại đúng mẫu của công ty
// (Danh_sach_dang_ky_ra_vao_cong_logo.xlsx): khổ A4 ngang, khung viền đậm, logo góc trái, font Times New Roman,
// độ rộng cột / chiều cao dòng / cỡ chữ y như mẫu. Logo, chữ ký, con dấu lấy từ PHÁP NHÂN (dùng chung Phương án giá).
import { containIn, pngSize, stampBoxes, type StampLayout } from '../costPlan/entity';
import { anchorAt, colPx, rowPx } from '../costPlan/excelFill';
import { SIGN_HINT, SIGN_ROW_PT, SIGN_ROWS, STAMP_BOX, signStartCol, type GateDoc } from './gateList';

export { signStartCol };

type Cell = import('exceljs').Cell;
type Border = Partial<import('exceljs').Borders>;

export interface GateImages {
  /** data URL PNG/JPEG (đã chuyển đổi), null = không chèn */
  logo: string | null;
  signature: string | null;
  seal: string | null;
  layout: StampLayout;
}

const FONT = 'Times New Roman';

/** Viền 1 ô — luôn tạo style mới (ExcelJS cho ô gộp dùng chung 1 object style, sửa trực tiếp sẽ lan sang ô khác). */
function setBorder(cell: Cell, patch: Border) {
  cell.style = { ...cell.style, border: { ...(cell.style.border ?? {}), ...patch } };
}

export async function buildGateXlsx(doc: GateDoc, img: GateImages): Promise<ArrayBuffer> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Let's Go VN CRM";
  const ws = wb.addWorksheet('Danh sách', {
    views: [{ showGridLines: false }],
    pageSetup: {
      paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, horizontalCentered: true,
      margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.6, header: 0.5, footer: 0.5 },
    },
  });
  const N = doc.columns.length;
  doc.columns.forEach((c, i) => { ws.getColumn(i + 1).width = c.width; });

  const thick = { style: 'thick' as const };
  const thin = { style: 'thin' as const };
  let r = 0;
  const next = (heightPt?: number) => { r++; if (heightPt) ws.getRow(r).height = heightPt; return r; };
  /** Viền khung ngoài cho cả dòng (trái cột 1, phải cột cuối) + viền trên/dưới tuỳ chọn. */
  const frame = (row: number, o: { top?: 'thick'; bottom?: 'thick' | 'medium' } = {}) => {
    for (let c = 1; c <= N; c++) {
      const p: Border = {};
      if (c === 1) p.left = thick;
      if (c === N) p.right = thick;
      if (o.top) p.top = { style: o.top };
      if (o.bottom) p.bottom = { style: o.bottom };
      setBorder(ws.getCell(row, c), p);
    }
  };
  const put = (row: number, c1: number, c2: number, value: string, font: Partial<import('exceljs').Font>, align: Partial<import('exceljs').Alignment>) => {
    if (c2 > c1) ws.mergeCells(row, c1, row, c2);
    const cell = ws.getCell(row, c1);
    cell.value = value;
    cell.font = { name: FONT, ...font };
    cell.alignment = { vertical: 'middle', ...align };
  };

  // ── Đầu trang: tên pháp nhân · địa chỉ · điện thoại (cột C → hết), logo ở A1:B3 ──
  const head = Math.min(3, N);
  next(30); put(r, head, N, doc.companyName, { bold: true, size: 16 }, { horizontal: 'left', indent: 1 }); frame(r, { top: 'thick' });
  next(24); put(r, head, N, doc.address, { size: 12 }, { horizontal: 'left', indent: 1 }); frame(r);
  next(24); put(r, head, N, doc.phone, { bold: true, size: 12 }, { horizontal: 'left', indent: 1 }); frame(r);
  next(24); frame(r, { bottom: 'medium' });
  next(9.75); frame(r);
  next(45.75); put(r, 1, N, doc.title, { bold: true, size: 24 }, { horizontal: 'center' }); frame(r);
  if (doc.recipient) { next(22); put(r, 1, N, doc.recipient, { bold: true, size: 13 }, { horizontal: 'center' }); frame(r); }
  if (doc.visit) { next(22); put(r, 1, N, doc.visit, { italic: true, size: 12 }, { horizontal: 'center', wrapText: true }); frame(r); }
  next(7.5); frame(r);

  // ── Bảng ──
  next(33.75);
  doc.columns.forEach((col, i) => {
    const cell = ws.getCell(r, i + 1);
    cell.value = col.label;
    cell.font = { name: FONT, bold: true, size: 13 };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    setBorder(cell, { top: thin, bottom: thin, left: i === 0 ? thick : thin, right: i === N - 1 ? thick : thin });
  });
  for (const row of doc.rows) {
    next(42);
    doc.columns.forEach((col, i) => {
      const cell = ws.getCell(r, i + 1);
      cell.value = row[col.key];
      cell.numFmt = '@';                                   // CCCD giữ số 0 đầu, không thành số
      cell.font = { name: FONT, size: col.key === 'name' ? 13 : 12, bold: !!col.bold };
      cell.alignment = col.align === 'left'
        ? { horizontal: 'left', vertical: 'middle', wrapText: true, indent: 1 }
        : { horizontal: 'center', vertical: 'middle', wrapText: true };
      setBorder(cell, { top: thin, bottom: thin, left: i === 0 ? thick : thin, right: i === N - 1 ? thick : thin });
    });
  }

  // ── Ngày ký + khối ký (cột "Nơi cấp" → hết) ──
  const s = signStartCol(doc);
  next(13.5); frame(r);
  next(16); put(r, s, N, doc.dateLine, { italic: true, size: 12 }, { horizontal: 'center' }); frame(r);
  next(8); frame(r);
  next(21.75); put(r, s, N, doc.signCompany, { bold: true, size: 13 }, { horizontal: 'center' }); frame(r);
  next(15); put(r, s, N, SIGN_HINT, { italic: true, size: 11 }, { horizontal: 'center' }); frame(r);
  const signTop = r + 1;
  for (let k = 0; k < SIGN_ROWS; k++) { next(SIGN_ROW_PT); frame(r); }
  if (doc.signerName) { next(21.75); put(r, s, N, doc.signerName, { bold: true, size: 13 }, { horizontal: 'center' }); frame(r); }
  next(21.75); frame(r, { bottom: 'thick' });

  // ── Ảnh ──
  const pic = (dataUrl: string | null, at: { c: number; r: number; x: number; y: number; w: number; h: number }) => {
    const m = dataUrl && /^data:image\/(png|jpe?g);base64,/.exec(dataUrl);
    if (!dataUrl || !m) return;
    const id = wb.addImage({ base64: dataUrl, extension: m[1] === 'png' ? 'png' : 'jpeg' });
    ws.addImage(id, {
      tl: anchorAt(ws, at.c, at.r, at.x, at.y) as never,
      ext: { width: Math.max(1, Math.round(at.w)), height: Math.max(1, Math.round(at.h)) },
      editAs: 'oneCell',
    });
  };
  if (img.logo) {
    // Mẫu: logo 143×100px cách mép trái 12px, mép trên 6px
    const box = containIn({ x: 12, y: 6, w: 143, h: 100 }, pngSize(img.logo));
    pic(img.logo, { c: 1, r: 1, ...box });
  }
  if (img.signature || img.seal) {
    let blockW = 0;
    for (let c = s; c <= N; c++) blockW += colPx(ws, c);
    let blockH = 0;
    for (let k = 0; k < SIGN_ROWS; k++) blockH += rowPx(ws, signTop + k);
    const x0 = (blockW - STAMP_BOX.w) / 2;
    const y0 = (blockH - STAMP_BOX.h) / 2;
    const { sig, seal } = stampBoxes(img.layout, STAMP_BOX);
    const sigR = containIn(sig, img.signature ? pngSize(img.signature) : null);
    const sealR = containIn(seal, img.seal ? pngSize(img.seal) : null);
    const order = img.layout.sealOnTop === false ? ['seal', 'sig'] : ['sig', 'seal'];
    for (const k of order) {
      if (k === 'sig') pic(img.signature, { c: s, r: signTop, x: x0 + sigR.x, y: y0 + sigR.y, w: sigR.w, h: sigR.h });
      else pic(img.seal, { c: s, r: signTop, x: x0 + sealR.x, y: y0 + sealR.y, w: sealR.w, h: sealR.h });
    }
  }

  ws.pageSetup.printArea = `A1:${ws.getColumn(N).letter}${r}`;
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

