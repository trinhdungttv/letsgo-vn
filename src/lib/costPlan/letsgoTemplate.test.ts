import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { buildSheetModel } from './sheetModel';
import { LETSGO_VERSIONS, buildLetsgoTemplate } from './letsgoTemplate';
import { FILL_FONT, applyEditsToTemplate, buildFillValues, fillExcelTemplate, inspectTemplate, findSignatureBox } from './excelFill';
import { computePlan, DEFAULT_SETTINGS, newLine } from './engine';
import { DEFAULT_LAYOUT, type QuoteEntity } from './entity';
import { defaultDoc } from './quoteDoc';
import type { PlanData } from './types';

const png = (w: number, h: number) => {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, w); new DataView(b.buffer).setUint32(20, h);
  return `data:image/png;base64,${btoa(String.fromCharCode(...b))}`;
};
const data: PlanData = {
  settings: { ...DEFAULT_SETTINGS, taxOption: 'none' }, notes: '',
  lines: [
    newLine({ name: 'Lương cơ bản', unit: 'day', value: 250_000, paidToWorker: true, isBaseWage: true, group: 'worker' }),
    newLine({ name: 'BHXH, BHYT, BHTN (DN đóng 21,5%)', unit: 'month', value: 1_290_000, group: 'compliance' }),
    newLine({ name: 'Phí dịch vụ', unit: 'day', value: 74_000, isServiceFee: true, group: 'service' }),
  ],
};
const entity = (over: Partial<QuoteEntity> = {}): QuoteEntity => ({
  id: 'e', label: 'LG', layout: DEFAULT_LAYOUT, logo: null, signature: png(400, 160), seal: png(300, 300), has_signature: true, has_seal: true, sort_order: 0, updated_by_name: null, updated_at: null,
  data: { name: "CÔNG TY CỔ PHẦN LET'S GO VN", address: '', taxCode: '', phone: '', email: '', website: '', signerName: 'Nguyễn Văn Tuấn', signerTitle: 'Tổng giám đốc', place: 'Đồng Nai' },
  ...over,
});
const doc = () => {
  const d = defaultDoc(new Date(2026, 9, 3), { name: 'Công ty ABC', address: '12 Lê Lợi', taxCode: '0312345678', phone: '0251', attn: 'Chị Lan', mobile: '0909', email: 'lan@abc.vn', sellerName: 'Trần Văn B', sellerTitle: 'Kinh doanh', sellerMobile: '0911', sellerEmail: 'b@lg.vn' });
  d.number = 'BG-001';
  return d;
};
const fill = async (sheet: string, use = { signature: true, seal: true }, e = entity()) => {
  const buf = await buildLetsgoTemplate();
  const vals = buildFillValues(data, computePlan(data), { company: 'Công ty ABC' }, { entity: e, doc: doc(), use });
  const { output, report } = await fillExcelTemplate(buf, { ...vals, layout: e.layout }, { sheet });
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(output);
  return { ws: wb.getWorksheet(sheet)!, report };
};
const findCell = (ws: ExcelJS.Worksheet, pred: (t: string) => boolean) => { let out: ExcelJS.Cell | null = null; ws.eachRow(r => r.eachCell(c => { const v = c.value; const t = typeof v === 'object' && v && 'richText' in v ? v.richText.map(x => x.text).join('') : String(v ?? ''); if (!out && pred(t)) out = c; })); return out as ExcelJS.Cell | null; };
const textOf = (c: ExcelJS.Cell) => { const v = c.value; return typeof v === 'object' && v && 'richText' in v ? v.richText.map(x => x.text).join('') : String(v ?? ''); };

describe('Mẫu báo giá Let\'s Go dựng sẵn', () => {
  it('nhận đủ 4 phiên bản, đúng ngôn ngữ, và 10/10 dòng giá mỗi bản', async () => {
    const v = await inspectTemplate(await buildLetsgoTemplate());
    expect(v.map(x => [x.sheet, x.lang, x.rows])).toEqual(LETSGO_VERSIONS.map(x => [x.sheet, x.lang, 10]));
  });
  it('điền đủ 10 dòng giá theo kiểu tách khoản ở cả 4 phiên bản', async () => {
    const p = computePlan(data);
    for (const v of LETSGO_VERSIONS) {
      const { report } = await fill(v.sheet);
      expect(report.rows.map(r => r.kind), v.sheet).toEqual(['base', 'night_allow', 'ot_day', 'ot_night', 'ot_sun', 'ot_sun_night', 'ot_hol', 'ot_hol_night', 'bhxh', 'service_fee']);
      const byKind = Object.fromEntries(report.rows.map(r => [r.kind, r.value]));
      expect(byKind.base).toBe(250_000);
      expect(byKind.night_allow).toBe(75_000);                       // 30% × 250.000
      expect(byKind.ot_day).toBe(46_875); expect(byKind.ot_night).toBe(62_500); expect(byKind.ot_sun).toBe(62_500);
      expect(byKind.ot_sun_night).toBe(84_375); expect(byKind.ot_hol).toBe(93_750); expect(byKind.ot_hol_night).toBe(121_875);
      expect(byKind.bhxh).toBe(1_290_000);
      expect(byKind.service_fee).toBe(Math.round(p.serviceFeeDaily));
    }
  });
  it('điền thông tin khách & người phụ trách vào ô cạnh nhãn (không cần ô {{...}}), đúng bên trái / phải', async () => {
    for (const v of LETSGO_VERSIONS) {
      const { ws, report } = await fill(v.sheet);
      expect(report.fields, v.sheet).toBe(14);
      const right = (label: string, nth = 0) => { const hits: ExcelJS.Cell[] = []; ws.eachRow(r => r.eachCell(c => { if (!(c.isMerged && c.master !== c) && textOf(c).split(/\n| \/ /)[0].replace(/[:：]$/, '').trim() === label) hits.push(c); })); const c = hits[nth]; let col = c.col as unknown as number; const m = (ws.model as { merges?: string[] }).merges ?? []; for (const x of m) { const [a, b] = x.split(':'); if (a === c.address && b) col = ws.getCell(b).col as unknown as number; } const t = ws.getCell(Number(c.row), col + 1); return textOf(t.isMerged ? t.master : t); };
      expect(right('Khách hàng')).toBe('Công ty ABC');
      expect(right('MST')).toBe('0312345678');
      expect(right('Địa chỉ', 0)).toBe('12 Lê Lợi');
      expect(right('Điện thoại')).toBe('0251');
      expect(right('Người liên hệ')).toBe('Chị Lan');
      expect(right('Di động', 0)).toBe('0909');               // nửa trái = khách
      expect(right('Di động', 1)).toBe('0911');               // nửa phải = bên mình
      expect(right('Người phụ trách')).toBe('Trần Văn B');
      expect(right('Chức vụ')).toBe('Kinh doanh');
      expect(right('Số')).toBe('BG-001');
      expect(right('Ngày ban hành')).toBe('03/10/2026');
    }
  });
  it('giữ nguyên chữ gốc: không thay bất kỳ nội dung có sẵn nào', async () => {
    const { ws } = await fill('Trung - Việt');
    expect(findCell(ws, t => t.includes('提供普通劳务派遣，无需工作经验'))).toBeTruthy();
    expect(findCell(ws, t => t.includes('每月月底结算工时'))).toBeTruthy();
    expect(findCell(ws, t => t.includes('阮文俊'))).toBeTruthy();
    expect(findCell(ws, t => t.includes('LET\'S GO VN股份公司'))).toBeTruthy();
  });
  it('câu ghi chú sát dưới bảng ("tăng ca chủ nhật…") KHÔNG bị nhầm thành dòng giá và không bị ghi đè', async () => {
    for (const v of LETSGO_VERSIONS) {
      const { ws } = await fill(v.sheet);
      expect(findCell(ws, t => t.includes('Cách tính lương ca đêm, phụ cấp ca đêm')), v.sheet).toBeTruthy();
    }
    // biến thể không gộp ô, nằm ngay dưới dòng cuối của bảng
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await buildLetsgoTemplate());
    const ws = wb.getWorksheet('Tiếng Việt')!;
    let last = 0; ws.eachRow((r, i) => { if (/Phí dịch vụ/.test(textOf(r.getCell(2)))) last = i; });
    const row = last + 1;
    for (const m of [...((ws.model as { merges?: string[] }).merges ?? [])]) if (new RegExp(`^A${row}:`).test(m)) ws.unMergeCells(m);
    ws.getCell(row, 1).value = 'Cách tính lương ca đêm, phụ cấp ca đêm, lương và tăng ca chủ nhật dựa trên quy định của Luật Việt Nam hiện hành, áp dụng cho mọi ca làm việc.';
    const out = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
    const vals = buildFillValues(data, computePlan(data), { company: 'X' }, { entity: entity(), doc: doc(), use: {} });
    const res = await fillExcelTemplate(out, vals, { sheet: 'Tiếng Việt' });
    expect(res.report.rows).toHaveLength(10);
  });
  it('mẫu đặt "vừa 1 trang": mô hình xem trước biết để thu nhỏ vừa 1 trang', async () => {
    const buf = await buildLetsgoTemplate();
    for (const v of LETSGO_VERSIONS) expect((await buildSheetModel(buf, v.sheet)).fitOnePage, v.sheet).toBe(true);
    const wb = new ExcelJS.Workbook(); wb.addWorksheet('S').getCell('A1').value = 'x';
    expect((await buildSheetModel((await wb.xlsx.writeBuffer()) as ArrayBuffer, 'S')).fitOnePage).toBe(false);
  });
  it('khối ký tìm theo tên người ký in sẵn: ảnh nằm TRONG khoảng trống giữa tên công ty và tên người ký, cả 4 phiên bản', async () => {
    for (const v of LETSGO_VERSIONS) {
      const { ws, report } = await fill(v.sheet);
      const name = findCell(ws, t => t.startsWith('NGUYỄN VĂN TUẤN'))!;
      expect(ws.getImages(), v.sheet).toHaveLength(2 + 1);                // 2 ảnh ký/dấu + logo có sẵn trong mẫu
      const imgs = ws.getImages().map(i => i.range.tl as unknown as { nativeRow: number }).filter(t => t.nativeRow > 10);
      expect(imgs).toHaveLength(2);
      for (const t of imgs) expect(t.nativeRow + 1).toBeLessThan(Number(name.row));      // nằm TRÊN tên người ký
      expect(report.images.every(i => i.mode === 'tự tìm khối ký')).toBe(true);
      expect(report.imageWarnings, v.sheet).toEqual([]);
    }
  });
  it('mặc định KÝ TRƯỚC, ĐÓNG DẤU SAU: ảnh con dấu được thêm sau chữ ký (nằm trên); đổi cấu hình thì đảo lại', async () => {
    const order = async (e: QuoteEntity) => (await fill('Tiếng Việt', { signature: true, seal: true }, e)).report.images.map(i => i.what);
    expect(await order(entity())).toEqual(['chữ ký', 'con dấu']);
    expect(await order(entity({ layout: { ...DEFAULT_LAYOUT, sealOnTop: false } }))).toEqual(['con dấu', 'chữ ký']);
  });
  it('dùng chữ ký/dấu khi chưa điền tên người đại diện → vẫn cảnh báo rõ chứ không đặt bừa', async () => {
    const e = entity(); e.data = { ...e.data, signerName: '' };
    const { report } = await fill('Tiếng Việt', { signature: true, seal: true }, e);
    expect(report.images).toHaveLength(0);
    expect(report.imageWarnings.join(' ')).toMatch(/Người đại diện/);
  });
  it('findSignatureBox theo tên: bỏ qua dấu & hoa/thường', async () => {
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('S');
    ws.getCell('C10').value = 'CÔNG TY ABC'; ws.getCell('C16').value = 'NGUYỄN VĂN TUẤN';
    const f = findSignatureBox(ws as never, { signer: 'Nguyễn văn Tuấn' })!;
    expect(f.box).toMatchObject({ r1: 11, r2: 15 });
    expect(f.tight).toBe(false);
  });

  it('MỌI ô hệ thống điền vào đều dùng font Times New Roman, kể cả khi mẫu dùng font khác (bản có tỉ lệ dùng Arial)', async () => {
    for (const v of LETSGO_VERSIONS) {
      const { ws, report } = await fill(v.sheet);
      for (const rw of report.rows) expect(ws.getCell(rw.cell).font?.name, `${v.sheet}!${rw.cell}`).toBe(FILL_FONT);
      const cus = findCell(ws, t => t === 'Công ty ABC')!;
      expect(cus.font?.name).toBe(FILL_FONT);
      expect(cus.font?.size).toBeGreaterThan(0);                 // giữ cỡ chữ của nhãn
    }
  });
  it('sửa chữ trực tiếp: ô nhiều kiểu chữ giữ kiểu từng đoạn; ô thường thay nguyên; sửa thắng giá trị tự điền', async () => {
    const buf = await buildLetsgoTemplate();
    const e = entity();
    const vals = buildFillValues(data, computePlan(data), { company: 'Công ty ABC' }, { entity: e, doc: doc(), use: {} });
    const probe = (await fillExcelTemplate(buf, vals, { sheet: 'Anh - Việt' })).output;
    const wb0 = new ExcelJS.Workbook(); await wb0.xlsx.load(probe);
    const ws0 = wb0.getWorksheet('Anh - Việt')!;
    const night = findCell(ws0, t => t.startsWith('Phụ cấp ca đêm'))!;
    const cust = findCell(ws0, t => t === 'Công ty ABC')!;
    const { output, report } = await fillExcelTemplate(buf, { ...vals, edits: {
      [`Anh - Việt!${night.address}`]: ['Phụ cấp ca đêm', '\nNight-shift allowance (fixed)'],
      [`Anh - Việt!${cust.address}`]: ['CÔNG TY TNHH ABC VIỆT NAM'],
      'Anh - Việt!Z999': ['bỏ qua ô ngoài vùng không lỗi'],
    } }, { sheet: 'Anh - Việt' });
    expect(report.edited).toBe(3);
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(output);
    const ws = wb.getWorksheet('Anh - Việt')!;
    const v = ws.getCell(night.address).value as { richText: { text: string; font?: { italic?: boolean } }[] };
    expect(v.richText.map(r => r.text)).toEqual(['Phụ cấp ca đêm', '\nNight-shift allowance (fixed)']);
    expect(v.richText[1].font?.italic).toBe(true);                // kiểu chữ nghiêng của bản dịch được giữ
    expect(textOf(ws.getCell(cust.address))).toBe('CÔNG TY TNHH ABC VIỆT NAM');
  });
  it('sửa chữ trong ô giá: nhập "250.000" thành số; ô có công thức không bị đụng', async () => {
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('S');
    ws.getCell('A1').value = 100; ws.getCell('A2').value = { formula: 'A1*2', result: 200 };
    const out = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
    const res = await fillExcelTemplate(out, { prices: {}, text: {}, edits: { 'S!A1': ['250.000'], 'S!A2': ['hỏng'] } });
    const w2 = new ExcelJS.Workbook(); await w2.xlsx.load(res.output);
    expect(w2.getWorksheet('S')!.getCell('A1').value).toBe(250000);
    expect((w2.getWorksheet('S')!.getCell('A2').value as { formula: string }).formula).toBe('A1*2');
    expect(res.report.edited).toBe(1);
  });
  it('lưu sửa đổi vào mẫu: chỉ ghi vào ô có chữ sẵn của mẫu, ô trống (chỗ điền) không bị ghi cứng', async () => {
    const buf = await buildLetsgoTemplate();
    const wb0 = new ExcelJS.Workbook(); await wb0.xlsx.load(buf);
    const ws0 = wb0.getWorksheet('Trung - Việt')!;
    const note = findCell(ws0, t => t.includes('报价不包含增值税'))!;
    let blank = ''; ws0.getRow(Number(findCell(ws0, t => t.startsWith('Khách hàng'))!.row)).eachCell({ includeEmpty: true }, c => { if (!blank && textOf(c) === '' && Number(c.col) > 1) blank = c.address; });
    const { output, applied } = await applyEditsToTemplate(buf, { [`Trung - Việt!${note.address}`]: ['- Báo giá chưa gồm VAT./ 报价不含增值税。'], [`Trung - Việt!${blank}`]: ['không ghi cứng'] });
    expect(applied).toEqual([`Trung - Việt!${note.address}`]);
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(output);
    expect(textOf(wb.getWorksheet('Trung - Việt')!.getCell(note.address))).toContain('报价不含增值税。');
    expect(textOf(wb.getWorksheet('Trung - Việt')!.getCell(blank))).toBe('');
  });
  it('mô hình xem trước cho biết địa chỉ ô, nội dung từng đoạn và ô nào sửa được', async () => {
    const { output } = await fillExcelTemplate(await buildLetsgoTemplate(), buildFillValues(data, computePlan(data), { company: 'X' }, { entity: entity(), doc: doc(), use: {} }), { sheet: 'Anh - Việt' });
    const m = await buildSheetModel(output, 'Anh - Việt');
    const cell = m.cells.find(c => c.raw.join('').startsWith('Phụ cấp ca đêm'))!;
    expect(cell.addr).toMatch(/^[A-Z]+\d+$/); expect(cell.raw).toHaveLength(2); expect(cell.editable).toBe(true);
    expect(cell.runs?.[1].italic).toBe(true);
  });

  it('bản song ngữ: nhãn "Việt / dịch" trên 1 dòng; tiêu đề > đầu mục > chữ thường; giá tiền to hơn chữ thường', async () => {
    const buf = await buildLetsgoTemplate();
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf);
    for (const [sheet, tr] of [['Anh - Việt', 'Customer'], ['Trung - Việt', '客户']] as const) {
      const ws = wb.getWorksheet(sheet)!;
      const lab = findCell(ws, t => t.startsWith('Khách hàng'))!;
      expect(textOf(lab), sheet).toBe(`Khách hàng / ${tr}`);
      const size = (pred: (t: string) => boolean) => findCell(ws, pred)!.font!.size!;
      const title = size(t => t === 'BÁO GIÁ DỊCH VỤ CUNG ỨNG LAO ĐỘNG'), heading = size(t => t.startsWith('1. Dịch vụ cung cấp')), body = size(t => t.startsWith('- Công việc')), thead = size(t => t.startsWith('Nội dung đơn giá'));
      expect(title).toBeGreaterThan(heading); expect(heading).toBeGreaterThan(body); expect(thead).toBeGreaterThanOrEqual(body);
      let price = 0; ws.eachRow(r => r.eachCell({ includeEmpty: true }, c => { if (c.numFmt === '#,##0') price = c.font?.size ?? 0; }));
      expect(price).toBeGreaterThan(body);
    }
    // bảng thông tin thấp lại: 7 dòng nhãn không còn hàng cao 2 dòng
    const ws = wb.getWorksheet('Anh - Việt')!;
    const r0 = Number(findCell(ws, t => t.startsWith('Khách hàng'))!.row);
    for (let i = 0; i < 7; i++) expect(ws.getRow(r0 + i).height!).toBeLessThan(24);
  });
});
