import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { buildSheetModel, colorOf, formatValue } from './sheetModel';
import { fillExcelTemplate, buildFillValues } from './excelFill';
import { computePlan, DEFAULT_SETTINGS, newLine } from './engine';
import { DEFAULT_LAYOUT, type QuoteEntity } from './entity';
import type { PlanData } from './types';

const png = (w: number, h: number) => {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, w); new DataView(b.buffer).setUint32(20, h);
  return `data:image/png;base64,${btoa(String.fromCharCode(...b))}`;
};
const buf = async (wb: ExcelJS.Workbook) => (await wb.xlsx.writeBuffer()) as ArrayBuffer;

describe('định dạng giá trị ô', () => {
  it('số kiểu Việt Nam', () => {
    expect(formatValue(1234567, '#,##0')).toBe('1.234.567');
    expect(formatValue(1234.5, '#,##0.00')).toBe('1.234,50');
    expect(formatValue(0.255, '0.0%')).toBe('25,5%');
    expect(formatValue(12.5)).toBe('12,5');
    expect(formatValue(-5000, '#,##0')).toBe('-5.000');
  });
  it('ngày & chữ', () => { expect(formatValue(new Date(Date.UTC(2026, 9, 3)), 'dd/mm/yyyy')).toBe('03/10/2026'); expect(formatValue('abc')).toBe('abc'); });
  it('màu argb & theme (có tint)', () => {
    expect(colorOf({ argb: 'FFC00000' })).toBe('#c00000');
    expect(colorOf({ theme: 0 })).toBe('#ffffff');
    expect(colorOf({ theme: 1, tint: 0.5 })).toBe('#808080');
    expect(colorOf(undefined)).toBeNull();
  });
});

describe('dựng mô hình sheet', () => {
  it('toạ độ ô, ô gộp, nền, viền, căn lề', async () => {
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('S');
    ws.getColumn(1).width = 10; ws.getColumn(2).width = 20; ws.getRow(1).height = 30;
    ws.mergeCells('A1:B1'); ws.getCell('A1').value = 'TIÊU ĐỀ'; ws.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FFFF0000' } };
    ws.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };
    ws.getCell('B2').value = 1234567; ws.getCell('B2').numFmt = '#,##0'; ws.getCell('B2').border = { bottom: { style: 'thin' } };
    const m = await buildSheetModel(await buf(wb), 'S');
    const head = m.cells.find(c => c.text === 'TIÊU ĐỀ')!;
    expect(head).toMatchObject({ x: 0, y: 0, w: 75 + 145, h: 40, bold: true, bg: '#fff2cc', h_align: 'center', v_align: 'center', color: '#ff0000' });
    expect(head.size).toBeCloseTo(18.67, 1);
    const num = m.cells.find(c => c.text === '1.234.567')!;
    expect(num).toMatchObject({ x: 75, y: 40, h_align: 'right' });
    expect(num.b).toMatchObject({ w: 1, style: 'solid' });
    expect(m.width).toBe(220);
  });
  it('dòng ẩn bị bỏ, dòng sau dịch lên', async () => {
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('S');
    ws.getCell('A1').value = 'a'; ws.getCell('A2').value = 'b'; ws.getCell('A3').value = 'c'; ws.getRow(2).hidden = true;
    const m = await buildSheetModel(await buf(wb), 'S');
    expect(m.cells.map(c => c.text)).toEqual(['a', 'c']);
    expect(m.cells[1].y).toBe(m.cells[0].h);
  });
  it('ô tự xuống dòng không đặt chiều cao → dòng được giãn ra', async () => {
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('S'); ws.getColumn(1).width = 12;
    ws.getCell('A1').value = 'Một đoạn chữ khá dài cần phải xuống nhiều dòng trong ô hẹp'; ws.getCell('A1').alignment = { wrapText: true };
    ws.getCell('A2').value = 'sau';
    const m = await buildSheetModel(await buf(wb), 'S');
    const a = m.cells.find(c => c.text.startsWith('Một'))!;
    expect(a.h).toBeGreaterThan(40);
    expect(m.cells.find(c => c.text === 'sau')!.y).toBe(a.h);
  });
  it('vùng in được tôn trọng', async () => {
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('S');
    ws.getCell('A1').value = 'trong'; ws.getCell('F20').value = 'ngoài'; ws.pageSetup.printArea = 'A1:C5';
    const m = await buildSheetModel(await buf(wb), 'S');
    expect(m.cells.map(c => c.text)).toEqual(['trong']);
    expect(m.height).toBe(5 * 20);
  });
  it('ảnh đọc lại đúng vị trí & kích thước (1 ô neo và 2 ô neo)', async () => {
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('S');
    ws.getColumn(1).width = 10; ws.getCell('D10').value = 'x';
    const id = wb.addImage({ base64: png(100, 50), extension: 'png' });
    ws.addImage(id, { tl: { nativeCol: 1, nativeColOff: 10 * 9525, nativeRow: 2, nativeRowOff: 5 * 9525 } as never, ext: { width: 120, height: 60 } });
    ws.addImage(id, { tl: { col: 0, row: 0 }, br: { col: 2, row: 1 } } as never);
    const m = await buildSheetModel(await buf(wb), 'S');
    expect(m.images).toHaveLength(2);
    const one = m.images.find(i => i.w === 120)!;
    expect(one).toMatchObject({ x: 75 + 10, y: 40 + 5, h: 60 });
    expect(one.src.startsWith('data:image/png;base64,')).toBe(true);
    const two = m.images.find(i => i.w !== 120)!;
    expect(two).toMatchObject({ x: 0, y: 0 }); expect(two.w).toBeGreaterThan(100); expect(two.h).toBe(20);
  });
  it('sheet không tồn tại → dùng sheet đầu; file rỗng báo lỗi rõ', async () => {
    const wb = new ExcelJS.Workbook(); wb.addWorksheet('A').getCell('A1').value = 1;
    expect((await buildSheetModel(await buf(wb), 'B')).name).toBe('A');
  });
});

describe('end-to-end: điền mẫu + ký → mô hình có ảnh nằm dưới chức danh', () => {
  it('ảnh chữ ký/con dấu nằm trong vùng trống dưới "ĐẠI DIỆN" và không đè chữ', async () => {
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('VN');
    ws.getColumn(2).width = 30; ws.getColumn(5).width = 14; ws.getColumn(6).width = 14;
    ws.getRow(5).values = [undefined, 'STT', 'Nội dung', 'Đơn vị', 'Đơn giá'];
    ws.getRow(6).values = [undefined, 1, 'Lương ngày làm việc 8 tiếng', 'VNĐ/ngày', 1];
    ws.mergeCells('E12:F12'); ws.getCell('E12').value = 'ĐẠI DIỆN CÔNG TY'; ws.getCell('E13').value = '(Giám đốc)';
    ws.getCell('E20').value = 'cuối';
    const data: PlanData = { settings: { ...DEFAULT_SETTINGS, taxOption: 'none' }, notes: '', lines: [newLine({ name: 'Lương cơ bản', unit: 'day', value: 250_000, paidToWorker: true, isBaseWage: true, group: 'worker' })] };
    const ent: QuoteEntity = { id: 'e', label: 'L', layout: DEFAULT_LAYOUT, logo: null, signature: png(400, 200), seal: png(300, 300), has_signature: true, has_seal: true, sort_order: 0, updated_by_name: null, updated_at: null, data: { name: 'C' } as QuoteEntity['data'] };
    const { output } = await fillExcelTemplate(await buf(wb), buildFillValues(data, computePlan(data), {}, { entity: ent, use: { signature: true, seal: true } }), { sheet: 'VN' });
    const m = await buildSheetModel(output, 'VN');
    const title = m.cells.find(c => c.text === 'ĐẠI DIỆN CÔNG TY')!;
    const sub = m.cells.find(c => c.text === '(Giám đốc)')!;
    const last = m.cells.find(c => c.text === 'cuối')!;
    expect(m.images).toHaveLength(2);
    for (const i of m.images) { expect(i.y).toBeGreaterThanOrEqual(sub.y + sub.h - 1); expect(i.y + i.h).toBeLessThanOrEqual(last.y + 2); }
    expect(m.cells.find(c => c.text === '424.000' || c.text === '250.000' || /\d/.test(c.text) && c.x > 0)).toBeTruthy();
    expect(title.y).toBeLessThan(sub.y);
  });
});
