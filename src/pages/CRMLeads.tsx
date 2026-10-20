import { lazy, Suspense } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Activity, Gift, Grid3x3, HeartHandshake, LayoutGrid, Map as MapIcon, NotebookText } from 'lucide-react';
import { ICON_TILE } from '../components/workspace/wsTheme';
import { useHashTab } from '../hooks/useHashSubRoute';
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

// 'contacts' = đường dẫn cũ của "Danh sách liên hệ" (nay là Ma trận);
// 'radar' = Relationship Radar cũ (thay bằng Dashboard + khối "Sức khỏe CSKH" ở hồ sơ Khách hàng)
type RouteTab = CskhTabKey | 'contacts' | 'radar';
const ROUTE_TABS = ['dashboard', 'matrix', 'map', 'cadence', 'log', 'events', 'contacts', 'radar'] as const;
// short = nhãn khi màn hẹp hơn 1280px (thanh tab cuộn ngang, cần gọn)
const TABS: { key: CskhTabKey; label: string; short: string; Icon: LucideIcon }[] = [
  { key: 'dashboard', label: 'Tổng quan', short: 'Tổng quan', Icon: LayoutGrid },
  { key: 'matrix', label: 'Ma trận Khách hàng', short: 'Ma trận', Icon: Grid3x3 },
  { key: 'map', label: 'Bản đồ', short: 'Bản đồ', Icon: MapIcon },
  { key: 'cadence', label: 'Nhịp độ Chăm sóc', short: 'Nhịp độ', Icon: Activity },
  { key: 'log', label: 'Nhật ký', short: 'Nhật ký', Icon: NotebookText },
  { key: 'events', label: 'Sự kiện & Quà tặng', short: 'Sự kiện & Quà', Icon: Gift },
];

const CRMLeads: React.FC<Props> = ({ clients, onSelectClient, onNavigate, toast }) => {
  // Ghi tab đang mở vào URL (#/crm-leads/log) — F5 hay bookmark đều quay lại đúng tab.
  const [raw, setTab] = useHashTab<RouteTab>('crm-leads', ROUTE_TABS, 'dashboard');
  const tab: CskhTabKey = raw === 'contacts' ? 'matrix' : raw === 'radar' ? 'dashboard' : raw;

  return (
    <>
      {/* Thanh trên kiểu Apple: ô icon + tên mục, điều khiển phân đoạn 6 tab (cuộn ngang trên điện thoại) */}
      <div className="shrink-0 bg-[#F5F5F7]/90 backdrop-blur-xl border-b border-black/[0.06] px-3 md:px-8 py-2.5 flex items-center gap-3">
        <div className="hidden xl:flex items-center gap-2.5 shrink-0" title="Chăm sóc người đại diện công ty khách hàng">
          <span className={`w-8 h-8 rounded-[9px] ${ICON_TILE.red} text-white flex items-center justify-center shadow-[0_1px_2px_rgba(0,0,0,0.12)]`}>
            <HeartHandshake size={17} strokeWidth={2.1} />
          </span>
          <span className="text-[15px] font-semibold tracking-[-0.01em] text-[#1D1D1F]">CSKH</span>
        </div>
        <div role="tablist" aria-label="Các trang CSKH"
          className="flex p-[2px] rounded-[10px] bg-[rgba(118,118,128,0.12)] max-w-full overflow-x-auto no-scrollbar xl:mx-auto">
          {TABS.map(t => {
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
                <t.Icon size={15} strokeWidth={on ? 2.3 : 2} className={on ? 'text-[#0071E3]' : ''} />
                <span className="xl:hidden">{t.short}</span>
                <span className="hidden xl:inline">{t.label}</span>
              </button>
            );
          })}
        </div>
        {/* giữ tab nằm giữa trên màn rộng (cân với khối tiêu đề bên trái) */}
        <div className="hidden xl:block w-[92px] shrink-0" aria-hidden />
      </div>

      <div className="flex-1 overflow-y-auto bg-[#F5F5F7] px-3 md:px-8 pt-4 md:pt-6 pb-8 space-y-4 md:space-y-5">
        <Suspense fallback={<div className="py-16 flex justify-center"><div className="w-5 h-5 border-2 border-black/[0.08] border-t-[#0071E3] rounded-full animate-spin" /></div>}>
          <CskhModule
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
