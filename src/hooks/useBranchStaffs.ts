import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { BranchStaff } from '../lib/types';

export function useBranchStaffs(branchId: string | null) {
  const [staffs, setStaffs] = useState<BranchStaff[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!branchId) { setStaffs([]); return; }
    setLoading(true);
    const { data } = await supabase
      .from('branch_staffs')
      .select('*')
      .eq('branch_id', branchId)
      .order('name');
    setStaffs((data || []) as BranchStaff[]);
    setLoading(false);
  }, [branchId]);

  useEffect(() => { load(); }, [load]);

  const add = useCallback(async (fields: { name: string; role?: string | null; phone?: string | null; email?: string | null }) => {
    if (!branchId) throw new Error('No branch selected');
    const { data, error } = await supabase
      .from('branch_staffs')
      .insert({ branch_id: branchId, ...fields })
      .select();
    if (error) throw error;
    const added = (data as BranchStaff[])[0];
    setStaffs(prev => [...prev, added].sort((a, b) => a.name.localeCompare(b.name)));
    return added;
  }, [branchId]);

  const update = useCallback(async (id: string, fields: Partial<Pick<BranchStaff, 'name' | 'role' | 'phone' | 'email'>>) => {
    const { data, error } = await supabase
      .from('branch_staffs')
      .update(fields)
      .eq('id', id)
      .select();
    if (error) throw error;
    const updated = (data as BranchStaff[])[0];
    setStaffs(prev => prev.map(s => s.id === id ? updated : s));
  }, []);

  const remove = useCallback(async (id: string) => {
    const { error } = await supabase.from('branch_staffs').delete().eq('id', id);
    if (error) throw error;
    setStaffs(prev => prev.filter(s => s.id !== id));
  }, []);

  return { staffs, loading, add, update, remove, reload: load };
}
