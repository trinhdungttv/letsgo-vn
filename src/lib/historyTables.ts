// Nhãn tiếng Việt cho các bảng dữ liệu — dùng chung cho module Lịch sử & Sao lưu

export const TABLE_LABELS: Record<string, string> = {
  clients: 'Khách hàng',
  client_labor_history: 'Lao động',
  client_branch_history: 'Lịch sử chi nhánh KH',
  client_manager_history: 'Lịch sử quản lý KH',
  client_documents: 'Tài liệu khách hàng',
  client_gifts: 'Quà tặng khách hàng',
  finance_records: 'Tài chính',
  proxy_ledger: 'Sổ thu hộ/chi hộ',
  payment_history: 'Lịch sử thanh toán',
  monthly_confirmations: 'Chốt tháng',
  quotes: 'Báo giá',
  market_surveys: 'Lương thị trường',
  competitors: 'Đối thủ',
  market_zones: 'Khu vực',
  market_leads: 'Công ty/Dự án',
  kcn_visits: 'Thăm KCN',
  win_loss_records: 'Win/Loss',
  crm_pipeline: 'CRM Pipeline',
  crm_interactions: 'CRM Tương tác',
  crm_gifts: 'CRM Quà tặng',
  crm_pipeline_tasks: 'CRM Công việc',
  crm_leads: 'CRM Lead',
  crm_deals: 'CRM Deal',
  crm_products: 'Sản phẩm',
  crm_activities: 'CRM Hoạt động',
  pipeline_appendices: 'Phụ lục pipeline',
  contacts: 'Liên hệ',
  cskh_logs: 'CSKH',
  app_users: 'Người dùng',
  app_settings: 'Cài đặt hệ thống',
  role_permissions: 'Phân quyền',
  branches: 'Chi nhánh',
  branch_staffs: 'Nhân sự chi nhánh',
  branch_targets: 'Chỉ tiêu chi nhánh',
  branch_type_history: 'Lịch sử loại chi nhánh',
  branch_zones: 'Khu vực chi nhánh',
  branch_zone_costs: 'Chi phí khu vực CN',
  regions: 'Khu vực phụ trách',
  managers: 'Quản lý',
  cost_categories: 'Danh mục chi phí',
  overhead_categories: 'Danh mục chi phí chung',
  pnl_revenue_lines: 'Dòng doanh thu PnL',
  pnl_invoice_settings: 'Cài đặt hóa đơn PnL',
  pnl_split_settings: 'Cài đặt tách PnL',
  payroll_staffs: 'Nhân sự tính lương',
  dashboard_targets: 'Chỉ tiêu dashboard',
  dashboard_tasks: 'Công việc dashboard',
  morning_priorities: 'Ưu tiên buổi sáng',
  work_tasks: 'Công việc (Workspace)',
  workspace_tasks: 'Workspace tasks',
  google_task_links: 'Liên kết Google Calendar',
  loans: 'Khoản vay',
  loan_borrowers: 'Bên vay',
  loan_collaterals: 'Tài sản đảm bảo',
  loan_disbursements: 'Giải ngân',
  loan_rate_history: 'Lịch sử lãi suất',
  loan_renewals: 'Đáo hạn khoản vay',
  loan_schedules: 'Lịch trả nợ',
};

export function tableLabel(name: string): string {
  return TABLE_LABELS[name] || name;
}

// Các bảng đưa vào bản sao lưu JSON (toàn bộ bảng dữ liệu, trừ log/phiên/token)
export const BACKUP_TABLES: string[] = Object.keys(TABLE_LABELS);

// Thử tìm một "tên" dễ đọc trong dữ liệu bản ghi để hiển thị
const NAME_KEYS = ['name', 'full_name', 'title', 'label', 'company', 'company_name', 'client_name', 'staff_name', 'description', 'note', 'month', 'code'];
export function recordName(data: Record<string, any> | null): string {
  if (!data) return '';
  for (const k of NAME_KEYS) {
    const v = data[k];
    if (typeof v === 'string' && v.trim()) return v.length > 60 ? v.slice(0, 57) + '…' : v;
  }
  return '';
}

export function formatValue(v: any): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Có' : 'Không';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
