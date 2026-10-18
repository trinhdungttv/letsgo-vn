import type { Currency } from './types';

/** Làm tròn nửa xa số 0 (−24.45 → −24.5, giống cách kế toán làm tròn). */
export function roundHalfAway(v: number, digits = 0): number {
  const f = 10 ** digits;
  const r = Math.sign(v) * Math.round(Math.abs(v) * f) / f;
  return Object.is(r, -0) ? 0 : r;
}

/** 5997000 → '5,997,000đ' (làm tròn đồng) */
export function fmtVND(n: number | null | undefined, suffix = 'đ'): string {
  return roundHalfAway(n || 0).toLocaleString('en-US') + suffix;
}

/** 3680.5 → '$3,680.5' (tối đa 2 số lẻ) */
export function fmtUSD(n: number | null | undefined): string {
  const v = n || 0;
  const s = Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 2 });
  return (v < 0 ? '-$' : '$') + s;
}

export function fmtMoney(n: number | null | undefined, currency: Currency): string {
  return currency === 'USD' ? fmtUSD(n) : fmtVND(n);
}

/** Đơn vị triệu, 1 số lẻ — chỉ dùng ở bảng tổng quan. 363527000 → '363.5' */
export function fmtTr(n: number | null | undefined): string {
  return roundHalfAway((n || 0) / 1e6, 1).toLocaleString('en-US', { maximumFractionDigits: 1 });
}

/** Số nguyên có dấu phẩy, không hậu tố (ô nhập, bảng). Ô trống khi = 0 nếu blankZero. */
export function fmtNum(n: number | null | undefined, blankZero = false): string {
  if (blankZero && !n) return '';
  return roundHalfAway(n || 0).toLocaleString('en-US');
}

/**
 * Định dạng chuỗi đang gõ trong ô tiền. VND: chỉ nhận số nguyên. USD: tối đa 2 số lẻ.
 * Gõ '5997000' → '5,997,000'; gõ lại trên '5,997,000' vẫn giữ nguyên.
 */
export function formatMoneyInput(text: string, currency: Currency): { text: string; raw: number } {
  if (currency === 'USD') {
    let clean = text.replace(/[^\d.]/g, '');
    const firstDot = clean.indexOf('.');
    if (firstDot !== -1) clean = clean.slice(0, firstDot + 1) + clean.slice(firstDot + 1).replace(/\./g, '');
    const [ip, dpRaw] = clean.split('.');
    const dp = dpRaw !== undefined ? dpRaw.slice(0, 2) : undefined;
    const intPart = ip ? Number(ip).toLocaleString('en-US') : (dp !== undefined ? '0' : '');
    const out = intPart + (dp !== undefined ? '.' + dp : '');
    const raw = clean && clean !== '.' ? Number(`${ip || '0'}.${dp || '0'}`) : 0;
    return { text: out, raw };
  }
  const digits = text.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  if (!digits) return { text: '', raw: 0 };
  const raw = Number(digits);
  return { text: raw.toLocaleString('en-US'), raw };
}

/** Hiển thị giá trị đã lưu vào ô nhập (ô trống khi = 0). */
export function moneyInputText(value: number | null | undefined, currency: Currency): string {
  if (!value) return '';
  return currency === 'USD'
    ? value.toLocaleString('en-US', { maximumFractionDigits: 2 })
    : Math.round(value).toLocaleString('en-US');
}

/** Làm tròn đúng số lẻ cho phép trước khi lưu (VND: đồng, USD: cent). */
export function roundForCurrency(value: number, currency: Currency): number {
  return currency === 'USD' ? Math.round(value * 100) / 100 : Math.round(value);
}
