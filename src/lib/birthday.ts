// ============================================================================
// Ngày sinh của CHÍNH người liên hệ (cột contacts.birthday, kiểu DATE) — dùng chung cho
// form đầy đủ, tạo nhanh, thẻ xem nhanh, CSKH. Hàm thuần, có test (birthday.test.ts).
// ----------------------------------------------------------------------------
// Nhiều khách chỉ biết NGÀY + THÁNG sinh. Cột DATE bắt buộc có năm nên khi không rõ năm,
// app lưu năm giữ chỗ NO_YEAR = 1604 (cùng quy ước "bỏ năm" của Danh bạ Apple; 1604 là năm
// nhuận nên 29/02 vẫn lưu được). Không cần migration, sinh nhật đang có giữ nguyên.
// Đọc ra: năm ngoài 1900–2100 (gồm 1604) = "không rõ năm" → không hiện năm, không tính tuổi.
//
// Ô nhập (BirthdayInput) giữ cả trạng thái đang gõ dở trong cùng chuỗi: chuỗi bắt đầu bằng
// '~' ("~ngày/tháng/năm") là bản nháp chưa hợp lệ — saveContact sẽ báo lỗi thay vì lưu
// nhầm thành "không có ngày sinh" (tránh mất sinh nhật đang có khi xoá dở 1 ô).
// ============================================================================

/** Năm giữ chỗ khi không rõ năm sinh. */
export const NO_YEAR = 1604;
const MIN_REAL_YEAR = 1900;
const MAX_REAL_YEAR = 2100;

export interface BirthdayParts {
  day: number;
  month: number;
  /** null = không rõ năm. */
  year: number | null;
}

const pad = (n: number, len = 2) => String(n).padStart(len, '0');
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})/;

/** Ngày có thật không — không rõ năm thì kiểm theo năm nhuận (29/02 hợp lệ). */
export function isRealDayMonth(day: number, month: number, year: number | null): boolean {
  if (!Number.isInteger(day) || !Number.isInteger(month) || month < 1 || month > 12 || day < 1) return false;
  return day <= new Date(Date.UTC(year ?? 2000, month, 0)).getUTCDate();
}

/** Năm đọc từ DB có phải năm sinh thật không (năm giữ chỗ / năm lạ → không). */
export const isRealBirthYear = (y: number): boolean => y >= MIN_REAL_YEAR && y <= MAX_REAL_YEAR;

/** "YYYY-MM-DD" (DB) → ngày/tháng/năm; năm giữ chỗ → null. Rỗng / nháp / hỏng → null. */
export function parseBirthday(raw: string | null | undefined): BirthdayParts | null {
  const m = raw ? ISO_RE.exec(raw.trim()) : null;
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (!isRealDayMonth(d, mo, null)) return null;
  return { day: d, month: mo, year: isRealBirthYear(y) ? y : null };
}

/** Giá trị ghi DB: không rõ năm → năm giữ chỗ 1604. */
export function birthdayValue(p: BirthdayParts): string {
  return `${pad(p.year ?? NO_YEAR, 4)}-${pad(p.month)}-${pad(p.day)}`;
}

/** Có ghi năm sinh thật không. */
export const hasBirthYear = (raw: string | null | undefined): boolean => parseBirthday(raw)?.year != null;

/** "15/03/1985" · không rõ năm → "15/03". Rỗng / hỏng → ''. */
export function formatBirthday(raw: string | null | undefined): string {
  const p = parseBirthday(raw);
  if (!p) return '';
  return `${pad(p.day)}/${pad(p.month)}${p.year !== null ? `/${p.year}` : ''}`;
}

/** Tuổi hiện tại (tính tới `today` "YYYY-MM-DD"); không rõ năm → null. */
export function birthdayAge(raw: string | null | undefined, today: string): number | null {
  const p = parseBirthday(raw);
  if (!p || p.year === null) return null;
  const [ty, tm, td] = today.split('-').map(Number);
  const age = ty - p.year - (tm < p.month || (tm === p.month && td < p.day) ? 1 : 0);
  return age >= 0 && age < 130 ? age : null;
}

// ── Ô nhập Ngày / Tháng / Năm ───────────────────────────────────────────────
/** Trạng thái ô nhập: ngày, tháng (null = chưa chọn) và chữ năm đang gõ ('' = không rõ năm). */
export interface BirthdayDraft {
  day: number | null;
  month: number | null;
  yearText: string;
}

export const DRAFT_PREFIX = '~';
export const isBirthdayDraft = (v: string | null | undefined): boolean => !!v && v.startsWith(DRAFT_PREFIX);

/** Chuỗi trong form → trạng thái ô nhập (đọc được cả giá trị DB lẫn bản nháp '~d/m/y'). */
export function draftOfBirthday(v: string | null | undefined): BirthdayDraft {
  if (!v) return { day: null, month: null, yearText: '' };
  if (isBirthdayDraft(v)) {
    const [d = '', m = '', y = ''] = v.slice(1).split('/');
    return { day: d ? Number(d) || null : null, month: m ? Number(m) || null : null, yearText: y.replace(/\D/g, '').slice(0, 4) };
  }
  const m = ISO_RE.exec(v.trim());
  if (!m) return { day: null, month: null, yearText: '' };
  const y = Number(m[1]);
  // Năm lạ đang có trong DB (không phải năm giữ chỗ) vẫn hiện ra để người dùng thấy mà sửa
  return { day: Number(m[3]), month: Number(m[2]), yearText: y === NO_YEAR ? '' : m[1] };
}

/** Lỗi của ô nhập (null = hợp lệ hoặc để trống hẳn). */
export function birthdayDraftError(d: BirthdayDraft, currentYear: number): string | null {
  const year = d.yearText.trim();
  if (d.day === null && d.month === null && year === '') return null;
  if (d.day === null || d.month === null) return 'Chọn đủ ngày và tháng sinh (năm có thể bỏ trống)';
  if (!isRealDayMonth(d.day, d.month, null)) return `Không có ngày ${d.day}/${d.month}`;
  if (year === '') return null;
  if (!/^\d{4}$/.test(year)) return 'Năm sinh gõ đủ 4 số, hoặc để trống nếu không rõ';
  const y = Number(year);
  if (y < MIN_REAL_YEAR || y > currentYear) return `Năm sinh ${y} không hợp lệ`;
  if (!isRealDayMonth(d.day, d.month, y)) return `Năm ${y} không có ngày ${d.day}/${d.month}`;
  return null;
}

/** Trạng thái ô nhập → chuỗi lưu trong form: '' · "YYYY-MM-DD" · bản nháp '~d/m/y' khi chưa hợp lệ. */
export function birthdayOfDraft(d: BirthdayDraft, currentYear: number): string {
  const year = d.yearText.trim();
  if (d.day === null && d.month === null && year === '') return '';
  if (birthdayDraftError(d, currentYear) !== null) return `${DRAFT_PREFIX}${d.day ?? ''}/${d.month ?? ''}/${year}`;
  return birthdayValue({ day: d.day as number, month: d.month as number, year: year === '' ? null : Number(year) });
}

/**
 * Giá trị ngày sinh để ghi DB. '' → null; bản nháp chưa hợp lệ → ném lỗi đọc được (không lưu
 * nhầm thành "không có ngày sinh"); giá trị đang có trong DB giữ nguyên.
 */
export function birthdayForSave(v: string | null | undefined, currentYear: number): string | null {
  const s = (v ?? '').trim();
  if (!s) return null;
  if (isBirthdayDraft(s)) {
    throw new Error(`Ngày sinh: ${birthdayDraftError(draftOfBirthday(s), currentYear) ?? 'chưa hợp lệ'}`);
  }
  const m = ISO_RE.exec(s);
  if (!m || !isRealDayMonth(Number(m[3]), Number(m[2]), null)) throw new Error('Ngày sinh không hợp lệ');
  return s.slice(0, 10);
}
