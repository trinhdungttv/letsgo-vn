export interface AppUser {
  id: string;
  username: string;
  full_name: string;
  role: 'admin' | 'ketoan' | 'kinhdoanh' | 'bdh';
}

export interface Region {
  id: string;
  name: string;
  created_at: string;
}

export interface Manager {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  region: string | null;
  created_at: string;
}

export interface Client {
  id: string;
  name: string;
  region: string | null;
  manager: string | null;
  industrial_zones: string[];
  min_workers: number;
  cutoff_day: number;
  cutoff_day_end: number | null;
  calc_day: number;
  calc_day_end: number | null;
  payment_start: number;
  payment_end: number;
  salary_day: number;
  salary_day_end: number | null;
  next_month_pay: boolean;
  contract_start: string | null;
  contract_end: string | null;
  notes: string | null;
  status: 'ok' | 'warn' | 'danger';
  paid_this_month: boolean;
  prog_cutoff: boolean;
  prog_calc: boolean;
  prog_paid: boolean;
  created_at: string;
  updated_at: string;
  current_workers?: number;
  // Unified prospect/active fields
  client_type: 'prospect' | 'active';
  pipeline_stage: string | null;
  won_date: string | null;
  source: string | null;
  crm_owner: string | null;
  phone: string | null;
  email: string | null;
  prospect_status: 'lead' | 'prospect' | 'customer' | 'churned' | null;
  archived_at: string | null;
}

export interface LaborHistoryEntry {
  id: string;
  client_id: string;
  week_label: string;
  count: number;
  updated_by: string;
  created_at: string;
}

export interface FinanceRecord {
  id: string;
  client_id: string;
  month: string;
  revenue: number;
  cost_labor: number;
  cost_mgmt: number;
  cost_other: number;
  commission_rate: number;
  paid_status: boolean;
  paid_date: string | null;
  created_at: string;
  clients?: { name: string } | null;
}

export interface CSKHLog {
  id: string;
  client_id: string | null;
  client_name: string | null;
  contact_person: string | null;
  contact_type: string;
  content: string | null;
  followup: string | null;
  followup_done: boolean;
  log_date: string;
  created_at: string;
}

export interface CRMPipelineEntry {
  id: string;
  company_name: string;
  region: string | null;
  worker_estimate: number | null;
  workers_seasonal: number | null;
  workers_permanent: number | null;
  stage: string;
  sub_status: string | null;
  rating: string | null;
  preferences: string | null;
  last_contact: string | null;
  notes: string | null;
  created_at: string;
}

export interface CRMInteraction {
  id: string;
  crm_id: string;
  interaction_date: string;
  interaction_type: string;
  content: string | null;
  created_at: string;
}

export interface CRMGift {
  id: string;
  crm_id: string;
  gift_date: string;
  item_name: string | null;
  value: string | null;
  created_at: string;
}

export interface ClientGift {
  id: string;
  client_id: string;
  item_name: string;
  value: number | null;
  gift_date: string;
  notes: string | null;
  recipient_name: string | null;
  recipient_contact_id: string | null;
  created_by: string | null;
  created_at: string;
}

export type PipelineTaskStatus = 'pending' | 'in_progress' | 'done';

export interface CRMPipelineTask {
  id: string;
  crm_id: string;
  company_name: string;
  title: string;
  description: string | null;
  due_date: string | null;
  status: PipelineTaskStatus;
  created_at: string;
  updated_at: string;
}

export interface MarketSurvey {
  id: string;
  zone_name: string;
  survey_date: string;
  industry: string | null;
  wage_unskilled_min: number | null;
  wage_unskilled_max: number | null;
  wage_seasonal_min: number | null;
  wage_seasonal_max: number | null;
  wage_skilled_min: number | null;
  wage_skilled_max: number | null;
  wage_tech: number | null;
  labor_availability: string;
  occupancy: string | null;
  surveyed_by: string | null;
  notes: string | null;
  created_at: string;
}

export interface Competitor {
  id: string;
  zone_name: string;
  company_name: string;
  survey_date: string;
  wage_paid: number | null;
  fee_unskilled: number | null;
  fee_skilled: number | null;
  fee_tech: number | null;
  fee_per_shift: number | null;
  supplying_for: string[] | null;
  trend: string;
  notes: string | null;
  created_at: string;
}

export interface MarketZone {
  id: string;
  name: string;
  full_name: string | null;
  location: string | null;
  operator: string | null;
  area: string | null;
  established_year: string | null;
  occupancy_pct: number | null;
  total_companies: number | null;
  fdi_companies: number | null;
  total_workers: number | null;
  industries: string[] | null;
  countries: string[] | null;
  characteristics: string | null;
  strengths: string | null;
  weaknesses: string | null;
  labor_availability: string;
  lgv_clients: number;
  lgv_workers: number;
  potential: number;
  notes: string | null;
  updated_at: string;
  created_at: string;
}

export interface MarketLeadSupplier {
  name: string;
  qty: number;
  is_us: boolean;
}

export interface MarketLead {
  id: string;
  company_name: string;
  region: string | null;
  industry: string | null;
  workers_needed: number;
  source: string | null;
  lead_date: string;
  status: string;
  suppliers: MarketLeadSupplier[];
  created_at: string;
}

export interface Quote {
  id: string;
  client_name: string;
  tax_code: string | null;
  address: string | null;
  contact_person: string | null;
  labor_demand: string | null;
  zone: string | null;
  price_unskilled: number | null;
  price_skilled: number | null;
  price_tech: number | null;
  status: string;
  created_at: string;
}

export type Page = 'dashboard' | 'clients' | 'client-detail' | 'branches' | 'finance' | 'market' | 'quotes' | 'reports' | 'users' | 'history' | 'crm-dash' | 'crm-board' | 'crm-leads' | 'crm-prods' | 'crm-deal' | 'crm-pipeline';

export type AuditAction = 'insert' | 'update' | 'delete';

export interface AuditLogEntry {
  id: string;
  user_id: string | null;
  user_name: string | null;
  action: AuditAction;
  table_name: string;
  record_id: string;
  description: string | null;
  old_data: any;
  new_data: any;
  undone: boolean;
  created_at: string;
}

export interface DashboardTarget {
  id: string;
  scope: string; // 'total' or a region/branch name
  target_value: number;
  updated_at: string;
}

export type FinanceTimelineMode = 'clients' | 'payment';

export interface CRMProduct {
  id: string;
  name: string;
  price: number;
  sku: string | null;
  description: string | null;
  category: string | null;
  created_at: string;
}

export interface CRMDeal {
  id: string;
  title: string;
  lead_id: string | null;
  contact_id: string | null;
  product_id: string | null;
  value: number;
  stage: 'new' | 'contacted' | 'in_progress' | 'proposal' | 'won' | 'lost';
  owner: string | null;
  expected_closing_date: string | null;
  probability: number;
  notes: string | null;
  created_at: string;
  clients?: { name: string } | null;
  crm_leads?: { name: string; company: string | null } | null;
  crm_products?: { name: string } | null;
  contacts?: { name: string; phone: string | null } | null;
}

export interface CRMActivity {
  id: string;
  deal_id: string | null;
  type: 'call' | 'email' | 'note' | 'meeting';
  content: string | null;
  created_by: string | null;
  created_at: string;
}

export interface Contact {
  id: string;
  client_id: string | null;
  name: string;
  phone: string | null;
  email: string | null;
  role: string | null;
  start_date: string | null;
  end_date: string | null;
  is_active: boolean;
  is_primary: boolean;
  notes: string | null;
  address: string | null;
  birthday: string | null;
  hobbies: string | null;
  social_link: string | null;
  channel: string | null;
  rich_notes: string | null;
  created_at: string;
  updated_at: string;
  clients?: { name: string } | null;
}

export type ProjectPnlType = 'shared' | 'managed';
export type CostPayer = 'lg' | 'cn' | 'ch';
export type OverheadCostType = 'Cố định' | 'Biến đổi';

export interface ProjectPnl {
  id: string;
  client_id: string;
  month: string;
  branch_manager: string | null;
  project_type: ProjectPnlType;
  lg_pct: number;
  cn_pct: number;
  revenue: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  split_temp_until: string | null;
  split_reverted: boolean;
  clients?: { name: string } | null;
}

// Per-client default profit-split ratio + optional temporary override (auto-expires).
export interface PnlSplitSettings {
  id: string;
  client_id: string;
  lg_pct: number;
  cn_pct: number;
  pending_lg_pct: number | null;
  pending_cn_pct: number | null;
  pending_until_month: string | null;
  updated_at: string;
}

export interface ProjectPnlCost {
  id: string;
  pnl_id: string;
  label: string;
  value: number;
  payer: CostPayer;
  sort_order: number;
}

export interface BranchOverhead {
  id: string;
  branch_manager: string;
  month: string;
  label: string;
  value: number;
  cost_type: OverheadCostType;
  sort_order: number;
}

export type BranchStatus = 'active' | 'paused';

export interface Branch {
  id: string;
  name: string;
  short_name: string | null;
  manager_id: string | null;
  manager_name: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  region: string | null;
  location: string | null;
  map_link: string | null;
  established_date: string | null;
  status: BranchStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
}
