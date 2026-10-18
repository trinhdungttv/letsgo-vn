import type { BdsHeadLease, BdsOpexCategory, BdsTenant } from '../lib/types';
import type { Landlord } from '../lib/calc/types';

export const LANDLORD_NAME: Record<Landlord, string> = { mbt: 'Minh Bảo Tín', ts4: 'Thủy Sản 4' };
export const LANDLORD_SHORT: Record<Landlord, string> = { mbt: 'MBT', ts4: 'TS4' };

const byOrderName = (a: { sort_order: number; name: string }, b: { sort_order: number; name: string }) =>
  (a.sort_order || 0) - (b.sort_order || 0) || a.name.localeCompare(b.name, 'vi');

export function sortLeases(leases: BdsHeadLease[]): BdsHeadLease[] {
  return [...leases].sort((a, b) => (a.landlord === b.landlord ? 0 : a.landlord === 'mbt' ? -1 : 1) || byOrderName(a, b));
}

export function sortTenants(tenants: BdsTenant[]): BdsTenant[] {
  return [...tenants].sort((a, b) => Number(b.active) - Number(a.active) || byOrderName(a, b));
}

export function sortCategories(cats: BdsOpexCategory[]): BdsOpexCategory[] {
  return [...cats].sort(byOrderName);
}

export function nextSortOrder(rows: { sort_order: number }[]): number {
  return rows.reduce((m, r) => Math.max(m, r.sort_order || 0), 0) + 1;
}
