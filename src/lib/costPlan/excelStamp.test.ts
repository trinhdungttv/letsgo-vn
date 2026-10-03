import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { anchorAt, boxOf, colPx, findSignatureBox, fillExcelTemplate, buildFillValues, mergeOf, rowPx } from './excelFill';
import { computePlan, DEFAULT_SETTINGS, newLine } from './engine';
import { DEFAULT_LAYOUT, type QuoteEntity } from './entity';
import type { PlanData } from './types';

const png = (w: number, h: number) => {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, w); new DataView(b.buffer).setUint32(20, h);
  return `data:image/png;base64,${btoa(String.fromCharCode(...b))}`;
};
const SIG = png(400, 200), SEAL = png(300, 300), LOGO = png(200, 100);

const data: PlanData = {
  settings: { ...DEFAULT_SETTINGS, taxOption: 'none' }, notes: '',
  lines: [
    newLine({ name: 'Lương cơ bản', unit: 'day', value: 250_000, paidToWorker: true, isBaseWage: true, group: 'worker' }),
    newLine({ name: 'Phí dịch vụ', unit: 'day', value: 74_000, isServiceFee: true, group: 'service' }),
  ],
};
const entity = (over: Partial<QuoteEntity> = {}): QuoteEntity => ({
  id: 'e1', label: 'Let\'s Go', layout: DEFAULT_LAYOUT, logo: LOGO, signature: SIG, seal: SEAL, has_signature: true, has_seal: true, sort_order: 0, updated_by_name: null, updated_at: null,
  data: { name: 'CÔNG TY LET\'S GO', address: '1 Nguyễn Huệ', taxCode: '0312345678', signerName: 'Nguyễn Văn A', signerTitle: 'Giám đốc', place: 'TP.HCM' } as QuoteEntity['data'],
  ...over,
});
const vals = (use: { signature?: boolean; seal?: boolean; logo?: boolean }, e: QuoteEntity | null = entity()) =>
  buildFillValues(data, computePlan(data), { company: 'ABC', today: new Date(2026, 9, 3) }, { entity: e, use });

/** Mẫu: bảng giá + khối ký "ĐẠI DIỆN CÔNG TY / Giám đốc" ở cột E, 5 dòng trống bên dưới. */
async function tpl(kind: 'auto' | 'token' | 'both' | 'cramped' | 'none'): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('VN');
  ws.getColumn(2).width = 30; ws.getColumn(3).width = 12; ws.getColumn(4).width = 10; ws.getColumn(5).width = 14; ws.getColumn(6).width = 14;
  ws.getRow(5).values = [undefined, 'STT', 'Nội dung', 'Đơn vị', 'Đơn giá'];
  ws.getRow(6).values = [undefined, 1, 'Lương ngày làm việc 8 tiếng', 'VNĐ/ngày', 1];
  ws.getCell('B8').value = 'Ghi chú: {{luu_y}}';
  if (kind !== 'none') {
    ws.mergeCells('E12:F12');
    ws.getCell('E12').value = 'ĐẠI DIỆN CÔNG TY';
    ws.getCell('E13').value = '(Giám đốc)';
  }
  if (kind === 'token') { ws.mergeCells('E15:F19'); ws.getCell('E15').value = '{{chu_ky}}'; ws.mergeCells('B15:C19'); ws.getCell('B15').value = '{{con_dau}}'; }
  if (kind === 'both') { ws.mergeCells('E15:F19'); ws.getCell('E15').value = '{{chu_ky}} {{con_dau}}'; }
  if (kind === 'cramped') ws.getCell('E14').value = 'Ghi chú khác';
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}
const load = async (buf: ArrayBuffer) => { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf); return wb; };
const pics = (ws: ExcelJS.Worksheet) => ws.getImages().map(i => ({ ...i.range.tl as unknown as { nativeCol: number; nativeRow: number; nativeColOff: number; nativeRowOff: number }, ext: (i.range as unknown as { ext: { width: number; height: number } }).ext }));

describe('đo ô Excel ra pixel', () => {
  it('cột & dòng', async () => {
    const ws = (await load(await tpl('auto'))).getWorksheet('VN')!;
    expect(colPx(ws, 2)).toBe(215);                // 30 × 7 + 5
    expect(Math.round(rowPx(ws, 1))).toBe(20);     // 15pt = 20px
    expect(boxOf(ws, { r1: 1, r2: 2, c1: 5, c2: 6 })).toEqual({ w: 103 + 103, h: rowPx(ws, 1) + rowPx(ws, 2) });
  });
  it('vùng gộp & ô thường', async () => {
    const ws = (await load(await tpl('auto'))).getWorksheet('VN')!;
    expect(mergeOf(ws, 12, 6)).toEqual({ r1: 12, c1: 5, r2: 12, c2: 6 });
    expect(mergeOf(ws, 6, 2)).toEqual({ r1: 6, c1: 2, r2: 6, c2: 2 });
  });
  it('anchorAt: lệch dương qua nhiều cột/dòng và lệch âm', async () => {
    const ws = (await load(await tpl('auto'))).getWorksheet('VN')!;
    const a = anchorAt(ws, 2, 1, 215 + 10, 20 + 5);          // vượt cột B (215px) & dòng 1 (20px)
    expect(a.nativeCol).toBe(2); expect(a.nativeRow).toBe(1);
    expect(Math.round(a.nativeColOff / 9525)).toBe(10); expect(Math.round(a.nativeRowOff / 9525)).toBe(5);
    const b = anchorAt(ws, 3, 3, -20, -10);                   // lùi sang cột B, dòng 2
    expect(b.nativeCol).toBe(1); expect(b.nativeRow).toBe(1);
    expect(Math.round(b.nativeColOff / 9525)).toBe(215 - 20);
  });
});

describe('tự tìm khối ký', () => {
  it('tìm "ĐẠI DIỆN CÔNG TY" và lấy vùng trống bên dưới, bỏ qua dòng "(Giám đốc)"', async () => {
    const ws = (await load(await tpl('auto'))).getWorksheet('VN')!;
    const f = findSignatureBox(ws)!;
    expect(f.box.r1).toBe(14);
    expect(f.box.c1).toBeLessThanOrEqual(5);
    expect(f.tight).toBe(false);
  });
  it('ô đánh dấu {{nguoi_dai_dien}} dưới khối ký KHÔNG bị nhầm là chức danh', async () => {
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('S');
    ws.getCell('E12').value = 'ĐẠI DIỆN CÔNG TY'; ws.getCell('E20').value = '{{nguoi_dai_dien}}';
    const f = findSignatureBox(ws)!;
    expect(f.box.r1).toBe(13); expect(f.box.r2).toBeLessThan(20);
  });
  it('không có khối ký → null', async () => {
    expect(findSignatureBox((await load(await tpl('none'))).getWorksheet('VN')!)).toBeNull();
  });
  it('nhận cả tiếng Anh / tiếng Trung', async () => {
    for (const t of ['Legal Representative', 'GENERAL DIRECTOR', '法定代表人']) {
      const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('S'); ws.getCell('D10').value = t;
      expect(findSignatureBox(ws), t).not.toBeNull();
    }
  });
});

describe('chèn chữ ký / con dấu vào file của khách', () => {
  it('tự tìm khối ký → chèn 2 ảnh dưới chức danh, ảnh nằm trong vùng trống, đúng tỉ lệ', async () => {
    const { output, report } = await fillExcelTemplate(await tpl('auto'), vals({ signature: true, seal: true }), { sheet: 'VN' });
    const ws = (await load(output)).getWorksheet('VN')!;
    expect(ws.getImages()).toHaveLength(2);
    expect(report.images.map(i => [i.what, i.mode])).toEqual([['chữ ký', 'tự tìm khối ký'], ['con dấu', 'tự tìm khối ký']]);
    for (const p of pics(ws)) expect(p.nativeRow).toBeGreaterThanOrEqual(13);     // 0-based: không đè lên dòng chức danh (dòng 12/13)
    const [sig, seal] = pics(ws);
    expect(Math.abs(sig.ext.width / sig.ext.height - 2)).toBeLessThan(0.05);          // 400×200
    expect(Math.abs(seal.ext.width / seal.ext.height - 1)).toBeLessThan(0.05);        // vuông
    expect(report.imageWarnings).toEqual([]);
  });

  it('ô {{chu_ky}} / {{con_dau}} riêng → xoá chữ đánh dấu, ảnh đặt đúng ô', async () => {
    const { output, report } = await fillExcelTemplate(await tpl('token'), vals({ signature: true, seal: true }), { sheet: 'VN' });
    const ws = (await load(output)).getWorksheet('VN')!;
    expect(ws.getCell('E15').value ?? null).toBeNull();
    expect(ws.getCell('B15').value ?? null).toBeNull();
    expect(report.images.map(i => i.mode)).toEqual(['ô đánh dấu', 'ô đánh dấu']);
    const [sig, seal] = pics(ws).sort((a, b) => a.nativeCol - b.nativeCol).reverse();
    expect(sig.nativeCol).toBeGreaterThanOrEqual(4);       // cột E
    expect(seal.nativeCol).toBeLessThanOrEqual(2);         // cột B/C
    expect(sig.nativeRow).toBe(14);
  });

  it('cả hai token trong 1 ô → dùng bố cục chuẩn: dấu lệch trái, đè một phần lên chữ ký', async () => {
    const { output } = await fillExcelTemplate(await tpl('both'), vals({ signature: true, seal: true }), { sheet: 'VN' });
    const ws = (await load(output)).getWorksheet('VN')!;
    expect(ws.getCell('E15').value ?? null).toBeNull();
    const [sig, seal] = pics(ws);
    const absX = (p: ReturnType<typeof pics>[number]) => p.nativeColOff / 9525 + (p.nativeCol - 4) * 103;
    expect(absX(seal)).toBeLessThan(absX(sig));
    expect(absX(seal) + seal.ext.width).toBeGreaterThan(absX(sig));   // chồng lên nhau
  });

  it('mặc định tắt: không bật → không chèn ảnh nhưng vẫn xoá ô đánh dấu', async () => {
    const { output, report } = await fillExcelTemplate(await tpl('both'), vals({}), { sheet: 'VN' });
    const ws = (await load(output)).getWorksheet('VN')!;
    expect(ws.getImages()).toHaveLength(0);
    expect(ws.getCell('E15').value ?? null).toBeNull();
    expect(report.images).toEqual([]);
  });

  it('bật chữ ký nhưng pháp nhân chưa có ảnh (không phải admin) → không chèn, không lỗi', async () => {
    const { output } = await fillExcelTemplate(await tpl('auto'), vals({ signature: true, seal: true }, entity({ signature: null, seal: null })), { sheet: 'VN' });
    expect((await load(output)).getWorksheet('VN')!.getImages()).toHaveLength(0);
  });

  it('mẫu không có khối ký và không có token → cảnh báo rõ, vẫn trả file', async () => {
    const { report, output } = await fillExcelTemplate(await tpl('none'), vals({ signature: true, seal: true }), { sheet: 'VN' });
    expect(output.byteLength).toBeGreaterThan(0);
    expect(report.imageWarnings.join(' ')).toMatch(/Không tìm thấy khối ký/);
  });

  it('khối ký chật (không có dòng trống) → cảnh báo', async () => {
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('VN');
    ws.getCell('E12').value = 'ĐẠI DIỆN CÔNG TY'; ws.getCell('E13').value = 'Giám đốc'; ws.getCell('E14').value = 'x'; ws.getCell('E15').value = 'y';
    const { report } = await fillExcelTemplate((await wb.xlsx.writeBuffer()) as ArrayBuffer, vals({ signature: true }), { sheet: 'VN' });
    expect(report.imageWarnings.join(' ')).toMatch(/không đủ dòng trống/);
  });

  it('logo chỉ chèn khi có ô {{logo}}', async () => {
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('VN');
    ws.mergeCells('B1:C3'); ws.getCell('B1').value = '{{logo}}';
    const b = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
    const a = await fillExcelTemplate(b, vals({ logo: true }), { sheet: 'VN' });
    expect((await load(a.output)).getWorksheet('VN')!.getImages()).toHaveLength(1);
    const c = await fillExcelTemplate(await tpl('auto'), vals({ logo: true }), { sheet: 'VN' });
    expect(c.report.imageWarnings.join(' ')).toMatch(/không có ô \{\{logo\}\}/);
  });

  it('ảnh sẵn có trong file mẫu (logo in sẵn) KHÔNG bị mất sau khi điền', async () => {
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('VN');
    const id = wb.addImage({ base64: png(120, 60), extension: 'png' });
    ws.addImage(id, { tl: { col: 0, row: 0 }, ext: { width: 120, height: 60 } });
    ws.getCell('E12').value = 'ĐẠI DIỆN CÔNG TY';
    const { output } = await fillExcelTemplate((await wb.xlsx.writeBuffer()) as ArrayBuffer, vals({ signature: true }), { sheet: 'VN' });
    expect((await load(output)).getWorksheet('VN')!.getImages()).toHaveLength(2);
  });

  it('không dùng ảnh thì cũng không rò rỉ token ảnh sang giá trị chữ', async () => {
    const v = vals({ signature: true, seal: true });
    expect(Object.keys(v.text)).not.toContain('chu_ky');
    expect(v.text.nguoi_dai_dien).toBe('Nguyễn Văn A');
    expect(v.text.cong_ty).toBe('CÔNG TY LET\'S GO');
  });
});
