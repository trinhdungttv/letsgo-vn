import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { MapPin, Coins, Eye, Building2, GraduationCap, Map as MapIcon, Factory, Route, type LucideIcon } from 'lucide-react';
import { useHashTab } from '../hooks/useHashSubRoute';
import { useIsMobile } from '../hooks/useIsMobile';
import PageHeader from '../components/PageHeader';
import type { MarketSurvey, Competitor, MarketZone, MarketLead, Client, LaborHistoryEntry } from '../lib/types';
import ZonesTab from './market/ZonesTab';
import IndustryTab from './market/IndustryTab';
import WageTab from './market/WageTab';
import CompetitorsTab from './market/CompetitorsTab';
import LeadsTab from './market/LeadsTab';
import MapViewTab from './market/MapViewTab';
import SurveyTab from './market/SurveyTab';
// Nguồn LĐ (thay tab Báo giá 09/11/2026) — tải riêng khi mở tab
const LaborSourcesTab = lazy(() => import('./market/sources/LaborSourcesTab'));

export type MarketTab = 'zones' | 'industry' | 'wage' | 'comp' | 'leads' | 'sources' | 'map' | 'survey';

interface MarketProps {
  marketSurveys: MarketSurvey[];
  competitors: Competitor[];
  marketZones: MarketZone[];
  marketLeads: MarketLead[];
  clients: Client[];
  laborHistory: Record<string, LaborHistoryEntry[]>;
  onRefresh: () => Promise<void>;
  toast: (msg: string) => void;
}

// short = nhãn trên điện thoại (ô lưới 4 cột, ~80px)
const TABS: { id: MarketTab; label: string; short?: string; Icon: LucideIcon }[] = [
  { id: 'zones', label: 'Khu vực', Icon: MapPin },
  { id: 'industry', label: 'Ngành Nghề', Icon: Factory },
  { id: 'wage', label: 'Lương TT', Icon: Coins },
  { id: 'comp', label: 'Đối thủ', Icon: Eye },
  { id: 'leads', label: 'Công ty / Dự án', short: 'Cty / Dự án', Icon: Building2 },
  { id: 'sources', label: 'Nguồn LĐ', Icon: GraduationCap },
  { id: 'map', label: 'Bản đồ', Icon: MapIcon },
  { id: 'survey', label: 'Khảo sát KCN', Icon: Route },
];

export default function Market({ marketSurveys, competitors, marketZones, marketLeads, clients, laborHistory, onRefresh, toast }: MarketProps) {
  const MARKET_TAB_KEYS = ['zones', 'industry', 'wage', 'comp', 'leads', 'sources', 'map', 'survey'] as const;
  const [tab, setTabRaw] = useHashTab<MarketTab>('market', MARKET_TAB_KEYS, 'zones');
  const [zoneFilter, setZoneFilter] = useState('all');
  const isMobile = useIsMobile();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Menu tab nay nằm cố định ngoài vùng cuộn → đổi tab lúc đang cuộn sâu thì về đầu tab mới
  useEffect(() => { scrollRef.current?.scrollTo({ top: 0 }); }, [tab]);

  const setTab = (t: MarketTab) => setTabRaw(t);
  const goTab = (t: MarketTab, zone?: string) => {
    setTab(t);
    if (zone !== undefined) setZoneFilter(zone);
  };

  const shared = {
    marketZones, marketSurveys, competitors, marketLeads, clients, laborHistory,
    zoneFilter, setZoneFilter, goTab, onRefresh, toast,
  };

  return (
    <>
      {/* Điện thoại: bỏ phụ đề (trùng tên tab) để dành chỗ cho menu */}
      <PageHeader title="Thị trường" subtitle={isMobile ? undefined : 'Khu vực · Lương · Đối thủ · Công ty/Dự án · Nguồn LĐ · Khảo sát KCN'} />
      {/* Menu tab CỐ ĐỊNH ngoài vùng cuộn (12/11/2026). Điện thoại: lưới 4×2 thấy đủ 8 tab, không phải
          vuốt ngang — dải cuộn ngang cũ hay kéo cả trang trượt theo. Máy tính: 1 hàng nút như cũ. */}
      <nav aria-label="Mục Thị trường" className="shrink-0 bg-white border-b border-[#E8E7E2] px-2 py-1.5 md:px-5 md:py-2.5">
        <div className="grid grid-cols-4 gap-1 md:flex md:flex-wrap md:gap-1.5">
          {TABS.map(({ id, label, short, Icon }) => {
            const on = tab === id;
            return (
              <button
                key={id}
                onClick={() => setTab(id)}
                aria-current={on ? 'page' : undefined}
                className={`min-w-0 h-[44px] px-1 flex flex-col items-center justify-center gap-0.5 rounded-xl text-[11px] leading-tight font-medium transition
                  md:h-auto md:flex-row md:gap-1.5 md:px-3 md:py-1.5 md:rounded-lg md:text-[12px] md:border md:whitespace-nowrap ${
                  on
                    ? 'bg-blue-50 text-blue-700 md:border-blue-200'
                    : 'text-[#666] active:bg-[#F2F2F0] md:bg-white md:border-[#E8E7E2] md:hover:bg-[#F9F9F7]'
                }`}
              >
                <Icon className="w-4 h-4 md:w-[13px] md:h-[13px] shrink-0" />
                <span className="max-w-full truncate md:hidden">{short ?? label}</span>
                <span className="hidden md:inline">{label}</span>
              </button>
            );
          })}
        </div>
      </nav>
      {/* overflow-x-hidden: khối nào lỡ rộng hơn màn hình cũng không kéo cả trang trượt ngang */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto overflow-x-hidden p-3 md:p-5 space-y-4">
        {tab === 'zones' && <ZonesTab {...shared} />}
        {tab === 'industry' && <IndustryTab clients={clients} marketLeads={marketLeads} marketSurveys={marketSurveys} competitors={competitors} goTab={goTab} toast={toast} />}
        {tab === 'wage' && <WageTab {...shared} />}
        {tab === 'comp' && <CompetitorsTab {...shared} />}
        {tab === 'leads' && <LeadsTab {...shared} />}
        {tab === 'map' && <MapViewTab {...shared} />}
        {tab === 'survey' && <SurveyTab {...shared} />}
        {tab === 'sources' && (
          <Suspense fallback={<div className="py-12 text-center text-[12px] text-[#999]">Đang tải…</div>}>
            <LaborSourcesTab {...shared} />
          </Suspense>
        )}
      </div>
    </>
  );
}
