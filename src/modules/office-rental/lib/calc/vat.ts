import type { CalcSettings, Currency, VatCategory, VatMode } from './types';

/** Thuế suất (%) theo loại khoản. */
export function vatRateFor(settings: Pick<CalcSettings, 'vatRateRent' | 'vatRateUtil'>, category: VatCategory): number {
  return category === 'util' ? settings.vatRateUtil : settings.vatRateRent;
}

/** Số tiền thực trả/thu — dùng để tính lời/lỗ. `none` và `incl` giữ nguyên số nhập. */
export function gross(raw: number, mode: VatMode, ratePct: number): number {
  return mode === 'excl' ? raw * (1 + ratePct / 100) : raw;
}

/** Giá trước VAT (chỉ để hiển thị). */
export function net(raw: number, mode: VatMode, ratePct: number): number {
  return mode === 'incl' ? raw / (1 + ratePct / 100) : raw;
}

/** Tiền thuế VAT (chỉ để hiển thị). */
export function vatAmount(raw: number, mode: VatMode, ratePct: number): number {
  if (mode === 'none') return 0;
  if (mode === 'excl') return raw * (ratePct / 100);
  return raw - raw / (1 + ratePct / 100);
}

export function toVND(amount: number, currency: Currency, exchangeRate: number): number {
  return currency === 'USD' ? amount * exchangeRate : amount;
}
