// Tiêu đề tab trình duyệt theo module đang mở: "Khách hàng - LGVN".
import type { Page } from './types';
import { OFFICE_NAV } from '../modules/office-rental/pages';

const TITLES: Partial<Record<Page, string>> = {
  dashboard: 'Dashboard',
  overview: 'Tổng quan',
  workspace: 'Workspace',
  clients: 'Khách hàng',
  'client-detail': 'Khách hàng',
  recruit: 'Tuyển dụng',
  branches: 'Chi nhánh',
  finance: 'Tài chính',
  market: 'Thị trường',
  reports: 'Báo cáo',
  loans: 'Khoản vay',
  history: 'Lịch sử',
  legal: 'Pháp lý',
  'crm-dash': 'CRM Dashboard',
  'crm-board': 'CRM',
  'crm-pipeline': 'BD Pipeline',
  'crm-leads': 'CSKH',
  'crm-prods': 'Sản phẩm',
  'crm-deal': 'Deal',
  'admin-settings': 'Phân quyền & Tài khoản',
  users: 'Quản lý Users',
};

export function pageTitle(page: string): string {
  const office = OFFICE_NAV.find(o => o.page === page);
  const name = office?.short ?? TITLES[page as Page];
  return name ? `${name} - LGVN` : "Let's Go VN";
}
