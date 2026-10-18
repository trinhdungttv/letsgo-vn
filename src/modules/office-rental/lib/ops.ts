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

export type ContractState = 'none' | 'active' | 'soon' | 'urgent' | 'expired' | 'ended';

export function contractState(t: Pick<BdsTenant, 'active' | 'contract_end'>, today: string, alertDays: number): { state: ContractState; days: number | null } {
  if (!t.active) return { state: 'ended', days: null };
  if (!t.contract_end) return { state: 'none', days: null };
  const days = daysBetween(today, t.contract_end);
  if (days < 0) return { state: 'expired', days };
  if (days <= 30) return { state: 'urgent', days };
  if (days <= alertDays) return { state: 'soon', days };
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

// ── Cảnh báo tổng quan ────────────────────────────────────────────────────

export interface OpsAlert {
  key: string;
  tone: 'red' | 'amber' | 'blue';
  text: string;
  target: 'contracts' | 'invoices' | 'rooms' | 'revenue' | 'tickets';
}

export function buildAlerts(input: {
  tenants: BdsTenant[];
  rooms: BdsRoom[];
  invoices: BdsInvoice[];
  openTickets: number;
  today: string;
  alertDays: number;
  exchangeRate: number;
  opsReady: boolean;
}): OpsAlert[] {
  const out: OpsAlert[] = [];
  const { today } = input;
  const nameOf = new Map(input.tenants.map(t => [t.id, t.name]));

  if (input.opsReady) {
    for (const t of input.tenants) {
      const c = contractState(t, today, input.alertDays);
      if (c.state === 'expired') out.push({ key: `c-${t.id}`, tone: 'red', target: 'contracts', text: `${t.name}: hợp đồng đã hết hạn ${-c.days!} ngày (vẫn đang thuê)` });
      else if (c.state === 'urgent') out.push({ key: `c-${t.id}`, tone: 'red', target: 'contracts', text: `${t.name}: hết hợp đồng sau ${c.days} ngày` });
      else if (c.state === 'soon') out.push({ key: `c-${t.id}`, tone: 'amber', target: 'contracts', text: `${t.name}: hết hợp đồng sau ${c.days} ngày` });
    }
    for (const inv of input.invoices) {
      const st = invoiceState(inv, today);
      if (st.state === 'overdue') {
        out.push({ key: `i-${inv.id}`, tone: 'red', target: 'invoices', text: `${nameOf.get(inv.tenant_id) || 'Khách'}: hoá đơn T${Number(inv.month.slice(5, 7))}/${inv.month.slice(0, 4)} quá hạn ${st.overdueDays} ngày` });
      }
    }
    for (const r of input.rooms) {
      if (effectiveRoomStatus(r, input.tenants) !== 'vacant') continue;
      const price = Number(r.list_price) || 0;
      const vnd = r.list_currency === 'USD' ? price * input.exchangeRate : price;
      out.push({
        key: `r-${r.id}`, tone: 'amber', target: 'rooms',
        text: `${r.code}${r.name ? ` (${r.name})` : ''} đang trống${vnd > 0 ? ` — bỏ phí ~${(vnd / 1e6).toLocaleString('en-US', { maximumFractionDigits: 1 })} tr/tháng` : ''}`,
      });
    }
    if (input.openTickets > 0) out.push({ key: 'tickets', tone: 'blue', target: 'tickets', text: `${input.openTickets} sự cố đang mở` });
  }
  const unassigned = input.tenants.filter(t => t.active && !t.head_lease_id);
  if (unassigned.length) {
    out.push({ key: 'unassigned', tone: 'amber', target: 'revenue', text: `${unassigned.length} khách chưa gán mặt bằng: ${unassigned.map(t => t.name).join(', ')}` });
  }
  const rank = { red: 0, amber: 1, blue: 2 } as const;
  return out.sort((a, b) => rank[a.tone] - rank[b.tone]);
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
