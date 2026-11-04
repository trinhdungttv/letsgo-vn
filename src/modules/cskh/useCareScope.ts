// Bộ lọc phạm vi dùng chung cho Dashboard / Nhịp độ / Sự kiện: Chi nhánh · Người phụ trách
// · Người quản lý KH (thay cho "Cá nhân · Công việc" của PRM) · Sao ưu tiên công ty. Nhớ lựa chọn theo trình duyệt.
// Sao của người liên hệ = sao CAO NHẤT trong các công ty họ gắn (clients.star_rating, gán ở trang Khách hàng).
import { useMemo } from 'react';
import { useAuth } from '../../lib/auth';
import { useBranchLookup } from '../../hooks/useBranchLookup';
import { usePersistedState } from '../../hooks/usePersistedState';
import { branchOf } from '../../lib/branchRef';
import { contactStarOf, isStarFilter, matchesStarFilter, type ClientStar, type StarFilter } from '../../lib/clientStars';
import { SPACE_INFO, type CskhSpace } from '../../lib/cskh/space';
import type { CskhContact } from '../../lib/cskh/types';
import type { Branch, Client } from '../../lib/types';

export interface ScopeFilters {
  /** 'all' | branch id */
  branch: string;
  /** 'mine' | 'all' | 'none' | app_users.id */
  owner: string;
  /** 'all' | tên người quản lý KH (clients.manager) */
  manager: string;
  /** Sao ưu tiên của công ty: 'all' | '3' | '2' | '1' | 'none' (chưa xếp sao) */
  stars: StarFilter;
}

export const DEFAULT_SCOPE: ScopeFilters = { branch: 'all', owner: 'mine', manager: 'all', stars: 'all' };

export interface CareScope {
  filters: ScopeFilters;
  setFilters: (f: ScopeFilters) => void;
  /** Người liên hệ khớp bộ lọc. */
  scoped: CskhContact[];
  /** Người liên hệ thấy được sau khi bấm "Xoá lọc" (bộ lọc mặc định) — để báo "N mục ngoài bộ lọc". */
  base: CskhContact[];
  isFiltered: boolean;
  isAdmin: boolean;
  options: {
    branches: Branch[];
    managers: string[];
    /** Số người liên hệ theo sao (trước khi lọc) — 0 người gắn công ty thì ẩn ô lọc sao. */
    starCounts: Record<ClientStar | 'none', number>;
    /** Có người liên hệ nào gắn công ty khách không (tệp Sale thì không). */
    hasCompanies: boolean;
  };
  /** Sao ưu tiên của 1 người liên hệ (sao cao nhất trong các công ty họ gắn). */
  starOf: (contactId: string) => ClientStar | null;
}

export function useCareScope(contacts: readonly CskhContact[], clients: readonly Client[], space: CskhSpace = 'client'): CareScope {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const { branches } = useBranchLookup();
  // Khách và Sale nhớ bộ lọc riêng
  const [stored, setFilters] = usePersistedState<ScopeFilters>(SPACE_INFO[space].storageKey('cskh_scope_filters'), DEFAULT_SCOPE);
  const merged: ScopeFilters = { ...DEFAULT_SCOPE, ...stored };
  // Bộ lọc lưu từ bản cũ / giá trị lạ → coi như "Mọi mức sao"
  const filters: ScopeFilters = { ...merged, stars: isStarFilter(merged.stars) ? merged.stars : 'all' };
  const clientById = useMemo(() => new Map(clients.map(c => [c.id, c])), [clients]);

  const index = useMemo(() => new Map(contacts.map(c => {
    const branchIds = new Set<string>();
    const managers = new Set<string>();
    for (const id of c.clientIds) {
      const cl = clientById.get(id);
      const b = branchOf(cl ?? null, branches);
      if (b) branchIds.add(b.id);
      const m = cl?.manager?.trim();
      if (m) managers.add(m);
    }
    return [c.id, { branchIds, managers, star: contactStarOf(c.clientIds, clientById) }] as const;
  })), [contacts, clientById, branches]);

  const options = useMemo(() => {
    const bIds = new Set<string>();
    const mgrs = new Set<string>();
    const starCounts: Record<ClientStar | 'none', number> = { 3: 0, 2: 0, 1: 0, none: 0 };
    for (const v of index.values()) {
      v.branchIds.forEach(id => bIds.add(id));
      v.managers.forEach(m => mgrs.add(m));
      starCounts[v.star ?? 'none'] += 1;
    }
    return {
      branches: branches.filter(b => bIds.has(b.id)),
      managers: [...mgrs].sort((a, b) => a.localeCompare(b, 'vi')),
      starCounts,
      hasCompanies: contacts.some(c => c.clientIds.length > 0),
    };
  }, [index, branches, contacts]);

  const { branch, owner, manager, stars } = filters;
  const isFiltered = branch !== 'all' || manager !== 'all' || owner !== 'mine' || stars !== 'all';
  const pick = useMemo(() => (f: ScopeFilters) => contacts.filter(c => {
    const ix = index.get(c.id);
    if (f.branch !== 'all' && !ix?.branchIds.has(f.branch)) return false;
    if (f.manager !== 'all' && !ix?.managers.has(f.manager)) return false;
    if (f.stars !== 'all' && !matchesStarFilter(ix?.star ?? null, f.stars)) return false;
    if (f.owner === 'mine') {
      // Admin xem cả người chưa giao — lúc đầu mọi người liên hệ đều chưa có người phụ trách
      if (!(c.ownerId === user?.id || (c.ownerId === null && isAdmin))) return false;
    } else if (f.owner === 'none') {
      if (c.ownerId !== null) return false;
    } else if (f.owner !== 'all' && c.ownerId !== f.owner) {
      return false;
    }
    return true;
  }), [contacts, index, user?.id, isAdmin]);
  const scoped = useMemo(() => pick({ branch, owner, manager, stars }), [pick, branch, owner, manager, stars]);
  const starOf = useMemo(() => (contactId: string) => index.get(contactId)?.star ?? null, [index]);
  const base = useMemo(() => (isFiltered ? pick(DEFAULT_SCOPE) : scoped), [pick, isFiltered, scoped]);

  return {
    filters,
    setFilters,
    scoped,
    base,
    isFiltered,
    isAdmin,
    options,
    starOf,
  };
}
