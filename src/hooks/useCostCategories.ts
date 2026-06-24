import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { CostCategory } from '../lib/types';

export function useCostCategories() {
  const [categories, setCategories] = useState<CostCategory[]>([]);

  const load = useCallback(async () => {
    const { data } = await supabase.from('cost_categories').select('*').order('sort_order');
    if (data) setCategories(data);
  }, []);

  useEffect(() => { load(); }, [load]);

  const add = async (label: string) => {
    const { data, error } = await supabase.from('cost_categories')
      .insert({ label, sort_order: categories.length })
      .select().single();
    if (error) throw error;
    setCategories(prev => [...prev, data]);
    return data as CostCategory;
  };

  const rename = async (id: string, label: string) => {
    const { error } = await supabase.from('cost_categories').update({ label }).eq('id', id);
    if (error) throw error;
    setCategories(prev => prev.map(c => c.id === id ? { ...c, label } : c));
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from('cost_categories').delete().eq('id', id);
    if (error) throw error;
    setCategories(prev => prev.filter(c => c.id !== id));
  };

  return { categories, add, rename, remove, reload: load };
}
