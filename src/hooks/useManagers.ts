import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { Manager } from '../lib/types';

export function useManagers() {
  const [managers, setManagers] = useState<Manager[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('managers').select('*').order('name');
    setManagers((data || []) as Manager[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const add = useCallback(async (fields: Omit<Manager, 'id' | 'created_at'>) => {
    const { data, error } = await supabase.from('managers').insert(fields).select();
    if (error) throw error;
    const added = (data as Manager[])[0];
    setManagers(prev => [...prev, added].sort((a, b) => a.name.localeCompare(b.name)));
    return added;
  }, []);

  const update = useCallback(async (id: string, fields: Partial<Omit<Manager, 'id' | 'created_at'>>) => {
    const { data, error } = await supabase.from('managers').update(fields).eq('id', id).select();
    if (error) throw error;
    const updated = (data as Manager[])[0];
    setManagers(prev => prev.map(m => m.id === id ? updated : m));
  }, []);

  const remove = useCallback(async (id: string) => {
    const { error } = await supabase.from('managers').delete().eq('id', id);
    if (error) throw error;
    setManagers(prev => prev.filter(m => m.id !== id));
  }, []);

  return { managers, loading, add, update, remove, reload: load };
}
