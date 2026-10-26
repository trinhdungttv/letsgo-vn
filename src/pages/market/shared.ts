import type { MarketZone, MarketSurvey, Competitor, MarketLead, Client, LaborHistoryEntry } from '../../lib/types';
import type { MarketTab } from '../Market';

export const fmtTr = (v: number | null | undefined) => v != null ? (v / 1_000_000).toFixed(1) + 'tr' : '—';

export const occColor = (occ: number | null | undefined) => {
  const o = occ ?? 0;
  return o >= 90 ? 'text-emerald-600 bg-emerald-500' : o >= 75 ? 'text-amber-600 bg-amber-500' : 'text-red-600 bg-red-500';
};

export const LABOR_AVAIL_OPTIONS = ['Dồi dào', 'Trung bình', 'Khan hiếm'];

export const availPillCls = (v: string) =>
  v === 'Dồi dào' ? 'bg-emerald-50 text-emerald-700' : v === 'Khan hiếm' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700';

// So khớp tên KCN (zoneKey / sameZone / isNationwide) đặt ở src/lib/zoneMatch.ts để tầng lib dùng
// được mà không phải import ngược lên pages/; re-export ở đây để các import cũ vẫn chạy nguyên.
export { zoneKey, sameZone, isNationwide } from '../../lib/zoneMatch';

export interface MarketTabProps {
  marketZones: MarketZone[];
  marketSurveys: MarketSurvey[];
  competitors: Competitor[];
  marketLeads: MarketLead[];
  clients: Client[];
  /** Lịch sử lao động theo tuần của từng khách hàng — nguồn của "số LĐ mới nhất". */
  laborHistory: Record<string, LaborHistoryEntry[]>;
  zoneFilter: string;
  setZoneFilter: (z: string) => void;
  goTab: (tab: MarketTab, zone?: string) => void;
  onRefresh: () => Promise<void>;
  toast: (msg: string) => void;
}
