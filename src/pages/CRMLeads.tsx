import { lazy, Suspense } from 'react';
import PageHeader from '../components/PageHeader';
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
const TABS: { key: CskhTabKey; label: string }[] = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'matrix', label: 'Ma trận Khách hàng' },
  { key: 'map', label: 'Bản đồ Khách hàng' },
  { key: 'cadence', label: 'Nhịp độ Chăm sóc' },
  { key: 'log', label: 'Nhật ký CSKH' },
  { key: 'events', label: 'Sự kiện & Quà tặng' },
];

const CRMLeads: React.FC<Props> = ({ clients, onSelectClient, onNavigate, toast }) => {
  // Ghi tab đang mở vào URL (#/crm-leads/log) — F5 hay bookmark đều quay lại đúng tab.
  const [raw, setTab] = useHashTab<RouteTab>('crm-leads', ROUTE_TABS, 'dashboard');
  const tab: CskhTabKey = raw === 'contacts' ? 'matrix' : raw === 'radar' ? 'dashboard' : raw;

  return (
    <>
      <PageHeader title="CSKH" subtitle="Chăm sóc người đại diện công ty khách hàng" />

      <div className="flex-1 overflow-y-auto p-3 md:p-5 space-y-4">
        {/* Thanh tab CSKH — cuộn ngang trên điện thoại */}
        <div className="flex gap-0.5 bg-[rgba(118,118,128,0.12)] rounded-[10px] p-[2px] w-fit max-w-full overflow-x-auto no-scrollbar">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={[
                'px-3.5 h-9 md:h-8 rounded-[8px] text-[13px] transition-all whitespace-nowrap',
                tab === t.key
                  ? 'bg-white text-[#1D1D1F] font-semibold shadow-[0_3px_8px_rgba(0,0,0,0.12),0_1px_1px_rgba(0,0,0,0.04)]'
                  : 'text-[#3C3C43]/75 font-medium hover:text-[#1D1D1F]',
              ].join(' ')}
            >
              {t.label}
            </button>
          ))}
        </div>

        <Suspense fallback={<div className="py-16 flex justify-center"><div className="w-5 h-5 border-2 border-gray-200 border-t-blue-500 rounded-full animate-spin" /></div>}>
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
