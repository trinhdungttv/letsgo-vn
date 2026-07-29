import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabase';

const SEED_PROVINCES = [
  'Bình Dương', 'Bình Phước', 'Đồng Nai', 'Hồ Chí Minh', 'Long An',
  'Bà Rịa - Vũng Tàu', 'Tây Ninh', 'Bình Thuận', 'Lâm Đồng',
  'Đà Nẵng', 'Hà Nội', 'Hải Phòng', 'Bắc Ninh', 'Hưng Yên',
];

/**
 * `zonesForCount` (tuỳ chọn): danh sách KCN (marketZones) — khi truyền vào, tỉnh/thành nào có
 * nhiều KCN hơn sẽ hiện lên đầu danh sách (thay vì xếp theo A-Z), giúp chọn nhanh hơn ở các nơi
 * "chọn tỉnh thành để phân loại/lọc". Không truyền thì giữ nguyên thứ tự A-Z như trước.
 */
export function useProvinces(zonesForCount?: { location?: string | null }[]) {
  const [extras, setExtras] = useState<string[]>([]);

  useEffect(() => {
    (async () => {
      const [{ data: branches }, { data: zones }] = await Promise.all([
        supabase.from('branches').select('location'),
        supabase.from('market_zones').select('location'),
      ]);
      const set = new Set<string>();
      for (const b of (branches ?? []) as { location: string | null }[]) if (b.location) set.add(b.location);
      for (const z of (zones ?? []) as { location: string | null }[]) if (z.location) set.add(z.location);
      setExtras(Array.from(set));
    })();
  }, []);

  const zoneCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const z of zonesForCount ?? []) if (z.location) map.set(z.location, (map.get(z.location) ?? 0) + 1);
    return map;
  }, [zonesForCount]);

  const provinces = useMemo(() => {
    const set = new Set([...SEED_PROVINCES, ...extras]);
    return Array.from(set).sort((a, b) => {
      const diff = (zoneCounts.get(b) ?? 0) - (zoneCounts.get(a) ?? 0);
      return diff !== 0 ? diff : a.localeCompare(b, 'vi');
    });
  }, [extras, zoneCounts]);

  const addProvince = useCallback((name: string) => {
    if (!name.trim()) return;
    setExtras(prev => prev.includes(name.trim()) ? prev : [...prev, name.trim()]);
  }, []);

  return { provinces, addProvince };
}
