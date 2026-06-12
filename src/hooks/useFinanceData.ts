import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { ProjectPnl, ProjectPnlCost, BranchOverhead } from '../lib/types';

export function useFinanceData() {
  const [projectsPnl, setProjectsPnl] = useState<ProjectPnl[]>([]);
  const [pnlCosts, setPnlCosts] = useState<Record<string, ProjectPnlCost[]>>({});
  const [overhead, setOverhead] = useState<BranchOverhead[]>([]);
  const [loading, setLoading] = useState(false);

  // ── projects_pnl ──────────────────────────────────────────────────
  const loadProjectsPnl = useCallback(async (month?: string) => {
    setLoading(true);
    let query = supabase.from('projects_pnl').select('*, clients(name)').order('created_at');
    if (month) query = query.eq('month', month);
    const { data, error } = await query;
    if (error) throw error;
    setProjectsPnl((data || []) as ProjectPnl[]);
    setLoading(false);
    return (data || []) as ProjectPnl[];
  }, []);

  const addProjectPnl = useCallback(async (fields: Omit<ProjectPnl, 'id' | 'created_at' | 'updated_at' | 'clients'>) => {
    const { data, error } = await supabase.from('projects_pnl').insert(fields).select('*, clients(name)').single();
    if (error) throw error;
    const added = data as ProjectPnl;
    setProjectsPnl(prev => [...prev, added]);
    return added;
  }, []);

  const updateProjectPnl = useCallback(async (id: string, fields: Partial<Omit<ProjectPnl, 'id' | 'created_at' | 'clients'>>) => {
    const updates = { ...fields, updated_at: new Date().toISOString() };
    const { data, error } = await supabase.from('projects_pnl').update(updates).eq('id', id).select('*, clients(name)').single();
    if (error) throw error;
    const updated = data as ProjectPnl;
    setProjectsPnl(prev => prev.map(p => p.id === id ? updated : p));
    return updated;
  }, []);

  const deleteProjectPnl = useCallback(async (id: string) => {
    const { error } = await supabase.from('projects_pnl').delete().eq('id', id);
    if (error) throw error;
    setProjectsPnl(prev => prev.filter(p => p.id !== id));
    setPnlCosts(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  // ── projects_pnl_costs ────────────────────────────────────────────
  const loadPnlCosts = useCallback(async (pnlId: string) => {
    const { data, error } = await supabase.from('projects_pnl_costs').select('*').eq('pnl_id', pnlId).order('sort_order');
    if (error) throw error;
    const costs = (data || []) as ProjectPnlCost[];
    setPnlCosts(prev => ({ ...prev, [pnlId]: costs }));
    return costs;
  }, []);

  const addPnlCost = useCallback(async (fields: Omit<ProjectPnlCost, 'id'>) => {
    const { data, error } = await supabase.from('projects_pnl_costs').insert(fields).select().single();
    if (error) throw error;
    const added = data as ProjectPnlCost;
    setPnlCosts(prev => ({ ...prev, [added.pnl_id]: [...(prev[added.pnl_id] || []), added] }));
    return added;
  }, []);

  const updatePnlCost = useCallback(async (id: string, fields: Partial<Omit<ProjectPnlCost, 'id' | 'pnl_id'>>) => {
    const { data, error } = await supabase.from('projects_pnl_costs').update(fields).eq('id', id).select().single();
    if (error) throw error;
    const updated = data as ProjectPnlCost;
    setPnlCosts(prev => ({
      ...prev,
      [updated.pnl_id]: (prev[updated.pnl_id] || []).map(c => c.id === id ? updated : c),
    }));
    return updated;
  }, []);

  const deletePnlCost = useCallback(async (id: string, pnlId: string) => {
    const { error } = await supabase.from('projects_pnl_costs').delete().eq('id', id);
    if (error) throw error;
    setPnlCosts(prev => ({
      ...prev,
      [pnlId]: (prev[pnlId] || []).filter(c => c.id !== id),
    }));
  }, []);

  // ── branch_overhead ───────────────────────────────────────────────
  const loadOverhead = useCallback(async (branchManager?: string, month?: string) => {
    let query = supabase.from('branch_overhead').select('*').order('sort_order');
    if (branchManager) query = query.eq('branch_manager', branchManager);
    if (month) query = query.eq('month', month);
    const { data, error } = await query;
    if (error) throw error;
    const rows = (data || []) as BranchOverhead[];
    setOverhead(prev => {
      const others = prev.filter(o => !(
        (!branchManager || o.branch_manager === branchManager) &&
        (!month || o.month === month)
      ));
      return [...others, ...rows];
    });
    return rows;
  }, []);

  const addOverhead = useCallback(async (fields: Omit<BranchOverhead, 'id'>) => {
    const { data, error } = await supabase.from('branch_overhead').insert(fields).select().single();
    if (error) throw error;
    const added = data as BranchOverhead;
    setOverhead(prev => [...prev, added]);
    return added;
  }, []);

  const updateOverhead = useCallback(async (id: string, fields: Partial<Omit<BranchOverhead, 'id'>>) => {
    const { data, error } = await supabase.from('branch_overhead').update(fields).eq('id', id).select().single();
    if (error) throw error;
    const updated = data as BranchOverhead;
    setOverhead(prev => prev.map(o => o.id === id ? updated : o));
    return updated;
  }, []);

  const deleteOverhead = useCallback(async (id: string) => {
    const { error } = await supabase.from('branch_overhead').delete().eq('id', id);
    if (error) throw error;
    setOverhead(prev => prev.filter(o => o.id !== id));
  }, []);

  const copyOverheadFromMonth = useCallback(async (branchManager: string, fromMonth: string, toMonth: string) => {
    const { data, error } = await supabase.from('branch_overhead').select('*').eq('branch_manager', branchManager).eq('month', fromMonth);
    if (error) throw error;
    const rows = (data || []) as BranchOverhead[];
    if (rows.length === 0) return [];
    const inserts = rows.map(row => ({
      branch_manager: row.branch_manager,
      label: row.label,
      value: row.value,
      cost_type: row.cost_type,
      sort_order: row.sort_order,
      month: toMonth,
    }));
    const { data: inserted, error: insError } = await supabase.from('branch_overhead').insert(inserts).select();
    if (insError) throw insError;
    const added = (inserted || []) as BranchOverhead[];
    setOverhead(prev => [...prev, ...added]);
    return added;
  }, []);

  useEffect(() => { loadProjectsPnl(); loadOverhead(); }, [loadProjectsPnl, loadOverhead]);

  return {
    projectsPnl, setProjectsPnl,
    pnlCosts, setPnlCosts,
    overhead, setOverhead,
    loading,
    loadProjectsPnl, addProjectPnl, updateProjectPnl, deleteProjectPnl,
    loadPnlCosts, addPnlCost, updatePnlCost, deletePnlCost,
    loadOverhead, addOverhead, updateOverhead, deleteOverhead, copyOverheadFromMonth,
  };
}
