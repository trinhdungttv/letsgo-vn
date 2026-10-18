import type { CalcSettings, Currency, VatMode } from './types';
import { gross, toVND } from './vat';

export interface BreakevenRoomInput {
  name: string;
  area: number;
  currency: Currency;
  price: number;
  vatMode: VatMode;
}

export interface BreakevenRoomResult extends BreakevenRoomInput {
  /** Doanh thu gộp của phòng (gross, VNĐ) */
  revenueVND: number;
  /** Giá đề xuất / m² theo tiền tệ của phòng */
  pricePerM2: number | null;
  /** Giá sàn (VNĐ thực thu) = mục tiêu × m² phòng / tổng m² */
  floorVND: number | null;
  /** Giá sàn quy về đúng "kiểu số" anh nhập ở cột giá (cùng tiền tệ, trước VAT nếu chọn chưa gồm VAT) */
  floorQuote: number | null;
  floorPerM2VND: number | null;
  /** Dư/thiếu của riêng phòng so với giá sàn */
  diffVND: number | null;
}

export interface BreakevenResult {
  target: number;
  totalArea: number;
  rooms: BreakevenRoomResult[];
  totalRevenue: number;
  /** Dương = dư (lời), âm = thiếu (lỗ) */
  diff: number;
  /** Có nhập diện tích gốc và tổng m² các phòng lệch */
  areaMismatch: { parent: number; rooms: number } | null;
}

export function computeBreakeven(input: {
  targetCost: number;
  extraCost: number;
  parentArea?: number | null;
  rooms: BreakevenRoomInput[];
  settings: Pick<CalcSettings, 'exchangeRate' | 'vatRateRent'>;
}): BreakevenResult {
  const { settings } = input;
  const target = (input.targetCost || 0) + (input.extraCost || 0);
  const totalArea = input.rooms.reduce((a, r) => a + (r.area || 0), 0);
  const rate = settings.vatRateRent;

  const rooms = input.rooms.map((r): BreakevenRoomResult => {
    const revenueVND = toVND(gross(r.price || 0, r.vatMode, rate), r.currency, settings.exchangeRate);
    const floorVND = totalArea > 0 ? target * (r.area || 0) / totalArea : null;
    let floorQuote: number | null = null;
    if (floorVND !== null) {
      const preVat = r.vatMode === 'excl' ? floorVND / (1 + rate / 100) : floorVND;
      floorQuote = r.currency === 'USD' ? (settings.exchangeRate > 0 ? preVat / settings.exchangeRate : null) : preVat;
    }
    return {
      ...r,
      revenueVND,
      pricePerM2: r.area > 0 ? (r.price || 0) / r.area : null,
      floorVND,
      floorQuote,
      floorPerM2VND: floorVND !== null && r.area > 0 ? floorVND / r.area : null,
      diffVND: floorVND !== null ? revenueVND - floorVND : null,
    };
  });
  const totalRevenue = rooms.reduce((a, r) => a + r.revenueVND, 0);
  const parent = input.parentArea || 0;
  return {
    target,
    totalArea,
    rooms,
    totalRevenue,
    diff: totalRevenue - target,
    areaMismatch: parent > 0 && Math.abs(totalArea - parent) > 0.005 ? { parent, rooms: totalArea } : null,
  };
}
