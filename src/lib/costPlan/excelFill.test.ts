import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { classifyLabel, fillExcelTemplate, buildFillValues } from './excelFill';
import { computePlan, DEFAULT_SETTINGS, newLine } from './engine';
import type { PlanData } from './types';

// Nhãn lấy đúng từ ảnh bảng báo giá thật (song ngữ Việt–Trung)
const LABELS: [string, string][] = [
  ['Lương ngày làm việc 8 tiếng\n8小时工作日工资', 'day8'],
  ['Lương ngày làm việc 8 tiếng ca đêm\n8小时夜班工作日工资', 'night8'],
  ['Lương tăng ca ngày 1 tiếng\n加班工资每天增加1小时', 'ot_day'],
  ['Lương tăng ca 1 tiếng ca đêm\n夜班加班费1小时', 'ot_night'],
  ['Lương tăng ca ngày chủ nhật 1 tiếng\n周日加班1小时', 'ot_sun'],
  ['Lương tăng ca ngày chủ nhật 1 tiếng ca đêm\n周日加班费1小时夜班', 'ot_sun_night'],
  ['Lương tăng ca ngày lễ, Tết 1 tiếng', 'ot_hol'],
  ['Lương tăng ca ngày lễ, Tết 1 tiếng ca đêm', 'ot_hol_night'],
];

describe('nhận diện nhãn dòng giá', () => {
  for (const [label, kind] of LABELS) it(`${label.split('\n')[0]} → ${kind}`, () => expect(classifyLabel(label)).toBe(kind));
  it('nhãn không liên quan → null', () => {
    expect(classifyLabel('Phụ cấp cơm trưa')).toBeNull();
    expect(classifyLabel('Ghi chú: Báo giá chưa bao gồm VAT')).toBeNull();
    expect(classifyLabel('Cung ứng cho thuê lao động phổ thông')).toBeNull();
  });
  it('"lễ" chỉ khớp nguyên từ — "tiếng Lê" không bị nhầm thành lễ/Tết', () => {
    expect(classifyLabel('Lương tăng ca ngày 1 tiếng (anh Lê)')).toBe('ot_day');
  });
});

const real: PlanData = {
  settings: { ...DEFAULT_SETTINGS, taxOption: 'none' }, notes: '',
  lines: [
    newLine({ name: 'Lương cơ bản', unit: 'day', value: 250_000, paidToWorker: true, isBaseWage: true, group: 'worker' }),
    newLine({ name: 'Phụ cấp độc hại', unit: 'day', value: 40_000, paidToWorker: true, group: 'worker' }),
    newLine({ name: 'BHXH', unit: 'day', value: 60_000, group: 'compliance' }),
    newLine({ name: 'Phí dịch vụ', unit: 'day', value: 74_000, isServiceFee: true, group: 'service' }),
  ],
};
const values = () => buildFillValues(real, computePlan(real), { company: 'Công ty ABC', industry: 'Hóa chất', zone: 'KCN Dầu Giây', today: new Date(2026, 9, 3) });

/** Dựng file mẫu giống ảnh: tiêu đề + bảng 5 cột + ghi chú, ô giá có định dạng riêng. */
async function makeTemplate(opts: { tokens?: boolean; formulaRow?: boolean } = {}): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Báo giá');
  ws.getCell('B2').value = opts.tokens ? 'Kính gửi: {{ten_khach}} — {{nganh}} — {{kcn}} — ngày {{ngay_bao_gia}}' : 'Kính gửi: quý khách';
  ws.getCell('B3').value = 'Cung ứng lao động phổ thông';
  ws.getRow(5).values = [undefined, 'STT\n序号', 'Nội dung đơn giá\n单价内容', 'Đơn vị tính', 'Đơn giá (VNĐ)\n单价（越南盾）', 'Ghi chú\n备注'];
  LABELS.slice(0, 6).forEach(([label], i) => {
    const r = 6 + i;
    ws.getRow(r).values = [undefined, i + 1, label, i < 2 ? 'VNĐ/ngày' : 'VNĐ/giờ', 111, i === 0 ? 'Bao gồm: cũ' : undefined];
    const p = ws.getCell(`E${r}`);
    p.font = { bold: true, color: { argb: 'FFC00000' } };
    p.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };
    p.border = { top: { style: 'thin' }, bottom: { style: 'thin' } };
  });
  ws.mergeCells('F6:F11');
  ws.getRow(12).values = [undefined, undefined, 'Phụ cấp cơm trưa', 'VNĐ/ngày', 30_000];            // dòng có giá nhưng không nhận ra
  if (opts.formulaRow) ws.getCell('E13').value = { formula: 'E6*2', result: 222 };
  if (opts.formulaRow) ws.getRow(13).values = [undefined, undefined, 'Lương ngày làm việc 8 tiếng ca đêm', 'VNĐ/ngày', { formula: 'E6*2', result: 222 }];
  ws.getCell('B15').value = 'Ghi chú: {{luu_y}}';
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}
const reread = async (buf: ArrayBuffer) => { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf); return wb.getWorksheet('Báo giá')!; };

describe('điền file Excel mẫu', () => {
  it('tự nhận bảng giá: điền đúng 6 ô theo nhãn (số khớp bảng giá thật)', async () => {
    const { output, report } = await fillExcelTemplate(await makeTemplate(), values());
    const ws = await reread(output);
    expect([6, 7, 8, 9, 10, 11].map(r => ws.getCell(`E${r}`).value)).toEqual([424_000, 499_000, 46_875, 62_500, 62_500, 84_375]);
    expect(report.rows).toHaveLength(6);
    expect(report.foundTable).toBe(true);
  });
  it('giữ nguyên định dạng của ô giá (chữ đậm đỏ, nền vàng, viền) và ô gộp', async () => {
    const ws = await reread((await fillExcelTemplate(await makeTemplate(), values())).output);
    const c = ws.getCell('E7');
    expect(c.font?.bold).toBe(true);
    expect(c.font?.color?.argb).toBe('FFC00000');
    expect((c.fill as ExcelJS.FillPattern).fgColor?.argb).toBe('FFFFF2CC');
    expect(c.border?.top?.style).toBe('thin');
    expect(ws.getCell('F6').isMerged).toBe(true);
    expect(ws.getCell('F6').value).toBe('Bao gồm: cũ');   // không ghi đè ghi chú của file mẫu
  });
  it('ô giá chưa có định dạng số → đặt #,##0', async () => {
    const ws = await reread((await fillExcelTemplate(await makeTemplate(), values())).output);
    expect(ws.getCell('E6').numFmt).toBe('#,##0');
  });
  it('dòng có giá nhưng không nhận ra nhãn → giữ nguyên và báo lại', async () => {
    const { output, report } = await fillExcelTemplate(await makeTemplate(), values());
    expect((await reread(output)).getCell('E12').value).toBe(30_000);
    expect(report.skipped.some(s => /Phụ cấp cơm trưa/.test(s))).toBe(true);
  });
  it('ô giá có công thức → không ghi đè, báo lại', async () => {
    const { output, report } = await fillExcelTemplate(await makeTemplate({ formulaRow: true }), values());
    const v = (await reread(output)).getCell('E13').value as { formula?: string };
    expect(v.formula).toBe('E6*2');
    expect(report.skipped.some(s => /công thức/.test(s))).toBe(true);
  });
  it('ô {{...}}: thay tên khách, ngành, KCN, ngày, lưu ý', async () => {
    const { output, report } = await fillExcelTemplate(await makeTemplate({ tokens: true }), values());
    const ws = await reread(output);
    expect(ws.getCell('B2').value).toBe('Kính gửi: Công ty ABC — Hóa chất — KCN Dầu Giây — ngày 03/10/2026');
    expect(String(ws.getCell('B15').value)).toContain('Báo giá chưa bao gồm thuế VAT.');
    expect(report.tokens).toBe(5);
  });
  it('token giá nằm riêng 1 ô → ghi số thật; token lạ → để nguyên', async () => {
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Báo giá');
    ws.getCell('A1').value = '{{gia_ngay}}'; ws.getCell('A2').value = 'Giá đêm: {{gia_dem}} đ/ngày'; ws.getCell('A3').value = '{{khong_co}}';
    const { output, report } = await fillExcelTemplate((await wb.xlsx.writeBuffer()) as ArrayBuffer, values());
    const out = await reread(output);
    expect(out.getCell('A1').value).toBe(424_000);
    expect(out.getCell('A2').value).toBe('Giá đêm: 499.000 đ/ngày');
    expect(out.getCell('A3').value).toBe('{{khong_co}}');
    expect(report.tokens).toBe(2);
  });
  it('file không có bảng giá lẫn token → không lỗi, báo không tìm thấy', async () => {
    const wb = new ExcelJS.Workbook(); wb.addWorksheet('Báo giá').getCell('A1').value = 'Xin chào';
    const { report } = await fillExcelTemplate((await wb.xlsx.writeBuffer()) as ArrayBuffer, values());
    expect(report.foundTable).toBe(false); expect(report.rows).toHaveLength(0); expect(report.tokens).toBe(0);
  });
  it('KHÔNG lộ giá vốn / lợi nhuận: chỉ các khoản hiển thị cho khách mới có giá trị', () => {
    const v = values();
    expect(Object.keys(v.prices).sort()).toEqual(['base', 'bhxh', 'day8', 'night8', 'night_allow', 'ot_day', 'ot_hol', 'ot_hol_night', 'ot_night', 'ot_sun', 'ot_sun_night', 'service_fee']);
    expect(JSON.stringify(v.text)).not.toMatch(/gia_von|loi_nhuan/);
  });
  it('mẫu KHÔNG có dòng "Phí dịch vụ"/"BHXH" thì phí dịch vụ không xuất hiện ở bất kỳ ô nào', async () => {
    const { output } = await fillExcelTemplate(await makeTemplate({ tokens: true }), values());
    const ws = await reread(output);
    const all: unknown[] = []; ws.eachRow(r => r.eachCell(c => all.push(c.value)));
    expect(all).not.toContain(74_000);
  });
});

// ── Nhiều phiên bản trong 1 file: Việt / Việt–Trung / Anh–Việt ─────────────────────────────────
import { detectLang, inspectTemplate, LANG_LABEL } from './excelFill';

const HEAD = {
  vi: ['STT', 'Nội dung đơn giá', 'Đơn vị tính', 'Đơn giá (VNĐ)', 'Ghi chú'],
  zh: ['STT 序号', 'Nội dung đơn giá 单价内容', 'Đơn vị tính 计量单位', 'Đơn giá (VNĐ) 单价（越南盾）', 'Ghi chú 备注'],
  en: ['No.', 'Description / Nội dung', 'Unit', 'Unit price (VND)', 'Remarks'],
};
const ROWS = {
  vi: ['Lương ngày làm việc 8 tiếng', 'Lương ngày làm việc 8 tiếng ca đêm', 'Lương tăng ca ngày 1 tiếng', 'Lương tăng ca 1 tiếng ca đêm', 'Lương tăng ca ngày chủ nhật 1 tiếng', 'Lương tăng ca ngày chủ nhật 1 tiếng ca đêm'],
  zh: ['Lương ngày làm việc 8 tiếng\n8小时工作日工资', 'Lương ngày làm việc 8 tiếng ca đêm\n8小时夜班工作日工资', 'Lương tăng ca ngày 1 tiếng\n加班工资每天增加1小时', 'Lương tăng ca 1 tiếng ca đêm\n夜班加班费1小时', 'Lương tăng ca ngày chủ nhật 1 tiếng\n周日加班1小时', 'Lương tăng ca ngày chủ nhật 1 tiếng ca đêm\n周日加班费1小时夜班'],
  // Anh–Việt: nhãn có thể chỉ có tiếng Anh
  en: ['Daily wage (8 hours)', 'Daily wage (8 hours) - night shift', 'Overtime pay per hour - weekday', 'Overtime pay per hour - weekday night', 'Overtime pay per hour - Sunday', 'Overtime pay per hour - Sunday night'],
};
async function multiVersionTemplate(): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  (['vi', 'zh', 'en'] as const).forEach((k, idx) => {
    const ws = wb.addWorksheet(['VN', 'VN-CN', 'EN-VN'][idx]);
    ws.getCell('B2').value = k === 'en' ? 'QUOTATION — Customer: {{ten_khach}}' : 'BÁO GIÁ — Khách hàng: {{ten_khach}}';
    ws.getRow(5).values = [undefined, ...HEAD[k]];
    ROWS[k].forEach((l, i) => { ws.getRow(6 + i).values = [undefined, i + 1, l, i < 2 ? 'VND/day' : 'VND/hour', 111]; });
  });
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

describe('nhận nhãn tiếng Anh / tiếng Trung', () => {
  const EN: [string, string][] = [
    ['Daily wage (8 hours)', 'day8'], ['Daily wage (8 hours) - night shift', 'night8'],
    ['Overtime pay per hour - weekday', 'ot_day'], ['Overtime pay per hour - weekday night', 'ot_night'],
    ['Overtime pay per hour - Sunday', 'ot_sun'], ['Overtime pay per hour - Sunday night', 'ot_sun_night'],
    ['Overtime pay per hour - public holiday', 'ot_hol'], ['Overtime pay per hour - public holiday night', 'ot_hol_night'],
  ];
  for (const [l, k] of EN) it(`EN: ${l} → ${k}`, () => expect(classifyLabel(l)).toBe(k));
  const ZH: [string, string][] = [
    ['8小时工作日工资', 'day8'], ['8小时夜班工作日工资', 'night8'], ['加班工资每天增加1小时', 'ot_day'], ['夜班加班费1小时', 'ot_night'],
    ['周日加班1小时', 'ot_sun'], ['周日加班费1小时夜班', 'ot_sun_night'], ['节假日加班1小时', 'ot_hol'], ['节假日夜班加班1小时', 'ot_hol_night'],
  ];
  for (const [l, k] of ZH) it(`ZH: ${l} → ${k}`, () => expect(classifyLabel(l)).toBe(k));
  it('nhãn tiếng Anh không liên quan → null', () => {
    expect(classifyLabel('Lunch allowance')).toBeNull();
    expect(classifyLabel('Remarks: price excludes VAT')).toBeNull();
  });
});

describe('đoán ngôn ngữ phiên bản', () => {
  it('có chữ Hán → Việt–Trung', () => expect(detectLang(['Đơn giá 单价', 'Lương ngày'])).toBe('zh'));
  it('nhiều từ báo giá tiếng Anh → Anh–Việt', () => expect(detectLang(['QUOTATION', 'Description', 'Unit price (VND)', 'Overtime pay per hour'])).toBe('en'));
  it('chỉ tiếng Việt (kể cả có chữ "VAT") → Việt', () => expect(detectLang(['BÁO GIÁ', 'Báo giá chưa bao gồm thuế VAT', 'Đơn giá'])).toBe('vi'));
  it('nội dung mơ hồ thì dựa vào tên sheet', () => {
    expect(detectLang(['x'], 'Song ngữ Trung')).toBe('zh');
    expect(detectLang(['x'], 'English')).toBe('en');
    expect(detectLang(['x'], 'Sheet1')).toBe('vi');
  });
  it('nhãn hiển thị', () => expect(LANG_LABEL.zh).toBe('Song ngữ Việt – Trung'));
});

describe('file mẫu nhiều phiên bản', () => {
  it('liệt kê đủ 3 phiên bản, đúng ngôn ngữ, nhận đủ 6 dòng giá mỗi bản', async () => {
    const v = await inspectTemplate(await multiVersionTemplate());
    expect(v.map(x => [x.sheet, x.lang, x.rows, x.hasTable, x.tokens])).toEqual([['VN', 'vi', 6, true, 1], ['VN-CN', 'zh', 6, true, 1], ['EN-VN', 'en', 6, true, 1]]);
  });
  it('chọn phiên bản Việt–Trung → file trả về CHỈ có sheet đó, đã điền đủ giá', async () => {
    const { output, report } = await fillExcelTemplate(await multiVersionTemplate(), values(), { sheet: 'VN-CN' });
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(output);
    expect(wb.worksheets.map(w => w.name)).toEqual(['VN-CN']);
    const ws = wb.getWorksheet('VN-CN')!;
    expect([6, 7, 8, 9, 10, 11].map(r => ws.getCell(`E${r}`).value)).toEqual([424_000, 499_000, 46_875, 62_500, 62_500, 84_375]);
    expect(report.rows).toHaveLength(6);
    expect(ws.getCell('B2').value).toBe('BÁO GIÁ — Khách hàng: Công ty ABC');
  });
  it('chọn phiên bản Anh–Việt (nhãn chỉ có tiếng Anh) → điền đúng, tiêu đề "Unit price" được nhận', async () => {
    const { output, report } = await fillExcelTemplate(await multiVersionTemplate(), values(), { sheet: 'EN-VN' });
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(output);
    expect(wb.worksheets.map(w => w.name)).toEqual(['EN-VN']);
    expect([6, 7, 8, 9, 10, 11].map(r => wb.getWorksheet('EN-VN')!.getCell(`E${r}`).value)).toEqual([424_000, 499_000, 46_875, 62_500, 62_500, 84_375]);
    expect(report.rows).toHaveLength(6);
    expect(wb.getWorksheet('EN-VN')!.getCell('B2').value).toBe('QUOTATION — Customer: Công ty ABC');
  });
  it('các phiên bản khác KHÔNG bị lẫn: mỗi bản chỉ dùng số của chính nó', async () => {
    const { output } = await fillExcelTemplate(await multiVersionTemplate(), values(), { sheet: 'VN' });
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(output);
    expect(wb.worksheets).toHaveLength(1);
    expect(wb.getWorksheet('VN')!.getCell('B2').value).toBe('BÁO GIÁ — Khách hàng: Công ty ABC');
  });
  it('chọn sheet không tồn tại → báo lỗi rõ, không trả file', async () => {
    await expect(fillExcelTemplate(await multiVersionTemplate(), values(), { sheet: 'KHÔNG-CÓ' })).rejects.toThrow(/Không thấy phiên bản/);
  });
  it('không chọn sheet → xử lý tất cả như cũ', async () => {
    const { output } = await fillExcelTemplate(await multiVersionTemplate(), values());
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(output);
    expect(wb.worksheets).toHaveLength(3);
  });
  it('sheet ẩn không hiện trong danh sách phiên bản', async () => {
    const wb = new ExcelJS.Workbook(); wb.addWorksheet('Hiện'); wb.addWorksheet('Ẩn').state = 'hidden';
    expect((await inspectTemplate((await wb.xlsx.writeBuffer()) as ArrayBuffer)).map(v => v.sheet)).toEqual(['Hiện']);
  });
});
