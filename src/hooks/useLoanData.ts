import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { Loan, LoanMonthlyConfirmation, LoanRateHistory, LoanPaymentHistory, LoanRenewal, LoanDisbursement, ProxyLedgerEntry, LoanBorrower, LoanCollateral } from '../lib/types';

export function useLoanData() {
  const [loans, setLoans] = useState<Loan[]>([]);
  const [confirmations, setConfirmations] = useState<LoanMonthlyConfirmation[]>([]);
  const [rateHistory, setRateHistory] = useState<LoanRateHistory[]>([]);
  const [payments, setPayments] = useState<LoanPaymentHistory[]>([]);
  const [renewals, setRenewals] = useState<LoanRenewal[]>([]);
  const [disbursements, setDisbursements] = useState<LoanDisbursement[]>([]);
  const [proxyLedger, setProxyLedger] = useState<ProxyLedgerEntry[]>([]);
  const [borrowers, setBorrowers] = useState<LoanBorrower[]>([]);
  const [collaterals, setCollaterals] = useState<LoanCollateral[]>([]);
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

  const loadDisbursements = useCallback(async () => {
    const { data } = await supabase.from('loan_disbursements').select('*').order('created_at', { ascending: false });
    if (data) setDisbursements(data as LoanDisbursement[]);
  }, []);

  const loadBorrowers = useCallback(async () => {
    const { data } = await supabase.from('loan_borrowers').select('*').order('name', { ascending: true });
    if (data) setBorrowers(data as LoanBorrower[]);
  }, []);

  const loadCollaterals = useCallback(async () => {
    const { data } = await supabase.from('loan_collaterals').select('*').order('name', { ascending: true });
    if (data) setCollaterals(data as LoanCollateral[]);
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    await Promise.all([loadLoans(), loadConfirmations(), loadRateHistory(), loadPayments(), loadRenewals(), loadProxyLedger(), loadDisbursements(), loadBorrowers(), loadCollaterals()]);
    setLoading(false);
  }, [loadLoans, loadConfirmations, loadRateHistory, loadPayments, loadRenewals, loadProxyLedger, loadDisbursements, loadBorrowers, loadCollaterals]);

  useEffect(() => { reload(); }, [reload]);

  return {
    loans, setLoans,
    confirmations, setConfirmations,
    rateHistory, setRateHistory,
    payments, setPayments,
    renewals, setRenewals,
    disbursements, setDisbursements,
    proxyLedger, setProxyLedger,
    borrowers, setBorrowers,
    collaterals, setCollaterals,
    loading,
    reload,
    loadLoans,
    loadConfirmations,
    loadRateHistory,
    loadPayments,
    loadRenewals,
    loadProxyLedger,
    loadDisbursements,
    loadBorrowers,
    loadCollaterals,
  };
}
