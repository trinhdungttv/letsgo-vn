import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { PayrollStaff } from '../lib/types';

export function usePayrollStaffs() {
  const [payrollStaffs, setPayrollStaffs] = useState<PayrollStaff[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('payroll_staffs').select('*').order('name');
    setPayrollStaffs((data || []) as PayrollStaff[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const add = useCallback(async (name: string) => {
    const { data, error } = await supabase.from('payroll_staffs').insert({ name }).select();
    if (error) throw error;
    const added = (data as PayrollStaff[])[0];
    setPayrollStaffs(prev => [...prev, added].sort((a, b) => a.name.localeCompare(b.name)));
    return added;
  }, []);

  const update = useCallback(async (id: string, name: string) => {
    const { data, error } = await supabase.from('payroll_staffs').update({ name }).eq('id', id).select();
    if (error) throw error;
    const updated = (data as PayrollStaff[])[0];
    setPayrollStaffs(prev => prev.map(s => s.id === id ? updated : s));
  }, []);

  const remove = useCallback(async (id: string) => {
    const { error } = await supabase.from('payroll_staffs').delete().eq('id', id);
    if (error) throw error;
    setPayrollStaffs(prev => prev.filter(s => s.id !== id));
  }, []);

  return { payrollStaffs, loading, add, update, remove, reload: load };
}
