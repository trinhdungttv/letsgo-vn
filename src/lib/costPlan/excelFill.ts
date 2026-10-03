// Phương án giá — ĐIỀN SỐ VÀO FILE EXCEL MẪU CỦA NGƯỜI DÙNG (giữ nguyên định dạng, viền, ô gộp, logo của file mẫu).
//
// Hai cách nhận diện — dùng được CÙNG LÚC trong một file:
//  1) TỰ NHẬN DIỆN BẢNG GIÁ: tìm ô tiêu đề "Đơn giá…", đọc nhãn từng dòng bên dưới ("Lương ngày làm việc 8 tiếng",
//     "Lương tăng ca ngày chủ nhật 1 tiếng ca đêm"…), ghi giá vào đúng ô Đơn giá của dòng đó. Không cần sửa file.
//  2) Ô ĐÁNH DẤU {{tên}} ở bất kỳ đâu (vd {{ten_khach}}, {{gia_ngay}}, {{ot_cn_dem}}) — thay bằng giá trị tương ứng.
//  3) Ô THÔNG TIN KHÁCH đứng cạnh nhãn ("Khách hàng", "MST", "Ngày ban hành", "Người phụ trách"… hoặc Customer / Tax code / 客户…):
//     nếu ô bên phải nhãn còn TRỐNG thì điền thông tin tương ứng — file mẫu không cần gõ {{...}}.
// Chỉ GHI giá/chữ vào ô; không đụng tới ô có công thức. Giá vốn tổng hợp và lợi nhuận không bao giờ ra file; riêng BHXH và Phí dịch vụ chỉ
// được ghi khi file mẫu CÓ dòng đó (mẫu báo giá của công ty liệt kê hai dòng này cho khách).
import { computePriceList, defaultQuoteSheet, includedNoteAuto, normalizeQuoteSheet } from './quoteSheet';
import { normalizePlanData } from './engine';
import { NORM_NIGHT } from '../payroll/coefficients';
import { normalizeText } from './presets';
import type { PlanData, PlanResult, QuoteRowKind } from './types';
import { DEFAULT_LAYOUT, containIn, pngSize, stampBoxes, type QuoteEntity, type Rect, type StampLayout } from './entity';
import { dateLong, dateShort, normalizeDoc, type DocLang, type QuoteDoc } from './quoteDoc';

/** Dòng giá của bảng gửi khách. `base/night_allow/bhxh/service_fee` dành cho kiểu báo giá TÁCH KHOẢN (lương cơ bản + phụ cấp + BHXH + phí dịch vụ). */
/** Font chuẩn của MỌI ô do hệ thống điền vào (giá, thông tin khách, ô đánh dấu). */
export const FILL_FONT = 'Times New Roman';

type PriceKind = Exclude<QuoteRowKind, 'custom'> | 'base' | 'night_allow' | 'bhxh' | 'service_fee';

/**
 * Đoán dòng giá thuộc loại nào từ nhãn — hiểu cả tiếng Việt, tiếng Anh và tiếng Trung (nhãn song ngữ thì các ngôn ngữ cùng góp tín hiệu).
 * null = không nhận ra.
 */
export function classifyLabel(raw: string): PriceKind | null {
  const t = ` ${normalizeText(raw).replace(/[^a-z0-9]+/g, ' ')} `;
  const has = (...ws: string[]) => ws.some(w => t.includes(` ${w} `));
  const cjk = (re: RegExp) => re.test(raw);
  const en = (re: RegExp) => re.test(` ${raw.toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `);

  const ot = (has('tang') && has('ca')) || has('lam them gio') || en(/ (overtime|over time|ot) /) || cjk(/加班/);
  const night = t.includes(' ca dem ') || t.includes(' ban dem ') || t.includes(' lam dem ') || has('dem') || en(/ (night|nights) /) || cjk(/夜/);
  const sunday = t.includes(' chu nhat ') || has('nghi hang tuan') || en(/ (sunday|sundays|weekly days? off|weekly rest days?) /) || cjk(/周日|星期日|星期天|礼拜天|週日|周休息日|周休|休息日/);
  // "lễ" (ngày lễ) và "Lê" (họ người) bỏ dấu giống hệt nhau → phải xét CÓ DẤU trên chữ gốc; chỉ khi file viết không dấu mới dựa vào cụm "ngày lễ"/"tết"
  const words = raw.toLowerCase().normalize('NFC').split(/[^\p{L}\p{N}]+/u);
  const holiday = words.includes('lễ') || words.includes('tết') || has('tet') || t.includes(' ngay le ') || en(/ (holiday|holidays|tet|public holiday) /) || cjk(/节假日|法定假日|节日|春节|假日|節假日/);
  if (ot) {
    if (holiday) return night ? 'ot_hol_night' : 'ot_hol';
    if (sunday) return night ? 'ot_sun_night' : 'ot_sun';
    return night ? 'ot_night' : 'ot_day';
  }
  // Các khoản của kiểu báo giá tách khoản
  if (has('bhxh') || has('bao hiem xa hoi') || en(/ social (insurance|security) /) || cjk(/社会保险|社會保險|社保/)) return 'bhxh';
  if (has('phi dich vu') || en(/ service (fee|fees|charge|charges) /) || cjk(/服务费|服務費/)) return 'service_fee';
  if ((has('phu cap') || en(/ allowances? /) || cjk(/津贴|津貼|补贴|補貼/)) && night) return 'night_allow';
  const wage = has('luong') || en(/ (wage|wages|salary|daily rate|day rate|rate) /) || cjk(/工资|工資|薪/);
  if (wage && (has('co ban') || en(/ (basic|base) /) || cjk(/基本/))) return 'base';
  const day = has('ngay') || t.includes(' 8 tieng ') || en(/ (daily|day|8 hours|8 hour|8h|8 hrs|8 hr) /) || cjk(/工作日|8小时|8小時/);
  if (wage && day) return night ? 'night8' : 'day8';
  return null;
}

export const FILL_TOKENS: { token: string; desc: string }[] = [
  { token: 'luong_co_ban', desc: 'Lương cơ bản 8h/ngày' }, { token: 'phu_cap_dem', desc: 'Phụ cấp ca đêm (30% lương cơ bản)' },
  { token: 'bhxh', desc: 'BHXH / tháng' }, { token: 'phi_dv', desc: 'Phí dịch vụ / ngày' },
  { token: 'gia_ngay', desc: 'Giá ngày 8 tiếng' }, { token: 'gia_dem', desc: 'Giá ngày 8 tiếng ca đêm' },
  { token: 'ot_ngay', desc: 'Tăng ca ngày 1 giờ' }, { token: 'ot_dem', desc: 'Tăng ca đêm 1 giờ' },
  { token: 'ot_cn', desc: 'Tăng ca Chủ nhật 1 giờ' }, { token: 'ot_cn_dem', desc: 'Tăng ca Chủ nhật đêm 1 giờ' },
  { token: 'ot_le', desc: 'Tăng ca lễ/Tết 1 giờ' }, { token: 'ot_le_dem', desc: 'Tăng ca lễ/Tết đêm 1 giờ' },
  { token: 'ten_khach', desc: 'Tên khách hàng' }, { token: 'nganh', desc: 'Ngành nghề' }, { token: 'kcn', desc: 'KCN / vùng' },
  { token: 'ngay_bao_gia', desc: 'Ngày báo giá (dd/mm/yyyy)' }, { token: 'bao_gom', desc: 'Ghi chú "Bao gồm: …"' }, { token: 'luu_y', desc: 'Lưu ý chung' },
  { token: 'so_bao_gia', desc: 'Số báo giá' }, { token: 'hieu_luc', desc: 'Hiệu lực đến (dd/mm/yyyy)' },
  { token: 'di_dong_khach', desc: 'Di động người liên hệ (khách)' }, { token: 'email_khach', desc: 'Email khách' },
  { token: 'nguoi_phu_trach', desc: 'Người phụ trách (bên mình)' }, { token: 'chuc_vu_nv', desc: 'Chức vụ người phụ trách' },
  { token: 'di_dong_nv', desc: 'Di động người phụ trách' }, { token: 'email_nv', desc: 'Email người phụ trách' },
  { token: 'dia_chi_khach', desc: 'Địa chỉ khách' }, { token: 'mst_khach', desc: 'Mã số thuế khách' }, { token: 'nguoi_nhan', desc: 'Người nhận (khách)' }, { token: 'sdt_khach', desc: 'Điện thoại khách' },
  { token: 'cong_ty', desc: 'Tên pháp nhân gửi báo giá' }, { token: 'dia_chi_cty', desc: 'Địa chỉ pháp nhân' }, { token: 'mst_cty', desc: 'MST pháp nhân' },
  { token: 'dien_thoai_cty', desc: 'Điện thoại pháp nhân' }, { token: 'email_cty', desc: 'Email pháp nhân' }, { token: 'website_cty', desc: 'Website pháp nhân' },
  { token: 'nguoi_dai_dien', desc: 'Họ tên người đại diện' }, { token: 'chuc_danh', desc: 'Chức danh người đại diện' }, { token: 'noi_ky', desc: 'Nơi ký' },
  { token: 'ngay_ky', desc: 'Nơi ký + ngày ký (tiếng Việt)' }, { token: 'ngay_ky_zh', desc: 'Nơi ký + ngày ký (tiếng Trung)' }, { token: 'ngay_ky_en', desc: 'Nơi ký + ngày ký (tiếng Anh)' },
  { token: 'chu_ky', desc: 'ẢNH chữ ký — đặt ở ô muốn chèn' }, { token: 'con_dau', desc: 'ẢNH con dấu — đặt ở ô muốn chèn' }, { token: 'logo', desc: 'ẢNH logo — đặt ở ô muốn chèn' },
];
type ImageToken = 'chu_ky' | 'con_dau' | 'logo';
const TOKEN_KIND: Record<string, PriceKind> = {
  luong_co_ban: 'base', phu_cap_dem: 'night_allow', bhxh: 'bhxh', phi_dv: 'service_fee',
  gia_ngay: 'day8', gia_dem: 'night8', ot_ngay: 'ot_day', ot_dem: 'ot_night', ot_cn: 'ot_sun', ot_cn_dem: 'ot_sun_night', ot_le: 'ot_hol', ot_le_dem: 'ot_hol_night',
};

export interface FillImage { dataUrl: string }
export interface FillValues {
  prices: Partial<Record<PriceKind, number>>;
  text: Record<string, string>;
  /** Ảnh cần chèn (chỉ điền những ảnh người dùng đã BẬT; thiếu = không chèn) */
  images?: { signature?: FillImage | null; seal?: FillImage | null; logo?: FillImage | null };
  layout?: StampLayout;
  /** Sửa chữ trực tiếp: khoá `<sheet>!<ô>` → nội dung từng đoạn chữ của ô (áp SAU CÙNG nên thắng mọi giá trị tự điền) */
  edits?: Record<string, string[]>;
}

export function buildFillValues(
  data: PlanData, result: PlanResult,
  meta: { company?: string | null; industry?: string | null; zone?: string | null; today?: Date },
  extra: {
    entity?: QuoteEntity | null; doc?: QuoteDoc | null;
    /** Bật/tắt từng loại ảnh (mặc định tắt) */
    use?: { signature?: boolean; seal?: boolean; logo?: boolean };
  } = {},
): FillValues {
  const list = computePriceList(data, result);
  const q = normalizeQuoteSheet(data.quote ?? defaultQuoteSheet());
  const prices: FillValues['prices'] = {};
  for (const r of list.rows) if (r.kind !== 'custom') prices[r.kind] = r.price;
  // Kiểu báo giá tách khoản: lương cơ bản + phụ cấp đêm (+30%) + BHXH/tháng + phí dịch vụ/ngày (chỉ ghi khi file mẫu có dòng đó)
  prices.base = Math.round(result.baseWageDaily);
  prices.night_allow = Math.round(list.otBaseDaily * (NORM_NIGHT - 1));
  const bh = normalizePlanData(data).lines.filter(l => /\bbhxh\b|bao hiem xa hoi/.test(normalizeText(l.name)));
  if (bh.length) prices.bhxh = Math.round(bh.reduce((a, l) => a + (result.lines[l.id]?.monthly ?? 0), 0));
  if (result.serviceFeeDaily > 0) prices.service_fee = Math.round(result.serviceFeeDaily);
  const d = meta.today ?? new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const doc = normalizeDoc(extra.doc ?? data.doc);
  const ent = extra.entity?.data;
  const cus = doc?.customer;
  const iso = doc?.date || `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const place = ((doc?.place ?? ent?.place) ?? '').trim();
  const signLine = (lang: DocLang) => { const b = dateLong(lang, iso); const t = lang === 'zh' ? (b.b ?? b.a) : b.a; return place ? `${place}${lang === 'zh' ? '，' : ', '}${t}` : t; };
  const use = extra.use ?? {};
  return {
    prices,
    text: {
      ten_khach: cus?.name?.trim() || meta.company || '', nganh: meta.industry ?? '', kcn: meta.zone ?? '',
      dia_chi_khach: cus?.address ?? '', mst_khach: cus?.taxCode ?? '', nguoi_nhan: cus?.attn ?? '', sdt_khach: cus?.phone ?? '',
      di_dong_khach: cus?.mobile ?? '', email_khach: cus?.email ?? '',
      nguoi_phu_trach: doc?.seller.name ?? '', chuc_vu_nv: doc?.seller.title ?? '', di_dong_nv: doc?.seller.mobile ?? '', email_nv: doc?.seller.email ?? '',
      ngay_bao_gia: dateShort(iso) || `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`,
      so_bao_gia: doc?.number ?? '', hieu_luc: doc?.validUntil ? dateShort(doc.validUntil) : '',
      bao_gom: q.includedNote ?? includedNoteAuto(data), luu_y: q.generalNotes,
      cong_ty: ent?.name ?? '', dia_chi_cty: ent?.address ?? '', mst_cty: ent?.taxCode ?? '', dien_thoai_cty: ent?.phone ?? '', email_cty: ent?.email ?? '', website_cty: ent?.website ?? '',
      nguoi_dai_dien: (doc?.signerName ?? ent?.signerName ?? '').trim(), chuc_danh: (doc?.signerTitle ?? ent?.signerTitle ?? '').trim(), noi_ky: place,
      ngay_ky: signLine('vi'), ngay_ky_zh: signLine('zh'), ngay_ky_en: signLine('en'),
    },
    images: {
      signature: use.signature && extra.entity?.signature ? { dataUrl: extra.entity.signature } : null,
      seal: use.seal && extra.entity?.seal ? { dataUrl: extra.entity.seal } : null,
      logo: use.logo && extra.entity?.logo ? { dataUrl: extra.entity.logo } : null,
    },
    layout: extra.entity?.layout ?? DEFAULT_LAYOUT,
  };
}

export interface FillReport {
  /** Các ô giá đã điền tự động theo nhãn dòng */
  rows: { sheet: string; cell: string; label: string; kind: PriceKind; value: number }[];
  /** Số ô {{...}} đã thay */
  tokens: number;
  /** Số ô thông tin đã điền cạnh nhãn (Khách hàng, MST, Ngày ban hành…) */
  fields: number;
  /** Số ô đã áp nội dung người dùng sửa tay */
  edited: number;
  /** Dòng có giá nhưng không nhận ra nhãn / ô có công thức → để nguyên */
  skipped: string[];
  /** Có tìm thấy ô tiêu đề "Đơn giá" không */
  foundTable: boolean;
  /** Ảnh đã chèn: ở đâu, theo cách nào */
  images: { what: 'chữ ký' | 'con dấu' | 'logo'; where: string; mode: 'ô đánh dấu' | 'tự tìm khối ký' }[];
  /** Cảnh báo về vị trí ảnh (thiếu chỗ trống, không tìm thấy khối ký…) */
  imageWarnings: string[];
}

const TOKEN_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
const vnd = (n: number) => Math.round(n).toLocaleString('vi-VN');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cellText = (v: any): string => {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (v instanceof Date) return '';
  if (Array.isArray(v.richText)) return v.richText.map((r: { text: string }) => r.text).join('');
  if (typeof v.text === 'string') return v.text;
  if (v.result != null && typeof v.result !== 'object') return String(v.result);
  return '';
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const hasFormula = (v: any) => !!v && typeof v === 'object' && ('formula' in v || 'sharedFormula' in v);



/** Ô tiêu đề của cột giá: "Đơn giá" (Việt) / "Unit price" (Anh) / "单价" (Trung). */
const isPriceText = (raw: string) => { const n = normalizeText(raw); return n.includes('don gia') || n.includes('unit price') || /单价|單價/.test(raw); };
const isOtherHeaderText = (raw: string) => { const n = normalizeText(raw); return n.includes('noi dung') || n.includes('description') || n.includes('don vi') || n.includes('unit of measure') || n.includes('stt') || /内容|內容|单位|單位|序号|序號/.test(raw); };
/**
 * Các ô tiêu đề cột giá. Loại: cột "Nội dung đơn giá"/"Đơn vị tính", và các NHÃN DÒNG có chữ "Đơn giá" như "Đơn giá lương cơ bản 8h/ngày"
 * (nhãn dòng nhận ra được là khoản giá, hoặc có chữ lương/phụ cấp/phí). Nếu có hàng tiêu đề thật (cùng hàng có STT / Nội dung / Đơn vị) thì chỉ lấy hàng đó.
 */
export function findPriceHeaders(ws: import('exceljs').Worksheet): { row: number; col: number }[] {
  const all: { row: number; col: number; real: boolean }[] = [];
  ws.eachRow({ includeEmpty: false }, (row, r) => {
    const cells: { c: number; raw: string }[] = [];
    row.eachCell({ includeEmpty: false }, (cell, c) => { if (cell.isMerged && cell.master !== cell) return; const raw = cellText(cell.value); if (raw) cells.push({ c, raw }); });
    const real = cells.some(x => isOtherHeaderText(x.raw));
    for (const { c, raw } of cells) {
      const n = normalizeText(raw);
      if (n.length >= 90 || !isPriceText(raw) || isOtherHeaderText(raw)) continue;
      if (classifyLabel(raw) || /luong|phu cap|phi |bhxh/.test(`${n} `)) continue;        // nhãn dòng, không phải tiêu đề cột
      all.push({ row: r, col: c, real });
    }
  });
  const real = all.filter(h => h.real);
  return (real.length ? real : all).map(({ row, col }) => ({ row, col }));
}

/**
 * Các dòng của bảng giá bên dưới 1 ô tiêu đề cột giá. Dừng khi hết bảng: dòng trống, dòng gộp ngang qua cột giá (đoạn "Ghi chú…", "Phương thức thanh toán…"),
 * hoặc dòng chỉ có 1 ô chữ dài (đoạn văn không gộp ô). Nhờ vậy câu ghi chú nằm sát dưới bảng không bị nhầm thành dòng giá.
 */
function* tableRows(ws: import('exceljs').Worksheet, h: { row: number; col: number }) {
  for (let r = h.row + 1; r <= Math.min(ws.rowCount, h.row + 60); r++) {
    const row = ws.getRow(r);
    const priceCell = row.getCell(h.col);
    if (priceCell.isMerged && (priceCell.master.fullAddress.col !== h.col || priceCell.master.fullAddress.row !== r)) return;
    const labels: string[] = [];
    let any = false, own = 0, longest = 0;
    row.eachCell({ includeEmpty: false }, (cell, c) => {
      any = true;
      const t = cellText(cell.value);
      if (!(cell.isMerged && cell.master !== cell) && (t || typeof cell.value === 'number')) { own++; longest = Math.max(longest, t.length); }
      if (c !== h.col) { if (t && !/^\d+$/.test(t.trim())) labels.push(t); }
    });
    if (!any) return;
    if (own < 2 && longest > 60) return;
    yield { r, label: labels.join(' '), priceCell };
  }
}

/** Font của ô (ô nhiều kiểu chữ thì lấy đoạn đầu). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function cell0Font(cell: import('exceljs').Cell): { size?: number; color?: any } {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const v: any = cell.isMerged ? cell.master.value : cell.value;
  const f = (cell.font ?? (v && Array.isArray(v.richText) ? v.richText[0]?.font : undefined)) ?? {};
  return { size: f.size, color: f.color };
}

/** Áp nội dung người dùng sửa tay cho 1 sheet. Ô có công thức bị bỏ qua; ô nhiều kiểu chữ giữ kiểu từng đoạn. */
function applyCellEdits(ws: WS, edits: Record<string, string[]> | undefined, report?: FillReport, opts: { skipEmpty?: boolean } = {}): string[] {
  const applied: string[] = [];
  if (!edits) return applied;
  const prefix = `${ws.name}!`;
  for (const [key, texts] of Object.entries(edits)) {
    if (!key.startsWith(prefix) || !texts.length) continue;
    const addr = key.slice(prefix.length);
    if (!/^[A-Z]{1,3}\d{1,5}$/.test(addr)) continue;
    const cell = ws.getCell(addr);
    const master = cell.isMerged ? cell.master : cell;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v: any = master.value;
    if (hasFormula(v)) continue;
    if (opts.skipEmpty && cellText(v).trim() === '' && typeof v !== 'number') continue;        // ô trống của mẫu (chỗ điền) không ghi cứng vào mẫu
    if (v && typeof v === 'object' && Array.isArray(v.richText) && v.richText.length) {
      const runs = v.richText as { text: string }[];
      master.value = { richText: runs.map((r, i) => ({ ...r, text: i === runs.length - 1 ? texts.slice(i).join('\n') : texts[i] ?? r.text })) } as never;
    } else if (typeof v === 'number') {
      const n = Number(texts.join('').replace(/\./g, '').replace(',', '.').trim());
      master.value = Number.isFinite(n) && texts.join('').trim() !== '' ? n : texts.join('\n');
    } else {
      master.value = texts.join('\n');
    }
    applied.push(key);
    if (report) report.edited++;
  }
  return applied;
}

/** Ghi các sửa đổi thẳng vào file mẫu (để lưu lại làm mẫu mới, dùng cho mọi báo giá sau). */
export async function applyEditsToTemplate(buf: ArrayBuffer, edits: Record<string, string[]>): Promise<{ output: ArrayBuffer; applied: string[] }> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const applied: string[] = [];
  wb.eachSheet(ws => { applied.push(...applyCellEdits(ws, edits, undefined, { skipEmpty: true })); });
  return { output: (await wb.xlsx.writeBuffer()) as ArrayBuffer, applied };
}

// ── Ô thông tin cạnh nhãn ("Khách hàng | ........") ──────────────────────────────────────────────
const FIELD_LABELS: { keys: [string, string?]; re: RegExp; cjk?: RegExp }[] = [
  { keys: ['ten_khach'], re: /^(khach hang|customer|client)$/, cjk: /^(客户|客戶|客人)$/ },
  { keys: ['mst_khach'], re: /^(mst|ma so thue|tax code|tax id)$/, cjk: /^(税号|稅號|纳税号)$/ },
  { keys: ['dia_chi_khach'], re: /^(dia chi|address)$/, cjk: /^(地址)$/ },
  { keys: ['sdt_khach'], re: /^(dien thoai|tel|telephone|phone)$/, cjk: /^(电话|電話)$/ },
  { keys: ['nguoi_nhan'], re: /^(nguoi lien he|contact person|attn|attention)$/, cjk: /^(联系人|聯繫人|联络人)$/ },
  { keys: ['ngay_bao_gia'], re: /^(ngay ban hanh|date issued|issue date|date of issue)$/, cjk: /^(发布日期|發佈日期|发行日期)$/ },
  { keys: ['hieu_luc'], re: /^(ngay hieu luc|effective date|valid until)$/, cjk: /^(生效日期)$/ },
  { keys: ['so_bao_gia'], re: /^(so|no|so bao gia|quotation no)$/, cjk: /^(编号|編號)$/ },
  { keys: ['nguoi_phu_trach'], re: /^(nguoi phu trach|person in charge)$/, cjk: /^(负责人|負責人)$/ },
  { keys: ['chuc_vu_nv'], re: /^(chuc vu|position|title)$/, cjk: /^(职务|職務)$/ },
  // "Di động" / "Email" xuất hiện ở CẢ HAI cột của bảng thông tin: nửa trái là khách, nửa phải là bên mình
  { keys: ['di_dong_khach', 'di_dong_nv'], re: /^(di dong|mobile|cell)$/, cjk: /^(手机|手機)$/ },
  { keys: ['email_khach', 'email_nv'], re: /^(email|e mail)$/, cjk: /^(邮箱|郵箱)$/ },
];

/** Điền ô TRỐNG ngay bên phải các nhãn thông tin. Trả về số ô đã điền. */
function fillLabeledFields(ws: WS, text: Record<string, string>): number {
  let totalW = 0;
  const lastCol = Math.max(ws.columnCount, 1);
  for (let c = 1; c <= lastCol; c++) totalW += colPx(ws, c);
  let n = 0;
  const jobs: { r: number; c: number; key: string }[] = [];
  ws.eachRow({ includeEmpty: false }, (row, r) => row.eachCell({ includeEmpty: false }, (cell, c) => {
    if (cell.isMerged && cell.master !== cell) return;
    const raw = cellText(cell.value);
    if (!raw || hasFormula(cell.value) || raw.length > 60) return;
    // Nhãn 1 ngôn ngữ ("Khách hàng"), 2 dòng ("Khách hàng\nCustomer") hoặc cạnh nhau ("Khách hàng / Customer / 客户"): khớp nếu MỘT đoạn khớp
    const segs = raw.split(/[\n/／]/).map(x => x.trim().replace(/[:：]+$/, '').trim()).filter(Boolean);
    const spec = FIELD_LABELS.find(f => segs.some(sg => f.re.test(normalizeText(sg).replace(/[^a-z0-9]+/g, ' ').trim()) || (f.cjk && f.cjk.test(sg))));
    if (!spec) return;
    let key = spec.keys[0];
    if (spec.keys[1]) {                                                   // chọn bên theo vị trí ngang của nhãn
      const m = mergeOf(ws, r, c);
      let x = 0; for (let k = 1; k < m.c1; k++) x += colPx(ws, k);
      const centre = x + boxOf(ws, m).w / 2;
      key = totalW > 0 && centre / totalW > 0.5 ? spec.keys[1] : spec.keys[0];
    }
    jobs.push({ r, c, key });
  }));
  for (const { r, c, key } of jobs) {
    const v = (text[key] ?? '').trim();
    if (!v) continue;
    const m = mergeOf(ws, r, c);
    const target = ws.getCell(r, m.c2 + 1);
    const master = target.isMerged ? target.master : target;
    if (cellText(master.value).trim() !== '' || hasFormula(master.value)) continue;     // ô đã có chữ → giữ nguyên
    master.value = v;
    const lf = cell0Font(ws.getCell(r, c));
    master.font = { name: FILL_FONT, size: lf.size ?? master.font?.size, color: lf.color ?? master.font?.color, bold: false, italic: false };
    n++;
  }
  return n;
}

// ── Chèn ẢNH (chữ ký / con dấu / logo) vào file Excel ─────────────────────────────────────────────────────
type WS = import('exceljs').Worksheet;
interface CR { r1: number; c1: number; r2: number; c2: number }

const colName = (c: number) => { let n = c, s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
const colNum = (L: string) => L.split('').reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0);
const addrOf = (cr: CR) => (cr.r1 === cr.r2 && cr.c1 === cr.c2 ? `${colName(cr.c1)}${cr.r1}` : `${colName(cr.c1)}${cr.r1}:${colName(cr.c2)}${cr.r2}`);

/** Độ rộng cột theo px (Excel: ký tự × 7 + 5, ứng với font mặc định Calibri 11). */
export const colPx = (ws: WS, c: number) => { const col = ws.getColumn(c); return col.hidden ? 0 : Math.max(0, Math.round((col.width ?? 8.43) * 7 + 5)); };
/** Chiều cao dòng theo px (Excel tính bằng point: 1 pt = 96/72 px). */
export const rowPx = (ws: WS, r: number) => { const row = ws.getRow(r); return row.hidden ? 0 : ((row.height ?? ws.properties.defaultRowHeight ?? 15) * 96) / 72; };

/** Vùng gộp chứa ô (r,c); ô không gộp thì chính nó. */
export function mergeOf(ws: WS, r: number, c: number): CR {
  for (const m of ((ws.model as { merges?: string[] }).merges ?? [])) {
    const [a, b] = m.split(':');
    const pa = /^([A-Z]+)(\d+)$/.exec(a), pb = /^([A-Z]+)(\d+)$/.exec(b ?? a);
    if (!pa || !pb) continue;
    const cr = { c1: colNum(pa[1]), r1: Number(pa[2]), c2: colNum(pb[1]), r2: Number(pb[2]) };
    if (r >= cr.r1 && r <= cr.r2 && c >= cr.c1 && c <= cr.c2) return cr;
  }
  return { r1: r, c1: c, r2: r, c2: c };
}
export const boxOf = (ws: WS, cr: CR): { w: number; h: number } => {
  let w = 0, h = 0;
  for (let c = cr.c1; c <= cr.c2; c++) w += colPx(ws, c);
  for (let r = cr.r1; r <= cr.r2; r++) h += rowPx(ws, r);
  return { w, h };
};

/** Điểm neo (ô + độ lệch EMU) cho điểm cách góc trên-trái của (c1,r1) một đoạn (dx,dy) px — dx,dy có thể âm. */
export function anchorAt(ws: WS, c1: number, r1: number, dx: number, dy: number) {
  let c = c1, r = r1, x = dx, y = dy;
  while (x < 0 && c > 1) { c--; x += colPx(ws, c); }
  for (let g = 0; g < 200 && colPx(ws, c) > 0 && x >= colPx(ws, c); g++) { x -= colPx(ws, c); c++; }
  while (y < 0 && r > 1) { r--; y += rowPx(ws, r); }
  for (let g = 0; g < 400 && rowPx(ws, r) > 0 && y >= rowPx(ws, r); g++) { y -= rowPx(ws, r); r++; }
  return { nativeCol: c - 1, nativeColOff: Math.max(0, Math.round(x * 9525)), nativeRow: r - 1, nativeRowOff: Math.max(0, Math.round(y * 9525)) };
}

const isEmptyAt = (ws: WS, r: number, c: number): boolean => {
  const cell = ws.getCell(r, c);
  const master = cell.isMerged ? cell.master : cell;
  return cellText(master.value).trim() === '';
};

/**
 * Khối ký theo TÊN NGƯỜI KÝ in sẵn trong mẫu (vd "NGUYỄN VĂN TUẤN" nằm dưới "CÔNG TY CỔ PHẦN … / LET'S GO VN JOINT STOCK COMPANY"):
 * vùng trống ngay phía TRÊN tên (giữa dòng tên công ty và dòng tên người ký) chính là chỗ ký + đóng dấu.
 */
function findBySigner(ws: WS, signer?: string): { box: CR; title: string; ambiguous: boolean; tight: boolean } | null {
  const key = normalizeText(signer ?? '').replace(/[^a-z0-9]+/g, ' ').trim();
  if (key.length < 3) return null;
  let best: { r: number; c: number } | null = null;
  ws.eachRow({ includeEmpty: false }, (row, r) => row.eachCell({ includeEmpty: false }, (cell, c) => {
    if (cell.isMerged && cell.master !== cell) return;
    const raw = cellText(cell.value).trim();
    if (!raw || raw.length > 80 || raw.includes('{{')) return;
    const n = normalizeText(raw).replace(/[^a-z0-9]+/g, ' ').trim();
    if (!n.includes(key)) return;
    if (!best || r > best.r || (r === best.r && c > best.c)) best = { r, c };      // dòng thấp nhất; cùng dòng → bên phải
  }));
  if (!best) return null;
  const { r: br, c: bc } = best as { r: number; c: number };
  const t = mergeOf(ws, br, bc);
  const rowEmpty = (r: number, c1: number, c2: number) => { for (let c = c1; c <= c2; c++) if (!isEmptyAt(ws, r, c)) return false; return true; };
  let tr = t.r1 - 1;
  while (tr >= 1 && t.r1 - tr <= 12 && rowEmpty(tr, t.c1, t.c2)) tr--;                  // đi lên qua các dòng trống tới dòng tên công ty
  const gapRows = t.r1 - 1 - tr;
  let c1 = t.c1, c2 = t.c2, title = '';
  if (tr >= 1) {
    for (let c = t.c1; c <= t.c2; c++) if (!isEmptyAt(ws, tr, c)) { const tm = mergeOf(ws, tr, c); c1 = Math.min(c1, tm.c1); c2 = Math.max(c2, tm.c2); title = cellText((ws.getCell(tr, c).isMerged ? ws.getCell(tr, c).master : ws.getCell(tr, c)).value).trim(); break; }
  }
  if (gapRows < 1) return { box: { r1: Math.max(1, t.r1 - 2), r2: t.r1 - 1, c1, c2 }, title: title || cellText(ws.getCell(br, bc).value).trim(), ambiguous: false, tight: true };
  const box: CR = { r1: tr + 1, r2: t.r1 - 1, c1, c2 };
  return { box, title: title || cellText(ws.getCell(br, bc).value).trim(), ambiguous: false, tight: boxOf(ws, box).h < 44 };
}

const REP_RE = /(^| )(dai dien|nguoi dai dien|giam doc|tong giam doc|legal representative|representative|general director|director)( |$)/;
/**
 * Tìm KHỐI KÝ khi file mẫu không có ô {{chu_ky}}: ô chức danh "ĐẠI DIỆN …/Giám đốc/Representative/法定代表人" nằm thấp nhất trong bảng, rồi lấy vùng trống ngay bên dưới
 * (bỏ qua tối đa 2 dòng phụ như "(Giám đốc)" hay dòng tiếng Trung) làm chỗ ký. null nếu không thấy.
 */
export function findSignatureBox(ws: WS, opts: { signer?: string } = {}): { box: CR; title: string; ambiguous: boolean; tight: boolean } | null {
  const bySigner = findBySigner(ws, opts.signer);
  if (bySigner) return bySigner;
  const cands: { r: number; c: number }[] = [];
  ws.eachRow({ includeEmpty: false }, (row, r) => row.eachCell({ includeEmpty: false }, (cell, c) => {
    if (cell.isMerged && cell.master !== cell) return;
    const raw = cellText(cell.value).trim();
    if (!raw || raw.length > 60 || raw.includes('{{')) return;                 // ô đánh dấu như {{nguoi_dai_dien}} không phải chức danh
    const n = ` ${normalizeText(raw).replace(/[^a-z0-9]+/g, ' ').trim()} `;
    if (REP_RE.test(n) || /法定代表|公司代表|代表人/.test(raw)) cands.push({ r, c });
  }));
  if (!cands.length) return null;
  const lowest = Math.max(...cands.map(x => x.r));
  const row = cands.filter(x => x.r >= lowest - 2);
  const pick = row.reduce((a, b) => (b.c > a.c ? b : a));          // cùng hàng nhiều khối (bên mua / bên bán) → lấy khối bên phải
  const t = mergeOf(ws, pick.r, pick.c);
  const lastRow = Math.max(ws.rowCount, t.r2 + 8);

  // mở rộng bề ngang tới ≥ 230px qua các cột còn trống bên dưới chức danh
  let c1 = t.c1, c2 = t.c2;
  const colFree = (c: number) => { for (let r = t.r2 + 1; r <= Math.min(lastRow, t.r2 + 6); r++) if (!isEmptyAt(ws, r, c)) return false; return true; };
  const width = () => { let w = 0; for (let c = c1; c <= c2; c++) w += colPx(ws, c); return w; };
  for (let g = 0; g < 6 && width() < 230; g++) {
    if (colFree(c2 + 1)) c2++; else if (c1 > 1 && colFree(c1 - 1)) c1--; else break;
  }
  const rowEmpty = (r: number) => { for (let c = c1; c <= c2; c++) if (!isEmptyAt(ws, r, c)) return false; return true; };
  let r = t.r2 + 1, skipped = 0;
  while (skipped < 2 && r <= lastRow && !rowEmpty(r)) { r++; skipped++; }      // dòng phụ của chức danh
  const r1 = r;
  let r2 = r1 - 1;
  while (r2 + 1 <= Math.min(lastRow, r1 + 7) && rowEmpty(r2 + 1)) r2++;
  const ambiguous = new Set(row.map(x => mergeOf(ws, x.r, x.c).c1)).size > 1;        // nhiều KHỐI khác cột (chức danh + dòng phụ cùng cột thì không tính)
  if (r2 < r1) {                                                                  // không có dòng trống: đành đặt đè lên 2 dòng ngay dưới chức danh
    return { box: { r1: t.r2 + 1, r2: t.r2 + 2, c1, c2 }, title: cellText(ws.getCell(pick.r, pick.c).value).trim(), ambiguous, tight: true };
  }
  const box: CR = { r1, r2, c1, c2 };
  return { box, title: cellText(ws.getCell(pick.r, pick.c).value).trim(), ambiguous, tight: boxOf(ws, box).h < 44 };
}

/** Thêm 1 ảnh vào sheet: `rect` là vị trí/kích thước (px) tính từ góc trên-trái của vùng `cr`. */
function addPicture(wb: import('exceljs').Workbook, ws: WS, dataUrl: string, rect: Rect, cr: CR): boolean {
  const m = /^data:image\/(png|jpe?g);base64,/.exec(dataUrl);
  if (!m) return false;
  const id = wb.addImage({ base64: dataUrl, extension: m[1] === 'png' ? 'png' : 'jpeg' });
  ws.addImage(id, { tl: anchorAt(ws, cr.c1, cr.r1, rect.x, rect.y) as never, ext: { width: Math.max(1, Math.round(rect.w)), height: Math.max(1, Math.round(rect.h)) }, editAs: 'oneCell' });
  return true;
}

/** Vị trí 1 ảnh đứng riêng trong khung `box` (căn giữa, phóng/dịch theo cấu hình). */
function loneRect(kind: ImageToken, layout: StampLayout, box: { w: number; h: number }, img: { w: number; h: number } | null): Rect {
  if (kind === 'logo') return containIn({ x: box.w * 0.025, y: box.h * 0.025, w: box.w * 0.95, h: box.h * 0.95 }, img);
  const sig = kind === 'chu_ky';
  const k = sig ? layout.sigScale : layout.sealScale;
  const w = (sig ? Math.min(box.w * 0.9, 190) : Math.min(box.h, box.w * 0.9, 100)) * k;
  const h = (sig ? Math.min(box.h * 0.92, 90) : Math.min(box.h, box.w * 0.9, 100)) * k;
  const dx = sig ? layout.sigDx : layout.sealDx, dy = sig ? layout.sigDy : layout.sealDy;
  return containIn({ x: (box.w - w) / 2 + dx, y: (box.h - h) / 2 + dy, w, h }, img);
}

const IMG_TOKEN_RE = /\{\{\s*(chu_ky|con_dau|logo)\s*\}\}/gi;
const WHAT: Record<ImageToken, 'chữ ký' | 'con dấu' | 'logo'> = { chu_ky: 'chữ ký', con_dau: 'con dấu', logo: 'logo' };

/** Xử lý ảnh cho 1 sheet: ô {{chu_ky}} / {{con_dau}} / {{logo}} trước, rồi tự tìm khối ký cho ảnh còn thiếu. */
function placeImages(wb: import('exceljs').Workbook, ws: WS, values: FillValues, report: FillReport) {
  const layout = values.layout ?? DEFAULT_LAYOUT;
  const want: Record<ImageToken, string | null> = {
    chu_ky: values.images?.signature?.dataUrl ?? null, con_dau: values.images?.seal?.dataUrl ?? null, logo: values.images?.logo?.dataUrl ?? null,
  };
  // 1) gom các ô đánh dấu ảnh và xoá chữ đánh dấu
  const groups = new Map<string, { cr: CR; kinds: Set<ImageToken> }>();
  ws.eachRow({ includeEmpty: false }, (row, r) => row.eachCell({ includeEmpty: false }, (cell, c) => {
    if (cell.isMerged && cell.master !== cell) return;
    const txt = cellText(cell.value);
    if (!txt.includes('{{') || hasFormula(cell.value)) return;
    const found: ImageToken[] = [];
    const rest = txt.replace(IMG_TOKEN_RE, (_m, n: string) => { found.push(n.toLowerCase() as ImageToken); return ''; });
    if (!found.length) return;
    cell.value = rest.trim() === '' ? null : rest;
    const cr = mergeOf(ws, r, c);
    const key = `${cr.r1}:${cr.c1}`;
    const g = groups.get(key) ?? { cr, kinds: new Set<ImageToken>() };
    found.forEach(k => g.kinds.add(k));
    groups.set(key, g);
  }));

  const done = new Set<ImageToken>();
  const put = (kind: ImageToken, rect: Rect, cr: CR, mode: FillReport['images'][number]['mode']) => {
    const url = want[kind];
    if (!url) return;
    if (addPicture(wb, ws, url, rect, cr)) { done.add(kind); report.images.push({ what: WHAT[kind], where: addrOf(cr), mode }); }
    else report.imageWarnings.push(`Ảnh ${WHAT[kind]} không đúng định dạng PNG/JPEG nên không chèn được.`);
  };
  for (const { cr, kinds } of groups.values()) {
    const box = boxOf(ws, cr);
    if (kinds.has('chu_ky') && kinds.has('con_dau')) {       // cùng 1 ô → đặt theo kiểu chuẩn: dấu lệch trái đè một phần lên chữ ký
      const b = stampBoxes(layout, box);
      // thêm ảnh nào TRƯỚC thì nằm DƯỚI: mặc định ký trước, đóng dấu sau → dấu nằm trên chữ ký
      const order: ImageToken[] = layout.sealOnTop === false ? ['con_dau', 'chu_ky'] : ['chu_ky', 'con_dau'];
      for (const k of order) { const u = want[k]; if (u) put(k, containIn(k === 'chu_ky' ? b.sig : b.seal, pngSize(u)), cr, 'ô đánh dấu'); }
    }
    for (const k of kinds) {
      if (done.has(k) || (kinds.has('chu_ky') && kinds.has('con_dau') && k !== 'logo')) continue;
      const url = want[k];
      if (url) put(k, loneRect(k, layout, box, pngSize(url)), cr, 'ô đánh dấu');
    }
    if (box.w < 30 || box.h < 18) report.imageWarnings.push(`Ô ${addrOf(cr)} quá nhỏ để chèn ảnh — hãy gộp ô hoặc nới rộng cho đủ chỗ.`);
  }

  // 2) ảnh chữ ký / con dấu đã bật mà chưa có ô đánh dấu → tự tìm khối ký
  const missingOrder: ImageToken[] = layout.sealOnTop === false ? ['con_dau', 'chu_ky'] : ['chu_ky', 'con_dau'];
  const missing = missingOrder.filter(k => want[k] && !done.has(k));
  if (missing.length) {
    const f = findSignatureBox(ws, { signer: values.text.nguoi_dai_dien });
    if (!f) {
      report.imageWarnings.push(`Không tìm thấy khối ký trong sheet “${ws.name}” nên chưa chèn ${missing.map(k => WHAT[k]).join(' + ')}. Hãy điền “Người đại diện” cho pháp nhân (để khớp tên in sẵn trong mẫu), hoặc đặt ô {{chu_ky}} / {{con_dau}} đúng chỗ.`);
    } else {
      const box = boxOf(ws, f.box);
      const b = stampBoxes(layout, box);
      for (const k of missing) {
        const url = want[k]!;
        put(k, containIn(k === 'chu_ky' ? b.sig : b.seal, pngSize(url)), f.box, 'tự tìm khối ký');
      }
      if (f.ambiguous) report.imageWarnings.push('Có nhiều khối “Đại diện” cùng hàng — đã chọn khối bên phải. Nếu sai, đặt ô {{chu_ky}} / {{con_dau}} đúng chỗ.');
      if (f.tight) report.imageWarnings.push(`Dưới chức danh “${f.title}” không đủ dòng trống để ký (chỉ ${Math.round(box.h)}px) — ảnh đặt đè lên các dòng bên dưới. Nên chèn thêm 3–4 dòng trống hoặc dùng ô {{chu_ky}}.`);
    }
  }
  if (want.logo && !done.has('logo')) report.imageWarnings.push('Đã bật logo nhưng file mẫu không có ô {{logo}} nên không chèn.');
}

export async function fillExcelTemplate(
  buf: ArrayBuffer, values: FillValues,
  /** `sheet`: chỉ xử lý đúng sheet (phiên bản) này và BỎ các sheet còn lại khỏi file trả về. Bỏ trống = xử lý tất cả. */
  opts: { sheet?: string } = {},
): Promise<{ output: ArrayBuffer; report: FillReport }> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  if (opts.sheet) {
    const keep = wb.getWorksheet(opts.sheet);
    if (!keep) throw new Error(`Không thấy phiên bản (sheet) “${opts.sheet}” trong file mẫu.`);
    for (const ws of [...wb.worksheets]) if (ws.id !== keep.id) wb.removeWorksheet(ws.id);
    wb.views = [{ activeTab: 0, x: 0, y: 0, width: 10000, height: 20000, firstSheet: 0, visibility: 'visible' }];
  }
  const report: FillReport = { rows: [], tokens: 0, fields: 0, edited: 0, skipped: [], foundTable: false, images: [], imageWarnings: [] };

  const setNumber = (cell: import('exceljs').Cell, n: number) => {
    const target = cell.master ?? cell;
    target.value = Math.round(n);
    target.font = { ...(target.font ?? {}), name: FILL_FONT };
    if (!target.numFmt || target.numFmt === 'General' || target.numFmt === '@') target.numFmt = '#,##0';
  };

  wb.eachSheet(ws => {
    // ── 0) Ảnh chữ ký / con dấu / logo (xử lý trước để các ô đánh dấu ảnh được xoá chữ) ──
    placeImages(wb, ws, values, report);

    // ── 1) Ô đánh dấu {{...}} ──
    ws.eachRow({ includeEmpty: false }, row => row.eachCell({ includeEmpty: false }, cell => {
      const txt = cellText(cell.value);
      if (!txt.includes('{{') || hasFormula(cell.value)) return;
      const whole = /^\s*\{\{\s*([a-zA-Z0-9_]+)\s*\}\}\s*$/.exec(txt);
      const kind = whole ? TOKEN_KIND[whole[1].toLowerCase()] : undefined;
      if (kind && values.prices[kind] != null) { setNumber(cell, values.prices[kind]!); report.tokens++; return; }
      let changed = false;
      const out = txt.replace(TOKEN_RE, (m, name: string) => {
        const k = name.toLowerCase();
        const pk = TOKEN_KIND[k];
        const rep = pk ? (values.prices[pk] != null ? vnd(values.prices[pk]!) : null) : k in values.text ? values.text[k] : null;
        if (rep == null) return m;   // token lạ → để nguyên cho người dùng thấy
        changed = true; report.tokens++;
        return rep;
      });
      if (changed) { cell.value = out; const tg = cell.master ?? cell; tg.font = { ...(tg.font ?? {}), name: FILL_FONT }; }
    }));

    // ── 1b) Ô thông tin cạnh nhãn (Khách hàng, MST, Ngày ban hành, Người phụ trách…) ──
    report.fields += fillLabeledFields(ws, values.text);

    // ── 2) Tự nhận diện bảng giá theo ô tiêu đề "Đơn giá" ──
    const headers = findPriceHeaders(ws);
    for (const h of headers) {
      report.foundTable = true;
      for (const { r, label, priceCell } of tableRows(ws, h)) {
        const kind = classifyLabel(label);
        const pv = priceCell.master?.value ?? priceCell.value;
        if (!kind || values.prices[kind] == null) {
          if (typeof pv === 'number') report.skipped.push(`Dòng ${r}: ${label.split('\n')[0].slice(0, 60) || '(không có nhãn)'} — không nhận ra`);
          continue;
        }
        if (hasFormula(pv)) { report.skipped.push(`Dòng ${r}: ô giá có công thức nên giữ nguyên`); continue; }
        const cur = cellText(pv).trim();
        if (cur.length > 12 && /\p{L}/u.test(cur)) { report.skipped.push(`Dòng ${r}: ô giá đang chứa chữ nên giữ nguyên`); continue; }
        setNumber(priceCell, values.prices[kind]!);
        report.rows.push({ sheet: ws.name, cell: priceCell.address, label: label.split('\n')[0].slice(0, 60), kind, value: Math.round(values.prices[kind]!) });
      }
    }

    // ── 3) Nội dung người dùng sửa tay (thắng mọi giá trị tự điền) ──
    applyCellEdits(ws, values.edits, report);
  });

  const out = await wb.xlsx.writeBuffer();
  return { output: out as ArrayBuffer, report };
}

// ── Nhận biết các PHIÊN BẢN trong 1 file mẫu (mỗi sheet là 1 phiên bản báo giá) ──────────────────
export type TemplateLang = 'vi' | 'zh' | 'en' | 'other';
export const LANG_LABEL: Record<TemplateLang, string> = { vi: 'Tiếng Việt', zh: 'Song ngữ Việt – Trung', en: 'Song ngữ Anh – Việt', other: 'Phiên bản khác' };

export interface TemplateVersion {
  /** Tên sheet — khoá để chọn phiên bản */
  sheet: string;
  lang: TemplateLang;
  /** Nhãn hiển thị (người dùng đổi được) */
  label: string;
  /** Có tìm thấy bảng giá (ô tiêu đề "Đơn giá") */
  hasTable: boolean;
  /** Số dòng giá nhận ra được trong bảng */
  rows: number;
  /** Số ô {{...}} */
  tokens: number;
}

/** Đoán ngôn ngữ của 1 sheet từ nội dung chữ (tên sheet chỉ là gợi ý phụ khi nội dung không đủ rõ). Người dùng luôn đổi được nhãn. */
export function detectLang(texts: string[], sheetName = ''): TemplateLang {
  const all = texts.join('\n');
  if (/[\u4e00-\u9fff]/.test(all)) return 'zh';                                  // có chữ Hán → song ngữ Việt–Trung
  const low = ` ${all.toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;
  // Đếm số TỪ KHÁC NHAU (không đếm lặp: cột đơn vị "VND/hour" lặp 6 dòng không làm 1 bản tiếng Việt thành tiếng Anh)
  const enHits = new Set(low.match(/ (unit price|description|overtime|night shift|night|sunday|holiday|quotation|remarks?|total|price list|daily|hours?|per day|per hour|includes?) /g) ?? []).size;
  if (enHits >= 3) return 'en';                                                    // nhiều từ tiếng Anh đặc trưng của báo giá → Anh–Việt
  const n = normalizeText(sheetName);
  if (/(trung|chinese|\bcn\b|\bzh\b|\bhoa\b)/.test(n) || /中|华|華/.test(sheetName)) return 'zh';
  if (/(\banh\b|english|\ben\b|\beng\b)/.test(n)) return 'en';
  return 'vi';
}

/** Liệt kê các phiên bản (sheet hiển thị) của file mẫu kèm ngôn ngữ đoán được và mức nhận diện. */
export async function inspectTemplate(buf: ArrayBuffer): Promise<TemplateVersion[]> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const out: TemplateVersion[] = [];
  wb.eachSheet(ws => {
    if (ws.state && ws.state !== 'visible') return;
    const texts: string[] = [];
    let tokens = 0;
    ws.eachRow({ includeEmpty: false }, row => row.eachCell({ includeEmpty: false }, cell => {
      const raw = cellText(cell.value);
      if (!raw) return;
      texts.push(raw);
      tokens += (raw.match(TOKEN_RE) ?? []).length;
    }));
    const headers = findPriceHeaders(ws);
    let rows = 0;
    for (const h of headers) {
      for (const { label } of tableRows(ws, h)) if (classifyLabel(label)) rows++;
    }
    const lang = detectLang(texts, ws.name);
    out.push({ sheet: ws.name, lang, label: LANG_LABEL[lang], hasTable: headers.length > 0, rows, tokens });
  });
  return out;
}
