import { useState, useCallback, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import type { Branch } from '../lib/types';

export function useBranchData() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(false);

  const loadBranches = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from('branches').select('*').order('name');
    if (error) throw error;
    const rows = (data || []) as Branch[];
    setBranches(rows);
    setLoading(false);
    return rows;
  }, []);

  const addBranch = useCallback(async (fields: Omit<Branch, 'id' | 'created_at' | 'updated_at'>) => {
    const { data, error } = await supabase.from('branches').insert(fields).select().single();
    if (error) throw error;
    const added = data as Branch;
    setBranches(prev => [...prev, added].sort((a, b) => a.name.localeCompare(b.name)));
    return added;
  }, []);

  const updateBranch = useCallback(async (id: string, fields: Partial<Omit<Branch, 'id' | 'created_at'>>) => {
    const updates = { ...fields, updated_at: new Date().toISOString() };
    const { data, error } = await supabase.from('branches').update(updates).eq('id', id).select().single();
    if (error) throw error;
    const updated = data as Branch;
    setBranches(prev => prev.map(b => b.id === id ? updated : b));
    return updated;
  }, []);

  const deleteBranch = useCallback(async (id: string) => {
    const { error } = await supabase.from('branches').delete().eq('id', id);
    if (error) throw error;
    setBranches(prev => prev.filter(b => b.id !== id));
  }, []);

  useEffect(() => { loadBranches(); }, [loadBranches]);

  return {
    branches, setBranches, loading,
    loadBranches, addBranch, updateBranch, deleteBranch,
  };
}
