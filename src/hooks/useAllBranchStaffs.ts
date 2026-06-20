import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { BranchStaff } from '../lib/types';

export function useAllBranchStaffs() {
  const [staffs, setStaffs] = useState<BranchStaff[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('branch_staffs').select('*').order('name');
    setStaffs((data || []) as BranchStaff[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const getByBranchId = useCallback((branchId: string) => {
    return staffs.filter(s => s.branch_id === branchId);
  }, [staffs]);

  return { staffs, loading, reload: load, getByBranchId };
}
