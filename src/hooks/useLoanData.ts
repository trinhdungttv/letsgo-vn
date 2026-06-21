import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { Loan, LoanMonthlyConfirmation, LoanRateHistory, LoanPaymentHistory, LoanRenewal, ProxyLedgerEntry } from '../lib/types';

export function useLoanData() {
  const [loans, setLoans] = useState<Loan[]>([]);
  const [confirmations, setConfirmations] = useState<LoanMonthlyConfirmation[]>([]);
  const [rateHistory, setRateHistory] = useState<LoanRateHistory[]>([]);
  const [payments, setPayments] = useState<LoanPaymentHistory[]>([]);
  const [renewals, setRenewals] = useState<LoanRenewal[]>([]);
  const [proxyLedger, setProxyLedger] = useState<ProxyLedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const loadLoans = useCallback(async () => {
    const { data } = await supabase.from('loans').select('*').order('created_at', { ascending: false });
    if (data) setLoans(data as Loan[]);
  }, []);

  const loadConfirmations = useCallback(async (month?: string) => {
    let q = supabase.from('monthly_confirmations').select('*').order('created_at', { ascending: false });
    if (month) q = q.eq('month', month);
    const { data } = await q;
    if (data) setConfirmations(data as LoanMonthlyConfirmation[]);
  }, []);

  const loadRateHistory = useCallback(async (loanId?: string) => {
    let q = supabase.from('loan_rate_history').select('*').order('effective_date', { ascending: false });
    if (loanId) q = q.eq('loan_id', loanId);
    const { data } = await q;
    if (data) setRateHistory(data as LoanRateHistory[]);
  }, []);

  const loadPayments = useCallback(async (loanId?: string) => {
    let q = supabase.from('payment_history').select('*').order('paid_date', { ascending: false });
    if (loanId) q = q.eq('loan_id', loanId);
    const { data } = await q;
    if (data) setPayments(data as LoanPaymentHistory[]);
  }, []);

  const loadRenewals = useCallback(async () => {
    const { data } = await supabase.from('loan_renewals').select('*').order('created_at', { ascending: false });
    if (data) setRenewals(data as LoanRenewal[]);
  }, []);

  const loadProxyLedger = useCallback(async () => {
    const { data } = await supabase.from('proxy_ledger').select('*').order('entry_date', { ascending: true });
    if (data) setProxyLedger(data as ProxyLedgerEntry[]);
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    await Promise.all([loadLoans(), loadConfirmations(), loadRateHistory(), loadPayments(), loadRenewals(), loadProxyLedger()]);
    setLoading(false);
  }, [loadLoans, loadConfirmations, loadRateHistory, loadPayments, loadRenewals, loadProxyLedger]);

  useEffect(() => { reload(); }, [reload]);

  return {
    loans, setLoans,
    confirmations, setConfirmations,
    rateHistory, setRateHistory,
    payments, setPayments,
    renewals, setRenewals,
    proxyLedger, setProxyLedger,
    loading,
    reload,
    loadLoans,
    loadConfirmations,
    loadRateHistory,
    loadPayments,
    loadRenewals,
    loadProxyLedger,
  };
}
