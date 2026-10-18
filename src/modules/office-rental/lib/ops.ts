// Logic vận hành thuần (không React/Supabase): trạng thái phòng, hợp đồng, hoá đơn, cảnh báo.
import type { CalcData, CalcTenant, MonthKey } from './calc/types';
import { feeOf, parkingRaw } from './calc/pl';
import { gross, toVND, vatAmount } from './calc/vat';
import type { BdsInvoice, BdsRoom, BdsTenant, RoomStatus } from './types';

/** 'YYYY-MM-DD' theo giờ máy (không lệch múi giờ như toISOString). */
export function todayStr(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** Số ngày từ a đến b (b − a), cả hai 'YYYY-MM-DD'. */
export function daysBetween(a: string, b: string): number {
  const [y1, m1, d1] = a.slice(0, 10).split('-').map(Number);
  const [y2, m2, d2] = b.slice(0, 10).split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

export function fmtDate(d: string | null | undefined): string {
  if (!d) return '—';
  const [y, m, dd] = d.slice(0, 10).split('-');
  return `${dd}/${m}/${y}`;
}

/** Hạn thanh toán mặc định: ngày `day` của chính tháng hoá đơn. */
export function defaultDueDate(month: MonthKey, day: number): string {
  return `${month}-${String(Math.min(Math.max(Math.round(day) || 10, 1), 28)).padStart(2, '0')}`;
}

// ── Phòng ─────────────────────────────────────────────────────────────────

export function roomTenants(room: Pick<BdsRoom, 'id'>, tenants: BdsTenant[]): BdsTenant[] {
  return tenants.filter(t => t.room_id === room.id && t.active);
}

/** Có khách đang thuê gán vào → "Đã thuê"; ngược lại theo cột status (trống / giữ chỗ). */
export function effectiveRoomStatus(room: BdsRoom, tenants: BdsTenant[]): RoomStatus {
  if (roomTenants(room, tenants).length) return 'occupied';
  return room.status === 'reserved' ? 'reserved' : 'vacant';
}

export function occupancy(rooms: BdsRoom[], tenants: BdsTenant[]): { total: number; occupied: number; rate: number | null } {
  let total = 0;
  let occupied = 0;
  for (const r of rooms) {
    const a = Number(r.area_m2) || 0;
    total += a;
    if (effectiveRoomStatus(r, tenants) === 'occupied') occupied += a;
  }
  return { total, occupied, rate: total > 0 ? occupied / total : null };
}

// ── Hợp đồng ──────────────────────────────────────────────────────────────

export type ContractState = 'none' | 'active' | 'notice' | 'soon' | 'urgent' | 'expired' | 'ended';

/** Mức nhắc hợp đồng: ≤ 30 ngày (khẩn) · ≤ 60 ngày (2 tháng) · ≤ horizon (mặc định 90 ngày = 3 tháng). */
export const CONTRACT_TIERS = { urgent: 30, soon: 60 } as const;

export function contractState(t: Pick<BdsTenant, 'active' | 'contract_end'>, today: string, horizonDays: number): { state: ContractState; days: number | null } {
  if (!t.active) return { state: 'ended', days: null };
  if (!t.contract_end) return { state: 'none', days: null };
  const days = daysBetween(today, t.contract_end);
  if (days < 0) return { state: 'expired', days };
  if (days <= CONTRACT_TIERS.urgent) return { state: 'urgent', days };
  if (days <= CONTRACT_TIERS.soon) return { state: 'soon', days };
  if (days <= Math.max(horizonDays, CONTRACT_TIERS.soon)) return { state: 'notice', days };
  return { state: 'active', days };
}

// ── Hoá đơn / đề nghị thanh toán ─────────────────────────────────────────

export interface InvoiceLine {
  net: number;
  vat: number;
  gross: number;
}

export interface InvoiceBreakdown {
  /** Tiền thuê theo tiền tệ của khách (số nhập) */
  rentInput: number;
  rent: InvoiceLine;
  electricity: InvoiceLine;
  parking: InvoiceLine;
  moto: number;
  car: number;
  vatTotal: number;
  total: number;
  isEmpty: boolean;
}

function line(raw: number, mode: CalcTenant['vatMode'], rate: number, currency: CalcTenant['currency'], fx: number): InvoiceLine {
  const g = toVND(gross(raw, mode, rate), currency, fx);
  const v = toVND(vatAmount(raw, mode, rate), currency, fx);
  return { net: g - v, vat: v, gross: g };
}

/** Số tiền hoá đơn LUÔN tính lại từ tiền thuê + phụ phí (không lưu bản sao) — khớp P&L. */
export function invoiceBreakdown(data: CalcData, m: MonthKey, t: CalcTenant): InvoiceBreakdown {
  const s = data.settings;
  const rentInput = data.rent[m]?.[t.id] || 0;
  const fee = feeOf(data, m, t.id);
  const rent = line(rentInput, t.vatMode, s.vatRateRent, t.currency, s.exchangeRate);
  const electricity = line(fee.electricity || 0, t.vatMode, s.vatRateUtil, 'VND', s.exchangeRate);
  const parking = line(parkingRaw(fee, s), t.vatMode, s.vatRateUtil, 'VND', s.exchangeRate);
  const total = rent.gross + electricity.gross + parking.gross;
  return {
    rentInput, rent, electricity, parking, moto: fee.moto || 0, car: fee.car || 0,
    vatTotal: rent.vat + electricity.vat + parking.vat, total, isEmpty: total === 0,
  };
}

export type InvoiceState = 'none' | 'unpaid' | 'overdue' | 'paid';

export function invoiceState(inv: Pick<BdsInvoice, 'status' | 'due_date'> | undefined, today: string): { state: InvoiceState; overdueDays: number } {
  if (!inv) return { state: 'none', overdueDays: 0 };
  if (inv.status === 'paid') return { state: 'paid', overdueDays: 0 };
  if (inv.due_date && inv.due_date < today) return { state: 'overdue', overdueDays: daysBetween(inv.due_date, today) };
  return { state: 'unpaid', overdueDays: 0 };
}

export const TICKET_STEPS = [
  { step: 1, title: 'Kiểm tra hiện trạng thiết bị', hint: 'trong 15–30 phút từ khi nhận tin' },
  { step: 2, title: 'Xác định lỗi & ai chịu chi phí', hint: 'hao mòn tự nhiên → tòa nhà chịu; lỗi sử dụng → khách chịu' },
  { step: 3, title: 'Đề xuất vật tư / báo giá & duyệt chi', hint: 'chốt số tiền dự kiến' },
  { step: 4, title: 'Tiến hành sửa chữa / thay thế', hint: 'ghi chi phí thực tế' },
  { step: 5, title: 'Nghiệm thu, đóng ticket & cập nhật Drive', hint: 'bắt buộc dán link Google Drive (ảnh nghiệm thu)' },
] as const;

export function ticketCode(no: number): string {
  return `TK-${String(no).padStart(4, '0')}`;
}
