// Ngữ cảnh chung của module Tuyển dụng: dữ liệu tổng quan (bootstrap), dự án đang chọn, danh mục tham chiếu
// (khách hàng, chi nhánh, KCN, CTV, xã/phường) — để các tab không phải truyền props nhiều tầng.
import { createContext, useContext } from 'react';
import { supabase } from '../../lib/supabase';
import type { Branch, Client } from '../../lib/types';
import type { RecruitBootstrap, RecruitPosition, RecruitProject, RecruitSite } from '../../lib/recruit/types';

export type RecruitTab = 'overview' | 'pipeline' | 'candidates' | 'batches' | 'settle' | 'insights' | 'workforce' | 'plan';

export interface ZoneRef { id: string; name: string; lat: number | null; lng: number | null }
export interface SaleRef { id: string; name: string; phone: string | null }
export interface CommuneRef { province: string; commune: string; lat: number | null; lng: number | null }

export interface RecruitCtx {
  boot: RecruitBootstrap;
  reload: () => Promise<void>;
  canEdit: boolean;
  project: RecruitProject | null;
  setProjectId: (id: string) => void;
  /** Đang tạo dự án mới (tab Kế hoạch hiện form trống). Chưa có dự án nào → luôn true. */
  creating: boolean;
  setCreating: (v: boolean) => void;
  sites: RecruitSite[];
  positions: RecruitPosition[];
  clients: Client[];
  branches: Branch[];
  zones: ZoneRef[];
  sales: SaleRef[];
  toast: (m: string) => void;
  onTab: (t: RecruitTab) => void;
}

export const RecruitContext = createContext<RecruitCtx | null>(null);

export function useRecruit(): RecruitCtx {
  const ctx = useContext(RecruitContext);
  if (!ctx) throw new Error('useRecruit ngoài RecruitContext');
  return ctx;
}

/** Tên hiển thị theo id (trống → ''). */
export const nameOf = <T extends { id: string; name: string }>(list: readonly T[], id: string | null | undefined): string =>
  (id && list.find(x => x.id === id)?.name) || '';

// ── Danh mục tham chiếu (bảng có sẵn, đọc bằng anon như phần còn lại của app) ──
export async function loadZones(): Promise<ZoneRef[]> {
  const { data } = await supabase.from('market_zones').select('id, name, lat, lng').order('name');
  return (data ?? []) as ZoneRef[];
}

export async function loadSales(): Promise<SaleRef[]> {
  const { data, error } = await supabase.from('contacts').select('id, name, phone').eq('kind', 'sale').order('name');
  return error ? [] : ((data ?? []) as SaleRef[]);
}

let communeCache: Promise<CommuneRef[]> | null = null;
/** Xã/phường (mô hình 2 cấp từ 07/2025) — nạp 1 lần, dùng cho ô chọn nơi ở + bản đồ nguồn lao động. */
export function loadCommunes(): Promise<CommuneRef[]> {
  if (!communeCache) {
    communeCache = (async () => {
      const { data, error } = await supabase.from('population_communes').select('province_new, commune_name, lat, lng').order('commune_name');
      if (error) { communeCache = null; return []; }
      return (data ?? []).map((r: { province_new: string; commune_name: string; lat: number | null; lng: number | null }) =>
        ({ province: r.province_new, commune: r.commune_name, lat: r.lat, lng: r.lng }));
    })();
  }
  return communeCache;
}
