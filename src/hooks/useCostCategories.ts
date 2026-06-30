import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { CostCategory, CostGroupType, CostPayer } from '../lib/types';

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

  const toggleDefault = async (id: string, val: boolean) => {
    const { error } = await supabase.from('cost_categories').update({ is_default: val }).eq('id', id);
    if (error) throw error;
    setCategories(prev => prev.map(c => c.id === id ? { ...c, is_default: val } : c));
  };

  const setGroupType = async (id: string, val: CostGroupType) => {
    const { error } = await supabase.from('cost_categories').update({ group_type: val }).eq('id', id);
    if (error) throw error;
    setCategories(prev => prev.map(c => c.id === id ? { ...c, group_type: val } : c));
  };

  const setDefaultPayer = async (id: string, val: CostPayer) => {
    const { error } = await supabase.from('cost_categories').update({ default_payer: val }).eq('id', id);
    if (error) throw error;
    setCategories(prev => prev.map(c => c.id === id ? { ...c, default_payer: val } : c));
  };

  return { categories, add, rename, remove, toggleDefault, setGroupType, setDefaultPayer, reload: load };
}
