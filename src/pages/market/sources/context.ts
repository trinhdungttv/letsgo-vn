// Dữ liệu dùng chung cho mọi màn của tab Nguồn LĐ (nạp 1 lần ở LaborSourcesTab).
import { createContext, useContext } from 'react';
import type { AppUser, Branch, Client, MarketLead, MarketZone } from '../../../lib/types';
import type { LaborData } from '../../../lib/laborSources/api';
import type { MatchCompany } from '../../../lib/laborSources/match';
import type { NamedTarget } from '../../../lib/laborSources/targets';
import type { InternWindow, LaborSource, RouteRow, RouteTargetType, SourceBatch, SourceContact, SourceProgram } from '../../../lib/laborSources/types';

export interface IndustryLite { id: string; name: string; season_levels: number[] | null }
export interface UserLite { id: string; full_name: string }
/** Nhóm CSKH của tệp Sale / CTV (VD "Ban giám hiệu / Đại diện trường"). */
export interface GroupLite { id: string; name: string; base_tier: string | null }

export interface LaborCtx {
  data: LaborData;
  loading: boolean;
  today: string;
  user: AppUser | null;
  zones: MarketZone[];
  clients: Client[];
  leads: MarketLead[];
  branches: Branch[];
  industries: IndustryLite[];
  /** Đối thủ (Thị trường → Đối thủ) — mỗi công ty 1 mục (gộp các dòng cùng tên ở nhiều KCN). */
  competitorOptions: { id: string; name: string }[];
  /** Tên đối thủ (đã bỏ trùng) từ danh sách mã đã gắn. */
  competitorNames: (ids: readonly string[]) => string[];
  users: UserLite[];
  groups: GroupLite[];
  targets: NamedTarget[];
  companies: MatchCompany[];
  programsBy: Map<string, SourceProgram[]>;
  windowsBy: Map<string, InternWindow[]>;
  batchesBy: Map<string, SourceBatch[]>;
  contactsBy: Map<string, SourceContact[]>;
  /** Tháng có SV đi thực tập trong 12 tháng tới, theo đơn vị. */
  monthsBy: Map<string, number[]>;
  routeIdx: Map<string, RouteRow>;
  route: (sourceId: string, type: RouteTargetType, id: string) => RouteRow | undefined;
  reload: () => Promise<void>;
  addRoutes: (rows: RouteRow[]) => void;
  /** Đang tính đường: nhãn tiến độ (null = rảnh). */
  routing: string | null;
  setRouting: (s: string | null) => void;
  toast: (msg: string) => void;
  openSource: (id: string) => void;
  editSource: (s: LaborSource | null) => void;
  /** Sang tab khác của Thị trường (Bản đồ, Khảo sát KCN…) kèm KCN. */
  goTab: (tab: 'map' | 'survey' | 'zones' | 'leads', zone?: string) => void;
}

export const LaborContext = createContext<LaborCtx | null>(null);

export function useLabor(): LaborCtx {
  const c = useContext(LaborContext);
  if (!c) throw new Error('useLabor phải nằm trong LaborContext');
  return c;
}

/** Mở hồ sơ đơn vị nguồn từ nơi khác trong app (Bản đồ, Khảo sát KCN, hồ sơ KH, CSKH). */
export const OPEN_SOURCE_KEY = 'lgvn_open_labor_source';
export function requestOpenSource(id: string) {
  try { sessionStorage.setItem(OPEN_SOURCE_KEY, id); } catch { /* chế độ riêng tư */ }
  window.location.hash = '#/market/sources';
  window.dispatchEvent(new Event('lgvn:open-labor-source'));
}
