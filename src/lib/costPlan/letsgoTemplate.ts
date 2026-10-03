// Mẫu báo giá CÓ SẴN của Let's Go VN — dựng lại từ 4 file PDF mẫu của công ty (bản Việt, Anh–Việt, Trung–Việt và bản "có cột tỉ lệ %").
// Toàn bộ chữ giữ đúng như file gốc. Mẫu KHÔNG chứa ô {{...}}: hệ thống nhận ra các dòng giá và các ô thông tin theo nhãn
// ("Khách hàng", "MST", "Ngày ban hành"…) như với mọi file Excel khác của công ty.
// Khi có file .xlsx gốc, cứ tải lên thư viện: hệ thống dùng file gốc y nguyên, không cần mẫu này.
import type { Cell, Workbook, Worksheet } from 'exceljs';
import { LETSGO_LOGO_B64 } from './letsgoLogo';
import type { TemplateLang } from './excelFill';

export const LETSGO_TEMPLATE_NAME = "Mẫu báo giá Let's Go VN";

export interface BuiltinVersion { sheet: string; lang: TemplateLang; label: string }
export const LETSGO_VERSIONS: BuiltinVersion[] = [
  { sheet: 'Tiếng Việt', lang: 'vi', label: 'Tiếng Việt' },
  { sheet: 'Anh - Việt', lang: 'en', label: 'Song ngữ Anh – Việt' },
  { sheet: 'Trung - Việt', lang: 'zh', label: 'Song ngữ Việt – Trung' },
  { sheet: 'Có tỉ lệ (%)', lang: 'vi', label: 'Tiếng Việt (có cột tỉ lệ %)' },
];

const NAVY = 'FF081F5C', GREEN = 'FF2A6419', HEAD = 'FFDBE2F1';
type L = 'vi' | 'en' | 'zh';
type Run = { t: string; b?: boolean; i?: boolean; g?: boolean };
const px2emu = 9525;

// ── Nội dung (đúng từng chữ của file gốc) ─────────────────────────────────────────────────────
const NAME = "CÔNG TY CỔ PHẦN LET'S GO VN";
const NAME2: Record<L, string> = { vi: '', en: "LET'S GO VN JOINT STOCK COMPANY", zh: "LET'S GO VN股份公司" };
const TITLE = 'BÁO GIÁ DỊCH VỤ CUNG ỨNG LAO ĐỘNG';
const TITLE2: Record<L, string> = { vi: '', en: 'LABOUR SUPPLY QUOTATION', zh: '劳务供应服务报价单' };
const ADDR_VI = 'Tổ 11 Khu phố Lập Thành, Xã Dầu Giây, Tỉnh Đồng Nai';

const LEFT_LABELS: [string, string, string][] = [
  ['Khách hàng', 'Customer', '客户'], ['MST', 'Tax code', '税号'], ['Địa chỉ', 'Address', '地址'], ['Điện thoại', 'Tel', '电话'],
  ['Người liên hệ', 'Contact Person', '联系人'], ['Di động', 'Mobile', '手机'], ['Email', '', '邮箱'],
];
const RIGHT_LABELS: [string, string, string][] = [
  ['Ngày ban hành', 'Date Issued', '发布日期'], ['Ngày hiệu lực', 'Effective Date', '生效日期'], ['Số', 'No.', '编号'], ['Người phụ trách', 'Person in Charge', '负责人'],
  ['Chức vụ', 'Position', '职务'], ['Di động', 'Mobile', '手机'], ['Email', '', '邮箱'],
];

const SERVICE: [string, string, string][] = [
  ['- Cung ứng cho thuê lao động phổ thông, không cần kinh nghiệm.', '- Supplying unskilled labor for hire, no experience required:', '- 提供普通劳务派遣，无需工作经验:'],
  ['- Công việc.', '- Work:', '- 工作内容:'],
  ['- Thời gian làm việc.', '- Working time:', '- 工作时间:'],
  ['- Yêu cầu: Nam/ Nữ từ 18 đến 45 tuổi, sức khỏe tốt.', '- Male/ Female from 18 to 45 years old, good health:', '- 要求：男女， 年龄18至45岁，身体健康:'],
];

// [tên dòng VI, tên EN, tên ZH, đơn vị VI, đơn vị EN, đơn vị ZH, tỉ lệ (bản có cột %)]
const ROWS: [string, string, string, string, string, string, string][] = [
  ['Đơn giá lương cơ bản 8h/ngày', 'Basic salary 8 hours/day', '8小时/天基本工资', 'VNĐ/ngày', 'VND/day', '越南盾/天', '-'],
  ['Phụ cấp ca đêm', 'Night shift allowance', '夜班津贴', 'VNĐ/ngày', 'VND/ night-shift', '越南盾/夜班', '30%'],
  ['Lương làm thêm giờ vào ngày thường', 'Overtime pay on weekdays', '平日加班工资', 'VNĐ/ giờ', 'VND/ hours', '越南盾/小时', '150%'],
  ['Lương làm thêm giờ vào ban đêm ngày thường', 'Overtime pay on weekdays at night', '平日夜间加班工资', 'VNĐ/ giờ', 'VND/ hours', '越南盾/小时', '200%'],
  ['Lương làm thêm giờ vào ngày nghỉ hàng tuần', 'Overtime pay on weekly days off', '周休息日加班工资', 'VNĐ/ giờ', 'VND/ hours', '越南盾/小时', '200%'],
  ['Lương làm thêm giờ ban đêm ngày nghỉ hàng tuần', 'Overtime pay for working at night on weekly days off', '周休息日夜间加班工资', 'VNĐ/ giờ', 'VND/ hours', '越南盾/小时', '270%'],
  ['Lương làm thêm giờ vào ngày nghỉ lễ, tết', 'Overtime pay on holidays', '节假日加班工资', 'VNĐ/ giờ', 'VND/ hours', '越南盾/小时', '300%'],
  ['Lương làm thêm giờ ban đêm vào ngày nghỉ lễ, tết', 'Overtime pay for night work on public holidays and Tet holidays', '节假日夜间加班工资', 'VNĐ/ giờ', 'VND/ hours', '越南盾/小时', '390%'],
  ['BHXH', 'Social Insurance', '社会保险', 'VNĐ/tháng', 'VND/month', '越南盾/月', '-'],
  ['Phí dịch vụ', 'Service fee', '服务费', 'VNĐ/ngày', 'VND/day', '越南盾/天', '-'],
];

const NOTES: [string, string, string][] = [
  [' - Báo giá chưa bao gồm thuế VAT.', ' The quotation does not include VAT.', ' 报价不包含增值税（VAT）。'],
  [' - Báo giá chưa bao gồm tiền cơm và các khoản chi phí khác.', ' The quotation does not include meal allowances and other expenses.', ' 报价不包含餐费及其他费用。'],
  [' - Báo giá không bao gồm các yêu cầu phát sinh khác từ khách hàng.', ' The quotation does not cover additional requests from the client.', ' 报价不包含客户提出的其他额外要求。'],
  [' - Cách tính lương ca đêm, phụ cấp ca đêm, lương và tăng ca chủ nhật dựa trên quy định của Luật Việt Nam hiện hành.', ' How to calculate night shift wages, night shift allowances, Sunday wages and overtime based on current Vietnamese Law regulations.', '夜班工资、夜班津贴、周日工资及加班费的计算均依据越南现行法律规定。'],
];
const PAY_VI = 'Chốt công cuối tháng, hai bên đối chiếu bảng công và xuất hóa đơn chậm nhất ngày 5 hàng tháng. Thanh toán trong vòng 10 ngày kể từ ngày ra hóa đơn.';
const PAY2: Record<L, string> = {
  vi: '',
  en: 'At the end of the month, both parties will finalize the work hours, review the timesheet, and issue the invoice no later than the 5th of each month. Payment is to be made within 10 days from the invoice date.',
  zh: '每月月底结算工时，双方核对考勤表并最迟于每月5日开具发票。自开票之日起10日内完成付款。',
};
const THANKS = 'Xin chân thành cảm ơn và rất hân hạnh được phục vụ quý khách!';
const THANKS2: Record<L, string> = { vi: '', en: 'Looking forward your response. Thanks and best regards!', zh: '谨致以诚挚感谢，并非常荣幸为贵公司服务！' };
const CONFIRM: [string, string] = ['XÁC NHẬN CỦA KHÁCH HÀNG', ''];
const CONFIRM2: Record<L, string> = { vi: '', en: 'Customer Confirmation', zh: '客户确认' };
const SIGNER = 'NGUYỄN VĂN TUẤN';
const SIGNER2: Record<L, string> = { vi: '', en: '', zh: '阮文俊' };

// ── Dựng ──────────────────────────────────────────────────────────────────────────────────────
/** Cỡ chữ (pt) từng phần của 1 phiên bản. Tiêu đề, đầu mục và giá tiền to hơn chữ thường để dễ đọc, cân đối với bảng. */
interface Sizes { body: number; name: number; contact: number; title: number; title2: number; heading: number; thead: number; price: number; info: number }
interface Spec { lang: L; ratio: boolean; font: string; z: Sizes }

const SIZES: Record<'vi' | 'bi' | 'ratio', Sizes> = {
  vi: { body: 12, name: 17, contact: 12, title: 21, title2: 0, heading: 14, thead: 12.5, price: 14, info: 12 },
  bi: { body: 11, name: 16, contact: 11, title: 19, title2: 17, heading: 13, thead: 11.5, price: 13, info: 10.5 },
  ratio: { body: 11, name: 15, contact: 11, title: 18, title2: 0, heading: 13, thead: 11.5, price: 13, info: 11 },
};

export async function buildLetsgoTemplate(): Promise<ArrayBuffer> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Let's Go VN";
  const logo = wb.addImage({ base64: `data:image/png;base64,${LETSGO_LOGO_B64}`, extension: 'png' });
  sheet(wb, logo, 'Tiếng Việt', { lang: 'vi', ratio: false, font: 'Times New Roman', z: SIZES.vi });
  sheet(wb, logo, 'Anh - Việt', { lang: 'en', ratio: false, font: 'Times New Roman', z: SIZES.bi });
  sheet(wb, logo, 'Trung - Việt', { lang: 'zh', ratio: false, font: 'Times New Roman', z: SIZES.bi });
  sheet(wb, logo, 'Có tỉ lệ (%)', { lang: 'vi', ratio: true, font: 'Arial', z: SIZES.ratio });
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

/** Chiều cao dòng (pt) cho `lines` dòng chữ cỡ `size`. */
const hp = (size: number, lines = 1) => Math.round((size * 1.3 * lines + 5) * 10) / 10;
const colPxOf = (w: number) => w * 7 + 5;
/** Ước lượng số dòng khi chữ cỡ `size` xuống dòng trong bề ngang `px` (chữ Hán rộng gấp ~2 chữ Latin). */
function nLines(text: string, size: number, px: number): number {
  const em = size * 1.333;
  return text.split('\n').reduce((a, ln) => {
    const w = [...ln].reduce((s, ch) => s + (/[\u3000-\u9fff\uff00-\uffef]/.test(ch) ? 1 : 0.47), 0) * em;
    return a + Math.max(1, Math.ceil(w / Math.max(40, px - 10)));
  }, 0);
}

function sheet(wb: Workbook, logo: number, name: string, sp: Spec) {
  const ws = wb.addWorksheet(name, { views: [{ showGridLines: false }] });
  const { lang, ratio, z } = sp;
  const bi = lang !== 'vi';
  const lastCol = ratio ? 5 : 4;                               // A..D (hoặc A..E khi có cột tỉ lệ)
  // Bản song ngữ: cột nhãn rộng hơn để "Khách hàng / Customer" nằm TRỌN 1 dòng (dịch cạnh tiếng Việt, ngăn bằng dấu "/")
  const widths = ratio ? [15, 64, 22, 11, 24] : bi ? [25, 49, 31, 23] : [15, 66, 21, 26];
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  const totalPx = widths.reduce((a, w) => a + colPxOf(w), 0);
  ws.pageSetup = { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 1, margins: { left: 0.45, right: 0.45, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 } };

  let r = 1;
  const font = (o: { b?: boolean; i?: boolean; g?: boolean; size?: number } = {}) => ({ name: sp.font, size: o.size ?? z.body, bold: !!o.b, italic: !!o.i, color: { argb: o.g ? GREEN : NAVY } });
  const rich = (rs: Run[], size?: number) => ({ richText: rs.map(x => ({ text: x.t, font: font({ b: x.b, i: x.i, g: x.g, size }) })) });
  const merge = (r1: number, c1: number, r2: number, c2: number) => { if (r1 !== r2 || c1 !== c2) ws.mergeCells(r1, c1, r2, c2); };
  const put = (cell: Cell, rs: Run[], al: Partial<import('exceljs').Alignment> = {}, size?: number) => {
    cell.value = rs.length === 1 && !rs[0].i && !rs[0].b && !rs[0].g ? { richText: [{ text: rs[0].t, font: font({ size }) }] } : rich(rs, size);
    cell.font = font({ size });                                  // cỡ chữ gốc của ô (các đoạn rich text ghi đè kiểu)
    cell.alignment = { vertical: 'middle', ...al };
  };
  const edge = (r1: number, c1: number, r2: number, c2: number) => {                       // viền ngoài của 1 vùng
    const t = { style: 'thin' as const, color: { argb: 'FF000000' } };
    for (let rr = r1; rr <= r2; rr++) for (let cc = c1; cc <= c2; cc++) {
      const b: Partial<import('exceljs').Borders> = {};
      if (rr === r1) b.top = t; if (rr === r2) b.bottom = t; if (cc === c1) b.left = t; if (cc === c2) b.right = t;
      const cell = ws.getCell(rr, cc); cell.border = { ...cell.border, ...b };
    }
  };
  const grid = (r1: number, c1: number, r2: number, c2: number) => { for (let rr = r1; rr <= r2; rr++) for (let cc = c1; cc <= c2; cc++) edge(rr, cc, rr, cc); };
  const row = (h: number) => { ws.getRow(r).height = h; return r++; };
  const text = (rs: Run[]) => rs.map(x => x.t).join('');

  // ── Đầu thư: logo + tên công ty + liên hệ ──
  const indent = lang === 'vi' ? 10 : 1;
  const head = (rs: Run[], size: number, lines = 1) => { const rr = row(hp(size, lines) - 2); merge(rr, 2, rr, lastCol); put(ws.getCell(rr, 2), rs, { horizontal: 'left', indent }, size); };
  const c = z.contact;
  if (lang === 'vi') {
    head([{ t: NAME, b: true, g: true }], z.name);
    head([{ t: 'Địa chỉ: ', b: true }, { t: `464 ${ADDR_VI}` }], c);
    head([{ t: 'Hotline (24/7): ', b: true }, { t: '092 642 38 38' }], c);
    head([{ t: 'Email: ', b: true }, { t: 'kinhdoanh@vieclamletsgo.com' }], c);
    head([{ t: 'Website: ', b: true }, { t: 'vieclamletsgo.com' }], c);
  } else {
    head([{ t: NAME, b: true, g: true }], z.name);
    head([{ t: NAME2[lang], b: true, i: true, g: true }], z.name - 1);
    head([{ t: 'Địa chỉ: ', b: true }, { t: `464 ${ADDR_VI}` }], c);
    head(lang === 'en'
      ? [{ t: 'Address: ', b: true, i: true }, { t: ' 464 Group 11 Lap Thanh Quarter, Dau Giay Commune, Dong Nai Province', i: true }]
      : [{ t: '地址： ', b: true, i: true }, { t: '越南同奈省油溪社立成坊第11组464号', b: true, i: true }], c);
    if (lang === 'en') head([{ t: 'Hotline (24/7): ', b: true }, { t: '092 642 38 38' }], c);
    else head([{ t: '热线电话（24/7）：', b: true }, { t: '092 642 38 38' }], c);
    head([{ t: lang === 'zh' ? '邮箱: ' : 'Email: ', b: true }, { t: 'kinhdoanh@vieclamletsgo.com' }], c);
    head([{ t: lang === 'zh' ? '网站: ' : 'Website: ', b: true }, { t: 'vieclamletsgo.com' }], c);
  }
  // Logo: góc trên-trái, neo theo ô
  ws.addImage(logo, { tl: { nativeCol: 0, nativeColOff: (lang === 'vi' ? 24 : 6) * px2emu, nativeRow: 0, nativeRowOff: 8 * px2emu } as never, ext: lang === 'vi' ? { width: 132, height: 88 } : { width: 150, height: 100 }, editAs: 'oneCell' });

  // Tiêu đề (to nhất trang)
  const tr = row(hp(z.title)); merge(tr, 1, tr, lastCol);
  put(ws.getCell(tr, 1), [{ t: TITLE, b: true, g: true }], { horizontal: 'center' }, z.title);
  if (bi) { const t2 = row(hp(z.title2)); merge(t2, 1, t2, lastCol); put(ws.getCell(t2, 1), [{ t: TITLE2[lang], b: true, i: true, g: true }], { horizontal: 'center' }, z.title2); }

  // ── Bảng thông tin khách / báo giá (viền đủ). Bản song ngữ: "Việt / dịch" trên 1 dòng → bảng thấp lại, dành chỗ cho nội dung bên dưới ──
  const info0 = r;
  const lbl = (a: [string, string, string]): Run[] => {
    const tr2 = lang === 'en' ? a[1] : lang === 'zh' ? a[2] : '';
    return tr2 ? [{ t: a[0] }, { t: ` / ${tr2}`, i: true, b: lang === 'zh' }] : [{ t: a[0] }];
  };
  LEFT_LABELS.forEach((lab, i) => {
    const rr = row(hp(z.info) + 3);
    put(ws.getCell(rr, 1), lbl(lab), { horizontal: 'left', wrapText: true }, z.info);
    put(ws.getCell(rr, 3), lbl(RIGHT_LABELS[i]), { horizontal: 'left', wrapText: true }, z.info);
    if (ratio) merge(rr, 4, rr, 5);                              // bản có cột tỉ lệ: ô giá trị bên phải gộp D:E
    for (const col of [2, lastCol === 5 ? 4 : 4]) { const v = ws.getCell(rr, col); v.font = font({ size: z.info }); v.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true }; }
  });
  grid(info0, 1, r - 1, lastCol);
  if (ratio) for (let rr = info0; rr < r; rr++) { const cc = ws.getCell(rr, 5); cc.border = { ...cc.border, right: { style: 'thin', color: { argb: 'FF000000' } } }; }

  row(8);

  // ── 1. Dịch vụ cung cấp ──
  const s0 = r;
  const line = (rs: Run[], size: number, al: Partial<import('exceljs').Alignment> = {}, minLines = 1) => {
    const lines = Math.max(minLines, nLines(text(rs), size, totalPx));
    const rr = row(hp(size, lines) - 2); merge(rr, 1, rr, lastCol); put(ws.getCell(rr, 1), rs, { horizontal: 'left', wrapText: true, ...al }, size); return rr;
  };
  const bold = (a: string, b2?: string): Run[] => (bi && b2 ? [{ t: a, b: true }, { t: b2, b: true, i: true }] : [{ t: a, b: true }]);
  line(bold('1. Dịch vụ cung cấp', bi ? (lang === 'en' ? '/ Content Services' : '/ 服务内容') : undefined), z.heading);
  for (const sv of SERVICE) line(bi ? [{ t: sv[0] + '/ ' }, { t: sv[lang === 'en' ? 1 : 2].replace(/^- /, ''), i: true, b: lang === 'zh' }] : [{ t: sv[0] }], z.body);
  edge(s0, 1, r - 1, lastCol);
  const sb = row(hp(z.heading) + 2); merge(sb, 1, sb, lastCol);
  put(ws.getCell(sb, 1), bold('2. Bảng giá dịch vụ', bi ? (lang === 'en' ? '/ Quotation' : '/ 服务价格表') : undefined), { horizontal: 'left' }, z.heading);
  edge(sb, 1, sb, lastCol);

  // ── Bảng giá ──
  const heads: [string, string, string][] = [
    ['STT', '', '序号'], ['Nội dung đơn giá', 'Unit price description', '单价内容'], ['Đơn vị tính', 'Unit of measure', '计量单位'], ['Đơn giá (VNĐ)', 'Unit price (VND)', '单价（越南盾）'],
  ];
  const hr = row(hp(z.thead, bi ? 2 : 1) + 1);
  const hcols = ratio ? [1, 2, 3, 5] : [1, 2, 3, 4];
  heads.forEach((h, i) => {
    const sec = lang === 'en' ? h[1] : lang === 'zh' ? h[2] : '';
    put(ws.getCell(hr, hcols[i]), sec ? [{ t: h[0], b: true }, { t: `\n${sec}`, i: true }] : [{ t: h[0], b: true }], { horizontal: 'center', wrapText: true }, z.thead);
  });
  if (ratio) put(ws.getCell(hr, 4), [{ t: 'Tỉ lệ (%)', b: true }], { horizontal: 'center', wrapText: true }, z.thead);
  for (let cc = 1; cc <= lastCol; cc++) ws.getCell(hr, cc).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEAD } };
  const t0 = hr;
  ROWS.forEach((rw, i) => {
    const sec = lang === 'en' ? rw[1] : lang === 'zh' ? rw[2] : '';
    const lines = bi ? nLines(rw[0], z.body, colPxOf(widths[1])) + nLines(sec, z.body, colPxOf(widths[1])) : nLines(rw[0], z.body, colPxOf(widths[1]));
    const rr = row(Math.max(hp(z.price), hp(z.body, lines)));
    put(ws.getCell(rr, 1), [{ t: String(i + 1) }], { horizontal: 'center' });
    put(ws.getCell(rr, 2), bi ? [{ t: rw[0] }, { t: `\n${sec}`, i: true, b: lang === 'zh' }] : [{ t: rw[0] }], { horizontal: 'left', wrapText: true });
    put(ws.getCell(rr, 3), bi ? [{ t: rw[3] }, { t: `\n${lang === 'en' ? rw[4] : rw[5]}`, i: true, b: lang === 'zh' }] : [{ t: rw[3] }], { horizontal: 'center', wrapText: true });
    if (ratio) put(ws.getCell(rr, 4), [{ t: rw[6] }], { horizontal: 'center' });
    const price = ws.getCell(rr, hcols[3]);
    price.numFmt = '#,##0'; price.font = font({ b: true, size: z.price }); price.alignment = { horizontal: 'right', vertical: 'middle' };   // giá tiền to, đậm
  });
  grid(t0, 1, r - 1, lastCol);

  // ── Ghi chú ──
  line(bold('Ghi chú:', bi ? (lang === 'en' ? '/ Note:' : '/ 备注：') : undefined), z.heading);
  NOTES.forEach((n, i) => {
    const long = i === 3;
    const rs: Run[] = bi ? [{ t: n[0] + '/' }, { t: (lang === 'en' ? n[1] : (long ? `\n${n[2]}` : n[2])), i: true, b: lang === 'zh' }] : [{ t: n[0] }];
    line(rs, z.body);
  });
  row(8);

  // ── 3. Phương thức thanh toán ──
  line(bold('3. Phương thức thanh toán', bi ? (lang === 'en' ? '/ Payment term' : '/ 付款方式') : undefined), z.heading);
  line(bi ? [{ t: PAY_VI }, { t: `\n${PAY2[lang]}`, i: true, b: lang === 'zh' }] : [{ t: PAY_VI }], z.body, { vertical: 'top' });
  row(5);
  line(bi ? [{ t: THANKS + '/ ', g: true }, { t: THANKS2[lang], i: true, g: true }] : [{ t: THANKS, g: true }], z.body);
  row(6);

  // ── Chữ ký: trái = khách xác nhận, phải = công ty; chỗ ký + đóng dấu là các dòng trống phía trên tên người ký ──
  const half = 3;                                                // khối phải (công ty) bắt đầu ở cột C
  const sg = row(hp(z.heading, bi ? 2 : 1));
  merge(sg, 1, sg, 2); merge(sg, half, sg, lastCol);
  put(ws.getCell(sg, 1), bi ? [{ t: CONFIRM[0], b: true }, { t: `\n${CONFIRM2[lang]}`, b: true, i: true }] : [{ t: CONFIRM[0], b: true }], { horizontal: 'center', wrapText: true }, z.heading);
  put(ws.getCell(sg, half), bi ? [{ t: NAME, b: true }, { t: `\n${NAME2[lang]}`, b: true, i: true }] : [{ t: NAME, b: true }], { horizontal: 'center', wrapText: true }, z.heading);
  for (let k = 0; k < 5; k++) row(21);
  const nm = row(hp(z.heading, SIGNER2[lang] ? 2 : 1));
  merge(nm, half, nm, lastCol);
  put(ws.getCell(nm, half), SIGNER2[lang] ? [{ t: SIGNER, b: true }, { t: `\n${SIGNER2[lang]}`, b: true, i: true }] : [{ t: SIGNER, b: true }], { horizontal: 'center', wrapText: true }, z.heading);

  ws.pageSetup.printArea = `A1:${String.fromCharCode(64 + lastCol)}${nm}`;
  return ws as Worksheet;
}
