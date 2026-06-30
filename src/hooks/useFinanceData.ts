import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { ProjectPnl, ProjectPnlCost, BranchOverhead, PnlSplitSettings, PnlInvoiceSettings } from '../lib/types';

export function useFinanceData() {
  const [projectsPnl, setProjectsPnl] = useState<ProjectPnl[]>([]);
  const [pnlCosts, setPnlCosts] = useState<Record<string, ProjectPnlCost[]>>({});
  const [overhead, setOverhead] = useState<BranchOverhead[]>([]);
  const [splitSettings, setSplitSettings] = useState<Record<string, PnlSplitSettings>>({});
  const [invoiceSettings, setInvoiceSettings] = useState<Record<string, PnlInvoiceSettings>>({});
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

  // ── pnl_split_settings ────────────────────────────────────────────
  const loadSplitSettings = useCallback(async () => {
    const { data, error } = await supabase.from('pnl_split_settings').select('*');
    if (error) throw error;
    const rows = (data || []) as PnlSplitSettings[];
    const map: Record<string, PnlSplitSettings> = {};
    for (const row of rows) map[row.client_id] = row;
    setSplitSettings(map);
    return map;
  }, []);

  const saveSplitSettings = useCallback(async (clientId: string, fields: Partial<Omit<PnlSplitSettings, 'id' | 'client_id' | 'updated_at'>>) => {
    const current = splitSettings[clientId];
    const payload = {
      client_id: clientId,
      lg_pct: current?.lg_pct ?? 40,
      cn_pct: current?.cn_pct ?? 60,
      pending_lg_pct: current?.pending_lg_pct ?? null,
      pending_cn_pct: current?.pending_cn_pct ?? null,
      pending_until_month: current?.pending_until_month ?? null,
      tax_pct: current?.tax_pct ?? 20,
      tax_exempt: current?.tax_exempt ?? false,
      ...fields,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await supabase.from('pnl_split_settings').upsert(payload, { onConflict: 'client_id' }).select().single();
    if (error) throw error;
    const saved = data as PnlSplitSettings;
    setSplitSettings(prev => ({ ...prev, [clientId]: saved }));
    return saved;
  }, [splitSettings]);

  // ── pnl_invoice_settings ──────────────────────────────────────────
  const loadInvoiceSettings = useCallback(async () => {
    const { data, error } = await supabase.from('pnl_invoice_settings').select('*');
    if (error) throw error;
    const rows = (data || []) as PnlInvoiceSettings[];
    const map: Record<string, PnlInvoiceSettings> = {};
    for (const row of rows) map[row.client_id] = row;
    setInvoiceSettings(map);
    return map;
  }, []);

  const saveInvoiceSettings = useCallback(async (clientId: string, fields: Partial<Omit<PnlInvoiceSettings, 'client_id' | 'updated_at'>>) => {
    const current = invoiceSettings[clientId];
    const payload = {
      client_id: clientId,
      period_count: current?.period_count ?? 3,
      period_labels: current?.period_labels ?? ['Kỳ 1', 'Kỳ 2', 'Kỳ 3', 'Kỳ 4'],
      invoice_label_template: current?.invoice_label_template ?? 'Hoa don',
      invoice_days: current?.invoice_days ?? [10, 20, 30, 31],
      ...fields,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await supabase.from('pnl_invoice_settings').upsert(payload, { onConflict: 'client_id' }).select().single();
    if (error) throw error;
    const saved = data as PnlInvoiceSettings;
    setInvoiceSettings(prev => ({ ...prev, [clientId]: saved }));
    return saved;
  }, [invoiceSettings]);

  useEffect(() => { loadProjectsPnl(); loadOverhead(); loadSplitSettings(); loadInvoiceSettings(); }, [loadProjectsPnl, loadOverhead, loadSplitSettings, loadInvoiceSettings]);

  return {
    projectsPnl, setProjectsPnl,
    pnlCosts, setPnlCosts,
    overhead, setOverhead,
    splitSettings, setSplitSettings,
    invoiceSettings, setInvoiceSettings,
    loading,
    loadProjectsPnl, addProjectPnl, updateProjectPnl, deleteProjectPnl,
    loadPnlCosts, addPnlCost, updatePnlCost, deletePnlCost,
    loadOverhead, addOverhead, updateOverhead, deleteOverhead, copyOverheadFromMonth,
    loadSplitSettings, saveSplitSettings,
    loadInvoiceSettings, saveInvoiceSettings,
  };
}
