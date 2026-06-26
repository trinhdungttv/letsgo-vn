import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabase';

const SEED_PROVINCES = [
  'Bình Dương', 'Bình Phước', 'Đồng Nai', 'Hồ Chí Minh', 'Long An',
  'Bà Rịa - Vũng Tàu', 'Tây Ninh', 'Bình Thuận', 'Lâm Đồng',
  'Đà Nẵng', 'Hà Nội', 'Hải Phòng', 'Bắc Ninh', 'Hưng Yên',
];

export function useProvinces() {
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

  const provinces = useMemo(() => {
    const set = new Set([...SEED_PROVINCES, ...extras]);
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'vi'));
  }, [extras]);

  const addProvince = useCallback((name: string) => {
    if (!name.trim()) return;
    setExtras(prev => prev.includes(name.trim()) ? prev : [...prev, name.trim()]);
  }, []);

  return { provinces, addProvince };
}
