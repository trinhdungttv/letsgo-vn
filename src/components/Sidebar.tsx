import { useState, useEffect, useRef } from 'react';
import { Home, Building2, DollarSign, MapPin, Calculator, BarChart3, Users, LogOut, LayoutDashboard, KanbanSquare, UserCircle2, Package, ChevronDown, ChevronRight, ChevronsLeft, ChevronsRight, Network, History } from 'lucide-react';
import type { Page } from '../lib/types';
import { useAuth, canAccess } from '../lib/auth';

interface SidebarProps {
  currentPage: Page;
  onNavigate: (page: Page) => void;
}

const NAV_ITEMS: { page: Page; label: string; icon: React.ReactNode }[] = [
  { page: 'dashboard', label: 'Dashboard', icon: <Home size={15} /> },
  { page: 'clients', label: 'Khách hàng', icon: <Building2 size={15} /> },
  { page: 'finance', label: 'Tài chính', icon: <DollarSign size={15} /> },
  { page: 'market', label: 'Thị trường', icon: <MapPin size={15} /> },
  { page: 'quotes', label: 'Báo giá', icon: <Calculator size={15} /> },
  { page: 'reports', label: 'Báo cáo', icon: <BarChart3 size={15} /> },
  { page: 'users', label: 'Quản lý Users', icon: <Users size={15} /> },
  { page: 'history', label: 'Lịch sử', icon: <History size={15} /> },
];

const CRM_ITEMS: { page: Page; label: string; icon: React.ReactNode }[] = [
  { page: 'crm-dash',     label: 'Dashboard',   icon: <LayoutDashboard size={13} /> },
  { page: 'crm-pipeline', label: 'BD Pipeline', icon: <Network size={13} /> },
  { page: 'crm-board',    label: 'Deals',       icon: <KanbanSquare size={13} /> },
  { page: 'crm-leads',    label: 'CSKH',        icon: <UserCircle2 size={13} /> },
  { page: 'crm-prods',    label: 'Sản phẩm',   icon: <Package size={13} /> },
];

const CRM_PAGES: Page[] = ['crm-dash', 'crm-board', 'crm-leads', 'crm-prods', 'crm-deal', 'crm-pipeline'];

const IDLE_TIMEOUT = 5_000; // auto-collapse sidebar after 5s of no interaction

export default function Sidebar({ currentPage, onNavigate }: SidebarProps) {
  const { user, logout } = useAuth();
  const role = user?.role || 'kinhdoanh';
  const activeP = (currentPage === 'client-detail' ? 'clients' : currentPage) as Page;
  const isCrmActive = CRM_PAGES.includes(currentPage);
  const [crmOpen, setCrmOpen] = useState(isCrmActive);
  const [collapsed, setCollapsed] = useState(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const hasCRM = CRM_ITEMS.some(item => canAccess(role, item.page));

  return (
    <aside
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={`${collapsed ? 'w-[52px]' : 'w-[190px]'} bg-[#0c2340] flex-shrink-0 flex flex-col h-screen transition-all duration-200`}
    >
      <div className="px-4 py-4 border-b border-white/10 flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-blue-500 flex items-center justify-center shrink-0">
          <span className="text-white font-bold text-[12px]">LG</span>
        </div>
        {!collapsed && (
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-semibold text-white leading-tight">P. Kinh Doanh</div>
            <div className="text-[10px] text-white/40 mt-0.5">Ops v5.0</div>
          </div>
        )}
      </div>

      <div className="px-2 py-1.5 border-b border-white/10">
        <button
          onClick={toggleCollapsed}
          title={collapsed ? 'Hiện menu' : 'Ẩn menu'}
          className="flex items-center gap-2 px-2 py-1.5 w-full text-left text-white/40 hover:text-white/80 hover:bg-white/6 rounded-md transition"
        >
          {collapsed ? <ChevronsRight size={14} /> : <><ChevronsLeft size={14} /><span className="text-[11px]">Ẩn menu</span></>}
        </button>
      </div>

      <nav className="flex-1 py-1.5 overflow-y-auto">
        {NAV_ITEMS.filter(item => canAccess(role, item.page)).map(item => {
          const isActive = activeP === item.page;
          return (
            <button
              key={item.page}
              onClick={() => handleNavigate(item.page)}
              title={collapsed ? item.label : undefined}
              className={`flex items-center gap-2.5 px-4 py-2 text-[12px] w-full text-left transition-all border-l-[3px] ${
                isActive
                  ? 'bg-white/10 text-white border-l-blue-400'
                  : 'text-white/50 border-l-transparent hover:bg-white/6 hover:text-white/80'
              } ${collapsed ? 'justify-center px-0' : ''}`}
            >
              <span className={isActive ? 'text-white' : 'text-white/40'}>{item.icon}</span>
              {!collapsed && <span className="flex-1">{item.label}</span>}
            </button>
          );
        })}

        {/* CRM Module section */}
        {hasCRM && (
          <>
            <div className="mx-4 my-2 border-t border-white/10" />
            {!collapsed && (
              <button
                onClick={() => setCrmOpen(!crmOpen)}
                className="flex items-center gap-2 px-4 py-1.5 w-full text-left text-[10.5px] font-semibold text-white/30 uppercase tracking-wider hover:text-white/50 transition"
              >
                <span className="flex-1">CRM Module</span>
                {crmOpen ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
              </button>
            )}
            {(collapsed || crmOpen) && CRM_ITEMS.filter(item => canAccess(role, item.page)).map(item => {
              const isActive = activeP === item.page || (currentPage === 'crm-deal' && item.page === 'crm-board');
              return (
                <button
                  key={item.page}
                  onClick={() => handleNavigate(item.page)}
                  title={collapsed ? item.label : undefined}
                  className={`flex items-center gap-2 pl-6 pr-4 py-1.5 text-[12px] w-full text-left transition-all border-l-[3px] ${
                    isActive
                      ? 'bg-white/10 text-white border-l-blue-400'
                      : 'text-white/50 border-l-transparent hover:bg-white/6 hover:text-white/80'
                  } ${collapsed ? 'justify-center pl-0 pr-0' : ''}`}
                >
                  <span className={isActive ? 'text-white' : 'text-white/40'}>{item.icon}</span>
                  {!collapsed && <span>{item.label}</span>}
                </button>
              );
            })}
          </>
        )}
      </nav>

      <div className={`px-4 py-3 border-t border-white/10 ${collapsed ? 'px-2 flex flex-col items-center' : ''}`}>
        {!collapsed && (
          <>
            <div className="text-[11.5px] text-white/70 font-medium truncate">{user?.full_name}</div>
            <div className="text-[10px] text-white/35 mb-2 truncate">{user?.role}</div>
          </>
        )}
        <button
          onClick={logout}
          title="Đăng xuất"
          className="flex items-center gap-1.5 text-white/35 hover:text-white/70 transition text-[11px]"
        >
          <LogOut size={11} /> {!collapsed && 'Đăng xuất'}
        </button>
      </div>
    </aside>
  );
}
