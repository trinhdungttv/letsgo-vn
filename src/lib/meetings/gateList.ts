// "DANH SÁCH ĐĂNG KÝ RA VÀO CỔNG" — dựng dữ liệu (thuần, có test) cho bản xem trước / PDF / Excel.
// Bố cục theo đúng mẫu của công ty (file Excel "Danh_sach_dang_ky_ra_vao_cong_logo.xlsx"): đầu trang logo + tên
// pháp nhân + địa chỉ + điện thoại, tiêu đề lớn, bảng 9 cột, dòng "<nơi>, ngày … tháng … năm …", khối ký đóng dấu.
import type { CompanyProfileData } from '../costPlan/quoteDoc';
import { DEFAULT_HEADER, INDENT_PX, normalizeHeader, type HeaderLayout } from '../costPlan/entity';
import { foldVn } from '../companyMatch';
import type { GateExtraCol, GateOptions, Meeting, MeetingMember } from './types';

export const GATE_TITLE = 'DANH SÁCH ĐĂNG KÝ RA VÀO CỔNG';
export const SIGN_HINT = '(Ký, ghi rõ họ tên, đóng dấu)';

export interface GateRow {
  memberId: string;
  stt: string;
  name: string;
  gender: string;
  birth: string;
  idNumber: string;
  issuedOn: string;
  issuedBy: string;
  address: string;
  title: string;
  phone: string;
  plate: string;
}

export interface GateColumn {
  key: Exclude<keyof GateRow, 'memberId'>;
  label: string;
  /** Độ rộng cột Excel (ký tự) — lấy đúng từ file mẫu; bản xem trước chia tỉ lệ theo số này. */
  width: number;
  align: 'center' | 'left';
  bold?: boolean;
}

/** 9 cột như file mẫu (độ rộng cột Excel đúng như mẫu). */
export const BASE_COLUMNS: readonly GateColumn[] = [
  { key: 'stt', label: 'STT', width: 7, align: 'center' },
  { key: 'name', label: 'Họ và Tên', width: 28, align: 'left', bold: true },
  { key: 'gender', label: 'Giới tính', width: 11, align: 'center' },
  { key: 'birth', label: 'Năm sinh', width: 13, align: 'center' },
  { key: 'idNumber', label: 'Số CCCD', width: 19, align: 'center', bold: true },
  { key: 'issuedOn', label: 'Ngày cấp', width: 14, align: 'center' },
  { key: 'issuedBy', label: 'Nơi cấp', width: 16, align: 'center' },
  { key: 'address', label: 'Địa chỉ thường trú', width: 50, align: 'left' },
  { key: 'title', label: 'Chức vụ', width: 24, align: 'left', bold: true },
];

const EXTRA_COLUMNS: Record<GateExtraCol, GateColumn> = {
  phone: { key: 'phone', label: 'Số điện thoại', width: 15, align: 'center' },
  vehicle_plate: { key: 'plate', label: 'Biển số xe', width: 14, align: 'center', bold: true },
};
export const EXTRA_COL_LABEL: Record<GateExtraCol, string> = { phone: 'Số điện thoại', vehicle_plate: 'Biển số xe' };

/** Cột của bản in: 9 cột mẫu + cột thêm (SĐT, biển số xe) đặt sau cùng. "Năm sinh" đổi thành "Ngày sinh" khi có người ghi đủ ngày. */
export function gateColumns(rows: readonly GateRow[], extra: readonly GateExtraCol[] = []): GateColumn[] {
  const fullDate = rows.some(r => /\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}/.test(r.birth));
  const base = BASE_COLUMNS.map(c => (c.key === 'birth' && fullDate ? { ...c, label: 'Ngày sinh' } : c));
  const extras = (['phone', 'vehicle_plate'] as const).filter(k => extra.includes(k)).map(k => EXTRA_COLUMNS[k]);
  return [...base, ...extras];
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** yyyy-mm-dd → dd/mm/yyyy (chuỗi khác giữ nguyên). */
export function isoToVn(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : (iso ?? '');
}

/** Dòng bảng theo đúng thứ tự người tham dự đã xếp. Người không còn trong danh sách thành viên thì bỏ qua. */
export function buildGateRows(meeting: Pick<Meeting, 'attendees'>, members: readonly MeetingMember[]): GateRow[] {
  const byId = new Map(members.map(m => [m.id, m]));
  const rows: GateRow[] = [];
  for (const a of meeting.attendees) {
    const m = byId.get(a.id);
    if (!m) continue;
    rows.push({
      memberId: m.id,
      stt: pad2(rows.length + 1),
      name: m.full_name.trim(),
      gender: m.gender,
      birth: m.birth.trim(),
      idNumber: m.id_number.trim(),
      issuedOn: isoToVn(m.id_issued_on),
      issuedBy: m.id_issued_by.trim(),
      address: m.address.trim(),
      title: (a.title.trim() || m.title).trim(),
      phone: m.phone.trim(),
      plate: m.vehicle_plate.trim(),
    });
  }
  return rows;
}

/**
 * "Đồng Nai, ngày 10 tháng 11 năm 2026". Theo Nghị định 30/2020 (thể thức văn bản): ngày dưới 10 và tháng 1, 2
 * thêm số 0 phía trước ("ngày 05 tháng 02").
 */
export function gateDateLine(place: string, iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return place.trim();
  const d = Number(m[3]), mo = Number(m[2]);
  const ds = d < 10 ? pad2(d) : String(d);
  const ms = mo < 3 ? pad2(mo) : String(mo);
  const p = place.trim();
  return `${p ? `${p}, ` : ''}ngày ${ds} tháng ${ms} năm ${m[1]}`;
}

/** Đoán nơi ký từ địa chỉ: "…, Phường Long Bình, TP Đồng Nai, Việt Nam" → "Đồng Nai". */
export function guessPlace(address: string): string {
  const parts = address.split(',').map(s => s.trim()).filter(Boolean);
  while (parts.length && /^(viet nam|vietnam)$/.test(foldVn(parts[parts.length - 1]))) parts.pop();
  const last = parts[parts.length - 1] ?? '';
  return last.replace(/^(thành phố|tp\.?|tỉnh)\s*/i, '').trim();
}

/** Nơi ký: tuỳ chọn của buổi họp → "Nơi ký" của pháp nhân → đoán từ địa chỉ pháp nhân. */
export function resolvePlace(opts: GateOptions, profile: Pick<CompanyProfileData, 'place' | 'address'> | null): string {
  if (opts.place && opts.place.trim()) return opts.place.trim();
  if (profile?.place.trim()) return profile.place.trim();
  return profile ? guessPlace(profile.address) : '';
}

const WEEKDAY = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
export function weekdayOf(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return '';
  return WEEKDAY[new Date(y, m - 1, d).getDay()];
}

/** Thứ viết gọn trên ô lịch: T2…T7, CN. */
export function shortWeekday(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return '';
  const w = new Date(y, m - 1, d).getDay();
  return w === 0 ? 'CN' : `T${w + 1}`;
}

/** "08:30, Thứ Tư 11/11/2026" */
export function visitWhen(meeting: Pick<Meeting, 'meet_date' | 'meet_time'>): string {
  const day = `${weekdayOf(meeting.meet_date)} ${isoToVn(meeting.meet_date)}`.trim();
  return meeting.meet_time ? `${meeting.meet_time}, ${day}` : day;
}

/** Tên file như cách công ty đặt: "Danh sách Đăng ký vào cổng TTI - 11.11.2026.xlsx" (ngày = ngày họp). */
export function gateFileName(meeting: Pick<Meeting, 'meet_date' | 'company_name'>, ext: 'pdf' | 'xlsx'): string {
  const company = meeting.company_name.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
  const d = isoToVn(meeting.meet_date).replace(/\//g, '.');
  return `Danh sách Đăng ký vào cổng${company ? ` ${company}` : ''}${d ? ` - ${d}` : ''}.${ext}`;
}

/** Tên pháp nhân in hoa như mẫu ("CÔNG TY CỔ PHẦN LET'S GO VN"). */
export const upperVn = (s: string) => s.trim().toLocaleUpperCase('vi-VN');

/** Khung ký/đóng dấu chuẩn (px) — cùng cỡ với ô xem trước ở "Pháp nhân" để vị trí chữ ký/con dấu khớp nhau. */
export const STAMP_BOX = { w: 280, h: 112 };
/** Số dòng chừa cho chữ ký + con dấu (mỗi dòng 21,75pt như mẫu). */
export const SIGN_ROWS = 4;
export const SIGN_ROW_PT = 21.75;

/** Cột bắt đầu khối ký: từ cột "Nơi cấp" tới hết (mẫu: G:I). */
export function signStartCol(doc: GateDoc): number {
  const i = doc.columns.findIndex(c => c.key === 'issuedBy');
  return i >= 0 ? i + 1 : Math.max(1, doc.columns.length - 2);
}

/** Toàn bộ nội dung 1 bản danh sách — bản xem trước, PDF và Excel đều dựng từ đây. */
export interface GateDoc {
  /** Đầu trang (in hoa như mẫu) */
  companyName: string;
  address: string;
  phone: string;
  title: string;
  /** "" = không in */
  recipient: string;
  /** "" = không in */
  visit: string;
  columns: GateColumn[];
  rows: GateRow[];
  dateLine: string;
  signCompany: string;
  /** "" = không in tên dưới chỗ ký */
  signerName: string;
  /** Cỡ / vị trí logo, chữ đầu trang, tiêu đề */
  header: HeaderLayout;
}

/**
 * Kích thước đầu trang — DÙNG CHUNG cho bản xem trước / PDF và file Excel để 2 bản giống nhau.
 * Chiều cao dòng & cỡ chữ theo pt (như Excel), vị trí logo theo px của Excel (gốc = góc trên-trái ô A1).
 * Mẫu gốc: 4 dòng 30 / 24 / 24 / 24 pt (tên công ty 16pt đậm, địa chỉ 12pt, điện thoại 12pt đậm), logo 143×100 px
 * cách trái 12 px, trên 6 px; tiêu đề 24pt đậm cao 45,75 pt, cách khung đầu trang 9,75 pt.
 * Logo phóng to quá khung → dòng cuối đầu trang tự cao thêm cho đủ chỗ (không đè lên tiêu đề).
 */
export interface GateHeaderGeom {
  /** đệm phía trên khối chữ (pt) — 0 = không có dòng đệm */
  padTop: number;
  nameH: number; lineH: number; tail: number;
  nameSize: number; lineSize: number;
  logo: { x: number; y: number; w: number; h: number };
  align: 'left' | 'center' | 'right';
  /** số nấc thụt lề Excel (căn giữa = 0) */
  indent: number;
  titleGap: number; titleH: number; titleSize: number;
}
export function gateHeaderGeom(h: HeaderLayout): GateHeaderGeom {
  const hs = h.headScale;
  const padTop = h.headDy * 0.75;
  const nameH = 30 * hs, lineH = 24 * hs;
  const logo = { x: 12 + h.logoDx, y: 6 + h.logoDy, w: 143 * h.logoScale, h: 100 * h.logoScale };
  const logoBottomPt = (logo.y + logo.h) * 0.75;
  const tail = Math.max(6, Math.max(102, logoBottomPt + 4) - (padTop + nameH + 2 * lineH));
  return {
    // cỡ chữ làm tròn số nguyên (Excel / ExcelJS chỉ giữ số nguyên) để bản xem trước khớp file Excel
    padTop, nameH, lineH, tail, nameSize: Math.round(16 * hs), lineSize: Math.round(12 * hs), logo,
    align: h.headAlign, indent: h.headAlign === 'center' ? 0 : 1 + Math.round(h.headDx / INDENT_PX),
    titleGap: Math.max(1, 9.75 + h.titleDy * 0.75), titleH: 45.75 * h.titleScale, titleSize: Math.round(24 * h.titleScale),
  };
}

export function buildGateDoc(a: {
  meeting: Pick<Meeting, 'attendees' | 'meet_date' | 'meet_time' | 'location' | 'purpose' | 'company_name'>;
  members: readonly MeetingMember[];
  profile: CompanyProfileData | null;
  options: GateOptions;
  /** yyyy-mm-dd — ngày ký mặc định */
  today: string;
  /** Đầu trang mặc định của pháp nhân — dùng khi buổi họp chưa chỉnh riêng (options.header) */
  entityHeader?: HeaderLayout | null;
}): GateDoc {
  const { meeting, profile, options } = a;
  const rows = buildGateRows(meeting, a.members);
  const name = upperVn(profile?.name ?? '');
  const phone = (profile?.phone ?? '').trim();
  const visitParts = [
    `Thời gian: ${visitWhen(meeting)}`,
    meeting.location.trim() ? `Địa điểm: ${meeting.location.trim()}` : '',
    meeting.purpose.trim() ? `Nội dung: ${meeting.purpose.trim()}` : '',
  ].filter(Boolean);
  return {
    companyName: name,
    address: profile?.address.trim() ? `Địa chỉ: ${profile.address.trim()}` : '',
    phone: phone ? `Điện thoại: ${phone}` : '',
    title: (options.title ?? '').trim() || GATE_TITLE,
    recipient: (options.recipient ?? '').trim() ? `Kính gửi: ${(options.recipient ?? '').trim().replace(/^kính gửi\s*:?\s*/i, '')}` : '',
    visit: options.showVisit ? visitParts.join('   ·   ') : '',
    columns: gateColumns(rows, options.extraCols ?? []),
    rows,
    dateLine: gateDateLine(resolvePlace(options, profile), options.docDate || a.today),
    signCompany: name,
    signerName: options.showSigner === false ? '' : (profile?.signerName ?? '').trim(),
    header: normalizeHeader(options.header) ?? normalizeHeader(a.entityHeader) ?? DEFAULT_HEADER,
  };
}

/** Những chỗ còn thiếu / đáng ngờ trước khi gửi danh sách cho bảo vệ. */
export function gateIssues(rows: readonly GateRow[], ctx: { entityMissing: boolean }): string[] {
  const out: string[] = [];
  if (ctx.entityMissing) out.push('Chưa chọn pháp nhân đứng tên danh sách');
  if (!rows.length) out.push('Chưa có thành viên tham dự');
  for (const r of rows) {
    const miss: string[] = [];
    const bad: string[] = [];
    if (!r.idNumber) miss.push('số CCCD');
    else {
      const digits = r.idNumber.replace(/\D/g, '');
      if (digits.length !== 12) bad.push(`số CCCD có ${digits.length} chữ số (CCCD phải đủ 12 số)`);
    }
    if (!r.issuedOn) miss.push('ngày cấp');
    if (!r.gender) miss.push('giới tính');
    if (!r.birth) miss.push('năm sinh');
    if (!r.address) miss.push('địa chỉ thường trú');
    const parts = [miss.length ? `thiếu ${miss.join(', ')}` : '', ...bad].filter(Boolean);
    if (parts.length) out.push(`${r.name}: ${parts.join('; ')}`);
  }
  return out;
}
