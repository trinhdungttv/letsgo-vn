import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { Region } from '../lib/types';

export function useRegions() {
  const [regions, setRegions] = useState<Region[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('regions').select('*').order('name');
    setRegions((data || []) as Region[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const add = useCallback(async (name: string) => {
    const { data, error } = await supabase.from('regions').insert({ name }).select();
    if (error) throw error;
    const added = (data as Region[])[0];
    setRegions(prev => [...prev, added].sort((a, b) => a.name.localeCompare(b.name)));
    return added;
  }, []);

  const update = useCallback(async (id: string, name: string) => {
    const { data, error } = await supabase.from('regions').update({ name }).eq('id', id).select();
    if (error) throw error;
    const updated = (data as Region[])[0];
    setRegions(prev => prev.map(r => r.id === id ? updated : r));
  }, []);

  const remove = useCallback(async (id: string) => {
    const { error } = await supabase.from('regions').delete().eq('id', id);
    if (error) throw error;
    setRegions(prev => prev.filter(r => r.id !== id));
  }, []);

  return { regions, loading, add, update, remove, reload: load };
}
