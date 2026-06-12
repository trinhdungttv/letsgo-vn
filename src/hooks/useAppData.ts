import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { Client, LaborHistoryEntry, FinanceRecord, MarketSurvey, Competitor, MarketZone, MarketLead } from '../lib/types';

function withTimeout<T>(promise: Promise<T>, ms = 10000): Promise<T> {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`Không thể kết nối Supabase (${ms / 1000}s)`)), ms);
    promise.then(v => { clearTimeout(t); res(v); }).catch(e => { clearTimeout(t); rej(e); });
  });
}

export function useAppData(enabled = false) {
  const [clients, setClients] = useState<Client[]>([]);
  const [laborHistory, setLaborHistory] = useState<Record<string, LaborHistoryEntry[]>>({});
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
    setClients(clientList);
    setLaborHistory(laborMap);
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
    finance, setFinance, marketSurveys, competitors, marketZones, marketLeads,
    loading, error,
    loadClients, loadFinance, loadMarket,
  };
}
