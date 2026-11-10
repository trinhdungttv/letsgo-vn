import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Activity, Briefcase, Check, Gift, Grid3x3, HeartHandshake, LayoutGrid, List, Map as MapIcon, NotebookText, Settings2, UsersRound } from 'lucide-react';
import { ICON_TILE } from '../components/workspace/wsTheme';
import { usePersistedState } from '../hooks/usePersistedState';
import { canAccess, meetingLevel, SALE_PAGE, useAuth } from '../lib/auth';
import { SPACE_INFO, type CskhSpace } from '../lib/cskh/space';
import type { Client, CRMProduct, Page } from '../lib/types';
import type { CskhTabKey } from '../modules/cskh/context';

// Module CSKH (kiểu PRM) — tải bundle riêng khi mở trang (xem src/modules/cskh)
const CskhModule = lazy(() => import('../modules/cskh'));

interface Props {
  clients: Client[];
  /** Giữ chữ ký cũ của trang (App truyền vào) — module CSKH chưa dùng tới. */
  products?: CRMProduct[];
  /** Mở hồ sơ chi tiết công ty bên Khách hàng. */
  onSelectClient: (id: string) => void;
  /** Sang trang khác của app (VD Workspace để tái ký hợp đồng). */
  onNavigate: (page: Page) => void;
  toast: (m: string) => void;
}

// ── 2 tệp trong 1 trang (31/10/2026 gộp "Mạng lưới Sale" vào CSKH) ──────────────
// Khách hàng và Sale / CTV dùng chung bộ máy nhưng MỖI LÚC CHỈ HIỆN 1 TỆP, không trộn:
// cùng 1 hạng mang nghĩa khác nhau ở 2 tệp, nhịp khác nhau, quà khách bắt buộc gắn công ty…
//   • Quyền: chỉ người vào được SALE_PAGE (admin) mới thấy tệp Sale — người khác thấy y như CSKH cũ.
//   • Bánh răng: hiện cả 2 tệp (chuyển bằng nút) hoặc chỉ 1 tệp — nhớ theo máy, chỉ ẩn khỏi màn hình.
//   • Đường dẫn giữ tệp: #/crm-leads/<tab> = Khách hàng · #/crm-leads/sale/<tab> = Sale.
//     #/crm-leads (bấm menu) = tệp đầu tiên đang hiện. Link cũ #/crm-sales/… App tự đổi sang đây.
type SpaceView = 'both' | CskhSpace;
const VIEW_KEY = 'cskh_space_view';
const VIEW_OPTIONS: { key: SpaceView; label: string; hint: string }[] = [
  { key: 'both', label: 'Cả hai tệp', hint: 'Chuyển qua lại bằng nút, mỗi lúc 1 tệp' },
  { key: 'client', label: 'Chỉ Khách hàng', hint: 'Ẩn nút chuyển, chỉ chăm sóc khách' },
  { key: 'sale', label: 'Chỉ Sale / CTV', hint: 'Ẩn nút chuyển, chỉ Mạng lưới Sale' },
];

const SALE_SEGMENT = 'sale';
const TAB_KEYS = ['dashboard', 'matrix', 'map', 'cadence', 'log', 'events', 'meetings'] as const;
// 'contacts' = đường dẫn cũ của "Danh sách liên hệ" (nay là Ma trận);
// 'radar' = Relationship Radar cũ (thay bằng Dashboard + khối "Sức khỏe CSKH" ở hồ sơ Khách hàng)
const LEGACY_TAB: Record<string, CskhTabKey> = { contacts: 'matrix', radar: 'dashboard' };

/** Nhận diện từng tệp: ô icon, màu nhấn của tab đang chọn, chữ trên nút chuyển. */
const SPACE_LOOK: Record<CskhSpace, { Icon: LucideIcon; tile: string; accent: string; spin: string; label: string; hint: string }> = {
  client: { Icon: HeartHandshake, tile: ICON_TILE.red, accent: 'text-[#0071E3]', spin: 'border-t-[#0071E3]', label: 'Khách hàng', hint: 'Chăm sóc người đại diện công ty khách hàng' },
  sale: { Icon: UsersRound, tile: ICON_TILE.orange, accent: 'text-[#C93400]', spin: 'border-t-[#FF9500]', label: 'Sale / CTV', hint: 'Sale / CTV bên ngoài — trao đổi thông tin, giới thiệu khách, chiêu mộ' },
};

// short = nhãn khi màn hẹp hơn 1280px (thanh tab cuộn ngang, cần gọn)
// meetings = "Đi họp" (lịch đi họp + danh sách đăng ký ra vào cổng) — chỉ tệp Khách hàng, chỉ người có quyền 'Đi họp'
function tabsOf(space: CskhSpace, canMeet: boolean): { key: CskhTabKey; label: string; short: string; Icon: LucideIcon }[] {
  const info = SPACE_INFO[space];
  const sale = space === 'sale';
  return [
    { key: 'dashboard', label: 'Tổng quan', short: 'Tổng quan', Icon: LayoutGrid },
    { key: 'matrix', label: info.listTitle, short: info.listShort, Icon: sale ? List : Grid3x3 },
    { key: 'map', label: 'Bản đồ', short: 'Bản đồ', Icon: MapIcon },
    { key: 'cadence', label: sale ? 'Nhịp độ' : 'Nhịp độ Chăm sóc', short: 'Nhịp độ', Icon: Activity },
    { key: 'log', label: 'Nhật ký', short: 'Nhật ký', Icon: NotebookText },
    { key: 'events', label: 'Sự kiện & Quà tặng', short: 'Sự kiện & Quà', Icon: Gift },
    ...(!sale && canMeet ? [{ key: 'meetings' as const, label: 'Đi họp', short: 'Đi họp', Icon: Briefcase }] : []),
  ];
}

interface Route {
  /** null = đường dẫn không nói tệp nào (#/crm-leads) → tệp đầu tiên đang hiện. */
  space: CskhSpace | null;
  tab: CskhTabKey;
}

function parseRoute(): Route {
  const parts = window.location.hash.replace('#/', '').split('/');
  if (parts[0] !== 'crm-leads') return { space: null, tab: 'dashboard' };
  const sale = parts[1] === SALE_SEGMENT;
  const raw = (sale ? parts[2] : parts[1]) || '';
  const tab = (TAB_KEYS as readonly string[]).includes(raw) ? raw as CskhTabKey : LEGACY_TAB[raw] ?? 'dashboard';
  return { space: sale ? 'sale' : raw ? 'client' : null, tab };
}

const hashOf = (space: CskhSpace, tab: CskhTabKey) => `#/crm-leads/${space === 'sale' ? `${SALE_SEGMENT}/` : ''}${tab}`;

const CRMLeads: React.FC<Props> = ({ clients, onSelectClient, onNavigate, toast }) => {
  const { user, rolePermissions } = useAuth();
  const canSale = !!user && canAccess(user.role, SALE_PAGE, rolePermissions);
  const [view, setView] = usePersistedState<SpaceView>(VIEW_KEY, 'both');
  const visible: CskhSpace[] = !canSale ? ['client'] : view === 'client' || view === 'sale' ? [view] : ['client', 'sale'];

  // Tệp + tab đang mở nằm trên URL — F5, bookmark, gửi link đều về đúng tệp, đúng tab.
  const [route, setRoute] = useState<Route>(parseRoute);
  useEffect(() => {
    const sync = () => setRoute(parseRoute());
    window.addEventListener('popstate', sync);
    window.addEventListener('hashchange', sync);
    return () => { window.removeEventListener('popstate', sync); window.removeEventListener('hashchange', sync); };
  }, []);
  const space: CskhSpace = route.space && visible.includes(route.space) ? route.space : visible[0];
  const canMeet = !!user && meetingLevel(user.role, rolePermissions) !== 'none';
  // "Đi họp" chỉ có ở tệp Khách hàng (và người có quyền) — link/F5 ở chỗ khác thì về Tổng quan
  const tab: CskhTabKey = route.tab === 'meetings' && (space !== 'client' || !canMeet) ? 'dashboard' : route.tab;

  // Link mở tệp đang bị ẩn / không có quyền → về tệp đang hiện + nói rõ lý do (không im lặng đổi tệp)
  const wanted = route.space;
  useEffect(() => {
    if (!wanted || wanted === space || !user) return;
    window.history.replaceState(null, '', hashOf(space, tab));
    setRoute({ space, tab });
    toast(!canSale ? 'Chỉ tài khoản admin được xem tệp Sale / CTV'
      : `Tệp ${SPACE_LOOK[wanted].label} đang ẩn trên máy này — bật lại ở nút bánh răng cạnh tên trang`);
  }, [wanted, space, tab, canSale, user, toast]);

  const go = useCallback((s: CskhSpace, t: CskhTabKey) => {
    setRoute({ space: s, tab: t });
    const hash = hashOf(s, t);
    if (window.location.hash !== hash) window.history.pushState(null, '', hash);
  }, []);
  const setTab = useCallback((t: CskhTabKey) => go(space, t), [go, space]);

  // Số người cần liên hệ hôm nay ở tệp KHÔNG đang hiện — hiện trên nút chuyển để không bỏ sót
  const [due, setDue] = useState<Partial<Record<CskhSpace, number>>>({});
  const onDueCounts = useCallback((s: CskhSpace, n: number) => setDue(d => (d[s] === n ? d : { ...d, [s]: n })), []);

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [menuOpen]);

  const pickView = (v: SpaceView) => {
    setView(v);
    setMenuOpen(false);
    // Chọn "chỉ 1 tệp" khi đang xem tệp kia → sang luôn tệp đó, giữ tab
    if (v !== 'both' && v !== space) go(v, tab);
  };

  const look = SPACE_LOOK[space];
  const tabs = tabsOf(space, canMeet);
  const switchable = visible.length > 1;

  return (
    <>
      {/* Thanh trên kiểu Apple: [ô icon · nút chuyển tệp · bánh răng] — 6 tab ở giữa (cuộn ngang trên điện thoại).
          Màu theo tệp: Khách hàng = ô đỏ + nhấn xanh, Sale / CTV = ô cam + nhấn cam — nhìn là biết đang ở tệp nào. */}
      <div className="relative z-20 shrink-0 bg-[#F5F5F7]/90 backdrop-blur-xl border-b border-black/[0.06] px-3 md:px-8 py-2.5 flex flex-col gap-2 md:flex-row md:items-center md:gap-3">
        <div ref={menuRef} className={`relative items-center gap-2.5 min-w-0 ${canSale ? 'flex' : 'hidden xl:flex'}`}>
          <span title={look.hint} className={`w-8 h-8 shrink-0 rounded-[9px] ${look.tile} text-white flex items-center justify-center shadow-[0_1px_2px_rgba(0,0,0,0.12)]`}>
            <look.Icon size={17} strokeWidth={2.1} />
          </span>
          {switchable ? (
            <div role="tablist" aria-label="Tệp đang xem" className="flex p-[2px] rounded-[10px] bg-[rgba(118,118,128,0.12)] shrink-0">
              {visible.map(s => {
                const on = s === space;
                const L = SPACE_LOOK[s];
                const n = on ? 0 : due[s] ?? 0;
                return (
                  <button
                    key={s}
                    type="button"
                    role="tab"
                    aria-selected={on}
                    title={L.hint}
                    onClick={() => go(s, tab)}
                    className={[
                      'inline-flex items-center gap-1.5 px-3 h-9 md:h-8 rounded-[8px] text-[13px] transition-all whitespace-nowrap',
                      on
                        ? 'bg-white text-[#1D1D1F] font-semibold shadow-[0_3px_8px_rgba(0,0,0,0.12),0_1px_1px_rgba(0,0,0,0.04)]'
                        : 'text-[#3C3C43]/75 font-medium hover:text-[#1D1D1F]',
                    ].join(' ')}
                  >
                    <L.Icon size={15} strokeWidth={on ? 2.3 : 2} className={on ? (s === 'sale' ? 'text-[#FF9500]' : 'text-[#FF3B30]') : ''} />
                    {L.label}
                    {n > 0 && (
                      <span title={`${n} người cần liên hệ hôm nay`} className="min-w-[18px] h-[18px] px-1 rounded-full bg-[#FF3B30] text-white text-[11px] font-semibold leading-[18px] text-center tabular-nums">{n}</span>
                    )}
                  </button>
                );
              })}
            </div>
          ) : (
            <span className="text-[15px] font-semibold tracking-[-0.01em] text-[#1D1D1F] truncate">{SPACE_INFO[space].title}</span>
          )}
          {canSale && (
            <button
              type="button"
              onClick={() => setMenuOpen(o => !o)}
              aria-expanded={menuOpen}
              title="Chọn tệp hiển thị (Khách hàng / Sale – CTV)"
              className={`w-8 h-8 shrink-0 rounded-full flex items-center justify-center transition-colors ${menuOpen ? 'bg-black/[0.08] text-[#1D1D1F]' : 'text-[#86868B] hover:bg-black/[0.05] hover:text-[#1D1D1F]'}`}
            >
              <Settings2 size={16} />
            </button>
          )}
          {menuOpen && (
            <div role="menu" className="absolute left-0 top-full mt-2 w-[290px] max-w-[calc(100vw-24px)] bg-white rounded-[14px] shadow-[0_10px_30px_rgba(0,0,0,0.16),0_0_0_0.5px_rgba(0,0,0,0.08)] p-1.5">
              <div className="px-2.5 pt-1.5 pb-1 text-[12px] font-medium text-[#86868B]">Tệp hiển thị trên máy này</div>
              {VIEW_OPTIONS.map(o => {
                const on = o.key === view;
                return (
                  <button key={o.key} type="button" role="menuitemradio" aria-checked={on} onClick={() => pickView(o.key)}
                    className="w-full flex items-start gap-2.5 px-2.5 py-2 rounded-[9px] text-left hover:bg-black/[0.04] transition-colors">
                    <span className="w-4 pt-0.5 shrink-0 text-[#0071E3]">{on && <Check size={15} strokeWidth={2.5} />}</span>
                    <span className="min-w-0">
                      <span className={`block text-[13.5px] text-[#1D1D1F] ${on ? 'font-semibold' : ''}`}>{o.label}</span>
                      <span className="block text-[12px] text-[#86868B]">{o.hint}</span>
                    </span>
                  </button>
                );
              })}
              <p className="mx-2.5 mt-1 pt-2 pb-1 border-t border-[#E5E5EA] text-[11.5px] leading-snug text-[#86868B]">
                Chỉ ẩn khỏi màn hình. Dữ liệu và việc nhắc tự động trong Workspace của cả 2 tệp vẫn giữ nguyên.
              </p>
            </div>
          )}
        </div>

        <div role="tablist" aria-label={`Các trang ${SPACE_INFO[space].title}`}
          className="flex p-[2px] rounded-[10px] bg-[rgba(118,118,128,0.12)] max-w-full md:min-w-0 overflow-x-auto no-scrollbar md:mx-auto">
          {tabs.map(t => {
            const on = tab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setTab(t.key)}
                className={[
                  'shrink-0 inline-flex items-center gap-1.5 px-3 md:px-3.5 h-9 md:h-8 rounded-[8px] text-[13px] transition-all whitespace-nowrap',
                  on
                    ? 'bg-white text-[#1D1D1F] font-semibold shadow-[0_3px_8px_rgba(0,0,0,0.12),0_1px_1px_rgba(0,0,0,0.04)]'
                    : 'text-[#3C3C43]/75 font-medium hover:text-[#1D1D1F]',
                ].join(' ')}
              >
                <t.Icon size={15} strokeWidth={on ? 2.3 : 2} className={on ? look.accent : ''} />
                <span className="xl:hidden">{t.short}</span>
                <span className="hidden xl:inline">{t.label}</span>
              </button>
            );
          })}
        </div>
        {/* Không thấy tệp Sale: giữ tab nằm giữa trên màn rộng (cân với khối tiêu đề bên trái) như trước */}
        {!canSale && <div className="hidden xl:block w-[92px] shrink-0" aria-hidden />}
      </div>

      <div className="flex-1 overflow-y-auto bg-[#F5F5F7] px-3 md:px-8 pt-4 md:pt-6 pb-8 space-y-4 md:space-y-5">
        <Suspense fallback={<div className="py-16 flex justify-center"><div className={`w-5 h-5 border-2 border-black/[0.08] ${look.spin} rounded-full animate-spin`} /></div>}>
          <CskhModule
            space={space}
            spaces={visible}
            onDueCounts={switchable ? onDueCounts : undefined}
            tab={tab}
            onTab={setTab}
            clients={clients}
            toast={toast}
            onOpenWorkspace={() => onNavigate('workspace')}
            onOpenClient={onSelectClient}
          />
        </Suspense>
      </div>
    </>
  );
};

export default CRMLeads;
