import { ChevronLeft } from 'lucide-react';
import type { Page } from '../lib/types';
import { OFFICE_NAV, isOfficePage } from '../modules/office-rental/pages';

// Tên hiện trên thanh quay lại (trang người dùng vừa rời đi)
const PAGE_LABEL: Partial<Record<Page, string>> = {
  dashboard: 'Dashboard',
  clients: 'Khách hàng',
  'client-detail': 'Hồ sơ công ty',
  branches: 'Chi nhánh',
  finance: 'Tài chính',
  market: 'Thị trường',
  reports: 'Báo cáo',
  loans: 'Khoản vay',
  history: 'Lịch sử',
  workspace: 'Workspace',
  'crm-dash': 'Tổng quan CRM',
  'crm-board': 'Pipeline',
  'crm-leads': 'CRM',
  'crm-prods': 'Sản phẩm',
  'crm-deal': 'Chi tiết deal',
  'crm-pipeline': 'Pipeline',
  'admin-settings': 'Phân quyền',
  users: 'Users',
};

function pageLabel(p: Page): string {
  if (isOfficePage(p)) return `VP Orient · ${OFFICE_NAV.find(n => n.page === p)?.label ?? ''}`;
  return PAGE_LABEL[p] ?? 'Trang trước';
}

/**
 * Thanh "‹ Trang trước" chỉ hiện trên điện thoại. iPhone (nhất là khi cài ra màn hình chính) không có
 * nút back của trình duyệt, nên trang nào mở bằng liên kết trong trang khác (vd Dashboard → Chi nhánh)
 * cần một nút quay về đúng trang vừa rời đi.
 */
export default function MobileBackBar({ from, onBack }: { from: Page; onBack: () => void }) {
  return (
    <button
      type="button"
      onClick={onBack}
      className="md:hidden shrink-0 flex items-center w-full h-11 pl-1.5 pr-4 text-left text-[16px] font-medium text-[#0071E3] bg-white/85 backdrop-blur-xl border-b border-black/[0.06] active:bg-black/[0.04] transition-colors"
    >
      <ChevronLeft size={24} strokeWidth={2.2} className="shrink-0" />
      <span className="truncate">{pageLabel(from)}</span>
    </button>
  );
}
