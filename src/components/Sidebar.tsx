import { useState, useEffect, useRef } from 'react';
import { Home, Briefcase, Building2, Building, DollarSign, MapPin, BarChart3, Users, LogOut, LayoutDashboard, UserCircle2, Package, ChevronRight, ChevronsLeft, ChevronsRight, Network, History, Settings, Landmark, UsersRound, UserPlus } from 'lucide-react';
import type { Page } from '../lib/types';
import { useAuth, canAccess } from '../lib/auth';
import { getAppLogoUrl } from '../lib/appSettings';
import { OFFICE_ICON, OFFICE_NAV, isOfficePage } from '../modules/office-rental/pages';
import { ICON_TILE } from './workspace/wsTheme';

interface SidebarProps {
  currentPage: Page;
  onNavigate: (page: Page) => void;
}

const NAV_ITEMS: { page: Page; label: string; icon: React.ReactNode }[] = [
  { page: 'dashboard', label: 'Dashboard', icon: <Home size={16} /> },
  { page: 'workspace', label: 'Workspace', icon: <Briefcase size={16} /> },
  { page: 'clients', label: 'Khách hàng', icon: <Building2 size={16} /> },
  { page: 'recruit', label: 'Tuyển dụng', icon: <UserPlus size={16} /> },
  { page: 'branches', label: 'Chi Nhánh', icon: <Building size={16} /> },
  { page: 'finance', label: 'Tài chính', icon: <DollarSign size={16} /> },
  { page: 'market', label: 'Thị trường', icon: <MapPin size={16} /> },
  { page: 'reports', label: 'Báo cáo', icon: <BarChart3 size={16} /> },
  { page: 'loans', label: 'Khoan vay', icon: <Landmark size={16} /> },
  { page: 'history', label: 'Lịch sử', icon: <History size={16} /> },
];

const CRM_ITEMS: { page: Page; label: string; icon: React.ReactNode }[] = [
  { page: 'crm-dash',     label: 'Dashboard',   icon: <LayoutDashboard size={16} /> },
  { page: 'crm-pipeline', label: 'BD Pipeline', icon: <Network size={16} /> },
  { page: 'crm-leads',    label: 'CSKH',        icon: <UserCircle2 size={16} /> },
  // Mạng lưới Sale — tách hẳn khỏi CSKH khách hàng (chỉ admin, xem canAccess)
  { page: 'crm-sales',    label: 'Mạng lưới Sale', icon: <UsersRound size={16} /> },
  { page: 'crm-prods',    label: 'Sản phẩm',   icon: <Package size={16} /> },
];

const CRM_PAGES: Page[] = ['crm-dash', 'crm-board', 'crm-leads', 'crm-sales', 'crm-prods', 'crm-deal', 'crm-pipeline'];

const ADMIN_ITEMS: { page: Page; label: string; icon: React.ReactNode }[] = [
  { page: 'admin-settings', label: 'Phân quyền & Tài khoản', icon: <Settings size={16} /> },
  { page: 'users',          label: 'Quản lý Users',          icon: <Users size={16} /> },
];

const ADMIN_PAGES: Page[] = ['admin-settings', 'users'];

const IDLE_TIMEOUT = 5_000; // auto-collapse sidebar after 5s of no interaction

// Thanh bên kiểu macOS: nền sáng mờ, hàng bo 8px, mục đang chọn = nền xám nhạt + icon màu nhấn.
const ROW = 'flex items-center gap-2.5 w-full rounded-[8px] text-left transition-colors';
const ROW_ON = 'bg-black/[0.06] font-medium';
const ROW_OFF = 'hover:bg-black/[0.04]';

function NavRow({ label, icon, active, collapsed, title, accent = 'text-[#0071E3]', onClick }: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  collapsed: boolean;
  title?: string;
  /** Màu icon khi đang chọn (Văn phòng Orient dùng cam để tách khỏi mảng lao động) */
  accent?: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={collapsed ? (title ?? label) : undefined}
      className={`${ROW} h-8 text-[13px] text-[#1D1D1F] ${active ? ROW_ON : ROW_OFF} ${collapsed ? 'justify-center px-0' : 'px-2.5'}`}
    >
      <span className={`shrink-0 ${active ? accent : 'text-[#86868B]'}`}>{icon}</span>
      {!collapsed && <span className="flex-1 truncate">{label}</span>}
    </button>
  );
}

function SectionHeader({ label, open, collapsed, onToggle }: { label: string; open: boolean; collapsed: boolean; onToggle: () => void }) {
  // Thu gọn: không có chỗ cho tiêu đề → chỉ một đường kẻ mảnh ngăn nhóm
  if (collapsed) return <div className="mx-1.5 my-2 border-t border-black/[0.06]" />;
  return (
    <button
      onClick={onToggle}
      className="flex items-center gap-1 w-full px-2.5 pt-4 pb-1 text-left text-[11px] font-semibold text-[#86868B] hover:text-[#6E6E73] transition-colors"
    >
      <span className="flex-1 truncate">{label}</span>
      <ChevronRight size={12} className={`text-[#AEAEB2] transition-transform duration-200 ${open ? 'rotate-90' : ''}`} />
    </button>
  );
}

export default function Sidebar({ currentPage, onNavigate }: SidebarProps) {
  const { user, logout, rolePermissions } = useAuth();
  const role = user?.role || 'kinhdoanh';
  const activeP = (currentPage === 'client-detail' ? 'clients' : currentPage) as Page;
  const isCrmActive = CRM_PAGES.includes(currentPage);
  const isAdminActive = ADMIN_PAGES.includes(currentPage);
  const isOfficeActive = isOfficePage(currentPage);
  const [crmOpen, setCrmOpen] = useState(isCrmActive);
  const [officeOpen, setOfficeOpen] = useState(isOfficeActive);
  const [adminOpen, setAdminOpen] = useState(isAdminActive);
  const [collapsed, setCollapsed] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    getAppLogoUrl().then(setLogoUrl).catch(() => {});
  }, []);

  const scheduleCollapse = () => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setCollapsed(true), IDLE_TIMEOUT);
  };

  useEffect(() => {
    scheduleCollapse();
    return () => { if (idleTimer.current) clearTimeout(idleTimer.current); };
  }, []);

  const handleMouseEnter = () => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    setCollapsed(false);
  };

  const handleMouseLeave = () => {
    scheduleCollapse();
  };

  const toggleCollapsed = () => {
    setCollapsed(c => !c);
    scheduleCollapse();
  };

  const handleNavigate = (page: Page) => {
    onNavigate(page);
    scheduleCollapse();
  };

  const hasCRM = CRM_ITEMS.some(item => canAccess(role, item.page, rolePermissions));
  const hasAdmin = ADMIN_ITEMS.some(item => canAccess(role, item.page, rolePermissions));
  const hasOffice = OFFICE_NAV.some(item => canAccess(role, item.page, rolePermissions));

  // Chữ cái đầu của tên gọi (từ cuối trong họ tên tiếng Việt) cho ô avatar
  const initial = (user?.full_name || user?.username || '').trim().split(/\s+/).pop()?.charAt(0).toUpperCase() || '?';

  return (
    <aside
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={`${collapsed ? 'w-[52px]' : 'w-[220px]'} bg-white/70 backdrop-blur-xl border-r border-black/[0.06] flex-shrink-0 flex flex-col h-screen transition-[width] duration-200 ease-out`}
    >
      <div className={`h-14 shrink-0 flex items-center gap-2.5 ${collapsed ? 'justify-center' : 'px-4'}`}>
        <div className={`w-8 h-8 rounded-[9px] ${logoUrl ? 'bg-white' : ICON_TILE.blue} shadow-[0_0_0_0.5px_rgba(0,0,0,0.08),0_1px_2px_rgba(0,0,0,0.08)] flex items-center justify-center shrink-0 overflow-hidden`}>
          {logoUrl ? (
            <img src={logoUrl} alt="Logo" className="w-full h-full object-cover" />
          ) : (
            <span className="text-white font-semibold text-[12px]">LG</span>
          )}
        </div>
        {!collapsed && (
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-semibold text-[#1D1D1F] leading-tight truncate">P. Kinh Doanh</div>
            <div className="text-[11px] text-[#86868B] mt-0.5">Ops v5.0</div>
          </div>
        )}
      </div>

      <div className="px-2 pb-1 shrink-0">
        <button
          onClick={toggleCollapsed}
          title={collapsed ? 'Hiện menu' : 'Ẩn menu'}
          className={`${ROW} h-7 text-[12px] text-[#86868B] hover:text-[#1D1D1F] hover:bg-black/[0.04] ${collapsed ? 'justify-center px-0' : 'px-2.5'}`}
        >
          {collapsed ? <ChevronsRight size={15} /> : <><ChevronsLeft size={15} /><span>Ẩn menu</span></>}
        </button>
      </div>

      <nav className="flex-1 px-2 pb-2 overflow-y-auto no-scrollbar space-y-px">
        {NAV_ITEMS.filter(item => canAccess(role, item.page, rolePermissions)).map(item => (
          <NavRow
            key={item.page}
            label={item.label}
            icon={item.icon}
            active={activeP === item.page}
            collapsed={collapsed}
            onClick={() => handleNavigate(item.page)}
          />
        ))}

        {/* CRM Module section */}
        {hasCRM && (
          <>
            <SectionHeader label="CRM Module" open={crmOpen} collapsed={collapsed} onToggle={() => setCrmOpen(!crmOpen)} />
            {(collapsed || crmOpen) && CRM_ITEMS.filter(item => canAccess(role, item.page, rolePermissions)).map(item => (
              <NavRow
                key={item.page}
                label={item.label}
                icon={item.icon}
                active={activeP === item.page || (currentPage === 'crm-deal' && item.page === 'crm-board')}
                collapsed={collapsed}
                onClick={() => handleNavigate(item.page)}
              />
            ))}
          </>
        )}

        {/* Văn phòng Orient — mảng cho thuê văn phòng, tách biệt dữ liệu với cung ứng lao động (chỉ admin) */}
        {hasOffice && (
          <>
            <SectionHeader label="Văn phòng Orient" open={officeOpen} collapsed={collapsed} onToggle={() => setOfficeOpen(!officeOpen)} />
            {(collapsed || officeOpen) && OFFICE_NAV.filter(item => canAccess(role, item.page, rolePermissions)).map(item => {
              const Icon = OFFICE_ICON[item.page];
              return (
                <NavRow
                  key={item.page}
                  label={item.label}
                  icon={<Icon size={16} />}
                  active={currentPage === item.page}
                  collapsed={collapsed}
                  title={`Văn phòng Orient · ${item.label}`}
                  accent="text-[#FF9500]"
                  onClick={() => handleNavigate(item.page)}
                />
              );
            })}
          </>
        )}

        {/* Admin section */}
        {hasAdmin && (
          <>
            <SectionHeader label="Admin" open={adminOpen} collapsed={collapsed} onToggle={() => setAdminOpen(!adminOpen)} />
            {(collapsed || adminOpen) && ADMIN_ITEMS.filter(item => canAccess(role, item.page, rolePermissions)).map(item => (
              <NavRow
                key={item.page}
                label={item.label}
                icon={item.icon}
                active={activeP === item.page}
                collapsed={collapsed}
                onClick={() => handleNavigate(item.page)}
              />
            ))}
          </>
        )}
      </nav>

      <div className="shrink-0 px-2 py-2 border-t border-black/[0.06]">
        <div className={`flex items-center gap-2.5 py-1.5 ${collapsed ? 'justify-center' : 'px-2'}`}>
          <span
            title={collapsed ? `${user?.full_name ?? ''} · ${user?.role ?? ''}` : undefined}
            className={`w-7 h-7 rounded-full ${ICON_TILE.gray} text-white text-[12px] font-semibold flex items-center justify-center shrink-0`}
          >
            {initial}
          </span>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <div className="text-[12.5px] text-[#1D1D1F] font-medium leading-tight truncate">{user?.full_name}</div>
              <div className="text-[11px] text-[#86868B] truncate">{user?.role}</div>
            </div>
          )}
        </div>
        <button
          onClick={logout}
          title="Đăng xuất"
          className={`${ROW} h-7 text-[12px] text-[#86868B] hover:text-[#D70015] hover:bg-[#FF3B30]/[0.08] ${collapsed ? 'justify-center px-0' : 'px-2.5'}`}
        >
          <LogOut size={14} /> {!collapsed && 'Đăng xuất'}
        </button>
      </div>
    </aside>
  );
}
