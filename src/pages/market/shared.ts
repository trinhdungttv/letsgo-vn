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

/** Chuẩn hoá tên KCN để SO KHỚP (không dùng để hiển thị): bỏ dấu, bỏ tiền tố loại hình
 * ("KCN", "Khu công nghiệp", "CCN", "KCX"…), gộp khoảng trắng. Nhờ vậy "BIÊN HOÀ 2" gõ tay
 * ở hồ sơ đối thủ vẫn khớp "KCN Biên Hoà 2" trong market_zones. */
export const zoneKey = (s?: string | null) => (s ?? '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[.,\-–—()]/g, ' ')
  .replace(/\b(khu cong nghiep|cum cong nghiep|khu che xuat|khu kinh te|kcn|ccn|kcx|kkt)\b/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

/** So khớp CHẶT 2 tên khu vực (sau khi chuẩn hoá phải bằng nhau).
 * Khác zoneMatches() kiểu "includes" ở WageTab/Quotes: ở đây "Tân Phú" KHÔNG khớp
 * "Tân Phú Trung" — dùng cho việc ghi nhận đối thủ theo KCN, nơi khớp nhầm nguy hiểm hơn bỏ sót. */
export const sameZone = (a?: string | null, b?: string | null) => {
  const ka = zoneKey(a);
  return !!ka && ka === zoneKey(b);
};

/** Giá trị mang nghĩa "phủ toàn quốc" hay gặp trong ô Trụ sở/Khu vực hoạt động của đối thủ. */
export const isNationwide = (s?: string | null) => ['toan quoc', 'ca nuoc', 'toan mien nam', 'toan mien bac'].includes(zoneKey(s));

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
