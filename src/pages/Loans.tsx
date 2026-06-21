import { useState, useMemo } from 'react';
import { BarChart3, Calendar, List, PenLine, RefreshCw, Shield, Handshake, Droplets, Plus, Edit2, Trash2, X, Check, AlertTriangle } from 'lucide-react';
import { useLoanData } from '../hooks/useLoanData';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { logActivity } from '../lib/audit';
import { fmtVND, fmtRate, monthlyInterest } from '../lib/loanCalculations';
import type { Loan, LoanStatus } from '../lib/types';
import { BORROWER_TYPE_LABELS, LOAN_STATUS_LABELS } from '../lib/types';

type LoanTab = 'dashboard' | 'calendar' | 'list' | 'input-interest' | 'renewal' | 'risk' | 'proxy' | 'cashflow';

const TABS: { key: LoanTab; label: string; icon: React.ReactNode }[] = [
  { key: 'dashboard',       label: 'Dashboard',       icon: <BarChart3 size={13} /> },
  { key: 'calendar',        label: 'Lich',             icon: <Calendar size={13} /> },
  { key: 'list',            label: 'Danh sach',        icon: <List size={13} /> },
  { key: 'input-interest',  label: 'Nhap lai',         icon: <PenLine size={13} /> },
  { key: 'renewal',         label: 'Dao han',          icon: <RefreshCw size={13} /> },
  { key: 'risk',            label: 'Rui ro & CIC',     icon: <Shield size={13} /> },
  { key: 'proxy',           label: 'Bac Kiem',         icon: <Handshake size={13} /> },
  { key: 'cashflow',        label: 'Dong tien',        icon: <Droplets size={13} /> },
];

interface Props {
  toast: (msg: string) => void;
}

// ── Empty form defaults ────────────────────────────────────────────
const emptyForm: Omit<Loan, 'id' | 'created_at' | 'updated_at'> = {
  label: '', bank_name: '', borrower_name: '', borrower_type: 'bank',
  collateral: null, principal: 0, interest_rate: 0, rate_type: 'floating',
  base_rate: null, margin: null, repayment_type: 'interest_only',
  term_months: 3, payment_day: 20, disbursement_date: null, maturity_date: null,
  proxy_account: null, status: 'active', notes: null,
};

export default function Loans({ toast }: Props) {
  const { user, token } = useAuth();
  const { loans, confirmations, loading, loadLoans } = useLoanData();
  const [tab, setTab] = useState<LoanTab>('dashboard');
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState<'all' | LoanStatus>('all');

  // ── Derived data ─────────────────────────────────────────────────
  const activeLoans = useMemo(() => loans.filter(l => l.status === 'active'), [loans]);
  const totalPrincipal = useMemo(() => activeLoans.reduce((s, l) => s + l.principal, 0), [activeLoans]);

  const now = new Date();
  const curYear = now.getFullYear();
  const curMonth = now.getMonth() + 1;
  const totalInterestMonth = useMemo(
    () => activeLoans.reduce((s, l) => s + monthlyInterest(l.principal, l.interest_rate, curYear, curMonth), 0),
    [activeLoans, curYear, curMonth]
  );

  const curMonthKey = `${curYear}-${String(curMonth).padStart(2, '0')}`;
  const paidCount = useMemo(
    () => confirmations.filter(c => c.month === curMonthKey && c.status === 'paid').length,
    [confirmations, curMonthKey]
  );

  const wacc = useMemo(() => {
    if (totalPrincipal === 0) return 0;
    return activeLoans.reduce((s, l) => s + l.interest_rate * l.principal, 0) / totalPrincipal;
  }, [activeLoans, totalPrincipal]);

  const cicRiskCount = useMemo(
    () => confirmations.filter(c => c.month === curMonthKey && c.cic_risk).length,
    [confirmations, curMonthKey]
  );

  const filteredLoans = useMemo(() => {
    if (filter === 'all') return loans;
    return loans.filter(l => l.status === filter);
  }, [loans, filter]);

  // ── CRUD ─────────────────────────────────────────────────────────
  const openAdd = () => {
    setForm({ ...emptyForm });
    setEditingId(null);
    setFormOpen(true);
  };

  const openEdit = (loan: Loan) => {
    setForm({
      label: loan.label, bank_name: loan.bank_name, borrower_name: loan.borrower_name,
      borrower_type: loan.borrower_type, collateral: loan.collateral, principal: loan.principal,
      interest_rate: loan.interest_rate, rate_type: loan.rate_type, base_rate: loan.base_rate,
      margin: loan.margin, repayment_type: loan.repayment_type, term_months: loan.term_months,
      payment_day: loan.payment_day, disbursement_date: loan.disbursement_date,
      maturity_date: loan.maturity_date, proxy_account: loan.proxy_account,
      status: loan.status, notes: loan.notes,
    });
    setEditingId(loan.id);
    setFormOpen(true);
  };

  const handleSave = async () => {
    if (!form.label.trim() || !form.bank_name.trim() || !form.borrower_name.trim()) {
      toast('Vui long nhap day du ten khoan vay, ngan hang, nguoi vay');
      return;
    }
    if (!token) { toast('Phien dang nhap het han, vui long dang nhap lai'); return; }
    setSaving(true);
    const payload: Record<string, unknown> = {
      label: form.label, bank_name: form.bank_name, borrower_name: form.borrower_name,
      borrower_type: form.borrower_type, collateral: form.collateral,
      principal: Number(form.principal) || 0, interest_rate: Number(form.interest_rate) || 0,
      rate_type: form.rate_type,
      base_rate: form.base_rate != null ? Number(form.base_rate) : null,
      margin: form.margin != null ? Number(form.margin) : null,
      repayment_type: form.repayment_type,
      term_months: form.term_months != null ? Number(form.term_months) : null,
      payment_day: form.payment_day != null ? Number(form.payment_day) : null,
      disbursement_date: form.disbursement_date || null,
      maturity_date: form.maturity_date || null,
      proxy_account: form.proxy_account, status: form.status, notes: form.notes,
    };

    const { data: returnedId, error } = await supabase.rpc('admin_upsert_loan', {
      p_token: token, p_id: editingId, p_data: payload,
    });
    if (error) { toast('Loi: ' + error.message); setSaving(false); return; }
    const rid = (returnedId as string) || editingId || '';
    await logActivity({ user, action: editingId ? 'update' : 'insert', table: 'loans', recordId: rid, description: editingId ? `Cap nhat khoan vay "${form.label}"` : `Them khoan vay "${form.label}" - ${form.bank_name}`, newData: payload });
    toast(editingId ? 'Da cap nhat khoan vay' : 'Da them khoan vay moi');
    setFormOpen(false);
    setSaving(false);
    await loadLoans();
  };

  const handleDelete = async (loan: Loan) => {
    if (!confirm(`Xoa vinh vien khoan vay "${loan.label}"? Thao tac nay khong the hoan tac.`)) return;
    if (!token) { toast('Phien dang nhap het han'); return; }
    const { error } = await supabase.rpc('admin_delete_loan', { p_token: token, p_id: loan.id });
    if (error) { toast('Loi: ' + error.message); return; }
    await logActivity({ user, action: 'delete', table: 'loans', recordId: loan.id, description: `Xoa khoan vay "${loan.label}"`, oldData: loan });
    toast('Da xoa khoan vay');
    await loadLoans();
  };

  const handleSettle = async (loan: Loan) => {
    if (!confirm(`Tat toan khoan vay "${loan.label}"? Trang thai se chuyen thanh "Da tat toan".`)) return;
    if (!token) { toast('Phien dang nhap het han'); return; }
    const { error } = await supabase.rpc('admin_settle_loan', { p_token: token, p_id: loan.id });
    if (error) { toast('Loi: ' + error.message); return; }
    await logActivity({ user, action: 'update', table: 'loans', recordId: loan.id, description: `Tat toan khoan vay "${loan.label}"`, oldData: { status: loan.status }, newData: { status: 'closed' } });
    toast('Da tat toan khoan vay');
    await loadLoans();
  };

  // ── Render ───────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-gray-200 border-t-blue-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-5 pt-4 pb-0">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-[17px] font-semibold flex items-center gap-2">
              <BarChart3 size={18} className="text-gray-500" /> Quan ly Khoan Vay
            </div>
            <div className="text-[11px] text-gray-400 mt-0.5">
              Tong quan danh muc · Thang {curMonth}/{curYear}
            </div>
          </div>
          <button onClick={openAdd} className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-[12px] font-medium rounded-lg hover:bg-blue-700 transition">
            <Plus size={13} /> Them khoan vay
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-0 border-b border-gray-200 overflow-x-auto">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-3.5 py-2 text-[12px] font-medium border-b-2 whitespace-nowrap transition ${
                tab === t.key
                  ? 'border-b-teal-600 text-gray-900'
                  : 'border-b-transparent text-gray-400 hover:text-gray-600'
              }`}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-5">
        {tab === 'dashboard' && <DashboardTab activeLoans={activeLoans} totalPrincipal={totalPrincipal} totalInterestMonth={totalInterestMonth} paidCount={paidCount} wacc={wacc} cicRiskCount={cicRiskCount} curMonthKey={curMonthKey} confirmations={confirmations} />}
        {tab === 'list' && <ListTab loans={filteredLoans} filter={filter} setFilter={setFilter} onEdit={openEdit} onDelete={handleDelete} onSettle={handleSettle} curYear={curYear} curMonth={curMonth} />}
        {tab === 'calendar' && <PlaceholderTab name="Lich thanh toan" />}
        {tab === 'input-interest' && <PlaceholderTab name="Nhap lai thang nay" />}
        {tab === 'renewal' && <PlaceholderTab name="Dao han & Tai vay" />}
        {tab === 'risk' && <PlaceholderTab name="Rui ro & CIC" />}
        {tab === 'proxy' && <PlaceholderTab name="Doi soat Bac Kiem" />}
        {tab === 'cashflow' && <PlaceholderTab name="Dong tien" />}
      </div>

      {/* Form modal */}
      {formOpen && (
        <LoanFormModal
          form={form} setForm={setForm}
          editingId={editingId} saving={saving}
          onSave={handleSave} onClose={() => setFormOpen(false)}
        />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// Dashboard tab
// ══════════════════════════════════════════════════════════════════════
function DashboardTab({ activeLoans, totalPrincipal, totalInterestMonth, paidCount, wacc, cicRiskCount, curMonthKey, confirmations }: {
  activeLoans: Loan[];
  totalPrincipal: number;
  totalInterestMonth: number;
  paidCount: number;
  wacc: number;
  cicRiskCount: number;
  curMonthKey: string;
  confirmations: { loan_id: string; month: string; status: string; cic_risk: boolean }[];
}) {
  const kpis = [
    { label: 'Tong du no', value: fmtVND(totalPrincipal), sub: `${activeLoans.length} khoan dang theo doi`, color: 'border-t-red-500' },
    { label: 'Lai thang nay', value: fmtVND(totalInterestMonth), sub: 'Uoc tinh', color: 'border-t-amber-500' },
    { label: 'Da dong', value: `${paidCount}/${activeLoans.length}`, sub: `Thang ${curMonthKey.split('-')[1]}`, color: 'border-t-teal-500' },
    { label: 'Chi phi von BQ', value: fmtRate(wacc), sub: 'WACC toan danh muc', color: 'border-t-blue-500' },
    { label: 'CIC risk', value: String(cicRiskCount), sub: cicRiskCount > 0 ? 'Khoan co rui ro' : 'An toan', color: cicRiskCount > 0 ? 'border-t-red-500' : 'border-t-green-500' },
  ];

  // Group by borrower
  const byBorrower = activeLoans.reduce<Record<string, number>>((acc, l) => {
    acc[l.borrower_name] = (acc[l.borrower_name] || 0) + l.principal;
    return acc;
  }, {});
  const borrowerEntries = Object.entries(byBorrower).sort((a, b) => b[1] - a[1]);

  // Group by source
  const bySource = activeLoans.reduce<Record<string, number>>((acc, l) => {
    const key = BORROWER_TYPE_LABELS[l.borrower_type];
    acc[key] = (acc[key] || 0) + l.principal;
    return acc;
  }, {});
  const sourceEntries = Object.entries(bySource).sort((a, b) => b[1] - a[1]);

  // Upcoming maturities
  const upcoming = activeLoans
    .filter(l => l.maturity_date)
    .map(l => ({ ...l, daysLeft: Math.ceil((new Date(l.maturity_date!).getTime() - Date.now()) / 86400000) }))
    .filter(l => l.daysLeft <= 90 && l.daysLeft >= 0)
    .sort((a, b) => a.daysLeft - b.daysLeft);

  // Overdue or CIC risk
  const alerts = confirmations.filter(c => c.month === curMonthKey && (c.status === 'overdue' || c.cic_risk));
  const alertLoans = alerts.map(a => {
    const loan = activeLoans.find(l => l.id === a.loan_id);
    return loan ? { loan, alert: a } : null;
  }).filter(Boolean) as { loan: Loan; alert: typeof alerts[0] }[];

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <div className="grid grid-cols-5 gap-3">
        {kpis.map((k, i) => (
          <div key={i} className={`bg-white rounded-xl border border-gray-100 p-3 border-t-[3px] ${k.color}`}>
            <div className="text-[9.5px] text-gray-400 font-semibold uppercase tracking-wide mb-1">{k.label}</div>
            <div className="text-[19px] font-semibold leading-tight">{k.value}</div>
            <div className="text-[10px] text-gray-400 mt-1">{k.sub}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3">
        {/* Du no theo nguon */}
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <div className="text-[12px] font-semibold text-gray-700 mb-3">Du no theo nguon vay</div>
          <div className="space-y-2">
            {sourceEntries.map(([name, amount]) => {
              const pct = totalPrincipal > 0 ? (amount / totalPrincipal * 100) : 0;
              return (
                <div key={name}>
                  <div className="flex justify-between text-[11px] mb-0.5">
                    <span className="text-gray-600">{name}</span>
                    <span className="font-medium">{fmtVND(amount)} ({pct.toFixed(0)}%)</span>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-500 rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Du no theo nguoi vay */}
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <div className="text-[12px] font-semibold text-gray-700 mb-3">Du no theo nguoi dung ten</div>
          <div className="space-y-2">
            {borrowerEntries.map(([name, amount]) => {
              const pct = totalPrincipal > 0 ? (amount / totalPrincipal * 100) : 0;
              const colors = ['bg-red-500', 'bg-purple-500', 'bg-amber-500', 'bg-teal-500', 'bg-blue-500'];
              const idx = borrowerEntries.findIndex(e => e[0] === name);
              return (
                <div key={name}>
                  <div className="flex justify-between text-[11px] mb-0.5">
                    <span className="text-gray-600">{name}</span>
                    <span className="font-medium">{fmtVND(amount)} ({pct.toFixed(0)}%)</span>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${colors[idx % colors.length]}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {/* Sap dao han */}
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <div className="text-[12px] font-semibold text-gray-700 mb-3 flex items-center gap-1.5">
            <AlertTriangle size={13} className="text-amber-500" /> Sap dao han (90 ngay)
          </div>
          {upcoming.length === 0 ? (
            <div className="text-[11px] text-gray-400 py-4 text-center">Khong co khoan nao sap dao han</div>
          ) : (
            <div className="space-y-1.5">
              {upcoming.map(l => (
                <div key={l.id} className="flex items-center gap-2 text-[11px] py-1.5 border-b border-gray-50 last:border-0">
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${l.daysLeft <= 14 ? 'bg-red-500' : l.daysLeft <= 30 ? 'bg-amber-500' : 'bg-gray-300'}`} />
                  <span className="font-medium flex-1">{l.label} — {l.bank_name}</span>
                  <span className={`font-semibold ${l.daysLeft <= 14 ? 'text-red-600' : 'text-amber-600'}`}>{l.daysLeft} ngay</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Canh bao */}
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <div className="text-[12px] font-semibold text-gray-700 mb-3 flex items-center gap-1.5">
            <Shield size={13} className="text-red-500" /> Canh bao CIC
          </div>
          {alertLoans.length === 0 ? (
            <div className="text-[11px] text-gray-400 py-4 text-center">Khong co canh bao</div>
          ) : (
            <div className="space-y-1.5">
              {alertLoans.map(({ loan, alert }) => (
                <div key={loan.id} className="flex items-center gap-2 text-[11px] py-1.5 border-b border-gray-50 last:border-0">
                  <span className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0" />
                  <span className="font-medium flex-1">{loan.label} — {loan.bank_name}</span>
                  <span className="px-1.5 py-0.5 bg-red-50 text-red-700 rounded text-[10px] font-semibold">
                    {alert.cic_risk ? 'CIC' : 'Qua han'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// List tab
// ══════════════════════════════════════════════════════════════════════
function ListTab({ loans, filter, setFilter, onEdit, onDelete, onSettle, curYear, curMonth }: {
  loans: Loan[];
  filter: 'all' | LoanStatus;
  setFilter: (f: 'all' | LoanStatus) => void;
  onEdit: (l: Loan) => void;
  onDelete: (l: Loan) => void;
  onSettle: (l: Loan) => void;
  curYear: number;
  curMonth: number;
}) {
  const filters: { key: 'all' | LoanStatus; label: string }[] = [
    { key: 'all', label: 'Tat ca' },
    { key: 'active', label: 'Dang vay' },
    { key: 'closed', label: 'Da tat toan' },
    { key: 'restructured', label: 'Tai co cau' },
  ];

  return (
    <div>
      <div className="flex gap-1.5 mb-3">
        {filters.map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-3 py-1 text-[11px] rounded-full border transition ${
              filter === f.key
                ? 'bg-gray-800 text-white border-gray-800'
                : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loans.length === 0 ? (
        <div className="text-center py-12 text-[13px] text-gray-400">Chua co khoan vay nao</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <table className="w-full text-[11.5px]">
            <thead>
              <tr className="bg-gray-50 text-gray-500 text-left">
                <th className="px-3 py-2 font-medium">Khoan vay</th>
                <th className="px-3 py-2 font-medium">Ngan hang</th>
                <th className="px-3 py-2 font-medium">Nguoi vay</th>
                <th className="px-3 py-2 font-medium text-right">Du no</th>
                <th className="px-3 py-2 font-medium text-right">Lai suat</th>
                <th className="px-3 py-2 font-medium text-right">Lai/thang</th>
                <th className="px-3 py-2 font-medium">Dao han</th>
                <th className="px-3 py-2 font-medium">Trang thai</th>
                <th className="px-3 py-2 font-medium w-24"></th>
              </tr>
            </thead>
            <tbody>
              {loans.map(l => {
                const interest = monthlyInterest(l.principal, l.interest_rate, curYear, curMonth);
                const maturityStr = l.maturity_date ? new Date(l.maturity_date).toLocaleDateString('vi-VN') : '—';
                const daysToMaturity = l.maturity_date ? Math.ceil((new Date(l.maturity_date).getTime() - Date.now()) / 86400000) : null;
                const statusColor = l.status === 'active' ? 'bg-green-50 text-green-700' : l.status === 'closed' ? 'bg-gray-100 text-gray-500' : 'bg-amber-50 text-amber-700';
                return (
                  <tr key={l.id} className="border-t border-gray-50 hover:bg-gray-50/50 transition">
                    <td className="px-3 py-2 font-medium text-gray-800">{l.label}</td>
                    <td className="px-3 py-2 text-gray-600">{l.bank_name}</td>
                    <td className="px-3 py-2 text-gray-600">
                      {l.borrower_name}
                      <span className="ml-1 text-[10px] text-gray-400">({BORROWER_TYPE_LABELS[l.borrower_type]})</span>
                    </td>
                    <td className="px-3 py-2 text-right font-medium">{fmtVND(l.principal)}</td>
                    <td className="px-3 py-2 text-right">
                      {fmtRate(l.interest_rate)}
                      <span className="ml-0.5 text-[9px] text-gray-400">{l.rate_type === 'floating' ? 'TN' : 'CD'}</span>
                    </td>
                    <td className="px-3 py-2 text-right text-amber-600 font-medium">{fmtVND(interest)}</td>
                    <td className="px-3 py-2">
                      <span className={daysToMaturity !== null && daysToMaturity <= 14 ? 'text-red-600 font-semibold' : daysToMaturity !== null && daysToMaturity <= 30 ? 'text-amber-600' : ''}>
                        {maturityStr}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold ${statusColor}`}>
                        {LOAN_STATUS_LABELS[l.status]}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex gap-1">
                        <button onClick={() => onEdit(l)} className="p-1 text-gray-400 hover:text-blue-600 transition" title="Sua">
                          <Edit2 size={12} />
                        </button>
                        {l.status === 'active' && (
                          <button onClick={() => onSettle(l)} className="p-1 text-gray-400 hover:text-teal-600 transition" title="Tat toan">
                            <Check size={12} />
                          </button>
                        )}
                        <button onClick={() => onDelete(l)} className="p-1 text-gray-400 hover:text-red-600 transition" title="Xoa">
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// Placeholder for tabs not yet built
// ══════════════════════════════════════════════════════════════════════
function PlaceholderTab({ name }: { name: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-gray-400">
      <div className="text-[14px] font-medium mb-1">{name}</div>
      <div className="text-[12px]">Dang phat trien...</div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// Loan form modal
// ══════════════════════════════════════════════════════════════════════
function LoanFormModal({ form, setForm, editingId, saving, onSave, onClose }: {
  form: Omit<Loan, 'id' | 'created_at' | 'updated_at'>;
  setForm: React.Dispatch<React.SetStateAction<typeof form>>;
  editingId: string | null;
  saving: boolean;
  onSave: () => void;
  onClose: () => void;
}) {
  const setF = (field: string, value: string | number | null) =>
    setForm(prev => ({ ...prev, [field]: value }));

  return (
    <div className="fixed inset-0 bg-black/40 flex items-start justify-center z-50 pt-[5vh] overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 mb-10" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
          <div className="text-[14px] font-semibold">{editingId ? 'Sua khoan vay' : 'Them khoan vay moi'}</div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
        </div>

        <div className="px-5 py-4 space-y-3 max-h-[70vh] overflow-y-auto">
          <Field label="Ten khoan vay *" value={form.label} onChange={v => setF('label', v)} placeholder="VD: Lo B1, Nha 40..." />
          <Field label="Ngan hang / Nguon vay *" value={form.bank_name} onChange={v => setF('bank_name', v)} placeholder="VD: Sacombank, ACB..." />
          <Field label="Nguoi dung ten vay *" value={form.borrower_name} onChange={v => setF('borrower_name', v)} placeholder="VD: Chi Tam, Bac Kiem..." />

          <div className="grid grid-cols-2 gap-3">
            <SelectField label="Nguon vay" value={form.borrower_type} onChange={v => setF('borrower_type', v)} options={[
              { value: 'bank', label: 'Ngan hang' },
              { value: 'proxy', label: 'Vay ho (Bac Kiem)' },
              { value: 'personal', label: 'Ca nhan' },
            ]} />
            <SelectField label="Hinh thuc tra" value={form.repayment_type} onChange={v => setF('repayment_type', v)} options={[
              { value: 'interest_only', label: 'Lai hang ky (pho bien)' },
              { value: 'reducing', label: 'Du no giam dan' },
              { value: 'emi', label: 'Nien kim co dinh' },
            ]} />
          </div>

          <Field label="Tai san dam bao (so do)" value={form.collateral || ''} onChange={v => setF('collateral', v || null)} />

          <div className="grid grid-cols-3 gap-3">
            <Field label="Du no goc (VND)" value={String(form.principal)} onChange={v => setF('principal', Number(v) || 0)} type="number" />
            <Field label="Lai suat (%/nam)" value={String(form.interest_rate)} onChange={v => setF('interest_rate', Number(v) || 0)} type="number" />
            <SelectField label="Loai lai suat" value={form.rate_type} onChange={v => setF('rate_type', v)} options={[
              { value: 'floating', label: 'Tha noi' },
              { value: 'fixed', label: 'Co dinh' },
            ]} />
          </div>

          {form.rate_type === 'floating' && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Lai co so (%)" value={String(form.base_rate ?? '')} onChange={v => setF('base_rate', v ? Number(v) : null)} type="number" />
              <Field label="Bien do (%)" value={String(form.margin ?? '')} onChange={v => setF('margin', v ? Number(v) : null)} type="number" />
            </div>
          )}

          <div className="grid grid-cols-3 gap-3">
            <Field label="Ky han (thang)" value={String(form.term_months ?? '')} onChange={v => setF('term_months', v ? Number(v) : null)} type="number" />
            <Field label="Ngay dong lai" value={String(form.payment_day ?? '')} onChange={v => setF('payment_day', v ? Number(v) : null)} type="number" />
            <SelectField label="Trang thai" value={form.status} onChange={v => setF('status', v)} options={[
              { value: 'active', label: 'Dang vay' },
              { value: 'closed', label: 'Da tat toan' },
              { value: 'restructured', label: 'Tai co cau' },
            ]} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Ngay giai ngan" value={form.disbursement_date || ''} onChange={v => setF('disbursement_date', v || null)} type="date" />
            <Field label="Ngay dao han" value={form.maturity_date || ''} onChange={v => setF('maturity_date', v || null)} type="date" />
          </div>

          {form.borrower_type === 'proxy' && (
            <Field label="TK nop tien (Bac Kiem)" value={form.proxy_account || ''} onChange={v => setF('proxy_account', v || null)} />
          )}

          <div>
            <label className="block text-[11px] text-gray-500 mb-1">Ghi chu</label>
            <textarea
              value={form.notes || ''}
              onChange={e => setF('notes', e.target.value || null)}
              className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-[12px] focus:ring-1 focus:ring-blue-300 focus:border-blue-300 outline-none resize-none"
              rows={2}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-100">
          <button onClick={onClose} className="px-4 py-1.5 text-[12px] text-gray-500 hover:text-gray-700 transition">Huy</button>
          <button onClick={onSave} disabled={saving} className="px-4 py-1.5 bg-blue-600 text-white text-[12px] font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition">
            {saving ? 'Dang luu...' : editingId ? 'Cap nhat' : 'Them moi'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Shared form field components ───────────────────────────────────
function Field({ label, value, onChange, type = 'text', placeholder }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-[11px] text-gray-500 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-[12px] focus:ring-1 focus:ring-blue-300 focus:border-blue-300 outline-none"
      />
    </div>
  );
}

function SelectField({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div>
      <label className="block text-[11px] text-gray-500 mb-1">{label}</label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-[12px] focus:ring-1 focus:ring-blue-300 focus:border-blue-300 outline-none bg-white"
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}
