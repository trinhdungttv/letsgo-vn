// ============================================================================
// CSKH — Âm lịch Việt Nam (múi giờ +7)
// ----------------------------------------------------------------------------
// Port NGUYÊN từ PRM Tony Study (src/lib/prm/lunar.ts): thuật toán thiên văn
// của Hồ Ngọc Đức (https://www.informatik.uni-leipzig.de/~duc/amlich/).
// Dùng cho sự kiện lặp lại hằng năm theo âm lịch (đám giỗ, sinh nhật âm, lễ tết)
// trong contact_special_dates (is_lunar = true).
//
// Quy ước: tháng nhuận chỉ dùng khi quy đổi nội bộ; sự kiện kỷ niệm hằng năm
// luôn lấy tháng CHÍNH (không nhuận) — đúng tập quán giỗ chạp Việt Nam.
// Hàm thuần: không đọc đồng hồ, không phụ thuộc múi giờ của máy.
// ============================================================================

const TIME_ZONE = 7;
const SYNODIC_MONTH = 29.530588853;
const JD_NEW_MOON_EPOCH = 2415021.076998695;

export interface LunarDate {
  day: number;
  month: number;
  year: number;
  isLeapMonth: boolean;
}

export interface SolarDate {
  day: number;
  month: number;
  year: number;
}

function int(d: number): number {
  return Math.floor(d);
}

/** Số ngày Julian của ngày dương lịch (0h UTC). */
export function jdFromDate(day: number, month: number, year: number): number {
  const a = int((14 - month) / 12);
  const y = year + 4800 - a;
  const m = month + 12 * a - 3;
  let jd =
    day + int((153 * m + 2) / 5) + 365 * y + int(y / 4) - int(y / 100) + int(y / 400) - 32045;
  if (jd < 2299161) {
    jd = day + int((153 * m + 2) / 5) + 365 * y + int(y / 4) - 32083;
  }
  return jd;
}

/** Ngày dương lịch từ số ngày Julian. */
export function jdToDate(jd: number): SolarDate {
  let a: number;
  let b: number;
  let c: number;
  if (jd > 2299160) {
    a = jd + 32044;
    b = int((4 * a + 3) / 146097);
    c = a - int((b * 146097) / 4);
  } else {
    b = 0;
    c = jd + 32082;
  }
  const d = int((4 * c + 3) / 1461);
  const e = c - int((1461 * d) / 4);
  const m = int((5 * e + 2) / 153);
  return {
    day: e - int((153 * m + 2) / 5) + 1,
    month: m + 3 - 12 * int(m / 10),
    year: b * 100 + d - 4800 + int(m / 10),
  };
}

/** Thời điểm trăng mới (new moon) thứ k kể từ 1/1/1900, đơn vị ngày Julian. */
function newMoon(k: number): number {
  const t = k / 1236.85;
  const t2 = t * t;
  const t3 = t2 * t;
  const dr = Math.PI / 180;
  let jd1 = 2415020.75933 + 29.53058868 * k + 0.0001178 * t2 - 0.000000155 * t3;
  jd1 += 0.00033 * Math.sin((166.56 + 132.87 * t - 0.009173 * t2) * dr);
  const m = 359.2242 + 29.10535608 * k - 0.0000333 * t2 - 0.00000347 * t3;
  const mpr = 306.0253 + 385.81691806 * k + 0.0107306 * t2 + 0.00001236 * t3;
  const f = 21.2964 + 390.67050646 * k - 0.0016528 * t2 - 0.00000239 * t3;
  let c1 = (0.1734 - 0.000393 * t) * Math.sin(m * dr) + 0.0021 * Math.sin(2 * dr * m);
  c1 = c1 - 0.4068 * Math.sin(mpr * dr) + 0.0161 * Math.sin(dr * 2 * mpr);
  c1 = c1 - 0.0004 * Math.sin(dr * 3 * mpr);
  c1 = c1 + 0.0104 * Math.sin(dr * 2 * f) - 0.0051 * Math.sin(dr * (m + mpr));
  c1 = c1 - 0.0074 * Math.sin(dr * (m - mpr)) + 0.0004 * Math.sin(dr * (2 * f + m));
  c1 = c1 - 0.0004 * Math.sin(dr * (2 * f - m)) - 0.0006 * Math.sin(dr * (2 * f + mpr));
  c1 = c1 + 0.001 * Math.sin(dr * (2 * f - mpr)) + 0.0005 * Math.sin(dr * (2 * mpr + m));
  let deltat: number;
  if (t < -11) {
    deltat =
      0.001 + 0.000839 * t + 0.0002261 * t2 - 0.00000845 * t3 - 0.000000081 * t * t3;
  } else {
    deltat = -0.000278 + 0.000265 * t + 0.000262 * t2;
  }
  return jd1 + c1 - deltat;
}

/** Ngày (theo múi giờ địa phương) chứa thời điểm trăng mới thứ k. */
function getNewMoonDay(k: number, timeZone: number): number {
  return int(newMoon(k) + 0.5 + timeZone / 24);
}

/** Kinh độ mặt trời tại ngày dayNumber, trả về chỉ số cung hoàng đạo 0-11 (mỗi cung 30 độ). */
function getSunLongitude(dayNumber: number, timeZone: number): number {
  const t = (dayNumber - 0.5 - timeZone / 24 - 2451545.0) / 36525;
  const t2 = t * t;
  const dr = Math.PI / 180;
  const m = 357.5291 + 35999.0503 * t - 0.0001559 * t2 - 0.00000048 * t * t2;
  const l0 = 280.46645 + 36000.76983 * t + 0.0003032 * t2;
  let dl = (1.9146 - 0.004817 * t - 0.000014 * t2) * Math.sin(dr * m);
  dl = dl + (0.019993 - 0.000101 * t) * Math.sin(dr * 2 * m) + 0.00029 * Math.sin(dr * 3 * m);
  let l = (l0 + dl) * dr;
  l = l - Math.PI * 2 * int(l / (Math.PI * 2));
  return int((l / Math.PI) * 6);
}

/** Ngày bắt đầu tháng 11 âm lịch của năm dương lịch yy (tháng chứa Đông chí). */
function getLunarMonth11(yy: number, timeZone: number): number {
  const off = jdFromDate(31, 12, yy) - 2415021;
  const k = int(off / SYNODIC_MONTH);
  let nm = getNewMoonDay(k, timeZone);
  const sunLong = getSunLongitude(nm, timeZone);
  if (sunLong >= 9) {
    nm = getNewMoonDay(k - 1, timeZone);
  }
  return nm;
}

/** Vị trí tháng nhuận sau tháng 11 (a11). */
function getLeapMonthOffset(a11: number, timeZone: number): number {
  const k = int((a11 - JD_NEW_MOON_EPOCH) / SYNODIC_MONTH + 0.5);
  let last = 0;
  let i = 1;
  let arc = getSunLongitude(getNewMoonDay(k + i, timeZone), timeZone);
  do {
    last = arc;
    i += 1;
    arc = getSunLongitude(getNewMoonDay(k + i, timeZone), timeZone);
  } while (arc !== last && i < 14);
  return i - 1;
}

/** Đổi ngày dương lịch sang âm lịch (múi giờ Việt Nam +7). */
export function convertSolar2Lunar(day: number, month: number, year: number): LunarDate {
  const timeZone = TIME_ZONE;
  const dayNumber = jdFromDate(day, month, year);
  const k = int((dayNumber - JD_NEW_MOON_EPOCH) / SYNODIC_MONTH);
  let monthStart = getNewMoonDay(k + 1, timeZone);
  if (monthStart > dayNumber) {
    monthStart = getNewMoonDay(k, timeZone);
  }
  let a11 = getLunarMonth11(year, timeZone);
  let b11 = a11;
  let lunarYear: number;
  if (a11 >= monthStart) {
    lunarYear = year;
    a11 = getLunarMonth11(year - 1, timeZone);
  } else {
    lunarYear = year + 1;
    b11 = getLunarMonth11(year + 1, timeZone);
  }
  const lunarDay = dayNumber - monthStart + 1;
  const diff = int((monthStart - a11) / 29);
  let isLeapMonth = false;
  let lunarMonth = diff + 11;
  if (b11 - a11 > 365) {
    const leapMonthDiff = getLeapMonthOffset(a11, timeZone);
    if (diff >= leapMonthDiff) {
      lunarMonth = diff + 10;
      if (diff === leapMonthDiff) {
        isLeapMonth = true;
      }
    }
  }
  if (lunarMonth > 12) {
    lunarMonth -= 12;
  }
  if (lunarMonth >= 11 && diff < 4) {
    lunarYear -= 1;
  }
  return { day: lunarDay, month: lunarMonth, year: lunarYear, isLeapMonth };
}

/**
 * Đổi ngày âm lịch sang dương lịch (múi giờ +7). isLeapMonth chỉ hợp lệ khi
 * năm đó thật sự có tháng nhuận trùng tên — ngược lại trả về null.
 */
export function convertLunar2Solar(
  lunarDay: number,
  lunarMonth: number,
  lunarYear: number,
  isLeapMonth: boolean,
): SolarDate | null {
  const timeZone = TIME_ZONE;
  let a11: number;
  let b11: number;
  if (lunarMonth < 11) {
    a11 = getLunarMonth11(lunarYear - 1, timeZone);
    b11 = getLunarMonth11(lunarYear, timeZone);
  } else {
    a11 = getLunarMonth11(lunarYear, timeZone);
    b11 = getLunarMonth11(lunarYear + 1, timeZone);
  }
  const k = int(0.5 + (a11 - JD_NEW_MOON_EPOCH) / SYNODIC_MONTH);
  let off = lunarMonth - 11;
  if (off < 0) {
    off += 12;
  }
  if (b11 - a11 > 365) {
    const leapOff = getLeapMonthOffset(a11, timeZone);
    let leapMonth = leapOff - 2;
    if (leapMonth < 0) {
      leapMonth += 12;
    }
    if (isLeapMonth && lunarMonth !== leapMonth) {
      return null;
    }
    if (isLeapMonth || off >= leapOff) {
      off += 1;
    }
  }
  const monthStart = getNewMoonDay(k + off, timeZone);
  return jdToDate(monthStart + lunarDay - 1);
}

// ── Tiện ích cho sự kiện lặp lại hằng năm ──────────────────────────────────

function toIso(d: SolarDate): string {
  const mm = String(d.month).padStart(2, '0');
  const dd = String(d.day).padStart(2, '0');
  return `${d.year}-${mm}-${dd}`;
}

function parseIso(iso: string): SolarDate {
  return {
    year: Number(iso.slice(0, 4)),
    month: Number(iso.slice(5, 7)),
    day: Number(iso.slice(8, 10)),
  };
}

function lastDayOfMonth(month: number, year: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Lần xảy ra kế tiếp (>= fromIso) của ngày âm lịch day/month, trả về ISO
 * dương lịch. Luôn dùng tháng chính (không nhuận). Nếu tháng âm năm đó chỉ
 * có 29 ngày mà sự kiện là ngày 30 thì lùi về ngày cuối tháng (tập quán giỗ
 * chạp: giỗ sớm một ngày, không dời sang tháng sau).
 */
function nextLunarOccurrence(day: number, month: number, fromIso: string): string {
  const from = parseIso(fromIso);
  const fromLunar = convertSolar2Lunar(from.day, from.month, from.year);
  for (let yearOffset = 0; yearOffset <= 2; yearOffset += 1) {
    const lunarYear = fromLunar.year + yearOffset;
    let solar = convertLunar2Solar(day, month, lunarYear, false);
    if (solar !== null) {
      // Tháng âm chỉ có 29 ngày: đổi qua lại bị lệch sang mùng 1 tháng sau → lùi 1 ngày
      const check = convertSolar2Lunar(solar.day, solar.month, solar.year);
      if (check.day !== day || check.month !== month) {
        solar = jdToDate(jdFromDate(solar.day, solar.month, solar.year) - 1);
      }
      const iso = toIso(solar);
      if (iso >= fromIso) {
        return iso;
      }
    }
  }
  // Không bao giờ tới đây với day/month hợp lệ; trả về fromIso cho an toàn kiểu
  return fromIso;
}

/** Lần xảy ra kế tiếp (>= fromIso) của ngày dương lịch day/month, trả về ISO. */
function nextSolarOccurrence(day: number, month: number, fromIso: string): string {
  const from = parseIso(fromIso);
  for (let yearOffset = 0; yearOffset <= 1; yearOffset += 1) {
    const year = from.year + yearOffset;
    // 29/02 năm thường → lùi về 28/02 (vẫn kỷ niệm, không bỏ qua)
    const clampedDay = Math.min(day, lastDayOfMonth(month, year));
    const iso = toIso({ day: clampedDay, month, year });
    if (iso >= fromIso) {
      return iso;
    }
  }
  return fromIso;
}

/**
 * Ngày dương lịch của lần kỷ niệm kế tiếp (>= fromIso) cho một sự kiện:
 * isLunar quyết định hệ lịch của day/month.
 */
export function nextOccurrenceIso(
  day: number,
  month: number,
  isLunar: boolean,
  fromIso: string,
): string {
  return isLunar
    ? nextLunarOccurrence(day, month, fromIso)
    : nextSolarOccurrence(day, month, fromIso);
}

/** Số ngày từ fromIso đến toIso2 (dương = tương lai). */
export function diffDays(fromIso: string, toIso2: string): number {
  const a = parseIso(fromIso);
  const b = parseIso(toIso2);
  return jdFromDate(b.day, b.month, b.year) - jdFromDate(a.day, a.month, a.year);
}

/** Cộng/trừ n ngày vào ngày "YYYY-MM-DD" (không phụ thuộc múi giờ). */
export function addDaysIso(iso: string, days: number): string {
  const d = parseIso(iso);
  return toIso(jdToDate(jdFromDate(d.day, d.month, d.year) + days));
}
