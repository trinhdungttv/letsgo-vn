import { useState } from 'react';
import { Home, Building2, DollarSign, MapPin, Calculator, BarChart3, Users, LogOut, LayoutDashboard, KanbanSquare, UserCircle2, Package, ChevronDown, ChevronRight, Network } from 'lucide-react';
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
];

const CRM_ITEMS: { page: Page; label: string; icon: React.ReactNode }[] = [
  { page: 'crm-dash',     label: 'Dashboard',   icon: <LayoutDashboard size={13} /> },
  { page: 'crm-pipeline', label: 'BD Pipeline', icon: <Network size={13} /> },
  { page: 'crm-board',    label: 'Deals',       icon: <KanbanSquare size={13} /> },
  { page: 'crm-leads',    label: 'CSKH',        icon: <UserCircle2 size={13} /> },
  { page: 'crm-prods',    label: 'Sản phẩm',   icon: <Package size={13} /> },
];

const CRM_PAGES: Page[] = ['crm-dash', 'crm-board', 'crm-leads', 'crm-prods', 'crm-deal', 'crm-pipeline'];

export default function Sidebar({ currentPage, onNavigate }: SidebarProps) {
  const { user, logout } = useAuth();
  const role = user?.role || 'kinhdoanh';
  const activeP = (currentPage === 'client-detail' ? 'clients' : currentPage) as Page;
  const isCrmActive = CRM_PAGES.includes(currentPage);
  const [crmOpen, setCrmOpen] = useState(isCrmActive);

  const hasCRM = CRM_ITEMS.some(item => canAccess(role, item.page));

  return (
    <aside className="w-[190px] bg-[#0c2340] flex-shrink-0 flex flex-col h-screen">
      <div className="px-4 py-4 border-b border-white/10">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-blue-500 flex items-center justify-center shrink-0">
            <span className="text-white font-bold text-[12px]">LG</span>
          </div>
          <div>
            <div className="text-[13px] font-semibold text-white leading-tight">Let's Go VN</div>
            <div className="text-[10px] text-white/40 mt-0.5">Ops v5.0</div>
          </div>
        </div>
      </div>

      <nav className="flex-1 py-1.5 overflow-y-auto">
        {NAV_ITEMS.filter(item => canAccess(role, item.page)).map(item => {
          const isActive = activeP === item.page;
          return (
            <button
              key={item.page}
              onClick={() => onNavigate(item.page)}
              className={`flex items-center gap-2.5 px-4 py-2 text-[12px] w-full text-left transition-all border-l-[3px] ${
                isActive
                  ? 'bg-white/10 text-white border-l-blue-400'
                  : 'text-white/50 border-l-transparent hover:bg-white/6 hover:text-white/80'
              }`}
            >
              <span className={isActive ? 'text-white' : 'text-white/40'}>{item.icon}</span>
              <span className="flex-1">{item.label}</span>
            </button>
          );
        })}

        {/* CRM Module section */}
        {hasCRM && (
          <>
            <div className="mx-4 my-2 border-t border-white/10" />
            <button
              onClick={() => setCrmOpen(!crmOpen)}
              className="flex items-center gap-2 px-4 py-1.5 w-full text-left text-[10.5px] font-semibold text-white/30 uppercase tracking-wider hover:text-white/50 transition"
            >
              <span className="flex-1">CRM Module</span>
              {crmOpen ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
            </button>
            {crmOpen && CRM_ITEMS.filter(item => canAccess(role, item.page)).map(item => {
              const isActive = activeP === item.page || (currentPage === 'crm-deal' && item.page === 'crm-board');
              return (
                <button
                  key={item.page}
                  onClick={() => onNavigate(item.page)}
                  className={`flex items-center gap-2 pl-6 pr-4 py-1.5 text-[12px] w-full text-left transition-all border-l-[3px] ${
                    isActive
                      ? 'bg-white/10 text-white border-l-blue-400'
                      : 'text-white/50 border-l-transparent hover:bg-white/6 hover:text-white/80'
                  }`}
                >
                  <span className={isActive ? 'text-white' : 'text-white/40'}>{item.icon}</span>
                  <span>{item.label}</span>
                </button>
              );
            })}
          </>
        )}
      </nav>

      <div className="px-4 py-3 border-t border-white/10">
        <div className="text-[11.5px] text-white/70 font-medium truncate">{user?.full_name}</div>
        <div className="text-[10px] text-white/35 mb-2 truncate">{user?.role}</div>
        <button
          onClick={logout}
          className="flex items-center gap-1.5 text-white/35 hover:text-white/70 transition text-[11px]"
        >
          <LogOut size={11} /> Đăng xuất
        </button>
      </div>
    </aside>
  );
}
