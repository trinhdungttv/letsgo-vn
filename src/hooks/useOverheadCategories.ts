import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { OverheadCategory } from '../lib/types';

export function useOverheadCategories() {
  const [categories, setCategories] = useState<OverheadCategory[]>([]);

  const load = useCallback(async () => {
    const { data } = await supabase.from('overhead_categories').select('*').order('sort_order');
    if (data) setCategories(data);
  }, []);

  useEffect(() => { load(); }, [load]);

  const add = async (label: string, costType: 'fixed' | 'operational' = 'fixed') => {
    const { data, error } = await supabase.from('overhead_categories')
      .insert({ label, sort_order: categories.length, is_default: false, cost_type: costType }).select().single();
    if (error) throw error;
    setCategories(prev => [...prev, data as OverheadCategory]);
    return data as OverheadCategory;
  };

  const rename = async (id: string, label: string) => {
    const { error } = await supabase.from('overhead_categories').update({ label }).eq('id', id);
    if (error) throw error;
    setCategories(prev => prev.map(c => c.id === id ? { ...c, label } : c));
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from('overhead_categories').delete().eq('id', id);
    if (error) throw error;
    setCategories(prev => prev.filter(c => c.id !== id));
  };

  const toggleDefault = async (id: string, isDefault: boolean) => {
    const { error } = await supabase.from('overhead_categories').update({ is_default: isDefault }).eq('id', id);
    if (error) throw error;
    setCategories(prev => prev.map(c => c.id === id ? { ...c, is_default: isDefault } : c));
  };

  const updateCostType = async (id: string, costType: 'fixed' | 'operational') => {
    const { error } = await supabase.from('overhead_categories').update({ cost_type: costType }).eq('id', id);
    if (error) throw error;
    setCategories(prev => prev.map(c => c.id === id ? { ...c, cost_type: costType } : c));
  };

  const updateIcon = async (id: string, icon: string) => {
    const { error } = await supabase.from('overhead_categories').update({ icon }).eq('id', id);
    if (error) throw error;
    setCategories(prev => prev.map(c => c.id === id ? { ...c, icon } : c));
  };

  const reorder = async (reordered: OverheadCategory[]) => {
    setCategories(reordered);
    for (let i = 0; i < reordered.length; i++) {
      await supabase.from('overhead_categories').update({ sort_order: i }).eq('id', reordered[i].id);
    }
  };

  return { categories, add, rename, remove, toggleDefault, updateCostType, updateIcon, reorder, reload: load };
}
