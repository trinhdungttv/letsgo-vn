export interface AppUser {
  id: string;
  username: string;
  full_name: string;
  role: 'admin' | 'ketoan' | 'kinhdoanh' | 'bdh';
  email?: string | null;
  is_active?: boolean;
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

// Loại hình dịch vụ:
//   'leasing'     - Cho thuê lao động: chu kỳ tháng cố định, các trường ngày bắt buộc.
//   'recruitment' - Giới thiệu lao động: xuất HĐ theo sự kiện, thanh toán theo công nợ.
//   'hoh'         - HOH: vận hành theo chu kỳ tháng như leasing, badge riêng màu cam.
export type ServiceType = 'leasing' | 'recruitment' | 'hoh';

export interface Client {
  id: string;
  name: string;
  region: string | null;
  manager: string | null;
  industrial_zones: string[];
  min_workers: number;
  // Các trường chu kỳ tháng — bắt buộc với 'leasing', NULL với 'recruitment'.
  cutoff_day: number | null;
  cutoff_day_end: number | null;
  calc_day: number | null;
  calc_day_end: number | null;
  invoice_day: number | null;
  invoice_day_end: number | null;
  payment_start: number | null;
  payment_end: number | null;
  salary_day: number | null;
  salary_day_end: number | null;
  extra_salary_days: { start: number; end: number | null }[];
  extra_calc_days: { start: number; end: number | null }[];
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
  // Loại hình dịch vụ — mặc định 'leasing' cho toàn bộ dữ liệu cũ.
  service_type: ServiceType;
  // Số ngày công nợ cho dịch vụ 'recruitment' (ví dụ: 15, 30).
  payment_term_days: number;
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
  project_type: 'managed' | 'contracted';
  default_lg_pct: number;
  default_cn_pct: number;
  khoan_type?: 'pct' | 'fixed' | 'tiered';
  khoan_fixed_fee?: number;
  khoan_tiers?: { min_workers: number; lg_pct: number; cn_pct: number }[];
  cooperation_status?: 'active' | 'suspended';
  suspension_reason?: string | null;
  suspended_at?: string | null;
  payment_group?: number;
  payment_days?: number;
  payment_wday?: boolean;
  payment_holiday?: string;
  payment_fixed_day?: number;
  payment_cutoff?: number;
  payment_weekday?: string;
  payment_ca_from?: number;
  payment_ca_to?: number;
  payment_cb_from?: number;
  payment_cb_to?: number;
  invoice_date?: string;
  payroll_staff?: string | null;
  // Toạ độ bản đồ (migration 094)
  map_link?: string | null;
  lat?: number | null;
  lng?: number | null;
  geocoded_at?: string | null;
  // Kênh online — Website/Facebook/YouTube/TikTok (migration 119)
  website_url?: string | null;
  facebook_url?: string | null;
  youtube_url?: string | null;
  tiktok_url?: string | null;
  // Hồ sơ thị trường: ngành nghề + theo dõi lấp đầy NCC + lương khảo sát (migration 100)
  industry?: string | null;
  market_workers_needed?: number | null;
  market_suppliers?: MarketLeadSupplier[];
  wage_min?: number | null;
  wage_max?: number | null;
  allowance_notes?: string | null;
  // Chi tiết lương Let's Go VN trả cho khách hàng này, theo từng trường dùng chung (migration 101)
  wage_detail?: Record<string, number> | null;
  // Chi tiết lương/phí PHÍA CÔNG TY trả cho Let's Go VN, cùng bộ trường với wage_detail để
  // so sánh chênh lệch từng khoản (migration 115)
  wage_detail_client?: Record<string, number> | null;
}

// Mục tiêu doanh thu tháng theo chi nhánh — dashboard điều hành (trang Báo cáo).
export interface BranchTarget {
  id: string;
  branch_id: string;
  month: string;
  revenue_target: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface PayrollStaff {
  id: string;
  name: string;
  created_at: string;
}

export interface BranchStaff {
  id: string;
  branch_id: string;
  zone_id: string | null;
  name: string;
  role: string | null;
  phone: string | null;
  email: string | null;
  salary: number;
  created_at: string;
}

export interface StaffSalaryHistory {
  id: string;
  staff_id: string;
  amount: number;
  effective_from: string;
  notes: string | null;
  created_at: string;
}

export interface AiChatMessage {
  id: string;
  user_id: string;
  role: 'user' | 'model';
  text: string;
  created_at: string;
}

export type ClientDocumentType = 'contract' | 'appendix' | 'other';

export interface ClientDocument {
  id: string;
  client_id: string;
  name: string;
  file_url: string;
  file_path: string;
  doc_type: ClientDocumentType;
  uploaded_by: string | null;
  created_at: string;
}

export interface ClientManagerHistory {
  id: string;
  client_id: string;
  manager_name: string;
  effective_from: string; // "YYYY-MM"
  created_by: string | null;
  created_at: string;
}

export interface ClientBranchHistory {
  id: string;
  client_id: string;
  branch_name: string;
  effective_from: string; // "YYYY-MM"
  notes: string | null;
  created_by: string | null;
  created_at: string;
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
  client_id?: string | null;
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
  contact_id: string | null;
  product_id: string | null;
  custom_price: number | null;
  contacts?: { name: string; phone: string | null } | null;
  crm_products?: { name: string; category: string | null; price?: number } | null;
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

export interface PipelineAppendix {
  id: string;
  crm_id: string;
  version_label: string;
  content: string;
  created_by: string | null;
  created_at: string;
}

export interface CRMGift {
  id: string;
  crm_id: string;
  gift_date: string;
  item_name: string | null;
  value: string | null;
  recipient_contact_id: string | null;
  recipient_name: string | null;
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
  result_note: string | null;
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
  total_workers?: number;
  strengths?: string;
  weaknesses?: string;
  recruitment_source?: string;
  // Ảnh cover + Khu vực hoạt động (migration 103)
  image_url?: string | null;
  active_zones?: string[] | null;
  // Giám đốc + mạng xã hội (migration 105)
  director?: string | null;
  website_url?: string | null;
  facebook_url?: string | null;
  tiktok_url?: string | null;
  social_other_url?: string | null;
  // Vị trí hiển thị ảnh cover (%) + link Google Maps văn phòng + giá trị link tự thêm (migration 114)
  image_pos_x?: number;
  image_pos_y?: number;
  map_link?: string | null;
  custom_links?: Record<string, string>;
  // Chế độ hiển thị ảnh cover: 'cover' cắt lấp đầy khung, 'contain' tự khớp hiện toàn bộ ảnh (migration 116)
  image_fit?: 'cover' | 'contain' | null;
}

export interface CompetitorClient {
  id: string;
  competitor_id: string;
  client_name: string;
  kcn?: string;
  worker_count?: number;
  relationship?: string;
  created_at?: string;
  // Phí sale/cộng tác viên trả hàng tháng cho dự án này (migration 103)
  sale_name?: string | null;
  sale_fee?: number | null;
  // SĐT sale phụ trách (migration 104)
  sale_phone?: string | null;
}

export interface CompetitorLog {
  id: string;
  competitor_id: string;
  note: string;
  source?: string;
  created_at?: string;
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
  // Toạ độ bản đồ (migration 094)
  map_link?: string | null;
  lat?: number | null;
  lng?: number | null;
  geocoded_at?: string | null;
  // Ảnh cover (migration 102)
  image_url?: string | null;
  // Vùng lương tối thiểu Vùng I–IV (migration 110) — mỗi KCN 1 vùng riêng
  region_zone?: string | null;
}

export interface Industry {
  id: string;
  name: string;
  overview?: string | null;
  policy_notes?: string | null;
  tax_notes?: string | null;
  trend_notes?: string | null;
  // Lịch mùa vụ (migration 108) — 12 phần tử, index 0 = tháng 1
  season_levels?: number[] | null;
  season_notes?: string[] | null;
  // Hồ sơ giữ chân lao động (migration 109)
  turnover_rate?: number | null;
  quit_stage?: string | null;
  quit_reasons?: string[] | null;
  retention_actions?: string | null;
  // Nhiều giai đoạn hay nghỉ + ghi chú chi tiết theo từng lý do (migration 120).
  // quit_stage vẫn được ghi = phần tử đầu của quit_stages cho dữ liệu/báo cáo cũ.
  quit_stages?: string[] | null;
  quit_reason_notes?: Record<string, string> | null;
  // Ô tổng quan Chuỗi giá trị ngành (migration 117), mặc định ẩn trên UI
  value_chain_input_summary?: string | null;
  value_chain_customer_summary?: string | null;
  value_chain_market_summary?: string | null;
  updated_at?: string;
  created_at?: string;
}

// Bản đồ vị trí tuyển dụng trong ngành (migration 109)
export interface IndustryPosition {
  id: string;
  industry_id: string;
  position: string;
  ratio_pct?: number | null;
  wage_min?: number | null;
  wage_max?: number | null;
  requirements?: string | null;
  difficulty?: number | null;
  sort_order?: number | null;
  created_at?: string;
}

// Chỉ số ngành theo quý (migration 109)
export interface IndustryMetric {
  id: string;
  industry_id: string;
  period: string;
  avg_wage_unskilled?: number | null;
  avg_wage_skilled?: number | null;
  service_fee_min?: number | null;
  service_fee_max?: number | null;
  turnover_rate?: number | null;
  ot_hours?: number | null;
  demand_headcount?: number | null;
  note?: string | null;
  created_at?: string;
}

// Chuỗi giá trị ngành (migration 109) — 'input' nguyên liệu, 'customer' khách của khách, 'market' thị trường xuất
export type ValueChainKind = 'input' | 'customer' | 'market';
export interface IndustryValueChainItem {
  id: string;
  industry_id: string;
  kind: ValueChainKind;
  name: string;
  note?: string | null;
  created_at?: string;
}

// BD Battlecard & kịch bản tư vấn Sales (migration 118)
export interface IndustryBattlecard {
  id: string;
  industry_id: string;
  pain_point: string;
  our_weapon: string;
  pitching_script?: string | null;
  category?: string | null;
  sort_order?: number | null;
  created_at?: string;
}

// Thuật ngữ ngành (migration 107) — industry_id null = thuật ngữ dùng chung mọi ngành
export interface IndustryTerm {
  id: string;
  industry_id?: string | null;
  term: string;
  aliases?: string[] | null;
  category?: string | null;
  short_def?: string | null;
  detail?: string | null;
  example?: string | null;
  pinned?: boolean | null;
  created_at?: string;
  updated_at?: string;
}

export interface MarketLeadSupplier {
  name: string;
  qty: number;
  is_us: boolean;
  // Lương NCC này trả cho LĐ tại chính công ty/dự án này (khác nhau theo từng dự án)
  wage_min?: number | null;
  wage_max?: number | null;
  // Chi tiết lương theo từng trường dùng chung (tên trường từ wage_detail_fields, giá trị VNĐ)
  wage_detail?: Record<string, number> | null;
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
  // Toạ độ bản đồ (migration 095)
  map_link?: string | null;
  lat?: number | null;
  lng?: number | null;
  geocoded_at?: string | null;
  // Kênh online — Website/Facebook/YouTube/TikTok (migration 119)
  website_url?: string | null;
  facebook_url?: string | null;
  youtube_url?: string | null;
  tiktok_url?: string | null;
  // Lương khảo sát thực địa (migration 100)
  wage_min?: number | null;
  wage_max?: number | null;
  allowance_notes?: string | null;
  // Chi tiết lương Let's Go VN dự kiến trả, theo từng trường dùng chung (migration 101)
  wage_detail?: Record<string, number> | null;
  // Chi tiết lương/phí PHÍA CÔNG TY trả cho Let's Go VN, cùng bộ trường với wage_detail để
  // so sánh chênh lệch từng khoản (migration 115)
  wage_detail_client?: Record<string, number> | null;
  // Liên kết sang crm_pipeline khi đã "Đẩy CRM" (hoặc được tạo sẵn liên kết từ CRM Pipeline/
  // Workspace) — 1-1 tuỳ chọn, cùng mẫu với crm_pipeline.client_id (migration 122).
  crm_id?: string | null;
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
  // Ngành nghề + liên kết Dự án được tạo từ báo giá này khi "Thắng" (migration 121)
  industry?: string | null;
  converted_lead_id?: string | null;
}

export type Page = 'dashboard' | 'clients' | 'client-detail' | 'branches' | 'finance' | 'market' | 'reports' | 'users' | 'history' | 'crm-dash' | 'crm-board' | 'crm-leads' | 'crm-prods' | 'crm-deal' | 'crm-pipeline' | 'admin-settings' | 'workspace' | 'loans';

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

export type DataHistoryAction = 'INSERT' | 'UPDATE' | 'DELETE';

export interface DataHistoryEntry {
  id: number;
  happened_at: string;
  table_name: string;
  record_id: string;
  action: DataHistoryAction;
  old_data: Record<string, any> | null;
  new_data: Record<string, any> | null;
  changed_fields: string[] | null;
}

export type PermissionAction = 'view' | 'edit' | 'delete' | 'export';
export type PermissionStatus = 'pending' | 'approved' | 'rejected';

export interface PermissionRequest {
  id: string;
  requester_email: string;
  requester_name: string | null;
  requester_role: string | null;
  module: string;
  action_requested: PermissionAction;
  reason: string | null;
  status: PermissionStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
}

export type RolePermissionLevel = 'full' | 'view' | 'none';

export interface RolePermission {
  role: string;
  module: string;
  level: RolePermissionLevel;
  updated_at: string;
}

export interface UserPermission {
  id: string;
  user_email: string;
  module: string;
  can_view: boolean;
  can_edit: boolean;
  can_delete: boolean;
  can_export: boolean;
  granted_by: string | null;
  created_at: string;
}

export type NotificationType = 'alert' | 'info' | 'success' | 'warning';

export interface AppNotification {
  id: string;
  user_id: string;
  title: string;
  body: string | null;
  type: NotificationType;
  is_read: boolean;
  action_url: string | null;
  created_at: string;
}

export type SalesTaskStatus = 'todo' | 'inprogress' | 'done' | 'overdue';

export interface SalesTask {
  id: string;
  title: string;
  sub_label: string | null;
  client_name: string | null;
  deadline: string | null;
  assigned_to: string | null;
  assigned_name: string | null;
  status: SalesTaskStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
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
  industry: string | null;
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

export interface PnlRevenueLine {
  id: string;
  pnl_id: string;
  label: string;
  amount: number;
  invoice_date: string | null;
  sort_order: number;
  period_label: string | null;
  man_days: number;
  // 'leasing' (mặc định) = Cho thuê lao động; 'recruitment' = Giới thiệu Lao động (GTLD),
  // dịch vụ phụ một số dự án làm thêm — vẫn cộng chung vào doanh thu dự án.
  service_type?: ServiceType;
}

// 'shared'     - Đã Nhận Khoán: chia LN sau thuế theo % lg_pct/cn_pct.
// 'managed'    - Không Khoán - Nhận Lương: LGV nhận 100% LN, CN nhận lương cố định.
// 'per_manday' - Khoán Theo Công: CN nhận manday_rate × total_man_days (đảm bảo đủ
//                kể cả khi lỗ), LGV nhận phần LN sau thuế còn lại (có thể âm).
export type ProjectPnlType = 'shared' | 'managed' | 'per_manday';
export type CostPayer = 'lg' | 'cn' | 'ch';
export type OverheadCostType = 'Cố định' | 'Biến đổi';
export type PnlInvoiceMode = 'single' | 'periodic';

export interface ProjectPnl {
  id: string;
  client_id: string;
  month: string;
  branch_manager: string | null;
  project_type: ProjectPnlType;
  lg_pct: number;
  cn_pct: number;
  revenue: number;
  total_man_days: number;
  manday_rate: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  split_temp_until: string | null;
  split_reverted: boolean;
  invoice_mode: PnlInvoiceMode;
  // Tỷ lệ phân chia riêng cho phần doanh thu HOH (xuất hộ khách hàng) trong dự án —
  // mặc định 100% Let's Go VN, tách biệt với lg_pct/cn_pct của Cho thuê lao động.
  hoh_lg_pct?: number;
  hoh_cn_pct?: number;
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
  manday_rate: number;
  tax_pct: number;
  tax_exempt: boolean;
  updated_at: string;
}

export interface PnlInvoiceSettings {
  client_id: string;
  period_count: number;
  period_labels: string[];
  invoice_label_template: string;
  invoice_days: number[];
  updated_at: string;
}

export interface ProjectPnlCost {
  id: string;
  pnl_id: string;
  label: string;
  value: number;
  payer: CostPayer;
  sort_order: number;
  period_label: string | null;
  // 'leasing' (mặc định) = Cho thuê lao động; 'recruitment' = chi phí riêng cho GTLD.
  service_type?: ServiceType;
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

export interface BranchZone {
  id: string;
  branch_id: string;
  name: string;
  location: string | null;
  manager_name: string | null;
  manager_salary: number;
  image_url: string | null;
  image_fit: string;
  image_position: string;
  client_ids: string[];
}

export interface OverheadCategory {
  id: string;
  label: string;
  sort_order: number;
  is_default?: boolean;
  cost_type?: 'fixed' | 'operational';
  icon?: string;
}

export interface BranchZoneCost {
  id: string;
  zone_id: string;
  label: string;
  amount: number;
  sort_order: number;
}

export type CostGroupType = 'salary' | 'general';

export interface CostCategory {
  id: string;
  label: string;
  sort_order: number;
  is_default: boolean;
  group_type: CostGroupType;
  default_payer: CostPayer;
}

export type BranchType = 'contracted' | 'company';

export interface BranchTypeHistory {
  id: string;
  branch_id: string;
  branch_type: BranchType;
  effective_from: string;
  manager_name: string | null;
  lg_pct: number;
  cn_pct: number;
  notes: string | null;
  created_by: string | null;
  created_at: string;
}

export interface Branch {
  id: string;
  name: string;
  short_name: string | null;
  manager_id: string | null;
  manager_name: string | null;
  manager_avatar_url: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  region: string | null;
  location: string | null;
  map_link: string | null;
  established_date: string | null;
  status: BranchStatus;
  branch_type: BranchType;
  notes: string | null;
  status_note: string | null;
  difficulties: string | null;
  opportunities: string | null;
  khoan_type?: 'pct' | 'fixed' | 'tiered';
  khoan_fixed_fee?: number;
  khoan_tiers?: { min_workers: number; lg_pct: number; cn_pct: number }[];
  created_at: string;
  updated_at: string;
  // Toạ độ bản đồ (migration 094)
  lat?: number | null;
  lng?: number | null;
  geocoded_at?: string | null;
}

// --- Morning Priority -------------------------------------------
export type GoalType = 'tai_ky' | 'chot_bao_gia' | 'follow_up' | 'tham_quan' | 'other' | 'hoi_tham' | 'cap_nhat' | 'kho_khan'
export type OutcomeStatus = 'done' | 'partial' | 'missed'
export type MorningWorkType = 'field' | 'office_contract' | 'office_branch'

export interface MorningPriority {
  id: string
  user_id: string
  priority_date: string          // 'YYYY-MM-DD'
  target_name: string | null
  target_kcn: string | null
  goal_type: GoalType | null
  goal_note: string | null
  outcome_note: string | null
  outcome_status: OutcomeStatus | null
  created_at: string
  updated_at: string
}

// --- Win/Loss Tracker -------------------------------------------
export type DealType   = 'new_client' | 'renewal' | 'expansion'
export type DealResult = 'win' | 'loss' | 'pending'
export type LossReason = 'price' | 'labor_quality' | 'competitor' | 'relationship' | 'timing' | 'requirements' | 'other'

export interface WinLossRecord {
  id: string
  user_id: string
  client_name: string
  client_id: string | null
  deal_type: DealType
  result: DealResult
  labor_count: number | null
  monthly_value: number | null
  loss_reason: LossReason | null
  competitor_name: string | null
  competitor_price: number | null
  decision_maker: string | null
  first_contact_date: string | null
  deal_closed_date: string | null
  days_to_close: number | null   // generated column
  notes: string | null
  created_at: string
  updated_at: string
}

// --- KCN Grid ---------------------------------------------------
export interface KCNZone {
  id: string
  name: string
  province: string
  potential_score: number        // 1–5
  notes: string | null
  is_active: boolean
  created_at: string
}

export interface KCNSummary extends KCNZone {
  client_count: number
  last_visit_date: string | null
  next_visit_date: string | null
  days_since_visit: number | null
}

// Lịch khảo sát KCN + báo cáo (dùng chung giữa Workspace > KCN Grid và Market > Hồ sơ khu vực)
export interface KCNVisit {
  id: string
  zone_id: string
  user_id: string
  visit_date: string
  status: 'planned' | 'done'
  report_summary: string | null
  occupancy_note: string | null
  labor_note: string | null
  wage_note: string | null
  competitor_note: string | null
  notes: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

// Labels / constants
export const GOAL_TYPE_LABELS: Record<GoalType, string> = {
  tai_ky:       'Tái ký hợp đồng',
  chot_bao_gia: 'Chốt báo giá',
  follow_up:    'Follow-up khách',
  tham_quan:    'Thăm quan nhà máy',
  hoi_tham:     'Hỏi thăm tình hình',
  cap_nhat:     'Cập nhật thông tin',
  kho_khan:     'Ghi nhận khó khăn',
  other:        'Khác',
}

// Bộ mục tiêu hiển thị theo loại công việc (field / xử lý HĐ tại VP / hỏi thăm chi nhánh)
export const GOAL_SETS: Record<MorningWorkType, { value: GoalType; label: string }[]> = {
  office_contract: [
    { value: 'tai_ky',       label: 'Soạn / gửi HĐ' },
    { value: 'chot_bao_gia', label: 'Chuẩn bị báo giá' },
    { value: 'follow_up',    label: 'Email / Zalo follow-up' },
    { value: 'other',        label: 'Giấy tờ khác' },
  ],
  office_branch: [
    { value: 'hoi_tham', label: 'Hỏi thăm tình hình' },
    { value: 'cap_nhat', label: 'Cập nhật thông tin' },
    { value: 'kho_khan', label: 'Ghi nhận khó khăn' },
    { value: 'other',    label: 'Việc khác' },
  ],
  field: [
    { value: 'tai_ky',       label: 'Tái ký HĐ' },
    { value: 'chot_bao_gia', label: 'Chốt báo giá' },
    { value: 'follow_up',    label: 'Follow-up' },
    { value: 'tham_quan',    label: 'Thăm quan nhà máy' },
    { value: 'other',        label: 'Khác' },
  ],
}

export const LOSS_REASON_LABELS: Record<LossReason, string> = {
  price:          'Giá cao hơn đối thủ',
  labor_quality:  'Chất lượng lao động',
  competitor:     'Đối thủ có quan hệ tốt hơn',
  relationship:   'Thiếu quan hệ bên KH',
  timing:         'Sai thời điểm',
  requirements:   'Không đáp ứng yêu cầu',
  other:          'Lý do khác',
}

export const DEAL_TYPE_LABELS: Record<DealType, string> = {
  new_client: 'Khách hàng mới',
  renewal:    'Tái ký hợp đồng',
  expansion:  'Mở rộng (thêm lao động)',
}

export type TaskPriority = 'high' | 'medium' | 'low'
export type TaskStatus = 'pending' | 'in_progress' | 'done' | 'ngung_hd'

export interface WorkTask {
  id: string
  user_id: string
  client_id: string | null
  title: string
  task_type: string | null
  due_date: string
  priority: TaskPriority
  kcn: string | null
  notes: string | null
  status: TaskStatus
  completed_at: string | null
  created_at: string
  updated_at: string
  contract_status_note?: string | null
  doc_status?: string | null
}

export interface CooperationSuspensionRequest {
  id: string
  client_id: string
  task_id: string | null
  requester_id: string
  requester_name: string
  reason: string
  status: 'pending' | 'approved' | 'rejected'
  reviewed_by: string | null
  reviewed_at: string | null
  created_at: string
}

export interface WorkTaskComment {
  id: string
  task_id: string
  user_id: string
  user_name: string
  content: string
  created_at: string
}

export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = { high: 'Cao', medium: 'TB', low: 'Thấp' }
export const TASK_PRIORITY_COLORS: Record<TaskPriority, string> = {
  high:   'bg-red-50 text-red-700 border-red-200',
  medium: 'bg-amber-50 text-amber-700 border-amber-200',
  low:    'bg-green-50 text-green-700 border-green-200',
}
export const TASK_STATUS_LABELS: Record<TaskStatus, string> = { pending: 'Cần làm', in_progress: 'Đang làm', done: 'Hoàn thành', ngung_hd: 'Ngưng HĐ' }
export const TASK_STATUS_COLORS: Record<TaskStatus, string> = {
  pending:     'bg-slate-100 text-slate-600 border-slate-300',
  in_progress: 'bg-blue-50 text-blue-700 border-blue-300',
  done:        'bg-green-50 text-green-700 border-green-300',
  ngung_hd:    'bg-red-50 text-red-700 border-red-300',
}

export type DocStatus = 'chua_soan' | 'dang_soan' | 'cho_duyet' | 'cho_kh_ky' | 'hoan_tat' | 'ngung_hd'
export const DOC_STATUS_STEPS: { key: DocStatus; label: string; danger?: boolean }[] = [
  { key: 'chua_soan',  label: 'Chưa soạn' },
  { key: 'dang_soan',  label: 'Đang soạn' },
  { key: 'cho_duyet',  label: 'Chờ duyệt' },
  { key: 'cho_kh_ky', label: 'Chờ KH ký' },
  { key: 'hoan_tat',  label: 'Hoàn tất' },
  { key: 'ngung_hd',  label: 'Ngưng HĐ', danger: true },
]
export const TASK_TYPE_OPTIONS = ['Tái ký HĐ', 'Báo giá', 'Thăm quan', 'Hỏi thăm CN', 'Văn phòng', 'Khác']

// ─── Module: Quan ly Khoan Vay ─────────────────────────────────────

export type LoanBorrowerType = 'bank' | 'proxy' | 'personal';
export type LoanRateType = 'fixed' | 'floating';
export type LoanRepaymentType = 'interest_only' | 'reducing' | 'emi';
export type LoanStatus = 'active' | 'closed' | 'restructured';

export interface LoanBorrower {
  id: string;
  name: string;
  borrower_type: 'personal' | 'company';
  note: string | null;
  created_at: string;
}

export interface LoanCollateral {
  id: string;
  name: string;
  note: string | null;
  created_at: string;
}

export interface Loan {
  id: string;
  label: string;
  bank_name: string;
  borrower_id: string | null;
  borrower_name: string;
  borrower_type: LoanBorrowerType;
  collateral_id: string | null;
  collateral: string | null;
  principal: number;
  interest_rate: number;
  rate_type: LoanRateType;
  base_rate: number | null;
  margin: number | null;
  repayment_type: LoanRepaymentType;
  term_months: number | null;
  payment_day: number | null;
  disbursement_date: string | null;
  maturity_date: string | null;
  proxy_account: string | null;
  status: LoanStatus;
  notes: string | null;
  // v2: an han goc — so thang dau chi tra lai (vay dai han)
  grace_months: number;
  // v2: khoan cong ty — giai ngan phai cung cap hoa don cho NH
  requires_invoice: boolean;
  created_at: string;
  updated_at: string;
}

export type LoanConfirmationStatus = 'pending' | 'confirmed' | 'paid' | 'overdue';

export interface LoanMonthlyConfirmation {
  id: string;
  loan_id: string;
  month: string;
  estimated_interest: number | null;
  confirmed_interest: number | null;
  buffer_amount: number | null;
  amount_to_pay: number | null;
  status: LoanConfirmationStatus;
  paid_date: string | null;
  paid_amount: number | null;
  cic_risk: boolean;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface LoanRateHistory {
  id: string;
  loan_id: string;
  effective_date: string;
  interest_rate: number;
  base_rate: number | null;
  margin: number | null;
  note: string | null;
  created_at: string;
}

export type LoanScheduleStatus = 'pending' | 'paid' | 'overdue' | 'skipped';

export interface LoanSchedule {
  id: string;
  loan_id: string;
  period: number;
  due_date: string;
  principal_due: number;
  interest_due: number;
  is_estimated: boolean;
  status: LoanScheduleStatus;
  created_at: string;
}

export interface LoanPaymentHistory {
  id: string;
  loan_id: string;
  paid_date: string;
  amount: number;
  principal_paid: number;
  interest_paid: number;
  fee_paid: number;
  note: string | null;
  created_at: string;
}

// Flow dao han thuc te: chua xu ly -> da lien he NH -> da nop tien dao -> NH giai ngan lai (co the sang nguoi khac) -> hoan tat
export type LoanRenewalStatus = 'pending' | 'contacted' | 'deposited' | 'redisbursed' | 'completed' | 'rejected';

export interface LoanRenewal {
  id: string;
  loan_id: string;
  new_loan_id: string | null;
  contacted_date: string | null;
  approval_date: string | null;
  renewal_date: string | null;
  deposit_date: string | null;       // ngay nop tien vao TK de dao
  redisbursed_date: string | null;   // ngay NH giai ngan lai
  new_borrower_name: string | null;  // giai ngan sang nguoi dung ten moi (neu doi)
  new_principal: number | null;
  new_rate: number | null;
  new_term_months: number | null;
  status: LoanRenewalStatus;
  checklist: { label: string; done: boolean }[];
  worst_case_note: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

// Giai ngan theo hoa don (khoan cong ty): cho hoa don -> da gui NH -> NH da giai ngan cho NCC
export type LoanDisbursementStatus = 'pending' | 'submitted' | 'disbursed';

export interface LoanDisbursement {
  id: string;
  loan_id: string;
  invoice_no: string | null;
  supplier_name: string | null;
  amount: number;
  request_date: string | null;
  disbursed_date: string | null;
  status: LoanDisbursementStatus;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export type ProxyLedgerEntryType = 'deposit' | 'interest' | 'adjustment' | 'carry_forward';

export interface ProxyLedgerEntry {
  id: string;
  loan_id: string | null;
  entry_date: string;
  entry_type: ProxyLedgerEntryType;
  amount: number;
  running_balance: number;
  note: string | null;
  created_at: string;
}

export interface LoanAuditLog {
  id: string;
  user_id: string | null;
  user_name: string | null;
  action: string;
  table_name: string;
  record_id: string | null;
  before_data: Record<string, unknown> | null;
  after_data: Record<string, unknown> | null;
  description: string | null;
  created_at: string;
}

export const BORROWER_TYPE_LABELS: Record<LoanBorrowerType, string> = {
  bank: 'Ngân hàng',
  proxy: 'Vay hộ',
  personal: 'Cá nhân',
};

export const LOAN_STATUS_LABELS: Record<LoanStatus, string> = {
  active: 'Đang vay',
  closed: 'Đã tất toán',
  restructured: 'Tái cơ cấu',
};

export const CONFIRMATION_STATUS_LABELS: Record<LoanConfirmationStatus, string> = {
  pending: 'Chưa xác nhận',
  confirmed: 'Đã xác nhận',
  paid: 'Đã nộp',
  overdue: 'Trễ hạn',
};

export const RENEWAL_STATUS_LABELS: Record<LoanRenewalStatus, string> = {
  pending: 'Chưa xử lý',
  contacted: 'Đã liên hệ NH',
  deposited: 'Đã nộp tiền đáo',
  redisbursed: 'NH đã giải ngân lại',
  completed: 'Hoàn tất',
  rejected: 'NH từ chối',
};

export const DISBURSEMENT_STATUS_LABELS: Record<LoanDisbursementStatus, string> = {
  pending: 'Chờ hoá đơn',
  submitted: 'Đã gửi NH',
  disbursed: 'Đã giải ngân cho NCC',
};
