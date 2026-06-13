import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { Client, CRMProduct, CRMDeal, CRMActivity, CRMPipelineEntry } from '../lib/types';

export function useCRMData(enabled: boolean) {
  const [leads, setLeads] = useState<Client[]>([]);
  const [products, setProducts] = useState<CRMProduct[]>([]);
  const [deals, setDeals] = useState<CRMDeal[]>([]);
  const [activities, setActivities] = useState<CRMActivity[]>([]);
  const [pipeline, setPipeline] = useState<CRMPipelineEntry[]>([]);
  const [crmLoading, setCrmLoading] = useState(false);

  const reloadCRM = useCallback(async () => {
    if (!enabled) return;
    setCrmLoading(true);
    try {
      const [l, p, d, a, pl] = await Promise.all([
        supabase.from('clients').select('*').eq('client_type', 'prospect').order('created_at', { ascending: false }),
        supabase.from('crm_products').select('*').order('name'),
        supabase.from('crm_deals').select('*, crm_leads(name, company), crm_products(name)').order('created_at', { ascending: false }),
        supabase.from('crm_activities').select('*').order('created_at', { ascending: false }),
        supabase.from('crm_pipeline').select('*, contacts(name, phone), crm_products(name, category, price)').order('created_at', { ascending: false }),
      ]);
      setLeads((l.data ?? []) as Client[]);
      setProducts(p.data ?? []);
      setDeals((d.data ?? []) as CRMDeal[]);
      setActivities(a.data ?? []);
      setPipeline((pl.data ?? []) as CRMPipelineEntry[]);
    } finally {
      setCrmLoading(false);
    }
  }, [enabled]);

  const reloadPipeline = useCallback(async () => {
    const { data } = await supabase.from('crm_pipeline').select('*, contacts(name, phone), crm_products(name, category, price)').order('created_at', { ascending: false });
    setPipeline((data ?? []) as CRMPipelineEntry[]);
  }, []);

  useEffect(() => { reloadCRM(); }, [reloadCRM]);

  return { leads, setLeads, products, setProducts, deals, setDeals, activities, setActivities, pipeline, setPipeline, crmLoading, reloadCRM, reloadPipeline };
}
