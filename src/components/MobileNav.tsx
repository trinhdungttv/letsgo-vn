import { useEffect, useMemo, useState } from 'react';
import {
  BarChart3, Home, Building2, Building, Briefcase, DollarSign, MapPin, Landmark, History,
  LayoutDashboard, Network, UserCircle2, Package, Settings, Users,
  MoreHorizontal, X, SlidersHorizontal, ChevronRight, ChevronLeft, GripVertical, Minus, Pin,
} from 'lucide-react';
import type { Page } from '../lib/types';
import { useAuth, canAccess } from '../lib/auth';

interface MobileNavProps {
  currentPage: Page;
  onNavigate: (page: Page) => void;
}

// Registry đầy đủ các trang điều hướng được — mirror Sidebar (NAV + CRM + ADMIN items).
const MOBILE_MENU: { page: Page; label: string; icon: React.ReactNode }[] = [
  { page: 'reports',        label: 'Báo cáo',    icon: <BarChart3 size={21} /> },
  { page: 'dashboard',      label: 'Dashboard',  icon: <Home size={21} /> },
  { page: 'clients',        label: 'Khách hàng', icon: <Building2 size={21} /> },
  { page: 'workspace',      label: 'Workspace',  icon: <Briefcase size={21} /> },
  { page: 'branches',       label: 'Chi nhánh',  icon: <Building size={21} /> },
  { page: 'finance',        label: 'Tài chính',  icon: <DollarSign size={21} /> },
  { page: 'market',         label: 'Thị trường', icon: <MapPin size={21} /> },
  { page: 'loans',          label: 'Khoản vay',  icon: <Landmark size={21} /> },
  { page: 'history',        label: 'Lịch sử',    icon: <History size={21} /> },
  { page: 'crm-dash',       label: 'CRM',        icon: <LayoutDashboard size={21} /> },
  { page: 'crm-pipeline',   label: 'Pipeline',   icon: <Network size={21} /> },
  { page: 'crm-leads',      label: 'CSKH',       icon: <UserCircle2 size={21} /> },
  { page: 'crm-prods',      label: 'Sản phẩm',   icon: <Package size={21} /> },
  { page: 'admin-settings', label: 'Phân quyền', icon: <Settings size={21} /> },
  { page: 'users',          label: 'Users',      icon: <Users size={21} /> },
];

const DEFAULT_PINS: Page[] = ['reports', 'dashboard', 'clients', 'workspace'];
const MAX_PINS = 4;

// Trang con quy về mục nav cha để highlight đúng tab.
function navIdOf(page: Page): Page {
  if (page === 'client-detail') return 'clients';
  if (page === 'crm-board' || page === 'crm-deal') return 'crm-dash';
  return page;
}

function pinsKey(username?: string | null) {
  return `lgvn_mobile_pins_${username || 'anon'}`;
}

export default function MobileNav({ currentPage, onNavigate }: MobileNavProps) {
  const { user, rolePermissions } = useAuth();
  const role = user?.role || 'kinhdoanh';

  const allowed = useMemo(
    () => MOBILE_MENU.filter(m => canAccess(role, m.page, rolePermissions)),
    [role, rolePermissions]
  );
  const allowedIds = useMemo(() => new Set(allowed.map(m => m.page)), [allowed]);

  const [pins, setPins] = useState<Page[]>(DEFAULT_PINS);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(pinsKey(user?.username));
      if (raw) {
        const parsed = (JSON.parse(raw) as Page[]).filter(p => MOBILE_MENU.some(m => m.page === p));
        if (parsed.length) setPins(parsed.slice(0, MAX_PINS));
      }
    } catch { /* giữ mặc định */ }
  }, [user?.username]);

  const savePins = (next: Page[]) => {
    setPins(next);
    try { localStorage.setItem(pinsKey(user?.username), JSON.stringify(next)); } catch { /* ignore */ }
  };

  const visiblePins = pins.filter(p => allowedIds.has(p)).slice(0, MAX_PINS);
  const restItems = allowed.filter(m => !visiblePins.includes(m.page));

  const [drawer, setDrawer] = useState(false);
  const [customize, setCustomize] = useState(false);
  const [toast, setToast] = useState('');
  const notify = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 2200); };

  const activeId = navIdOf(currentPage);
  const moreActive = drawer || !visiblePins.includes(activeId);

  const go = (page: Page) => {
    onNavigate(page);
    setDrawer(false);
    setCustomize(false);
  };

  const unpin = (page: Page) => savePins(visiblePins.filter(p => p !== page));
  const pin = (page: Page) => {
    if (visiblePins.length >= MAX_PINS) { notify('Tối đa 4 mục — bỏ ghim một mục trước'); return; }
    savePins([...visiblePins, page]);
  };

  const itemOf = (page: Page) => MOBILE_MENU.find(m => m.page === page);

  return (
    <>
      {/* ==== Bottom nav — chỉ hiện trên mobile ==== */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 flex bg-white/95 backdrop-blur-lg border-t border-[#E8E7E2] px-1 pt-1.5 pb-[max(6px,env(safe-area-inset-bottom))]">
        {visiblePins.map(page => {
          const m = itemOf(page)!;
          const isActive = activeId === page && !drawer;
          return (
            <button
              key={page}
              onClick={() => go(page)}
              className={`flex-1 flex flex-col items-center gap-0.5 py-1 ${isActive ? 'text-[#1D4ED8]' : 'text-[#8B8A85]'}`}
            >
              {m.icon}
              <span className={`text-[9.5px] ${isActive ? 'font-semibold' : 'font-medium'}`}>{m.label}</span>
            </button>
          );
        })}
        <button
          onClick={() => setDrawer(true)}
          className={`flex-1 flex flex-col items-center gap-0.5 py-1 ${moreActive ? 'text-[#1D4ED8]' : 'text-[#8B8A85]'}`}
        >
          <MoreHorizontal size={21} />
          <span className="text-[9.5px] font-medium">Thêm</span>
        </button>
      </nav>

      {/* ==== Drawer ⋯ + màn tuỳ chỉnh ==== */}
      <div className={`md:hidden fixed inset-0 z-50 ${drawer ? '' : 'pointer-events-none'}`}>
        <div
          onClick={() => { setDrawer(false); setCustomize(false); }}
          className="absolute inset-0 bg-[#0c2340]/40 transition-opacity duration-300"
          style={{ opacity: drawer ? 1 : 0 }}
        />
        <div
          className="absolute inset-x-0 bottom-0 bg-[#F7F6F2] rounded-t-[22px] shadow-[0_-8px_40px_rgba(12,35,64,0.18)] transition-transform duration-300 flex flex-col"
          style={{
            transform: drawer ? 'translateY(0)' : 'translateY(105%)',
            transitionTimingFunction: 'cubic-bezier(0.32, 0.72, 0, 1)',
            maxHeight: customize ? '92vh' : '75vh',
          }}
        >
          <div className="flex justify-center pt-2.5 pb-0.5 shrink-0">
            <div className="w-9 h-[5px] rounded-full bg-[#D6D4CC]" />
          </div>

          {!customize ? (
            <>
              <div className="flex items-center justify-between px-4 py-2 shrink-0">
                <span className="text-[14px] font-bold text-[#111]">Menu khác</span>
                <button onClick={() => setDrawer(false)} className="w-7 h-7 rounded-full bg-[#EAE8E1] text-[#666] flex items-center justify-center">
                  <X size={14} />
                </button>
              </div>
              <div className="overflow-y-auto px-4 pb-[max(16px,env(safe-area-inset-bottom))]">
                <div className="grid grid-cols-4 gap-2">
                  {restItems.map(m => (
                    <button
                      key={m.page}
                      onClick={() => go(m.page)}
                      className="flex flex-col items-center gap-1.5 py-3 bg-white border border-[#E8E7E2] rounded-[14px] text-[#0c2340] active:scale-95 transition-transform"
                    >
                      {m.icon}
                      <span className="text-[10px] text-[#444] font-medium">{m.label}</span>
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => setCustomize(true)}
                  className="flex items-center gap-2.5 w-full mt-3 px-3.5 py-3 bg-white border border-[#E8E7E2] rounded-[14px] active:scale-[0.98] transition-transform"
                >
                  <span className="w-[30px] h-[30px] rounded-[9px] bg-blue-50 text-[#1D4ED8] flex items-center justify-center shrink-0">
                    <SlidersHorizontal size={16} />
                  </span>
                  <span className="flex-1 text-left">
                    <span className="block text-[12.5px] font-semibold text-[#111]">Tuỳ chỉnh thanh điều hướng</span>
                    <span className="block text-[10.5px] text-[#888]">Chọn 4 mục hay dùng nhất của bạn</span>
                  </span>
                  <ChevronRight size={16} className="text-[#bbb]" />
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 px-3 py-2 shrink-0">
                <button onClick={() => setCustomize(false)} className="w-8 h-8 rounded-[10px] text-[#1D4ED8] flex items-center justify-center">
                  <ChevronLeft size={20} />
                </button>
                <span className="flex-1 text-[15px] font-bold text-[#111]">Tuỳ chỉnh điều hướng</span>
                <button
                  onClick={() => { setCustomize(false); setDrawer(false); }}
                  className="px-4 py-[7px] text-[12.5px] font-semibold text-white bg-[#1D4ED8] rounded-[10px]"
                >
                  Xong
                </button>
              </div>
              <div className="overflow-y-auto px-4 pb-[max(20px,env(safe-area-inset-bottom))]">
                <div className="text-[11px] font-semibold text-[#888] tracking-wide mt-2 mb-2">
                  ĐANG GHIM · {visiblePins.length}/{MAX_PINS}
                </div>
                <div className="bg-white border border-[#E8E7E2] rounded-[14px] overflow-hidden mb-4">
                  {visiblePins.map((page, i) => {
                    const m = itemOf(page)!;
                    return (
                      <div key={page} className={`flex items-center gap-2.5 px-3 py-2.5 ${i ? 'border-t border-[#F0EEE9]' : ''}`}>
                        <GripVertical size={17} className="text-[#C9C7BF] shrink-0" />
                        <span className="w-8 h-8 rounded-[10px] bg-blue-50 text-[#1D4ED8] flex items-center justify-center shrink-0">{m.icon}</span>
                        <span className="flex-1 text-[13px] font-semibold text-[#111]">{m.label}</span>
                        <button onClick={() => unpin(page)} className="w-[26px] h-[26px] rounded-full bg-red-50 text-red-600 flex items-center justify-center">
                          <Minus size={14} />
                        </button>
                      </div>
                    );
                  })}
                  {!visiblePins.length && (
                    <div className="px-4 py-4 text-[12px] text-[#aaa] text-center">Chưa ghim mục nào</div>
                  )}
                </div>

                <div className="text-[11px] font-semibold text-[#888] tracking-wide mb-2">MENU KHÁC</div>
                <div className="bg-white border border-[#E8E7E2] rounded-[14px] overflow-hidden">
                  {restItems.map((m, i) => (
                    <div key={m.page} className={`flex items-center gap-2.5 px-3 py-2.5 ${i ? 'border-t border-[#F0EEE9]' : ''}`}>
                      <span className="w-8 h-8 rounded-[10px] bg-[#F1EFE8] text-[#5F5E5A] flex items-center justify-center shrink-0">{m.icon}</span>
                      <span className="flex-1 text-[13px] font-medium text-[#111]">{m.label}</span>
                      <button
                        onClick={() => pin(m.page)}
                        className={`flex items-center gap-1 px-2.5 py-[5px] text-[11px] font-semibold rounded-[9px] border ${
                          visiblePins.length >= MAX_PINS
                            ? 'border-[#E8E7E2] bg-[#F7F6F2] text-[#B4B2A9]'
                            : 'border-blue-200 bg-blue-50 text-[#1D4ED8]'
                        }`}
                      >
                        <Pin size={12} /> Ghim
                      </button>
                    </div>
                  ))}
                </div>
                <div className="text-[10.5px] text-[#aaa] text-center mt-3 leading-relaxed">
                  Thanh điều hướng cập nhật ngay khi bạn ghim/bỏ ghim.<br />Lưu trên thiết bị này theo tài khoản.
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {toast && (
        <div className="md:hidden fixed bottom-24 left-1/2 -translate-x-1/2 z-[60] bg-[#111]/95 text-white text-[11.5px] px-4 py-2.5 rounded-xl whitespace-nowrap">
          {toast}
        </div>
      )}
    </>
  );
}
