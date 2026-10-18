// Kiểu dòng dữ liệu của các bảng bds_* (khớp migration 164 + 165).
import type { Currency, Landlord, VatCategory, VatMode } from './calc/types';

export interface BdsSettings {
  id: 1;
  exchange_rate: number;
  vat_rate_rent: number;
  vat_rate_util: number;
  parking_price_moto: number;
  parking_price_car: number;
  start_month: string;
  range_months: number;
  include_forecast_in_cost: boolean;
  hide_empty_months: boolean;
  show_fee_panel: boolean;
  // ── migration 165 (vận hành) ──
  electricity_unit_price?: number;
  invoice_due_day?: number;
  invoice_footer?: string | null;
  alert_days?: number;
  updated_at?: string;
}

export interface BdsHeadLease {
  id: string;
  landlord: Landlord;
  name: string;
  currency: Currency;
  base_price: number;
  base_month: string;
  end_month: string | null;
  vat_mode: VatMode;
  vat_category: VatCategory;
  is_parking: boolean;
  sort_order: number;
  note: string | null;
}

export interface BdsIncrease {
  id: string;
  head_lease_id: string;
  effective_month: string;
  percent: number;
}

export interface BdsTenant {
  id: string;
  name: string;
  currency: Currency;
  vat_mode: VatMode;
  head_lease_id: string | null;
  area_m2: number | null;
  active: boolean;
  sort_order: number;
  note: string | null;
  // ── migration 165 (hợp đồng) ──
  room_id?: string | null;
  contract_code?: string | null;
  contract_start?: string | null;
  contract_end?: string | null;
  deposit_amount?: number | null;
  deposit_currency?: Currency;
  contact_name?: string | null;
  contact_phone?: string | null;
}

export interface BdsTenantRent {
  tenant_id: string;
  month: string;
  amount: number;
}

export interface BdsTenantFee {
  tenant_id: string;
  month: string;
  electricity_amount: number;
  motorbike_count: number;
  car_count: number;
}

export interface BdsOpexCategory {
  id: string;
  name: string;
  vat_mode: VatMode;
  vat_category: VatCategory;
  sort_order: number;
  active: boolean;
}

export interface BdsOpexMonthly {
  category_id: string;
  month: string;
  amount: number;
}

export interface BdsForecast {
  id: string;
  name: string;
  month: string;
  amount: number;
  note: string | null;
}

export interface BdsScenario {
  id: string;
  name: string;
  head_lease_id: string | null;
  reference_month: string | null;
  target_cost: number;
  extra_cost: number;
  parent_area_m2: number | null;
  note: string | null;
  created_at?: string;
}

export interface BdsScenarioRoom {
  id: string;
  scenario_id: string;
  name: string;
  area_m2: number;
  currency: Currency;
  price: number;
  vat_mode: VatMode;
  sort_order: number;
}

// ── Vận hành (migration 165) ──────────────────────────────────────────────

export type RoomStatus = 'vacant' | 'reserved' | 'occupied';

export interface BdsRoom {
  id: string;
  code: string;
  name: string | null;
  area_m2: number | null;
  head_lease_id: string | null;
  location: string | null;
  status: RoomStatus;
  list_price: number | null;
  list_currency: Currency;
  sort_order: number;
  note: string | null;
}

export interface BdsMeterReading {
  id: string;
  tenant_id: string;
  month: string;
  prev_reading: number;
  curr_reading: number;
  unit_price: number;
  applied_at: string | null;
  note: string | null;
}

export type InvoiceStatus = 'unpaid' | 'paid';

export interface BdsInvoice {
  id: string;
  tenant_id: string;
  month: string;
  invoice_no: string | null;
  status: InvoiceStatus;
  due_date: string | null;
  paid_at: string | null;
  paid_amount: number | null;
  note: string | null;
}

export type AssetStatus = 'ok' | 'repairing' | 'maintenance' | 'broken' | 'retired';

export interface BdsAsset {
  id: string;
  code: string | null;
  name: string;
  room_id: string | null;
  location: string | null;
  installed_on: string | null;
  status: AssetStatus;
  drive_url: string | null;
  note: string | null;
}

export type TicketStatus = 'open' | 'in_progress' | 'done' | 'cancelled';
export type TicketPriority = 'low' | 'normal' | 'high' | 'urgent';
export type TicketResponsibility = 'undecided' | 'building' | 'tenant';

export interface BdsTicket {
  id: string;
  ticket_no: number;
  title: string;
  room_id: string | null;
  asset_id: string | null;
  location: string | null;
  reported_by: string | null;
  reported_at: string;
  priority: TicketPriority;
  status: TicketStatus;
  step_done: number;
  responsibility: TicketResponsibility;
  estimated_cost: number | null;
  actual_cost: number | null;
  cost_approved_at: string | null;
  drive_url: string | null;
  closed_at: string | null;
  note: string | null;
}

export interface BdsMaintenanceLog {
  id: string;
  ticket_id: string;
  step: number | null;
  action: string;
  note: string | null;
  cost: number | null;
  actor: string | null;
  created_at: string;
}

// ── Thông báo (migration 166) ─────────────────────────────────────────────

export interface BdsNotificationState {
  event_key: string;
  status: 'dismissed' | 'snoozed';
  snooze_until: string | null;
  note?: string | null;
  updated_at?: string;
}

export interface BdsTables {
  bds_settings: BdsSettings;
  bds_head_leases: BdsHeadLease;
  bds_head_lease_increases: BdsIncrease;
  bds_tenants: BdsTenant;
  bds_tenant_rent: BdsTenantRent;
  bds_tenant_fees: BdsTenantFee;
  bds_opex_categories: BdsOpexCategory;
  bds_opex_monthly: BdsOpexMonthly;
  bds_forecast_expenses: BdsForecast;
  bds_breakeven_scenarios: BdsScenario;
  bds_breakeven_rooms: BdsScenarioRoom;
  bds_rooms: BdsRoom;
  bds_meter_readings: BdsMeterReading;
  bds_invoices: BdsInvoice;
  bds_assets: BdsAsset;
  bds_tickets: BdsTicket;
  bds_maintenance_logs: BdsMaintenanceLog;
  bds_notification_states: BdsNotificationState;
}

export type TableName = keyof BdsTables;
export type IdTable = Exclude<TableName, 'bds_tenant_rent' | 'bds_tenant_fees' | 'bds_opex_monthly' | 'bds_notification_states'>;
export type CellTable = 'bds_tenant_rent' | 'bds_tenant_fees' | 'bds_opex_monthly';

export const CORE_TABLES = [
  'bds_settings', 'bds_head_leases', 'bds_head_lease_increases', 'bds_tenants', 'bds_tenant_rent',
  'bds_tenant_fees', 'bds_opex_categories', 'bds_opex_monthly', 'bds_forecast_expenses',
  'bds_breakeven_scenarios', 'bds_breakeven_rooms',
] as const satisfies readonly TableName[];

export const OPS_TABLES = [
  'bds_rooms', 'bds_meter_readings', 'bds_invoices', 'bds_assets', 'bds_tickets', 'bds_maintenance_logs',
] as const satisfies readonly TableName[];

export const NOTIFY_TABLES = ['bds_notification_states'] as const satisfies readonly TableName[];
