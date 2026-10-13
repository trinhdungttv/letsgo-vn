// Phương án giá — TÀI LIỆU BÁO GIÁ (bản xem trước + xuất PDF) theo 3 phiên bản ngôn ngữ:
//   vi = tiếng Việt · zh = song ngữ Việt–Trung (Việt trên, Trung dưới) · en = song ngữ Anh–Việt (Anh trên, Việt dưới)
// File này THUẦN (không React, không DOM) để test được: gom dữ liệu phương án + thông tin người dùng đã điền thành 1 "DocView"
// đã dịch & định dạng sẵn; component chỉ việc vẽ. Chỗ nào người dùng chưa sửa (null) thì dùng câu mặc định của đúng ngôn ngữ.
import { computePriceList, DEFAULT_GENERAL_NOTES, includedNoteAuto, normalizeQuoteSheet } from './quoteSheet';
import { normalizePlanData } from './engine';
import { normalizeReferral, referralNotes, referralPriceRow, referralTerms } from './referral';
import type { PlanData, PlanResult, QuoteRowKind } from './types';

export type DocLang = 'vi' | 'zh' | 'en';
export const DOC_LANGS: { value: DocLang; label: string }[] = [
  { value: 'vi', label: 'Tiếng Việt' }, { value: 'zh', label: 'Việt – Trung' }, { value: 'en', label: 'Anh – Việt' },
];

/** Cặp chữ: `a` dòng chính, `b` dòng phụ (bản song ngữ) — bản tiếng Việt thì không có `b`. */
export interface Bi { a: string; b?: string }

export interface QuoteDoc {
  lang: DocLang;
  /** Pháp nhân gửi báo giá này (null = cái dùng gần nhất / cái đầu tiên) */
  entityId: string | null;
  number: string;
  /** Ngày ban hành, yyyy-mm-dd */
  date: string;
  /** yyyy-mm-dd hoặc '' */
  validUntil: string;
  /** Hiệu lực tính theo số tháng kể từ ngày ban hành (đổi ngày ban hành thì ngày hết hạn tự theo). null = tự chọn ngày cụ thể */
  validMonths: number | null;
  customer: { name: string; attn: string; address: string; taxCode: string; phone: string; mobile: string; email: string };
  /** Người phụ trách bên mình (điền vào các ô "Người phụ trách / Chức vụ / Di động / Email" của file mẫu) */
  seller: { name: string; title: string; mobile: string; email: string };
  /** null = dùng câu mặc định của ngôn ngữ đang chọn */
  title: string | null;
  intro: string | null;
  /** Mỗi dòng 1 ý */
  serviceLines: string | null;
  closing: string | null;
  payment: string;
  /**
   * Sửa chữ trực tiếp trên bản xem trước file mẫu (vd bản dịch song ngữ sai). Khoá = `<mã mẫu>|<tên sheet>!<ô>`, giá trị = nội dung từng
   * đoạn chữ của ô (ô nhiều kiểu chữ thì mỗi đoạn 1 phần tử).
   */
  edits: Record<string, string[]>;
  signerName: string | null;
  signerTitle: string | null;
  place: string | null;
}

/** Thông tin công ty gửi báo giá (lưu 1 lần cho cả công ty ở bảng quote_company_profile). */
export interface CompanyProfileData {
  name: string; address: string; taxCode: string; phone: string; email: string; website: string;
  signerName: string; signerTitle: string; place: string;
}
export const emptyProfile = (): CompanyProfileData => ({ name: '', address: '', taxCode: '', phone: '', email: '', website: '', signerName: '', signerTitle: '', place: '' });
export const normalizeProfile = (raw: unknown): CompanyProfileData => {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out = emptyProfile();
  for (const k of Object.keys(out) as (keyof CompanyProfileData)[]) out[k] = typeof r[k] === 'string' ? (r[k] as string) : '';
  return out;
};

export const pad2 = (n: number) => String(n).padStart(2, '0');
export const isoDate = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
/** Cộng tháng theo lịch, giữ ngày trong tháng (31/01 + 1 tháng → 28 hoặc 29/02). */
export function addMonthsIso(iso: string, months: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return '';
  const total = (m - 1) + months;
  const ty = y + Math.floor(total / 12), tm = ((total % 12) + 12) % 12;
  const last = new Date(ty, tm + 1, 0).getDate();
  return `${ty}-${pad2(tm + 1)}-${pad2(Math.min(d, last))}`;
}
/** Còn bao nhiêu ngày hiệu lực (âm = đã hết, 0 = hết hạn hôm nay). null khi chưa có ngày hết hạn. */
export function daysLeft(validUntil: string | null | undefined, today = new Date()): number | null {
  const [y, m, d] = (validUntil ?? '').split('-').map(Number);
  if (!y || !m || !d) return null;
  const end = new Date(y, m - 1, d).getTime();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  return Math.round((end - start) / 86_400_000);
}
/** Hiệu lực mặc định của báo giá: 1 tháng kể từ ngày ban hành */
export const DEFAULT_VALID_MONTHS = 1;

export interface DocDefaults {
  name?: string; attn?: string; address?: string; taxCode?: string; phone?: string; mobile?: string; email?: string;
  sellerName?: string; sellerTitle?: string; sellerMobile?: string; sellerEmail?: string;
  /** yyyy-mm-dd từ "Thông tin báo giá" (CRM) */
  validUntil?: string; payment?: string;
}

/** Số báo giá gợi ý: BG-yyyymmdd-nnn (người dùng sửa được). */
export const suggestNumber = (d: Date, rand = Math.floor(Math.random() * 900) + 100) => `BG-${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${rand}`;

export function defaultDoc(today: Date, def: DocDefaults = {}, lang: DocLang = 'vi'): QuoteDoc {
  return {
    lang, entityId: null, number: suggestNumber(today), date: isoDate(today),
    validUntil: def.validUntil || addMonthsIso(isoDate(today), DEFAULT_VALID_MONTHS),
    validMonths: def.validUntil ? null : DEFAULT_VALID_MONTHS,
    customer: { name: def.name ?? '', attn: def.attn ?? '', address: def.address ?? '', taxCode: def.taxCode ?? '', phone: def.phone ?? '', mobile: def.mobile ?? '', email: def.email ?? '' },
    seller: { name: def.sellerName ?? '', title: def.sellerTitle ?? '', mobile: def.sellerMobile ?? '', email: def.sellerEmail ?? '' },
    title: null, intro: null, serviceLines: null, closing: null, payment: def.payment ?? '', edits: {},
    signerName: null, signerTitle: null, place: null,
  };
}

/** Chỉ nhận { khoá: string[] }, giới hạn số lượng & độ dài để dữ liệu rác không làm phình phương án. */
export function normalizeEdits(raw: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>).slice(0, 300)) {
    if (!Array.isArray(v) || k.length > 120) continue;
    out[k] = v.slice(0, 12).map(x => String(x ?? '').slice(0, 2000));
  }
  return out;
}

/** Đọc từ DB (có thể thiếu/cũ) về dạng đầy đủ; thiếu hẳn thì null để nơi gọi tạo mặc định. */
export function normalizeDoc(raw: unknown): QuoteDoc | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<QuoteDoc>;
  const base = defaultDoc(new Date());
  const str = (v: unknown, d: string) => (typeof v === 'string' ? v : d);
  const nul = (v: unknown) => (typeof v === 'string' ? v : null);
  const c = (r.customer ?? {}) as Partial<QuoteDoc['customer']>;
  const sl = (r.seller ?? {}) as Partial<QuoteDoc['seller']>;
  return {
    lang: r.lang === 'zh' || r.lang === 'en' ? r.lang : 'vi', entityId: nul(r.entityId),
    number: str(r.number, base.number), date: str(r.date, base.date), validUntil: str(r.validUntil, base.validUntil),
    // Báo giá cũ chưa có trường này → giữ đúng ngày hết hạn đã ghi (không tự tính lại)
    validMonths: typeof r.validMonths === 'number' && r.validMonths > 0 ? Math.min(24, Math.round(r.validMonths)) : null,
    customer: { name: str(c.name, ''), attn: str(c.attn, ''), address: str(c.address, ''), taxCode: str(c.taxCode, ''), phone: str(c.phone, ''), mobile: str(c.mobile, ''), email: str(c.email, '') },
    seller: { name: str(sl.name, ''), title: str(sl.title, ''), mobile: str(sl.mobile, ''), email: str(sl.email, '') },
    title: nul(r.title), intro: nul(r.intro), serviceLines: nul(r.serviceLines), closing: nul(r.closing),
    payment: str(r.payment, ''), edits: normalizeEdits((r as { edits?: unknown }).edits), signerName: nul(r.signerName), signerTitle: nul(r.signerTitle), place: nul(r.place),
  };
}

// ── Từ điển 3 ngôn ngữ ───────────────────────────────────────────────────────────────────────
type Tri = { vi: string; zh: string; en: string };
const T = {
  title: { vi: 'BẢNG BÁO GIÁ DỊCH VỤ', zh: '服务报价单', en: 'SERVICE QUOTATION' },
  to: { vi: 'Kính gửi', zh: '致', en: 'To' },
  attn: { vi: 'Người nhận', zh: '联系人', en: 'Attention' },
  address: { vi: 'Địa chỉ', zh: '地址', en: 'Address' },
  tax: { vi: 'Mã số thuế', zh: '税号', en: 'Tax code' },
  phone: { vi: 'Điện thoại', zh: '电话', en: 'Phone' },
  number: { vi: 'Số', zh: '编号', en: 'No.' },
  date: { vi: 'Ngày ban hành', zh: '签发日期', en: 'Issue date' },
  validShort: { vi: 'Hiệu lực đến', zh: '有效期至', en: 'Valid until' },
  s1: { vi: 'Nội dung dịch vụ', zh: '服务内容', en: 'Scope of service' },
  s2: { vi: 'Bảng giá dịch vụ', zh: '服务价格表', en: 'Service price list' },
  s3: { vi: 'Điều kiện tính phí', zh: '收费条件', en: 'Fee terms' },
  thNo: { vi: 'STT', zh: '序号', en: 'No.' },
  thDesc: { vi: 'Nội dung đơn giá', zh: '单价内容', en: 'Description' },
  thUnit: { vi: 'Đơn vị tính', zh: '计量单位', en: 'Unit' },
  thPrice: { vi: 'Đơn giá (VNĐ)', zh: '单价（越南盾）', en: 'Unit price (VND)' },
  thNote: { vi: 'Ghi chú', zh: '备注', en: 'Remarks' },
  notes: { vi: 'Ghi chú', zh: '备注', en: 'Notes' },
  valid: { vi: 'Báo giá có hiệu lực đến', zh: '报价有效期至', en: 'This quotation is valid until' },
  payment: { vi: 'Thanh toán', zh: '付款方式', en: 'Payment' },
  signTitle: { vi: 'ĐẠI DIỆN CÔNG TY', zh: '公司代表', en: 'COMPANY REPRESENTATIVE' },
  included: { vi: 'Bao gồm', zh: '包括', en: 'Includes' },
} satisfies Record<string, Tri>;
export type LabelKey = keyof typeof T;

/** Ghép cặp theo ngôn ngữ: vi → chỉ Việt; zh → Việt trên, Trung dưới; en → Anh trên, Việt dưới. */
export function bi(t: Tri, lang: DocLang): Bi {
  if (lang === 'zh') return { a: t.vi, b: t.zh };
  if (lang === 'en') return { a: t.en, b: t.vi };
  return { a: t.vi };
}
export const label = (k: LabelKey, lang: DocLang): Bi => bi(T[k], lang);

const ROW_NAME: Record<Exclude<QuoteRowKind, 'custom'>, Tri> = {
  day8: { vi: 'Lương ngày làm việc 8 tiếng', zh: '8小时工作日工资', en: 'Daily wage (8 working hours)' },
  night8: { vi: 'Lương ngày làm việc 8 tiếng ca đêm', zh: '8小时夜班工作日工资', en: 'Daily wage (8 working hours) - night shift' },
  ot_day: { vi: 'Lương tăng ca ngày 1 tiếng', zh: '加班工资每天增加1小时', en: 'Overtime pay per hour - weekday' },
  ot_night: { vi: 'Lương tăng ca 1 tiếng ca đêm', zh: '夜班加班费1小时', en: 'Overtime pay per hour - weekday night' },
  ot_sun: { vi: 'Lương tăng ca ngày chủ nhật 1 tiếng', zh: '周日加班1小时', en: 'Overtime pay per hour - Sunday' },
  ot_sun_night: { vi: 'Lương tăng ca ngày chủ nhật 1 tiếng ca đêm', zh: '周日加班费1小时夜班', en: 'Overtime pay per hour - Sunday night' },
  ot_hol: { vi: 'Lương tăng ca ngày lễ, Tết 1 tiếng', zh: '节假日加班1小时', en: 'Overtime pay per hour - public holiday' },
  ot_hol_night: { vi: 'Lương tăng ca ngày lễ, Tết 1 tiếng ca đêm', zh: '节假日夜班加班费1小时', en: 'Overtime pay per hour - public holiday night' },
  insurance: { vi: 'Bảo hiểm xã hội, y tế, thất nghiệp', zh: '社会保险、医疗保险、失业保险', en: 'Social, health & unemployment insurance' },
};
const ROW_UNIT: Record<Exclude<QuoteRowKind, 'custom'>, Tri> = {
  day8: { vi: 'VNĐ/ngày', zh: '越南盾/天', en: 'VND/day' },
  night8: { vi: 'VNĐ/ngày (ca đêm)', zh: '越南盾/夜班', en: 'VND/day (night shift)' },
  ot_day: { vi: 'VNĐ/giờ', zh: '越南盾/小时', en: 'VND/hour' },
  ot_night: { vi: 'VNĐ/giờ (ca đêm)', zh: '越南盾/小时（夜班）', en: 'VND/hour (night shift)' },
  ot_sun: { vi: 'VNĐ/giờ', zh: '越南盾/小时', en: 'VND/hour' },
  ot_sun_night: { vi: 'VNĐ/giờ (ca đêm)', zh: '越南盾/小时（夜班）', en: 'VND/hour (night shift)' },
  ot_hol: { vi: 'VNĐ/giờ', zh: '越南盾/小时', en: 'VND/hour' },
  ot_hol_night: { vi: 'VNĐ/giờ (ca đêm)', zh: '越南盾/小时（夜班）', en: 'VND/hour (night shift)' },
  insurance: { vi: 'VNĐ/người/tháng', zh: '越南盾/人/月', en: 'VND/worker/month' },
};

const trimLines = (s: string) => s.split('\n').map(x => x.trim()).filter(Boolean);
const biLines = (vi: string[], zh: string[], en: string[], lang: DocLang): Bi[] =>
  vi.map((v, i) => (lang === 'zh' ? { a: v, b: zh[i] } : lang === 'en' ? { a: en[i], b: v } : { a: v }));

function defaultServiceLines(lang: DocLang, industry: string | null | undefined, referral = false): Bi[] {
  const ind = (industry ?? '').trim();
  if (referral) {
    return biLines(
      ['Giới thiệu, tuyển chọn lao động phổ thông theo yêu cầu của Quý Công ty.', ind ? `Vị trí: lao động phổ thông trong ngành ${ind}.` : 'Vị trí: lao động phổ thông theo yêu cầu của Quý Công ty.', 'Người lao động ký hợp đồng lao động trực tiếp với Quý Công ty.', 'Yêu cầu: Nam/Nữ từ 18 đến 45 tuổi, sức khỏe tốt.'],
      ['按贵公司要求介绍、甄选普通劳动者。', ind ? `岗位：${ind}行业普通劳动。` : '岗位：按贵公司要求的普通劳动。', '劳动者与贵公司直接签订劳动合同。', '要求：男女均可，年龄18至45岁，身体健康。'],
      ['Referral and selection of general workers as required by your company.', ind ? `Position: general labor in the ${ind} industry.` : 'Position: general labor as required by your company.', 'Workers sign labor contracts directly with your company.', 'Requirements: Male/Female, aged 18 to 45, in good health.'],
      lang,
    );
  }
  return biLines(
    ['Cung ứng lao động phổ thông, không cần kinh nghiệm.', ind ? `Công việc: lao động phổ thông trong ngành ${ind}.` : 'Công việc: lao động phổ thông theo yêu cầu của Quý Công ty.', 'Thời gian làm việc: 8 giờ/ngày, theo ca/kíp của Quý Công ty.', 'Yêu cầu: Nam/Nữ từ 18 đến 45 tuổi, sức khỏe tốt.'],
    ['提供普通劳务派遣，无需工作经验。', ind ? `工作内容：${ind}行业普通劳动。` : '工作内容：按贵公司要求的普通劳动。', '工作时间：每天8小时，按贵公司班次安排。', '要求：男女均可，年龄18至45岁，身体健康。'],
    ['Supply of general labor, no experience required.', ind ? `Job description: general labor in the ${ind} industry.` : 'Job description: general labor as required by your company.', 'Working hours: 8 hours/day, following your company shifts.', 'Requirements: Male/Female, aged 18 to 45, in good health.'],
    lang,
  );
}
const defaultNotes = (lang: DocLang): Bi[] => biLines(
  trimLines(DEFAULT_GENERAL_NOTES),
  ['报价不含增值税（VAT）。', '报价不含餐费及其他费用。', '报价不含客户提出的其他额外要求。'],
  ['Prices exclude VAT.', 'Prices exclude meals and other expenses.', 'Prices exclude any additional requests from the customer.'],
  lang,
);
// Tên đã bắt đầu bằng "Công ty"/"Cty" thì không thêm tiền tố nữa (tránh "Công ty CÔNG TY TNHH …")
const viCompany = (name: string) => (/^\s*(công ty|cty)(\s|$)/i.test(name) ? name.trim() : `Công ty ${name}`);
const defaultIntro = (lang: DocLang, company: string, referral = false): Bi => {
  const vi = `${viCompany(company)} xin trân trọng gửi tới Quý Công ty bảng báo giá dịch vụ ${referral ? 'giới thiệu' : 'cung ứng'} lao động như sau:`;
  return {
    vi: { a: vi },
    zh: { a: vi, b: `${company}谨向贵公司提供${referral ? '劳动力介绍' : '劳务派遣'}服务报价如下：` },
    en: { a: `${company} is pleased to submit the following quotation for labor ${referral ? 'referral' : 'supply'} services:`, b: vi },
  }[lang];
};
const defaultClosing = (lang: DocLang): Bi => ({
  vi: { a: 'Rất mong nhận được sự hợp tác của Quý Công ty. Trân trọng cảm ơn!' },
  zh: { a: 'Rất mong nhận được sự hợp tác của Quý Công ty. Trân trọng cảm ơn!', b: '期待与贵公司合作，谨此致谢！' },
  en: { a: 'We look forward to cooperating with your company. Thank you!', b: 'Rất mong nhận được sự hợp tác của Quý Công ty. Trân trọng cảm ơn!' },
}[lang]);

export function dateLong(lang: DocLang, iso: string): Bi {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return { a: '' };
  const en = `${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][m - 1]} ${d}, ${y}`;
  const vi = `ngày ${pad2(d)} tháng ${pad2(m)} năm ${y}`;
  const zh = `${y}年${pad2(m)}月${pad2(d)}日`;
  return lang === 'zh' ? { a: vi, b: zh } : lang === 'en' ? { a: en, b: vi } : { a: vi };
}
export const dateShort = (iso: string) => { const [y, m, d] = iso.split('-'); return y && m && d ? `${d}/${m}/${y}` : ''; };

export interface DocRow { no: number; name: Bi; unit: Bi; price: number }

export interface DocView {
  lang: DocLang;
  company: { name: string; lines: string[] };
  title: Bi;
  number: string;
  dateText: string;
  /** dd/mm/yyyy hoặc '' */
  validUntilText: string;
  customer: { name: string; rows: { label: Bi; value: string }[] };
  labels: Record<LabelKey, Bi>;
  intro: Bi;
  serviceLines: Bi[];
  rows: DocRow[];
  /** Câu "Bao gồm: …" đặt ngay dưới bảng giá ('' = không có) */
  includedNote: string;
  /** Điều kiện tính phí (chỉ dịch vụ Giới thiệu lao động; cung ứng = []) */
  terms: Bi[];
  notes: Bi[];
  closing: Bi;
  validText: Bi | null;
  placeDate: Bi;
  signer: { title: Bi; role: string; name: string };
}

export function resolveDoc(docIn: QuoteDoc, input: PlanData, result: PlanResult, profileIn: CompanyProfileData, ctx: { industry?: string | null } = {}): DocView {
  const doc = normalizeDoc(docIn) ?? defaultDoc(new Date());
  const lang = doc.lang;
  const plan = normalizePlanData(input);
  const q = normalizeQuoteSheet(plan.quote);
  const profile = normalizeProfile(profileIn);
  const companyName = profile.name.trim() || "Let's Go VN";
  const labels = Object.fromEntries((Object.keys(T) as LabelKey[]).map(k => [k, label(k, lang)])) as Record<LabelKey, Bi>;

  // Bảng giá: các dòng đang hiện; tên/đơn vị mặc định được dịch, tên người dùng đã sửa thì giữ nguyên
  const list = computePriceList(plan, result).rows.filter(r => !r.hidden);
  const defTri = (kind: QuoteRowKind, name: string, tbl: Record<string, Tri>, field: 'vi'): Bi => {
    const t = kind !== 'custom' ? tbl[kind] : undefined;
    return t && t[field] === name ? bi(t, lang) : { a: name };
  };
  const referral = plan.service === 'referral';
  const refCfg = referral ? normalizeReferral(plan.referral) : null;
  const included = q.includedNote ?? includedNoteAuto(plan);
  // Câu "Bao gồm: …" tự sinh: bản Anh–Việt đổi tiền tố thành "Includes:" (tên các khoản vẫn là tiếng Việt vì là chữ người dùng tự đặt)
  const includedText = q.includedNote == null && lang === 'en' ? included.replace(/^Bao gồm:?/, 'Includes:') : included;
  const rows: DocRow[] = refCfg
    ? [{ no: 1, ...referralPriceRow(refCfg, lang) }]
    : list.map((r, i) => ({
        no: i + 1,
        name: defTri(r.kind, r.name, ROW_NAME, 'vi'),
        unit: defTri(r.kind, r.unit, ROW_UNIT, 'vi'),
        price: r.price,
      }));

  const customNotes = q.generalNotes.trim() !== DEFAULT_GENERAL_NOTES.trim();
  const notes: Bi[] = refCfg ? referralNotes(refCfg, lang) : customNotes ? trimLines(q.generalNotes).map(a => ({ a })) : defaultNotes(lang);
  // Bảo hiểm tách khỏi giá ngày → ghi rõ điều kiện thu (đặt đầu phần ghi chú)
  if (!refCfg && list.some(r => r.kind === 'insurance')) {
    const n = result.separateMinDays;
    notes.unshift(bi({
      vi: `Bảo hiểm (BHXH, BHYT, BHTN) thu riêng theo tháng, chỉ áp dụng cho người lao động làm từ ${n} công/tháng trở lên; không tính vào đơn giá ngày công.`,
      zh: `保险费（社会保险、医疗保险、失业保险）按月另行收取，仅适用于当月工作满${n}个工日及以上的劳动者，不计入日工价。`,
      en: `Insurance (social, health and unemployment) is charged separately per month, only for workers with ${n} or more working days in the month; it is not included in the daily rate.`,
    }, lang));
  }
  if (doc.payment.trim()) notes.push({ a: `${bi(T.payment, lang).a}: ${doc.payment.trim()}` });

  const cus = doc.customer;
  const cRows: { label: Bi; value: string }[] = [];
  if (cus.attn.trim()) cRows.push({ label: labels.attn, value: cus.attn.trim() });
  if (cus.address.trim()) cRows.push({ label: labels.address, value: cus.address.trim() });
  if (cus.taxCode.trim()) cRows.push({ label: labels.tax, value: cus.taxCode.trim() });
  if (cus.phone.trim()) cRows.push({ label: labels.phone, value: cus.phone.trim() });

  const contact = [profile.phone && `${labels.phone.a}: ${profile.phone}`, profile.email, profile.website].filter(Boolean).join('  ·  ');
  const place = (doc.place ?? profile.place).trim();
  const dl = dateLong(lang, doc.date);
  const withPlace = (s: string | undefined) => (s === undefined ? undefined : place ? `${place}${lang === 'zh' && s === dl.b ? '，' : ', '}${s}` : s);
  const fromProfileTitle = profile.signerTitle.trim();

  return {
    lang,
    company: { name: companyName, lines: [profile.address, profile.taxCode && `${labels.tax.a}: ${profile.taxCode}`, contact].filter(Boolean) as string[] },
    title: doc.title?.trim() ? { a: doc.title.trim() } : labels.title,
    number: doc.number.trim(),
    dateText: dateShort(doc.date),
    validUntilText: doc.validUntil ? dateShort(doc.validUntil) : '',
    customer: { name: cus.name.trim(), rows: cRows },
    labels,
    intro: doc.intro?.trim() ? { a: doc.intro.trim() } : defaultIntro(lang, companyName, referral),
    serviceLines: doc.serviceLines != null && doc.serviceLines.trim() ? trimLines(doc.serviceLines).map(a => ({ a })) : defaultServiceLines(lang, ctx.industry, referral),
    rows, includedNote: refCfg ? '' : includedText.trim(), terms: refCfg ? referralTerms(refCfg, lang, 'quote') : [], notes,
    closing: doc.closing?.trim() ? { a: doc.closing.trim() } : defaultClosing(lang),
    validText: doc.validUntil ? { a: `${labels.valid.a}: ${dateShort(doc.validUntil)}`, b: labels.valid.b ? `${labels.valid.b}: ${dateShort(doc.validUntil)}` : undefined } : null,
    placeDate: { a: withPlace(dl.a) ?? '', b: withPlace(dl.b) },
    signer: {
      title: labels.signTitle, role: (doc.signerTitle ?? fromProfileTitle).trim(), name: (doc.signerName ?? profile.signerName).trim(),
    },
  };
}

export interface DocIssue { level: 'error' | 'warn'; text: string }

/** Những chỗ nên xem lại trước khi gửi khách — không chặn xuất, chỉ nhắc. */
export function docIssues(doc: QuoteDoc, view: DocView, profile: CompanyProfileData, opts: { sign: boolean; seal: boolean }): DocIssue[] {
  const out: DocIssue[] = [];
  if (!view.customer.name) out.push({ level: 'error', text: 'Chưa điền tên khách hàng (mục “Kính gửi”).' });
  if (!view.rows.length) out.push({ level: 'error', text: 'Bảng giá chưa có dòng nào hiển thị.' });
  const zero = view.rows.filter(r => r.price <= 0);
  if (zero.length) out.push({ level: 'error', text: `${zero.length} dòng giá đang bằng 0 (${zero.map(r => r.name.a).slice(0, 2).join('; ')}${zero.length > 2 ? '…' : ''}).` });
  if (!profile.name.trim()) out.push({ level: 'warn', text: 'Chưa có tên công ty gửi báo giá — đang ghi “Let’s Go VN”. Điền ở mục “Công ty & chữ ký”.' });
  if (!profile.address.trim() || !profile.taxCode.trim()) out.push({ level: 'warn', text: 'Thiếu địa chỉ hoặc mã số thuế của công ty trên đầu trang.' });
  if (doc.validUntil && doc.validUntil < doc.date) out.push({ level: 'warn', text: 'Ngày hết hiệu lực sớm hơn ngày báo giá.' });
  if ((opts.sign || opts.seal) && !view.signer.name) out.push({ level: 'warn', text: 'Đang chèn chữ ký/con dấu nhưng chưa có tên người đại diện.' });
  if (!doc.number.trim()) out.push({ level: 'warn', text: 'Chưa có số báo giá.' });
  return out;
}

export function docFileName(view: DocView): string {
  const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/Đ/g, 'D').replace(/đ/g, 'd').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return [`Bao-gia`, slug(view.customer.name).slice(0, 40), slug(view.number)].filter(Boolean).join('-') + '.pdf';
}
