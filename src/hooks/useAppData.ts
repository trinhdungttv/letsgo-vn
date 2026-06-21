import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { Client, LaborHistoryEntry, ClientManagerHistory, FinanceRecord, MarketSurvey, Competitor, MarketZone, MarketLead } from '../lib/types';

// Nhan PromiseLike de chap nhan ca PostgrestFilterBuilder cua Supabase (thenable, khong phai Promise that),
// nho do TypeScript suy ra dung kieu { data, error } thay vi unknown.
function withTimeout<T>(promise: PromiseLike<T>, ms = 10000): Promise<T> {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`Không thể kết nối Supabase (${ms / 1000}s)`)), ms);
    Promise.resolve(promise).then(
      v => { clearTimeout(t); res(v); },
      e => { clearTimeout(t); rej(e); },
    );
  });
}

export function useAppData(enabled = false) {
  const [clients, setClients] = useState<Client[]>([]);
  const [laborHistory, setLaborHistory] = useState<Record<string, LaborHistoryEntry[]>>({});
  const [managerHistory, setManagerHistory] = useState<Record<string, ClientManagerHistory[]>>({});
  const [finance, setFinance] = useState<FinanceRecord[]>([]);
  const [marketSurveys, setMarketSurveys] = useState<MarketSurvey[]>([]);
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [marketZones, setMarketZones] = useState<MarketZone[]>([]);
  const [marketLeads, setMarketLeads] = useState<MarketLead[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadClients = useCallback(async () => {
    const { data, error: err } = await withTimeout(supabase.from('clients').select('*').eq('client_type', 'active').is('archived_at', null).order('name'));
    if (err) throw new Error(err.message);
    const clientList = (data || []) as Client[];
    const ids = clientList.map(c => c.id);
    let allLabor: LaborHistoryEntry[] = [];
    if (ids.length) {
      const { data: laborData, error: le } = await withTimeout(
        supabase.from('client_labor_history').select('*').in('client_id', ids).order('created_at', { ascending: true })
      );
      if (le) throw new Error(le.message);
      allLabor = (laborData || []) as LaborHistoryEntry[];
    }
    const laborMap: Record<string, LaborHistoryEntry[]> = {};
    for (const e of allLabor) {
      if (!laborMap[e.client_id]) laborMap[e.client_id] = [];
      laborMap[e.client_id].push(e);
    }
    for (const c of clientList) {
      const h = laborMap[c.id] || [];
      c.current_workers = h.length ? h[h.length - 1].count : 0;
    }

    let allManagerHist: ClientManagerHistory[] = [];
    if (ids.length) {
      const { data: mhData, error: mhe } = await withTimeout(
        supabase.from('client_manager_history').select('*').in('client_id', ids).order('effective_from', { ascending: true })
      );
      if (mhe) throw new Error(mhe.message);
      allManagerHist = (mhData || []) as ClientManagerHistory[];
    }
    const managerMap: Record<string, ClientManagerHistory[]> = {};
    for (const e of allManagerHist) {
      if (!managerMap[e.client_id]) managerMap[e.client_id] = [];
      managerMap[e.client_id].push(e);
    }

    setClients(clientList);
    setLaborHistory(laborMap);
    setManagerHistory(managerMap);
  }, []);

  const loadFinance = useCallback(async (month: string) => {
    const { data } = await withTimeout(
      supabase.from('finance_records').select('*, clients(name)').eq('month', month)
    );
    setFinance((data || []) as FinanceRecord[]);
  }, []);

  const loadMarket = useCallback(async () => {
    const [sr, cr, zr, lr] = await Promise.all([
      withTimeout(supabase.from('market_surveys').select('*').order('zone_name')),
      withTimeout(supabase.from('competitors').select('*').order('zone_name')),
      withTimeout(supabase.from('market_zones').select('*').order('name')),
      withTimeout(supabase.from('market_leads').select('*').order('lead_date', { ascending: false })),
    ]);
    if (!sr.error) setMarketSurveys((sr.data || []) as MarketSurvey[]);
    if (!cr.error) setCompetitors((cr.data || []) as Competitor[]);
    if (!zr.error) setMarketZones((zr.data || []) as MarketZone[]);
    if (!lr.error) setMarketLeads((lr.data || []) as MarketLead[]);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    setLoading(true);
    setError(null);
    Promise.all([loadClients(), loadMarket()])
      .catch((e: Error) => { if (active) setError(e.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [enabled, loadClients, loadMarket]);

  return {
    clients, setClients, laborHistory, setLaborHistory,
    managerHistory, setManagerHistory,
    finance, setFinance, marketSurveys, competitors, marketZones, setMarketZones, marketLeads,
    loading, error,
    loadClients, loadFinance, loadMarket,
  };
}
