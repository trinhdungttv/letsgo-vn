import { useState } from 'react';
import { BarChart3, Calendar, List, PenLine, RefreshCw, Shield, Droplets, Plus, X } from 'lucide-react';
import { useLoanData } from '../hooks/useLoanData';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { logActivity } from '../lib/audit';
import type { Loan } from '../lib/types';
import { LoanDashboardTab } from '../components/loans/LoanDashboardTab';
import { LoanCalendarTab } from '../components/loans/LoanCalendarTab';
import { LoanListTab } from '../components/loans/LoanListTab';
import { LoanInterestTab } from '../components/loans/LoanInterestTab';
import { LoanRenewalTab } from '../components/loans/LoanRenewalTab';
import { LoanRiskTab } from '../components/loans/LoanRiskTab';
import { LoanCashflowTab } from '../components/loans/LoanCashflowTab';

type LoanTab = 'dashboard' | 'calendar' | 'list' | 'input-interest' | 'renewal' | 'risk' | 'cashflow';

const TABS: { key: LoanTab; label: string; icon: React.ReactNode }[] = [
  { key: 'dashboard',      label: 'Dashboard',        icon: <BarChart3 size={13} /> },
  { key: 'calendar',       label: 'Lịch',             icon: <Calendar size={13} /> },
  { key: 'list',           label: 'Danh sách',        icon: <List size={13} /> },
  { key: 'input-interest', label: 'Nhập lãi',         icon: <PenLine size={13} /> },
  { key: 'renewal',        label: 'Đáo hạn & Tái vay', icon: <RefreshCw size={13} /> },
  { key: 'risk',           label: 'Rủi ro & CIC',     icon: <Shield size={13} /> },
  { key: 'cashflow',       label: 'Dòng tiền',        icon: <Droplets size={13} /> },
];

interface Props {
  toast: (msg: string) => void;
}

// ── Form mac dinh ────────────────────────────────────────────────
const emptyForm: Omit<Loan, 'id' | 'created_at' | 'updated_at'> = {
  label: '', bank_name: '', borrower_name: '', borrower_type: 'bank',
  collateral: null, principal: 0, interest_rate: 0, rate_type: 'floating',
  base_rate: null, margin: null, repayment_type: 'interest_only',
  term_months: 3, payment_day: 20, disbursement_date: null, maturity_date: null,
  proxy_account: null, status: 'active', notes: null,
  grace_months: 0, requires_invoice: false,
};

export default function Loans({ toast }: Props) {
  const { user, token } = useAuth();
  const data = useLoanData();
  const { loans, confirmations, rateHistory, payments, renewals, disbursements, loading, reload } = data;
  const [tab, setTab] = useState<LoanTab>('dashboard');
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const now = new Date();

  // ── CRUD ─────────────────────────────────────────────────────────
  const openAdd = () => { setForm({ ...emptyForm }); setEditingId(null); setFormOpen(true); };

  const openEdit = (loan: Loan) => {
    const { id: _id, created_at: _c, updated_at: _u, ...rest } = loan;
    setForm(rest);
    setEditingId(loan.id);
    setFormOpen(true);
  };

  const handleSave = async () => {
    if (!form.label.trim() || !form.bank_name.trim() || !form.borrower_name.trim()) {
      toast('Vui lòng nhập đủ tên khoản vay, ngân hàng, người đứng tên');
      return;
    }
    if (!token) { toast('Phiên đăng nhập hết hạn, vui lòng đăng nhập lại'); return; }
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
      grace_months: Number(form.grace_months) || 0,
      requires_invoice: !!form.requires_invoice,
    };

    const { data: returnedId, error } = await supabase.rpc('admin_upsert_loan', {
      p_token: token, p_id: editingId, p_data: payload,
    });
    if (error) { toast('Lỗi: ' + error.message); setSaving(false); return; }
    const rid = (returnedId as string) || editingId || '';
    await logActivity({ user, action: editingId ? 'update' : 'insert', table: 'loans', recordId: rid, description: editingId ? `Cập nhật khoản vay "${form.label}"` : `Thêm khoản vay "${form.label}" — ${form.bank_name}`, newData: payload });
    toast(editingId ? 'Đã cập nhật khoản vay' : 'Đã thêm khoản vay mới');
    setFormOpen(false);
    setSaving(false);
    await reload();
  };

  const handleDelete = async (loan: Loan) => {
    if (!confirm(`Xoá vĩnh viễn khoản vay "${loan.label}"? Chỉ xoá được khi chưa có lịch sử đóng tiền — nếu đã đóng, hãy Tất toán.`)) return;
    if (!token) { toast('Phiên đăng nhập hết hạn'); return; }
    const { error } = await supabase.rpc('admin_delete_loan', { p_token: token, p_id: loan.id });
    if (error) { toast('Lỗi: ' + error.message); return; }
    await logActivity({ user, action: 'delete', table: 'loans', recordId: loan.id, description: `Xoá khoản vay "${loan.label}"`, oldData: loan });
    toast('Đã xoá khoản vay');
    await reload();
  };

  const handleSettle = async (loan: Loan) => {
    if (!confirm(`Tất toán khoản vay "${loan.label}"? Trạng thái sẽ chuyển "Đã tất toán", lịch sử được giữ nguyên.`)) return;
    if (!token) { toast('Phiên đăng nhập hết hạn'); return; }
    const { error } = await supabase.rpc('admin_settle_loan', { p_token: token, p_id: loan.id });
    if (error) { toast('Lỗi: ' + error.message); return; }
    await logActivity({ user, action: 'update', table: 'loans', recordId: loan.id, description: `Tất toán khoản vay "${loan.label}"`, oldData: { status: loan.status }, newData: { status: 'closed' } });
    toast('Đã tất toán khoản vay');
    await reload();
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
              <BarChart3 size={18} className="text-gray-500" /> Quản lý Khoản Vay
            </div>
            <div className="text-[11px] text-gray-400 mt-0.5">
              Tổng quan danh mục · Tháng {now.getMonth() + 1}/{now.getFullYear()}
            </div>
          </div>
          <button onClick={openAdd} className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-[12px] font-medium rounded-lg hover:bg-blue-700 transition">
            <Plus size={13} /> Thêm khoản vay
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-0 border-b border-gray-200 overflow-x-auto">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-3.5 py-2 text-[12px] font-medium border-b-2 whitespace-nowrap transition ${
                tab === t.key ? 'border-b-teal-600 text-gray-900' : 'border-b-transparent text-gray-400 hover:text-gray-600'
              }`}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-5">
        {tab === 'dashboard' && <LoanDashboardTab loans={loans} confirmations={confirmations} payments={payments} renewals={renewals} />}
        {tab === 'calendar' && <LoanCalendarTab loans={loans} confirmations={confirmations} />}
        {tab === 'list' && (
          <LoanListTab loans={loans} rateHistory={rateHistory} payments={payments} disbursements={disbursements}
            onEdit={openEdit} onDelete={handleDelete} onSettle={handleSettle} onChanged={reload} toast={toast} />
        )}
        {tab === 'input-interest' && <LoanInterestTab loans={loans} confirmations={confirmations} onChanged={reload} toast={toast} />}
        {tab === 'renewal' && <LoanRenewalTab loans={loans} renewals={renewals} onChanged={reload} toast={toast} />}
        {tab === 'risk' && <LoanRiskTab loans={loans} confirmations={confirmations} />}
        {tab === 'cashflow' && <LoanCashflowTab loans={loans} renewals={renewals} />}
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
  const setF = (field: string, value: string | number | boolean | null) =>
    setForm(prev => ({ ...prev, [field]: value }));

  return (
    <div className="fixed inset-0 bg-black/40 flex items-start justify-center z-50 pt-[5vh] overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 mb-10" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
          <div className="text-[14px] font-semibold">{editingId ? 'Sửa khoản vay' : 'Thêm khoản vay mới'}</div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
        </div>

        <div className="px-5 py-4 space-y-3 max-h-[70vh] overflow-y-auto">
          <Field label="Tên khoản vay *" value={form.label} onChange={v => setF('label', v)} placeholder="VD: Lô B1, Nhà 40..." />
          <Field label="Ngân hàng / Nguồn vay *" value={form.bank_name} onChange={v => setF('bank_name', v)} placeholder="VD: Sacombank, ACB..." />
          <Field label="Người đứng tên vay *" value={form.borrower_name} onChange={v => setF('borrower_name', v)} placeholder="VD: Chị Tâm, Bác Kiệm, Công ty..." />

          <div className="grid grid-cols-2 gap-3">
            <SelectField label="Nguồn vay" value={form.borrower_type} onChange={v => setF('borrower_type', v)} options={[
              { value: 'bank', label: 'Ngân hàng' },
              { value: 'proxy', label: 'Vay hộ' },
              { value: 'personal', label: 'Cá nhân' },
            ]} />
            <SelectField label="Hình thức trả" value={form.repayment_type} onChange={v => setF('repayment_type', v)} options={[
              { value: 'interest_only', label: 'Lãi hàng kỳ (phổ biến)' },
              { value: 'reducing', label: 'Dư nợ giảm dần' },
              { value: 'emi', label: 'Niên kim cố định' },
            ]} />
          </div>

          <Field label="Tài sản đảm bảo (sổ đỏ)" value={form.collateral || ''} onChange={v => setF('collateral', v || null)} />

          <div className="grid grid-cols-3 gap-3">
            <Field label="Dư nợ gốc (VND)" value={String(form.principal)} onChange={v => setF('principal', Number(v) || 0)} type="number" />
            <Field label="Lãi suất (%/năm)" value={String(form.interest_rate)} onChange={v => setF('interest_rate', Number(v) || 0)} type="number" />
            <SelectField label="Loại lãi suất" value={form.rate_type} onChange={v => setF('rate_type', v)} options={[
              { value: 'floating', label: 'Thả nổi' },
              { value: 'fixed', label: 'Cố định' },
            ]} />
          </div>

          {form.rate_type === 'floating' && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Lãi cơ sở (%)" value={String(form.base_rate ?? '')} onChange={v => setF('base_rate', v ? Number(v) : null)} type="number" />
              <Field label="Biên độ (%)" value={String(form.margin ?? '')} onChange={v => setF('margin', v ? Number(v) : null)} type="number" />
            </div>
          )}

          <div className="grid grid-cols-3 gap-3">
            <Field label="Kỳ hạn (tháng)" value={String(form.term_months ?? '')} onChange={v => setF('term_months', v ? Number(v) : null)} type="number" />
            <Field label="Ngày chi lãi hằng tháng" value={String(form.payment_day ?? '')} onChange={v => setF('payment_day', v ? Number(v) : null)} type="number" />
            <SelectField label="Trạng thái" value={form.status} onChange={v => setF('status', v)} options={[
              { value: 'active', label: 'Đang vay' },
              { value: 'closed', label: 'Đã tất toán' },
              { value: 'restructured', label: 'Tái cơ cấu' },
            ]} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Ngày giải ngân" value={form.disbursement_date || ''} onChange={v => setF('disbursement_date', v || null)} type="date" />
            <Field label="Ngày đáo hạn" value={form.maturity_date || ''} onChange={v => setF('maturity_date', v || null)} type="date" />
          </div>

          {/* v2: an han goc + giai ngan theo hoa don */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Field label="Ân hạn gốc (tháng)" value={String(form.grace_months ?? 0)} onChange={v => setF('grace_months', Number(v) || 0)} type="number" />
              <div className="text-[9.5px] text-gray-400 mt-0.5">Vay dài hạn: số tháng đầu chỉ trả lãi (VD 12 = năm đầu chỉ lãi, năm 2 trả cả gốc + lãi)</div>
            </div>
            <div className="pt-5">
              <label className="flex items-center gap-2 text-[12px] text-gray-700 cursor-pointer">
                <input type="checkbox" checked={form.requires_invoice} onChange={e => setF('requires_invoice', e.target.checked)} className="rounded" />
                🧾 Giải ngân theo hoá đơn
              </label>
              <div className="text-[9.5px] text-gray-400 mt-0.5">Khoản công ty: muốn giải ngân phải cung cấp hoá đơn để NH chuyển cho NCC</div>
            </div>
          </div>

          <Field label="TK nộp tiền (nếu nộp qua TK người khác)" value={form.proxy_account || ''} onChange={v => setF('proxy_account', v || null)} />

          <div>
            <label className="block text-[11px] text-gray-500 mb-1">Ghi chú</label>
            <textarea
              value={form.notes || ''}
              onChange={e => setF('notes', e.target.value || null)}
              className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-[12px] focus:ring-1 focus:ring-blue-300 focus:border-blue-300 outline-none resize-none"
              rows={2}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-100">
          <button onClick={onClose} className="px-4 py-1.5 text-[12px] text-gray-500 hover:text-gray-700 transition">Huỷ</button>
          <button onClick={onSave} disabled={saving} className="px-4 py-1.5 bg-blue-600 text-white text-[12px] font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition">
            {saving ? 'Đang lưu...' : editingId ? 'Cập nhật' : 'Thêm mới'}
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
