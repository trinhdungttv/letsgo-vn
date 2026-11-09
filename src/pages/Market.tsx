import { lazy, Suspense, useState } from 'react';
import { MapPin, Coins, Eye, Building2, GraduationCap, Map as MapIcon, Factory, Route } from 'lucide-react';
import { useHashTab } from '../hooks/useHashSubRoute';
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

const TABS: { id: MarketTab; label: string; icon: React.ReactNode }[] = [
  { id: 'zones', label: 'Khu vực', icon: <MapPin size={13} /> },
  { id: 'industry', label: 'Ngành Nghề', icon: <Factory size={13} /> },
  { id: 'wage', label: 'Lương TT', icon: <Coins size={13} /> },
  { id: 'comp', label: 'Đối thủ', icon: <Eye size={13} /> },
  { id: 'leads', label: 'Công ty / Dự án', icon: <Building2 size={13} /> },
  { id: 'sources', label: 'Nguồn LĐ', icon: <GraduationCap size={13} /> },
  { id: 'map', label: 'Bản đồ', icon: <MapIcon size={13} /> },
  { id: 'survey', label: 'Khảo sát KCN', icon: <Route size={13} /> },
];

export default function Market({ marketSurveys, competitors, marketZones, marketLeads, clients, laborHistory, onRefresh, toast }: MarketProps) {
  const MARKET_TAB_KEYS = ['zones', 'industry', 'wage', 'comp', 'leads', 'sources', 'map', 'survey'] as const;
  const [tab, setTabRaw] = useHashTab<MarketTab>('market', MARKET_TAB_KEYS, 'zones');
  const [zoneFilter, setZoneFilter] = useState('all');

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
      <PageHeader title="Thị trường" subtitle="Khu vực · Lương · Đối thủ · Công ty/Dự án · Nguồn LĐ · Khảo sát KCN" />
      <div className="flex-1 overflow-y-auto p-3 md:p-5 space-y-4">
        {/* Điện thoại: 8 tab thành 1 dải cuộn ngang thay vì xếp 3 dòng */}
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar -mx-3 px-3 md:mx-0 md:px-0 md:flex-wrap">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`shrink-0 whitespace-nowrap inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium border transition ${
                tab === t.id ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-[#E8E7E2] text-[#666] hover:bg-[#F9F9F7]'
              }`}
            >
              {t.icon}{t.label}
            </button>
          ))}
        </div>

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
