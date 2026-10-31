import { useEffect, useMemo, useState } from 'react';
import {
  BarChart3, Home, Building2, Building, Briefcase, DollarSign, MapPin, Landmark, History,
  LayoutDashboard, Network, UserCircle2, UsersRound, UserPlus, Package, Settings, Users,
  LogOut, MoreHorizontal, X, SlidersHorizontal, ChevronRight, ChevronLeft, GripVertical, Minus, Pin, Check,
} from 'lucide-react';
import type { Page } from '../lib/types';
import { useAuth, canAccess } from '../lib/auth';
import { OFFICE_ICON, OFFICE_NAV, isOfficePage } from '../modules/office-rental/pages';
import { BTN_PRIMARY, BTN_TINTED, ICON_TILE } from './workspace/wsTheme';

interface MobileNavProps {
  currentPage: Page;
  onNavigate: (page: Page) => void;
}

// Registry đầy đủ các trang điều hướng được — mirror Sidebar (NAV + CRM + ADMIN items).
// tile = màu ô icon kiểu iOS trong menu "Thêm" (cùng nhóm cùng màu).
const MOBILE_MENU: { page: Page; label: string; icon: React.ReactNode; tile: keyof typeof ICON_TILE }[] = [
  { page: 'reports',        label: 'Báo cáo',    icon: <BarChart3 size={21} />,       tile: 'indigo' },
  { page: 'dashboard',      label: 'Dashboard',  icon: <Home size={21} />,            tile: 'blue' },
  { page: 'clients',        label: 'Khách hàng', icon: <Building2 size={21} />,       tile: 'teal' },
  { page: 'recruit',        label: 'Tuyển dụng', icon: <UserPlus size={21} />,        tile: 'teal' },
  { page: 'workspace',      label: 'Workspace',  icon: <Briefcase size={21} />,       tile: 'blue' },
  { page: 'branches',       label: 'Chi nhánh',  icon: <Building size={21} />,        tile: 'teal' },
  { page: 'finance',        label: 'Tài chính',  icon: <DollarSign size={21} />,      tile: 'green' },
  { page: 'market',         label: 'Thị trường', icon: <MapPin size={21} />,          tile: 'red' },
  { page: 'loans',          label: 'Khoản vay',  icon: <Landmark size={21} />,        tile: 'green' },
  { page: 'history',        label: 'Lịch sử',    icon: <History size={21} />,         tile: 'gray' },
  // "CRM" mở thẳng Leads (trang CSKH) — trước đây mở Dashboard CRM rồi phải bấm thêm nút Leads
  { page: 'crm-leads',      label: 'CRM',        icon: <UserCircle2 size={21} />,     tile: 'purple' },
  { page: 'crm-dash',       label: 'Tổng quan CRM', icon: <LayoutDashboard size={21} />, tile: 'purple' },
  { page: 'crm-pipeline',   label: 'Pipeline',   icon: <Network size={21} />,         tile: 'purple' },
  { page: 'crm-sales',      label: 'Mạng lưới Sale', icon: <UsersRound size={21} />,   tile: 'orange' },
  { page: 'crm-prods',      label: 'Sản phẩm',   icon: <Package size={21} />,         tile: 'purple' },
  // Văn phòng Orient (chỉ admin) — gộp 10 trang thành 1 mục; bấm vào mở danh sách trang (xem OFFICE_NAV)
  { page: 'office',         label: 'VP Orient',  icon: <Building size={21} />,        tile: 'orange' },
  { page: 'admin-settings', label: 'Phân quyền', icon: <Settings size={21} />,        tile: 'gray' },
  { page: 'users',          label: 'Users',      icon: <Users size={21} />,           tile: 'gray' },
];

// Ô icon nhỏ trong danh sách tuỳ chỉnh: thu icon 21px về 18px cho vừa ô 32px
const LIST_TILE = 'w-8 h-8 rounded-[8px] text-white flex items-center justify-center shrink-0 [&>svg]:w-[18px] [&>svg]:h-[18px]';
// Nhóm danh sách kiểu iOS: thẻ trắng bo 12px, không viền
const GROUP = 'bg-white rounded-[12px] overflow-hidden';

const DEFAULT_PINS: Page[] = ['reports', 'dashboard', 'clients', 'workspace'];
const MAX_PINS = 4;

// Trang con quy về mục nav cha để highlight đúng tab.
function navIdOf(page: Page): Page {
  if (isOfficePage(page)) return 'office';
  if (page === 'client-detail') return 'clients';
  if (page === 'crm-board' || page === 'crm-deal') return 'crm-dash';
  return page;
}

function pinsKey(username?: string | null) {
  return `lgvn_mobile_pins_${username || 'anon'}`;
}

export default function MobileNav({ currentPage, onNavigate }: MobileNavProps) {
  const { user, logout, rolePermissions } = useAuth();
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
        // Ghim cũ của từng trang Văn phòng Orient → quy về mục gộp 'office' (bỏ trùng);
        // ghim "CRM" cũ (Dashboard CRM) → nay "CRM" là Leads nên chuyển sang 'crm-leads'
        const saved = (JSON.parse(raw) as Page[]).map(p => (isOfficePage(p) ? 'office' : p === 'crm-dash' ? 'crm-leads' : p) as Page);
        const parsed = saved.filter((p, i) => saved.indexOf(p) === i && MOBILE_MENU.some(m => m.page === p));
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
  const [officeView, setOfficeView] = useState(false);
  const [toast, setToast] = useState('');
  const notify = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 2200); };

  const activeId = navIdOf(currentPage);
  const moreActive = drawer || !visiblePins.includes(activeId);

  // Không đặt lại màn con khi đóng (tránh nháy nội dung lúc sheet trượt xuống) — mỗi lần mở mới đặt lại
  const closeDrawer = () => setDrawer(false);

  const go = (page: Page) => {
    onNavigate(page);
    closeDrawer();
  };

  // 'office' là mục gộp: mở danh sách các trang Văn phòng Orient thay vì đi thẳng tới một trang
  const pick = (page: Page) => {
    if (page === 'office') { setCustomize(false); setOfficeView(true); setDrawer(true); return; }
    go(page);
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
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 flex bg-[#F9F9F9]/[0.86] backdrop-blur-xl backdrop-saturate-150 border-t border-black/[0.1] px-1 pt-1.5 pb-[max(6px,env(safe-area-inset-bottom))]">
        {visiblePins.map(page => {
          const m = itemOf(page)!;
          const isActive = activeId === page && !drawer;
          return (
            <button
              key={page}
              onClick={() => pick(page)}
              className={`flex-1 flex flex-col items-center gap-0.5 py-1 transition-colors ${isActive ? 'text-[#0071E3]' : 'text-[#8E8E93]'}`}
            >
              {m.icon}
              <span className={`text-[10px] tracking-[0.01em] ${isActive ? 'font-semibold' : 'font-medium'}`}>{m.label}</span>
            </button>
          );
        })}
        <button
          onClick={() => { setCustomize(false); setOfficeView(false); setDrawer(true); }}
          className={`flex-1 flex flex-col items-center gap-0.5 py-1 transition-colors ${moreActive ? 'text-[#0071E3]' : 'text-[#8E8E93]'}`}
        >
          <MoreHorizontal size={21} />
          <span className={`text-[10px] tracking-[0.01em] ${moreActive ? 'font-semibold' : 'font-medium'}`}>Thêm</span>
        </button>
      </nav>

      {/* ==== Drawer ⋯ + màn tuỳ chỉnh ==== */}
      <div className={`md:hidden fixed inset-0 z-50 ${drawer ? '' : 'pointer-events-none'}`}>
        <div
          onClick={closeDrawer}
          className="absolute inset-0 bg-black/30 transition-opacity duration-300"
          style={{ opacity: drawer ? 1 : 0 }}
        />
        <div
          className="absolute inset-x-0 bottom-0 bg-[#F2F2F7] rounded-t-[22px] shadow-[0_-8px_40px_rgba(0,0,0,0.16)] transition-transform duration-300 flex flex-col"
          style={{
            transform: drawer ? 'translateY(0)' : 'translateY(105%)',
            transitionTimingFunction: 'cubic-bezier(0.32, 0.72, 0, 1)',
            maxHeight: customize || officeView ? '92vh' : '75vh',
          }}
        >
          <div className="flex justify-center pt-2.5 pb-0.5 shrink-0">
            <div className="w-9 h-[5px] rounded-full bg-[#C7C7CC]" />
          </div>

          {officeView ? (
            <>
              <div className="flex items-center gap-2 px-3 py-2 shrink-0">
                <button onClick={() => setOfficeView(false)} className="w-8 h-8 rounded-full text-[#0071E3] flex items-center justify-center active:bg-black/[0.05]">
                  <ChevronLeft size={22} />
                </button>
                <span className="flex-1 text-[17px] font-semibold tracking-[-0.01em] text-[#1D1D1F]">Văn phòng Orient</span>
                <button onClick={closeDrawer} className="w-[30px] h-[30px] rounded-full bg-black/[0.06] text-[#86868B] flex items-center justify-center active:bg-black/[0.1] transition-colors">
                  <X size={15} strokeWidth={2.5} />
                </button>
              </div>
              <div className="overflow-y-auto px-4 pb-[max(16px,env(safe-area-inset-bottom))]">
                <div className={GROUP}>
                  {OFFICE_NAV.filter(n => canAccess(role, n.page, rolePermissions)).map((n, i) => {
                    const Icon = OFFICE_ICON[n.page];
                    const isActive = currentPage === n.page;
                    return (
                      <button
                        key={n.page}
                        onClick={() => go(n.page)}
                        className={`flex items-center gap-3 w-full px-3.5 py-2.5 text-left active:bg-[#E5E5EA] transition-colors ${i ? 'border-t border-black/[0.06]' : ''}`}
                      >
                        <span className={`${LIST_TILE} ${ICON_TILE.orange}`}><Icon size={21} /></span>
                        <span className={`flex-1 text-[15px] ${isActive ? 'font-medium text-[#0071E3]' : 'text-[#1D1D1F]'}`}>{n.label}</span>
                        {isActive ? <Check size={17} className="text-[#0071E3] shrink-0" strokeWidth={2.5} /> : <ChevronRight size={16} className="text-[#C7C7CC] shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          ) : !customize ? (
            <>
              <div className="flex items-center justify-between px-4 py-2 shrink-0">
                <span className="text-[17px] font-semibold tracking-[-0.01em] text-[#1D1D1F]">Menu khác</span>
                <button onClick={() => setDrawer(false)} className="w-[30px] h-[30px] rounded-full bg-black/[0.06] text-[#86868B] flex items-center justify-center active:bg-black/[0.1] transition-colors">
                  <X size={15} strokeWidth={2.5} />
                </button>
              </div>
              <div className="overflow-y-auto px-4 pb-[max(16px,env(safe-area-inset-bottom))]">
                <div className="grid grid-cols-4 gap-x-2 gap-y-1">
                  {restItems.map(m => (
                    <button
                      key={m.page}
                      onClick={() => pick(m.page)}
                      className="flex flex-col items-center gap-1.5 py-2 rounded-[14px] active:bg-black/[0.04] active:scale-95 transition"
                    >
                      <span className={`w-[46px] h-[46px] rounded-[12px] ${ICON_TILE[m.tile]} text-white flex items-center justify-center shadow-[0_1px_2px_rgba(0,0,0,0.12)]`}>{m.icon}</span>
                      <span className="text-[11px] text-[#1D1D1F] font-medium leading-tight text-center">{m.label}</span>
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => setCustomize(true)}
                  className={`${GROUP} flex items-center gap-3 w-full mt-3 px-3.5 py-3 active:bg-[#E5E5EA] transition-colors`}
                >
                  <span className={`${LIST_TILE} ${ICON_TILE.blue}`}>
                    <SlidersHorizontal size={16} />
                  </span>
                  <span className="flex-1 text-left min-w-0">
                    <span className="block text-[14px] font-medium text-[#1D1D1F]">Tuỳ chỉnh thanh điều hướng</span>
                    <span className="block text-[12px] text-[#86868B]">Chọn 4 mục hay dùng nhất của bạn</span>
                  </span>
                  <ChevronRight size={16} className="text-[#C7C7CC] shrink-0" />
                </button>
                {/* Tài khoản: trên điện thoại không có thanh bên nên đăng xuất đặt ở đây */}
                <div className={`${GROUP} flex items-center gap-3 w-full mt-3 px-3.5 py-3`}>
                  <span className={`w-8 h-8 rounded-full ${ICON_TILE.gray} text-white flex items-center justify-center shrink-0`}><UserCircle2 size={18} /></span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[14px] font-medium text-[#1D1D1F] truncate">{user?.full_name || user?.username}</span>
                    <span className="block text-[12px] text-[#86868B] truncate">{user?.role}</span>
                  </span>
                  <button
                    onClick={() => { if (window.confirm('Đăng xuất khỏi tài khoản này?')) { setDrawer(false); logout(); } }}
                    className="shrink-0 flex items-center gap-1.5 px-3 py-[7px] rounded-full bg-[#FF3B30]/10 text-[#D70015] text-[12px] font-semibold active:scale-95 transition-transform"
                  >
                    <LogOut size={13} /> Đăng xuất
                  </button>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 px-3 py-2 shrink-0">
                <button onClick={() => setCustomize(false)} className="w-8 h-8 rounded-full text-[#0071E3] flex items-center justify-center active:bg-black/[0.05]">
                  <ChevronLeft size={22} />
                </button>
                <span className="flex-1 text-[17px] font-semibold tracking-[-0.01em] text-[#1D1D1F]">Tuỳ chỉnh điều hướng</span>
                <button
                  onClick={() => { setCustomize(false); setDrawer(false); }}
                  className={`${BTN_PRIMARY} px-4 py-[7px] text-[13px]`}
                >
                  Xong
                </button>
              </div>
              <div className="overflow-y-auto px-4 pb-[max(20px,env(safe-area-inset-bottom))]">
                <div className="px-3.5 text-[12px] text-[#6E6E73] tracking-wide mt-2 mb-1.5">
                  ĐANG GHIM · {visiblePins.length}/{MAX_PINS}
                </div>
                <div className={`${GROUP} mb-5`}>
                  {visiblePins.map((page, i) => {
                    const m = itemOf(page)!;
                    return (
                      <div key={page} className={`flex items-center gap-3 px-3.5 py-2.5 ${i ? 'border-t border-black/[0.06]' : ''}`}>
                        <button onClick={() => unpin(page)} className="w-[22px] h-[22px] rounded-full bg-[#FF3B30] text-white flex items-center justify-center shrink-0 active:scale-90 transition-transform">
                          <Minus size={14} strokeWidth={3} />
                        </button>
                        <span className={`${LIST_TILE} ${ICON_TILE[m.tile]}`}>{m.icon}</span>
                        <span className="flex-1 text-[15px] text-[#1D1D1F]">{m.label}</span>
                        <GripVertical size={17} className="text-[#C7C7CC] shrink-0" />
                      </div>
                    );
                  })}
                  {!visiblePins.length && (
                    <div className="px-4 py-4 text-[13px] text-[#86868B] text-center">Chưa ghim mục nào</div>
                  )}
                </div>

                <div className="px-3.5 text-[12px] text-[#6E6E73] tracking-wide mb-1.5">MENU KHÁC</div>
                <div className={GROUP}>
                  {restItems.map((m, i) => (
                    <div key={m.page} className={`flex items-center gap-3 px-3.5 py-2.5 ${i ? 'border-t border-black/[0.06]' : ''}`}>
                      <span className={`${LIST_TILE} ${ICON_TILE[m.tile]}`}>{m.icon}</span>
                      <span className="flex-1 text-[15px] text-[#1D1D1F]">{m.label}</span>
                      <button
                        onClick={() => pin(m.page)}
                        className={`px-2.5 py-[5px] text-[12px] ${
                          visiblePins.length >= MAX_PINS
                            ? 'inline-flex items-center gap-1 rounded-full bg-black/[0.04] text-[#AEAEB2] font-medium'
                            : BTN_TINTED
                        }`}
                      >
                        <Pin size={12} /> Ghim
                      </button>
                    </div>
                  ))}
                </div>
                <div className="text-[12px] text-[#86868B] text-center mt-3 leading-relaxed">
                  Thanh điều hướng cập nhật ngay khi bạn ghim/bỏ ghim.<br />Lưu trên thiết bị này theo tài khoản.
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {toast && (
        <div className="md:hidden fixed bottom-24 left-1/2 -translate-x-1/2 z-[60] bg-[#1D1D1F]/90 backdrop-blur-xl text-white text-[12px] px-4 py-2.5 rounded-[12px] whitespace-nowrap">
          {toast}
        </div>
      )}
    </>
  );
}
